import React from 'react';
import { AspectRatioType, MaskStyleType, ZoomMode } from '../../types/presets';
import {
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  ZoomIn,
  Eye,
  EyeOff,
  Crosshair,
  Subtitles,
  RotateCcw,
  FileVideo,
  Ratio,
  Maximize2,
} from 'lucide-react';

export type { ZoomMode };

interface ViewerToolbarProps {
  videoTitle?: string;
  videoDimensions?: { width: number; height: number };
  aspectRatio: AspectRatioType;
  onAspectRatioChange: (ratio: AspectRatioType) => void;
  fitMode?: 'contain' | 'cover';
  onToggleFitMode?: () => void;
  isFlippedH: boolean;
  onToggleFlipH: () => void;
  isFlippedV: boolean;
  onToggleFlipV: () => void;
  rotation: number;
  onRotate: () => void;
  zoomLevel: ZoomMode;
  onZoomChange: (zoom: ZoomMode) => void;
  onResetTransform: () => void;
  showRoi: boolean;
  onToggleRoi: () => void;
  previewMask: boolean;
  onTogglePreviewMask: () => void;
  maskStyle?: MaskStyleType;
  onMaskStyleChange?: (style: MaskStyleType) => void;
  showSubtitleOverlay: boolean;
  onToggleSubtitleOverlay: () => void;
}

