import React, { useRef, useState, useEffect } from 'react';
import { RotateCw } from 'lucide-react';

interface VideoTransformOverlayProps {
  // Kích thước canvas gốc
  containerWidth: number;
  containerHeight: number;
  // Trạng thái biến đổi hiện tại
  position: { x: number; y: number };
  scale: number;
  rotation: number;
  isFlippedH?: boolean;
  isFlippedV?: boolean;
  // Callback cập nhật
  onPositionChange: (pos: { x: number; y: number }) => void;
  onScaleChange: (scale: number) => void;
  onRotationChange: (rotation: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  // Trạng thái hiển thị
  isActive: boolean;
}

type DragAction = 'move' | 'scale_nw' | 'scale_ne' | 'scale_se' | 'scale_sw' | 'scale_n' | 'scale_s' | 'scale_e' | 'scale_w' | 'rotate' | null;

export const VideoTransformOverlay: React.FC<VideoTransformOverlayProps> = ({
  containerWidth,
  containerHeight,
  position,
  scale,
  rotation,
  isFlippedH = false,
  isFlippedV = false,
  onPositionChange,
  onScaleChange,
  onRotationChange,
  onDragStateChange,
  isActive,
}) => {
  const [dragAction, setDragAction] = useState<DragAction>(null);

  useEffect(() => {
    onDragStateChange?.(dragAction !== null);
  }, [dragAction, onDragStateChange]);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    startPos: { x: number; y: number };
    startScale: number;
    startRotation: number;
    centerX: number;
    centerY: number;
    startDist: number;
    startAngle: number;
  }>({
    mouseX: 0,
    mouseY: 0,
    startPos: { x: 0, y: 0 },
    startScale: 1,
    startRotation: 0,
    centerX: 0,
    centerY: 0,
    startDist: 1,
    startAngle: 0,
  });

  const overlayRef = useRef<HTMLDivElement>(null);

  // Khởi động thao tác kéo chuột
  const handleStartDrag = (action: DragAction, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!overlayRef.current) return;
    const parent = overlayRef.current.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    // Tâm của video trên màn hình (đã cộng offset vị trí)
    const centerX = parentRect.left + parentRect.width / 2 + position.x;
    const centerY = parentRect.top + parentRect.height / 2 + position.y;

