jest.mock('../telemetry', () => ({}));
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn()
}));
import { execFile } from 'child_process';
import { JupyterServer } from '../server';
import { SessionWindow } from '../sessionwindow/sessionwindow';

describe('shutdown ownership', () => {
  function server() {
    const instance = Object.create(JupyterServer.prototype);
    instance._info = { engine: 'docker', containerName: 'test' };
    instance._nbServer = { kill: jest.fn() };
    return instance;
  }
  beforeEach(() => jest.clearAllMocks());
  it('preserves the pending stop through startup failure and duplicate stop', async () => {
    const instance = server();
    const pending = instance.stop();
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    instance._serverStartFailed();
    expect(instance.stop()).toBe(pending);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect((execFile as jest.Mock).mock.calls[0][2]).toEqual({
      timeout: 10000
    });
    const callback = (execFile as jest.Mock).mock.calls[0][3];
    callback(null, '', '');
    await pending;
    instance._serverStartFailed();
    expect(instance.stop()).toBe(pending);
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it.each([
    [null, '', false],
    [new Error('missing'), 'No such container: test', false],
    [new Error('missing'), 'no container with name or ID test found', false],
    [new Error('daemon'), 'permission denied', true],
    [Object.assign(new Error('missing binary'), { code: 'ENOENT' }), '', true],
    [
      Object.assign(new Error('timeout'), { killed: true }),
      'No such container',
      true
    ]
  ])('settles removal %#', async (error, stderr, rejects) => {
    const instance = server();
    const pending = instance.stop();
    const assertion = rejects
      ? expect(pending).rejects.toBe(error)
      : expect(pending).resolves.toBeUndefined();
    (execFile as jest.Mock).mock.calls[0][3](error, '', stderr);
    await assertion;
  });
  it('rejects disposal and cleans up all views', async () => {
    const instance = Object.create(SessionWindow.prototype);
    const failure = new Error('daemon unavailable');
    instance._evm = { dispose: jest.fn() };
    instance._wsSettings = { save: jest.fn() };
    instance._server = { server: { stop: () => Promise.reject(failure) } };
    instance._window = {
      isDestroyed: () => false,
      contentView: { removeChildView: jest.fn() }
    };
    const close = jest.fn();
    const wc = { isDestroyed: () => false, close };
    const dispose = jest.fn();
    instance._labView = { view: {}, dispose };
    instance._titleBarView = { view: { webContents: wc } };
    instance._welcomeView = { view: { webContents: wc } };
    instance._progressView = { view: { view: { webContents: wc } } };
    const pending = instance.dispose();
    expect(instance.dispose()).toBe(pending);
    await expect(pending).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(3);
  });
});

describe('window close event boundary', () => {
  it('handles disposal rejection in the registered close listener', async () => {
    const instance = Object.create(SessionWindow.prototype);
    const on = jest.fn();
    instance._window = { on };
    instance._evm = { registerEventHandler: jest.fn() };
    instance.dispose = jest
      .fn()
      .mockRejectedValue(new Error('daemon unavailable'));
    instance._registerListeners();
    const close = on.mock.calls.find(call => call[0] === 'close')[1];
    await expect(close()).resolves.toBeUndefined();
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  });
});
