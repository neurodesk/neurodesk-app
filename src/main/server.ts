import { ChildProcess, execFile, execSync } from 'child_process';
import { IRegistry, SERVER_TOKEN_PREFIX } from './registry';
import { dialog } from 'electron';
import { ArrayExt } from '@lumino/algorithm';
import log from 'electron-log';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { IDisposable, IEnvironmentType, IPythonEnvironment } from './tokens';
import { Config, getFreePort, getUserDataDir, waitForDuration } from './utils';
import {
  EngineType,
  KeyValueMap,
  resolveWorkingDirectory,
  serverLaunchArgsDefault,
  SettingType,
  userSettings,
  WorkspaceSettings
} from './config/settings';
import { randomBytes } from 'crypto';
import { ProgressView } from './progressview/progressview';

const SERVER_LAUNCH_TIMEOUT = 40 * 60000; // milliseconds
const SERVER_RESTART_LIMIT = 1; // max server restarts

function createTempFile(
  fileName = 'temp',
  data = '',
  encoding: BufferEncoding = 'utf8'
) {
  const tempDirPath = path.join(os.tmpdir(), 'neurodesk_app');
  const tmpDir = fs.mkdtempSync(tempDirPath);
  const tmpFilePath = path.join(tmpDir, fileName);

  fs.writeFileSync(tmpFilePath, data, { encoding });

  return tmpFilePath;
}

