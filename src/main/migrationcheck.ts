import log from 'electron-log';
import fetch from 'node-fetch';

const MIGRATION_JSON_URL =
  'https://sciget.github.io/migration.json';

export interface IMigrationInfo {
  status: 'active' | 'migrated';
  message?: string;
  downloadUrl?: string;
}

export interface IMigrationCheckResult {
  shouldNotify: boolean;
  info?: IMigrationInfo;
}

export async function fetchMigrationStatus(): Promise<IMigrationCheckResult> {
  try {
    const response = await fetch(MIGRATION_JSON_URL, { timeout: 10000 });
    if (!response.ok) {
      return { shouldNotify: false };
    }
    const data = await response.json();
    if (!data || typeof data.status !== 'string') {
      return { shouldNotify: false };
    }
    const info = data as IMigrationInfo;
    return {
      shouldNotify: info.status === 'migrated',
      info
    };
  } catch (error) {
    log.debug('Migration check failed (expected behind firewalls):', error);
    return { shouldNotify: false };
  }
}
