#!/usr/bin/env node
// Fake `NeurodeskAppX --headless` used by src/main/__tests__/ndappx-*.test.ts.
// Scenario is selected with FAKE_NDAPPX_SCENARIO; every request is appended
// as a JSON line to FAKE_NDAPPX_LOG so tests can assert on headers/bodies.
/* eslint-disable */
const http = require('http');
const fs = require('fs');

const scenario = process.env.FAKE_NDAPPX_SCENARIO || 'ok';
const logFile = process.env.FAKE_NDAPPX_LOG;
const token = 'A'.repeat(43);

if (process.argv[2] !== '--headless') {
  process.stderr.write('expected --headless\n');
  process.exit(2);
}
if (scenario === 'exit_early') {
  process.stderr.write('fatal: cannot open cache\n');
  process.exit(3);
}

let nextOp = 1;
const ops = {};
const replays = {};
let vm = null;
let shutdown504 = scenario === 'shutdown_504_once';

function record(entry) {
  if (logFile) fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(text);
}

function error(res, status, code, message) {
  send(res, status, {
    error: { code, message, details: {}, retryable: false }
  });
}

function accept(res, kind, resourceId, result, fail) {
  const id = `op_${nextOp++}`;
  ops[id] = { kind, resourceId, result, fail, polls: 0 };
  send(
    res,
    202,
    { operation_id: id, kind, state: 'queued', resource_id: resourceId },
    { Location: `/v1/operations/${id}` }
  );
}

