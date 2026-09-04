import React, { useState } from 'react';
import {
  AspectRatioType,
  MaskStyleType,
  SubtitlePlacementMode,
  ZoomMode,
} from '../../types/presets';
import {
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  RotateCcw,
  ZoomIn,
  Eye,
  EyeOff,
  Crosshair,
  Subtitles,
  FileVideo,
  Ratio,
  Maximize2,
  Minimize2,
  Sliders,
} from 'lucide-react';

export type { ZoomMode };

export interface ViewerToolbarProps {
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
  onRotationChange?: (rotation: number) => void;
  zoomLevel: ZoomMode;
  onZoomChange: (zoom: ZoomMode) => void;
  onResetTransform: () => void;
  showRoi: boolean;
  onToggleRoi: () => void;
  previewMask: boolean;
  onTogglePreviewMask: () => void;
  maskStyle?: MaskStyleType;
  onMaskStyleChange?: (style: MaskStyleType) => void;
  blurStrength?: number;
  onBlurStrengthChange?: (strength: number) => void;
  showSubtitleOverlay: boolean;
  onToggleSubtitleOverlay: () => void;
  subtitlePlacement?: SubtitlePlacementMode;
  onSubtitlePlacementChange?: (mode: SubtitlePlacementMode) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
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
  onRotationChange,
  zoomLevel,
  onZoomChange,
  onResetTransform,
  showRoi,
  onToggleRoi,
  previewMask,
  onTogglePreviewMask,
  maskStyle = 'feather_tight',
  onMaskStyleChange,
  blurStrength = 20,
  onBlurStrengthChange,
  showSubtitleOverlay,
  onToggleSubtitleOverlay,
  subtitlePlacement = 'roi',
  onSubtitlePlacementChange,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const [showBlurSlider, setShowBlurSlider] = useState(false);

  const isTransformed =
    isFlippedH ||
    isFlippedV ||
    rotation !== 0 ||
    zoomLevel !== 'fit' ||
    aspectRatio !== 'original';

  const zoomNumericValue =
    typeof zoomLevel === 'number' ? Math.round(zoomLevel * 100) : 100;

