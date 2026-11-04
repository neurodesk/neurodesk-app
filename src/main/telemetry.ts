import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, net } from 'electron';
import log from 'electron-log';
import { getLogFilePath, getUserHomeDir } from './utils';
import { SettingType, TelemetryConsent, userSettings } from './config/settings';
import { getNeurodesktopStoragePath } from './app';
import { SERVER_TOKEN_PREFIX } from './server';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PostHog } = require('posthog-node');

export interface ICrashReport {
  [key: string]: string | undefined;
}

const LOG_TAIL_LINES = 50;

let posthogClient: any = null;
let distinctId = '';

function getPostHogConfig(): {
  apiKey: string;
  host: string;
  apiKeySource: string;
  hostSource: string;
} {
  let packagedConfig: { apiKey?: string; host?: string } = {};
  try {
    packagedConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'telemetry-config.json'), 'utf8')
    );
  } catch {
    // The packaged configuration is absent during development and unit tests.
  }

  return {
    apiKey: process.env.POSTHOG_API_KEY || packagedConfig.apiKey || '',
    host: process.env.POSTHOG_HOST || packagedConfig.host || '',
    apiKeySource: process.env.POSTHOG_API_KEY
      ? 'environment'
      : packagedConfig.apiKey
      ? 'package'
      : 'missing',
    hostSource: process.env.POSTHOG_HOST
      ? 'environment'
      : packagedConfig.host
      ? 'package'
      : 'missing'
  };
}

function getHostOrigin(host: string): string {
  if (!host) {
    return 'missing';
  }
  try {
    return new URL(host).origin;
  } catch {
    return 'invalid';
  }
}

function getRequestEndpoint(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/batch/')) {
      return 'batch';
    }
    if (pathname.endsWith('/i/v1/analytics/events')) {
      return 'capture-v1';
    }
    return 'other';
  } catch {
    return 'invalid';
  }
}

function getNetworkErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    const nested = current as {
      code?: unknown;
      cause?: unknown;
      error?: unknown;
      errors?: unknown;
      message?: unknown;
    };
    if (typeof nested.code === 'string' && /^[A-Z0-9_]+$/.test(nested.code)) {
      return nested.code;
    }
    if (typeof nested.message === 'string') {
      const chromiumCode = /\bnet::(ERR_[A-Z0-9_]+)\b/.exec(nested.message);
      if (chromiumCode) {
        return chromiumCode[1];
      }
    }
    current =
      nested.cause ||
      nested.error ||
      (Array.isArray(nested.errors) ? nested.errors[0] : undefined);
  }
  return undefined;
}

async function loggedPostHogFetch(
  url: string,
  options: Parameters<typeof fetch>[1]
): Promise<Response> {
  const request = {
    hostOrigin: getHostOrigin(url),
    endpoint: getRequestEndpoint(url),
    compressed: new Headers(options?.headers).get('Content-Encoding') === 'gzip'
  };
  const startedAt = Date.now();
  log.info('Telemetry request started', request);
  try {
    const response = await net.fetch(url, options);
    log.info('Telemetry request completed', {
      ...request,
      status: response.status,
      durationMs: Date.now() - startedAt
    });
    return response;
  } catch (error) {
    log.warn('Telemetry request failed', {
      ...request,
      name: error instanceof Error ? error.name : 'UnknownError',
      code: getNetworkErrorCode(error),
      durationMs: Date.now() - startedAt
    });
    throw error;
  }
}

/**
 * Generate an anonymous machine ID (hash of hostname + OS, no PII).
 */
