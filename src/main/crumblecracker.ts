import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { request } from 'http';

export interface ICrumbleOptions {
  binary: string;
  cache: string;
  prefixArgs?: string[];
}
export interface ICrumbleStart {
  image: string;
  name: string;
  storage: string;
  directory: string;
  port: number;
  gpu: boolean;
  cvmfs: boolean;
  memory?: number;
  cpus?: number;
  env?: { [name: string]: string };
}
interface IReady {
  event: string;
  protocol: string;
  api_version: number;
  base_url: string;
  token: string;
  pid: number;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Main-process only. Backend credentials never cross the renderer IPC bridge. */
export class CrumbleCracker {
  private child: ChildProcessWithoutNullStreams;
  private ready: Promise<IReady>;
  private exited: Promise<void>;
  private dead = false;
  private stopping = false;
  private stopPromise?: Promise<void>;
  private vm?: string;
  private glassPromise?: Promise<void>;

  constructor(options: ICrumbleOptions) {
    this.child = spawn(
      options.binary,
      [
        ...(options.prefixArgs || []),
        '--headless',
        '--cache-dir',
        options.cache
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    this.exited = new Promise(resolve => {
      this.child.once('exit', () => {
        this.dead = true;
        resolve();
      });
      this.child.once('error', () => {
        this.dead = true;
        resolve();
      });
    });
    // Drain without echoing guest logs, which can contain Jupyter credentials.
    this.child.stderr.on('data', () => undefined);
    this.ready = new Promise((resolve, reject) => {
      let buffer = '';
      let complete = false;
      const timer = setTimeout(
        () => finish(new Error('CrumbleCracker ready timeout')),
        30000
      );
      const finish = (error?: Error, value?: IReady) => {
        if (complete) {
          return;
        }
        complete = true;
        clearTimeout(timer);
        this.child.stdout.removeListener('data', onData);
        this.child.stdout.resume();
        error ? reject(error) : resolve(value!);
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (Buffer.byteLength(buffer) > 65536) {
          finish(new Error('Invalid CrumbleCracker ready record'));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) {
          return;
        }
        try {
          const value: IReady = JSON.parse(buffer.slice(0, newline));
          const url = new URL(value.base_url);
          if (
            value.event !== 'ready' ||
            value.protocol !== 'ndappx' ||
            value.api_version !== 1 ||
            value.pid !== this.child.pid ||
            !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
            url.protocol !== 'http:' ||
            url.hostname !== '127.0.0.1' ||
            !url.port ||
            url.pathname !== '/' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          ) {
            throw new Error('Invalid CrumbleCracker ready record');
          }
          finish(undefined, value);
        } catch (_) {
          finish(new Error('Invalid CrumbleCracker ready record'));
        }
      };
      this.child.stdout.on('data', onData);
      this.child.once('error', () =>
        finish(new Error('Could not launch CrumbleCracker binary'))
      );
      this.child.once('exit', () =>
        finish(new Error('CrumbleCracker exited before ready'))
      );
    });
  }

  private async api(route: string, body?: unknown, raw = false): Promise<any> {
    const ready = await this.ready;
    if (this.dead) {
      throw new Error('CrumbleCracker exited');
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request(
        new URL(route, ready.base_url),
        {
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${ready.token}`,
            ...(payload === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Idempotency-Key': uuid()
                })
          }
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 16 * 1024 * 1024) {
              req.destroy(new Error('Backend response too large'));
            } else {
              chunks.push(chunk);
            }
          });
          res.on('error', reject);
          res.on('end', () => {
            try {
              if (res.statusCode !== 200 && res.statusCode !== 202) {
                throw new Error(
                  `CrumbleCracker request failed (${res.statusCode})`
                );
              }
              const data = Buffer.concat(chunks);
              resolve(raw ? data : JSON.parse(data.toString('utf8')));
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.setTimeout(35000, () =>
        req.destroy(new Error('CrumbleCracker request timeout'))
      );
      req.on('error', () =>
        reject(new Error('CrumbleCracker connection failed'))
      );
      req.end(payload);
    });
  }

  private async operation(
    route: string,
    body: unknown,
    progress: (phase: string) => void
  ) {
    if (this.stopping) {
      throw new Error('CrumbleCracker stopped');
    }
    const accepted = await this.api(route, body);
    const deadline = Date.now() + 40 * 60 * 1000;
    while (!this.stopping && Date.now() < deadline) {
      const op = await this.api(`/v1/operations/${accepted.operation_id}`);
      progress(op.phase);
      if (op.state === 'succeeded') {
        return op.result;
      }
      if (op.state === 'failed' || op.state === 'cancelled') {
        throw new Error(`CrumbleCracker ${op.error?.code || op.state}`);
      }
      await delay(250);
    }
    throw new Error(
      this.stopping
        ? 'CrumbleCracker stopped'
        : 'CrumbleCracker operation timeout'
    );
  }

  async start(
    options: ICrumbleStart,
    progress: (phase: string) => void = () => undefined
  ) {
    try {
      const info = await this.api('/v1/info');
      if (
        !info.capabilities.jupyter_first ||
        (options.gpu && !info.capabilities.gpu_acceleration)
      ) {
        throw new Error(
          'This CrumbleCracker build does not support the selected configuration'
        );
      }
      const image = await this.operation(
        '/v1/images/pull',
        {
          reference: options.image,
          platform: `linux/${process.arch === 'x64' ? 'amd64' : process.arch}`,
          policy: 'if_missing',
          timeout_seconds: 1800
        },
        progress
      );
      const result = await this.operation(
        '/v1/vms',
        {
          image_id: image.image_id,
          name: options.name,
          memory_mib: options.memory || 8192,
          cpus: options.cpus || 2,
          user: 'jovyan',
          home: { mode: 'persistent', id: options.name },
          storage: { host_path: options.storage, create: true },
          shares: options.directory
            ? [
                {
                  host_path: options.directory,
                  guest_path: '/data',
                  read_only: false
                }
              ]
            : [],
          network: { enabled: true, allow_internet: true },
          display: { width: 1440, height: 900, gpu_acceleration: options.gpu },
          cvmfs: { enabled: options.cvmfs },
          jupyter: { host_port: options.port },
          env: options.env || {},
          boot_timeout_seconds: 600
        },
        progress
      );
      if (
        !result.jupyter ||
        !/^[0-9a-f]{64}$/.test(result.jupyter.token) ||
        result.jupyter.url !== `http://127.0.0.1:${options.port}/lab`
      ) {
        throw new Error('Backend returned invalid Jupyter connection details');
      }
      this.vm = result.vm_id;
      return { ...result.jupyter, imageDigest: image.digest };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  openDesktop(): Promise<void> {
    if (this.glassPromise) {
      return this.glassPromise;
    }
    this.glassPromise = (async () => {
      if (!this.vm || this.stopping) {
        throw new Error('Start Jupyter before opening the desktop');
      }
      const state = await this.api(`/v1/vms/${this.vm}`);
      if (state.glass?.state === 'open') {
        return;
      }
      await this.operation(
        `/v1/vms/${this.vm}/glass`,
        {
          title: 'Neurodesk Desktop',
          width: 1440,
          height: 900,
          timeout_seconds: 180
        },
        () => undefined
      );
    })().finally(() => {
      this.glassPromise = undefined;
    });
    return this.glassPromise;
  }

  diagnostics() {
    return this.api(`/v1/vms/${this.vm}/diagnostics`);
  }
  screenshot(): Promise<Buffer> {
    return this.api(`/v1/vms/${this.vm}/screenshot`, undefined, true);
  }

  private async waitForExit(timeout: number) {
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      this.exited,
      new Promise(resolve => {
        timer = setTimeout(resolve, timeout);
      })
    ]);
    clearTimeout(timer!);
  }

  stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopping = true;
    this.stopPromise = (async () => {
      try {
        if (!this.dead) {
          await this.api('/v1/shutdown', { timeout_seconds: 30 });
        }
      } catch (_) {
        /* EOF requests cleanup for this owned child. */
      }
      this.child.stdin.end();
      await this.waitForExit(35000);
      if (!this.dead) {
        this.child.kill('SIGTERM');
        await this.waitForExit(10000);
      }
      if (!this.dead) {
        throw new Error('CrumbleCracker cleanup did not finish');
      }
    })();
    return this.stopPromise;
  }
}
