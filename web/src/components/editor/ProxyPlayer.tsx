import React, { useEffect, useRef } from 'react';

interface ProxyPlayerProps {
  videoUrl?: string;
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onTogglePlay: () => void;
}

export const ProxyPlayer: React.FC<ProxyPlayerProps> = ({
  videoUrl,
  currentTime,
  isPlaying,
  onTimeUpdate,
  onTogglePlay,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

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
    <div className="flex flex-col bg-black rounded-xl border border-zinc-800 overflow-hidden shadow-xl">
      <div className="relative aspect-video flex items-center justify-center bg-zinc-950">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="text-zinc-600 text-xs font-mono flex flex-col items-center gap-2">
            <span>🎥 Video Preview / Proxy</span>
            <span>(Không có luồng phát trực tiếp)</span>
          </div>
        )}
      </div>

      {/* Playback Controls */}
      <div className="h-12 bg-zinc-900 border-t border-zinc-800 px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onTogglePlay}
            className="w-7 h-7 rounded bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center font-bold"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => onTimeUpdate(Math.max(0, currentTime - 1.0))}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono"
            title="Lùi 1s"
          >
            -1s
          </button>
          <button
            onClick={() => onTimeUpdate(currentTime + 1.0)}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono"
            title="Tới 1s"
          >
            +1s
          </button>
        </div>

        <div className="font-mono text-zinc-300 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800">
          PTS: <span className="text-indigo-400 font-bold">{formatTimecode(currentTime)}</span>
        </div>
      </div>
    </div>
  );
};
