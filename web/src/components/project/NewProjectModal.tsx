import React, { useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: ProjectManifestV1) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploadStatus(`⏳ Đang tải video lên server (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);
    setLoading(true);

    try {
      const res = await apiClient.uploadVideo(file);
      setVideoPath(res.path);
      setUploadStatus(`✓ Đã tải video lên thành công: ${res.filename}`);

      if (!title) {
        setTitle(file.name.replace(/\.[^/.]+$/, ''));
      }
    } catch (err: any) {
      setError(`Lỗi tải video lên server: ${err.message}. Bạn có thể nhập đường dẫn thủ công bên dưới.`);
      setVideoPath(file.name);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Vui lòng nhập tên dự án');
      return;
    }
    if (!videoPath.trim()) {
      setError('Vui lòng chọn file video hoặc nhập đường dẫn video');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const project = await apiClient.createProject({
        title: title.trim(),
        source_video_path: videoPath.trim(),
        source_language: sourceLang,
        target_language: targetLang,
      });
      onCreated(project);
      // Reset form
      setTitle('');
      setVideoPath('');
      setUploadStatus(null);
      setSourceLang('zh');
      setTargetLang('vi');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Lỗi tạo dự án');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <span>🎬</span> Tạo dự án phụ đề mới
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 text-xs rounded-lg">
            {error}
          </div>
        )}

        {uploadStatus && !error && (
          <div className="p-3 bg-indigo-950/60 border border-indigo-800 text-indigo-300 text-xs rounded-lg animate-pulse">
            {uploadStatus}
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4 text-sm">
          {/* Tên dự án */}
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">Tên dự án</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phim tài liệu lịch sử 01"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Video nguồn */}
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">
              Video nguồn (Hard Subtitle)
            </label>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mkv,.avi,.mov,.webm,.ts,.flv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full px-3 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium text-xs transition-colors border border-zinc-700 border-dashed flex items-center justify-center gap-2 shadow-inner"
            >
              <span className="text-base">📁</span>
              <span>{loading ? 'Đang xử lý...' : 'Click để chọn video từ máy tính...'}</span>
            </button>

            <div className="mt-2">
              <span className="text-[11px] text-zinc-500 block mb-1">Hoặc dán đường dẫn file trên máy:</span>
              <input
                type="text"
                value={videoPath}
                onChange={(e) => {
                  setVideoPath(e.target.value);
                  if (!title && e.target.value) {
                    const parts = e.target.value.replace(/\\/g, '/').split('/');
                    const fileName = parts[parts.length - 1];
                    setTitle(fileName.replace(/\.[^/.]+$/, ''));
                  }
                }}
                placeholder="D:/Videos/sample.mp4"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
              />
            </div>
          </div>

          {/* Ngôn ngữ */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Ngôn ngữ nguồn (OCR)</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="zh">Tiếng Trung (Chinese - 中文)</option>
                <option value="ja">Tiếng Nhật (Japanese - 日本語)</option>
                <option value="ko">Tiếng Hàn (Korean - 한국어)</option>
                <option value="en">Tiếng Anh (English)</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Ngôn ngữ đích (Dịch)</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="vi">Tiếng Việt (Vietnamese)</option>
                <option value="en">Tiếng Anh (English)</option>
                <option value="none">Không dịch (OCR-only)</option>
              </select>
            </div>
          </div>

          {/* Nút hành động */}
          <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !videoPath.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shadow-lg shadow-indigo-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? 'Đang xử lý...' : 'Tạo Dự Án'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
