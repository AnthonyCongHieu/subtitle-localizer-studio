import React, { useState, useRef, useCallback, useEffect } from 'react';
import { RegionTrackV1 } from '../../types/api';
import { Crosshair, Droplet, Scan } from 'lucide-react';

interface RoiOverlayProps {
  region: RegionTrackV1;
  onChange: (region: RegionTrackV1) => void;
  regions?: RegionTrackV1[];
  activeRegionId?: string;
  onSelectRegion?: (id: string) => void;
  containerWidth: number;
  containerHeight: number;
  disabled?: boolean;
  scale?: number;
  rotation?: number;
}

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | null;

export const RoiOverlay: React.FC<RoiOverlayProps> = ({
  region,
  onChange,
  regions,
  activeRegionId,
  onSelectRegion,
  containerWidth,
  containerHeight,
  disabled = false,
  scale = 1,
  rotation = 0,
}) => {
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    origRegion: RegionTrackV1;
  } | null>(null);

  // Vùng đang hoạt động (Active Region)
  const currentRegion = (regions && regions.find((r) => r.region_id === (activeRegionId || region.region_id))) || region;
  const inactiveRegions = (regions || []).filter((r) => r.region_id !== currentRegion.region_id);

  // Tính toán tọa độ pixel từ tỷ lệ phần trăm chuẩn hóa [0.0, 1.0]
  // Kẹp an toàn để bảo đảm tuyệt đối không bao giờ bị tràn ngoài viền hay W > 100%
  const clampedX = Math.max(0.0, Math.min(0.97, currentRegion.x));
  const clampedY = Math.max(0.0, Math.min(0.98, currentRegion.y));
  const clampedW = Math.max(0.03, Math.min(1.0 - clampedX, currentRegion.width));
  const clampedH = Math.max(0.02, Math.min(1.0 - clampedY, currentRegion.height));

  const boxLeft = Math.round(clampedX * containerWidth);
  const boxTop = Math.round(clampedY * containerHeight);
  const boxWidth = Math.round(clampedW * containerWidth);
  const boxHeight = Math.round(clampedH * containerHeight);

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
        origRegion: { ...currentRegion },
      };
    },
    [disabled, currentRegion]
  );

  // Xử lý di chuyển chuột khi đang kéo
  useEffect(() => {
    if (!dragMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || containerWidth === 0 || containerHeight === 0) return;

      // Chuẩn hóa biến đổi chuột: chia cho scale và xoay theo ma trận quay ngược để con trỏ bám 1:1
      const effectiveScale = scale && scale > 0 ? scale : 1;
      const rad = ((rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rawDx = (e.clientX - dragStartRef.current.startX) / (containerWidth * effectiveScale);
      const rawDy = (e.clientY - dragStartRef.current.startY) / (containerHeight * effectiveScale);
      const deltaX = rawDx * cos + rawDy * sin;
      const deltaY = -rawDx * sin + rawDy * cos;
      const orig = dragStartRef.current.origRegion;

      let newX = orig.x;
      let newY = orig.y;
      let newW = orig.width;
      let newH = orig.height;

      const minW = 0.03;
      const minH = 0.02;

      // Giới hạn tuyệt đối trong phạm vi khung hình [0.0, 1.0]
      const boundMinX = 0.0;
      const boundMaxX = 1.0;
      const boundMinY = 0.0;
      const boundMaxY = 1.0;

      if (dragMode === 'move') {
        newX = Math.max(boundMinX, Math.min(boundMaxX - orig.width, orig.x + deltaX));
        newY = Math.max(boundMinY, Math.min(boundMaxY - orig.height, orig.y + deltaY));
      } else {
        // Co giãn các góc và cạnh linh hoạt, luôn khống chế trong phạm vi [0.0, 1.0]
        if (dragMode.includes('w')) {
          const maxLeft = orig.x + orig.width - minW;
          newX = Math.max(boundMinX, Math.min(maxLeft, orig.x + deltaX));
          newW = orig.width + (orig.x - newX);
        }
        if (dragMode.includes('e')) {
          newW = Math.max(minW, Math.min(boundMaxX - orig.x, orig.width + deltaX));
        }
        if (dragMode.includes('n')) {
          const maxTop = orig.y + orig.height - minH;
          newY = Math.max(boundMinY, Math.min(maxTop, orig.y + deltaY));
          newH = orig.height + (orig.y - newY);
        }
        if (dragMode.includes('s')) {
          newH = Math.max(minH, Math.min(boundMaxY - orig.y, orig.height + deltaY));
        }
      }

      // Khống chế an toàn tuyệt đối chống tràn biên
      newX = Math.max(0.0, Math.min(1.0 - minW, newX));
      newY = Math.max(0.0, Math.min(1.0 - minH, newY));
      newW = Math.max(minW, Math.min(1.0 - newX, newW));
      newH = Math.max(minH, Math.min(1.0 - newY, newH));

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
  }, [dragMode, containerWidth, containerHeight, currentRegion, onChange, scale, rotation]);

  if (containerWidth === 0 || containerHeight === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-visible select-none">
      {/* 1. Các vùng phụ (Inactive Regions) */}
      {inactiveRegions.map((inact, inactIdx) => {
        const iLeft = Math.round(inact.x * containerWidth);
        const iTop = Math.round(inact.y * containerHeight);
        const iWidth = Math.round(inact.width * containerWidth);
        const iHeight = Math.round(inact.height * containerHeight);
        return (
          <div
            key={inact.region_id}
            onClick={(e) => {
              e.stopPropagation();
              onSelectRegion?.(inact.region_id);
            }}
            className="absolute pointer-events-auto border-2 border-dashed border-emerald-400/85 bg-emerald-500/5 hover:border-emerald-300 hover:bg-emerald-500/15 rounded cursor-pointer transition-all z-30 group shadow-sm"
            style={{
              left: `${iLeft}px`,
              top: `${iTop}px`,
              width: `${iWidth}px`,
              height: `${iHeight}px`,
            }}
            title="Nhấp để chọn và điều chỉnh vùng này"
          >
            <span className="sr-only">Vùng {inactIdx + 2}</span>
          </div>
        );
      })}

      {/* 2. Khung viền chữ nhật Vùng Đang Chọn (Active ROI) */}
      {disabled ? (
        /* Chế độ dẫn hướng bị động: Vẫn hiển thị rõ ràng và cho phép nhấp chọn để kích hoạt */
        <div
          className="absolute pointer-events-auto cursor-pointer border border-dashed border-indigo-400/80 bg-indigo-500/5 hover:border-indigo-400 rounded z-20"
          style={{
            left: `${boxLeft}px`,
            top: `${boxTop}px`,
            width: `${boxWidth}px`,
            height: `${boxHeight}px`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRegion?.(currentRegion.region_id);
          }}
          title="Nhấp để chuyển sang chế độ Quét Sub và điều chỉnh vùng này"
        />
      ) : (
        /* Chế độ tương tác đầy đủ: 8 mấu kéo, mặt nạ và tọa độ chi tiết */
        <div
          className="absolute pointer-events-auto border-2 border-indigo-400 bg-indigo-500/5 rounded cursor-move shadow-[0_0_15px_rgba(99,102,241,0.4)] transition-shadow hover:shadow-[0_0_25px_rgba(99,102,241,0.7)] z-50"
          style={{
            left: `${boxLeft}px`,
            top: `${boxTop}px`,
            width: `${boxWidth}px`,
            height: `${boxHeight}px`,
          }}
          onMouseDown={(e) => handleMouseDown('move', e)}
        >
          {/* Lưới định vị hỗ trợ căn chỉnh (Rule of thirds guide) */}
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-1 pointer-events-none opacity-20 border-indigo-300">
            <div className="border-r border-indigo-300" />
            <div className="border-r border-indigo-300" />
          </div>

          {/* 4 Tay cầm ở 4 góc - Thiết kế nhỏ gọn, tinh tế, không che phụ đề */}
          <div
            className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-white border border-indigo-600 rounded-[2px] cursor-nwse-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('nw', e)}
            title="Kéo chỉnh kích thước góc Tây Bắc"
          />
          <div
            className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white border border-indigo-600 rounded-[2px] cursor-nesw-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('ne', e)}
            title="Kéo chỉnh kích thước góc Đông Bắc"
          />
          <div
            className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-white border border-indigo-600 rounded-[2px] cursor-nesw-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('sw', e)}
            title="Kéo chỉnh kích thước góc Tây Nam"
          />
          <div
            className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-white border border-indigo-600 rounded-[2px] cursor-nwse-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('se', e)}
            title="Kéo chỉnh kích thước góc Đông Nam"
          />

          {/* 4 Tay cầm ở 4 cạnh - Kích thước thanh mảnh */}
          <div
            className="absolute -top-1 left-1/2 -translate-x-1/2 w-3.5 h-1.5 bg-white border border-indigo-600 rounded-[1px] cursor-ns-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('n', e)}
            title="Kéo chỉnh mép trên"
          />
          <div
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3.5 h-1.5 bg-white border border-indigo-600 rounded-[1px] cursor-ns-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('s', e)}
            title="Kéo chỉnh mép dưới"
          />
          <div
            className="absolute -left-1 top-1/2 -translate-y-1/2 h-3.5 w-1.5 bg-white border border-indigo-600 rounded-[1px] cursor-ew-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('w', e)}
            title="Kéo chỉnh mép trái"
          />
          <div
            className="absolute -right-1 top-1/2 -translate-y-1/2 h-3.5 w-1.5 bg-white border border-indigo-600 rounded-[1px] cursor-ew-resize shadow-sm hover:scale-125 transition-transform z-50 pointer-events-auto"
            onMouseDown={(e) => handleMouseDown('e', e)}
            title="Kéo chỉnh mép phải"
          />
        </div>
      )}

      {/* Nhãn thông số ROI tinh tế - Đặt ở góc dưới đáy bên phải, không che nội dung video */}
      {!disabled && (
        <div className="absolute bottom-2 right-2 bg-slate-950/90 backdrop-blur-md text-indigo-300 border border-slate-800 px-2.5 py-1 rounded-lg text-[10px] font-mono flex items-center gap-1.5 shadow-xl pointer-events-none z-50">
          <Crosshair className="w-3 h-3 text-indigo-400" />
          <span className="font-semibold text-slate-200">ROI:</span>
          {currentRegion.mask_enabled !== false ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
              <Droplet className="w-2.5 h-2.5" /> Làm mờ
            </span>
          ) : (
            <span className="text-amber-400 font-semibold flex items-center gap-0.5">
              <Scan className="w-2.5 h-2.5" /> Chỉ quét
            </span>
          )}
          <span className="text-slate-600">|</span>
          <span>Y: {Math.round(clampedY * 100)}%</span>
          <span>H: {Math.round(clampedH * 100)}%</span>
          <span>W: {Math.round(clampedW * 100)}%</span>
        </div>
      )}
    </div>
  );
};
