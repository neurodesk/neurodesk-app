import { CrumbleCracker } from '../crumblecracker';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const options = {
  image: 'docker-archive:/candidate.tar',
  name: 'test',
  storage: '/storage',
  directory: '/data',
  port: 18888,
  gpu: true,
  cvmfs: false
};
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-client-'));
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const launch = (mode = '') =>
  new CrumbleCracker({
    binary: process.execPath,
    cache: directory,
    prefixArgs: [
      path.join(__dirname, '../test-fixtures/crumble-backend.js'),
      path.join(directory, 'calls'),
      mode
    ]
  });
const calls = () =>
  fs
    .readFileSync(path.join(directory, 'calls'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));

test('starts authenticated Jupyter first, defers and coalesces desktop activation, owns shutdown', async () => {
  const client = launch();
  try {
    const result = await client.start(options);
    expect(result.token).toHaveLength(64);
    expect(calls().some(call => call.path.endsWith('/glass'))).toBe(false);
    const vm = calls().find(call => call.path === '/v1/vms').body;
    expect(vm.display.gpu_acceleration).toBe(true);
    expect(vm.jupyter.host_port).toBe(options.port);
    await Promise.all([client.openDesktop(), client.openDesktop()]);
    await client.openDesktop();
    expect(calls().filter(call => call.path.endsWith('/glass'))).toHaveLength(
      1
    );
  } finally {
    await client.stop();
  }
  expect(calls().filter(call => call.path === '/v1/shutdown')).toHaveLength(1);
}, 15000);

test('rejects a remote ready address and closes its own child without sending a token', async () => {
  const client = launch('remote');
  await expect(client.start(options)).rejects.toThrow(
    'Invalid CrumbleCracker ready'
  );
  expect(calls()).toEqual([{ eof: true }]);
}, 15000);

test('EOF cleans up when authenticated shutdown fails', async () => {
  const client = launch('eof');
  await client.start(options);
  await client.stop();
  expect(calls().some(call => call.eof)).toBe(true);
}, 15000);

test('stop cancels a pending import without booting a VM', async () => {
  const client = launch('pending');
  let importing: () => void;
  const progress = new Promise<void>(resolve => {
    importing = resolve;
  });
  const start = client.start(options, () => importing());
  const rejection = expect(start).rejects.toThrow('stopped');
  await progress;
  await client.stop();
  await rejection;
  expect(calls().some(call => call.path === '/v1/vms')).toBe(false);
}, 15000);

test('does not expose a host data share when none is configured', async () => {
  const client = launch();
  try {
    await client.start({ ...options, directory: '' });
    expect(calls().find(call => call.path === '/v1/vms').body.shares).toEqual(
      []
    );
  } finally {
    await client.stop();
  }
}, 15000);
