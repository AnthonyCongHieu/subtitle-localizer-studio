import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from './api/client';
import { wsClient } from './api/websocket';
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
import { useTimelineShortcuts } from './hooks/useTimelineShortcuts';
import { AlertCircle } from 'lucide-react';
import { extractDramaInfo } from './utils/drama';

const STUDIO_STORAGE_KEY = 'sub_studio_active_state_v1';

interface StoredStudioState {
  roiRegion?: RegionTrackV1;
  regions?: RegionTrackV1[];
  activeRegionId?: string;
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
  viewMode?: 'dashboard' | 'studio' | 'queue' | 'downloader' | 'settings';
  downloaderTab?: 'search' | 'direct' | 'queue' | 'auth' | 'settings';
  settingsTab?: 'ocr' | 'translation' | 'dubbing' | 'render';
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
  const [viewMode, setViewMode] = useState<'dashboard' | 'studio' | 'queue' | 'downloader' | 'settings'>(
    () => savedState?.viewMode || 'dashboard'
  );
  const [downloaderTab, setDownloaderTab] = useState<'search' | 'direct' | 'queue' | 'auth' | 'settings'>(
    () => savedState?.downloaderTab || 'search'
  );
  const [settingsTab, setSettingsTab] = useState<'ocr' | 'translation' | 'dubbing' | 'render'>(
    () => savedState?.settingsTab || 'ocr'
  );