    const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1;
    const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startPos: { ...position },
      startScale: scale,
      startRotation: rotation,
      centerX,
      centerY,
      startDist,
      startAngle,
    };

    setDragAction(action);
  };

  // Xử lý di chuyển chuột toàn cục
  useEffect(() => {
    if (!dragAction) return;

    const handleMouseMove = (e: MouseEvent) => {
      const {
        mouseX,
        mouseY,
        startPos,
        startScale,
        startRotation,
        centerX,
        centerY,
        startDist,
        startAngle,
      } = dragStartRef.current;

      if (dragAction === 'move') {
        // Di chuyển vị trí X, Y
        const dx = e.clientX - mouseX;
        const dy = e.clientY - mouseY;
        onPositionChange({
          x: Math.round(startPos.x + dx),
          y: Math.round(startPos.y + dy),
        });
      } else if (dragAction.startsWith('scale_')) {
        // Co giãn tỷ lệ video (Scale)
        const currentDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
        const ratio = currentDist / startDist;
        // Giới hạn scale từ 10% đến 400%
        const newScale = Math.max(0.1, Math.min(4.0, parseFloat((startScale * ratio).toFixed(3))));
        onScaleChange(newScale);
      } else if (dragAction === 'rotate') {
        // Xoay video quanh tâm
        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
        let deltaAngle = currentAngle - startAngle;
        let newRot = Math.round(startRotation + deltaAngle);
        // Chuẩn hóa góc xoay [-180, 180]
        let normalized = newRot % 360;
        if (normalized > 180) normalized -= 360;
        if (normalized < -180) normalized += 360;
        onRotationChange(normalized);
      }
    };

    const handleMouseUp = () => {
      setDragAction(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragAction, onPositionChange, onScaleChange, onRotationChange]);

  if (!isActive || containerWidth === 0 || containerHeight === 0) return null;

  // Transform đồng bộ tuyệt đối với thẻ video
  const transformStyle: React.CSSProperties = {
    width: `${containerWidth}px`,
    height: `${containerHeight}px`,
    transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg) scaleX(${isFlippedH ? -1 : 1}) scaleY(${isFlippedV ? -1 : 1})`,
    transformOrigin: 'center center',
    transition: dragAction ? 'none' : 'transform 100ms ease-out',
  };

  return (
    <div
      ref={overlayRef}
      style={transformStyle}
      className="absolute inset-0 pointer-events-none z-30 select-none"
    >
      {/* 1. Khung viền bounding box CapCut */}
      <div
        className="w-full h-full border-2 border-white/95 shadow-2xl relative pointer-events-auto cursor-move rounded-none group"
        onMouseDown={(e) => handleStartDrag('move', e)}
        title="Nhấp và kéo để di chuyển vị trí video"
      >
        {/* Lớp phủ mờ khi hover để người dùng nhận biết có thể kéo */}
        <div className="absolute inset-0 bg-white/5 hover:bg-white/10 transition-colors rounded-none" />

        {/* 2. Bốn mấu tay cầm ở 4 góc (Resize Corners) */}
        {/* Góc Tây Bắc (NW) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_nw', e)}
          className="absolute -top-2 -left-2 w-4 h-4 bg-white border border-slate-900 rounded-full shadow-md cursor-nwse-resize hover:scale-125 transition-transform z-10"
          title="Kéo để phóng to / thu nhỏ video"
        />
        {/* Góc Đông Bắc (NE) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_ne', e)}
          className="absolute -top-2 -right-2 w-4 h-4 bg-white border border-slate-900 rounded-full shadow-md cursor-nesw-resize hover:scale-125 transition-transform z-10"
          title="Kéo để phóng to / thu nhỏ video"
        />
        {/* Góc Đông Nam (SE) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_se', e)}
          className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border border-slate-900 rounded-full shadow-md cursor-nwse-resize hover:scale-125 transition-transform z-10"
          title="Kéo để phóng to / thu nhỏ video"
        />
        {/* Góc Tây Nam (SW) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_sw', e)}
          className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border border-slate-900 rounded-full shadow-md cursor-nesw-resize hover:scale-125 transition-transform z-10"
          title="Kéo để phóng to / thu nhỏ video"
        />

        {/* 3. Bốn mấu tay cầm ở 4 cạnh (Edge Handles) */}
        {/* Cạnh Trên (N) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_n', e)}
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-3 bg-white border border-slate-900 rounded-sm shadow-md cursor-ns-resize hover:scale-125 transition-transform z-10"
        />
        {/* Cạnh Dưới (S) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_s', e)}
          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-3 bg-white border border-slate-900 rounded-sm shadow-md cursor-ns-resize hover:scale-125 transition-transform z-10"
        />
        {/* Cạnh Trái (W) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_w', e)}
          className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-4 bg-white border border-slate-900 rounded-sm shadow-md cursor-ew-resize hover:scale-125 transition-transform z-10"
        />
        {/* Cạnh Phải (E) */}
        <div
          onMouseDown={(e) => handleStartDrag('scale_e', e)}
          className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-3 h-4 bg-white border border-slate-900 rounded-sm shadow-md cursor-ew-resize hover:scale-125 transition-transform z-10"
        />

        {/* 4. Mấu xoay tròn dưới đáy video (CapCut Rotate Handle) */}
        <div className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-auto z-20">
          {/* Đường nối thanh mảnh */}
          <div className="w-0.5 h-3.5 bg-white/90 shadow" />
          {/* Nút xoay tròn */}
          <button
            type="button"
            onMouseDown={(e) => handleStartDrag('rotate', e)}
            className="w-6 h-6 rounded-full bg-slate-900/90 border border-white text-white flex items-center justify-center shadow-lg hover:bg-white hover:text-slate-900 transition cursor-grab active:cursor-grabbing"
            title="Kéo để xoay video quanh tâm"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 5. Nhãn thông số trực quan (Position & Scale Tooltip) */}
        {(dragAction || position.x !== 0 || position.y !== 0 || scale !== 1.0) && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-slate-950/90 backdrop-blur border border-slate-700/80 rounded text-[10px] font-mono text-cyan-300 shadow-lg whitespace-nowrap pointer-events-none">
            X: {position.x}px | Y: {position.y}px | {Math.round(scale * 100)}% | {rotation}°
          </div>
        )}
      </div>
    </div>
  );
};
