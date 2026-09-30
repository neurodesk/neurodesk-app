/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import * as http from 'http';
import { AddressInfo } from 'net';
import { NdappxClient, NdappxError } from '../ndappx/client';

const TOKEN = 'T'.repeat(43);

interface IRecorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let baseUrl: string;
let recorded: IRecorded[];
let handler: (req: IRecorded, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const r = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      };
      recorded.push(r);
      handler(r, res);
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(
  () => new Promise<void>(r => server.close(() => r()))
);

beforeEach(() => {
  recorded = [];
});

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers = {}
) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

describe('NdappxClient', () => {
  it('sends the bearer token, the Host of base_url and no Origin', async () => {
    handler = (_r, res) => json(res, 200, { supported: true });
    await new NdappxClient(baseUrl, TOKEN).virtualization();
    const [req] = recorded;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/v1/virtualization');
    expect(req.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers.host).toBe(new URL(baseUrl).host);
    expect(req.headers.origin).toBeUndefined();
    expect(req.headers['idempotency-key']).toBeUndefined();
  });

  it('sends a UUID idempotency key and a null-free body on mutations', async () => {
    handler = (_r, res) =>
      json(
        res,
        202,
        {
          operation_id: 'op_1',
          kind: 'image_pull',
          state: 'queued',
          resource_id: null
        },
        { Location: '/v1/operations/op_1' }
      );
    const res = await new NdappxClient(baseUrl, TOKEN).pullImage({
      reference: 'docker.io/vnmd/neurodesktop:2026-07-11',
      platform: undefined,
      policy: 'if_missing'
    });
    expect(res.status).toBe(202);
    expect(res.location).toBe('/v1/operations/op_1');
    const [req] = recorded;
    expect(req.headers['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(req.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req.body)).toEqual({
      reference: 'docker.io/vnmd/neurodesktop:2026-07-11',
      policy: 'if_missing'
    });
  });

  it('maps API errors to NdappxError without retrying', async () => {
    handler = (_r, res) =>
      json(res, 422, {
        error: {
          code: 'unsupported_configuration',
          message: 'Requested resources exceed host capacity',
          details: { cpu_limit: 4 },
          retryable: false
        }
      });
    const client = new NdappxClient(baseUrl, TOKEN, { retryDelayMs: 1 });
    await expect(client.startVm({ image_id: 'img_1' })).rejects.toMatchObject({
      name: 'NdappxError',
      code: 'unsupported_configuration',
      status: 422,
      retryable: false,
      details: { cpu_limit: 4 }
    });
    expect(recorded).toHaveLength(1);
  });

  it('treats a non-JSON error body as an http_error', async () => {
    handler = (_r, res) => {
      res.writeHead(500);
      res.end();
    };
    const err = await new NdappxClient(baseUrl, TOKEN).info().catch(e => e);
    expect(err).toBeInstanceOf(NdappxError);
    expect(err.code).toBe('http_error');
    expect(err.status).toBe(500);
  });

  it('retries a dropped connection with the same idempotency key', async () => {
    let calls = 0;
    handler = (_r, res) => {
      calls++;
      if (calls === 1) {
        res.socket?.destroy();
        return;
      }
      json(res, 202, {
        operation_id: 'op_2',
        kind: 'vm_start',
        state: 'queued',
        resource_id: 'vm_1'
      });
    };
    const client = new NdappxClient(baseUrl, TOKEN, { retryDelayMs: 1 });
    const res = await client.startVm(
      { image_id: 'img_1' },
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    );
    expect(res.body.operation_id).toBe('op_2');
    expect(recorded).toHaveLength(2);
    expect(recorded[0].headers['idempotency-key']).toBe(
      recorded[1].headers['idempotency-key']
    );
    expect(recorded[0].body).toBe(recorded[1].body);
  });

  it('gives up after the configured number of network retries', async () => {
    handler = (_r, res) => res.socket?.destroy();
    const client = new NdappxClient(baseUrl, TOKEN, {
      networkRetries: 2,
      retryDelayMs: 1
    });
    await expect(client.info()).rejects.not.toBeInstanceOf(NdappxError);
    expect(recorded).toHaveLength(3);
  });
});
