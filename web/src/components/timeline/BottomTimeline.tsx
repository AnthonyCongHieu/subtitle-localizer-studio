import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  FastForward,
  Rewind,
  ZoomIn,
  ZoomOut,
  Film,
  Activity,
  Subtitles,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Clock,
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
  onSelectCue?: (cue: SubtitleCueV1) => void;
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
  onSelectCue,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<{ time: number; dataUrl: string }[]>([]);
  const [isGeneratingThumbs, setIsGeneratingThumbs] = useState<boolean>(false);

  // Trạng thái khóa và ẩn track NLE
  const [isSubLocked, setIsSubLocked] = useState<boolean>(false);
  const [isSubVisible, setIsSubVisible] = useState<boolean>(true);
  const [isVideoLocked, setIsVideoLocked] = useState<boolean>(false);
  const [isVideoVisible, setIsVideoVisible] = useState<boolean>(true);
  const [isAudioLocked, setIsAudioLocked] = useState<boolean>(false);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);

  const totalDuration = Math.max(1.0, duration);

  // Xác định câu phụ đề đang phát
  const activeCueId = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    const found = cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts);
    return found?.cue_id || null;
  }, [cues, currentTime]);

  // Bộ nhớ đệm danh sách các khối phụ đề (Blocks NLE)
  const renderedCues = useMemo(() => {
    if (!cues || cues.length === 0 || !isSubVisible) return null;
    return cues.map((cue, idx) => {
      const leftPct = (cue.start_pts / totalDuration) * 100;
      const widthPct = Math.max(0.4, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
      const isActive = cue.cue_id ? cue.cue_id === activeCueId : false;
      const text = cue.translated_text || cue.source_text;
      return (
        <div
          key={cue.cue_id || idx}
          onClick={(e) => {
            e.stopPropagation();
            if (!isSubLocked) {
              onSeek(cue.start_pts);
              if (onSelectCue) onSelectCue(cue);
            }
          }}
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: '20px',
          }}
          className={`absolute top-1 bottom-1 rounded-md px-2 flex items-center overflow-hidden cursor-pointer transition-all duration-75 text-[10px] select-none border ${
            isActive
              ? 'bg-amber-500 text-slate-950 font-bold border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.9)] z-20 scale-[1.02]'
              : 'bg-indigo-950/80 border-indigo-700/70 hover:border-amber-400 text-amber-200 hover:text-white shadow-sm'
          } ${isSubLocked ? 'cursor-not-allowed opacity-60' : ''}`}
          title={`[${cue.start_pts.toFixed(2)}s - ${cue.end_pts.toFixed(2)}s] ${text}`}
        >
          <span className="truncate whitespace-nowrap font-medium">{text}</span>
        </div>
      );
    });
  }, [cues, totalDuration, activeCueId, onSeek, onSelectCue, isSubVisible, isSubLocked]);

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
      .catch((err) => {
        console.warn('Chưa nạp được audio waveform từ máy chủ:', err);
      });

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
            offscreenVideo.currentTime = targetTime;
            offscreenVideo.onseeked = () => {
              if (ctx) {
                ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
                result.push({
                  time: targetTime,
                  dataUrl: canvas.toDataURL('image/jpeg', 0.6),
                });
              }
              resolve();
            };
          });
        }

        if (!isCancelled) {
          setThumbnails(result);
        }
      } catch (err) {
        console.warn('Không thể tự tạo thumbnails client-side:', err);
      } finally {
        if (!isCancelled) setIsGeneratingThumbs(false);
      }
    };

    generateThumbnails();

    return () => {
      isCancelled = true;
    };
  }, [videoUrl, duration]);

  // Định dạng thời gian dạng 00:00.00
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Định dạng nhãn cho thước đo thời gian dạng 00:00
  const formatRulerTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Tính toán các mốc của Thước Đo Thời Gian (Time Ruler Ticks)
  const rulerTicks = useMemo(() => {
    // Bước nhảy thời gian dựa trên tổng thời lượng và zoom
    let step = 5;
    if (totalDuration > 300) step = 30;
    else if (totalDuration > 120) step = 15;
    else if (totalDuration > 60) step = 10;
    else if (totalDuration <= 15) step = 1;
    else step = 5;

    if (zoomLevel >= 2.0) {
      step = Math.max(1, Math.floor(step / 2));
    }

    const ticks: { time: number; label: string; pct: number }[] = [];
    for (let t = 0; t <= totalDuration; t += step) {
      ticks.push({
        time: t,
        label: formatRulerTime(t),
        pct: (t / totalDuration) * 100,
      });
    }
    return ticks;
  }, [totalDuration, zoomLevel]);

  // Tính toán đường cong SVG sóng âm thanh từ dữ liệu biên độ thật
  const waveformSvgPath = useMemo(() => {
    if (!audioPeaks || audioPeaks.length === 0) {
      return '';
    }

    const points: string[] = [];
    const len = audioPeaks.length;
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * 100;
      const val = Math.max(0.02, Math.min(1.0, audioPeaks[i]));
      const h = val * 15;
      points.push(`M ${x} ${16 - h} L ${x} ${16 + h}`);
    }
    return points.join(' ');
  }, [audioPeaks]);

  // Xử lý kéo thả kim tua (Scrubbing)
  const handleSeekFromEvent = useCallback(
    (clientX: number) => {
      const activeEl = trackRef.current || rulerRef.current;
      if (!activeEl) return;
      const rect = activeEl.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percentage = clickX / rect.width;
      const newTime = percentage * totalDuration;
      onSeek(newTime);
    },
    [totalDuration, onSeek]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsScrubbing(true);
    handleSeekFromEvent(e.clientX);
  };

  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleSeekFromEvent(e.clientX);
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
  }, [isScrubbing, handleSeekFromEvent]);

  const playheadPercent = Math.min(100, Math.max(0, (currentTime / totalDuration) * 100));

  return (
    <div className="bg-slate-900 border-t border-slate-800 flex flex-col select-none shadow-2xl z-40 shrink-0">
      {/* 1. Thanh Transport Bar Chuẩn NLE (Play/Pause, Tua, Timecode, Slider Zoom Trực Quan) */}
      <div className="px-4 py-2 flex flex-wrap items-center justify-between border-b border-slate-800/90 bg-slate-950/80 gap-3">
        {/* Nút Play/Tua + Timecode */}
        <div className="flex items-center gap-2.5">
          {/* Nút Play/Pause chính */}
          <button
            onClick={onTogglePlay}
            className="p-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition shadow-md"
            title={isPlaying ? 'Tạm dừng (Space)' : 'Phát video (Space)'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
          </button>

          {/* Tua lùi 1s */}
          <button
            onClick={() => onSeek(Math.max(0, currentTime - 1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Lùi lại 1 giây (←)"
          >
            <Rewind className="w-3.5 h-3.5" />
          </button>

          {/* Tua tới 1s */}
          <button
            onClick={() => onSeek(Math.min(totalDuration, currentTime + 1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Tua tới 1 giây (→)"
          >
            <FastForward className="w-3.5 h-3.5" />
          </button>

          {/* Timecode hiện tại / Tổng thời lượng */}
          <div className="flex items-center gap-1.5 font-mono text-xs ml-2 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 shadow-inner">
            <span className="text-indigo-400 font-bold tracking-wide">{formatTime(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Cụm Zoom Timeline Trực Quan (Slider Kéo + Nút Fit/150%/200%/300%) */}
        <div className="flex items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
            <ZoomOut
              className="w-3.5 h-3.5 text-slate-500 cursor-pointer hover:text-slate-300"
              onClick={() => setZoomLevel((z) => Math.max(1.0, parseFloat((z - 0.25).toFixed(2))))}
            />
            {/* Slider Zoom Trực Quan */}
            <input
              type="range"
              min="1.0"
              max="3.0"
              step="0.1"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              className="w-20 md:w-28 h-1 bg-slate-700 rounded appearance-none cursor-pointer accent-indigo-500"
              title="Kéo trượt để phóng to / thu nhỏ dải Timeline"
            />
            <ZoomIn
              className="w-3.5 h-3.5 text-slate-500 cursor-pointer hover:text-slate-300"
              onClick={() => setZoomLevel((z) => Math.min(3.0, parseFloat((z + 0.25).toFixed(2))))}
            />
            <span className="text-[11px] font-mono text-slate-300 w-10 text-right">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>

          {/* Các nút bấm nhanh mức Zoom */}
          <div className="hidden sm:flex items-center gap-1">
            {[
              { label: 'Fit', val: 1.0 },
              { label: '150%', val: 1.5 },
              { label: '200%', val: 2.0 },
              { label: '300%', val: 3.0 },
            ].map((btn) => (
              <button
                key={btn.label}
                onClick={() => setZoomLevel(btn.val)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                  Math.abs(zoomLevel - btn.val) < 0.05
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Bố Cục Timeline Chuẩn NLE: Cột Track Header Bên Trái + Vùng Cuộn Track & Thước Đo Thời Gian */}
      <div className="flex px-4 py-2.5 gap-2">
        {/* Cột Track Header bên trái: Có icon Khóa / Ẩn / Mute cho từng dải */}
        <div className="w-24 shrink-0 flex flex-col rounded-xl overflow-hidden border border-slate-800/90 bg-slate-950 text-[10px] font-medium shadow-md">
          {/* Ô Header Trống (Tương ứng với hàng Thước Đo Thời Gian) */}
          <div className="h-6 border-b border-slate-800/90 px-2 flex items-center justify-between text-slate-500 bg-slate-900/50">
            <span className="text-[9px] font-mono uppercase tracking-wider">Tracks</span>
            <Clock className="w-3 h-3 text-slate-600" />
          </div>

          {/* Header Phụ Đề Track */}
          <div className="h-10 border-b border-slate-800/90 px-2 flex items-center justify-between text-amber-400 bg-amber-950/20">
            <div className="flex items-center gap-1 truncate">
              <Subtitles className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Phụ đề</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsSubLocked(!isSubLocked)}
                className={`p-0.5 rounded hover:bg-slate-800 ${isSubLocked ? 'text-amber-400' : 'text-slate-600'}`}
                title={isSubLocked ? 'Mở khóa track phụ đề' : 'Khóa track phụ đề'}
              >
                {isSubLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => setIsSubVisible(!isSubVisible)}
                className={`p-0.5 rounded hover:bg-slate-800 ${isSubVisible ? 'text-amber-400' : 'text-slate-600'}`}
                title={isSubVisible ? 'Ẩn track phụ đề' : 'Hiện track phụ đề'}
              >
                {isSubVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* Header Video Track */}
          <div className="h-14 border-b border-slate-800/90 px-2 flex items-center justify-between text-slate-300 bg-slate-900/40">
            <div className="flex items-center gap-1 truncate">
              <Film className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="truncate">Video</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsVideoLocked(!isVideoLocked)}
                className={`p-0.5 rounded hover:bg-slate-800 ${isVideoLocked ? 'text-indigo-400' : 'text-slate-600'}`}
                title={isVideoLocked ? 'Mở khóa track video' : 'Khóa track video'}
              >
                {isVideoLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => setIsVideoVisible(!isVideoVisible)}
                className={`p-0.5 rounded hover:bg-slate-800 ${isVideoVisible ? 'text-indigo-400' : 'text-slate-600'}`}
                title={isVideoVisible ? 'Ẩn track video' : 'Hiện track video'}
              >
                {isVideoVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* Header Audio Track */}
          <div className="h-10 px-2 flex items-center justify-between text-emerald-400 bg-emerald-950/20">
            <div className="flex items-center gap-1 truncate">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Audio</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsAudioLocked(!isAudioLocked)}
                className={`p-0.5 rounded hover:bg-slate-800 ${isAudioLocked ? 'text-emerald-400' : 'text-slate-600'}`}
                title={isAudioLocked ? 'Mở khóa track audio' : 'Khóa track audio'}
              >
                {isAudioLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              </button>
              <button
                type="button"
                onClick={() => setIsAudioMuted(!isAudioMuted)}
                className={`p-0.5 rounded hover:bg-slate-800 ${isAudioMuted ? 'text-rose-400' : 'text-slate-600'}`}
                title={isAudioMuted ? 'Bật tiếng track audio' : 'Tắt tiếng track audio'}
              >
                {isAudioMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>

        {/* Vùng Cuộn Track & Thước Đo Thời Gian (Scroll Area) */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden cursor-pointer scrollbar-thin scrollbar-thumb-slate-700"
        >
          <div
            ref={trackRef}
            onMouseDown={handleMouseDown}
            className="relative rounded-xl overflow-hidden border border-slate-800/90 bg-slate-950 transition-[width] shadow-inner"
            style={{ width: `${zoomLevel * 100}%`, minWidth: '100%' }}
          >
            {/* THƯỚC ĐO THỜI GIAN (TIME RULER - VẠCH CHIA GIÂY CHUẨN NLE) */}
            <div
              ref={rulerRef}
              className="h-6 bg-slate-900/90 border-b border-slate-800/90 relative overflow-hidden text-[9px] font-mono text-slate-400 select-none cursor-ew-resize"
            >
              {rulerTicks.map((tick, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 flex flex-col items-center"
                  style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}
                >
                  <span className="text-[9px] leading-tight text-slate-400 select-none pt-0.5">
                    {tick.label}
                  </span>
                  <div className="w-px h-2 bg-slate-700 mt-auto" />
                </div>
              ))}
            </div>

            {/* Tầng 1: Dải Track Phụ Đề (Subtitle Track) */}
            <div className="h-10 bg-slate-950 border-b border-slate-800/90 relative flex items-center overflow-hidden px-0.5">
              {renderedCues ? (
                renderedCues
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600 gap-1.5">
                  <Subtitles className="w-3 h-3 opacity-40" />
                  <span>{isSubVisible ? 'Chưa có câu phụ đề nào' : 'Track phụ đề đang ẩn'}</span>
                </div>
              )}
            </div>

            {/* Tầng 2: Dải Hình Ảnh (Filmstrip Thumbnails) */}
            <div className="h-14 bg-slate-950 border-b border-slate-800/90 flex items-center relative overflow-hidden">
              {isVideoVisible ? (
                thumbnails.length > 0 ? (
                  <div className="w-full h-full flex">
                    {thumbnails.map((thumb, idx) => (
                      <div
                        key={idx}
                        className="flex-1 h-full border-r border-slate-800/40 relative group overflow-hidden bg-slate-900"
                      >
                        <img
                          src={thumb.dataUrl}
                          alt={`Frame at ${thumb.time}s`}
                          className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                        />
                        <span className="absolute bottom-0.5 right-1 text-[8px] font-mono text-slate-300 bg-black/60 px-1 rounded pointer-events-none">
                          {Math.floor(thumb.time)}s
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-slate-600 gap-2">
                    <Film className="w-4 h-4 opacity-40" />
                    <span>
                      {isGeneratingThumbs ? 'Đang trích xuất khung hình...' : 'Dải hình ảnh sẵn sàng'}
                    </span>
                  </div>
                )
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-600 gap-1.5">
                  <EyeOff className="w-3.5 h-3.5 opacity-40" />
                  <span>Track video đang ẩn</span>
                </div>
              )}
            </div>

            {/* Tầng 3: Dải Sóng Âm Thanh (Audio Waveform) */}
            <div className={`h-10 bg-slate-900/90 relative flex items-center px-2 ${isAudioMuted ? 'opacity-30' : ''}`}>
              {waveformSvgPath ? (
                <svg
                  className="w-full h-8"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 32"
                >
                  <path
                    d={waveformSvgPath}
                    className="fill-emerald-500/40 stroke-emerald-400/80"
                    strokeWidth="0.6"
                  />
                </svg>
              ) : (
                <div className="w-full flex items-center justify-center text-[10px] text-slate-600 gap-2 font-mono select-none">
                  <div className="flex-1 h-px bg-slate-800" />
                  <span className="shrink-0 text-slate-500">Đang đọc sóng âm thanh thực tế...</span>
                  <div className="flex-1 h-px bg-slate-800" />
                </div>
              )}
            </div>

            {/* KIM TUA THỜI GIAN (PLAYHEAD / SCRUBBER) CHUẨN NLE XUYÊN SUỐT TOÀN BỘ CÁC TRACK */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-30 transition-transform duration-75"
              style={{
                left: `${playheadPercent}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {/* Đầu kim thời gian (Tam giác chỉ giờ) */}
              <div className="w-3.5 h-3.5 -ml-[1px] bg-amber-400 border border-slate-950 shadow-md rotate-45 transform origin-center -translate-y-1.5 cursor-ew-resize" />
              {/* Vạch kim chỉ màu vàng amber phát sáng xuyên suốt từ đỉnh Time Ruler xuống đáy */}
              <div className="w-0.5 h-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const BottomTimeline = React.memo(BottomTimelineComponent);
