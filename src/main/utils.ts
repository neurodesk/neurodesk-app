// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as path from 'path';
import * as fs from 'fs';
import * as semver from 'semver';
import log from 'electron-log';
import { AddressInfo, createServer, Socket } from 'net';
import { app, nativeTheme } from 'electron';
import { spawn } from 'child_process';

export const DarkThemeBGColor = '#212121';
export const LightThemeBGColor = '#ffffff';

export interface ISaveOptions {
  id: string;
  raw: string;
}

export function isDevMode(): boolean {
  return require.main.filename.indexOf('app.asar') === -1;
}

export function getAppDir(): string {
  let appDir = app.getAppPath();
  if (!isDevMode()) {
    appDir = path.dirname(appDir);
  }

  return appDir;
}

export function getUserHomeDir(): string {
  return app.getPath('home');
}

export function getUserDataDir(): string {
  const userDataDir = app.getPath('userData');

  if (!fs.existsSync(userDataDir)) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch (error) {
      log.error(error);
    }
  }

  return userDataDir;
}

export function getSchemasDir(): string {
  return path.normalize(path.join(getAppDir(), './build/schemas'));
}

export function getBundledPythonInstallDir(): string {
  // this directory path cannot have any spaces since
  // conda constructor cannot install to such paths
  const installDir =
    process.platform === 'darwin'
      ? path.normalize(path.join(app.getPath('home'), 'Library', app.getName()))
      : app.getPath('userData');

  if (!fs.existsSync(installDir)) {
    try {
      fs.mkdirSync(installDir, { recursive: true });
    } catch (error) {
      log.error(error);
    }
  }

  return installDir;
}

// user data dir for<= 3.5.1-1
export function getOldUserConfigPath() {
  return path.join(getBundledPythonInstallDir(), 'jupyterlab-desktop-data');
}

export function isDarkTheme(themeType: string) {
  if (themeType === 'light') {
    return false;
  } else if (themeType === 'dark') {
    return true;
  } else {
    return nativeTheme.shouldUseDarkColors;
  }
}

export function clearSession(session: Electron.Session): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      Promise.all([
        session.clearCache(),
        session.clearAuthCache(),
        session.clearStorageData(),
        session.flushStorageData()
      ]).then(() => {
        resolve();
      });
    } catch (error) {
      reject();
    }
  });
}

export function isPortInUse(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let inUse = false;
    const socket = new Socket();
    socket.setTimeout(200);
    socket.once('error', err => {
      inUse = false;
      socket.destroy();
    });
    socket.on('timeout', () => {
      inUse = false;
      socket.destroy();
    });
    socket.on('connect', () => {
      inUse = true;
      socket.destroy();
    });
    socket.on('close', exception => {
      resolve(inUse);
    });
    socket.connect({ port: port, host: '127.0.0.1' });
  });
}

export function getFreePort(): Promise<number> {
  return new Promise<number>(resolve => {
    const getPort = () => {
      const server = createServer(socket => {
        socket.write('Echo server\r\n');
        socket.pipe(socket);
      });

      server.on('error', function (e) {
        getPort();
      });
      server.on('listening', function (e: any) {
        const port = (server.address() as AddressInfo).port;
        server.close();

        resolve(port);
      });

      server.listen(0, '127.0.0.1');
    };

    getPort();
  });
}

export async function waitForDuration(duration: number): Promise<boolean> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(false);
    }, duration);
  });
}

/**
 * Wait for a function to finish for max. timeout milliseconds (copied from galata)
 *
 * @param fn Function
 * @param timeout Timeout
 */
export async function waitForFunction(
  fn: () => boolean,
  timeout?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let checkTimer: NodeJS.Timeout = null;
    let timeoutTimer: NodeJS.Timeout = null;
    const check = async () => {
      checkTimer = null;
      if (await Promise.resolve(fn())) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        resolve();
      } else {
        checkTimer = setTimeout(check, 200);
      }
    };

    void check();

    if (timeout) {
      timeoutTimer = setTimeout(() => {
        timeoutTimer = null;
        if (checkTimer) {
          clearTimeout(checkTimer);
        }
        reject(new Error('Timed out waiting for condition to be fulfilled.'));
      }, timeout);
    }
  });
}

export class Config {
  static loadConfig(
    configDir: string,
    configFileName: string = this.defaultFileName()
  ): Config {
    const location = path.join(configDir, configFileName);
    console.debug(`Loading config from ${location}...`);
    const config = this.loadConfigFromFile(location);
    return config;
  }

  static loadConfigFromFile(location: string): Config {
    const toml = require('toml');
    const data = fs.readFileSync(location);
    const tomlData = toml.parse(data);
    return new Config(tomlData);
  }

  static defaultFileName(): string {
    return 'neurodesktop.toml';
  }

  public ConfigToml: any;

  constructor(configToml: any) {
    this.ConfigToml = configToml;
  }
}
// remove alpha / beta suffixes
export function versionWithoutSuffix(version: string) {
  return `${semver.major(version, { loose: true })}.${semver.minor(version, {
    loose: true
  })}.${semver.patch(version, { loose: true })}`;
}

export function getLogFilePath(processType: 'main' | 'renderer' = 'main') {
  switch (process.platform) {
    case 'win32':
      return path.join(getUserDataDir(), `\\logs\\${processType}.log`);
    case 'darwin':
      return path.join(
        getUserHomeDir(),
        `/Library/Logs/neurodeskapp/${processType}.log`
      );
    default:
      return path.join(
        getUserHomeDir(),
        `/.config/neurodeskapp/logs/${processType}.log`
      );
  }
}

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
    sleep 0.1
    done
    ${process.argv.join(' ')} & disown
    exit
  `;
  spawn('sh', ['-c', `"${script}"`], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  });
  // Exit the parent process
  // process.exit();
}
