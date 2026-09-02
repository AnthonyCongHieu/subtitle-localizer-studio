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
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Trình duyệt chỉ cho biết tên file, không có full path.
    // Hiển thị tên file để người dùng biết đã chọn đúng.
    const fileName = file.name;
    setVideoPath(fileName);

    // Tự động điền tên dự án nếu đang trống
    if (!title) {
      setTitle(fileName.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Vui long nhap ten du an');
      return;
    }
    if (!videoPath.trim()) {
      setError('Vui long nhap duong dan video hoac chon file');
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
      setSourceLang('zh');
      setTargetLang('vi');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Loi tao du an');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h2 className="text-lg font-semibold text-zinc-100">Tao du an phu de moi</h2>
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
          {/* Ten du an */}
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">Ten du an</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phim tai lieu lich su 01"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Video nguon */}
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">
              Video nguon (Hard Subtitle)
            </label>

            {/* Cach 1: Nhap duong dan thu cong */}
            <input
              type="text"
              value={videoPath}
              onChange={(e) => {
                setVideoPath(e.target.value);
                // Tu dong dien ten du an tu ten file
                if (!title && e.target.value) {
                  const parts = e.target.value.replace(/\\/g, '/').split('/');
                  const fileName = parts[parts.length - 1];
                  setTitle(fileName.replace(/\.[^/.]+$/, ''));
                }
              }}
              placeholder="D:/Videos/sample.mp4"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500 font-mono text-xs mb-2"
            />

            {/* Cach 2: Chon file bang dialog trinh duyet */}
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
              className="w-full px-3 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium text-xs transition-colors border border-zinc-700 border-dashed flex items-center justify-center gap-2"
            >
              <span>📁</span> Click de chon video tu may tinh...
            </button>
            <p className="text-zinc-500 text-[11px] mt-1.5">
              Ho tro: MP4, MKV, AVI, MOV, WebM, TS, FLV. Ban co the nhap truc tiep duong dan vao o phia tren.
            </p>
          </div>

          {/* Ngon ngu */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Ngon ngu nguon (OCR)</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="zh">Chinese (Trung)</option>
                <option value="ja">Japanese (Nhat)</option>
                <option value="ko">Korean (Han)</option>
                <option value="en">English (Anh)</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Ngon ngu dich</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="vi">Vietnamese (Viet)</option>
                <option value="en">English (Anh)</option>
                <option value="none">Khong dich (OCR-only)</option>
              </select>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium"
            >
              Huy
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !videoPath.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shadow-lg shadow-indigo-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Dang tao...' : 'Tao Du An'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
