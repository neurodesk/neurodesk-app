/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { IOperation, OperationPhase } from './types';

const PHASE_LABELS: { [phase in OperationPhase]: string } = {
  queued: 'Waiting to start',
  resolving: 'Resolving image',
  downloading: 'Downloading image',
  preparing: 'Preparing image and kernel',
  checking: 'Checking virtual machine',
  booting: 'Booting virtual machine',
  desktop_starting: 'Starting desktop',
  window_opening: 'Opening desktop window',
  stopping: 'Stopping',
  complete: 'Complete'
};

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) {
    return `${h}h${m}m`;
  }
  if (m > 0) {
    return `${m}m${rest}s`;
  }
  return `${rest}s`;
}

export function phaseLabel(phase: OperationPhase): string {
  return PHASE_LABELS[phase] || phase;
}

/**
 * Turn an operation snapshot into a progress title and detail line.
 * Totals, rates and ETA can be null while planning is incomplete.
 */
export function formatOperationProgress(
  op: IOperation
): { title: string; detail: string } {
  const title = phaseLabel(op.phase);
  const progress = op.progress;
  if (!progress) {
    return { title, detail: '' };
  }

  const parts: string[] = [];
  if (progress.total_bytes !== null && progress.total_bytes > 0) {
    const pct = Math.min(
      100,
      Math.floor((progress.completed_bytes / progress.total_bytes) * 100)
    );
    parts.push(
      `${formatBytes(progress.completed_bytes)} / ${formatBytes(
        progress.total_bytes
      )} (${pct}%)`
    );
  } else if (progress.completed_bytes > 0) {
    parts.push(formatBytes(progress.completed_bytes));
  }
  if (progress.rate_bytes_per_second !== null) {
    parts.push(`${formatBytes(progress.rate_bytes_per_second)}/s`);
  }
  if (progress.eta_seconds !== null) {
    parts.push(`ETA ${formatDuration(progress.eta_seconds)}`);
  }
  if (!progress.planning_complete) {
    parts.push('discovering downloads');
  }

  return { title, detail: parts.join(' · ') };
}
