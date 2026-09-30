/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import {
  formatBytes,
  formatDuration,
  formatOperationProgress
} from '../ndappx/progress';
import { IOperation } from '../ndappx/types';

function op(progress: Partial<IOperation['progress']> | null): IOperation {
  return {
    operation_id: 'op_1',
    kind: 'image_pull',
    resource_id: null,
    state: 'running',
    phase: 'downloading',
    progress:
      progress === null
        ? null
        : {
            updated_at: '2026-09-30T00:00:00Z',
            completed_bytes: 0,
            total_bytes: null,
            rate_bytes_per_second: null,
            eta_seconds: null,
            planning_complete: true,
            artifacts: [],
            ...progress
          },
    created_at: '2026-09-30T00:00:00Z',
    finished_at: null,
    result: null,
    error: null
  };
}

describe('ndappx progress formatting', () => {
  it('formats bytes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_200_000_000)).toBe('1.2 GB');
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(90)).toBe('1m30s');
    expect(formatDuration(3720)).toBe('1h2m');
  });

  it('shows totals, rate and ETA when known', () => {
    const { title, detail } = formatOperationProgress(
      op({
        completed_bytes: 1_200_000_000,
        total_bytes: 3_400_000_000,
        rate_bytes_per_second: 25_000_000,
        eta_seconds: 90
      })
    );
    expect(title).toBe('Downloading image');
    expect(detail).toBe('1.2 GB / 3.4 GB (35%) · 25.0 MB/s · ETA 1m30s');
  });

  it('handles null totals, rate and ETA', () => {
    const { detail } = formatOperationProgress(
      op({ completed_bytes: 2000, planning_complete: false })
    );
    expect(detail).toBe('2.0 KB · discovering downloads');
  });

  it('handles operations without progress', () => {
    const o = op(null);
    o.phase = 'booting';
    expect(formatOperationProgress(o)).toEqual({
      title: 'Booting virtual machine',
      detail: ''
    });
  });
});
