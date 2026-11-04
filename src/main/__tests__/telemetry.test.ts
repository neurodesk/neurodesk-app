// Mock posthog-node before importing telemetry
jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
    on: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined)
  }))
}));

import {
  buildScrubList,
  collectContext,
  sanitizeProperties,
  scrubString
} from '../telemetry';

// Mock electron modules
jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return '/Users/testuser';
      if (name === 'userData')
        return '/Users/testuser/Library/Application Support/neurodeskapp';
      return '/tmp';
    },
    getVersion: () => '2.0.0',
    isPackaged: false,
    getAppPath: () => '/test/app'
  },
  nativeTheme: { shouldUseDarkColors: false },
  net: { fetch: jest.fn() }
}));

jest.mock('electron-log', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    transports: { file: { level: 'info' }, console: { level: 'info' } }
  },
  __esModule: true
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue(''),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn()
}));

jest.mock('../config/settings', () => {
  const actual = jest.requireActual('../config/settings');
  return {
    ...actual,
    userSettings: {
      getValue: jest.fn((key: string) => {
        const values: Record<string, string> = {
          engineType: 'docker',
          cvmfsMode: 'false',
          defaultWorkingDirectory: '/Users/testuser/mydata',
          neurodesktopStorageDirectory: '',
          telemetryConsent: 'on'
        };
        return values[key] ?? '';
      }),
      setValue: jest.fn(),
      save: jest.fn()
    }
  };
});

jest.mock('../app', () => ({
  getNeurodesktopStoragePath: () => '/Users/testuser/neurodesktop-storage'
}));

describe('sanitizeProperties', () => {
  const scrubList = [
    '/Users/testuser',
    '/Users/testuser/neurodesktop-storage',
    '/Users/testuser/mydata'
  ];

  it('replaces home directory paths with ~', () => {
    const properties = {
      $exception_message:
        'Error at /Users/testuser/repos/neurodesk-app/src/main/app.ts',
      $exception_stack_trace_raw:
        'Error\n    at /Users/testuser/repos/neurodesk-app/src/main/app.ts:10:5'
    };

    const result = sanitizeProperties(properties, scrubList);
    expect(result.$exception_message).toBe(
      'Error at ~/repos/neurodesk-app/src/main/app.ts'
    );
    expect(result.$exception_stack_trace_raw).toContain(
      '~/repos/neurodesk-app/src/main/app.ts'
    );
  });

  it('strips server tokens (jlab:srvr:...)', () => {
    const properties = {
      $exception_message: 'Failed with token jlab:srvr:abc123def456'
    };

    const result = sanitizeProperties(properties, scrubList);
    expect(result.$exception_message).toBe('Failed with token <token>');
  });

  it('strips ServerApp.token from launch args', () => {
    const properties = {
      launchScript:
        "docker run -e TOKEN=val --ServerApp.token='mysecrettoken123' --port 8888"
    };

    const result = sanitizeProperties(properties, scrubList);
    expect(result.launchScript).toContain("--ServerApp.token='<token>'");
    expect(result.launchScript).not.toContain('mysecrettoken123');
  });

  it('redacts env var values in Docker -e flags', () => {
    const properties = {
      launchScript:
        'docker run -e NB_UID=1000 -e SECRET_KEY=supersecret -e GRANT_SUDO=yes'
    };

    const result = sanitizeProperties(properties, scrubList);
    expect(result.launchScript).toContain('-e NB_UID=<redacted>');
    expect(result.launchScript).toContain('-e SECRET_KEY=<redacted>');
    expect(result.launchScript).not.toContain('supersecret');
  });

  it('strips storage and working directory paths', () => {
    const properties = {
      $exception_message:
        'Error reading /Users/testuser/neurodesktop-storage/file and /Users/testuser/mydata/notebook.ipynb'
    };

    const result = sanitizeProperties(properties, scrubList);
    const msg = result.$exception_message;
    // Home dir, storage dir, and working dir paths should all be scrubbed
    expect(msg).not.toContain('/Users/testuser');
    expect(msg).toContain('file');
    expect(msg).toContain('notebook.ipynb');
  });

  it('handles undefined values gracefully', () => {
    const properties = {
      $exception_message: undefined,
      someField: 'safe value'
    };

    expect(() => sanitizeProperties(properties, scrubList)).not.toThrow();
    const result = sanitizeProperties(properties, scrubList);
    expect(result.$exception_message).toBeUndefined();
    expect(result.someField).toBe('safe value');
  });
});