  // Quản lý Chuẩn Cấu Hình (Preset Profiles)
  const [presets, setPresets] = useState<PresetProfile[]>(() => getStoredPresets());
  const [activePresetId, setActivePresetId] = useState<string>(() => savedState?.activePresetId || getDefaultPreset().id);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);


  // Trạng thái dự án và video hiện tại
  const [projects, setProjects] = useState<ProjectManifestV1[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifestV1 | null>(null);
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
      x: 0.05,
      y: 0.70,
      width: 0.90,
      height: 0.26,
    }];
  });
  const [activeRegionId, setActiveRegionId] = useState<string>(() => savedState?.activeRegionId || 'roi-main');

  const activeRoiRegion = regions.find((r) => r.region_id === activeRegionId) || regions[0] || {
    region_id: 'roi-main',
    x: 0.05,
    y: 0.70,
    width: 0.90,
    height: 0.26,
  };

  // Thao tác với Đa Vùng Quét OCR
  const handleUpdateRegion = useCallback((updated: RegionTrackV1) => {
    setRegions((prev) => {
      const exists = prev.some((r) => r.region_id === updated.region_id);
      if (exists) {
        return prev.map((r) => (r.region_id === updated.region_id ? updated : r));
      }
      return [...prev, updated];
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
  const [previewMask, setPreviewMask] = useState<boolean>(false);
  const [maskStyle, setMaskStyle] = useState<MaskStyleType>(() => savedState?.maskStyle || 'feather_tight');
  const [blurStrength, setBlurStrength] = useState<number>(() => (typeof savedState?.blurStrength === 'number' ? savedState.blurStrength : 20));
  const [subtitlePlacement, setSubtitlePlacement] = useState<SubtitlePlacementMode>(() => savedState?.subtitlePlacement || 'roi');
  const [showSubtitleOverlay, setShowSubtitleOverlay] = useState<boolean>(true);

  // Trạng thái phát video và thanh timeline
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoVisible, setIsVideoVisible] = useState<boolean>(true);

  // Trạng thái hệ thống và pipeline
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const localUrlRef = useRef<string | null>(null);

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

  // Hệ thống phím tắt toàn cục chuẩn CapCut / Premiere
  useTimelineShortcuts({
    isPlaying,
    onTogglePlay: () => setIsPlaying((p) => !p),
    currentTime,
    duration,
    onSeek: (t) => setCurrentTime(t),
    selectedCueId: null,
    cues,
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
    const id = projId || activeProject?.project_id;
    if (!id) {
      setCues([]);
      return;
    }
    try {
      const list = await apiClient.getCues(id);
      setCues(list || []);
      if (list && list.length > 0) {
        appLogger.info(`Đã nạp ${list.length} câu phụ đề vào Timeline`, 'Phụ đề', false);
      }
    } catch (err) {
      console.warn('Chưa nạp được danh sách phụ đề:', err);
      setCues([]);
    }
  }, [activeProject]);

  // Cập nhật câu phụ đề khi người dùng sửa trực tiếp trên bảng
  const handleUpdateCue = async (updatedCue: SubtitleCueV1) => {
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

  // Chia đôi câu phụ đề tại vị trí con trỏ thời gian (Split Cue)
  const handleSplitCue = async (splitTime: number) => {
    if (!activeProject || cues.length === 0) return;
    const targetCue = cues.find((c) => splitTime > c.start_pts && splitTime < c.end_pts);
    if (!targetCue) {
      appLogger.warn('Không có câu phụ đề nào ở vị trí con trỏ để chia tách', 'Timeline');
      return;
    }

    const duration = targetCue.end_pts - targetCue.start_pts;
    const ratio = duration > 0 ? (splitTime - targetCue.start_pts) / duration : 0.5;
    const words = targetCue.source_text.trim().split(/\s+/);
    const transWords = (targetCue.translated_text || '').trim().split(/\s+/);

    const splitIdx = Math.max(1, Math.round(words.length * ratio));
    const transSplitIdx = Math.max(1, Math.round(transWords.length * ratio));

    const text1 = words.slice(0, splitIdx).join(' ');
    const text2 = words.slice(splitIdx).join(' ') || targetCue.source_text;
    const transText1 = transWords.length > 0 ? transWords.slice(0, transSplitIdx).join(' ') : '';
    const transText2 = transWords.length > 0 ? transWords.slice(transSplitIdx).join(' ') : '';

    const cue1: SubtitleCueV1 = {
      ...targetCue,
      end_pts: Number(splitTime.toFixed(3)),
      source_text: text1,
      translated_text: transText1,
    };

    const cue2: SubtitleCueV1 = {
      ...targetCue,
      cue_id: `cue_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      start_pts: Number(splitTime.toFixed(3)),
      source_text: text2,
      translated_text: transText2,
    };

    const nextCues = cues.flatMap((c) => (c.cue_id === targetCue.cue_id ? [cue1, cue2] : [c]));
    setCues(nextCues);
    setSelectedCueId(cue2.cue_id);

    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
      appLogger.success(`Đã chia câu phụ đề tại ${splitTime.toFixed(2)}s`, 'Timeline');
    } catch (err: any) {
      appLogger.error(`Lỗi khi lưu phụ đề sau khi chia: ${err?.message}`, 'Timeline');
    }
  };

  // Xóa câu phụ đề được chọn khỏi kịch bản
  const handleDeleteCue = async (cueId: string) => {
    if (!activeProject) return;
    const nextCues = cues.filter((c) => c.cue_id !== cueId);
    setCues(nextCues);
    if (selectedCueId === cueId) setSelectedCueId(null);

    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
      appLogger.success('Đã xóa câu phụ đề khỏi kịch bản', 'Timeline');
    } catch (err: any) {
      appLogger.error(`Lỗi xóa câu phụ đề: ${err?.message}`, 'Timeline');
    }
  };

  // Kéo chỉnh điểm đầu / điểm cuối câu phụ đề trên Timeline
  const handleUpdateCueTime = async (cueId: string, startPts: number, endPts: number) => {
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

    try {
      await apiClient.saveCues(activeProject.project_id, nextCues);
    } catch (err: any) {
      console.warn('Lỗi lưu thời gian phụ đề:', err);
    }
  };

  // Chọn dự án để xử lý video và chuyển sang giao diện Studio
  const selectProject = useCallback((proj: ProjectManifestV1, navigate: boolean = true) => {
    setActiveProject(proj);
    setLocalVideoFile(null);

    // Khi khôi phục sau F5 (navigate = false), bảo toàn cấu hình người dùng đã lưu trong savedState
    if (!navigate && savedState?.activeProjectId === proj.project_id) {
      if (savedState.sourceLang) setSourceLang(savedState.sourceLang);
      if (savedState.targetLang) setTargetLang(savedState.targetLang);
      if (savedState.regions && savedState.regions.length > 0) {
        setRegions(savedState.regions);
        setActiveRegionId(savedState.activeRegionId || savedState.regions[0].region_id);
      } else if (savedState.roiRegion) {
        setRegions([savedState.roiRegion]);
        setActiveRegionId(savedState.roiRegion.region_id);
      }
    } else {
      setSourceLang(proj.source_language || 'zh');
      setTargetLang(proj.target_language || 'vi');

      if (proj.regions && proj.regions.length > 0) {
        setRegions(proj.regions);
        setActiveRegionId(proj.regions[0].region_id);
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
          x: 0.05,
          y: 0.70,
          width: 0.90,
          height: 0.26,
        };
        setRegions([initRoi]);
        setActiveRegionId('roi-main');
      }
    }

    if (navigate) {
      const drama = extractDramaInfo(proj.title, proj.source_video_path).dramaTitle;
      if (drama && drama !== 'Video đơn lẻ / Chưa phân loại') {
        setSelectedDramaTitle(drama);
      }
    }

    const streamUrl = apiClient.getVideoStreamUrl(proj.project_id);
    setVideoUrl(streamUrl);

    loadCues(proj.project_id);

    if (navigate) {
      setStatusMessage(`Đã nạp: ${proj.title}`);
      appLogger.info(`Đã nạp dự án: ${proj.title}`, 'Dự án');
      setViewMode('studio');
    } else if (savedState?.viewMode === 'studio') {
      setStatusMessage(`Đã khôi phục: ${proj.title}`);
    }
  }, [presets, loadCues]);

  // Nạp danh sách dự án từ Backend & tự động khôi phục dự án sau F5
  const loadProjects = useCallback(async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);

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
      setErrorMessage(err?.message || 'Không thể xóa dự án');
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

  // Tự động lưu snapshot trạng thái làm việc vào localStorage để giữ nguyên khi F5
  useEffect(() => {
    saveStudioActiveState({
      roiRegion: activeRoiRegion,
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
      activeProjectId: activeProject?.project_id || null,
      viewMode,
      downloaderTab,
      settingsTab,
    });

    // Tự động đồng bộ ROI và danh sách vùng xuống backend (debounce 500ms)
    if (activeProject?.project_id) {
      const timer = setTimeout(() => {
        apiClient.saveProjectSettings(activeProject.project_id, {
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
        } as any).catch(() => {});
        apiClient.saveRegions(activeProject.project_id, regions).catch(() => {});
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
    viewMode,
    downloaderTab,
    settingsTab,
  ]);

  // Khởi tạo và lắng nghe WebSocket
  useEffect(() => {
    checkHealth();
    loadProjects();

    wsClient.connect();
    setWsConnected(true);

    const unsub = wsClient.onEvent((evt: BridgeEventV1) => {
      if (evt.event_type === 'stage_started') {
        setStatusMessage(`Đang chạy: ${evt.payload?.stage_name || 'Tiến trình quét'}`);
        appLogger.info(`Đang chạy: ${evt.payload?.stage_name || 'Tiến trình quét'}`, 'Quét phụ đề', false);
      } else if (evt.event_type === 'stage_completed') {
        setStatusMessage(`Hoàn thành: ${evt.payload?.stage_name || 'Tiến trình'}`);
        appLogger.success(`Hoàn thành giai đoạn: ${evt.payload?.stage_name || 'Tiến trình'}`, 'Quét phụ đề');
      } else if (evt.event_type === 'pipeline_completed') {
        setIsScanning(false);
        setStatusMessage('Đã hoàn thành quét phụ đề toàn bộ video!');
        appLogger.success('Đã hoàn thành quét phụ đề toàn bộ video!', 'Quét phụ đề');
        loadCues();
      } else if (evt.event_type === 'pipeline_failed') {
        setIsScanning(false);
        setErrorMessage(`Lỗi quét: ${evt.payload?.error || 'Không xác định'}`);
        appLogger.error(`Lỗi quét: ${evt.payload?.error || 'Không xác định'}`, 'Quét phụ đề');
      } else if (evt.event_type === 'pipeline_cancelled') {
        setIsScanning(false);
        setStatusMessage('Đã dừng tiến trình quét phụ đề');
        appLogger.warn('Đã dừng tiến trình quét phụ đề', 'Quét phụ đề');
        loadCues();
      }
    });

    return () => {
      unsub();
      if (localUrlRef.current) {
        URL.revokeObjectURL(localUrlRef.current);
      }
    };
  }, [checkHealth, loadProjects, loadCues]);

  // Polling tiến trình khi isScanning === true
  useEffect(() => {
    if (!isScanning || !activeProject) return;

    const interval = setInterval(async () => {
      try {
        const stages = await apiClient.getStages(activeProject.project_id);
        if (stages && stages.length > 0) {
          const latest = stages[stages.length - 1];
          if (latest.metrics?.label) {
            setStatusMessage(latest.metrics.label);
          }
          if (latest.stage_name === 'pipeline' && latest.status === 'completed') {
            setIsScanning(false);
            setStatusMessage(latest.metrics?.label || 'Đã hoàn tất quét và dịch phụ đề!');
            loadCues(activeProject.project_id);
          } else if (latest.status === 'failed') {
            setIsScanning(false);
            setErrorMessage(`Lỗi: ${latest.errors?.[0] || 'Quét phụ đề thất bại'}`);
          } else if (latest.status === 'cancelled') {
            setIsScanning(false);
            setStatusMessage('Đã dừng tiến trình quét phụ đề');
            appLogger.warn('Đã dừng tiến trình quét phụ đề', 'Quét phụ đề');
            loadCues(activeProject.project_id);
          }
        }
      } catch (err) {
        console.warn('Lỗi kiểm tra tiến trình stage:', err);
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
        handleUpdateRegion(res.region);
        setStatusMessage(`Đã bắt dính vùng chữ thành công! (${res.detected_count} vùng)`);
        appLogger.success(`Đã bắt dính vùng chữ thành công! (${res.detected_count} vùng)`, 'ROI');
      } else {
        appLogger.warn('Không phát hiện vùng chữ rõ ràng trên khung hình', 'ROI');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể tự động phát hiện vùng chữ');
      appLogger.error(err?.message || 'Không thể tự động phát hiện vùng chữ', 'ROI');
    }
  };

  // Khởi chạy quét phụ đề
  const handleStartScan = async () => {
    if (!activeProject && !localVideoFile) {
      setErrorMessage('Vui lòng chọn hoặc nạp một video trước khi chạy');
      appLogger.warn('Vui lòng chọn hoặc nạp một video trước khi chạy', 'Quét');
      return;
    }

    try {
      setIsScanning(true);
      setErrorMessage(null);

      if (activeProject) {
        setStatusMessage('Đang lưu vùng quét phụ đề vào dự án...');
        await apiClient.saveRegions(activeProject.project_id, regions);

        setStatusMessage('Đang khởi chạy tiến trình quét phụ đề trên máy chủ...');
        appLogger.info('Đang khởi chạy tiến trình quét phụ đề trên máy chủ...', 'Quét');
        await apiClient.runPipeline(activeProject.project_id);

        setStatusMessage('Tiến trình quét phụ đề đang thực thi...');
      } else if (localVideoFile) {
        setStatusMessage('Đang tải video lên máy chủ và khởi tạo dự án...');
        appLogger.info('Đang tải video lên máy chủ và khởi tạo dự án...', 'Quét');
        const uploadRes = await apiClient.uploadVideo(localVideoFile);
        const newProj = await apiClient.createProject({
          title: localVideoFile.name.replace(/\.[^/.]+$/, ''),
          source_video_path: uploadRes.path,
          source_language: sourceLang,
          target_language: targetLang,
        });

        await apiClient.saveRegions(newProj.project_id, regions);
        await apiClient.runPipeline(newProj.project_id);

        setActiveProject(newProj);
        setVideoUrl(apiClient.getVideoStreamUrl(newProj.project_id));
        loadProjects();
        setStatusMessage('Đã tạo dự án và bắt đầu quét phụ đề!');
        appLogger.success('Đã tạo dự án và bắt đầu quét phụ đề!', 'Quét');
      }
    } catch (err: any) {
      setIsScanning(false);
      setErrorMessage(err?.message || 'Có lỗi xảy ra khi bắt đầu quét phụ đề');
      appLogger.error(err?.message || 'Có lỗi xảy ra khi bắt đầu quét phụ đề', 'Quét');
    }
  };

  // Dừng / Hủy tiến trình quét phụ đề
  const handleStopScan = async () => {
    if (!activeProject) {
      setIsScanning(false);
      return;
    }
    try {
      setStatusMessage('Đang gửi yêu cầu dừng quét phụ đề...');
      appLogger.info('Đang gửi yêu cầu dừng quét phụ đề...', 'Quét');
      await apiClient.stopPipeline(activeProject.project_id);
      setIsScanning(false);
      setStatusMessage('Đã dừng tiến trình quét phụ đề theo yêu cầu');
      appLogger.warn('Đã dừng tiến trình quét phụ đề theo yêu cầu', 'Quét');
      loadCues(activeProject.project_id);
    } catch (err: any) {
      setIsScanning(false);
      appLogger.error(`Không thể dừng tiến trình: ${err?.message || 'Lỗi kết nối'}`, 'Quét');
    }
  };

  const handleResetTransform = () => {
    setVideoPosition({ x: 0, y: 0 });
    setIsFlippedH(false);
    setIsFlippedV(false);
    setRotation(0);
    setZoomLevel('fit');
    setAspectRatio('original');
    appLogger.info('Đã khôi phục khung nhìn về mặc định (Tâm 0,0, Fit, 0°, Không lật)', 'Hiển thị');
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 1. VIEW ROUTER: DOWNLOADER / QUEUE / DASHBOARD / STUDIO */}
      {/* ========================================================================= */}
      {viewMode === 'downloader' ? (
        <VideoDownloaderHub
          initialTab={downloaderTab}
          onTabChange={setDownloaderTab}
          onSwitchToDashboard={() => setViewMode('dashboard')}
          onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
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
        /* Hàng Đợi Tải Phim: Tích hợp DownloadQueueHub và VideoDownloaderHub */
        Boolean(false) ? (
          <DownloadQueueHub onSwitchToDashboard={() => setViewMode('dashboard')} />
        ) : (
          <VideoDownloaderHub
            initialTab={downloaderTab || 'queue'}
            onTabChange={setDownloaderTab}
            onSwitchToDashboard={() => setViewMode('dashboard')}
            onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
            onOpenSettings={() => {
              setSettingsTab('ocr');
              setViewMode('settings');
            }}
            onRefreshProjects={loadProjects}
            onBatchProjectsCreated={(newProjs) => {
              setProjects((prev) => [...prev, ...newProjs]);
            }}
          />
        )
      ) : viewMode === 'settings' ? (
        <GlobalSettingsView
          initialTab={settingsTab}
          onTabChange={setSettingsTab}
          presets={presets}
          onSavePresets={handleSavePresets}
          onSelectPreset={(p) => applyPresetProfile(p)}
          onSwitchToDashboard={() => setViewMode('dashboard')}
          onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
          onOpenDownloader={(tab) => {
            setDownloaderTab(tab || 'direct');
            setViewMode('downloader');
          }}
          onOpenQueue={() => {
            setDownloaderTab('queue');
            setViewMode('downloader');
          }}
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
            loggerCount={loggerCount}
            onToggleLogger={() => appLogger.toggle()}
            isScanning={isScanning}
            hasVideo={Boolean(videoUrl)}
            onStartScan={handleStartScan}
            onStopScan={handleStopScan}
            onOpenDownloader={() => {
              setDownloaderTab('direct');
              setViewMode('downloader');
            }}
            onOpenQueue={() => {
              setDownloaderTab('queue');
              setViewMode('downloader');
            }}
            onOpenSettings={() => {
              setSettingsTab('ocr');
              setViewMode('settings');
            }}
            onExportVideo={() => setIsExportModalOpen(true)}
            cuesCount={cues.length}
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
              onRefreshProject={loadProjects}
              selectedCueId={selectedCueId}
            />

            {/* Video Canvas ở Giữa: Khung Xem Cực Kỳ Thoáng Đãng */}
            <VideoPlayer
              videoUrl={videoUrl}
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
              fitMode={fitMode}
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
              isVideoVisible={isVideoVisible}
            />

            {/* Hộp Phải: Bảng Thuộc Tính & Inspector Chuẩn Premiere/CapCut */}
            <RightInspectorPanel
              regions={regions}
              activeRegionId={activeRegionId}
              onSelectRegion={setActiveRegionId}
              onAddRegion={handleAddRegion}
              onDeleteRegion={handleDeleteRegion}
              region={activeRoiRegion}
              onUpdateRegion={handleUpdateRegion}
              onAutoDetectRoi={handleAutoDetectRoi}
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
              onRefreshCues={loadCues}
              isScanning={isScanning}
              onStartScan={handleStartScan}
              onStopScan={handleStopScan}
            />
          </main>

          {/* Thanh dưới: Timeline NLE Nâng Cấp (Time Ruler + Playhead + Cột Track Khóa/Ẩn/Mute + Zoom Slider) */}
          <BottomTimeline
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
            onSelectCue={(cue) => {
              setSelectedCueId(cue.cue_id);
              setCurrentTime(cue.start_pts);
            }}
            onUpdateCueTime={handleUpdateCueTime}
            onSplitCue={handleSplitCue}
            onDeleteCue={handleDeleteCue}
            hasVoiceover={Boolean(
              activeProject?.has_voiceover ||
              (activeProject as any)?.voiceover_path ||
              (activeProject as any)?.status === 'completed'
            )}
            isAudioMuted={isAudioMuted}
            onToggleAudioMute={() => setIsAudioMuted((p) => !p)}
            isVideoVisible={isVideoVisible}
            onToggleVideoVisible={() => setIsVideoVisible((p) => !p)}
            isSubVisible={showSubtitleOverlay}
            onToggleSubVisible={() => setShowSubtitleOverlay((p) => !p)}
          />
        </>
      )}


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

      {/* Toast thông báo lỗi nổi tinh tế góc dưới */}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 bg-rose-950/95 border border-rose-800 text-rose-200 px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-3 text-xs animate-in slide-in-from-bottom-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white text-xs ml-2"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