function operation(id) {
  const op = ops[id];
  op.polls++;
  const done = op.polls >= 2;
  const state = !done ? 'running' : op.fail ? 'failed' : 'succeeded';
  return {
    operation_id: id,
    kind: op.kind,
    resource_id: op.resourceId,
    state,
    phase: done
      ? 'complete'
      : op.kind === 'image_pull'
      ? 'downloading'
      : 'booting',
    progress:
      op.kind === 'image_pull'
        ? {
            updated_at: new Date().toISOString(),
            completed_bytes: done ? 100 : 50,
            total_bytes: 100,
            rate_bytes_per_second: 10,
            eta_seconds: done ? 0 : 5,
            planning_complete: true,
            artifacts: []
          }
        : null,
    created_at: new Date().toISOString(),
    finished_at: done ? new Date().toISOString() : null,
    result: done && !op.fail ? op.result() : null,
    error:
      done && op.fail
        ? {
            code: 'pull_failed',
            message: 'manifest unknown',
            details: {},
            retryable: false
          }
        : null
  };
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : undefined;
    record({ method: req.method, url: req.url, headers: req.headers, body });

    if (req.headers.authorization !== `Bearer ${token}`) {
      return error(res, 401, 'unauthorized', 'bad token');
    }
    if (req.headers.origin) {
      return error(res, 403, 'forbidden', 'origin not allowed');
    }
    if (req.method === 'POST') {
      const key = req.headers['idempotency-key'];
      if (!key) return error(res, 400, 'invalid_request', 'Idempotency-Key');
      // Like the real backend, keys are global: one key identifies one
      // method + path + body, and reusing it for anything else is a 409.
      const signature = `${req.method} ${req.url} ${raw}`;
      if (replays[key]) {
        const r = replays[key];
        if (r.signature !== signature)
          return error(
            res,
            409,
            'idempotency_conflict',
            'Idempotency key already used for another request'
          );
        return send(res, r.status, r.body, r.headers);
      }
      const origWrite = res.writeHead.bind(res);
      const origEnd = res.end.bind(res);
      let status, headers;
      res.writeHead = (s, h) => ((status = s), (headers = h), origWrite(s, h));
      res.end = text => {
        replays[key] = { signature, status, headers, body: JSON.parse(text) };
        return origEnd(text);
      };
    }

    const url = req.url;
    if (req.method === 'GET' && url === '/v1/info') {
      return send(res, 200, {
        protocol: 'ndappx',
        api_version: 1,
        version: 'v0.10.1-fake',
        state: 'ready',
        platform: { os: process.platform, arch: process.arch },
        capabilities: {
          max_active_vms: 1,
          native_glass: true,
          gpu_acceleration: false
        },
        defaults: {
          image: 'ghcr.io/tinyrange/neurodesktop-glass:latest-estargz',
          memory_mib: 4096,
          cpus: 2,
          user: 'jovyan',
          home_mode: 'persistent',
          storage_path: '/tmp/fake-storage'
        }
      });
    }
    if (req.method === 'GET' && url === '/v1/virtualization') {
      if (scenario === 'novirt') {
        return send(res, 200, {
          supported: true,
          accessible: false,
          backend: 'kvm',
          reason: {
            code: 'permission_denied',
            message: '/dev/kvm: permission denied'
          }
        });
      }
      return send(res, 200, {
        supported: true,
        accessible: true,
        backend: 'kvm',
        reason: null
      });
    }
    if (req.method === 'POST' && url === '/v1/images/pull') {
      return accept(
        res,
        'image_pull',
        null,
        () => ({
          image_id: 'img_1',
          reference: body.reference,
          digest: 'sha256:' + '0'.repeat(64),
          platform: 'linux/amd64',
          cache_hit: false,
          kernel: {
            kernel_id: 'k_1',
            version: '6.1',
            platform: 'linux/amd64',
            cache_hit: true
          }
        }),
        scenario === 'pull_fail'
      );
    }
    let m;
    if (
      req.method === 'GET' &&
      (m = url.match(/^\/v1\/operations\/([^/]+)$/))
    ) {
      if (!ops[m[1]]) return error(res, 404, 'not_found', 'operation');
      return send(res, 200, operation(m[1]));
    }
    if (req.method === 'POST' && url === '/v1/vms') {
      vm = {
        vm_id: 'vm_1',
        name: body.name,
        image_id: body.image_id,
        state: 'running',
        config: body,
        glass: null,
        active_operation_id: null,
        last_error: null
      };
      return accept(res, 'vm_start', 'vm_1', () => ({
        vm_id: 'vm_1',
        state: 'running'
      }));
    }
    if (req.method === 'GET' && url === '/v1/vms/vm_1') {
      return send(res, 200, vm);
    }
    if (req.method === 'POST' && url === '/v1/vms/vm_1/glass') {
      vm.glass = {
        glass_id: 'g_1',
        state: 'open',
        title: 'Neurodesk',
        width: 1440,
        height: 900
      };
      return accept(res, 'glass_spawn', 'vm_1', () => vm.glass);
    }
    if (req.method === 'POST' && url === '/v1/vms/vm_1/stop') {
      vm.state = 'stopped';
      vm.glass = null;
      return accept(res, 'vm_stop', 'vm_1', () => ({
        vm_id: 'vm_1',
        state: 'stopped'
      }));
    }
    if (req.method === 'POST' && url === '/v1/shutdown') {
      if (shutdown504) {
        shutdown504 = false;
        return error(res, 504, 'shutdown_timeout', 'cleanup incomplete');
      }
      send(res, 200, { state: 'stopped' });
      setTimeout(() => process.exit(0), 20);
      return;
    }
    error(res, 404, 'not_found', url);
  });
});

// Test hook: close the Glass window as if the user had closed it.
process.on('SIGUSR2', () => {
  if (vm && vm.glass) vm.glass.state = 'closed';
});

process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const ready = JSON.stringify({
    event: 'ready',
    protocol: scenario === 'bad_ready' ? 'other' : 'ndappx',
    api_version: 1,
    base_url: `http://127.0.0.1:${port}`,
    token,
    pid: process.pid
  });
  // Split the record across writes to exercise line buffering.
  process.stdout.write(ready.slice(0, 10));
  setTimeout(
    () => process.stdout.write(ready.slice(10) + '\n{"ignored":true}\n'),
    10
  );
});
