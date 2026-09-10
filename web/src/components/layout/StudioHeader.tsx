import React from 'react';
import {
  Layers,
  CheckCircle2,
  XCircle,
  Play,
  Loader2,
  Download,
  ListPlus,
  Activity,
  Settings,
  ChevronLeft,
  AlertTriangle,
  Sparkles,
  Mic,
  Check,
} from 'lucide-react';
import { ProjectManifestV1, SubtitleCueV1 } from '../../types/api';
import { PresetProfile } from '../../types/presets';
import { ActivityLogButton } from '../common/GlobalActivityLogger';

interface StudioHeaderProps {
  activeProject: ProjectManifestV1 | null;
  projects?: ProjectManifestV1[];
  onSelectProject?: (p: ProjectManifestV1) => void;
  onBackToDashboard: () => void;
  onBackToDrama?: () => void;
  dramaTitle?: string | null;
  presets?: PresetProfile[];
  activePresetId?: string;
  onSelectPreset?: (preset: PresetProfile) => void;
  statusMessage?: string | null;
  backendOnline: boolean | null;
  wsConnected: boolean;
  wsStatus?: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  loggerCount: number;
  onToggleLogger: () => void;
  isScanning: boolean;
  scanProgress?: number | null;
  hasVideo: boolean;
  onStartScan: () => void;
  onStopScan?: () => void;
  onTranslateAll?: () => void;
  isTranslating?: boolean;
  onDubAll?: () => void;
  isDubbing?: boolean;
  onOpenDownloader: () => void;
  onOpenQueue: () => void;
  onOpenAdmin?: () => void;
  onOpenSettings: () => void;
  onExportVideo?: () => void;
  cuesCount?: number;
  cues?: SubtitleCueV1[];
  hasVoiceover?: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  activeProject,
  projects: _projects,
  onSelectProject: _onSelectProject,
  onBackToDashboard,
  onBackToDrama,
  dramaTitle,
  presets: _presets,
  activePresetId: _activePresetId,
  onSelectPreset: _onSelectPreset,
  statusMessage,
  backendOnline,
  wsConnected,
  wsStatus,
  saveStatus,
  loggerCount: _loggerCount,
  onToggleLogger: _onToggleLogger,
  isScanning,
  scanProgress,
  hasVideo,
  onStartScan,
  onStopScan,
  onTranslateAll,
  isTranslating = false,
  onDubAll,
  isDubbing = false,
  onOpenDownloader,
  onOpenQueue,
  onOpenAdmin,
  onOpenSettings,
  onExportVideo,
  cuesCount = 0,
  cues = [],
  hasVoiceover = false,
}) => {
  const hasSubDone = (cues && cues.length > 0) || cuesCount > 0;
  const hasTransDone = cues && cues.length > 0 && cues.some((c) => Boolean(c.translated_text && c.translated_text.trim()));
  const hasDubDone = Boolean(hasVoiceover || activeProject?.has_voiceover);

  return (
    <header className="relative h-12 bg-slate-950 border-b border-slate-800/90 px-3 sm:px-4 flex items-center justify-between text-xs select-none shrink-0 z-30 shadow-md gap-2 overflow-x-auto no-scrollbar">
      {/* Bên Trái: Nút Quay Lại Breadcrumb + Logo/Badge + Nhóm Điều Hướng Màn Hình */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {dramaTitle ? (
          <div className="flex items-center gap-1 shrink-0 min-w-0">
            {/* 1. Nút về Dashboard gốc */}
            <button
              onClick={onBackToDashboard}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white transition shadow-sm cursor-pointer shrink-0 whitespace-nowrap"
              title="Quay về Dashboard Tổng (Tất cả bộ phim)"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium hidden sm:inline text-[11px]">Dashboard</span>
            </button>

            <span className="text-slate-600 hidden sm:inline shrink-0">/</span>

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
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shadow-sm cursor-pointer shrink-0 whitespace-nowrap"
            title="Quay lại Màn hình Quản lý Dự án (Dashboard)"
          >
            <ChevronLeft className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-medium hidden sm:inline text-[11px]">Dashboard</span>
          </button>
        )}

        <div className="h-4 w-px bg-slate-800 hidden sm:block shrink-0" />

        {/* Studio Badge */}
        <div className="hidden lg:flex items-center gap-1 bg-indigo-950/60 border border-indigo-700/50 px-2 py-0.5 rounded-md text-indigo-300 shrink-0 whitespace-nowrap">
          <Layers className="w-3 h-3 text-indigo-400 shrink-0" />
          <span className="font-bold text-[10px] tracking-wide uppercase">Studio</span>
        </div>

        <div className="h-4 w-px bg-slate-800 hidden md:block shrink-0" />

        {/* Cụm Nút Chuyển Màn Hình Chuẩn Hóa Liền Kề Bên Trái */}
        <div className="hidden md:flex items-center gap-1 bg-slate-900/90 p-0.5 rounded-lg border border-slate-800 shadow-sm shrink-0">
          <button
            onClick={onOpenDownloader}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition cursor-pointer shrink-0 whitespace-nowrap"
            title="Tải video từ mạng (Douyin, Kuaishou, YouTube)"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Tải Video</span>
          </button>
          <button
            onClick={onOpenQueue}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0 whitespace-nowrap"
            title="Hàng đợi tải phim tự động"
          >
            <ListPlus className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Hàng Đợi</span>
          </button>
          {onOpenAdmin && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-cyan-300 hover:text-white hover:bg-cyan-950/40 transition cursor-pointer shrink-0 whitespace-nowrap"
              title="Quản lý worker và job LAN"
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span>Admin LAN</span>
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0 whitespace-nowrap"
            title="Thiết lập toàn cục hệ thống"
          >
            <Settings className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Thiết Lập</span>
          </button>
        </div>
      </div>

      {/* Bên Phải: Trạng thái Server + Nhật ký + Nút Hành Động Chính */}
      <div className="flex items-center gap-2 min-w-0 shrink-0 justify-end ml-auto">
        {/* Trạng thái Server & WebSocket Live */}
        <div className="hidden xl:flex items-center gap-1.5 text-[11px] bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 shrink-0 whitespace-nowrap">
          {backendOnline ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-3 h-3 text-rose-500 shrink-0" />
          )}
          <span className="text-slate-400">Server</span>
          <span className="text-slate-700">|</span>
          {(wsStatus === 'connected' || (wsStatus === undefined && wsConnected)) ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="text-emerald-400 font-medium">Live</span>
            </>
          ) : (wsStatus === 'connecting' || wsStatus === 'reconnecting') ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
              <span className="text-amber-400 font-medium">Đang nối...</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
              <span className="text-slate-500">Mất kết nối</span>
            </>
          )}
        </div>

        {/* Trạng thái lưu cấu hình Editor (Auto-Save State) */}
        {activeProject && saveStatus && saveStatus !== 'idle' && (
          <div className="hidden 2xl:flex items-center gap-1.5 text-[11px] bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 animate-in fade-in shrink-0 whitespace-nowrap">
            {saveStatus === 'saving' && (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                <span className="text-amber-300 font-medium">Đang lưu...</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-emerald-300 font-medium">Đã lưu</span>
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                <span className="text-rose-400 font-semibold" title="Không thể lưu vào cơ sở dữ liệu. Vui lòng kiểm tra lại kết nối server.">Lỗi đồng bộ</span>
              </>
            )}
          </div>
        )}

        {/* Nút Nhật Ký Tích Hợp Thông Minh (Không Che Màn Hình) */}
        <div className="shrink-0">
          <ActivityLogButton />
        </div>

        {/* Cụm 3 Nút Tổng Hợp Chuẩn Quy Trình: [1. Quét Sub] • [2. Dịch AI] • [3. Lồng Tiếng] */}
        <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-sm shrink-0">
          {/* 1. Quét Phụ Đề */}
          {isScanning ? (
            <button
              type="button"
              onClick={onStopScan}
              className="flex items-center justify-center gap-1 px-2.5 h-7 rounded-lg text-xs font-semibold shadow-sm bg-indigo-600 hover:bg-indigo-500 text-white whitespace-nowrap shrink-0 transition active:scale-[0.98] cursor-pointer"
              title={statusMessage || '1. Quét Sub: Đang quét phụ đề... (Chi tiết xem tại Dòng thời gian. Nhấp để dừng)'}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{scanProgress !== null && scanProgress !== undefined ? `Quét (${Math.round(scanProgress)}%)` : 'Đang Quét...'}</span>
            </button>
          ) : (
            <button
              onClick={onStartScan}
              disabled={!hasVideo}
              className={`flex items-center justify-center gap-1 px-2.5 h-7 rounded-lg text-xs font-semibold shadow-sm whitespace-nowrap shrink-0 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                hasSubDone
                  ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border border-indigo-500/40'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
              title="1. Quét Sub: Quét phụ đề tự động theo vùng nhận diện"
            >
              {hasSubDone ? (
                <span className="flex items-center justify-center gap-1 whitespace-nowrap">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Quét Lại</span>
                </span>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-white shrink-0" />
                  <span>Quét Sub</span>
                </>
              )}
            </button>
          )}

          {/* 2. Dịch Phụ Đề AI */}
          {onTranslateAll && (
            <button
              type="button"
              onClick={onTranslateAll}
              disabled={isTranslating || !hasVideo || !hasSubDone}
              className={`flex items-center justify-center gap-1 px-2.5 h-7 rounded-lg text-xs font-semibold shadow-sm whitespace-nowrap shrink-0 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                hasTransDone
                  ? 'bg-slate-800 hover:bg-slate-750 text-purple-300 border border-purple-500/40'
                  : 'bg-purple-600 hover:bg-purple-500 text-white'
              }`}
              title={!hasSubDone ? "Cần quét hoặc nhập phụ đề trước khi dịch" : "2. Dịch AI: Dịch toàn bộ phụ đề bằng Gemini AI"}
            >
              {isTranslating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>Đang Dịch...</span>
                </>
              ) : hasTransDone ? (
                <span className="flex items-center justify-center gap-1 whitespace-nowrap">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Dịch Lại</span>
                </span>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>Dịch AI</span>
                </>
              )}
            </button>
          )}

          {/* 3. Lồng Tiếng AI (TTS) */}
          {onDubAll && (
            <button
              type="button"
              onClick={onDubAll}
              disabled={isDubbing || !hasVideo || !hasSubDone}
              className={`flex items-center justify-center gap-1 px-2.5 h-7 rounded-lg text-xs font-semibold shadow-sm whitespace-nowrap shrink-0 transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                hasDubDone
                  ? 'bg-slate-800 hover:bg-slate-750 text-amber-300 border border-amber-500/40'
                  : 'bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold'
              }`}
              title={!hasSubDone ? "Cần quét phụ đề trước khi lồng tiếng" : "3. Lồng Tiếng: Lồng tiếng toàn bộ video"}
            >
              {isDubbing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950 shrink-0" />
                  <span>Đang Đọc...</span>
                </>
              ) : hasDubDone ? (
                <span className="flex items-center justify-center gap-1 whitespace-nowrap">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Đọc Lại</span>
                </span>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                  <span>Lồng Tiếng</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Nút Hành Động Cuối: Xuất Bản Video MP4 (Export Video) */}
        {onExportVideo && (
          <button
            type="button"
            onClick={onExportVideo}
            disabled={!hasVideo}
            className="flex items-center justify-center gap-1.5 px-3 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
            title="Xuất bản & kết xuất video MP4 hoàn thiện (che sub gốc + đè phụ đề dịch)"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>Xuất Video</span>
          </button>
        )}
      </div>
    </header>
  );
};
