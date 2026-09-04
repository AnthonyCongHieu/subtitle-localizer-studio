import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { RoiOverlay } from '../roi/RoiOverlay';
import { ViewerToolbar } from './ViewerToolbar';
import { RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import {
  AspectRatioType,
  MaskStyleType,
  SubtitlePlacementMode,
  ZoomMode,
} from '../../types/presets';
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
  aspectRatio: AspectRatioType;
  onAspectRatioChange: (ratio: AspectRatioType) => void;
  fitMode?: 'contain' | 'cover';
  onToggleFitMode?: () => void;
  isFlippedH: boolean;
  onToggleFlipH: () => void;
  isFlippedV: boolean;
  onToggleFlipV: () => void;
  rotation: number;
  onRotate: () => void;
  onRotationChange?: (rotation: number) => void;
  zoomLevel: ZoomMode;
  onZoomChange: (zoom: ZoomMode) => void;
  onResetTransform: () => void;
  previewMask: boolean;
  onTogglePreviewMask: () => void;
  maskStyle?: MaskStyleType;
  onMaskStyleChange?: (style: MaskStyleType) => void;
  blurStrength?: number;
  onBlurStrengthChange?: (strength: number) => void;
  showSubtitleOverlay: boolean;
  onToggleSubtitleOverlay: () => void;
  subtitlePlacement?: SubtitlePlacementMode;
  onSubtitlePlacementChange?: (mode: SubtitlePlacementMode) => void;
}

export type { MaskStyleType, SubtitlePlacementMode };

const getMaskStyleClass = (style: MaskStyleType | string = 'feather_tight') => {
  switch (style) {
    case 'feather_tight':
      // 1. Mờ siêu mỏng bám sát dòng chữ (Khuyên dùng - Chuẩn ảnh mẫu tham khảo):
      // Bo góc chuẩn theo ô quét, viền mờ 4% cực êm, che phủ 100% dòng chữ gốc
      return 'backdrop-blur-[24px] bg-black/20 rounded [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)]';

    case 'optical_blend':
      // 2. Hòa tan quang học thuần khiết (100% trong suốt - Không viền tối):
      // Giữ nguyên 100% màu da, ánh sáng cảnh quay, Gaussian blur làm nét chữ tan biến hoàn toàn
      return 'backdrop-blur-[28px] bg-black/10 rounded [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_5%,black_95%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_5%,black_95%,transparent_100%)]';

    case 'soft_cinema':
      // 3. Gradient điện ảnh mềm (Soft Cinema Ambient Fade):
      // Chuyển sắc từ dưới lên êm ái, tiệp màu cảnh quay, không tạo bóng đen đục
      return 'backdrop-blur-[20px] bg-gradient-to-t from-black/35 via-black/15 to-transparent rounded [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)]';

    case 'blur':
      // 4. Mờ hòa tan tự nhiên:
      return 'backdrop-blur-[24px] bg-black/15 rounded [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_4%,black_96%,transparent_100%)]';

    case 'glass':
      // 5. Kính mờ trong suốt (Clear Frosted Glass):
      return 'backdrop-blur-[24px] bg-white/5 border border-white/10 rounded shadow-sm';

    case 'ambient':
    case 'gradient':
      // 6. Gradient đáy êm dịu:
      return 'backdrop-blur-[18px] bg-gradient-to-t from-black/40 via-black/20 to-transparent rounded';

    case 'feather':
      // 7. Viền lông mềm nhung:
      return 'backdrop-blur-[20px] bg-black/15 rounded shadow-sm [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_5%,black_95%,transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,black_5%,black_95%,transparent_100%)]';

    case 'mosaic':
      // 8. Khảm Mosaic nhẹ:
      return 'backdrop-blur-md bg-black/25 rounded [background-image:radial-gradient(#ffffff20_1px,transparent_1px)] [background-size:6px_6px]';

    case 'box':
    default:
      // 9. Hộp đen Cinema truyền thống:
      return 'bg-black/90 rounded shadow-xl';
  }
};

