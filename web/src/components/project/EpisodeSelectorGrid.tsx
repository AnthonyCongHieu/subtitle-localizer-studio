import React, { useMemo } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  CircleDashed,
  CheckCheck,
  RotateCcw,
  XSquare,
  Sparkles,
  Layers,
} from 'lucide-react';

export interface EpisodeSelectorGridProps {
  totalEpisodes: number;
  episodesStatus?: Record<number, 'completed' | 'corrupted' | 'missing'>;
  selectedEpisodes: number[];
  onToggleEpisode: (episode: number) => void;
  onSelectAll: () => void;
  onSelectMissingOrError: () => void;
  onDeselectAll: () => void;
  maxHeight?: string;
  isScanning?: boolean;
}

export const EpisodeSelectorGrid: React.FC<EpisodeSelectorGridProps> = ({
  totalEpisodes,
  episodesStatus = {},
  selectedEpisodes,
  onToggleEpisode,
  onSelectAll,
  onSelectMissingOrError,
  onDeselectAll,
  maxHeight = 'max-h-60',
  isScanning = false,
}) => {
  const selectedSet = useMemo(() => new Set(selectedEpisodes), [selectedEpisodes]);

  // Thống kê số lượng theo trạng thái trên ổ đĩa
  const stats = useMemo(() => {
    let completed = 0;
    let corrupted = 0;
    let missing = 0;
    for (let i = 1; i <= totalEpisodes; i++) {
      const st = episodesStatus[i] || 'missing';
      if (st === 'completed') completed++;
      else if (st === 'corrupted') corrupted++;
      else missing++;
    }
    return { completed, corrupted, missing };
  }, [totalEpisodes, episodesStatus]);

  const episodeList = useMemo(() => {
    const list: number[] = [];
    for (let i = 1; i <= totalEpisodes; i++) {
      list.push(i);
    }
    return list;
  }, [totalEpisodes]);

  return (
    <div className="space-y-3 bg-slate-950/70 border border-slate-800/90 rounded-xl p-3.5 select-none">
      {/* Header thanh công cụ & thống kê */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-white">
            Danh Sách Tập Phim ({totalEpisodes} tập)
          </span>
          {isScanning ? (
            <span className="flex items-center gap-1 text-[10px] text-amber-300 font-medium px-2 py-0.5 rounded-full bg-amber-950/50 border border-amber-700/50 animate-pulse">
              <Sparkles className="w-3 h-3 animate-spin" />
              Đang quét ổ cứng...
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 font-medium">
              Đã chọn:{' '}
              <strong className="text-indigo-300 font-mono">
                {selectedEpisodes.length}
              </strong>
              /{totalEpisodes}
            </span>
          )}
        </div>

        {/* Legend nhận diện trạng thái ổ cứng: completed green, corrupted red, missing gray */}
        <div className="flex items-center gap-3 text-[11px]">
          <div
            className="flex items-center gap-1 text-emerald-400 font-medium"
            title="Đã tải hoàn chỉnh trên ổ đĩa"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            <span>Đã có ({stats.completed})</span>
          </div>

          <div
            className="flex items-center gap-1 text-rose-400 font-medium"
            title="File tải lỗi hoặc thiếu dung lượng"
          >
            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
            <span>Lỗi ({stats.corrupted})</span>
          </div>

          <div
            className="flex items-center gap-1 text-slate-400 font-medium"
            title="Chưa có trên ổ cứng"
          >
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            <span>Chưa tải ({stats.missing})</span>
          </div>
        </div>
      </div>

      {/* 3 Nút thao tác nhanh 1 chạm theo đúng chuẩn hợp đồng */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onSelectAll}
          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-indigo-950/80 hover:bg-indigo-900/90 text-indigo-200 border border-indigo-700/60 transition flex items-center gap-1.5 active:scale-95 shadow-sm"
          title="Chọn toàn bộ các tập của bộ phim"
        >
          <CheckCheck className="w-3 h-3 text-indigo-400" />
          <span>Chọn tất cả</span>
        </button>

        <button
          type="button"
          onClick={onSelectMissingOrError}
          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-amber-950/80 hover:bg-amber-900/90 text-amber-200 border border-amber-700/60 transition flex items-center gap-1.5 active:scale-95 shadow-sm"
          title="Tự động lọc và chỉ chọn các tập còn thiếu hoặc bị lỗi để tải bù"
        >
          <RotateCcw className="w-3 h-3 text-amber-400" />
          <span>Chỉ chọn các tập còn thiếu / lỗi</span>
        </button>

        <button
          type="button"
          onClick={onDeselectAll}
          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition flex items-center gap-1.5 active:scale-95 shadow-sm"
          title="Bỏ chọn tất cả các tập"
        >
          <XSquare className="w-3 h-3 text-slate-400" />
          <span>Bỏ chọn tất cả</span>
        </button>
      </div>

      {/* Lưới ô vuông số tập phong cách iQIYI/Netflix */}
      <div
        className={`${maxHeight} overflow-y-auto pr-1 grid grid-cols-6 sm:grid-cols-9 md:grid-cols-12 gap-1.5 scrollbar-thin scrollbar-thumb-slate-800`}
      >
        {episodeList.map((ep) => {
          const isSelected = selectedSet.has(ep);
          const status = episodesStatus[ep] || 'missing';

          // Màu sắc trực quan theo trạng thái đĩa và trạng thái chọn
          let statusBadgeColor = 'border-slate-800 bg-slate-900/80 text-slate-400';
          let indicatorIcon = <CircleDashed className="w-2.5 h-2.5 text-slate-500" />;

          if (status === 'completed') {
            statusBadgeColor = 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300';
            indicatorIcon = <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />;
          } else if (status === 'corrupted') {
            statusBadgeColor = 'border-rose-800/80 bg-rose-950/40 text-rose-300';
            indicatorIcon = <AlertCircle className="w-2.5 h-2.5 text-rose-400" />;
          } else {
            // missing
            statusBadgeColor = 'border-slate-800 bg-slate-950 text-slate-400';
            indicatorIcon = <CircleDashed className="w-2.5 h-2.5 text-slate-600" />;
          }

          return (
            <button
              key={ep}
              type="button"
              onClick={() => onToggleEpisode(ep)}
              className={`relative h-10 rounded-lg border text-xs font-bold transition flex flex-col items-center justify-center p-1 active:scale-95 ${
                isSelected
                  ? 'ring-2 ring-indigo-400 bg-indigo-600 text-white border-indigo-400 shadow-md shadow-indigo-600/30'
                  : `${statusBadgeColor} hover:border-slate-600 hover:text-white`
              }`}
              title={`Tập ${ep}: ${
                status === 'completed'
                  ? 'Đã tải hoàn tất'
                  : status === 'corrupted'
                  ? 'Tải lỗi / file hỏng'
                  : 'Chưa tải'
              } ${isSelected ? '(Đã chọn để tải)' : '(Chưa chọn)'}`}
            >
              {/* Số tập */}
              <span className="font-mono text-xs leading-none">{ep}</span>

              {/* Icon / Chấm trạng thái nhỏ dưới chân */}
              <div className="mt-0.5 flex items-center justify-center">
                {isSelected ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                ) : (
                  indicatorIcon
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1">
        <span>* Bấm vào từng ô để chọn tải riêng tập đó (ví dụ tập 15, 32).</span>
        <span>
          Đã bôi chọn:{' '}
          <strong className="text-slate-300 font-mono">
            {selectedEpisodes.length}
          </strong>{' '}
          tập
        </span>
      </div>
    </div>
  );
};
