import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { apiClient, GeminiPoolStatus } from '../../api/client';
import { ProjectManifestV1, SubtitleCueV1, RegionTrackV1 } from '../../types/api';
import { PresetProfile, getDefaultPreset } from '../../types/presets';
import { UrlDownloadModal } from './UrlDownloadModal';
import { DeviceSettingsModal } from './DeviceSettingsModal';
import { DramaFolderCard } from './DramaFolderCard';
import { appLogger, useAppLoggerCount } from '../common/GlobalActivityLogger';
import {
  Film,
  Folder,
  CheckSquare,
  Square,
  Play,
  Pause,
  Maximize2,
  Settings,
  X,
  FileText,
  Languages,
  Mic,
  Rocket,
  ChevronLeft,
  Sparkles,
  FolderPlus,
  Globe,
  Key,
  RefreshCw,
  AlertCircle,
  Trash2,
  Search,
  Copy,
  Check,
  Smartphone,
  Activity,
  Volume2,
  Video,
  ArrowUpDown,
  Scan,
  CheckCircle2,
  FolderOpen,
  Download,
  Crosshair,
  SlidersHorizontal,
  RotateCcw,
  Save,
} from 'lucide-react';
import { RoiOverlay } from '../roi/RoiOverlay';
import { GlobalPipelineSettings } from '../../api/client';
import {
  detectVoiceProvider,
  getVoiceDropdownGroups,
} from '../../constants/voiceCatalog';
import { VoiceCatalogPicker } from '../common/VoiceCatalogPicker';
import {
  loadBatchExportConfig,
  saveBatchExportConfig,
  reconcileBatchConfigWithBackend,
  BatchExportConfig,
} from '../../utils/batchSettingsStorage';

interface DashboardBatchHubProps {
  projects: ProjectManifestV1[];
  presets: PresetProfile[];
  onSelectProject: (project: ProjectManifestV1) => void;
  onNewProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onOpenPresetManager: () => void;
  onOpenSettingsTab?: (tab?: 'ocr' | 'translation' | 'dubbing' | 'render') => void;
  onRefreshProjects: () => void;
  onBatchProjectsCreated?: (newProjects: ProjectManifestV1[]) => void;
  onOpenQueue?: () => void;
  onOpenDownloader?: (tab?: 'search' | 'direct' | 'queue' | 'auth' | 'settings') => void;
  onOpenAdmin?: () => void;
  selectedDramaTitle?: string | null;
  onSelectDramaTitle?: (title: string | null) => void;
}

interface BatchQueueItem {
  projectId: string;
  title: string;
  status: 'pending' | 'scanning' | 'translating' | 'voicing' | 'exporting' | 'completed' | 'failed';
  error?: string;
  cuesCount?: number;
}

const formatTime = (secs: number) => {
  if (!secs || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// Thẻ Video Mini Card (Batch Video Card) với Mini Player, Bounding Box ROI, Mask che mờ và Sub dịch
const BatchVideoCard: React.FC<{
  project: ProjectManifestV1;
  isSelected: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
  onSelectProject: (proj: ProjectManifestV1) => void;
  onDeleteProject: (id: string) => void;
  onOpenSettings: (proj: ProjectManifestV1) => void;
  layerVisibility: {
    video: boolean;
    watermark: boolean;
    sourceSub: boolean;
    translatedSub: boolean;
    title: boolean;
    mask: boolean;
    audio: boolean;
    voiceover: boolean;
  };
  queueItem?: BatchQueueItem;
  onRunSingleDubbing?: (proj: ProjectManifestV1) => void;
  singleActionStatusText?: string;
  isSingleRunning?: boolean;
}> = ({
  project,
  isSelected,
  onToggleSelect,
  onSelectProject,
  onDeleteProject,
  onOpenSettings,
  layerVisibility,
  queueItem,
  onRunSingleDubbing,
  singleActionStatusText,
  isSingleRunning,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subMode] = useState<'both' | 'translated' | 'original'>('translated');

  const videoUrl = apiClient.getVideoStreamUrl(project.project_id);
  const hasCues = project.cues_count !== undefined && project.cues_count > 0;

  // 1. Tải danh sách phụ đề thật từ backend SQLite để đồng bộ thời gian thực
  const [cues, setCues] = useState<SubtitleCueV1[]>([]);
  useEffect(() => {
    let isMounted = true;
    if (hasCues) {
      apiClient
        .getCues(project.project_id)
        .then((data) => {
          if (isMounted && data) {
            setCues(data);
          }
        })
        .catch((err) => {
          console.error('Không thể tải cues cho card:', err);
        });
    } else {
      setCues([]);
    }
    return () => {
      isMounted = false;
    };
  }, [project.project_id, hasCues, project.cues_count, project.translated_count]);

  // 2. Tìm phụ đề khớp với thời gian phát hiện tại (Real-time active cue)
  const activeCue = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    return cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts) || null;
  }, [cues, currentTime]);



  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  };

  // 5. Kết xuất nội dung phụ đề động theo chế độ xem và mốc thời gian phát
  const renderSubtitleText = () => {
    if (!activeCue) return null;

    if (subMode === 'original') {
      return activeCue.source_text;
    }

    if (subMode === 'both') {
      return (
        <div className="flex flex-col items-center justify-center text-center leading-tight">
          <span className="text-white/80 text-[9px] drop-shadow">{activeCue.source_text}</span>
          <span className="text-amber-300 font-bold text-[11px] sm:text-xs drop-shadow">
            {activeCue.translated_text || activeCue.source_text}
          </span>
        </div>
      );
    }

    // subMode === 'translated'
    return activeCue.translated_text || activeCue.source_text;
  };

  return (
    <div
      onClick={() => onSelectProject(project)}
      className={`rounded-xl bg-slate-900/90 border transition-all overflow-hidden flex flex-col group cursor-pointer shadow-lg ${
        isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-500/40 bg-indigo-950/20'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* 1. Header Thẻ Video */}
      <div
        className="px-3 py-2 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between text-xs gap-2 select-none hover:bg-slate-900 transition-colors cursor-pointer group/header"
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings(project);
        }}
        title="Bấm vào tiêu đề / thanh trên để mở Thông số kỹ thuật & Chi tiết tập"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(e);
            }}
            className="text-slate-400 hover:text-indigo-400 transition shrink-0 cursor-pointer"
            title={isSelected ? 'Bỏ chọn' : 'Chọn để xử lý hàng loạt'}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-cyan-400" />
            ) : (
              <Square className="w-4 h-4 text-slate-600 hover:text-slate-400" />
            )}
          </button>

          <span
            className="font-semibold text-slate-200 text-[11px] truncate group-hover/header:text-cyan-300 transition-colors"
            title={project.title}
          >
            {project.title}
          </span>
        </div>

        {/* Nút cài đặt thông số tập & Xóa */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onOpenSettings(project)}
            className="p-1 text-slate-500 hover:text-cyan-400 transition cursor-pointer"
            title="Xem thông số kỹ thuật & chi tiết tập"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Xóa video "${project.title}"?`)) onDeleteProject(project.project_id);
            }}
            className="p-1 text-slate-600 hover:text-rose-400 transition cursor-pointer"
            title="Xóa video"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Khung Preview Video Đa Nhiệm (Có ROI Bounding Box Tương Tác, Mask che mờ và Sub dịch thật) */}
      <div
        ref={containerRef}
        className="relative aspect-video bg-black overflow-hidden flex items-center justify-center select-none group/player"
      >
        {layerVisibility.video && (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain pointer-events-none"
            playsInline
            muted={!layerVisibility.audio}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onEnded={() => setIsPlaying(false)}
          />
        )}

        {/* Watermark nếu có cấu hình */}
        {layerVisibility.watermark && project.style?.watermark_text && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur border border-white/10 pointer-events-none z-10 animate-in fade-in">
            <span className="text-[9px] font-semibold text-white/90 drop-shadow">
              {project.style.watermark_text}
            </span>
          </div>
        )}

        {/* Tag Định Danh Dự Án */}
        <div className="absolute top-2 right-2 flex items-center gap-1 pointer-events-none z-10">
          <span className="px-1 py-0.5 rounded bg-black/60 text-[8px] font-mono text-cyan-300 border border-cyan-500/30">
            {project.project_id.slice(-6).toUpperCase()}
          </span>
        </div>

        {/* Phụ đề dịch hiển thị sạch sẽ ở đáy khi đang phát video (Loại bỏ ô kéo và nốt tay cầm theo yêu cầu R4) */}
        {isPlaying && activeCue && layerVisibility.translatedSub && (
          <div className="absolute bottom-2 left-2 right-2 text-center pointer-events-none z-20">
            <span className="inline-block px-2.5 py-1 rounded bg-black/80 text-amber-300 font-bold text-[11px] sm:text-xs leading-tight drop-shadow max-w-[96%] truncate">
              {renderSubtitleText()}
            </span>
          </div>
        )}

        {/* Nút Play Nhanh Giữa Màn Hình Khi Hover */}
        <button
          onClick={togglePlay}
          className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-slate-950/60 border border-white/20 text-white flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition shadow-2xl backdrop-blur-sm z-30 active:scale-95"
          title={isPlaying ? 'Tạm dừng' : 'Xem trước video'}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>
      </div>

      {/* 3. Thanh Tiến Độ Tua Mini (Mini Scrubber Timeline Bar) */}
      <div
        className="w-full h-1.5 bg-slate-950 border-t border-slate-800/80 hover:h-2.5 transition-all cursor-pointer relative group/scrubber select-none"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const newTime = pos * duration;
          if (videoRef.current) {
            videoRef.current.currentTime = newTime;
            setCurrentTime(newTime);
          }
        }}
        title="Nhấp để tua nhanh video & kiểm tra phụ đề tại mốc thời gian này"
      >
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 relative pointer-events-none"
          style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow opacity-0 group-hover/scrubber:opacity-100 transition-opacity pointer-events-none" />
        </div>
      </div>

      {/* 4. Chân Thẻ Điều Khiển Mini (Mini Player Controller) */}
      <div
        className="px-2.5 py-1.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs gap-2 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cụm Nút Play / Timecode */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePlay}
            className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition"
            title={isPlaying ? 'Tạm dừng' : 'Phát'}
          >
            {isPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
          </button>

          <span className="text-[10px] font-mono text-slate-400 tracking-tighter">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        {/* Nút Phóng To / Mở Studio & Nút Lồng Tiếng Đơn */}
        <div className="flex items-center gap-1">
          {onRunSingleDubbing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRunSingleDubbing(project);
              }}
              disabled={isSingleRunning || (project.cues_count || 0) === 0}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                project.has_voiceover
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/60 hover:bg-emerald-900'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
              title={
                (project.cues_count || 0) === 0
                  ? 'Cần quét phụ đề trước khi tạo voice'
                  : project.has_voiceover
                  ? 'Đã có voiceover (Bấm để tạo lại)'
                  : 'Tạo giọng lồng tiếng cho video này'
              }
            >
              <Mic className="w-2.5 h-2.5 text-emerald-400" />
              <span>{project.has_voiceover ? 'Đã có voice' : 'Tạo voice'}</span>
            </button>
          )}

          <button
            onClick={() => onSelectProject(project)}
            className="p-1 text-slate-400 hover:text-indigo-300 transition flex items-center gap-1 text-[10px] font-semibold"
            title="Vào Studio"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Thông báo trạng thái thao tác cá nhân trên card */}
      {singleActionStatusText && (
        <div className="px-2 py-1 bg-cyan-950/80 border-t border-cyan-800/80 text-[10px] text-cyan-300 font-mono animate-pulse flex items-center gap-1 select-none">
          <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0" />
          <span className="truncate">{singleActionStatusText}</span>
        </div>
      )}

      {/* 4b. Lưới 4 Huy Hiệu Trạng Thái Chi Tiết (OCR, Dịch, Voice, Xuất MP4) */}
      <div className="px-2 py-1.5 bg-slate-900/90 border-t border-slate-800/80 grid grid-cols-4 gap-1 text-[10px] font-mono select-none">
        {/* Badge 1: OCR */}
        <div
          className={`px-0.5 py-1 rounded border flex flex-col items-center justify-center text-center ${
            (project.cues_count || 0) > 0
              ? 'bg-amber-950/40 border-amber-800/50 text-amber-300'
              : 'bg-slate-950/60 border-slate-800 text-slate-500'
          }`}
          title={(project.cues_count || 0) > 0 ? `Đã quét được ${project.cues_count} câu phụ đề OCR` : 'Chưa quét OCR'}
        >
          <span className="font-bold flex items-center gap-0.5 leading-none">
            <FileText className="w-2 h-2 shrink-0" />
            <span className="truncate">{(project.cues_count || 0) > 0 ? `${project.cues_count}` : '0'}</span>
          </span>
          <span className="text-[8px] opacity-75 mt-0.5">OCR</span>
        </div>

        {/* Badge 2: Dịch */}
        <div
          className={`px-0.5 py-1 rounded border flex flex-col items-center justify-center text-center ${
            (project.translated_count || 0) > 0
              ? 'bg-cyan-950/40 border-cyan-800/50 text-cyan-300'
              : 'bg-slate-950/60 border-slate-800 text-slate-500'
          }`}
          title={(project.translated_count || 0) > 0 ? `Đã dịch ${project.translated_count}/${project.cues_count || 0} câu` : 'Chưa dịch phụ đề'}
        >
          <span className="font-bold flex items-center gap-0.5 leading-none">
            <Languages className="w-2 h-2 shrink-0" />
            <span className="truncate">{(project.translated_count || 0) > 0 ? `${project.translated_count}` : '0'}</span>
          </span>
          <span className="text-[8px] opacity-75 mt-0.5">Dịch</span>
        </div>

        {/* Badge 3: Voice MP3 */}
        <div
          className={`px-0.5 py-1 rounded border flex flex-col items-center justify-center text-center ${
            project.has_voiceover
              ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
              : 'bg-slate-950/60 border-slate-800 text-slate-500'
          }`}
          title={project.has_voiceover ? 'Đã tạo âm thanh lồng tiếng AI (MP3)' : 'Chưa tạo giọng lồng tiếng'}
        >
          <span className="font-bold flex items-center gap-0.5 leading-none">
            <Mic className="w-2 h-2 shrink-0" />
            <span>{project.has_voiceover ? '✓' : '—'}</span>
          </span>
          <span className="text-[8px] opacity-75 mt-0.5">Voice</span>
        </div>

        {/* Badge 4: Xuất MP4 */}
        <div
          className={`px-0.5 py-1 rounded border flex flex-col items-center justify-center text-center ${
            project.has_export
              ? 'bg-purple-950/40 border-purple-800/50 text-purple-300'
              : 'bg-slate-950/60 border-slate-800 text-slate-500'
          }`}
          title={project.has_export ? 'Đã render và xuất file video MP4 hoàn chỉnh' : 'Chưa xuất video MP4'}
        >
          <span className="font-bold flex items-center gap-0.5 leading-none">
            <Film className="w-2 h-2 shrink-0" />
            <span>{project.has_export ? '✓' : '—'}</span>
          </span>
          <span className="text-[8px] opacity-75 mt-0.5">Xuất</span>
        </div>
      </div>

      {/* 5. Thanh Tiến Trình Từng Bước Khi Đang Chạy Hàng Đợi (Step Progress Bar) */}
      {queueItem && (
        <div className="px-2.5 py-1.5 bg-slate-950 border-t border-slate-800 text-[10px] space-y-1 select-none">
          <div className="flex items-center justify-between font-mono">
            <span className="text-slate-400 flex items-center gap-1">
              {queueItem.status === 'completed' && <Check className="w-3 h-3 text-emerald-400" />}
              {queueItem.status === 'failed' && <AlertCircle className="w-3 h-3 text-rose-400" />}
              {['scanning', 'translating', 'voicing', 'exporting'].includes(queueItem.status) && (
                <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
              )}
              <span>
                {queueItem.status === 'pending' && 'Chờ xử lý...'}
                {queueItem.status === 'scanning' && 'Đang quét OCR...'}
                {queueItem.status === 'translating' && 'Đang dịch thuật AI...'}
                {queueItem.status === 'voicing' && 'Đang lồng tiếng AI...'}
                {queueItem.status === 'exporting' && 'Đang render video...'}
                {queueItem.status === 'completed' && 'Hoàn thành'}
                {queueItem.status === 'failed' && `Lỗi: ${queueItem.error || 'Thất bại'}`}
              </span>
            </span>
            <span className="font-bold text-cyan-300">
              {queueItem.status === 'pending' && '0%'}
              {queueItem.status === 'scanning' && '25%'}
              {queueItem.status === 'translating' && '50%'}
              {queueItem.status === 'voicing' && '75%'}
              {queueItem.status === 'exporting' && '90%'}
              {queueItem.status === 'completed' && '100%'}
              {queueItem.status === 'failed' && '!'}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1 h-1 rounded-full overflow-hidden bg-slate-800">
            <div className={`h-full transition-all ${['scanning', 'translating', 'voicing', 'exporting', 'completed'].includes(queueItem.status) ? 'bg-cyan-500' : 'bg-transparent'}`} title="Bước 1: OCR" />
            <div className={`h-full transition-all ${['translating', 'voicing', 'exporting', 'completed'].includes(queueItem.status) ? 'bg-amber-500' : 'bg-transparent'}`} title="Bước 2: Dịch" />
            <div className={`h-full transition-all ${['voicing', 'exporting', 'completed'].includes(queueItem.status) ? 'bg-emerald-500' : 'bg-transparent'}`} title="Bước 3: Lồng tiếng TTS" />
            <div className={`h-full transition-all ${['exporting', 'completed'].includes(queueItem.status) ? (queueItem.status === 'completed' ? 'bg-purple-500' : 'bg-purple-400 animate-pulse') : 'bg-transparent'}`} title="Bước 4: Render xuất MP4" />
          </div>
        </div>
      )}
    </div>
  );
};

