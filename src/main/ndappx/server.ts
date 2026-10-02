/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import log from 'electron-log';
import * as path from 'path';
import { ISignal, Signal } from '@lumino/signaling';
import {
  CvmfsMode,
  EngineType,
  resolveWorkingDirectory,
  SettingType,
  userSettings,
  WorkspaceSettings
} from '../config/settings';
import { ProgressView } from '../progressview/progressview';
import type { IServer, JupyterServer } from '../server';
import {
  createContainerConfigParser,
  getDefaultStorageDirectory,
  resolveNdappxPath
} from '../server';
import { getUserDataDir } from '../utils';
import { formatOperationProgress } from './progress';
import { buildVMRequest } from './request';
import { NdappxSession } from './session';
import { IOperation, IVM } from './types';

const GLASS_TITLE = 'Neurodesk';
const SHUTDOWN_TIMEOUT_SECONDS = 30;

/** State of a running native session, as shown in the session window. */
export interface INativeSessionStatus {
  /**
   * open: the desktop window is showing.
   * closed: the window was closed; the VM keeps running.
   * opening: a reopen request is in progress.
   * ended: the VM or the NeurodeskAppX process is gone.
   */
  state: 'open' | 'closed' | 'opening' | 'ended';
  message?: string;
}

/**
 * Server for the NeurodeskAppX engine. It pulls the image picked in the
 * welcome view, boots it in a VM and opens the native desktop window. There
 * is no JupyterLab URL: `info.displayMode` is 'native'.
 */
export class NdappxServer implements IServer {
  constructor(options: JupyterServer.IOptions, progressView?: ProgressView) {
    this._options = options;
    this._progressView = progressView;
    const workingDir =
      options.workingDirectory || userSettings.resolvedWorkingDirectory;
    const wsSettings = new WorkspaceSettings(workingDir);
    this._info = {
      type: 'local',
      displayMode: 'native',
      engine: EngineType.NeurodeskAppX,
      url: null,
      port: null,
      token: null,
      workingDirectory: workingDir,
      containerConfigName: options.containerConfigName,
      imageVersion: options.imageVersion,
      serverArgs: wsSettings.getValue(SettingType.serverArgs),
      cvmfsMode: wsSettings.getValue(SettingType.cvmfsMode)
    };
  }

  get info(): JupyterServer.IInfo {
    return this._info;
  }

  get status(): INativeSessionStatus {
    return this._status;
  }

  get statusChanged(): ISignal<this, INativeSessionStatus> {
    return this._statusChanged;
  }

