import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from './api/client'
import {
  ORIGINAL_AUDIO_VOLUME_KEY,
  VOICEOVER_VOLUME_KEY,
  readStoredVolumePercent,
  writeStoredVolumePercent,
} from './utils/audioVolume';
import { wsClient, WsConnectionStatus } from './api/websocket';
import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1, BridgeEventV1 } from './types/api';
import {
  PresetProfile,
  AspectRatioType,
  MaskStyleType,
  SubtitlePlacementMode,
  ZoomMode,
  getStoredPresets,
  saveStoredPresets,
  getDefaultPreset,
} from './types/presets';
import { VideoPlayer } from './components/player/VideoPlayer';
import { BottomTimeline } from './components/timeline/BottomTimeline';
import { StudioHeader } from './components/layout/StudioHeader';
import { LeftMediaSidebar } from './components/sidebar/LeftMediaSidebar';
import { RightInspectorPanel } from './components/inspector/RightInspectorPanel';
import { DashboardBatchHub } from './components/project/DashboardBatchHub';
import { GlobalSettingsView } from './components/project/GlobalSettingsView';
import { NewProjectModal } from './components/project/NewProjectModal';
import { DownloadQueueHub } from './components/project/DownloadQueueHub';
import { VideoDownloaderHub } from './components/project/VideoDownloaderHub';
import { ExportModal } from './components/editor/ExportModal';
import { GlobalActivityLogger, appLogger, useAppLoggerCount } from './components/common/GlobalActivityLogger';
import { AdminLanView } from './components/admin/AdminLanView';
import { AppSidebar } from './components/layout/AppSidebar';
import { useTimelineShortcuts } from './hooks/useTimelineShortcuts';
import { extractDramaInfo } from './utils/drama';
import { RefreshCw, RotateCw } from 'lucide-react';

const STUDIO_STORAGE_KEY = 'sub_studio_active_state_v1';

interface StoredStudioState {
  roiRegion?: RegionTrackV1;
  regions?: RegionTrackV1[];
  activeRegionId?: string;
  previewMask?: boolean;
  maskStyle?: MaskStyleType;
  blurStrength?: number;
  subtitlePlacement?: SubtitlePlacementMode;
  aspectRatio?: AspectRatioType;
  fitMode?: 'contain' | 'cover';
  zoomLevel?: ZoomMode;
  isFlippedH?: boolean;
  isFlippedV?: boolean;
  rotation?: number;
  sourceLang?: string;
  targetLang?: string;
  activePresetId?: string;
  selectedDramaTitle?: string | null;
  activeProjectId?: string | null;
  subtitleFontSize?: number;
  subtitleFontFamily?: string;
  subtitleTextColor?: string;
  maskOpacity?: number;
  maskPadding?: number;
  maskBorderRadius?: number;
  responsiveFontScale?: boolean;
  subtitleStroke?: 'none' | 'soft' | 'stroke' | 'glow';
  subtitleLineHeight?: number;
  viewMode?: 'dashboard' | 'studio' | 'queue' | 'downloader' | 'settings' | 'admin';
  downloaderTab?: 'search' | 'direct' | 'queue' | 'auth' | 'settings' | 'pipeline';
  settingsTab?: 'ocr' | 'translation' | 'dubbing' | 'render' | 'device' | 'batch' | 'router';
}


function getStoredStudioState(): StoredStudioState | null {
  try {
    const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore
  }
  return null;
}

function saveStudioActiveState(state: StoredStudioState) {
  try {
    localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }
}

