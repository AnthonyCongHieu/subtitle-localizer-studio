import React, { useState } from 'react';
import { ProjectManifestV1 } from '../../types/api';
import { apiClient } from '../../api/client';
import {
  Folder,
  Film,
  Rocket,
  Trash2,
  ChevronRight,
  FileText,
  Languages,
  Mic,
  CheckCircle2,
} from 'lucide-react';

interface DramaFolderCardProps {
  dramaTitle: string;
  projects: ProjectManifestV1[];
  onOpenDrama: (dramaTitle: string) => void;
  onRunBatchDrama?: (dramaTitle: string, projects: ProjectManifestV1[]) => void;
  onDeleteDrama?: (dramaTitle: string, projects: ProjectManifestV1[]) => void;
}

export const DramaFolderCard: React.FC<DramaFolderCardProps> = ({
  dramaTitle,
  projects,
  onOpenDrama,
  onRunBatchDrama,
  onDeleteDrama,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const total = projects.length;

  // Tính toán số liệu thống kê 4 công đoạn
  const ocrDone = projects.filter((p) => (p.cues_count || 0) > 0).length;
  const transDone = projects.filter((p) => (p.translated_count || 0) > 0).length;
  const voiceDone = projects.filter((p) => Boolean(p.has_voiceover)).length;
  const exportDone = projects.filter((p) => Boolean(p.has_export)).length;

  // % Tiến độ hoàn thành bộ phim (dựa trên số tập đã hoàn tất xuất video MP4)
  const progressPercent = total > 0 ? Math.round((exportDone / total) * 100) : 0;

  // Video đại diện cho folder (tập 1 hoặc tập đầu tiên có sẵn)
  const firstProject = projects[0];
  const videoUrl = firstProject ? apiClient.getVideoStreamUrl(firstProject.project_id) : '';

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative bg-slate-900/90 border border-slate-800 hover:border-indigo-500/60 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-indigo-950/40 transition-all duration-300 flex flex-col cursor-pointer"
      onClick={() => onOpenDrama(dramaTitle)}
    >
      {/* 1. Header Card: Thumbnail đại diện hoặc Video Preview */}
      <div className="relative aspect-[16/9] w-full bg-slate-950 overflow-hidden">
        {videoUrl ? (
          <video
            src={videoUrl}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-80 group-hover:opacity-100"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/40">
            <Folder className="w-14 h-14 text-indigo-500/40" />
          </div>
        )}

        {/* Lớp phủ Gradient mờ */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />

        {/* Huy hiệu số tập ở góc trên bên trái */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-slate-950/80 backdrop-blur-md text-cyan-300 border border-cyan-500/30 flex items-center gap-1 shadow">
            <Film className="w-3.5 h-3.5 text-cyan-400" />
            <span>{total} tập</span>
          </span>
          {progressPercent === 100 && (
            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Hoàn tất</span>
            </span>
          )}
        </div>

        {/* Nút hành động nhanh ở góc trên bên phải */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
          {onDeleteDrama && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Bạn có chắc chắn muốn xóa toàn bộ ${total} tập của bộ phim "${dramaTitle}"?`)) {
                  onDeleteDrama(dramaTitle, projects);
                }
              }}
              title="Xóa bộ phim này"
              className="p-1.5 rounded-lg bg-slate-950/80 hover:bg-rose-900/80 text-slate-400 hover:text-rose-300 border border-slate-700/60 hover:border-rose-700/60 transition cursor-pointer backdrop-blur-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Biểu tượng Play / Mở Folder ở giữa khi Hover */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-all duration-300 pointer-events-none ${
            isHovered ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
          }`}
        >
          <div className="w-12 h-12 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-xl shadow-indigo-600/40 border border-indigo-400/40">
            <ChevronRight className="w-6 h-6 ml-0.5" />
          </div>
        </div>

        {/* Tên bộ phim nằm đè lên góc dưới video */}
        <div className="absolute bottom-2.5 left-3 right-3">
          <h3 className="text-sm font-bold text-white tracking-wide truncate drop-shadow-md">
            {dramaTitle}
          </h3>
        </div>
      </div>

      {/* 2. Body Card: Thống kê 4 bước & Thanh Tiến độ tổng quan */}
      <div className="p-4 space-y-3 flex-1 flex flex-col justify-between bg-slate-900/95">
        {/* Thanh Tiến Độ Hoàn Thành Bộ Phim */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400 font-medium">Tiến độ xuất phim</span>
            <span className="text-indigo-300 font-bold font-mono">{progressPercent}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Lưới 4 huy hiệu thống kê tiến độ từng công đoạn */}
        <div className="grid grid-cols-4 gap-1.5 pt-1 text-[10px] font-mono">
          <div className="p-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col items-center justify-center text-center">
            <span className="text-amber-400 font-bold flex items-center gap-0.5">
              <FileText className="w-2.5 h-2.5" />
              <span>{ocrDone}/{total}</span>
            </span>
            <span className="text-slate-500 text-[9px] mt-0.5">OCR</span>
          </div>
          <div className="p-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col items-center justify-center text-center">
            <span className="text-cyan-400 font-bold flex items-center gap-0.5">
              <Languages className="w-2.5 h-2.5" />
              <span>{transDone}/{total}</span>
            </span>
            <span className="text-slate-500 text-[9px] mt-0.5">Dịch</span>
          </div>
          <div className="p-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col items-center justify-center text-center">
            <span className="text-emerald-400 font-bold flex items-center gap-0.5">
              <Mic className="w-2.5 h-2.5" />
              <span>{voiceDone}/{total}</span>
            </span>
            <span className="text-slate-500 text-[9px] mt-0.5">Lồng tiếng</span>
          </div>
          <div className="p-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col items-center justify-center text-center">
            <span className="text-purple-400 font-bold flex items-center gap-0.5">
              <Film className="w-2.5 h-2.5" />
              <span>{exportDone}/{total}</span>
            </span>
            <span className="text-slate-500 text-[9px] mt-0.5">Xuất</span>
          </div>
        </div>

        {/* 3. Footer Card: Nút Mở xem danh sách tập & Chạy cả bộ */}
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
          {onRunBatchDrama && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRunBatchDrama(dramaTitle, projects);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer border border-slate-700/60"
              title={`Xử lý tự động cả ${total} tập`}
            >
              <Rocket className="w-3.5 h-3.5 text-amber-400" />
              <span>Chạy cả bộ</span>
            </button>
          )}

          <button
            onClick={() => onOpenDrama(dramaTitle)}
            className="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-indigo-950/40 transition active:scale-95 cursor-pointer"
          >
            <span>Xem các tập</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
