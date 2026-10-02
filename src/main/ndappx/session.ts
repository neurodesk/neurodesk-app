/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { NdappxClient, NdappxError } from './client';
import { ReadinessReader } from './readiness';
import {
  IAcceptance,
  IGlass,
  IGlassRequest,
  IImage,
  IInfo,
  IOperation,
  IVirtualization,
  IVM,
  IVMRequest,
  IVMResult
} from './types';

const READY_TIMEOUT_MS = 60000;
const DEFAULT_POLL_MS = 500;
const DEFAULT_WATCH_MS = 2000;
const EXIT_GRACE_MS = 10000;

/** User-facing text for each virtualization failure reason. */
export const VIRTUALIZATION_HINTS: { [code: string]: string } = {
  unsupported_platform:
    'This computer is not supported by NeurodeskAppX (it needs Apple Silicon macOS, Linux x64/ARM64 with KVM, or Windows x64 with Windows Hypervisor Platform).',
  permission_denied:
    'Access to the hypervisor was denied. On Linux, add your user to the "kvm" group and log in again.',
  virtualization_disabled:
    'Hardware virtualization is disabled. Enable it in the BIOS/UEFI settings (Intel VT-x / AMD-V), and on Windows turn on "Windows Hypervisor Platform".',
  hypervisor_unavailable:
    'The hypervisor is unavailable. On Linux make sure /dev/kvm exists; on Windows turn on "Windows Hypervisor Platform".',
  probe_failed: 'The virtualization check failed. See the logs for details.'
};

export class VirtualizationError extends Error {
  constructor(readonly virtualization: IVirtualization) {
    super(
      VIRTUALIZATION_HINTS[virtualization.reason?.code] ||
        virtualization.reason?.message ||
        'Virtualization is not accessible'
    );
    this.name = 'VirtualizationError';
  }
}

export class OperationError extends Error {
  constructor(readonly operation: IOperation) {
    super(
      operation.error?.message ||
        `NeurodeskAppX ${operation.kind} ${operation.state}`
    );
    this.name = 'OperationError';
  }
}

export interface INdappxSessionOptions {
  /** Executable path. */
  command: string;
  /** Extra args, e.g. ['--cache-dir', dir]. `--headless` is always first. */
  args?: string[];
  env?: NodeJS.ProcessEnv;
  pollIntervalMs?: number;
  watchIntervalMs?: number;
  readyTimeoutMs?: number;
  /** Receives stderr diagnostics (never contains the token). */
  onLog?: (line: string) => void;
  /** Called if the child exits on its own after readiness. */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

/**
 * Owns one NeurodeskAppX child process and drives the headless session
 * sequence: info/virtualization -> pull -> VM -> Glass -> stop/shutdown.
 */
export class NdappxSession {
  constructor(options: INdappxSessionOptions) {
    this._options = options;
  }

  get client(): NdappxClient {
    return this._client;
  }

  get pid(): number | undefined {
    return this._child?.pid;
  }

  get vmId(): string | null {
    return this._vmId;
  }

  get running(): boolean {
    return !!this._child && !this._exited;
  }

  /** Spawn the child and wait for its readiness record. */
  start(): Promise<void> {
    if (this._started) {
      return this._started;
    }
    this._started = new Promise<void>((resolve, reject) => {
      const reader = new ReadinessReader();
      const stderr: string[] = [];
      let settled = false;
      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          // A child we cannot talk to must not outlive the failed start.
          if (this._child && !this._exited) {
            this._shuttingDown = true;
            this._child.stdin?.end();
            this._child.kill('SIGTERM');
          }
          const tail = stderr.slice(-10).join('').trim();
          reject(tail ? new Error(`${err.message}\n${tail}`) : err);
        }
      };

      const child = spawn(
        this._options.command,
        ['--headless', ...(this._options.args || [])],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: this._options.env || process.env,
          windowsHide: true
        }
      );
      this._child = child;
      this._exitPromise = new Promise(res => {
        child.once('exit', (code, signal) => {
          this._exited = true;
          this._stopWatching();
          res();
          if (!settled) {
            fail(
              new Error(
                `NeurodeskAppX exited before it was ready (code=${code}, signal=${signal})`
              )
            );
          } else if (!this._shuttingDown) {
            this._options.onExit?.(code, signal);
          }
        });
      });

      const timer = setTimeout(
        () => fail(new Error('Timed out waiting for NeurodeskAppX to start')),
        this._options.readyTimeoutMs ?? READY_TIMEOUT_MS
      );

