import React, { useState } from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';
import { Film, Plus, Trash2, Folder, Download, ArrowRight, CheckSquare, Square, Zap, Loader2 } from 'lucide-react';

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
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

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

  const handleToggleSelectProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    );
  };

  const handleSelectAll = () => {
    if (selectedProjectIds.length === projects.length) {
      setSelectedProjectIds([]);
    } else {
      setSelectedProjectIds(projects.map((p) => p.project_id));
    }
  };

  const handleRunBatch = async () => {
    if (selectedProjectIds.length === 0) return;
    try {
      setIsBatchProcessing(true);
      setBatchStatus(`⚡ Đang xử lý tự động hàng loạt ${selectedProjectIds.length} video (OCR + Dịch + Xuất)...`);
      const res = await apiClient.runBatchPipeline(selectedProjectIds, true);
      setBatchStatus(`✓ Xử lý hàng loạt hoàn tất! Thành công: ${res.successful}/${res.total} video`);
      setTimeout(() => {
        setBatchStatus(null);
        setSelectedProjectIds([]);
      }, 5000);
    } catch (err: any) {
      setBatchStatus(`Lỗi xử lý hàng loạt: ${err.message}`);
      setTimeout(() => setBatchStatus(null), 5000);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl w-full mx-auto p-8 space-y-6 select-none">
      {/* Header Banner */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight flex items-center gap-2.5">
            <Film className="w-6 h-6 text-indigo-400" />
            <span>Dự Án Bản Địa Hóa Phụ Đề</span>
          </h1>
          <p className="text-zinc-400 text-xs mt-1">
            Hỗ trợ sản xuất 30+ video/ngày: Tự động nhận diện hard subtitle, co giãn che sub thông minh, dịch ngữ cảnh AI
          </p>
        </div>

        <div className="flex items-center gap-3">
          {projects.length > 0 && (
            <>
              <button
                onClick={handleSelectAll}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-medium border border-zinc-700 transition-colors flex items-center gap-1.5"
              >
                {selectedProjectIds.length === projects.length ? (
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-zinc-400" />
                )}
                <span>{selectedProjectIds.length === projects.length ? 'Bỏ Chọn Hết' : 'Chọn Tất Cả'}</span>
              </button>

              {selectedProjectIds.length > 0 && (
                <button
                  onClick={handleRunBatch}
                  disabled={isBatchProcessing}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2 animate-pulse"
                >
                  {isBatchProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4 text-amber-300" />
                  )}
                  <span>Xử Lý Hàng Loạt ({selectedProjectIds.length})</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={onNewProject}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo Dự Án Mới</span>
          </button>
        </div>
      </div>

      {batchStatus && (
        <div className="p-3.5 rounded-xl bg-indigo-950/70 border border-indigo-800 text-indigo-200 text-xs font-medium flex items-center justify-between shadow-lg shadow-indigo-950/40">
          <div className="flex items-center gap-2.5">
            <Zap className="w-4 h-4 text-amber-400" />
            <span>{batchStatus}</span>
          </div>
          {isBatchProcessing && <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="border border-dashed border-zinc-800 bg-zinc-900/30 rounded-2xl p-14 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400 shadow-inner">
            <Film className="w-7 h-7 text-zinc-600" />
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
          {projects.map((proj) => {
            const isSelected = selectedProjectIds.includes(proj.project_id);
            return (
              <div
                key={proj.project_id}
                onClick={() => onSelectProject(proj)}
                className={`bg-zinc-900/80 border rounded-2xl p-5 space-y-4 transition-all hover:shadow-xl hover:shadow-black/40 group flex flex-col justify-between cursor-pointer ${
                  isSelected ? 'border-indigo-500 ring-1 ring-indigo-500/40 bg-indigo-950/20' : 'border-zinc-800/80 hover:border-zinc-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleToggleSelectProject(proj.project_id, e)}
                        className="text-zinc-400 hover:text-indigo-400 transition-colors"
                        title={isSelected ? 'Bỏ chọn' : 'Chọn để xử lý hàng loạt'}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <Square className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
                        )}
                      </button>
                      <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono uppercase bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-semibold">
                        {proj.source_language} &rarr; {proj.target_language}
                      </span>
                      {proj.cues_count !== undefined && proj.cues_count > 0 ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-semibold">
                          {proj.cues_count} câu sub
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-zinc-800/80 border border-zinc-700 text-zinc-400 font-medium">
                          Chưa quét
                        </span>
                      )}
                    </div>

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
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div>
                    <h3
                      className="font-semibold text-zinc-100 group-hover:text-indigo-400 transition-colors truncate text-sm"
                    >
                      {proj.title}
                    </h3>
                    <p className="text-zinc-500 text-[11px] font-mono truncate mt-1 flex items-center gap-1" title={proj.source_video_path}>
                      <Folder className="w-3 h-3 text-zinc-600 shrink-0" />
                      <span className="truncate">{proj.source_video_path}</span>
                    </p>
                  </div>

                  <div className="text-[11px] text-zinc-400 space-y-0.5">
                    <div>Nguồn: <span className="text-zinc-300">{getLanguageName(proj.source_language)}</span></div>
                    <div>Đích: <span className="text-indigo-400">{getLanguageName(proj.target_language)}</span></div>
                  </div>
                </div>

                <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs" onClick={(e) => e.stopPropagation()}>
                  <a
                    href={apiClient.getExportSrtUrl(proj.project_id, true)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-400 hover:text-zinc-200 text-[11px] font-medium transition-colors flex items-center gap-1"
                    title="Tải nhanh file SRT tiếng Việt"
                  >
                    <Download className="w-3 h-3" />
                    <span>Tải .SRT</span>
                  </a>
                  <button
                    onClick={() => onSelectProject(proj)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1"
                  >
                    <span>Mở Studio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
