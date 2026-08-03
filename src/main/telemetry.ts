import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';
import { getLogFilePath, getUserHomeDir } from './utils';
import { SettingType, TelemetryConsent, userSettings } from './config/settings';
import { getNeurodesktopStoragePath } from './app';
import { SERVER_TOKEN_PREFIX } from './server';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PostHog } = require('posthog-node');

export interface ICrashReport {
  [key: string]: string | undefined;
}

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || '';
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';
const LOG_TAIL_LINES = 50;

let posthogClient: any = null;
let distinctId = '';

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
    return;
  }

  if (!POSTHOG_API_KEY) {
    return;
  }

  distinctId = generateDistinctId();

  posthogClient = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST
  });

  // Capture uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error: Error) => {
    captureException(error);
  });

  process.on('unhandledRejection', (reason: any) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    captureException(error);
  });
}

/**
 * Capture an exception and send it to PostHog.
 */
export function captureException(error: Error): void {
  if (!posthogClient) {
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