      child.on('error', err => fail(err));
      // Keep stdin open for the whole session: EOF triggers child cleanup.
      child.stdin.on('error', () => undefined);

      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) {
          return;
        }
        try {
          const ready = reader.push(chunk);
          if (ready) {
            this._client = new NdappxClient(ready.base_url, ready.token);
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        } catch (err) {
          fail(err as Error);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr.push(text);
        if (stderr.length > 50) {
          stderr.shift();
        }
        this._options.onLog?.(text);
      });
    });
    return this._started;
  }

  /**
   * GET /v1/info and /v1/virtualization. Throws VirtualizationError when the
   * hypervisor is not usable.
   */
  async checkHost(): Promise<{ info: IInfo; virtualization: IVirtualization }> {
    const [info, virtualization] = await Promise.all([
      this._client.info(),
      this._client.virtualization()
    ]);
    if (!virtualization.accessible) {
      throw new VirtualizationError(virtualization);
    }
    return { info, virtualization };
  }

  async pull(
    reference: string,
    onProgress?: (op: IOperation) => void
  ): Promise<IImage> {
    const accepted = await this._client.pullImage({
      reference,
      policy: 'if_missing'
    });
    const op = await this.pollOperation(accepted.body, onProgress);
    return op.result as IImage;
  }

  async startVm(
    req: IVMRequest,
    onProgress?: (op: IOperation) => void
  ): Promise<IVMResult> {
    const accepted = await this._client.startVm(req);
    const op = await this.pollOperation(accepted.body, onProgress);
    const result = op.result as IVMResult;
    this._vmId = result?.vm_id || accepted.body.resource_id;
    return result;
  }

  async openGlass(
    req: IGlassRequest = {},
    onProgress?: (op: IOperation) => void
  ): Promise<IGlass> {
    const vmId = this._requireVm();
    console.log(`Opening NeurodeskAppX Glass for VM ${vmId}`);
    const accepted = await this._client.openGlass(vmId, req);
    const op = await this.pollOperation(accepted.body, onProgress);
    return op.result as IGlass;
  }

  vm(): Promise<IVM> {
    return this._client.vm(this._requireVm());
  }

  async stopVm(timeoutSeconds = 30): Promise<void> {
    if (!this._vmId) {
      return;
    }
    this._stopWatching();
    const accepted = await this._client.stopVm(this._vmId, timeoutSeconds);
    await this.pollOperation(accepted.body);
  }

  /**
   * Poll an operation until it reaches a terminal state. Resolves on
   * `succeeded`, rejects with OperationError on `failed`/`cancelled`.
   */
  async pollOperation(
    accepted: IAcceptance,
    onProgress?: (op: IOperation) => void
  ): Promise<IOperation> {
    const interval = this._options.pollIntervalMs ?? DEFAULT_POLL_MS;
    for (;;) {
      if (this._exited) {
        throw new Error('NeurodeskAppX exited during an operation');
      }
      const op = await this._client.operation(accepted.operation_id);
      onProgress?.(op);
      if (op.state === 'succeeded') {
        return op;
      }
      if (op.state === 'failed' || op.state === 'cancelled') {
        throw new OperationError(op);
      }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  /**
   * Poll VM status and report every snapshot until stopped. Errors while
   * polling are reported as null snapshots.
   */
  watchVm(onChange: (vm: IVM | null, error?: Error) => void): void {
    this._stopWatching();
    const interval = this._options.watchIntervalMs ?? DEFAULT_WATCH_MS;
    const tick = async () => {
      if (!this._watching || this._exited) {
        return;
      }
      try {
        onChange(await this.vm());
      } catch (err) {
        onChange(null, err as Error);
      }
      if (this._watching && !this._exited) {
        this._watchTimer = setTimeout(tick, interval);
      }
    };
    this._watching = true;
    this._watchTimer = setTimeout(tick, interval);
  }

  /**
   * Gracefully shut down the whole child. POST /v1/shutdown (retrying a
   * 504 with a fresh key), then wait for exit. Falls back to stdin EOF,
   * SIGTERM and finally SIGKILL.
   */
  shutdown(timeoutSeconds = 30): Promise<void> {
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }
    this._shuttingDown = true;
    this._stopWatching();
    this._shutdownPromise = (async () => {
      if (!this._child || this._exited) {
        return;
      }
      if (this._client) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await this._client.shutdown(timeoutSeconds, randomUUID());
            break;
          } catch (err) {
            const retry = err instanceof NdappxError && err.status === 504;
            this._options.onLog?.(
              `NeurodeskAppX shutdown request failed: ${
                (err as Error).message
              }\n`
            );
            if (!retry) {
              break;
            }
          }
        }
      }
      if (await this._waitForExit(EXIT_GRACE_MS)) {
        return;
      }
      this._child.stdin.end();
      if (await this._waitForExit(EXIT_GRACE_MS)) {
        return;
      }
      this._child.kill('SIGTERM');
      if (await this._waitForExit(EXIT_GRACE_MS)) {
        return;
      }
      this._child.kill('SIGKILL');
      await this._waitForExit(EXIT_GRACE_MS);
    })();
    return this._shutdownPromise;
  }

  private _waitForExit(ms: number): Promise<boolean> {
    if (this._exited) {
      return Promise.resolve(true);
    }
    return Promise.race([
      this._exitPromise.then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), ms).unref())
    ]);
  }

  private _requireVm(): string {
    if (!this._vmId) {
      throw new Error('No NeurodeskAppX VM has been started');
    }
    return this._vmId;
  }

  private _stopWatching(): void {
    this._watching = false;
    if (this._watchTimer) {
      clearTimeout(this._watchTimer);
      this._watchTimer = null;
    }
  }

  private _options: INdappxSessionOptions;
  private _child: ChildProcess | null = null;
  private _client: NdappxClient;
  private _started: Promise<void> | null = null;
  private _exitPromise: Promise<void>;
  private _exited = false;
  private _shuttingDown = false;
  private _shutdownPromise: Promise<void> | null = null;
  private _vmId: string | null = null;
  private _watching = false;
  private _watchTimer: NodeJS.Timeout | null = null;
}
