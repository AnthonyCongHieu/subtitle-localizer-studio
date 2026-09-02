import React from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';

interface ProjectListProps {
  projects: ProjectManifestV1[];
  onSelectProject: (project: ProjectManifestV1) => void;
  onNewProject: () => void;
  onDeleteProject: (projectId: string) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  onSelectProject,
  onNewProject,
  onDeleteProject,
}) => {
  const getLanguageName = (code: string) => {
    switch (code) {
      case 'zh': return 'Tiếng Trung (中文)';
      case 'ja': return 'Tiếng Nhật (日本語)';
      case 'ko': return 'Tiếng Hàn (한국어)';
      case 'en': return 'Tiếng Anh (English)';
      case 'vi': return 'Tiếng Việt';
      default: return code;
    }
  };

  return (
    <div className="max-w-5xl w-full mx-auto p-8 space-y-6">
      {/* Header Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight flex items-center gap-2">
            <span>🎬</span> Dự Án Bản Địa Hóa Phụ Đề
          </h1>
          <p className="text-zinc-400 text-xs mt-1">
            Tự động nhận diện hard subtitle (Trung / Nhật / Hàn / Anh), dựng timing và dịch sang tiếng Việt
          </p>
        </div>
        <button
          onClick={onNewProject}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2"
        >
          <span>+</span> Tạo Dự Án Mới
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="border border-dashed border-zinc-800 bg-zinc-900/30 rounded-2xl p-14 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400 text-2xl shadow-inner">
            🎬
          </div>
          <div className="space-y-1">
            <h3 className="text-zinc-200 font-semibold text-sm">Chưa có dự án nào</h3>
            <p className="text-zinc-500 text-xs">Import video đầu tiên của bạn để trải nghiệm tính năng OCR & Dịch tự động</p>
          </div>
          <button
            onClick={onNewProject}
            className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-lg text-xs font-medium border border-indigo-500/30 transition-colors"
          >
            Import Video Ngay
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((proj) => (
            <div
              key={proj.project_id}
              className="bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 rounded-2xl p-5 space-y-4 transition-all hover:shadow-xl hover:shadow-black/40 group flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-md text-[11px] font-mono uppercase bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-semibold">
                    {proj.source_language} &rarr; {proj.target_language}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Bạn có chắc muốn xóa dự án "${proj.title}"?`)) {
                        onDeleteProject(proj.project_id);
                      }
                    }}
                    className="text-zinc-600 hover:text-rose-400 text-xs transition-colors p-1"
                    title="Xóa dự án"
                  >
                    🗑️
                  </button>
                </div>

                <div>
                  <h3
                    onClick={() => onSelectProject(proj)}
                    className="font-semibold text-zinc-100 group-hover:text-indigo-400 transition-colors cursor-pointer truncate text-sm"
                  >
                    {proj.title}
                  </h3>
                  <p className="text-zinc-500 text-[11px] font-mono truncate mt-1" title={proj.source_video_path}>
                    📁 {proj.source_video_path}
                  </p>
                </div>

                <div className="text-[11px] text-zinc-400 space-y-0.5">
                  <div>Nguồn: <span className="text-zinc-300">{getLanguageName(proj.source_language)}</span></div>
                  <div>Đích: <span className="text-indigo-400">{getLanguageName(proj.target_language)}</span></div>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                <a
                  href={apiClient.getExportSrtUrl(proj.project_id, true)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-400 hover:text-zinc-200 text-[11px] font-medium transition-colors"
                  title="Tải nhanh file SRT tiếng Việt"
                >
                  📥 Tải .SRT
                </a>
                <button
                  onClick={() => onSelectProject(proj)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shadow-md shadow-indigo-600/20 transition-all"
                >
                  Mở Studio &rarr;
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