function createLaunchScript(
  serverInfo: JupyterServer.IInfo,
  engineType: EngineType,
  port: number,
  token: string
): string {
  const isWin = process.platform === 'win32';
  const strPort = port.toString();
  const config = Config.loadConfig(path.join(__dirname, '..'));
  const tag = config.ConfigToml.jupyter_neurodesk_version;
  let imageRegistry = `vnmd/neurodesktop:${tag}`;
  let additionalDir = '';
  let isPodman = engineType === EngineType.Podman;
  let isTinyRange = engineType === EngineType.TinyRange;
  let isDocker = engineType === EngineType.Docker;
  let CVMFS_DISABLE = serverInfo.cvmfsMode == 'true'; // Download(1): CVMFS_DISABLE=true, Stream(0): CVMFS_DISABLE=false
  let neurodesktopStorageDir = isWin
    ? 'C://neurodesktop-storage'
    : '~/neurodesktop-storage';
  const isDev = process.env.NODE_ENV === 'development';
  console.log('isDev', isDev);
  const tinyrangePath = isDev
    ? path
        .join(
          __dirname,
          '../../..',
          'tinyrange',
          isWin ? 'tinyrange.exe' : 'tinyrange'
        )
        .replace(/\\/g, '/') // Development path
    : path
        .join(
          process.resourcesPath,
          'app',
          'tinyrange',
          isWin ? 'tinyrange.exe' : 'tinyrange'
        )
        .replace(/\\/g, '/'); // Production path
  let osVersion = '';
  if (os.platform() === 'linux') {
    osVersion = execSync('lsb_release -a | grep Description')
      .toString()
      .split('Description:')[1]
      .trim()
      .split(' ')[1]
      .split('.')
      .join('')
      .slice(0, 4);
  }

  console.debug(`!!!..... ${strPort} engineType ${engineType}`);

  // engineCmd = isPodman && process.platform == 'linux' ? 'podman' : engineType;
  // note: traitlets<5.0 require fully specified arguments to
  // be followed by equals sign without a space; this can be
  // removed once jupyter_server requires traitlets>5.0
  let volumeCheck = `${
    isWin
      ? `${engineType} volume inspect neurodesk-home >NUL 2>&1 || ${engineType} volume create neurodesk-home`
      : `${engineType} volume exists neurodesk-home &> /dev/null || ${engineType} volume create neurodesk-home`
  }`;
  let volumeCreate = `${isPodman ? `${volumeCheck}` : ''}`;

  // Common launch arguments
  let commonLaunchArgs = [
    `--shm-size=1gb`,
    `-it`,
    `--privileged`,
    `--user=root`,
    `--name neurodeskapp-${strPort}`,
    `-p ${strPort}:${strPort}`,
    `-e NEURODESKTOP_VERSION=${tag}`,
    `-e CVMFS_DISABLE=${CVMFS_DISABLE}`,
    isWin
      ? `-v ${neurodesktopStorageDir}:/neurodesktop-storage`
      : `-e NB_UID="$(id -u)" -e NB_GID="$(id -g)" -v ${neurodesktopStorageDir}:/neurodesktop-storage`
  ];

  let launchArgs: string[] = [];
  if (isTinyRange) {
    const buildDir = path.join(neurodesktopStorageDir, 'build');
    launchArgs = [
      tinyrangePath,
      'login',
      `--buildDir ${buildDir.replace(/\\/g, '//')}`,
      `--oci ${imageRegistry}`,
      `--forward ${strPort}`,
      '-m //lib/qemu:user',
      `--mount-rw ${neurodesktopStorageDir}:/neurodesktop-storage`,
      `--volume neurodeskHome,${20 * 1024},/home,persist`,
      '--auto-scale'
    ];
  } else {
    launchArgs = [
      `${engineType} run -d --rm`,
      ...commonLaunchArgs,
      isPodman
        ? `-v neurodesk-home:/home/jovyan --network bridge:ip=10.88.0.10,mac=88:75:56:ef:3e:d6`
        : `--mount source=neurodesk-home,target=/home/jovyan --mac-address=88:75:56:ef:3e:d6`,
      parseInt(osVersion) >= 2310 && isDocker // use apparmor profile for ubuntu>=23.10
        ? '--security-opt apparmor=neurodeskapp'
        : ''
    ];
  }
  if (serverInfo.workingDirectory) {
    additionalDir = resolveWorkingDirectory(serverInfo.workingDirectory);
    if (process.platform === 'linux') {
      // Only chmod if directory is in /home
      const isHomeDir = additionalDir.startsWith('/home/');

      if (isHomeDir) {
        // Async chmod to avoid blocking when directory is large, container will mount regardless
        fs.promises.chmod(additionalDir, 0o777).catch(e => {
          log.warn(
            `Failed to chmod ${additionalDir} (continuing anyway): ${e.message}`
          );
        });
      } else {
        log.info(
          `Skipping chmod for network/remote directory: ${additionalDir}`
        );
      }
    }
    launchArgs.push(
      isTinyRange
        ? `--mount-rw "${
            isWin ? additionalDir.replace(/\\/g, '//') : additionalDir
          }":/data`
        : ` --volume "${additionalDir}":/data`
    );
  }
  launchArgs.push(imageRegistry);

  if (!serverInfo.overrideDefaultServerArgs) {
    launchArgs.push(
      isTinyRange
        ? `-e NEURODESKTOP_VERSION=${tag} -e CVMFS_DISABLE=${CVMFS_DISABLE} -E "chmod 777 /dev/fuse;`
        : ''
    );
    for (const arg of serverLaunchArgsDefault) {
      launchArgs.push(arg.replace('{token}', token).replace('{port}', strPort));
    }
    launchArgs.push(isTinyRange ? '"' : '');
  }

  /**
   * Launch command for TinyRange needs downloading the executable file into tmp directory, then unzip it and run it.
   * curl -L https://github.com/tinyrange/tinyrange/releases/download/v0.1.8/tinyrange-linux-amd64.zip > tinyrange.zip && unzip tinyrange.zip && curl -L https://raw.githubusercontent.com/NeuroDesk/neurodesktop/2b3d68adbfbff2529f0d27a9de59da7d1ff48cb9/neurodesk.yml > neurodesk.yml &&
   */

  let launchCmd = launchArgs.join(' ');
  let removeCmd = `${
    isWin
      ? `${engineType} container exists neurodeskapp-${strPort} >NUL 2>&1 && ${engineType} rm -f neurodeskapp-${strPort} >NUL 2>&1`
      : `${engineType} container exists neurodeskapp-${strPort} &> /dev/null && ${engineType} rm -f neurodeskapp-${strPort} &> /dev/null`
  }`;
  let stopCmd = `${
    isPodman
      ? `${removeCmd}`
      : isTinyRange
      ? ``
      : isWin
      ? `${engineType} rm -f neurodeskapp-${strPort} >NUL 2>&1`
      : `${engineType} rm -f neurodeskapp-${strPort} &> /dev/null`
  }`;
  let script: string;

  if (isWin) {
    script = `
        setlocal enabledelayedexpansion
        SET ERRORCODE=0
        SET IMAGE_EXISTS=
        where ${engineType} >nul 2>nul
          if %ERRORLEVEL% neq 0 (
              echo "${engineType} command not found, running ${launchCmd}"
              ${launchCmd}
          )
        FOR /F "usebackq delims=" %%i IN (\`${engineType} image inspect ${imageRegistry} --format="exists" 2^>nul\`) DO SET IMAGE_EXISTS=%%i
        if "%IMAGE_EXISTS%"=="exists" (
            echo "Image exists"
            FOR /F "usebackq delims=" %%i IN (\`${engineType} container inspect -f "{{.State.Status}}" neurodeskapp-${strPort}\`) DO SET CONTAINER_STATUS=%%i
              ${stopCmd} 
              ${volumeCreate}
              ${launchCmd}
        ) else (
            echo "Image does not exist"
            ${stopCmd} 
            ${volumeCreate}            
            ${engineType} pull docker.io/${imageRegistry}
            ${launchCmd}
        )
      `;
  } else {
    script = `
        if [[ "$(${engineType} image inspect ${imageRegistry} --format='exists' 2> /dev/null)" == "exists" ]]; then 
          ${stopCmd} 
          ${volumeCreate}
          ${launchCmd}
        else
          ${stopCmd}
          ${volumeCreate}
          ${engineType} pull docker.io/${imageRegistry}
          ${launchCmd}
        fi
        `;
  }

  const ext = isWin ? 'bat' : 'sh';
  const scriptPath = createTempFile(`launch.${ext}`, script);

  console.debug(`Server launch script:\n${script}`);

  if (!isWin) {
    fs.chmodSync(scriptPath, 0o755);
  }

  return scriptPath;
}

