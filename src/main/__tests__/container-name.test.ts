jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execSync: jest.fn()
}));

import { execSync } from 'child_process';
import { EngineType } from '../config/settings';
import { resolveContainerName } from '../server';

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

  it('returns the base container name for every engine', () => {
    for (const engineType of [
      EngineType.Docker,
      EngineType.Podman,
      EngineType.TinyRange
    ]) {
      expect(resolveContainerName(engineType)).toBe('neurodeskapp');
    }
  });

  it('does not shell out for TinyRange (no container to remove)', () => {
    resolveContainerName(EngineType.TinyRange);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('removes a stale container before reusing the name (Docker)', () => {
    withPlatform('linux', () => {
      resolveContainerName(EngineType.Docker);
    });
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0][0]).toContain(
      'docker rm -f neurodeskapp'
    );
  });

  it('wraps the removal in timeout 30 on Linux only', () => {
    withPlatform('linux', () => resolveContainerName(EngineType.Podman));
    expect(execSyncMock.mock.calls[0][0]).toContain('timeout 30 podman rm -f');

    execSyncMock.mockReset();
    withPlatform('darwin', () => resolveContainerName(EngineType.Docker));
    expect(execSyncMock.mock.calls[0][0]).not.toContain('timeout 30');
  });

  it('uses cmd.exe redirection on Windows', () => {
    withPlatform('win32', () => resolveContainerName(EngineType.Docker));
    const cmd = execSyncMock.mock.calls[0][0];
    expect(cmd).toContain('>NUL 2>&1');
    expect(cmd).not.toContain('&>/dev/null');
  });

  it('passes a hard timeout so a wedged daemon cannot block startup', () => {
    withPlatform('linux', () => resolveContainerName(EngineType.Docker));
    expect(execSyncMock.mock.calls[0][1]).toMatchObject({ timeout: 35000 });
  });

  it('still returns the name when the removal throws (no such container)', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('No such container: neurodeskapp');
    });
    withPlatform('linux', () => {
      expect(resolveContainerName(EngineType.Docker)).toBe('neurodeskapp');
    });
  });
});
