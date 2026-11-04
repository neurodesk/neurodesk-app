import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

const DEFAULT_CONTAINER_CONFIG = 'neurodesk';

export function validateStorageMount(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) ||
    value === '..'
  ) {
    throw new Error('defaultStorageMount must be a single directory name');
  }
  return value;
}

/** Read the mount name from the bundled installer YAML. */
export function readDefaultStorageMount(
  containerConfigName: string = DEFAULT_CONTAINER_CONFIG
): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(containerConfigName)) {
    throw new Error('Invalid container configuration name');
  }

  // The first location is used by the packaged app; the second by source tests.
  const bundledPath = path.join(
    __dirname,
    '../../container_installer',
    `${containerConfigName}.yml`
  );
  const sourcePath = path.join(
    __dirname,
    '../../../container_installer',
    `${containerConfigName}.yml`
  );
  const configPath = fs.existsSync(bundledPath) ? bundledPath : sourcePath;
  const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
    defaultStorageMount?: unknown;
  };
  return validateStorageMount(config?.defaultStorageMount);
}

/** Preserve the existing platform path pattern with the YAML mount name. */
export function getDefaultStorageDirectory(
  platform: string = process.platform,
  mountName: string = readDefaultStorageMount(),
  homeDir: string = os.homedir()
): string {
  const name = validateStorageMount(mountName);
  return platform === 'win32' ? `C:/${name}` : path.join(homeDir, name);
}
