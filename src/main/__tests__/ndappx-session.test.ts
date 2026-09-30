/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  NdappxSession,
  OperationError,
  VirtualizationError
} from '../ndappx/session';

const FAKE = path.join(__dirname, '../../__mocks__/fake-ndappx.js');
const posixOnly = process.platform === 'win32' ? describe.skip : describe;

let tmpDir: string;
let logFile: string;
let fakeBin: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndappx-test-'));
  fakeBin = path.join(tmpDir, 'NeurodeskAppX');
  fs.copyFileSync(FAKE, fakeBin);
  fs.chmodSync(fakeBin, 0o755);
});

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function makeSession(scenario = 'ok', extra = {}): NdappxSession {
  logFile = path.join(
    tmpDir,
    `log-${Math.random().toString(36).slice(2)}.jsonl`
  );
  return new NdappxSession({
    command: fakeBin,
    args: ['--cache-dir', tmpDir],
    env: {
      ...process.env,
      FAKE_NDAPPX_SCENARIO: scenario,
      FAKE_NDAPPX_LOG: logFile
    },
    pollIntervalMs: 5,
    watchIntervalMs: 5,
    readyTimeoutMs: 10000,
    ...extra
  });
}

function requests(): any[] {
  if (!fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));
}

posixOnly('NdappxSession against a fake NeurodeskAppX', () => {
  it('runs pull -> vm -> glass -> shutdown and exits the child', async () => {
    const session = makeSession();
    await session.start();
    const { info } = await session.checkHost();
    expect(info.defaults.user).toBe('jovyan');

    const phases: string[] = [];
    const image = await session.pull(
      'docker.io/vnmd/neurodesktop:2026-07-11',
      op => phases.push(op.phase)
    );
    expect(image.image_id).toBe('img_1');
    expect(image.reference).toBe('docker.io/vnmd/neurodesktop:2026-07-11');
    expect(phases).toEqual(['downloading', 'complete']);

    await session.startVm({ image_id: image.image_id, name: 'neurodesk' });
    expect(session.vmId).toBe('vm_1');
    const glass = await session.openGlass({ title: 'Neurodesk' });
    expect(glass.state).toBe('open');

    await session.shutdown(5);
    expect(session.running).toBe(false);

    const reqs = requests();
    const pull = reqs.find(r => r.url === '/v1/images/pull');
    expect(pull.body).toEqual({
      reference: 'docker.io/vnmd/neurodesktop:2026-07-11',
      policy: 'if_missing'
    });
    for (const r of reqs.filter(r => r.method === 'POST')) {
      expect(r.headers['idempotency-key']).toBeTruthy();
    }
    expect(reqs.map(r => `${r.method} ${r.url}`)).toContain(
      'POST /v1/shutdown'
    );
  });

  it('rejects reusing one idempotency key for a different request', async () => {
    const session = makeSession();
    await session.start();
    const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const pull = await session.client.pullImage({ reference: 'x:1' }, key);
    // Same key + same request replays the original acceptance.
    const replay = await session.client.pullImage({ reference: 'x:1' }, key);
    expect(replay.body.operation_id).toBe(pull.body.operation_id);
    // Same key on another endpoint is a conflict, as on the real backend.
    await expect(
      session.client.startVm({ image_id: 'img_1' }, key)
    ).rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' });
    await session.shutdown(5);
  });

  it('rejects when virtualization is not accessible', async () => {
    const session = makeSession('novirt');
    await session.start();
    const err = await session.checkHost().catch(e => e);
    expect(err).toBeInstanceOf(VirtualizationError);
    expect(err.virtualization.reason.code).toBe('permission_denied');
    expect(err.message).toMatch(/kvm/);
    await session.shutdown(5);
  });

  it('rejects with the operation error when a pull fails', async () => {
    const session = makeSession('pull_fail');
    await session.start();
    const err = await session
      .pull('docker.io/vnmd/neurodesktop:nope')
      .catch(e => e);
    expect(err).toBeInstanceOf(OperationError);
    expect(err.message).toBe('manifest unknown');
    await session.shutdown(5);
  });

  it('retries shutdown after a 504 with a new idempotency key', async () => {
    const session = makeSession('shutdown_504_once');
    await session.start();
    await session.shutdown(5);
    const shutdowns = requests().filter(r => r.url === '/v1/shutdown');
    expect(shutdowns).toHaveLength(2);
    expect(shutdowns[0].headers['idempotency-key']).not.toBe(
      shutdowns[1].headers['idempotency-key']
    );
    expect(session.running).toBe(false);
  });

  it('reports a closed Glass window and can reopen it', async () => {
    const session = makeSession();
    await session.start();
    const image = await session.pull('x:1');
    await session.startVm({ image_id: image.image_id });
    await session.openGlass();

    const closed = new Promise<void>(resolve =>
      session.watchVm(vm => {
        if (vm?.glass?.state === 'closed') {
          resolve();
        }
      })
    );
    process.kill(session.pid, 'SIGUSR2');
    await closed;

    const glass = await session.openGlass();
    expect(glass.state).toBe('open');
    await session.shutdown(5);
  });

  it('fails start with stderr when the child exits before readiness', async () => {
    const session = makeSession('exit_early');
    await expect(session.start()).rejects.toThrow(/cannot open cache/);
  });

  it('fails start on an invalid readiness record', async () => {
    const session = makeSession('bad_ready');
    await expect(session.start()).rejects.toThrow(/protocol/);
    await session.shutdown(1);
    expect(session.running).toBe(false);
  });

  it('notifies onExit when the child dies unexpectedly', async () => {
    const onExit = jest.fn();
    const session = makeSession('ok', { onExit });
    await session.start();
    const exited = new Promise<void>(r => onExit.mockImplementation(() => r()));
    process.kill(session.pid, 'SIGKILL');
    await exited;
    expect(onExit).toHaveBeenCalledWith(null, 'SIGKILL');
  });
});
