jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn()
}));

import { execFile } from 'child_process';
import { EngineType } from '../config/settings';
import { JupyterServer } from '../server';

const execFileMock = execFile as jest.Mock;

describe('JupyterServer.stop', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('waits for container removal without requesting shutdown over HTTP', async () => {
    let finishRemoval: (error: Error | null) => void;
    execFileMock.mockImplementation((_command, _options, callback) => {
      finishRemoval = callback;
    });

    const kill = jest.fn();
    const server = Object.create(JupyterServer.prototype) as JupyterServer;
    (server as any)._info = {
      engine: EngineType.Docker,
      containerName: 'neurodeskapp',
      url: new URL('http://127.0.0.1:57023/lab')
    };
    (server as any)._nbServer = { kill };

    const stopped = server.stop();
    let settled = false;
    stopped.then(() => {
      settled = true;
    });

    expect(server.stop()).toBe(stopped);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][0]).toBe('docker rm -f neurodeskapp');
    await Promise.resolve();
    expect(settled).toBe(false);

    finishRemoval(null);
    await stopped;
    expect(settled).toBe(true);
    expect((server as any)._stopping).toBe(true);
  });

  it('reports a container-engine failure during removal', async () => {
    execFileMock.mockImplementation((_command, _options, callback) => {
      callback(new Error('engine unavailable'), '', 'Cannot connect to daemon');
    });

    const server = Object.create(JupyterServer.prototype) as JupyterServer;
    (server as any)._info = {
      engine: EngineType.Podman,
      containerName: 'neurodeskapp'
    };
    (server as any)._nbServer = { kill: jest.fn() };

    await expect(server.stop()).rejects.toThrow('engine unavailable');
    expect(execFileMock.mock.calls[0][0]).toBe('podman rm -f neurodeskapp');
  });

  it('accepts a container already removed during shutdown', async () => {
    execFileMock.mockImplementation((_command, _options, callback) => {
      callback(new Error('exit code 1'), '', 'No such container: neurodeskapp');
    });

    const server = Object.create(JupyterServer.prototype) as JupyterServer;
    (server as any)._info = {
      engine: EngineType.Docker,
      containerName: 'neurodeskapp'
    };
    (server as any)._nbServer = { kill: jest.fn() };

    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('removes the container after stopping the launcher on Windows', async () => {
    execFileMock.mockImplementation((command, _options, callback) => {
      if (command === 'podman rm -f neurodeskapp') {
        callback(null, '', '');
      }
    });

    const server = Object.create(JupyterServer.prototype) as JupyterServer;
    (server as any)._info = {
      engine: EngineType.Podman,
      containerName: 'neurodeskapp'
    };
    (server as any)._nbServer = { pid: 1234 };

    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await server.stop();
    } finally {
      if (original) {
        Object.defineProperty(process, 'platform', original);
      }
    }

    expect(execFileMock.mock.calls.map(call => call[0])).toEqual([
      'taskkill',
      'podman rm -f neurodeskapp'
    ]);
  });
});
