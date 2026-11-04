import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { appData } from '../config/appdata';

describe('ApplicationData', () => {
  it('drops legacy recent sessions while retaining remote browser data for Clear History', () => {
    const dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'neurodesk-appdata-')
    );
    const appDataPath = path.join(dataDir, 'app-data.json');
    const getPath = jest.spyOn(app, 'getPath').mockImplementation(name => {
      return name === 'userData' ? dataDir : os.homedir();
    });

    try {
      fs.writeFileSync(
        appDataPath,
        JSON.stringify({
          sessions: [
            {
              remoteURL: 'https://current.example.org',
              partition: 'persist:current'
            }
          ],
          recentSessions: [
            {
              remoteURL: 'https://old.example.org',
              partition: 'persist:legacy'
            },
            { workingDirectory: '/old/workspace' },
            { partition: 'partition:temporary' }
          ],
          persistentRemotePartitions: ['persist:legacy'],
          recentRemoteURLs: [
            { url: 'https://remote.example.org', date: '2026-01-01T00:00:00Z' }
          ]
        })
      );

      appData.read();
      expect(appData.persistentRemotePartitions).toEqual([
        'persist:legacy',
        'persist:current'
      ]);

      appData.save();
      const saved = JSON.parse(fs.readFileSync(appDataPath, 'utf8'));
      expect(saved).not.toHaveProperty('recentSessions');
      expect(saved.persistentRemotePartitions).toEqual([
        'persist:legacy',
        'persist:current'
      ]);
      expect(saved.recentRemoteURLs).toHaveLength(1);
      expect(saved.sessions).toHaveLength(1);
    } finally {
      getPath.mockRestore();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
