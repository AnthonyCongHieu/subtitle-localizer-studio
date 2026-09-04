import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { apiClient, GeminiPoolStatus } from '../../api/client';
import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import { PresetProfile, getDefaultPreset } from '../../types/presets';
import { UrlDownloadModal } from './UrlDownloadModal';
import { DeviceSettingsModal } from './DeviceSettingsModal';
import {
  Film,
  Download,
  CheckSquare,
  Square,
  Play,
  Pause,
  Square as StopIcon,
  Maximize2,
  Settings,
  X,
  FileText,
  Languages,
  Mic,
  Rocket,
  Octagon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FolderPlus,
  Key,
  RefreshCw,
  AlertCircle,
  Trash2,
  Search,
  Copy,
  Check,
  Globe,
  Smartphone,
  Layers,
} from 'lucide-react';

interface DashboardBatchHubProps {
  projects: ProjectManifestV1[];
  presets: PresetProfile[];
  onSelectProject: (project: ProjectManifestV1) => void;
  onNewProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onOpenPresetManager: () => void;
  onRefreshProjects: () => void;
  onBatchProjectsCreated?: (newProjects: ProjectManifestV1[]) => void;
  onOpenQueue?: () => void;
}

interface BatchQueueItem {
  projectId: string;
  title: string;
  status: 'pending' | 'scanning' | 'translating' | 'voicing' | 'exporting' | 'completed' | 'failed';
  error?: string;
  cuesCount?: number;
}

