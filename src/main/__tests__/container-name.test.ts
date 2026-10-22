jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn()
}));

import { execSync } from 'child_process';
import { EngineType } from '../config/settings';
import { getUserScopedContainerName, resolveContainerName } from '../server';

const execSyncMock = execSync as jest.Mock;

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

  it('uses the host user ID as a stable suffix for every engine', () => {
    for (const engineType of [
      EngineType.Docker,
      EngineType.Podman,
      EngineType.TinyRange
    ]) {
      expect(resolveContainerName(engineType, 'neurodeskapp', 4444444)).toBe(
        'neurodeskapp-4444444'
      );
    }
  });

  it('does not shell out for TinyRange (no container to remove)', () => {
    resolveContainerName(EngineType.TinyRange, 'neurodeskapp', 4444444);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('removes a stale container before reusing the name (Docker)', () => {
    withPlatform('linux', () => {
      resolveContainerName(EngineType.Docker, 'neurodeskapp', 4444444);
    });
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0][0]).toContain(
      'docker rm -f neurodeskapp-4444444'
    );
  });

  it('wraps the removal in timeout 30 on Linux only', () => {
    withPlatform('linux', () =>
      resolveContainerName(EngineType.Podman, 'neurodeskapp')
    );
    expect(execSyncMock.mock.calls[0][0]).toContain('timeout 30 podman rm -f');

    execSyncMock.mockReset();
    withPlatform('darwin', () =>
      resolveContainerName(EngineType.Docker, 'neurodeskapp')
    );
    expect(execSyncMock.mock.calls[0][0]).not.toContain('timeout 30');
  });

  it('uses cmd.exe redirection on Windows', () => {
    withPlatform('win32', () =>
      resolveContainerName(EngineType.Docker, 'neurodeskapp')
    );
    const cmd = execSyncMock.mock.calls[0][0];
    expect(cmd).toContain('>NUL 2>&1');
    expect(cmd).not.toContain('&>/dev/null');
  });

  it('passes a hard timeout so a wedged daemon cannot block startup', () => {
    withPlatform('linux', () =>
      resolveContainerName(EngineType.Docker, 'neurodeskapp')
    );
    expect(execSyncMock.mock.calls[0][1]).toMatchObject({ timeout: 35000 });
  });

  it('still returns the name when the removal throws (no such container)', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('No such container: neurodeskapp-4444444');
    });
    withPlatform('linux', () => {
      expect(
        resolveContainerName(EngineType.Docker, 'neurodeskapp', 4444444)
      ).toBe('neurodeskapp-4444444');
    });
  });

  it('uses the current Unix UID by default', () => {
    if (process.getuid) {
      expect(getUserScopedContainerName('neurodeskapp')).toBe(
        `neurodeskapp-${process.getuid()}`
      );
    }
  });

  it('sanitizes account names used when a numeric UID is unavailable', () => {
    expect(getUserScopedContainerName('neurodeskapp', 'Jane Doe')).toBe(
      'neurodeskapp-Jane-Doe'
    );
  });
});