async function checkIfUrlExists(url: URL): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = requestFn(url, function (r) {
      resolve(r.statusCode >= 200 && r.statusCode < 400);
      console.debug(`Checking if ${url} exists... ${r.statusCode}`);
    });
    req.on('error', function (err) {
      resolve(false);
    });
    req.end();
  });
}

export async function waitUntilServerIsUp(url: URL): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    async function checkUrl() {
      const exists = await checkIfUrlExists(url);
      if (exists) {
        return resolve(true);
      } else {
        setTimeout(async () => {
          await checkUrl();
        }, 500);
      }
    }

    checkUrl();
  });
}

export class JupyterServer {
  constructor(
    options: JupyterServer.IOptions,
    registry: IRegistry,
    progressView: ProgressView
  ) {
    this._options = options;
    this._progressView = progressView;
    const option: IPythonEnvironment = {
      name: 'python',
      path: 'C:\\',
      type: IEnvironmentType.Path,
      versions: {},
      defaultKernel: 'python3'
    };
    this._info.environment = option;
    const workingDir =
      this._options.workingDirectory || userSettings.resolvedWorkingDirectory;
    this._info.workingDirectory = workingDir;

    const wsSettings = new WorkspaceSettings(workingDir);
    this._info.engine = wsSettings.getValue(SettingType.engineType);
    this._info.cvmfsMode = wsSettings.getValue(SettingType.cvmfsMode);
    this._info.serverArgs = wsSettings.getValue(SettingType.serverArgs);
    this._info.overrideDefaultServerArgs = wsSettings.getValue(
      SettingType.overrideDefaultServerArgs
    );
    this._info.serverEnvVars = wsSettings.getValue(SettingType.serverEnvVars);
  }

  get info(): JupyterServer.IInfo {
    return this._info;
  }