describe('scrubString', () => {
  const scrubList = ['/Users/testuser'];

  it('returns undefined for undefined input', () => {
    expect(scrubString(undefined, scrubList)).toBeUndefined();
  });

  it('scrubs sensitive paths', () => {
    expect(scrubString('/Users/testuser/repos/file.ts', scrubList)).toBe(
      '~/repos/file.ts'
    );
  });
});

describe('collectContext', () => {
  it('returns app context with expected fields', () => {
    const ctx = collectContext();
    expect(ctx.app).toBeDefined();
    expect(ctx.app.engineType).toBe('docker');
    expect(ctx.app.cvmfsMode).toBe('false');
    expect(ctx.app.platform).toBe(process.platform);
    expect(ctx.app.appVersion).toBe('2.0.0');
    expect(ctx.logTail).toBeDefined();
  });

  it('returns empty log tail when log file does not exist', () => {
    const ctx = collectContext();
    expect(ctx.logTail).toBe('');
  });
});

describe('buildScrubList', () => {
  it('includes home directory, storage path, and working directory', () => {
    const list = buildScrubList();
    expect(list).toContain('/Users/testuser');
    expect(list).toContain('/Users/testuser/neurodesktop-storage');
    expect(list).toContain('/Users/testuser/mydata');
  });
});

