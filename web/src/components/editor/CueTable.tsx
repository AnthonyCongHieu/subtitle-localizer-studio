import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SubtitleCueV1 } from '../../types/api';
import { FixedSizeList } from 'react-window';
import {
  Play,
  Lock,
  Unlock,
  Scissors,
  Link2,
  Trash2,
  Search,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
  Type,
  List,
  LayoutGrid,
  RefreshCw,
  ChevronsUp,
  Zap,
  Loader2,
  Sparkles,
  Film,
} from 'lucide-react';

interface CueTableProps {
  cues: SubtitleCueV1[];
  selectedCueId?: string;
  currentVideoTime?: number;
  onSelectCue: (cueId: string) => void;
  onPlayCue: (pts: number) => void;
  onUpdateCue: (updated: SubtitleCueV1) => void;
  onSplitCue: (cueId: string) => void;
  onMergeWithNext: (cueId: string) => void;
  onDeleteCue: (cueId: string) => void;
  onToggleLock: (cueId: string) => void;
  onRetranslate?: (cueId: string) => void;
  onRunPipeline?: () => void;
  onRunQuickScan?: () => void;
  isProcessing?: boolean;
  statusMessage?: string | null;
  progressPercent?: number;
}

export const CueTable: React.FC<CueTableProps> = ({
  cues,
  selectedCueId,
  currentVideoTime,
  onSelectCue,
  onPlayCue,
  onUpdateCue,
  onSplitCue,
  onMergeWithNext,
  onDeleteCue,
  onToggleLock,
  onRetranslate,
  onRunPipeline,
  onRunQuickScan,
  isProcessing = false,
  statusMessage = null,
  progressPercent = 0,
}) => {
  const [filterLowConf, setFilterLowConf] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [fontSizeMode, setFontSizeMode] = useState<'normal' | 'large'>('large');
  const [viewMode, setViewMode] = useState<'compact' | 'card'>('compact');
  const activeRowRef = useRef<HTMLDivElement>(null);
  const inspectorTextareaRef = useRef<HTMLTextAreaElement>(null);

  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  useEffect(() => {
    if (!listContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setListHeight(entry.contentRect.height);
      }
    });
    observer.observe(listContainerRef.current);
    return () => observer.disconnect();
  }, [viewMode]);


  const selectedIndex = cues.findIndex((c) => c.cue_id === selectedCueId);
  const activeSelectedCue = selectedIndex >= 0 ? cues[selectedIndex] : null;

  const selectPreviousCue = useCallback(() => {
    if (selectedIndex > 0) {
      const prev = cues[selectedIndex - 1];
      onSelectCue(prev.cue_id);
      onPlayCue(prev.start_pts);
    }
  }, [selectedIndex, cues, onSelectCue, onPlayCue]);

  const selectNextCue = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < cues.length - 1) {
      const next = cues[selectedIndex + 1];
      onSelectCue(next.cue_id);
      onPlayCue(next.start_pts);
    }
  }, [selectedIndex, cues, onSelectCue, onPlayCue]);

  const capitalizeFirst = useCallback((text: string) => {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }, []);

  // Ctrl+Enter = save and jump next cue (inside textarea)
  const handleInspectorKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      selectNextCue();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      selectPreviousCue();
    }
  }, [selectNextCue, selectPreviousCue]);

  // Auto-scroll to active row
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedCueId]);

  // Auto-focus inspector textarea when active cue changes
  useEffect(() => {
    if (inspectorTextareaRef.current && activeSelectedCue) {
      const timer = setTimeout(() => {
        inspectorTextareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedCueId]);

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

  const nudgeStart = (cue: SubtitleCueV1, delta: number) => {
    const nextStart = Math.max(0, parseFloat((cue.start_pts + delta).toFixed(2)));
    if (nextStart < cue.end_pts) {
      onUpdateCue({ ...cue, start_pts: nextStart });
    }
  };

  const nudgeEnd = (cue: SubtitleCueV1, delta: number) => {
    const nextEnd = Math.max(cue.start_pts + 0.1, parseFloat((cue.end_pts + delta).toFixed(2)));
    onUpdateCue({ ...cue, end_pts: nextEnd });
  };

  const snapStartToVideo = (cue: SubtitleCueV1) => {
    if (currentVideoTime !== undefined && currentVideoTime < cue.end_pts) {
      onUpdateCue({ ...cue, start_pts: parseFloat(currentVideoTime.toFixed(2)) });
    }
  };

  const snapEndToVideo = (cue: SubtitleCueV1) => {
    if (currentVideoTime !== undefined && currentVideoTime > cue.start_pts) {
      onUpdateCue({ ...cue, end_pts: parseFloat(currentVideoTime.toFixed(2)) });
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${m}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl select-none">
      {/* Table Toolbar */}
      <div className="h-12 bg-zinc-900 border-b border-zinc-800 px-4 flex items-center justify-between text-xs gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <FileText className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-zinc-100">Bảng Biên Tập Phụ Đề Song Ngữ</span>
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono text-[10px] border border-zinc-700">
            {displayedCues.length} / {cues.length} câu
          </span>
        </div>

        {/* Search, View Mode, Font Size, and Filters */}
        <div className="flex items-center gap-2 flex-1 justify-end max-w-lg">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-zinc-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm từ khóa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-36 bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 text-xs"
            />
          </div>

          {/* View Mode Toggle: Compact Grid vs Card */}
          <div className="flex items-center bg-zinc-950 rounded-lg p-0.5 border border-zinc-800 gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'compact'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Bảng Lưới Tinh Gọn (Compact Grid - Chuẩn Aegisub)"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'card'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Thẻ Chi Tiết (Card View)"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setFontSizeMode(fontSizeMode === 'large' ? 'normal' : 'large')}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium flex items-center gap-1 border border-zinc-700 transition-colors"
            title="Tùy chỉnh cỡ chữ danh sách"
          >
            <Type className="w-3.5 h-3.5 text-indigo-400" />
            <span>{fontSizeMode === 'large' ? '16px' : '14px'}</span>
          </button>

          <label className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer text-xs shrink-0">
            <input
              type="checkbox"
              checked={filterLowConf}
              onChange={(e) => setFilterLowConf(e.target.checked)}
              className="rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0"
            />
            <span>Độ tin cậy &lt;70%</span>
          </label>
        </div>
      </div>

      {/* CapCut-Style Active Cue Inspector */}
      {activeSelectedCue && (
        <div className="bg-zinc-950/90 border-b border-zinc-800 p-4 space-y-3 shrink-0 shadow-lg">
          {/* Active Cue Bar Header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-mono font-bold text-xs shadow-md shadow-indigo-600/30">
                #{activeSelectedCue.cue_id}
              </span>
              <span className="text-zinc-400 font-mono text-xs">
                Mốc: <strong className="text-zinc-200">{activeSelectedCue.start_pts.toFixed(2)}s &rarr; {activeSelectedCue.end_pts.toFixed(2)}s</strong> ({(activeSelectedCue.end_pts - activeSelectedCue.start_pts).toFixed(2)}s)
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] font-semibold">
                {(activeSelectedCue.confidence * 100).toFixed(0)}% Độ tin cậy
              </span>
              <button
                type="button"
                onClick={() => onSelectCue('')}
                className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[10px] font-medium transition-colors border border-zinc-700/60 flex items-center gap-1"
                title="Bỏ chọn câu này và ẩn bảng chỉnh sửa (Phím ESC)"
              >
                <span>✕ Bỏ chọn (ESC)</span>
              </button>
            </div>

            {/* Prev / Play / Next */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={selectPreviousCue}
                disabled={selectedIndex <= 0}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 text-xs font-medium transition-colors flex items-center gap-1"
                title="Câu trước (Ctrl+Shift+Enter)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Câu Trước</span>
              </button>
              <button
                type="button"
                onClick={() => onPlayCue(activeSelectedCue.start_pts)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1"
                title="Phát câu này trên video"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Phát Lại</span>
              </button>
              <button
                type="button"
                onClick={selectNextCue}
                disabled={selectedIndex < 0 || selectedIndex >= cues.length - 1}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 text-xs font-medium transition-colors flex items-center gap-1"
                title="Câu sau (Ctrl+Enter)"
              >
                <span className="hidden sm:inline">Câu Sau</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Large Typography Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Vietnamese Translated (Primary Editor - 8 cols) */}
            <div className="md:col-span-8 flex flex-col space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-amber-300 font-bold flex items-center gap-1.5">
                  <span>Phụ đề tiếng Việt (Chỉnh sửa trực tiếp):</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className={activeSelectedCue.translated_text.length > 45 ? 'text-amber-400 font-semibold' : 'text-zinc-400'}>
                    {activeSelectedCue.translated_text.length} ký tự {activeSelectedCue.translated_text.length > 45 && '(Cảnh báo: Hơi dài)'}
                  </span>
                  <span className="text-zinc-600 text-[10px] hidden lg:inline">Ctrl+Enter = Câu sau</span>
                </div>
              </div>
              <textarea
                ref={inspectorTextareaRef}
                rows={3}
                value={activeSelectedCue.translated_text}
                onChange={(e) => onUpdateCue({ ...activeSelectedCue, translated_text: e.target.value })}
                onKeyDown={handleInspectorKeyDown}
                placeholder="Nhập nội dung phụ đề tiếng Việt..."
                className="w-full bg-zinc-900 border-2 border-indigo-500/80 rounded-xl p-3 text-amber-200 text-base font-medium focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30 transition-all shadow-inner leading-relaxed"
              />
            </div>

            {/* Original OCR Text (4 cols) */}
            <div className="md:col-span-4 flex flex-col space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400 font-medium">
                <span>Văn bản gốc (OCR):</span>
                <span>{activeSelectedCue.source_text.length} ký tự</span>
              </div>
              <textarea
                rows={3}
                value={activeSelectedCue.source_text}
                onChange={(e) => onUpdateCue({ ...activeSelectedCue, source_text: e.target.value })}
                placeholder="Văn bản gốc..."
                className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl p-3 text-zinc-200 text-sm focus:outline-none focus:border-zinc-600 transition-all leading-relaxed"
              />
            </div>
          </div>

          {/* Timing Nudges & Action Tools Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-zinc-800/60 text-xs">
            {/* Timing Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Start PTS */}
              <div className="flex items-center gap-1 font-mono">
                <span className="text-zinc-500 text-[11px]">Bắt đầu:</span>
                <input
                  type="number"
                  step="0.05"
                  value={activeSelectedCue.start_pts}
                  onChange={(e) => onUpdateCue({ ...activeSelectedCue, start_pts: parseFloat(e.target.value) || 0 })}
                  className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 text-xs focus:outline-none focus:border-indigo-500"
                />
                <button type="button" onClick={() => nudgeStart(activeSelectedCue, -0.1)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold" title="Lùi 0.1s">-0.1s</button>
                <button type="button" onClick={() => nudgeStart(activeSelectedCue, 0.1)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold" title="Tiến 0.1s">+0.1s</button>
                <button type="button" onClick={() => snapStartToVideo(activeSelectedCue)} className="p-1 px-1.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 hover:bg-indigo-900 text-xs flex items-center gap-1" title="Gán thời gian video hiện tại làm PTS bắt đầu">
                  <Clock className="w-3.5 h-3.5" /><span className="text-[10px]">Bắt giờ</span>
                </button>
              </div>
              {/* End PTS */}
              <div className="flex items-center gap-1 font-mono">
                <span className="text-zinc-500 text-[11px]">Kết thúc:</span>
                <input
                  type="number"
                  step="0.05"
                  value={activeSelectedCue.end_pts}
                  onChange={(e) => onUpdateCue({ ...activeSelectedCue, end_pts: parseFloat(e.target.value) || 0 })}
                  className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-100 text-xs focus:outline-none focus:border-indigo-500"
                />
                <button type="button" onClick={() => nudgeEnd(activeSelectedCue, -0.1)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold" title="Lùi 0.1s">-0.1s</button>
                <button type="button" onClick={() => nudgeEnd(activeSelectedCue, 0.1)} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold" title="Tiến 0.1s">+0.1s</button>
                <button type="button" onClick={() => snapEndToVideo(activeSelectedCue)} className="p-1 px-1.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 hover:bg-indigo-900 text-xs flex items-center gap-1" title="Gán thời gian video hiện tại làm PTS kết thúc">
                  <Clock className="w-3.5 h-3.5" /><span className="text-[10px]">Bắt giờ</span>
                </button>
              </div>
            </div>

            {/* Action Tools */}
            <div className="flex items-center gap-2 flex-wrap">
              {onRetranslate && (
                <button type="button" onClick={() => onRetranslate(activeSelectedCue.cue_id)} className="px-2.5 py-1 bg-sky-950/60 hover:bg-sky-900/80 text-sky-300 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors border border-sky-800/50" title="Dịch lại câu này bằng AI">
                  <RefreshCw className="w-3 h-3 text-sky-400" /><span>Dịch Lại</span>
                </button>
              )}
              <button type="button" onClick={() => onUpdateCue({ ...activeSelectedCue, translated_text: capitalizeFirst(activeSelectedCue.translated_text) })} className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors" title="Viết hoa chữ cái đầu câu">
                <ChevronsUp className="w-3 h-3 text-indigo-400" /><span>Hoa Đầu</span>
              </button>
              <button type="button" onClick={() => onSplitCue(activeSelectedCue.cue_id)} className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors" title="Tách câu làm đôi">
                <Scissors className="w-3 h-3 text-indigo-400" /><span>Tách Đôi</span>
              </button>
              <button type="button" onClick={() => onMergeWithNext(activeSelectedCue.cue_id)} className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors" title="Gộp nội dung với câu kế tiếp">
                <Link2 className="w-3 h-3 text-indigo-400" /><span>Gộp Tiếp</span>
              </button>
              <button type="button" onClick={() => onToggleLock(activeSelectedCue.cue_id)} className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors" title="Khóa/Mở khóa chỉnh sửa">
                {activeSelectedCue.status === 'locked' ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                <span>{activeSelectedCue.status === 'locked' ? 'Đã Khóa' : 'Khóa'}</span>
              </button>
              <button type="button" onClick={() => onDeleteCue(activeSelectedCue.cue_id)} className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors" title="Xóa câu này">
                <Trash2 className="w-3 h-3" /><span>Xóa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table Rows Container */}
      <div className="flex-1 overflow-y-auto text-xs">
        {displayedCues.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-center space-y-6">
            {isProcessing ? (
              <div className="bg-zinc-900/90 p-8 rounded-2xl border border-indigo-500/40 max-w-md w-full shadow-2xl shadow-indigo-500/20 text-center space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-400">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-zinc-100 font-bold text-base mb-1.5 flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
                    <span>Đang Xử Lý Phụ Đề Video</span>
                  </h3>
                  <p className="text-indigo-400 font-medium text-xs">
                    {statusMessage || 'Đang quét frame video và nhận diện chữ bằng RapidOCR...'}
                  </p>
                </div>
                <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden border border-zinc-700/60 p-0.5">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(5, progressPercent || 0)}%` }}
                  />
                </div>
                <div className="text-[11px] text-zinc-400 flex items-center justify-between font-mono">
                  <span>Tiến độ hoàn tất</span>
                  <span className="text-emerald-400 font-bold">{progressPercent || 0}%</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8 space-y-4 max-w-sm my-auto">
                <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 shadow-inner">
                  <Film className="w-8 h-8 text-zinc-500 stroke-[1.5]" />
                </div>
                <div>
                  <h3 className="text-zinc-200 font-semibold text-sm">Chưa có phụ đề</h3>
                  <p className="text-zinc-500 text-xs mt-1">
                    Bắt đầu nhận diện và dịch thuật tự động từ video
                  </p>
                </div>
                <div className="flex items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={onRunQuickScan}
                    className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-lg font-semibold text-xs shadow-md shadow-amber-600/25 transition-all flex items-center gap-2"
                    title="Quét 3 phút đầu để kiểm tra nhanh (15s)"
                  >
                    <Zap className="w-4 h-4 text-amber-200 fill-current" />
                    <span>⚡ Quét 3 Phút Đầu (15s)</span>
                  </button>
                  <button
                    type="button"
                    onClick={onRunPipeline}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium text-xs border border-zinc-700/80 transition-all flex items-center gap-1.5"
                    title="Quét toàn bộ video ở chế độ chạy ngầm"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Toàn Bộ Video</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : viewMode === 'compact' ? (
          /* ========== COMPACT GRID VIEW (Aegisub / Premiere Pro Caption Table) ========== */
          <div className="w-full h-full flex flex-col">
            {/* Table Header */}
            <div className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-700 grid grid-cols-[3rem_5.5rem_1fr_1fr_3.5rem] gap-px text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              <div className="px-2 py-2 text-center">#</div>
              <div className="px-2 py-2">Mốc</div>
              <div className="px-2 py-2">Văn bản gốc (OCR)</div>
              <div className="px-2 py-2 text-amber-300">Phụ đề Việt</div>
              <div className="px-2 py-2 text-center">%</div>
            </div>
            {/* Table Rows */}
            <div ref={listContainerRef} className="w-full flex-1" style={{ height: 'calc(100% - 28px)' }}>
              <FixedSizeList
                height={listHeight || 400}
                width="100%"
                itemCount={displayedCues.length}
                itemSize={44}
                itemData={displayedCues}
              >
                {({ index, style, data }: any) => {
                  const cue = data[index];
                  const isSelected = cue.cue_id === selectedCueId;
                  const isLocked = cue.status === 'locked';

                  return (
                    <div
                      style={style}
                      ref={isSelected ? activeRowRef : undefined}
                      onClick={() => {
                        if (isSelected) {
                          onSelectCue('');
                        } else {
                          onSelectCue(cue.cue_id);
                          onPlayCue(cue.start_pts);
                        }
                      }}
                      className={`grid grid-cols-[3rem_5.5rem_1fr_1fr_3.5rem] gap-px items-center cursor-pointer border-b border-zinc-800/50 transition-colors ${
                        isSelected
                          ? 'bg-indigo-950/50 ring-1 ring-inset ring-indigo-500/60'
                          : isLocked
                          ? 'bg-amber-950/10 hover:bg-amber-950/20'
                          : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="px-2 py-2 text-center font-mono text-zinc-500 text-[10px]">{index + 1}</div>
                      <div className="px-2 py-2 font-mono text-[10px] text-zinc-400 leading-tight">
                        <div>{formatTime(cue.start_pts)}</div>
                        <div className="text-zinc-600">{formatTime(cue.end_pts)}</div>
                      </div>
                      <div className={`px-2 py-2 truncate ${fontSizeMode === 'large' ? 'text-sm' : 'text-xs'} text-zinc-300 leading-snug`}>
                        {cue.source_text || <span className="text-zinc-600 italic">&mdash;</span>}
                      </div>
                      <div className={`px-2 py-2 truncate font-medium ${fontSizeMode === 'large' ? 'text-sm' : 'text-xs'} ${isSelected ? 'text-amber-200' : 'text-amber-300/80'} leading-snug`}>
                        {cue.translated_text || <span className="text-zinc-600 italic">Chưa dịch</span>}
                      </div>
                      <div className={`px-2 py-2 text-center font-mono text-[10px] font-semibold ${cue.confidence >= 0.9 ? 'text-emerald-400' : cue.confidence >= 0.7 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {(cue.confidence * 100).toFixed(0)}
                      </div>
                    </div>
                  );
                }}
              </FixedSizeList>
            </div>
          </div>
        ) : (
          /* ========== CARD VIEW (Detailed Editing Cards) ========== */
          <div className="divide-y divide-zinc-800/60">
            {displayedCues.map((cue, index) => {
              const isSelected = cue.cue_id === selectedCueId;
              const isLocked = cue.status === 'locked';
              const viLength = cue.translated_text ? cue.translated_text.trim().length : 0;
              const isTooLong = viLength > 45;

              return (
                <div
                  key={cue.cue_id}
                  ref={isSelected ? activeRowRef : undefined}
                  onClick={() => {
                    if (isSelected) {
                      onSelectCue('');
                    } else {
                      onSelectCue(cue.cue_id);
                      onPlayCue(cue.start_pts);
                    }
                  }}
                  className={`p-3.5 flex flex-col md:flex-row gap-3 items-start transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-950/40 ring-1 ring-inset ring-indigo-500/60 shadow-inner'
                      : isLocked
                      ? 'bg-amber-950/15 hover:bg-amber-950/25'
                      : 'hover:bg-zinc-800/40'
                  }`}
                >
                  {/* Timing & Cue Info */}
                  <div className="w-44 shrink-0 flex flex-col gap-2 font-mono text-[11px] text-zinc-400">
                    <div className="flex items-center justify-between">
                      <button onClick={(e) => { e.stopPropagation(); onSelectCue(cue.cue_id); onPlayCue(cue.start_pts); }} className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors" title="Phát video từ câu này">
                        <Play className="w-3 h-3 fill-current" /><span>#{cue.cue_id}</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onToggleLock(cue.cue_id); }} className={`text-xs p-1 rounded transition-colors flex items-center gap-1 ${isLocked ? 'text-amber-400 bg-amber-950/60 border border-amber-800' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`} title={isLocked ? 'Mở khóa câu này' : 'Khóa chống ghi đè'}>
                        {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-zinc-500 w-7">Bắt đầu</span>
                        <input type="number" step="0.05" value={cue.start_pts} onChange={(e) => onUpdateCue({ ...cue, start_pts: parseFloat(e.target.value) || 0 })} disabled={isLocked} className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-indigo-500 text-[11px]" />
                        <button onClick={(e) => { e.stopPropagation(); nudgeStart(cue, -0.1); }} disabled={isLocked} className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[9px]" title="Lùi 0.1s">-0.1</button>
                        <button onClick={(e) => { e.stopPropagation(); nudgeStart(cue, 0.1); }} disabled={isLocked} className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[9px]" title="Tiến 0.1s">+0.1</button>
                        <button onClick={(e) => { e.stopPropagation(); snapStartToVideo(cue); }} disabled={isLocked} className="p-1 rounded bg-zinc-800 hover:bg-indigo-900 text-zinc-400 hover:text-indigo-200 text-[9px]" title="Lấy thời gian video hiện tại làm PTS bắt đầu"><Clock className="w-2.5 h-2.5" /></button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-zinc-500 w-7">Kết thúc</span>
                        <input type="number" step="0.05" value={cue.end_pts} onChange={(e) => onUpdateCue({ ...cue, end_pts: parseFloat(e.target.value) || 0 })} disabled={isLocked} className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none focus:border-indigo-500 text-[11px]" />
                        <button onClick={(e) => { e.stopPropagation(); nudgeEnd(cue, -0.1); }} disabled={isLocked} className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[9px]" title="Lùi 0.1s">-0.1</button>
                        <button onClick={(e) => { e.stopPropagation(); nudgeEnd(cue, 0.1); }} disabled={isLocked} className="px-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[9px]" title="Tiến 0.1s">+0.1</button>
                        <button onClick={(e) => { e.stopPropagation(); snapEndToVideo(cue); }} disabled={isLocked} className="p-1 rounded bg-zinc-800 hover:bg-indigo-900 text-zinc-400 hover:text-indigo-200 text-[9px]" title="Lấy thời gian video hiện tại làm PTS kết thúc"><Clock className="w-2.5 h-2.5" /></button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-0.5">
                      <span>Thời lượng: {(cue.end_pts - cue.start_pts).toFixed(2)}s</span>
                      <span className="text-emerald-400/90 font-medium">{(cue.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Bilingual Text Editor */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2.5 w-full">
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 font-medium mb-1">
                        <span>Văn bản gốc (OCR):</span>
                        <span className="text-zinc-500">{cue.source_text.length} ký tự</span>
                      </div>
                      <textarea rows={3} value={cue.source_text} onChange={(e) => onUpdateCue({ ...cue, source_text: e.target.value })} disabled={isLocked} placeholder="Văn bản gốc..." className={`w-full bg-zinc-950/90 border border-zinc-800 rounded-lg p-2.5 text-zinc-200 focus:outline-none focus:border-indigo-500 resize-none font-sans leading-relaxed disabled:opacity-50 ${fontSizeMode === 'large' ? 'text-sm' : 'text-xs'}`} />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between text-[10px] font-medium mb-1">
                        <span className="text-indigo-300 font-semibold">Phụ đề tiếng Việt (Dịch):</span>
                        <span className={isTooLong ? 'text-amber-400 font-semibold' : 'text-zinc-500'}>{viLength} ký tự {isTooLong && '(Dài)'}</span>
                      </div>
                      <textarea rows={3} value={cue.translated_text} onChange={(e) => onUpdateCue({ ...cue, translated_text: e.target.value })} disabled={isLocked} placeholder="Nhập phụ đề tiếng Việt..." className={`w-full bg-zinc-950/90 border rounded-lg p-2.5 text-amber-200 focus:outline-none resize-none font-sans leading-relaxed font-medium disabled:opacity-50 ${isTooLong ? 'border-amber-600/60 focus:border-amber-500' : 'border-zinc-800 focus:border-indigo-500'} ${fontSizeMode === 'large' ? 'text-sm font-semibold' : 'text-xs'}`} />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex md:flex-col gap-1.5 shrink-0 pt-3 md:pt-0">
                    <button onClick={(e) => { e.stopPropagation(); onSplitCue(cue.cue_id); }} disabled={isLocked} className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg text-[11px] transition-colors flex items-center gap-1.5" title="Tách câu làm đôi">
                      <Scissors className="w-3 h-3 text-zinc-400" /><span>Tách</span>
                    </button>
                    {index < displayedCues.length - 1 && (
                      <button onClick={(e) => { e.stopPropagation(); onMergeWithNext(cue.cue_id); }} disabled={isLocked} className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg text-[11px] transition-colors flex items-center gap-1.5" title="Gộp với câu tiếp theo">
                        <Link2 className="w-3 h-3 text-zinc-400" /><span>Gộp</span>
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onDeleteCue(cue.cue_id); }} disabled={isLocked} className="px-2.5 py-1.5 bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 disabled:opacity-30 rounded-lg text-[11px] transition-colors flex items-center gap-1.5" title="Xóa câu này">
                      <Trash2 className="w-3 h-3 text-rose-400" /><span>Xóa</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