  /**
   * Start a local Jupyter server. This method can be
   * called multiple times without initiating multiple starts.
   *
   * @return a promise that is resolved when the server has started.
   */
  public start(port?: number, token?: string): Promise<JupyterServer.IInfo> {
    if (this._startServer) {
      return this._startServer;
    }
    let started = false;
    let stderrChunks: string[] = [];
    let stdoutChunks: string[] = [];

    console.debug('Starting Jupyter server....');
    this._startServer = new Promise<JupyterServer.IInfo>(
      // eslint-disable-next-line no-async-promise-executor
      async (resolve, reject) => {
        const isWin = process.platform === 'win32';
        console.debug('isWin: ' + isWin);
        // const pythonPath = this._info.environment.path;
        // if (!fs.existsSync(pythonPath)) {
        //   reject(`Error: Environment not found at: ${pythonPath}`);
        //   return;
        // }
        // this._info.engine = getEngineType() || EngineType.Podman;
        this._info.port = port || this._options.port || (await getFreePort());
        this._info.token =
          token || this._options.token || this._generateToken();

        this._info.url = new URL(
          `http://127.0.0.1:${this._info.port}/lab?token=${this._info.token}`
        );

        console.log('token', this._info.token);
        const launchScriptPath = createLaunchScript(
          this._info,
          this._info.engine,
          this._info.port,
          this._info.token
        );

        const jlabWorkspacesDir = path.join(
          this._info.workingDirectory,
          '.jupyter',
          'desktop-workspaces'
        );

        const serverEnvVars = { ...this._info.serverEnvVars };

        // allow modifying PATH without replacing by using {PATH} variable
        if (process.env.PATH && 'PATH' in serverEnvVars) {
          serverEnvVars.PATH = serverEnvVars.PATH.replace(
            '{PATH}',
            process.env.PATH
          );
        }

        const execOptions = {
          cwd: this._info.workingDirectory,
          shell: isWin ? 'cmd.exe' : '/bin/bash',
          env: {
            ...process.env,
            JUPYTER_CONFIG_DIR:
              process.env.JLAB_DESKTOP_CONFIG_DIR || getUserDataDir(),
            JUPYTERLAB_WORKSPACES_DIR:
              process.env.JLAB_DESKTOP_WORKSPACES_DIR || jlabWorkspacesDir,
            ...serverEnvVars
          },
          timeout: 500000000
        };

        // console.debug(
        //   `Server launch parameters:\n  [script]: ${launchScriptPath}\n  [options]: ${JSON.stringify(
        //     execOptions
        //   )}`
        // );

        this._nbServer = execFile(launchScriptPath, execOptions);

        Promise.race([
          waitUntilServerIsUp(this._info.url),
          waitForDuration(SERVER_LAUNCH_TIMEOUT)
        ]).then((up: boolean) => {
          if (up) {
            started = true;
            fs.unlinkSync(launchScriptPath);
            console.log('delete launchScriptPath', launchScriptPath);
            resolve(this._info);
          } else {
            console.debug("Server didn't start in time");
            this._serverStartFailed();
            reject(
              new Error(
                'Failed to launch Neurodesk from Promise ' +
                  this._info.port +
                  stderrChunks +
                  stdoutChunks
              )
            );
          }
        });

        this._nbServer.stdout.on('data', (data: string) => {
          // console.debug(`stdout: ${data}`);
          stdoutChunks = stdoutChunks.concat(data);
          if (this._progressView) {
            this._progressView.setChildProcessLog(data);
          }
        });

        this._nbServer.stderr.on('data', (data: string) => {
          // console.debug(`stderr: ${data}`);
          if (data.includes('The input device is not a TTY.')) {
            console.error('The input device is not a TTY.');
            // Handle the error appropriately here
          } else if (!data.includes('ERROR failed to dial vm port')) {
            console.debug(`stderr: ${data}`);
            stderrChunks = stderrChunks.concat(data);
            if (this._progressView) {
              this._progressView.setChildProcessLog(data);
            } else {
              console.debug('no progress view');
            }
            // reject(new Error('Failed to launch Neurodesk from stderr ' + this._restartCount + this._info.port + stderrChunks + stdoutChunks));
          }
        });

        this._nbServer.on('error', (err: Error) => {
          if (started) {
            dialog.showMessageBox({
              message: `Neurodesk process errored: ${err.message}`,
              type: 'error'
            });
          } else {
            this._serverStartFailed();
            reject(err);
          }
        });

        this._nbServer.on('exit', (code, signal) => {
          const _code: number | null = code;
          stdoutChunks.concat(
            'child process exited with ' +
              `code ${code} and signal ${signal} on this._restartCount ${this._restartCount}`
          );
          console.log(
            'child process exited with ' + `code ${code} and signal ${signal}`
          );
          if (_code === 0 || started) {
            /* On Windows, JupyterLab server sometimes crashes randomly during websocket
              connection. As a result of this, users experience kernel connections failures.
              This crash only happens when server is launched from electron app. Since we
              haven't been able to detect the exact cause of these crashes we are restarting the
              server at the same port. After the restart, users are able to launch new kernels
              for the notebook.
              */
            this._cleanupListeners();

            if (!this._stopping && this._restartCount < SERVER_RESTART_LIMIT) {
              started = false;
              this._startServer = null;
              this.start(this._info.port, this._info.token);
              this._restartCount++;
            }
          } else {
            this._serverStartFailed();
            reject(new Error('Neurodesk process terminated' + stderrChunks));
          }
        });

        this._nbServer.on('error', (err: Error) => {
          if (started) {
            dialog.showMessageBox({
              message: `Neurodesk process errored: ${err.message}`,
              type: 'error'
            });
          } else {
            this._serverStartFailed();
            reject(err);
          }
        });
      }
    );

    return this._startServer;
  }

