import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Scissors,
  Trash2,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Clock,
  ChevronDown,
  ChevronUp,
  Mic,
} from 'lucide-react';
import { apiClient } from '../../api/client';
import { SubtitleCueV1 } from '../../types/api';

interface BottomTimelineProps {
  videoUrl?: string;
  projectId?: string;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  cues?: SubtitleCueV1[];
  selectedCueId?: string | null;
  onSelectCue?: (cue: SubtitleCueV1) => void;
  onUpdateCueTime?: (cueId: string, startPts: number, endPts: number) => void;
  onSplitCue?: (time: number) => void;
  onDeleteCue?: (cueId: string) => void;
  hasVoiceover?: boolean;
  isAudioMuted?: boolean;
  onToggleAudioMute?: () => void;
  isVideoVisible?: boolean;
  onToggleVideoVisible?: () => void;
  isSubVisible?: boolean;
  onToggleSubVisible?: () => void;
}

const BottomTimelineComponent: React.FC<BottomTimelineProps> = ({
  videoUrl,
  projectId,
  duration,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  cues = [],
  selectedCueId,
  onSelectCue,
  onUpdateCueTime,
  onSplitCue,
  onDeleteCue,
  hasVoiceover = false,
  isAudioMuted: externalAudioMuted,
  onToggleAudioMute,
  isVideoVisible: externalVideoVisible,
  onToggleVideoVisible,
  isSubVisible: externalSubVisible,
  onToggleSubVisible,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<{ time: number; dataUrl: string }[]>([]);
  const [, setIsGeneratingThumbs] = useState<boolean>(false);

  // Trạng thái Khóa / Ẩn / Tắt tiếng từng Track NLE
  const [isSubLocked, setIsSubLocked] = useState<boolean>(false);
  const [internalSubVisible, setInternalSubVisible] = useState<boolean>(true);
  const isSubVisible = externalSubVisible !== undefined ? externalSubVisible : internalSubVisible;

  const [isVideoLocked, setIsVideoLocked] = useState<boolean>(false);
  const [internalVideoVisible, setInternalVideoVisible] = useState<boolean>(true);
  const isVideoVisible = externalVideoVisible !== undefined ? externalVideoVisible : internalVideoVisible;

  const [isVoiceoverLocked, setIsVoiceoverLocked] = useState<boolean>(false);
  const [isVoiceoverMuted, setIsVoiceoverMuted] = useState<boolean>(false);

  const [isAudioLocked, setIsAudioLocked] = useState<boolean>(false);
  const [internalAudioMuted, setInternalAudioMuted] = useState<boolean>(false);
  const isAudioMuted = externalAudioMuted !== undefined ? externalAudioMuted : internalAudioMuted;

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // Đồng bộ âm thanh Lồng tiếng Track A1 với Playhead
  useEffect(() => {
    const audio = voiceAudioRef.current;
    if (!audio || !hasVoiceover) return;

    if (isPlaying && !isVoiceoverMuted) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying, hasVoiceover, isVoiceoverMuted]);

  useEffect(() => {
    const audio = voiceAudioRef.current;
    if (!audio || !hasVoiceover) return;
    try {
      if (audio.readyState >= 1 && Math.abs(audio.currentTime - currentTime) > 0.25) {
        audio.currentTime = currentTime;
      }
    } catch {}
  }, [currentTime, hasVoiceover]);

  useEffect(() => {
    const audio = voiceAudioRef.current;
    if (!audio) return;
    audio.muted = isVoiceoverMuted;
  }, [isVoiceoverMuted]);

  // Trạng thái kéo co giãn cạnh đầu/cuối của câu phụ đề (Trim Cue Dragging)
  const [trimmingState, setTrimmingState] = useState<{
    cueId: string;
    handle: 'start' | 'end' | 'move';
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
  } | null>(null);

  const totalDuration = Math.max(1.0, duration);

  // Xác định câu phụ đề đang phát tại currentTime
  const activeCue = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    return cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts) || null;
  }, [cues, currentTime]);

  const activeCueId = selectedCueId || activeCue?.cue_id || null;

  // Định dạng thời gian SMPTE Timecode: 00:00:00:00
  const formatSmpteTimecode = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 25);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  // Nạp dữ liệu sóng âm thanh (Waveform Peaks) từ backend API
  useEffect(() => {
    if (!projectId) return;
    let isCancelled = false;

    apiClient
      .getAudioWaveform(projectId)
      .then((data) => {
        if (!isCancelled && data?.peaks?.length > 0) {
          setAudioPeaks(data.peaks);
        }
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, [projectId]);

  // Tự động trích xuất chuỗi khung hình Thumbnail (Filmstrip) bằng Canvas
  useEffect(() => {
    if (!videoUrl || duration <= 0) return;
    let isCancelled = false;

    const generateThumbnails = async () => {
      setIsGeneratingThumbs(true);
      const offscreenVideo = document.createElement('video');
      offscreenVideo.crossOrigin = 'anonymous';
      offscreenVideo.src = videoUrl;
      offscreenVideo.muted = true;
      offscreenVideo.preload = 'auto';

      try {
        await new Promise<void>((resolve, reject) => {
          offscreenVideo.onloadedmetadata = () => resolve();
          offscreenVideo.onerror = () => reject();
        });

        const thumbCount = Math.min(24, Math.max(8, Math.floor(duration / 3)));
        const step = duration / thumbCount;
        const result: { time: number; dataUrl: string }[] = [];

        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 68;
        const ctx = canvas.getContext('2d');

        for (let i = 0; i < thumbCount; i++) {
          if (isCancelled) break;
          const targetTime = i * step;

          await new Promise<void>((resolve) => {
            let timer: any = null;
            const cleanup = () => {
              if (timer) clearTimeout(timer);
              offscreenVideo.onseeked = null;
              offscreenVideo.onerror = null;
            };

            timer = setTimeout(() => {
              cleanup();
              resolve();
            }, 800);

            offscreenVideo.onseeked = () => {
              cleanup();
              if (ctx) {
                try {
                  ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
                  result.push({
                    time: targetTime,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.6),
                  });
                } catch {}
              }
              resolve();
            };

            offscreenVideo.onerror = () => {
              cleanup();
              resolve();
            };

            offscreenVideo.currentTime = targetTime;
          });
        }

        if (!isCancelled) {
          setThumbnails(result);
        }
      } catch {
      } finally {
        if (!isCancelled) setIsGeneratingThumbs(false);
      }
    };

    generateThumbnails();

    return () => {
      isCancelled = true;
    };
  }, [videoUrl, duration]);

  // Xử lý kéo Playhead Scrubber chuẩn xác tuyệt đối ở mọi mức zoom
  const handleTimelineScrub = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!trackAreaRef.current || totalDuration <= 0) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const scrollLeft = trackAreaRef.current.scrollLeft || 0;
      const totalWidth = trackAreaRef.current.scrollWidth || (rect.width * Math.max(1, zoomLevel));
      const clickX = (e.clientX - rect.left) + scrollLeft;
      const pct = Math.max(0, Math.min(1, clickX / totalWidth));
      let targetTime = pct * totalDuration;

      // Tính năng Magnet Snap: Hút dính vào đầu hoặc cuối câu phụ đề gần nhất trong phạm vi 0.25s
      if (snapEnabled && cues && cues.length > 0) {
        for (const c of cues) {
          if (Math.abs(targetTime - c.start_pts) <= 0.25) {
            targetTime = c.start_pts;
            break;
          }
          if (Math.abs(targetTime - c.end_pts) <= 0.25) {
            targetTime = c.end_pts;
            break;
          }
        }
      }

      onSeek(parseFloat(targetTime.toFixed(3)));
    },
    [totalDuration, snapEnabled, cues, onSeek, zoomLevel]
  );

  const handleMouseDownScrub = (e: React.MouseEvent) => {
    setIsScrubbing(true);
    handleTimelineScrub(e);
  };

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMouseMove = (e: MouseEvent) => {
      handleTimelineScrub(e);
    };
    const handleMouseUp = () => {
      setIsScrubbing(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, handleTimelineScrub]);

  // Tự động cuộn theo Playhead khi phát video ở chế độ thu phóng (Follow Playhead Auto-Scroll)
  useEffect(() => {
    if (!trackAreaRef.current || !isPlaying || zoomLevel <= 1.0 || isScrubbing) return;
    const container = trackAreaRef.current;
    const totalWidth = container.scrollWidth;
    const playheadX = (currentTime / totalDuration) * totalWidth;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    const margin = container.clientWidth * 0.2;
    if (playheadX > viewRight - margin || playheadX < viewLeft + margin) {
      container.scrollLeft = Math.max(0, playheadX - container.clientWidth / 2);
    }
  }, [currentTime, isPlaying, zoomLevel, totalDuration, isScrubbing]);

  // Xử lý kéo mép co giãn Timecode của câu phụ đề (Trim Handles)
  const handleMouseDownTrim = (
    e: React.MouseEvent,
    cue: SubtitleCueV1,
    handle: 'start' | 'end' | 'move'
  ) => {
    if (isSubLocked) return;
    e.stopPropagation();
    e.preventDefault();
    setTrimmingState({
      cueId: cue.cue_id,
      handle,
      initialMouseX: e.clientX,
      initialStart: cue.start_pts,
      initialEnd: cue.end_pts,
    });
  };

  useEffect(() => {
    if (!trimmingState || !trackAreaRef.current || !onUpdateCueTime) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const totalWidth = trackAreaRef.current.scrollWidth || (rect.width * Math.max(1, zoomLevel));
      const deltaPixels = e.clientX - trimmingState.initialMouseX;
      const deltaSeconds = (deltaPixels / totalWidth) * totalDuration;

      let newStart = trimmingState.initialStart;
      let newEnd = trimmingState.initialEnd;

      if (trimmingState.handle === 'start') {
        newStart = Math.max(0, Math.min(trimmingState.initialEnd - 0.2, trimmingState.initialStart + deltaSeconds));
      } else if (trimmingState.handle === 'end') {
        newEnd = Math.max(trimmingState.initialStart + 0.2, Math.min(totalDuration, trimmingState.initialEnd + deltaSeconds));
      } else if (trimmingState.handle === 'move') {
        const cueLen = trimmingState.initialEnd - trimmingState.initialStart;
        newStart = Math.max(0, Math.min(totalDuration - cueLen, trimmingState.initialStart + deltaSeconds));
        newEnd = newStart + cueLen;
      }

      onUpdateCueTime(trimmingState.cueId, parseFloat(newStart.toFixed(3)), parseFloat(newEnd.toFixed(3)));
    };

    const handleMouseUp = () => {
      setTrimmingState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trimmingState, totalDuration, onUpdateCueTime, zoomLevel]);

  // Tính toán nhãn thước đo thời gian (Time Ruler Ticks)
  const rulerTicks = useMemo(() => {
    let step = 5;
    if (totalDuration > 300) step = 30;
    else if (totalDuration > 120) step = 15;
    else if (totalDuration > 60) step = 10;
    else if (totalDuration <= 15) step = 1;

    if (zoomLevel >= 2.0) {
      step = Math.max(1, Math.floor(step / 2));
    }

    const ticks: { time: number; label: string; pct: number }[] = [];
    for (let t = 0; t <= totalDuration; t += step) {
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      ticks.push({
        time: t,
        label: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
        pct: (t / totalDuration) * 100,
      });
    }
    return ticks;
  }, [totalDuration, zoomLevel]);

  const playheadPct = (currentTime / totalDuration) * 100;

  return (
    <div
      ref={containerRef}
      className={`w-full bg-slate-950 border-t border-slate-800/80 flex flex-col select-none transition-all duration-200 z-20 shrink-0 ${
        isCollapsed ? 'h-10' : 'h-64 sm:h-72'
      }`}
    >
      {/* 1. THANH CÔNG CỤ TIMELINE CHUẨN CAPCUT / PREMIERE (TOP TOOLBAR) */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-3 flex items-center justify-between shrink-0">
        {/* Nhóm Nút Phát / Tua & Timecode SMPTE */}
        <div className="flex items-center gap-3">
          {/* Nút Play / Pause */}
          <button
            type="button"
            onClick={onTogglePlay}
            className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-md active:scale-95 transition cursor-pointer"
            title="Phát / Tạm dừng (Space)"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
          </button>

          {/* Timecode Chuyên Nghiệp */}
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-amber-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800 shadow-inner">
              {formatSmpteTimecode(currentTime)}
            </span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-400">{formatSmpteTimecode(duration)}</span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Công cụ Cắt Câu Phụ Đề (Split Cue Tool - Ctrl+B / C) */}
          <button
            type="button"
            onClick={() => onSplitCue && onSplitCue(currentTime)}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-indigo-300 hover:text-white rounded-lg border border-slate-800 text-[11px] font-semibold shadow-sm transition active:scale-95 cursor-pointer"
            title="Cắt / Tách câu phụ đề tại vị trí kim Playhead (Ctrl + B hoặc C)"
          >
            <Scissors className="w-3 h-3 text-indigo-400" />
            <span>Cắt Câu</span>
          </button>

          {/* Công cụ Xóa Câu (Delete Cue Tool) */}
          {activeCueId && onDeleteCue && (
            <button
              type="button"
              onClick={() => onDeleteCue(activeCueId)}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 rounded-lg border border-rose-800/60 text-[11px] font-semibold shadow-sm transition active:scale-95 cursor-pointer"
              title="Xóa câu phụ đề đang chọn (Delete)"
            >
              <Trash2 className="w-3 h-3 text-rose-400" />
              <span>Xóa Câu</span>
            </button>
          )}

          {/* Nút Bật/Tắt Hút Dính Timecode (Magnet Snap) */}
          <button
            type="button"
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`p-1.5 rounded-lg border text-xs transition cursor-pointer ${
              snapEnabled
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300 shadow-sm'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
            title={`Tự động hút dính mốc thời gian (Magnet Snap): ${snapEnabled ? 'Đang BẬT' : 'Đang TẮT'}`}
          >
            <Magnet className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cụm Điều Khiển Phóng To / Thu Nhỏ & Thu Gọn */}
        <div className="flex items-center gap-2.5">
          {/* Zoom Timeline Slider */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
            <ZoomOut className="w-3 h-3 text-slate-500" />
            <input
              type="range"
              min="1.0"
              max="4.0"
              step="0.2"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              className="w-16 sm:w-24 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
              title={`Phóng to timeline: ${Math.round(zoomLevel * 100)}%`}
            />
            <ZoomIn className="w-3 h-3 text-slate-500" />
          </div>

          {/* Thu gọn / Mở rộng Timeline */}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title={isCollapsed ? 'Mở rộng Timeline đa Track' : 'Thu gọn Timeline'}
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 2. KHU VỰC ĐA TRACK CHÍNH (NLE MULTI-TRACK CANVAS) */}
      {!isCollapsed && (
        <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
          {/* A. CỘT ĐẦU TRACK BÊN TRÁI (TRACK HEADERS) */}
          <div className="w-24 sm:w-32 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 z-20">
            {/* Header Thước Đo */}
            <div className="h-6 border-b border-slate-800/80 px-2 flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>TRACKS</span>
              <Clock className="w-3 h-3" />
            </div>

            {/* Header Track 1: Phụ Đề [T] */}
            <div className="h-14 border-b border-slate-800/70 px-2 flex items-center justify-between bg-slate-900/40">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-indigo-950 border border-indigo-700/60 text-indigo-300 font-bold text-[10px] flex items-center justify-center">
                  T
                </span>
                <span className="text-[11px] font-semibold text-slate-300">Phụ Đề</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsSubLocked(!isSubLocked)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isSubLocked ? 'Mở khóa track phụ đề' : 'Khóa track phụ đề'}
                >
                  {isSubLocked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleSubVisible ? onToggleSubVisible() : setInternalSubVisible(!internalSubVisible)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isSubVisible ? 'Ẩn track phụ đề' : 'Hiện track phụ đề'}
                >
                  {isSubVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                </button>
              </div>
            </div>

            {/* Header Track 2: Video [V] */}
            <div className="h-14 border-b border-slate-800/70 px-2 flex items-center justify-between bg-slate-900/40">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[10px] flex items-center justify-center">
                  V
                </span>
                <span className="text-[11px] font-semibold text-slate-300">Video</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsVideoLocked(!isVideoLocked)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                >
                  {isVideoLocked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleVideoVisible ? onToggleVideoVisible() : setInternalVideoVisible(!internalVideoVisible)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isVideoVisible ? 'Ẩn video' : 'Hiện video'}
                >
                  {isVideoVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                </button>
              </div>
            </div>

            {/* Header Track 3: Lồng Tiếng [A1] */}
            <div className="h-10 border-b border-slate-800/70 px-2 flex items-center justify-between bg-slate-900/40">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-amber-950 border border-amber-700/60 text-amber-300 font-bold text-[10px] flex items-center justify-center">
                  A1
                </span>
                <span className="text-[10px] font-semibold text-slate-300">Lồng Tiếng</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsVoiceoverLocked(!isVoiceoverLocked)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isVoiceoverLocked ? 'Mở khóa track lồng tiếng' : 'Khóa track lồng tiếng'}
                >
                  {isVoiceoverLocked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsVoiceoverMuted(!isVoiceoverMuted)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isVoiceoverMuted ? 'Bật tiếng thuyết minh' : 'Tắt tiếng thuyết minh'}
                >
                  {isVoiceoverMuted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {/* Header Track 4: Audio Gốc [A2] */}
            <div className="flex-1 min-h-0 px-2 flex items-center justify-between bg-slate-900/40">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-300 font-bold text-[10px] flex items-center justify-center">
                  A2
                </span>
                <span className="text-[10px] font-semibold text-slate-300">Audio Gốc</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsAudioLocked(!isAudioLocked)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isAudioLocked ? 'Mở khóa track audio gốc' : 'Khóa track audio gốc'}
                >
                  {isAudioLocked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleAudioMute ? onToggleAudioMute() : setInternalAudioMuted(!internalAudioMuted)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                  title={isAudioMuted ? 'Bật tiếng gốc' : 'Tắt tiếng gốc'}
                >
                  {isAudioMuted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>

          {/* B. THÂN DÒNG THỜI GIAN CUỘN ĐƯỢC (SCROLLABLE TIMELINE BODY) */}
          <div
            ref={trackAreaRef}
            onMouseDown={handleMouseDownScrub}
            className="flex-1 min-h-0 relative overflow-x-auto overflow-y-hidden cursor-crosshair select-none bg-slate-950"
          >
            <div
              style={{ width: `${Math.max(100, zoomLevel * 100)}%` }}
              className="h-full relative flex flex-col"
            >
              {/* 1. Thước Đo Thời Gian (Time Ruler) */}
              <div ref={rulerRef} className="h-6 bg-slate-900/90 border-b border-slate-800 relative select-none">
                {rulerTicks.map((tick, idx) => (
                  <div
                    key={idx}
                    style={{ left: `${tick.pct}%` }}
                    className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
                  >
                    <span className="text-[9px] font-mono text-slate-400 pl-1 leading-none pt-1">
                      {tick.label}
                    </span>
                    <div className="w-px h-2 bg-slate-700 self-start" />
                  </div>
                ))}
              </div>

              {/* 2. Track 1: Khối Phụ Đề Dịch [T] */}
              <div className="h-14 border-b border-slate-800/70 relative bg-slate-950/80">
                {isSubVisible &&
                  cues.map((cue, idx) => {
                    const leftPct = (cue.start_pts / totalDuration) * 100;
                    const widthPct = Math.max(0.4, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
                    const isSelected = cue.cue_id === activeCueId;
                    const hasTranslated = Boolean((cue.translated_text || '').trim());
                    const text = cue.translated_text || cue.source_text;

                    return (
                      <div
                        key={cue.cue_id || idx}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isSubLocked) {
                            onSeek(cue.start_pts);
                            onSelectCue?.(cue);
                          }
                        }}
                        onMouseDown={(e) => handleMouseDownTrim(e, cue, 'move')}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          minWidth: '24px',
                        }}
                        className={`absolute top-1.5 bottom-1.5 rounded-lg flex items-center overflow-hidden cursor-pointer transition-all duration-75 text-[11px] select-none border group ${
                          isSelected
                            ? 'bg-amber-500 text-slate-950 font-bold border-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.95)] z-30 scale-[1.02]'
                            : hasTranslated
                            ? 'bg-indigo-950/85 border-indigo-600/70 hover:border-indigo-400 text-indigo-200 hover:text-white shadow-sm'
                            : 'bg-slate-900 border-amber-600/60 text-amber-300 hover:border-amber-400'
                        } ${isSubLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                        title={`[${cue.start_pts.toFixed(2)}s - ${cue.end_pts.toFixed(2)}s] ${text}`}
                      >
                        {/* Tay kéo mép trái (Trim Left) */}
                        {!isSubLocked && (
                          <div
                            onMouseDown={(e) => handleMouseDownTrim(e, cue, 'start')}
                            className="absolute left-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-amber-400 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-all z-20"
                            title="Kéo để chỉnh thời điểm bắt đầu (start_pts)"
                          />
                        )}

                        <span className="truncate px-2 whitespace-nowrap font-medium pointer-events-none">
                          {text}
                        </span>

                        {/* Tay kéo mép phải (Trim Right) */}
                        {!isSubLocked && (
                          <div
                            onMouseDown={(e) => handleMouseDownTrim(e, cue, 'end')}
                            className="absolute right-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-amber-400 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-all z-20"
                            title="Kéo để chỉnh thời điểm kết thúc (end_pts)"
                          />
                        )}
                      </div>
                    );
                  })}
              </div>

              {/* 3. Track 2: Dải Thumbnails Video [V] */}
              <div className="h-14 border-b border-slate-800/70 relative overflow-hidden bg-black/60 flex items-center">
                {isVideoVisible && thumbnails.length > 0 && (
                  <div className="absolute inset-0 flex">
                    {thumbnails.map((thumb, idx) => (
                      <div
                        key={idx}
                        className="h-full flex-1 border-r border-slate-800/40 relative overflow-hidden shrink-0"
                      >
                        <img
                          src={thumb.dataUrl}
                          alt={`thumb-${idx}`}
                          className="w-full h-full object-cover opacity-70 hover:opacity-100 transition-opacity pointer-events-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Track 3: Lồng Tiếng AI [A1] */}
              <div className="h-10 border-b border-slate-800/70 relative bg-slate-950/90 flex items-center">
                {cues.map((cue, idx) => {
                  const leftPct = (cue.start_pts / totalDuration) * 100;
                  const widthPct = Math.max(0.4, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
                  return (
                    <div
                      key={idx}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className="absolute top-1 bottom-1 rounded bg-amber-950/60 border border-amber-700/50 flex items-center px-1.5 overflow-hidden text-[9px] font-mono text-amber-300/80 select-none pointer-events-none"
                    >
                      <Mic className="w-2.5 h-2.5 mr-1 shrink-0 text-amber-400" />
                      <span className="truncate">{cue.translated_text || cue.source_text}</span>
                    </div>
                  );
                })}
              </div>

              {/* 5. Track 4: Sóng Âm Thanh Gốc [A2] */}
              <div className="flex-1 min-h-0 relative bg-slate-950 flex items-center overflow-hidden px-1">
                {audioPeaks.length > 0 ? (
                  <div className="w-full h-full flex items-center gap-[1px]">
                    {audioPeaks.map((peak, idx) => {
                      const hPct = Math.max(8, Math.min(100, peak * 100));
                      return (
                        <div
                          key={idx}
                          style={{ height: `${hPct}%` }}
                          className={`flex-1 rounded-sm ${
                            isAudioMuted ? 'bg-slate-700' : 'bg-gradient-to-t from-emerald-600 to-emerald-400 opacity-80'
                          }`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600 font-mono">
                    <span>Đang sẵn sàng phân tích sóng âm thanh...</span>
                  </div>
                )}
              </div>

              {/* 6. ĐẦU PHÁT PLAYHEAD VÀNG CHUẨN NLE CAPCUT / PREMIERE (PIXEL-PERFECT ALIGNED PLAYHEAD) */}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 pointer-events-none z-50 flex flex-col items-center -translate-x-1/2"
              >
                {/* Con trỏ kim tam giác màu vàng chỉ xuống trên đỉnh Thước đo (SVG Downward Pointer) */}
                <svg
                  width="14"
                  height="12"
                  viewBox="0 0 14 12"
                  className="shrink-0 -mt-0.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
                >
                  <polygon
                    points="0,0 14,0 7,12"
                    fill="#fbbf24"
                    stroke="#1e293b"
                    strokeWidth="1.2"
                  />
                </svg>
                {/* Thân kim màu vàng phát sáng chạy thẳng xuyên suốt toàn bộ các track */}
                <div className="w-[1.5px] flex-1 bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.95)]" />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Audio element phát thuyết minh lồng tiếng A1 đồng bộ NLE */}
      <audio
        ref={voiceAudioRef}
        key={`${projectId}-${hasVoiceover}`}
        src={projectId && hasVoiceover ? apiClient.getVoiceoverAudioUrl(projectId) : undefined}
        preload="auto"
        onLoadedMetadata={() => {
          if (voiceAudioRef.current) {
            try {
              voiceAudioRef.current.currentTime = currentTime;
            } catch {}
          }
        }}
      />
    </div>
  );
};

export const BottomTimeline = React.memo(BottomTimelineComponent);
