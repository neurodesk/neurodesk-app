const http = require('http');
const fs = require('fs');
const [report, mode] = process.argv.slice(2);
const token = 'a'.repeat(43);
const log = value => fs.appendFileSync(report, JSON.stringify(value) + '\n');
let port;
let glass = false;
let state;
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  let body = '';
  req.on('data', b => {
    body += b;
  });
  req.on('end', () => {
    const json = body ? JSON.parse(body) : null;
    log({ path: req.url, body: json, key: req.headers['idempotency-key'] });
    const send = (data, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (
      req.method === 'POST' &&
      !/^[a-f0-9-]{36}$/.test(req.headers['idempotency-key'] || '')
    ) {
      send({}, 400);
      return;
    }
    if (req.url === '/v1/info') {
      send({ capabilities: { jupyter_first: true, gpu_acceleration: true } });
    } else if (req.url === '/v1/images/pull') {
      state = 'image';
      send({ operation_id: 'one' }, 202);
    } else if (req.url === '/v1/vms') {
      port = json.jupyter.host_port;
      state = 'vm';
      send({ operation_id: 'one' }, 202);
    } else if (req.url.endsWith('/glass')) {
      state = 'glass';
      glass = true;
      send({ operation_id: 'one' }, 202);
    } else if (req.url === '/v1/operations/one') {
      if (mode === 'pending') {
        send({ state: 'running', phase: 'importing' });
        return;
      }
      send({
        state: 'succeeded',
        phase: 'complete',
        result:
          state === 'image'
            ? { image_id: 'image', digest: 'sha256:fixture' }
            : state === 'vm'
            ? {
                vm_id: 'vm',
                jupyter: {
                  url: `http://127.0.0.1:${port}/lab`,
                  token: 'b'.repeat(64)
                }
              }
            : { state: 'open' }
      });
    } else if (req.url === '/v1/vms/vm') {
      send({ glass: glass ? { state: 'open' } : null });
    } else if (req.url === '/v1/shutdown') {
      send({ state: 'stopped' }, mode === 'eof' ? 500 : 200);
      if (mode !== 'eof') {
        server.close(() => process.exit(0));
      }
    } else {
      send({}, 404);
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  const record =
    JSON.stringify({
      event: 'ready',
      protocol: 'ndappx',
      api_version: 1,
      base_url:
        mode === 'remote'
          ? 'http://example.com:80'
          : `http://127.0.0.1:${server.address().port}`,
      token,
      pid: process.pid
    }) + '\n';
  // Deliberately split stdout: pipe chunks are not record boundaries.
  process.stdout.write(record.slice(0, 17));
  setTimeout(() => process.stdout.write(record.slice(17)), 5);
});
process.stdin.resume();
process.stdin.on('end', () => {
  log({ eof: true });
  server.close(() => process.exit(0));
});
