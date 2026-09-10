import React, { useCallback, useRef, useState } from 'react';
import {
  Film,
  FolderOpen,
  Link2,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { focusRing } from './LanUi';

/* ==========================================================================
 * Kiểu dữ liệu cho popup Thêm Job
 * 3 con đường tạo job: Local File, Link URL, Batch (lô video theo bộ phim)
 * ======================================================================== */

export type CreateJobMode = 'local' | 'url' | 'batch';

export interface CreateJobPayload {
  mode: CreateJobMode;
  /** Dùng cho mode='local': file video từ máy */
  localFile?: File;
  /** Dùng cho mode='url': link tải video */
  videoUrl?: string;
  /** Dùng cho mode='batch': danh sách URL hoặc file theo tập phim */
  batchItems?: BatchItem[];
  /** Tên dự án/bộ phim (optional, dùng cho batch) */
  seriesName?: string;
  /** Loại job pipeline */
  jobType?: string;
}

export interface BatchItem {
  id: string;
  /** Tên tập / episode label */
  label: string;
  /** URL hoặc đường dẫn file */
  source: string;
  /** local hoặc url */
  sourceType: 'local' | 'url';
  /** File object nếu chọn từ máy */
  file?: File;
}

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateJobPayload) => void;
  isSubmitting?: boolean;
}

const TABS: { id: CreateJobMode; label: string; icon: React.ElementType; desc: string }[] = [
  {
    id: 'local',
    label: 'Video Trên Máy',
    icon: Upload,
    desc: 'Chọn file video có sẵn trên ổ đĩa máy tính',
  },
  {
    id: 'url',
    label: 'Link Tải Video',
    icon: Link2,
    desc: 'Nhập URL để hệ thống tải video từ internet',
  },
  {
    id: 'batch',
    label: 'Lô Video Theo Bộ Phim',
    icon: FolderOpen,
    desc: 'Thêm nhiều tập phim cùng lúc (batch)',
  },
];

const JOB_TYPES = [
  { value: 'ocr', label: 'OCR (Bóc phụ đề)' },
  { value: 'full_pipeline', label: 'Full Pipeline (OCR → Dịch → Render)' },
  { value: 'translation', label: 'Dịch thuật (Translation)' },
  { value: 'dubbing', label: 'Lồng tiếng (Dubbing)' },
];

let batchIdCounter = 0;
function nextBatchId(): string {
  return `batch-${Date.now()}-${++batchIdCounter}`;
}