  get started(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const check = () => {
        if (this._startServer) {
          this._startServer.then(() => resolve(true)).catch(reject);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  start(): Promise<JupyterServer.IInfo> {
    if (!this._startServer) {
      this._startServer = this._start().catch(async error => {
        log.error('NeurodeskAppX session failed to start:', error);
        await this._session?.shutdown(SHUTDOWN_TIMEOUT_SECONDS);
        throw error;
      });
    }
    return this._startServer;
  }

  stop(): Promise<void> {
    if (!this._stopServer) {
      this._stopping = true;
      this._stopServer = (async () => {
        if (this._session) {
          await this._session.shutdown(SHUTDOWN_TIMEOUT_SECONDS);
          log.info('NeurodeskAppX session shut down');
        }
      })();
    }
    return this._stopServer;
  }

  /** Reopen the desktop window after the user closed it. */
  async reopenDesktop(): Promise<void> {
    if (!this._session || this._status.state !== 'closed') {
      return;
    }
    this._setStatus({ state: 'opening' });
    try {
      await this._session.openGlass({ title: GLASS_TITLE });
      this._setStatus({ state: 'open' });
    } catch (error) {
      log.error('Failed to reopen the NeurodeskAppX desktop:', error);
      this._setStatus({ state: 'closed', message: (error as Error).message });
    }
  }

  private async _start(): Promise<JupyterServer.IInfo> {
    const { containerConfigName, imageVersion } = this._options;
    if (!containerConfigName) {
      throw new Error('containerConfigName is required to launch a session');
    }
    const parser = createContainerConfigParser(
      containerConfigName,
      imageVersion
    );
    const reference = parser.getNdappxImageName();
    this._info.imageVersion = parser.getImageVersion();

    const command = resolveNdappxPath();
    const cacheDir = path.join(getUserDataDir(), 'ndappx-cache');
    log.info(
      `NeurodeskAppX launch: command=${command} cacheDir=${cacheDir} image=${reference}`
    );

    this._progress('Starting NeurodeskAppX', '');
    const session = new NdappxSession({
      command,
      args: ['--cache-dir', cacheDir],
      onLog: text => {
        log.info(`[ndappx] ${text.trimEnd()}`);
        this._progressView?.setChildProcessLog(text);
      },
      onExit: (code, signal) => {
        if (!this._stopping) {
          log.error(
            `NeurodeskAppX exited unexpectedly (code=${code}, signal=${signal})`
          );
          this._setStatus({
            state: 'ended',
            message: `NeurodeskAppX exited unexpectedly (code ${code}${
              signal ? `, signal ${signal}` : ''
            }).`
          });
        }
      }
    });
    this._session = session;
    await session.start();

    this._progress('Checking virtualization', '');
    const { info, virtualization } = await session.checkHost();
    log.info(
      `NeurodeskAppX ${info.version} on ${info.platform.os}/${info.platform.arch}, backend=${virtualization.backend}`
    );

    const onProgress = (op: IOperation) => {
      const { title, detail } = formatOperationProgress(op);
      this._progress(title, detail);
    };

    const image = await session.pull(reference, onProgress);
    log.info(
      `NeurodeskAppX image ready: ${image.reference} ${image.digest} (cache_hit=${image.cache_hit})`
    );

    const storageDirectory =
      userSettings.getValue(SettingType.neurodesktopStorageDirectory) ||
      getDefaultStorageDirectory();
    const additionalDirectory = this._info.serverArgs
      ? resolveWorkingDirectory(this._info.serverArgs)
      : '';

    const vmRequest = buildVMRequest({
      imageId: image.image_id,
      imageVersion: this._info.imageVersion,
      storageDirectory: path.resolve(storageDirectory),
      additionalDirectory,
      cvmfsEnabled: this._info.cvmfsMode !== CvmfsMode.Download,
      defaults: info.defaults
    });
    // env is returned in VM config; log only non-sensitive fields.
    log.info(
      `NeurodeskAppX VM: memory=${vmRequest.memory_mib}MiB cpus=${
        vmRequest.cpus
      } storage=${vmRequest.storage.host_path} shares=${vmRequest.shares
        .map(s => `${s.host_path}:${s.guest_path}`)
        .join(',')} cvmfs=${vmRequest.cvmfs.enabled}`
    );

    await session.startVm(vmRequest, onProgress);
    await session.openGlass({ title: GLASS_TITLE }, onProgress);
    this._setStatus({ state: 'open' });

    session.watchVm(vm => this._onVmSnapshot(vm));
    return this._info;
  }

  private _onVmSnapshot(vm: IVM | null): void {
    // Transient poll failures are ignored; process exit is reported by onExit.
    if (!vm || this._stopping || this._status.state === 'opening') {
      return;
    }
    if (vm.state === 'failed' || vm.state === 'stopped') {
      this._setStatus({
        state: 'ended',
        message:
          vm.last_error?.message ||
          (vm.state === 'failed'
            ? 'The virtual machine failed.'
            : 'The virtual machine stopped.')
      });
      return;
    }
    const glass = vm.glass?.state;
    if (glass === 'open' || glass === 'starting') {
      this._setStatus({ state: 'open' });
    } else if (this._status.state !== 'ended') {
      this._setStatus({
        state: 'closed',
        message: glass === 'failed' ? vm.last_error?.message : undefined
      });
    }
  }

  private _setStatus(status: INativeSessionStatus): void {
    if (
      this._status.state === status.state &&
      this._status.message === status.message
    ) {
      return;
    }
    // Once ended, only a new session can change the state.
    if (this._status.state === 'ended') {
      return;
    }
    this._status = status;
    this._statusChanged.emit(status);
  }

  private _progress(title: string, detail: string): void {
    this._progressView?.setProgress(
      title,
      detail ? `<div class="message-row">${detail}</div>` : '',
      true
    );
  }

  private _options: JupyterServer.IOptions;
  private _progressView?: ProgressView;
  private _info: JupyterServer.IInfo;
  private _session: NdappxSession | null = null;
  private _startServer: Promise<JupyterServer.IInfo> | null = null;
  private _stopServer: Promise<void> | null = null;
  private _stopping = false;
  private _status: INativeSessionStatus = { state: 'opening' };
  private _statusChanged = new Signal<this, INativeSessionStatus>(this);
}