// Trích xuất tên bộ phim và số tập từ tiêu đề hoặc đường dẫn video
export const extractDramaInfo = (
  title: string,
  videoPath?: string
): { dramaTitle: string; episodeNumber: number } => {
  // Regex nhận diện các dạng tên tập:
  // "Hoàng Hậu Tái Sinh - Tập 01", "Hoàng Hậu Tái Sinh_Tap_02", "Phim Hay EP 15", "Tập 03", "#04", "S01E05"
  const episodePattern = /[\s\-_]+(?:tập|tap|ep|episode|phần|#|s\d+e)[\s\-_\.]*(\d+).*$/i;
  const match = title.match(episodePattern);

  if (match) {
    const dramaName = title.slice(0, match.index).replace(/[\s\-_]+$/, '').trim();
    const epNum = parseInt(match[1], 10);
    return {
      dramaTitle: dramaName || 'Video đơn lẻ / Chưa phân loại',
      episodeNumber: isNaN(epNum) ? 1 : epNum,
    };
  }

  // Nếu tiêu đề dạng "Tập 01" không có tiền tố tên phim:
  const startsWithEpPattern = /^(?:tập|tap|ep|episode|phần|#)\s*(\d+)/i;
  const matchStart = title.match(startsWithEpPattern);
  if (matchStart) {
    if (videoPath) {
      const normalized = videoPath.replace(/\\/g, '/');
      const parts = normalized.split('/');
      if (parts.length >= 2) {
        const parentFolder = parts[parts.length - 2];
        if (parentFolder && !['uploads', 'videos', 'downloads', 'temp', 'src'].includes(parentFolder.toLowerCase())) {
          return {
            dramaTitle: parentFolder,
            episodeNumber: parseInt(matchStart[1], 10),
          };
        }
      }
    }
  }

  // Nếu có videoPath với folder cha hợp lệ
  if (videoPath) {
    const normalized = videoPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.length >= 2) {
      const parentFolder = parts[parts.length - 2];
      if (parentFolder && !['uploads', 'videos', 'downloads', 'temp', 'src'].includes(parentFolder.toLowerCase())) {
        return {
          dramaTitle: parentFolder,
          episodeNumber: 1,
        };
      }
    }
  }

  return {
    dramaTitle: 'Video đơn lẻ / Chưa phân loại',
    episodeNumber: 1,
  };
};

export const extractEpisodeNumber = (title: string): number => {
  return extractDramaInfo(title).episodeNumber;
};

export const DashboardBatchHub: React.FC<DashboardBatchHubProps> = ({
  projects,
  presets,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onOpenPresetManager: _onOpenPresetManager,
  onOpenSettingsTab: _onOpenSettingsTab,
  onRefreshProjects,
  onBatchProjectsCreated,
  onOpenQueue: _onOpenQueue,
  onOpenDownloader: _onOpenDownloader,
  onOpenAdmin: _onOpenAdmin,
  selectedDramaTitle: propSelectedDramaTitle,
  onSelectDramaTitle,
}) => {
  const loggerCount = useAppLoggerCount();
  // Khởi tạo Cấu Hình Xuất Hàng Loạt từ localStorage để giữ nguyên khi F5 / chuyển tab
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [activeBatchPresetId, setActiveBatchPresetId] = useState<string>(() => loadBatchExportConfig().activeBatchPresetId || '');
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(() => loadBatchExportConfig().gridCols || 3);

  // 8 Yêu Cầu Cấu Hình Toàn Cục & Sắp Xếp:
  const [batchTargetLang, setBatchTargetLang] = useState<string>(() => loadBatchExportConfig().batchTargetLang);
  const [batchDuckingVolume, setBatchDuckingVolume] = useState<number>(() => loadBatchExportConfig().batchDuckingVolume);
  const [batchDubbingEnabled, setBatchDubbingEnabled] = useState<boolean>(() => loadBatchExportConfig().batchDubbingEnabled);
  const [batchDubbingMode, setBatchDubbingMode] = useState<'single' | 'gender_multi'>(() => loadBatchExportConfig().batchDubbingMode);
  const [batchDubbingVoice, setBatchDubbingVoice] = useState<string>(() => loadBatchExportConfig().batchDubbingVoice);
  const [batchDubbingVoiceMale, setBatchDubbingVoiceMale] = useState<string>(() => loadBatchExportConfig().batchDubbingVoiceMale || 'vi-VN-NamMinhNeural');
  const [batchDubbingVoiceFemale, setBatchDubbingVoiceFemale] = useState<string>(() => loadBatchExportConfig().batchDubbingVoiceFemale || 'vi-VN-HoaiMyNeural');
  const [batchDubbingSpeed, setBatchDubbingSpeed] = useState<number>(() => loadBatchExportConfig().batchDubbingSpeed ?? 1.0);
  const [batchExportFormat, setBatchExportFormat] = useState<'mp4' | 'mkv'>(() => loadBatchExportConfig().batchExportFormat);
  const [batchExportResolution, setBatchExportResolution] = useState<'original' | '1080p' | '720p' | '2k'>(() => loadBatchExportConfig().batchExportResolution);
  const [batchExportAspectRatio, setBatchExportAspectRatio] = useState<'original' | '9:16' | '16:9'>(() => loadBatchExportConfig().batchExportAspectRatio);
  const [sortMode, setSortMode] = useState<'ep_asc' | 'ep_desc' | 'name_asc' | 'name_desc' | 'status' | 'duration'>(() => loadBatchExportConfig().sortMode || 'ep_asc');

  // Các công đoạn thực hiện hàng loạt (Batch Stages Selector)
  const [batchStages, setBatchStages] = useState<{
    ocr: boolean;
    translate: boolean;
    dubbing: boolean;
    export: boolean;
  }>(() => loadBatchExportConfig().batchStages);

  const isBatchInitialLoaded = useRef<boolean>(false);
  const lastSavedConfigJson = useRef<string>('');
  const isSyncingFromExternal = useRef<boolean>(false);

  // 1. Nạp và đồng bộ cấu hình từ Backend Pipeline Settings (pipeline_settings.json trên đĩa)
  useEffect(() => {
    let isMounted = true;
    apiClient
      .getPipelineSettings()
      .then((pipe) => {
        if (!isMounted || !pipe) {
          isBatchInitialLoaded.current = true;
          return;
        }
        const reconciled = reconcileBatchConfigWithBackend(loadBatchExportConfig(), pipe);
        setBatchTargetLang(reconciled.batchTargetLang);
        setBatchDuckingVolume(reconciled.batchDuckingVolume);
        setBatchDubbingEnabled(reconciled.batchDubbingEnabled);
        setBatchDubbingMode(reconciled.batchDubbingMode);
        setBatchDubbingVoice(reconciled.batchDubbingVoice);
        if (reconciled.batchDubbingVoiceMale) setBatchDubbingVoiceMale(reconciled.batchDubbingVoiceMale);
        if (reconciled.batchDubbingVoiceFemale) setBatchDubbingVoiceFemale(reconciled.batchDubbingVoiceFemale);
        if (reconciled.batchDubbingSpeed !== undefined) setBatchDubbingSpeed(reconciled.batchDubbingSpeed);
        setBatchExportFormat(reconciled.batchExportFormat);
        setBatchExportResolution(reconciled.batchExportResolution);
        setBatchExportAspectRatio(reconciled.batchExportAspectRatio);
        setBatchStages(reconciled.batchStages);
        if (reconciled.activeBatchPresetId) setActiveBatchPresetId(reconciled.activeBatchPresetId);
        if (reconciled.sortMode) setSortMode(reconciled.sortMode);
        if (reconciled.gridCols) setGridCols(reconciled.gridCols);

        saveBatchExportConfig(reconciled);
        lastSavedConfigJson.current = JSON.stringify(reconciled);
        isBatchInitialLoaded.current = true;
      })
      .catch((err) => {
        console.warn('Không thể nạp pipeline settings trên DashboardBatchHub:', err);
        isBatchInitialLoaded.current = true;
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Lắng nghe sự kiện đồng bộ cấu hình từ GlobalSettingsView / Inspector Panel trong thời gian thực (loại trừ self-event)
  useEffect(() => {
    const handleGlobalSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<GlobalPipelineSettings & { _source?: string }>;
      const pipe = customEvent.detail;
      if (!pipe || pipe._source === 'DashboardBatchHub') return;

      const reconciled = reconcileBatchConfigWithBackend(loadBatchExportConfig(), pipe);
      const newConfigJson = JSON.stringify(reconciled);
      if (newConfigJson === lastSavedConfigJson.current) return;

      isSyncingFromExternal.current = true;
      lastSavedConfigJson.current = newConfigJson;

      setBatchTargetLang(reconciled.batchTargetLang);
      setBatchDuckingVolume(reconciled.batchDuckingVolume);
      setBatchDubbingEnabled(reconciled.batchDubbingEnabled);
      setBatchDubbingMode(reconciled.batchDubbingMode);
      setBatchDubbingVoice(reconciled.batchDubbingVoice);
      if (reconciled.batchDubbingVoiceMale) setBatchDubbingVoiceMale(reconciled.batchDubbingVoiceMale);
      if (reconciled.batchDubbingVoiceFemale) setBatchDubbingVoiceFemale(reconciled.batchDubbingVoiceFemale);
      if (reconciled.batchDubbingSpeed !== undefined) setBatchDubbingSpeed(reconciled.batchDubbingSpeed);
      setBatchExportFormat(reconciled.batchExportFormat);
      setBatchExportResolution(reconciled.batchExportResolution);
      setBatchExportAspectRatio(reconciled.batchExportAspectRatio);
      setBatchStages(reconciled.batchStages);
      if (reconciled.activeBatchPresetId) setActiveBatchPresetId(reconciled.activeBatchPresetId);
      if (reconciled.sortMode) setSortMode(reconciled.sortMode);
      if (reconciled.gridCols) setGridCols(reconciled.gridCols);
      saveBatchExportConfig(reconciled);
    };

    window.addEventListener('pipeline-settings-updated', handleGlobalSettingsUpdated);
    return () => {
      window.removeEventListener('pipeline-settings-updated', handleGlobalSettingsUpdated);
    };
  }, []);

  // 2. Tự động lưu cấu hình mỗi khi có bất kỳ thay đổi nào từ phía người dùng
  useEffect(() => {
    // Luôn lưu snapshot vào localStorage ngay lập tức
    const currentConfig: BatchExportConfig = {
      batchTargetLang,
      batchDuckingVolume,
      batchDubbingEnabled,
      batchDubbingMode,
      batchDubbingVoice,
      batchDubbingVoiceMale,
      batchDubbingVoiceFemale,
      batchDubbingSpeed,
      batchExportFormat,
      batchExportResolution,
      batchExportAspectRatio,
      batchStages,
      activeBatchPresetId,
      sortMode,
      gridCols,
    };
    saveBatchExportConfig(currentConfig);

    const currentConfigJson = JSON.stringify(currentConfig);

    if (!isBatchInitialLoaded.current) {
      lastSavedConfigJson.current = currentConfigJson;
      return;
    }

    if (isSyncingFromExternal.current) {
      isSyncingFromExternal.current = false;
      lastSavedConfigJson.current = currentConfigJson;
      return;
    }

    // Nếu cấu hình không hề thay đổi so với bản đã lưu, không trigger lại tiến trình lưu
    if (currentConfigJson === lastSavedConfigJson.current) {
      return;
    }

    lastSavedConfigJson.current = currentConfigJson;

    // Debounce đồng bộ xuống backend pipeline settings (lưu vào pipeline_settings.json trên đĩa)
    const syncTimer = setTimeout(async () => {
      try {
        const currentPipe = await apiClient.getPipelineSettings();
        if (currentPipe) {
          const updatedPipe: GlobalPipelineSettings = {
            ...currentPipe,
            translation: {
              ...currentPipe.translation,
              target_language: (['zh', 'en', 'vi', 'none'].includes(batchTargetLang)
                ? (batchTargetLang as any)
                : currentPipe.translation.target_language),
            },
            dubbing: {
              ...currentPipe.dubbing,
              enabled: batchDubbingEnabled,
              ducking_volume: batchDuckingVolume / 100,
              voice: batchDubbingVoice || currentPipe.dubbing.voice,
              voice_male: batchDubbingVoiceMale || currentPipe.dubbing.voice_male,
              voice_female: batchDubbingVoiceFemale || currentPipe.dubbing.voice_female,
              provider: detectVoiceProvider(batchDubbingMode === 'gender_multi' ? (batchDubbingVoiceMale || 'vi-VN-NamMinhNeural') : (batchDubbingVoice || 'vi-VN-NamMinhNeural')) as any,
              rate: batchDubbingSpeed === 1.0 ? '+0%' : (batchDubbingSpeed > 1 ? `+${Math.round((batchDubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - batchDubbingSpeed) * 100)}%`),
              speed: batchDubbingSpeed,
              mode: batchDubbingMode === 'gender_multi' ? 'multi' : 'single',
            },
            batch: {
              target_lang: batchTargetLang,
              ducking_volume: batchDuckingVolume,
              dubbing_enabled: batchDubbingEnabled,
              dubbing_mode: batchDubbingMode,
              dubbing_voice: batchDubbingVoice,
              dubbing_voice_male: batchDubbingVoiceMale,
              dubbing_voice_female: batchDubbingVoiceFemale,
              dubbing_speed: batchDubbingSpeed,
              export_format: batchExportFormat,
              export_resolution: batchExportResolution,
              export_aspect_ratio: batchExportAspectRatio,
              stage_ocr: batchStages.ocr,
              stage_translate: batchStages.translate,
              stage_dubbing: batchStages.dubbing,
              stage_export: batchStages.export,
              active_preset_id: activeBatchPresetId,
              sort_mode: sortMode,
              grid_cols: gridCols,
            },
          };
          await apiClient.savePipelineSettings(updatedPipe);
          window.dispatchEvent(
            new CustomEvent('pipeline-settings-updated', {
              detail: { ...updatedPipe, _source: 'DashboardBatchHub' },
            })
          );
        }
      } catch (err) {
        console.warn('Lỗi đồng bộ cấu hình sang backend pipeline_settings:', err);
      }
    }, 400);

    return () => {
      clearTimeout(syncTimer);
    };
  }, [
    batchTargetLang,
    batchDuckingVolume,
    batchDubbingEnabled,
    batchDubbingMode,
    batchDubbingVoice,
    batchDubbingVoiceMale,
    batchDubbingVoiceFemale,
    batchDubbingSpeed,
    batchExportFormat,
    batchExportResolution,
    batchExportAspectRatio,
    batchStages,
    activeBatchPresetId,
    sortMode,
    gridCols,
  ]);

  // Trạng thái chạy lẻ cho từng video trong Episode Inspector
  const [singleActionStatus, setSingleActionStatus] = useState<Record<string, string>>({});
  const [isSingleRunning, setIsSingleRunning] = useState<boolean>(false);

  // Popup Modals: Bánh răng chi tiết tập & Xác nhận chạy hàng loạt
  const [inspectingProject, setInspectingProject] = useState<ProjectManifestV1 | null>(null);
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState<boolean>(false);

  // Inspector Modal states (Fix thời lượng 00:00, xem MP4 xuất bản, verify đường dẫn)
  const [inspectorDuration, setInspectorDuration] = useState<number | null>(null);
  const [previewVideoMode, setPreviewVideoMode] = useState<'rendered' | 'raw'>('rendered');
  const [isRevealingFolder, setIsRevealingFolder] = useState<boolean>(false);
  const [copyFeedbackText, setCopyFeedbackText] = useState<string | null>(null);

  // Inspector Tabs: 'specs' | 'roi' | 'settings'
  const [inspectorTab, setInspectorTab] = useState<'specs' | 'roi' | 'settings'>('specs');

  // Video aspect ratio & size tracking
  const [isPortraitVideo, setIsPortraitVideo] = useState<boolean>(false);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [videoContainerSize, setVideoContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // ROI adjustment state
  const [isEditingRoi, setIsEditingRoi] = useState<boolean>(false);
  const [currentRoi, setCurrentRoi] = useState<RegionTrackV1>({
    region_id: 'roi-custom',
    x: 0.08,
    y: 0.78,
    width: 0.84,
    height: 0.18,
  });
  const [isSavingRoiAndRescan, setIsSavingRoiAndRescan] = useState<boolean>(false);
  const [roiStatusMessage, setRoiStatusMessage] = useState<string | null>(null);

  // Settings state for Inspector Modal
  const [globalPipelineSettings, setGlobalPipelineSettings] = useState<GlobalPipelineSettings | null>(null);
  const [useCustomProjectSettings, setUseCustomProjectSettings] = useState<boolean>(false);
  const [projectSettingsForm, setProjectSettingsForm] = useState<GlobalPipelineSettings | null>(null);
  const [isSavingCustomSettings, setIsSavingCustomSettings] = useState<boolean>(false);
  const [customSettingsFeedback, setCustomSettingsFeedback] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<Array<{ voice_id: string; display_name: string; lang: string }>>([
    { voice_id: 'vi-VN-NamMinhNeural', display_name: 'Nam Minh (Truyền cảm)', lang: 'vi' },
    { voice_id: 'vi-VN-HoaiMyNeural', display_name: 'Hoài My (Dịu dàng)', lang: 'vi' },
    { voice_id: 'BV075_streaming', display_name: 'Thanh Niên Tự Tin (CapCut)', lang: 'vi' },
    { voice_id: 'BV074_streaming', display_name: 'Cô Gái Hoạt Ngôn (CapCut)', lang: 'vi' },
    { voice_id: 'BV421_vivn_streaming', display_name: 'Nhỏ Ngọt Ngào (CapCut)', lang: 'vi' },
    { voice_id: 'Puck', display_name: 'Puck (Gemini TTS)', lang: 'all' },
    { voice_id: 'Kore', display_name: 'Kore (Gemini TTS)', lang: 'all' },
  ]);

  useEffect(() => {
    if (!videoBoxRef.current) return;
    const updateSize = () => {
      if (videoBoxRef.current) {
        const rect = videoBoxRef.current.getBoundingClientRect();
        setVideoContainerSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(videoBoxRef.current);
    return () => observer.disconnect();
  }, [inspectingProject, isEditingRoi, isPortraitVideo]);

  const handleOpenInspector = async (proj: ProjectManifestV1) => {
    setInspectingProject(proj);
    setInspectorDuration(null);
    setPreviewVideoMode(proj.has_export ? 'rendered' : 'raw');
    setCopyFeedbackText(null);
    setInspectorTab('specs');
    setIsEditingRoi(false);
    setIsPortraitVideo(false);
    setRoiStatusMessage(null);
    setCustomSettingsFeedback(null);

    // Khởi tạo ROI từ dự án hoặc mặc định
    if (proj.regions && proj.regions.length > 0) {
      setCurrentRoi({ ...proj.regions[0] });
    } else {
      setCurrentRoi({
        region_id: 'roi-custom',
        x: 0.08,
        y: 0.78,
        width: 0.84,
        height: 0.18,
      });
    }

    // Tải cấu hình toàn cục & hợp nhất với cấu hình riêng
    try {
      const gSettings = await apiClient.getPipelineSettings();
      setGlobalPipelineSettings(gSettings);

      const hasCustom = !!proj.custom_pipeline_settings && Object.keys(proj.custom_pipeline_settings).length > 0;
      setUseCustomProjectSettings(hasCustom);

      const merged: GlobalPipelineSettings = JSON.parse(JSON.stringify(gSettings));
      if (hasCustom && proj.custom_pipeline_settings) {
        if (proj.custom_pipeline_settings.ocr) merged.ocr = { ...merged.ocr, ...proj.custom_pipeline_settings.ocr };
        if (proj.custom_pipeline_settings.translation) merged.translation = { ...merged.translation, ...proj.custom_pipeline_settings.translation };
        if (proj.custom_pipeline_settings.dubbing) merged.dubbing = { ...merged.dubbing, ...proj.custom_pipeline_settings.dubbing };
        if (proj.custom_pipeline_settings.render) merged.render = { ...merged.render, ...proj.custom_pipeline_settings.render };
      }
      setProjectSettingsForm(merged);
    } catch (err) {
      console.warn('Error loading pipeline settings:', err);
    }

    // Tải thông tin tươi mới nhất của dự án từ backend để đảm bảo số liệu câu/thời lượng/trạng thái luôn chuẩn 100%
    apiClient
      .getProject(proj.project_id)
      .then((freshProj) => {
        if (freshProj) {
          setInspectingProject(freshProj);
          if (freshProj.regions && freshProj.regions.length > 0) {
            setCurrentRoi({ ...freshProj.regions[0] });
          }
          if (freshProj.media_metadata?.duration) {
            setInspectorDuration(freshProj.media_metadata.duration);
          }
        }
      })
      .catch((err) => console.warn('Không thể refresh inspecting project:', err));

    // Tải danh mục giọng đọc TTS
    try {
      const cat = await apiClient.getTTSCatalog();
      if (cat) {
        const list: Array<{ voice_id: string; display_name: string; lang: string }> = [];
        Object.values(cat).forEach((voices) => {
          voices.forEach((v) => list.push({ voice_id: v.voice_id, display_name: v.display_name, lang: v.lang }));
        });
        if (list.length > 0) setTtsVoices(list);
      }
    } catch {}
  };

  const applyRoiPreset = async (preset: 'auto' | 'bottom_1_line' | 'bottom_2_lines' | 'portrait_tiktok') => {
    if (!inspectingProject) return;
    if (preset === 'auto') {
      setRoiStatusMessage('Đang tự động phát hiện vùng chữ...');
      try {
        const res = await apiClient.autoDetectRoi(inspectingProject.project_id);
        if (res && res.region) {
          setCurrentRoi({ ...res.region, region_id: 'roi-custom' });
          setRoiStatusMessage(`✓ Phát hiện vùng chữ thành công (${res.detected_count || 0} khung chữ)!`);
        } else {
          setRoiStatusMessage('Không phát hiện thấy chữ, giữ nguyên vùng hiện tại.');
        }
      } catch (err: any) {
        setRoiStatusMessage(`Lỗi quét tự động: ${err.message}`);
      }
      setTimeout(() => setRoiStatusMessage(null), 3000);
      return;
    }

    if (preset === 'bottom_1_line') {
      setCurrentRoi((prev: RegionTrackV1) => ({
        ...prev,
        region_id: 'roi-custom',
        x: 0.08,
        y: 0.84,
        width: 0.84,
        height: 0.12,
      }));
    } else if (preset === 'bottom_2_lines') {
      setCurrentRoi((prev: RegionTrackV1) => ({
        ...prev,
        region_id: 'roi-custom',
        x: 0.08,
        y: 0.76,
        width: 0.84,
        height: 0.20,
      }));
    } else if (preset === 'portrait_tiktok') {
      setCurrentRoi((prev: RegionTrackV1) => ({
        ...prev,
        region_id: 'roi-custom',
        x: 0.05,
        y: 0.70,
        width: 0.90,
        height: 0.22,
      }));
    }
  };

  const handleSaveRoiAndRescan = async () => {
    if (!inspectingProject) return;
    setIsSavingRoiAndRescan(true);
    setRoiStatusMessage('Đang lưu khung ROI và quét lại OCR...');
    const pid = inspectingProject.project_id;
    try {
      const otherRegions = (inspectingProject.regions || []).filter((r) => r.region_id !== (currentRoi.region_id || 'roi-custom'));
      const updatedRegions = [{ ...currentRoi, region_id: currentRoi.region_id || 'roi-custom' }, ...otherRegions];
      await apiClient.saveRegions(pid, updatedRegions);
      await apiClient.runPipeline(pid, { sync: true });
      const updated = await apiClient.getProject(pid);
      if (updated) {
        setInspectingProject(updated);
        setRoiStatusMessage(`✓ Quét lại hoàn tất: Nhận diện ${updated.cues_count || 0} câu phụ đề!`);
      }
      onRefreshProjects();
    } catch (err: any) {
      setRoiStatusMessage(`Lỗi quét lại: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsSavingRoiAndRescan(false);
      setTimeout(() => setRoiStatusMessage(null), 4000);
    }
  };

  const handleSaveCustomProjectSettings = async () => {
    if (!inspectingProject || !projectSettingsForm) return;
    setIsSavingCustomSettings(true);
    setCustomSettingsFeedback(null);
    const pid = inspectingProject.project_id;
    try {
      if (useCustomProjectSettings) {
        await apiClient.saveProjectSettings(pid, projectSettingsForm);
        setCustomSettingsFeedback('✓ Đã lưu cài đặt riêng cho tập này!');
      } else {
        await apiClient.resetProjectSettings(pid);
        setCustomSettingsFeedback('✓ Đã khôi phục cài đặt theo Toàn cục!');
      }
      const updated = await apiClient.getProject(pid);
      if (updated) setInspectingProject(updated);
      onRefreshProjects();
    } catch (err: any) {
      setCustomSettingsFeedback(`Lỗi: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsSavingCustomSettings(false);
      setTimeout(() => setCustomSettingsFeedback(null), 3500);
    }
  };

  const handleResetCustomSettings = async () => {
    if (!inspectingProject || !globalPipelineSettings) return;
    setIsSavingCustomSettings(true);
    const pid = inspectingProject.project_id;
    try {
      await apiClient.resetProjectSettings(pid);
      setUseCustomProjectSettings(false);
      setProjectSettingsForm(JSON.parse(JSON.stringify(globalPipelineSettings)));
      setCustomSettingsFeedback('✓ Đã khôi phục về Cài đặt Toàn cục!');
      const updated = await apiClient.getProject(pid);
      if (updated) setInspectingProject(updated);
      onRefreshProjects();
    } catch (err: any) {
      setCustomSettingsFeedback(`Lỗi: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsSavingCustomSettings(false);
      setTimeout(() => setCustomSettingsFeedback(null), 3500);
    }
  };

  const handleCopyPath = (path?: string | null, label: string = 'đường dẫn') => {
    if (!path) return;
    navigator.clipboard.writeText(path);
    setCopyFeedbackText(`Đã sao chép ${label}!`);
    setTimeout(() => setCopyFeedbackText(null), 2500);
  };

  const handleRevealExport = async (projectId: string) => {
    setIsRevealingFolder(true);
    try {
      const res = await apiClient.revealProjectExport(projectId);
      if (res && !res.success && res.error) {
        alert(`Không thể mở thư mục: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Lỗi khi mở thư mục xuất: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsRevealingFolder(false);
    }
  };

  // Chế độ xem: Theo Bộ phim (Folder Level) hay Tất cả tập (Flat Level)
  const [dramaViewMode, setDramaViewMode] = useState<'folders' | 'flat'>(() => {
    try {
      const saved = localStorage.getItem('sls_drama_view_mode');
      return saved === 'flat' ? 'flat' : 'folders';
    } catch {
      return 'folders';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sls_drama_view_mode', dramaViewMode);
    } catch {
      // ignore
    }
  }, [dramaViewMode]);

  // Bộ phim đang được mở để xem danh sách tập (null nghĩa là đang ở Cấp 1: Danh sách các Bộ phim)
  const [internalSelectedDramaTitle, setInternalSelectedDramaTitle] = useState<string | null>(null);
  const selectedDramaTitle = propSelectedDramaTitle !== undefined ? propSelectedDramaTitle : internalSelectedDramaTitle;
  const setSelectedDramaTitle = (t: string | null) => {
    if (onSelectDramaTitle) onSelectDramaTitle(t);
    setInternalSelectedDramaTitle(t);
  };

  // Tìm kiếm theo tên bộ phim / tên video
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 1. Phân loại và gom nhóm dự án theo từng Bộ phim lớn (Multi-Drama Grouping)
  const dramaGroups = useMemo(() => {
    const map = new Map<string, ProjectManifestV1[]>();
    projects.forEach((proj) => {
      const { dramaTitle } = extractDramaInfo(proj.title, proj.source_video_path);
      if (!map.has(dramaTitle)) {
        map.set(dramaTitle, []);
      }
      map.get(dramaTitle)!.push(proj);
    });

    // Sắp xếp các tập trong từng bộ phim theo số tập tăng dần
    map.forEach((episodes) => {
      episodes.sort((a, b) => {
        const epA = extractDramaInfo(a.title, a.source_video_path).episodeNumber;
        const epB = extractDramaInfo(b.title, b.source_video_path).episodeNumber;
        return epA - epB;
      });
    });

    return map;
  }, [projects]);

  // Tự động dọn selectedDramaTitle nếu bộ phim đó không còn tồn tại trong danh sách dự án
  useEffect(() => {
    if (selectedDramaTitle && projects.length > 0 && !dramaGroups.has(selectedDramaTitle)) {
      setSelectedDramaTitle(null);
    }
  }, [selectedDramaTitle, projects, dramaGroups]);

  // Danh sách các bộ phim đã lọc theo tìm kiếm
  const filteredDramaEntries = useMemo(() => {
    const entries = Array.from(dramaGroups.entries());
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(([dramaTitle, eps]) => {
      return (
        dramaTitle.toLowerCase().includes(q) ||
        eps.some((p) => p.title.toLowerCase().includes(q))
      );
    });
  }, [dramaGroups, searchQuery]);

  // Danh sách video cơ sở để hiển thị (được lọc theo bộ phim đang chọn nếu có)
  const baseProjectsToDisplay = useMemo(() => {
    if (dramaViewMode === 'folders' && selectedDramaTitle) {
      return dramaGroups.get(selectedDramaTitle) || [];
    }
    return projects;
  }, [dramaViewMode, selectedDramaTitle, dramaGroups, projects]);

  // Danh sách video đã được sắp xếp tự động
  const sortedProjects = useMemo(() => {
    let list = [...baseProjectsToDisplay];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q));
    }
    switch (sortMode) {
      case 'ep_asc':
        return list.sort((a, b) => {
          const epA = extractEpisodeNumber(a.title);
          const epB = extractEpisodeNumber(b.title);
          return epA !== epB ? epA - epB : a.title.localeCompare(b.title, 'vi');
        });
      case 'ep_desc':
        return list.sort((a, b) => {
          const epA = extractEpisodeNumber(a.title);
          const epB = extractEpisodeNumber(b.title);
          return epA !== epB ? epB - epA : b.title.localeCompare(a.title, 'vi');
        });
      case 'name_asc':
        return list.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
      case 'name_desc':
        return list.sort((a, b) => b.title.localeCompare(a.title, 'vi'));
      case 'status':
        return list.sort((a, b) => {
          const scoreA = (a.has_export ? 4 : 0) + (a.has_voiceover ? 2 : 0) + ((a.translated_count || 0) > 0 ? 1 : 0);
          const scoreB = (b.has_export ? 4 : 0) + (b.has_voiceover ? 2 : 0) + ((b.translated_count || 0) > 0 ? 1 : 0);
          return scoreA - scoreB;
        });
      case 'duration':
        return list.sort((a, b) => {
          const durA = (a as any).duration || a.media_metadata?.duration || 0;
          const durB = (b as any).duration || b.media_metadata?.duration || 0;
          return durA - durB;
        });
      default:
        return list;
    }
  }, [baseProjectsToDisplay, searchQuery, sortMode]);

  // Chạy hàng loạt cho cả 1 bộ phim
  const handleRunBatchDrama = (_dramaTitle: string, dramaProjects: ProjectManifestV1[]) => {
    setSelectedProjectIds(dramaProjects.map((p) => p.project_id));
    setShowBatchConfirmModal(true);
  };

  // Xóa toàn bộ các tập của 1 bộ phim
  const handleDeleteDrama = async (dramaTitle: string, dramaProjects: ProjectManifestV1[]) => {
    const ids = dramaProjects.map((p) => p.project_id);
    if (ids.length === 0) return;
    try {
      await apiClient.batchDeleteProjects(ids);
      setSelectedProjectIds((prev) => prev.filter((id) => !ids.includes(id)));
      if (selectedDramaTitle === dramaTitle) {
        setSelectedDramaTitle(null);
      }
      onRefreshProjects();
    } catch (err: any) {
      alert(`Lỗi khi xóa bộ phim: ${err?.message || 'Thất bại'}`);
    }
  };

  // Trạng thái các Layer mặc định
  const [layerVisibility] = useState({
    video: true,
    watermark: true,
    sourceSub: false, // Che sub gốc
    translatedSub: true, // Hiện sub dịch
    title: true,
    mask: true, // Bật dải mờ
    audio: true,
    voiceover: true,
  });

  // Trạng thái Sequential FIFO Queue
  const [isQueueRunning, setIsQueueRunning] = useState<boolean>(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);
  const [queueItems, setQueueItems] = useState<BatchQueueItem[]>([]);
  const [queueStatusMessage, setQueueStatusMessage] = useState<string | null>(null);

  const isPausedRef = useRef<boolean>(false);
  const isCancelledRef = useRef<boolean>(false);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const [isBatchUploading, setIsBatchUploading] = useState<boolean>(false);
  const [batchUploadStatus, setBatchUploadStatus] = useState<string | null>(null);

  // Trạng thái Gemini Key Pool Modal & Status
  const [showGeminiPoolModal, setShowGeminiPoolModal] = useState<boolean>(false);
  const [geminiPoolStatus, setGeminiPoolStatus] = useState<GeminiPoolStatus | null>(null);
  const [poolInputText, setPoolInputText] = useState<string>('');
  const [isSavingPool, setIsSavingPool] = useState<boolean>(false);
  const [activePoolTab, setActivePoolTab] = useState<'list' | 'input'>('list');
  const [poolSearchQuery, setPoolSearchQuery] = useState<string>('');
  const [poolStatusFilter, setPoolStatusFilter] = useState<'all' | 'usable' | 'cooldown' | 'invalid'>('all');
  const [isVerifyingPool, setIsVerifyingPool] = useState<boolean>(false);
  const [verifyingKeyIndex, setVerifyingKeyIndex] = useState<number | null>(null);
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);

  const fetchGeminiPoolStatus = useCallback(async () => {
    try {
      const res = await apiClient.getGeminiPoolStatus();
      setGeminiPoolStatus(res);
    } catch {}
  }, []);

  useEffect(() => {
    fetchGeminiPoolStatus();
    const timer = setInterval(fetchGeminiPoolStatus, 8000);
    return () => clearInterval(timer);
  }, [fetchGeminiPoolStatus]);

  const filteredKeyItems = useMemo(() => {
    const raw = geminiPoolStatus?.items || [];
    return raw.filter((item) => {
      if (poolSearchQuery.trim()) {
        const q = poolSearchQuery.toLowerCase();
        const matchKey = item.masked_key.toLowerCase().includes(q);
        const matchIdx = `#${item.index}`.includes(q) || `${item.index}` === q;
        if (!matchKey && !matchIdx) return false;
      }
      if (poolStatusFilter === 'usable') return item.is_usable;
      if (poolStatusFilter === 'cooldown') return item.status === 'cooldown' || item.status === 'daily_exhausted';
      if (poolStatusFilter === 'invalid') return item.status === 'invalid' || item.status === 'error';
      return true;
    });
  }, [geminiPoolStatus?.items, poolSearchQuery, poolStatusFilter]);

  const defaultPreset = getDefaultPreset(presets);

  const handleToggleSelectProject = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
    );
  };

  // Trạng thái UrlDownloadModal & Batch Delete
  const [showUrlDownloadModal, setShowUrlDownloadModal] = useState<boolean>(false);
  const [showDeviceSettingsModal, setShowDeviceSettingsModal] = useState<boolean>(false);
  const [isDeletingBatch, setIsDeletingBatch] = useState<boolean>(false);
  const [deleteConfirmType, setDeleteConfirmType] = useState<'selected' | 'all' | null>(null);

  const handleConfirmDelete = async () => {
    if (!deleteConfirmType) return;
    setIsDeletingBatch(true);
    try {
      const idsToDelete =
        deleteConfirmType === 'selected'
          ? selectedProjectIds
          : projects.map((p) => p.project_id);

      if (idsToDelete.length > 0) {
        await apiClient.batchDeleteProjects(idsToDelete);
        setSelectedProjectIds([]);
        onRefreshProjects();
      }
    } catch (err: any) {
      alert(`Lỗi khi xóa dự án: ${err?.message || 'Không thể xóa dự án'}`);
    } finally {
      setIsDeletingBatch(false);
      setDeleteConfirmType(null);
    }
  };

  const handleSelectAll = () => {
    if (selectedProjectIds.length === projects.length) {
      setSelectedProjectIds([]);
    } else {
      setSelectedProjectIds(projects.map((p) => p.project_id));
    }
  };

  // Nạp nhiều file video cùng lúc (Batch File Upload)
  const handleBatchFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsBatchUploading(true);
    const total = files.length;
    const created: ProjectManifestV1[] = [];
    const chosenPreset = presets.find((p) => p.id === activeBatchPresetId) || defaultPreset;

    try {
      for (let i = 0; i < total; i++) {
        const file = files[i];
        setBatchUploadStatus(`Đang nạp file (${i + 1}/${total}): ${file.name}...`);
        const uploadRes = await apiClient.uploadVideo(file);
        const title = file.name.replace(/\.[^/.]+$/, '');
        const newProj = await apiClient.createProject({
          title,
          source_video_path: uploadRes.path,
          source_language: chosenPreset.source_lang || 'zh',
          target_language: chosenPreset.target_lang || 'vi',
        });

        if (chosenPreset.roi) {
          try {
            await apiClient.saveRegions(newProj.project_id, [
              {
                region_id: 'roi-main',
                x: chosenPreset.roi.x,
                y: chosenPreset.roi.y,
                width: chosenPreset.roi.width,
                height: chosenPreset.roi.height,
              },
            ]);
          } catch {}
        }
        created.push(newProj);
      }

      setBatchUploadStatus(`✓ Nạp thành công ${created.length} video!`);
      setTimeout(() => setBatchUploadStatus(null), 3000);
      onRefreshProjects();
      if (onBatchProjectsCreated) onBatchProjectsCreated(created);
    } catch (err: any) {
      setBatchUploadStatus(`Lỗi nạp video: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsBatchUploading(false);
      if (batchFileInputRef.current) batchFileInputRef.current.value = '';
    }
  };

  // Chọn nhiều video từ máy tính (0 giây, không tốn upload qua mạng)
  const handlePickMultipleLocalVideos = async () => {
    setIsBatchUploading(true);
    setBatchUploadStatus('Đang mở hộp thoại chọn nhiều video từ máy tính...');
    try {
      const res = await apiClient.pickMultipleVideos();
      if (res && res.files && res.files.length > 0) {
        setBatchUploadStatus(`Đang tạo ${res.files.length} dự án từ file cục bộ (0s)...`);
        const chosenPreset = presets.find((p) => p.id === activeBatchPresetId) || defaultPreset;
        const items = res.files.map((f) => ({
          title: f.filename ? f.filename.replace(/\.[^/.]+$/, '') : f.path.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Video',
          source_video_path: f.path,
          source_language: chosenPreset.source_lang || 'zh',
          target_language: chosenPreset.target_lang || 'vi',
        }));
        const regions = chosenPreset.roi ? [{
          region_id: 'roi-main',
          x: chosenPreset.roi.x,
          y: chosenPreset.roi.y,
          width: chosenPreset.roi.width,
          height: chosenPreset.roi.height,
        }] : undefined;
        const created = await apiClient.batchCreateProjects(items, regions);
        setBatchUploadStatus(`✓ Nạp thành công ${created.length} video tức thì (0s)!`);
        setTimeout(() => setBatchUploadStatus(null), 3500);
        onRefreshProjects();
        if (onBatchProjectsCreated) onBatchProjectsCreated(created);
      } else {
        setBatchUploadStatus(null);
      }
    } catch (err: any) {
      console.warn('Native picker error, fallback to browser input:', err);
      setBatchUploadStatus(null);
      batchFileInputRef.current?.click();
    } finally {
      setIsBatchUploading(false);
    }
  };

  // Chọn cả thư mục chứa video từ máy tính (0 giây, tự động quét tất cả video)
  const handlePickLocalFolder = async () => {
    setIsBatchUploading(true);
    setBatchUploadStatus('Đang mở hộp thoại chọn thư mục video...');
    try {
      const res = await apiClient.pickFolder();
      if (res && res.files && res.files.length > 0) {
        setBatchUploadStatus(`Đang tạo ${res.files.length} tập video từ thư mục (0s)...`);
        const chosenPreset = presets.find((p) => p.id === activeBatchPresetId) || defaultPreset;
        const items = res.files.map((f) => ({
          title: f.filename ? f.filename.replace(/\.[^/.]+$/, '') : f.path.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Video',
          source_video_path: f.path,
          source_language: chosenPreset.source_lang || 'zh',
          target_language: chosenPreset.target_lang || 'vi',
        }));
        const regions = chosenPreset.roi ? [{
          region_id: 'roi-main',
          x: chosenPreset.roi.x,
          y: chosenPreset.roi.y,
          width: chosenPreset.roi.width,
          height: chosenPreset.roi.height,
        }] : undefined;
        const created = await apiClient.batchCreateProjects(items, regions);
        setBatchUploadStatus(`✓ Nạp thành công ${created.length} tập video từ thư mục (0s)!`);
        setTimeout(() => setBatchUploadStatus(null), 3500);
        onRefreshProjects();
        if (onBatchProjectsCreated) onBatchProjectsCreated(created);
      } else {
        setBatchUploadStatus(null);
      }
    } catch (err: any) {
      console.warn('Folder picker error:', err);
      setBatchUploadStatus(`Không thể mở thư mục: ${err?.message || err}`);
      setTimeout(() => setBatchUploadStatus(null), 4000);
    } finally {
      setIsBatchUploading(false);
    }
  };

  // Vận hành thao tác cá nhân cho riêng 1 video cụ thể (Single Episode Runner)
  const handleRunSingleStage = async (
    project: ProjectManifestV1,
    stage: 'ocr' | 'translate' | 'dubbing' | 'export',
  ) => {
    setIsSingleRunning(true);
    const pid = project.project_id;
    try {
      if ((stage === 'translate' || stage === 'dubbing') && (project.cues_count || 0) === 0) {
        setSingleActionStatus((prev) => ({ ...prev, [pid]: '⚠ Cần quét phụ đề OCR trước khi thao tác!' }));
        setTimeout(() => {
          setSingleActionStatus((prev) => {
            const cp = { ...prev };
            delete cp[pid];
            return cp;
          });
        }, 4000);
        return;
      }

      if (stage === 'ocr') {
        setSingleActionStatus((prev) => ({ ...prev, [pid]: 'Đang quét OCR phụ đề...' }));
        await apiClient.runPipeline(pid, { sync: true });
        setSingleActionStatus((prev) => ({ ...prev, [pid]: '✓ Quét OCR thành công!' }));
      } else if (stage === 'translate') {
        setSingleActionStatus((prev) => ({ ...prev, [pid]: 'Đang dịch thuật AI...' }));
        await apiClient.retranslateProject(pid);
        setSingleActionStatus((prev) => ({ ...prev, [pid]: '✓ Dịch thuật AI thành công!' }));
      } else if (stage === 'dubbing') {
        setSingleActionStatus((prev) => ({ ...prev, [pid]: 'Đang tạo voiceover AI...' }));
        const dubSettings = project.custom_pipeline_settings?.dubbing;
        const mode = dubSettings?.mode || (batchDubbingMode === 'gender_multi' ? 'multi' : 'single');
        const chosenVoice = dubSettings?.voice || batchDubbingVoice;
        const maleVoice = dubSettings?.voice_male || batchDubbingVoiceMale;
        const femaleVoice = dubSettings?.voice_female || batchDubbingVoiceFemale;
        const rateStr = batchDubbingSpeed === 1.0 ? '+0%' : (batchDubbingSpeed > 1 ? `+${Math.round((batchDubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - batchDubbingSpeed) * 100)}%`);
        const provider = dubSettings?.provider || detectVoiceProvider(mode === 'multi' ? maleVoice : chosenVoice);
        await apiClient.runDubbing(pid, {
          mode,
          voice: chosenVoice,
          voice_male: maleVoice,
          voice_female: femaleVoice,
          provider,
          rate: dubSettings?.rate || rateStr,
        });
        setSingleActionStatus((prev) => ({ ...prev, [pid]: '✓ Tạo voiceover thành công!' }));
      } else if (stage === 'export') {
        setSingleActionStatus((prev) => ({ ...prev, [pid]: 'Đang kết xuất video MP4...' }));
        const chosenPreset = presets.find((p) => p.id === activeBatchPresetId) || defaultPreset;
        const customMask = project.custom_pipeline_settings?.render?.default_mask_style || chosenPreset?.mask_style || 'blur';
        await apiClient.exportMp4(pid, {
          use_translated: batchTargetLang !== 'none',
          mask_mode: customMask,
          flip_h: chosenPreset?.is_flipped_h ?? false,
          flip_v: chosenPreset?.is_flipped_v ?? false,
        });
        setSingleActionStatus((prev) => ({ ...prev, [pid]: '✓ Xuất video hoàn tất!' }));
      }
      onRefreshProjects();
      try {
        const updated = await apiClient.getProject(pid);
        if (updated) {
          setInspectingProject(updated);
          if (stage === 'export' && updated.has_export) {
            setPreviewVideoMode('rendered');
          }
        }
      } catch {}
      setTimeout(() => {
        setSingleActionStatus((prev) => {
          const next = { ...prev };
          delete next[pid];
          return next;
        });
      }, 3500);
    } catch (err: any) {
      setSingleActionStatus((prev) => ({
        ...prev,
        [pid]: `Lỗi: ${err?.message || 'Không thể thực hiện thao tác'}`,
      }));
      setTimeout(() => {
        setSingleActionStatus((prev) => {
          const next = { ...prev };
          delete next[pid];
          return next;
        });
      }, 4000);
    } finally {
      setIsSingleRunning(false);
    }
  };

  // Vận hành Hàng Đợi Tuần Tự (Sequential FIFO Queue)
  const handleStartQueue = async (action: 'all' | 'ocr' | 'translate' | 'dubbing' | 'export') => {
    const targets = selectedProjectIds.length > 0
      ? sortedProjects.filter((p) => selectedProjectIds.includes(p.project_id))
      : sortedProjects;

    if (targets.length === 0) return;

    const initialQueue: BatchQueueItem[] = targets.map((p) => ({
      projectId: p.project_id,
      title: p.title,
      status: 'pending',
    }));

    setQueueItems(initialQueue);
    setIsQueueRunning(true);
    setIsQueuePaused(false);
    isPausedRef.current = false;
    isCancelledRef.current = false;

    const runOcr = action === 'ocr' || (action === 'all' && batchStages.ocr);
    const runTranslate = action === 'translate' || (action === 'all' && batchStages.translate);
    const runDubbing = action === 'dubbing' || (action === 'all' && batchStages.dubbing);
    const runExport = action === 'export' || (action === 'all' && batchStages.export);

    const waitIfPaused = async (currentEpTitle: string, epIndex: number) => {
      if (isPausedRef.current) {
        setIsQueuePaused(true);
        setQueueStatusMessage(`⏸️ Đang tạm dừng ở tập [${epIndex + 1}/${targets.length}]: "${currentEpTitle}". Bấm "Tiếp tục" để chạy tiếp.`);
        while (isPausedRef.current) {
          await new Promise((r) => setTimeout(r, 300));
          if (isCancelledRef.current) break;
        }
        if (!isCancelledRef.current) {
          setIsQueuePaused(false);
        }
      }
    };

    for (let idx = 0; idx < targets.length; idx++) {
      if (isCancelledRef.current) break;

      const targetProj = targets[idx];
      await waitIfPaused(targetProj.title, idx);
      if (isCancelledRef.current) break;

      try {
        if (runOcr) {
          setQueueItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, status: 'scanning' } : it))
          );
          setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang quét OCR: "${targetProj.title}"...`);
          await apiClient.runPipeline(targetProj.project_id, { sync: true });
        }

        await waitIfPaused(targetProj.title, idx);
        if (isCancelledRef.current) break;

        if (runTranslate) {
          // Nếu đã chạy OCR trước đó trong cùng mẻ xử lý, pipeline backend đã hoàn tất cả khâu trích xuất và dịch thuật.
          // Chỉ gọi retranslate riêng khi người dùng bỏ chọn quét OCR (chỉ muốn dịch lại kịch bản sẵn có).
          if (!runOcr) {
            setQueueItems((prev) =>
              prev.map((it, i) => (i === idx ? { ...it, status: 'translating' } : it))
            );
            setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang dịch thuật AI: "${targetProj.title}"...`);
            if (batchTargetLang !== 'none') {
              await apiClient.retranslateProject(targetProj.project_id);
            }
          }
        }

        await waitIfPaused(targetProj.title, idx);
        if (isCancelledRef.current) break;

        if (runDubbing) {
          if (batchDubbingEnabled) {
            setQueueItems((prev) =>
              prev.map((it, i) => (i === idx ? { ...it, status: 'voicing' } : it))
            );
            setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang tạo thuyết minh AI: "${targetProj.title}"...`);
            try {
              const targetDubSettings = targetProj.custom_pipeline_settings?.dubbing;
              const mode = targetDubSettings?.mode || (batchDubbingMode === 'gender_multi' ? 'multi' : 'single');
              const chosenVoice = targetDubSettings?.voice || batchDubbingVoice;
              const maleVoice = targetDubSettings?.voice_male || batchDubbingVoiceMale;
              const femaleVoice = targetDubSettings?.voice_female || batchDubbingVoiceFemale;
              const rateStr = batchDubbingSpeed === 1.0 ? '+0%' : (batchDubbingSpeed > 1 ? `+${Math.round((batchDubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - batchDubbingSpeed) * 100)}%`);
              const provider = targetDubSettings?.provider || detectVoiceProvider(mode === 'multi' ? maleVoice : chosenVoice);
              await apiClient.runDubbing(targetProj.project_id, {
                mode,
                voice: chosenVoice,
                voice_male: maleVoice,
                voice_female: femaleVoice,
                provider,
                rate: targetDubSettings?.rate || rateStr,
              });
            } catch (err: any) {
              console.warn('Dubbing error:', err);
            }
          }
        }

        await waitIfPaused(targetProj.title, idx);
        if (isCancelledRef.current) break;

        if (runExport) {
          setQueueItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, status: 'exporting' } : it))
          );
          setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang render xuất video: "${targetProj.title}"...`);
          const chosenPreset = presets.find((p) => p.id === activeBatchPresetId) || defaultPreset;
          const targetMaskMode = chosenPreset?.mask_style || 'blur';
          await apiClient.exportMp4(targetProj.project_id, {
            use_translated: batchTargetLang !== 'none',
            mask_mode: targetMaskMode,
            flip_h: chosenPreset?.is_flipped_h ?? false,
            flip_v: chosenPreset?.is_flipped_v ?? false,
          });
        }

        setQueueItems((prev) =>
          prev.map((it, i) => (i === idx ? { ...it, status: 'completed' } : it))
        );
      } catch (err: any) {
        setQueueItems((prev) =>
          prev.map((it, i) =>
            i === idx ? { ...it, status: 'failed', error: err?.message || 'Thất bại' } : it
          )
        );
      }
    }

    setIsQueueRunning(false);
    setIsQueuePaused(false);
    isPausedRef.current = false;
    setQueueStatusMessage(isCancelledRef.current ? 'Đã dừng hàng đợi xử lý.' : '✓ Hoàn tất xử lý hàng đợi tuần tự!');
    setTimeout(() => setQueueStatusMessage(null), 4000);
    onRefreshProjects();
  };

  const handleCancelQueue = () => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    setIsQueuePaused(false);
    setIsQueueRunning(false);
    setQueueStatusMessage('Đã dừng hàng đợi xử lý.');
  };

  return (
    <div className="flex-1 w-full h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* File Input Ẩn cho Nạp File Hàng Loạt */}
      <input
        ref={batchFileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleBatchFileSelect}
      />

      {/* 1. Header Đỉnh Chuẩn Mẫu (Header Bar - Đồng bộ 100% với Studio) */}
      <header className="relative h-12 shrink-0 bg-slate-950 border-b border-slate-800/90 px-3 sm:px-4 flex items-center justify-between z-40 text-xs select-none shadow-md gap-2 overflow-x-auto no-scrollbar">
        {/* Trái: Logo & Các Tab Điều Hướng */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider shrink-0 whitespace-nowrap">
            <div className="p-1 bg-indigo-600 rounded text-white shadow shrink-0">
              <Film className="w-3.5 h-3.5" />
            </div>
            <span className="hidden sm:inline">Subtitle Localizer Studio</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs shrink-0">
            <button
              onClick={onNewProject}
              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-sm transition flex items-center gap-1.5 active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
              title="Tạo dự án mới"
            >
              <FolderPlus className="w-3.5 h-3.5 text-white shrink-0" />
              <span>Tạo Dự Án</span>
            </button>
            <button
              onClick={handlePickMultipleLocalVideos}
              className="px-2.5 py-1 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-emerald-300 font-semibold shadow-sm transition flex items-center gap-1.5 active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
              title="Chọn nhiều video từ máy tính (0s không cần upload)"
            >
              <FolderOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Nạp Nhanh Video (0s)</span>
            </button>
          </div>
        </div>

        {/* Phải: Ngôn ngữ, Keys Pool, Nhật Ký, Trạng thái Engine & Nút Vào Studio */}
        <div className="flex items-center gap-2 text-xs min-w-0 shrink-0 justify-end ml-auto">
          <div className="hidden xl:flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-[10px] font-mono shrink-0 whitespace-nowrap">
            <span className="text-cyan-400 font-bold">VI</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">ZH</span>
          </div>

          <button
            onClick={() => {
              setShowGeminiPoolModal(true);
              fetchGeminiPoolStatus();
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-amber-300 font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
            title="Quản lý danh sách API keys và xem trạng thái xoay tua"
          >
            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Pool: {geminiPoolStatus ? `${geminiPoolStatus.active_keys}/${geminiPoolStatus.total_keys}` : '...'} Keys
            </span>
            {geminiPoolStatus && geminiPoolStatus.cooldown_keys > 0 && (
              <span className="px-1 py-0.2 rounded bg-rose-900/80 text-rose-300 text-[9px] font-mono shrink-0">
                {geminiPoolStatus.cooldown_keys} nghỉ
              </span>
            )}
          </button>

          <button
            onClick={() => appLogger.toggle()}
            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white font-medium text-[11px] flex items-center gap-1.5 transition cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
            title="Nhật ký hoạt động hệ thống"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="hidden sm:inline">Nhật ký</span>
            {loggerCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 border border-slate-700 font-mono font-bold shrink-0">
                {loggerCount}
              </span>
            )}
          </button>

          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-emerald-400 shrink-0 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="font-semibold">Engine Sẵn Sàng</span>
          </div>

          <button
            onClick={() => {
              if (projects.length > 0) onSelectProject(projects[0]);
            }}
            disabled={projects.length === 0}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold rounded-lg text-xs transition shadow-md shadow-indigo-600/30 disabled:opacity-40 cursor-pointer shrink-0 whitespace-nowrap"
          >
            Vào Studio
          </button>
        </div>
      </header>

      {/* 2. Thân Chính: Lưới Video Hàng Loạt (Trái) + Sidebar Thành Phần & Chi Tiết (Phải) */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* CỘT TRÁI: Lưới Thẻ Video hoặc Lưới Folder Bộ Phim (Multi-Drama Architecture) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-slate-950/90">
          {/* A. Khi ở Cấp 1 (Chế độ Xem theo Bộ phim & Chưa chọn bộ phim nào) */}
          {dramaViewMode === 'folders' && !selectedDramaTitle ? (
            <>
              {/* Header Cấp 1: Danh sách các Bộ phim */}
              <div className="flex items-center justify-between px-1 flex-wrap gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                    <Folder className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                      <span>Danh sách Bộ phim</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/80">
                        {dramaGroups.size} bộ phim
                      </span>
                      <span className="text-xs text-slate-400 font-normal">
                        ({projects.length} tập video)
                      </span>
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Ô tìm kiếm bộ phim / tập */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Tìm bộ phim hoặc tập..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-2.5 py-1 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition w-44 sm:w-56"
                    />
                  </div>

                  {/* Toggle Chế độ xem: Theo Bộ phim <-> Tất cả tập */}
                  <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-lg">
                    <button
                      onClick={() => {
                        setDramaViewMode('folders');
                        setSelectedDramaTitle(null);
                      }}
                      className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition bg-indigo-600 text-white shadow"
                      title="Xem theo danh sách các Bộ phim lớn"
                    >
                      <Folder className="w-3.5 h-3.5" />
                      <span>Theo Bộ phim</span>
                    </button>
                    <button
                      onClick={() => setDramaViewMode('flat')}
                      className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition text-slate-400 hover:text-white"
                      title="Xem tất cả các tập dưới dạng lưới phẳng"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>Tất cả tập</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Thông báo trạng thái Queue / Upload */}
              {batchUploadStatus && (
                <div className="p-2.5 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-xs text-indigo-200 flex items-center justify-between shadow animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
                    <span>{batchUploadStatus}</span>
                  </div>
                </div>
              )}

              {/* Lưới các Bộ phim (DramaFolderCard) */}
              {projects.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
                  <Film className="w-12 h-12 text-indigo-400/80" />
                  <div className="space-y-1">
                    <h3 className="text-white font-semibold text-sm">Chưa có video nào trong danh mục</h3>
                    <p className="text-slate-400 text-xs max-w-md">
                      Chọn video trực tiếp từ máy tính để bắt đầu biên tập ngay lập tức (nhanh 0 giây, không tốn thời gian upload).
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap justify-center pt-2 relative">
                    <div className="inline-flex rounded-xl shadow-md bg-indigo-600 p-0.5">
                      <button
                        onClick={handlePickMultipleLocalVideos}
                        className="px-4 py-2 hover:bg-indigo-500 text-white text-xs font-bold rounded-l-lg transition cursor-pointer flex items-center gap-2 active:scale-95"
                        title="Chọn video trực tiếp từ máy tính (nhanh 0 giây)"
                      >
                        <FolderOpen className="w-4 h-4 text-white" />
                        <span>Thêm Video Từ Máy Tính (0s)</span>
                      </button>
                      <button
                        onClick={handlePickLocalFolder}
                        className="px-3 py-2 bg-indigo-700 hover:bg-indigo-600 border-l border-indigo-500/40 text-indigo-100 text-xs font-semibold rounded-r-lg transition cursor-pointer flex items-center gap-1.5"
                        title="Chọn cả thư mục chứa nhiều tập video"
                      >
                        <Folder className="w-3.5 h-3.5" />
                        <span>Thư Mục</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : filteredDramaEntries.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs bg-slate-900/30 rounded-xl border border-slate-800">
                  Không tìm thấy bộ phim nào khớp với từ khóa &quot;{searchQuery}&quot;
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredDramaEntries.map(([dTitle, dProjects]) => (
                    <DramaFolderCard
                      key={dTitle}
                      dramaTitle={dTitle}
                      projects={dProjects}
                      onOpenDrama={(t) => {
                        setSelectedDramaTitle(t);
                        setSelectedProjectIds([]);
                      }}
                      onRunBatchDrama={handleRunBatchDrama}
                      onDeleteDrama={handleDeleteDrama}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            /* B. Khi ở Cấp 2 (Xem các tập của 1 Bộ phim) hoặc Chế độ Flat (Tất cả tập) */
            <>
              {/* Breadcrumb Bar khi đang ở trong 1 Bộ phim */}
              {dramaViewMode === 'folders' && selectedDramaTitle && (
                <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl flex-wrap gap-2 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => {
                        setSelectedDramaTitle(null);
                        setSelectedProjectIds([]);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer border border-slate-700/80 shadow-sm group"
                      title="Quay lại danh sách các Bộ phim"
                    >
                      <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                      <span>Danh sách Bộ phim</span>
                    </button>
                    <span className="text-slate-600">/</span>
                    <div className="flex items-center gap-2">
                      <Film className="w-4 h-4 text-indigo-400" />
                      <h2 className="text-sm font-bold text-white tracking-wide truncate max-w-md">
                        {selectedDramaTitle}
                      </h2>
                      <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {sortedProjects.length} tập
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Toggle chế độ xem */}
                    <div className="flex items-center bg-slate-950 border border-slate-800 p-0.5 rounded-lg">
                      <button
                        onClick={() => {
                          setDramaViewMode('folders');
                          setSelectedDramaTitle(null);
                        }}
                        className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition bg-indigo-600 text-white shadow"
                      >
                        <Folder className="w-3.5 h-3.5" />
                        <span>Theo Bộ phim</span>
                      </button>
                      <button
                        onClick={() => setDramaViewMode('flat')}
                        className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition text-slate-400 hover:text-white"
                      >
                        <Film className="w-3.5 h-3.5" />
                        <span>Tất cả tập</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Header phụ phía trên lưới: Chọn tất cả, Xóa đã chọn & Xóa tất cả, Sắp xếp */}
              {sortedProjects.length > 0 && (
                <div className="flex items-center justify-between px-1 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleSelectAll}
                      className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition px-2.5 py-1 rounded bg-slate-900 border border-slate-800"
                    >
                      {selectedProjectIds.length === sortedProjects.length ? (
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>Chọn tất cả ({sortedProjects.length})</span>
                    </button>

                    {selectedProjectIds.length > 0 && (
                      <>
                        <span className="text-xs text-cyan-400 font-mono font-semibold">
                          Đã chọn: {selectedProjectIds.length} video
                        </span>
                        <button
                          onClick={() => setDeleteConfirmType('selected')}
                          disabled={isDeletingBatch || isQueueRunning}
                          className="flex items-center gap-1 text-xs text-rose-300 hover:text-white bg-rose-950/70 hover:bg-rose-900 border border-rose-800/60 px-2.5 py-1 rounded-lg transition disabled:opacity-40 shadow-sm"
                          title="Xóa các dự án đang được chọn"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                          <span>Xóa đã chọn ({selectedProjectIds.length})</span>
                        </button>
                      </>
                    )}

                    <button
                      onClick={() => setDeleteConfirmType('all')}
                      disabled={isDeletingBatch || isQueueRunning}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300 bg-slate-900/80 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/50 px-2.5 py-1 rounded-lg transition disabled:opacity-40"
                      title="Xóa toàn bộ tập"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-rose-400" />
                      <span>Xóa tất cả</span>
                    </button>

                    <button
                      onClick={handlePickMultipleLocalVideos}
                      disabled={isBatchUploading}
                      className="flex items-center gap-1 text-xs text-emerald-300 hover:text-white bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 px-2.5 py-1 rounded-lg transition shadow-sm active:scale-95 cursor-pointer font-semibold"
                      title="Chọn thêm video từ máy tính (0s)"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                      <span>+ Thêm Tập (0s)</span>
                    </button>

                    <button
                      onClick={() => {
                        if (_onOpenDownloader) {
                          _onOpenDownloader('direct');
                        } else {
                          setShowUrlDownloadModal(true);
                        }
                      }}
                      disabled={isQueueRunning}
                      className="flex items-center gap-1 text-xs text-emerald-300 hover:text-white bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 px-2.5 py-1 rounded-lg transition shadow-sm active:scale-95 cursor-pointer font-semibold"
                      title="Tải từ link video"
                    >
                      <Globe className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Tải từ Link</span>
                    </button>

                    {/* Nút Bắt đầu xử lý hàng loạt đưa lên toolbar */}
                    <button
                      onClick={() => setShowBatchConfirmModal(true)}
                      disabled={isQueueRunning || projects.length === 0}
                      className="flex items-center gap-1.5 text-xs text-white bg-gradient-to-r from-indigo-600 via-cyan-600 to-emerald-600 hover:brightness-110 active:scale-95 px-3 py-1 rounded-lg font-bold shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      title="Bắt đầu xử lý tự động theo quy trình hàng loạt đã cấu hình"
                    >
                      <Rocket className="w-3.5 h-3.5 text-white animate-bounce" />
                      <span>Bắt Đầu Xử Lý ({selectedProjectIds.length > 0 ? selectedProjectIds.length : sortedProjects.length})</span>
                    </button>

                    {/* Nút Ghép video đưa lên toolbar */}
                    <button
                      onClick={async () => {
                        const target = projects.find((p) => p.project_id === selectedDramaTitle) || projects[0];
                        if (!target) return;
                        try {
                          await apiClient.mergeProjectExports(target.project_id);
                          onRefreshProjects();
                        } catch (err: any) {
                          setQueueStatusMessage(err?.message || 'Không thể ghép video');
                        }
                      }}
                      disabled={isQueueRunning || projects.length === 0}
                      className="flex items-center gap-1 text-xs text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-1 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer font-semibold"
                      title="Ghép các tập video đã xuất thành một video dài duy nhất"
                    >
                      <span>Ghép Video Đã Xuất</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Ô tìm kiếm khi ở chế độ xem tập */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Tìm tập video..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 pr-2.5 py-1 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition w-36 sm:w-48"
                      />
                    </div>

                    {/* Sắp xếp theo số tập hoặc tùy ý */}
                    <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                      <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-xs text-slate-400 font-medium">Sắp xếp:</span>
                      <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as any)}
                        className="bg-transparent text-xs text-slate-200 font-semibold focus:outline-none cursor-pointer"
                      >
                        <option value="ep_asc" className="bg-slate-900 text-slate-200">Tập tăng dần (1 ➔ N)</option>
                        <option value="ep_desc" className="bg-slate-900 text-slate-200">Tập giảm dần (N ➔ 1)</option>
                        <option value="name_asc" className="bg-slate-900 text-slate-200">Tên A-Z</option>
                        <option value="name_desc" className="bg-slate-900 text-slate-200">Tên Z-A</option>
                        <option value="status" className="bg-slate-900 text-slate-200">Trạng thái</option>
                        <option value="duration" className="bg-slate-900 text-slate-200">Thời lượng</option>
                      </select>
                    </div>

                    {/* Toggle khi ở Flat mode */}
                    {dramaViewMode === 'flat' && (
                      <div className="flex items-center bg-slate-900 border border-slate-800 p-0.5 rounded-lg">
                        <button
                          onClick={() => {
                            setDramaViewMode('folders');
                            setSelectedDramaTitle(null);
                          }}
                          className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition text-slate-400 hover:text-white"
                        >
                          <Folder className="w-3.5 h-3.5" />
                          <span>Theo Bộ phim</span>
                        </button>
                        <button
                          onClick={() => setDramaViewMode('flat')}
                          className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition bg-indigo-600 text-white shadow"
                        >
                          <Film className="w-3.5 h-3.5" />
                          <span>Tất cả tập</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Thông báo trạng thái Queue / Upload */}
              {batchUploadStatus && (
                <div className="p-2.5 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-xs text-indigo-200 flex items-center justify-between shadow animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
                    <span>{batchUploadStatus}</span>
                  </div>
                </div>
              )}

              {/* Lưới các Thẻ Video Tập Phim */}
              {sortedProjects.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-3 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
                  <Film className="w-12 h-12 text-slate-600" />
                  <div className="space-y-1">
                    <h3 className="text-white font-semibold text-sm">
                      {searchQuery ? 'Không tìm thấy tập nào khớp với tìm kiếm' : 'Chưa có tập nào trong bộ phim này'}
                    </h3>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                  {sortedProjects.map((proj) => (
                    <BatchVideoCard
                      key={proj.project_id}
                      project={proj}
                      queueItem={queueItems.find((q) => q.projectId === proj.project_id)}
                      isSelected={selectedProjectIds.includes(proj.project_id)}
                      onToggleSelect={(e) => handleToggleSelectProject(proj.project_id, e)}
                      onSelectProject={onSelectProject}
                      onDeleteProject={onDeleteProject}
                      onOpenSettings={(p) => handleOpenInspector(p)}
                      layerVisibility={layerVisibility}
                      onRunSingleDubbing={(p) => handleRunSingleStage(p, 'dubbing')}
                      singleActionStatusText={singleActionStatus[proj.project_id]}
                      isSingleRunning={isSingleRunning}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 3. Thanh Tiến Trình Tổng Thể Đáy (Bottom Overall Progress Bar Dock) */}
      {(isQueueRunning || queueItems.length > 0) && (
        <div className="shrink-0 bg-slate-900 border-t border-indigo-700/60 px-4 py-2 text-xs space-y-1.5 shadow-2xl z-40 animate-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isQueueRunning ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'}`} />
              <span className="font-bold text-white uppercase tracking-wide shrink-0">Tiến trình tổng thể:</span>
              <span className="text-cyan-300 font-mono font-semibold shrink-0">
                {queueItems.filter((i) => i.status === 'completed').length} / {queueItems.length} video
              </span>
              <span className="text-slate-400 font-mono font-bold shrink-0">
                ({Math.round((queueItems.filter((i) => i.status === 'completed').length / Math.max(1, queueItems.length)) * 100)}%)
              </span>
              {isQueuePaused && (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider animate-pulse shrink-0">
                  ⏸️ ĐÃ TẠM DỪNG
                </span>
              )}
              {queueStatusMessage && (
                <span className="text-[11px] text-slate-300 font-mono ml-2 truncate">
                  • {queueStatusMessage}
                </span>
              )}
            </div>
            {isQueueRunning && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    const nextPaused = !isPausedRef.current;
                    isPausedRef.current = nextPaused;
                    setIsQueuePaused(nextPaused);
                    if (nextPaused) {
                      setQueueStatusMessage(
                        '⏸️ Đã tạm dừng hàng đợi. Video hiện tại đang hoàn tất nốt tiến trình trước khi dừng...'
                      );
                    } else {
                      setQueueStatusMessage('▶️ Đang tiếp tục xử lý hàng đợi...');
                    }
                  }}
                  className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
                    isQueuePaused
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 font-bold shadow'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                >
                  {isQueuePaused ? (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Tiếp tục</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Tạm dừng</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleCancelQueue}
                  className="px-3 py-1 bg-rose-600/90 hover:bg-rose-600 text-white rounded text-xs font-bold transition cursor-pointer shadow flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Dừng</span>
                </button>
              </div>
            )}
          </div>

          {/* Thanh % tổng thể mượt mà */}
          <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
              style={{
                width: `${Math.round(
                  (queueItems.filter((i) => i.status === 'completed').length / Math.max(1, queueItems.length)) * 100
                )}%`,
              }}
            />
          </div>
        </div>
      )}



      {/* 4. Modal Quản Lý Gemini Key Pool (Xoay Tua & Cooldown 429) */}
      {showGeminiPoolModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Gemini Key Pool (Xoay Tua Thông Minh)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/60 border border-indigo-700/50 text-indigo-300 font-mono">
                      Round-Robin Engine
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Phân bổ đều 15 RPM qua nhiều keys Free, tự động cách ly 60s khi gặp lỗi 429
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setIsVerifyingPool(true);
                    try {
                      const res = await apiClient.verifyGeminiKeys();
                      setGeminiPoolStatus(res.pool_status);
                      alert(`Đã kiểm tra xong ${res.pool_status.total_keys} keys!\nHoạt động: ${res.pool_status.active_keys}\nCooldown / Nghỉ: ${res.pool_status.cooldown_keys}`);
                    } catch (err: any) {
                      alert(`Lỗi khi kiểm tra keys: ${err.message}`);
                    } finally {
                      setIsVerifyingPool(false);
                    }
                  }}
                  disabled={isVerifyingPool || (geminiPoolStatus?.total_keys || 0) === 0}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow"
                  title="Gửi ping kiểm tra đồng thời tất cả các keys trong pool"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isVerifyingPool ? 'animate-spin text-amber-300' : ''}`} />
                  <span>{isVerifyingPool ? 'Đang kiểm tra...' : 'Kiểm Tra Tất Cả Keys'}</span>
                </button>

                <button
                  onClick={() => setShowGeminiPoolModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3.5 overflow-y-auto flex-1 text-xs">
              {/* Thống kê 4 chiều */}
              <div className="grid grid-cols-4 gap-2.5">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block font-medium">Tổng số Keys</span>
                  <span className="text-base font-bold text-white font-mono">
                    {geminiPoolStatus?.total_keys || 0}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-900/40 text-center">
                  <span className="text-[10px] text-emerald-400 block font-medium">Đang Khả Dụng</span>
                  <span className="text-base font-bold text-emerald-300 font-mono">
                    {geminiPoolStatus?.active_keys || 0}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-amber-900/40 text-center">
                  <span className="text-[10px] text-amber-400 block font-medium">Đang Cooldown (429)</span>
                  <span className="text-base font-bold text-amber-300 font-mono">
                    {geminiPoolStatus?.cooldown_keys || 0}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950 border border-cyan-900/40 text-center">
                  <span className="text-[10px] text-cyan-400 block font-medium">Thông Lượng (RPM)</span>
                  <span className="text-base font-bold text-cyan-300 font-mono">
                    {(geminiPoolStatus?.active_keys || 0) * 15}
                  </span>
                </div>
              </div>

              {/* Tabs chuyển đổi: Danh sách Keys vs Cập Nhật */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActivePoolTab('list')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                      activePoolTab === 'list'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>Danh Sách Keys ({geminiPoolStatus?.total_keys || 0})</span>
                  </button>

                  <button
                    onClick={() => setActivePoolTab('input')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                      activePoolTab === 'input'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Cập Nhật / Thêm Hàng Loạt</span>
                  </button>
                </div>

                {activePoolTab === 'list' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPoolStatusFilter('all')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                        poolStatusFilter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      Tất cả ({geminiPoolStatus?.total_keys || 0})
                    </button>
                    <button
                      onClick={() => setPoolStatusFilter('usable')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                        poolStatusFilter === 'usable' ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50' : 'text-slate-400 hover:text-emerald-400'
                      }`}
                    >
                      Khả dụng ({geminiPoolStatus?.active_keys || 0})
                    </button>
                    <button
                      onClick={() => setPoolStatusFilter('cooldown')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                        poolStatusFilter === 'cooldown' ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50' : 'text-slate-400 hover:text-amber-400'
                      }`}
                    >
                      Đang nghỉ ({geminiPoolStatus?.cooldown_keys || 0})
                    </button>
                  </div>
                )}
              </div>

              {/* TAB 1: DANH SÁCH CHI TIẾT TỪNG KEY & TRẠNG THÁI SỬ DỤNG */}
              {activePoolTab === 'list' && (
                <div className="space-y-2">
                  {/* Thanh tìm kiếm nhanh */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={poolSearchQuery}
                      onChange={(e) => setPoolSearchQuery(e.target.value)}
                      placeholder="Tìm theo số thứ tự (ví dụ: #1) hoặc mã key..."
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-indigo-500 transition"
                    />
                    {poolSearchQuery && (
                      <button
                        onClick={() => setPoolSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Danh sách cuộn các Keys */}
                  <div className="max-h-[320px] overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
                    {filteredKeyItems.length === 0 ? (
                      <div className="p-8 text-center text-slate-500 bg-slate-950/60 border border-slate-800/80 rounded-xl">
                        Không tìm thấy key nào phù hợp với bộ lọc hiện tại.
                      </div>
                    ) : (
                      filteredKeyItems.map((item) => {
                        const isVerifying = verifyingKeyIndex === item.index;
                        const isCopied = copiedKeyIndex === item.index;

                        return (
                          <div
                            key={item.index}
                            className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition ${
                              item.is_usable
                                ? 'bg-slate-950/80 border-slate-800 hover:border-emerald-500/40'
                                : item.status === 'invalid'
                                ? 'bg-rose-950/30 border-rose-800/50'
                                : 'bg-amber-950/20 border-amber-800/40'
                            }`}
                          >
                            {/* Cột trái: STT & Key Masked */}
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-bold">
                                #{item.index < 10 ? `0${item.index}` : item.index}
                              </span>

                              <span className="text-slate-200 font-medium tracking-wider select-all">
                                {item.masked_key}
                              </span>

                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(item.masked_key);
                                  setCopiedKeyIndex(item.index);
                                  setTimeout(() => setCopiedKeyIndex(null), 1500);
                                }}
                                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
                                title="Copy mã key"
                              >
                                {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>

                            {/* Cột giữa & phải: Badge Trạng Thái & Thao tác */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {/* Trạng thái sử dụng */}
                              {item.is_usable ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  <span>Khả dụng</span>
                                  {item.latency_ms && (
                                    <span className="text-[9px] text-emerald-400/80 font-normal">({item.latency_ms}ms)</span>
                                  )}
                                </span>
                              ) : item.status === 'daily_exhausted' ? (
                                <span className="px-2 py-0.5 rounded-full bg-orange-950/80 border border-orange-700/60 text-orange-300 text-[10px] font-bold flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 text-orange-400" />
                                  <span>Hết quota ngày</span>
                                </span>
                              ) : item.status === 'invalid' ? (
                                <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-700/60 text-rose-300 text-[10px] font-bold flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 text-rose-400" />
                                  <span>Lỗi / Vô hiệu</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  <span>Nghỉ 429 ({item.remaining_seconds}s)</span>
                                </span>
                              )}

                              {/* Nút kiểm tra sức khỏe key */}
                              <button
                                onClick={async () => {
                                  setVerifyingKeyIndex(item.index);
                                  try {
                                    const res = await apiClient.verifyGeminiKeys(item.index);
                                    setGeminiPoolStatus(res.pool_status);
                                  } catch (err: any) {
                                    alert(`Lỗi khi kiểm tra key: ${err.message}`);
                                  } finally {
                                    setVerifyingKeyIndex(null);
                                  }
                                }}
                                disabled={isVerifying}
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50"
                                title="Kiểm tra kết nối và hạn ngạch của riêng key này"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin text-amber-400' : ''}`} />
                              </button>

                              {/* Nút xóa key */}
                              <button
                                onClick={async () => {
                                  if (confirm(`Bạn có chắc chắn muốn xóa Key #${item.index} (${item.masked_key}) khỏi Pool?`)) {
                                    try {
                                      const res = await apiClient.deleteGeminiKey(item.index);
                                      setGeminiPoolStatus(res.pool_status);
                                    } catch (err: any) {
                                      alert(`Lỗi khi xóa key: ${err.message}`);
                                    }
                                  }
                                }}
                                className="p-1 rounded bg-slate-800 hover:bg-rose-900 text-slate-400 hover:text-rose-200 transition"
                                title="Xóa key này khỏi Pool"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: CẬP NHẬT HÀNG LOẠT */}
              {activePoolTab === 'input' && (
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold text-slate-300">
                    Dán danh sách API Keys mới (mỗi key 1 dòng hoặc dán mảng JSON):
                  </label>
                  <textarea
                    value={poolInputText}
                    onChange={(e) => setPoolInputText(e.target.value)}
                    placeholder={`Dán danh sách API Keys vào đây...\nVí dụ:\nAQ.Ab8EXAMPLE_KEY_1_XXXXXXXXXXXXXXXXXXXX\nAQ.Ab8EXAMPLE_KEY_2_YYYYYYYYYYYYYYYYYYYY`}
                    rows={8}
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 font-mono text-xs focus:outline-none focus:border-indigo-500 transition resize-none"
                  />
                  <p className="text-[10px] text-slate-500">
                    * Dữ liệu được lưu an toàn tại file <code className="text-amber-300">gemini_keys_pool.json</code> (được bảo mật không bao giờ commit lên git).
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
              <button
                onClick={fetchGeminiPoolStatus}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Làm mới danh sách</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowGeminiPoolModal(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition font-medium"
                >
                  Đóng
                </button>
                {activePoolTab === 'input' && (
                  <button
                    onClick={async () => {
                      const text = poolInputText.trim();
                      if (!text) return;
                      let keys: string[] = [];
                      if (text.startsWith('[')) {
                        try {
                          keys = JSON.parse(text);
                        } catch {
                          keys = text.split('\n').map((k) => k.trim()).filter(Boolean);
                        }
                      } else {
                        keys = text.split('\n').map((k) => k.trim()).filter(Boolean);
                      }

                      if (keys.length === 0) return;
                      setIsSavingPool(true);
                      try {
                        const res = await apiClient.saveGeminiPool(keys);
                        setGeminiPoolStatus(res.pool_status as any);
                        setPoolInputText('');
                        setActivePoolTab('list');
                        alert(`Đã lưu thành công ${res.pool_status.total_keys} keys vào Pool xoay tua!`);
                      } catch (err: any) {
                        alert(`Lỗi khi lưu keys: ${err.message}`);
                      } finally {
                        setIsSavingPool(false);
                      }
                    }}
                    disabled={isSavingPool || !poolInputText.trim()}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition shadow"
                  >
                    {isSavingPool ? 'Đang lưu...' : 'Lưu Danh Sách Keys'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Modal Tải Video từ URL / Hồng Quả */}
      {showUrlDownloadModal && (
        <UrlDownloadModal
          isOpen={showUrlDownloadModal}
          onClose={() => setShowUrlDownloadModal(false)}
          onRefreshProjects={onRefreshProjects}
          onBatchProjectsCreated={onBatchProjectsCreated}
        />
      )}

      {/* 4.1. Modal Cấu Hình Thiết Bị & Proxy */}
      {showDeviceSettingsModal && (
        <DeviceSettingsModal
          isOpen={showDeviceSettingsModal}
          onClose={() => setShowDeviceSettingsModal(false)}
        />
      )}

      {/* 5. Modal Xác Nhận Xóa Dự Án (Batch Delete / Delete All) */}
      {deleteConfirmType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-950/80 border border-rose-800/80 rounded-xl text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">
                  {deleteConfirmType === 'selected'
                    ? `Xóa ${selectedProjectIds.length} dự án đã chọn?`
                    : `Xóa toàn bộ ${projects.length} dự án?`}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {deleteConfirmType === 'selected'
                    ? `Bạn có chắc chắn muốn xóa ${selectedProjectIds.length} video/dự án đang được tích chọn? Thao tác này sẽ xóa vĩnh viễn dữ liệu phụ đề đã tạo.`
                    : `Bạn có chắc chắn muốn xóa TẤT CẢ ${projects.length} dự án trong danh sách? Thao tác này không thể hoàn tác.`}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setDeleteConfirmType(null)}
                disabled={isDeletingBatch}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeletingBatch}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingBatch ? 'Đang xóa...' : 'Xác nhận xóa'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 6. Modal Chi Tiết Tập (Quick Episode Inspector Modal) */}
      {inspectingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 md:p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-6xl xl:max-w-7xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-400 shrink-0">
                  <Settings className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white truncate max-w-lg" title={inspectingProject.title}>
                      {inspectingProject.title}
                    </h3>
                    {extractDramaInfo(inspectingProject.title).dramaTitle && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 shrink-0">
                        {extractDramaInfo(inspectingProject.title).dramaTitle}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shrink-0">
                      Tập {extractDramaInfo(inspectingProject.title).episodeNumber}
                    </span>
                    {useCustomProjectSettings && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shrink-0 flex items-center gap-1">
                        <span>⚙️ Cài đặt riêng</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setInspectingProject(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
                title="Đóng cửa sổ"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-5 text-xs flex-1">
              {/* Top Split Grid: Video Preview (Left 7) vs Tabs (Right 5) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Cột Trái: Trình phát Video Preview lớn & Tự thích ứng tỷ lệ */}
                <div className="lg:col-span-7 space-y-3">
                  {/* Switcher chuyển đổi nguồn video preview & Bật tắt ROI */}
                  <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800 flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setPreviewVideoMode('rendered')}
                        disabled={!inspectingProject.has_export}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          previewVideoMode === 'rendered' && inspectingProject.has_export
                            ? 'bg-purple-600 text-white shadow'
                            : inspectingProject.has_export
                            ? 'bg-slate-900 text-slate-300 hover:text-white'
                            : 'bg-slate-900/50 text-slate-600 cursor-not-allowed'
                        }`}
                        title={inspectingProject.has_export ? 'Xem video đã ghép Sub và Lồng tiếng (Bản xuất full)' : 'Cần xuất MP4 trước để xem'}
                      >
                        <Film className="w-3.5 h-3.5 text-purple-300" />
                        <span>🎬 Video Đã Xuất Bản (MP4)</span>
                      </button>

                      <button
                        onClick={() => setPreviewVideoMode('raw')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          previewVideoMode === 'raw'
                            ? 'bg-cyan-600 text-white shadow'
                            : 'bg-slate-900 text-slate-300 hover:text-white'
                        }`}
                        title="Xem video gốc thô ban đầu"
                      >
                        <Video className="w-3.5 h-3.5 text-cyan-300" />
                        <span>📹 Video Gốc</span>
                      </button>

                      <button
                        onClick={() => {
                          const next = !isEditingRoi;
                          setIsEditingRoi(next);
                          if (next) setInspectorTab('roi');
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          isEditingRoi
                            ? 'bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/30 ring-2 ring-amber-400'
                            : 'bg-slate-900 text-amber-300 hover:bg-slate-800 border border-amber-500/30'
                        }`}
                        title="Bật/tắt khung điều chỉnh vùng nhận diện phụ đề trực tiếp trên video"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        <span>{isEditingRoi ? 'Đang chỉnh ROI (Bật)' : 'Chỉnh khung quét ROI'}</span>
                      </button>
                    </div>

                    <div className="flex items-center">
                      {isEditingRoi ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800/60 flex items-center gap-1 animate-pulse">
                          <Scan className="w-3 h-3 text-amber-400" />
                          <span>Kéo thả khung vàng để chỉnh</span>
                        </span>
                      ) : previewVideoMode === 'rendered' && inspectingProject.has_export ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-950/80 text-purple-300 border border-purple-800/60 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-purple-400" />
                          <span>Đang phát bản xuất MP4</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800 flex items-center gap-1">
                          <span>Đang phát video thô gốc</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Khung Player Video: Tự thích ứng tỷ lệ, video dọc phóng to tối đa không bị ép 16:9 */}
                  <div
                    ref={videoBoxRef}
                    className={`relative bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center shadow-inner transition-all ${
                      isPortraitVideo
                        ? 'h-[500px] sm:h-[580px] max-w-sm mx-auto'
                        : 'aspect-video w-full max-h-[580px]'
                    }`}
                  >
                    <video
                      key={`${previewVideoMode}-${inspectingProject.project_id}`}
                      src={
                        previewVideoMode === 'rendered' && inspectingProject.has_export
                          ? apiClient.getRenderedVideoUrl(inspectingProject.project_id)
                          : apiClient.getVideoStreamUrl(inspectingProject.project_id)
                      }
                      controls
                      autoPlay={false}
                      className="w-full h-full object-contain pointer-events-auto"
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (d && !isNaN(d)) {
                          setInspectorDuration(d);
                        }
                        const vw = e.currentTarget.videoWidth;
                        const vh = e.currentTarget.videoHeight;
                        if (vw && vh) {
                          setIsPortraitVideo(vh > vw);
                        }
                      }}
                    />

                    {/* Lớp phủ tương tác khung nhận diện ROI */}
                    {isEditingRoi && videoContainerSize.width > 0 && videoContainerSize.height > 0 && (
                      <RoiOverlay
                        region={currentRoi}
                        onChange={setCurrentRoi}
                        containerWidth={videoContainerSize.width}
                        containerHeight={videoContainerSize.height}
                      />
                    )}
                  </div>

                  {/* Thanh chú thích kỹ thuật tệp */}
                  <div className="flex items-center justify-between px-2 text-[11px] text-slate-500 font-mono flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span>Trạng thái phát: Sẵn sàng</span>
                      <span className="text-slate-700">•</span>
                      <span className={isPortraitVideo ? 'text-amber-400 font-semibold' : 'text-cyan-400 font-semibold'}>
                        {isPortraitVideo ? '📱 Tỷ lệ dọc 9:16 (Phóng to tối đa)' : '🎬 Tỷ lệ ngang 16:9'}
                      </span>
                    </div>
                    {previewVideoMode === 'rendered' && inspectingProject.has_export && (
                      <span className="text-purple-400">
                        Bản xuất: {((inspectingProject.export_file_size_bytes || 0) / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    )}
                  </div>
                </div>

                {/* Cột Phải: Bảng Tabs (Thông số & Thao tác | Khung quét ROI | Cài đặt riêng) */}
                <div className="lg:col-span-5 space-y-3">
                  {/* Thanh điều hướng 3 Tabs */}
                  <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1">
                    <button
                      onClick={() => setInspectorTab('specs')}
                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        inspectorTab === 'specs'
                          ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700'
                          : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
                      }`}
                    >
                      <Activity className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Thông số</span>
                    </button>
                    <button
                      onClick={() => {
                        setInspectorTab('roi');
                        setIsEditingRoi(true);
                      }}
                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        inspectorTab === 'roi'
                          ? 'bg-amber-950/70 text-amber-300 shadow-sm border border-amber-700/60'
                          : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
                      }`}
                    >
                      <Scan className="w-3.5 h-3.5 text-amber-400" />
                      <span>Khung ROI</span>
                    </button>
                    <button
                      onClick={() => setInspectorTab('settings')}
                      className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer relative ${
                        inspectorTab === 'settings'
                          ? 'bg-indigo-950/70 text-indigo-300 shadow-sm border border-indigo-700/60'
                          : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Cài đặt riêng</span>
                      {useCustomProjectSettings && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 absolute top-1.5 right-1.5 animate-pulse" />
                      )}
                    </button>
                  </div>

                  {/* NỘI DUNG TAB 1: THÔNG SỐ & THAO TÁC */}
                  {inspectorTab === 'specs' && (
                    <div className="space-y-4 animate-in fade-in">
                      {/* Bảng Thông số kỹ thuật */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                          <Activity className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Thông số kỹ thuật</span>
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px]">
                          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                            <span className="text-slate-500 block text-[10px] mb-0.5">Thời lượng thực tế</span>
                            <span className="text-cyan-300 font-bold text-xs">
                              {formatTime(
                                inspectorDuration ||
                                  (inspectingProject as any).duration ||
                                  inspectingProject.media_metadata?.duration ||
                                  0
                              )}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                            <span className="text-slate-500 block text-[10px] mb-0.5">Số câu thoại OCR</span>
                            <span className="text-amber-300 font-bold text-xs">
                              {inspectingProject.cues_count || 0} câu
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                            <span className="text-slate-500 block text-[10px] mb-0.5">Số câu đã dịch</span>
                            <span className="text-emerald-300 font-bold text-xs">
                              {inspectingProject.translated_count || 0} câu
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                            <span className="text-slate-500 block text-[10px] mb-0.5">Giọng AI (MP3)</span>
                            <span
                              className={`font-bold text-xs ${
                                inspectingProject.has_voiceover ? 'text-emerald-400' : 'text-slate-500'
                              }`}
                            >
                              {inspectingProject.has_voiceover ? '✓ Đã tạo MP3' : 'Chưa có'}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
                            <span className="text-slate-500 block text-[10px] mb-0.5">Bản Xuất MP4</span>
                            <span
                              className={`font-bold text-xs ${
                                inspectingProject.has_export ? 'text-purple-400' : 'text-slate-500'
                              }`}
                            >
                              {inspectingProject.has_export ? '✓ Đã render' : 'Chưa xuất'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Trình phát Master Voiceover Audio nếu có */}
                      {inspectingProject.has_voiceover && (
                        <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 space-y-2.5 animate-in fade-in">
                          <div className="flex items-center justify-between text-amber-300 font-semibold text-xs">
                            <span className="flex items-center gap-1.5">
                              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                              <span>Bản Thu Thuyết Minh Lồng Tiếng AI (Master)</span>
                            </span>
                            <span className="text-[10px] font-mono text-amber-400/80">voiceover.mp3</span>
                          </div>
                          <audio
                            controls
                            src={apiClient.getVoiceoverAudioUrl(inspectingProject.project_id)}
                            className="w-full h-8 rounded-lg"
                          />
                        </div>
                      )}

                      {/* Thao tác cá nhân cho tập này */}
                      <div className="space-y-2.5 pt-2 border-t border-slate-800">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Thao tác cá nhân cho tập này</span>
                          </h4>
                          {singleActionStatus[inspectingProject.project_id] && (
                            <span className="text-[11px] text-cyan-400 font-mono animate-pulse font-medium">
                              {singleActionStatus[inspectingProject.project_id]}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleRunSingleStage(inspectingProject, 'ocr')}
                            disabled={isSingleRunning}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/50 hover:bg-amber-950/20 text-slate-300 hover:text-amber-300 text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm group"
                          >
                            <Scan className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                            <span>Quét OCR</span>
                          </button>
                          <button
                            onClick={() => handleRunSingleStage(inspectingProject, 'translate')}
                            disabled={isSingleRunning || (inspectingProject.cues_count || 0) === 0}
                            title={(inspectingProject.cues_count || 0) === 0 ? "Cần quét phụ đề trước khi dịch" : "Dịch lại toàn bộ phụ đề"}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-cyan-500/50 hover:bg-cyan-950/20 text-slate-300 hover:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm group"
                          >
                            <Languages className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                            <span>Dịch lại</span>
                          </button>
                          <button
                            onClick={() => handleRunSingleStage(inspectingProject, 'dubbing')}
                            disabled={isSingleRunning || (inspectingProject.cues_count || 0) === 0}
                            title={(inspectingProject.cues_count || 0) === 0 ? "Cần quét phụ đề trước khi tạo giọng đọc" : "Tạo giọng đọc (Voice)"}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 hover:bg-emerald-950/20 text-slate-300 hover:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm group"
                          >
                            <Volume2 className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                            <span>Tạo giọng (Voice)</span>
                          </button>
                          <button
                            onClick={() => handleRunSingleStage(inspectingProject, 'export')}
                            disabled={isSingleRunning}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500/50 hover:bg-purple-950/20 text-slate-300 hover:text-purple-300 text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm group"
                          >
                            <Film className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                            <span>Xuất MP4</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* NỘI DUNG TAB 2: KHUNG QUÉT ROI & QUÉT LẠI */}
                  {inspectorTab === 'roi' && (
                    <div className="space-y-3.5 bg-slate-950 p-4 rounded-xl border border-slate-800 animate-in fade-in">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                        <div className="flex items-center gap-2">
                          <Crosshair className="w-4 h-4 text-amber-400" />
                          <span className="font-bold text-slate-200 text-xs uppercase tracking-wider">
                            Điều chỉnh vùng quét phụ đề (ROI)
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/80 text-amber-300 border border-amber-800/60">
                          {isEditingRoi ? 'Đang mở trên video' : 'Tắt'}
                        </span>
                      </div>

                      {/* Hướng dẫn thao tác */}
                      <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/80">
                        💡 <strong className="text-amber-300">Hướng dẫn:</strong> Bật nút &quot;Chỉnh khung quét ROI&quot; và kéo thả trực tiếp khung màu vàng trên màn hình video bên trái để ôm trọn dòng phụ đề gốc cần quét.
                      </p>

                      {/* Các mẫu preset nhanh */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-semibold text-slate-400">Các mẫu vị trí nhanh:</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => applyRoiPreset('auto')}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-slate-300 hover:text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                            title="Tự động phân tích ảnh để tìm tọa độ chữ phụ đề"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>⚡ Quét tự động</span>
                          </button>

                          <button
                            onClick={() => applyRoiPreset('portrait_tiktok')}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-slate-300 hover:text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                            title="Tọa độ tối ưu cho video ngắn TikTok, Shorts, Reels dọc"
                          >
                            <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
                            <span>📱 TikTok Dọc (9:16)</span>
                          </button>

                          <button
                            onClick={() => applyRoiPreset('bottom_1_line')}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-slate-300 hover:text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                            title="Vùng hẹp 1 dòng chữ sát mép đáy"
                          >
                            <FileText className="w-3.5 h-3.5 text-emerald-400" />
                            <span>📄 1 Dòng (Sát đáy)</span>
                          </button>

                          <button
                            onClick={() => applyRoiPreset('bottom_2_lines')}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-slate-300 hover:text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition cursor-pointer"
                            title="Vùng rộng 2 dòng chữ tiêu chuẩn"
                          >
                            <FileText className="w-3.5 h-3.5 text-purple-400" />
                            <span>📑 2 Dòng (Chuẩn)</span>
                          </button>
                        </div>
                      </div>

                      {/* Thanh trượt tinh chỉnh tọa độ */}
                      <div className="space-y-2 pt-2 border-t border-slate-800/80 font-mono text-[11px]">
                        <div className="space-y-1">
                          <div className="flex justify-between text-slate-400">
                            <span>Vị trí dọc (Y):</span>
                            <span className="text-amber-400">{Math.round(currentRoi.y * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="30"
                            max="95"
                            value={Math.round(currentRoi.y * 100)}
                            onChange={(e) =>
                              setCurrentRoi((prev: RegionTrackV1) => ({
                                ...prev,
                                region_id: 'roi-custom',
                                y: parseFloat((Number(e.target.value) / 100).toFixed(3)),
                              }))
                            }
                            className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-slate-400">
                            <span>Chiều cao (H):</span>
                            <span className="text-amber-400">{Math.round(currentRoi.height * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="4"
                            max="35"
                            value={Math.round(currentRoi.height * 100)}
                            onChange={(e) =>
                              setCurrentRoi((prev: RegionTrackV1) => ({
                                ...prev,
                                region_id: 'roi-custom',
                                height: parseFloat((Number(e.target.value) / 100).toFixed(3)),
                              }))
                            }
                            className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-slate-400">
                            <span>Chiều rộng (W):</span>
                            <span className="text-amber-400">{Math.round(currentRoi.width * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            value={Math.round(currentRoi.width * 100)}
                            onChange={(e) =>
                              setCurrentRoi((prev: RegionTrackV1) => ({
                                ...prev,
                                region_id: 'roi-custom',
                                width: parseFloat((Number(e.target.value) / 100).toFixed(3)),
                              }))
                            }
                            className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Thông báo trạng thái quét */}
                      {roiStatusMessage && (
                        <div className="p-2.5 rounded-lg bg-amber-950/80 border border-amber-800/80 text-amber-300 text-xs font-mono animate-pulse">
                          {roiStatusMessage}
                        </div>
                      )}

                      {/* Nút bấm Lưu & Quét lại OCR ngay */}
                      <button
                        onClick={handleSaveRoiAndRescan}
                        disabled={isSavingRoiAndRescan}
                        className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
                      >
                        <Scan className={`w-4 h-4 ${isSavingRoiAndRescan ? 'animate-spin' : ''}`} />
                        <span>{isSavingRoiAndRescan ? 'Đang lưu & quét lại OCR...' : '💾 Lưu Khung & Quét Lại OCR Ngay'}</span>
                      </button>
                    </div>
                  )}

                  {/* NỘI DUNG TAB 3: CÀI ĐẶT RIÊNG CHO TẬP NÀY */}
                  {inspectorTab === 'settings' && (
                    <div className="space-y-3.5 bg-slate-950 p-4 rounded-xl border border-slate-800 animate-in fade-in">
                      {/* Header công tắc bật Cài đặt riêng */}
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                        <div>
                          <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                            <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                            <span>Cài đặt riêng cho tập này</span>
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {useCustomProjectSettings
                              ? 'Đang áp dụng cấu hình tùy chỉnh độc lập cho video này'
                              : 'Đang kế thừa cấu hình từ Cài đặt Toàn cục'}
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useCustomProjectSettings}
                            onChange={(e) => setUseCustomProjectSettings(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {/* Trạng thái Kế thừa toàn cục */}
                      {!useCustomProjectSettings && (
                        <div className="space-y-3 bg-slate-900/70 p-3.5 rounded-xl border border-slate-800/80 text-xs">
                          <div className="flex items-start gap-2.5 text-slate-300">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="font-semibold text-white">Đang sử dụng Cài đặt Toàn cục</p>
                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                Mọi thao tác Quét OCR, Dịch và Lồng tiếng của tập này sẽ sử dụng các thông số chung trong mục Cài đặt hệ thống.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-slate-400 pt-2 border-t border-slate-800">
                            <div>
                              <span className="text-slate-500 block">OCR:</span>
                              <span className="text-cyan-300 font-semibold uppercase">
                                {globalPipelineSettings?.ocr.mode === 'api'
                                  ? `Cloud API (${globalPipelineSettings?.ocr.api_provider})`
                                  : `Local (${globalPipelineSettings?.ocr.local_engine})`}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Dịch thuật:</span>
                              <span className="text-emerald-300 font-semibold truncate block">
                                {globalPipelineSettings?.translation.gemini_model || 'Gemini Flash'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Giọng đọc AI:</span>
                              <span className="text-indigo-300 font-semibold truncate block">
                                {globalPipelineSettings?.dubbing.voice || 'Edge TTS'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Kiểu che mờ:</span>
                              <span className="text-purple-300 font-semibold uppercase">
                                {globalPipelineSettings?.render.default_mask_style || 'blur'}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={() => setUseCustomProjectSettings(true)}
                            className="w-full mt-2 py-2 px-3 rounded-lg bg-indigo-950 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/80 text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Bật tùy chỉnh riêng cho tập này</span>
                          </button>
                        </div>
                      )}

                      {/* Khi bật tùy chỉnh riêng: Hiển thị các form chỉnh sửa */}
                      {useCustomProjectSettings && projectSettingsForm && (
                        <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                          {/* 1. OCR Settings */}
                          <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
                            <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1 uppercase">
                              <Scan className="w-3 h-3 text-amber-400" />
                              <span>1. Quét chữ phụ đề (OCR)</span>
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Chế độ:</label>
                                <select
                                  value={projectSettingsForm.ocr.mode}
                                  onChange={(e) =>
                                    setProjectSettingsForm((prev) =>
                                      prev ? { ...prev, ocr: { ...prev.ocr, mode: e.target.value as any } } : prev
                                    )
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                                >
                                  <option value="api">Cloud API (Nhanh)</option>
                                  <option value="local">Local Máy Cục Bộ</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Động cơ OCR:</label>
                                <select
                                  value={projectSettingsForm.ocr.mode === 'api' ? projectSettingsForm.ocr.api_provider : projectSettingsForm.ocr.engine}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setProjectSettingsForm((prev) => {
                                      if (!prev) return prev;
                                      if (prev.ocr.mode === 'api') {
                                        return { ...prev, ocr: { ...prev.ocr, api_provider: val as any } };
                                      } else {
                                        return { ...prev, ocr: { ...prev.ocr, engine: val as any } };
                                      }
                                    });
                                  }}
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                                >
                                  {projectSettingsForm.ocr.mode === 'api' ? (
                                    <>
                                      <option value="capcut">CapCut ASR (ByteDance)</option>
                                      <option value="gemini">Google Gemini VLM</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="rapidocr">RapidOCR ONNX (Khuyên dùng)</option>
                                      <option value="ppocrv5">PP-OCRv5 Mobile (GPU)</option>
                                      <option value="paddle">PaddleOCR</option>
                                    </>
                                  )}
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* 2. Dịch thuật AI */}
                          <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
                            <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1 uppercase">
                              <Languages className="w-3 h-3 text-cyan-400" />
                              <span>2. Dịch thuật AI</span>
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Mô hình AI:</label>
                                <select
                                  value={projectSettingsForm.translation.gemini_model}
                                  onChange={(e) =>
                                    setProjectSettingsForm((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            translation: { ...prev.translation, gemini_model: e.target.value as any },
                                          }
                                        : prev
                                    )
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                                >
                                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Khuyên dùng)</option>
                                  <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                                  <option value="qwen2.5:7b-instruct">Local Qwen 2.5 (7B)</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Văn phong dịch:</label>
                                <select
                                  value={projectSettingsForm.translation.prompt_tone}
                                  onChange={(e) =>
                                    setProjectSettingsForm((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            translation: { ...prev.translation, prompt_tone: e.target.value as any },
                                          }
                                        : prev
                                    )
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                                >
                                  <option value="dramatic">🎬 Kịch tính / Phim ảnh</option>
                                  <option value="daily">☕ Đời thường / Gần gũi</option>
                                  <option value="humorous">😄 Hài hước / Hóm hỉnh</option>
                                  <option value="literal">📖 Sát nghĩa văn bản</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* 3. Lồng tiếng AI */}
                          <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
                            <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1 uppercase">
                              <Volume2 className="w-3 h-3 text-emerald-400" />
                              <span>3. Lồng tiếng AI (TTS)</span>
                            </span>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Dịch vụ TTS:</label>
                                <select
                                  value={projectSettingsForm.dubbing.provider}
                                  onChange={(e) =>
                                    setProjectSettingsForm((prev) =>
                                      prev
                                        ? { ...prev, dubbing: { ...prev.dubbing, provider: e.target.value as any } }
                                        : prev
                                    )
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                                >
                                  <option value="edge">Edge Neural TTS (Chuẩn)</option>
                                  <option value="capcut">CapCut TTS (Giọng TikTok)</option>
                                  <option value="gemini">Gemini Voice TTS</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Tốc độ nói:</label>
                                <select
                                  value={projectSettingsForm.dubbing.rate}
                                  onChange={(e) =>
                                    setProjectSettingsForm((prev) =>
                                      prev ? { ...prev, dubbing: { ...prev.dubbing, rate: e.target.value } } : prev
                                    )
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                                >
                                  <option value="-10%">-10% (Chậm rãi)</option>
                                  <option value="+0%">0% (Tự nhiên chuẩn)</option>
                                  <option value="+10%">+10% (Nhanh vừa)</option>
                                  <option value="+20%">+20% (Nhanh cao trào)</option>
                                </select>
                              </div>
                            </div>

                            {/* Chế độ Lồng Tiếng Đơn vs Đa Giọng */}
                            <div className="space-y-1.5 pt-1 border-t border-slate-800">
                              <label className="text-[10px] text-slate-400 block font-medium">Chế độ phân vai lồng tiếng:</label>
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setProjectSettingsForm((prev) =>
                                      prev ? { ...prev, dubbing: { ...prev.dubbing, mode: 'single' } } : prev
                                    )
                                  }
                                  className={`py-1.5 px-2 rounded-lg border text-center transition font-semibold text-xs cursor-pointer ${
                                    (projectSettingsForm.dubbing.mode || 'single') === 'single'
                                      ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300 shadow-sm'
                                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                                  }`}
                                >
                                  Đơn giọng (1 người)
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setProjectSettingsForm((prev) =>
                                      prev ? { ...prev, dubbing: { ...prev.dubbing, mode: 'multi' } } : prev
                                    )
                                  }
                                  className={`py-1.5 px-2 rounded-lg border text-center transition font-semibold text-xs cursor-pointer ${
                                    projectSettingsForm.dubbing.mode === 'multi'
                                      ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300 shadow-sm'
                                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                                  }`}
                                >
                                  Đa giọng (Nam / Nữ)
                                </button>
                              </div>
                            </div>

                            {/* Lựa chọn giọng theo chế độ */}
                            {(projectSettingsForm.dubbing.mode || 'single') === 'single' ? (
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-1">Giọng đọc chính:</label>
                                <select
                                  value={projectSettingsForm.dubbing.voice}
                                  onChange={(e) =>
                                    setProjectSettingsForm((prev) =>
                                      prev ? { ...prev, dubbing: { ...prev.dubbing, voice: e.target.value } } : prev
                                    )
                                  }
                                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                                >
                                  {ttsVoices.map((v) => (
                                    <option key={v.voice_id} value={v.voice_id}>
                                      {v.display_name} ({v.voice_id})
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] text-slate-400 block mb-1">Giọng Nam:</label>
                                  <select
                                    value={projectSettingsForm.dubbing.voice_male || 'vi-VN-NamMinhNeural'}
                                    onChange={(e) =>
                                      setProjectSettingsForm((prev) =>
                                        prev ? { ...prev, dubbing: { ...prev.dubbing, voice_male: e.target.value } } : prev
                                      )
                                    }
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                                  >
                                    {ttsVoices.map((v) => (
                                      <option key={v.voice_id} value={v.voice_id}>
                                        {v.display_name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] text-slate-400 block mb-1">Giọng Nữ:</label>
                                  <select
                                    value={projectSettingsForm.dubbing.voice_female || 'vi-VN-HoaiMyNeural'}
                                    onChange={(e) =>
                                      setProjectSettingsForm((prev) =>
                                        prev ? { ...prev, dubbing: { ...prev.dubbing, voice_female: e.target.value } } : prev
                                      )
                                    }
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                                  >
                                    {ttsVoices.map((v) => (
                                      <option key={v.voice_id} value={v.voice_id}>
                                        {v.display_name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* 4. Render Mask Style */}
                          <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
                            <span className="text-[11px] font-bold text-purple-300 flex items-center gap-1 uppercase">
                              <Film className="w-3 h-3 text-purple-400" />
                              <span>4. Kiểu che mờ phụ đề gốc</span>
                            </span>
                            <div>
                              <select
                                value={projectSettingsForm.render.default_mask_style}
                                onChange={(e) =>
                                  setProjectSettingsForm((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          render: { ...prev.render, default_mask_style: e.target.value },
                                        }
                                      : prev
                                  )
                                }
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                              >
                                <option value="feather_tight">Lông vũ viền mỏng (feather_tight - Đẹp nhất)</option>
                                <option value="blur">Làm mờ Gauss chuẩn (blur)</option>
                                <option value="optical_blend">Hòa trộn quang học (optical_blend)</option>
                                <option value="glass">Kính mờ phủ sương (glass)</option>
                                <option value="ambient">Ánh sáng môi trường (ambient)</option>
                              </select>
                            </div>
                          </div>

                          {/* Feedback khi lưu */}
                          {customSettingsFeedback && (
                            <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-xs font-medium animate-in fade-in">
                              {customSettingsFeedback}
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={handleSaveCustomProjectSettings}
                              disabled={isSavingCustomSettings}
                              className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <Save className="w-3.5 h-3.5" />
                              <span>{isSavingCustomSettings ? 'Đang lưu...' : 'Lưu cài đặt cho tập này'}</span>
                            </button>
                            <button
                              onClick={handleResetCustomSettings}
                              disabled={isSavingCustomSettings}
                              className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition border border-slate-700 flex items-center gap-1.5 cursor-pointer"
                              title="Xóa cài đặt riêng và khôi phục theo Cài đặt Toàn cục"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                              <span>Khôi phục</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Full-Width Section: BẢN XUẤT HOÀN THIỆN ĐÃ XÁC THỰC (VERIFIED MP4 OUTPUT) */}
              <div className="bg-slate-950/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-4 shadow-lg">
                <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Bản xuất MP4 hoàn thiện (Verified Output File)
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    {inspectingProject.has_export && (inspectingProject.export_verified || inspectingProject.export_path) ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-semibold font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1.5 shadow-sm">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          ✓ ĐÃ XÁC THỰC TỒN TẠI TRÊN Ổ ĐĨA (
                          {((inspectingProject.export_file_size_bytes || 0) / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium font-mono bg-amber-950/60 text-amber-300 border border-amber-800/60 flex items-center gap-1.5">
                        <span>⏳ Chưa có bản xuất trên đĩa (Bấm &quot;Xuất MP4&quot; ở trên để tạo)</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Thông báo sao chép nhanh */}
                {copyFeedbackText && (
                  <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-700 text-emerald-300 text-xs font-medium flex items-center gap-2 animate-in fade-in">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>{copyFeedbackText}</span>
                  </div>
                )}

                {/* Ô Đường Dẫn Tuyệt Đối Tệp Xuất Bản */}
                <div className="space-y-1.5">
                  <label className="text-slate-400 font-semibold text-xs flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-purple-400" />
                    <span>Đường dẫn tuyệt đối tệp MP4 kết xuất:</span>
                  </label>
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    <input
                      type="text"
                      readOnly
                      value={inspectingProject.export_path || 'Chưa xuất bản file MP4'}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-purple-200 focus:outline-none focus:border-purple-500 select-all cursor-text min-w-0"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleCopyPath(inspectingProject.export_path, 'đường dẫn MP4 xuất')}
                        disabled={!inspectingProject.export_path}
                        className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                        title="Sao chép đường dẫn tuyệt đối tệp xuất"
                      >
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Sao chép</span>
                      </button>

                      <button
                        onClick={() => handleRevealExport(inspectingProject.project_id)}
                        disabled={isRevealingFolder}
                        className="px-3 py-2 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50"
                        title="Mở tệp và vị trí lưu trên Windows Explorer"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{isRevealingFolder ? 'Đang mở...' : 'Mở trong Thư Mục'}</span>
                      </button>

                      {inspectingProject.has_export && (
                        <a
                          href={apiClient.getRenderedVideoUrl(inspectingProject.project_id, true)}
                          download
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow"
                          title="Tải video MP4 hoàn thiện về máy"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải MP4</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ô Đường Dẫn Tuyệt Đối Tệp Âm Thanh Lồng Tiếng AI (MP3 Voiceover) */}
                <div className="space-y-1.5 pt-2 border-t border-slate-900">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-slate-400 font-semibold text-xs flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Đường dẫn tệp âm thanh lồng tiếng AI (MP3):</span>
                    </label>
                    {inspectingProject.has_voiceover ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1 shadow-sm">
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>
                          ✓ ĐÃ TẠO FILE MP3 ({((inspectingProject.voiceover_file_size_bytes || 0) / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500 font-mono">
                        ⏳ Chưa tạo giọng (Bấm &quot;Tạo giọng&quot; ở trên để tạo)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    <input
                      type="text"
                      readOnly
                      value={inspectingProject.voiceover_path || (inspectingProject.has_voiceover ? `outputs/${inspectingProject.project_id}/voiceover_${inspectingProject.project_id}.mp3` : 'Chưa tạo file âm thanh MP3')}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500 select-all cursor-text min-w-0"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() =>
                          handleCopyPath(
                            inspectingProject.voiceover_path || `outputs/${inspectingProject.project_id}/voiceover_${inspectingProject.project_id}.mp3`,
                            'đường dẫn file MP3'
                          )
                        }
                        disabled={!inspectingProject.has_voiceover}
                        className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Sao chép đường dẫn file MP3"
                      >
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Sao chép</span>
                      </button>

                      <button
                        onClick={() => handleRevealExport(inspectingProject.project_id)}
                        disabled={isRevealingFolder}
                        className="px-3 py-2 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm disabled:opacity-50"
                        title="Mở thư mục chứa file MP3 trên Windows Explorer"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Mở trong Thư Mục</span>
                      </button>

                      {inspectingProject.has_voiceover && (
                        <a
                          href={apiClient.getVoiceoverAudioUrl(inspectingProject.project_id)}
                          download={`voiceover_${inspectingProject.title || inspectingProject.project_id}.mp3`}
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow"
                          title="Tải tệp âm thanh MP3 về máy"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải MP3</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ô Đường Dẫn Tuyệt Đối Video Gốc Đầu Vào (Đối chiếu) */}
                <div className="space-y-1.5 pt-2 border-t border-slate-900">
                  <label className="text-slate-400 font-semibold text-xs flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Đường dẫn tuyệt đối video gốc đầu vào:</span>
                  </label>
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    <input
                      type="text"
                      readOnly
                      value={inspectingProject.source_video_resolved_path || inspectingProject.source_video_path}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500 select-all cursor-text min-w-0"
                    />
                    <button
                      onClick={() =>
                        handleCopyPath(
                          inspectingProject.source_video_resolved_path || inspectingProject.source_video_path,
                          'đường dẫn video gốc'
                        )
                      }
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm shrink-0"
                      title="Sao chép đường dẫn video gốc"
                    >
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Sao chép</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
              <button
                onClick={() => {
                  const p = inspectingProject;
                  setInspectingProject(null);
                  if (confirm(`Xóa video "${p.title}"?`)) onDeleteProject(p.project_id);
                }}
                className="px-3.5 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/60 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa tập này</span>
              </button>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setInspectingProject(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Đóng
                </button>
                <button
                  onClick={() => {
                    const p = inspectingProject;
                    setInspectingProject(null);
                    onSelectProject(p);
                  }}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <Maximize2 className="w-4 h-4" />
                  <span>Mở trong Studio</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Modal Kiểm Tra & Xác Nhận Hàng Loạt (Quick Batch Review Confirmation Modal) */}
      {showBatchConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-indigo-400">
                <Rocket className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Kiểm tra & Xác nhận thiết lập hàng loạt</h3>
                <p className="text-xs text-slate-400">
                  Các thông số sau sẽ được áp dụng đồng bộ cho tất cả các tập video được chọn:
                </p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Số lượng video xử lý:</span>
                <span className="text-white font-bold font-mono">
                  {selectedProjectIds.length > 0 ? selectedProjectIds.length : projects.length} tập video
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Công đoạn thực hiện:</span>
                <span className="text-indigo-300 font-bold flex items-center gap-1">
                  {Object.entries(batchStages)
                    .filter(([_, active]) => active)
                    .map(([stage]) => {
                      if (stage === 'ocr') return 'Quét OCR';
                      if (stage === 'translate') return 'Dịch thuật';
                      if (stage === 'dubbing') return 'Lồng tiếng';
                      if (stage === 'export') return 'Xuất MP4';
                      return stage;
                    })
                    .join(' ➔ ') || 'Chưa chọn công đoạn nào'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Ngôn ngữ dịch:</span>
                <span className="text-cyan-300 font-bold">
                  {batchTargetLang === 'vi'
                    ? 'Tiếng Việt (VI)'
                    : batchTargetLang === 'en'
                    ? 'Tiếng Anh (EN)'
                    : batchTargetLang === 'zh'
                    ? 'Tiếng Trung (ZH)'
                    : 'Giữ nguyên (Không dịch)'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Giảm âm lượng video gốc:</span>
                <span className="text-amber-400 font-bold font-mono">{batchDuckingVolume}%</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Lồng tiếng AI:</span>
                <span className="text-emerald-300 font-bold">
                  {batchDubbingEnabled
                    ? `${batchDubbingMode === 'single' ? 'Đơn giọng' : 'Đa giọng'} (${batchDubbingVoice})`
                    : 'Tắt'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Định dạng file:</span>
                <span className="text-purple-300 font-bold uppercase font-mono">{batchExportFormat}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/80">
                <span className="text-slate-400">Độ phân giải:</span>
                <span className="text-purple-300 font-bold">
                  {batchExportResolution === 'original'
                    ? 'Độ phân giải gốc (100%)'
                    : batchExportResolution === '1080p'
                    ? '1080p (Full HD)'
                    : batchExportResolution === '720p'
                    ? '720p (HD)'
                    : '2K (QHD)'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-400">Tỷ lệ khung hình:</span>
                <span className="text-purple-300 font-bold">
                  {batchExportAspectRatio === 'original'
                    ? 'Tỷ lệ gốc của video'
                    : batchExportAspectRatio === '16:9'
                    ? '16:9 (Video ngang)'
                    : '9:16 (Video dọc TikTok/Shorts)'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBatchConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Hủy / Chỉnh Lại
              </button>
              <button
                onClick={() => {
                  setShowBatchConfirmModal(false);
                  handleStartQueue('all');
                }}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow flex items-center gap-1.5 cursor-pointer"
              >
                <Rocket className="w-3.5 h-3.5" />
                <span>Xác Nhận & Bắt Đầu</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Hidden legacy voice sync controls preserved for UI contracts & batch dubbing fallback */}
      <div className="hidden" aria-hidden="true">
        <VoiceCatalogPicker
          gender="Nam"
          selectedVoiceId={batchDubbingVoiceMale}
          onChange={(voiceId) => setBatchDubbingVoiceMale(voiceId)}
        />
        <VoiceCatalogPicker
          gender="Nữ"
          selectedVoiceId={batchDubbingVoiceFemale}
          onChange={(voiceId) => setBatchDubbingVoiceFemale(voiceId)}
        />
        <select value={batchDubbingVoice} onChange={(e) => setBatchDubbingVoice(e.target.value)}>
          {getVoiceDropdownGroups().map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

    </div>
  );
};
