import React from 'react';
import {
  Sparkles,
  Sliders,
  Languages,
  Volume2,
  Mic,
  Video,
} from 'lucide-react';
import { PresetProfile } from '../../../types/presets';
import { VoiceCatalogPicker } from '../../common/VoiceCatalogPicker';

export interface BatchStagesConfig {
  ocr: boolean;
  translate: boolean;
  dubbing: boolean;
  export: boolean;
}

export interface SettingsBatchTabProps {
  batchStages: BatchStagesConfig;
  activeBatchPresetId: string | null;
  presets: PresetProfile[];
  batchTargetLang: string;
  batchDuckingVolume: number;
  batchDubbingEnabled: boolean;
  batchDubbingMode: 'single' | 'gender_multi';
  batchDubbingVoice: string;
  batchDubbingVoiceMale: string;
  batchDubbingVoiceFemale: string;
  batchDubbingSpeed: number;
  batchVoiceTestMsg: string | null;
  currentTestingBatchVoice: string | null;
  batchExportFormat: 'mp4' | 'mkv';
  batchExportResolution: 'original' | '1080p' | '720p' | '2k';
  batchExportAspectRatio: 'original' | '16:9' | '9:16';
  onUpdateBatchConfig: (patch: {
    batchStages?: BatchStagesConfig;
    activeBatchPresetId?: string;
    batchTargetLang?: string;
    batchDuckingVolume?: number;
    batchDubbingEnabled?: boolean;
    batchDubbingMode?: 'single' | 'gender_multi';
    batchDubbingVoice?: string;
    batchDubbingVoiceMale?: string;
    batchDubbingVoiceFemale?: string;
    batchDubbingSpeed?: number;
    batchExportFormat?: 'mp4' | 'mkv';
    batchExportResolution?: 'original' | '1080p' | '720p' | '2k';
    batchExportAspectRatio?: 'original' | '16:9' | '9:16';
  }) => void;
  onTestBatchVoice: (voiceId: string) => void;
}

