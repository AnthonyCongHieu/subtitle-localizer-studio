import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderOpen,
  Crosshair,
  Subtitles,
  Sparkles,
  Download,
  ChevronLeft,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Edit3,
  FlipHorizontal,
  FlipVertical,
  Tv,
  AlignJustify,
  Smartphone,
} from 'lucide-react';
import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import { apiClient } from '../../api/client';

import { AspectRatioType } from '../../types/presets';

export type SidebarTab = 'media' | 'roi' | 'subtitles' | 'ai' | 'export';
export type CueFilterMode = 'all' | 'untranslated' | 'translated';

interface CapcutSidebarProps {
  projects: ProjectManifestV1[];
  activeProject: ProjectManifestV1 | null;
  onSelectProject: (proj: ProjectManifestV1) => void;
  onPickLocalVideo: (file: File) => void;
  region: RegionTrackV1;
  onUpdateRegion: (region: RegionTrackV1) => void;
  onAutoDetectRoi?: () => void;
  cues: SubtitleCueV1[];
  onRefreshCues?: () => void;
  onSeekToCue?: (startPts: number) => void;
  onUpdateCue?: (cue: SubtitleCueV1) => void;
  sourceLang: string;
  targetLang: string;
  onLanguageChange?: (source: string, target: string) => void;
  isFlippedH?: boolean;
  isFlippedV?: boolean;

  aspectRatio?: AspectRatioType;
  onAspectRatioChange?: (ratio: AspectRatioType) => void;
}

