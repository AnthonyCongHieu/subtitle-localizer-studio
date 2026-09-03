import React, { useState } from 'react';
import { RegionTrackV1 } from '../../types/api';
import { Crosshair, Tv, AlignJustify, Smartphone, ChevronDown, ChevronUp } from 'lucide-react';

interface RoiSelectorProps {
  region?: RegionTrackV1;
  onUpdateRegion: (region: RegionTrackV1) => void;
  onAutoDetect?: () => void;
}

export const RoiSelector: React.FC<RoiSelectorProps> = ({ region, onUpdateRegion, onAutoDetect }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const currentY = region ? Math.round(region.y * 100) : 85;
  const currentH = region ? Math.round(region.height * 100) : 10;
  const currentW = region ? Math.round(region.width * 100) : 84;

  const applyPreset = (preset: 'auto' | 'one_line_tight' | 'one_line_standard' | 'two_lines' | 'portrait_tiktok') => {
    if (preset === 'auto') {
      onAutoDetect?.();
    } else if (preset === 'one_line_tight') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.15,
        y: 0.87,
        width: 0.70,
        height: 0.09,
      });
    } else if (preset === 'one_line_standard') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.08,
        y: 0.85,
        width: 0.84,
        height: 0.11,
      });
    } else if (preset === 'two_lines') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.08,
        y: 0.80,
        width: 0.84,
        height: 0.16,
      });
    } else if (preset === 'portrait_tiktok') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.06,
        y: 0.72,
        width: 0.88,
        height: 0.12,
      });
    }
  };

  const handleYChange = (newYPercent: number) => {
    const yVal = Math.min(0.95, Math.max(0.30, newYPercent / 100));
    onUpdateRegion({
      region_id: region?.region_id || 'roi-default',
      x: region?.x ?? 0.08,
      y: parseFloat(yVal.toFixed(3)),
      width: region?.width ?? 0.84,
      height: region?.height ?? 0.18,
    });
  };

  const handleHChange = (newHPercent: number) => {
    const hVal = Math.min(0.40, Math.max(0.05, newHPercent / 100));
    onUpdateRegion({
      region_id: region?.region_id || 'roi-default',
      x: region?.x ?? 0.08,
      y: region?.y ?? 0.78,
      width: region?.width ?? 0.84,
      height: parseFloat(hVal.toFixed(3)),
    });
  };

  const handleWChange = (newWPercent: number) => {
    const wVal = Math.min(1.0, Math.max(0.50, newWPercent / 100));
    const xVal = Math.max(0, (1.0 - wVal) / 2);
    onUpdateRegion({
      region_id: region?.region_id || 'roi-default',
      x: parseFloat(xVal.toFixed(3)),
      y: region?.y ?? 0.78,
      width: parseFloat(wVal.toFixed(3)),
      height: region?.height ?? 0.18,
    });
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-3 shadow-lg select-none transition-all">
      {/* Header with Collapse/Expand Toggle */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h4 className="font-semibold text-zinc-100 flex items-center gap-1.5 text-xs">
          <Crosshair className="w-4 h-4 text-indigo-400" />
          <span>Vùng Nhận Diện & Che Phụ Đề (ROI)</span>
        </h4>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <span className="px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-bold">
              Y: {currentY}%
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold">
              Cao: {currentH}%
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold">
              Rộng: {currentW}%
            </span>
          </div>
          <button
            type="button"
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors"
            title={isCollapsed ? 'Mở rộng tùy chỉnh ROI' : 'Thu gọn bảng ROI'}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="space-y-3 pt-2 border-t border-zinc-800/80 text-xs animate-in fade-in duration-150">
          {/* Quick Presets */}
          <div>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset('auto')}
                className="p-1.5 rounded-lg border border-indigo-500/50 bg-indigo-950/80 text-indigo-200 hover:bg-indigo-900 text-[11px] font-semibold flex items-center justify-center gap-1 transition-all shadow-sm"
                title="Tự động quét khung hình và co gọn vùng ROI vừa khít chữ"
              >
                <span>🎯 Tự Bắt Dính</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('one_line_tight')}
                className={`p-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
                  currentY === 87 && currentH === 9
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200 shadow-sm'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                }`}
              >
                <Tv className="w-3 h-3 text-indigo-400" />
                <span>1 Dòng Nhỏ</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('one_line_standard')}
                className={`p-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
                  currentY === 85 && currentH === 11
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200 shadow-sm'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                }`}
              >
                <AlignJustify className="w-3 h-3 text-indigo-400" />
                <span>1 Dòng Chuẩn</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('two_lines')}
                className={`p-1.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 transition-all ${
                  currentY === 80 && currentH === 16
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200 shadow-sm'
                    : 'bg-zinc-950 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                }`}
              >
                <Smartphone className="w-3 h-3 text-indigo-400" />
                <span>2 Dòng Lớn</span>
              </button>
            </div>
          </div>

          {/* Interactive Fine-tune Sliders */}
          <div className="space-y-3 pt-2 border-t border-zinc-800/80">
            

            {/* Y Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Vị trí dọc (Y - Từ trên xuống):</span>
                <span className="text-indigo-400 font-mono font-bold">{currentY}%</span>
              </div>
              <input
                type="range"
                min="40"
                max="95"
                step="1"
                value={currentY}
                onChange={(e) => handleYChange(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Height Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Độ dày vùng che (Chiều cao H):</span>
                <span className="text-indigo-400 font-mono font-bold">{currentH}%</span>
              </div>
              <input
                type="range"
                min="5"
                max="35"
                step="1"
                value={currentH}
                onChange={(e) => handleHChange(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Width Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-400">Độ rộng ngang (W):</span>
                <span className="text-indigo-400 font-mono font-bold">{currentW}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="100"
                step="1"
                value={currentW}
                onChange={(e) => handleWChange(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