function generateDistinctId(): string {
  const raw = `${os.hostname()}-${os.platform()}-${os.arch()}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Initialize PostHog telemetry if the user has opted in.
 * Must be called early in app startup (before other imports that
 * might throw).
 */
export function initTelemetry(): void {
  const consent = userSettings.getValue(
    SettingType.telemetryConsent
  ) as TelemetryConsent;

  if (consent !== TelemetryConsent.On) {
    log.info('Telemetry disabled: consent not granted');
    return;
  }

  const { apiKey, host, apiKeySource, hostSource } = getPostHogConfig();
  log.info('Telemetry configuration', {
    apiKey: apiKey ? 'configured' : 'missing',
    apiKeySource,
    host: host ? 'configured' : 'missing',
    hostSource,
    hostOrigin: getHostOrigin(host)
  });

  if (!apiKey || !host) {
    log.warn('Telemetry disabled: PostHog configuration is incomplete');
    if (process.env.NODE_ENV === 'development') {
      if (!apiKey) {
        console.error(
          'POSTHOG_API_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_API_KEY is configured'
        );
      }
      if (!host) {
        console.error(
          'POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_HOST is configured'
        );
      }
    }
    return;
  }

  if (posthogClient) {
    return;
  }

  distinctId = generateDistinctId();

  posthogClient = new PostHog(apiKey, {
    host,
    enableExceptionAutocapture: true,
    fetch: loggedPostHogFetch
  });
  posthogClient.on('capture', (message: { event?: string }) => {
    log.info('Telemetry event queued', { event: message.event });
  });
  posthogClient.on('flush', (messages: unknown[]) => {
    log.info('Telemetry batch delivered', { count: messages.length });
  });
  posthogClient.on('error', (error: { name?: string; status?: number }) => {
    log.warn('Telemetry delivery failed', {
      name: error.name,
      status: error.status,
      code: getNetworkErrorCode(error)
    });
  });
  log.info('Telemetry initialized');
}

/**
 * Capture an exception and send it to PostHog.
 */
export function captureException(error: Error): void {
  if (
    !posthogClient ||
    userSettings.getValue(SettingType.telemetryConsent) !== TelemetryConsent.On
  ) {
    return;
  }

  const context = collectContext();
  const properties: ICrashReport = {
    $exception_message: error.message,
    $exception_stack_trace_raw: error.stack,
    $exception_type: error.name,
    engineType: context.app.engineType,
    cvmfsMode: context.app.cvmfsMode,
    platform: context.app.platform,
    arch: context.app.arch,
    osRelease: context.app.osRelease,
    electronVersion: context.app.electronVersion,
    appVersion: context.app.appVersion,
    logTail: context.logTail
  };

  if (context.launchScript) {
    properties.launchScript = context.launchScript;
  }

  const sanitized = sanitizeProperties(properties);

  posthogClient.capture({
    distinctId,
    event: '$exception',
    properties: sanitized
  });
}

/** Record a mini app chosen from the welcome screen without sending a URL or image tag. */
export function captureMiniAppSelection(
  miniAppId: string | undefined,
  launchType: 'local' | 'remote'
): void {
  if (
    !posthogClient ||
    userSettings.getValue(SettingType.telemetryConsent) !==
      TelemetryConsent.On ||
    !miniAppId ||
    !/^[a-z0-9-]{1,64}$/.test(miniAppId)
  ) {
    return;
  }

  posthogClient.capture({
    distinctId,
    event: 'mini_app_selected',
    properties: { miniAppId, launchType }
  });
}

/** Record the outcome of a local startup without file, path, or error details. */
export function captureLocalSessionStartup(
  engineType: string,
  failedSessionStartup: boolean
): void {
  if (
    !posthogClient ||
    userSettings.getValue(SettingType.telemetryConsent) !== TelemetryConsent.On
  ) {
    return;
  }

  try {
    posthogClient.capture({
      distinctId,
      event: 'local_session_started',
      properties: {
        engineType,
        operatingSystem: process.platform,
        failedSessionStartup
      }
    });
  } catch {
    // A telemetry failure must not interrupt local session startup.
  }
}

/** Record a remote session opening without its URL or token. */
export function captureRemoteSessionStarted(persistSessionData: boolean): void {
  if (
    !posthogClient ||
    userSettings.getValue(SettingType.telemetryConsent) !== TelemetryConsent.On
  ) {
    return;
  }

  posthogClient.capture({
    distinctId,
    event: 'remote_session_started',
    properties: { persistSessionData }
  });
}

/**
 * Flush pending PostHog events before the process exits.
 * Returns a promise that resolves when flush completes or times out.
 */
export async function closeTelemetry(timeoutMs = 2000): Promise<void> {
  if (!posthogClient) {
    return;
  }
  try {
    await Promise.race([
      posthogClient.shutdown(),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
    ]);
  } catch {
    // PostHog may not be initialized; ignore
  }
}

/**
 * Build the list of sensitive strings to scrub from telemetry data.
 * Exported for testing.
 */
export function buildScrubList(): string[] {
  const scrubList: string[] = [];

  const homeDir = getUserHomeDir();
  if (homeDir) {
    scrubList.push(homeDir);
  }

  const storagePath = getNeurodesktopStoragePath();
  if (storagePath && storagePath !== homeDir) {
    scrubList.push(storagePath);
  }

  const workingDir = userSettings.getValue(
    SettingType.defaultWorkingDirectory
  ) as string;
  if (workingDir && workingDir !== homeDir && workingDir !== storagePath) {
    scrubList.push(workingDir);
  }

  return scrubList;
}

/**
 * Scrub a single string of sensitive data.
 * Exported for testing.
 */
export function scrubString(
  input: string | undefined,
  sensitiveStrings: string[]
): string | undefined {
  if (!input) {
    return input;
  }

  let result = input;

  // Replace sensitive path strings with placeholders
  for (const sensitive of sensitiveStrings) {
    if (sensitive) {
      result = result.split(sensitive).join('~');
    }
  }

  // Strip server tokens (jlab:srvr:...)
  result = result.replace(
    new RegExp(escapeRegExp(SERVER_TOKEN_PREFIX) + '[a-zA-Z0-9_-]+', 'g'),
    '<token>'
  );

  // Strip ServerApp.token='...' from launch args
  result = result.replace(
    /--ServerApp\.token='[^']*'/g,
    "--ServerApp.token='<token>'"
  );

  // Strip env var values in KEY=VALUE patterns (keep key)
  // This catches -e KEY=value in Docker commands
  result = result.replace(
    /-e\s+(\w+)=("[^"]*"|'[^']*'|\S+)/g,
    '-e $1=<redacted>'
  );

  return result;
}

/**
 * Sanitize a flat properties object before it leaves the machine.
 * Removes home directory paths, server tokens, env var values,
 * storage/working directory paths, and ServerApp.token values.
 *
 * Pure function (given a stable scrub list) for testability.
 * Exported for testing.
 */
export function sanitizeProperties(
  properties: ICrashReport,
  scrubList?: string[]
): ICrashReport {
  const sensitiveStrings = scrubList ?? buildScrubList();
  const result: ICrashReport = {};

  for (const key of Object.keys(properties)) {
    if (typeof properties[key] === 'string') {
      result[key] = scrubString(properties[key], sensitiveStrings);
    } else {
      result[key] = properties[key];
    }
  }

  return result;
}

/**
 * Collect context to attach to crash reports.
 * Exported for testing.
 */
export function collectContext(): {
  app: Record<string, string>;
  logTail: string;
  launchScript?: string;
} {
  const engineType = userSettings.getValue(SettingType.engineType) as string;
  const cvmfsMode = userSettings.getValue(SettingType.cvmfsMode) as string;

  const appContext: Record<string, string> = {
    engineType,
    cvmfsMode,
    platform: process.platform,
    arch: String(os.arch()),
    osRelease: os.release(),
    electronVersion: process.versions.electron || 'unknown',
    appVersion: app.getVersion()
  };

  const logTail = readLogTail();

  return {
    app: appContext,
    logTail
  };
}

/**
 * Read the last N lines of the main process log file.
 */
function readLogTail(): string {
  try {
    const logPath = getLogFilePath('main');
    if (!fs.existsSync(logPath)) {
      // Try the rotated log file
      const rotatedPath = logPath.replace('.log', '.old.log');
      if (!fs.existsSync(rotatedPath)) {
        return '';
      }
      return tailFile(rotatedPath, LOG_TAIL_LINES);
    }
    return tailFile(logPath, LOG_TAIL_LINES);
  } catch {
    return '';
  }
}

function tailFile(filePath: string, lines: number): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
