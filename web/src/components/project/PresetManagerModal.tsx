import React, { useState, useRef } from 'react';
import {
  PresetProfile,
  AspectRatioType,
  MaskStyleType,
  ZoomMode,
  exportPresetsAsJson,
  parsePresetsJson,
  BUILTIN_PRESETS,
} from '../../types/presets';
import {
  Sliders,
  Plus,
  Trash2,
  Edit2,
  Check,
  Star,
  Download,
  Upload,
  RotateCcw,
  X,
  Tv,
  AlignJustify,
  Smartphone,
  Eye,
  Layers,
  Feather,
  Square,
  Grid,
  Sparkles,
} from 'lucide-react';

interface PresetManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  presets: PresetProfile[];
  onSavePresets: (presets: PresetProfile[]) => void;
  onSelectPreset?: (preset: PresetProfile) => void;
}

export const PresetManagerModal: React.FC<PresetManagerModalProps> = ({
  isOpen,
  onClose,
  presets,
  onSavePresets,
  onSelectPreset,
}) => {
  const [editingPreset, setEditingPreset] = useState<PresetProfile | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleStartCreate = () => {
    setIsCreatingNew(true);
    setEditingPreset({
      id: `preset-${Date.now()}`,
      name: 'Chuẩn Cấu Hình Mới',
      is_default: false,
      source_lang: 'zh',
      target_lang: 'vi',
      mask_style: 'blur',
      is_flipped_h: false,
      is_flipped_v: false,
      show_subtitle_overlay: true,
      zoom_level: 'fit',
      aspect_ratio: '16:9',
      fit_mode: 'contain',
      roi: {
        x: 0.08,
        y: 0.82,
        width: 0.84,
        height: 0.13,
      },
    });
  };

  const handleStartEdit = (p: PresetProfile) => {
    setIsCreatingNew(false);
    setEditingPreset({ ...p });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPreset) return;
    if (!editingPreset.name.trim()) {
      setMessage('Vui lòng nhập tên cho chuẩn cấu hình');
      return;
    }

    let nextPresets: PresetProfile[];
    if (isCreatingNew) {
      nextPresets = [...presets, editingPreset];
      setMessage(`Đã tạo chuẩn mới: "${editingPreset.name}"`);
    } else {
      nextPresets = presets.map((p) => (p.id === editingPreset.id ? editingPreset : p));
      setMessage(`Đã cập nhật chuẩn: "${editingPreset.name}"`);
    }

    onSavePresets(nextPresets);
    setEditingPreset(null);
    setIsCreatingNew(false);
  };

  const handleDelete = (id: string, name: string) => {
    if (presets.length <= 1) {
      setMessage('Cần giữ lại ít nhất 1 chuẩn mặc định.');
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa chuẩn "${name}"?`)) {
      const next = presets.filter((p) => p.id !== id);
      // Nếu xóa trúng chuẩn mặc định, set chuẩn đầu tiên làm mặc định
      if (!next.some((p) => p.is_default) && next.length > 0) {
        next[0].is_default = true;
      }
      onSavePresets(next);
      if (editingPreset?.id === id) {
        setEditingPreset(null);
      }
      setMessage(`Đã xóa chuẩn: "${name}"`);
    }
  };

  const handleSetDefault = (id: string) => {
    const next = presets.map((p) => ({
      ...p,
      is_default: p.id === id,
    }));
    onSavePresets(next);
    setMessage('Đã cập nhật chuẩn mặc định!');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parsePresetsJson(text);
      if (parsed.length === 0) {
        setMessage('File JSON không chứa chuẩn nào hợp lệ.');
        return;
      }
      // Ghép nối các chuẩn mới vào danh sách hiện tại (tránh trùng id)
      const existingIds = new Set(presets.map((p) => p.id));
      const cleanNew = parsed.map((p) => ({
        ...p,
        id: existingIds.has(p.id) ? `preset-${Date.now()}-${Math.random().toString(36).substring(2, 6)}` : p.id,
      }));
      const merged = [...presets, ...cleanNew];
      onSavePresets(merged);
      setMessage(`Đã nhập thành công ${cleanNew.length} chuẩn từ file JSON!`);
    } catch (err: any) {
      setMessage(`Lỗi nhập file: ${err?.message || 'File JSON không hợp lệ'}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleResetToBuiltin = () => {
    if (confirm('Khôi phục toàn bộ danh sách về 4 chuẩn mặc định gốc của Studio?')) {
      onSavePresets(BUILTIN_PRESETS);
      setEditingPreset(null);
      setMessage('Đã khôi phục các chuẩn gốc thành công!');
    }
  };

  const applyRoiPreset = (type: 'one_line' | 'two_lines' | 'tiktok_portrait') => {
    if (!editingPreset) return;
    if (type === 'one_line') {
      setEditingPreset({
        ...editingPreset,
        aspect_ratio: '16:9',
        roi: { x: 0.08, y: 0.82, width: 0.84, height: 0.12 },
      });
    } else if (type === 'two_lines') {
      setEditingPreset({
        ...editingPreset,
        aspect_ratio: '16:9',
        roi: { x: 0.08, y: 0.74, width: 0.84, height: 0.2 },
      });
    } else if (type === 'tiktok_portrait') {
      setEditingPreset({
        ...editingPreset,
        aspect_ratio: '9:16',
        roi: { x: 0.1, y: 0.68, width: 0.8, height: 0.16 },
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150 text-slate-100">
        {/* Header Modal */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">
                Quản Lý Chuẩn Cấu Hình (Presets Profile)
              </h2>
              <p className="text-[11px] text-slate-400">
                Lưu sẵn tỉ lệ khung hình, ngôn ngữ dịch, kiểu che, lật video, zoom % và vùng ROI để áp dụng 1-click
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => exportPresetsAsJson(presets)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition"
              title="Xuất danh sách chuẩn ra file JSON để sao lưu hoặc chia sẻ"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Xuất JSON</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition"
              title="Nhập file JSON cấu hình chuẩn từ máy tính"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>Nhập JSON</span>
            </button>

            <button
              onClick={handleResetToBuiltin}
              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
              title="Khôi phục chuẩn gốc ban đầu"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {message && (
          <div className="px-6 py-2 bg-indigo-950/60 border-b border-indigo-800 text-indigo-300 text-xs flex items-center justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="text-indigo-400 hover:text-white text-xs">✕</button>
          </div>
        )}

        {/* Nội dung 2 cột: Danh sách Chuẩn (Trái) & Chi Tiết Soạn Thảo (Phải) */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-hidden">
          {/* Cột Trái: Danh Sách Chuẩn (320px) */}
          <div className="w-full md:w-80 flex flex-col bg-slate-950/40 p-4 space-y-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Danh Sách Chuẩn ({presets.length})
              </span>
              <button
                onClick={handleStartCreate}
                className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 shadow transition"
              >
                <Plus className="w-3 h-3" />
                <span>Thêm Chuẩn</span>
              </button>
            </div>

            <div className="space-y-2">
              {presets.map((p) => {
                const isCurrentEditing = editingPreset?.id === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => handleStartEdit(p)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex flex-col gap-2 ${
                      isCurrentEditing
                        ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-lg ring-1 ring-indigo-500/50'
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="font-semibold text-xs leading-snug line-clamp-2">
                        {p.name}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {p.is_default ? (
                          <span
                            className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-0.5"
                            title="Chuẩn mặc định"
                          >
                            <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                            <span>Mặc định</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetDefault(p.id);
                            }}
                            className="text-slate-500 hover:text-amber-400 p-0.5 text-[10px]"
                            title="Đặt làm chuẩn mặc định"
                          >
                            <Star className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800 font-mono">
                        {p.aspect_ratio || '16:9'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 text-indigo-300 border border-slate-800 font-mono">
                        {p.source_lang} &rarr; {p.target_lang}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-950 text-emerald-400 border border-slate-800">
                        {p.mask_style}
                      </span>
                      {p.is_flipped_h && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 text-sky-300 border border-slate-800">
                          Lật Ngang
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[11px]" onClick={(e) => e.stopPropagation()}>
                      {onSelectPreset && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectPreset(p);
                            onClose();
                          }}
                          className="text-indigo-400 hover:text-indigo-300 font-medium text-[10px]"
                        >
                          Áp dụng ngay
                        </button>
                      )}
                      <div className="flex items-center gap-1 ml-auto">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(p)}
                          className="text-slate-400 hover:text-white p-1"
                          title="Sửa chuẩn này"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id, p.name)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                          title="Xóa chuẩn này"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cột Phải: Form Chỉnh Sửa Chuẩn (Editing Panel) */}
          <div className="flex-1 p-6 overflow-y-auto">
            {editingPreset ? (
              <form onSubmit={handleSaveEdit} className="space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>{isCreatingNew ? 'Tạo Chuẩn Cấu Hình Mới' : `Chỉnh Sửa: ${editingPreset.name}`}</span>
                  </h3>

                  <label className="flex items-center gap-2 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={Boolean(editingPreset.is_default)}
                      onChange={(e) => setEditingPreset({ ...editingPreset, is_default: e.target.checked })}
                      className="rounded accent-amber-500"
                    />
                    <span className="text-slate-300 font-medium flex items-center gap-1">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                      <span>Đặt làm Chuẩn Mặc Định</span>
                    </span>
                  </label>
                </div>

                {/* 1. Tên Chuẩn */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tên Chuẩn Cấu Hình</label>
                  <input
                    type="text"
                    value={editingPreset.name}
                    onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                    placeholder="VD: Chuẩn TikTok 9:16 Lật Ngang, Mờ Viền"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                {/* 2. Tỉ Lệ Khung Hình & Chế Độ Đệm */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Tỉ Lệ Khung Hình (Aspect Ratio)
                    </label>
                    <select
                      value={editingPreset.aspect_ratio || '16:9'}
                      onChange={(e) => setEditingPreset({ ...editingPreset, aspect_ratio: e.target.value as AspectRatioType })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value="original">Gốc (Theo video gốc)</option>
                      <option value="16:9">16:9 (Ngang YouTube / TV)</option>
                      <option value="9:16">9:16 (Dọc TikTok / Reels / Shorts)</option>
                      <option value="1:1">1:1 (Vuông Instagram / Facebook)</option>
                      <option value="4:3">4:3 (Truyền hình cổ điển)</option>
                      <option value="2.35:1">2.35:1 (Điện ảnh Anamorphic)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Mức Thu Phóng (Zoom %)
                    </label>
                    <select
                      value={editingPreset.zoom_level}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditingPreset({
                          ...editingPreset,
                          zoom_level: val === 'fit' ? 'fit' : (parseFloat(val) as ZoomMode),
                        });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value="fit">Vừa khít (Fit)</option>
                      <option value="0.5">50%</option>
                      <option value="0.75">75%</option>
                      <option value="1">100%</option>
                      <option value="1.25">125%</option>
                      <option value="1.5">150%</option>
                      <option value="2">200%</option>
                    </select>
                  </div>
                </div>

                {/* 3. Ngôn Ngữ Dịch */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Ngôn Ngữ Nguồn (OCR)</label>
                    <select
                      value={editingPreset.source_lang}
                      onChange={(e) => setEditingPreset({ ...editingPreset, source_lang: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="zh">Tiếng Trung (zh)</option>
                      <option value="en">Tiếng Anh (en)</option>
                      <option value="ja">Tiếng Nhật (ja)</option>
                      <option value="ko">Tiếng Hàn (ko)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Ngôn Ngữ Đích (Dịch sang)</label>
                    <select
                      value={editingPreset.target_lang}
                      onChange={(e) => setEditingPreset({ ...editingPreset, target_lang: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="vi">Tiếng Việt (vi)</option>
                      <option value="en">Tiếng Anh (en)</option>
                    </select>
                  </div>
                </div>

                {/* 4. Kiểu Che & Chế Độ Lật & Auto Sub */}
                <div className="space-y-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Kiểu Che Phụ Đề Gốc (Mask Style)</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'feather_tight', name: '✨ Mờ bám chữ', desc: 'Dải hẹp bám sát chữ', icon: Sparkles },
                      { id: 'optical_blend', name: '💧 Hòa tan quang học', desc: '100% trong suốt không tối', icon: Eye },
                      { id: 'soft_cinema', name: '🎬 Gradient Cinema', desc: 'Chuyển sắc êm dịu', icon: Layers },
                      { id: 'blur', name: 'Mờ hòa tan', desc: 'Màu hòa 100% video', icon: Sparkles },
                      { id: 'glass', name: 'Kính mờ', desc: 'Giữ sáng bối cảnh', icon: Eye },
                      { id: 'ambient', name: 'Gradient đáy', desc: 'Chuyển sắc êm', icon: Layers },
                      { id: 'feather', name: 'Viền lông mềm', desc: 'Viền nhung mềm', icon: Feather },
                      { id: 'box', name: 'Hộp đen Cinema', desc: 'Dải đen truyền thống', icon: Square },
                      { id: 'mosaic', name: 'Khảm Mosaic', desc: 'Pixel mờ phóng sự', icon: Grid },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setEditingPreset({ ...editingPreset, mask_style: m.id as MaskStyleType })}
                        className={`p-2 rounded-lg border text-left text-xs transition flex flex-col gap-0.5 ${
                          editingPreset.mask_style === m.id
                            ? 'bg-indigo-950 border-indigo-500 text-white shadow ring-1 ring-indigo-500/40'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span className="font-semibold text-[11px]">{m.name}</span>
                        <span className="text-[9px] text-slate-500">{m.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/80 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingPreset.is_flipped_h}
                        onChange={(e) => setEditingPreset({ ...editingPreset, is_flipped_h: e.target.checked })}
                        className="rounded accent-indigo-600"
                      />
                      <span className="text-slate-300 font-medium">Lật Ngang Video</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingPreset.is_flipped_v}
                        onChange={(e) => setEditingPreset({ ...editingPreset, is_flipped_v: e.target.checked })}
                        className="rounded accent-indigo-600"
                      />
                      <span className="text-slate-300 font-medium">Lật Dọc Video</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingPreset.show_subtitle_overlay}
                        onChange={(e) => setEditingPreset({ ...editingPreset, show_subtitle_overlay: e.target.checked })}
                        className="rounded accent-emerald-500"
                      />
                      <span className="text-emerald-400 font-medium">Bật Auto Sub Overlay</span>
                    </label>
                  </div>
                </div>

                {/* 5. Vùng Quét Phụ Đề ROI Mẫu */}
                <div className="space-y-2 p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Vị Trí Vùng Quét Mẫu (ROI)</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyRoiPreset('one_line')}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded text-[10px] flex items-center gap-1"
                      >
                        <Tv className="w-3 h-3 text-indigo-400" />
                        <span>1 Dòng Đáy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyRoiPreset('two_lines')}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded text-[10px] flex items-center gap-1"
                      >
                        <AlignJustify className="w-3 h-3 text-indigo-400" />
                        <span>2 Dòng Đáy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => applyRoiPreset('tiktok_portrait')}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded text-[10px] flex items-center gap-1"
                      >
                        <Smartphone className="w-3 h-3 text-indigo-400" />
                        <span>Dọc TikTok</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-500 block">X (Ngang)</span>
                      <span className="text-indigo-400 font-bold">{Math.round(editingPreset.roi.x * 100)}%</span>
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-500 block">Y (Dọc)</span>
                      <span className="text-indigo-400 font-bold">{Math.round(editingPreset.roi.y * 100)}%</span>
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-500 block">W (Rộng)</span>
                      <span className="text-indigo-400 font-bold">{Math.round(editingPreset.roi.width * 100)}%</span>
                    </div>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-500 block">H (Cao)</span>
                      <span className="text-indigo-400 font-bold">{Math.round(editingPreset.roi.height * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditingPreset(null)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Lưu Chuẩn Này</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
                <Sliders className="w-12 h-12 text-slate-700 mb-3" />
                <h4 className="text-sm font-semibold text-slate-400 mb-1">Chọn hoặc Tạo Chuẩn Cấu Hình</h4>
                <p className="text-xs max-w-sm">
                  Chọn một chuẩn ở danh sách bên trái để chỉnh sửa thông số, hoặc bấm &quot;Thêm Chuẩn&quot; để thiết lập một chuẩn sản xuất video mới.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
