// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as path from 'path';
import * as fs from 'fs';
import { getUserDataDir } from '../utils';
import { SessionConfig } from './sessionconfig';

export interface INewsItem {
  title: string;
  link: string;
}

export interface IRecentRemoteURL {
  url: string;
  date: Date;
}

let _appDataSingleton: ApplicationData;

export class ApplicationData {
  constructor() {
    if (_appDataSingleton) {
      throw 'This is a singleton class. Use ApplicationData.getSingleton()';
    }

    this.read();
  }

  static getSingleton() {
    if (!_appDataSingleton) {
      _appDataSingleton = new ApplicationData();
    }

    return _appDataSingleton;
  }

  setActiveSessions(sessionConfigs: SessionConfig[]) {
    this.sessions = sessionConfigs;
  }

  read() {
    const appDataPath = this._getAppDataPath();
    if (!fs.existsSync(appDataPath)) {
      return;
    }
    const data = fs.readFileSync(appDataPath);
    const jsonData = JSON.parse(data.toString());

    this.sessions = [];
    if ('sessions' in jsonData && Array.isArray(jsonData.sessions)) {
      for (const session of jsonData.sessions) {
        const sessionConfig = new SessionConfig();
        sessionConfig.deserialize(session);
        this.sessions.push(sessionConfig);
      }
    }

    this.persistentRemotePartitions = [];
    if (Array.isArray(jsonData.persistentRemotePartitions)) {
      for (const partition of jsonData.persistentRemotePartitions) {
        this.addPersistentRemotePartition(partition);
      }
    }
    if (Array.isArray(jsonData.sessions)) {
      for (const session of jsonData.sessions) {
        if (session?.remoteURL && session.persistSessionData !== false) {
          this.addPersistentRemotePartition(session.partition);
        }
      }
    }
    // Keep old remote browser data clearable while dropping recent sessions.
    if (Array.isArray(jsonData.recentSessions)) {
      for (const recentSession of jsonData.recentSessions) {
        this.addPersistentRemotePartition(recentSession?.partition);
      }
    }

    this.recentRemoteURLs = [];
    if (
      'recentRemoteURLs' in jsonData &&
      Array.isArray(jsonData.recentRemoteURLs)
    ) {
      for (const remoteURL of jsonData.recentRemoteURLs) {
        this.recentRemoteURLs.push({
          url: remoteURL.url,
          date: new Date(remoteURL.date)
        });
      }
    }
    this._sortRecentItems(this.recentRemoteURLs);

    this.newsList = [];
    if ('newsList' in jsonData && Array.isArray(jsonData.newsList)) {
      for (const newsItem of jsonData.newsList) {
        this.newsList.push({
          title: newsItem.title,
          link: newsItem.link
        });
      }
    }
  }

  save() {
    const appDataPath = this._getAppDataPath();
    const appDataJSON: { [key: string]: any } = {};

    appDataJSON.sessions = [];
    for (const sessionConfig of this.sessions) {
      appDataJSON.sessions.push(sessionConfig.serialize());
    }

    appDataJSON.persistentRemotePartitions = this.persistentRemotePartitions;

    appDataJSON.recentRemoteURLs = [];
    for (const remoteUrl of this.recentRemoteURLs) {
      appDataJSON.recentRemoteURLs.push({
        url: remoteUrl.url,
        date: remoteUrl.date.toISOString()
      });
    }

    appDataJSON.newsList = [];
    for (const newsItem of this.newsList) {
      appDataJSON.newsList.push({
        title: newsItem.title,
        link: newsItem.link
      });
    }

    fs.writeFileSync(appDataPath, JSON.stringify(appDataJSON, null, 2));
  }

  addRemoteURLToRecents(url: string) {
    const existing = this.recentRemoteURLs.find(value => {
      return value.url === url;
    });

    const now = new Date();

    if (existing) {
      existing.date = now;
    } else {
      this.recentRemoteURLs.push({
        url,
        date: now
      });
    }
  }

  removeRemoteURLFromRecents(url: string) {
    const index = this.recentRemoteURLs.findIndex(value => {
      return value.url === url;
    });

    if (index !== -1) {
      this.recentRemoteURLs.splice(index, 1);
    }
  }

  addPersistentRemotePartition(partition: string | undefined) {
    if (
      typeof partition === 'string' &&
      partition.startsWith('persist:') &&
      !this.persistentRemotePartitions.includes(partition)
    ) {
      this.persistentRemotePartitions.push(partition);
    }
  }

  private _getAppDataPath(): string {
    const userDataDir = getUserDataDir();
    return path.join(userDataDir, 'app-data.json');
  }

  private _sortRecentItems(items: { date?: Date }[]) {
    items.sort((lhs, rhs) => {
      return rhs.date.valueOf() - lhs.date.valueOf();
    });
  }

  newsList: INewsItem[] = [];
  sessions: SessionConfig[] = [];
  recentRemoteURLs: IRecentRemoteURL[] = [];
  persistentRemotePartitions: string[] = [];
}

export const appData = ApplicationData.getSingleton();
