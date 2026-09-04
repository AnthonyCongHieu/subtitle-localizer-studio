import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1 } from '../types/api';

const API_BASE = 'http://127.0.0.1:8899/api/v1';

export class StudioApiClient {
  private token: string;

  constructor(token: string = 'dev-local-token') {
    this.token = token;
  }

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listProjects(): Promise<ProjectManifestV1[]> {
    const res = await fetch(`${API_BASE}/projects`, { headers: this.headers() });
    if (!res.ok) throw new Error('Không thể tải danh sách dự án');
    return res.json();
  }

  async createProject(data: {
    title: string;
    source_video_path: string;
    source_language: string;
    target_language: string;
  }): Promise<ProjectManifestV1> {
    const res = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Lỗi khi tạo dự án mới');
    return res.json();
  }

  async getProject(projectId: string): Promise<ProjectManifestV1> {
    const res = await fetch(`${API_BASE}/projects/${projectId}`, { headers: this.headers() });
    if (!res.ok) throw new Error('Không tìm thấy dự án');
    return res.json();
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/projects/${projectId}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return res.ok;
  }

  async getCues(projectId: string): Promise<SubtitleCueV1[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/cues`, { headers: this.headers() });
    if (!res.ok) throw new Error('Không thể tải danh sách phụ đề');
    return res.json();
  }

  async saveCues(projectId: string, cues: SubtitleCueV1[]): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/cues`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(cues),
    });
    if (!res.ok) throw new Error('Không thể lưu phụ đề');
  }

  async saveRegions(projectId: string, regions: RegionTrackV1[]): Promise<RegionTrackV1[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/regions`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(regions),
    });
    if (!res.ok) throw new Error('Không thể lưu vùng nhận diện phụ đề');
    return res.json();
  }

  async runPipeline(projectId: string, options?: { max_duration_seconds?: number; sync?: boolean }): Promise<{ status: string; project_id: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/pipeline/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(options || {}),
    });
    if (!res.ok) throw new Error('Lỗi khi khởi chạy tiến trình xử lý');
    return res.json();
  }

  async getStages(projectId: string): Promise<any[]> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/stages`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tải thông tin tiến trình');
    return res.json();
  }

  async exportMp4(
    projectId: string,
    options: { use_translated: boolean; mask_mode: 'box' | 'blur' | 'none' },
  ): Promise<{ status: 'completed'; output_path: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/export/mp4`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || 'Không thể render video MP4');
    }
    return res.json();
  }

  async retranslateCue(projectId: string, cueId: string): Promise<SubtitleCueV1> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/cues/${cueId}/retranslate`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể dịch lại câu phụ đề');
    return res.json();
  }

  async autoDetectRoi(
    projectId: string,
    pts?: number,
  ): Promise<{ status: string; region: RegionTrackV1; detected_count: number }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/roi/auto-detect`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ pts }),
    });
    if (!res.ok) throw new Error('Không thể tự động phát hiện vùng chữ');
    return res.json();
  }

  async getAudioWaveform(projectId: string): Promise<{ duration: number; peaks: number[] }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/audio-waveform`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tải sóng âm thanh');
    return res.json();
  }

  async retranslateProject(projectId: string): Promise<{ status: string; cues_count: number }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/retranslate`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể dịch lại kịch bản');
    return res.json();
  }

  async setGeminiKey(apiKey: string): Promise<{ status: string; configured: boolean }> {
    const res = await fetch(`${API_BASE}/settings/gemini-key`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!res.ok) throw new Error('Lỗi cấu hình Gemini API Key');
    return res.json();
  }

  async getGeminiStatus(): Promise<{ configured: boolean; masked_key?: string }> {
    const res = await fetch(`${API_BASE}/settings/gemini-key`, {
      headers: this.headers(),
    });
    if (!res.ok) return { configured: false };
    return res.json();
  }

  async runBatchPipeline(projectIds: string[], autoExportMp4: boolean = false): Promise<any> {
    const res = await fetch(`${API_BASE}/batch/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ project_ids: projectIds, auto_export_mp4: autoExportMp4 }),
    });
    if (!res.ok) throw new Error('Lỗi chạy batch pipeline');
    return res.json();
  }

  async uploadVideo(file: File): Promise<{ path: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/projects/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: formData,
    });
    if (!res.ok) throw new Error('Không thể tải video lên máy chủ');
    return res.json();
  }

  async pickVideo(): Promise<{ path: string; filename: string }> {
    const res = await fetch(`${API_BASE}/system/pick-video`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể mở hộp thoại chọn video');
    return res.json();
  }

  getExportSrtUrl(projectId: string, useTranslated: boolean = true): string {
    return `${API_BASE}/projects/${projectId}/export/srt?use_translated=${useTranslated}`;
  }

  getExportAssUrl(projectId: string, useTranslated: boolean = true): string {
    return `${API_BASE}/projects/${projectId}/export/ass?use_translated=${useTranslated}`;
  }

  getVideoStreamUrl(projectId: string): string {
    return `${API_BASE}/projects/${projectId}/video/stream`;
  }

  getRenderedVideoUrl(projectId: string, download: boolean = false): string {
    return `${API_BASE}/projects/${projectId}/video/rendered${download ? '?download=true' : ''}`;
  }

  async runDubbing(
    projectId: string,
    voice: string = 'vi-VN-NamMinhNeural',
  ): Promise<{ status: string; project_id: string; cues_count: number; audio_url: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/dubbing/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ voice }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || 'Lỗi khi tạo thuyết minh AI');
    }
    return res.json();
  }

  getVoiceoverAudioUrl(projectId: string): string {
    return `${API_BASE}/projects/${projectId}/audio/voiceover`;
  }

  async getGeminiPoolStatus(): Promise<GeminiPoolStatus> {
    const res = await fetch(`${API_BASE}/settings/gemini-pool`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy trạng thái Gemini Key Pool');
    return res.json();
  }

  async saveGeminiPool(keys: string[]): Promise<{
    status: string;
    pool_status: GeminiPoolStatus;
  }> {
    const res = await fetch(`${API_BASE}/settings/gemini-pool`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) throw new Error('Không thể cập nhật danh sách Gemini Keys');
    return res.json();
  }

  async verifyGeminiKeys(index?: number): Promise<{
    status: string;
    result?: any;
    pool_status: GeminiPoolStatus;
  }> {
    const res = await fetch(`${API_BASE}/settings/gemini-pool/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ index: index ?? null }),
    });
    if (!res.ok) throw new Error('Không thể kiểm tra trạng thái Keys');
    return res.json();
  }

  async deleteGeminiKey(index: number): Promise<{
    status: string;
    pool_status: GeminiPoolStatus;
  }> {
    const res = await fetch(`${API_BASE}/settings/gemini-pool/key/${index}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Không thể xóa key #${index}`);
    return res.json();
  }

  async batchDeleteProjects(projectIds: string[]): Promise<{ deleted_count: number; total: number }> {
    const res = await fetch(`${API_BASE}/projects/batch-delete`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ project_ids: projectIds }),
    });
    if (!res.ok) throw new Error('Không thể xóa hàng loạt dự án');
    return res.json();
  }

  async parseDownloadTarget(target: string): Promise<DownloadTargetInfo> {
    const res = await fetch(`${API_BASE}/downloader/parse`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ target }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi phân tích liên kết' }));
      throw new Error(err.detail || 'Lỗi phân tích liên kết');
    }
    return res.json();
  }

  async startDownload(payload: {
    target_info: DownloadTargetInfo;
    episodes?: number[];
    output_dir?: string;
    start_ep?: number;
    end_ep?: number;
    auto_create_project?: boolean;
    source_language?: string;
    target_language?: string;
    proxy?: string | null;
    rate_limit_delay?: number;
    rotate_device_each_ep?: boolean;
    rotation_interval?: number;
  }): Promise<{ status: string }> {
    const res = await fetch(`${API_BASE}/downloader/start`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi khởi chạy tải video' }));
      throw new Error(err.detail || 'Lỗi khởi chạy tải video');
    }
    return res.json();
  }

  async testProxy(proxyUrl: string): Promise<{ ok: boolean; ip?: string; direct_ip?: string; is_masked?: boolean; latency_ms?: number; error?: string }> {
    const res = await fetch(`${API_BASE}/downloader/test-proxy`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ proxy: proxyUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi kiểm tra proxy' }));
      throw new Error(err.detail || 'Lỗi kiểm tra proxy');
    }
    return res.json();
  }

  async getDeviceStatus(): Promise<DeviceStatusInfo> {
    const res = await fetch(`${API_BASE}/downloader/device`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy thông tin thiết bị');
    return res.json();
  }

  async rotateDevice(proxyUrl?: string): Promise<DeviceStatusInfo> {
    const res = await fetch(`${API_BASE}/downloader/device/rotate`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ proxy: proxyUrl || null }),
    });
    if (!res.ok) throw new Error('Không thể cấp phát thiết bị mới');
    return res.json();
  }

  async saveCustomDevice(deviceId: string, installId: string, platform = 'android'): Promise<DeviceStatusInfo> {
    const res = await fetch(`${API_BASE}/downloader/device/custom`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ device_id: deviceId, install_id: installId, platform }),
    });
    if (!res.ok) throw new Error('Không thể lưu thông tin thiết bị');
    return res.json();
  }

  async getDownloadStatus(): Promise<DownloadTaskStatus> {
    const res = await fetch(`${API_BASE}/downloader/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy trạng thái tải');
    return res.json();
  }

  async cancelDownload(): Promise<{ status: string }> {
    const res = await fetch(`${API_BASE}/downloader/cancel`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể hủy tiến trình tải');
    return res.json();
  }

  // -------------------------------------------------------------------------
  // R1: Directory Validation API
  // -------------------------------------------------------------------------
  async validateDirectory(path: string, autoCreate: boolean = false): Promise<DirectoryValidateResponse> {
    const res = await fetch(`${API_BASE}/downloader/directory/validate`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ path, auto_create: autoCreate }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi kiểm tra đường dẫn thư mục' }));
      throw new Error(err.detail || 'Lỗi kiểm tra đường dẫn thư mục');
    }
    return res.json();
  }

  // -------------------------------------------------------------------------
  // R2: Episode Disk Scanning API
  // -------------------------------------------------------------------------
  async scanEpisodes(title: string, totalEpisodes: number, outputDir?: string, seriesId?: string): Promise<ScanEpisodesResponse> {
    const res = await fetch(`${API_BASE}/downloader/scan-episodes`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        title,
        total_episodes: totalEpisodes,
        output_dir: outputDir || null,
        series_id: seriesId || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi kiểm tra tập video trên ổ cứng' }));
      throw new Error(err.detail || 'Lỗi kiểm tra tập video trên ổ cứng');
    }
    return res.json();
  }

  // -------------------------------------------------------------------------
  // R3 & R4: Multi-Drama Queue Scheduler API
  // -------------------------------------------------------------------------
  async addToQueue(payload: DownloadQueueAddPayload): Promise<DownloadQueueAddResponse> {
    const res = await fetch(`${API_BASE}/downloader/queue/add`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi thêm vào hàng đợi tải' }));
      throw new Error(err.detail || 'Lỗi thêm vào hàng đợi tải');
    }
    return res.json();
  }

  async getQueueList(): Promise<DownloadQueueListResponse> {
    const res = await fetch(`${API_BASE}/downloader/queue/list`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tải danh sách hàng đợi');
    return res.json();
  }

  async pauseQueue(): Promise<DownloadQueuePauseResponse> {
    const res = await fetch(`${API_BASE}/downloader/queue/pause`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tạm dừng hàng đợi');
    return res.json();
  }

  async resumeQueue(): Promise<DownloadQueueResumeResponse> {
    const res = await fetch(`${API_BASE}/downloader/queue/resume`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tiếp tục hàng đợi');
    return res.json();
  }

  async deleteQueueTask(taskId: string): Promise<DownloadQueueDeleteResponse> {
    const res = await fetch(`${API_BASE}/downloader/queue/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể xóa tác vụ khỏi hàng đợi');
    return res.json();
  }

  async reorderQueue(taskId: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<DownloadQueueReorderResponse> {
    const res = await fetch(`${API_BASE}/downloader/queue/reorder`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ task_id: taskId, direction }),
    });
    if (!res.ok) throw new Error('Không thể thay đổi thứ tự ưu tiên trong hàng đợi');
    return res.json();
  }

  // -------------------------------------------------------------------------
  // R5: Download Cover API
  // -------------------------------------------------------------------------
  async downloadCover(
    coverUrlOrTitle: string,
    outputDirOrCoverUrl?: string,
    outputDir?: string,
    filename?: string,
    proxy?: string
  ): Promise<DownloadCoverResponse> {
    // Cho phép gọi downloadCover(coverUrl, outputDir) hoặc downloadCover(title, coverUrl, outputDir)
    let finalCoverUrl = coverUrlOrTitle;
    let finalOutputDir = outputDirOrCoverUrl || 'uploads';
    let finalFilename = filename || 'cover.jpg';
    let finalProxy = proxy;

    if (coverUrlOrTitle.startsWith('http://') || coverUrlOrTitle.startsWith('https://')) {
      finalCoverUrl = coverUrlOrTitle;
      finalOutputDir = outputDirOrCoverUrl || 'uploads';
    } else if (outputDirOrCoverUrl && (outputDirOrCoverUrl.startsWith('http://') || outputDirOrCoverUrl.startsWith('https://'))) {
      finalCoverUrl = outputDirOrCoverUrl;
      finalOutputDir = outputDir || 'uploads';
    }

    const res = await fetch(`${API_BASE}/downloader/download-cover`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        cover_url: finalCoverUrl,
        output_dir: finalOutputDir,
        filename: finalFilename,
        proxy: finalProxy || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi tải ảnh bìa phim' }));
      throw new Error(err.detail || 'Lỗi tải ảnh bìa phim');
    }
    return res.json();
  }
}

