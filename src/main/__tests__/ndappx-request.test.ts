/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { buildVMRequest, IVMRequestParams } from '../ndappx/request';
import { stripNulls } from '../ndappx/client';

const defaults = {
  image: 'ghcr.io/tinyrange/neurodesktop-glass:latest-estargz',
  memory_mib: 4096,
  cpus: 2,
  user: 'jovyan',
  home_mode: 'persistent' as const,
  storage_path: '/tmp/x'
};

function params(overrides: Partial<IVMRequestParams> = {}): IVMRequestParams {
  return {
    imageId: 'img_1',
    imageVersion: '2026-07-11',
    storageDirectory: '/home/u/neurodesktop-storage',
    additionalDirectory: '',
    cvmfsEnabled: true,
    defaults,
    ...overrides
  };
}

describe('buildVMRequest', () => {
  it('maps storage, home, version and API defaults', () => {
    const req = buildVMRequest(params());
    expect(req).toMatchObject({
      image_id: 'img_1',
      name: 'neurodesk',
      memory_mib: 4096,
      cpus: 2,
      user: 'jovyan',
      home: { mode: 'persistent', id: 'neurodesk' },
      storage: { host_path: '/home/u/neurodesktop-storage', create: true },
      shares: [],
      env: { NEURODESKTOP_VERSION: '2026-07-11' }
    });
  });

  it('mounts the additional directory at /data', () => {
    const req = buildVMRequest(params({ additionalDirectory: '/proj' }));
    expect(req.shares).toEqual([
      { host_path: '/proj', guest_path: '/data', read_only: false }
    ]);
  });

  it('uses host-managed CVMFS when streaming, without CVMFS_DISABLE', () => {
    const req = buildVMRequest(params({ cvmfsEnabled: true }));
    expect(req.cvmfs).toEqual({ enabled: true, mirror: 'auto' });
    expect(req.env).not.toHaveProperty('CVMFS_DISABLE');
    expect(req.env).not.toHaveProperty('NEURODESKTOP_CVMFS_STARTUP_MODE');
  });

  it('disables CVMFS in download mode without host mirror options', () => {
    const req = buildVMRequest(params({ cvmfsEnabled: false }));
    expect(req.cvmfs).toEqual({ enabled: false });
    expect(req.env.CVMFS_DISABLE).toBe('true');
  });

  it('overrides memory and cpus when set', () => {
    const req = buildVMRequest(params({ memoryMib: 8192, cpus: 4 }));
    expect(req.memory_mib).toBe(8192);
    expect(req.cpus).toBe(4);
  });

  it('never emits null values or reserved env names', () => {
    const req = buildVMRequest(params({ cvmfsEnabled: false }));
    expect(JSON.stringify(req)).not.toContain('null');
    for (const key of Object.keys(req.env)) {
      expect(key).not.toMatch(/^(CCX3_|VMSH_)/);
      expect(typeof req.env[key]).toBe('string');
    }
  });
});

describe('stripNulls', () => {
  it('drops null and undefined recursively', () => {
    expect(
      stripNulls({ a: 1, b: null, c: { d: undefined, e: 'x' }, f: [1, null] })
    ).toEqual({ a: 1, c: { e: 'x' }, f: [1] });
  });
});
