jest.mock('../crumblecracker');
jest.mock('../config/containerConfigParser', () => {
  const actual = jest.requireActual('../config/containerConfigParser');
  const path = jest.requireActual('path');
  return {
    ...actual,
    ContainerConfigParser: jest.fn(
      (_base, config, version) =>
        new actual.ContainerConfigParser(
          path.join(__dirname, '../config/baseContainerConfig.yml'),
          path.join(
            __dirname,
            '../../../container_installer',
            path.basename(config)
          ),
          version
        )
    )
  };
});

const fs = jest.requireActual('fs');
import { CrumbleCracker } from '../crumblecracker';
import { ContainerConfigParser } from '../config/containerConfigParser';
import {
  EngineType,
  SettingType,
  userSettings,
  WorkspaceSettings
} from '../config/settings';
import { JupyterServer } from '../server';

const start = jest.fn().mockResolvedValue({
  token: 'guest-token',
  url: 'http://127.0.0.1:18888/lab'
});
let settings: { [key: string]: any };
const savedImage = process.env.NEURODESK_CC_IMAGE;
const savedBinary = process.env.NEURODESK_CC_BINARY;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NEURODESK_CC_IMAGE;
  process.env.NEURODESK_CC_BINARY = process.execPath;
  settings = {
    [SettingType.engineType]: EngineType.CrumbleCracker,
    [SettingType.serverArgs]: '',
    [SettingType.serverEnvVars]: {},
    [SettingType.neurodesktopStorageDirectory]: '/test/storage'
  };
  jest
    .spyOn(WorkspaceSettings.prototype, 'getValue')
    .mockImplementation(key => settings[key]);
  jest.spyOn(userSettings, 'getValue').mockImplementation(key => settings[key]);
  jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
  (CrumbleCracker as jest.Mock).mockImplementation(() => ({ start }));
});
afterEach(() => {
  jest.restoreAllMocks();
  if (savedBinary === undefined) delete process.env.NEURODESK_CC_BINARY;
  else process.env.NEURODESK_CC_BINARY = savedBinary;
  if (savedImage === undefined) delete process.env.NEURODESK_CC_IMAGE;
  else process.env.NEURODESK_CC_IMAGE = savedImage;
});

function session(imageVersion?: string) {
  return new JupyterServer(
    {
      workingDirectory: '/workspace',
      containerConfigName: 'neurodesk',
      imageVersion,
      port: 18888
    },
    undefined
  );
}

test('native session uses the selected YAML image version without implicitly sharing its working directory', async () => {
  const info = await session('selected-version').start();
  expect(ContainerConfigParser).toHaveBeenCalledWith(
    expect.stringContaining('baseContainerConfig.yml'),
    expect.stringContaining('neurodesk.yml'),
    'selected-version'
  );
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      image: 'docker.io/vnmd/neurodesktop:selected-version',
      directory: '',
      storage: '/test/storage'
    }),
    expect.any(Function)
  );
  expect(info.url.searchParams.get('token')).toBe('guest-token');
});

test('legacy native settings use the API and an explicit candidate image override', async () => {
  settings[SettingType.engineType] = EngineType.TinyRange;
  settings[SettingType.serverArgs] = __dirname;
  process.env.NEURODESK_CC_IMAGE = 'docker-archive:/candidate.tar';
  await session().start();
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      image: 'docker-archive:/candidate.tar',
      directory: __dirname
    }),
    expect.any(Function)
  );
});

test('rejects an unknown container configuration before spawning a backend', async () => {
  const server = new JupyterServer(
    {
      workingDirectory: '/workspace',
      containerConfigName: 'missing-config',
      port: 18888
    },
    undefined
  );
  await expect(server.start()).rejects.toThrow();
  expect(CrumbleCracker).not.toHaveBeenCalled();
});
