import {
  LanDownload,
  LanJob,
  LanOverview,
  LanWorker,
  ProjectManifestV1,
  RegionTrackV1,
  SubtitleCueV1,
} from '../types/api';

export class StudioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'StudioApiError';
  }
}

// Resolve the API from the page origin so a browser on another LAN machine
// talks to the host that served the UI (localhost must only be the dev fallback).
export function getApiBase(): string {
  const configured = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_API_BASE;
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const port = window.location.port === '5199' ? '8899' : window.location.port;
    const origin = `${window.location.protocol}//${window.location.hostname}${port ? `:${port}` : ''}`;
    return `${origin}/api/v1`;
  }
  return 'http://127.0.0.1:8899/api/v1';
}

const API_BASE = getApiBase();

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

  private async adminRequest<T>(path: string, init?: RequestInit, fallback = 'Yêu cầu quản trị LAN thất bại'): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...this.headers(), ...init?.headers } });
    } catch (error) {
      throw new StudioApiError('Không thể kết nối máy chủ điều phối LAN', 0, 'network_error', error);
    }
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { detail?: unknown; code?: string } | null;
      const detail = typeof payload?.detail === 'string' ? payload.detail : fallback;
      throw new StudioApiError(detail, res.status, payload?.code, payload?.detail);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
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
    media_items?: Array<{ source_video_path: string }>;
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

  sanitizeRegions(regions: RegionTrackV1[]): RegionTrackV1[] {
    return regions.map((r) => {
      const rx = Number(r.x) || 0;
      const ry = Number(r.y) || 0;
      const rw = Number(r.width) || 0.1;
      const rh = Number(r.height) || 0.1;

      const x1 = Math.max(0.0, Math.min(0.99, rx));
      const y1 = Math.max(0.0, Math.min(0.99, ry));
      const x2 = Math.max(x1 + 0.01, Math.min(1.0, rx + rw));
      const y2 = Math.max(y1 + 0.01, Math.min(1.0, ry + rh));

      return {
        ...r,
        x: Math.round(x1 * 10000) / 10000,
        y: Math.round(y1 * 10000) / 10000,
        width: Math.round((x2 - x1) * 10000) / 10000,
        height: Math.round((y2 - y1) * 10000) / 10000,
      };
    });
  }

  async saveRegions(projectId: string, regions: RegionTrackV1[]): Promise<RegionTrackV1[]> {
    // Tự động kẹp tọa độ trong phạm vi hợp lệ [0.0, 1.0] để người dùng trên Web UI có thể kéo ra ngoài mép khung hình
    // mà khi lưu xuống backend API vẫn tuân thủ chặt chẽ schema kiểm tra không bị lỗi 422
    const sanitizedRegions = this.sanitizeRegions(regions);

    const res = await fetch(`${API_BASE}/projects/${projectId}/regions`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(sanitizedRegions),
    });
    if (!res.ok) throw new Error('Không thể lưu vùng nhận diện phụ đề');
    return res.json();
  }

  async getProjectSettings(projectId: string): Promise<Record<string, any>> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/settings`, { headers: this.headers() });
    if (!res.ok) throw new Error('Không thể tải cài đặt riêng của dự án');
    return res.json();
  }

  async saveProjectSettings(projectId: string, settings: Record<string, any>): Promise<{ status: string; custom_pipeline_settings: Record<string, any> }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/settings`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Không thể lưu cài đặt riêng cho dự án');
    return res.json();
  }

  async resetProjectSettings(projectId: string): Promise<{ status: string; custom_pipeline_settings: null }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/settings`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể khôi phục cài đặt mặc định');
    return res.json();
  }

  async saveEditorState(
    projectId: string,
    payload: { regions?: RegionTrackV1[]; settings?: Record<string, any> }
  ): Promise<{ status: string; project_id: string; revision?: number; regions?: RegionTrackV1[]; settings?: any }> {
    const body: Record<string, any> = {};
    if (payload.regions) {
      body.regions = this.sanitizeRegions(payload.regions);
    }
    if (payload.settings !== undefined) {
      body.settings = payload.settings;
    }
    const res = await fetch(`${API_BASE}/projects/${projectId}/editor-state`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Không thể lưu trạng thái editor');
    }
    return res.json();
  }

  async runPipeline(projectId: string, options?: { max_duration_seconds?: number; sync?: boolean; ocr_only?: boolean }): Promise<{ status: string; project_id: string; ocr_only?: boolean }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/pipeline/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(options || {}),
    });
    if (!res.ok) throw new Error('Lỗi khi khởi chạy tiến trình xử lý');
    return res.json();
  }

  async stopPipeline(projectId: string): Promise<{ status: string; project_id: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/pipeline/stop`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể dừng tiến trình xử lý');
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
    options: {
      use_translated?: boolean;
      mask_mode?: string;
      flip_h?: boolean;
      flip_v?: boolean;
      video_x?: number;
      video_y?: number;
      video_scale?: number;
      rotation?: number;
      regions?: RegionTrackV1[];
      subtitle_placement?: string;
      blur_strength?: number;
      export_format?: 'mp4' | 'mkv';
      export_resolution?: 'original' | '1080p' | '720p' | '2k';
      export_aspect_ratio?: 'original' | '9:16' | '16:9';
    },
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

  async retranslateProject(projectId: string, target_language?: 'vi' | 'en' | 'zh' | 'none'): Promise<{ status: string; cues_count: number }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/retranslate`, {
      method: 'POST',
      headers: this.headers(),
      body: target_language ? JSON.stringify({ target_language }) : undefined,
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

  async mergeProjectExports(projectId: string): Promise<{ status: string; output_path: string; item_count: number }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/merge-export`, { method: 'POST', headers: this.headers() });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || 'Không thể ghép các video đã xuất');
    }
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

  async pickMultipleVideos(): Promise<{ files: Array<{ path: string; filename: string }> }> {
    const res = await fetch(`${API_BASE}/system/pick-multiple-videos`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể mở hộp thoại chọn nhiều video');
    return res.json();
  }

  async pickFolder(): Promise<{ files: Array<{ path: string; filename: string }> }> {
    const res = await fetch(`${API_BASE}/system/pick-folder`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể mở hộp thoại chọn thư mục');
    return res.json();
  }

  async batchCreateProjects(items: Array<{
    title: string;
    source_video_path: string;
    source_language: string;
    target_language: string;
  }>, regions?: any[], folder_groups?: Array<{ title: string; videos: string[]; source_language?: string; target_language?: string }>): Promise<ProjectManifestV1[]> {
    const res = await fetch(`${API_BASE}/projects/batch-create`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ items, regions, folder_groups }),
    });
    if (!res.ok) throw new Error('Không thể tạo hàng loạt dự án');
    return res.json();
  }

  getExportSrtUrl(projectId: string, useTranslated: boolean = true): string {
    return `${API_BASE}/projects/${projectId}/export/srt?use_translated=${useTranslated}`;
  }

  getExportAssUrl(projectId: string, useTranslated: boolean = true): string {
    return `${API_BASE}/projects/${projectId}/export/ass?use_translated=${useTranslated}`;
  }

  getVideoStreamUrl(projectId: string, quality: string = 'original'): string {
    const qParam = quality && quality !== 'original' ? `?quality=${encodeURIComponent(quality)}` : '';
    return `${API_BASE}/projects/${projectId}/video/stream${qParam}`;
  }

  getRenderedVideoUrl(projectId: string, download: boolean = false): string {
    return `${API_BASE}/projects/${projectId}/video/rendered${download ? '?download=true' : ''}`;
  }

  async revealProjectExport(projectId: string): Promise<{ success: boolean; path: string; error?: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/reveal-export`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể mở thư mục xuất file');
    return res.json();
  }

  async runDubbing(
    projectId: string,
    voiceOrOptions?: string | {
      voice?: string;
      rate?: string;
      mode?: string;
      provider?: string;
      voice_male?: string;
      voice_female?: string;
      prompt_style?: string;
    },
  ): Promise<{ status: string; project_id: string; cues_count: number; audio_url: string }> {
    const payload = typeof voiceOrOptions === 'string'
      ? { voice: voiceOrOptions }
      : (voiceOrOptions || { voice: 'vi-VN-NamMinhNeural' });
    const res = await fetch(`${API_BASE}/projects/${projectId}/dubbing/run`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || 'Lỗi khi tạo thuyết minh AI');
    }
    return res.json();
  }

  async adaptSpoken(
    projectId: string,
    options?: { cue_id?: string; mode?: string; rate?: string; force?: boolean }
  ): Promise<{ status: string; adapted_count: number; warned_count: number; required_voices: number; cues_count: number; mode: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/dubbing/adapt-spoken`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(options || {}),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || 'Lỗi khi rút gọn lời đọc theo thời lượng');
    }
    return res.json();
  }

  getVoiceoverAudioUrl(projectId: string): string {
    return `${API_BASE}/projects/${projectId}/audio/voiceover`;
  }

  async dubSingleCue(
    projectId: string,
    cueId: string,
    options?: { voice?: string; rate?: string; provider?: string }
  ): Promise<{ status: string; cue_id: string; voice: string; duration: number; cue_audio_url: string; audio_url: string }> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/cues/${cueId}/dub`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(options || {}),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || 'Lỗi khi lồng tiếng câu phụ đề');
    }
    return res.json();
  }

  getCueAudioUrl(projectId: string, cueId: string): string {
    return `${API_BASE}/projects/${projectId}/cues/${cueId}/audio`;
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

  async getGroqPoolStatus(): Promise<GroqPoolStatus> {
    const res = await fetch(`${API_BASE}/settings/groq-pool`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy trạng thái Groq Key Pool');
    return res.json();
  }

  async saveGroqPool(keys: string[]): Promise<{
    status: string;
    pool_status: GroqPoolStatus;
  }> {
    const res = await fetch(`${API_BASE}/settings/groq-pool`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) throw new Error('Không thể cập nhật danh sách Groq Keys');
    return res.json();
  }

  async verifyGroqKeys(index?: number): Promise<{
    status: string;
    result?: any;
    pool_status: GroqPoolStatus;
  }> {
    const res = await fetch(`${API_BASE}/settings/groq-pool/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ index: index ?? null }),
    });
    if (!res.ok) throw new Error('Không thể kiểm tra trạng thái Groq Keys');
    return res.json();
  }

  async deleteGroqKey(index: number): Promise<{
    status: string;
    pool_status: GroqPoolStatus;
  }> {
    const res = await fetch(`${API_BASE}/settings/groq-pool/key/${index}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Không thể xóa Groq key #${index}`);
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
    proxy_list?: string[];
    strict_proxy?: boolean;
    cdn_direct_bypass?: boolean;
    rate_limit_delay?: number;
    rotate_device_each_ep?: boolean;
    rotation_interval?: number;
    target_resolution?: string;
    concurrency?: number;
    cookie_source?: string;
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

  async testProxy(proxyUrl: string): Promise<{ ok: boolean; ip?: string; direct_ip?: string; is_masked?: boolean; latency_ms?: number; error?: string; note?: string; is_standby?: boolean }> {
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

  async getProxyStatus(proxyUrl?: string): Promise<ProxyStatusResponse> {
    const query = proxyUrl ? `?proxy_url=${encodeURIComponent(proxyUrl)}` : '';
    const res = await fetch(`${API_BASE}/downloader/proxy/status${query}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể kiểm tra trạng thái proxy');
    return res.json();
  }

  async getProxyPoolStatus(): Promise<ProxyPoolStatusResponse> {
    const res = await fetch(`${API_BASE}/downloader/proxy/pool`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy thông tin proxy pool');
    return res.json();
  }

  async getXrayStatus(): Promise<XrayStatusResponse> {
    const res = await fetch(`${API_BASE}/downloader/xray/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy trạng thái Xray Core');
    return res.json();
  }

  async refreshXrayNodes(customFeed?: string, maxLatencyMs?: number): Promise<XrayStatusResponse> {
    const res = await fetch(`${API_BASE}/downloader/xray/refresh`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        custom_feed_or_nodes: customFeed || null,
        max_latency_ms: maxLatencyMs || 800.0,
      }),
    });
    if (!res.ok) throw new Error('Không thể làm mới danh sách node Xray');
    return res.json();
  }

  async toggleXray(enabled: boolean): Promise<{ success: boolean; is_enabled: boolean; status: XrayStatusResponse }> {
    const res = await fetch(`${API_BASE}/downloader/xray/toggle`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error('Không thể chuyển đổi trạng thái Xray');
    return res.json();
  }

  async switchXrayNode(nodeName: string): Promise<{ success: boolean; status: XrayStatusResponse }> {
    const res = await fetch(`${API_BASE}/downloader/xray/switch`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ node_name: nodeName }),
    });
    if (!res.ok) throw new Error(`Không thể chuyển sang node ${nodeName}`);
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

  async retryQueueTask(taskId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/downloader/queue/${encodeURIComponent(taskId)}/retry`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể thử lại tác vụ');
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

  // -------------------------------------------------------------------------
  // Platform Authentication, QR Login & Video Search API
  // -------------------------------------------------------------------------
  async getPlatformAuthStatus(): Promise<PlatformAuthStatusResponse> {
    const res = await fetch(`${API_BASE}/downloader/auth/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể lấy trạng thái xác thực nền tảng');
    return res.json();
  }

  async generateBilibiliQr(): Promise<BilibiliQrGenResponse> {
    const res = await fetch(`${API_BASE}/downloader/auth/bilibili/qr/generate`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tạo mã QR Bilibili');
    return res.json();
  }

  async pollBilibiliQr(qrcodeKey: string): Promise<BilibiliQrPollResponse> {
    const res = await fetch(`${API_BASE}/downloader/auth/bilibili/qr/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể kiểm tra trạng thái quét QR');
    return res.json();
  }

  async savePlatformCookie(platform: string, cookie: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/downloader/auth/cookies`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ platform, cookie }),
    });
    if (!res.ok) throw new Error('Không thể lưu cookie');
    return res.json();
  }

  async deletePlatformCookie(platform: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/downloader/auth/cookies/${encodeURIComponent(platform)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể xóa cookie');
    return res.json();
  }

  async searchVideos(
    keyword: string,
    platform: string = 'bilibili',
    page: number = 1,
    options?: VideoSearchOptions,
  ): Promise<VideoSearchResponse> {
    const res = await fetch(`${API_BASE}/downloader/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        keyword,
        platform,
        page,
        order: options?.order || 'totalrank',
        duration: options?.duration || 0,
        must_contain: options?.must_contain || undefined,
        must_not_contain: options?.must_not_contain || undefined,
        auto_translate: options?.auto_translate ?? true,
        translate_titles: options?.translate_titles ?? true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Lỗi tìm kiếm video' }));
      throw new Error(err.detail || 'Lỗi tìm kiếm video');
    }
    return res.json();
  }

  async clearDownloadHistory(): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${API_BASE}/downloader/history/clear`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể xóa lịch sử tải xuống');
    return res.json();
  }

  // -------------------------------------------------------------------------
  // Pipeline Settings & Live Test Endpoints
  // -------------------------------------------------------------------------
  async getPipelineSettings(): Promise<GlobalPipelineSettings> {
    const res = await fetch(`${API_BASE}/settings/pipeline`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tải cấu hình Pipeline');
    return res.json();
  }

  async savePipelineSettings(settings: GlobalPipelineSettings): Promise<{ status: string; settings: GlobalPipelineSettings }> {
    const res = await fetch(`${API_BASE}/settings/pipeline`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Không thể lưu cấu hình Pipeline');
    return res.json();
  }

  async getHardwareInfo(): Promise<HardwareInfoResponse> {
    const res = await fetch(`${API_BASE}/settings/hardware-check`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể kiểm tra phần cứng');
    return res.json();
  }

  async testTranslation(req: {
    text: string;
    source_lang?: string;
    target_lang?: string;
    provider?: string;
    gemini_model?: string;
    local_model?: string;
    local_endpoint?: string;
    auto_fallback?: boolean;
    prompt_tone?: string;
    use_glossary?: boolean;
  }): Promise<TestTranslationResult> {
    const res = await fetch(`${API_BASE}/settings/test-translation`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error('Lỗi khi kiểm tra dịch thử');
    return res.json();
  }

  async testLocalLlmConnection(req?: {
    endpoint?: string;
    model?: string;
  }): Promise<{
    ok: boolean;
    latency_ms: number;
    message: string;
    models: string[];
    has_target_model: boolean;
  }> {
    const res = await fetch(`${API_BASE}/settings/local-llm-check`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req || {}),
    });
    if (!res.ok) throw new Error('Không thể kết nối API kiểm tra Local LLM');
    return res.json();
  }

  async startLocalLlm(): Promise<{
    ok: boolean;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/settings/local-llm-start`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể khởi động Local LLM');
    return res.json();
  }


  async testDubbing(req: {
    text: string;
    provider?: string;
    voice?: string;
    rate?: string;
    pitch?: string;
    prompt_style?: string;
  }): Promise<Blob> {
    const res = await fetch(`${API_BASE}/settings/test-tts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error('Lỗi khi tạo giọng đọc thử nghiệm');
    return res.blob();
  }

  async getTTSCatalog(): Promise<Record<string, Array<{
    voice_id: string;
    display_name: string;
    lang: string;
    gender: string;
    description: string;
    tags: string[];
    resource_id?: string;
  }>>> {
    const res = await fetch(`${API_BASE}/settings/tts-catalog`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Lỗi khi nạp danh mục giọng đọc');
    return res.json();
  }

  async testCapCutConnection(req?: {
    endpoint?: string;
    session_token?: string;
  }): Promise<{
    ok: boolean;
    endpoint: string;
    latency_ms: number;
    message: string;
    status_code?: number;
    has_token?: boolean;
  }> {
    const res = await fetch(`${API_BASE}/settings/capcut-check`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req || {}),
    });
    if (!res.ok) throw new Error('Lỗi khi kiểm tra kết nối CapCut Cloud API');
    return res.json();
  }

  async testGroqConnection(req?: {
    api_key?: string;
  }): Promise<{
    ok: boolean;
    latency_ms: number;
    message: string;
    models_count?: number;
  }> {
    const res = await fetch(`${API_BASE}/settings/groq-check`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(req || {}),
    });
    if (!res.ok) throw new Error('Lỗi khi kiểm tra kết nối Groq Cloud API');
    return res.json();
  }

  async getCapCutDrafts(limit: number = 30): Promise<CapCutDraftsResponse> {
    const res = await fetch(`${API_BASE}/settings/capcut-drafts?limit=${limit}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Không thể tải danh sách dự án CapCut');
    return res.json();
  }

  async importCapCutDraft(
    projectId: string,
    draftId?: string,
    draftPath?: string
  ): Promise<ImportCapCutDraftResponse> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/import-capcut-draft`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ draft_id: draftId, draft_path: draftPath }),
    });
    if (!res.ok) throw new Error('Không thể nạp phụ đề từ CapCut');
    return res.json();
  }

  async listWorkers(): Promise<LanWorker[]> {
    return this.adminRequest<LanWorker[]>('/admin/workers', undefined, 'Không thể tải danh sách worker');
  }

  async listAdminJobs(status?: string): Promise<LanJob[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.adminRequest<LanJob[]>(`/admin/jobs${query}`, undefined, 'Không thể tải hàng đợi LAN');
  }

  async listDownloadApprovals(status?: string): Promise<LanDownload[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.adminRequest<LanDownload[]>(`/admin/downloads${query}`, undefined, 'Không thể tải danh sách yêu cầu duyệt');
  }

  async getLanOverview(): Promise<LanOverview> {
    const [workers, jobs, downloads] = await Promise.all([
      this.listWorkers(), this.listAdminJobs(), this.listDownloadApprovals(),
    ]);
    return {
      workers, jobs, downloads,
      worker_count: workers.length,
      online_worker_count: workers.filter(worker => worker.is_online && worker.status !== 'disabled').length,
      running_job_count: jobs.filter(job => job.status === 'running').length,
      queue_depth: workers.reduce((total, worker) => total + Number(worker.queue_depth || 0), 0),
      failed_job_count: jobs.filter(job => job.status === 'failed').length,
      pending_download_count: downloads.filter(item => ['requested', 'preview_ready'].includes(item.status || '')).length,
      fetched_at: Date.now(),
    };
  }

  async decideDownload(requestId: string, approved: boolean): Promise<LanDownload> {
    return this.adminRequest<LanDownload>(`/admin/downloads/${encodeURIComponent(requestId)}/decision`, {
      method: 'POST', body: JSON.stringify({ approved }),
    }, 'Không thể cập nhật quyết định tải');
  }

  async setWorkerStatus(workerId: string, status: 'online' | 'draining' | 'disabled'): Promise<LanWorker> {
    return this.adminRequest<LanWorker>(`/admin/workers/${encodeURIComponent(workerId)}/status?status=${status}`, {
      method: 'POST',
    }, 'Không thể cập nhật trạng thái worker');
  }

  async cancelAdminJob(jobId: string): Promise<LanJob> {
    return this.adminRequest<LanJob>(`/admin/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }, 'Không thể hủy job');
  }

  async retryAdminJob(jobId: string): Promise<LanJob> {
    return this.adminRequest<LanJob>(`/admin/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }, 'Không thể retry job');
  }

  async deleteWorker(workerId: string): Promise<void> {
    return this.adminRequest<void>(`/admin/workers/${encodeURIComponent(workerId)}`, { method: 'DELETE' }, 'Không thể xóa worker');
  }

  async createAdminJob(payload: {
    project_id: string;
    job_type: string;
    idempotency_key: string;
    worker_id?: string;
    profile?: string;
    video_fingerprint?: string;
    max_attempts?: number;
    protocol_version?: string;
    stage_plan?: string[];
    package?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
  }): Promise<LanJob> {
    return this.adminRequest<LanJob>('/admin/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, 'Không thể tạo job mới');
  }

  async deleteAdminJob(jobId: string): Promise<void> {
    return this.adminRequest<void>(`/admin/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }, 'Không thể xóa job');
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

export interface DetectedLocalProxyItem {
  name: string;
  url: string;
  active: boolean;
}

export interface ProxyStatusResponse {
  enabled: boolean;
  proxy_url: string | null;
  is_alive: boolean;
  is_standby?: boolean;
  latency_ms: number | null;
  mode: string;
  detected_local_proxies: DetectedLocalProxyItem[];
}

export interface ProxyNodeMetric {
  url: string;
  is_alive: boolean;
  latency_ms: number | null;
  active_leases: number;
  total_served: number;
  bytes_transferred: number;
  speed_mbps: number;
  last_active_at: number;
}

export interface TunnelLogEntry {
  timestamp: number;
  time_str: string;
  task: string;
  proxy: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  speed_mbps: number;
  bytes_transferred: number;
}

export interface ProxyPoolStatusResponse {
  status?: 'active' | 'standby';
  is_active?: boolean;
  is_downloading?: boolean;
  total_nodes: number;
  alive_nodes: number;
  active_leases: number;
  total_bytes_transferred: number;
  total_speed_mbps: number;
  strict_proxy: boolean;
  nodes: ProxyNodeMetric[];
  tunnel_logs: TunnelLogEntry[];
}

export interface XrayActiveNode {
  name: string;
  protocol: string;
  host: string;
  port: number;
  latency_ms?: number | null;
}

export interface XrayQualityNode {
  name: string;
  protocol: string;
  host: string;
  port: number;
  is_alive: boolean;
  latency_ms?: number | null;
  error?: string | null;
}

export interface XrayStatusResponse {
  installed: boolean;
  running: boolean;
  is_enabled: boolean;
  is_downloading: boolean;
  is_benchmarking: boolean;
  http_port: number;
  socks_port: number;
  active_node?: XrayActiveNode | null;
  quality_nodes_count: number;
  quality_nodes: XrayQualityNode[];
  last_benchmarked_at: number;
}

export interface VideoResolutionItem {
  id: string;
  label: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  size_mb?: number;
  bitrate?: number;
  fps?: number;
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
  proxy_list?: string[];
  strict_proxy?: boolean;
  cdn_direct_bypass?: boolean;
  auto_xray?: boolean;
  rate_limit_delay?: number;
  rotate_device_each_ep?: boolean;
  rotation_interval?: number;
  target_resolution?: string;
  concurrency?: number;
  cookie_source?: string;
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
  target_resolution?: string;
  concurrency?: number;
  cookie_source?: string;
  error?: string | null;
  auto_xray?: boolean;
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
  author?: string;
  ext?: string;
  resolutions?: VideoResolutionItem[];
  sample_probe?: Record<string, any>;
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

export interface GroqKeyItem {
  index: number;
  masked_key: string;
  is_usable: boolean;
  status: 'active' | 'cooldown' | 'invalid' | 'error' | 'network_error' | 'untested';
  status_label: string;
  remaining_seconds: number;
  reason: string;
  latency_ms?: number;
  last_checked?: number;
  message?: string;
}

export interface GroqPoolStatus {
  total_keys: number;
  active_keys: number;
  cooldown_keys: number;
  items: GroqKeyItem[];
}

export interface CapCutDraftItem {
  id: string;
  name: string;
  path: string;
  folder_path: string;
  mtime: number;
  updated_at: string;
  duration_sec: number;
  cue_count: number;
  preview_cues: string[];
}

export interface CapCutDraftsResponse {
  installed: boolean;
  draft_dir: string;
  drafts: CapCutDraftItem[];
}

export interface ImportCapCutDraftResponse {
  status: string;
  imported_count: number;
  message?: string;
  cues: any[];
}

export interface PlatformAuthAccount {
  logged_in: boolean;
  user_name?: string;
  vip_status?: string;
  cookie_preview?: string;
  source?: string;
}

export interface PlatformAuthStatusResponse {
  platforms: Record<string, PlatformAuthAccount>;
  accountless_capabilities: Record<string, string>;
}

export interface BilibiliQrGenResponse {
  qrcode_key: string;
  url: string;
}

export interface BilibiliQrPollResponse {
  code: number;
  message: string;
  url?: string;
  refresh_token?: string;
}

export interface VideoSearchResultItem {
  id: string;
  bvid?: string;
  title: string;
  title_vi?: string;
  author: string;
  pic: string;
  play?: number;
  danmaku?: number;
  pubdate?: number;
  duration?: string;
  url: string;
  arcurl?: string;
  description?: string;
  platform?: string;
  downloaded?: boolean;
}

export interface VideoSearchOptions {
  order?: string;
  duration?: number;
  must_contain?: string;
  must_not_contain?: string;
  auto_translate?: boolean;
  translate_titles?: boolean;
}

export interface VideoSearchResponse {
  results: VideoSearchResultItem[];
  platform: string;
}

export type ExtractionMethod = 'ocr' | 'asr_whisper' | 'vlm_gemini' | 'demux_stream';

/** OCR backends understood by the pipeline settings API.
 *
 * `rapidocr` remains the safe detector-backed default.  PP-OCRv5 currently
 * supplies recognition models and is selected after text boxes have been
 * produced by the detector bridge.  The `auto` value is accepted by the
 * backend for hardware-aware selection; legacy callers can still pass an
 * arbitrary string through the optional fields below.
 */
export type OcrBackend = 'rapidocr' | 'ppocrv5' | 'paddle' | 'auto';
export type PpOcrModelTier = 'mobile' | 'server';
export type OcrPerformanceProfile = 'fast' | 'full_speed_quality' | 'maximum_recall';
export type HardwareTuningMode = 'auto' | 'manual';

export interface ExtractionSettings {
  // Phân chia 2 Master Mode:
  // - "local": Chạy hoàn toàn cục bộ trên máy, tận dụng GPU RTX 3050 & 16 CPU cores (0đ, 100% offline)
  // - "api": Chạy qua đám mây Cloud AI (Google Gemini, ByteDance CapCut, hoặc Groq Whisper)
  mode?: 'local' | 'api';
  local_engine?: 'rapidocr' | 'whisper' | 'demux' | 'hybrid' | 'pure_ocr' | 'ppocrv5';
  api_provider?: 'gemini' | 'capcut' | 'groq';
  api_fusion_mode?: 'hybrid_ocr' | 'api_only';
  /** @deprecated removed from production; ignored by backend */
  groq_api_key?: string;
  groq_model?: 'whisper-large-v3' | 'whisper-large-v3-turbo';
  hybrid_whisper_model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  hybrid_confidence_threshold?: number;
  hybrid_rescue_missing?: boolean;
  capcut_api_endpoint?: string;
  capcut_session_token?: string;
  capcut_mode?: 'cloud_api' | 'desktop_draft';
  capcut_draft_id?: string;
  auto_fallback?: boolean;
  enable_early_exit?: boolean;
  edge_gating_threshold?: number;
  whisper_model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  whisper_device?: 'cuda' | 'cpu';
  whisper_compute_type?: 'float16' | 'int8_float16' | 'int8';
  whisper_vad_filter?: boolean;

  method?: ExtractionMethod;

  // 1. OCR (Thị giác khung hình)
  /** Primary OCR engine.  PP-OCRv5 is an opt-in recognizer tier. */
  engine: OcrBackend | 'ppocrv5-mobile' | 'ppocrv5-server';
  /** Detector/recognizer selection used by the worker bridge. */
  primary_backend?: OcrBackend | string;
  fallback_backend?: OcrBackend | string;
  ppocr_model_tier?: PpOcrModelTier;
  /** Number of text crops sent to the recognizer in one ONNX call. */
  recognition_batch_size?: number;

  // Hardware decode and adaptive execution
  enable_nvdec_hwaccel?: boolean;
  nvdec_device_id?: number;
  hardware_tuning_mode?: HardwareTuningMode | string;

  // DBNet detector tuning (used before PP-OCRv5 recognition)
  dbnet_limit_side_len?: number;
  dbnet_limit_type?: 'max' | 'min' | string;

  // Five-stage anti-false-positive funnel
  enable_anti_noise_funnel?: boolean;
  anti_noise_ar_min?: number;
  anti_noise_h_max?: number;
  anti_noise_swt_cov_max?: number;
  anti_noise_lum_min?: number;
  enable_adaptive_rescue?: boolean;
  adaptive_rescue_mid_y?: number;
  adaptive_rescue_mid_h?: number;
  enable_stroke_dhash_cache?: boolean;
  stroke_dhash_threshold?: number;

  default_source_lang?: 'zh' | 'en' | 'vi' | 'auto';
  sample_fps: number;
  diff_threshold: number;
  enable_gap_rescue: boolean;
  gap_rescue_max_frames?: number;
  enable_roi_tightening: boolean;
  performance_profile?: OcrPerformanceProfile | string;
  include_advanced_preprocessing?: boolean;


  // 3. VLM Multimodal AI (Gemini Video)
  vlm_provider?: 'gemini' | 'qwen_vl_local';
  vlm_prompt_style?: string;

  // 4. Bóc tách luồng phụ đề có sẵn (Demux)
  demux_fallback_to_ocr?: boolean;
  demux_stream_lang?: string;
}

export type OcrSettings = ExtractionSettings;

export interface TranslationSettings {
  provider: 'gemini' | 'local' | 'local_model' | 'auto' | 'google_web';
  target_language?: 'vi' | 'en' | 'zh' | 'none';
  gemini_model: string;
  local_model?: string;
  local_endpoint?: string;
  auto_fallback?: boolean;
  batch_size: number;
  prompt_tone: 'dramatic' | 'daily' | 'humorous' | 'literal';
  use_glossary: boolean;
}


export interface DubbingSettings {
  enabled?: boolean;
  provider?: 'edge' | 'capcut' | 'gemini' | 'local';
  mode?: 'single' | 'multi';
  voice: string;
  voice_male?: string;
  voice_female?: string;
  auto_detect_speakers?: boolean;
  gemini_prompt_style?: string;
  rate: string;
  speed?: number;
  pitch: string;
  ducking_volume: number;
}

export interface RenderSettings {
  ffmpeg_encoder: 'auto' | 'nvenc' | 'qsv' | 'cpu';
  default_mask_style: string;
  default_blur_strength: number;
  burn_subtitles: boolean;
}

export interface BatchPipelineSettings {
  target_lang?: string;
  ducking_volume?: number;
  dubbing_enabled?: boolean;
  dubbing_mode?: 'single' | 'gender_multi';
  dubbing_voice?: string;
  dubbing_voice_male?: string;
  dubbing_voice_female?: string;
  dubbing_speed?: number;
  export_format?: 'mp4' | 'mkv';
  export_resolution?: 'original' | '1080p' | '720p' | '2k';
  export_aspect_ratio?: 'original' | '9:16' | '16:9';
  stage_ocr?: boolean;
  stage_translate?: boolean;
  stage_dubbing?: boolean;
  stage_export?: boolean;
  active_preset_id?: string;
  sort_mode?: 'ep_asc' | 'ep_desc' | 'name_asc' | 'name_desc' | 'status' | 'duration';
  grid_cols?: 2 | 3 | 4;
}

export interface GlobalPipelineSettings {
  ocr: OcrSettings;
  translation: TranslationSettings;
  dubbing: DubbingSettings;
  render: RenderSettings;
  batch?: BatchPipelineSettings;
}

export interface HardwareInfoResponse {
  os: string;
  cpu: {
    cores: number;
    model: string;
  };
  gpu: {
    has_gpu: boolean;
    name: string;
    driver: string;
    vram_total_mb: number;
    cuda_available: boolean;
  };
  onnx_providers: string[];
  ffmpeg: {
    available: boolean;
    version: string;
    has_nvenc: boolean;
    has_qsv: boolean;
    recommended_encoder: string;
  };
}

export interface TestTranslationResult {
  original: string;
  translated: string;
  provider_used: string;
  latency_ms: number;
}

export const apiClient = new StudioApiClient();
