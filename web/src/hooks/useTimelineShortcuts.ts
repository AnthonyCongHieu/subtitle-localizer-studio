import { useEffect, useCallback } from 'react';
import { SubtitleCueV1 } from '../types/api';

interface UseTimelineShortcutsOptions {
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  selectedCueId?: string | null;
  selectedCueIds?: string[];
  cues: SubtitleCueV1[];
  onSplitCue?: (time: number) => void;
  onDeleteCue?: (cueId: string) => void;
  onDeleteCues?: (cueIds: string[]) => void;
  onDeselectCue?: () => void;
  onToggleFullscreen?: () => void;
  onToggleAudioMute?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  enabled?: boolean;
}

/**
 * Hook quản lý toàn bộ phím tắt chuẩn CapCut PC & Premiere Pro:
 * - Space hoặc K: Phát / Tạm dừng (Play / Pause)
 * - J / L: Tua nhanh lùi / tiến 1s
 * - S hoặc C hoặc Ctrl+B: Cắt / Tách câu phụ đề tại vị trí playhead (Split Cue)
 * - Delete hoặc Backspace: Xóa câu phụ đề đang chọn (Delete Cue)
 * - Escape: Bỏ chọn câu phụ đề (Deselect)
 * - M: Bật / Tắt tiếng (Mute toggle)
 * - Home / End: Về đầu (0s) hoặc cuối video
 * - + / = và - / _: Phóng to / Thu nhỏ timeline (Zoom In/Out)
 * - Mũi tên Trái / Phải: Tua lùi / tiến 1 frame (~0.04s)
 * - Shift + Mũi tên Trái / Phải: Nhảy đến câu phụ đề trước / sau (Jump Cue)
 * - F: Bật / Tắt chế độ toàn màn hình (Fullscreen)
 * - Ctrl + Z / Ctrl + Y / Ctrl + Shift + Z: Hoàn tác / Làm lại (Undo / Redo)
 */
export function useTimelineShortcuts({
  isPlaying,
  onTogglePlay,
  currentTime,
  duration,
  onSeek,
  selectedCueId,
  selectedCueIds,
  cues,
  onSplitCue,
  onDeleteCue,
  onDeleteCues,
  onDeselectCue,
  onToggleFullscreen,
  onToggleAudioMute,
  onZoomIn,
  onZoomOut,
  onUndo,
  onRedo,
  enabled = true,
}: UseTimelineShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Không can thiệp nếu người dùng đang nhập văn bản trong ô input, textarea, select hoặc contentEditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest('input, textarea, select, [contenteditable="true"]') ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // 1. Phím Space hoặc K: Play / Pause
      if (
        (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Space') ||
        (!e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'k' || e.key === 'K'))
      ) {
        e.preventDefault();
        onTogglePlay();
        return;
      }

      // 1.1. Phím J / L: Tua nhanh lùi / tiến 1s chuẩn Premiere / CapCut
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        if (e.key === 'j' || e.key === 'J') {
          e.preventDefault();
          onSeek(Math.max(0, currentTime - 1.0));
          return;
        }
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          onSeek(Math.min(duration || 9999, currentTime + 1.0));
          return;
        }
      }

      // 2. Ctrl + B hoặc phím C hoặc phím S (không kèm Ctrl/Alt): Cắt / Tách câu phụ đề tại vị trí con trỏ Playhead
      if (
        ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) ||
        (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 's' || e.key === 'S'))
      ) {
        e.preventDefault();
        if (onSplitCue) {
          onSplitCue(currentTime);
        }
        return;
      }

      // 3. Phím Delete hoặc Backspace: Xóa câu phụ đề đang chọn (Đơn lẻ hoặc Hàng loạt)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedCueIds && selectedCueIds.length > 0 && onDeleteCues) {
          e.preventDefault();
          onDeleteCues(selectedCueIds);
          return;
        }
        if (selectedCueId && onDeleteCue) {
          e.preventDefault();
          onDeleteCue(selectedCueId);
          return;
        }
      }

      // 3.1. Phím Escape: Bỏ chọn câu phụ đề đang chọn
      if (e.key === 'Escape') {
        e.preventDefault();
        onDeselectCue?.();
        return;
      }

      // 3.2. Phím M: Tắt / Bật tiếng audio gốc
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        onToggleAudioMute?.();
        return;
      }

      // 3.3. Phím Home / End: Về đầu (0s) hoặc cuối video
      if (e.key === 'Home') {
        e.preventDefault();
        onSeek(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        if (duration > 0) onSeek(duration);
        return;
      }

      // 3.4. Phím + / = và - / _: Phóng to / Thu nhỏ dòng thời gian
      if (!e.altKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        onZoomIn?.();
        return;
      }
      if (!e.altKey && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        onZoomOut?.();
        return;
      }

      // 4. Mũi tên Trái / Phải: Tua 1 frame (~0.04s) hoặc 0.1s
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + Left: Nhảy về câu phụ đề trước
          const prevCues = cues.filter((c) => c.start_pts < currentTime - 0.05);
          if (prevCues.length > 0) {
            const target = prevCues[prevCues.length - 1];
            onSeek(target.start_pts);
          } else {
            onSeek(0);
          }
        } else {
          // Tua lùi 1 frame
          onSeek(Math.max(0, currentTime - 0.04));
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift + Right: Nhảy đến câu phụ đề tiếp theo
          const nextCue = cues.find((c) => c.start_pts > currentTime + 0.05);
          if (nextCue) {
            onSeek(nextCue.start_pts);
          } else if (duration > 0) {
            onSeek(duration);
          }
        } else {
          // Tua tiến 1 frame
          onSeek(Math.min(duration || 9999, currentTime + 0.04));
        }
        return;
      }

      // 5. Phím F: Fullscreen
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (onToggleFullscreen) {
          onToggleFullscreen();
        }
        return;
      }

      // 6. Ctrl + Z / Ctrl + Y / Ctrl + Shift + Z: Undo / Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo?.();
        return;
      }
    },
    [
      enabled,
      isPlaying,
      onTogglePlay,
      currentTime,
      duration,
      onSeek,
      selectedCueId,
      cues,
      onSplitCue,
      onDeleteCue,
      onDeselectCue,
      onToggleFullscreen,
      onToggleAudioMute,
      onZoomIn,
      onZoomOut,
      onUndo,
      onRedo,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
