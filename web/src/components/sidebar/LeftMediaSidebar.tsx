import React, { useState, useMemo, useRef } from 'react';
import {
  Subtitles,
  Film,
  Search,
  RefreshCw,
  FolderDown,
  Check,
  Edit2,
  Upload,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  ArrowUpDown,
  CheckSquare,
  Square,
  Trash2,
  Scan,
  Languages,
} from 'lucide-react';
import { ProjectManifestV1, SubtitleCueV1 } from '../../types/api';
import { apiClient } from '../../api/client';
import { sortProjectsNaturally } from '../../utils/drama';

export type LeftSidebarTab = 'subtitles' | 'media';
export type CueFilterMode = 'all' | 'untranslated' | 'translated';

interface LeftMediaSidebarProps {
  projects: ProjectManifestV1[];
  activeProject: ProjectManifestV1 | null;
  onSelectProject: (proj: ProjectManifestV1) => void;
  onPickLocalVideo?: (file: File) => void;
  cues: SubtitleCueV1[];
  currentTime: number;
  onRefreshCues?: () => void;
  onSeekToCue: (startPts: number) => void;
  onUpdateCue?: (cue: SubtitleCueV1) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onBatchScanProjects?: (projectIds: string[]) => void;
  onBatchTranslateProjects?: (projectIds: string[]) => void;
  onDeleteProject?: (projectId: string) => void;
}

