import React from 'react';
import {
  Layers,
  FolderOpen,
  Sliders,
  CheckCircle2,
  XCircle,
  Activity,
  Play,
  Loader2,
  Download,
  ListPlus,
  Settings,
  ChevronLeft,
  Square,
  AlertTriangle,
} from 'lucide-react';
import { ProjectManifestV1 } from '../../types/api';
import { PresetProfile } from '../../types/presets';

interface StudioHeaderProps {
  activeProject: ProjectManifestV1 | null;
  projects: ProjectManifestV1[];
  onSelectProject: (p: ProjectManifestV1) => void;
  onBackToDashboard: () => void;
  onBackToDrama?: () => void;
  dramaTitle?: string | null;
  presets: PresetProfile[];
  activePresetId: string;
  onSelectPreset: (preset: PresetProfile) => void;
  statusMessage?: string | null;
  backendOnline: boolean | null;
  wsConnected: boolean;
  wsStatus?: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  loggerCount: number;
  onToggleLogger: () => void;
  isScanning: boolean;
  hasVideo: boolean;
  onStartScan: () => void;
  onStopScan?: () => void;
  onOpenDownloader: () => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
  onExportVideo?: () => void;
  cuesCount?: number;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  activeProject,
  projects,
  onSelectProject,
  onBackToDashboard,
  onBackToDrama,
  dramaTitle,
  presets,
  activePresetId,
  onSelectPreset,
  statusMessage: _statusMessage,
  backendOnline,
  wsConnected,
  wsStatus,
  saveStatus,
  loggerCount,
  onToggleLogger,
  isScanning,
  hasVideo,
  onStartScan,
  onStopScan,
  onOpenDownloader,
  onOpenQueue,
  onOpenSettings,
  onExportVideo,
  cuesCount = 0,
}) => {
  return (
    <header className="relative h-12 bg-slate-950 border-b border-slate-800/90 px-4 flex items-center justify-between text-xs select-none shrink-0 z-30 shadow-md">
      {/* Bên Trái: Nút Quay Lại Breadcrumb + Logo + Bộ Chọn Tập Drama */}
      <div className="flex items-center gap-1.5 min-w-0 max-w-[calc(50%-140px)] overflow-hidden">
        {dramaTitle ? (
          <div className="flex items-center gap-1 shrink-0 min-w-0">
            {/* 1. Nút về Dashboard gốc */}
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white transition shadow-sm cursor-pointer shrink-0"
              title="Quay về Dashboard Tổng (Tất cả bộ phim)"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-medium hidden sm:inline text-[11px]">Dashboard</span>
            </button>

            <span className="text-slate-600 hidden sm:inline">/</span>

            {/* 2. Nút về Dự Án / Bộ Phim đang mở */}
            <button
              onClick={onBackToDrama || onBackToDashboard}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-200 hover:text-white transition shadow-sm font-semibold group cursor-pointer max-w-[120px] sm:max-w-[160px] truncate shrink-0"
              title={`Quay lại danh sách tập của bộ phim: ${dramaTitle}`}
            >
              <span className="truncate text-[11px]">
                {dramaTitle}
              </span>
            </button>
          </div>
        ) : (
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shadow-sm cursor-pointer shrink-0"
            title="Quay lại Màn hình Quản lý Dự án (Dashboard)"
          >
            <ChevronLeft className="w-4 h-4 text-indigo-400" />
            <span className="font-medium hidden sm:inline text-[11px]">Dashboard</span>
          </button>
        )}

        <div className="h-4 w-px bg-slate-800 hidden sm:block shrink-0" />

        {/* Studio Badge */}
        <div className="hidden lg:flex items-center gap-1 bg-indigo-950/60 border border-indigo-700/50 px-2 py-0.5 rounded-md text-indigo-300 shrink-0">
          <Layers className="w-3 h-3 text-indigo-400" />
          <span className="font-bold text-[10px] tracking-wide uppercase">Studio</span>
        </div>

        {/* Bộ Chọn Tập Drama Dạng Pill */}
        {projects.length > 0 && (
          <div className="flex items-center gap-1 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 px-2 py-1 rounded-lg text-xs transition min-w-0 max-w-[130px] sm:max-w-[160px] shrink-0">
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <select
              value={activeProject?.project_id || ''}
              onChange={(e) => {
                const found = projects.find((p) => p.project_id === e.target.value);
                if (found) onSelectProject(found);
              }}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer w-full truncate text-[11px]"
              title="Chọn tập phim để biên tập"
            >
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id} className="bg-slate-900 text-slate-200">
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Bộ Chọn Chuẩn Preset Dạng Pill */}
        {presets.length > 0 && (
          <div className="hidden 2xl:flex items-center gap-1 bg-slate-900/90 border border-slate-800 px-2 py-1 rounded-lg text-xs shrink-0 max-w-[140px]">
            <Sliders className="w-3 h-3 text-amber-400 shrink-0" />
            <select
              value={activePresetId}
              onChange={(e) => {
                const chosen = presets.find((x) => x.id === e.target.value);
                if (chosen) onSelectPreset(chosen);
              }}
              className="bg-transparent text-amber-300 font-medium focus:outline-none cursor-pointer w-full truncate text-[11px]"
              title="Chuẩn cấu hình áp dụng cho video"
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Ở Giữa: Nút Chuyển Màn Hình Phụ Cố Định Tâm Màn Hình Tuyệt Đối */}
      <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-1.5 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800 shadow-sm z-20 pointer-events-auto">
        <button
          onClick={onOpenDownloader}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition cursor-pointer"
          title="Tải video từ mạng (Douyin, Kuaishou, YouTube)"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Tải Video</span>
        </button>
        <button
          onClick={onOpenQueue}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          title="Hàng đợi tải phim tự động"
        >
          <ListPlus className="w-3.5 h-3.5 text-indigo-400" />
          <span>Hàng Đợi</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          title="Thiết lập toàn cục hệ thống"
        >
          <Settings className="w-3.5 h-3.5 text-indigo-400" />
          <span>Thiết Lập</span>
        </button>
      </div>

      {/* Bên Phải: Trạng thái Server + Nhật ký + Nút Hành Động Chính */}
      <div className="flex items-center gap-2 min-w-0 max-w-[calc(50%-140px)] justify-end ml-auto">
        {/* Trạng thái Server & WebSocket Live */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
          {backendOnline ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          ) : (
            <XCircle className="w-3 h-3 text-rose-500" />
          )}
          <span className="text-slate-400">Server</span>
          <span className="text-slate-700">|</span>
          {(wsStatus === 'connected' || (wsStatus === undefined && wsConnected)) ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 font-medium">Live</span>
            </>
          ) : (wsStatus === 'connecting' || wsStatus === 'reconnecting') ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
              <span className="text-amber-400 font-medium">Đang nối...</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
              <span className="text-slate-500">Mất kết nối</span>
            </>
          )}
        </div>

        {/* Trạng thái lưu cấu hình Editor (Auto-Save State) */}
        {activeProject && saveStatus && saveStatus !== 'idle' && (
          <div className="hidden md:flex items-center gap-1.5 text-[11px] bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 animate-in fade-in">
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                <span className="text-amber-300 font-medium">Đang lưu...</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-300 font-medium">Đã lưu</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertTriangle className="w-3 h-3 text-rose-400" />
                <span className="text-rose-400 font-semibold" title="Không thể lưu vào cơ sở dữ liệu. Vui lòng kiểm tra lại kết nối server.">Lỗi đồng bộ</span>
              </>
            )}
          </div>
        )}

        {/* Nút Nhật Ký */}
        <button
          onClick={onToggleLogger}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs transition"
          title="Mở nhật ký hoạt động hệ thống"
        >
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline text-[11px]">Nhật ký</span>
          {loggerCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 border border-slate-700 font-mono font-bold">
              {loggerCount}
            </span>
          )}
        </button>

        {/* Nút Hành Động Chính 1: Bắt Đầu Quét Sub HOẶC Dừng / Hủy Quét */}
        {isScanning ? (
          <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-medium shadow-inner">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>Đang Quét...</span>
            </div>
            {onStopScan && (
              <button
                type="button"
                onClick={onStopScan}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-rose-600/40 transition cursor-pointer"
                title="Dừng hoặc Hủy tiến trình quét phụ đề ngay lập tức"
              >
                <Square className="w-3 h-3 fill-white" />
                <span>Dừng / Hủy</span>
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={onStartScan}
            disabled={!hasVideo}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Quét phụ đề tự động theo vùng nhận diện"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>{cuesCount > 0 ? 'Quét Lại Sub' : 'Quét Phụ Đề'}</span>
          </button>
        )}

        {/* Nút Hành Động 2: Xuất Bản Video MP4 (Export Video) */}
        {onExportVideo && (
          <button
            type="button"
            onClick={onExportVideo}
            disabled={!hasVideo}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            title="Xuất bản & kết xuất video MP4 hoàn thiện (che sub gốc + đè phụ đề dịch)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất Video</span>
          </button>
        )}
      </div>
    </header>
  );
};