  return (
    <div className="h-10 w-full bg-slate-900 border-b border-slate-800 px-3 flex items-center justify-between text-xs select-none shrink-0 rounded-t-xl gap-2 overflow-x-auto no-scrollbar">
      {/* Bên Trái: Tên Video + Độ Phân Giải */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <FileVideo className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span
          className="font-semibold text-slate-200 truncate text-[11px] max-w-[130px] sm:max-w-[200px]"
          title={videoTitle || 'Video Input'}
        >
          {videoTitle || 'Video Input'}
        </span>
        {videoDimensions && videoDimensions.width > 0 && (
          <span className="text-[10px] text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 font-mono shrink-0 hidden sm:inline">
            {videoDimensions.width}×{videoDimensions.height}
          </span>
        )}
      </div>

      {/* Bên Phải: Cụm Công Cụ Biến Đổi & Khung Canvas */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* 1. Bộ Chọn Tỉ Lệ Khung Hình Canvas (Aspect Ratio) */}
        <div className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
          <Ratio className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <select
            value={aspectRatio}
            onChange={(e) =>
              onAspectRatioChange(e.target.value as AspectRatioType)
            }
            className="bg-transparent text-slate-200 text-[10px] font-mono focus:outline-none cursor-pointer"
            title="Chọn tỉ lệ khung hình Canvas"
          >
            <option value="original" className="bg-slate-900">
              Gốc
            </option>
            <option value="16:9" className="bg-slate-900">
              16:9 (YT/TV)
            </option>
            <option value="9:16" className="bg-slate-900">
              9:16 (TikTok)
            </option>
            <option value="1:1" className="bg-slate-900">
              1:1 (Vuông)
            </option>
            <option value="4:3" className="bg-slate-900">
              4:3 (Cổ điển)
            </option>
            <option value="2.35:1" className="bg-slate-900">
              2.35:1 (Cinema)
            </option>
          </select>

          {onToggleFitMode && (
            <button
              type="button"
              onClick={onToggleFitMode}
              className={`p-0.5 rounded transition ${
                fitMode === 'cover'
                  ? 'text-amber-300 font-bold'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
              title={
                fitMode === 'cover'
                  ? 'Chế độ Fill (Tràn viền)'
                  : 'Chế độ Fit (Đệm đen chuẩn)'
              }
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* 2. Thanh Trượt Xoay % / Độ (Rotation Slider) */}
        <div
          className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800"
          title={`Góc xoay video: ${rotation}° (Kéo thanh trượt để xoay mượt mà)`}
        >
          <RotateCw className="w-3 h-3 text-cyan-400 shrink-0" />
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (onRotationChange) {
                onRotationChange(val);
              }
            }}
            className="w-24 sm:w-28 h-1.5 accent-cyan-400 bg-slate-700 rounded cursor-pointer"
          />
          <button
            type="button"
            onClick={() => {
              if (onRotationChange) {
                onRotationChange(0);
              }
            }}
            className={`text-[10px] font-mono px-1 py-0.2 rounded transition ${
              rotation !== 0
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-semibold hover:bg-cyan-900'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Nhấp để reset về 0°"
          >
            {rotation}°
          </button>
          <button
            type="button"
            onClick={onRotate}
            className="p-0.5 text-slate-400 hover:text-cyan-300 transition"
            title="Xoay nhanh +90°"
          >
            <RotateCw className="w-2.5 h-2.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* 3. Thanh Trượt Zoom % (Zoom Slider) */}
        <div
          className="flex items-center gap-1 bg-slate-950 px-2 py-0.5 rounded border border-slate-800"
          title={`Phóng to / Thu nhỏ: ${zoomLevel === 'fit' ? 'Fit' : `${zoomNumericValue}%`}`}
        >
          <ZoomIn className="w-3 h-3 text-indigo-400 shrink-0" />
          <input
            type="range"
            min={50}
            max={300}
            step={5}
            value={zoomNumericValue}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              onZoomChange(val / 100);
            }}
            className="w-24 sm:w-32 h-1.5 accent-indigo-500 bg-slate-700 rounded cursor-pointer"
          />
          <button
            type="button"
            onClick={() => onZoomChange('fit')}
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded transition ${
              zoomLevel === 'fit'
                ? 'bg-indigo-600 text-white font-semibold'
                : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-700'
            }`}
            title="Trở về chế độ Fit vừa vặn"
          >
            {zoomLevel === 'fit' ? 'Fit' : `${zoomNumericValue}%`}
          </button>
        </div>

        {/* Nút Reset Biến Đổi Nếu Đã Biến Đổi */}
        {isTransformed && (
          <button
            type="button"
            onClick={onResetTransform}
            className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
            title="Khôi phục trạng thái khung nhìn ban đầu (Reset tất cả)"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* 4. Lật Ngang / Lật Dọc */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onToggleFlipH}
            className={`p-1 rounded text-[10px] font-medium transition ${
              isFlippedH
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Lật video Trái ↔ Phải (Flip Horizontal)"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleFlipV}
            className={`p-1 rounded text-[10px] font-medium transition ${
              isFlippedV
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Lật video Trên ↕ Dưới (Flip Vertical)"
          >
            <FlipVertical className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* 5. Che Sub Gốc & Chọn Kiểu Che Đa Dạng & Độ Mờ Slider */}
        <div className="flex items-center relative">
          <button
            type="button"
            onClick={onTogglePreviewMask}
            className={`px-2 py-1 ${
              onMaskStyleChange ? 'rounded-l' : 'rounded'
            } text-[11px] font-medium transition flex items-center gap-1 ${
              previewMask
                ? 'bg-amber-600/30 border border-amber-500/50 text-amber-300 shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Bật/Tắt chế độ che phụ đề gốc"
          >
            {previewMask ? (
              <Eye className="w-3 h-3 text-amber-400" />
            ) : (
              <EyeOff className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">
              {previewMask ? 'Đang che' : 'Che sub'}
            </span>
          </button>
          {onMaskStyleChange && (
            <select
              value={maskStyle}
              onChange={(e) => onMaskStyleChange(e.target.value as MaskStyleType)}
              className="bg-slate-950 border border-slate-800 border-l-0 px-1.5 py-1 text-[10px] text-slate-300 font-medium focus:outline-none cursor-pointer"
              title="Kiểu hiệu ứng che phụ đề gốc"
            >
              <option value="feather_tight" className="bg-slate-900 text-amber-300 font-semibold">
                ✨ Mờ bám chữ (Khuyên dùng)
              </option>
              <option value="optical_blend" className="bg-slate-900 text-cyan-300 font-semibold">
                💧 Hòa tan quang học (Trong suốt)
              </option>
              <option value="soft_cinema" className="bg-slate-900">
                🎬 Gradient điện ảnh mềm
              </option>
              <option value="blur" className="bg-slate-900">
                Mờ hòa tan tự nhiên
              </option>
              <option value="glass" className="bg-slate-900">
                Kính mờ sương
              </option>
              <option value="ambient" className="bg-slate-900">
                Gradient êm dịu
              </option>
              <option value="feather" className="bg-slate-900">
                Viền lông mềm
              </option>
              <option value="box" className="bg-slate-900">
                Hộp đen Cinema
              </option>
              <option value="mosaic" className="bg-slate-900">
                Khảm Mosaic
              </option>
            </select>
          )}

          {/* Nút Mở Thanh Trượt Cường Độ Mờ */}
          {onBlurStrengthChange && (
            <button
              type="button"
              onClick={() => setShowBlurSlider(!showBlurSlider)}
              className={`p-1 bg-slate-950 border border-slate-800 border-l-0 rounded-r text-[10px] transition ${
                showBlurSlider ? 'text-amber-400 bg-slate-800' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Chỉnh độ mờ (Blur Strength)"
            >
              <Sliders className="w-3 h-3" />
            </button>
          )}

          {/* Popover Điều Chỉnh Độ Mờ */}
          {showBlurSlider && onBlurStrengthChange && (
            <div className="absolute top-full mt-1 right-0 bg-slate-900 border border-slate-700 p-2 rounded-lg shadow-2xl z-50 flex items-center gap-2 text-slate-200 animate-in fade-in">
              <span className="text-[10px] whitespace-nowrap font-medium text-slate-400">
                Độ mờ:
              </span>
              <input
                type="range"
                min={6}
                max={48}
                step={2}
                value={blurStrength}
                onChange={(e) => onBlurStrengthChange(parseInt(e.target.value, 10))}
                className="w-20 h-1 accent-amber-400 bg-slate-800 rounded cursor-pointer"
              />
              <span className="text-[10px] font-mono text-amber-300 w-7">
                {blurStrength}px
              </span>
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* 6. Hiện Sub Dịch & Vị Trí Phụ Đề (Đáy Video vs Vùng Quét) */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={onToggleSubtitleOverlay}
            className={`px-2 py-1 ${
              onSubtitlePlacementChange ? 'rounded-l' : 'rounded'
            } text-[11px] font-medium transition flex items-center gap-1 ${
              showSubtitleOverlay
                ? 'bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Bật/Tắt hiển thị câu phụ đề tiếng Việt đè lên video"
          >
            <Subtitles className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">
              {showSubtitleOverlay ? 'Sub: Bật' : 'Sub: Tắt'}
            </span>
          </button>

          {onSubtitlePlacementChange && (
            <button
              type="button"
              onClick={() =>
                onSubtitlePlacementChange(
                  subtitlePlacement === 'bottom' ? 'roi' : 'bottom'
                )
              }
              className="bg-slate-950 border border-slate-800 border-l-0 rounded-r px-1.5 py-1 text-[10px] text-slate-300 font-medium hover:text-emerald-300 transition"
              title={
                subtitlePlacement === 'bottom'
                  ? 'Vị trí Sub: Đáy video (Chuẩn điện ảnh). Nhấp để đổi sang Vùng quét.'
                  : 'Vị trí Sub: Trong vùng quét (Đè chữ gốc). Nhấp để đổi sang Đáy video.'
              }
            >
              {subtitlePlacement === 'bottom' ? 'Đáy video' : 'Vùng quét'}
            </button>
          )}
        </div>

        {/* 7. Bật/Tắt Khung Quét ROI */}
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

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        {/* 8. Toàn Màn Hình CHỈ VIDEO (Pure Video Fullscreen) */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className={`p-1.5 rounded transition flex items-center gap-1 ${
              isFullscreen
                ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/50'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
            }`}
            title="Toàn màn hình CHỈ VIDEO (Loại bỏ toàn bộ thanh công cụ, phím F)"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-slate-300" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export const ViewerToolbar = React.memo(ViewerToolbarComponent);
