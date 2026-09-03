import React, { useState } from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';
import { Download, CheckCircle2, Play, X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  project: ProjectManifestV1;
  onClose: () => void;
  onViewRendered?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  project,
  onClose,
  onViewRendered,
}) => {
  const [exportType, setExportType] = useState<'srt' | 'ass' | 'mp4'>('srt');
  const [useTranslated, setUseTranslated] = useState(true);
  const [maskMode, setMaskMode] = useState<'box' | 'blur' | 'none'>('blur');
  const [isExporting, setIsExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [renderedSuccess, setRenderedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleDownloadSrt = () => {
    const url = apiClient.getExportSrtUrl(project.project_id, useTranslated);
    window.open(url, '_blank');
  };

  const handleDownloadAss = () => {
    const url = apiClient.getExportAssUrl(project.project_id, useTranslated);
    window.open(url, '_blank');
  };

  const handleExport = async () => {
    if (exportType === 'srt') {
      handleDownloadSrt();
      onClose();
    } else if (exportType === 'ass') {
      handleDownloadAss();
      onClose();
    } else {
      setIsExporting(true);
      setMessage('Đang render video MP4 bằng FFmpeg (che sub gốc + đè sub tiếng Việt)...');
      try {
        await apiClient.exportMp4(project.project_id, {
          use_translated: useTranslated,
          mask_mode: maskMode,
        });
        setMessage(`✓ Render hoàn tất! File video thành phẩm đã sẵn sàng.`);
        setRenderedSuccess(true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Lỗi render không xác định';
        setMessage(`Lỗi render MP4: ${detail}`);
      } finally {
        setIsExporting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <Download className="w-4 h-4 text-indigo-400" />
            <span>Xuất Phụ Đề & Video Thành Phẩm</span>
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {message && (
          <div className="p-3 bg-indigo-950/60 border border-indigo-800 text-indigo-200 text-xs rounded-lg">
            {message}
          </div>
        )}

        <div className="space-y-4 text-xs">
          {/* Định dạng xuất */}
          <div>
            <label className="block text-zinc-400 font-medium mb-2">Chọn định dạng xuất:</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setExportType('srt')}
                className={`p-3 rounded-lg border text-center font-medium transition-all ${
                  exportType === 'srt'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-bold text-sm">.SRT</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">SubRip chuẩn</div>
              </button>

              <button
                type="button"
                onClick={() => setExportType('ass')}
                className={`p-3 rounded-lg border text-center font-medium transition-all ${
                  exportType === 'ass'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-bold text-sm">.ASS</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Tùy biến Style</div>
              </button>

              <button
                type="button"
                onClick={() => setExportType('mp4')}
                className={`p-3 rounded-lg border text-center font-medium transition-all ${
                  exportType === 'mp4'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-bold text-sm">.MP4</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">Hardsub + Che</div>
              </button>
            </div>
          </div>

          {/* Tùy chọn nội dung phụ đề */}
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <label className="block text-zinc-400 font-medium">Nội dung văn bản:</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="radio"
                  name="subText"
                  checked={useTranslated}
                  onChange={() => setUseTranslated(true)}
                  className="text-indigo-600 focus:ring-0"
                />
                <span>Bản dịch tiếng Việt</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="radio"
                  name="subText"
                  checked={!useTranslated}
                  onChange={() => setUseTranslated(false)}
                  className="text-indigo-600 focus:ring-0"
                />
                <span>Văn bản gốc (OCR)</span>
              </label>
            </div>
          </div>

          {/* Tùy chọn Masking khi xuất MP4 */}
          {exportType === 'mp4' && (
            <div className="space-y-2 pt-2 border-t border-zinc-800/80">
              <label className="block text-zinc-400 font-medium">Kiểu che phụ đề gốc:</label>
              <select
                value={maskMode}
                onChange={(e: any) => setMaskMode(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="box">Hộp đen mờ che đè (Solid/Translucent Box)</option>
                <option value="blur">Làm mờ vùng chữ cũ (Gaussian Blur)</option>
                <option value="none">Không che (Chỉ đè subtitle mới lên trên)</option>
              </select>
            </div>
          )}
        </div>

        {renderedSuccess && (
          <div className="p-3 bg-emerald-950/50 border border-emerald-800 rounded-xl space-y-2">
            <div className="text-emerald-300 font-medium text-[11px] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Video đã render xong với phụ đề tiếng Việt và làm mờ chữ gốc!</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onViewRendered?.();
                  onClose();
                }}
                className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Xem Ngay Trong Studio</span>
              </button>
              <a
                href={apiClient.getRenderedVideoUrl(project.project_id, true)}
                download={`${project.title}-localized.mp4`}
                className="py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 text-center transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải File MP4 Về Máy</span>
              </a>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            {isExporting ? 'Đang xuất...' : exportType === 'mp4' ? 'Render Video MP4' : 'Tải File Về Máy'}
          </button>
        </div>
      </div>
    </div>
  );
};
