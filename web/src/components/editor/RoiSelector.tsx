import React from 'react';
import { RegionTrackV1 } from '../../types/api';

interface RoiSelectorProps {
  region?: RegionTrackV1;
  onUpdateRegion: (region: RegionTrackV1) => void;
}

export const RoiSelector: React.FC<RoiSelectorProps> = ({ region, onUpdateRegion }) => {
  const applyPreset = (preset: 'bottom_standard' | 'bottom_tall' | 'portrait_tiktok') => {
    if (preset === 'bottom_standard') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.08,
        y: 0.78,
        width: 0.84,
        height: 0.16,
      });
    } else if (preset === 'bottom_tall') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.05,
        y: 0.70,
        width: 0.90,
        height: 0.25,
      });
    } else if (preset === 'portrait_tiktok') {
      onUpdateRegion({
        region_id: region?.region_id || 'roi-default',
        x: 0.05,
        y: 0.65,
        width: 0.90,
        height: 0.22,
      });
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs space-y-3 shadow-lg">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-zinc-200 flex items-center gap-1.5">
          <span>🎯</span> Vùng Nhận Diện Phụ Đề (ROI)
        </h4>
        <span className="text-[10px] text-zinc-500 font-mono">
          Y: {((region?.y || 0.78) * 100).toFixed(0)}% &bull; H: {((region?.height || 0.16) * 100).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => applyPreset('bottom_standard')}
          className="p-2 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium text-center transition-colors"
        >
          🎬 Ngang Chuẩn (16:9)
        </button>
        <button
          type="button"
          onClick={() => applyPreset('bottom_tall')}
          className="p-2 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium text-center transition-colors"
        >
          📄 2 Dòng Chữ Lớn
        </button>
        <button
          type="button"
          onClick={() => applyPreset('portrait_tiktok')}
          className="p-2 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium text-center transition-colors"
        >
          📱 Video Dọc (9:16)
        </button>
      </div>

      <p className="text-zinc-500 text-[11px] leading-relaxed">
        Hệ thống chỉ quét và nhận diện chữ bên trong vùng này, giúp tăng tốc độ OCR và bỏ qua các chữ không liên quan trên màn hình.
      </p>
    </div>
  );
};
