import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Trash2,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Volume1,
  Volume2,
  VolumeX,
  Clock,
  ChevronDown,
  ChevronUp,
  Mic,
  Loader2,
  Square,
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
  selectedCueIds?: string[];
  onSelectCue?: (cue: SubtitleCueV1) => void;
  onSelectCues?: (cueIds: string[], anchorCueId?: string) => void;
  onBeginCueDrag?: () => void;
  onUpdateCueTime?: (cueId: string, startPts: number, endPts: number, isLiveOnly?: boolean) => void;
  onUpdateMultipleCuesTime?: (updates: { cueId: string; startPts: number; endPts: number }[], isLiveOnly?: boolean) => void;
  onSplitCue?: (time: number) => void;
  onDeleteCue?: (cueId: string) => void;
  onDeleteCues?: (cueIds: string[]) => void;
  hasVoiceover?: boolean;
  voiceoverVolume?: number;
  onVoiceoverVolumeChange?: (vol: number) => void;
  originalAudioVolume?: number;
  onOriginalAudioVolumeChange?: (vol: number) => void;
  isAudioMuted?: boolean;
  onToggleAudioMute?: () => void;
  isVideoVisible?: boolean;
  onToggleVideoVisible?: () => void;
  isSubVisible?: boolean;
  onToggleSubVisible?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  isScanning?: boolean;
  statusMessage?: string | null;
  onStopScan?: () => void;
  isTranslating?: boolean;
  isDubbing?: boolean;
  height?: number;
}

/**
 * Chuyển đổi % âm lượng sang tỉ lệ gain âm thanh thực tế (0.0 -> 1.0).
 * Sử dụng tỉ lệ tuyến tính trực tiếp để đồng bộ 1:1 với trình phát video và các NLE chuẩn,
 * giúp người dùng tăng/giảm âm lượng một cách chính xác, tự nhiên, không bị sụt âm đột ngột.
 */
