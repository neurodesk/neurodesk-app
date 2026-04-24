import { EventTypeMain, EventTypeRenderer } from '../eventtypes';

const { contextBridge, ipcRenderer } = require('electron');

type ShowChildProcressLogListener = (detail: string) => void;
type ShowProgressListener = (
  title: string,
  detail: string,
  showAnimation: boolean
) => void;

let onChildProcessListener: ShowChildProcressLogListener;
let onShowProgressListener: ShowProgressListener;

contextBridge.exposeInMainWorld('electronAPI', {
  getAppConfig: () => {
    return {
      platform: process.platform
    };
  },
  isDarkTheme: () => {
    return ipcRenderer.invoke(EventTypeMain.IsDarkTheme);
  },
  onGetChildProcressLog: (callback: ShowChildProcressLogListener) => {
    onChildProcessListener = callback;
  },
  onShowProgress: (callback: ShowProgressListener) => {
    onShowProgressListener = callback;
  },
  sendMessageToMain: (message: string, ...args: any[]) => {
    ipcRenderer.send(message, ...args);
  }
});

ipcRenderer.on(EventTypeRenderer.ShowChildProcressLog, (event, detail) => {
  if (onChildProcessListener) {
    onChildProcessListener(detail);
  }
});

ipcRenderer.on(
  EventTypeRenderer.ShowProgress,
  (event, title, detail, showAnimation) => {
    if (onShowProgressListener) {
      onShowProgressListener(title, detail, showAnimation);
    }
  }
);

export {};
