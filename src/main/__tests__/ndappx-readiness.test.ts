/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { parseReadinessLine, ReadinessReader } from '../ndappx/readiness';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_Z';

function record(overrides: { [key: string]: unknown } = {}): string {
  return JSON.stringify({
    event: 'ready',
    protocol: 'ndappx',
    api_version: 1,
    base_url: 'http://127.0.0.1:49152',
    token: TOKEN,
    pid: 12345,
    ...overrides
  });
}

describe('parseReadinessLine', () => {
  it('accepts a valid record', () => {
    const ready = parseReadinessLine(record());
    expect(ready.base_url).toBe('http://127.0.0.1:49152');
    expect(ready.token).toBe(TOKEN);
    expect(ready.pid).toBe(12345);
  });

  it.each([
    ['protocol', { protocol: 'other' }],
    ['api_version', { api_version: 2 }],
    ['event', { event: 'starting' }],
    ['non-loopback url', { base_url: 'http://0.0.0.0:49152' }],
    ['localhost name', { base_url: 'http://localhost:49152' }],
    ['https url', { base_url: 'https://127.0.0.1:49152' }],
    ['url with path', { base_url: 'http://127.0.0.1:49152/v1' }],
    ['short token', { token: 'abc' }],
    ['token with padding', { token: TOKEN.slice(0, 42) + '=' }],
    ['pid', { pid: 0 }]
  ])('rejects bad %s', (_name, overrides) => {
    expect(() => parseReadinessLine(record(overrides))).toThrow();
  });

  it('rejects invalid JSON', () => {
    expect(() => parseReadinessLine('{not json')).toThrow(/not valid JSON/);
  });

  it('never puts the token in the error message', () => {
    try {
      parseReadinessLine(record({ protocol: 'x' }));
    } catch (e) {
      expect((e as Error).message).not.toContain(TOKEN);
    }
    try {
      parseReadinessLine(record({ token: TOKEN + 'x' }));
    } catch (e) {
      expect((e as Error).message).not.toContain(TOKEN);
    }
  });
});

describe('ReadinessReader', () => {
  it('waits for a complete line across chunks', () => {
    const reader = new ReadinessReader();
    const line = record() + '\n';
    expect(reader.push(line.slice(0, 5))).toBeNull();
    expect(reader.push(line.slice(5, 40))).toBeNull();
    const ready = reader.push(line.slice(40));
    expect(ready?.pid).toBe(12345);
    expect(reader.done).toBe(true);
  });

  it('handles the record and later data in one chunk', () => {
    const reader = new ReadinessReader();
    const ready = reader.push(record() + '\n{"other":1}\n');
    expect(ready?.protocol).toBe('ndappx');
    expect(reader.push('more\n')).toBeNull();
  });

  it('accepts CRLF line endings', () => {
    const reader = new ReadinessReader();
    expect(reader.push(Buffer.from(record() + '\r\n'))?.pid).toBe(12345);
  });

  it('throws on an invalid first line', () => {
    const reader = new ReadinessReader();
    expect(() => reader.push('garbage\n')).toThrow();
  });

  it('gives up on an unterminated oversized record', () => {
    const reader = new ReadinessReader();
    expect(() => reader.push('x'.repeat(5000))).toThrow(/too long/);
  });
});