  /**
   * Stop the currently executing Jupyter server.
   *
   * @return a promise that is resolved when the server has stopped.
   */
  public stop(): Promise<void> {
    // If stop has already been initiated, just return the promise
    if (this._stopServer) {
      return this._stopServer;
    }

    this._stopping = true;

    this._stopServer = new Promise<void>((resolve, reject) => {
      if (this._nbServer !== undefined) {
        if (process.platform === 'win32') {
          if (this._info.engine === EngineType.TinyRange) {
            execFile(
              `${this._info.engine} rm -f neurodeskapp-${this._info.port}`,
              {
                shell: 'cmd.exe'
              }
            );
          } else {
            execFile('taskkill', ['/IM', 'NeurodeskApp.exe', '/T', '/F'], {
              shell: 'cmd.exe'
            });
          }
          execFile(
            'taskkill',
            ['/PID', String(this._nbServer.pid), '/T', '/F'],
            {
              shell: 'cmd.exe'
            }
          );
          this._shutdownServer()
            .then(() => {
              this._stopping = false;
              resolve();
            })
            .catch(reject);
        } else {
          if (this._info.engine === EngineType.TinyRange) {
            execFile(`killall qemu-system-x86`, {
              shell: '/bin/bash'
            });
          } else {
            execFile(
              `${this._info.engine} rm -f neurodeskapp-${this._info.port}`,
              {
                shell: '/bin/bash'
              }
            );
          }
          this._nbServer.kill();
          this._shutdownServer()
            .then(() => {
              this._stopping = false;
              resolve();
            })
            .catch(reject);
        }
      } else {
        this._stopping = false;
        resolve();
      }
    });
    return this._stopServer;
  }

