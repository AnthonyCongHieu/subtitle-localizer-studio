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
  model_selections?: Record<string, string>;
  regions?: RegionTrackV1[];
  cues_count?: number;
  translated_count?: number;
  first_cue_text?: string;
  first_cue_original?: string;
  has_voiceover?: boolean;
  has_export?: boolean;
  style?: Record<string, any>;
  output_presets?: Record<string, any>;
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
