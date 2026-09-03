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
}

export const apiClient = new StudioApiClient();
