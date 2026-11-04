jest.mock('../../package.json', () => ({ version: 'test' }), { virtual: true });
jest.mock('../telemetry', () => ({}));
jest.mock('../sessionwindow/sessionwindow', () => ({
  SessionWindow: jest.fn(),
  ContentViewType: { Lab: 'lab' }
}));
import { SessionWindowManager } from '../app';
import { SessionWindow } from '../sessionwindow/sessionwindow';

it('removes the right closed window after rejected asynchronous disposal', async () => {
  const closeSettingsDialog = jest.fn();
  const closeAboutDialog = jest.fn();
  const manager = new SessionWindowManager({
    app: { closeSettingsDialog, closeAboutDialog },
    serverFactory: {}
  } as any);
  const sync = jest
    .spyOn(manager, 'syncSessionData')
    .mockImplementation(() => undefined);
  const callbacks: Array<() => Promise<void>> = [];
  const failures: Array<(error: Error) => void> = [];
  (SessionWindow as jest.Mock).mockImplementation(() => ({
    load: jest.fn(),
    sessionConfigChanged: { connect: jest.fn(), disconnect: jest.fn() },
    window: {
      on: (_name: string, cb: () => Promise<void>) => callbacks.push(cb)
    },
    dispose: () =>
      new Promise<void>((_resolve, reject) => failures.push(reject))
  }));
  manager.createNew(undefined, undefined, true);
  const second = manager.createNew(undefined, undefined, true);
  const firstClose = callbacks[0]();
  const secondClose = callbacks[1]();
  failures[0](new Error('daemon unavailable'));
  await expect(firstClose).resolves.toBeUndefined();
  expect(manager.windows).toEqual([second]);
  failures[1](new Error('timeout'));
  await expect(secondClose).resolves.toBeUndefined();
  expect(manager.windows).toEqual([]);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(closeSettingsDialog).toHaveBeenCalledTimes(1);
  expect(closeAboutDialog).toHaveBeenCalledTimes(1);
});
