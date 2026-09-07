import React from 'react';
import {
  Sparkles,
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
  Save,
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
  onSaveGlobalConfig?: () => void;
  isSavingConfig?: boolean;
  hasUnsavedChanges?: boolean;
  statusMessage: string | null;
  backendOnline: boolean | null;
  wsConnected: boolean;
  loggerCount: number;
  onToggleLogger: () => void;
  isScanning: boolean;
  hasVideo: boolean;
  onStartScan: () => void;
  onOpenDownloader: () => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
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
  onSaveGlobalConfig,
  isSavingConfig = false,
  hasUnsavedChanges = false,
  statusMessage,
  backendOnline,
  wsConnected,
  loggerCount,
  onToggleLogger,
  isScanning,
  hasVideo,
  onStartScan,
  onOpenDownloader,
  onOpenQueue,
  onOpenSettings,
  cuesCount = 0,
}) => {
  return (
    <header className="h-12 bg-slate-950 border-b border-slate-800/90 px-4 flex items-center justify-between text-xs select-none shrink-0 z-30 shadow-md">
      {/* Bên Trái: Nút Quay Lại Breadcrumb + Logo + Bộ Chọn Tập Drama + Preset Nhanh */}
      <div className="flex items-center gap-2 min-w-0">
        {dramaTitle ? (
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 1. Nút về Dashboard gốc */}
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white transition shadow-sm"
              title="Quay về Dashboard Tổng (Tất cả bộ phim)"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-medium hidden md:inline text-[11px]">Dashboard</span>
            </button>

            <span className="text-slate-600 hidden sm:inline">/</span>

            {/* 2. Nút về Dự Án / Bộ Phim đang mở */}
            <button
              onClick={onBackToDrama || onBackToDashboard}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-200 hover:text-white transition shadow-sm font-semibold group"
              title={`Quay lại danh sách tập của bộ phim: ${dramaTitle}`}
            >
              <ChevronLeft className="w-3.5 h-3.5 text-indigo-400 group-hover:-translate-x-0.5 transition-transform" />
              <span className="max-w-[120px] sm:max-w-[180px] truncate text-[11px]">
                Dự án: {dramaTitle}
              </span>
            </button>
          </div>
        ) : (
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shadow-sm"
            title="Quay lại Màn hình Quản lý Dự án (Dashboard)"
          >
            <ChevronLeft className="w-4 h-4 text-indigo-400" />
            <span className="font-medium hidden sm:inline text-[11px]">Dashboard</span>
          </button>
        )}

        <div className="h-4 w-px bg-slate-800 hidden sm:block" />

        {/* Studio Badge */}
        <div className="flex items-center gap-1.5 bg-indigo-950/60 border border-indigo-700/50 px-2 py-0.5 rounded-md text-indigo-300">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-bold text-[11px] tracking-wide uppercase hidden md:inline">Studio</span>
        </div>

        {/* Bộ Chọn Tập Drama Dạng Pill */}
        {projects.length > 0 && (
          <div className="flex items-center gap-1.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 px-2.5 py-1 rounded-lg text-xs transition">
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <select
              value={activeProject?.project_id || ''}
              onChange={(e) => {
                const found = projects.find((p) => p.project_id === e.target.value);
                if (found) onSelectProject(found);
              }}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer max-w-[150px] sm:max-w-[220px] truncate text-[11px]"
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
          <div className="hidden lg:flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 px-2 py-1 rounded-lg text-xs">
            <Sliders className="w-3 h-3 text-amber-400 shrink-0" />
            <select
              value={activePresetId}
              onChange={(e) => {
                const chosen = presets.find((x) => x.id === e.target.value);
                if (chosen) onSelectPreset(chosen);
              }}
              className="bg-transparent text-amber-300 font-medium focus:outline-none cursor-pointer max-w-[150px] truncate text-[11px]"
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

        {/* Nút Lưu Cấu Hình Toàn Cục / Chuẩn Preset */}
        {onSaveGlobalConfig && (
          <button
            type="button"
            onClick={onSaveGlobalConfig}
            disabled={isSavingConfig}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition shadow-sm cursor-pointer ${
              hasUnsavedChanges
                ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-amber-900/40'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-800'
            }`}
            title="Lưu toàn bộ cấu hình hiện tại (ROI, Mask, Tỉ lệ, Pipeline) - Bền vững khi F5"
          >
            <Save className={`w-3.5 h-3.5 ${hasUnsavedChanges ? 'text-white animate-bounce' : 'text-amber-400'}`} />
            <span className="text-[11px] font-bold">
              {isSavingConfig ? 'Đang lưu...' : hasUnsavedChanges ? 'Lưu Cấu Hình *' : 'Lưu Toàn Cục'}
            </span>
          </button>
        )}

        {/* Trạng thái hệ thống nhỏ gọn */}
        {statusMessage && (
          <div className="hidden xl:flex items-center gap-1 text-[11px] text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-2 py-0.5 rounded-full animate-in fade-in">
            <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
            <span className="max-w-[180px] truncate">{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Ở Giữa: Nút Chuyển Màn Hình Phụ (Tải Video, Hàng Đợi, Thiết Lập) */}
      <div className="hidden md:flex items-center gap-1.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800">
        <button
          onClick={onOpenDownloader}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition"
          title="Tải video từ mạng (Douyin, Kuaishou, YouTube)"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Tải Video</span>
        </button>
        <button
          onClick={onOpenQueue}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
          title="Hàng đợi tải phim tự động"
        >
          <ListPlus className="w-3.5 h-3.5 text-indigo-400" />
          <span>Hàng Đợi</span>
        </button>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
          title="Thiết lập toàn cục hệ thống"
        >
          <Settings className="w-3.5 h-3.5 text-indigo-400" />
          <span>Thiết Lập</span>
        </button>
      </div>

      {/* Bên Phải: Trạng thái Server + Nhật ký + Nút Hành Động Chính */}
      <div className="flex items-center gap-2">
        {/* Trạng thái Server */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
          {backendOnline ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          ) : (
            <XCircle className="w-3 h-3 text-rose-500" />
          )}
          <span className="text-slate-400">Server</span>
          <span className="text-slate-700">|</span>
          <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-slate-400">Live</span>
        </div>

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

        {/* Nút Hành Động Chính: Bắt Đầu Quét Sub */}
        <button
          onClick={onStartScan}
          disabled={isScanning || !hasVideo}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          title="Quét phụ đề tự động theo vùng nhận diện"
        >
          {isScanning ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Đang Quét...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>{cuesCount > 0 ? 'Quét Lại Sub' : 'Quét Phụ Đề'}</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
