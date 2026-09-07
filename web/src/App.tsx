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
import { GlobalActivityLogger, appLogger, useAppLoggerCount } from './components/common/GlobalActivityLogger';
import { AlertCircle } from 'lucide-react';
import { extractDramaInfo } from './utils/drama';

const STUDIO_STORAGE_KEY = 'sub_studio_active_state_v1';

interface StoredStudioState {
  roiRegion?: RegionTrackV1;
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

  // Chế độ màn hình: Dashboard, Studio, Hàng Đợi, Trung Tâm Tải Video, hoặc Thiết Lập Hệ Thống
  const [viewMode, setViewMode] = useState<'dashboard' | 'studio' | 'queue' | 'downloader' | 'settings'>('dashboard');
  const [downloaderTab, setDownloaderTab] = useState<'search' | 'direct' | 'queue' | 'auth' | 'settings'>('search');
  const [settingsTab, setSettingsTab] = useState<'ocr' | 'translation' | 'dubbing' | 'render'>('ocr');

  // Quản lý Chuẩn Cấu Hình (Preset Profiles)
  const [presets, setPresets] = useState<PresetProfile[]>(() => getStoredPresets());
  const [activePresetId, setActivePresetId] = useState<string>(() => savedState?.activePresetId || getDefaultPreset().id);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);

  // Trạng thái lưu cấu hình toàn cục & thay đổi chưa lưu
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);

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

  // Vùng quét phụ đề (ROI)
  const [roiRegion, setRoiRegion] = useState<RegionTrackV1>(() => savedState?.roiRegion || {
    region_id: 'roi-main',
    x: 0.05,
    y: 0.70,
    width: 0.90,
    height: 0.26,
  });

  // Trạng thái biến đổi video và lớp phủ hiển thị
  const [videoPosition, setVideoPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [interactionMode, setInteractionMode] = useState<'video' | 'roi'>('video');
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

  // Trạng thái hệ thống và pipeline
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
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
      setRoiRegion({
        region_id: 'roi-main',
        x: preset.roi.x,
        y: preset.roi.y,
        width: preset.roi.width,
        height: preset.roi.height,
      });
    }
    setStatusMessage(`Đã áp dụng: ${preset.name}`);
    appLogger.success(`Đã áp dụng chuẩn: ${preset.name}`, 'Preset');
  };

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

  // Chọn dự án để xử lý video và chuyển sang giao diện Studio
  const selectProject = useCallback((proj: ProjectManifestV1) => {
    setActiveProject(proj);
    setLocalVideoFile(null);
    setSourceLang(proj.source_language || 'zh');
    setTargetLang(proj.target_language || 'vi');

    const drama = extractDramaInfo(proj.title, proj.source_video_path).dramaTitle;
    if (drama && drama !== 'Video đơn lẻ / Chưa phân loại') {
      setSelectedDramaTitle(drama);
    }

    const streamUrl = apiClient.getVideoStreamUrl(proj.project_id);
    setVideoUrl(streamUrl);

    loadCues(proj.project_id);

    if (proj.regions && proj.regions.length > 0) {
      setRoiRegion(proj.regions[0]);
    } else {
      const defPreset = getDefaultPreset(presets);
      if (defPreset?.roi) {
        setRoiRegion({
          region_id: 'roi-main',
          x: defPreset.roi.x,
          y: defPreset.roi.y,
          width: defPreset.roi.width,
          height: defPreset.roi.height,
        });
      }
    }

    setStatusMessage(`Đã nạp: ${proj.title}`);
    appLogger.info(`Đã nạp dự án: ${proj.title}`, 'Dự án');
    setViewMode('studio');
  }, [presets, loadCues]);

  // Nạp danh sách dự án từ Backend & tự động khôi phục dự án sau F5
  const loadProjects = useCallback(async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);

      // Tự động khôi phục lại tập phim đang mở nếu người dùng F5
      if (!activeProject && savedState?.activeProjectId) {
        const found = list.find((p) => p.project_id === savedState.activeProjectId);
        if (found) {
          selectProject(found);
        }
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách dự án:', err);
    }
  }, [activeProject, selectProject]);

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
      roiRegion,
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
    });
  }, [
    roiRegion,
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
  ]);

  // Lưu cấu hình toàn cục (Preset, LocalStorage & Pipeline Settings backend)
  const handleSaveGlobalConfig = async () => {
    setIsSavingConfig(true);
    try {
      // 1. Cập nhật và lưu Preset Profile hiện tại vào localStorage
      const currentPreset = presets.find((p) => p.id === activePresetId) || getDefaultPreset(presets);
      const updatedPreset: PresetProfile = {
        ...currentPreset,
        roi: {
          x: roiRegion.x,
          y: roiRegion.y,
          width: roiRegion.width,
          height: roiRegion.height,
        },
        mask_style: maskStyle,
        blur_strength: blurStrength,
        subtitle_placement: subtitlePlacement,
        aspect_ratio: aspectRatio,
        fit_mode: fitMode,
        zoom_level: zoomLevel,
        is_flipped_h: isFlippedH,
        is_flipped_v: isFlippedV,
        show_subtitle_overlay: showSubtitleOverlay,
        source_lang: sourceLang,
        target_lang: targetLang,
      };

      const nextPresets = presets.map((p) => (p.id === updatedPreset.id ? updatedPreset : p));
      handleSavePresets(nextPresets);

      // 2. Lưu trạng thái snapshot tức thì vào localStorage
      saveStudioActiveState({
        roiRegion,
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
      });

      // 3. Đồng bộ xuống backend pipeline settings
      try {
        const currentPipe = await apiClient.getPipelineSettings();
        if (currentPipe) {
          const updatedPipe = {
            ...currentPipe,
            render: {
              ...currentPipe.render,
              default_mask_style: maskStyle,
              default_blur_strength: blurStrength,
            },
            translation: {
              ...currentPipe.translation,
              target_language: (['zh', 'en', 'vi', 'none'].includes(targetLang) ? (targetLang as any) : 'vi'),
            },
          };
          await apiClient.savePipelineSettings(updatedPipe);
        }
      } catch (pipeErr) {
        console.warn('Không thể đồng bộ pipeline settings xuống backend:', pipeErr);
      }

      // 4. Nếu có activeProject, lưu ROI vào project settings trên backend
      if (activeProject) {
        try {
          await apiClient.saveProjectSettings(activeProject.project_id, {
            roi: roiRegion,
            aspect_ratio: aspectRatio,
          } as any);
        } catch {
          // Ignore
        }
      }

      setStatusMessage('✓ Đã lưu cấu hình toàn cục thành công! (Không mất khi F5)');
      appLogger.success('Đã lưu cấu hình toàn cục thành công (giữ nguyên khi F5)', 'Cấu hình');
      setHasUnsavedChanges(false);
    } catch (err: any) {
      console.error('Lỗi khi lưu cấu hình:', err);
      appLogger.error(`Lỗi lưu cấu hình: ${err?.message || 'Thất bại'}`, 'Cấu hình');
    } finally {
      setIsSavingConfig(false);
    }
  };

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
        setRoiRegion(res.region);
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
        await apiClient.saveRegions(activeProject.project_id, [roiRegion]);

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

        await apiClient.saveRegions(newProj.project_id, [roiRegion]);
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
          onSwitchToDashboard={() => setViewMode('dashboard')}
          onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
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
            initialTab="queue"
            onSwitchToDashboard={() => setViewMode('dashboard')}
            onSwitchToStudio={activeProject ? () => setViewMode('studio') : undefined}
            onRefreshProjects={loadProjects}
            onBatchProjectsCreated={(newProjs) => {
              setProjects((prev) => [...prev, ...newProjs]);
            }}
          />
        )
      ) : viewMode === 'settings' ? (
        <GlobalSettingsView
          initialTab={settingsTab}
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
            onSaveGlobalConfig={handleSaveGlobalConfig}
            isSavingConfig={isSavingConfig}
            hasUnsavedChanges={hasUnsavedChanges}
            statusMessage={statusMessage}
            backendOnline={backendOnline}
            wsConnected={wsConnected}
            loggerCount={loggerCount}
            onToggleLogger={() => appLogger.toggle()}
            isScanning={isScanning}
            hasVideo={Boolean(videoUrl)}
            onStartScan={handleStartScan}
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
            cuesCount={cues.length}
          />

          {/* 2. Vùng Làm Việc 3-Panel: Hộp Trái + Video ở Giữa + Hộp Phải Inspector */}
          <main className="flex-1 min-h-0 min-w-0 flex flex-row relative overflow-hidden">
            {/* Hộp Trái: Danh Sách Phụ Đề & Quản Lý Tập Phim */}
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
            />

            {/* Video Canvas ở Giữa: Khung Xem Cực Kỳ Thoáng Đãng */}
            <VideoPlayer
              videoUrl={videoUrl}
              region={roiRegion}
              currentTime={currentTime}
              isPlaying={isPlaying}
              onTimeUpdate={(t) => setCurrentTime(t)}
              onDurationChange={(d) => setDuration(d)}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              onUpdateRegion={(r) => setRoiRegion(r)}
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
                appLogger.info(`Zoom: ${z === 'fit' ? 'Fit (Vừa vặn)' : `${Math.round(z * 100)}%`}`, 'Hiển thị');
              }}
              previewMask={previewMask}
              maskStyle={maskStyle}
              blurStrength={blurStrength}
              showSubtitleOverlay={showSubtitleOverlay}
              subtitlePlacement={subtitlePlacement}
              videoPosition={videoPosition}
              onPositionChange={setVideoPosition}
              interactionMode={interactionMode}
              onInteractionModeChange={setInteractionMode}
            />

            {/* Hộp Phải: Bảng Thuộc Tính & Inspector Chuẩn Premiere/CapCut */}
            <RightInspectorPanel
              region={roiRegion}
              onUpdateRegion={(r) => setRoiRegion(r)}
              onAutoDetectRoi={handleAutoDetectRoi}
              sourceLang={sourceLang}
              targetLang={targetLang}
              onLanguageChange={(s, t) => {
                setSourceLang(s);
                setTargetLang(t);
              }}
              previewMask={previewMask}
              onTogglePreviewMask={() => {
                setPreviewMask((prev) => {
                  const next = !prev;
                  appLogger.info(next ? 'Bật chế độ che phụ đề gốc' : 'Tắt chế độ che phụ đề gốc', 'Che sub');
                  return next;
                });
              }}
              maskStyle={maskStyle}
              onMaskStyleChange={(st) => {
                setMaskStyle(st);
                appLogger.info(`Kiểu che phụ đề: ${st}`, 'Che sub');
              }}
              blurStrength={blurStrength}
              onBlurStrengthChange={setBlurStrength}
              showSubtitleOverlay={showSubtitleOverlay}
              onToggleSubtitleOverlay={() => {
                setShowSubtitleOverlay((prev) => {
                  const next = !prev;
                  appLogger.info(next ? 'Bật hiển thị phụ đề dịch' : 'Tắt hiển thị phụ đề dịch', 'Phụ đề');
                  return next;
                });
              }}
              subtitlePlacement={subtitlePlacement}
              onSubtitlePlacementChange={(p) => {
                setSubtitlePlacement(p);
                appLogger.info(`Vị trí phụ đề: ${p === 'bottom' ? 'Đáy video (chuẩn điện ảnh)' : 'Vùng quét (đè chữ gốc)'}`, 'Phụ đề');
              }}
              aspectRatio={aspectRatio}
              onAspectRatioChange={(r) => {
                setAspectRatio(r);
                appLogger.info(`Đổi tỉ lệ khung hình: ${r}`, 'Canvas');
              }}
              fitMode={fitMode}
              onToggleFitMode={() => {
                setFitMode((m) => {
                  const next = m === 'contain' ? 'cover' : 'contain';
                  appLogger.info(`Chế độ khung hình: ${next === 'cover' ? 'Fill (Tràn viền)' : 'Fit (Đệm chuẩn)'}`, 'Canvas');
                  return next;
                });
              }}
              isFlippedH={isFlippedH}
              onToggleFlipH={() => {
                setIsFlippedH((prev) => {
                  const next = !prev;
                  appLogger.info(next ? 'Lật ngang video: BẬT' : 'Lật ngang video: TẮT', 'Hiển thị');
                  return next;
                });
              }}
              isFlippedV={isFlippedV}
              onToggleFlipV={() => {
                setIsFlippedV((prev) => {
                  const next = !prev;
                  appLogger.info(next ? 'Lật dọc video: BẬT' : 'Lật dọc video: TẮT', 'Hiển thị');
                  return next;
                });
              }}
              rotation={rotation}
              onRotate={() => {
                const next = normalizeRotation(rotation + 90);
                setRotation(next);
                appLogger.info(`Xoay nhanh video: ${next}°`, 'Hiển thị');
              }}
              onRotationChange={(deg) => {
                const next = normalizeRotation(deg);
                setRotation(next);
              }}
              videoPosition={videoPosition}
              onPositionChange={setVideoPosition}
              onResetTransform={handleResetTransform}
              activeProject={activeProject}
              onRefreshCues={loadCues}
              isScanning={isScanning}
              onStartScan={handleStartScan}
              onSaveGlobalConfig={handleSaveGlobalConfig}
              isSavingConfig={isSavingConfig}
              hasUnsavedChanges={hasUnsavedChanges}
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
            onSelectCue={(cue) => setCurrentTime(cue.start_pts)}
          />
        </>
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