const CapcutSidebarComponent: React.FC<CapcutSidebarProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onPickLocalVideo,
  region,
  onUpdateRegion,
  onAutoDetectRoi,
  cues,
  onRefreshCues,
  onSeekToCue,
  onUpdateCue,
  sourceLang,
  targetLang,
  onLanguageChange,
  isFlippedH = false,
  isFlippedV = false,

  aspectRatio = 'original',
  onAspectRatioChange,
}) => {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>('subtitles');
  const [cueFilter, setCueFilter] = useState<CueFilterMode>('all');
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  const [geminiStatus, setGeminiStatus] = useState<{ configured: boolean; masked_key?: string }>({
    configured: false,
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [isExportingMp4, setIsExportingMp4] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [maskMode, setMaskMode] = useState<'blur' | 'box' | 'none'>('blur');
  const [applyFlipToExport, setApplyFlipToExport] = useState<boolean>(true);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Phân loại phụ đề đã thay vs chưa thay
  const isCueTranslated = (cue: SubtitleCueV1) => {
    if (!cue.translated_text || cue.translated_text.trim().length === 0) return false;
    if (cue.translated_text.trim() !== cue.source_text.trim()) return true;
    // Ký tự số hoặc dấu câu (như 1.1, 2025) giữ nguyên trong tiếng Việt vẫn tính là đã dịch
    return /^[\d\s.,:;!?%#\-+*\/()]+$/.test(cue.source_text.trim());
  };

  const translatedCues = useMemo(() => cues.filter(isCueTranslated), [cues]);
  const untranslatedCues = useMemo(() => cues.filter((c) => !isCueTranslated(c)), [cues]);

  const filteredCues = useMemo(() => {
    if (cueFilter === 'translated') return translatedCues;
    if (cueFilter === 'untranslated') return untranslatedCues;
    return cues;
  }, [cues, cueFilter, translatedCues, untranslatedCues]);

  // Nạp trạng thái Gemini API Key khi mở tab AI
  useEffect(() => {
    if (activeTab === 'ai') {
      apiClient.getGeminiStatus().then(setGeminiStatus).catch(() => {});
    }
  }, [activeTab]);

  const handleSaveGeminiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsSavingKey(true);
    setKeyMessage(null);
    try {
      await apiClient.setGeminiKey(apiKeyInput.trim());
      setGeminiStatus({ configured: true, masked_key: '••••••••' + apiKeyInput.slice(-4) });
      setKeyMessage('Đã lưu Gemini API Key thành công!');
      setApiKeyInput('');
    } catch (err: any) {
      setKeyMessage(`Lỗi: ${err?.message || 'Không thể lưu API Key'}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleExportMp4 = async () => {
    if (!activeProject) return;
    setIsExportingMp4(true);
    setExportMessage(null);
    try {
      setExportMessage('Đang kết xuất video MP4 gắn phụ đề...');
      const res = await apiClient.exportMp4(activeProject.project_id, {
        use_translated: true,
        mask_mode: maskMode,
      });
      setExportMessage(`Xuất video thành công: ${res.output_path}`);
    } catch (err: any) {
      setExportMessage(`Lỗi xuất video: ${err?.message || 'Không thành công'}`);
    } finally {
      setIsExportingMp4(false);
    }
  };

  // Bắt đầu chỉnh sửa câu phụ đề
  const handleStartEditCue = (cue: SubtitleCueV1) => {
    setEditingCueId(cue.cue_id);
    setEditingText(cue.translated_text || '');
  };

  // Lưu nội dung câu phụ đề sau khi sửa và cập nhật trạng thái "Đã thay"
  const handleSaveCueEdit = (cue: SubtitleCueV1) => {
    if (onUpdateCue) {
      onUpdateCue({
        ...cue,
        translated_text: editingText.trim(),
        status: 'reviewed',
      });
    }
    setEditingCueId(null);
  };

  // Áp dụng cấu hình mẫu vùng quét phụ đề
  const applyPreset = (type: 'one_line' | 'two_lines' | 'tiktok_portrait') => {
    switch (type) {
      case 'one_line':
        onUpdateRegion({
          ...region,
          x: 0.08,
          y: 0.82,
          width: 0.84,
          height: 0.12,
        });
        break;
      case 'two_lines':
        onUpdateRegion({
          ...region,
          x: 0.08,
          y: 0.74,
          width: 0.84,
          height: 0.2,
        });
        break;
      case 'tiktok_portrait':
        onUpdateRegion({
          ...region,
          x: 0.1,
          y: 0.65,
          width: 0.8,
          height: 0.15,
        });
        break;
    }
  };

  // Căn chỉnh thanh trượt ROI
  const handleSliderY = (val: number) => {
    onUpdateRegion({
      ...region,
      y: parseFloat((val / 100).toFixed(4)),
    });
  };

  const handleSliderH = (val: number) => {
    onUpdateRegion({
      ...region,
      height: parseFloat((val / 100).toFixed(4)),
    });
  };

  const handleSliderW = (val: number) => {
    const w = val / 100;
    const x = Math.max(0, (1.0 - w) / 2);
    onUpdateRegion({
      ...region,
      x: parseFloat(x.toFixed(4)),
      width: parseFloat(w.toFixed(4)),
    });
  };

  return (
    <div className="flex h-full shrink-0 z-30 select-none">
      {/* 1. Thanh Icon Dọc (CapCut Navigation Rail) */}
      <div className="w-16 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-3 gap-2 shrink-0">
        <button
          onClick={() => setActiveTab(activeTab === 'media' ? null : 'media')}
          className={`w-12 py-2 flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition ${
            activeTab === 'media'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="Phương tiện & Dự án"
        >
          <FolderOpen className="w-4 h-4" />
          <span>Media</span>
        </button>

        <button
          onClick={() => setActiveTab(activeTab === 'roi' ? null : 'roi')}
          className={`w-12 py-2 flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition ${
            activeTab === 'roi'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="Vùng quét phụ đề (ROI)"
        >
          <Crosshair className="w-4 h-4" />
          <span>Vùng Quét</span>
        </button>

        <button
          onClick={() => setActiveTab(activeTab === 'subtitles' ? null : 'subtitles')}
          className={`w-12 py-2 flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition relative ${
            activeTab === 'subtitles'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="Danh sách phụ đề đã thay / chưa thay"
        >
          <Subtitles className="w-4 h-4" />
          <span>Phụ Đề</span>
          {untranslatedCues.length > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" />
          )}
        </button>

        <button
          onClick={() => setActiveTab(activeTab === 'ai' ? null : 'ai')}
          className={`w-12 py-2 flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition ${
            activeTab === 'ai'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="AI Dịch thuật & Cài đặt API"
        >
          <Sparkles className="w-4 h-4" />
          <span>AI Dịch</span>
        </button>

        <button
          onClick={() => setActiveTab(activeTab === 'export' ? null : 'export')}
          className={`w-12 py-2 flex flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition ${
            activeTab === 'export'
              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
          title="Xuất file phụ đề và video"
        >
          <Download className="w-4 h-4" />
          <span>Xuất Bản</span>
        </button>
      </div>

      {/* 2. Bảng Chi Tiết (Drawer Panel CapCut - 320px) */}
      {activeTab && (
        <div className="w-80 bg-slate-900/95 border-r border-slate-800 flex flex-col shrink-0 overflow-hidden shadow-2xl animate-in slide-in-from-left-2 duration-150">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-1.5">
              {activeTab === 'media' && <><FolderOpen className="w-3.5 h-3.5 text-indigo-400" /> Media & Dự Án</>}
              {activeTab === 'roi' && <><Crosshair className="w-3.5 h-3.5 text-indigo-400" /> Vùng Quét Phụ Đề</>}
              {activeTab === 'subtitles' && <><Subtitles className="w-3.5 h-3.5 text-indigo-400" /> Phụ Đề ({cues.length})</>}
              {activeTab === 'ai' && <><Sparkles className="w-3.5 h-3.5 text-indigo-400" /> AI Dịch & Cấu Hình</>}
              {activeTab === 'export' && <><Download className="w-3.5 h-3.5 text-indigo-400" /> Xuất Bản</>}
            </h3>
            <button
              onClick={() => setActiveTab(null)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800"
              title="Thu gọn bảng điều khiển"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Thân bảng chi tiết */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {/* PANEL PHỤ ĐỀ: XEM CỤ THỂ ĐÃ THAY VS CHƯA THAY */}
            {activeTab === 'subtitles' && (
              <div className="space-y-3">
                {/* 3 Tab lọc trạng thái */}
                <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                  <button
                    onClick={() => setCueFilter('all')}
                    className={`flex-1 py-1 rounded font-medium transition ${
                      cueFilter === 'all'
                        ? 'bg-slate-800 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Tất cả ({cues.length})
                  </button>
                  <button
                    onClick={() => setCueFilter('untranslated')}
                    className={`flex-1 py-1 rounded font-medium transition flex items-center justify-center gap-1 ${
                      cueFilter === 'untranslated'
                        ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 shadow'
                        : 'text-slate-400 hover:text-amber-300'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>Chưa thay ({untranslatedCues.length})</span>
                  </button>
                  <button
                    onClick={() => setCueFilter('translated')}
                    className={`flex-1 py-1 rounded font-medium transition flex items-center justify-center gap-1 ${
                      cueFilter === 'translated'
                        ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 shadow'
                        : 'text-slate-400 hover:text-emerald-300'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Đã thay ({translatedCues.length})</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">
                    Hiển thị: <strong>{filteredCues.length}</strong> câu
                  </span>
                  {onRefreshCues && (
                    <button
                      onClick={onRefreshCues}
                      className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Làm mới</span>
                    </button>
                  )}
                </div>

                {/* Danh sách câu phụ đề */}
                {filteredCues.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 border border-dashed border-slate-800 rounded-lg">
                    {cues.length === 0
                      ? 'Chưa có phụ đề nào. Bấm "Bắt Đầu Quét Sub" để tạo phụ đề.'
                      : 'Không có câu phụ đề nào thuộc bộ lọc này.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                    {filteredCues.map((cue, idx) => {
                      const isTranslated = isCueTranslated(cue);
                      const isEditing = editingCueId === cue.cue_id;

                      return (
                        <div
                          key={cue.cue_id || idx}
                          onClick={() => onSeekToCue && onSeekToCue(cue.start_pts)}
                          className={`p-2.5 rounded-lg border transition space-y-1.5 cursor-pointer ${
                            isTranslated
                              ? 'bg-slate-950/60 border-slate-800 hover:border-emerald-500/50'
                              : 'bg-amber-950/20 border-amber-900/40 hover:border-amber-500/50'
                          }`}
                        >
                          {/* Header câu: Số thứ tự, Timecode, Badge Đã thay / Chưa thay */}
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-slate-400 font-bold">#{idx + 1}</span>
                            <span className="text-slate-500">
                              {cue.start_pts.toFixed(1)}s → {cue.end_pts.toFixed(1)}s
                            </span>
                            {isTranslated ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-semibold flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                <span>Đã thay</span>
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 font-semibold flex items-center gap-1">
                                <AlertCircle className="w-2.5 h-2.5" />
                                <span>Chưa thay</span>
                              </span>
                            )}
                          </div>

                          {/* Văn bản gốc */}
                          <div className="text-slate-400 text-[11px] leading-relaxed line-clamp-2">
                            {cue.source_text}
                          </div>

                          {/* Bản dịch tiếng Việt (có thể sửa trực tiếp) */}
                          {isEditing ? (
                            <div
                              className="space-y-1.5 pt-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editingText}
                                autoFocus
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveCueEdit(cue);
                                  if (e.key === 'Escape') setEditingCueId(null);
                                }}
                                className="w-full bg-slate-900 border border-indigo-500 rounded p-1.5 text-xs text-yellow-300 font-medium focus:outline-none"
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingCueId(null)}
                                  className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px]"
                                >
                                  Hủy
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveCueEdit(cue)}
                                  className="px-2 py-0.5 rounded bg-indigo-600 text-white font-medium text-[10px]"
                                >
                                  Lưu câu
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditCue(cue);
                              }}
                              className="group flex items-start justify-between gap-1 text-[11px] font-medium text-yellow-300 bg-slate-900/60 p-1.5 rounded border border-slate-800/80 hover:border-indigo-500/50 transition cursor-text"
                              title="Bấm vào để chỉnh sửa nhanh câu dịch này"
                            >
                              <span className="line-clamp-2">
                                {cue.translated_text || '(Chưa có bản dịch)'}
                              </span>
                              <Edit3 className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* PANEL XUẤT BẢN CÓ CHECKBOX LẬT VIDEO */}
            {activeTab === 'export' && (
              <div className="space-y-4">
                {activeProject ? (
                  <>
                    <div className="space-y-2">
                      <span className="text-slate-400 font-medium block">Tải file phụ đề rời:</span>
                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href={apiClient.getExportSrtUrl(activeProject.project_id)}
                          download
                          className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500 text-center text-slate-200 font-medium block transition"
                        >
                          Tải file .SRT
                        </a>
                        <a
                          href={apiClient.getExportAssUrl(activeProject.project_id)}
                          download
                          className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500 text-center text-slate-200 font-medium block transition"
                        >
                          Tải file .ASS
                        </a>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-slate-800">
                      <span className="text-slate-400 font-medium block">Cài đặt Kết Xuất MP4:</span>

                      {/* Tùy chọn lật video khi xuất để lách bản quyền */}
                      <label className="flex items-start gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-indigo-500/50 transition">
                        <input
                          type="checkbox"
                          checked={applyFlipToExport}
                          onChange={(e) => setApplyFlipToExport(e.target.checked)}
                          className="mt-0.5 rounded accent-indigo-600"
                        />
                        <div className="text-[11px] space-y-0.5">
                          <span className="text-white font-medium block flex items-center gap-1">
                            <span>Áp dụng lật video vào MP4 xuất ra</span>
                            {isFlippedH && <FlipHorizontal className="w-3 h-3 text-indigo-400" />}
                            {isFlippedV && <FlipVertical className="w-3 h-3 text-indigo-400" />}
                          </span>
                          <span className="text-slate-500 block text-[10px]">
                            {isFlippedH || isFlippedV
                              ? 'Sẽ render video lật ngang/dọc qua FFmpeg để lách bản quyền video.'
                              : 'Hiện video chưa bật chế độ lật (có thể bật trên thanh Player).'}
                          </span>
                        </div>
                      </label>

                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Kiểu che phụ đề gốc:</label>
                        <select
                          value={maskMode}
                          onChange={(e: any) => setMaskMode(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-slate-200"
                        >
                          <option value="blur">Làm mờ (Blur Sub Gốc)</option>
                          <option value="box">Hộp đen (Black Box)</option>
                          <option value="none">Không che</option>
                        </select>
                      </div>

                      <button
                        onClick={handleExportMp4}
                        disabled={isExportingMp4}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition shadow disabled:opacity-50"
                      >
                        {isExportingMp4 ? 'Đang Render Video...' : 'Xuất Video MP4 Hoàn Chỉnh'}
                      </button>

                      {exportMessage && (
                        <div className="text-[11px] text-indigo-300 mt-1 break-all bg-slate-950 p-2 rounded border border-slate-800">
                          {exportMessage}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-6 text-slate-500">
                    Chọn một dự án để sử dụng tính năng xuất bản.
                  </div>
                )}
              </div>
            )}

            {/* PANEL VÙNG QUÉT ROI */}
            {activeTab === 'roi' && (
              <div className="space-y-4">
                {onAutoDetectRoi && (
                  <button
                    onClick={onAutoDetectRoi}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold flex items-center justify-center gap-1.5 transition shadow"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>🎯 Tự Bắt Dính Chữ</span>
                  </button>
                )}

                {/* Tỉ Lệ Khung Hình Canvas */}
                {onAspectRatioChange && (
                  <div className="space-y-1.5">
                    <label className="text-slate-400 font-medium block text-[11px]">Tỉ lệ khung hình (Aspect Ratio):</label>
                    <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
                      {[
                        { id: 'original', label: 'Gốc' },
                        { id: '16:9', label: '16:9 (Ngang)' },
                        { id: '9:16', label: '9:16 (Dọc)' },
                        { id: '1:1', label: '1:1 (Vuông)' },
                        { id: '4:3', label: '4:3' },
                        { id: '2.35:1', label: '2.35:1' },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onAspectRatioChange(item.id as AspectRatioType)}
                          className={`p-1.5 rounded-lg border text-center transition ${
                            aspectRatio === item.id
                              ? 'bg-indigo-600/30 border-indigo-500 text-white font-bold'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cụm Preset Mẫu Vùng Quét */}
                <div className="space-y-1.5">
                  <label className="text-slate-400 font-medium block text-[11px]">Vùng quét mẫu sẵn:</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyPreset('one_line')}
                      className="p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500/70 hover:text-white text-slate-300 flex flex-col items-center gap-1 transition text-[11px]"
                      title="Phụ đề 1 dòng ở đáy video"
                    >
                      <Tv className="w-3.5 h-3.5 text-indigo-400" />
                      <span>1 Dòng</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('two_lines')}
                      className="p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500/70 hover:text-white text-slate-300 flex flex-col items-center gap-1 transition text-[11px]"
                      title="Phụ đề 2 dòng ở đáy video"
                    >
                      <AlignJustify className="w-3.5 h-3.5 text-indigo-400" />
                      <span>2 Dòng</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('tiktok_portrait')}
                      className="p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500/70 hover:text-white text-slate-300 flex flex-col items-center gap-1 transition text-[11px]"
                      title="Phụ đề cho video dọc TikTok/Reels"
                    >
                      <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Dọc TikTok</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Vị trí dọc (Y):</span>
                      <span className="text-indigo-400 font-mono font-bold">{Math.round(region.y * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="95"
                      value={Math.round(region.y * 100)}
                      onChange={(e) => handleSliderY(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Chiều cao (H):</span>
                      <span className="text-indigo-400 font-mono font-bold">{Math.round(region.height * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="35"
                      value={Math.round(region.height * 100)}
                      onChange={(e) => handleSliderH(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Chiều rộng (W):</span>
                      <span className="text-indigo-400 font-mono font-bold">{Math.round(region.width * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      value={Math.round(region.width * 100)}
                      onChange={(e) => handleSliderW(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </div>

                {/* Nút Căn Giữa Chuẩn Phụ Đề Nhanh */}
                <button
                  type="button"
                  onClick={() => onUpdateRegion({
                    region_id: 'roi-main',
                    x: 0.06,
                    y: 0.81,
                    width: 0.88,
                    height: 0.15,
                  })}
                  className="w-full py-1.5 px-2 bg-indigo-950/40 hover:bg-indigo-900/60 text-indigo-300 rounded-lg text-[11px] font-semibold transition flex items-center justify-center gap-1.5 border border-indigo-500/40 shadow-sm"
                  title="Căn giữa toàn màn hình chuẩn dòng phụ đề"
                >
                  <Crosshair className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Căn giữa chuẩn phụ đề (Khuyến nghị)</span>
                </button>


                {/* Kiểu che phụ đề gốc đã chuyển lên Toolbar (dropdown đầy đủ 9 kiểu) */}
              </div>
            )}

            {/* PANEL MEDIA */}
            {activeTab === 'media' && (
              <div className="space-y-4">
                <div>
                  <label className="text-slate-400 block mb-2 font-medium">Tải video mới từ máy tính:</label>
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
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium flex items-center justify-center gap-1.5 transition shadow"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Chọn File Video (.mp4)</span>
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <label className="text-slate-400 block mb-2 font-medium">Dự án trên máy chủ ({projects.length}):</label>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {projects.map((p) => (
                      <div
                        key={p.project_id}
                        onClick={() => onSelectProject(p)}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex flex-col gap-1 ${
                          activeProject?.project_id === p.project_id
                            ? 'bg-indigo-950/40 border-indigo-500/60 text-white'
                            : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="font-medium truncate">{p.title}</div>
                        <div className="text-[10px] text-slate-500 flex items-center justify-between">
                          <span>{p.source_language} → {p.target_language}</span>
                          <span>{p.cues_count || 0} câu sub</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* PANEL AI DỊCH THUẬT */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-slate-400 block font-medium">Ngôn ngữ nguồn → đích:</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={sourceLang}
                      onChange={(e) => onLanguageChange && onLanguageChange(e.target.value, targetLang)}
                      className="bg-slate-950 border border-slate-800 rounded p-1.5 text-slate-200"
                    >
                      <option value="zh">Tiếng Trung (zh)</option>
                      <option value="en">Tiếng Anh (en)</option>
                      <option value="ja">Tiếng Nhật (ja)</option>
                      <option value="ko">Tiếng Hàn (ko)</option>
                    </select>

                    <select
                      value={targetLang}
                      onChange={(e) => onLanguageChange && onLanguageChange(sourceLang, e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded p-1.5 text-slate-200"
                    >
                      <option value="vi">Tiếng Việt (vi)</option>
                      <option value="en">Tiếng Anh (en)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Gemini API Key:</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${geminiStatus.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                      {geminiStatus.configured ? 'Đã cấu hình' : 'Chưa có'}
                    </span>
                  </div>

                  <input
                    type="password"
                    placeholder="Dán khóa API AI..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                  />

                  <button
                    onClick={handleSaveGeminiKey}
                    disabled={isSavingKey || !apiKeyInput.trim()}
                    className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium disabled:opacity-50 transition"
                  >
                    {isSavingKey ? 'Đang lưu...' : 'Lưu API Key'}
                  </button>

                  {keyMessage && (
                    <div className="text-[11px] text-indigo-400 mt-1">{keyMessage}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const CapcutSidebar = React.memo(CapcutSidebarComponent);

