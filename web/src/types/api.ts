export type SubtitleCueStatus = 'auto' | 'reviewed' | 'locked';

export interface SubtitleCueV1 {
  cue_id: string;
  start_pts: number;
  end_pts: number;
  source_text: string;
  translated_text: string;
  style?: Record<string, any>;
  region_id?: string | null;
  quality_flags?: string[];
  confidence: number;
  revision: number;
  status: SubtitleCueStatus;
  schema_version?: string;
}

export interface RegionTrackV1 {
  region_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mask_enabled?: boolean;
  /** dialogue | ignore | always_mask */
  role?: string;
  valid_start_pts?: number;
  valid_end_pts?: number;
  keyframe_overrides?: Record<number, Record<string, number>>;
  schema_version?: string;
}

export interface ProjectManifestV1 {
  project_id: string;
  title: string;
  source_video_path: string;
  video_fingerprint: string;
  source_language: string;
  target_language: string;
  active_revision: number;
  media_metadata?: Record<string, any>;
  duration?: number;
  source_video_resolved_path?: string;
  model_selections?: Record<string, string>;
  regions?: RegionTrackV1[];
  cues_count?: number;
  translated_count?: number;
  first_cue_text?: string;
  first_cue_original?: string;
  has_voiceover?: boolean;
  voiceover_path?: string | null;
  voiceover_file_size_bytes?: number;
  has_export?: boolean;
  export_path?: string | null;
  export_file_size_bytes?: number;
  export_verified?: boolean;
  style?: Record<string, any>;
  output_presets?: Record<string, any>;
  custom_pipeline_settings?: Record<string, any>;
  created_at: number;
  updated_at: number;
  schema_version?: string;
}

export interface BridgeEventV1 {
  event_id: string;
  sequence: number;
  project_id: string;
  job_id?: string | null;
  event_type: string;
  payload: Record<string, any>;
  timestamp: number;
  schema_version?: string;
}

export interface StageRunV1 {
  stage_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  metrics?: Record<string, any>;
  errors?: string[];
  start_time: number;
  end_time?: number | null;
}

// Pipeline settings are declared in api/client.ts for backwards compatibility
// with existing imports.  Re-export the contract from this shared type module
// so consumers can depend on API schemas without importing the HTTP client.
// `export type` keeps this cycle type-only and emits no runtime dependency.
export type {
  ExtractionMethod,
  ExtractionSettings,
  GlobalPipelineSettings,
  HardwareInfoResponse,
  HardwareTuningMode,
  OcrBackend,
  OcrPerformanceProfile,
  OcrSettings,
  PpOcrModelTier,
} from '../api/client';

export type LanWorkerStatus = 'online' | 'offline' | 'draining' | 'disabled' | string;
export interface LanWorker {
  worker_id: string;
  hostname?: string; ip_address?: string; platform?: string;
  app_version?: string; model_version?: string; gpu_name?: string; vram_mb?: number;
  capabilities?: Record<string, boolean | string | number | null>;
  status?: LanWorkerStatus; is_online?: boolean; last_seen?: number | string;
  active_job_id?: string | null; queue_depth?: number; last_error?: string | null;
}

export type LanJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
export interface LanJob {
  job_id: string; project_id?: string; worker_id?: string; job_type?: string;
  status?: LanJobStatus; profile?: string; video_fingerprint?: string;
  progress?: number; stage?: string; current_stage?: string;
  attempt?: number; max_attempts?: number; lease_id?: string; lease_expires_at?: number | string;
  metrics?: Record<string, unknown>; error?: string | null;
  created_at?: number | string; updated_at?: number | string;
}

export type LanDownloadStatus = 'requested' | 'preview_ready' | 'approved' | 'rejected' | 'downloading' | 'downloaded' | 'failed' | 'cancelled' | string;
export interface LanDownload {
  request_id: string; worker_id?: string; source?: string; title?: string;
  thumbnail_url?: string; duration_seconds?: number; size_bytes?: number;
  status?: LanDownloadStatus; created_at?: number | string; decided_at?: number | string | null;
  progress?: number; error?: string | null;
}

export interface LanOverview {
  workers: LanWorker[]; jobs: LanJob[]; downloads: LanDownload[];
  worker_count: number; online_worker_count: number; running_job_count: number;
  queue_depth: number; failed_job_count: number; pending_download_count: number;
  fetched_at: number;
}
