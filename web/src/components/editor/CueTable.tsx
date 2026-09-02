import React, { useState } from 'react';
import { SubtitleCueV1 } from '../../types/api';

interface CueTableProps {
  cues: SubtitleCueV1[];
  selectedCueId?: string;
  onSelectCue: (cueId: string) => void;
  onUpdateCue: (updated: SubtitleCueV1) => void;
  onSplitCue: (cueId: string) => void;
  onMergeWithNext: (cueId: string) => void;
  onDeleteCue: (cueId: string) => void;
  onToggleLock: (cueId: string) => void;
}

export const CueTable: React.FC<CueTableProps> = ({
  cues,
  selectedCueId,
  onSelectCue,
  onUpdateCue,
  onSplitCue,
  onMergeWithNext,
  onDeleteCue,
  onToggleLock,
}) => {
  const [filterLowConf, setFilterLowConf] = useState(false);

  const displayedCues = filterLowConf
    ? cues.filter((c) => c.confidence < 0.7 || c.quality_flags?.includes('low_confidence'))
    : cues;

  return (
    <div className="flex flex-col flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl">
      {/* Table Toolbar */}
      <div className="h-11 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-200">Danh Sách Câu Phụ Đề</span>
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px]">
            {displayedCues.length} / {cues.length}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={filterLowConf}
              onChange={(e) => setFilterLowConf(e.target.checked)}
              className="rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0"
            />
            <span>Chỉ hiện độ tin cậy thấp (&lt;70%)</span>
          </label>
        </div>
      </div>

      {/* Table Rows Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 text-xs">
        {displayedCues.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">Không có câu phụ đề nào phù hợp</div>
        ) : (
          displayedCues.map((cue, index) => {
            const isSelected = cue.cue_id === selectedCueId;
            const isLocked = cue.status === 'locked';

            return (
              <div
                key={cue.cue_id}
                onClick={() => onSelectCue(cue.cue_id)}
                className={`p-3.5 flex flex-col md:flex-row gap-3 items-start transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-950/40 ring-1 ring-inset ring-indigo-500/40'
                    : isLocked
                    ? 'bg-amber-950/20 hover:bg-amber-950/30'
                    : 'hover:bg-zinc-800/40'
                }`}
              >
                {/* ID and Timing Column */}
                <div className="w-36 shrink-0 flex flex-col gap-1 font-mono text-[11px] text-zinc-400">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-300">#{cue.cue_id}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLock(cue.cue_id);
                      }}
                      className={`text-xs p-0.5 rounded ${
                        isLocked ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-600 hover:text-zinc-400'
                      }`}
                      title={isLocked ? 'Mở khóa cue' : 'Khóa cue (chống ghi đè)'}
                    >
                      {isLocked ? '🔒' : '🔓'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      value={cue.start_pts}
                      onChange={(e) =>
                        onUpdateCue({ ...cue, start_pts: parseFloat(e.target.value) || 0 })
                      }
                      disabled={isLocked}
                      className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                    <span>&rarr;</span>
                    <input
                      type="number"
                      step="0.1"
                      value={cue.end_pts}
                      onChange={(e) =>
                        onUpdateCue({ ...cue, end_pts: parseFloat(e.target.value) || 0 })
                      }
                      disabled={isLocked}
                      className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5">
                    <span>Conf: {(cue.confidence * 100).toFixed(0)}%</span>
                    {cue.quality_flags && cue.quality_flags.length > 0 && (
                      <span className="text-rose-400 bg-rose-950/60 px-1 rounded border border-rose-900">
                        {cue.quality_flags.join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Text Editing Dual Columns */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 w-full">
                  {/* Source Text */}
                  <textarea
                    rows={2}
                    value={cue.source_text}
                    onChange={(e) => onUpdateCue({ ...cue, source_text: e.target.value })}
                    disabled={isLocked}
                    placeholder="Văn bản gốc (OCR)..."
                    className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none font-sans text-xs leading-relaxed disabled:opacity-60"
                  />

                  {/* Translated Text */}
                  <textarea
                    rows={2}
                    value={cue.translated_text}
                    onChange={(e) => onUpdateCue({ ...cue, translated_text: e.target.value })}
                    disabled={isLocked}
                    placeholder="Bản dịch tiếng Việt..."
                    className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg p-2 text-indigo-200 focus:outline-none focus:border-indigo-500 resize-none font-sans text-xs leading-relaxed disabled:opacity-60"
                  />
                </div>

                {/* Row Quick Action Buttons */}
                <div className="flex md:flex-col gap-1 shrink-0 pt-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSplitCue(cue.cue_id);
                    }}
                    disabled={isLocked}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 rounded text-[11px]"
                    title="Tách câu làm đôi"
                  >
                    ✂️ Tách
                  </button>
                  {index < displayedCues.length - 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onMergeWithNext(cue.cue_id);
                      }}
                      disabled={isLocked}
                      className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 rounded text-[11px]"
                      title="Gộp với câu tiếp theo"
                    >
                      🔗 Gộp
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCue(cue.cue_id);
                    }}
                    disabled={isLocked}
                    className="px-2 py-1 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 disabled:opacity-40 rounded text-[11px]"
                    title="Xóa câu này"
                  >
                    🗑️ Xóa
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
