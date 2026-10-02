/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { IReadiness, NDAPPX_API_VERSION, NDAPPX_PROTOCOL } from './types';

const BASE_URL_RE = /^http:\/\/127\.0\.0\.1:[0-9]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Validate the single stdout readiness record printed by
 * `NeurodeskAppX --headless`. Throws on anything unexpected; the error
 * message never includes the token.
 */
export function parseReadinessLine(line: string): IReadiness {
  let record: any;
  try {
    record = JSON.parse(line);
  } catch {
    throw new Error('NeurodeskAppX readiness record is not valid JSON');
  }
  if (!record || typeof record !== 'object') {
    throw new Error('NeurodeskAppX readiness record is not an object');
  }
  if (record.event !== 'ready') {
    throw new Error(`Unexpected NeurodeskAppX event: ${record.event}`);
  }
  if (record.protocol !== NDAPPX_PROTOCOL) {
    throw new Error(`Unsupported NeurodeskAppX protocol: ${record.protocol}`);
  }
  if (record.api_version !== NDAPPX_API_VERSION) {
    throw new Error(
      `Unsupported NeurodeskAppX api_version: ${record.api_version}`
    );
  }
  if (
    typeof record.base_url !== 'string' ||
    !BASE_URL_RE.test(record.base_url)
  ) {
    throw new Error(
      `NeurodeskAppX base_url is not an IPv4 loopback URL: ${record.base_url}`
    );
  }
  if (typeof record.token !== 'string' || !TOKEN_RE.test(record.token)) {
    throw new Error('NeurodeskAppX token is malformed');
  }
  if (!Number.isInteger(record.pid) || record.pid < 1) {
    throw new Error(`NeurodeskAppX pid is invalid: ${record.pid}`);
  }
  return record as IReadiness;
}

/**
 * Accumulates stdout chunks and yields the readiness record once the first
 * complete line arrives. Pipe reads can split or combine data arbitrarily.
 */
export class ReadinessReader {
  /**
   * Feed a stdout chunk. Returns the parsed record when the first line is
   * complete, otherwise null. Throws if that line is invalid. Data after the
   * first line is ignored.
   */
  push(chunk: string | Buffer): IReadiness | null {
    if (this._done) {
      return null;
    }
    this._buffer += chunk.toString();
    const newline = this._buffer.indexOf('\n');
    if (newline < 0) {
      if (this._buffer.length > MAX_READINESS_BYTES) {
        this._done = true;
        throw new Error('NeurodeskAppX readiness record is too long');
      }
      return null;
    }
    this._done = true;
    const line = this._buffer.slice(0, newline).replace(/\r$/, '');
    this._buffer = '';
    return parseReadinessLine(line);
  }

  get done(): boolean {
    return this._done;
  }

  private _buffer = '';
  private _done = false;
}

const MAX_READINESS_BYTES = 4096;