// Thẻ Video Mini Card (Batch Video Card) với Mini Player, Bounding Box ROI, Mask che mờ và Sub dịch
const BatchVideoCard: React.FC<{
  project: ProjectManifestV1;
  isSelected: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
  onSelectProject: (proj: ProjectManifestV1) => void;
  onDeleteProject: (id: string) => void;
  onOpenSettings: (proj: ProjectManifestV1) => void;
  onRegionSaved?: (projectId: string, region: RegionTrackV1) => void;
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
}> = ({
  project,
  isSelected,
  onToggleSelect,
  onSelectProject,
  onDeleteProject,
  onOpenSettings,
  onRegionSaved,
  layerVisibility,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subMode, setSubMode] = useState<'both' | 'translated' | 'original'>('translated');

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

  // 3. Trạng thái vùng chọn quét & che mờ (ROI Bounding Box)
  const [region, setRegion] = useState<RegionTrackV1>(() => {
    if (project.regions && project.regions.length > 0) {
      return { ...project.regions[0] };
    }
    return {
      region_id: 'roi-' + project.project_id.slice(-6),
      x: 0.15,
      y: 0.76,
      width: 0.7,
      height: 0.14,
    };
  });

  useEffect(() => {
    if (project.regions && project.regions.length > 0) {
      setRegion({ ...project.regions[0] });
    }
  }, [project.regions]);

  type DragAnchor = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  type DragMode = DragAnchor | null;
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [isSavedRecently, setIsSavedRecently] = useState(false);
  const currentRegionRef = useRef<RegionTrackV1>(region);
  currentRegionRef.current = region;

  // 4. Xử lý kéo thả di chuyển và co giãn 8 nốt tay cầm (8-Anchor Drag & Resize)
  const handleMouseDown = useCallback(
    (mode: DragAnchor, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { ...currentRegionRef.current };
      const containerW = rect.width;
      const containerH = rect.height;

      setDragMode(mode);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault();
        if (containerW <= 0 || containerH <= 0) return;

        const deltaX = (moveEvent.clientX - startX) / containerW;
        const deltaY = (moveEvent.clientY - startY) / containerH;

        let newX = orig.x;
        let newY = orig.y;
        let newW = orig.width;
        let newH = orig.height;

        const minW = 0.08;
        const minH = 0.03;

        if (mode === 'move') {
          newX = Math.max(0, Math.min(1.0 - orig.width, orig.x + deltaX));
          newY = Math.max(0, Math.min(1.0 - orig.height, orig.y + deltaY));
        } else {
          if (mode.includes('w')) {
            const maxLeft = orig.x + orig.width - minW;
            newX = Math.max(0, Math.min(maxLeft, orig.x + deltaX));
            newW = orig.width + (orig.x - newX);
          }
          if (mode.includes('e')) {
            newW = Math.max(minW, Math.min(1.0 - orig.x, orig.width + deltaX));
          }
          if (mode.includes('n')) {
            const maxTop = orig.y + orig.height - minH;
            newY = Math.max(0, Math.min(maxTop, orig.y + deltaY));
            newH = orig.height + (orig.y - newY);
          }
          if (mode.includes('s')) {
            newH = Math.max(minH, Math.min(1.0 - orig.y, orig.height + deltaY));
          }
        }

        newX = Math.max(0, Math.min(1.0 - minW, newX));
        newY = Math.max(0, Math.min(1.0 - minH, newY));
        newW = Math.max(minW, Math.min(1.0 - newX, newW));
        newH = Math.max(minH, Math.min(1.0 - newY, newH));

        const updated: RegionTrackV1 = {
          ...orig,
          x: parseFloat(newX.toFixed(4)),
          y: parseFloat(newY.toFixed(4)),
          width: parseFloat(newW.toFixed(4)),
          height: parseFloat(newH.toFixed(4)),
        };

        setRegion(updated);
        currentRegionRef.current = updated;
      };

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        setDragMode(null);

        // Lưu ngay tọa độ mới vào SQLite database qua API
        const finalRegion = currentRegionRef.current;
        apiClient
          .saveRegions(project.project_id, [finalRegion])
          .then(() => {
            setIsSavedRecently(true);
            setTimeout(() => setIsSavedRecently(false), 2000);
            project.regions = [finalRegion];
            onRegionSaved?.(project.project_id, finalRegion);
          })
          .catch((err) => console.error('Lỗi khi lưu tọa độ ROI:', err));
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [project.project_id, onRegionSaved]
  );

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

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 5. Kết xuất nội dung phụ đề động theo chế độ xem và mốc thời gian phát
  const renderSubtitleText = () => {
    if (subMode === 'original') {
      if (activeCue) return activeCue.source_text;
      if (isPlaying || currentTime > 0.5) return '';
      return project.first_cue_original || cues[0]?.source_text || (hasCues ? 'Đã trích xuất phụ đề' : 'Chưa quét phụ đề');
    }

    if (subMode === 'both') {
      if (activeCue) {
        return (
          <div className="flex flex-col items-center justify-center text-center leading-tight">
            <span className="text-white/80 text-[9px] drop-shadow">{activeCue.source_text}</span>
            <span className="text-amber-300 font-bold text-[11px] sm:text-xs drop-shadow">
              {activeCue.translated_text || activeCue.source_text}
            </span>
          </div>
        );
      }
      if (isPlaying || currentTime > 0.5) return '';
      return (
        <div className="flex flex-col items-center justify-center text-center leading-tight">
          <span className="text-white/80 text-[9px] drop-shadow">{project.first_cue_original || cues[0]?.source_text || ''}</span>
          <span className="text-amber-300 font-bold text-[11px] sm:text-xs drop-shadow">
            {project.first_cue_text || cues[0]?.translated_text || (hasCues ? 'Đã trích xuất phụ đề' : 'Chưa quét phụ đề')}
          </span>
        </div>
      );
    }

    // subMode === 'translated'
    if (activeCue) return activeCue.translated_text || activeCue.source_text;
    if (isPlaying || currentTime > 0.5) return '';
    return project.first_cue_text || cues[0]?.translated_text || cues[0]?.source_text || (hasCues ? 'Đã trích xuất phụ đề' : 'Chưa quét phụ đề');
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
        className="px-3 py-2 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between text-xs gap-2 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={onToggleSelect}
            className="text-slate-400 hover:text-indigo-400 transition shrink-0"
            title={isSelected ? 'Bỏ chọn' : 'Chọn để xử lý hàng loạt'}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-cyan-400" />
            ) : (
              <Square className="w-4 h-4 text-slate-600 hover:text-slate-400" />
            )}
          </button>

          <span className="font-semibold text-slate-200 text-[11px] truncate" title={project.title}>
            {project.title}
          </span>
        </div>

        {/* Cụm Badges Trạng Thái Thực Tế: Gốc | Dịch | Giọng | Xuất */}
        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
              hasCues
                ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
            title={hasCues ? `Đã trích xuất ${project.cues_count} câu thoại` : 'Chưa trích xuất phụ đề gốc'}
          >
            Gốc
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
              (project.translated_count || 0) > 0
                ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
            title={(project.translated_count || 0) > 0 ? `Đã dịch ${project.translated_count} câu thoại` : 'Chưa dịch thuật'}
          >
            Dịch
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
              project.has_voiceover
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-500'
            }`}
            title={project.has_voiceover ? 'Đã tạo giọng đọc thuyết minh' : 'Chưa tạo giọng đọc'}
          >
            Giọng
          </span>
          {project.has_export && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-600/20 border border-purple-500/40 text-purple-300" title="Đã kết xuất video hoàn chỉnh">
              Xuất
            </span>
          )}

          <button
            onClick={() => onOpenSettings(project)}
            className="p-1 text-slate-500 hover:text-slate-300 transition ml-0.5"
            title="Cài đặt chuẩn riêng cho video này"
          >
            <Settings className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Xóa video "${project.title}"?`)) onDeleteProject(project.project_id);
            }}
            className="p-1 text-slate-600 hover:text-rose-400 transition"
            title="Xóa video"
          >
            <X className="w-3 h-3" />
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

        {/* Bounding Box ROI Khung Kéo Căn Chỉnh Vùng Quét (8 Nốt Tay Cầm Màu Trắng - Tương Tác Kéo Thả & Co Giãn Thật) */}
        <div
          className="absolute border border-white/80 transition-[border-color] flex items-center justify-center shadow-2xl z-20 select-none group/roi"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`,
            cursor: dragMode === 'move' ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => handleMouseDown('move', e)}
          title="Kéo thân hộp để di chuyển, kéo 8 nốt trắng để co giãn vùng che & quét sub"
        >
          {/* Lớp Mask Che Mờ Sub Gốc (B0) */}
          {layerVisibility.mask && (
            <div className="absolute inset-0 backdrop-blur-[14px] bg-black/35 rounded-sm -z-10 shadow-inner pointer-events-none" />
          )}

          {/* Phụ Đề Dịch Tiếng Việt Thật Từ Cơ Sở Dữ Liệu Đồng Bộ Thời Gian Thực */}
          {layerVisibility.translatedSub && (
            <div className="text-amber-300 font-bold text-[11px] sm:text-xs text-center px-2 py-0.5 tracking-wide leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,1)] [text-shadow:_0_1px_3px_rgba(0,0,0,0.95)] truncate max-w-[96%] pointer-events-none">
              {renderSubtitleText()}
            </div>
          )}

          {/* Badge Tag B0 & S1 và Tooltip Tọa độ */}
          <div className="absolute -bottom-3 left-0 flex items-center gap-1 pointer-events-none">
            <span className="text-[7px] font-mono bg-indigo-950/90 text-indigo-300 border border-indigo-700 px-1 rounded shadow">
              S1/B0
            </span>
            {(dragMode || isSavedRecently) && (
              <span className="text-[7px] font-mono bg-slate-950/90 text-cyan-300 border border-slate-700 px-1 rounded shadow animate-in fade-in">
                {isSavedRecently ? 'Đã lưu ROI' : `Y:${Math.round(region.y * 100)}% H:${Math.round(region.height * 100)}%`}
              </span>
            )}
          </div>

          {/* 4 Nốt Góc Màu Trắng (Có thể kéo co giãn nw, ne, sw, se) */}
          <div
            className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-slate-900 rounded-xs shadow cursor-nwse-resize hover:scale-125 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('nw', e)}
            title="Kéo chỉnh góc Trên-Trái"
          />
          <div
            className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-slate-900 rounded-xs shadow cursor-nesw-resize hover:scale-125 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('ne', e)}
            title="Kéo chỉnh góc Trên-Phải"
          />
          <div
            className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-slate-900 rounded-xs shadow cursor-nesw-resize hover:scale-125 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('sw', e)}
            title="Kéo chỉnh góc Dưới-Trái"
          />
          <div
            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-slate-900 rounded-xs shadow cursor-nwse-resize hover:scale-125 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('se', e)}
            title="Kéo chỉnh góc Dưới-Phải"
          />

          {/* 4 Nốt Cạnh Màu Trắng (Có thể kéo co giãn n, s, w, e) */}
          <div
            className="absolute -top-1 left-1/2 -translate-x-1/2 w-4 h-2 bg-white border border-slate-900 rounded-xs shadow cursor-ns-resize hover:scale-110 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('n', e)}
            title="Kéo chỉnh cạnh Trên"
          />
          <div
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-2 bg-white border border-slate-900 rounded-xs shadow cursor-ns-resize hover:scale-110 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('s', e)}
            title="Kéo chỉnh cạnh Dưới"
          />
          <div
            className="absolute top-1/2 -left-1 -translate-y-1/2 h-4 w-2 bg-white border border-slate-900 rounded-xs shadow cursor-ew-resize hover:scale-110 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('w', e)}
            title="Kéo chỉnh cạnh Trái"
          />
          <div
            className="absolute top-1/2 -right-1 -translate-y-1/2 h-4 w-2 bg-white border border-slate-900 rounded-xs shadow cursor-ew-resize hover:scale-110 transition-transform z-30 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('e', e)}
            title="Kéo chỉnh cạnh Phải"
          />
        </div>

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
        {/* Dropdown Chế Độ Xem */}
        <select
          value={subMode}
          onChange={(e) => setSubMode(e.target.value as any)}
          className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 font-medium focus:outline-none cursor-pointer"
        >
          <option value="translated">Sub dịch</option>
          <option value="original">Gốc</option>
          <option value="both">Đè mờ</option>
        </select>

        {/* Cụm Nút Play / Stop / Timecode */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleStop}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
            title="Dừng & Về đầu"
          >
            <StopIcon className="w-3 h-3" />
          </button>
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

        {/* Nút Phóng To / Mở Studio Chi Tiết */}
        <button
          onClick={() => onSelectProject(project)}
          className="p-1 text-slate-400 hover:text-indigo-300 transition flex items-center gap-1 text-[10px] font-semibold"
          title="Mở Studio Chi Tiết"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export const DashboardBatchHub: React.FC<DashboardBatchHubProps> = ({
  projects,
  presets,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onOpenPresetManager,
  onRefreshProjects,
  onBatchProjectsCreated,
  onOpenQueue,
}) => {
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [activeBatchPresetId, setActiveBatchPresetId] = useState<string>('');
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const [sidebarTab, setSidebarTab] = useState<'pipeline' | 'layers' | 'tune'>('layers');
  const [subTab, setSubTab] = useState<'layers' | 'details'>('layers');

  // Trạng thái các Layer (Bật / Tắt theo ảnh tham khảo)
  const [layerVisibility, setLayerVisibility] = useState({
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

  // Vận hành Hàng Đợi Tuần Tự (Sequential FIFO Queue)
  const handleStartQueue = async (action: 'all' | 'ocr' | 'translate' | 'dubbing' | 'export') => {
    const targets = selectedProjectIds.length > 0
      ? projects.filter((p) => selectedProjectIds.includes(p.project_id))
      : projects;

    if (targets.length === 0) return;

    const initialQueue: BatchQueueItem[] = targets.map((p) => ({
      projectId: p.project_id,
      title: p.title,
      status: 'pending',
    }));

    setQueueItems(initialQueue);
    setIsQueueRunning(true);
    isPausedRef.current = false;
    isCancelledRef.current = false;

    for (let idx = 0; idx < targets.length; idx++) {
      if (isCancelledRef.current) break;

      while (isPausedRef.current) {
        await new Promise((r) => setTimeout(r, 400));
        if (isCancelledRef.current) break;
      }
      if (isCancelledRef.current) break;

      const targetProj = targets[idx];

      try {
        if (action === 'all' || action === 'ocr') {
          setQueueItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, status: 'scanning' } : it))
          );
          setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang quét OCR: "${targetProj.title}"...`);
          await apiClient.runPipeline(targetProj.project_id, { sync: true });
        }

        if (action === 'all' || action === 'translate') {
          setQueueItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, status: 'translating' } : it))
          );
          setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang dịch thuật AI: "${targetProj.title}"...`);
          try {
            await apiClient.retranslateProject(targetProj.project_id);
          } catch {}
        }

        if (action === 'all' || action === 'dubbing') {
          setQueueItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, status: 'voicing' } : it))
          );
          setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang tạo thuyết minh AI: "${targetProj.title}"...`);
          try {
            await apiClient.runDubbing(targetProj.project_id);
          } catch (err: any) {
            console.warn('Dubbing error:', err);
          }
        }

        if (action === 'all' || action === 'export') {
          setQueueItems((prev) =>
            prev.map((it, i) => (i === idx ? { ...it, status: 'exporting' } : it))
          );
          setQueueStatusMessage(`[${idx + 1}/${targets.length}] Đang render xuất video MP4: "${targetProj.title}"...`);
          try {
            await apiClient.exportMp4(targetProj.project_id, {
              use_translated: true,
              mask_mode: 'blur',
            });
          } catch {}
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
    setQueueStatusMessage('✓ Hoàn tất xử lý hàng đợi tuần tự!');
    setTimeout(() => setQueueStatusMessage(null), 4000);
    onRefreshProjects();
  };

  const handleCancelQueue = () => {
    isCancelledRef.current = true;
    setIsQueueRunning(false);
    setQueueStatusMessage('Đã dừng hàng đợi xử lý.');
  };

  const scannedCount = projects.filter((p) => (p.cues_count || 0) > 0).length;
  const translatedCount = projects.filter((p) => (p.translated_count || 0) > 0).length;
  const voiceCount = projects.filter((p) => p.has_voiceover).length;
  const completedCount = isQueueRunning
    ? queueItems.filter((i) => i.status === 'completed').length
    : projects.filter((p) => p.has_export).length;

  return (
    <div className="flex-1 w-full h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* 1. Header Đỉnh Chuẩn Mẫu (Header Bar) */}
      <header className="h-11 shrink-0 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between z-40">
        {/* Trái: Logo & Các Tab Điều Hướng */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
            <div className="p-1 bg-indigo-600 rounded text-white shadow">
              <Film className="w-3.5 h-3.5" />
            </div>
            <span>Subtitle Localizer Studio</span>
          </div>

          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={onNewProject}
              className="px-2.5 py-1 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 border border-indigo-500/30 transition flex items-center gap-1.5 font-semibold"
              title="Tạo dự án mới"
            >
              <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Tạo Dự Án</span>
            </button>

            <button
              onClick={onOpenPresetManager}
              className="px-2.5 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-1.5 font-medium"
            >
              <Settings className="w-3.5 h-3.5 text-indigo-400" />
              <span>Thiết Lập</span>
            </button>
            <button
              onClick={() => {
                if (projects.length > 0) onSelectProject(projects[0]);
              }}
              className="px-2.5 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-1.5 font-medium"
            >
              <FileText className="w-3.5 h-3.5 text-amber-400" />
              <span>Kịch bản</span>
            </button>
            <button
              onClick={() => {
                if (projects.length > 0) onSelectProject(projects[0]);
              }}
              className="px-2.5 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-1.5 font-medium text-rose-300"
            >
              <span>Chi tiết Studio</span>
            </button>
            <button
              onClick={() => {
                if (projects.length > 0) {
                  window.open(apiClient.getExportSrtUrl(projects[0].project_id, true), '_blank');
                }
              }}
              className="px-2.5 py-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition flex items-center gap-1.5 font-medium"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tải xuống SRT</span>
            </button>

            {onOpenQueue && (
              <button
                onClick={onOpenQueue}
                className="px-2.5 py-1 rounded text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-700/50 transition flex items-center gap-1.5 font-semibold text-xs shadow-sm active:scale-95"
                title="Mở Trang Quản Lý Hàng Đợi Tải Phim"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>Hàng Đợi</span>
              </button>
            )}
          </div>
        </div>

        {/* Phải: Ngôn ngữ, Trạng thái Engine & Nút Mở Studio */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-[10px] font-mono">
            <span className="text-cyan-400 font-bold">VI</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">ZH</span>
          </div>

          <button
            onClick={() => {
              setShowGeminiPoolModal(true);
              fetchGeminiPoolStatus();
            }}
            className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-amber-500/50 text-amber-300 font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            title="Quản lý danh sách API keys và xem trạng thái xoay tua Round-Robin"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Pool: {geminiPoolStatus ? `${geminiPoolStatus.active_keys}/${geminiPoolStatus.total_keys}` : '...'} Keys
            </span>
            {geminiPoolStatus && geminiPoolStatus.cooldown_keys > 0 && (
              <span className="px-1 py-0.2 rounded bg-rose-900/80 text-rose-300 text-[9px] font-mono">
                {geminiPoolStatus.cooldown_keys} nghỉ
              </span>
            )}
          </button>

          <span className="px-2.5 py-1 rounded bg-emerald-950/80 border border-emerald-600/50 text-emerald-400 font-bold text-[10px] tracking-wide flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Local Engine Sẵn Sàng</span>
          </span>

          <button
            onClick={() => {
              if (projects.length > 0) onSelectProject(projects[0]);
            }}
            disabled={projects.length === 0}
            className="px-3.5 py-1 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold rounded-lg text-xs transition shadow disabled:opacity-40"
          >
            Vào Studio
          </button>
        </div>
      </header>

      {/* 2. Thân Chính: Lưới Video Hàng Loạt (Trái) + Sidebar Thành Phần & Chi Tiết (Phải) */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* CỘT TRÁI: Lưới Thẻ Video (Batch Video Grid) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-slate-950/90">
          {/* Header phụ phía trên lưới: Chọn tất cả, Xóa đã chọn & Xóa tất cả */}
          {projects.length > 0 && (
            <div className="flex items-center justify-between px-1 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition px-2.5 py-1 rounded bg-slate-900 border border-slate-800"
                >
                  {selectedProjectIds.length === projects.length ? (
                    <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span>Chọn tất cả ({projects.length})</span>
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
                  title="Xóa toàn bộ dự án đang có"
                >
                  <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-rose-400" />
                  <span>Xóa tất cả</span>
                </button>
              </div>
            </div>
          )}

          {/* Thông báo trạng thái Queue / Upload */}
          {(batchUploadStatus || queueStatusMessage) && (
            <div className="p-2.5 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-xs text-indigo-200 flex items-center justify-between shadow animate-in fade-in">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
                <span>{batchUploadStatus || queueStatusMessage}</span>
              </div>
              {isQueueRunning && (
                <button
                  onClick={handleCancelQueue}
                  className="px-2 py-0.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded text-[10px] font-bold"
                >
                  Dừng khẩn cấp
                </button>
              )}
            </div>
          )}

          {/* Lưới các Thẻ Video */}
          {projects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-3 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
              <Film className="w-12 h-12 text-slate-600" />
              <div className="space-y-1">
                <h3 className="text-white font-semibold text-sm">Chưa có video nào trong dự án</h3>
                <p className="text-slate-400 text-xs">
                  Bấm &quot;Thêm video&quot; ở thanh bên dưới để nạp hàng loạt video từ máy tính của bạn.
                </p>
              </div>
              <button
                onClick={() => batchFileInputRef.current?.click()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow transition"
              >
                + Thêm video ngay
              </button>
            </div>
          ) : (
            <div
              className={`grid gap-3.5 ${
                gridCols === 2
                  ? 'grid-cols-1 md:grid-cols-2'
                  : gridCols === 4
                  ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
                  : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {projects.map((proj) => (
                <BatchVideoCard
                  key={proj.project_id}
                  project={proj}
                  isSelected={selectedProjectIds.includes(proj.project_id)}
                  onToggleSelect={(e) => handleToggleSelectProject(proj.project_id, e)}
                  onSelectProject={onSelectProject}
                  onDeleteProject={onDeleteProject}
                  onOpenSettings={onOpenPresetManager}
                  onRegionSaved={(pId, newRegion) => {
                    const p = projects.find((x) => x.project_id === pId);
                    if (p) p.regions = [newRegion];
                  }}
                  layerVisibility={layerVisibility}
                />
              ))}
            </div>
          )}
        </div>

        {/* CỘT PHẢI: Sidebar "Thành Phần" & "Chi Tiết" (Layers & Inspector) */}
        <div className="w-72 sm:w-80 shrink-0 bg-slate-900 border-l border-slate-800 flex flex-col min-h-0 text-xs select-none">
          {/* Top Tabs: Pipeline | Thành phần | Tinh chỉnh video */}
          <div className="h-9 bg-slate-950 border-b border-slate-800 flex items-center px-1">
            <button
              onClick={() => setSidebarTab('pipeline')}
              className={`flex-1 py-1.5 text-center text-[11px] font-semibold transition ${
                sidebarTab === 'pipeline' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Pipeline
            </button>
            <button
              onClick={() => setSidebarTab('layers')}
              className={`flex-1 py-1.5 text-center text-[11px] font-semibold transition ${
                sidebarTab === 'layers' ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Thành phần
            </button>
            <button
              onClick={() => setSidebarTab('tune')}
              className={`flex-1 py-1.5 text-center text-[11px] font-semibold transition ${
                sidebarTab === 'tune' ? 'text-amber-400 border-b-2 border-amber-500' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tinh chỉnh video
            </button>
          </div>

          {/* Subtabs khi ở tab Thành phần (layers) */}
          {sidebarTab === 'layers' && (
            <div className="flex border-b border-slate-800 bg-slate-950/60 text-[10px] font-semibold">
              <button
                onClick={() => setSubTab('layers')}
                className={`flex-1 py-1.5 text-center transition ${
                  subTab === 'layers' ? 'bg-slate-800/80 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Lớp (Layers)
              </button>
              <button
                onClick={() => setSubTab('details')}
                className={`flex-1 py-1.5 text-center transition ${
                  subTab === 'details' ? 'bg-slate-800/80 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Chi tiết
              </button>
            </div>
          )}

          {/* Nội Dung Các Lớp & Tùy Chọn Theo Tab */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {sidebarTab === 'pipeline' && (
              <div className="space-y-4 text-xs">
                <div>
                  <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    Cấu Hình Pipeline Hàng Loạt
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Quy trình tự động hóa 4 bước: Quét phụ đề OCR &rarr; Dịch AI &rarr; Lồng tiếng TTS &rarr; Xuất MP4.
                  </p>
                </div>

                <div className="space-y-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">OCR Engine:</span>
                    <span className="font-semibold text-cyan-300">RapidOCR ONNX (Local)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Dịch thuật:</span>
                    <span className="font-semibold text-amber-300">Gemini 2.5 Flash / Google</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Thuyết minh (TTS):</span>
                    <span className="font-semibold text-emerald-300">Edge Neural TTS (vi-VN)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Render phần cứng:</span>
                    <span className="font-semibold text-purple-300">FFmpeg NVENC / CPU</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400 block text-[11px] font-medium">Giọng đọc thuyết minh:</label>
                  <select
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 text-xs"
                    defaultValue="vi-VN-NamMinhNeural"
                  >
                    <option value="vi-VN-NamMinhNeural">Nam Minh (vi-VN-NamMinhNeural - Truyền cảm)</option>
                    <option value="vi-VN-HoaiMyNeural">Hoài My (vi-VN-HoaiMyNeural - Nữ dịu dàng)</option>
                  </select>
                </div>

                <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-[11px] text-indigo-200">
                  ⚡ <strong>100% Dữ liệu thật</strong>: Toàn bộ quá trình quét, dịch và lồng tiếng chạy trên video thực tế.
                </div>
              </div>
            )}

            {sidebarTab === 'tune' && (
              <div className="space-y-4 text-xs">
                <div>
                  <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    Hiệu Chỉnh Video Đầu Ra
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Tùy chỉnh che mờ phụ đề gốc, hòa âm giọng đọc và căn chỉnh khung hình.
                  </p>
                </div>

                <div className="space-y-2.5 text-[11px]">
                  <div>
                    <label className="text-slate-400 block mb-1">Kiểu che mờ phụ đề gốc:</label>
                    <select
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 text-xs"
                      defaultValue="blur"
                    >
                      <option value="blur">Mờ hòa tan tự nhiên (Optical Seamless Blur)</option>
                      <option value="glass">Kính mờ trong suốt (Frosted Glass)</option>
                      <option value="box">Hộp đen Cinema truyền thống</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Âm lượng nhạc nền khi có thuyết minh:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="0.1"
                        max="0.5"
                        step="0.05"
                        defaultValue="0.25"
                        className="flex-1 accent-indigo-500"
                      />
                      <span className="font-mono text-slate-300 text-xs">25%</span>
                    </div>
                    <span className="text-[10px] text-slate-500">Tự động hạ nhỏ nhạc nền để nổi bật giọng đọc</span>
                  </div>
                </div>
              </div>
            )}

            {sidebarTab === 'layers' && subTab === 'layers' && (
              <>
                {/* 1. Nhóm Video & Ảnh */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-cyan-600/30 text-cyan-400 font-bold font-mono flex items-center justify-center text-[10px]">
                        V
                      </span>
                      <span className="font-semibold text-slate-200">Video gốc</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerVisibility.video}
                      onChange={(e) => setLayerVisibility({ ...layerVisibility, video: e.target.checked })}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-rose-600/30 text-rose-400 font-bold font-mono flex items-center justify-center text-[10px]">
                        M0
                      </span>
                      <span className="text-slate-300">Logo Watermark</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerVisibility.watermark}
                      onChange={(e) => setLayerVisibility({ ...layerVisibility, watermark: e.target.checked })}
                      className="rounded accent-rose-500 cursor-pointer"
                    />
                  </div>
                </div>

                {/* 2. Nhóm Văn Bản (Subtitles) */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Văn bản phụ đề</div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-amber-600/30 text-amber-400 font-bold font-mono flex items-center justify-center text-[10px]">
                        S1
                      </span>
                      <span className="text-slate-300">Phụ đề dịch (Tiếng Việt)</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerVisibility.translatedSub}
                      onChange={(e) => setLayerVisibility({ ...layerVisibility, translatedSub: e.target.checked })}
                      className="rounded accent-amber-500 cursor-pointer"
                    />
                  </div>
                </div>

                {/* 3. Nhóm Che Mờ (Masking) */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Vùng che mờ</div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-indigo-600/30 text-indigo-400 font-bold font-mono flex items-center justify-center text-[10px]">
                        B0
                      </span>
                      <span className="text-slate-300">Hộp mờ che sub gốc</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerVisibility.mask}
                      onChange={(e) => setLayerVisibility({ ...layerVisibility, mask: e.target.checked })}
                      className="rounded accent-indigo-500 cursor-pointer"
                    />
                  </div>
                </div>

                {/* 4. Nhóm Âm Thanh (Audio) */}
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Âm thanh</div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-cyan-600/30 text-cyan-400 font-bold font-mono flex items-center justify-center text-[10px]">
                        A0
                      </span>
                      <span className="text-slate-300">Âm thanh gốc</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerVisibility.audio}
                      onChange={(e) => setLayerVisibility({ ...layerVisibility, audio: e.target.checked })}
                      className="rounded accent-cyan-500 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-emerald-600/30 text-emerald-400 font-bold font-mono flex items-center justify-center text-[10px]">
                        A1
                      </span>
                      <span className="text-slate-300">Lồng tiếng AI</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={layerVisibility.voiceover}
                      onChange={(e) => setLayerVisibility({ ...layerVisibility, voiceover: e.target.checked })}
                      className="rounded accent-emerald-500 cursor-pointer"
                    />
                  </div>
                </div>
              </>
            )}

            {sidebarTab === 'layers' && subTab === 'details' && (
              /* Subtab Chi Tiết (Inspector) */
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1 font-medium">Chuẩn áp dụng:</label>
                  <select
                    value={activeBatchPresetId || defaultPreset?.id}
                    onChange={(e) => setActiveBatchPresetId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200"
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Kiểu che:</span>
                    <span className="font-semibold text-cyan-300">Mờ hòa tan video</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tỉ lệ khung hình:</span>
                    <span className="font-semibold text-indigo-300">16:9 Cinema</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Ngôn ngữ:</span>
                    <span className="font-semibold text-amber-300">Trung (zh) &rarr; Việt (vi)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Tọa độ ROI:</span>
                    <span className="font-mono text-slate-400">Y: 81%, H: 15%, W: 88%</span>
                  </div>
                </div>

                <button
                  onClick={onOpenPresetManager}
                  className="w-full py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded font-semibold transition"
                >
                  Chỉnh sửa Profile Chuẩn
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Thanh Quy Trình Tự Động Hóa Đáy (Batch Pipeline Action Bar) */}
      <footer className="h-14 shrink-0 bg-slate-900 border-t border-slate-800 px-4 flex items-center justify-between z-40 select-none">
        {/* Nhóm Nút Xử Lý Hàng Loạt Chuẩn 5 Bước */}
        <div className="flex items-center gap-2">
          {/* File Input Ẩn */}
          <input
            ref={batchFileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={handleBatchFileSelect}
          />

          <button
            onClick={() => batchFileInputRef.current?.click()}
            disabled={isBatchUploading || isQueueRunning}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 shadow transition disabled:opacity-50"
            title="Thêm một hoặc nhiều video từ máy tính vào danh sách"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{isBatchUploading ? 'Đang nạp...' : 'Thêm video'}</span>
          </button>

          <button
            onClick={() => setShowUrlDownloadModal(true)}
            disabled={isQueueRunning}
            className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 shadow transition disabled:opacity-50"
            title="Tải trọn bộ video từ đường link bất kỳ và quản lý hàng đợi tải (hỗ trợ mở khóa toàn bộ tập VIP Hồng Quả, YouTube, Bilibili...)"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-300" />
            <span>Tải từ Link & Hàng Đợi</span>
            <span className="px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-200 text-[9px] font-bold border border-emerald-400/30">
              Hồng Quả
            </span>
          </button>

          <button
            onClick={() => setShowDeviceSettingsModal(true)}
            disabled={isQueueRunning}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 border border-slate-700 shadow transition disabled:opacity-50"
            title="Xem và điều chỉnh định danh thiết bị Android ByteDance, proxy, và tần suất xoay thiết bị"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span>Thiết bị & Proxy</span>
          </button>

          <button
            onClick={() => handleStartQueue('ocr')}
            disabled={isQueueRunning || projects.length === 0}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs rounded-lg flex items-center gap-1.5 border border-slate-700 transition disabled:opacity-40"
            title="Quét trích xuất phụ đề gốc cho các video đã chọn"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Trích phụ đề</span>
          </button>

          <button
            onClick={() => handleStartQueue('translate')}
            disabled={isQueueRunning || projects.length === 0}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs rounded-lg flex items-center gap-1.5 border border-slate-700 transition disabled:opacity-40"
            title="Dịch thuật AI theo ngôn ngữ đích"
          >
            <Languages className="w-3.5 h-3.5 text-cyan-400" />
            <span>Dịch</span>
          </button>

          <button
            onClick={() => handleStartQueue('dubbing')}
            disabled={isQueueRunning || projects.length === 0}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold text-xs rounded-lg flex items-center gap-1.5 border border-slate-700 transition disabled:opacity-40"
            title="Sinh giọng đọc thuyết minh tiếng Việt"
          >
            <Mic className="w-3.5 h-3.5 text-emerald-400" />
            <span>Lồng tiếng</span>
          </button>

          <button
            onClick={() => handleStartQueue('all')}
            disabled={isQueueRunning || projects.length === 0}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow transition disabled:opacity-40"
            title="Chạy tuần tự toàn bộ quy trình và kết xuất video MP4"
          >
            <Rocket className="w-4 h-4" />
            <span>Xuất ({selectedProjectIds.length > 0 ? selectedProjectIds.length : projects.length})</span>
          </button>

          <button
            onClick={handleCancelQueue}
            disabled={!isQueueRunning}
            className="px-3 py-2 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 font-semibold text-xs rounded-lg flex items-center gap-1.5 border border-slate-700 transition disabled:opacity-30"
          >
            <Octagon className="w-3.5 h-3.5 text-rose-500" />
            <span>Dừng</span>
          </button>
        </div>

        {/* Cụm Thống Kê Tiến Độ, Phân Trang & Bộ Đổi Layout Cột */}
        <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
          {/* Thống kê 4 bước */}
          <div className="hidden lg:flex items-center gap-2.5 px-3 py-1 rounded bg-slate-950 border border-slate-800 text-[11px]">
            <span className="text-indigo-300 flex items-center gap-1">
              📄 {scannedCount}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-cyan-300 flex items-center gap-1">
              🌐 {translatedCount}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-300 flex items-center gap-1">
              🎤 {voiceCount}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400 font-bold flex items-center gap-1">
              ⏱ {completedCount}/{projects.length}
            </span>
          </div>

          {/* Phân Trang */}
          <div className="flex items-center gap-1">
            <button className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-400">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] px-1">1/1</span>
            <button className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-400">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Dropdown Layout Cột (2 | 3 | 4 cột) */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Layout:</span>
            <select
              value={gridCols}
              onChange={(e) => setGridCols(parseInt(e.target.value) as any)}
              className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] text-slate-300 font-bold focus:outline-none cursor-pointer"
            >
              <option value={2}>2 Cột</option>
              <option value={3}>3 Cột</option>
              <option value={4}>4 Cột</option>
            </select>
          </div>
        </div>
      </footer>

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
                    ? `Bạn có chắc chắn muốn xóa ${selectedProjectIds.length} video/dự án đang được tích chọn? Thao tác này sẽ xóa vĩnh viễn dữ liệu phụ đề và kịch bản đã tạo.`
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
    </div>
  );
};