export interface DirectoryValidateResponse {
  valid: boolean;
  path: string;
  exists: boolean;
  writable: boolean;
  error?: string | null;
}

export interface EpisodeDiskStatusItem {
  episode: number;
  status: 'completed' | 'corrupted' | 'missing';
  size_bytes: number;
  filename: string;
}

export interface ScanEpisodesResponse {
  episodes: EpisodeDiskStatusItem[];
  completed_count: number;
  corrupted_count: number;
  missing_count: number;
}

export interface DownloadQueueAddPayload {
  target_info: DownloadTargetInfo | Record<string, any>;
  episodes?: number[];
  start_ep?: number;
  end_ep?: number;
  output_dir?: string;
  auto_create_project?: boolean;
  source_language?: string;
  target_language?: string;
  proxy?: string | null;
  rate_limit_delay?: number;
  rotate_device_each_ep?: boolean;
  rotation_interval?: number;
}

export interface DownloadQueueAddResponse {
  success: boolean;
  task_id: string;
  position: number;
  message: string;
}

export interface DownloadQueueTaskItem {
  task_id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  target_info: DownloadTargetInfo | Record<string, any>;
  progress_percent: number;
  speed_mbps: number;
  message: string;
  current_ep: number;
  total_eps: number;
  episodes?: number[];
  output_dir?: string;
  error?: string | null;
  created_at?: number;
}

