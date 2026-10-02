/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
import { IInfo, IVMRequest } from './types';

export const NDAPPX_VM_NAME = 'neurodesk';
export const NDAPPX_HOME_ID = 'neurodesk';

export interface IVMRequestParams {
  imageId: string;
  /** Image version picked in the welcome view (e.g. 2026-07-11). */
  imageVersion: string;
  storageDirectory: string;
  /** Host directory mounted at /data, already resolved; '' for none. */
  additionalDirectory: string;
  /**
   * Stream tools from CVMFS (CvmfsMode.Stream). False matches
   * CvmfsMode.Download, which disables CVMFS in the guest.
   */
  cvmfsEnabled: boolean;
  defaults: IInfo['defaults'];
  /** 0/undefined means use the API default. */
  memoryMib?: number;
  cpus?: number;
}

/**
 * Build the POST /v1/vms body from app settings. Pure: no fs or Electron.
 */
export function buildVMRequest(params: IVMRequestParams): IVMRequest {
  const env: { [key: string]: string } = {
    NEURODESKTOP_VERSION: params.imageVersion
  };

  // Streaming uses host-managed CVMFS, which the API recommends; it supplies
  // CVMFS_DISABLE itself, so it must not be set here.
  const cvmfsEnabled = params.cvmfsEnabled;
  if (!cvmfsEnabled) {
    env.CVMFS_DISABLE = 'true';
  }

  const req: IVMRequest = {
    image_id: params.imageId,
    name: NDAPPX_VM_NAME,
    memory_mib: params.memoryMib || params.defaults.memory_mib,
    cpus: params.cpus || params.defaults.cpus,
    user: params.defaults.user,
    home: { mode: 'persistent', id: NDAPPX_HOME_ID },
    storage: { host_path: params.storageDirectory, create: true },
    shares: [],
    network: { enabled: true, allow_internet: true },
    cvmfs: cvmfsEnabled
      ? { enabled: true, mirror: 'auto' }
      : { enabled: false },
    env
  };

  if (params.additionalDirectory) {
    req.shares.push({
      host_path: params.additionalDirectory,
      guest_path: '/data',
      read_only: false
    });
  }

  return req;
}