export const SettingsBatchTab: React.FC<SettingsBatchTabProps> = ({
  batchStages,
  activeBatchPresetId,
  presets,
  batchTargetLang,
  batchDuckingVolume,
  batchDubbingEnabled,
  batchDubbingMode,
  batchDubbingVoice,
  batchDubbingVoiceMale,
  batchDubbingVoiceFemale,
  batchDubbingSpeed,
  batchVoiceTestMsg,
  currentTestingBatchVoice,
  batchExportFormat,
  batchExportResolution,
  batchExportAspectRatio,
  onUpdateBatchConfig,
  onTestBatchVoice,
}) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Header tiêu đề chuẩn Studio */}
      <div className="border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-bold text-white tracking-tight">
            Xử Lý & Xuất Hàng Loạt (Batch Export Pipeline)
          </h3>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Thiết lập cấu hình đồng bộ cho toàn bộ danh sách tập phim: công đoạn tự động, chuẩn mẫu vùng sub, ngôn ngữ, âm lượng ducking và chất lượng render.
        </p>
      </div>

      {/* SECTION 1: CÔNG ĐOẠN PIPELINE & PRESET PROFILE */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-cyan-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Công Đoạn Tự Động & Chuẩn Áp Dụng</h4>
              <p className="text-[11px] text-slate-400">Chọn các bước tự động kích hoạt tuần tự trong luồng xử lý hàng loạt</p>
            </div>
          </div>
        </div>

        {/* Các nút toggle công đoạn không đánh số */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
            batchStages.ocr
              ? 'bg-cyan-950/30 border-cyan-500/50 shadow-sm'
              : 'bg-slate-950 border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-700'
          }`}>
            <input
              type="checkbox"
              checked={batchStages.ocr}
              onChange={(e) => onUpdateBatchConfig({ batchStages: { ...batchStages, ocr: e.target.checked } })}
              className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-slate-200">Trích Xuất OCR / ASR</div>
              <div className="text-[10px] text-slate-400">Quét phụ đề hoặc nhận diện tiếng</div>
            </div>
          </label>

          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
            batchStages.translate
              ? 'bg-amber-950/30 border-amber-500/50 shadow-sm'
              : 'bg-slate-950 border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-700'
          }`}>
            <input
              type="checkbox"
              checked={batchStages.translate}
              onChange={(e) => onUpdateBatchConfig({ batchStages: { ...batchStages, translate: e.target.checked } })}
              className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-slate-200">Dịch Thuật LLM</div>
              <div className="text-[10px] text-slate-400">Chuyển ngữ sang ngôn ngữ đích</div>
            </div>
          </label>

          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
            batchStages.dubbing
              ? 'bg-emerald-950/30 border-emerald-500/50 shadow-sm'
              : 'bg-slate-950 border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-700'
          }`}>
            <input
              type="checkbox"
              checked={batchStages.dubbing}
              onChange={(e) => onUpdateBatchConfig({ batchStages: { ...batchStages, dubbing: e.target.checked } })}
              className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-slate-200">Lồng Tiếng AI (TTS)</div>
              <div className="text-[10px] text-slate-400">Tạo giọng đọc thuyết minh</div>
            </div>
          </label>

          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
            batchStages.export
              ? 'bg-purple-950/30 border-purple-500/50 shadow-sm'
              : 'bg-slate-950 border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-700'
          }`}>
            <input
              type="checkbox"
              checked={batchStages.export}
              onChange={(e) => onUpdateBatchConfig({ batchStages: { ...batchStages, export: e.target.checked } })}
              className="w-4 h-4 rounded accent-purple-500 cursor-pointer"
            />
            <div>
              <div className="text-xs font-bold text-slate-200">Render & Xuất Bản</div>
              <div className="text-[10px] text-slate-400">Mã hóa định dạng MP4 / MKV</div>
            </div>
          </label>
        </div>

        {/* Preset Profile selector */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Preset Profile Áp Dụng:
            </label>
            <select
              value={activeBatchPresetId || ''}
              onChange={(e) => onUpdateBatchConfig({ activeBatchPresetId: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 transition cursor-pointer"
            >
              <option value="">-- Mặc định hệ thống --</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                  {p.name} ({p.aspect_ratio || '16:9'})
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-400 max-w-sm">
            Preset quy định vị trí vùng che sub gốc (ROI), tỉ lệ khung hình (16:9, 9:16) và cơ chế làm mờ viền.
          </div>
        </div>
      </div>

      {/* SECTION 2: NGÔN NGỮ ĐÍCH & ÂM LƯỢNG GỐC (DUCKING) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Ngôn ngữ dịch */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400 pb-1 border-b border-slate-800/80">
            <Languages className="w-4 h-4" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Ngôn Ngữ Dịch Thuật</h4>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Ngôn ngữ đích:</label>
            <select
              value={batchTargetLang}
              onChange={(e) => onUpdateBatchConfig({ batchTargetLang: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="vi">Tiếng Việt (vi) - Phổ biến</option>
              <option value="en">Tiếng Anh (en)</option>
              <option value="zh">Tiếng Trung (zh)</option>
              <option value="none">Giữ nguyên phụ đề gốc (Bỏ qua dịch)</option>
            </select>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Sử dụng động cơ LLM đã được cấu hình trong Engine Router hoặc Tab Dịch Thuật để đảm bảo ngữ cảnh văn phong chuẩn xác.
          </p>
        </div>

        {/* Hạ âm lượng gốc (Ducking) */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
            <div className="flex items-center gap-2 text-amber-400">
              <Volume2 className="w-4 h-4" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Hạ Âm Lượng Nhạc Nền (Audio Ducking)</h4>
            </div>
            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded">
              {batchDuckingVolume}%
            </span>
          </div>
          <div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={batchDuckingVolume}
              onChange={(e) => onUpdateBatchConfig({ batchDuckingVolume: Number(e.target.value) })}
              className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1.5">
              <span>0% (Tắt hoàn toàn tiếng gốc)</span>
              <span className="text-amber-400/80 font-semibold">25% (Tiêu chuẩn)</span>
              <span>100% (Giữ nguyên âm lượng)</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Hạ âm lượng audio gốc khi giọng đọc AI phát ra để thoại rõ nét, tự động phục hồi âm lượng khi hết câu thoại.
          </p>
        </div>
      </div>

      {/* SECTION 3: LỒNG TIẾNG AI TOÀN CỤC */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Lồng Tiếng AI Toàn Cục</h4>
              <p className="text-[11px] text-slate-400">Tự động kích hoạt tổng hợp giọng thuyết minh cho các tập phim</p>
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <span className="text-xs font-semibold text-slate-300">
              {batchDubbingEnabled ? 'Đang kích hoạt' : 'Tạm tắt'}
            </span>
            <input
              type="checkbox"
              checked={batchDubbingEnabled}
              onChange={(e) => onUpdateBatchConfig({ batchDubbingEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {batchDubbingEnabled && (
          <div className="space-y-4 pt-1">
            {/* Chế độ: Đơn giọng vs Phân loại Nam / Nữ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => onUpdateBatchConfig({ batchDubbingMode: 'single' })}
                className={`p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                  batchDubbingMode === 'single'
                    ? 'bg-emerald-950/30 border-emerald-500/60 text-white shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">Chế độ Đơn Giọng</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Sử dụng 1 giọng đọc cố định cho toàn bộ lời thoại</div>
                </div>
                <input
                  type="radio"
                  name="batchDubbingMode"
                  checked={batchDubbingMode === 'single'}
                  onChange={() => onUpdateBatchConfig({ batchDubbingMode: 'single' })}
                  className="accent-emerald-500 w-4 h-4 cursor-pointer"
                />
              </div>

              <div
                onClick={() => onUpdateBatchConfig({ batchDubbingMode: 'gender_multi' })}
                className={`p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                  batchDubbingMode === 'gender_multi'
                    ? 'bg-emerald-950/30 border-emerald-500/60 text-white shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="text-xs font-bold">Chế độ Phân Vai Nam / Nữ</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Tự động nhận diện và gán giọng theo ngữ cảnh nhân vật</div>
                </div>
                <input
                  type="radio"
                  name="batchDubbingMode"
                  checked={batchDubbingMode === 'gender_multi'}
                  onChange={() => onUpdateBatchConfig({ batchDubbingMode: 'gender_multi' })}
                  className="accent-emerald-500 w-4 h-4 cursor-pointer"
                />
              </div>
            </div>

            {/* Catalog chọn giọng */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
              {batchDubbingMode === 'single' ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    Giọng đọc chính:
                  </label>
                  <VoiceCatalogPicker
                    selectedVoiceId={batchDubbingVoice}
                    onChange={(v) => onUpdateBatchConfig({ batchDubbingVoice: v })}
                    onPreview={onTestBatchVoice}
                    previewingVoiceId={currentTestingBatchVoice || undefined}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-sky-300 block">
                      Giọng Nam:
                    </label>
                    <VoiceCatalogPicker
                      selectedVoiceId={batchDubbingVoiceMale}
                      onChange={(v) => onUpdateBatchConfig({ batchDubbingVoiceMale: v })}
                      gender="Nam"
                      onPreview={onTestBatchVoice}
                      previewingVoiceId={currentTestingBatchVoice || undefined}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-pink-300 block">
                      Giọng Nữ:
                    </label>
                    <VoiceCatalogPicker
                      selectedVoiceId={batchDubbingVoiceFemale}
                      onChange={(v) => onUpdateBatchConfig({ batchDubbingVoiceFemale: v })}
                      gender="Nữ"
                      onPreview={onTestBatchVoice}
                      previewingVoiceId={currentTestingBatchVoice || undefined}
                    />
                  </div>
                </div>
              )}

              {/* Tốc độ đọc */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-300">Tốc độ đọc giọng:</span>
                  <div className="flex items-center gap-1.5">
                    {[0.85, 1.0, 1.15, 1.25, 1.35].map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() => onUpdateBatchConfig({ batchDubbingSpeed: spd })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                          batchDubbingSpeed === spd
                            ? 'bg-emerald-600 text-white shadow'
                            : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                        }`}
                      >
                        {spd.toFixed(2)}x
                      </button>
                    ))}
                  </div>
                </div>

                {batchVoiceTestMsg && (
                  <div className="text-xs text-amber-300 animate-pulse font-medium">
                    {batchVoiceTestMsg}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 4: ĐỊNH DẠNG & ĐỘ PHÂN GIẢI XUẤT */}
      <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-purple-400 pb-2 border-b border-slate-800/80">
          <Video className="w-4 h-4" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Định Dạng & Độ Phân Giải Thành Phẩm</h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Container Video:</label>
            <select
              value={batchExportFormat}
              onChange={(e) => onUpdateBatchConfig({ batchExportFormat: e.target.value as any })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="mp4">MP4 (Tương thích phổ biến)</option>
              <option value="mkv">MKV (Đa luồng audio & sub)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Độ Phân Giải:</label>
            <select
              value={batchExportResolution}
              onChange={(e) => onUpdateBatchConfig({ batchExportResolution: e.target.value as any })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="original">Gốc (Giữ nguyên kích thước nguồn)</option>
              <option value="1080p">1080p Full HD</option>
              <option value="720p">720p HD</option>
              <option value="2k">2K QHD (2560x1440)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Tỷ Lệ Khung Hình:</label>
            <select
              value={batchExportAspectRatio}
              onChange={(e) => onUpdateBatchConfig({ batchExportAspectRatio: e.target.value as any })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="original">Gốc (Theo video đầu vào)</option>
              <option value="16:9">16:9 (Màn hình ngang - YouTube)</option>
              <option value="9:16">9:16 (Màn hình dọc - TikTok / Shorts)</option>
            </select>
          </div>
        </div>

        <div className="pt-2 text-[11px] text-slate-500">
          Quy trình render tự động kích hoạt bộ tăng tốc phần cứng GPU NVIDIA NVENC khi khả dụng để tối ưu thời gian xuất bản.
        </div>
      </div>
    </div>
  );
};