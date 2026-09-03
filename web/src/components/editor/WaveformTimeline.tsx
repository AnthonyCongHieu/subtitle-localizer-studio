import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { SubtitleCueV1 } from '../../types/api';
import { apiClient } from '../../api/client';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Subtitles,
  Film,
  Volume2,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Crosshair,
} from 'lucide-react';

interface WaveformTimelineProps {
  projectId?: string;
  duration: number;
  currentTime: number;
  cues: SubtitleCueV1[];
  selectedCueId?: string;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onSelectCue: (cueId: string) => void;
  onSeek: (time: number) => void;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  projectId,
  duration,
  currentTime,
  cues,
  selectedCueId,
  isPlaying,
  onTogglePlay,
  onSelectCue,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalDuration = Math.max(1.0, duration);
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);

  useEffect(() => {
    if (!projectId) return;
    apiClient
      .getAudioWaveform(projectId)
      .then((data) => {
        if (data && data.peaks && data.peaks.length > 0) {
          setAudioPeaks(data.peaks);
        }
      })
      .catch((err) => {
        console.warn('Không thể tải audio waveform:', err);
      });
  }, [projectId]);

  const waveformSvgPath = useMemo(() => {
    if (!audioPeaks || audioPeaks.length === 0) return null;
    const n = audioPeaks.length;
    const midY = 16;
    const maxAmp = 13.5;

    let topPoints = '';
    let bottomPoints = '';

    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 100;
      const amp = Math.max(0.04, audioPeaks[i]) * maxAmp;
      const yTop = midY - amp;
      const yBottom = midY + amp;
      topPoints += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${yTop.toFixed(1)} `;
      bottomPoints = `L ${x.toFixed(2)} ${yBottom.toFixed(1)} ` + bottomPoints;
    }

    return `${topPoints} ${bottomPoints} Z`;
  }, [audioPeaks]);

  const formatTimecode = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor(((seconds % 1) * 30)); // 30 fps timecode like Premiere Pro
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  // Compute seek time from click position
  const computeSeekTime = useCallback((clientX: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = clientX - rect.left + scrollLeft;
    const totalWidth = rect.width * zoomLevel;
    const ratio = Math.max(0, Math.min(clickX / totalWidth, 1.0));
    return ratio * totalDuration;
  }, [zoomLevel, totalDuration]);

  // Ruler scrubbing (drag on timeline to scrub)
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only left-click
    if (e.button !== 0) return;
    setIsScrubbing(true);
    const seekTime = computeSeekTime(e.clientX);
    if (seekTime !== null) onSeek(seekTime);
  }, [computeSeekTime, onSeek]);

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const seekTime = computeSeekTime(e.clientX);
      if (seekTime !== null) onSeek(seekTime);
    };
    const handleMouseUp = () => setIsScrubbing(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, computeSeekTime, onSeek]);

  // Follow Playhead Auto-Scroll
  useEffect(() => {
    if (!followPlayhead || !containerRef.current || !isPlaying) return;
    const container = containerRef.current;
    const totalWidth = container.clientWidth * zoomLevel;
    const playheadX = (currentTime / totalDuration) * totalWidth;
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    // If playhead goes beyond 75% of visible area, scroll to center it
    const margin = container.clientWidth * 0.25;
    if (playheadX > viewRight - margin || playheadX < viewLeft + margin) {
      container.scrollLeft = Math.max(0, playheadX - container.clientWidth / 2);
    }
  }, [currentTime, followPlayhead, isPlaying, zoomLevel, totalDuration]);

  // Disable follow-playhead when user manually scrolls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let userScrolling = false;
    const onScroll = () => {
      if (isScrubbing) return; // Don't disable during scrubbing
      // If we are following, check if scroll was user-initiated
      if (!userScrolling) {
        userScrolling = true;
        setTimeout(() => { userScrolling = false; }, 200);
      }
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [isScrubbing]);

  const rulerTicks = useMemo(() => {
    const ticks = [];
    const step = totalDuration > 60 ? 5 : totalDuration > 20 ? 2 : 1;
    for (let t = 0; t <= totalDuration; t += step) {
      ticks.push(t);
    }
    return ticks;
  }, [totalDuration]);

  const playheadPercent = (currentTime / totalDuration) * 100;

  // Selected cue index for prev/next
  const selectedIndex = cues.findIndex((c) => c.cue_id === selectedCueId);

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl select-none">
      {/* 1. Premiere Pro & CapCut Style Timeline Header Toolbar */}
      <div className="h-11 bg-zinc-900 border-b border-zinc-800 px-3 flex items-center justify-between text-xs gap-3">
        {/* Left: Premiere-Style Blue Timecode */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-950 px-2.5 py-1 rounded-md border border-zinc-800 font-mono shadow-inner">
            <span className="text-sky-400 font-bold text-xs tracking-wider">
              {formatTimecode(currentTime)}
            </span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400 text-[11px]">
              {formatTimecode(totalDuration)}
            </span>
          </div>

          <span className="text-zinc-500 font-medium hidden md:inline text-[11px]">
            Sequence: <strong className="text-zinc-300">Subtitle Timeline NLE</strong>
          </span>
        </div>

        {/* Center: Playhead Transport Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (selectedIndex > 0) {
                const prev = cues[selectedIndex - 1];
                onSelectCue(prev.cue_id);
                onSeek(prev.start_pts);
              }
            }}
            disabled={selectedIndex <= 0}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
            title="Câu Trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {onTogglePlay && (
            <button
              type="button"
              onClick={onTogglePlay}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md font-medium flex items-center gap-1 shadow-sm transition-all"
              title="Phát / Dừng (Phím Space)"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span className="text-[11px]">{isPlaying ? 'Dừng' : 'Phát'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (selectedIndex >= 0 && selectedIndex < cues.length - 1) {
                const next = cues[selectedIndex + 1];
                onSelectCue(next.cue_id);
                onSeek(next.start_pts);
              }
            }}
            disabled={selectedIndex < 0 || selectedIndex >= cues.length - 1}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 transition-colors"
            title="Câu Sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Follow Playhead + Zoom Slider */}
        <div className="flex items-center gap-2">
          {/* Follow Playhead Toggle */}
          <button
            type="button"
            onClick={() => setFollowPlayhead(!followPlayhead)}
            className={`p-1.5 rounded transition-colors flex items-center gap-1 text-[10px] ${
              followPlayhead
                ? 'bg-sky-950/60 text-sky-300 border border-sky-800/50'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
            }`}
            title={followPlayhead ? 'Tắt theo dõi kim phát' : 'Bật theo dõi kim phát (Auto-scroll)'}
          >
            <Crosshair className="w-3 h-3" />
            <span className="hidden md:inline">{followPlayhead ? 'Theo dõi' : 'Tự do'}</span>
          </button>

          <ZoomOut className="w-3.5 h-3.5 text-zinc-500" />
          <input
            type="range"
            min="1.0"
            max="3.5"
            step="0.25"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
            className="w-20 md:w-28 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            title="Thu phóng timeline"
          />
          <ZoomIn className="w-3.5 h-3.5 text-zinc-500" />
          <span className="font-mono text-[10px] text-zinc-400 w-7">{zoomLevel}x</span>
          <button
            onClick={() => setZoomLevel(1.0)}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Vừa vặn (1.0x)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Main Timeline Workspace: Track Headers (Left) + Multi-Track Lanes (Right) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track Headers Column (Fixed Width 110px) */}
        <div className="w-28 shrink-0 bg-zinc-900/90 border-r border-zinc-800 flex flex-col divide-y divide-zinc-800/80 text-[11px] font-sans select-none">
          {/* Ruler Corner Header */}
          <div className="h-6 bg-zinc-950/80 px-2 flex items-center justify-between text-zinc-500 font-mono text-[9px]">
            <span>TRACK</span>
            <span>SYNC</span>
          </div>

          {/* C1 Track Header */}
          <div className="h-16 px-2 flex flex-col justify-center gap-1 bg-amber-950/10 hover:bg-amber-950/20 transition-colors">
            <div className="flex items-center justify-between">
              <span className="px-1.5 py-0.5 rounded bg-amber-400 text-zinc-950 font-bold font-mono text-[10px] shadow-sm">
                C1
              </span>
              <span className="font-semibold text-amber-300 text-[11px] truncate">Phụ Đề</span>
            </div>
            <div className="flex items-center gap-1.5 text-zinc-500 text-[9px]">
              <Subtitles className="w-3 h-3 text-amber-400/80" />
              <span>{cues.length} cues</span>
            </div>
          </div>

          {/* V1 Track Header */}
          <div className="h-10 px-2 flex items-center justify-between bg-sky-950/10 hover:bg-sky-950/20 transition-colors">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-sky-500 text-white font-bold font-mono text-[10px] shadow-sm">
                V1
              </span>
              <span className="text-zinc-300 text-[11px] font-medium">Video</span>
            </div>
            <Film className="w-3 h-3 text-sky-400/70" />
          </div>

          {/* A1 Track Header */}
          <div className="h-11 px-2 flex items-center justify-between bg-emerald-950/10 hover:bg-emerald-950/20 transition-colors">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-zinc-950 font-bold font-mono text-[10px] shadow-sm">
                A1
              </span>
              <span className="text-zinc-300 text-[11px] font-medium">Audio</span>
            </div>
            <Volume2 className="w-3 h-3 text-emerald-400/70" />
          </div>
        </div>

        {/* Multi-Track Lanes (Horizontally Scrollable) */}
        <div
          ref={containerRef}
          onMouseDown={handleTimelineMouseDown}
          className={`relative flex-1 bg-zinc-950 overflow-x-auto overflow-y-hidden group shadow-inner ${isScrubbing ? 'cursor-col-resize' : 'cursor-pointer'}`}
        >
          <div
            style={{ width: `${zoomLevel * 100}%` }}
            className="relative h-full min-w-full flex flex-col"
          >
            {/* 1. Time Ruler */}
            <div className="h-6 bg-zinc-900/90 border-b border-zinc-800/90 relative text-[9px] font-mono text-zinc-500">
              {rulerTicks.map((t) => {
                const leftPercent = (t / totalDuration) * 100;
                return (
                  <div
                    key={t}
                    style={{ left: `${leftPercent}%` }}
                    className="absolute top-0 bottom-0 flex flex-col items-center pointer-events-none"
                  >
                    <div className="h-2 w-px bg-zinc-700" />
                    <span className="leading-none text-[8px] mt-0.5 -ml-2 text-zinc-400">
                      {Math.floor(t)}s
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 2. Track C1: Subtitle Clips (Yellow Clips) */}
            <div className="h-16 relative border-b border-zinc-800/80 bg-zinc-950/40 px-1 py-1 flex items-center">
              {cues.map((cue) => {
                const left = (cue.start_pts / totalDuration) * 100;
                const width = Math.max(1.5, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
                const isSelected = cue.cue_id === selectedCueId;

                return (
                  <div
                    key={cue.cue_id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCue(cue.cue_id);
                      onSeek(cue.start_pts);
                    }}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className={`absolute top-1 bottom-1 rounded px-2 py-0.5 text-xs font-sans transition-all cursor-pointer border flex flex-col justify-between overflow-hidden shadow-sm ${
                      isSelected
                        ? 'bg-amber-400 text-zinc-950 border-white ring-2 ring-sky-400 z-20 font-bold shadow-lg shadow-amber-400/20'
                        : 'bg-amber-400/90 hover:bg-amber-300 text-zinc-950 border-amber-300/80 z-10 font-semibold'
                    }`}
                    title={`[${cue.cue_id}] ${cue.translated_text || cue.source_text} (${cue.start_pts}s - ${cue.end_pts}s)`}
                  >
                    <div className="flex items-center justify-between text-[9px] font-mono leading-none text-zinc-900/80">
                      <span>#{cue.cue_id}</span>
                      <span>{(cue.end_pts - cue.start_pts).toFixed(1)}s</span>
                    </div>

                    <div className="truncate text-xs font-bold leading-tight text-zinc-950">
                      {cue.translated_text || cue.source_text}
                    </div>

                    {/* Trim Handles */}
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-zinc-900/20 hover:bg-zinc-900/40" />
                    <div className="absolute right-0 top-0 bottom-0 w-1 bg-zinc-900/20 hover:bg-zinc-900/40" />
                  </div>
                );
              })}
            </div>

            {/* 3. Track V1: Video Strip */}
            <div className="h-10 relative border-b border-zinc-800/80 bg-sky-950/20 px-1 py-1 flex items-center">
              <div className="w-full h-full rounded bg-sky-900/50 border border-sky-700/60 px-2.5 flex items-center justify-between text-sky-200 text-xs font-mono shadow-sm">
                <div className="flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-sky-400" />
                  <span className="font-sans font-medium text-[11px]">Video Source (V1)</span>
                </div>
                <span className="text-[10px] text-sky-300/70">{totalDuration.toFixed(1)}s</span>
              </div>
            </div>

            {/* 4. Track A1: Audio Waveform Strip (CapCut / Premiere Pro authentic acoustic waveform) */}
            <div className="h-11 relative bg-emerald-950/20 px-1 py-1 flex items-center">
              <div className="w-full h-full rounded bg-emerald-950/60 border border-emerald-800/60 px-2 flex items-center justify-between relative overflow-hidden">
                {/* Real Audio Waveform Svg Path */}
                {waveformSvgPath ? (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none px-1"
                    viewBox="0 0 100 32"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="waveformGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity="0.85" />
                        <stop offset="50%" stopColor="#10b981" stopOpacity="1" />
                        <stop offset="100%" stopColor="#059669" stopOpacity="0.85" />
                      </linearGradient>
                    </defs>
                    <path
                      d={waveformSvgPath}
                      fill="url(#waveformGrad)"
                      stroke="#34d399"
                      strokeWidth="0.3"
                    />
                  </svg>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none opacity-80">
                    {Array.from({ length: Math.floor(120 * zoomLevel) }).map((_, i) => {
                      const h = (Math.sin(i * 0.3) * 0.35 + 0.45 + (i % 5) * 0.08) * 85;
                      return (
                        <div
                          key={i}
                          className="w-1 bg-emerald-400 rounded-full"
                          style={{ height: `${Math.min(95, Math.max(15, h))}%` }}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="relative z-10 flex items-center gap-2 text-emerald-300 text-xs font-mono drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-sans font-medium text-[11px]">Audio Waveform (A1)</span>
                </div>
              </div>
            </div>

            {/* 5. Full-Height Premiere Pro Style Playhead Needle */}
            <div
              style={{ left: `${playheadPercent}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-sky-400 z-30 pointer-events-none shadow-[0_0_10px_rgba(56,189,248,1)] transition-[left] duration-75"
            >
              {/* Blue Playhead Top Needle (Premiere style) */}
              <div className="w-3 h-3 bg-sky-400 rotate-45 -mt-1.5 -ml-[5px] shadow-md border border-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
