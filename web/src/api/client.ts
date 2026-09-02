import { ProjectManifestV1, SubtitleCueV1 } from '../types/api';

const API_BASE = 'http://127.0.0.1:8000/api/v1';

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

  async runPipeline(projectId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/projects/${projectId}/pipeline/run`, {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Lỗi khi khởi chạy tiến trình xử lý');
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
}

export const apiClient = new StudioApiClient();
