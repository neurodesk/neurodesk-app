import { EventTypeMain, EventTypeRenderer } from '../eventtypes';

const { contextBridge, ipcRenderer } = require('electron');

type SetNewsListListener = (list: any[]) => void;
type SetNotificationMessageListener = (
  message: string,
  closable: boolean
) => void;
type DisableLocalServerActionsListener = () => void;

let onSetNewsListListener: SetNewsListListener;
let onSetNotificationMessageListener: SetNotificationMessageListener;
let onDisableLocalServerActionsListener: DisableLocalServerActionsListener;

contextBridge.exposeInMainWorld('electronAPI', {
  getAppConfig: () => {
    return {
      platform: process.platform
    };
  },
  isDarkTheme: () => {
    return ipcRenderer.invoke(EventTypeMain.IsDarkTheme);
  },
  fetchReleases: (
    releaseHistoryUrl: string,
    defaultVersion: string
  ): Promise<string[]> => {
    return ipcRenderer.invoke(
      EventTypeMain.FetchReleases,
      releaseHistoryUrl,
      defaultVersion
    );
  },
  newSession: (
    type:
      | 'notebook'
      | 'blank'
      | 'open'
      | 'open-file'
      | 'open-folder'
      | 'remote',
    containerConfigName?: string,
    remoteUrl?: string[],
    imageVersion?: string,
    miniAppId?: string
  ) => {
    if (type === 'notebook' || type === 'blank') {
      ipcRenderer.send(
        EventTypeMain.CreateNewSession,
        type,
        containerConfigName,
        imageVersion,
        miniAppId
      );
    } else if (type === 'open') {
      ipcRenderer.send(EventTypeMain.OpenFileOrFolder);
    } else if (type === 'open-file') {
      ipcRenderer.send(EventTypeMain.OpenFile);
    } else if (type === 'open-folder') {
      ipcRenderer.send(EventTypeMain.OpenFolder);
    } else if (type === 'remote') {
      ipcRenderer.send(
        EventTypeMain.CreateNewRemoteSession,
        remoteUrl,
        miniAppId
      );
    }
  },
  openDroppedFiles(files: string[]) {
    ipcRenderer.send(EventTypeMain.OpenDroppedFiles, files);
  },
  openNewsLink: (newsLink: string) => {
    ipcRenderer.send(EventTypeMain.OpenNewsLink, newsLink);
  },
  sendMessageToMain: (message: string, ...args: any[]) => {
    ipcRenderer.send(message, ...args);
  },
  onSetNewsList: (callback: SetNewsListListener) => {
    onSetNewsListListener = callback;
  },
  onSetNotificationMessage: (callback: SetNotificationMessageListener) => {
    onSetNotificationMessageListener = callback;
  },
  onDisableLocalServerActions: (
    callback: DisableLocalServerActionsListener
  ) => {
    onDisableLocalServerActionsListener = callback;
  }
});

ipcRenderer.on(EventTypeRenderer.SetNewsList, (event, list) => {
  if (onSetNewsListListener) {
    onSetNewsListListener(list);
  }
});

ipcRenderer.on(
  EventTypeRenderer.SetNotificationMessage,
  (event, message: string, closable: boolean) => {
    if (onSetNotificationMessageListener) {
      onSetNotificationMessageListener(message, closable);
    }
  }
);

ipcRenderer.on(EventTypeRenderer.DisableLocalServerActions, event => {
  if (onDisableLocalServerActionsListener) {
    onDisableLocalServerActionsListener();
  }
});

export {};
