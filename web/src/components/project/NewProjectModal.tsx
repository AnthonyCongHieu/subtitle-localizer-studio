import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';
import { PresetProfile, getDefaultPreset } from '../../types/presets';
import { Film, FolderOpen, Loader2, CheckCircle2, AlertCircle, X, Sliders } from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: ProjectManifestV1, appliedPreset?: PresetProfile) => void;
  presets?: PresetProfile[];
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  presets = [],
}) => {
  const [title, setTitle] = useState('');
  const [videoPath, setVideoPath] = useState('');
  const [videoItems, setVideoItems] = useState<string[]>([]);
  const [mode, setMode] = useState<'single' | 'folders'>('single');
  const [folderGroups, setFolderGroups] = useState<Array<{ title: string; videos: string[] }>>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('vi');
  const [isPicking, setIsPicking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (presets.length > 0) {
      const def = getDefaultPreset(presets);
      setSelectedPresetId(def.id);
      setSourceLang(def.source_lang || 'auto');
      setTargetLang(def.target_lang || 'vi');
    }
  }, [presets, isOpen]);

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const p = presets.find((x) => x.id === presetId);
    if (p) {
      setSourceLang(p.source_lang);
      setTargetLang(p.target_lang);
    }
  };

  if (!isOpen) return null;

  // Chọn file trực tiếp từ máy tính (0 giây, không tốn dung lượng nạp qua mạng)
  const handlePickLocalVideo = async () => {
    setError(null);
    setIsPicking(true);
    setStatusText('Đang mở hộp thoại chọn video từ máy tính...');
    try {
      const res = mode === 'single' ? await apiClient.pickMultipleVideos() : await apiClient.pickFolder();
      const files = res.files || [];
      if (mode === 'single' && files.length) {
        setVideoItems(files.map((f) => f.path));
        setVideoPath(files[0].path);
        const fileName = files[0].filename || files[0].path.replace(/\\/g, '/').split('/').pop() || '';
        if (!title && fileName) {
          setTitle(fileName.replace(/\.[^/.]+$/, ''));
        }
        setStatusText(`✓ Đã nạp đường dẫn trực tiếp (0s): ${fileName}`);
      } else if (mode === 'folders' && files.length) {
        const titleForFolder = files[0].path.replace(/\\/g, '/').split('/').slice(-2, -1)[0] || 'Thư mục';
        setFolderGroups((prev) => [...prev, { title: titleForFolder, videos: files.map((f) => f.path) }]);
        setStatusText(`✓ Đã thêm ${files.length} video từ thư mục`);
      } else {
        setStatusText(null);
      }
    } catch (err: any) {
      setError(`Không thể mở hộp thoại native: ${err.message || err}`);
    } finally {
      setIsPicking(false);
    }
  };


  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || (!videoPath.trim() && !folderGroups.length)) {
      setError('Vui lòng nhập tên dự án và chọn file video');
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const chosenPreset = presets.find((p) => p.id === selectedPresetId);
      if (mode === 'folders') {
        const created = await apiClient.batchCreateProjects([], undefined, folderGroups.map((g) => ({ ...g, source_language: sourceLang, target_language: targetLang })));
        created.forEach((project) => onCreated(project, chosenPreset));
        onClose();
        return;
      }
      const proj = await apiClient.createProject({
        title: title.trim(),
        source_video_path: videoPath.trim(),
        source_language: sourceLang,
        target_language: targetLang,
        media_items: mode === 'single' ? videoItems.map((source_video_path) => ({ source_video_path })) : folderGroups.flatMap((g) => g.videos.map((source_video_path) => ({ source_video_path }))),
      });

      // Nếu có cấu hình ROI trong preset, lưu ngay vào project
      if (chosenPreset?.roi) {
        try {
          await apiClient.saveRegions(proj.project_id, [
            {
              region_id: 'roi-main',
              x: chosenPreset.roi.x,
              y: chosenPreset.roi.y,
              width: chosenPreset.roi.width,
              height: chosenPreset.roi.height,
            },
          ]);
        } catch {
          // Non-blocking
        }
      }

      onCreated(proj, chosenPreset);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Lỗi tạo dự án');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150 text-slate-100">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2.5">
            <Film className="w-5 h-5 text-indigo-400" />
            <span>Tạo Dự Án Phụ Đề Mới</span>
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 text-xs rounded-lg leading-relaxed flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {statusText && !error && (
          <div className="p-3 bg-indigo-950/60 border border-indigo-800 text-indigo-300 text-xs rounded-lg flex items-center gap-2 animate-pulse">
            <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{statusText}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4 text-sm">
          {/* Tên dự án */}
          <div>
            <label className="block text-slate-300 text-xs font-semibold mb-1.5">Tên dự án</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Phim tài liệu lịch sử 01"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs"
            />
          </div>

          {/* Chọn Chuẩn Áp Dụng (Preset Profile) */}
          {presets.length > 0 && (
            <div>
              <label className="block text-slate-300 text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                <span>Áp dụng Chuẩn Cấu Hình (Preset Profile):</span>
              </label>
              <select
                value={selectedPresetId}
                onChange={(e) => handleSelectPreset(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs font-medium cursor-pointer"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.is_default ? '⭐ (Mặc định)' : ''} [{p.aspect_ratio || '16:9'}]
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Video nguồn */}
          <div>
            <label className="block text-slate-300 text-xs font-semibold mb-1.5">
              Video nguồn (Hard Subtitle)
            </label>

            <div className="flex gap-2 mb-2">
              <button type="button" onClick={() => setMode('single')} className={`px-3 py-2 rounded-lg text-xs ${mode === 'single' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Một dự án</button>
              <button type="button" onClick={() => setMode('folders')} className={`px-3 py-2 rounded-lg text-xs ${mode === 'folders' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Tạo nhiều theo thư mục</button>
            </div>
            <div className="grid grid-cols-1 gap-2 mb-2">
              <button
                type="button"
                onClick={handlePickLocalVideo}
                disabled={isPicking || isCreating}
                className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 cursor-pointer active:scale-98 disabled:opacity-50"
                title="Mở Windows Explorer để chọn file trực tiếp (Tức thì 0s, không tốn thời gian upload)"
              >
                {isPicking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderOpen className="w-4 h-4" />
                )}
                <span className="font-semibold text-xs">
                  {isPicking ? 'Đang mở cửa sổ chọn native...' : mode === 'single' ? '📂 Chọn một hoặc nhiều video' : '📁 Thêm thư mục'}
                </span>
              </button>
            </div>
            <div className="text-[11px] text-slate-400">{mode === 'single' ? `${videoItems.length || (videoPath ? 1 : 0)} video đã chọn` : `${folderGroups.length} thư mục, ${folderGroups.reduce((n, g) => n + g.videos.length, 0)} video`}</div>

            {/* Ô dán đường dẫn file */}
            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 block">Đường dẫn file video:</span>
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
                placeholder="D:/Videos/sample.mp4 (Tự động điền khi bạn chọn video ở trên)"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 font-mono text-[11px]"
              />
            </div>
          </div>

          {/* Ngôn ngữ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 text-xs font-semibold mb-1">Ngôn ngữ nguồn (OCR)</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
              >
                <option value="zh">🇨🇳 Tiếng Trung (Chinese - 中文)</option>
                <option value="en">🇬🇧 Tiếng Anh (English)</option>
                <option value="vi">🇻🇳 Tiếng Việt (Vietnamese)</option>
                <option value="auto">🌐 Tự động nhận diện (Auto-detect)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 text-xs font-semibold mb-1">Ngôn ngữ đích (Dịch)</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
              >
                <option value="vi">🇻🇳 Tiếng Việt (Vietnamese)</option>
                <option value="en">🇬🇧 Tiếng Anh (English)</option>
                <option value="zh">🇨🇳 Tiếng Trung (Chinese)</option>
                <option value="none">Trích xuất gốc (Không dịch / OCR-only)</option>
              </select>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isCreating || !title.trim() || !videoPath.trim()}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-indigo-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isCreating ? 'Đang xử lý...' : 'Tạo Dự Án'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