export const CreateJobModal: React.FC<CreateJobModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
}) => {
  const [mode, setMode] = useState<CreateJobMode>('local');
  const [jobType, setJobType] = useState('full_pipeline');

  // State cho mode='local'
  const [localFile, setLocalFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State cho mode='url'
  const [videoUrl, setVideoUrl] = useState('');

  // State cho mode='batch'
  const [seriesName, setSeriesName] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  // Reset form khi chuyển tab
  const handleSwitchMode = useCallback((newMode: CreateJobMode) => {
    setMode(newMode);
  }, []);

  // Xử lý chọn file local
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setLocalFile(file);
  }, []);

  // Xử lý thêm batch item bằng URL
  const addBatchUrl = useCallback(() => {
    setBatchItems((prev) => [
      ...prev,
      {
        id: nextBatchId(),
        label: `Tập ${prev.length + 1}`,
        source: '',
        sourceType: 'url',
      },
    ]);
  }, []);

  // Xử lý thêm batch items bằng file
  const handleBatchFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBatchItems((prev) => [
      ...prev,
      ...files.map((file, i) => ({
        id: nextBatchId(),
        label: `Tập ${prev.length + i + 1}`,
        source: file.name,
        sourceType: 'local' as const,
        file,
      })),
    ]);
    // Reset input để có thể chọn lại cùng file
    e.target.value = '';
  }, []);

  // Cập nhật batch item
  const updateBatchItem = useCallback((id: string, field: keyof BatchItem, value: string) => {
    setBatchItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }, []);

  // Xóa batch item
  const removeBatchItem = useCallback((id: string) => {
    setBatchItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Kiểm tra form hợp lệ trước khi submit
  const isValid = (() => {
    if (mode === 'local') return Boolean(localFile);
    if (mode === 'url') return videoUrl.trim().length > 0;
    if (mode === 'batch') return batchItems.length > 0 && batchItems.every((item) => item.source.trim().length > 0);
    return false;
  })();

  // Submit
  const handleSubmit = useCallback(() => {
    if (!isValid || isSubmitting) return;
    const payload: CreateJobPayload = {
      mode,
      jobType,
    };
    if (mode === 'local' && localFile) {
      payload.localFile = localFile;
    } else if (mode === 'url') {
      payload.videoUrl = videoUrl.trim();
    } else if (mode === 'batch') {
      payload.batchItems = batchItems;
      payload.seriesName = seriesName.trim() || undefined;
    }
    onSubmit(payload);
  }, [isValid, isSubmitting, mode, jobType, localFile, videoUrl, batchItems, seriesName, onSubmit]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        // Đóng modal khi click vùng ngoài
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50"
        role="dialog"
        aria-label="Thêm Job mới"
      >
        {/* ===== Header ===== */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 backdrop-blur-md px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-600 shadow-md shadow-indigo-600/30">
              <Plus className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Thêm Job Mới</h2>
              <p className="text-xs text-slate-400">Chọn nguồn video và loại tác vụ xử lý</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className={`rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ${focusRing}`}
            title="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* ===== Chọn nguồn video (3 tabs) ===== */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Nguồn Video
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleSwitchMode(tab.id)}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3.5 text-center transition-all ${focusRing} ${
                      isActive
                        ? 'border-indigo-500/60 bg-indigo-600/15 text-white shadow-sm'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`}
                    />
                    <span className="text-xs font-semibold">{tab.label}</span>
                    <span className="text-[10px] leading-tight text-slate-500">{tab.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ===== Nội dung theo từng mode ===== */}

          {/* --- MODE: Local File --- */}
          {mode === 'local' && (
            <div className="space-y-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Chọn File Video Từ Máy
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileChange}
                className="hidden"
              />
              {localFile ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4">
                  <Film className="h-8 w-8 text-emerald-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{localFile.name}</p>
                    <p className="text-xs text-slate-400">
                      {(localFile.size / 1024 / 1024).toFixed(1)} MB · {localFile.type || 'video/*'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setLocalFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className={`rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300 transition-colors ${focusRing}`}
                    title="Bỏ chọn file"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex w-full items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/40 px-4 py-8 text-sm font-medium text-slate-400 transition-colors hover:border-indigo-500/50 hover:bg-indigo-950/10 hover:text-slate-200 ${focusRing}`}
                >
                  <Upload className="h-5 w-5" />
                  Nhấn để chọn file video (.mp4, .mkv, .avi…)
                </button>
              )}
            </div>
          )}

          {/* --- MODE: URL Link --- */}
          {mode === 'url' && (
            <div className="space-y-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Nhập URL Video
              </label>
              <div className="relative">
                <Link2 className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <input
                  type="url"
                  placeholder="https://example.com/video.mp4 hoặc Douyin/TikTok link..."
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className={`w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 ${focusRing}`}
                />
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Hỗ trợ link trực tiếp (.mp4, .mkv) và link nền tảng video (Douyin, TikTok, YouTube…).
                Worker sẽ tự động tải video từ URL này trước khi xử lý.
              </p>
            </div>
          )}

          {/* --- MODE: Batch (Lô video theo bộ phim) --- */}
          {mode === 'batch' && (
            <div className="space-y-4">
              {/* Tên bộ phim */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Tên Bộ Phim / Series (tuỳ chọn)
                </label>
                <input
                  type="text"
                  placeholder="VD: Thiên Long Bát Bộ 2024, Đại Chiến Tiên Giới…"
                  value={seriesName}
                  onChange={(e) => setSeriesName(e.target.value)}
                  className={`w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 ${focusRing}`}
                />
              </div>

              {/* Danh sách các tập */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Danh Sách Tập ({batchItems.length} tập)
                </label>

                {batchItems.length > 0 && (
                  <div className="space-y-2 mb-3 max-h-60 overflow-y-auto pr-1">
                    {batchItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-[10px] font-bold text-slate-300">
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          placeholder="Tên tập"
                          value={item.label}
                          onChange={(e) => updateBatchItem(item.id, 'label', e.target.value)}
                          className={`w-24 shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 ${focusRing}`}
                        />
                        {item.sourceType === 'url' ? (
                          <input
                            type="url"
                            placeholder="Nhập URL video tập này…"
                            value={item.source}
                            onChange={(e) => updateBatchItem(item.id, 'source', e.target.value)}
                            className={`min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 ${focusRing}`}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-emerald-300" title={item.source}>
                            📁 {item.source}
                          </span>
                        )}
                        <button
                          onClick={() => removeBatchItem(item.id)}
                          className={`shrink-0 rounded-lg p-1 text-slate-500 hover:bg-rose-950/60 hover:text-rose-300 transition-colors ${focusRing}`}
                          title="Xoá tập này"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Nút thêm tập */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={addBatchUrl}
                    className={`flex items-center gap-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-medium text-slate-400 hover:border-indigo-500/50 hover:text-indigo-300 transition-colors ${focusRing}`}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    + Thêm URL tập
                  </button>
                  <input
                    ref={batchFileInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={handleBatchFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => batchFileInputRef.current?.click()}
                    className={`flex items-center gap-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2 text-xs font-medium text-slate-400 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors ${focusRing}`}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    + Chọn file từ máy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== Loại Job (chung cho cả 3 mode) ===== */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Loại Tác Vụ
            </label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className={`w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white ${focusRing}`}
            >
              {JOB_TYPES.map((jt) => (
                <option key={jt.value} value={jt.value}>
                  {jt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ===== Footer ===== */}
        <div className="sticky bottom-0 flex items-center justify-between border-t border-slate-800 bg-slate-900/95 backdrop-blur-md px-6 py-4">
          <p className="text-[11px] text-slate-500">
            {mode === 'local' && (localFile ? `1 file đã chọn` : 'Chưa chọn file')}
            {mode === 'url' && (videoUrl ? 'URL đã nhập' : 'Chưa nhập URL')}
            {mode === 'batch' && `${batchItems.length} tập trong danh sách`}
          </p>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className={`rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors ${focusRing}`}
            >
              Huỷ bỏ
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
              className={`flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/25 transition-all hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Đang tạo…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {mode === 'batch' ? `Tạo ${batchItems.length} Job` : 'Tạo Job'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