export const App: React.FC = () => {
  const loggerCount = useAppLoggerCount();
  const savedState = useRef(getStoredStudioState()).current;
  const hasRestoredProjectRef = useRef<boolean>(false);

  // Chế độ màn hình: Dashboard, Studio, Hàng Đợi, Trung Tâm Tải Video, hoặc Thiết Lập Hệ Thống
  const [viewMode, setViewMode] = useState<'dashboard' | 'studio' | 'queue' | 'downloader' | 'settings' | 'admin'>(
    () => savedState?.viewMode || 'dashboard'
  );
  const [downloaderTab, setDownloaderTab] = useState<'search' | 'direct' | 'queue' | 'auth' | 'settings' | 'pipeline'>(
    () => savedState?.downloaderTab || 'search'
  );
  const [settingsTab, setSettingsTab] = useState<'ocr' | 'translation' | 'dubbing' | 'render' | 'device' | 'batch' | 'router'>(
    () => savedState?.settingsTab || 'ocr'
  );




  // Quản lý Chuẩn Cấu Hình (Preset Profiles)
  const [presets, setPresets] = useState<PresetProfile[]>(() => getStoredPresets());
  const [activePresetId, setActivePresetId] = useState<string>(() => savedState?.activePresetId || getDefaultPreset().id);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);


  // Trạng thái dự án và video hiện tại
  const [projects, setProjects] = useState<ProjectManifestV1[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifestV1 | null>(null);
  const activeProjectRef = useRef<ProjectManifestV1 | null>(null);
  activeProjectRef.current = activeProject;
  const [selectedDramaTitle, setSelectedDramaTitle] = useState<string | null>(() => savedState?.selectedDramaTitle || null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [cues, setCues] = useState<SubtitleCueV1[]>([]);
  const [sourceLang, setSourceLang] = useState<string>(() => savedState?.sourceLang || 'auto');
  const [targetLang, setTargetLang] = useState<string>(() => savedState?.targetLang || 'vi');

  // Tỉ lệ khung hình (Aspect Ratio) & Fit Mode
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>(() => savedState?.aspectRatio || 'original');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>(() => savedState?.fitMode || 'contain');

  // Vùng quét phụ đề (ROI) & Đa Vùng Quét (Multi-ROI)
  const [regions, setRegions] = useState<RegionTrackV1[]>(() => {
    if (savedState?.regions && savedState.regions.length > 0) {
      return savedState.regions;
    }
    if (savedState?.roiRegion) {
      return [savedState.roiRegion];
    }
    return [{
      region_id: 'roi-main',
      x: 0.03,
      y: 0.61,
      width: 0.94,
      height: 0.08,
    }];
  });
  const [activeRegionId, setActiveRegionId] = useState<string>(() => savedState?.activeRegionId || 'roi-main');

  const activeRoiRegion = regions.find((r) => r.region_id === activeRegionId) || regions[0] || {
    region_id: 'roi-main',
    x: 0.03,
    y: 0.61,
    width: 0.94,
    height: 0.08,
  };

  // Thao tác với Đa Vùng Quét OCR
  const handleUpdateRegion = useCallback((updated: RegionTrackV1) => {
    const clampedX = Math.max(0.0, Math.min(0.97, updated.x));
    const clampedY = Math.max(0.0, Math.min(0.98, updated.y));
    const clampedW = Math.max(0.03, Math.min(1.0 - clampedX, updated.width));
    const clampedH = Math.max(0.02, Math.min(1.0 - clampedY, updated.height));
    const safeUpdated: RegionTrackV1 = {
      ...updated,
      x: clampedX,
      y: clampedY,
      width: clampedW,
      height: clampedH,
    };
    setRegions((prev) => {
      const exists = prev.some((r) => r.region_id === safeUpdated.region_id);
      if (exists) {
        return prev.map((r) => (r.region_id === safeUpdated.region_id ? safeUpdated : r));
      }
      return [...prev, safeUpdated];
    });
  }, []);

  const handleAddRegion = useCallback(() => {
    const newId = `roi-${Date.now().toString(36)}`;
    const isFirstBottom = (regions[0]?.y || 0.7) > 0.5;
    const newReg: RegionTrackV1 = {
      region_id: newId,
      x: 0.08,
      y: isFirstBottom ? 0.08 : 0.75,
      width: 0.84,
      height: 0.14,
    };
    setRegions((prev) => [...prev, newReg]);
    setActiveRegionId(newId);
    appLogger.info(`Đã thêm vùng quét OCR mới (${isFirstBottom ? 'Dòng Trên' : 'Dòng Đáy'})`, 'Vùng quét');
  }, [regions]);

  const handleDeleteRegion = useCallback((id: string) => {
    setRegions((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((r) => r.region_id !== id);
      if (activeRegionId === id) {
        setActiveRegionId(filtered[0]?.region_id || 'roi-main');
      }
      return filtered;
    });
    appLogger.info('Đã xóa vùng quét OCR', 'Vùng quét');
  }, [activeRegionId]);

  // Trạng thái biến đổi video và lớp phủ hiển thị
  const [videoPosition, setVideoPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [interactionMode, setInteractionMode] = useState<'video' | 'roi'>('roi');
  const [isFlippedH, setIsFlippedH] = useState<boolean>(() => Boolean(savedState?.isFlippedH));
  const [isFlippedV, setIsFlippedV] = useState<boolean>(() => Boolean(savedState?.isFlippedV));
  const [rotation, setRotation] = useState<number>(() => (typeof savedState?.rotation === 'number' ? savedState.rotation : 0));
  const [zoomLevel, setZoomLevel] = useState<ZoomMode>(() => savedState?.zoomLevel || 'fit');
  const [previewMask, setPreviewMask] = useState<boolean>(() => (typeof savedState?.previewMask === 'boolean' ? savedState.previewMask : true));
  const [maskStyle, setMaskStyle] = useState<MaskStyleType>(() => savedState?.maskStyle || 'feather_tight');
  const [blurStrength, setBlurStrength] = useState<number>(() => (typeof savedState?.blurStrength === 'number' ? savedState.blurStrength : 20));
  const [subtitlePlacement, setSubtitlePlacement] = useState<SubtitlePlacementMode>(() => savedState?.subtitlePlacement || 'roi');
  const [showSubtitleOverlay, setShowSubtitleOverlay] = useState<boolean>(true);
  const [subtitleFontSize, setSubtitleFontSize] = useState<number>(() => (typeof savedState?.subtitleFontSize === 'number' ? savedState.subtitleFontSize : 16));
  const [subtitleFontFamily, setSubtitleFontFamily] = useState<string>(() => savedState?.subtitleFontFamily || 'Inter, sans-serif');
  const [subtitleTextColor, setSubtitleTextColor] = useState<string>(() => savedState?.subtitleTextColor || '#fde047');
  const [maskOpacity, setMaskOpacity] = useState<number>(() => (typeof savedState?.maskOpacity === 'number' ? savedState.maskOpacity : 1.0));
  const [maskPadding, setMaskPadding] = useState<number>(() => (typeof savedState?.maskPadding === 'number' ? savedState.maskPadding : 0));
  const [maskBorderRadius, setMaskBorderRadius] = useState<number>(() => (typeof savedState?.maskBorderRadius === 'number' ? savedState.maskBorderRadius : 0));
  const [responsiveFontScale, setResponsiveFontScale] = useState<boolean>(() => (typeof savedState?.responsiveFontScale === 'boolean' ? savedState.responsiveFontScale : false));
  const [subtitleStroke, setSubtitleStroke] = useState<'none' | 'soft' | 'stroke' | 'glow'>(() => (savedState?.subtitleStroke || 'soft'));
  const [subtitleLineHeight, setSubtitleLineHeight] = useState<number>(() => (typeof savedState?.subtitleLineHeight === 'number' ? savedState.subtitleLineHeight : 1.25));

  // Trạng thái phát video và thanh timeline
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [selectedCueIds, setSelectedCueIds] = useState<string[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoVisible, setIsVideoVisible] = useState<boolean>(true);
  const [originalAudioVolume, setOriginalAudioVolume] = useState<number>(() =>
    readStoredVolumePercent(ORIGINAL_AUDIO_VOLUME_KEY, 100)
  );
  const handleOriginalAudioVolumeChange = useCallback((vol: number) => {
    setOriginalAudioVolume(writeStoredVolumePercent(ORIGINAL_AUDIO_VOLUME_KEY, vol));
  }, []);

  const [voiceoverVolume, setVoiceoverVolume] = useState<number>(() =>
    readStoredVolumePercent(VOICEOVER_VOLUME_KEY, 100)
  );
  const handleVoiceoverVolumeChange = useCallback((vol: number) => {
    setVoiceoverVolume(writeStoredVolumePercent(VOICEOVER_VOLUME_KEY, vol));
  }, []);
  const dragStartCuesSnapshotRef = useRef<SubtitleCueV1[] | null>(null);
  // Cờ ngăn toast trùng lặp khi dừng quét: handleStopScan set true, WS/polling kiểm tra để bỏ qua toast
  const cancelRequestedRef = useRef<boolean>(false);
  const lastSavedSignatureRef = useRef<string>('');

  // Trạng thái hệ thống và pipeline
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [wsStatus, setWsStatus] = useState<WsConnectionStatus>('disconnected');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [serverRestartNotification, setServerRestartNotification] = useState<{
    show: boolean;
    countdown: number;
  }>({ show: false, countdown: 2 });

  // Lắng nghe tiến trình phần trăm % từ Active Tasks để đồng bộ tức thời lên UI
  useEffect(() => {
    const unsub = appLogger.subscribeActiveTasks((tasks) => {
      if (!activeProject) {
        setScanProgress(null);
        return;
      }
      const scanTask = tasks.find((t) => t.taskKey === `scan-${activeProject.project_id}` || t.taskKey.startsWith('scan-'));
      if (scanTask && scanTask.progress !== undefined) {
        setScanProgress(scanTask.progress);
      } else if (!isScanning) {
        setScanProgress(null);
      }
    });
    return () => {
      unsub();
    };
  }, [activeProject, isScanning]);

  // Video Proxy Quality state (original / 720p / 480p) lưu trữ trong localStorage để chống lag
  const [videoQuality, setVideoQuality] = useState<'original' | '720p' | '480p'>(() => {
    return (localStorage.getItem('video_proxy_quality') as any) || 'original';
  });

  // Layout Resizing State: Co giãn thanh 2 bên, timeline và nhớ vị trí cuối cùng
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('studio_left_sidebar_width');
      return saved ? Math.max(260, Math.min(600, parseInt(saved, 10))) : 360;
    } catch {
      return 360;
    }
  });
  const [rightInspectorWidth, setRightInspectorWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('studio_right_inspector_width');
      return saved ? Math.max(280, Math.min(600, parseInt(saved, 10))) : 380;
    } catch {
      return 380;
    }
  });
  const [bottomTimelineHeight, setBottomTimelineHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('studio_bottom_timeline_height');
      return saved ? Math.max(160, Math.min(550, parseInt(saved, 10))) : 280;
    } catch {
      return 280;
    }
  });

  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [isResizingBottom, setIsResizingBottom] = useState(false);

  useEffect(() => {
    if (!isResizingLeft && !isResizingRight && !isResizingBottom) return;

    let rafId: number | null = null;
    let latestLeft = leftSidebarWidth;
    let latestRight = rightInspectorWidth;
    let latestBottom = bottomTimelineHeight;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (isResizingLeft) {
          const newWidth = Math.max(260, Math.min(600, e.clientX));
          latestLeft = newWidth;
          setLeftSidebarWidth(newWidth);
        } else if (isResizingRight) {
          const newWidth = Math.max(280, Math.min(600, window.innerWidth - e.clientX));
          latestRight = newWidth;
          setRightInspectorWidth(newWidth);
        } else if (isResizingBottom) {
          const newHeight = Math.max(160, Math.min(550, window.innerHeight - e.clientY));
          latestBottom = newHeight;
          setBottomTimelineHeight(newHeight);
        }
      });
    };

    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      try {
        if (isResizingLeft) {
          localStorage.setItem('studio_left_sidebar_width', String(latestLeft));
        } else if (isResizingRight) {
          localStorage.setItem('studio_right_inspector_width', String(latestRight));
        } else if (isResizingBottom) {
          localStorage.setItem('studio_bottom_timeline_height', String(latestBottom));
        }
      } catch {}

      setIsResizingLeft(false);
      setIsResizingRight(false);
      setIsResizingBottom(false);
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = isResizingBottom ? 'row-resize' : 'col-resize';
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight, isResizingBottom, leftSidebarWidth, rightInspectorWidth, bottomTimelineHeight]);

  const localUrlRef = useRef<string | null>(null);

  const handleVideoQualityChange = useCallback((newQuality: 'original' | '720p' | '480p') => {
    setVideoQuality(newQuality);
    localStorage.setItem('video_proxy_quality', newQuality);
    if (activeProject) {
      const streamUrl = apiClient.getVideoStreamUrl(activeProject.project_id, newQuality);
      setVideoUrl(streamUrl);
      appLogger.info(`Đã chuyển độ phân giải video sang: ${newQuality.toUpperCase()}`, 'Video Player');
    }
  }, [activeProject]);

  // Chuẩn hóa góc xoay luôn nằm trong dải [-180, 180] tương thích chính xác với Range Slider
  const normalizeRotation = (deg: number) => {
    let normalized = deg % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized < -180) normalized += 360;
    return normalized;
  };

  // Lưu danh sách presets khi thay đổi
  const handleSavePresets = (newPresets: PresetProfile[]) => {
    setPresets(newPresets);
    saveStoredPresets(newPresets);
    appLogger.success('Đã lưu cấu hình Preset vào bộ nhớ', 'Cấu hình');
  };

  // Lưu cấu hình hiện tại thành Preset mới
  const handleSaveCurrentAsPreset = useCallback(
    (name: string) => {
      const newPreset: PresetProfile = {
        id: `preset-${Date.now()}`,
        name: name.trim() || `Preset Tùy Chỉnh ${presets.length + 1}`,
        source_lang: sourceLang,
        target_lang: targetLang,
        mask_style: maskStyle,
        subtitle_placement: subtitlePlacement,
        blur_strength: blurStrength,
        is_flipped_h: isFlippedH,
        is_flipped_v: isFlippedV,
        show_subtitle_overlay: showSubtitleOverlay,
        zoom_level: zoomLevel,
        aspect_ratio: aspectRatio,
        fit_mode: fitMode,
        roi: {
          x: activeRoiRegion?.x ?? 0.08,
          y: activeRoiRegion?.y ?? 0.82,
          width: activeRoiRegion?.width ?? 0.84,
          height: activeRoiRegion?.height ?? 0.12,
        },
      };
      const updated = [newPreset, ...presets];
      handleSavePresets(updated);
      setActivePresetId(newPreset.id);
      appLogger.success(`Đã tạo preset mới: ${newPreset.name}`, 'Preset');
    },
    [
      presets,
      sourceLang,
      targetLang,
      maskStyle,
      subtitlePlacement,
      blurStrength,
      isFlippedH,
      isFlippedV,
      showSubtitleOverlay,
      zoomLevel,
      aspectRatio,
      fitMode,
      activeRoiRegion,
    ]
  );

  // Xóa Preset
  const handleDeletePreset = useCallback(
    (presetId: string) => {
      const updated = presets.filter((p) => p.id !== presetId);
      handleSavePresets(updated.length > 0 ? updated : getStoredPresets());
      if (activePresetId === presetId) {
        setActivePresetId(updated[0]?.id || '');
      }
      appLogger.info('Đã xóa preset cấu hình.', 'Preset');
    },
    [presets, activePresetId]
  );

  // Cập nhật Preset
  const handleUpdatePreset = useCallback(
    (preset: PresetProfile) => {
      const updated = presets.map((p) => (p.id === preset.id ? preset : p));
      handleSavePresets(updated);
      appLogger.success(`Đã cập nhật preset: ${preset.name}`, 'Preset');
    },
    [presets]
  );

  // Khôi phục toàn bộ thông số video và vùng quét về mặc định
  const handleResetAllParameters = useCallback(() => {
    setZoomLevel(1.0);
    setRotation(0);
    setIsFlippedH(false);
    setIsFlippedV(false);
    setVideoPosition({ x: 0, y: 0 });
    setAspectRatio('original');
    setFitMode('contain');
    setMaskStyle('blur');
    setBlurStrength(15);
    setMaskOpacity(1.0);
    setMaskPadding(0);
    setMaskBorderRadius(0);
    setResponsiveFontScale(false);
    setSubtitleStroke('soft');
    setSubtitleLineHeight(1.25);
    setPreviewMask(false);
    setShowSubtitleOverlay(true);
    const defaultRoi: RegionTrackV1 = {
      region_id: 'roi-main',
      x: 0.08,
      y: 0.82,
      width: 0.84,
      height: 0.12,
      mask_enabled: true,
    };
    setRegions([defaultRoi]);
    setActiveRegionId('roi-main');
    appLogger.success('Đã khôi phục toàn bộ thông số video về mặc định!', 'Studio');
  }, []);

  // Áp dụng thông số của một Chuẩn (Preset Profile)
  const applyPresetProfile = (preset: PresetProfile) => {
    setActivePresetId(preset.id);
    setSourceLang(preset.source_lang);
    setTargetLang(preset.target_lang);
    setMaskStyle(preset.mask_style);
    if (preset.subtitle_placement) setSubtitlePlacement(preset.subtitle_placement);
    if (typeof preset.blur_strength === 'number') setBlurStrength(preset.blur_strength);
    setIsFlippedH(preset.is_flipped_h);
    setIsFlippedV(preset.is_flipped_v);
    setShowSubtitleOverlay(preset.show_subtitle_overlay);
    setZoomLevel(preset.zoom_level);
    setAspectRatio(preset.aspect_ratio);
    if (preset.fit_mode) setFitMode(preset.fit_mode);
    if (preset.roi) {
      const newRoi: RegionTrackV1 = {
        region_id: 'roi-main',
        x: preset.roi.x,
        y: preset.roi.y,
        width: preset.roi.width,
        height: preset.roi.height,
      };
      setRegions([newRoi]);
      setActiveRegionId('roi-main');
    }
    setStatusMessage(`Đã áp dụng: ${preset.name}`);
    appLogger.success(`Đã áp dụng chuẩn: ${preset.name}`, 'Preset');
  };

  // ==========================================
  // HỆ THỐNG LỊCH SỬ HOÀN TÁC (UNDO / REDO STACK)
  // ==========================================
  const undoStackRef = useRef<SubtitleCueV1[][]>([]);
  const redoStackRef = useRef<SubtitleCueV1[][]>([]);

  const pushHistory = useCallback((previousCues: SubtitleCueV1[]) => {
    undoStackRef.current.push([...previousCues]);
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, []);

  const handleUndo = useCallback(async () => {
    if (!activeProject || undoStackRef.current.length === 0) {
      appLogger.info('Không còn thao tác nào để hoàn tác (Undo)', 'Timeline', false);
      return;
    }
    const prevCues = undoStackRef.current.pop()!;
    redoStackRef.current.push([...cues]);
    if (redoStackRef.current.length > 50) {
      redoStackRef.current.shift();
    }
    setCues(prevCues);
    try {
      await apiClient.saveCues(activeProject.project_id, prevCues);
      appLogger.success('Đã hoàn tác thao tác vừa thực hiện (Ctrl+Z)', 'Lịch sử', false);
    } catch (err: any) {
      console.warn('Lỗi lưu sau khi hoàn tác:', err);
    }
  }, [cues, activeProject]);

  const handleRedo = useCallback(async () => {
    if (!activeProject || redoStackRef.current.length === 0) {
      appLogger.info('Không còn thao tác nào để làm lại (Redo)', 'Timeline', false);
      return;
    }
    const nextCues = redoStackRef.current.pop()!;
    undoStackRef.current.push([...cues]);
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    setCues(nextCues);
    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
      appLogger.success('Đã làm lại thao tác (Ctrl+Y / Ctrl+Shift+Z)', 'Lịch sử', false);
    } catch (err: any) {
      console.warn('Lỗi lưu sau khi làm lại:', err);
    }
  }, [cues, activeProject]);

  // Chia đôi câu phụ đề tại vị trí con trỏ thời gian (Split Cue thông minh)
  const handleSplitCue = async (
    splitTime?: number,
    targetCueId?: string,
    customTexts?: { text1?: string; text2?: string; trans1?: string; trans2?: string }
  ) => {
    if (!activeProject || cues.length === 0) return;
    const time = splitTime !== undefined ? splitTime : currentTime;
    const targetCue = targetCueId
      ? cues.find((c) => c.cue_id === targetCueId)
      : cues.find((c) => time > c.start_pts && time < c.end_pts);

    if (!targetCue) {
      appLogger.warn('Không có câu phụ đề nào ở vị trí con trỏ để chia tách', 'Timeline');
      return;
    }

    pushHistory(cues);

    // Đảm bảo thời điểm chia nằm trong khoảng hợp lệ của câu
    const actualSplitTime = Math.min(Math.max(time, targetCue.start_pts + 0.1), targetCue.end_pts - 0.1);
    const duration = targetCue.end_pts - targetCue.start_pts;
    const ratio = duration > 0 ? (actualSplitTime - targetCue.start_pts) / duration : 0.5;

    let text1 = customTexts?.text1;
    let text2 = customTexts?.text2;
    let transText1 = customTexts?.trans1;
    let transText2 = customTexts?.trans2;

    // 1. Tự động tách câu gốc tiếng Trung / CJK thông minh nếu chưa có text tùy chỉnh
    if (text1 === undefined || text2 === undefined) {
      const src = targetCue.source_text.trim();
      const words = src.split(/\s+/);
      if (words.length > 1) {
        const splitIdx = Math.max(1, Math.round(words.length * ratio));
        text1 = text1 ?? words.slice(0, splitIdx).join(' ');
        text2 = text2 ?? (words.slice(splitIdx).join(' ') || src);
      } else {
        // Ký tự liền nhau không dấu cách (tiếng Trung, Nhật, Hàn)
        const chars = Array.from(src);
        const cIdx = Math.max(1, Math.min(chars.length - 1, Math.round(chars.length * ratio)));
        text1 = text1 ?? chars.slice(0, cIdx).join('');
        text2 = text2 ?? chars.slice(cIdx).join('');
      }
    }

    // 2. Tự động tách câu dịch tiếng Việt thông minh (bắt ranh giới dấu câu)
    if (transText1 === undefined || transText2 === undefined) {
      const trans = (targetCue.translated_text || '').trim();
      if (trans) {
        const transWords = trans.split(/\s+/);
        if (transWords.length > 1) {
          let transSplitIdx = Math.max(1, Math.round(transWords.length * ratio));
          // Tìm dấu ngắt câu tự nhiên (, . ! ? ; : -) gần nhất trong phạm vi ±3 từ
          for (let offset = 0; offset <= 3; offset++) {
            const checkIdx1 = transSplitIdx - offset;
            const checkIdx2 = transSplitIdx + offset;
            if (checkIdx1 >= 1 && checkIdx1 < transWords.length && /[,.!?;:\-—]$/.test(transWords[checkIdx1 - 1])) {
              transSplitIdx = checkIdx1;
              break;
            }
            if (checkIdx2 >= 1 && checkIdx2 < transWords.length && /[,.!?;:\-—]$/.test(transWords[checkIdx2 - 1])) {
              transSplitIdx = checkIdx2;
              break;
            }
          }
          transText1 = transText1 ?? transWords.slice(0, transSplitIdx).join(' ');
          transText2 = transText2 ?? transWords.slice(transSplitIdx).join(' ');
        } else {
          transText1 = transText1 ?? trans;
          transText2 = transText2 ?? '';
        }
      } else {
        transText1 = transText1 ?? '';
        transText2 = transText2 ?? '';
      }
    }

    const cue1: SubtitleCueV1 = {
      ...targetCue,
      end_pts: Number(actualSplitTime.toFixed(3)),
      source_text: text1,
      translated_text: transText1,
    };

    const cue2: SubtitleCueV1 = {
      ...targetCue,
      cue_id: `cue_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      start_pts: Number(actualSplitTime.toFixed(3)),
      source_text: text2,
      translated_text: transText2,
    };

    const nextCues = cues.flatMap((c) => (c.cue_id === targetCue.cue_id ? [cue1, cue2] : [c]));
    setCues(nextCues);
    setSelectedCueId(cue2.cue_id);

    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
      appLogger.success(`Đã tách câu phụ đề tại ${actualSplitTime.toFixed(2)}s`, 'Timeline');
    } catch (err: any) {
      appLogger.error(`Lỗi khi lưu phụ đề sau khi chia: ${err?.message}`, 'Timeline');
    }
  };

  // Chọn nhiều câu phụ đề hoặc chọn lẻ đồng bộ (Multi-select Cues chuẩn CapCut)
  const handleSelectCues = useCallback((cueIds: string[], anchorCueId?: string) => {
    setSelectedCueIds(cueIds);
    if (cueIds.length === 0) {
      setSelectedCueId(null);
    } else if (anchorCueId && cueIds.includes(anchorCueId)) {
      setSelectedCueId(anchorCueId);
    } else if (!cueIds.includes(selectedCueId || '')) {
      setSelectedCueId(cueIds[cueIds.length - 1]);
    }
  }, [selectedCueId]);

  // Xóa danh sách câu phụ đề (Hỗ trợ xóa đơn lẻ & xóa hàng loạt)
  const handleDeleteCues = useCallback(async (cueIds: string[]) => {
    if (!activeProject || cueIds.length === 0) return;
    pushHistory(cues);
    const targetSet = new Set(cueIds);
    const nextCues = cues.filter((c) => !targetSet.has(c.cue_id));
    setCues(nextCues);
    setSelectedCueIds([]);
    setSelectedCueId(null);

    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
      appLogger.success(
        cueIds.length > 1
          ? `Đã xóa ${cueIds.length} câu phụ đề khỏi kịch bản`
          : 'Đã xóa câu phụ đề khỏi kịch bản',
        'Timeline'
      );
    } catch (err: any) {
      appLogger.error(`Lỗi xóa câu phụ đề: ${err?.message}`, 'Timeline');
    }
  }, [activeProject, cues, pushHistory]);

  const handleDeleteCue = useCallback(async (cueId: string) => {
    await handleDeleteCues([cueId]);
  }, [handleDeleteCues]);

  // Hệ thống phím tắt toàn cục chuẩn CapCut / Premiere
  useTimelineShortcuts({
    isPlaying,
    onTogglePlay: () => setIsPlaying((p) => !p),
    currentTime,
    duration,
    onSeek: (t) => setCurrentTime(t),
    selectedCueId,
    selectedCueIds,
    cues,
    onSplitCue: handleSplitCue,
    onDeleteCue: handleDeleteCue,
    onDeleteCues: handleDeleteCues,
    onDeselectCue: () => {
      setSelectedCueId(null);
      setSelectedCueIds([]);
    },
    onToggleAudioMute: () => setIsAudioMuted((p) => !p),
    onUndo: handleUndo,
    onRedo: handleRedo,
    onToggleFullscreen: () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    },
    enabled: viewMode === 'studio',
  });

  // Kiểm tra sức khỏe Backend
  const checkHealth = useCallback(async () => {
    try {
      const ok = await apiClient.healthCheck();
      setBackendOnline(ok);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  // Nạp danh sách câu phụ đề của dự án
  const loadCues = useCallback(async (projId?: string) => {
    const id = projId || activeProjectRef.current?.project_id;
    if (!id) {
      setCues([]);
      return;
    }
    try {
      const list = await apiClient.getCues(id);
      setCues(list || []);
      undoStackRef.current = [];
      redoStackRef.current = [];
      if (list && list.length > 0) {
        appLogger.info(`Đã nạp ${list.length} câu phụ đề vào Timeline`, 'Phụ đề', false);
      }
    } catch (err) {
      console.warn('Chưa nạp được danh sách phụ đề:', err);
      setCues([]);
    }
  }, []);

  // Cập nhật câu phụ đề khi người dùng sửa trực tiếp trên bảng
  const handleUpdateCue = async (updatedCue: SubtitleCueV1) => {
    pushHistory(cues);
    const nextCues = cues.map((c) => (c.cue_id === updatedCue.cue_id ? updatedCue : c));
    setCues(nextCues);
    if (activeProject) {
      try {
        await apiClient.saveCues(activeProject.project_id, nextCues);
        setStatusMessage('Đã lưu câu phụ đề thành công!');
        appLogger.success('Đã lưu câu phụ đề thành công!', 'Phụ đề');
      } catch (err: any) {
        console.error('Không thể lưu phụ đề xuống server:', err);
        appLogger.error(`Không thể lưu phụ đề: ${err?.message || 'Lỗi kết nối máy chủ'}`, 'Phụ đề');
      }
    }
  };

  // Bắt đầu kéo thả mốc thời gian phụ đề: Lưu lại snapshot trước khi kéo
  const handleBeginCueDrag = useCallback(() => {
    dragStartCuesSnapshotRef.current = [...cues];
  }, [cues]);

  // Kéo chỉnh điểm đầu / điểm cuối câu phụ đề trên Timeline (Gom 1 hành động Undo)
  const handleUpdateCueTime = async (
    cueId: string,
    startPts: number,
    endPts: number,
    isLiveOnly: boolean = false
  ) => {
    if (!activeProject) return;

    const nextCues = cues.map((c) =>
      c.cue_id === cueId
        ? {
            ...c,
            start_pts: Number(startPts.toFixed(3)),
            end_pts: Number(endPts.toFixed(3)),
          }
        : c
    );
    setCues(nextCues);

    // Khi người dùng đang rê chuột kéo mép, chỉ cập nhật giao diện 60fps mượt mà
    // Tuyệt đối không tạo lịch sử Undo rác và không spam gọi API
    if (isLiveOnly) {
      return;
    }

    // Khi nhả chuột (Commit): Đẩy snapshot trước khi kéo vào Undo Stack ĐÚNG 1 LẦN DUY NHẤT
    if (dragStartCuesSnapshotRef.current) {
      pushHistory(dragStartCuesSnapshotRef.current);
      dragStartCuesSnapshotRef.current = null;
    } else {
      pushHistory(cues);
    }

    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
    } catch (err: any) {
      console.warn('Lỗi lưu thời gian phụ đề:', err);
    }
  };

  // Di chuyển hàng loạt nhiều câu phụ đề cùng lúc trên Timeline (Batch Move chuẩn CapCut)
  const handleUpdateMultipleCuesTime = useCallback(
    async (
      updates: { cueId: string; startPts: number; endPts: number }[],
      isLiveOnly: boolean = false
    ) => {
      if (!activeProject || updates.length === 0) return;

      const updateMap = new Map(updates.map((u) => [u.cueId, u]));
      const nextCues = cues.map((c) => {
        const up = updateMap.get(c.cue_id);
        if (up) {
          return {
            ...c,
            start_pts: Number(up.startPts.toFixed(3)),
            end_pts: Number(up.endPts.toFixed(3)),
          };
        }
        return c;
      });
      setCues(nextCues);

      if (isLiveOnly) return;

      if (dragStartCuesSnapshotRef.current) {
        pushHistory(dragStartCuesSnapshotRef.current);
        dragStartCuesSnapshotRef.current = null;
      } else {
        pushHistory(cues);
      }

      try {
        await apiClient.saveCues(activeProject.project_id, nextCues);
      } catch (err: any) {
        console.warn('Lỗi lưu thời gian phụ đề hàng loạt:', err);
      }
    },
    [activeProject, cues, pushHistory]
  );

  // Chọn dự án để xử lý video và chuyển sang giao diện Studio
  const selectProject = useCallback((proj: ProjectManifestV1, navigate: boolean = true) => {
    setActiveProject(proj);
    setLocalVideoFile(null);

    // Ưu tiên nạp regions chuẩn từ Project manifest
    if (proj.regions && proj.regions.length > 0) {
      setRegions(proj.regions);
      setActiveRegionId(proj.regions[0].region_id);
    } else if (savedState?.activeProjectId === proj.project_id && savedState.regions && savedState.regions.length > 0) {
      setRegions(savedState.regions);
      setActiveRegionId(savedState.activeRegionId || savedState.regions[0].region_id);
    } else if (savedState?.activeProjectId === proj.project_id && savedState.roiRegion) {
      setRegions([savedState.roiRegion]);
      setActiveRegionId(savedState.roiRegion.region_id);
    } else {
      const defPreset = getDefaultPreset(presets);
      const initRoi: RegionTrackV1 = defPreset?.roi ? {
        region_id: 'roi-main',
        x: defPreset.roi.x,
        y: defPreset.roi.y,
        width: defPreset.roi.width,
        height: defPreset.roi.height,
      } : {
        region_id: 'roi-main',
        x: 0.08,
        y: 0.82,
        width: 0.84,
        height: 0.12,
      };
      setRegions([initRoi]);
      setActiveRegionId('roi-main');
    }

    if (!navigate && savedState?.activeProjectId === proj.project_id) {
      if (savedState.sourceLang) setSourceLang(savedState.sourceLang);
      if (savedState.targetLang) setTargetLang(savedState.targetLang);
    } else {
      setSourceLang(proj.source_language || 'zh');
      setTargetLang(proj.target_language || 'vi');
    }

    // Đánh dấu signature ban đầu để không kích hoạt auto-save ghi đè sai thông số
    lastSavedSignatureRef.current = JSON.stringify({
      pid: proj.project_id,
      regions: proj.regions || [],
    });

    if (navigate) {
      const drama = extractDramaInfo(proj.title, proj.source_video_path).dramaTitle;
      if (drama && drama !== 'Video đơn lẻ / Chưa phân loại') {
        setSelectedDramaTitle(drama);
      }
    }

    const streamUrl = apiClient.getVideoStreamUrl(proj.project_id, videoQuality);
    setVideoUrl(streamUrl);

    loadCues(proj.project_id);

    // Tự động kiểm tra và khôi phục trạng thái đang quét (ví dụ sau khi F5)
    // Sắp xếp theo start_time và kiểm tra stage mới nhất, tránh phụ thuộc mù quáng vào thứ tự mảng
    apiClient.getStages(proj.project_id).then((stages) => {
      if (stages && stages.length > 0) {
        const sorted = [...stages].sort((a, b) => Number(a.start_time || 0) - Number(b.start_time || 0));
        const pipelineStage = sorted.slice().reverse().find((s: any) => s.stage_name === 'pipeline');
        const isPipelineDone = pipelineStage && ['completed', 'failed', 'cancelled'].includes(pipelineStage.status);
        const runningStage = sorted.slice().reverse().find((s: any) => s.status === 'running');
        const latest = sorted[sorted.length - 1];

        if ((latest && latest.status === 'running') || (runningStage && !isPipelineDone)) {
          setIsScanning(true);
          const active = runningStage || latest;
          const label = active.metrics?.label || `Đang chạy: ${active.stage_name}`;
          setStatusMessage(label);
          appLogger.info(`Đã khôi phục tiến trình đang quét: ${label}`, 'Quét phụ đề');
        } else {
          setIsScanning(false);
          appLogger.dismiss(`scan-${proj.project_id}`);
          if (!isPipelineDone && latest?.status === 'failed') {
            const errMsg = latest.errors?.[0] || 'Tiến trình quét thất bại';
            setStatusMessage(`Lỗi đợt trước: ${errMsg}`);
            appLogger.warn(`Lỗi đợt quét trước: ${errMsg}`, 'Quét phụ đề');
          }
        }
      } else {
        setIsScanning(false);
        appLogger.dismiss(`scan-${proj.project_id}`);
      }
    }).catch((err) => {
      console.warn('Lỗi kiểm tra stage khi nạp dự án:', err);
    });

    if (navigate) {
      setStatusMessage(`Đã nạp: ${proj.title}`);
      appLogger.info(`Đã nạp dự án: ${proj.title}`, 'Dự án');
      setViewMode('studio');
    } else if (savedState?.viewMode === 'studio') {
      setStatusMessage(`Đã khôi phục: ${proj.title}`);
    }
  }, [presets, loadCues, videoQuality]);

  // Nạp danh sách dự án từ Backend & tự động khôi phục dự án sau F5
  const loadProjects = useCallback(async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);

      // Cập nhật thuộc tính mới nhất (has_voiceover, voiceover_path, cues_count...) cho tập phim đang mở
      setActiveProject((current) => {
        if (!current) return current;
        const found = list.find((p) => p.project_id === current.project_id);
        if (!found) return current;
        if (
          found.has_voiceover === current.has_voiceover &&
          found.voiceover_path === current.voiceover_path &&
          found.has_export === current.has_export &&
          found.export_path === current.export_path &&
          found.cues_count === current.cues_count &&
          found.updated_at === current.updated_at
        ) {
          return current;
        }
        return { ...current, ...found };
      });

      // Tự động khôi phục lại tập phim đang mở nếu người dùng F5
      if (!hasRestoredProjectRef.current && savedState?.activeProjectId) {
        hasRestoredProjectRef.current = true;
        const found = list.find((p) => p.project_id === savedState.activeProjectId);
        if (found) {
          selectProject(found, false);
        }
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách dự án:', err);
    }
  }, [selectProject]);

  // Xóa dự án
  const handleDeleteProject = async (projectId: string) => {
    try {
      await apiClient.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId));
      if (activeProject?.project_id === projectId) {
        setActiveProject(null);
        setVideoUrl('');
        setCues([]);
        setViewMode('dashboard');
      }
      setStatusMessage('Đã xóa dự án thành công');
      appLogger.success('Đã xóa dự án thành công', 'Dự án');
    } catch (err: any) {
      appLogger.error(`Không thể xóa dự án: ${err?.message || 'Lỗi hệ thống'}`, 'Dự án');
    }
  };

  // Xử lý nạp file video từ máy tính
  const handlePickLocalVideo = (file: File) => {
    if (localUrlRef.current) {
      URL.revokeObjectURL(localUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    localUrlRef.current = objectUrl;

    setLocalVideoFile(file);
    setVideoUrl(objectUrl);
    setCues([]);
    setStatusMessage(`Đã nạp: ${file.name}`);
    appLogger.success(`Đã nạp video từ máy tính: ${file.name}`, 'Video');
  };

  // Xử lý nạp video và kết quả từ Admin Worker Job vào Studio Editor
  const handleOpenJobInStudio = useCallback(
    (projectId?: string, videoUrl?: string, initialCues?: SubtitleCueV1[]) => {
      if (projectId) {
        const existing = projects.find((p) => p.project_id === projectId);
        if (existing) {
          selectProject(existing);
          if (initialCues && initialCues.length > 0) {
            setCues(initialCues);
          }
          if (videoUrl) {
            setVideoUrl(videoUrl);
          }
          setViewMode('studio');
          appLogger.success(`Đã nạp dự án ${existing.title} vào Studio Editor`, 'Admin LAN');
          return;
        }
      }

      // Dự án mới từ Worker hoàn thành
      const lanProj: ProjectManifestV1 = {
        project_id: projectId || `proj-lan-${Date.now()}`,
        title: `Dự án LAN: ${projectId || 'Video Hoàn Thành'}`,
        source_video_path: videoUrl || '',
        video_fingerprint: `fp-${Date.now()}`,
        source_language: 'auto',
        target_language: 'vi',
        active_revision: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      setProjects((prev) => [lanProj, ...prev]);
      setActiveProject(lanProj);
      if (videoUrl) {
        setVideoUrl(videoUrl);
      }
      if (initialCues && initialCues.length > 0) {
        setCues(initialCues);
      }
      setViewMode('studio');
      appLogger.success('Đã đưa video và phụ đề hoàn thành vào Studio Editor!', 'Admin LAN');
    },
    [projects, selectProject]
  );

  // Tự động lưu snapshot trạng thái làm việc vào localStorage để giữ nguyên khi F5
  useEffect(() => {
    saveStudioActiveState({
      roiRegion: activeRoiRegion,
      regions,
      activeRegionId,
      previewMask,
      maskStyle,
      blurStrength,
      subtitlePlacement,
      aspectRatio,
      fitMode,
      zoomLevel,
      isFlippedH,
      isFlippedV,
      rotation,
      sourceLang,
      targetLang,
      activePresetId,
      selectedDramaTitle,
      activeProjectId: activeProject?.project_id || null,
      subtitleFontSize,
      subtitleFontFamily,
      subtitleTextColor,
      maskOpacity,
      maskPadding,
      maskBorderRadius,
      responsiveFontScale,
      subtitleStroke,
      subtitleLineHeight,
      viewMode,
      downloaderTab,
      settingsTab,
    });

    // Tự động đồng bộ ROI và danh sách vùng xuống backend (debounce 500ms) nguyên tử
    if (activeProject?.project_id) {
      const currentSig = JSON.stringify({
        pid: activeProject.project_id,
        regions,
        roi: activeRoiRegion,
        aspectRatio,
        maskStyle,
        blurStrength,
        subtitlePlacement,
        previewMask,
      });

      // Chỉ gửi lưu khi người dùng thực sự thay đổi cấu hình so với dữ liệu vừa nạp
      if (lastSavedSignatureRef.current === currentSig) {
        return;
      }

      const timer = setTimeout(() => {
        setSaveStatus('saving');
        apiClient.saveEditorState(activeProject.project_id, {
          regions,
          settings: {
            roi: activeRoiRegion,
            regions,
            aspect_ratio: aspectRatio,
            mask_style: maskStyle,
            blur_strength: blurStrength,
            subtitle_placement: subtitlePlacement,
            preview_mask: previewMask,
            source_lang: sourceLang,
            target_lang: targetLang,
            rotation,
            flip_h: isFlippedH,
            flip_v: isFlippedV,
            fit_mode: fitMode,
          },
        })
          .then(() => {
            lastSavedSignatureRef.current = currentSig;
            setSaveStatus('saved');
          })
          .catch((err: any) => {
            setSaveStatus('error');
            appLogger.error(`Lỗi đồng bộ cấu hình editor: ${err?.message || 'Không thể lưu'}`, 'AutoSave');
          });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [
    activeRoiRegion,
    regions,
    activeRegionId,
    maskStyle,
    blurStrength,
    subtitlePlacement,
    aspectRatio,
    fitMode,
    zoomLevel,
    isFlippedH,
    isFlippedV,
    rotation,
    sourceLang,
    targetLang,
    activePresetId,
    selectedDramaTitle,
    activeProject,
    subtitleFontSize,
    subtitleFontFamily,
    subtitleTextColor,
    maskOpacity,
    maskPadding,
    maskBorderRadius,
    responsiveFontScale,
    subtitleStroke,
    subtitleLineHeight,
    viewMode,
    downloaderTab,
    settingsTab,
  ]);

  // Khởi tạo và lắng nghe WebSocket với trạng thái kết nối trung thực
  useEffect(() => {
    checkHealth();
    loadProjects();

    wsClient.connect();

    // Lắng nghe trạng thái kết nối thực sự từ WebSocket readyState
    const unsubStatus = wsClient.onStatusChange((status) => {
      setWsStatus(status);
      setWsConnected(status === 'connected');
    });

    const unsub = wsClient.onEvent((evt: BridgeEventV1) => {
      const scanKey = `scan-${activeProject?.project_id || 'active'}`;
      if (evt.event_type === 'stage_started') {
        const stageLabel = evt.payload?.stage_name || 'Tiến trình quét';
        setStatusMessage(`Đang chạy: ${stageLabel}`);
        appLogger.loading(`Đang chạy: ${stageLabel}`, 'Quét phụ đề', { taskKey: scanKey });
      } else if (evt.event_type === 'stage_completed') {
        const stageLabel = evt.payload?.stage_name || 'Tiến trình';
        setStatusMessage(`Hoàn thành: ${stageLabel}`);
        appLogger.updateTask(scanKey, { message: `Hoàn thành giai đoạn: ${stageLabel}`, progress: 100 });
      } else if (evt.event_type === 'pipeline_completed') {
        setIsScanning(false);
        setStatusMessage('Đã hoàn thành quét phụ đề toàn bộ video!');
        appLogger.finishTask(scanKey, 'Đã hoàn thành quét phụ đề toàn bộ video!', 'success');
        loadCues();
      } else if (evt.event_type === 'pipeline_failed') {
        setIsScanning(false);
        const errMsg = evt.payload?.error || 'Không xác định';
        setStatusMessage(`Lỗi quét: ${errMsg}`);
        appLogger.finishTask(scanKey, `Lỗi quét: ${errMsg}`, 'error');
      } else if (evt.event_type === 'pipeline_cancelled') {
        setIsScanning(false);
        // Chỉ hiện toast nếu chưa có handleStopScan phát trước đó (tránh trùng lặp)
        if (!cancelRequestedRef.current) {
          setStatusMessage('Đã dừng tiến trình quét phụ đề');
          appLogger.finishTask(scanKey, 'Đã dừng tiến trình quét phụ đề', 'warn');
          loadCues();
        } else {
          appLogger.dismiss(scanKey);
        }
      }
    });

    const unsubRestart = wsClient.onServerRestart(() => {
      appLogger.info('Phát hiện máy chủ khởi động lại với phiên bản mã nguồn mới.', 'Hệ thống');
      setServerRestartNotification({ show: true, countdown: 2 });
      let seconds = 2;
      const timer = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(timer);
          window.location.reload();
        } else {
          setServerRestartNotification({ show: true, countdown: seconds });
        }
      }, 1000);
    });

    return () => {
      unsubStatus();
      unsub();
      unsubRestart();
      if (localUrlRef.current) {
        URL.revokeObjectURL(localUrlRef.current);
      }
    };
  }, [activeProject]);

  // Polling tiến trình khi isScanning === true
  const pollingFailuresRef = useRef<number>(0);
  useEffect(() => {
    if (!isScanning || !activeProject) return;

    pollingFailuresRef.current = 0;
    const interval = setInterval(async () => {
      try {
        const stages = await apiClient.getStages(activeProject.project_id);
        pollingFailuresRef.current = 0; // Đặt lại bộ đếm lỗi khi nhận phản hồi

        if (stages && stages.length > 0) {
          // Sắp xếp các stage theo start_time tăng dần để tìm stage mới nhất tuyệt đối
          const sorted = [...stages].sort((a, b) => Number(a.start_time || 0) - Number(b.start_time || 0));
          const latest = sorted[sorted.length - 1];

          // Tìm các stage chủ chốt
          const pipelineStage = sorted.slice().reverse().find((s: any) => s.stage_name === 'pipeline');
          const runningStage = sorted.slice().reverse().find((s: any) => s.status === 'running');
          const failedStage = sorted.slice().reverse().find((s: any) => s.status === 'failed');
          const cancelledStage = sorted.slice().reverse().find((s: any) => s.status === 'cancelled');

          // Luôn hiển thị trạng thái của stage đang chạy (hoặc stage mới nhất)
          const activeStage = runningStage || latest;
          if (activeStage?.metrics?.label) {
            setStatusMessage(activeStage.metrics.label);
          }
          if (activeStage?.progress !== undefined) {
            setScanProgress(Math.round(activeStage.progress * 100));
          }

          const scanKey = `scan-${activeProject.project_id}`;
          if (runningStage) {
            appLogger.updateTask(scanKey, {
              message: activeStage?.metrics?.label || 'Đang thực thi tiến trình...',
              progress: Math.round((activeStage?.progress || 0) * 100),
            });
          }

          // Kiểm tra xem pipeline đã thực sự hoàn tất / lỗi / hủy chưa
          // Không bao giờ ngắt polling khi các stage trung gian (như cloud_extraction) hoàn thành
          const isPipelineTerminal = pipelineStage && ['completed', 'failed', 'cancelled'].includes(pipelineStage.status);
          const hasError = failedStage !== undefined || pipelineStage?.status === 'failed';
          const hasCancel = cancelledStage !== undefined || pipelineStage?.status === 'cancelled';

          if (isPipelineTerminal || hasError || hasCancel) {
            setIsScanning(false);
            setScanProgress(null);
            if (pipelineStage && pipelineStage.status === 'completed') {
              const successMsg = pipelineStage.metrics?.label || 'Đã hoàn tất quét phụ đề!';
              setStatusMessage(successMsg);
              appLogger.finishTask(scanKey, successMsg, 'success');
            } else if (hasError) {
              const targetFail = failedStage || pipelineStage;
              const errMsg = targetFail?.errors?.[0] || targetFail?.metrics?.error || 'Tác vụ thất bại';
              setStatusMessage(`Thất bại: ${errMsg}`);
              appLogger.finishTask(scanKey, `Lỗi: ${errMsg}`, 'error');
            } else if (hasCancel) {
              if (!cancelRequestedRef.current) {
                setStatusMessage('Đã dừng tiến trình theo yêu cầu');
                appLogger.finishTask(scanKey, 'Đã dừng tiến trình theo yêu cầu', 'warn');
              } else {
                appLogger.dismiss(scanKey);
              }
            }
            await loadCues(activeProject.project_id);
            const updated = await apiClient.getProject(activeProject.project_id);
            if (updated) setActiveProject(updated);
          }
        }
      } catch (err) {
        pollingFailuresRef.current += 1;
        console.warn('Lỗi kiểm tra tiến trình stage:', err);
        if (pollingFailuresRef.current >= 4 && pollingFailuresRef.current < 10) {
          setStatusMessage('Mất kết nối máy chủ - đang thử lại...');
        } else if (pollingFailuresRef.current >= 10) {
          // Timeout sau ~12s mất mạng liên tục: dừng spinner và báo lỗi rõ ràng
          setIsScanning(false);
          setStatusMessage('Không thể kết nối máy chủ sau nhiều lần thử');
          appLogger.finishTask(`scan-${activeProject.project_id}`, 'Mất kết nối với máy chủ khi đang quét phụ đề', 'error');
        }
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [isScanning, activeProject, loadCues]);

  // Tự bắt dính vùng chữ ROI
  const handleAutoDetectRoi = async () => {
    if (!activeProject) {
      setStatusMessage('Cần nạp một dự án backend để tự bắt dính ROI');
      appLogger.warn('Cần nạp một dự án backend để tự bắt dính ROI', 'ROI');
      return;
    }
    try {
      setStatusMessage('Đang phân tích khung hình để bắt dính vị trí chữ...');
      appLogger.info('Đang phân tích khung hình để bắt dính vị trí chữ...', 'ROI');
      const res = await apiClient.autoDetectRoi(activeProject.project_id, currentTime);
      if (res.region) {
        const clampedW = Math.max(0.03, Math.min(1.0 - res.region.x, res.region.width));
        const newRegion: RegionTrackV1 = {
          region_id: res.region.region_id || 'roi-main',
          x: res.region.x,
          y: res.region.y,
          width: clampedW,
          height: res.region.height,
          mask_enabled: res.region.mask_enabled !== false,
        };
        setRegions([newRegion]);
        setActiveRegionId(newRegion.region_id);
        const lineDesc = (res as any).line_description || '1 dòng sub';
        const msg = `Đã bắt dính phụ đề: ${lineDesc} (Full ngang, H: ${Math.round(newRegion.height * 100)}%)`;
        setStatusMessage(msg);
        appLogger.success(msg, 'ROI');
      } else {
        appLogger.warn('Không phát hiện vùng chữ rõ ràng trên khung hình', 'ROI');
      }
    } catch (err: any) {
      appLogger.error(err?.message || 'Không thể tự động phát hiện vùng chữ', 'ROI');
    }
  };

  // Khởi chạy quét phụ đề
  const handleStartScan = async () => {
    if (!activeProject && !localVideoFile) {
      appLogger.warn('Vui lòng chọn hoặc nạp một video trước khi chạy', 'Quét');
      return;
    }

    const scanTaskKey = `scan-${activeProject?.project_id || 'new'}`;
    try {
      setIsScanning(true);

      if (activeProject) {
        setStatusMessage('Đang lưu vùng quét phụ đề vào dự án...');
        await apiClient.saveRegions(activeProject.project_id, regions);

        setStatusMessage('Đang khởi chạy tiến trình quét phụ đề trên máy chủ...');
        appLogger.loading('Đang khởi chạy tiến trình quét phụ đề trên máy chủ...', 'Quét', { taskKey: scanTaskKey });
        await apiClient.runPipeline(activeProject.project_id, { ocr_only: true });

        setStatusMessage('Tiến trình quét phụ đề đang thực thi...');
      } else if (localVideoFile) {
        setStatusMessage('Đang tải video lên máy chủ và khởi tạo dự án...');
        appLogger.loading('Đang tải video lên máy chủ và khởi tạo dự án...', 'Quét', { taskKey: scanTaskKey });
        const uploadRes = await apiClient.uploadVideo(localVideoFile);
        const newProj = await apiClient.createProject({
          title: localVideoFile.name.replace(/\.[^/.]+$/, ''),
          source_video_path: uploadRes.path,
          source_language: sourceLang,
          target_language: targetLang,
        });

        await apiClient.saveRegions(newProj.project_id, regions);
        await apiClient.runPipeline(newProj.project_id, { ocr_only: true });

        setActiveProject(newProj);
        setVideoUrl(apiClient.getVideoStreamUrl(newProj.project_id));
        loadProjects();
        setStatusMessage('Đã tạo dự án và bắt đầu quét phụ đề!');
        appLogger.finishTask(scanTaskKey, 'Đã tạo dự án và bắt đầu quét phụ đề!', 'success');
      }
    } catch (err: any) {
      setIsScanning(false);
      appLogger.finishTask(scanTaskKey, err?.message || 'Có lỗi xảy ra khi bắt đầu quét phụ đề', 'error');
    }
  };

  // Dừng / Hủy tiến trình quét phụ đề
  const handleStopScan = async () => {
    setIsScanning(false);
    if (!activeProject) {
      return;
    }
    const scanTaskKey = `scan-${activeProject.project_id}`;
    // Đặt cờ ngăn WS handler và polling phát toast trùng lặp
    cancelRequestedRef.current = true;
    try {
      setStatusMessage('Đang gửi yêu cầu dừng quét phụ đề...');
      appLogger.info('Đang gửi yêu cầu dừng quét phụ đề...', 'Quét');
      await apiClient.stopPipeline(activeProject.project_id);
      setStatusMessage('Đã dừng tiến trình quét phụ đề theo yêu cầu');
      appLogger.finishTask(scanTaskKey, 'Đã dừng tiến trình quét phụ đề theo yêu cầu', 'warn');
      loadCues(activeProject.project_id);
    } catch (err: any) {
      appLogger.error(`Không thể dừng tiến trình: ${err?.message || 'Lỗi kết nối'}`, 'Quét');
    } finally {
      // Reset cờ sau 3 giây để cho phép phát hiện cancel ngoài luồng trong tương lai
      setTimeout(() => { cancelRequestedRef.current = false; }, 3000);
    }
  };

  // Bước 2: Dịch thuật toàn bộ phụ đề bằng AI
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const handleTranslateAll = useCallback(async () => {
    if (!activeProject) return;
    if (cues.length === 0) {
      appLogger.warn('Cần quét hoặc nhập phụ đề trước khi dịch AI', 'Dịch Thuật');
      return;
    }
    const tKey = `translate-${activeProject.project_id}`;
    setIsTranslatingAll(true);
    setStatusMessage('Đang gọi AI dịch thuật ngữ cảnh toàn bộ tập phim...');
    appLogger.loading('Đang gọi AI dịch thuật ngữ cảnh toàn bộ tập phim...', 'Dịch Thuật', { taskKey: tKey });
    try {
      await apiClient.retranslateProject(activeProject.project_id);
      setStatusMessage('Dịch thuật AI toàn bộ phụ đề hoàn tất!');
      appLogger.finishTask(tKey, 'Dịch thuật ngữ cảnh toàn bộ phụ đề hoàn tất!', 'success');
      await loadCues(activeProject.project_id);
      const updated = await apiClient.getProject(activeProject.project_id);
      if (updated) setActiveProject(updated);
    } catch (err: any) {
      setStatusMessage(`Lỗi dịch AI: ${err?.message || 'Thất bại'}`);
      appLogger.finishTask(tKey, `Lỗi dịch AI: ${err?.message || 'Thất bại'}`, 'error');
    } finally {
      setIsTranslatingAll(false);
    }
  }, [activeProject, cues.length, loadCues]);

  // Bước 3: Lồng tiếng toàn bộ video bằng TTS (Single source of truth for dubbing state)
  const [isDubbingAll, setIsDubbingAll] = useState(false);
  const handleDubAll = useCallback(async () => {
    if (!activeProject) return;
    if (cues.length === 0) {
      appLogger.warn('Cần quét phụ đề trước khi lồng tiếng', 'Lồng Tiếng');
      return;
    }
    const tKey = `dubbing-${activeProject.project_id}`;
    setIsDubbingAll(true);
    setStatusMessage('Đang tạo thuyết minh lồng tiếng toàn bộ video...');
    appLogger.loading('Đang tạo thuyết minh lồng tiếng toàn bộ video...', 'Lồng Tiếng', { taskKey: tKey });
    const projectId = activeProject.project_id;
    const progressTimer = window.setInterval(async () => {
      try {
        const stages = await apiClient.getStages(projectId);
        const latest = [...stages].reverse().find((stage: any) => stage.stage_name === 'dubbing');
        if (!latest) return;
        const percent = Number(latest.metrics?.percent ?? Math.round(Number(latest.progress || 0) * 100));
        const done = latest.metrics?.completed_cues;
        const total = latest.metrics?.total_cues;
        if (latest.status === 'failed') {
          setStatusMessage(`Lỗi lồng tiếng: ${latest.errors?.[0] || 'Tạo voice thất bại'}`);
        } else if (latest.status === 'running') {
          setStatusMessage(`Đang lồng tiếng ${percent}%${done != null && total ? ` (${done}/${total} câu)` : ''}...`);
        } else if (latest.status === 'completed') {
          setStatusMessage('Lồng tiếng hoàn tất!');
        }
      } catch {}
    }, 1000);
    try {
      const dubSettings = activeProject.custom_pipeline_settings?.dubbing || {};
      const modeRaw = String((dubSettings as any).mode || 'single');
      const mode = modeRaw === 'multi' || modeRaw === 'gender_multi' ? 'multi' : 'single';
      await apiClient.runDubbing(activeProject.project_id, {
        ...dubSettings,
        mode,
        voice: (dubSettings as any).voice,
        voice_male: (dubSettings as any).voice_male,
        voice_female: (dubSettings as any).voice_female,
        rate: (dubSettings as any).rate,
        provider: (dubSettings as any).provider,
        auto_detect_speakers: (dubSettings as any).auto_detect_speakers,
      });
      setStatusMessage('Lồng tiếng toàn bộ video hoàn tất!');
      appLogger.finishTask(tKey, 'Lồng tiếng toàn bộ video hoàn tất! Đã đồng bộ với Timeline.', 'success');
      const updated = await apiClient.getProject(activeProject.project_id);
      if (updated) setActiveProject(updated);
      await loadCues(activeProject.project_id);
    } catch (err: any) {
      setStatusMessage(`Lỗi lồng tiếng: ${err?.message || 'Thất bại'}`);
      appLogger.finishTask(tKey, `Lỗi lồng tiếng: ${err?.message || 'Thất bại'}`, 'error');
    } finally {
      window.clearInterval(progressTimer);
      setIsDubbingAll(false);
    }
  }, [activeProject, cues.length, loadCues]);

  // Tự động ẩn thông báo trạng thái sau 4 giây khi tác vụ hoàn thành (không bị treo đè nút)
  useEffect(() => {
    if (!statusMessage) return;
    if (isScanning || isTranslatingAll || isDubbingAll) return;
    const timer = setTimeout(() => {
      setStatusMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [statusMessage, isScanning, isTranslatingAll, isDubbingAll]);

  const handleResetTransform = () => {
    setVideoPosition({ x: 0, y: 0 });
    setIsFlippedH(false);
    setIsFlippedV(false);
    setRotation(0);
    setZoomLevel('fit');
    setAspectRatio('original');
    setFitMode('contain');
    appLogger.info('Đã khôi phục khung nhìn về mặc định (Tâm 0,0, Fit, 0°, Không lật)', 'Hiển thị');
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-row font-sans overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 0. NAVIGATION SIDEBAR BÊN TRÁI (Chuẩn chuyên nghiệp, Mini 64px / Full 240px) */}
      {/* ========================================================================= */}
      <AppSidebar
        currentView={viewMode}
        onNavigate={(newView, tab) => {
          if (newView === 'settings' && tab) {
            setSettingsTab(tab as any);
          }
          setViewMode(newView);
        }}
        hasActiveProject={Boolean(activeProject)}
        activeProjectTitle={activeProject?.title}
        isBackendOnline={Boolean(backendOnline)}
      />

      {/* ========================================================================= */}
      {/* 1. VIEW ROUTER CONTAINER: DOWNLOADER / QUEUE / DASHBOARD / SETTINGS / STUDIO */}
      {/* ========================================================================= */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden relative">
        {viewMode === 'admin' ? (
          <AdminLanView
            onBack={() => setViewMode('dashboard')}
            onOpenInStudio={handleOpenJobInStudio}
          />
        ) : viewMode === 'downloader' ? (
          <VideoDownloaderHub
            initialTab={downloaderTab || 'queue'}
            onTabChange={setDownloaderTab}
            onSwitchToDashboard={() => setViewMode('dashboard')}
            onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
            onSelectProject={selectProject}
            onOpenSettings={() => {
              setSettingsTab('ocr');
              setViewMode('settings');
            }}
            onRefreshProjects={loadProjects}
            onBatchProjectsCreated={(newProjs) => {
              setProjects((prev) => [...prev, ...newProjs]);
            }}
          />
      ) : viewMode === 'queue' ? (
        <DownloadQueueHub onSwitchToDashboard={() => setViewMode('dashboard')} />
      ) : viewMode === 'settings' ? (
        <GlobalSettingsView
          initialTab={settingsTab}
          onTabChange={setSettingsTab}
          presets={presets}
          onSavePresets={handleSavePresets}
          onSelectPreset={(p) => applyPresetProfile(p)}
          onSwitchToDashboard={() => setViewMode('dashboard')}
          onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
        />
      ) : viewMode === 'dashboard' ? (
        <DashboardBatchHub
          projects={projects}
          presets={presets}
          onSelectProject={selectProject}
          onNewProject={() => setIsNewProjectModalOpen(true)}
          onDeleteProject={handleDeleteProject}
          onOpenPresetManager={() => {
            setSettingsTab('render');
            setViewMode('settings');
          }}
          onOpenSettingsTab={(tab) => {
            setSettingsTab(tab || 'ocr');
            setViewMode('settings');
          }}
          onRefreshProjects={loadProjects}
          onBatchProjectsCreated={(newProjs) => {
            setProjects((prev) => [...prev, ...newProjs]);
          }}
          onOpenQueue={() => {
            setDownloaderTab('queue');
            setViewMode('downloader');
          }}
          onOpenAdmin={() => setViewMode('admin')}
          onOpenDownloader={(tab) => {
            setDownloaderTab(tab || 'search');
            setViewMode('downloader');
          }}
          selectedDramaTitle={selectedDramaTitle}
          onSelectDramaTitle={(t) => setSelectedDramaTitle(t)}
        />
      ) : (
        /* ========================================================================= */
        /* 2. GIAO DIỆN STUDIO */
        /* ========================================================================= */
        <>
          {/* 1. Header Studio Duy Nhất 48px */}
          <StudioHeader
            activeProject={activeProject}
            projects={projects}
            onSelectProject={selectProject}
            onBackToDashboard={() => {
              setSelectedDramaTitle(null);
              setViewMode('dashboard');
            }}
            onBackToDrama={() => {
              setViewMode('dashboard');
            }}
            dramaTitle={selectedDramaTitle}
            presets={presets}
            activePresetId={activePresetId}
            onSelectPreset={applyPresetProfile}
            statusMessage={statusMessage}
            backendOnline={backendOnline}
            wsConnected={wsConnected}
            wsStatus={wsStatus}
            saveStatus={saveStatus}
            loggerCount={loggerCount}
            onToggleLogger={() => appLogger.toggle()}
            isScanning={isScanning}
            scanProgress={scanProgress}
            hasVideo={Boolean(videoUrl)}
            onStartScan={handleStartScan}
            onStopScan={handleStopScan}
            onExportVideo={() => setIsExportModalOpen(true)}
            onTranslateAll={handleTranslateAll}
            isTranslating={isTranslatingAll}
            onDubAll={handleDubAll}
            isDubbing={isDubbingAll}
            cuesCount={cues.length}
            cues={cues}
            hasVoiceover={Boolean(activeProject?.has_voiceover)}
          />

          {/* 2. Vùng Làm Việc 3-Panel: Hộp Trái + Video ở Giữa + Hộp Phải Inspector */}
          <main className="flex-1 min-h-0 min-w-0 flex flex-row relative overflow-hidden">
            {/* Hộp Trái: Danh Sách Phụ Đề & Quản Lý Tập Phim & Presets */}
            <LeftMediaSidebar
              projects={projects}
              activeProject={activeProject}
              onSelectProject={selectProject}
              onPickLocalVideo={handlePickLocalVideo}
              cues={cues}
              currentTime={currentTime}
              onRefreshCues={loadCues}
              onSeekToCue={(pts) => setCurrentTime(pts)}
              onUpdateCue={handleUpdateCue}
              onDeleteProject={handleDeleteProject}
              presets={presets}
              activePresetId={activePresetId}
              onSelectPreset={applyPresetProfile}
              onSaveCurrentAsPreset={handleSaveCurrentAsPreset}
              onDeletePreset={handleDeletePreset}
              onUpdatePreset={handleUpdatePreset}
              currentRoi={activeRoiRegion}
              onRefreshProject={loadProjects}
              selectedCueId={selectedCueId}
              onSplitCue={handleSplitCue}
              onUpdateActiveProject={(patch) => {
                setActiveProject((prev) => (prev ? { ...prev, ...patch } : null));
                setProjects((prev) =>
                  prev.map((p) => (p.project_id === activeProject?.project_id ? { ...p, ...patch } : p))
                );
              }}
              isScanning={isScanning}
              scanProgress={scanProgress}
              statusMessage={statusMessage}
              width={leftSidebarWidth}
            />

            {/* Splitter Co Giãn Trái */}
            <div
              onMouseDown={() => setIsResizingLeft(true)}
              className={`w-1 hover:w-1.5 bg-slate-850 hover:bg-indigo-500 active:bg-indigo-400 cursor-col-resize z-30 transition-all select-none shrink-0 ${
                isResizingLeft ? 'bg-indigo-500 w-1.5 shadow-[0_0_8px_rgba(99,102,241,0.6)]' : ''
              }`}
              title="Kéo để điều chỉnh độ rộng bảng Media / Phụ đề"
            />

            {/* Video Canvas ở Giữa: Khung Xem Cực Kỳ Thoáng Đãng */}
            <VideoPlayer
              videoUrl={videoUrl}
              videoQuality={videoQuality}
              onVideoQualityChange={handleVideoQualityChange}
              regions={regions}
              activeRegionId={activeRegionId}
              onSelectRegion={setActiveRegionId}
              region={activeRoiRegion}
              onUpdateRegion={handleUpdateRegion}
              currentTime={currentTime}
              isPlaying={isPlaying}
              onTimeUpdate={(t) => setCurrentTime(t)}
              onDurationChange={(d) => setDuration(d)}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              onPickLocalVideo={handlePickLocalVideo}
              cues={cues}
              aspectRatio={aspectRatio}
              onAspectRatioChange={(r) => setAspectRatio(r)}
              fitMode={fitMode}
              onToggleFitMode={() => setFitMode((m) => (m === 'contain' ? 'cover' : 'contain'))}
              onResetTransform={handleResetTransform}
              isFlippedH={isFlippedH}
              isFlippedV={isFlippedV}
              rotation={rotation}
              onRotationChange={(deg) => {
                const next = normalizeRotation(deg);
                setRotation(next);
              }}
              zoomLevel={zoomLevel}
              onZoomChange={(z) => {
                setZoomLevel(z);
              }}
              previewMask={previewMask}
              onTogglePreviewMask={() => {
                setPreviewMask((prev) => !prev);
              }}
              maskStyle={maskStyle}
              blurStrength={blurStrength}
              showSubtitleOverlay={showSubtitleOverlay}
              subtitlePlacement={subtitlePlacement}
              videoPosition={videoPosition}
              onPositionChange={setVideoPosition}
              interactionMode={interactionMode}
              onInteractionModeChange={setInteractionMode}
              onAutoDetectRoi={handleAutoDetectRoi}
              onResetAllParameters={handleResetAllParameters}
              onToggleFlipH={() => setIsFlippedH((p) => !p)}
              onToggleFlipV={() => setIsFlippedV((p) => !p)}
              onRotate={() => setRotation((r) => normalizeRotation(r + 90))}
              isAudioMuted={isAudioMuted}
              onToggleAudioMute={() => setIsAudioMuted((p) => !p)}
              isVideoVisible={isVideoVisible}
              volume={originalAudioVolume / 100}
              onVolumeChange={(v) => handleOriginalAudioVolumeChange(Math.round(v * 100))}
              subtitleFontSize={subtitleFontSize}
              subtitleFontFamily={subtitleFontFamily}
              subtitleTextColor={subtitleTextColor}
              maskOpacity={maskOpacity}
              maskPadding={maskPadding}
              maskBorderRadius={maskBorderRadius}
              responsiveFontScale={responsiveFontScale}
              subtitleStroke={subtitleStroke}
              subtitleLineHeight={subtitleLineHeight}
            />

            {/* Splitter Co Giãn Phải */}
            <div
              onMouseDown={() => setIsResizingRight(true)}
              className={`w-1 hover:w-1.5 bg-slate-850 hover:bg-indigo-500 active:bg-indigo-400 cursor-col-resize z-30 transition-all select-none shrink-0 ${
                isResizingRight ? 'bg-indigo-500 w-1.5 shadow-[0_0_8px_rgba(99,102,241,0.6)]' : ''
              }`}
              title="Kéo để điều chỉnh độ rộng bảng Thuộc Tính"
            />

            {/* Hộp Phải: Bảng Thuộc Tính & Inspector Chuẩn Premiere/CapCut */}
            <RightInspectorPanel
              width={rightInspectorWidth}
              regions={regions}
              activeRegionId={activeRegionId}
              onSelectRegion={setActiveRegionId}
              onAddRegion={handleAddRegion}
              onDeleteRegion={handleDeleteRegion}
              region={activeRoiRegion}
              onUpdateRegion={handleUpdateRegion}
              onAutoDetectRoi={handleAutoDetectRoi}
              subtitleFontSize={subtitleFontSize}
              onSubtitleFontSizeChange={setSubtitleFontSize}
              subtitleFontFamily={subtitleFontFamily}
              onSubtitleFontFamilyChange={setSubtitleFontFamily}
              subtitleTextColor={subtitleTextColor}
              onSubtitleTextColorChange={setSubtitleTextColor}
              maskOpacity={maskOpacity}
              onMaskOpacityChange={setMaskOpacity}
              maskPadding={maskPadding}
              onMaskPaddingChange={setMaskPadding}
              maskBorderRadius={maskBorderRadius}
              onMaskBorderRadiusChange={setMaskBorderRadius}
              responsiveFontScale={responsiveFontScale}
              onResponsiveFontScaleChange={setResponsiveFontScale}
              subtitleStroke={subtitleStroke}
              onSubtitleStrokeChange={(val) => setSubtitleStroke(val as any)}
              subtitleLineHeight={subtitleLineHeight}
              onSubtitleLineHeightChange={setSubtitleLineHeight}
              sourceLang={sourceLang}
              targetLang={targetLang}
              onLanguageChange={(s, t) => {
                setSourceLang(s);
                setTargetLang(t);
              }}
              previewMask={previewMask}
              onTogglePreviewMask={() => {
                setPreviewMask((prev) => !prev);
              }}
              maskStyle={maskStyle}
              onMaskStyleChange={(st) => {
                setMaskStyle(st);
              }}
              blurStrength={blurStrength}
              onBlurStrengthChange={setBlurStrength}
              showSubtitleOverlay={showSubtitleOverlay}
              onToggleSubtitleOverlay={() => {
                setShowSubtitleOverlay((prev) => !prev);
              }}
              subtitlePlacement={subtitlePlacement}
              onSubtitlePlacementChange={(p) => {
                setSubtitlePlacement(p);
              }}
              aspectRatio={aspectRatio}
              onAspectRatioChange={(r) => {
                setAspectRatio(r);
              }}
              fitMode={fitMode}
              onToggleFitMode={() => {
                setFitMode((m) => (m === 'contain' ? 'cover' : 'contain'));
              }}
              isFlippedH={isFlippedH}
              onToggleFlipH={() => {
                setIsFlippedH((prev) => !prev);
              }}
              isFlippedV={isFlippedV}
              onToggleFlipV={() => {
                setIsFlippedV((prev) => !prev);
              }}
              rotation={rotation}
              onRotate={() => {
                const next = normalizeRotation(rotation + 90);
                setRotation(next);
              }}
              onRotationChange={(deg) => {
                const next = normalizeRotation(deg);
                setRotation(next);
              }}
              videoPosition={videoPosition}
              onPositionChange={setVideoPosition}
              onResetTransform={handleResetTransform}
              onResetAllParameters={handleResetAllParameters}
              activeProject={activeProject}
              cues={cues}
              onRefreshCues={loadCues}
              onRefreshProject={loadProjects}
              onUpdateActiveProject={(patch) => {
                setActiveProject((prev) => (prev ? { ...prev, ...patch } : null));
                setProjects((prev) =>
                  prev.map((p) => (p.project_id === activeProject?.project_id ? { ...p, ...patch } : p))
                );
              }}
              isScanning={isScanning}
              scanProgress={scanProgress}
              statusMessage={statusMessage}
              onStartScan={handleStartScan}
              onStopScan={handleStopScan}
            />
          </main>

          {/* Splitter Co Giãn Dòng Thời Gian Ngang */}
          <div
            onMouseDown={() => setIsResizingBottom(true)}
            className={`h-1 hover:h-1.5 bg-slate-850 hover:bg-indigo-500 active:bg-indigo-400 cursor-row-resize z-30 transition-all select-none shrink-0 ${
              isResizingBottom ? 'bg-indigo-500 h-1.5 shadow-[0_0_8px_rgba(99,102,241,0.6)]' : ''
            }`}
            title="Kéo để điều chỉnh chiều cao Dòng thời gian Timeline"
          />

          {/* Thanh dưới: Timeline NLE Nâng Cấp (Time Ruler + Playhead + Cột Track Khóa/Ẩn/Mute + Zoom Slider) */}
          <BottomTimeline
            height={bottomTimelineHeight}
            videoUrl={videoUrl}
            projectId={activeProject?.project_id}
            duration={duration}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            onSeek={(time) => {
              setCurrentTime(time);
            }}
            cues={cues}
            selectedCueId={selectedCueId}
            selectedCueIds={selectedCueIds}
            onSelectCue={(cue) => {
              setSelectedCueId(cue.cue_id);
              setSelectedCueIds([cue.cue_id]);
              setCurrentTime(cue.start_pts);
            }}
            onSelectCues={handleSelectCues}
            onBeginCueDrag={handleBeginCueDrag}
            onUpdateCueTime={handleUpdateCueTime}
            onUpdateMultipleCuesTime={handleUpdateMultipleCuesTime}
            onSplitCue={handleSplitCue}
            onDeleteCue={handleDeleteCue}
            onDeleteCues={handleDeleteCues}
            originalAudioVolume={originalAudioVolume}
            onOriginalAudioVolumeChange={handleOriginalAudioVolumeChange}
            voiceoverVolume={voiceoverVolume}
            onVoiceoverVolumeChange={handleVoiceoverVolumeChange}
            hasVoiceover={Boolean(
              activeProject?.has_voiceover ||
              (activeProject as any)?.voiceover_path ||
              (activeProject as any)?.status === 'completed'
            )}
            isAudioMuted={isAudioMuted}
            onToggleAudioMute={() => setIsAudioMuted((p) => !p)}
            onSetAudioMuted={(muted) => setIsAudioMuted(muted)}
            isVideoVisible={isVideoVisible}
            onToggleVideoVisible={() => setIsVideoVisible((p) => !p)}
            isSubVisible={showSubtitleOverlay}
            onToggleSubVisible={() => setShowSubtitleOverlay((p) => !p)}
            isScanning={isScanning}
            scanProgress={scanProgress}
            statusMessage={statusMessage}
            onDismissStatus={() => setStatusMessage(null)}
            onStopScan={handleStopScan}
            isTranslating={isTranslatingAll}
            isDubbing={isDubbingAll}
            dubbingMode={(activeProject?.custom_pipeline_settings?.dubbing?.mode === 'multi' || activeProject?.custom_pipeline_settings?.dubbing?.mode === 'gender_multi') ? 'multi' : 'single'}
          />
        </>
      )}
      </div>


      {/* Modal Xuất Phụ Đề & Video Thành Phẩm */}
      {activeProject && (
        <ExportModal
          isOpen={isExportModalOpen}
          project={activeProject}
          onClose={() => setIsExportModalOpen(false)}
        />
      )}

      {/* Modal Tạo Dự Án Mới */}
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onCreated={(newProj, appliedPreset) => {
          setProjects((prev) => [newProj, ...prev]);
          if (appliedPreset) {
            applyPresetProfile(appliedPreset);
          }
          selectProject(newProj);
        }}
        presets={presets}
      />

      {/* Hệ thống Toast Thông Báo & Nhật Ký Hoạt Động Toàn Cục (Không bị im lặng) */}
      <GlobalActivityLogger />

      {/* Lớp bảo vệ chuột trong suốt khi đang co giãn panel (Ngăn video/iframe bắt chuột gây giật lag) */}
      {(isResizingLeft || isResizingRight || isResizingBottom) && (
        <div className="fixed inset-0 z-50 select-none bg-transparent" />
      )}

      {/* Thông Báo Máy Chủ Cập Nhật Mã Nguồn & Nút Bấm F5 Tải Lại Ngay */}
      {serverRestartNotification.show && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-indigo-950/95 border border-indigo-500/50 shadow-2xl backdrop-blur-md text-white font-medium text-sm">
            <RotateCw className="w-5 h-5 text-indigo-400 animate-spin" />
            <div className="flex flex-col">
              <span className="font-bold text-indigo-200">Máy chủ vừa cập nhật mã nguồn!</span>
              <span className="text-xs text-slate-300">
                Tự động làm mới trang sau {serverRestartNotification.countdown}s...
              </span>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="ml-3 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition shadow cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              F5 Tải lại ngay
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