describe('mini app selection telemetry', () => {
  it('initializes from packaged build configuration without runtime environment variables', () => {
    const previousKey = process.env.POSTHOG_API_KEY;
    const previousHost = process.env.POSTHOG_HOST;
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;

    const fs = require('fs');
    const readFileSync = fs.readFileSync as jest.Mock;
    readFileSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('telemetry-config.json')) {
        return JSON.stringify({
          apiKey: 'packaged-test-key',
          host: 'https://posthog.example'
        });
      }
      return '';
    });

    try {
      jest.isolateModules(() => {
        const telemetry = require('../telemetry');
        const { PostHog } = require('posthog-node');
        const log = require('electron-log').default;
        telemetry.initTelemetry();
        expect(PostHog).toHaveBeenCalledWith('packaged-test-key', {
          host: 'https://posthog.example',
          enableExceptionAutocapture: true,
          fetch: expect.any(Function)
        });
        expect(log.info).toHaveBeenCalledWith('Telemetry configuration', {
          apiKey: 'configured',
          apiKeySource: 'package',
          host: 'configured',
          hostSource: 'package',
          hostOrigin: 'https://posthog.example'
        });
        expect(JSON.stringify(log.info.mock.calls)).not.toContain(
          'packaged-test-key'
        );

        const client = (PostHog as jest.Mock).mock.results.slice(-1)[0].value;
        const listener = (name: string) =>
          client.on.mock.calls.find(([event]: [string]) => event === name)[1];
        listener('capture')({
          event: 'mini_app_selected',
          properties: { token: 'private-value' }
        });
        listener('flush')([{ properties: { token: 'private-value' } }]);
        listener('error')({
          name: 'PostHogFetchHttpError',
          status: 401,
          message: 'private-value'
        });
        listener('error')({
          name: 'PostHogFetchNetworkError',
          error: {
            cause: { code: 'ENOTFOUND', message: 'private-value' }
          }
        });
        expect(log.info).toHaveBeenCalledWith('Telemetry event queued', {
          event: 'mini_app_selected'
        });
        expect(log.info).toHaveBeenCalledWith('Telemetry batch delivered', {
          count: 1
        });
        expect(log.warn).toHaveBeenCalledWith('Telemetry delivery failed', {
          name: 'PostHogFetchHttpError',
          status: 401,
          code: undefined
        });
        expect(log.warn).toHaveBeenCalledWith('Telemetry delivery failed', {
          name: 'PostHogFetchNetworkError',
          status: undefined,
          code: 'ENOTFOUND'
        });
        expect(
          JSON.stringify([log.info.mock.calls, log.warn.mock.calls])
        ).not.toContain('private-value');
      });
    } finally {
      const { PostHog } = require('posthog-node');
      (PostHog as jest.Mock).mockClear();
      readFileSync.mockReturnValue('');
      if (previousKey === undefined) {
        delete process.env.POSTHOG_API_KEY;
      } else {
        process.env.POSTHOG_API_KEY = previousKey;
      }
      if (previousHost === undefined) {
        delete process.env.POSTHOG_HOST;
      } else {
        process.env.POSTHOG_HOST = previousHost;
      }
    }
  });

  it('logs request outcomes without logging the key, body, or URL query', async () => {
    const previousKey = process.env.POSTHOG_API_KEY;
    const previousHost = process.env.POSTHOG_HOST;
    const previousFetch = global.fetch;
    const electronFetch = require('electron').net.fetch as jest.Mock;
    process.env.POSTHOG_API_KEY = 'private-key';
    process.env.POSTHOG_HOST = 'https://posthog.example';

    try {
      let request: (
        url: string,
        options: Parameters<typeof fetch>[1]
      ) => Promise<Response>;
      jest.isolateModules(() => {
        const telemetry = require('../telemetry');
        const { PostHog } = require('posthog-node');
        telemetry.initTelemetry();
        request = (PostHog as jest.Mock).mock.calls.slice(-1)[0][1].fetch;
      });

      const log = require('electron-log').default;
      const options = {
        method: 'POST',
        headers: { Authorization: 'private-key' },
        body: 'private-body'
      };
      const url = 'https://posthog.example/batch/?token=private-query';
      const response = { status: 200 } as Response;
      global.fetch = jest.fn().mockRejectedValue(new Error('Node fetch used'));
      electronFetch.mockResolvedValueOnce(response);
      await expect(request!(url, options)).resolves.toBe(response);
      expect(electronFetch).toHaveBeenCalledWith(url, options);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledWith('Telemetry request started', {
        hostOrigin: 'https://posthog.example',
        endpoint: 'batch',
        compressed: false
      });
      expect(log.info).toHaveBeenCalledWith(
        'Telemetry request completed',
        expect.objectContaining({ status: 200 })
      );

      const networkError = Object.assign(new TypeError('private-message'), {
        cause: Object.assign(new Error('private-cause'), { code: 'ENOTFOUND' })
      });
      electronFetch.mockRejectedValueOnce(networkError);
      await expect(request!(url, options)).rejects.toBe(networkError);
      expect(log.warn).toHaveBeenCalledWith(
        'Telemetry request failed',
        expect.objectContaining({ name: 'TypeError', code: 'ENOTFOUND' })
      );
      const chromiumError = new Error(
        'net::ERR_CERT_AUTHORITY_INVALID private-message'
      );
      electronFetch.mockRejectedValueOnce(chromiumError);
      await expect(request!(url, options)).rejects.toBe(chromiumError);
      expect(log.warn).toHaveBeenCalledWith(
        'Telemetry request failed',
        expect.objectContaining({ code: 'ERR_CERT_AUTHORITY_INVALID' })
      );
      expect(
        JSON.stringify([log.info.mock.calls, log.warn.mock.calls])
      ).not.toMatch(
        /private-key|private-body|private-query|private-message|private-cause/
      );
    } finally {
      const { PostHog } = require('posthog-node');
      (PostHog as jest.Mock).mockClear();
      electronFetch.mockReset();
      global.fetch = previousFetch;
      if (previousKey === undefined) {
        delete process.env.POSTHOG_API_KEY;
      } else {
        process.env.POSTHOG_API_KEY = previousKey;
      }
      if (previousHost === undefined) {
        delete process.env.POSTHOG_HOST;
      } else {
        process.env.POSTHOG_HOST = previousHost;
      }
    }
  });

  it('sends only the selected app and launch type when consent is on', () => {
    const previousKey = process.env.POSTHOG_API_KEY;
    const previousHost = process.env.POSTHOG_HOST;
    process.env.POSTHOG_API_KEY = 'test-key';
    process.env.POSTHOG_HOST = 'https://posthog.example';
    const onSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

    try {
      jest.isolateModules(() => {
        const telemetry = require('../telemetry');
        const { userSettings } = require('../config/settings');
        const { PostHog } = require('posthog-node');
        const getValue = userSettings.getValue as jest.Mock;
        telemetry.initTelemetry();
        telemetry.initTelemetry();

        expect(PostHog).toHaveBeenCalledTimes(1);

        const client = (PostHog as jest.Mock).mock.results.slice(-1)[0].value;
        telemetry.captureMiniAppSelection('neurodesk', 'local');
        expect(client.capture).toHaveBeenCalledWith({
          distinctId: expect.any(String),
          event: 'mini_app_selected',
          properties: { miniAppId: 'neurodesk', launchType: 'local' }
        });

        telemetry.captureMiniAppSelection('/Users/private', 'remote');
        expect(client.capture).toHaveBeenCalledTimes(1);

        getValue.mockImplementation((key: string) =>
          key === 'telemetryConsent' ? 'off' : ''
        );
        telemetry.captureMiniAppSelection('neurodesk', 'remote');
        expect(client.capture).toHaveBeenCalledTimes(1);
      });
    } finally {
      onSpy.mockRestore();
      if (previousKey === undefined) {
        delete process.env.POSTHOG_API_KEY;
      } else {
        process.env.POSTHOG_API_KEY = previousKey;
      }
      if (previousHost === undefined) {
        delete process.env.POSTHOG_HOST;
      } else {
        process.env.POSTHOG_HOST = previousHost;
      }
    }
  });

  it('records OS and failed startup status for local sessions', () => {
    const previousKey = process.env.POSTHOG_API_KEY;
    const previousHost = process.env.POSTHOG_HOST;
    process.env.POSTHOG_API_KEY = 'test-key';
    process.env.POSTHOG_HOST = 'https://posthog.example';

    try {
      jest.isolateModules(() => {
        const telemetry = require('../telemetry');
        const { PostHog } = require('posthog-node');
        const { userSettings } = require('../config/settings');
        (userSettings.getValue as jest.Mock).mockImplementation((key: string) =>
          key === 'telemetryConsent' ? 'on' : ''
        );
        telemetry.initTelemetry();
        const client = (PostHog as jest.Mock).mock.results.slice(-1)[0].value;
        client.capture.mockClear();

        telemetry.captureLocalSessionStartup('docker', false);
        telemetry.captureLocalSessionStartup('docker', true);

        expect(client.capture).toHaveBeenNthCalledWith(1, {
          distinctId: expect.any(String),
          event: 'local_session_started',
          properties: {
            engineType: 'docker',
            operatingSystem: process.platform,
            failedSessionStartup: false
          }
        });
        expect(client.capture).toHaveBeenNthCalledWith(2, {
          distinctId: expect.any(String),
          event: 'local_session_started',
          properties: {
            engineType: 'docker',
            operatingSystem: process.platform,
            failedSessionStartup: true
          }
        });

        client.capture.mockImplementationOnce(() => {
          throw new Error('PostHog unavailable');
        });
        expect(() =>
          telemetry.captureLocalSessionStartup('docker', true)
        ).not.toThrow();
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.POSTHOG_API_KEY;
      } else {
        process.env.POSTHOG_API_KEY = previousKey;
      }
      if (previousHost === undefined) {
        delete process.env.POSTHOG_HOST;
      } else {
        process.env.POSTHOG_HOST = previousHost;
      }
    }
  });
});
