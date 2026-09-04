import React, { useState, useRef, useCallback, useEffect } from 'react';
import { RegionTrackV1 } from '../../types/api';
import { Crosshair } from 'lucide-react';

interface RoiOverlayProps {
  region: RegionTrackV1;
  onChange: (region: RegionTrackV1) => void;
  containerWidth: number;
  containerHeight: number;
  disabled?: boolean;
}

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null;

export const RoiOverlay: React.FC<RoiOverlayProps> = ({
  region,
  onChange,
  containerWidth,
  containerHeight,
  disabled = false,
}) => {
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    origRegion: RegionTrackV1;
  } | null>(null);

  // Tính toán tọa độ pixel từ tỷ lệ phần trăm chuẩn hóa [0.0, 1.0]
  const boxLeft = Math.round(region.x * containerWidth);
  const boxTop = Math.round(region.y * containerHeight);
  const boxWidth = Math.round(region.width * containerWidth);
  const boxHeight = Math.round(region.height * containerHeight);

  // Bắt đầu sự kiện kéo thả hoặc co giãn kích thước
  const handleMouseDown = useCallback(
    (mode: DragMode, e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      setDragMode(mode);
      dragStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origRegion: { ...region },
      };
    },
    [disabled, region]
  );

  // Xử lý di chuyển chuột khi đang kéo
  useEffect(() => {
    if (!dragMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || containerWidth === 0 || containerHeight === 0) return;

      const deltaX = (e.clientX - dragStartRef.current.startX) / containerWidth;
      const deltaY = (e.clientY - dragStartRef.current.startY) / containerHeight;
      const orig = dragStartRef.current.origRegion;

      let newX = orig.x;
      let newY = orig.y;
      let newW = orig.width;
      let newH = orig.height;

      const minW = 0.05;
      const minH = 0.03;

      if (dragMode === 'move') {
        newX = Math.max(0, Math.min(1.0 - orig.width, orig.x + deltaX));
        newY = Math.max(0, Math.min(1.0 - orig.height, orig.y + deltaY));
      } else {
        // Co giãn các góc và cạnh
        if (dragMode.includes('w')) {
          const maxLeft = orig.x + orig.width - minW;
          newX = Math.max(0, Math.min(maxLeft, orig.x + deltaX));
          newW = orig.width + (orig.x - newX);
        }
        if (dragMode.includes('e')) {
          newW = Math.max(minW, Math.min(1.0 - orig.x, orig.width + deltaX));
        }
        if (dragMode.includes('n')) {
          const maxTop = orig.y + orig.height - minH;
          newY = Math.max(0, Math.min(maxTop, orig.y + deltaY));
          newH = orig.height + (orig.y - newY);
        }
        if (dragMode.includes('s')) {
          newH = Math.max(minH, Math.min(1.0 - orig.y, orig.height + deltaY));
        }
      }

      onChange({
        ...region,
        x: parseFloat(newX.toFixed(4)),
        y: parseFloat(newY.toFixed(4)),
        width: parseFloat(newW.toFixed(4)),
        height: parseFloat(newH.toFixed(4)),
      });
    };

    const handleMouseUp = () => {
      setDragMode(null);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, containerWidth, containerHeight, region, onChange]);

  if (containerWidth === 0 || containerHeight === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden select-none">
      {/* 1. Vùng tối bên ngoài (Mặt nạ lấy nét - Focus Mask) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="roi-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={boxLeft}
              y={boxTop}
              width={boxWidth}
              height={boxHeight}
              fill="black"
              rx="4"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.45)"
          mask="url(#roi-spotlight-mask)"
        />
      </svg>

      {/* 2. Khung viền chữ nhật ROI tương tác */}
      <div
        className="absolute pointer-events-auto border-2 border-indigo-400 bg-indigo-500/10 rounded cursor-move shadow-[0_0_15px_rgba(99,102,241,0.35)] transition-shadow hover:shadow-[0_0_20px_rgba(99,102,241,0.6)]"
        style={{
          left: `${boxLeft}px`,
          top: `${boxTop}px`,
          width: `${boxWidth}px`,
          height: `${boxHeight}px`,
        }}
        onMouseDown={(e) => handleMouseDown('move', e)}
      >
        {/* Nhãn thông tin tọa độ tinh tế */}
        <div className="absolute -top-6 left-0 bg-slate-900/90 text-indigo-300 border border-slate-700/80 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 shadow pointer-events-none whitespace-nowrap">
          <Crosshair className="w-2.5 h-2.5 text-indigo-400" />
          <span>Vùng Quét</span>
          <span className="text-slate-500">|</span>
          <span>Y: {Math.round(region.y * 100)}%</span>
          <span>H: {Math.round(region.height * 100)}%</span>
          <span>W: {Math.round(region.width * 100)}%</span>
        </div>

        {/* Lưới định vị hỗ trợ căn chỉnh (Rule of thirds guide) */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-1 pointer-events-none opacity-20 border-indigo-300">
          <div className="border-r border-indigo-300" />
          <div className="border-r border-indigo-300" />
        </div>

        {/* 4 Tay cầm ở 4 góc */}
        <div
          className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border border-indigo-600 rounded-sm cursor-nwse-resize shadow hover:scale-125 transition-transform"
          onMouseDown={(e) => handleMouseDown('nw', e)}
        />
        <div
          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border border-indigo-600 rounded-sm cursor-nesw-resize shadow hover:scale-125 transition-transform"
          onMouseDown={(e) => handleMouseDown('ne', e)}
        />
        <div
          className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border border-indigo-600 rounded-sm cursor-nesw-resize shadow hover:scale-125 transition-transform"
          onMouseDown={(e) => handleMouseDown('sw', e)}
        />
        <div
          className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border border-indigo-600 rounded-sm cursor-nwse-resize shadow hover:scale-125 transition-transform"
          onMouseDown={(e) => handleMouseDown('se', e)}
        />

        {/* 4 Tay cầm ở 4 cạnh */}
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-6 h-2.5 bg-white border border-indigo-600 rounded-sm cursor-ns-resize shadow hover:scale-110 transition-transform"
          onMouseDown={(e) => handleMouseDown('n', e)}
        />
        <div
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-2.5 bg-white border border-indigo-600 rounded-sm cursor-ns-resize shadow hover:scale-110 transition-transform"
          onMouseDown={(e) => handleMouseDown('s', e)}
        />
        <div
          className="absolute -left-1.5 top-1/2 -translate-y-1/2 h-6 w-2.5 bg-white border border-indigo-600 rounded-sm cursor-ew-resize shadow hover:scale-110 transition-transform"
          onMouseDown={(e) => handleMouseDown('w', e)}
        />
        <div
          className="absolute -right-1.5 top-1/2 -translate-y-1/2 h-6 w-2.5 bg-white border border-indigo-600 rounded-sm cursor-ew-resize shadow hover:scale-110 transition-transform"
          onMouseDown={(e) => handleMouseDown('e', e)}
        />
      </div>
    </div>
  );
};
