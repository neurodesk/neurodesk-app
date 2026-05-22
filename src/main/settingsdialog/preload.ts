import { EventTypeMain, EventTypeRenderer } from '../eventtypes';

const { contextBridge, ipcRenderer } = require('electron');

type WorkingDirectorySelectedListener = (path: string) => void;
type StorageDirectorySelectedListener = (path: string) => void;

let onWorkingDirectorySelectedListener: WorkingDirectorySelectedListener;
let onStorageDirectorySelectedListener: StorageDirectorySelectedListener;

contextBridge.exposeInMainWorld('electronAPI', {
  getAppConfig: () => {
    return {
      platform: process.platform
    };
  },
  isDarkTheme: () => {
    return ipcRenderer.invoke(EventTypeMain.IsDarkTheme);
  },
  restartApp: () => {
    ipcRenderer.send(EventTypeMain.RestartApp);
  },
  setCheckForUpdatesAutomatically: (check: boolean) => {
    ipcRenderer.send(EventTypeMain.SetCheckForUpdatesAutomatically, check);
  },
  setInstallUpdatesAutomatically: (install: boolean) => {
    ipcRenderer.send(EventTypeMain.SetInstallUpdatesAutomatically, install);
  },
  checkForUpdates: () => {
    ipcRenderer.send(EventTypeMain.CheckForUpdates);
  },
  showLogs: () => {
    ipcRenderer.send(EventTypeMain.ShowLogs);
  },
  launchInstallerDownloadPage: () => {
    ipcRenderer.send(EventTypeMain.LaunchInstallerDownloadPage);
  },
  setEngineType: (mode: string) => {
    ipcRenderer.send(EventTypeMain.SetEngineType, mode);
  },
  setStartupMode: (mode: string) => {
    ipcRenderer.send(EventTypeMain.SetStartupMode, mode);
  },
  setCvmfsMode: (mode: string) => {
    ipcRenderer.send(EventTypeMain.SetCvmfsMode, mode);
  },
  setTheme: (theme: string) => {
    ipcRenderer.send(EventTypeMain.SetTheme, theme);
  },
  setSyncJupyterLabTheme: (sync: boolean) => {
    ipcRenderer.send(EventTypeMain.SetSyncJupyterLabTheme, sync);
  },
  setShowNewsFeed: (show: string) => {
    ipcRenderer.send(EventTypeMain.SetShowNewsFeed, show);
  },
  selectWorkingDirectory: () => {
    ipcRenderer.send(EventTypeMain.SelectWorkingDirectory);
  },
  onWorkingDirectorySelected: (callback: WorkingDirectorySelectedListener) => {
    onWorkingDirectorySelectedListener = callback;
  },
  setDefaultWorkingDirectory: (path: string) => {
    ipcRenderer.send(EventTypeMain.SetDefaultWorkingDirectory, path);
  },
  clearHistory: (options: any) => {
    return ipcRenderer.invoke(EventTypeMain.ClearHistory, options);
  },
  setLogLevel: (level: string) => {
    ipcRenderer.send(EventTypeMain.SetLogLevel, level);
  },
  setServerLaunchArgs: (
    serverArgs: string,
    overrideDefaultServerArgs?: boolean
  ) => {
    ipcRenderer.send(
      EventTypeMain.SetServerLaunchArgs,
      serverArgs,
      overrideDefaultServerArgs || false
    );
  },
  setServerEnvVars: (serverEnvVars: any) => {
    ipcRenderer.send(EventTypeMain.SetServerEnvVars, serverEnvVars);
  },
  setCtrlWBehavior: (behavior: string) => {
    ipcRenderer.send(EventTypeMain.SetCtrlWBehavior, behavior);
  },
  selectStorageDirectory: () => {
    ipcRenderer.send(EventTypeMain.SelectStorageDirectory);
  },
  onStorageDirectorySelected: (callback: StorageDirectorySelectedListener) => {
    onStorageDirectorySelectedListener = callback;
  },
  setStorageDirectory: (path: string) => {
    ipcRenderer.send(EventTypeMain.SetStorageDirectory, path);
  }
});

ipcRenderer.on(EventTypeRenderer.WorkingDirectorySelected, (event, path) => {
  if (onWorkingDirectorySelectedListener) {
    onWorkingDirectorySelectedListener(path);
  }
});

ipcRenderer.on(EventTypeRenderer.StorageDirectorySelected, (event, path) => {
  if (onStorageDirectorySelectedListener) {
    onStorageDirectorySelectedListener(path);
  }
});

export {};