const ViewerToolbarComponent: React.FC<ViewerToolbarProps> = ({
  videoTitle,
  videoDimensions,
  aspectRatio = 'original',
  onAspectRatioChange,
  fitMode = 'contain',
  onToggleFitMode,
  isFlippedH,
  onToggleFlipH,
  isFlippedV,
  onToggleFlipV,
  rotation,
  onRotate,
  zoomLevel,
  onZoomChange,
  onResetTransform,
  showRoi,
  onToggleRoi,
  previewMask,
  onTogglePreviewMask,
  maskStyle = 'blur',
  onMaskStyleChange,
  showSubtitleOverlay,
  onToggleSubtitleOverlay,
}) => {
  const isTransformed = isFlippedH || isFlippedV || rotation !== 0 || zoomLevel !== 'fit' || aspectRatio !== 'original';

  return (
    <div className="h-10 w-full bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between text-xs select-none shrink-0 rounded-t-xl">
      {/* Bên Trái: Tên Video + Độ Phân Giải */}
      <div className="flex items-center gap-2 min-w-0">
        <FileVideo className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span className="font-semibold text-slate-200 truncate text-[11px] max-w-[180px] sm:max-w-[240px]">
          {videoTitle || 'Video Input'}
        </span>
        {videoDimensions && videoDimensions.width > 0 && (
          <span className="text-[10px] text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 font-mono shrink-0">
            {videoDimensions.width}×{videoDimensions.height}
          </span>
        )}
      </div>

      {/* Bên Phải: Cụm Công Cụ Biến Đổi & Khung Canvas */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Bộ Chọn Tỉ Lệ Khung Hình Canvas (Aspect Ratio) */}
        <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
          <Ratio className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <select
            value={aspectRatio}
            onChange={(e) => onAspectRatioChange(e.target.value as AspectRatioType)}
            className="bg-transparent text-slate-200 text-[10px] font-mono focus:outline-none cursor-pointer"
            title="Chọn tỉ lệ khung hình Canvas (CapCut style)"
          >
            <option value="original" className="bg-slate-900">Tỉ lệ Gốc</option>
            <option value="16:9" className="bg-slate-900">16:9 (Ngang TV/YT)</option>
            <option value="9:16" className="bg-slate-900">9:16 (Dọc TikTok)</option>
            <option value="1:1" className="bg-slate-900">1:1 (Vuông IG)</option>
            <option value="4:3" className="bg-slate-900">4:3 (Cổ điển)</option>
            <option value="2.35:1" className="bg-slate-900">2.35:1 (Cinema)</option>
          </select>

          {onToggleFitMode && (
            <button
              type="button"
              onClick={onToggleFitMode}
              className={`p-0.5 rounded transition ${
                fitMode === 'cover' ? 'text-amber-300 font-bold' : 'text-slate-500 hover:text-slate-300'
              }`}
              title={fitMode === 'cover' ? 'Chế độ Fill (Tràn viền)' : 'Chế độ Fit (Đệm đen chuẩn)'}
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* Lật Ngang */}
        <button
          type="button"
          onClick={onToggleFlipH}
          className={`px-2 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
            isFlippedH
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Lật video Trái ↔ Phải (Flip Horizontal)"
        >
          <FlipHorizontal className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Lật Ngang</span>
        </button>

        {/* Lật Dọc */}
        <button
          type="button"
          onClick={onToggleFlipV}
          className={`px-2 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
            isFlippedV
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Lật video Trên ↕ Dưới (Flip Vertical)"
        >
          <FlipVertical className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Lật Dọc</span>
        </button>

        {/* Xoay 90° */}
        <button
          type="button"
          onClick={onRotate}
          className={`p-1.5 rounded transition flex items-center gap-1 ${
            rotation !== 0
              ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title={`Xoay 90° (Hiện tại: ${rotation}°)`}
        >
          <RotateCw className="w-3.5 h-3.5" />
          {rotation !== 0 && <span className="text-[10px] font-mono">{rotation}°</span>}
        </button>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* Zoom % */}
        <div className="flex items-center gap-1">
          <ZoomIn className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={zoomLevel}
            onChange={(e) => {
              const val = e.target.value;
              onZoomChange(val === 'fit' ? 'fit' : (parseFloat(val) as ZoomMode));
            }}
            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-200 font-mono focus:outline-none cursor-pointer"
          >
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>

          {isTransformed && (
            <button
              type="button"
              onClick={onResetTransform}
              className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
              title="Khôi phục trạng thái khung nhìn ban đầu"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* Che Sub Gốc & Chọn Kiểu Che */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={onTogglePreviewMask}
            className={`px-2 py-1 ${onMaskStyleChange ? 'rounded-l' : 'rounded'} text-[11px] font-medium transition flex items-center gap-1 ${
              previewMask
                ? 'bg-amber-600/30 border border-amber-500/50 text-amber-300 shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Bật/Tắt chế độ che phụ đề gốc"
          >
            {previewMask ? <Eye className="w-3 h-3 text-amber-400" /> : <EyeOff className="w-3 h-3" />}
            <span className="hidden sm:inline">{previewMask ? 'Đang che' : 'Che sub'}</span>
          </button>
          {onMaskStyleChange && (
            <select
              value={maskStyle === 'gradient' ? 'ambient' : maskStyle}
              onChange={(e) => onMaskStyleChange(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 border-l-0 rounded-r px-1.5 py-1 text-[10px] text-slate-300 font-medium focus:outline-none cursor-pointer"
              title="Kiểu che phụ đề gốc"
            >
              <option value="blur">Mờ hòa tan video</option>
              <option value="glass">Kính trong suốt</option>
              <option value="ambient">Gradient êm dịu</option>
              <option value="feather">Viền lông mềm</option>
              <option value="box">Hộp đen Cinema</option>
              <option value="mosaic">Khảm Mosaic</option>
            </select>
          )}
        </div>

        {/* Hiện Sub Dịch */}
        <button
          type="button"
          onClick={onToggleSubtitleOverlay}
          className={`px-2 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
            showSubtitleOverlay
              ? 'bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Bật/Tắt hiển thị câu phụ đề tiếng Việt đè lên video"
        >
          <Subtitles className="w-3 h-3 text-emerald-400" />
          <span className="hidden sm:inline">{showSubtitleOverlay ? 'Sub: Bật' : 'Sub: Tắt'}</span>
        </button>

        {/* Bật/Tắt Khung Quét ROI */}
        <button
          type="button"
          onClick={onToggleRoi}
          className={`px-2 py-1 rounded text-[11px] font-medium transition flex items-center gap-1 ${
            showRoi
              ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300 shadow'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title="Bật/Tắt hiển thị ô kéo vùng quét ROI"
        >
          <Crosshair className="w-3 h-3 text-indigo-400" />
          <span className="hidden sm:inline">Ô quét</span>
        </button>
      </div>
    </div>
  );
};

export const ViewerToolbar = React.memo(ViewerToolbarComponent);
