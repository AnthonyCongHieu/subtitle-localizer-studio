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
import { CapcutSidebar } from './components/sidebar/CapcutSidebar';
import { DashboardBatchHub } from './components/project/DashboardBatchHub';
import { PresetManagerModal } from './components/project/PresetManagerModal';
import { NewProjectModal } from './components/project/NewProjectModal';
import { DownloadQueueHub } from './components/project/DownloadQueueHub';
import { VideoDownloaderHub } from './components/project/VideoDownloaderHub';
import { GlobalActivityLogger, appLogger, useAppLoggerCount } from './components/common/GlobalActivityLogger';
import {
  Layers,
  CheckCircle2,
  XCircle,
  Play,
  Sparkles,
  FolderOpen,
  Loader2,
  AlertCircle,
  LayoutDashboard,
  ChevronLeft,
  Sliders,
  Ratio,
  ListPlus,
  Download,
  Activity,
} from 'lucide-react';

export const App: React.FC = () => {
  const loggerCount = useAppLoggerCount();
  // Chế độ màn hình: Màn hình Ngoài (Dashboard), Giao diện Studio, Hàng Đợi, hoặc Trung Tâm Tải Video
  const [viewMode, setViewMode] = useState<'dashboard' | 'studio' | 'queue' | 'downloader'>('dashboard');
  const [downloaderTab, setDownloaderTab] = useState<'search' | 'direct' | 'queue' | 'auth' | 'settings'>('search');

  // Quản lý Chuẩn Cấu Hình (Preset Profiles)
  const [presets, setPresets] = useState<PresetProfile[]>(() => getStoredPresets());
  const [activePresetId, setActivePresetId] = useState<string>(() => getDefaultPreset().id);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState<boolean>(false);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);

  // Trạng thái dự án và video hiện tại
  const [projects, setProjects] = useState<ProjectManifestV1[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifestV1 | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [cues, setCues] = useState<SubtitleCueV1[]>([]);
  const [sourceLang, setSourceLang] = useState<string>('zh');
  const [targetLang, setTargetLang] = useState<string>('vi');

  // Tỉ lệ khung hình (Aspect Ratio) & Fit Mode
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('original');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');

  // Vùng quét phụ đề (ROI)
  const [roiRegion, setRoiRegion] = useState<RegionTrackV1>({
    region_id: 'roi-main',
    x: 0.05,
    y: 0.70,
    width: 0.90,
    height: 0.26,
  });

  // Trạng thái biến đổi video và lớp phủ hiển thị
  const [isFlippedH, setIsFlippedH] = useState<boolean>(false);
  const [isFlippedV, setIsFlippedV] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<ZoomMode>('fit');
  const [previewMask, setPreviewMask] = useState<boolean>(false);
  const [maskStyle, setMaskStyle] = useState<MaskStyleType>('feather_tight');
  const [blurStrength, setBlurStrength] = useState<number>(20);
  const [subtitlePlacement, setSubtitlePlacement] = useState<SubtitlePlacementMode>('roi');
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

  // Nạp danh sách dự án từ Backend
  const loadProjects = useCallback(async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách dự án:', err);
    }
  }, []);

  // Chọn dự án để xử lý video và chuyển sang giao diện Studio
  const selectProject = (proj: ProjectManifestV1) => {
    setActiveProject(proj);
    setLocalVideoFile(null);
    setSourceLang(proj.source_language || 'zh');
    setTargetLang(proj.target_language || 'vi');

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
  };

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
    setIsFlippedH(false);
    setIsFlippedV(false);
    setRotation(0);
    setZoomLevel('fit');
    setAspectRatio('original');
    appLogger.info('Đã khôi phục khung nhìn về mặc định (Fit, 0°, Không lật)', 'Hiển thị');
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
      ) : viewMode === 'dashboard' ? (
        <DashboardBatchHub
          projects={projects}
          presets={presets}
          onSelectProject={selectProject}
          onNewProject={() => setIsNewProjectModalOpen(true)}
          onDeleteProject={handleDeleteProject}
          onOpenPresetManager={() => setIsPresetModalOpen(true)}
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
        />
      ) : (
        /* ========================================================================= */
        /* 2. GIAO DIỆN STUDIO */
        /* ========================================================================= */
        <>
          {/* Header Studio Chuẩn NLE Có Nút "Quay Lại Dashboard" Nổi Bật */}
          <header className="h-12 shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-4 flex items-center justify-between z-50">
            {/* Trái: Nút Quay Lại Dashboard + Logo + Bộ Chọn Dự Án & Chuẩn Nhanh */}
            <div className="flex items-center gap-3">
              {/* Nút Quay Lại Dashboard */}
              <button
                onClick={() => setViewMode('dashboard')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-semibold shadow transition active:scale-95"
                title="Quay lại Dashboard"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </button>

              {/* Nút Trung Tâm Tải Video */}
              <button
                onClick={() => {
                  setDownloaderTab('direct');
                  setViewMode('downloader');
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 text-xs font-semibold shadow transition active:scale-95"
                title="Tải video từ liên kết (Hồng Quả, YouTube, XHS...)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải Video</span>
              </button>

              {/* Nút Hàng Đợi Tải Phim */}
              <button
                onClick={() => {
                  setDownloaderTab('queue');
                  setViewMode('downloader');
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold shadow transition active:scale-95"
                title="Mở Trang Quản Lý Hàng Đợi Tải Phim"
              >
                <ListPlus className="w-3.5 h-3.5 text-indigo-400" />
                <span>Hàng Đợi</span>
              </button>

              <div className="h-4 w-px bg-slate-800" />

              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-600/20 border border-indigo-500/30 rounded text-indigo-400">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-bold text-white tracking-wide uppercase hidden sm:inline">
                  Studio
                </span>
              </div>

              <div className="h-4 w-px bg-slate-800" />

              {/* Chọn dự án dạng Pill */}
              {projects.length > 0 && (
                <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md text-xs">
                  <FolderOpen className="w-3 h-3 text-indigo-400 shrink-0" />
                  <select
                    value={activeProject?.project_id || ''}
                    onChange={(e) => {
                      const p = projects.find((x) => x.project_id === e.target.value);
                      if (p) selectProject(p);
                    }}
                    className="bg-transparent text-slate-200 focus:outline-none cursor-pointer max-w-[140px] sm:max-w-[200px] truncate text-[11px]"
                  >
                    {projects.map((p) => (
                      <option key={p.project_id} value={p.project_id} className="bg-slate-900 text-slate-200">
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Bộ Chọn Chuẩn Preset Nhanh Trong Studio */}
              <div className="hidden md:flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md text-xs">
                <Sliders className="w-3 h-3 text-amber-400 shrink-0" />
                <select
                  value={activePresetId}
                  onChange={(e) => {
                    const chosen = presets.find((x) => x.id === e.target.value);
                    if (chosen) applyPresetProfile(chosen);
                  }}
                  className="bg-transparent text-amber-300 font-medium focus:outline-none cursor-pointer max-w-[160px] truncate text-[11px]"
                  title="Đổi nhanh Chuẩn cấu hình áp dụng cho video này"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dòng trạng thái tích hợp tinh tế */}
              {statusMessage && (
                <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-2.5 py-0.5 rounded-full animate-in fade-in">
                  <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span className="max-w-[220px] truncate">{statusMessage}</span>
                </div>
              )}
            </div>

            {/* Phải: Trạng thái Backend, Nhật ký & Nút Bắt đầu Quét */}
            <div className="flex items-center gap-2.5">
              {/* Menu Tỉ Lệ Khung Hình Nhanh Trên Header */}
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-md text-xs">
                <Ratio className="w-3 h-3 text-indigo-400 shrink-0" />
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatioType)}
                  className="bg-transparent text-slate-300 font-mono text-[10px] focus:outline-none cursor-pointer"
                  title="Tỉ lệ khung hình Canvas"
                >
                  <option value="original" className="bg-slate-900">Gốc</option>
                  <option value="16:9" className="bg-slate-900">16:9</option>
                  <option value="9:16" className="bg-slate-900">9:16 (TikTok)</option>
                  <option value="1:1" className="bg-slate-900">1:1 (Vuông)</option>
                  <option value="4:3" className="bg-slate-900">4:3</option>
                  <option value="2.35:1" className="bg-slate-900">2.35:1</option>
                </select>
              </div>

              {/* Trạng thái Server */}
              <div className="hidden sm:flex items-center gap-2 text-[11px] bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                <div className="flex items-center gap-1">
                  {backendOnline ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3 h-3 text-rose-500" />
                  )}
                  <span className="text-slate-400">Server</span>
                </div>

                <span className="text-slate-700">|</span>

                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                  <span className="text-slate-400">Live</span>
                </div>
              </div>

              {/* Nút Mở Nhật Ký Hoạt Động */}
              <button
                onClick={() => appLogger.toggle()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer shadow-sm"
                title="Nhật ký hoạt động hệ thống"
              >
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Nhật ký</span>
                {loggerCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-cyan-300 border border-slate-700 font-mono font-bold">
                    {loggerCount}
                  </span>
                )}
              </button>

              {/* Nút hành động chính: Bắt đầu quét */}
              <button
                onClick={handleStartScan}
                disabled={isScanning || !videoUrl}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang Quét...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Quét Phụ Đề</span>
                  </>
                )}
              </button>
            </div>
          </header>

          {/* Vùng trung tâm: Sidebar CapCut bên trái + Video Player trung tâm */}
          <main className="flex-1 min-h-0 min-w-0 flex flex-row relative overflow-hidden">
            <CapcutSidebar
              projects={projects}
              activeProject={activeProject}
              onSelectProject={selectProject}
              onPickLocalVideo={handlePickLocalVideo}
              region={roiRegion}
              onUpdateRegion={(r) => setRoiRegion(r)}
              onAutoDetectRoi={handleAutoDetectRoi}
              cues={cues}
              onRefreshCues={loadCues}
              onSeekToCue={(pts) => setCurrentTime(pts)}
              onUpdateCue={handleUpdateCue}
              sourceLang={sourceLang}
              targetLang={targetLang}
              onLanguageChange={(s, t) => {
                setSourceLang(s);
                setTargetLang(t);
              }}
              isFlippedH={isFlippedH}
              isFlippedV={isFlippedV}

              aspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
            />

            <VideoPlayer
              videoUrl={videoUrl}
              videoTitle={activeProject?.title || localVideoFile?.name}
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
              zoomLevel={zoomLevel}
              onZoomChange={(z) => {
                setZoomLevel(z);
                appLogger.info(`Zoom: ${z === 'fit' ? 'Fit (Vừa vặn)' : `${Math.round(z * 100)}%`}`, 'Hiển thị');
              }}
              onResetTransform={handleResetTransform}
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

      {/* Modal Quản Lý Chuẩn (Preset Manager) */}
      <PresetManagerModal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        presets={presets}
        onSavePresets={handleSavePresets}
        onSelectPreset={(p) => applyPresetProfile(p)}
      />

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
