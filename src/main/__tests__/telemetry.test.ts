// Mock posthog-node before importing telemetry
jest.mock('posthog-node', () => ({
  PostHog: jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
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
  nativeTheme: { shouldUseDarkColors: false }
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