export const LeftMediaSidebar: React.FC<LeftMediaSidebarProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onPickLocalVideo,
  cues,
  currentTime,
  onRefreshCues,
  onSeekToCue,
  onUpdateCue,
  isCollapsed = false,
  onToggleCollapse,
  onBatchScanProjects,
  onBatchTranslateProjects,
  onDeleteProject,
}) => {
  const [activeTab, setActiveTab] = useState<LeftSidebarTab>('subtitles');
  const [searchQuery, setSearchQuery] = useState('');
  const [cueFilter, setCueFilter] = useState<CueFilterMode>('all');
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // Media tab state: Tự động sort & Chọn nhiều tập
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  // CapCut draft import state
  const [showCapcutModal, setShowCapcutModal] = useState(false);
  const [capcutDraftsList, setCapcutDraftsList] = useState<any[]>([]);
  const [isLoadingCapcutList, setIsLoadingCapcutList] = useState(false);
  const [capcutImportMsg, setCapcutImportMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phân loại phụ đề
  const isCueTranslated = (cue: SubtitleCueV1) => {
    if (!cue.translated_text || cue.translated_text.trim().length === 0) return false;
    if (cue.translated_text.trim() !== cue.source_text.trim()) return true;
    return /^[\d\s.,:;!?%#\-+*\/()]+$/.test(cue.source_text.trim());
  };

  const translatedCues = useMemo(() => cues.filter(isCueTranslated), [cues]);
  const untranslatedCues = useMemo(() => cues.filter((c) => !isCueTranslated(c)), [cues]);

  const filteredCues = useMemo(() => {
    let list = cues;
    if (cueFilter === 'translated') list = translatedCues;
    if (cueFilter === 'untranslated') list = untranslatedCues;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.source_text.toLowerCase().includes(q) ||
          (c.translated_text && c.translated_text.toLowerCase().includes(q))
      );
    }
    return list;
  }, [cues, cueFilter, translatedCues, untranslatedCues, searchQuery]);

  // Xác định câu phụ đề đang khớp với currentTime
  const activeCueId = useMemo(() => {
    if (!cues || cues.length === 0) return null;
    const found = cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts);
    return found?.cue_id || null;
  }, [cues, currentTime]);

  const handleStartEdit = (cue: SubtitleCueV1, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCueId(cue.cue_id || null);
    setEditingText(cue.translated_text || cue.source_text);
  };

  const handleSaveEdit = (cue: SubtitleCueV1) => {
    if (!onUpdateCue || !editingCueId) return;
    onUpdateCue({
      ...cue,
      translated_text: editingText.trim(),
    });
    setEditingCueId(null);
  };

  const handleOpenCapcutModal = async () => {
    setShowCapcutModal(true);
    setIsLoadingCapcutList(true);
    setCapcutImportMsg(null);
    try {
      const res = await apiClient.getCapCutDrafts(30);
      setCapcutDraftsList(res.drafts || []);
    } catch (err: any) {
      console.warn('Không thể nạp danh sách CapCut drafts:', err);
    } finally {
      setIsLoadingCapcutList(false);
    }
  };

  const handleImportCapcutProject = async (draftId: string) => {
    if (!activeProject) return;
    setIsLoadingCapcutList(true);
    try {
      const res = await apiClient.importCapCutDraft(activeProject.project_id, draftId);
      setCapcutImportMsg(`Đã nạp thành công ${res.imported_count} câu phụ đề từ CapCut!`);
      if (onRefreshCues) onRefreshCues();
      setTimeout(() => setShowCapcutModal(false), 1200);
    } catch (err: any) {
      setCapcutImportMsg(`Lỗi: ${err?.message || 'Không thể nạp phụ đề'}`);
    } finally {
      setIsLoadingCapcutList(false);
    }
  };

  const formatPts = (pts: number) => {
    const m = Math.floor(pts / 60);
    const s = Math.floor(pts % 60);
    const ms = Math.floor((pts % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  if (isCollapsed) {
    return (
      <aside className="w-12 bg-slate-950 border-r border-slate-800/80 flex flex-col items-center py-3 space-y-4 shrink-0 select-none z-20">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
          title="Mở rộng Hộp Phụ Đề & Media"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setActiveTab('subtitles');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === 'subtitles'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
          title="Xem danh sách phụ đề"
        >
          <Subtitles className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setActiveTab('media');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === 'media'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
          title="Xem danh sách tập phim"
        >
          <Film className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-80 md:w-88 lg:w-96 bg-slate-950 border-r border-slate-800/80 flex flex-col shrink-0 select-none z-20 min-h-0 overflow-hidden shadow-lg transition-all duration-200">
      {/* 1. Header Tab Selector: [Phụ Đề] & [Tập Phim / Media] */}
      <div className="h-11 bg-slate-900/60 border-b border-slate-800/80 px-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs flex-1 mr-2">
          <button
            type="button"
            onClick={() => setActiveTab('subtitles')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md font-medium transition ${
              activeTab === 'subtitles'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Subtitles className="w-3.5 h-3.5" />
            <span>Phụ Đề ({cues.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('media')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-md font-medium transition ${
              activeTab === 'media'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Tập Phim ({projects.length})</span>
          </button>
        </div>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition"
            title="Thu gọn thanh bên"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2. Nội dung Tab: Phụ Đề */}
      {activeTab === 'subtitles' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-3">
          {/* Search & Actions Bar */}
          <div className="flex items-center gap-1.5 mb-2.5">
            <div className="flex-1 relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm câu Trung hoặc Việt..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            {onRefreshCues && (
              <button
                type="button"
                onClick={onRefreshCues}
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white transition shadow-sm"
                title="Làm mới phụ đề"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenCapcutModal}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-semibold shadow transition"
              title="Nhập phụ đề từ CapCut Desktop Draft"
            >
              <FolderDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">CapCut</span>
            </button>
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 text-[11px] mb-2 font-medium">
            <button
              type="button"
              onClick={() => setCueFilter('all')}
              className={`px-2 py-0.5 rounded-md border transition ${
                cueFilter === 'all'
                  ? 'bg-indigo-950/80 border-indigo-600 text-indigo-300 font-semibold'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Tất cả ({cues.length})
            </button>
            <button
              type="button"
              onClick={() => setCueFilter('untranslated')}
              className={`px-2 py-0.5 rounded-md border transition ${
                cueFilter === 'untranslated'
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300 font-semibold'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Chưa thay ({untranslatedCues.length})
            </button>
            <button
              type="button"
              onClick={() => setCueFilter('translated')}
              className={`px-2 py-0.5 rounded-md border transition ${
                cueFilter === 'translated'
                  ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-semibold'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Đã thay ({translatedCues.length})
            </button>
          </div>

          {/* Danh Sách Cuộn Cues */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {filteredCues.length > 0 ? (
              filteredCues.map((cue, idx) => {
                const isActive = cue.cue_id ? cue.cue_id === activeCueId : false;
                const isEditing = editingCueId === cue.cue_id;

                return (
                  <div
                    key={cue.cue_id || idx}
                    onClick={() => onSeekToCue(cue.start_pts)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer group select-text ${
                      isActive
                        ? 'bg-indigo-950/50 border-indigo-500 shadow-md shadow-indigo-950/30'
                        : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono mb-1.5">
                      <span className={isActive ? 'text-indigo-300 font-bold' : 'text-slate-400'}>
                        {formatPts(cue.start_pts)} → {formatPts(cue.end_pts)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 font-bold text-[9px]">#{idx + 1}</span>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={(e) => handleStartEdit(cue, e)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-indigo-300 transition"
                            title="Sửa bản dịch câu này"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Câu tiếng Trung gốc */}
                    <div className="text-slate-400 text-[11px] font-serif mb-1 leading-snug">
                      {cue.source_text}
                    </div>

                    {/* Câu dịch Tiếng Việt hoặc Form chỉnh sửa */}
                    {isEditing ? (
                      <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(cue);
                            if (e.key === 'Escape') setEditingCueId(null);
                          }}
                          autoFocus
                          className="flex-1 bg-slate-950 border border-indigo-500 rounded-md px-2 py-1 text-xs text-amber-300 font-medium focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(cue)}
                          className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                          title="Lưu"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCueId(null)}
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
                          title="Hủy"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`text-xs font-medium leading-relaxed ${
                          cue.translated_text
                            ? 'text-amber-300'
                            : 'text-slate-500 italic'
                        }`}
                      >
                        {cue.translated_text || '(Chưa có bản dịch)'}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-slate-500 space-y-2">
                <Subtitles className="w-8 h-8 opacity-30 text-indigo-400" />
                <p className="text-xs">
                  {searchQuery ? 'Không tìm thấy câu phù hợp' : 'Chưa có phụ đề nào. Nhấn "Quét Phụ Đề" để bắt đầu!'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Nội dung Tab: Tập Phim / Media */}
      {activeTab === 'media' && (() => {
        const filteredAndSortedProjects = sortProjectsNaturally(
          mediaSearchQuery.trim()
            ? projects.filter(
                (p) =>
                  p.title.toLowerCase().includes(mediaSearchQuery.toLowerCase()) ||
                  p.project_id.toLowerCase().includes(mediaSearchQuery.toLowerCase())
              )
            : projects,
          sortOrder
        );

        const allVisibleSelected =
          filteredAndSortedProjects.length > 0 &&
          filteredAndSortedProjects.every((p) => selectedProjectIds.includes(p.project_id));

        const handleToggleSelectAll = () => {
          if (allVisibleSelected) {
            const visibleIds = new Set(filteredAndSortedProjects.map((p) => p.project_id));
            setSelectedProjectIds((prev) => prev.filter((id) => !visibleIds.has(id)));
          } else {
            const visibleIds = filteredAndSortedProjects.map((p) => p.project_id);
            setSelectedProjectIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
          }
        };

        const handleToggleProject = (id: string, e: React.MouseEvent) => {
          e.stopPropagation();
          setSelectedProjectIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          );
        };

        return (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-3">
            {/* Header thanh công cụ Tập Phim */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-200">Danh Sách Tập Phim</span>
                <span className="text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded-full border border-slate-800 font-semibold">
                  {filteredAndSortedProjects.length}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {/* Nút Đổi Thứ Tự Sắp Xếp Tự Nhiên */}
                <button
                  type="button"
                  onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition ${
                    sortOrder === 'asc'
                      ? 'bg-slate-900 border-slate-800 text-indigo-400 hover:bg-slate-850'
                      : 'bg-indigo-950/80 border-indigo-700 text-indigo-300'
                  }`}
                  title={`Thứ tự: ${sortOrder === 'asc' ? 'Tập 1 -> N (Tăng dần)' : 'Tập N -> 1 (Giảm dần)'}`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold">{sortOrder === 'asc' ? '1→N' : 'N→1'}</span>
                </button>

                {onPickLocalVideo && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onPickLocalVideo(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition shadow"
                      title="Nạp file video từ máy tính"
                    >
                      <Upload className="w-3 h-3" />
                      <span className="hidden sm:inline">Nạp File</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Ô Tìm kiếm tập phim */}
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={mediaSearchQuery}
                onChange={(e) => setMediaSearchQuery(e.target.value)}
                placeholder="Tìm tập phim (ví dụ: 05, 12, Tập...)"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
              {mediaSearchQuery && (
                <button
                  type="button"
                  onClick={() => setMediaSearchQuery('')}
                  className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Thanh Chọn Tập (Multi-select Bar) */}
            <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 rounded-lg mb-2 text-[11px]">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white font-medium transition cursor-pointer"
              >
                {allVisibleSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>{allVisibleSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
              </button>

              <span className="text-slate-400 font-semibold text-[10px]">
                Đã chọn: <span className="text-indigo-400 font-bold">{selectedProjectIds.length}</span> / {filteredAndSortedProjects.length}
              </span>
            </div>

            {/* Thanh Tác Vụ Khi Có Tập Được Chọn */}
            {selectedProjectIds.length > 0 && (
              <div className="flex items-center gap-1.5 bg-indigo-950/70 border border-indigo-700/60 p-1.5 rounded-lg mb-2 text-xs">
                <span className="text-[10px] text-indigo-300 font-semibold pl-1">
                  Đã chọn ({selectedProjectIds.length}):
                </span>
                {onBatchScanProjects && (
                  <button
                    type="button"
                    onClick={() => onBatchScanProjects(selectedProjectIds)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold transition"
                    title="Quét phụ đề cho các tập đã chọn"
                  >
                    <Scan className="w-3 h-3" />
                    <span>Quét Sub</span>
                  </button>
                )}
                {onBatchTranslateProjects && (
                  <button
                    type="button"
                    onClick={() => onBatchTranslateProjects(selectedProjectIds)}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white text-[10px] font-semibold transition"
                    title="Dịch AI các tập đã chọn"
                  >
                    <Languages className="w-3 h-3" />
                    <span>Dịch AI</span>
                  </button>
                )}
                {onDeleteProject && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm(`Bạn có chắc muốn xóa ${selectedProjectIds.length} tập đã chọn?`)) {
                        for (const id of selectedProjectIds) {
                          onDeleteProject(id);
                        }
                        setSelectedProjectIds([]);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-rose-900/80 hover:bg-rose-800 text-rose-200 text-[10px] font-semibold transition"
                    title="Xóa các tập đã chọn"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Xóa</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedProjectIds([])}
                  className="ml-auto text-slate-400 hover:text-white text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition"
                >
                  Hủy
                </button>
              </div>
            )}

            {/* Danh sách các thẻ tập phim đã tự động sắp xếp */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {filteredAndSortedProjects.map((proj) => {
                const isCurrent = activeProject?.project_id === proj.project_id;
                const isChecked = selectedProjectIds.includes(proj.project_id);

                return (
                  <div
                    key={proj.project_id}
                    onClick={() => onSelectProject(proj)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                      isCurrent
                        ? 'bg-indigo-950/90 border-indigo-500 ring-1 ring-indigo-500/50 shadow-md'
                        : isChecked
                        ? 'bg-slate-900/90 border-indigo-800/80 shadow-sm'
                        : 'bg-slate-900/50 hover:bg-slate-900 border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Hộp kiểm Chọn tập */}
                      <button
                        type="button"
                        onClick={(e) => handleToggleProject(proj.project_id, e)}
                        className="p-1 text-slate-500 hover:text-indigo-400 transition shrink-0 rounded"
                        title={isChecked ? 'Bỏ chọn tập này' : 'Chọn tập này'}
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                        )}
                      </button>

                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          isCurrent
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : isChecked
                            ? 'bg-indigo-900 text-indigo-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Film className="w-3.5 h-3.5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div
                          className={`font-semibold truncate text-xs ${
                            isCurrent ? 'text-white font-bold' : 'text-slate-200'
                          }`}
                        >
                          {proj.title}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{proj.project_id.slice(0, 8)}</span>
                          {proj.cues_count !== undefined && <span>• {proj.cues_count} câu</span>}
                        </div>
                      </div>
                    </div>

                    {isCurrent && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold shrink-0 ml-2">
                        Đang mở
                      </span>
                    )}
                  </div>
                );
              })}

              {filteredAndSortedProjects.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Không tìm thấy tập phim nào khớp với từ khóa.
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* CapCut Desktop Draft Import Modal */}
      {showCapcutModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FolderDown className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Nhập Phụ Đề từ CapCut Desktop Draft</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCapcutModal(false)}
                className="text-slate-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Chọn một dự án CapCut trên máy tính của bạn để trích xuất phụ đề tự động:
            </p>

            {capcutImportMsg && (
              <div className="p-2.5 rounded-lg bg-indigo-950/60 border border-indigo-800/80 text-indigo-300 text-xs text-center font-medium">
                {capcutImportMsg}
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-1.5 text-xs">
              {isLoadingCapcutList ? (
                <div className="p-8 flex items-center justify-center gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Đang quét các dự án CapCut trên máy...</span>
                </div>
              ) : capcutDraftsList.length > 0 ? (
                capcutDraftsList.map((draft, idx) => (
                  <div
                    key={draft.draft_id || idx}
                    onClick={() => handleImportCapcutProject(draft.draft_id)}
                    className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between cursor-pointer transition"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">{draft.name || draft.draft_id}</div>
                      <div className="text-[10px] text-slate-500">{draft.updated_at || 'Cập nhật gần đây'}</div>
                    </div>
                    <button className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-semibold">
                      Nhập
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-500">
                  Không tìm thấy dự án CapCut Desktop nào trong thư mục chuẩn.
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCapcutModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
