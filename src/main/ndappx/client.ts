/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { randomUUID } from 'crypto';
import { request as httpRequest } from 'http';
import {
  IAcceptance,
  IApiError,
  IGlassRequest,
  IInfo,
  IOperation,
  IPullRequest,
  IShutdown,
  IVirtualization,
  IVM,
  IVMRequest
} from './types';

const MAX_BODY_BYTES = 1024 * 1024;

export class NdappxError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: { [key: string]: unknown } = {}
  ) {
    super(message);
    this.name = 'NdappxError';
  }

  static fromApi(status: number, error: IApiError): NdappxError {
    return new NdappxError(
      error.message,
      error.code,
      status,
      error.retryable,
      error.details || {}
    );
  }
}

export interface IResponse<T> {
  status: number;
  body: T;
  location?: string;
}

export interface INdappxClientOptions {
  /** Retries after a connection-level failure (same idempotency key). */
  networkRetries?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
}

/**
 * Remove undefined and null values recursively. The API rejects nulls and
 * `JSON.stringify` already drops undefined object fields.
 */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value
      .filter(v => v !== null && v !== undefined)
      .map(v => stripNulls(v)) as unknown) as T;
  }
  if (value && typeof value === 'object') {
    const out: { [key: string]: unknown } = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null && v !== undefined) {
        out[k] = stripNulls(v);
      }
    }
    return (out as unknown) as T;
  }
  return value;
}

/**
 * Minimal client for the NeurodeskAppX headless API. It lives in the main
 * process only; the token must never reach renderers, URLs or logs.
 */
export class NdappxClient {
  constructor(
    baseUrl: string,
    token: string,
    options: INdappxClientOptions = {}
  ) {
    this._baseUrl = new URL(baseUrl);
    this._token = token;
    this._networkRetries = options.networkRetries ?? 3;
    this._retryDelayMs = options.retryDelayMs ?? 500;
    this._requestTimeoutMs = options.requestTimeoutMs ?? 30000;
  }

  info(): Promise<IInfo> {
    return this._get<IInfo>('/v1/info');
  }

  virtualization(): Promise<IVirtualization> {
    return this._get<IVirtualization>('/v1/virtualization');
  }

  pullImage(
    req: IPullRequest,
    key: string = randomUUID()
  ): Promise<IResponse<IAcceptance>> {
    return this._mutate<IAcceptance>('/v1/images/pull', req, key);
  }

  operation(operationId: string): Promise<IOperation> {
    return this._get<IOperation>(
      `/v1/operations/${encodeURIComponent(operationId)}`
    );
  }

  startVm(
    req: IVMRequest,
    key: string = randomUUID()
  ): Promise<IResponse<IAcceptance>> {
    return this._mutate<IAcceptance>('/v1/vms', req, key);
  }

  vm(vmId: string): Promise<IVM> {
    return this._get<IVM>(`/v1/vms/${encodeURIComponent(vmId)}`);
  }

  openGlass(
    vmId: string,
    req: IGlassRequest = {},
    key: string = randomUUID()
  ): Promise<IResponse<IAcceptance>> {
    return this._mutate<IAcceptance>(
      `/v1/vms/${encodeURIComponent(vmId)}/glass`,
      req,
      key
    );
  }

  stopVm(
    vmId: string,
    timeoutSeconds = 30,
    key: string = randomUUID()
  ): Promise<IResponse<IAcceptance>> {
    return this._mutate<IAcceptance>(
      `/v1/vms/${encodeURIComponent(vmId)}/stop`,
      { timeout_seconds: timeoutSeconds },
      key
    );
  }

  shutdown(
    timeoutSeconds = 30,
    key: string = randomUUID()
  ): Promise<IResponse<IShutdown>> {
    return this._mutate<IShutdown>(
      '/v1/shutdown',
      { timeout_seconds: timeoutSeconds },
      key,
      // Shutdown blocks until the guest has stopped.
      (timeoutSeconds + 15) * 1000
    );
  }

  private async _get<T>(path: string): Promise<T> {
    const res = await this._withRetry(() => this._send<T>('GET', path));
    return res.body;
  }

  private _mutate<T>(
    path: string,
    body: unknown,
    key: string,
    timeoutMs?: number
  ): Promise<IResponse<T>> {
    return this._withRetry(() =>
      this._send<T>('POST', path, stripNulls(body), key, timeoutMs)
    );
  }

  private async _withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof NdappxError || attempt >= this._networkRetries) {
          throw error;
        }
        attempt++;
        await new Promise(r => setTimeout(r, this._retryDelayMs * attempt));
      }
    }
  }

  private _send<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    timeoutMs?: number
  ): Promise<IResponse<T>> {
    return new Promise<IResponse<T>>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: { [key: string]: string | number } = {
        Authorization: `Bearer ${this._token}`,
        Accept: 'application/json'
      };
      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
      }

      const req = httpRequest(
        {
          protocol: this._baseUrl.protocol,
          hostname: this._baseUrl.hostname,
          port: this._baseUrl.port,
          method,
          path,
          headers
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy(new Error('NeurodeskAppX response too large'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const status = res.statusCode || 0;
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: any = undefined;
            if (text) {
              try {
                parsed = JSON.parse(text);
              } catch {
                reject(
                  new NdappxError(
                    `NeurodeskAppX returned invalid JSON (HTTP ${status})`,
                    'invalid_response',
                    status,
                    false
                  )
                );
                return;
              }
            }
            if (status >= 200 && status < 300) {
              const location = res.headers.location;
              resolve({
                status,
                body: parsed as T,
                location: Array.isArray(location) ? location[0] : location
              });
            } else if (parsed && parsed.error) {
              reject(NdappxError.fromApi(status, parsed.error));
            } else {
              reject(
                new NdappxError(
                  `NeurodeskAppX request failed (HTTP ${status})`,
                  'http_error',
                  status,
                  status >= 500
                )
              );
            }
          });
          res.on('error', reject);
        }
      );
      req.setTimeout(timeoutMs ?? this._requestTimeoutMs, () => {
        req.destroy(new Error(`NeurodeskAppX ${method} ${path} timed out`));
      });
      req.on('error', reject);
      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }

  private _baseUrl: URL;
  private _token: string;
  private _networkRetries: number;
  private _retryDelayMs: number;
  private _requestTimeoutMs: number;
}
