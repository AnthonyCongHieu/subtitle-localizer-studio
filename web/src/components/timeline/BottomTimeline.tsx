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
} from 'lucide-react';
import { apiClient } from '../../api/client';

interface BottomTimelineProps {
  videoUrl?: string;
  projectId?: string;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

export const BottomTimeline: React.FC<BottomTimelineProps> = ({
  videoUrl,
  projectId,
  duration,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<{ time: number; dataUrl: string }[]>([]);
  const [isGeneratingThumbs, setIsGeneratingThumbs] = useState<boolean>(false);

  const totalDuration = Math.max(1.0, duration);

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

  // Tính toán đường cong SVG sóng âm thanh
  const waveformSvgPath = useMemo(() => {
    if (audioPeaks.length === 0) {
      // Dữ liệu mô phỏng khi chưa có peaks thực tế
      const points: string[] = [];
      const count = 120;
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1)) * 100;
        const h = Math.abs(Math.sin(i * 0.28) * Math.cos(i * 0.15)) * 14 + 2;
        points.push(`M ${x} ${16 - h} L ${x} ${16 + h}`);
      }
      return points.join(' ');
    }

    const points: string[] = [];
    const len = audioPeaks.length;
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * 100;
      const val = Math.max(0.05, Math.min(1.0, audioPeaks[i]));
      const h = val * 15;
      points.push(`M ${x} ${16 - h} L ${x} ${16 + h}`);
    }
    return points.join(' ');
  }, [audioPeaks]);

  // Xử lý kéo thả kim tua (Scrubbing)
  const handleSeekFromEvent = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
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
      {/* 1. Thanh Transport Bar Chuẩn NLE (Play/Pause, Tua, Timecode, Zoom) */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/70">
        <div className="flex items-center gap-2">
          {/* Nút Play/Pause chính */}
          <button
            onClick={onTogglePlay}
            className="p-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition shadow"
            title={isPlaying ? 'Tạm dừng (Space)' : 'Phát video (Space)'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-white" /> : <Play className="w-3.5 h-3.5 fill-white ml-0.5" />}
          </button>

          {/* Tua lùi 1s */}
          <button
            onClick={() => onSeek(Math.max(0, currentTime - 1))}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Lùi lại 1 giây (←)"
          >
            <Rewind className="w-3.5 h-3.5" />
          </button>

          {/* Tua tới 1s */}
          <button
            onClick={() => onSeek(Math.min(totalDuration, currentTime + 1))}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Tua tới 1 giây (→)"
          >
            <FastForward className="w-3.5 h-3.5" />
          </button>

          {/* Timecode hiện tại / Tổng thời lượng */}
          <div className="flex items-center gap-1.5 font-mono text-xs ml-2 bg-slate-900 px-2.5 py-0.5 rounded border border-slate-800">
            <span className="text-indigo-400 font-bold">{formatTime(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Cụm Zoom Timeline */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">Zoom:</span>
          <button
            onClick={() => setZoomLevel((z) => Math.max(1.0, z - 0.25))}
            disabled={zoomLevel <= 1.0}
            className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 transition"
            title="Thu nhỏ timeline"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] font-mono text-slate-400 w-8 text-center">{Math.round(zoomLevel * 100)}%</span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(3.0, z + 0.25))}
            disabled={zoomLevel >= 3.0}
            className="p-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 transition"
            title="Phóng to timeline"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 2. Bố Cục Timeline Chuẩn NLE: Cột Track Header Bên Trái + Vùng Scroll Bên Phải */}
      <div className="flex px-4 py-2 gap-2">
        {/* Cột Track Header bên trái */}
        <div className="w-16 shrink-0 flex flex-col rounded-lg overflow-hidden border border-slate-800/80 bg-slate-950/80 text-[10px] font-medium">
          {/* Header Video Track */}
          <div className="h-14 border-b border-slate-800/80 flex flex-col items-center justify-center gap-0.5 text-slate-400">
            <Film className="w-3.5 h-3.5 text-indigo-400" />
            <span>Video</span>
          </div>

          {/* Header Audio Track */}
          <div className="h-10 flex flex-col items-center justify-center gap-0.5 text-emerald-400">
            <Activity className="w-3.5 h-3.5" />
            <span>Audio</span>
          </div>
        </div>

        {/* Vùng Cuộn Track Video & Audio */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden cursor-pointer scrollbar-thin scrollbar-thumb-slate-700"
        >
          <div
            ref={trackRef}
            onMouseDown={handleMouseDown}
            className="relative rounded-lg overflow-hidden border border-slate-800/80 bg-slate-950 transition-[width]"
            style={{ width: `${zoomLevel * 100}%`, minWidth: '100%' }}
          >
            {/* Tầng 1: Dải Hình Ảnh (Filmstrip Thumbnails) */}
            <div className="h-14 bg-slate-950 border-b border-slate-800/80 flex items-center relative overflow-hidden">
              {thumbnails.length > 0 ? (
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
              )}
            </div>

            {/* Tầng 2: Dải Sóng Âm Thanh (Audio Waveform) */}
            <div className="h-10 bg-slate-900/90 relative flex items-center px-1">
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
            </div>

            {/* Tầng 3: Kim Tua Thời Gian (Playhead / Scrubber) */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none z-30 transition-transform duration-75"
              style={{
                left: `${playheadPercent}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {/* Đầu kim thời gian */}
              <div className="w-3 h-3 -ml-0.5 bg-amber-400 border border-slate-950 shadow rotate-45 transform origin-center -translate-y-1" />
              {/* Vạch kim chỉ màu vàng */}
              <div className="w-0.5 h-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
