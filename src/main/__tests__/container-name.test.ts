jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn()
}));

import * as os from 'os';
import { execSync } from 'child_process';
import { EngineType } from '../config/settings';
import { getUserScopedContainerName, resolveContainerName } from '../server';

const execSyncMock = jest.mocked(execSync);

/** Override the read-only process.platform for a single test. */
function withPlatform(platform: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    fn();
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  }
}

describe('resolveContainerName', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it('uses the host user ID for every engine', () => {
    for (const engineType of [
      EngineType.Docker,
      EngineType.Podman,
      EngineType.CrumbleCracker
    ]) {
      expect(resolveContainerName(engineType, 'neurodeskapp', 1001)).toBe(
        'neurodeskapp-1001'
      );
    }
  });

  it('does not shell out for native engines (no container to remove)', () => {
    resolveContainerName(EngineType.CrumbleCracker, 'neurodeskapp');
    resolveContainerName(EngineType.TinyRange, 'neurodeskapp');
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('removes a stale container before reusing the name (Docker)', () => {
    withPlatform('linux', () => {
      resolveContainerName(EngineType.Docker, 'neurodeskapp', 1001);
    });
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0][0]).toContain(
      'docker rm -f neurodeskapp-1001'
    );
  });

  it('wraps the removal in timeout 30 on Linux only', () => {
    withPlatform('linux', () =>
      resolveContainerName(EngineType.Podman, 'neurodeskapp')
    );
    expect(execSyncMock.mock.calls[0][0]).toContain('timeout 30 podman rm -f');

    execSyncMock.mockReset();
    withPlatform('darwin', () =>
      resolveContainerName(EngineType.Docker, 'neurodeskapp', 1001)
    );
    expect(execSyncMock.mock.calls[0][0]).not.toContain('timeout 30');
  });

  it('uses cmd.exe redirection on Windows', () => {
    withPlatform('win32', () =>
      resolveContainerName(EngineType.Docker, 'neurodeskapp', 1001)
    );
    const cmd = execSyncMock.mock.calls[0][0];
    expect(cmd).toContain('>NUL 2>&1');
    expect(cmd).not.toContain('&>/dev/null');
  });

  it('passes a hard timeout so a wedged daemon cannot block startup', () => {
    withPlatform('linux', () =>
      resolveContainerName(EngineType.Docker, 'neurodeskapp', 1001)
    );
    expect(execSyncMock.mock.calls[0][1]).toMatchObject({ timeout: 35000 });
  });

  it('still returns the name when the removal throws (no such container)', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('No such container: neurodeskapp');
    });
    withPlatform('linux', () => {
      expect(
        resolveContainerName(EngineType.Docker, 'neurodeskapp', 1001)
      ).toBe('neurodeskapp-1001');
    });
  });
});

describe('user-scoped container names', () => {
  it('keeps names stable across restarts and distinct across users', () => {
    expect(getUserScopedContainerName('neurodeskapp', 1001)).toBe(
      'neurodeskapp-1001'
    );
    expect(getUserScopedContainerName('neurodeskapp', 1002)).toBe(
      'neurodeskapp-1002'
    );
    expect(getUserScopedContainerName('neurodeskapp', 0)).toBe(
      'neurodeskapp-0'
    );
  });

  it('uses the current host identity by default', () => {
    const identity = process.getuid?.() ?? os.userInfo().username;
    expect(getUserScopedContainerName('neurodeskapp')).toBe(
      getUserScopedContainerName('neurodeskapp', identity)
    );
  });

  it('does not collapse different Windows account names after sanitization', () => {
    const first = getUserScopedContainerName('neurodeskapp', 'Jane Doe');
    const second = getUserScopedContainerName('neurodeskapp', 'Jane-Doe');
    expect(first).toMatch(/^neurodeskapp-[a-zA-Z0-9_.-]+$/);
    expect(first).not.toBe(second);
    expect(first).toBe(getUserScopedContainerName('neurodeskapp', 'Jane Doe'));
  });

  it('only cleans up the current user’s container', () => {
    execSyncMock.mockReset();
    resolveContainerName(EngineType.Docker, 'neurodeskapp', 1002);
    expect(execSyncMock.mock.calls[0][0]).toContain(
      'docker rm -f neurodeskapp-1002 '
    );
    expect(execSyncMock.mock.calls[0][0]).not.toContain('neurodeskapp-1001');
    expect(execSyncMock.mock.calls[0][0]).not.toContain('rm -f neurodeskapp ');
  });
});
