import React, { useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  RotateCcw,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { GlobalPipelineSettings } from '../../api/client';
import { LanWorker } from '../../types/api';
import { focusRing, VramBar } from './LanUi';
import { WorkerEngineOverride } from './types';

interface WorkerConfigDrawerProps {
  worker: LanWorker | null;
  isOpen: boolean;
  onClose: () => void;
  globalSettings: GlobalPipelineSettings | null;
  currentOverride?: WorkerEngineOverride;
  onSaveOverride: (override: WorkerEngineOverride) => void;
  onResetToGlobal: (workerId: string) => void;
}

export const WorkerConfigDrawer: React.FC<WorkerConfigDrawerProps> = ({
  worker,
  isOpen,
  onClose,
  globalSettings,
  currentOverride,
  onSaveOverride,
  onResetToGlobal,
}) => {
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [roles, setRoles] = useState({
    ocr: true,
    transcribe: true,
    translate: true,
    dubbing: true,
    downloader: true,
  });
  const [gpuDeviceId, setGpuDeviceId] = useState<number>(0);
  const [batchSize, setBatchSize] = useState<number>(16);
  const [concurrencySlots, setConcurrencySlots] = useState<number>(2);

  useEffect(() => {
    if (worker) {
      if (currentOverride && currentOverride.is_custom) {
        setIsCustom(true);
        setRoles({ ...currentOverride.assigned_roles });
        setGpuDeviceId(currentOverride.gpu_device_id ?? 0);
        setBatchSize(currentOverride.batch_size ?? 16);
        setConcurrencySlots(currentOverride.concurrency_slots ?? 2);
      } else {
        // Mặc định kế thừa từ Setting Tổng
        setIsCustom(false);
        const caps = worker.capabilities || {};
        setRoles({
          ocr: Boolean(caps.ocr ?? true),
          transcribe: Boolean(caps.transcribe ?? true),
          translate: Boolean(caps.translate ?? true),
          dubbing: Boolean(caps.dubbing ?? true),
          downloader: Boolean(caps.downloader ?? true),
        });
        setGpuDeviceId(0);
        setBatchSize((globalSettings?.ocr as any)?.batch_size ?? 16);
        setConcurrencySlots(1);
      }
    }
  }, [worker, currentOverride, globalSettings]);

  if (!isOpen || !worker) return null;

  const handleSave = () => {
    const updated: WorkerEngineOverride = {
      worker_id: worker.worker_id,
      is_custom: isCustom,
      assigned_roles: roles,
      gpu_device_id: gpuDeviceId,
      batch_size: batchSize,
      concurrency_slots: concurrencySlots,
      updated_at: Date.now(),
    };
    onSaveOverride(updated);
    onClose();
  };

  const handleReset = () => {
    setIsCustom(false);
    onResetToGlobal(worker.worker_id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm transition-opacity"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worker-drawer-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/60 p-2 text-indigo-400">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h2 id="worker-drawer-title" className="text-base font-bold text-white">
                Cấu Hình Engine Worker
              </h2>
              <p className="font-mono text-xs text-slate-400 truncate max-w-xs">
                {worker.worker_id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ${focusRing}`}
            title="Đóng bảng cấu hình"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nội dung cấu hình */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Thông số phần cứng Worker */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Cpu className="h-4 w-4 text-indigo-400" />
                Thông số Máy Trạm
              </span>
              <span className="font-mono text-slate-400">{worker.platform || 'windows'}</span>
            </div>
            <p className="text-sm font-semibold text-white">
              {worker.gpu_name || 'CPU / Chưa nhận diện card đồ họa'}
            </p>
            <div className="text-xs text-slate-400 space-y-1">
              <p>Host: {worker.hostname || worker.ip_address || '127.0.0.1'}</p>
              <p>Phiên bản Client: {worker.app_version || '2.5.x'}</p>
            </div>
            {worker.vram_mb ? (
              <div className="pt-2 border-t border-slate-800/80">
                <VramBar vramMb={worker.vram_mb} />
              </div>
            ) : null}
          </div>

          {/* Công tắc Kế thừa Setting Tổng vs Tùy biến */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <label
                  htmlFor="custom-override-switch"
                  className="text-sm font-semibold text-slate-200 cursor-pointer"
                >
                  Tùy Biến Riêng Cho Worker Này
                </label>
                <p className="mt-0.5 text-xs text-slate-400">
                  {isCustom
                    ? 'Worker sẽ sử dụng cấu hình tùy chỉnh bên dưới thay vì Setting Tổng.'
                    : 'Worker đang kế thừa tự động mọi thông số từ Setting Tổng.'}
                </p>
              </div>
              <button
                id="custom-override-switch"
                type="button"
                role="switch"
                aria-checked={isCustom}
                onClick={() => setIsCustom(!isCustom)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${focusRing} ${
                  isCustom ? 'bg-indigo-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isCustom ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {!isCustom ? (
            /* Khối hiển thị Kế thừa Setting Tổng */
            <div className="rounded-2xl border border-indigo-900/40 bg-indigo-950/20 p-5 space-y-4">
              <div className="flex items-center gap-2 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="h-4 w-4" />
                Đang Đồng Bộ Theo Setting Tổng
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <p className="text-slate-400">OCR Engine</p>
                  <p className="font-semibold text-white mt-1">
                    {globalSettings?.ocr?.local_engine || globalSettings?.ocr?.method || 'rapidocr'} (
                    {globalSettings?.ocr?.performance_profile || 'balanced'})
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <p className="text-slate-400">Translation Engine</p>
                  <p className="font-semibold text-white mt-1">
                    {globalSettings?.translation?.provider || 'gemini'} (
                    {globalSettings?.translation?.gemini_model || 'pro'})
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <p className="text-slate-400">Dubbing TTS</p>
                  <p className="font-semibold text-white mt-1">
                    {globalSettings?.dubbing?.provider || 'edge'} (
                    {globalSettings?.dubbing?.mode || 'single'})
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <p className="text-slate-400">Render / Video Out</p>
                  <p className="font-semibold text-white mt-1">
                    {globalSettings?.render?.ffmpeg_encoder || 'nvenc'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 italic">
                * Khi bạn sửa cấu hình trong mục "Thiết Lập Hệ Thống", worker này sẽ tự động nhận diện thông số mới.
              </p>
            </div>
          ) : (
            /* Khối Tùy biến Riêng */
            <div className="space-y-5 animate-in fade-in duration-200">
              {/* Phân chia vai trò tác vụ */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Vai trò xử lý (Task Routing)
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={roles.ocr}
                      onChange={(e) => setRoles({ ...roles, ocr: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Quét chữ OCR GPU</span>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={roles.transcribe}
                      onChange={(e) => setRoles({ ...roles, transcribe: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Whisper Nhận Diện Audio</span>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={roles.translate}
                      onChange={(e) => setRoles({ ...roles, translate: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Dịch Thuật Phụ Đề AI</span>
                  </label>
                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={roles.dubbing}
                      onChange={(e) => setRoles({ ...roles, dubbing: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Lồng Tiếng AI (TTS)</span>
                  </label>
                  <label className="col-span-full flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200 cursor-pointer hover:border-slate-700">
                    <input
                      type="checkbox"
                      checked={roles.downloader}
                      onChange={(e) => setRoles({ ...roles, downloader: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Tải Video Nguồn Online</span>
                  </label>
                </div>
              </div>

              {/* Chọn Card đồ họa CUDA Device ID */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Thiết bị Tăng Tốc (CUDA Device)
                </label>
                <select
                  value={gpuDeviceId}
                  onChange={(e) => setGpuDeviceId(parseInt(e.target.value, 10))}
                  className={`w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 ${focusRing}`}
                >
                  <option value={0}>GPU 0 (Mặc định - Primary CUDA)</option>
                  <option value={1}>GPU 1 (Thứ cấp nếu có nhiều GPU)</option>
                  <option value={-1}>Chỉ chạy CPU (Fallback khi hết VRAM)</option>
                </select>
              </div>

              {/* Batch size & Concurrency */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Batch Size OCR
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className={`w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 ${focusRing}`}
                  />
                  <span className="text-[10px] text-slate-500">Khung hình / lần quét</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Queue Slots
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={concurrencySlots}
                    onChange={(e) =>
                      setConcurrencySlots(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                    className={`w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 ${focusRing}`}
                  />
                  <span className="text-[10px] text-slate-500">Tối đa job nhận cùng lúc</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-6 py-4">
          <button
            type="button"
            onClick={handleReset}
            className={`flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors ${focusRing}`}
            title="Xóa tùy biến và đồng bộ lại từ Thiết Lập Tổng"
          >
            <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
            Đồng bộ Setting Tổng
          </button>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className={`rounded-xl border border-slate-800 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors ${focusRing}`}
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={`flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition-colors ${focusRing}`}
            >
              <Check className="h-4 w-4" />
              Lưu Cấu Hình
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
