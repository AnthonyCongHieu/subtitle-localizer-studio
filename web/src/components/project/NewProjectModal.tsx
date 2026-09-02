import React, { useState } from 'react';
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
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePickVideo = async () => {
    try {
      const res = await apiClient.pickVideo();
      setVideoPath(res.path);
      if (!title) {
        setTitle(res.filename.replace(/\.[^/.]+$/, ''));
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !videoPath) {
      setError('Vui lòng nhập tên dự án và chọn video nguồn');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const project = await apiClient.createProject({
        title,
        source_video_path: videoPath,
        source_language: sourceLang,
        target_language: targetLang,
      });
      onCreated(project);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-lg font-semibold text-zinc-100">Tạo dự án phụ đề mới</h2>
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

        <form onSubmit={handleCreate} className="space-y-4 text-sm">
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">Tên dự án</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phim tài liệu lịch sử 01"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">Video nguồn (Hard Subtitle)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={videoPath}
                onChange={(e) => setVideoPath(e.target.value)}
                placeholder="D:/Videos/sample.mp4"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handlePickVideo}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium text-xs transition-colors border border-zinc-700"
              >
                Chọn File...
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Ngôn ngữ nguồn (OCR)</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-indigo-500"
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
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="vi">Tiếng Việt (Vietnamese)</option>
                <option value="en">Tiếng Anh (English)</option>
                <option value="none">Không dịch (OCR-only)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {loading ? 'Đang tạo...' : 'Tạo Dự Án'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
