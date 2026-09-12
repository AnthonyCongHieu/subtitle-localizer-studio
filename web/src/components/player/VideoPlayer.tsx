import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { RoiOverlay } from '../roi/RoiOverlay';
import { VideoTransformOverlay } from './VideoTransformOverlay';
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
  Move,
  Crop,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Sparkles,
  Crosshair,
  Droplet,
  Scan,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  RotateCcw,
  ChevronDown,
  Menu,
  Play,
  Pause,
  LayoutGrid,
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
  onPickLocalVideo?: (file: File) => void;

  cues?: SubtitleCueV1[];
  aspectRatio: AspectRatioType;
  onAspectRatioChange?: (ratio: AspectRatioType) => void;
  fitMode?: 'contain' | 'cover';
  onToggleFitMode?: () => void;
  onResetTransform?: () => void;
  isFlippedH: boolean;
  isFlippedV: boolean;
  rotation: number;
  onRotationChange?: (rotation: number) => void;
  zoomLevel: ZoomMode;
  onZoomChange: (zoom: ZoomMode) => void;
  previewMask: boolean;
  onTogglePreviewMask?: () => void;
  maskStyle?: MaskStyleType;
  blurStrength?: number;
  maskOpacity?: number;
  maskPadding?: number;
  maskBorderRadius?: number;
  responsiveFontScale?: boolean;
  subtitleStroke?: 'none' | 'soft' | 'stroke' | 'glow';
  subtitleLineHeight?: number;
  showSubtitleOverlay: boolean;
  subtitlePlacement?: SubtitlePlacementMode;
  videoPosition?: { x: number; y: number };
  onPositionChange?: (pos: { x: number; y: number }) => void;
  interactionMode?: 'video' | 'roi';
  onInteractionModeChange?: (mode: 'video' | 'roi') => void;
  regions?: RegionTrackV1[];
  activeRegionId?: string;
  onSelectRegion?: (id: string) => void;
  onAutoDetectRoi?: () => void;
  onResetAllParameters?: () => void;
  onToggleFlipH?: () => void;
  onToggleFlipV?: () => void;
  onRotate?: () => void;
  isAudioMuted?: boolean;
  onToggleAudioMute?: () => void;
  isVideoVisible?: boolean;
  volume?: number;
  onVolumeChange?: (vol: number) => void;
  subtitleFontSize?: number;
  subtitleFontFamily?: string;
  subtitleTextColor?: string;
  videoQuality?: 'original' | '720p' | '480p';
  onVideoQualityChange?: (quality: 'original' | '720p' | '480p') => void;
}

export type { MaskStyleType, SubtitlePlacementMode };

