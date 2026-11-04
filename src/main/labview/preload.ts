import { EventTypeMain } from '../eventtypes';
import { installDesktopLauncher } from './desktoplauncher';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getServerInfo: () => {
    return ipcRenderer.invoke(EventTypeMain.GetServerInfo);
  },
  broadcastLabUIReady: () => {
    ipcRenderer.send(EventTypeMain.LabUIReady);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  const info = await ipcRenderer.invoke(EventTypeMain.GetServerInfo);
  if (info?.nativeDesktop) {
    installDesktopLauncher(document, () =>
      ipcRenderer.send(EventTypeMain.OpenNativeDesktop)
    );
  }
});

export {};