const getCanvasAspectRatio = (
  ratio: AspectRatioType,
  naturalWidth: number,
  naturalHeight: number
): { ratioStr: string; label: string; ratioNum: number } => {
  switch (ratio) {
    case '16:9':
      return { ratioStr: '16 / 9', label: '16:9', ratioNum: 16 / 9 };
    case '9:16':
      return { ratioStr: '9 / 16', label: '9:16', ratioNum: 9 / 16 };
    case '1:1':
      return { ratioStr: '1 / 1', label: '1:1', ratioNum: 1 };
    case '4:3':
      return { ratioStr: '4 / 3', label: '4:3', ratioNum: 4 / 3 };
    case '2.35:1':
      return { ratioStr: '2.35 / 1', label: '2.35:1', ratioNum: 2.35 };
    case 'original':
    default: {
      const w = naturalWidth > 0 ? naturalWidth : 16;
      const h = naturalHeight > 0 ? naturalHeight : 9;
      return { ratioStr: `${w} / ${h}`, label: `${w}×${h}`, ratioNum: w / h };
    }
  }
};

const VideoPlayerComponent: React.FC<VideoPlayerProps> = ({
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
  aspectRatio = 'original',
  onAspectRatioChange,
  fitMode = 'contain',
  onToggleFitMode,
  isFlippedH,
  onToggleFlipH,
  isFlippedV,
  onToggleFlipV,
  rotation,
  onRotate,
  onRotationChange,
  zoomLevel,
  onZoomChange,
  onResetTransform,
  previewMask,
  onTogglePreviewMask,
  maskStyle = 'feather_tight',
  onMaskStyleChange,
  blurStrength = 20,
  onBlurStrengthChange,
  showSubtitleOverlay,
  onToggleSubtitleOverlay,
  subtitlePlacement = 'roi',
  onSubtitlePlacementChange,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
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

  const [canvasFitSize, setCanvasFitSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showRoi, setShowRoi] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const handleToggleFullscreen = useCallback(() => {
    if (!videoBoxRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoBoxRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  const clickTimerRef = useRef<number | null>(null);

  const handleVideoClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      handleToggleFullscreen();
    } else {
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        onTogglePlay();
      }, 240);
    }
  }, [handleToggleFullscreen, onTogglePlay]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === videoBoxRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Tìm câu phụ đề đang khớp với currentTime hiện tại để hiển thị trực tiếp lên video
  const activeCue = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    return (
      cues.find(
        (c) => (currentTime + 0.06) >= c.start_pts && (currentTime - 0.04) <= c.end_pts
      ) || null
    );
  }, [cues, currentTime]);

  const canvasRatio = useMemo(() => {
    return getCanvasAspectRatio(aspectRatio, videoDimensions.width, videoDimensions.height);
  }, [aspectRatio, videoDimensions.width, videoDimensions.height]);

  // Đo kích thước thực tế của khung Viewport để tính toán pixel chính xác cho Canvas
  // Giải quyết triệt để lỗi co rút về 300px do Flexbox intrinsic sizing cycle
  useEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          // Trừ đi padding đệm an toàn (24px)
          const availW = Math.max(160, rect.width - 24);
          const availH = Math.max(90, rect.height - 24);
          const targetRatio = canvasRatio.ratioNum;

          let w: number;
          let h: number;
          if (availW / availH > targetRatio) {
            h = availH;
            w = Math.round(availH * targetRatio);
          } else {
            w = availW;
            h = Math.round(availW / targetRatio);
          }

          setCanvasFitSize({ width: w, height: h });
        }
      }
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [canvasRatio.ratioNum]);

  // Quan sát trực tiếp videoBoxRef để cập nhật boxDimensions chính xác từng pixel,
  // bao gồm cả chế độ Cửa Sổ thường lẫn Toàn Màn Hình (Fullscreen 100vw/100vh)
  useEffect(() => {
    const box = videoBoxRef.current;
    if (!box) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (rect.width > 0 && rect.height > 0) {
          setBoxDimensions({
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [isFullscreen]);

  // Đồng bộ Play/Pause
  useEffect(() => {
    if (!videoRef.current) return;
    if (isPlaying && videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else if (!isPlaying && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  // Đồng bộ thời gian chính xác từng frame khi video đang phát
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying) return;

    let animId: number;
    let lastReportedTime = -1;

    const frameLoop = () => {
      if (video && !video.paused && !video.seeking) {
        const cur = video.currentTime;
        if (Math.abs(cur - lastReportedTime) >= 0.075) {
          lastReportedTime = cur;
          onTimeUpdate(cur);
        }
      }
      animId = requestAnimationFrame(frameLoop);
    };

    animId = requestAnimationFrame(frameLoop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, onTimeUpdate]);

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

  // Phím tắt Space Play/Pause & Phím F Toàn Màn Hình
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTogglePlay, handleToggleFullscreen]);

  // Style biến đổi video (Lật ngang, Lật dọc, Xoay, Zoom)
  // Transform áp dụng cho wrapper chứa video + mask + subtitle cùng nhau
  // để đảm bảo overlay luôn bám đúng vị trí khi zoom/xoay
  const scaleZoom = zoomLevel === 'fit' ? 1.0 : zoomLevel;
  const contentTransformStyle: React.CSSProperties = {
    transform: `scaleX(${isFlippedH ? -1 : 1}) scaleY(${isFlippedV ? -1 : 1}) rotate(${rotation}deg) scale(${scaleZoom})`,
    transformOrigin: 'center center',
    transition: 'transform 120ms ease-out',
  };

  return (
    <div className="w-full h-full flex-1 min-h-0 min-w-0 bg-slate-950 flex flex-col select-none overflow-hidden relative">
      {/* 1. Thanh Viewer Header Bar gắn cố định phía trên Viewport */}
      {videoUrl && (
        <ViewerToolbar
          videoTitle={videoTitle}
          videoDimensions={videoDimensions}
          aspectRatio={aspectRatio}
          onAspectRatioChange={onAspectRatioChange}
          fitMode={fitMode}
          onToggleFitMode={onToggleFitMode}
          isFlippedH={isFlippedH}
          onToggleFlipH={onToggleFlipH}
          isFlippedV={isFlippedV}
          onToggleFlipV={onToggleFlipV}
          rotation={rotation}
          onRotate={onRotate}
          onRotationChange={onRotationChange}
          zoomLevel={zoomLevel}
          onZoomChange={onZoomChange}
          onResetTransform={onResetTransform}
          showRoi={showRoi}
          onToggleRoi={() => setShowRoi(!showRoi)}
          previewMask={previewMask}
          onTogglePreviewMask={onTogglePreviewMask}
          maskStyle={maskStyle}
          onMaskStyleChange={onMaskStyleChange}
          blurStrength={blurStrength}
          onBlurStrengthChange={onBlurStrengthChange}
          showSubtitleOverlay={showSubtitleOverlay}
          onToggleSubtitleOverlay={onToggleSubtitleOverlay}
          subtitlePlacement={subtitlePlacement}
          onSubtitlePlacementChange={onSubtitlePlacementChange}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />
      )}

      {/* 2. Khung Viewport Video Tự Động Co Giãn Aspect-Fit với Canvas CapCut */}
      {videoUrl ? (
        <div
          ref={viewportRef}
          className="flex-1 min-h-0 min-w-0 w-full flex items-center justify-center relative overflow-hidden p-3 bg-slate-950"
        >
          {/* Khung Canvas chuẩn CapCut với pixel cố định tính toán qua ResizeObserver (chống co rút 300px) */}
          <div
            ref={videoBoxRef}
            className={`relative overflow-hidden bg-black flex items-center justify-center transition-all duration-100 ${
              isFullscreen
                ? 'w-screen h-screen max-w-none max-h-none rounded-none border-none'
                : 'rounded-xl border border-slate-800/90 shadow-2xl'
            }`}
            style={
              isFullscreen
                ? { width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh' }
                : {
                    width: canvasFitSize.width > 0 ? `${canvasFitSize.width}px` : '100%',
                    height: canvasFitSize.height > 0 ? `${canvasFitSize.height}px` : '100%',
                    maxWidth: '100%',
                    maxHeight: '100%',
                  }
            }
          >
            {/* === Wrapper Transform: CHỈ chứa Video === */}
            {/* Zoom/Xoay/Lật chỉ ảnh hưởng video, không ảnh hưởng overlay (zoom chỉ dùng cho xuất) */}
            <div
              className="relative w-full h-full"
              style={contentTransformStyle}
              onClick={handleVideoClick}
            >
              {/* Thẻ Video HTML5 */}
              <video
                ref={videoRef}
                src={videoUrl}
                crossOrigin="anonymous"
                playsInline
                style={{ objectFit: fitMode === 'cover' ? 'cover' : 'contain' }}
                className="w-full h-full block cursor-pointer"
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
            </div>

            {/* Lớp Phủ Che Sub Gốc (Preview Mask Bám Chuẩn Tọa Độ ROI - cùng coordinate space với ROI) */}
            {previewMask && boxDimensions.width > 0 && (
              <div
                className={`absolute pointer-events-none ${getMaskStyleClass(maskStyle)} z-10`}
                style={{
                  left: `${Math.round(region.x * boxDimensions.width)}px`,
                  top: `${Math.round(region.y * boxDimensions.height)}px`,
                  width: `${Math.round(region.width * boxDimensions.width)}px`,
                  height: `${Math.round(region.height * boxDimensions.height)}px`,
                  backdropFilter: `blur(${blurStrength}px)`,
                }}
              />
            )}

            {/* Lớp Phủ Hiển Thị Phụ Đề Dịch Tiếng Việt (cùng coordinate space với ROI) */}
            {showSubtitleOverlay && activeCue && boxDimensions.width > 0 && (
              <div
                className={`absolute pointer-events-none flex justify-center z-20 transition-all duration-75 px-4 ${
                  subtitlePlacement === 'bottom'
                    ? 'bottom-[6%] left-0 right-0 items-end'
                    : 'items-center'
                }`}
                style={
                  subtitlePlacement === 'bottom'
                    ? { left: 0, right: 0, bottom: '6%', margin: '0 auto' }
                    : {
                        left: 0,
                        right: 0,
                        top: `${Math.round(region.y * boxDimensions.height)}px`,
                        minHeight: `${Math.round(region.height * boxDimensions.height)}px`,
                        margin: '0 auto',
                      }
                }
              >
                <div className="relative inline-flex items-center justify-center max-w-[92%] px-4 py-1.5 transition-all duration-100">
                  {!previewMask && subtitlePlacement === 'roi' && (
                    <div
                      className={`absolute inset-0 ${getMaskStyleClass(maskStyle)} -z-10 animate-in fade-in duration-100 rounded-md`}
                      style={{ backdropFilter: `blur(${blurStrength}px)` }}
                    />
                  )}

                  {/* Phụ đề dịch tiếng Việt chuẩn điện ảnh */}
                  <div className="text-amber-300 font-bold text-sm sm:text-base md:text-lg lg:text-xl tracking-wide text-center leading-snug drop-shadow-[0_2px_4px_rgba(0,0,0,1)] [text-shadow:_0_1px_3px_rgba(0,0,0,0.95),_0_2px_8px_rgba(0,0,0,0.85)] select-none whitespace-normal">
                    {activeCue.translated_text || activeCue.source_text}
                  </div>
                </div>
              </div>
            )}

            {/* Lớp phủ ROI Overlay: cùng coordinate space với Mask → luôn khớp chính xác */}
            {showRoi && boxDimensions.width > 0 && boxDimensions.height > 0 && (
              <RoiOverlay
                region={region}
                onChange={onUpdateRegion}
                containerWidth={boxDimensions.width}
                containerHeight={boxDimensions.height}
              />
            )}

            {/* Thanh điều khiển âm lượng: NGOÀI transform wrapper → không bị zoom */}
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

export const VideoPlayer = React.memo(VideoPlayerComponent);
