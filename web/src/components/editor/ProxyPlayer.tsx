import React, { useEffect, useRef, useState } from 'react';
import { SubtitleCueV1 } from '../../types/api';

interface ProxyPlayerProps {
  videoUrl?: string;
  currentTime: number;
  isPlaying: boolean;
  activeCue?: SubtitleCueV1;
  onTimeUpdate: (time: number) => void;
  onTogglePlay: () => void;
}

export const ProxyPlayer: React.FC<ProxyPlayerProps> = ({
  videoUrl,
  currentTime,
  isPlaying,
  activeCue,
  onTimeUpdate,
  onTogglePlay,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showSubtitleOverlay, setShowSubtitleOverlay] = useState(true);

  useEffect(() => {
    if (videoRef.current) {
      if (Math.abs(videoRef.current.currentTime - currentTime) > 0.3) {
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

  const formatTimecode = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="flex flex-col bg-black rounded-xl border border-zinc-800 overflow-hidden shadow-2xl">
      {/* Video Viewport with Live Subtitle Overlay */}
      <div className="relative aspect-video flex items-center justify-center bg-zinc-950 overflow-hidden select-none">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-zinc-600 text-xs font-mono flex flex-col items-center gap-2">
            <span className="text-2xl">🎬</span>
            <span>Video Proxy Player</span>
            <span className="text-[10px] text-zinc-700">(Nhận diện PTS thời gian thực)</span>
          </div>
        )}

        {/* Live Subtitle Overlay on Video */}
        {showSubtitleOverlay && activeCue && (
          <div className="absolute bottom-6 left-4 right-4 text-center pointer-events-none transition-all animate-in fade-in duration-100">
            <div className="inline-block bg-black/80 backdrop-blur-sm border border-zinc-800/80 px-4 py-1.5 rounded-lg shadow-2xl max-w-[90%]">
              <p className="text-amber-300 font-semibold text-sm drop-shadow-md leading-snug">
                {activeCue.translated_text || activeCue.source_text}
              </p>
              {activeCue.translated_text && (
                <p className="text-zinc-400 text-[11px] mt-0.5 font-normal line-clamp-1 opacity-80">
                  {activeCue.source_text}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Playback Controls Bar */}
      <div className="h-12 bg-zinc-900 border-t border-zinc-800 px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onTogglePlay}
            className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-600/30 transition-colors"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => onTimeUpdate(Math.max(0, currentTime - 1.0))}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-[11px] transition-colors border border-zinc-700/50"
            title="Lùi 1 giây"
          >
            -1s
          </button>
          <button
            onClick={() => onTimeUpdate(currentTime + 1.0)}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono text-[11px] transition-colors border border-zinc-700/50"
            title="Tới 1 giây"
          >
            +1s
          </button>

          <button
            onClick={() => setShowSubtitleOverlay(!showSubtitleOverlay)}
            className={`px-2 py-1 rounded font-medium text-[11px] transition-colors border ${
              showSubtitleOverlay
                ? 'bg-amber-950/60 border-amber-700 text-amber-300'
                : 'bg-zinc-800 border-zinc-700 text-zinc-500'
            }`}
            title="Bật/Tắt xem trước phụ đề trên video"
          >
            CC {showSubtitleOverlay ? 'BẬT' : 'TẮT'}
          </button>
        </div>

        <div className="font-mono text-zinc-300 bg-zinc-950 px-3 py-1 rounded-md border border-zinc-800 text-[11px]">
          PTS: <span className="text-indigo-400 font-bold">{formatTimecode(currentTime)}</span>
        </div>
      </div>
    </div>
  );
};