export const toAudioGain = (volumePercent: number): number => {
  if (volumePercent <= 0) return 0;
  if (volumePercent >= 100) return 1;
  return Math.min(1, Math.max(0, volumePercent / 100));
};

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
  selectedCueIds,
  onSelectCue,
  onSelectCues,
  onBeginCueDrag,
  onUpdateCueTime,
  onUpdateMultipleCuesTime,
  onSplitCue: _onSplitCue,
  onDeleteCue,
  onDeleteCues,
  hasVoiceover = false,
  voiceoverVolume: externalVoiceoverVolume,
  onVoiceoverVolumeChange,
  originalAudioVolume: externalOriginalVolume,
  onOriginalAudioVolumeChange,
  isAudioMuted: externalAudioMuted,
  onToggleAudioMute,
  isVideoVisible: externalVideoVisible,
  onToggleVideoVisible,
  isSubVisible: externalSubVisible,
  onToggleSubVisible,
  onZoomIn,
  onZoomOut,
  isScanning = false,
  statusMessage,
  onStopScan,
  isTranslating = false,
  isDubbing = false,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const trackCanvasRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<{ time: number; dataUrl: string }[]>([]);
  const [, setIsGeneratingThumbs] = useState<boolean>(false);

  // Trạng thái đồng bộ thanh cuộn đáy Timeline chuẩn CapCut
  const [scrollMetrics, setScrollMetrics] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });
  const [isDraggingThumb, setIsDraggingThumb] = useState<boolean>(false);
  const thumbDragRef = useRef<{
    startX: number;
    startScrollLeft: number;
    trackWidth: number;
    thumbWidth: number;
    maxScroll: number;
  } | null>(null);

  // Trạng thái Khóa / Ẩn / Tắt tiếng từng Track NLE
  const [isSubLocked, setIsSubLocked] = useState<boolean>(false);
  const [internalSubVisible, setInternalSubVisible] = useState<boolean>(true);
  const isSubVisible = externalSubVisible !== undefined ? externalSubVisible : internalSubVisible;

  const [isVideoLocked, setIsVideoLocked] = useState<boolean>(false);
  const [internalVideoVisible, setInternalVideoVisible] = useState<boolean>(true);
  const isVideoVisible = externalVideoVisible !== undefined ? externalVideoVisible : internalVideoVisible;

  const [isVoiceoverLocked, setIsVoiceoverLocked] = useState<boolean>(false);
  const [isVoiceoverMuted, setIsVoiceoverMuted] = useState<boolean>(false);
  const [internalVoiceoverVolume, setInternalVoiceoverVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('studio_voiceover_volume');
      return saved !== null ? Math.max(0, Math.min(100, parseInt(saved, 10))) : 100;
    } catch {
      return 100;
    }
  });
  const voiceoverVolume = externalVoiceoverVolume !== undefined ? externalVoiceoverVolume : internalVoiceoverVolume;
  const setVoiceoverVolume = onVoiceoverVolumeChange || setInternalVoiceoverVolume;

  const handleVoiceoverVolumeChange = (newVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newVol)));
    setVoiceoverVolume(clamped);
    try {
      localStorage.setItem('studio_voiceover_volume', String(clamped));
    } catch {}
  };

  const [isAudioLocked, setIsAudioLocked] = useState<boolean>(false);
  const [internalAudioMuted, setInternalAudioMuted] = useState<boolean>(false);
  const isAudioMuted = externalAudioMuted !== undefined ? externalAudioMuted : internalAudioMuted;
  const [internalOriginalVolume, setInternalOriginalVolume] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('studio_original_audio_volume');
      return saved !== null ? Math.max(0, Math.min(100, parseInt(saved, 10))) : 100;
    } catch {
      return 100;
    }
  });
  const originalAudioVolume = externalOriginalVolume !== undefined ? externalOriginalVolume : internalOriginalVolume;
  const setOriginalAudioVolume = onOriginalAudioVolumeChange || setInternalOriginalVolume;

  const handleOriginalAudioVolumeChange = (newVol: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(newVol)));
    setOriginalAudioVolume(clamped);
    try {
      localStorage.setItem('studio_original_audio_volume', String(clamped));
    } catch {}
  };

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // Tính toán chia tầng (Multi-layer dubbing lanes) cho Track Lồng Tiếng A1 khi có các câu thoại nói đè lên nhau
  const voiceoverLanesData = useMemo(() => {
    if (!cues || cues.length === 0) return { cuesWithLanes: [], maxLanes: 1 };
    const sorted = [...cues].sort((a, b) => a.start_pts - b.start_pts);
    const lanesEndPts: number[] = [];
    const cuesWithLanes = sorted.map((cue) => {
      let lane = 0;
      while (lane < lanesEndPts.length && lanesEndPts[lane] > cue.start_pts + 0.05) {
        lane++;
      }
      lanesEndPts[lane] = cue.end_pts;
      return { cue, lane };
    });
    const maxLanes = Math.max(1, lanesEndPts.length);
    return { cuesWithLanes, maxLanes };
  }, [cues]);

  // Kiểm tra chính xác xem mốc thời gian có nằm trong câu phụ đề nào hiện hữu hay không
  // Khi người dùng xóa câu phụ đề trên giao diện, khoảng thời gian đó lập tức bị ngắt âm
  const checkTimeInCues = useCallback((t: number) => {
    if (!cues || cues.length === 0) return false;
    return cues.some((c) => t >= Math.max(0, c.start_pts - 0.04) && t <= (c.end_pts + 0.08));
  }, [cues]);

  // Đồng bộ âm thanh Lồng tiếng Track A1 với Playhead (Phát / Tạm dừng)
  useEffect(() => {
    const audio = voiceAudioRef.current;
    if (!audio) return;

    if (!hasVoiceover || cues.length === 0) {
      audio.muted = true;
      audio.volume = 0;
      audio.pause();
      return;
    }

    if (isPlaying && !isVoiceoverMuted) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [isPlaying, hasVoiceover, isVoiceoverMuted, cues.length]);

  // Đồng bộ vị trí Seek tức thời với Playhead
  useEffect(() => {
    const audio = voiceAudioRef.current;
    if (!audio || !hasVoiceover || cues.length === 0) return;
    try {
      if (audio.readyState >= 1 && Math.abs(audio.currentTime - currentTime) > 0.08) {
        audio.currentTime = currentTime;
      }
      const inCue = checkTimeInCues(currentTime);
      const shouldMute = isVoiceoverMuted || !inCue;
      audio.muted = shouldMute;
      audio.volume = shouldMute ? 0 : toAudioGain(voiceoverVolume);
    } catch {}
  }, [currentTime, hasVoiceover, cues.length, isVoiceoverMuted, voiceoverVolume, checkTimeInCues]);

  // Bộ giám sát âm thanh từng frame (Frame-Accurate Zero-Leak Audio Sentry)
  // Đảm bảo tuyệt đối: Bất kỳ câu phụ đề nào bị xóa trên giao diện sẽ bị ngắt âm ngay lập tức
  useEffect(() => {
    const audio = voiceAudioRef.current;
    if (!audio) return;

    if (!hasVoiceover || cues.length === 0 || isVoiceoverMuted) {
      audio.muted = true;
      audio.volume = 0;
      if (!audio.paused) audio.pause();
      return;
    }

    let animId: number;
    const checkAudioFrame = () => {
      if (audio && !audio.paused) {
        const t = audio.currentTime;
        const inCue = checkTimeInCues(t);
        const targetMuted = !inCue || isVoiceoverMuted;
        if (audio.muted !== targetMuted) {
          audio.muted = targetMuted;
        }
        const targetVol = targetMuted ? 0 : toAudioGain(voiceoverVolume);
        if (audio.volume !== targetVol) {
          audio.volume = targetVol;
        }
        // Giữ audio bám sát theo Playhead
        if (Math.abs(t - currentTime) > 0.08) {
          try {
            audio.currentTime = currentTime;
          } catch {}
        }
      }
      animId = requestAnimationFrame(checkAudioFrame);
    };

    animId = requestAnimationFrame(checkAudioFrame);
    return () => cancelAnimationFrame(animId);
  }, [hasVoiceover, cues, isVoiceoverMuted, voiceoverVolume, currentTime, checkTimeInCues]);

  // Giải phóng âm thanh khi unmount
  useEffect(() => {
    return () => {
      if (voiceAudioRef.current) {
        voiceAudioRef.current.pause();
      }
    };
  }, []);

  // Danh sách các câu đang được chọn (Hỗ trợ chọn lẻ + chọn nhiều theo dải hoặc khung quét Marquee)
  const effectiveSelectedCueIds = useMemo(() => {
    if (selectedCueIds && selectedCueIds.length > 0) return selectedCueIds;
    if (selectedCueId) return [selectedCueId];
    return [];
  }, [selectedCueIds, selectedCueId]);

  const anchorCueIdRef = useRef<string | null>(null);

  // Trạng thái khung kéo chuột chọn nhiều (Marquee / Rubber-band Box Selection như CapCut)
  const [marqueeState, setMarqueeState] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    isDragging: boolean;
    initialSelectedIds: string[];
  } | null>(null);

  // Trạng thái kéo co giãn hoặc di chuyển hàng loạt câu phụ đề (Trim & Batch Move)
  const [trimmingState, setTrimmingState] = useState<{
    cueId: string;
    handle: 'start' | 'end' | 'move';
    initialMouseX: number;
    initialStart: number;
    initialEnd: number;
    batchCues?: { cueId: string; initialStart: number; initialEnd: number }[];
  } | null>(null);

  const batchUpdatesRef = useRef<{ cueId: string; startPts: number; endPts: number }[]>([]);

  const totalDuration = useMemo(() => {
    if (duration > 0) return duration;
    if (cues && cues.length > 0) {
      const maxEnd = Math.max(...cues.map((c) => c.end_pts));
      if (maxEnd > 0) return Math.max(1.0, maxEnd + 1.0);
    }
    return 10.0;
  }, [duration, cues]);

  // Xác định câu phụ đề đang phát tại currentTime
  const activeCue = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    return cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts) || null;
  }, [cues, currentTime]);

  const activeCueId = selectedCueId || (effectiveSelectedCueIds.length > 0 ? effectiveSelectedCueIds[0] : null) || activeCue?.cue_id || null;

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

  // Tự động trích xuất chuỗi khung hình Thumbnail (Filmstrip) bằng Canvas chuẩn tỉ lệ (Aspect-Ratio Aware)
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
      offscreenVideo.playsInline = true;

      try {
        await new Promise<void>((resolve, reject) => {
          if (offscreenVideo.readyState >= 1 && offscreenVideo.videoWidth > 0) {
            resolve();
            return;
          }
          offscreenVideo.onloadedmetadata = () => resolve();
          offscreenVideo.onerror = () => reject();
        });

        // Tính toán kích thước canvas chuẩn xác theo tỉ lệ thực tế của video (ngăn ngừa vỡ hình/méo mặt 9:16 vs 16:9)
        const videoWidth = offscreenVideo.videoWidth || 1920;
        const videoHeight = offscreenVideo.videoHeight || 1080;
        const videoAspect = videoWidth / videoHeight;

        // Chiều cao chuẩn 64px, chiều rộng tự động nội suy chuẩn aspect ratio
        const renderHeight = 64;
        const renderWidth = Math.max(32, Math.round(renderHeight * videoAspect));

        const canvas = document.createElement('canvas');
        canvas.width = renderWidth;
        canvas.height = renderHeight;
        const ctx = canvas.getContext('2d');

        const thumbCount = Math.min(28, Math.max(12, Math.floor(duration / 2.5)));
        const step = duration / thumbCount;
        const result: { time: number; dataUrl: string }[] = [];
        let lastValidDataUrl = '';

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

            // Timeout an toàn 1200ms để chờ video giải mã frame
            timer = setTimeout(() => {
              cleanup();
              // Nếu seek chậm, tái sử dụng frame trước đó để đảm bảo không bị khuyết ô hay nhảy layout
              if (lastValidDataUrl) {
                result.push({
                  time: targetTime,
                  dataUrl: lastValidDataUrl,
                });
              }
              resolve();
            }, 1200);

            offscreenVideo.onseeked = () => {
              cleanup();
              if (ctx) {
                try {
                  ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
                  const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                  lastValidDataUrl = dataUrl;
                  result.push({
                    time: targetTime,
                    dataUrl,
                  });
                } catch {}
              }
              resolve();
            };

            offscreenVideo.onerror = () => {
              cleanup();
              if (lastValidDataUrl) {
                result.push({
                  time: targetTime,
                  dataUrl: lastValidDataUrl,
                });
              }
              resolve();
            };

            offscreenVideo.currentTime = targetTime;
          });
        }

        if (!isCancelled && result.length > 0) {
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
    e.stopPropagation();
    if (isPlaying) {
      onTogglePlay();
    }
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

  // Đồng bộ thông số kích thước cuộn giữa Timeline và thanh trượt đáy
  const syncScrollMetrics = useCallback(() => {
    if (trackAreaRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = trackAreaRef.current;
      setScrollMetrics((prev) => {
        if (
          prev.scrollLeft === scrollLeft &&
          prev.scrollWidth === scrollWidth &&
          prev.clientWidth === clientWidth
        ) {
          return prev;
        }
        return { scrollLeft, scrollWidth, clientWidth };
      });
    }
  }, []);

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
      syncScrollMetrics();
    }
  }, [currentTime, isPlaying, zoomLevel, totalDuration, isScrubbing, syncScrollMetrics]);

  // Cập nhật thông số cuộn khi đổi mức zoom, thời lượng hoặc kích thước khung nhìn
  useEffect(() => {
    syncScrollMetrics();
  }, [zoomLevel, totalDuration, syncScrollMetrics]);

  useEffect(() => {
    const el = trackAreaRef.current;
    if (!el) return;
    syncScrollMetrics();

    const ro = new ResizeObserver(() => {
      syncScrollMetrics();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncScrollMetrics, isCollapsed]);

  // Hàm áp dụng thu phóng mượt mà neo theo Playhead Vàng (Yellow Playhead-anchored Zoom)
  // Loại bỏ hoàn toàn hiện tượng giật rung hình bằng cách cập nhật DOM canvas width và scrollLeft đồng thời
  const applyZoom = useCallback(
    (targetZoom: number) => {
      const container = trackAreaRef.current;
      if (!container || totalDuration <= 0) return;

      const nextZoom = Math.max(1.0, Math.min(5.0, parseFloat(targetZoom.toFixed(2))));
      const prevZoom = zoomLevel;
      if (Math.abs(nextZoom - prevZoom) < 0.001) return;

      const clientWidth = container.clientWidth;
      const currentScrollLeft = container.scrollLeft;
      const currentScrollWidth = container.scrollWidth || (clientWidth * prevZoom);

      // Điểm vàng (Yellow Playhead): Tỷ lệ thời gian tại currentTime
      const playheadRatio = Math.max(0, Math.min(1, currentTime / totalDuration));
      const currentPlayheadPixel = playheadRatio * currentScrollWidth;
      const playheadViewportX = currentPlayheadPixel - currentScrollLeft;

      let targetScrollLeft = 0;
      if (nextZoom <= 1.0) {
        // "Out tổng dần": Khi zoom về 1.0x, cuộn về 0 để hiển thị trọn vẹn toàn bộ Timeline
        targetScrollLeft = 0;
      } else {
        const newScrollWidth = clientWidth * nextZoom;
        const maxScroll = Math.max(0, newScrollWidth - clientWidth);
        const newPlayheadPixel = playheadRatio * newScrollWidth;

        if (playheadViewportX >= 0 && playheadViewportX <= clientWidth) {
          // Điểm vàng đang nằm trong khung nhìn: Giữ nguyên vị trí pixel của điểm vàng trên màn hình
          const desiredScrollLeft = newPlayheadPixel - playheadViewportX;
          targetScrollLeft = Math.max(0, Math.min(maxScroll, desiredScrollLeft));
        } else {
          // Điểm vàng đang nằm ngoài khung nhìn: Căn điểm vàng vào ngay chính giữa khung nhìn
          const desiredScrollLeft = newPlayheadPixel - clientWidth / 2;
          targetScrollLeft = Math.max(0, Math.min(maxScroll, desiredScrollLeft));
        }
      }

      // TRIỆT TIÊU HOÀN TOÀN HIỆN TƯỢNG GIẬT: Cập nhật DOM trực tiếp và đồng thời trong cùng frame trước paint
      if (trackCanvasRef.current) {
        trackCanvasRef.current.style.width = `${Math.max(100, 100 * nextZoom)}%`;
      }
      container.scrollLeft = targetScrollLeft;

      setZoomLevel(nextZoom);
      syncScrollMetrics();
    },
    [totalDuration, zoomLevel, currentTime, syncScrollMetrics]
  );

  // Lăn chuột: Giữ Alt (hoặc lăn chuột thường) cuộn trái/phải • Giữ Ctrl zoom neo vào kim vàng Playhead
  const handleTimelineWheel = useCallback(
    (e: React.WheelEvent | WheelEvent) => {
      const isZoomModifier = e.ctrlKey || e.metaKey;
      const isAltPan = e.altKey; // Giữ Alt để cuộn ngang trái/phải chuẩn CapCut

      if (isZoomModifier) {
        // GIỮ CTRL: Zoom neo chính xác vào điểm vàng Playhead ("zoom vào điểm vàng") hoặc thu nhỏ tổng quan ("out tổng dần")
        if (Math.abs(e.deltaY) > 0) {
          if (e.cancelable) e.preventDefault();
          const delta = e.deltaY < 0 ? 0.2 : -0.2;
          applyZoom(zoomLevel + delta);
        }
      } else {
        // GIỮ ALT HOẶC LĂN CHUỘT THƯỜNG: Cuộn ngang Timeline sang trái / sang phải
        if (!trackAreaRef.current) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const speed = isAltPan ? 1.2 : 1.0;
        if (Math.abs(delta) > 0) {
          if (e.cancelable) e.preventDefault();
          trackAreaRef.current.scrollLeft += delta * speed;
          syncScrollMetrics();
        }
      }
    },
    [zoomLevel, applyZoom, syncScrollMetrics]
  );

  // Lắng nghe sự kiện wheel duy nhất với { passive: false } trên container để ngăn trang cuộn dọc và tránh kích hoạt đúp
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;

    const onNativeWheel = (e: WheelEvent) => {
      // Bỏ qua nếu thao tác trên input slider âm lượng / zoom để giữ nguyên hành vi chỉnh range
      if ((e.target as HTMLElement)?.closest('input[type="range"]')) return;
      handleTimelineWheel(e);
    };

    containerEl.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      containerEl.removeEventListener('wheel', onNativeWheel);
    };
  }, [handleTimelineWheel]);

  // Tính toán kích thước và vị trí con trượt thanh cuộn đáy
  const { scrollLeft, scrollWidth, clientWidth } = scrollMetrics;
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const viewportRatio = scrollWidth > 0 ? Math.min(1, clientWidth / scrollWidth) : 1;
  const thumbWidthPct = maxScroll > 0 ? Math.max(4, Math.min(100, viewportRatio * 100)) : 100;
  const scrollProgress = maxScroll > 0 ? Math.max(0, Math.min(1, scrollLeft / maxScroll)) : 0;
  const thumbLeftPct = scrollProgress * (100 - thumbWidthPct);

  // Bắt đầu kéo con trượt đáy Timeline (Drag Scrollbar Thumb)
  const handleThumbMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!trackAreaRef.current || !scrollbarTrackRef.current) return;

      const trackRect = scrollbarTrackRef.current.getBoundingClientRect();
      const trackWidth = trackRect.width;
      const thumbWidthPx = Math.max(36, (trackWidth * thumbWidthPct) / 100);
      const currentMaxScroll = trackAreaRef.current.scrollWidth - trackAreaRef.current.clientWidth;

      thumbDragRef.current = {
        startX: e.clientX,
        startScrollLeft: trackAreaRef.current.scrollLeft,
        trackWidth,
        thumbWidth: thumbWidthPx,
        maxScroll: Math.max(0, currentMaxScroll),
      };
      setIsDraggingThumb(true);
    },
    [thumbWidthPct]
  );

  // Xử lý nhấp chuột trực tiếp lên rãnh trượt để nhảy vị trí (Click-to-jump)
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackAreaRef.current || !scrollbarTrackRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-testid="timeline-scrollbar-thumb"]')) {
        return;
      }

      const trackRect = scrollbarTrackRef.current.getBoundingClientRect();
      const clickX = e.clientX - trackRect.left;
      const trackWidth = trackRect.width;
      const thumbWidthPx = Math.max(36, (trackWidth * thumbWidthPct) / 100);
      const availableTravel = trackWidth - thumbWidthPx;
      const currentMaxScroll = trackAreaRef.current.scrollWidth - trackAreaRef.current.clientWidth;

      if (availableTravel > 0 && currentMaxScroll > 0) {
        const desiredThumbLeft = clickX - thumbWidthPx / 2;
        const clampedThumbLeft = Math.max(0, Math.min(availableTravel, desiredThumbLeft));
        const progress = clampedThumbLeft / availableTravel;
        const newScrollLeft = progress * currentMaxScroll;
        trackAreaRef.current.scrollLeft = newScrollLeft;
        syncScrollMetrics();
      }
    },
    [thumbWidthPct, syncScrollMetrics]
  );

  // Lắng nghe di chuột toàn trang khi đang kéo con trượt
  useEffect(() => {
    if (!isDraggingThumb) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!thumbDragRef.current || !trackAreaRef.current) return;
      const { startX, startScrollLeft, trackWidth, thumbWidth, maxScroll } = thumbDragRef.current;
      const availableTravel = trackWidth - thumbWidth;
      if (availableTravel <= 0 || maxScroll <= 0) return;

      const deltaX = e.clientX - startX;
      const deltaScroll = (deltaX / availableTravel) * maxScroll;
      const newScrollLeft = Math.max(0, Math.min(maxScroll, startScrollLeft + deltaScroll));
      trackAreaRef.current.scrollLeft = newScrollLeft;
      syncScrollMetrics();
    };

    const handleMouseUp = () => {
      setIsDraggingThumb(false);
      thumbDragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingThumb, syncScrollMetrics]);

  // Xử lý click chọn câu phụ đề (Hỗ trợ: Click lẻ đơn, Ctrl/Cmd+Click toggle lẻ, Shift+Click chọn dải)
  const handleCueClick = useCallback(
    (e: React.MouseEvent, cue: SubtitleCueV1) => {
      e.stopPropagation();

      if (e.ctrlKey || e.metaKey) {
        // "Chọn lẻ": toggle câu này trong danh sách chọn mà không mất các câu khác
        const isSelected = effectiveSelectedCueIds.includes(cue.cue_id);
        let nextIds: string[];
        if (isSelected) {
          nextIds = effectiveSelectedCueIds.filter((id: string) => id !== cue.cue_id);
        } else {
          nextIds = [...effectiveSelectedCueIds, cue.cue_id];
        }
        anchorCueIdRef.current = cue.cue_id;
        onSelectCues?.(nextIds, cue.cue_id);
        if (!isSelected) {
          onSelectCue?.(cue);
        }
      } else if (e.shiftKey) {
        // "Chọn dải": Chọn liên tiếp từ câu anchor đến câu hiện tại
        const anchorId = anchorCueIdRef.current || effectiveSelectedCueIds[0];
        if (anchorId) {
          const anchorIdx = cues.findIndex((c) => c.cue_id === anchorId);
          const targetIdx = cues.findIndex((c) => c.cue_id === cue.cue_id);
          if (anchorIdx !== -1 && targetIdx !== -1) {
            const startIdx = Math.min(anchorIdx, targetIdx);
            const endIdx = Math.max(anchorIdx, targetIdx);
            const rangeIds = cues.slice(startIdx, endIdx + 1).map((c) => c.cue_id);
            const nextIds = Array.from(new Set([...effectiveSelectedCueIds, ...rangeIds]));
            onSelectCues?.(nextIds, cue.cue_id);
            return;
          }
        }
        anchorCueIdRef.current = cue.cue_id;
        onSelectCues?.([cue.cue_id], cue.cue_id);
        onSelectCue?.(cue);
      } else {
        // Chọn đơn lẻ thông thường
        anchorCueIdRef.current = cue.cue_id;
        onSelectCues?.([cue.cue_id], cue.cue_id);
        onSelectCue?.(cue);
      }
    },
    [effectiveSelectedCueIds, cues, onSelectCues, onSelectCue]
  );

  // Bắt đầu kéo chuột chọn nhiều câu phụ đề (Marquee Selection Box chuẩn CapCut)
  const handleTrackCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest('[data-testid="timeline-ruler"]') ||
          target.closest('[data-testid="timeline-cue-block"]') ||
          target.closest('button') ||
          target.closest('input'))
      ) {
        return;
      }
      if (!trackAreaRef.current) return;

      const rect = trackAreaRef.current.getBoundingClientRect();
      const scrollLeft = trackAreaRef.current.scrollLeft || 0;
      const scrollTop = trackAreaRef.current.scrollTop || 0;

      const canvasX = e.clientX - rect.left + scrollLeft;
      const canvasY = e.clientY - rect.top + scrollTop;

      const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
      const initialSelected = isMulti ? [...effectiveSelectedCueIds] : [];

      setMarqueeState({
        startX: canvasX,
        startY: canvasY,
        currentX: canvasX,
        currentY: canvasY,
        isDragging: false,
        initialSelectedIds: initialSelected,
      });
    },
    [effectiveSelectedCueIds]
  );

  // Hiệu ứng rê chuột quét hộp chọn nhiều (Marquee Dragging Effect)
  useEffect(() => {
    if (!marqueeState || !trackAreaRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const scrollLeft = trackAreaRef.current.scrollLeft || 0;
      const scrollTop = trackAreaRef.current.scrollTop || 0;

      const currentCanvasX = e.clientX - rect.left + scrollLeft;
      const currentCanvasY = e.clientY - rect.top + scrollTop;

      const dx = currentCanvasX - marqueeState.startX;
      const dy = currentCanvasY - marqueeState.startY;
      const dist = Math.hypot(dx, dy);

      const isDragging = marqueeState.isDragging || dist >= 5;

      // Tự động cuộn timeline khi rê chuột sát 2 biên
      const edgeMargin = 35;
      if (e.clientX > rect.right - edgeMargin) {
        trackAreaRef.current.scrollLeft += 15;
      } else if (e.clientX < rect.left + edgeMargin) {
        trackAreaRef.current.scrollLeft -= 15;
      }

      const boxLeft = Math.min(marqueeState.startX, currentCanvasX);
      const boxRight = Math.max(marqueeState.startX, currentCanvasX);
      const boxBottom = Math.max(marqueeState.startY, currentCanvasY);

      const totalWidth = trackAreaRef.current.scrollWidth || (rect.width * Math.max(1, zoomLevel));
      const boxStartPts = (boxLeft / totalWidth) * totalDuration;
      const boxEndPts = (boxRight / totalWidth) * totalDuration;

      // Quét chọn phụ đề theo vùng thời gian [boxStartPts, boxEndPts] khi kéo trên khu vực track
      const touchesSubTrack = boxBottom >= 0 || marqueeState.startY >= 0;

      let enclosedCueIds: string[] = [];
      if (touchesSubTrack && isDragging) {
        enclosedCueIds = cues
          .filter((c) => Math.max(c.start_pts, boxStartPts) <= Math.min(c.end_pts, boxEndPts))
          .map((c) => c.cue_id);
      }

      const nextSelected = Array.from(new Set([...marqueeState.initialSelectedIds, ...enclosedCueIds]));

      setMarqueeState((prev) =>
        prev
          ? {
              ...prev,
              currentX: currentCanvasX,
              currentY: currentCanvasY,
              isDragging,
            }
          : null
      );

      if (isDragging && onSelectCues) {
        onSelectCues(nextSelected);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!marqueeState) return;

      if (!marqueeState.isDragging) {
        // Click vào vùng trống không kéo: Bỏ chọn & nhảy kim Playhead
        const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
        if (!isMulti) {
          onSelectCues?.([]);
          if (trackAreaRef.current && totalDuration > 0) {
            const rect = trackAreaRef.current.getBoundingClientRect();
            const scrollLeft = trackAreaRef.current.scrollLeft || 0;
            const totalWidth = trackAreaRef.current.scrollWidth || (rect.width * Math.max(1, zoomLevel));
            const clickX = e.clientX - rect.left + scrollLeft;
            const pct = Math.max(0, Math.min(1, clickX / totalWidth));
            onSeek(parseFloat((pct * totalDuration).toFixed(3)));
          }
        }
      }

      setMarqueeState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [marqueeState, cues, totalDuration, zoomLevel, onSelectCues, onSeek]);

  const dragCoordsRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Xử lý kéo mép co giãn Timecode hoặc di chuyển nhóm câu phụ đề (Trim & Batch Move)
  const handleMouseDownTrim = (
    e: React.MouseEvent,
    cue: SubtitleCueV1,
    handle: 'start' | 'end' | 'move'
  ) => {
    if (isSubLocked) return;
    e.stopPropagation();
    e.preventDefault();
    if (isPlaying) {
      onTogglePlay();
    }
    onBeginCueDrag?.();
    dragCoordsRef.current = { start: cue.start_pts, end: cue.end_pts };

    const isSelected = effectiveSelectedCueIds.includes(cue.cue_id);
    let batchCues: { cueId: string; initialStart: number; initialEnd: number }[] | undefined = undefined;

    if (handle === 'move') {
      if (isSelected && effectiveSelectedCueIds.length > 1) {
        // Di chuyển đồng loạt cả nhóm câu đang chọn
        const selectedList = cues.filter((c) => effectiveSelectedCueIds.includes(c.cue_id));
        batchCues = selectedList.map((c) => ({
          cueId: c.cue_id,
          initialStart: c.start_pts,
          initialEnd: c.end_pts,
        }));
        batchUpdatesRef.current = batchCues.map((c) => ({
          cueId: c.cueId,
          startPts: c.initialStart,
          endPts: c.initialEnd,
        }));
      } else if (!isSelected && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Bấm vào câu chưa chọn để kéo: chuyển vùng chọn sang câu này
        onSelectCues?.([cue.cue_id], cue.cue_id);
        onSelectCue?.(cue);
        anchorCueIdRef.current = cue.cue_id;
      }
    }

    setTrimmingState({
      cueId: cue.cue_id,
      handle,
      initialMouseX: e.clientX,
      initialStart: cue.start_pts,
      initialEnd: cue.end_pts,
      batchCues,
    });
  };

  useEffect(() => {
    if (!trimmingState || !trackAreaRef.current || (!onUpdateCueTime && !onUpdateMultipleCuesTime)) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!trackAreaRef.current) return;
      const rect = trackAreaRef.current.getBoundingClientRect();
      const totalWidth = trackAreaRef.current.scrollWidth || (rect.width * Math.max(1, zoomLevel));
      const deltaPixels = e.clientX - trimmingState.initialMouseX;
      const deltaSeconds = (deltaPixels / totalWidth) * totalDuration;

      if (trimmingState.batchCues && trimmingState.batchCues.length > 1) {
        // Di chuyển đồng bộ cả nhóm câu đã chọn
        const minStart = Math.min(...trimmingState.batchCues.map((c) => c.initialStart));
        const maxEnd = Math.max(...trimmingState.batchCues.map((c) => c.initialEnd));
        const clampedDelta = Math.max(-minStart, Math.min(totalDuration - maxEnd, deltaSeconds));

        const updates = trimmingState.batchCues.map((c) => ({
          cueId: c.cueId,
          startPts: parseFloat((c.initialStart + clampedDelta).toFixed(3)),
          endPts: parseFloat((c.initialEnd + clampedDelta).toFixed(3)),
        }));
        batchUpdatesRef.current = updates;

        if (onUpdateMultipleCuesTime) {
          onUpdateMultipleCuesTime(updates, true);
        } else if (onUpdateCueTime) {
          updates.forEach((u) => onUpdateCueTime(u.cueId, u.startPts, u.endPts, true));
        }
        onSeek(parseFloat((trimmingState.initialStart + clampedDelta).toFixed(3)));
        return;
      }

      // Xử lý kéo 1 câu đơn lẻ
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

      const latestStart = parseFloat(newStart.toFixed(3));
      const latestEnd = parseFloat(newEnd.toFixed(3));
      dragCoordsRef.current = { start: latestStart, end: latestEnd };

      // Cập nhật vị trí hiển thị mượt mà trên UI, không tạo điểm undo rác (isLiveOnly: true)
      onUpdateCueTime?.(trimmingState.cueId, latestStart, latestEnd, true);
      // Di chuyển playhead và cập nhật khung hình video bám sát theo vị trí câu đang kéo
      onSeek(trimmingState.handle === 'end' ? latestEnd : latestStart);
    };

    const handleMouseUp = () => {
      if (trimmingState.batchCues && trimmingState.batchCues.length > 1) {
        const finalUpdates = batchUpdatesRef.current;
        if (onUpdateMultipleCuesTime) {
          onUpdateMultipleCuesTime(finalUpdates, false);
        } else if (onUpdateCueTime) {
          finalUpdates.forEach((u) => onUpdateCueTime(u.cueId, u.startPts, u.endPts, false));
        }
        setTrimmingState(null);
        return;
      }

      const finalStart = dragCoordsRef.current.start;
      const finalEnd = dragCoordsRef.current.end;
      // Commit: Ghi nhận 1 hành động duy nhất vào lịch sử Undo và lưu máy chủ (isLiveOnly: false)
      onUpdateCueTime?.(trimmingState.cueId, finalStart, finalEnd, false);
      setTrimmingState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trimmingState, totalDuration, onUpdateCueTime, onUpdateMultipleCuesTime, onSeek, zoomLevel]);

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
      style={!isCollapsed && height ? { height: `${height}px` } : undefined}
      className={`w-full bg-slate-950 border-t border-slate-800/80 flex flex-col select-none z-20 shrink-0 ${
        isCollapsed ? 'h-10' : 'h-64 sm:h-72'
      }`}
    >
      {/* 1. THANH CÔNG CỤ TIMELINE CHUẨN CAPCUT / PREMIERE (TOP TOOLBAR) */}
      <div className="h-10 bg-slate-900/90 border-b border-slate-800 px-3 flex items-center justify-between shrink-0">
        {/* Nhóm Nút Thao Tác Câu Phụ Đề */}
        <div className="flex items-center gap-2">

          {/* Công cụ Xóa Câu (Delete Cue Tool - Hỗ trợ Xóa Đơn Lẻ & Xóa Hàng Loạt) */}
          {effectiveSelectedCueIds.length > 0 && (onDeleteCues || onDeleteCue) && (
            <button
              type="button"
              onClick={() => {
                if (onDeleteCues && effectiveSelectedCueIds.length > 0) {
                  onDeleteCues(effectiveSelectedCueIds);
                } else if (onDeleteCue && activeCueId) {
                  onDeleteCue(activeCueId);
                }
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/60 hover:bg-rose-900 text-rose-300 rounded-lg border border-rose-800/60 text-[11px] font-semibold shadow-sm transition active:scale-95 cursor-pointer"
              title={`Xóa ${effectiveSelectedCueIds.length > 1 ? `${effectiveSelectedCueIds.length} câu phụ đề` : 'câu phụ đề'} đang chọn (Delete)`}
            >
              <Trash2 className="w-3 h-3 text-rose-400" />
              <span>{effectiveSelectedCueIds.length > 1 ? `Xóa ${effectiveSelectedCueIds.length} Câu` : 'Xóa Câu'}</span>
            </button>
          )}

          {/* Huy hiệu hiển thị số lượng câu đang chọn & nút bỏ chọn nhanh */}
          {effectiveSelectedCueIds.length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-950/80 border border-indigo-700/60 text-[10px] text-indigo-300 font-mono shadow-sm">
              <span>Đã chọn: <strong className="text-white font-bold">{effectiveSelectedCueIds.length}</strong></span>
              <button
                type="button"
                onClick={() => onSelectCues?.([])}
                className="ml-0.5 text-slate-400 hover:text-white cursor-pointer px-1 rounded hover:bg-indigo-900/60 transition"
                title="Bỏ chọn toàn bộ (Escape)"
              >
                ✕
              </button>
            </div>
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

          {/* Tiến Trình Tác Vụ Thời Gian Thực Kế Dòng Thời Gian (Quét OCR % / Dịch AI / Lồng Tiếng) */}
          {(isScanning || isTranslating || isDubbing || (statusMessage && statusMessage !== 'Sẵn sàng' && statusMessage !== '')) && (
            <div
              data-testid="timeline-progress-pill"
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-950/90 border border-indigo-500/40 text-indigo-200 text-xs shadow-inner animate-in fade-in"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
              <span
                data-testid="timeline-progress-text"
                className="font-mono text-[11px] font-semibold text-indigo-200 truncate max-w-[240px] md:max-w-[420px]"
                title={statusMessage || 'Đang xử lý...'}
              >
                {statusMessage || (isScanning ? 'Đang quét phụ đề...' : isTranslating ? 'Đang dịch AI...' : 'Đang lồng tiếng...')}
              </span>
              {isScanning && onStopScan && (
                <button
                  type="button"
                  data-testid="timeline-stop-scan-button"
                  onClick={onStopScan}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-[10px] font-bold shadow transition cursor-pointer shrink-0"
                  title="Dừng hoặc Hủy tiến trình quét phụ đề ngay lập tức"
                >
                  <Square className="w-2.5 h-2.5 fill-white" />
                  <span>Dừng</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Cụm Điều Khiển Phóng To / Thu Nhỏ & Thu Gọn */}
        <div className="flex items-center gap-2.5">
          {/* Zoom Timeline Slider */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => (onZoomOut ? onZoomOut() : applyZoom(zoomLevel - 0.2))}
              className="p-1 hover:text-slate-200 cursor-pointer"
              title="Thu nhỏ Timeline"
            >
              <ZoomOut className="w-3 h-3 text-slate-400" />
            </button>
            <input
              type="range"
              min="1.0"
              max="5.0"
              step="0.2"
              value={zoomLevel}
              onChange={(e) => applyZoom(parseFloat(e.target.value))}
              className="w-16 sm:w-24 h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
              title={`Phóng to timeline: ${Math.round(zoomLevel * 100)}%`}
            />
            <button
              type="button"
              onClick={() => (onZoomIn ? onZoomIn() : applyZoom(zoomLevel + 0.2))}
              className="p-1 hover:text-slate-200 cursor-pointer"
              title="Phóng to Timeline"
            >
              <ZoomIn className="w-3 h-3 text-slate-400" />
            </button>
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
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden relative">
            {/* A. CỘT ĐẦU TRACK BÊN TRÁI (TRACK HEADERS) */}
            <div className="w-64 sm:w-72 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 z-20 select-none">
              {/* Header Thước Đo */}
              <div className="h-6 border-b border-slate-800/80 px-2.5 flex items-center justify-between text-[10px] text-slate-400 font-mono font-medium">
                <span className="tracking-wider">TRACKS</span>
                <Clock className="w-3.5 h-3.5 text-slate-500" />
              </div>

              {/* Header Track 1: Phụ Đề [T] */}
              <div className="h-14 border-b border-slate-800/70 px-2.5 flex items-center justify-between bg-slate-900/40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded bg-indigo-950 border border-indigo-700/60 text-indigo-300 font-bold text-[10px] flex items-center justify-center shrink-0 shadow-sm">
                    T
                  </span>
                  <span className="text-xs font-semibold text-slate-200 truncate">Phụ Đề</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsSubLocked(!isSubLocked)}
                    className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                    title={isSubLocked ? 'Mở khóa track phụ đề' : 'Khóa track phụ đề'}
                  >
                    {isSubLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleSubVisible ? onToggleSubVisible() : setInternalSubVisible(!internalSubVisible)}
                    className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                    title={isSubVisible ? 'Ẩn track phụ đề' : 'Hiện track phụ đề'}
                  >
                    {isSubVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                  </button>
                </div>
              </div>

              {/* Header Track 2: Video [V] */}
              <div className="h-14 border-b border-slate-800/70 px-2.5 flex items-center justify-between bg-slate-900/40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[10px] flex items-center justify-center shrink-0 shadow-sm">
                    V
                  </span>
                  <span className="text-xs font-semibold text-slate-200 truncate">Video</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsVideoLocked(!isVideoLocked)}
                    className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                    title={isVideoLocked ? 'Mở khóa track video' : 'Khóa track video'}
                  >
                    {isVideoLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleVideoVisible ? onToggleVideoVisible() : setInternalVideoVisible(!internalVideoVisible)}
                    className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                    title={isVideoVisible ? 'Ẩn video' : 'Hiện video'}
                  >
                    {isVideoVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                  </button>
                </div>
              </div>

              {/* Header Track 3: Lồng Tiếng [A1] */}
              <div
                className={`border-b border-slate-800/70 px-2.5 flex flex-col justify-center bg-slate-900/40 gap-1.5 transition-all ${
                  voiceoverLanesData.maxLanes > 1 ? 'h-16' : 'h-12 sm:h-14'
                }`}
              >
                {/* Hàng trên: Badge A1, Tên Track, Nhãn 2 tầng & Nút Khóa / Tắt tiếng */}
                <div className="flex items-center justify-between min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-5 h-5 rounded bg-amber-950 border border-amber-700/60 text-amber-300 font-bold text-[10px] flex items-center justify-center shrink-0 shadow-sm">
                      A1
                    </span>
                    <span className="text-xs font-semibold text-slate-200 truncate">Lồng Tiếng</span>
                    {voiceoverLanesData.maxLanes > 1 && (
                      <span className="px-1 py-0.2 bg-purple-950/80 border border-purple-700/60 text-[8px] text-purple-300 rounded font-mono shrink-0">
                        2 Tầng
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsVoiceoverLocked(!isVoiceoverLocked)}
                      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                      title={isVoiceoverLocked ? 'Mở khóa track lồng tiếng' : 'Khóa track lồng tiếng'}
                    >
                      {isVoiceoverLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsVoiceoverMuted(!isVoiceoverMuted)}
                      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                      title={isVoiceoverMuted ? 'Bật tiếng thuyết minh' : 'Tắt tiếng thuyết minh'}
                    >
                      {isVoiceoverMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Hàng dưới: Thanh gạt âm lượng A1 to rõ, nhạy, dễ chỉnh */}
                <div className="flex items-center gap-2" title={`Âm lượng Lồng Tiếng: ${voiceoverVolume}% (Nhấp đúp để đặt lại 100%)`}>
                  <button
                    type="button"
                    onClick={() => setIsVoiceoverMuted(!isVoiceoverMuted)}
                    className="text-amber-400/80 hover:text-amber-300 transition shrink-0 cursor-pointer"
                    title={isVoiceoverMuted ? 'Bật âm thanh thuyết minh' : 'Tắt tiếng thuyết minh'}
                  >
                    {isVoiceoverMuted || voiceoverVolume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                    ) : voiceoverVolume < 50 ? (
                      <Volume1 className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={isVoiceoverMuted ? 0 : voiceoverVolume}
                    data-testid="volume-slider-a1"
                    title={`Âm lượng Lồng Tiếng: ${voiceoverVolume}% (Nhấp đúp để đặt về 100%)`}
                    onDoubleClick={() => handleVoiceoverVolumeChange(100)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      handleVoiceoverVolumeChange(v);
                      if (v > 0 && isVoiceoverMuted) setIsVoiceoverMuted(false);
                    }}
                    className="flex-1 h-2 bg-slate-800 hover:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500 transition shadow-inner"
                  />
                  <span
                    onClick={() => handleVoiceoverVolumeChange(voiceoverVolume === 100 ? 50 : 100)}
                    onDoubleClick={() => handleVoiceoverVolumeChange(100)}
                    className="text-xs font-mono text-amber-400 font-bold w-9 text-right shrink-0 cursor-pointer hover:underline"
                    title="Nhấp đúp để đặt về 100%"
                  >
                    {isVoiceoverMuted ? '0%' : `${voiceoverVolume}%`}
                  </span>
                </div>
              </div>

              {/* Header Track 4: Audio Gốc [A2] */}
              <div className="flex-1 min-h-[48px] sm:min-h-[56px] px-2.5 flex flex-col justify-center bg-slate-900/40 gap-1.5">
                {/* Hàng trên: Badge A2, Tên Track & Nút Khóa / Tắt tiếng */}
                <div className="flex items-center justify-between min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-5 h-5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-300 font-bold text-[10px] flex items-center justify-center shrink-0 shadow-sm">
                      A2
                    </span>
                    <span className="text-xs font-semibold text-slate-200 truncate">Audio Gốc</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsAudioLocked(!isAudioLocked)}
                      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                      title={isAudioLocked ? 'Mở khóa track audio gốc' : 'Khóa track audio gốc'}
                    >
                      {isAudioLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleAudioMute ? onToggleAudioMute() : setInternalAudioMuted(!internalAudioMuted)}
                      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/60 transition cursor-pointer"
                      title={isAudioMuted ? 'Bật tiếng gốc' : 'Tắt tiếng gốc'}
                    >
                      {isAudioMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Hàng dưới: Thanh gạt âm lượng A2 to rõ, nhạy, dễ chỉnh */}
                <div className="flex items-center gap-2" title={`Âm lượng Audio Gốc: ${originalAudioVolume}% (Nhấp đúp để đặt lại 100%)`}>
                  <button
                    type="button"
                    onClick={() => onToggleAudioMute ? onToggleAudioMute() : setInternalAudioMuted(!internalAudioMuted)}
                    className="text-emerald-400/80 hover:text-emerald-300 transition shrink-0 cursor-pointer"
                    title={isAudioMuted ? 'Bật tiếng gốc' : 'Tắt tiếng gốc'}
                  >
                    {isAudioMuted || originalAudioVolume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                    ) : originalAudioVolume < 50 ? (
                      <Volume1 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={isAudioMuted ? 0 : originalAudioVolume}
                    data-testid="volume-slider-a2"
                    title={`Âm lượng Audio Gốc: ${originalAudioVolume}% (Nhấp đúp để đặt về 100%)`}
                    onDoubleClick={() => handleOriginalAudioVolumeChange(100)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      handleOriginalAudioVolumeChange(v);
                      if (v > 0 && isAudioMuted) {
                        if (onToggleAudioMute) onToggleAudioMute();
                        else setInternalAudioMuted(false);
                      }
                    }}
                    className="flex-1 h-2 bg-slate-800 hover:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 transition shadow-inner"
                  />
                  <span
                    onClick={() => handleOriginalAudioVolumeChange(originalAudioVolume === 100 ? 50 : 100)}
                    onDoubleClick={() => handleOriginalAudioVolumeChange(100)}
                    className="text-xs font-mono text-emerald-400 font-bold w-9 text-right shrink-0 cursor-pointer hover:underline"
                    title="Nhấp đúp để đặt về 100%"
                  >
                    {isAudioMuted ? '0%' : `${originalAudioVolume}%`}
                  </span>
                </div>
              </div>
            </div>

          {/* B. THÂN DÒNG THỜI GIAN CUỘN ĐƯỢC (SCROLLABLE TIMELINE BODY) */}
          <div
            ref={trackAreaRef}
            data-testid="timeline-track-area"
            onScroll={syncScrollMetrics}
            className="flex-1 min-h-0 relative overflow-x-auto overflow-y-hidden select-none bg-slate-950 no-scrollbar"
          >
            {/* Vùng canvas timeline chứa toàn bộ thước đo và dải track */}
            <div
              ref={trackCanvasRef}
              style={{ width: `${Math.max(100, 100 * zoomLevel)}%` }}
              className="min-w-full relative h-full flex flex-col"
              onMouseDown={handleTrackCanvasMouseDown}
            >
              {/* 1. Thước đo thời gian Time Ruler */}
              <div
                ref={rulerRef}
                data-testid="timeline-ruler"
                className="h-7 border-b border-slate-800 bg-slate-900/90 relative cursor-pointer select-none"
                onMouseDown={handleMouseDownScrub}
              >
                {rulerTicks.map((tick, idx) => (
                  <div
                    key={idx}
                    style={{ left: `${tick.pct}%` }}
                    className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                  >
                    <span className="text-[9px] font-mono text-slate-400 mt-0.5">{tick.label}</span>
                    <div className="w-[1px] h-2 bg-slate-700 mt-auto" />
                  </div>
                ))}
              </div>

              {/* 2. Track 1: Dải Khối Phụ Đề [S] */}
              <div className="h-10 border-b border-slate-800/70 relative bg-slate-950/60 flex items-center">
                {isSubVisible &&
                  cues.map((cue) => {
                    const leftPct = (cue.start_pts / totalDuration) * 100;
                    const widthPct = Math.max(0.3, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
                    const isSelected = effectiveSelectedCueIds.includes(cue.cue_id) || selectedCueId === cue.cue_id;
                    const isCurrent = activeCue?.cue_id === cue.cue_id;

                    return (
                      <div
                        key={cue.cue_id}
                        data-testid="timeline-cue-block"
                        data-cue-id={cue.cue_id}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        onClick={(e) => handleCueClick(e, cue)}
                        onMouseDown={(e) => handleMouseDownTrim(e, cue, 'move')}
                        className={`absolute top-1 bottom-1 rounded transition-colors group flex items-center px-1.5 overflow-hidden text-xs select-none cursor-move ${
                          isSelected
                            ? 'bg-blue-600 border-2 border-white text-white shadow-lg shadow-blue-500/40 z-20 ring-2 ring-indigo-400/60'
                            : isCurrent
                            ? 'bg-blue-900/90 border border-blue-400 text-blue-100 z-10'
                            : 'bg-slate-800/90 border border-slate-600 hover:border-slate-400 text-slate-200'
                        }`}
                        title={`[${formatSmpteTimecode(cue.start_pts)} - ${formatSmpteTimecode(cue.end_pts)}] ${
                          cue.translated_text || cue.source_text
                        }`}
                      >
                        {/* Handle kéo mép trái (Trim Start) */}
                        <div
                          data-testid="trim-handle-start"
                          onMouseDown={(e) => handleMouseDownTrim(e, cue, 'start')}
                          className="absolute left-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-white/80 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-30"
                        >
                          <div className="w-[1.5px] h-3 bg-black/80 rounded" />
                        </div>

                        {/* Nội dung text câu phụ đề */}
                        <span className="truncate font-medium text-[10px] pointer-events-none px-1">
                          {cue.translated_text || cue.source_text}
                        </span>

                        {/* Handle kéo mép phải (Trim End) */}
                        <div
                          data-testid="trim-handle-end"
                          onMouseDown={(e) => handleMouseDownTrim(e, cue, 'end')}
                          className="absolute right-0 top-0 bottom-0 w-2 hover:w-3 bg-white/20 hover:bg-white/80 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center z-30"
                        >
                          <div className="w-[1.5px] h-3 bg-black/80 rounded" />
                        </div>
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
                        className="h-full flex-1 min-w-0 border-r border-slate-800/50 relative overflow-hidden bg-slate-900/40 flex items-center justify-center"
                      >
                        <img
                          src={thumb.dataUrl}
                          alt={`thumb-${idx}`}
                          className="w-full h-full object-cover object-center opacity-75 hover:opacity-100 transition-opacity pointer-events-none select-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Track 3: Lồng Tiếng AI [A1] */}
              <div
                className={`border-b border-slate-800/70 relative bg-slate-950/90 flex items-center transition-all ${
                  voiceoverLanesData.maxLanes > 1 ? 'h-16' : 'h-12 sm:h-14'
                }`}
              >
                {voiceoverLanesData.cuesWithLanes.map(({ cue, lane }, idx) => {
                  const leftPct = (cue.start_pts / totalDuration) * 100;
                  const widthPct = Math.max(0.4, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
                  const isSecondLane = lane > 0;
                  return (
                    <div
                      key={idx}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: voiceoverLanesData.maxLanes > 1 ? (lane === 0 ? '4px' : '34px') : '6px',
                        height: voiceoverLanesData.maxLanes > 1 ? '26px' : '34px',
                      }}
                      className={`absolute rounded border flex items-center px-1.5 overflow-hidden text-[9px] font-mono select-none pointer-events-none ${
                        isSecondLane
                          ? 'bg-purple-950/70 border-purple-600/60 text-purple-200'
                          : 'bg-amber-950/70 border-amber-700/60 text-amber-300/90'
                      }`}
                      title={`[Tầng ${lane + 1}] ${cue.translated_text || cue.source_text}`}
                    >
                      <Mic className={`w-2.5 h-2.5 mr-1 shrink-0 ${isSecondLane ? 'text-purple-400' : 'text-amber-400'}`} />
                      {voiceoverLanesData.maxLanes > 1 && (
                        <span
                          className={`px-1 py-0.2 mr-1 rounded text-[8px] font-bold shrink-0 ${
                            isSecondLane ? 'bg-purple-900/80 text-purple-300' : 'bg-amber-900/80 text-amber-300'
                          }`}
                        >
                          Tầng {lane + 1}
                        </span>
                      )}
                      <span className="truncate">{cue.translated_text || cue.source_text}</span>
                    </div>
                  );
                })}
              </div>

              {/* 5. Track 4: Sóng Âm Thanh Gốc [A2] */}
              <div className="flex-1 min-h-[48px] sm:min-h-[56px] relative bg-slate-950 flex items-center overflow-hidden px-1">
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

              {/* 5.5. HỘP CHỮ NHẬT VÙNG QUÉT CHỌN NHIỀU (MARQUEE SELECTION BOX CHUẨN CAPCUT) */}
              {marqueeState && marqueeState.isDragging && (
                <div
                  data-testid="timeline-marquee-box"
                  className="absolute pointer-events-none z-40 border-2 border-indigo-400 bg-indigo-500/20 rounded shadow-lg backdrop-blur-[0.5px]"
                  style={{
                    left: `${Math.min(marqueeState.startX, marqueeState.currentX)}px`,
                    top: `${Math.min(marqueeState.startY, marqueeState.currentY)}px`,
                    width: `${Math.abs(marqueeState.currentX - marqueeState.startX)}px`,
                    height: `${Math.abs(marqueeState.currentY - marqueeState.startY)}px`,
                  }}
                />
              )}

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

        {/* 3. THANH CUỘN NGANG ĐỒNG BỘ ĐÁY TIMELINE CHUẨN CAPCUT (BOTTOM SYNCHRONIZED SCROLLBAR) */}
        <div
          data-testid="timeline-bottom-scrollbar"
          className="h-5 sm:h-6 bg-slate-950 border-t border-slate-800/80 flex flex-row shrink-0 select-none z-20"
        >
          {/* Cột góc trái căn khớp với Cột Đầu Track (w-48 sm:w-56) */}
          <div className="w-48 sm:w-56 bg-slate-950 border-r border-slate-800 shrink-0 flex items-center justify-between px-2.5 text-[10px] text-slate-400 font-mono">
            <span className="truncate text-[9px] text-slate-400 font-medium tracking-wider">CUỘN</span>
            <span className="text-[9px] text-slate-400 font-mono">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>

          {/* Rãnh trượt chính căn khớp 100% với Khu vực Track phía trên */}
          <div className="flex-1 bg-slate-950/90 px-2 flex items-center relative min-w-0">
            <div
              ref={scrollbarTrackRef}
              data-testid="timeline-scrollbar-track"
              onClick={handleTrackClick}
              className="h-2.5 sm:h-3 w-full bg-slate-900/90 hover:bg-slate-900 rounded-full relative cursor-pointer border border-slate-800/80 shadow-inner flex items-center group transition-colors"
              title="Kéo thanh trượt hoặc Giữ Alt + Lăn chuột để cuộn trái/phải • Giữ Ctrl + Lăn chuột để phóng to đoạn đó / thu nhỏ tổng quan"
            >
              {/* Vạch Playhead vàng thu nhỏ phản ánh vị trí kim hiện tại */}
              <div
                style={{ left: `${Math.max(0, Math.min(100, playheadPct))}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-amber-400 pointer-events-none z-10 -translate-x-1/2 rounded-full shadow-[0_0_4px_rgba(251,191,36,0.8)]"
              />

              {/* Con trượt thanh cuộn (Scrollbar Thumb) chuẩn CapCut */}
              <div
                data-testid="timeline-scrollbar-thumb"
                onMouseDown={handleThumbMouseDown}
                style={{
                  left: `${thumbLeftPct}%`,
                  width: `${thumbWidthPct}%`,
                  minWidth: '36px',
                }}
                className={`absolute top-0.5 bottom-0.5 rounded-full flex items-center justify-center transition-colors select-none z-20 ${
                  isDraggingThumb
                    ? 'bg-indigo-600 border border-indigo-400 ring-2 ring-indigo-400/40 cursor-grabbing shadow-lg'
                    : 'bg-slate-700/90 border border-slate-600/80 hover:bg-slate-600 hover:border-slate-500 cursor-grab shadow-sm'
                }`}
              >
                {/* 3 vạch gân cầm nắm ở giữa con trượt */}
                <div className="flex items-center gap-0.5 opacity-50 group-hover:opacity-80 pointer-events-none">
                  <div className="w-[1.5px] h-2 bg-slate-300 rounded-full" />
                  <div className="w-[1.5px] h-2 bg-slate-300 rounded-full" />
                  <div className="w-[1.5px] h-2 bg-slate-300 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
      {/* Audio element phát thuyết minh lồng tiếng A1 đồng bộ NLE */}
      <audio
        ref={voiceAudioRef}
        key={`${projectId}-${hasVoiceover}`}
        src={projectId && hasVoiceover && cues.length > 0 ? apiClient.getVoiceoverAudioUrl(projectId) : undefined}
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
