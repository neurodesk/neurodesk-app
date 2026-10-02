/* eslint-disable camelcase -- field names follow the NeurodeskAppX HTTP API */
// Types for the NeurodeskAppX headless API (api_version 1).
// Source of truth: crumblecracker docs/headless.openapi.json.

export const NDAPPX_PROTOCOL = 'ndappx';
export const NDAPPX_API_VERSION = 1;

export interface IReadiness {
  event: 'ready';
  protocol: 'ndappx';
  api_version: 1;
  base_url: string;
  token: string;
  pid: number;
}

export interface IApiError {
  code: string;
  message: string;
  details: { [key: string]: unknown };
  retryable: boolean;
}

export interface IInfo {
  protocol: 'ndappx';
  api_version: 1;
  version: string;
  state: 'ready' | 'shutting_down';
  platform: { os: string; arch: string };
  capabilities: {
    max_active_vms: 1;
    native_glass: boolean;
    gpu_acceleration: boolean;
  };
  defaults: {
    image: string;
    memory_mib: number;
    cpus: number;
    user: string;
    home_mode: 'persistent';
    storage_path: string;
  };
}

export type VirtualizationReasonCode =
  | 'unsupported_platform'
  | 'permission_denied'
  | 'virtualization_disabled'
  | 'hypervisor_unavailable'
  | 'probe_failed';

export interface IVirtualization {
  supported: boolean;
  accessible: boolean;
  backend: 'hvf' | 'kvm' | 'whp' | 'none';
  reason: { code: VirtualizationReasonCode; message: string } | null;
}

export interface IPullRequest {
  reference: string;
  platform?: 'linux/arm64' | 'linux/amd64';
  policy?: 'if_missing' | 'refresh';
  timeout_seconds?: number;
}

export interface IVMRequest {
  image_id: string;
  name?: string;
  memory_mib?: number;
  cpus?: number;
  user?: string;
  home?: { mode?: 'persistent' | 'ephemeral'; id?: string };
  storage?: { host_path: string; create?: boolean };
  shares?: { host_path: string; guest_path: string; read_only?: boolean }[];
  network?: { enabled?: boolean; allow_internet?: boolean };
  display?: { width?: number; height?: number; gpu_acceleration?: boolean };
  cvmfs?: { enabled?: boolean; mirror?: string; cache_limit_bytes?: number };
  boot_timeout_seconds?: number;
  env?: { [key: string]: string };
}

export interface IGlassRequest {
  title?: string;
  width?: number;
  height?: number;
  timeout_seconds?: number;
}

export interface IGlass {
  glass_id: string;
  state: 'starting' | 'open' | 'closed' | 'failed';
  title: string;
  width: number;
  height: number;
}

export interface IKernel {
  kernel_id: string;
  version: string;
  platform: string;
  cache_hit: boolean;
}

export interface IImage {
  image_id: string;
  reference: string;
  digest: string;
  platform: string;
  cache_hit: boolean;
  kernel: IKernel;
}

export interface IVMResult {
  vm_id: string;
  state: 'running' | 'stopped';
}

export type VMState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface IVM {
  vm_id: string;
  name: string;
  image_id: string;
  state: VMState;
  config: IVMRequest;
  glass: IGlass | null;
  active_operation_id: string | null;
  last_error: IApiError | null;
}

export type OperationKind =
  | 'image_pull'
  | 'vm_start'
  | 'glass_spawn'
  | 'vm_stop';

export type OperationState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type OperationPhase =
  | 'queued'
  | 'resolving'
  | 'downloading'
  | 'preparing'
  | 'checking'
  | 'booting'
  | 'desktop_starting'
  | 'window_opening'
  | 'stopping'
  | 'complete';

export interface IAcceptance {
  operation_id: string;
  kind: OperationKind;
  state: 'queued';
  resource_id: string | null;
}

export interface IArtifact {
  artifact_id: string;
  kind:
    | 'image_manifest'
    | 'image_config'
    | 'image_layer'
    | 'kernel'
    | 'kernel_module'
    | 'dependency';
  name: string;
  reference: string;
  digest: string | null;
  state: string;
  completed_bytes: number;
  total_bytes: number | null;
  rate_bytes_per_second: number | null;
  eta_seconds: number | null;
  attempt: number;
  error: IApiError | null;
}

export interface IProgress {
  updated_at: string;
  completed_bytes: number;
  total_bytes: number | null;
  rate_bytes_per_second: number | null;
  eta_seconds: number | null;
  planning_complete: boolean;
  artifacts: IArtifact[];
}

export interface IOperation {
  operation_id: string;
  kind: OperationKind;
  resource_id: string | null;
  state: OperationState;
  phase: OperationPhase;
  progress: IProgress | null;
  created_at: string;
  finished_at: string | null;
  result: IImage | IVMResult | IGlass | null;
  error: IApiError | null;
}

export interface IShutdown {
  state: 'stopped';
}
