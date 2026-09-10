import { SubtitleCueV1 } from '../../types/api';

export type AdminTabId = 'overview' | 'workers' | 'jobs' | 'downloads';

export interface WorkerEngineOverride {
  worker_id: string;
  is_custom: boolean; // false = kế thừa từ Setting Tổng, true = tùy biến riêng
  assigned_roles: {
    ocr: boolean;
    transcribe: boolean;
    translate: boolean;
    dubbing: boolean;
    downloader: boolean;
  };
  gpu_device_id?: number;
  batch_size?: number;
  concurrency_slots?: number;
  notes?: string;
  updated_at?: number;
}

export interface MockSimulationState {
  enabled: boolean;
  simulatedProgress: Record<string, number>;
  simulatedStages: Record<string, string>;
}

export interface VideoPreviewTarget {
  job_id: string;
  project_id?: string;
  title: string;
  video_url: string;
  duration?: number;
  cues?: SubtitleCueV1[];
  stage?: string;
  status?: string;
  metrics?: Record<string, unknown>;
  worker_id?: string;
}
