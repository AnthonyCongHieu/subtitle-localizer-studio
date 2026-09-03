import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Eye,
  Film,
  Crosshair,
  FastForward,
  Rewind,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Target,
} from 'lucide-react';

interface ProxyPlayerProps {
  videoUrl?: string;
  renderedVideoUrl?: string;
  currentTime: number;
  isPlaying: boolean;
  activeCue?: SubtitleCueV1;
  region?: RegionTrackV1;
  previewMode?: 'mask_replace' | 'original' | 'rendered';
  showRoi?: boolean;
  onPreviewModeChange?: (mode: 'mask_replace' | 'original' | 'rendered') => void;
  onTimeUpdate: (time: number) => void;
  onTogglePlay: () => void;
  onToggleRoi?: () => void;
  onAutoDetectRoi?: () => void;
}

export const ProxyPlayer: React.FC<ProxyPlayerProps> = ({
  videoUrl,
  renderedVideoUrl,
  currentTime,
  isPlaying,
  activeCue,
  region,
  previewMode: controlledMode,
  showRoi,
  onPreviewModeChange,
  onTimeUpdate,
  onTogglePlay,
  onToggleRoi,
  onAutoDetectRoi,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const lastUpdateRef = useRef<number>(0);
  const [internalMode, setInternalMode] = useState<'mask_replace' | 'original' | 'rendered'>('mask_replace');
  const previewMode = controlledMode || internalMode;
  const setPreviewMode = (m: 'mask_replace' | 'original' | 'rendered') => {
    setInternalMode(m);
    onPreviewModeChange?.(m);
  };
  const [showRoiBox, setShowRoiBox] = useState(false);
  const isRoiVisible = showRoi !== undefined ? showRoi : showRoiBox;
  const [autoFitWidth, setAutoFitWidth] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubberRef = useRef<HTMLDivElement>(null);

  // Choose video source based on preview mode
  const activeVideoSource = previewMode === 'rendered' && renderedVideoUrl ? renderedVideoUrl : videoUrl;

  useEffect(() => {
    if (videoRef.current) {
      if (Math.abs(videoRef.current.currentTime - currentTime) > 0.25) {
        videoRef.current.currentTime = currentTime;
      }
    }
  }, [currentTime]);

  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      } else if (!isPlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Listen for fullscreen change events
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!playerContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      playerContainerRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  const formatTimecode = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const roiLeft = region ? `${(region.x * 100).toFixed(1)}%` : '8%';
  const roiWidth = region ? `${(region.width * 100).toFixed(1)}%` : '84%';

  // Dynamic Auto-Fit Box based on active cue text length - compact and snug for 16:9 widescreen
  const dynamicBox = useMemo(() => {
    // Multi-line detection: newline present or text > 42 chars
    const isMultiLine =
      (activeCue?.translated_text || '').includes('\n') ||
      (activeCue?.source_text || '').includes('\n') ||
      (activeCue?.translated_text || '').length > 42;

    // Single-line box height: 8.6% (covers 7.5% character height + 0.5% top/bottom safety buffer)
    // Multi-line box height: 12.2%
    const boxHeightNum = isMultiLine ? 12.2 : 8.6;

    // Subtitle baseline anchor:
    // In standard 16:9 video, subtitles sit precisely at y in [83.5%, 91.2%].
    // If an ROI is set, align mask bottom closely with ROI bottom (minus 1.0% margin).
    // Otherwise anchor mask bottom at 91.8% (so top = 83.2%, envelops 83.5% with 0.3% margin).
    const maskBottom = region
      ? Math.min(93.0, Math.max(85.0, (region.y + region.height) * 100 - 1.0))
      : 91.8;
    const boxTopNum = maskBottom - boxHeightNum;

    if (!autoFitWidth || !activeCue) {
      return {
        left: roiLeft,
        top: `${boxTopNum.toFixed(1)}%`,
        width: roiWidth,
        height: `${boxHeightNum.toFixed(1)}%`,
      };
    }

    const srcLen = (activeCue.source_text || '').trim().length;
    const transLen = (activeCue.translated_text || '').trim().length;

    // Chiều rộng chữ Hán gốc: mỗi ký tự tiếng Trung chiếm ~3.56% bề ngang frame 16:9.
    // Lề an toàn tối ưu 3.5% để ôm khít tuyệt đối chữ gốc, không thừa ô đen.
    const snugOriginWidth = Math.max(12, srcLen * 3.56 + 3.5);

    // Khi bật Co Giãn:
    // Khóa chặt kích thước khung che theo đúng text gốc tiếng Trung, cho phép mở rộng nhẹ tối đa 1.20x
    // để chứa vừa chữ tiếng Việt với cỡ chữ lớn, rõ nét hơn!
    const estTransWidth = Math.max(12, transLen * 1.02 + 3.2);
    const maxAllowedWidth = Math.max(snugOriginWidth * 1.20, snugOriginWidth + 3.0);
    const targetW = previewMode === 'original'
      ? snugOriginWidth
      : Math.min(maxAllowedWidth, Math.max(snugOriginWidth, estTransWidth));

    const fitW = Math.min(82, Math.max(targetW, 13));
    const fitL = (100 - fitW) / 2;

    return {
      left: `${fitL.toFixed(1)}%`,
      top: `${boxTopNum.toFixed(1)}%`,
      width: `${fitW.toFixed(1)}%`,
      height: `${boxHeightNum.toFixed(1)}%`,
    };
  }, [autoFitWidth, activeCue, previewMode, roiLeft, roiWidth, region]);

  const replayCurrentCue = () => {
    if (activeCue) {
      onTimeUpdate(activeCue.start_pts);
      if (!isPlaying) onTogglePlay();
    }
  };

  // Scrubber handlers
  const handleScrubberClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current || videoDuration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
    onTimeUpdate(ratio * videoDuration);
  }, [videoDuration, onTimeUpdate]);

  const handleScrubberMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsScrubbing(true);
    handleScrubberClick(e);
  }, [handleScrubberClick]);

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!scrubberRef.current || videoDuration <= 0) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
      onTimeUpdate(ratio * videoDuration);
    };
    const handleMouseUp = () => setIsScrubbing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, videoDuration, onTimeUpdate]);

  const scrubberProgress = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  return (
    <div ref={playerContainerRef} className="flex flex-col bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden shadow-2xl">
      {/* Top Banner: Mode Indicator */}
      <div className="bg-zinc-900/90 border-b border-zinc-800/80 px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-zinc-400">Xem trước:</span>
          <div className="flex bg-zinc-950 rounded-lg p-0.5 border border-zinc-800 gap-0.5">
            <button
              onClick={() => setPreviewMode('mask_replace')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
                previewMode === 'mask_replace'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Làm mờ chữ gốc và đè phụ đề tiếng Việt ngay tại tọa độ ROI"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              
            </button>
            <button
              onClick={() => setPreviewMode('original')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
                previewMode === 'original'
                  ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-zinc-400" />
              
            </button>
            {renderedVideoUrl && (
              <button
                onClick={() => setPreviewMode('rendered')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
                  previewMode === 'rendered'
                    ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/50 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Phát file video MP4 đã được render thực tế từ FFmpeg"
              >
                <Film className="w-3.5 h-3.5 text-emerald-400" />
                
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoFitWidth(!autoFitWidth)}
            className={`px-2 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition-all ${
              autoFitWidth
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Tự động co giãn viền che theo độ dài câu thoại"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Co Giãn</span>
          </button>

          {onAutoDetectRoi && (
            <button
              onClick={onAutoDetectRoi}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5 transition-all"
              title="Tự động bắt dính phụ đề gốc (Auto-snap ROI)"
            >
              <Target className="w-3.5 h-3.5 text-amber-300" />
              <span>Bắt Dính</span>
            </button>
          )}

          <button
            onClick={onToggleRoi || (() => setShowRoiBox(!showRoiBox))}
            className={`px-2 py-1 rounded-lg text-[11px] font-mono border transition-colors flex items-center gap-1.5 ${
              isRoiVisible
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Bật/Tắt khung căn chỉnh ROI"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Video Viewport Container */}
      <div className="relative w-full flex items-center justify-center bg-black select-none max-h-[calc(100vh-330px)] min-h-[240px]">
        {activeVideoSource ? (
          <div className="relative aspect-video max-w-full max-h-[calc(100vh-330px)] w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              src={activeVideoSource}
              preload="metadata"
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = currentTime;
                  setVideoDuration(videoRef.current.duration || 0);
                }
              }}
              onTimeUpdate={(e) => {
                if (!isScrubbing) {
                  const now = performance.now();
                  if (now - lastUpdateRef.current >= 80) {
                    lastUpdateRef.current = now;
                    onTimeUpdate(e.currentTarget.currentTime);
                  }
                }
              }}
              className="w-full h-full object-contain"
            />

            {/* ROI Box */}
            {isRoiVisible && previewMode !== 'rendered' && (
              <div
                style={{
                  left: dynamicBox.left,
                  top: dynamicBox.top,
                  width: dynamicBox.width,
                  height: dynamicBox.height,
                }}
                className="absolute border-2 border-dashed border-indigo-500/70 bg-indigo-500/5 pointer-events-none rounded transition-all duration-150 flex flex-col justify-between p-1 z-10"
              >
                <span className="text-[9px] font-mono bg-indigo-900/80 text-indigo-200 px-1 rounded w-fit uppercase font-semibold">
                  ROI: {dynamicBox.left}, {dynamicBox.top} (W: {dynamicBox.width})
                </span>
                <span className="text-[9px] font-mono text-indigo-300/60 self-end">
                  {autoFitWidth && activeCue ? 'Tự co giãn theo chữ' : 'Vùng nhận diện & che'}
                </span>
              </div>
            )}

            {/* Subtitle Overlay & Live Blur Mask */}
            {previewMode === 'mask_replace' && activeCue && (
              <div
                style={{
                  left: dynamicBox.left,
                  top: dynamicBox.top,
                  width: dynamicBox.width,
                  height: dynamicBox.height,
                }}
                className="absolute backdrop-blur-lg bg-black/95 rounded flex items-center justify-center px-2 py-0.5 z-20 pointer-events-none shadow-2xl transition-all duration-150 border border-zinc-800/80"
              >
                <p className={`text-amber-300 font-extrabold text-center leading-snug drop-shadow-[0_2px_4px_rgba(0,0,0,1)] select-none whitespace-pre-line px-1.5 tracking-wide ${
                  (activeCue.translated_text || '').length > 40
                    ? 'text-xs sm:text-sm md:text-base'
                    : (activeCue.translated_text || '').length > 22
                      ? 'text-sm sm:text-base md:text-lg'
                      : 'text-base sm:text-lg md:text-xl'
                }`}>
                  {activeCue.translated_text || activeCue.source_text}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-zinc-600 text-xs font-mono flex flex-col items-center gap-2 p-12">
            <Film className="w-8 h-8 text-zinc-700" />
            <span>Chưa nạp video</span>
          </div>
        )}
      </div>

      {/* Scrubber Progress Bar (CapCut-style thin progress bar above transport) */}
      <div
        ref={scrubberRef}
        onMouseDown={handleScrubberMouseDown}
        className="h-2.5 bg-zinc-900 cursor-pointer relative group border-t border-zinc-800/50"
        title="Kéo để tua video"
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-zinc-800/80" />
        {/* Progress fill */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-indigo-500 transition-[width] duration-75"
          style={{ width: `${scrubberProgress}%` }}
        />
        {/* Scrubber thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-400 border-2 border-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${scrubberProgress}%`, transform: `translate(-50%, -50%)` }}
        />
      </div>

      {/* Playback Transport Bar */}
      <div className="h-12 bg-zinc-900 border-t border-zinc-800 px-4 flex items-center justify-between text-xs">
        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlay}
            className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-600/30 transition-colors"
            title={isPlaying ? 'Tạm dừng (Phím Space)' : 'Phát (Phím Space)'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            onClick={() => onTimeUpdate(Math.max(0, currentTime - 1.0))}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700/50 flex items-center gap-1"
            title="Lùi 1 giây"
          >
            <Rewind className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px]">-1s</span>
          </button>

          <button
            onClick={() => onTimeUpdate(currentTime + 1.0)}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700/50 flex items-center gap-1"
            title="Tới 1 giây"
          >
            <FastForward className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px]">+1s</span>
          </button>

          {activeCue && (
            <button
              onClick={replayCurrentCue}
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 hover:text-amber-200 transition-colors border border-zinc-700/50 flex items-center gap-1 text-[10px]"
              title="Phát lại câu phụ đề đang chọn"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Phát lại</span>
            </button>
          )}

          {/* Speed Selector */}
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-zinc-300 text-[10px] font-mono focus:outline-none focus:border-indigo-500"
            title="Tốc độ phát"
          >
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1.0">1.0x Chuẩn</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
          </select>
        </div>

        
          <button
            onClick={onToggleRoi}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700/50 flex items-center gap-1"
            title="Bật/Tắt khung ROI"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>

          {/* Right: Volume, Fullscreen, Timecode */}
        <div className="flex items-center gap-3">
          {/* Volume Control */}
          <div className="flex items-center gap-1.5 group/vol">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
              title={isMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
            >
              {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setVolume(val);
                if (val > 0) setIsMuted(false);
              }}
              className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              title="Âm lượng"
            />
          </div>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700/50"
            title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>

          {/* Timecode & Cue Badge */}
          {activeCue && (
            <span className="hidden sm:inline-block text-[11px] text-zinc-400 font-mono truncate max-w-[180px]">
              Câu: <span className="text-amber-300 font-semibold">#{activeCue.cue_id}</span>
            </span>
          )}
          <div className="font-mono text-zinc-300 bg-zinc-950 px-3 py-1 rounded-md border border-zinc-800 text-[11px]">
            PTS: <span className="text-indigo-400 font-bold">{formatTimecode(currentTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
