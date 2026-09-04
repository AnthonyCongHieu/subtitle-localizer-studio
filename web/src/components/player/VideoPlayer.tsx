import React, { useRef, useState, useEffect, useMemo } from 'react';
import { RoiOverlay } from '../roi/RoiOverlay';
import { ViewerToolbar, ZoomMode } from './ViewerToolbar';
import { RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import {
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface VideoPlayerProps {
  videoUrl?: string;
  videoTitle?: string;
  region: RegionTrackV1;
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onTogglePlay: () => void;
  onUpdateRegion: (region: RegionTrackV1) => void;
  onAutoDetectRoi?: () => void;
  onPickLocalVideo?: (file: File) => void;

  cues?: SubtitleCueV1[];
  isFlippedH: boolean;
  onToggleFlipH: () => void;
  isFlippedV: boolean;
  onToggleFlipV: () => void;
  rotation: number;
  onRotate: () => void;
  zoomLevel: ZoomMode;
  onZoomChange: (zoom: ZoomMode) => void;
  onResetTransform: () => void;
  previewMask: boolean;
  onTogglePreviewMask: () => void;
  showSubtitleOverlay: boolean;
  onToggleSubtitleOverlay: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoUrl,
  videoTitle,
  region,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onDurationChange,
  onTogglePlay,
  onUpdateRegion,
  onPickLocalVideo,

  cues = [],
  isFlippedH,
  onToggleFlipH,
  isFlippedV,
  onToggleFlipV,
  rotation,
  onRotate,
  zoomLevel,
  onZoomChange,
  onResetTransform,
  previewMask,
  onTogglePreviewMask,
  showSubtitleOverlay,
  onToggleSubtitleOverlay,
}) => {
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const [boxDimensions, setBoxDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showRoi, setShowRoi] = useState<boolean>(true);

  // Tìm câu phụ đề đang khớp với currentTime hiện tại để hiển thị trực tiếp lên video
  const activeCue = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    return cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts) || null;
  }, [cues, currentTime]);

  // Đo kích thước thực tế của videoBox để ROI overlay khớp chính xác từng pixel
  useEffect(() => {
    if (!videoBoxRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          setBoxDimensions({
            width: Math.round(entry.contentRect.width),
            height: Math.round(entry.contentRect.height),
          });
        }
      }
    });
    observer.observe(videoBoxRef.current);
    return () => observer.disconnect();
  }, [videoUrl]);

  // Đồng bộ Play/Pause
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying && videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else if (!isPlaying && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  // Đồng bộ Seek
  useEffect(() => {
    if (!videoRef.current) return;
    if (Math.abs(videoRef.current.currentTime - currentTime) > 0.25) {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  // Đồng bộ Âm lượng
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  // Phím tắt Space Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTogglePlay]);

  // Style biến đổi video (Lật ngang, Lật dọc, Xoay, Zoom)
  const scaleZoom = zoomLevel === 'fit' ? 1.0 : zoomLevel;
  const videoTransformStyle: React.CSSProperties = {
    transform: `scaleX(${isFlippedH ? -1 : 1}) scaleY(${isFlippedV ? -1 : 1}) rotate(${rotation}deg) scale(${scaleZoom})`,
    transformOrigin: 'center center',
    transition: 'transform 120ms ease-out',
  };

  const vWidth = videoDimensions.width || 16;
  const vHeight = videoDimensions.height || 9;

  return (
    <div className="w-full h-full flex-1 min-h-0 min-w-0 bg-slate-950 flex flex-col select-none overflow-hidden relative">
      {/* 1. Thanh Viewer Header Bar gắn cố định phía trên Viewport */}
      {videoUrl && (
        <ViewerToolbar
          videoTitle={videoTitle}
          videoDimensions={videoDimensions}
          isFlippedH={isFlippedH}
          onToggleFlipH={onToggleFlipH}
          isFlippedV={isFlippedV}
          onToggleFlipV={onToggleFlipV}
          rotation={rotation}
          onRotate={onRotate}
          zoomLevel={zoomLevel}
          onZoomChange={onZoomChange}
          onResetTransform={onResetTransform}
          showRoi={showRoi}
          onToggleRoi={() => setShowRoi(!showRoi)}
          previewMask={previewMask}
          onTogglePreviewMask={onTogglePreviewMask}
          showSubtitleOverlay={showSubtitleOverlay}
          onToggleSubtitleOverlay={onToggleSubtitleOverlay}
        />
      )}

      {/* 2. Khung Viewport Video Tự Động Co Giãn Aspect-Fit */}
      {videoUrl ? (
        <div className="flex-1 min-h-0 min-w-0 w-full flex items-center justify-center relative overflow-hidden p-3">
          {/* Hộp video có tỷ lệ aspect-ratio cố định */}
          <div
            ref={videoBoxRef}
            className="relative rounded-xl overflow-hidden bg-black border border-slate-800/80 shadow-2xl flex items-center justify-center"
            style={{
              aspectRatio: `${vWidth} / ${vHeight}`,
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
            }}
          >
            {/* Thẻ Video HTML5 với hiệu ứng Lật và Zoom */}
            <video
              ref={videoRef}
              src={videoUrl}
              crossOrigin="anonymous"
              playsInline
              style={videoTransformStyle}
              className="w-full h-full block cursor-pointer object-contain"
              onClick={onTogglePlay}
              onLoadedMetadata={(e) => {
                const target = e.currentTarget;
                setVideoDimensions({ width: target.videoWidth, height: target.videoHeight });
                onDurationChange(target.duration);
              }}
              onTimeUpdate={(e) => {
                onTimeUpdate(e.currentTarget.currentTime);
              }}
              onEnded={() => onTogglePlay()}
            />

            {/* Lớp Phủ Làm Mờ Che Sub Gốc (Preview Mask) */}
            {previewMask && boxDimensions.width > 0 && (
              <div
                className="absolute pointer-events-none backdrop-blur-md bg-black/75 rounded border border-amber-500/40 shadow-lg flex items-center justify-center text-[10px] text-amber-200/90 font-medium z-10 animate-in fade-in duration-100"
                style={{
                  left: `${Math.round(region.x * boxDimensions.width)}px`,
                  top: `${Math.round(region.y * boxDimensions.height)}px`,
                  width: `${Math.round(region.width * boxDimensions.width)}px`,
                  height: `${Math.round(region.height * boxDimensions.height)}px`,
                }}
              >
                <span>[Đã che sub gốc]</span>
              </div>
            )}

            {/* Lớp Phủ Hiển Thị Phụ Đề Dịch Tiếng Việt */}
            {showSubtitleOverlay && activeCue && boxDimensions.width > 0 && (
              <div
                className="absolute pointer-events-none flex justify-center px-4 z-20 transition-all duration-75"
                style={{
                  left: `${Math.round(region.x * boxDimensions.width)}px`,
                  top: `${Math.round(region.y * boxDimensions.height)}px`,
                  width: `${Math.round(region.width * boxDimensions.width)}px`,
                  height: `${Math.round(region.height * boxDimensions.height)}px`,
                  alignItems: 'center',
                }}
              >
                <div className="bg-black/85 backdrop-blur-sm text-yellow-300 font-bold px-3 py-1 rounded text-xs sm:text-sm tracking-wide text-center shadow-lg border border-yellow-500/30 leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                  {activeCue.translated_text || activeCue.source_text}
                </div>
              </div>
            )}

            {/* Lớp phủ ROI Overlay: Khung kéo thả tương tác trên video */}
            {showRoi && boxDimensions.width > 0 && boxDimensions.height > 0 && (
              <RoiOverlay
                region={region}
                onChange={onUpdateRegion}
                containerWidth={boxDimensions.width}
                containerHeight={boxDimensions.height}
              />
            )}

            {/* Thanh điều khiển âm lượng góc dưới bên phải */}
            <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 bg-slate-900/80 backdrop-blur border border-slate-800 px-2.5 py-1 rounded-lg shadow pointer-events-auto">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-slate-300 hover:text-white transition"
                title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-slate-300" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  setIsMuted(false);
                }}
                className="w-14 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>
      ) : (
        /* Màn hình chờ khi chưa có video */
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-3 shadow-lg">
            <Upload className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-semibold text-white mb-1">
            Chưa có Video Input để xử lý
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Chọn video từ dự án máy chủ hoặc tải trực tiếp file video (.mp4, .mkv) từ máy tính của bạn.
          </p>
          {onPickLocalVideo && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onPickLocalVideo(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md active:scale-95 transition"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Chọn Video từ máy tính</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