export interface DownloadQueueListResponse {
  tasks: DownloadQueueTaskItem[];
  is_paused: boolean;
  active_task_id?: string | null;
}

export interface DownloadQueuePauseResponse {
  success: boolean;
  is_paused: boolean;
  message: string;
}

export interface DownloadQueueResumeResponse {
  success: boolean;
  is_paused: boolean;
  message: string;
}

export interface DownloadQueueDeleteResponse {
  success: boolean;
  message: string;
}

export interface DownloadQueueReorderResponse {
  success: boolean;
  tasks: string[];
  message: string;
}

export interface DownloadCoverResponse {
  success: boolean;
  file_path?: string;
  message: string;
}

export interface DeviceStatusInfo {
  device_id: string;
  install_id: string;
  platform: string;
  device_brand?: string;
  device_model?: string;
  status: 'ready' | 'unconfigured';
  server_source?: string;
  config_file?: string;
  last_updated?: string;
  message?: string;
}

export interface DownloadTargetInfo {
  platform: 'hongguo' | 'generic';
  series_id?: string;
  title: string;
  pinyin_title?: string;
  pinyin?: string;
  cover_url?: string;
  total_episodes: number;
  accessible_count?: number;
  intro?: string;
  vid_count?: number;
  url?: string;
  duration?: number;
  uploader?: string;
  ext?: string;
}

export interface DownloadTaskStatus {
  status: 'idle' | 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
  platform?: 'hongguo' | 'generic';
  title?: string;
  current_ep?: number;
  total_eps?: number;
  progress_percent?: number;
  speed_mbps?: number;
  message?: string;
  created_projects?: ProjectManifestV1[];
  error?: string | null;
}

export interface GeminiKeyItem {
  index: number;
  masked_key: string;
  is_usable: boolean;
  status: 'active' | 'cooldown' | 'daily_exhausted' | 'invalid' | 'error' | 'network_error' | 'untested';
  status_label: string;
  remaining_seconds: number;
  reason: string;
  latency_ms?: number;
  last_checked?: number;
  message?: string;
}

export interface GeminiPoolStatus {
  total_keys: number;
  active_keys: number;
  cooldown_keys: number;
  masked_keys: string[];
  cooldown_details: Record<string, { remaining_seconds: number; reason: string }>;
  items?: GeminiKeyItem[];
}

export const apiClient = new StudioApiClient();