const getMaskStyleClass = (style: MaskStyleType | string = 'feather_tight') => {
  switch (style) {
    case 'feather_tight':
      // 1. Mờ bám khít chuẩn khung chữ nhật:
      return 'bg-black/20';

    case 'optical_blend':
      // 2. Hòa tan quang học thuần khiết:
      return 'bg-black/10';

    case 'soft_cinema':
      // 3. Gradient điện ảnh mềm:
      return 'bg-gradient-to-t from-black/35 via-black/15 to-transparent';

    case 'blur':
      // 4. Mờ hòa tan tự nhiên:
      return 'bg-black/15';

    case 'glass':
      // 5. Kính mờ trong suốt (Clear Frosted Glass):
      return 'bg-white/10 border border-white/20 shadow-sm';

    case 'ambient':
    case 'gradient':
      // 6. Gradient đáy êm dịu:
      return 'bg-gradient-to-t from-black/40 via-black/20 to-transparent';

    case 'feather':
      // 7. Mờ tiêu chuẩn:
      return 'bg-black/20';

    case 'mosaic':
      // 8. Khảm Mosaic nhẹ:
      return 'bg-black/25 [background-image:radial-gradient(#ffffff20_1px,transparent_1px)] [background-size:6px_6px]';

    case 'box':
    default:
      // 9. Hộp đen Cinema truyền thống:
      return 'bg-black/90 shadow-xl';
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
  onResetTransform,
  isFlippedH,
  isFlippedV,
  rotation,
  onRotationChange,
  zoomLevel,
  onZoomChange,
  previewMask,
  onTogglePreviewMask,
  maskStyle = 'feather_tight',
  blurStrength = 20,
  maskOpacity = 1,
  maskPadding = 0,
  maskBorderRadius = 0,
  responsiveFontScale = false,
  subtitleStroke = 'soft',
  subtitleLineHeight,
  showSubtitleOverlay,
  subtitlePlacement = 'roi',
  videoPosition = { x: 0, y: 0 },
  onPositionChange,
  interactionMode = 'roi',
  onInteractionModeChange,
  regions,
  activeRegionId,
  onSelectRegion,
  onAutoDetectRoi,
  onResetAllParameters,
  onToggleFlipH,
  onToggleFlipV,
  onRotate,
  isAudioMuted = false,
  onToggleAudioMute,
  isVideoVisible = true,
  volume: externalVolume,
  onVolumeChange,
  subtitleFontSize,
  subtitleFontFamily,
  subtitleTextColor,
  videoQuality = 'original',
  onVideoQualityChange,
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

  const [internalVolume, setInternalVolume] = useState<number>(1.0);
  const volume = externalVolume !== undefined ? externalVolume : internalVolume;
  const setVolume = onVolumeChange || setInternalVolume;
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const showRoi = true;
  const [showRoiOverlay, setShowRoiOverlay] = useState<boolean>(() => {
    try {
      return localStorage.getItem('studio_show_roi_overlay') !== 'false';
    } catch {
      return true;
    }
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [windowedBoxSize, setWindowedBoxSize] = useState<{ width: number; height: number }>({
    width: 360,
    height: 640,
  });
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(false);

  // Định dạng SMPTE Timecode chuẩn CapCut: 00:00:00:00 (Giờ:Phút:Giây:Khung hình)
  const formatSmpteTimecode = useCallback((seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 25);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!viewportRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      viewportRef.current.requestFullscreen().catch(() => {});
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
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
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

  // Xác định DUY NHẤT 1 vùng hiển thị phụ đề dịch (Single Subtitle Display Area)
  // Bất kể người dùng bật hay tắt làm mờ, vùng hiển thị sub chỉ có 1,
  // luôn cố định tại vùng phụ đề chính sát đáy màn hình (không bị nhảy loạn xạ khi chọn các vùng OCR khác)
  const subDisplayRegion = useMemo(() => {
    const list = regions && regions.length > 0 ? regions : [region];
    const sortedByY = [...list].sort((a, b) => b.y - a.y);
    return sortedByY[0] || region;
  }, [regions, region]);

  const canvasRatio = useMemo(() => {
    return getCanvasAspectRatio(aspectRatio, videoDimensions.width, videoDimensions.height);
  }, [aspectRatio, videoDimensions.width, videoDimensions.height]);

  // Đo kích thước thực tế của khung Viewport để tính toán pixel chính xác cho Canvas
  // Giải quyết triệt để lỗi co rút về 300px do Flexbox intrinsic sizing cycle
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const measure = (rect: { width: number; height: number }) => {
      if (rect.width > 0 && rect.height > 0) {
        // Tối ưu hóa padding đệm cực gọn để video hiển thị to rõ nhất trong không gian giữa
        const availW = Math.max(160, rect.width - 16);
        const availH = Math.max(90, rect.height - 16);
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
    };

    const initialRect = vp.getBoundingClientRect();
    measure(initialRect);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        measure(entry.contentRect);
      }
    });
    observer.observe(vp);
    return () => observer.disconnect();
  }, [canvasRatio.ratioNum, videoUrl, isFullscreen]);

  // Quan sát trực tiếp videoBoxRef để cập nhật boxDimensions chính xác từng pixel,
  // bao gồm cả chế độ Cửa Sổ thường lẫn Toàn Màn Hình (Fullscreen 100vw/100vh)
  useEffect(() => {
    const box = videoBoxRef.current;
    if (!box) return;

    const initialRect = box.getBoundingClientRect();
    if (initialRect.width > 0 && initialRect.height > 0) {
      setBoxDimensions({
        width: Math.round(initialRect.width),
        height: Math.round(initialRect.height),
      });
    }

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
  }, [isFullscreen, videoUrl, canvasFitSize.width, canvasFitSize.height]);

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

  // Đồng bộ Âm lượng & Mute thực tế trên thẻ video DOM theo tỉ lệ chuẩn
  const effectiveMuted = isAudioMuted !== undefined ? isAudioMuted : isMuted;
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = effectiveMuted;
    const effectiveGain = effectiveMuted ? 0 : Math.min(1, Math.max(0, volume));
    videoRef.current.volume = effectiveGain;
  }, [volume, effectiveMuted]);

  // Giải phóng âm thanh khi unmount
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
      }
    };
  }, []);


  // Trạng thái đang kéo biến đổi video để tắt CSS transition, giúp bám chuột mượt 1:1
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);

  // Style biến đổi video (Vị trí X, Y, Lật ngang, Lật dọc, Xoay, Zoom)
  const scaleZoom = zoomLevel === 'fit' ? 1.0 : zoomLevel;
  const effectiveBoxWidth = boxDimensions.width > 0 ? boxDimensions.width : canvasFitSize.width;
  const effectiveBoxHeight = boxDimensions.height > 0 ? boxDimensions.height : canvasFitSize.height;

  // Tính toán vùng hiển thị thực tế của khung hình video bên trong Canvas (Letterbox/Pillarbox Compensation)
  const videoRect = useMemo(() => {
    if (
      videoDimensions.width <= 0 ||
      videoDimensions.height <= 0 ||
      effectiveBoxWidth <= 0 ||
      effectiveBoxHeight <= 0
    ) {
      return { left: 0, top: 0, width: effectiveBoxWidth, height: effectiveBoxHeight };
    }
    const boxRatio = effectiveBoxWidth / effectiveBoxHeight;
    const vidRatio = videoDimensions.width / videoDimensions.height;

    if (fitMode === 'cover') {
      if (boxRatio > vidRatio) {
        const renderH = effectiveBoxWidth / vidRatio;
        return {
          left: 0,
          top: Math.round((effectiveBoxHeight - renderH) / 2),
          width: effectiveBoxWidth,
          height: Math.round(renderH),
        };
      } else {
        const renderW = effectiveBoxHeight * vidRatio;
        return {
          left: Math.round((effectiveBoxWidth - renderW) / 2),
          top: 0,
          width: Math.round(renderW),
          height: effectiveBoxHeight,
        };
      }
    }

    // fitMode === 'contain' (mặc định): kẹp khít khung hình video
    if (boxRatio > vidRatio) {
      // Chiều cao khít, 2 bên trái/phải có khoảng đệm pillarbox
      const renderW = Math.round(effectiveBoxHeight * vidRatio);
      return {
        left: Math.round((effectiveBoxWidth - renderW) / 2),
        top: 0,
        width: renderW,
        height: effectiveBoxHeight,
      };
    } else {
      // Chiều ngang khít, trên/dưới có khoảng đệm letterbox
      const renderH = Math.round(effectiveBoxWidth / vidRatio);
      return {
        left: 0,
        top: Math.round((effectiveBoxHeight - renderH) / 2),
        width: effectiveBoxWidth,
        height: renderH,
      };
    }
  }, [videoDimensions.width, videoDimensions.height, effectiveBoxWidth, effectiveBoxHeight, fitMode]);

  useEffect(() => {
    if (isFullscreen) return;
    if (effectiveBoxWidth <= 0 || effectiveBoxHeight <= 0) return;
    setWindowedBoxSize((prev) => {
      if (prev.width === effectiveBoxWidth && prev.height === effectiveBoxHeight) return prev;
      return { width: effectiveBoxWidth, height: effectiveBoxHeight };
    });
  }, [isFullscreen, effectiveBoxWidth, effectiveBoxHeight]);

  const subtitleFontScale = responsiveFontScale
    ? (videoRect.width > 0 ? videoRect.width : effectiveBoxWidth) / 360
    : (isFullscreen ? effectiveBoxWidth / Math.max(1, windowedBoxSize.width) : 1);

  const getOverlayGeometry = useCallback((reg: RegionTrackV1) => {
    const padding = Math.min(24, Math.max(-4, maskPadding));
    const targetW = videoRect.width > 0 ? videoRect.width : effectiveBoxWidth;
    const targetH = videoRect.height > 0 ? videoRect.height : effectiveBoxHeight;
    const offsetX = videoRect.left;
    const offsetY = videoRect.top;

    const effectiveLeft = Math.max(0, Math.round(offsetX + reg.x * targetW) - padding);
    const effectiveTop = Math.max(0, Math.round(offsetY + reg.y * targetH) - padding);
    const effectiveWidth = Math.min(
      effectiveBoxWidth - effectiveLeft,
      Math.round(reg.width * targetW) + padding * 2
    );
    const effectiveHeight = Math.min(
      effectiveBoxHeight - effectiveTop,
      Math.round(reg.height * targetH) + padding * 2
    );
    return { effectiveLeft, effectiveTop, effectiveWidth, effectiveHeight };
  }, [videoRect, effectiveBoxWidth, effectiveBoxHeight, maskPadding]);

  const subtitleTextShadow = subtitleStroke === 'none'
    ? 'none'
    : subtitleStroke === 'stroke'
      ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
      : subtitleStroke === 'glow'
        ? '0 0 4px #000, 0 0 10px rgba(0,0,0,0.95), 0 0 16px rgba(0,0,0,0.8)'
        : '0 1px 3px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.85)';

  const contentTransformStyle: React.CSSProperties = {
    transform: `translate(${videoPosition.x}px, ${videoPosition.y}px) scale(${scaleZoom}) rotate(${rotation}deg) scaleX(${isFlippedH ? -1 : 1}) scaleY(${isFlippedV ? -1 : 1})`,
    transformOrigin: 'center center',
    transition: isDraggingVideo ? 'none' : 'transform 100ms ease-out',
  };

  return (
    <div className="w-full h-full flex-1 min-h-0 min-w-0 bg-slate-950 flex flex-col select-none overflow-hidden relative">
      {/* 1. Thanh Công Cụ Canvas Chuẩn (Dedicated Top Toolbar - Tách biệt độc lập, không che hay chạm sát Video) */}
      {videoUrl && (
        <div className="w-full shrink-0 h-9 px-3 bg-zinc-950/95 border-b border-zinc-800/80 flex items-center justify-between z-30 shadow-sm backdrop-blur-md select-none">
          {/* Tiêu đề Trình phát & Đồng bộ Timecode lên trên */}
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <span className="text-xs font-semibold text-slate-300 truncate">
              {videoTitle ? `Trình phát - ${videoTitle}` : 'Trình phát - Dòng thời gian 01'}
            </span>
            <div className="flex items-center gap-1.5 font-mono text-[11px] select-text bg-slate-900/90 px-2 py-0.5 rounded-md border border-slate-800">
              <span className="text-cyan-400 font-bold tracking-wider">
                {formatSmpteTimecode(currentTime)}
              </span>
              <span className="text-zinc-500">/</span>
              <span className="text-zinc-400 tracking-wider">
                {formatSmpteTimecode(videoDuration || 0)}
              </span>
            </div>
          </div>

          {/* Cụm công cụ tương tác nhanh & Menu CapCut */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Nhóm Nút Chuyển Đổi Chế Độ Thao Tác ROI / Kéo Video */}
            <div className="flex items-center gap-0.5 bg-slate-900/90 p-0.5 rounded-full border border-slate-800 shadow-inner">
              <button
                type="button"
                onClick={() => onInteractionModeChange?.('roi')}
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer ${
                  interactionMode === 'roi'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Chế độ Định Vị Vùng ROI Phụ Đề (Hiện khung chữ nhật xanh để căn chỉnh)"
              >
                <Crop className="w-3 h-3" />
                <span>Vùng ROI</span>
              </button>
              <button
                type="button"
                onClick={() => onInteractionModeChange?.('video')}
                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer ${
                  interactionMode === 'video'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Chế độ Kéo di chuyển / Co giãn / Xoay Video (Chuẩn CapCut)"
              >
                <Move className="w-3 h-3" />
                <span>Kéo Video</span>
              </button>
            </div>

            {/* Nút Ẩn / Hiện Lớp Che Sub Gốc (Filter Preview) */}
            {onTogglePreviewMask && (
              <button
                type="button"
                onClick={onTogglePreviewMask}
                className={`flex items-center justify-center gap-1 w-20 px-2 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                  previewMask
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold ring-1 ring-emerald-400/40'
                    : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
                title={
                  previewMask
                    ? 'Đang BẬT hiệu ứng che sub gốc / làm mờ (Nhấp để tắt làm mờ)'
                    : 'Đang TẮT hiệu ứng che sub gốc (Nhấp để bật làm mờ)'
                }
              >
                {previewMask ? (
                  <Eye className="w-3.5 h-3.5 text-emerald-200" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{previewMask ? 'Đang Che' : 'Tắt Che'}</span>
              </button>
            )}

            {/* Nút Ẩn / Hiện Khung Edit Vùng Quét (ROI Edit Frame) */}
            <button
              type="button"
              onClick={() => {
                setShowRoiOverlay((prev) => {
                  const next = !prev;
                  try {
                    localStorage.setItem('studio_show_roi_overlay', String(next));
                  } catch {}
                  return next;
                });
              }}
              className={`flex items-center justify-center gap-1 w-24 px-2 py-0.5 rounded-full text-[11px] font-medium transition cursor-pointer shadow-sm active:scale-95 shrink-0 ${
                showRoiOverlay
                  ? 'bg-sky-600 hover:bg-sky-500 text-white font-semibold ring-1 ring-sky-400/40'
                  : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
              title={showRoiOverlay ? 'Khung quét đang hiện (Nhấp để ẩn viền và tay cầm)' : 'Khung quét đang ẩn (Nhấp để hiện viền và tay cầm)'}
            >
              {showRoiOverlay ? <Eye className="w-3.5 h-3.5 text-sky-200" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
              <span>{showRoiOverlay ? 'Khung Quét' : 'Ẩn Khung'}</span>
            </button>

            {/* Tự động quét bắt dính ROI */}
            {onAutoDetectRoi && (
              <button
                type="button"
                onClick={onAutoDetectRoi}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white text-[10px] font-semibold transition cursor-pointer"
                title="🎯 Tự động quét và bắt dính vùng chữ phụ đề"
              >
                <Sparkles className="w-3 h-3 text-amber-300" />
                <span className="hidden sm:inline">Bắt Dính</span>
              </button>
            )}

            {/* Căn giữa chuẩn phụ đề đáy */}
            <button
              type="button"
              onClick={() => onUpdateRegion({ ...region, x: 0.06, y: 0.81, width: 0.88, height: 0.15 })}
              className="p-1 rounded-md bg-slate-900 hover:bg-slate-850 text-indigo-300 hover:text-white border border-slate-800 transition cursor-pointer"
              title="⌖ Căn giữa chuẩn phụ đề đáy"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>

            {/* Nhãn thông số ROI tinh tế trên Toolbar - Không che nội dung video */}
            {(() => {
              const currentReg = (regions && regions.find((r) => r.region_id === (activeRegionId || region.region_id))) || region;
              const cX = Math.max(0.0, Math.min(0.97, currentReg.x));
              const cY = Math.max(0.0, Math.min(0.98, currentReg.y));
              const cW = Math.max(0.03, Math.min(1.0 - cX, currentReg.width));
              const cH = Math.max(0.02, Math.min(1.0 - cY, currentReg.height));
              return (
                <div
                  data-testid="roi-toolbar-badge"
                  className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900/90 border border-slate-800 text-[10px] font-mono text-indigo-300 select-none shadow-sm shrink-0"
                  title="Thông số Vùng Quét ROI Hiện Tại"
                >
                  <Crosshair className="w-3 h-3 text-indigo-400" />
                  <span className="font-semibold text-slate-200">ROI:</span>
                  {currentReg.mask_enabled !== false ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                      <Droplet className="w-2.5 h-2.5" /> Làm mờ
                    </span>
                  ) : (
                    <span className="text-amber-400 font-semibold flex items-center gap-0.5">
                      <Scan className="w-2.5 h-2.5" /> Chỉ quét
                    </span>
                  )}
                  <span className="text-slate-600">|</span>
                  <span>Y: {Math.round(cY * 100)}%</span>
                  <span>H: {Math.round(cH * 100)}%</span>
                  <span>W: {Math.round(cW * 100)}%</span>
                </div>
              );
            })()}

            {/* Nút Menu Hamburger ≡ chuẩn CapCut góc phải trên cùng */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu((prev) => !prev)}
                className={`p-1.5 rounded text-slate-400 hover:text-white transition cursor-pointer ${
                  showMenu ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60'
                }`}
                title="Tùy chọn bổ sung (Xoay, Lật, Đặt lại biến đổi, Âm lượng)"
              >
                <Menu className="w-4 h-4" />
              </button>

              {/* Popover Dropdown Tùy Chọn Bổ Sung */}
              {showMenu && (
                <div
                  className="absolute right-0 top-full mt-1 w-56 bg-slate-900 border border-slate-700/80 rounded-lg shadow-2xl p-2 z-50 flex flex-col gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-[10px] uppercase font-bold text-slate-400 px-1">
                    Công Cụ Biến Đổi Video
                  </div>

                  {/* Lật & Xoay video */}
                  <div className="flex items-center gap-1">
                    {onToggleFlipH && (
                      <button
                        type="button"
                        onClick={onToggleFlipH}
                        className={`flex-1 flex items-center justify-center gap-1 py-1 rounded border text-[10px] transition cursor-pointer ${
                          isFlippedH
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title="Lật ngang (Flip H)"
                      >
                        <FlipHorizontal className="w-3 h-3" />
                        <span>Lật Ngang</span>
                      </button>
                    )}
                    {onToggleFlipV && (
                      <button
                        type="button"
                        onClick={onToggleFlipV}
                        className={`flex-1 flex items-center justify-center gap-1 py-1 rounded border text-[10px] transition cursor-pointer ${
                          isFlippedV
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title="Lật dọc (Flip V)"
                      >
                        <FlipVertical className="w-3 h-3" />
                        <span>Lật Dọc</span>
                      </button>
                    )}
                    {onRotate && (
                      <button
                        type="button"
                        onClick={onRotate}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-slate-950 border border-slate-800 text-cyan-400 hover:text-cyan-300 text-[10px] font-mono transition cursor-pointer"
                        title="Xoay +90°"
                      >
                        <RotateCw className="w-3 h-3" />
                        <span>+90°</span>
                      </button>
                    )}
                  </div>

                  {/* Đệm chuẩn / Tràn viền & Căn giữa */}
                  <div className="flex items-center gap-1">
                    {onToggleFitMode && (
                      <button
                        type="button"
                        onClick={onToggleFitMode}
                        className={`flex-1 flex items-center justify-center gap-1 py-1 rounded border text-[10px] transition cursor-pointer ${
                          fitMode === 'cover'
                            ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-semibold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title={fitMode === 'cover' ? 'Chuyển sang Đệm chuẩn (Contain)' : 'Chuyển sang Tràn viền (Cover)'}
                      >
                        <Crop className="w-3 h-3" />
                        <span>{fitMode === 'cover' ? 'Tràn Viền' : 'Đệm Chuẩn'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onPositionChange?.({ x: 0, y: 0 })}
                      className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white text-[10px] transition cursor-pointer"
                      title="Đặt lại video về tâm (Reset 0, 0)"
                    >
                      <Move className="w-3 h-3 text-indigo-400" />
                      <span>Về Tâm</span>
                    </button>
                  </div>

                  {/* Reset Toàn Bộ Biến Đổi */}
                  {(onResetTransform || onResetAllParameters) && (
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          (onResetTransform || onResetAllParameters)?.();
                          setShowMenu(false);
                        }}
                        className="w-full flex items-center justify-center gap-1 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 hover:text-white text-[10px] font-semibold transition cursor-pointer"
                        title="Khôi phục toàn bộ biến đổi về mặc định"
                      >
                        <RotateCcw className="w-3 h-3 text-rose-400" />
                        <span>Reset Biến Đổi</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Khung Viewport Video Tự Động Co Giãn Aspect-Fit với Canvas CapCut */}
      {videoUrl ? (
        <>
          <div
          ref={viewportRef}
          data-testid="player-fullscreen-root"
          className={
            isFullscreen
              ? 'w-screen h-screen p-0 bg-black flex items-center justify-center relative overflow-hidden'
              : 'flex-1 min-h-0 min-w-0 w-full flex items-center justify-center relative overflow-hidden p-2 sm:p-3 bg-slate-950'
          }
        >
          {/* Canvas giữ tỉ lệ thật; overlay ROI/phụ đề nằm trong canvas để không lệch khi fullscreen */}
          <div
            ref={videoBoxRef}
            data-testid="player-canvas-box"
            className={`relative bg-black flex items-center justify-center transition-all duration-100 ${
              isFullscreen
                ? 'rounded-none border-none'
                : 'rounded-none border border-slate-800/90 shadow-2xl'
            }`}
            style={{
              width: `${canvasFitSize.width}px`,
              height: `${canvasFitSize.height}px`,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            {/* === 1. Lớp Khung Chuẩn (Canvas Bounds): Cố định theo khung chuẩn góc vuông, clip 100% phần video tràn ra ngoài === */}
            <div
              className="absolute inset-0 overflow-hidden cursor-pointer rounded-none"
              onClick={handleVideoClick}
            >
              {/* Wrapper Transform: Chứa thẻ video, thực hiện kéo/phóng to/xoay/lật */}
              <div
                className="w-full h-full"
                style={contentTransformStyle}
              >
                {/* Thẻ Video HTML5 */}
                <video
                  ref={videoRef}
                  src={videoUrl}
                  crossOrigin="anonymous"
                  playsInline
                  muted={isAudioMuted}
                  style={{
                    objectFit: fitMode === 'cover' ? 'cover' : 'contain',
                    opacity: isVideoVisible !== false ? 1 : 0,
                  }}
                  className="w-full h-full block cursor-pointer transition-opacity duration-150"
                  onLoadedMetadata={(e) => {
                    const target = e.currentTarget;
                    setVideoDimensions({ width: target.videoWidth, height: target.videoHeight });
                    setVideoDuration(target.duration);
                    onDurationChange(target.duration);
                    if (currentTime > 0) {
                      try {
                        target.currentTime = currentTime;
                      } catch {}
                    }
                  }}
                  onTimeUpdate={(e) => {
                    onTimeUpdate(e.currentTarget.currentTime);
                  }}
                  onEnded={() => onTogglePlay()}
                />
              </div>
            </div>

            {/* Lưới căn chỉnh khung hình SMPTE / Quy tắc một phần ba (Rule of Thirds) */}
            {showGrid && (
              <div
                data-testid="smpte-grid-overlay"
                className="absolute inset-0 pointer-events-none z-20 grid grid-cols-3 grid-rows-3"
              >
                <div className="border-r border-b border-cyan-400/30" />
                <div className="border-r border-b border-cyan-400/30" />
                <div className="border-b border-cyan-400/30" />
                <div className="border-r border-b border-cyan-400/30" />
                <div className="border-r border-b border-cyan-400/30" />
                <div className="border-b border-cyan-400/30" />
                <div className="border-r border-cyan-400/30" />
                <div className="border-r border-cyan-400/30" />
                <div />
              </div>
            )}

            {/* === 2. Lớp Phủ Biến Đổi Video Chuẩn CapCut (Kéo di chuyển, 8 mấu co giãn, 1 mấu xoay) === */}
            {effectiveBoxWidth > 0 && effectiveBoxHeight > 0 && (
              <VideoTransformOverlay
                containerWidth={effectiveBoxWidth}
                containerHeight={effectiveBoxHeight}
                position={videoPosition}
                scale={scaleZoom}
                rotation={rotation}
                isFlippedH={isFlippedH}
                isFlippedV={isFlippedV}
                onPositionChange={onPositionChange || (() => {})}
                onScaleChange={(s) => onZoomChange(s)}
                onRotationChange={onRotationChange || (() => {})}
                onDragStateChange={setIsDraggingVideo}
                isActive={interactionMode === 'video'}
              />
            )}

            {/* === 3. Lớp Phủ Che Sub Gốc (khóa đúng khung ROI, không nhảy theo box từng câu) === */}
            {previewMask && effectiveBoxWidth > 0 && effectiveBoxHeight > 0 && (
              <>
                {(regions && regions.length > 0 ? regions : [region])
                  .filter((r) => r.mask_enabled !== false)
                  .map((reg) => {
                    const isSolidBox = maskStyle === 'box';
                    const bleed = (isSolidBox ? 0 : Math.max(14, Math.round(blurStrength * 0.8))) +
                      Math.min(24, Math.max(-4, maskPadding));
                    const {
                      effectiveLeft,
                      effectiveTop,
                      effectiveWidth,
                      effectiveHeight,
                    } = getOverlayGeometry(reg);

                    return (
                      <div
                        key={reg.region_id}
                        className="absolute pointer-events-none overflow-hidden z-30"
                        style={{
                          left: `${effectiveLeft}px`,
                          top: `${effectiveTop}px`,
                          width: `${effectiveWidth}px`,
                          height: `${effectiveHeight}px`,
                        }}
                      >
                        {/* Lớp nền làm mờ bám khít góc cạnh khung quét, loại bỏ hoàn toàn viền hở và suy giảm mép */}
                        <div
                          className={`absolute ${getMaskStyleClass(maskStyle)}`}
                          style={{
                            top: `-${bleed}px`,
                            left: `-${bleed}px`,
                            right: `-${bleed}px`,
                            bottom: `-${bleed}px`,
                            backdropFilter: isSolidBox ? 'none' : `blur(${blurStrength}px)`,
                            WebkitBackdropFilter: isSolidBox ? 'none' : `blur(${blurStrength}px)`,
                            opacity: Math.min(1, Math.max(0.1, maskOpacity)),
                            borderRadius: `${[0, 4, 8, 16].includes(maskBorderRadius) ? maskBorderRadius : 0}px`,
                          }}
                        />
                      </div>
                    );
                  })}
              </>
            )}

            {/* === 4. Lớp Phủ Hiển Thị Phụ Đề Dịch Tiếng Việt (CHỈ DUY NHẤT 1 VÙNG HIỂN THỊ CHUẨN) === */}
            {showSubtitleOverlay && activeCue && effectiveBoxWidth > 0 && (
              <div
                key={`sub-overlay-${activeCue.cue_id}`}
                className={`absolute pointer-events-none flex items-center justify-center z-40 ${
                  subtitlePlacement === 'bottom' || (subDisplayRegion && subDisplayRegion.y < 0.45)
                    ? 'bottom-[6%] left-0 right-0 px-4'
                    : ''
                }`}
                style={
                  subtitlePlacement === 'bottom' || (subDisplayRegion && subDisplayRegion.y < 0.45)
                    ? {
                        left: `${videoRect.left}px`,
                        width: `${videoRect.width}px`,
                        bottom: `${Math.max(16, (effectiveBoxHeight - videoRect.top - videoRect.height) + Math.round(videoRect.height * 0.06))}px`,
                        margin: '0 auto',
                      }
                    : (() => {
                        const geometry = getOverlayGeometry(subDisplayRegion);
                        const targetW = videoRect.width > 0 ? videoRect.width : effectiveBoxWidth;
                        // Đảm bảo phụ đề không bao giờ bị bóp nghẹt thành dải hẹp dọc
                        const minReadableWidth = Math.min(targetW * 0.96, Math.max(geometry.effectiveWidth, Math.min(380, targetW * 0.9)));
                        const centerX = geometry.effectiveLeft + geometry.effectiveWidth / 2;
                        const safeLeft = Math.max(videoRect.left + 4, Math.min(videoRect.left + targetW - minReadableWidth - 4, centerX - minReadableWidth / 2));
                        return {
                          left: `${safeLeft}px`,
                          top: `${geometry.effectiveTop}px`,
                          width: `${minReadableWidth}px`,
                          minHeight: `${geometry.effectiveHeight}px`,
                        };
                      })()
                }
              >
                <div className="relative inline-flex items-center justify-center w-full max-w-[92%] px-3 py-1 break-words text-center">
                  {/* Phụ đề dịch tiếng Việt chuẩn điện ảnh - Hỗ trợ tùy biến phông, cỡ chữ, màu sắc */}
                  <div
                    data-testid="rendered-subtitle-text"
                    style={{
                      fontSize: subtitleFontSize
                        ? `${subtitleFontSize * subtitleFontScale}px`
                        : undefined,
                      fontFamily: subtitleFontFamily || undefined,
                      color: subtitleTextColor || '#fde047',
                      lineHeight: subtitleLineHeight,
                      textShadow: subtitleTextShadow,
                    }}
                    className="font-bold tracking-wide text-center select-none whitespace-normal break-words max-w-full"
                  >
                    {activeCue.translated_text || activeCue.source_text}
                  </div>
                </div>
              </div>
            )}

            {/* === 5. KHUNG QUÉT SUB (ROI OVERLAY) === */}
            {showRoi && showRoiOverlay && videoRect.width > 0 && videoRect.height > 0 && (
              <div
                className="absolute pointer-events-none z-50 overflow-visible"
                style={{
                  left: `${videoRect.left}px`,
                  top: `${videoRect.top}px`,
                  width: `${videoRect.width}px`,
                  height: `${videoRect.height}px`,
                }}
              >
                <RoiOverlay
                  region={region}
                  onChange={onUpdateRegion}
                  regions={regions}
                  activeRegionId={activeRegionId}
                  onSelectRegion={onSelectRegion}
                  containerWidth={videoRect.width}
                  containerHeight={videoRect.height}
                  disabled={interactionMode !== 'roi'}
                />
              </div>
            )}
          </div>
        </div>

        {/* 3. THANH ĐIỀU KHIỂN ĐÁY TRÌNH PHÁT CHUẨN CAPCUT (DEDICATED BOTTOM CONTROLS) */}
        <div
          data-testid="player-bottom-controls"
          className="w-full h-9 bg-zinc-950/95 border-t border-zinc-800/80 px-3 flex items-center justify-between z-30 shrink-0 select-none shadow-md backdrop-blur-md"
        >
          {/* Cụm Bên Trái: Nút Phát / Tạm Dừng & Lưới Khung Hình */}
          <div className="flex items-center gap-2">
            {/* Nút Play / Pause Chuẩn CapCut (Solid White Triangle / Pause) */}
            <button
              type="button"
              data-testid="player-play-button"
              onClick={onTogglePlay}
              className="w-7 h-7 rounded flex items-center justify-center text-white hover:text-cyan-300 hover:bg-zinc-800/80 transition cursor-pointer"
              title={isPlaying ? "Tạm dừng video (Space)" : "Phát video (Space)"}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            {/* Biểu tượng lưới khung hình SMPTE 3x3 */}
            <button
              type="button"
              data-testid="player-grid-button"
              onClick={() => setShowGrid((p) => !p)}
              className={`p-1 transition cursor-pointer rounded ${
                showGrid
                  ? 'text-cyan-400 bg-zinc-800/90 shadow-inner'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={showGrid ? "Tắt lưới căn chỉnh SMPTE (3x3)" : "Bật lưới căn chỉnh SMPTE (3x3)"}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Cụm Bên Phải: Âm Lượng • Chất Lượng [Đầy đủ] • Canvas Zoom [Fit] • Tỉ Lệ [16:9] • Toàn Màn Hình [⛶] */}
          <div className="flex items-center gap-2">
            {/* Âm Lượng Video Nằm Kế Chất Lượng Xem */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900/90 border border-zinc-700/90 text-zinc-300 shadow-sm">
              <button
                type="button"
                onClick={() => {
                  if (onToggleAudioMute) {
                    onToggleAudioMute();
                  } else {
                    setIsMuted(!isMuted);
                  }
                }}
                className="text-zinc-400 hover:text-white transition cursor-pointer"
                title={effectiveMuted ? 'Bật âm thanh (M)' : 'Tắt tiếng (M)'}
              >
                {effectiveMuted || volume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-zinc-300" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={effectiveMuted ? 0 : volume}
                onDoubleClick={() => setVolume(1.0)}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  if (v > 0 && effectiveMuted) {
                    if (onToggleAudioMute) onToggleAudioMute();
                    else setIsMuted(false);
                  }
                }}
                className="w-20 sm:w-24 h-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition shadow-inner"
                title={`Âm lượng: ${Math.round((effectiveMuted ? 0 : volume) * 100)}% (Nhấp đúp để đặt lại 100%)`}
              />
              <span className="text-[10px] font-mono text-zinc-300 w-7 text-right font-medium">
                {Math.round((effectiveMuted ? 0 : volume) * 100)}%
              </span>
            </div>

            {/* 1. Chọn Chất Lượng Video Preview: Box Button [ Đầy đủ ▾ ] */}
            <div className="relative flex items-center">
              <select
                title="Chất lượng phát Video xem trước (Chọn 720p hoặc 480p để xem mượt, tua tức thì, không tốn RAM)"
                value={videoQuality || 'original'}
                onChange={(e) => onVideoQualityChange?.(e.target.value as 'original' | '720p' | '480p')}
                className="bg-zinc-900/90 text-zinc-300 hover:text-white border border-zinc-700/90 hover:border-zinc-500 rounded px-2 py-0.5 text-[11px] font-medium appearance-none pr-5 cursor-pointer focus:outline-none transition shadow-sm"
              >
                <option value="original">Đầy đủ</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
              <ChevronDown className="w-2.5 h-2.5 text-zinc-400 absolute right-1.5 pointer-events-none" />
            </div>

            {/* 2. Thu Phóng Canvas: Box Button [ Fit / Q ▾ ] */}
            <div className="relative flex items-center">
              <select
                title="Thu phóng khung nhìn Canvas"
                value={typeof zoomLevel === 'number' ? `${Math.round(zoomLevel * 100)}%` : zoomLevel}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'fit') {
                    onZoomChange('fit');
                  } else {
                    const parsed = parseFloat(val) / 100;
                    if (!isNaN(parsed)) onZoomChange(parsed);
                  }
                }}
                className="bg-zinc-900/90 text-zinc-300 hover:text-white border border-zinc-700/90 hover:border-zinc-500 rounded px-2 py-0.5 text-[11px] font-mono font-medium appearance-none pr-5 cursor-pointer focus:outline-none transition shadow-sm"
              >
                <option value="fit">Fit</option>
                <option value="50%">50%</option>
                <option value="75%">75%</option>
                <option value="100%">100%</option>
                <option value="125%">125%</option>
                <option value="150%">150%</option>
                <option value="200%">200%</option>
              </select>
              <ChevronDown className="w-2.5 h-2.5 text-zinc-400 absolute right-1.5 pointer-events-none" />
            </div>

            {/* 3. Tỉ Lệ Khung Hình Canvas: Box Button [ 16:9 ▾ ] */}
            <div className="relative flex items-center">
              <select
                title="Tỉ lệ khung hình Canvas"
                value={aspectRatio}
                onChange={(e) => onAspectRatioChange?.(e.target.value as AspectRatioType)}
                className="bg-zinc-900/90 text-zinc-300 hover:text-white border border-zinc-700/90 hover:border-zinc-500 rounded px-2 py-0.5 text-[11px] font-mono font-medium appearance-none pr-5 cursor-pointer focus:outline-none transition shadow-sm"
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="2.35:1">2.35:1</option>
                <option value="original">Gốc ({canvasRatio.label})</option>
              </select>
              <ChevronDown className="w-2.5 h-2.5 text-zinc-400 absolute right-1.5 pointer-events-none" />
            </div>

            {/* 4. Toàn màn hình [ ⛶ ] */}
            <button
              type="button"
              data-testid="player-fullscreen-button"
              onClick={handleToggleFullscreen}
              className="p-1 rounded text-zinc-400 hover:text-white transition cursor-pointer"
              title={isFullscreen ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </>
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
