import React, { useRef } from 'react';
import { SubtitleCueV1 } from '../../types/api';

interface WaveformTimelineProps {
  duration: number;
  currentTime: number;
  cues: SubtitleCueV1[];
  selectedCueId?: string;
  onSelectCue: (cueId: string) => void;
  onSeek: (time: number) => void;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  duration,
  currentTime,
  cues,
  selectedCueId,
  onSelectCue,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const totalDuration = Math.max(1.0, duration);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ratio = x / rect.width;
    onSeek(ratio * totalDuration);
  };

  const playheadPercent = (currentTime / totalDuration) * 100;

  return (
    <div className="flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2 select-none">
      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono px-1">
        <span>00:00.000</span>
        <span>TIMELINE & WAVEFORM TRACK</span>
        <span>{totalDuration.toFixed(1)}s</span>
      </div>

      <div
        ref={containerRef}
        onClick={handleClick}
        className="relative h-20 bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden cursor-crosshair group"
      >
        {/* Mock Waveform Bars */}
        <div className="absolute inset-0 flex items-center justify-between px-1 pointer-events-none opacity-25">
          {Array.from({ length: 80 }).map((_, i) => {
            const h = (Math.sin(i * 0.3) * 0.4 + 0.5) * 100;
            return (
              <div
                key={i}
                className="w-1 bg-indigo-400 rounded-full"
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>

        {/* Subtitle Cue Blocks */}
        {cues.map((cue) => {
          const left = (cue.start_pts / totalDuration) * 100;
          const width = Math.max(0.5, ((cue.end_pts - cue.start_pts) / totalDuration) * 100);
          const isSelected = cue.cue_id === selectedCueId;
          const isLocked = cue.status === 'locked';

          return (
            <div
              key={cue.cue_id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectCue(cue.cue_id);
                onSeek(cue.start_pts);
              }}
              style={{ left: `${left}%`, width: `${width}%` }}
              className={`absolute top-2 bottom-2 rounded px-1.5 py-0.5 text-[10px] font-mono truncate transition-all cursor-pointer border ${
                isSelected
                  ? 'bg-indigo-600/80 border-indigo-400 text-white z-20 ring-2 ring-indigo-500/50 shadow-lg'
                  : isLocked
                  ? 'bg-amber-950/60 border-amber-700/80 text-amber-200 z-10'
                  : 'bg-zinc-800/80 border-zinc-700 text-zinc-300 hover:bg-zinc-700 z-10'
              }`}
              title={`[${cue.cue_id}] ${cue.source_text} (${cue.start_pts}s - ${cue.end_pts}s)`}
            >
              {isLocked ? '🔒 ' : ''}
              {cue.source_text || cue.cue_id}
            </div>
          );
        })}

        {/* Playhead Marker */}
        <div
          style={{ left: `${playheadPercent}%` }}
          className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.8)]"
        >
          <div className="w-2.5 h-2.5 bg-rose-500 rounded-full -ml-1 -mt-0.5 shadow-md" />
        </div>
      </div>
    </div>
  );
};
