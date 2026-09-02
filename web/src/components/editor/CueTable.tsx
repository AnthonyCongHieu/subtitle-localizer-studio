import React, { useState } from 'react';
import { SubtitleCueV1 } from '../../types/api';

interface CueTableProps {
  cues: SubtitleCueV1[];
  selectedCueId?: string;
  onSelectCue: (cueId: string) => void;
  onPlayCue: (pts: number) => void;
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
  onPlayCue,
  onUpdateCue,
  onSplitCue,
  onMergeWithNext,
  onDeleteCue,
  onToggleLock,
}) => {
  const [filterLowConf, setFilterLowConf] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const displayedCues = cues.filter((c) => {
    if (filterLowConf && c.confidence >= 0.7 && !c.quality_flags?.includes('low_confidence')) {
      return false;
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        c.source_text.toLowerCase().includes(q) ||
        c.translated_text.toLowerCase().includes(q) ||
        c.cue_id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Table Toolbar */}
      <div className="h-12 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between text-xs gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-semibold text-zinc-100 flex items-center gap-1.5">
            <span>📝</span> Bảng Biên Tập Phụ Đề
          </span>
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] border border-zinc-700">
            {displayedCues.length} / {cues.length} câu
          </span>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3 flex-1 justify-end max-w-md">
          <input
            type="text"
            placeholder="🔍 Tìm từ khóa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-40 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 text-xs"
          />

          <label className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer text-xs shrink-0">
            <input
              type="checkbox"
              checked={filterLowConf}
              onChange={(e) => setFilterLowConf(e.target.checked)}
              className="rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0"
            />
            <span>Độ tin cậy thấp (&lt;70%)</span>
          </label>
        </div>
      </div>

      {/* Table Rows Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60 text-xs">
        {displayedCues.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 space-y-2">
            <div className="text-xl">🔍</div>
            <p>Không tìm thấy câu phụ đề nào phù hợp</p>
          </div>
        ) : (
          displayedCues.map((cue, index) => {
            const isSelected = cue.cue_id === selectedCueId;
            const isLocked = cue.status === 'locked';

            return (
              <div
                key={cue.cue_id}
                onClick={() => {
                  onSelectCue(cue.cue_id);
                  onPlayCue(cue.start_pts);
                }}
                className={`p-3 flex flex-col md:flex-row gap-3 items-start transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-950/40 ring-1 ring-inset ring-indigo-500/50 shadow-inner'
                    : isLocked
                    ? 'bg-amber-950/20 hover:bg-amber-950/30'
                    : 'hover:bg-zinc-800/40'
                }`}
              >
                {/* ID & Timing Column */}
                <div className="w-36 shrink-0 flex flex-col gap-1.5 font-mono text-[11px] text-zinc-400">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayCue(cue.start_pts);
                      }}
                      className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1"
                      title="Phát từ mốc này"
                    >
                      <span>▶</span> #{cue.cue_id}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLock(cue.cue_id);
                      }}
                      className={`text-xs px-1 py-0.5 rounded transition-colors ${
                        isLocked ? 'text-amber-400 bg-amber-950/60 border border-amber-800' : 'text-zinc-600 hover:text-zinc-400'
                      }`}
                      title={isLocked ? 'Mở khóa câu này' : 'Khóa câu này chống ghi đè'}
                    >
                      {isLocked ? '🔒 Khóa' : '🔓'}
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
                      className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-indigo-500 font-mono"
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
                      className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span>{(cue.confidence * 100).toFixed(0)}%</span>
                    {cue.quality_flags && cue.quality_flags.length > 0 && (
                      <span className="text-rose-400 bg-rose-950/60 px-1 rounded border border-rose-900">
                        {cue.quality_flags.join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Dual Bilingual Text Editing */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 w-full">
                  {/* Source OCR */}
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 font-medium mb-0.5">Gốc (OCR):</span>
                    <textarea
                      rows={2}
                      value={cue.source_text}
                      onChange={(e) => onUpdateCue({ ...cue, source_text: e.target.value })}
                      disabled={isLocked}
                      placeholder="Văn bản gốc..."
                      className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg p-2 text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none font-sans text-xs leading-relaxed disabled:opacity-60"
                    />
                  </div>

                  {/* Vietnamese Translated */}
                  <div className="flex flex-col">
                    <span className="text-[10px] text-indigo-400 font-medium mb-0.5">Tiếng Việt (Dịch):</span>
                    <textarea
                      rows={2}
                      value={cue.translated_text}
                      onChange={(e) => onUpdateCue({ ...cue, translated_text: e.target.value })}
                      disabled={isLocked}
                      placeholder="Nhập bản dịch tiếng Việt..."
                      className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg p-2 text-indigo-100 focus:outline-none focus:border-indigo-500 resize-none font-sans text-xs leading-relaxed disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex md:flex-col gap-1 shrink-0 pt-3 md:pt-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSplitCue(cue.cue_id);
                    }}
                    disabled={isLocked}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded text-[11px] transition-colors"
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
                      className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded text-[11px] transition-colors"
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
                    className="px-2 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 disabled:opacity-30 rounded text-[11px] transition-colors"
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