  get started(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const checkStartServerPromise = () => {
        if (this._startServer) {
          this._startServer
            .then(() => {
              resolve(true);
            })
            .catch(reject);
        } else {
          setTimeout(() => {
            checkStartServerPromise();
          }, 100);
        }
      };

      checkStartServerPromise();
    });
  }

  private _serverStartFailed(): void {
    this._cleanupListeners();
    // Server didn't start, resolve stop promise
    this._stopServer = Promise.resolve();
  }

  private _cleanupListeners(): void {
    this._nbServer.removeAllListeners();
    this._nbServer.stderr.removeAllListeners();
    this._nbServer.stdout.removeAllListeners();
  }

  private _callShutdownAPI(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        `${this._info.url.origin}/api/shutdown?_xsrf=${this._info.token}`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${this._info.token}`
          }
        },
        r => {
          if (r.statusCode == 200) {
            resolve();
          } else {
            reject(`Server failed to shutdown. Response code: ${r.statusCode}`);
          }
        }
      );
      req.on('error', err => {
        reject(err);
      });
      req.end();
    });
  }

  private _shutdownServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._callShutdownAPI()
        .then(() => {
          resolve();
        })
        .catch(error => {
          // if no connection, it is possible that server was not up yet
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          if (error.code === 'ECONNREFUSED') {
            console.log(
              'Server not up yet, waiting for it to start...',
              error.code
            );
            Promise.race([
              waitUntilServerIsUp(this._info.url),
              waitForDuration(SERVER_LAUNCH_TIMEOUT)
            ]).then((up: boolean) => {
              if (up) {
                this._callShutdownAPI()
                  .then(() => {
                    resolve();
                  })
                  .catch(reject);
              } else {
                reject();
              }
            });
          } else {
            reject(error);
          }
        });
    });
  }

  private _generateToken() {
    return SERVER_TOKEN_PREFIX + randomBytes(19).toString('hex');
  }

  /**
   * The child process object for the Jupyter server
   */
  private _nbServer: ChildProcess;
  private _stopServer: Promise<void> = null;
  private _startServer: Promise<JupyterServer.IInfo> = null;
  private _options: JupyterServer.IOptions;
  private _info: JupyterServer.IInfo = {
    type: 'local',
    engine: null,
    url: null,
    port: null,
    token: null,
    workingDirectory: null,
    environment: null,
    serverArgs: '',
    overrideDefaultServerArgs: false,
    serverEnvVars: {},
    version: null,
    cvmfsMode: null
  };
  private _stopping: boolean = false;
  private _restartCount: number = 0;
  private _progressView: ProgressView;
}

export namespace JupyterServer {
  export interface IOptions {
    port?: number;
    token?: string;
    workingDirectory?: string;
    environment?: IPythonEnvironment;
  }

  export interface IInfo {
    type: 'local' | 'remote';
    engine: EngineType;
    url: URL;
    port: number;
    token: string;
    environment?: IPythonEnvironment;
    workingDirectory: string;
    serverArgs?: string;
    overrideDefaultServerArgs?: boolean;
    serverEnvVars?: KeyValueMap;
    version?: string;
    pageConfig?: any;
    cvmfsMode: string;
  }
}

export interface IServerFactory {
  /**
   * Create and start a 'free' server is none exists.
   *
   * @param opts the Jupyter server options.
   *
   * @return the factory item.
   */
  createFreeServersIfNeeded: (
    opts?: JupyterServer.IOptions,
    freeCount?: number
  ) => Promise<void>;

  /**
   * Create and start a 'free' server. The server created will be returned
   * in the next call to 'createServer'.
   *
   * This method is a way to pre-launch Jupyter servers to improve load
   * times.
   *
   * @param opts the Jupyter server options.
   *
   * @return the factory item.
   */
  createFreeServer: (
    opts?: JupyterServer.IOptions
  ) => Promise<JupyterServerFactory.IFactoryItem>;

  /**
   * Create a Jupyter server.
   *
   * If a free server is available, it is preferred over
   * server creation.
   *
   * @param opts the Jupyter server options.
   * @param forceNewServer force the creation of a new server over a free server.
   *
   * @return the factory item.
   */
  createServer: (
    opts?: JupyterServer.IOptions,
    progressView?: ProgressView
  ) => Promise<JupyterServerFactory.IFactoryItem>;

  /**
   * Kill all currently running servers.
   *
   * @return a promise that is fulfilled when all servers are killed.
   */
  killAllServers: () => Promise<void[]>;
}

export namespace IServerFactory {
  export interface IServerStarted {
    readonly factoryId: number;
    type: 'local' | 'remote';
    url: string;
    token: string;
    error?: Error;
    pageConfig?: any;
  }

  export interface IServerStop {
    factoryId: number;
  }
}

export class JupyterServerFactory implements IServerFactory, IDisposable {
  constructor(registry: IRegistry) {
    this._registry = registry;
  }

  async createFreeServersIfNeeded(
    opts?: JupyterServer.IOptions,
    freeCount: number = 1
  ): Promise<void> {
    const unusedServerCount = await this._geUnusedServerCount();
    for (let i = unusedServerCount; i < freeCount; ++i) {
      this.createFreeServer(opts);
    }
  }

  /**
   * Create and start a 'free' server. The server created will be returned
   * in the next call to 'createServer'.
   *
   * This method is a way to pre-launch Jupyter servers to improve load
   * times.
   *
   * @param opts the Jupyter server options.
   *
   * @return the factory item.
   */
  async createFreeServer(
    opts?: JupyterServer.IOptions
  ): Promise<JupyterServerFactory.IFactoryItem> {
    let item: JupyterServerFactory.IFactoryItem;
    let env: IPythonEnvironment = {
      name: 'python',
      path: 'C:\\',
      type: IEnvironmentType.Path,
      versions: {},
      defaultKernel: 'python3'
    };

    console.debug('~ createFreeServer', opts);
    opts = { ...opts, ...{ environment: env } };
    item = this._createServer(opts);
    item.server.start().catch(error => {
      console.error('Failed to start server ~~', error);
      this._removeFailedServer(item.factoryId);
    });
    return item;
  }

  /**
   * Create a Jupyter server.
   *
   * If a free server is available, it is preferred over
   * server creation.
   *
   * @param opts the Jupyter server options.
   */
  async createServer(
    opts?: JupyterServer.IOptions,
    progressView?: ProgressView
  ): Promise<JupyterServerFactory.IFactoryItem> {
    let item: JupyterServerFactory.IFactoryItem;
    let env: IPythonEnvironment = {
      name: 'python',
      path: 'C:\\',
      type: IEnvironmentType.Path,
      versions: {},
      defaultKernel: 'python3'
    };
    console.log('~ createServer', opts?.environment);
    opts = { ...opts, ...{ environment: env } };

    item =
      (await this._findUnusedServer(opts)) ||
      this._createServer(opts, progressView);
    item.used = true;

    item.server.start().catch(error => {
      console.error('~ Failed to start server', error);
      this._removeFailedServer(item.factoryId);
    });

    console.debug('~ createServer ~ ', item);
    return item;
  }

  /**
   * Stop a Jupyter server.
   *
   * @param factoryId the factory item id.
   */
  stopServer(factoryId: number): Promise<void> {
    let idx = this._getServerIdx(factoryId);
    if (idx < 0) {
      return Promise.reject(new Error('Invalid server id: ' + factoryId));
    }

    let server = this._servers[idx];
    if (server.closing) {
      return server.closing;
    }
    let promise = new Promise<void>((res, rej) => {
      server.server
        .stop()
        .then(() => {
          ArrayExt.removeAt(this._servers, idx);
          res();
        })
        .catch(e => {
          log.error(e);
          ArrayExt.removeAt(this._servers, idx);
          rej();
        });
    });
    server.closing = promise;
    return promise;
  }

  /**
   * Kill all currently running servers.
   *
   * @return a promise that is fulfilled when all servers are killed.
   */
  killAllServers(): Promise<void[]> {
    // Get stop promises from all servers
    let stopPromises = this._servers.map(server => {
      return server.server.stop();
    });
    // Empty the server array.
    this._servers = [];
    return Promise.all(stopPromises);
  }

  dispose(): Promise<void> {
    if (this._disposePromise) {
      return this._disposePromise;
    }

    this._disposePromise = new Promise<void>((resolve, reject) => {
      this.killAllServers()
        .then(() => {
          resolve();
        })
        .catch(reject);
    });

    return this._disposePromise;
  }

  private _createServer(
    opts: JupyterServer.IOptions,
    progressView?: ProgressView
  ): JupyterServerFactory.IFactoryItem {
    let item: JupyterServerFactory.IFactoryItem = {
      factoryId: this._nextId++,
      server: new JupyterServer(opts, this._registry, progressView),
      closing: null,
      used: false
    };

    this._servers.push(item);
    return item;
  }

  private async _findUnusedServer(
    opts?: JupyterServer.IOptions
  ): Promise<JupyterServerFactory.IFactoryItem | null> {
    const workingDir =
      opts?.workingDirectory || userSettings.resolvedWorkingDirectory;
    const env = opts?.environment;

    let result = ArrayExt.findFirstValue(
      this._servers,
      (server: JupyterServerFactory.IFactoryItem, idx: number) => {
        return (
          !server.used &&
          server.server.info.workingDirectory === workingDir &&
          server.server.info.environment.path === env?.path
        );
      }
    );

    return result;
  }

  private async _geUnusedServerCount(
    opts?: JupyterServer.IOptions
  ): Promise<number> {
    let count = 0;

    const workingDir =
      opts?.workingDirectory || userSettings.resolvedWorkingDirectory;

    const env = opts?.environment;

    this._servers.forEach(server => {
      if (
        !server.used &&
        server.server.info.workingDirectory === workingDir &&
        server.server.info.environment.path === env?.path
      ) {
        count++;
      }
    });

    return count;
  }

  private _removeFailedServer(factoryId: number): void {
    let idx = this._getServerIdx(factoryId);
    if (idx < 0) {
      return;
    }
    ArrayExt.removeAt(this._servers, idx);
  }

  private _getServerIdx(factoryId: number): number {
    return ArrayExt.findFirstIndex(
      this._servers,
      (s: JupyterServerFactory.IFactoryItem, idx: number) => {
        if (s.factoryId === factoryId) {
          return true;
        }
        return false;
      }
    );
  }

  private _servers: JupyterServerFactory.IFactoryItem[] = [];
  private _nextId: number = 1;
  private _registry: IRegistry;
  private _disposePromise: Promise<void>;
}

export namespace JupyterServerFactory {
  /**
   * The object created by the JupyterServerFactory.
   */
  export interface IFactoryItem {
    /**
     * The factory ID. Used to keep track of the server.
     */
    readonly factoryId: number;

    /**
     * Whether the server is currently used.
     */
    used: boolean;

    /**
     * A promise that is created when the server is closing
     * and resolved on close.
     */
    closing: Promise<void>;

    /**
     * The actual Jupyter server object.
     */
    server: JupyterServer;
  }
}
