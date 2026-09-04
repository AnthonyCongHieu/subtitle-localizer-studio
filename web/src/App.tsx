import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from './api/client';
import { wsClient } from './api/websocket';
import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1, BridgeEventV1 } from './types/api';
import { VideoPlayer } from './components/player/VideoPlayer';
import { BottomTimeline } from './components/timeline/BottomTimeline';
import { CapcutSidebar } from './components/sidebar/CapcutSidebar';
import { ZoomMode } from './components/player/ViewerToolbar';
import {
  Layers,
  CheckCircle2,
  XCircle,
  Play,
  Sparkles,
  FolderOpen,
  Loader2,
  AlertCircle,
} from 'lucide-react';

export const App: React.FC = () => {
  // Trạng thái dự án và video hiện tại
  const [projects, setProjects] = useState<ProjectManifestV1[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifestV1 | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [cues, setCues] = useState<SubtitleCueV1[]>([]);
  const [sourceLang, setSourceLang] = useState<string>('zh');
  const [targetLang, setTargetLang] = useState<string>('vi');

  // Vùng quét phụ đề (ROI)
  const [roiRegion, setRoiRegion] = useState<RegionTrackV1>({
    region_id: 'roi-main',
    x: 0.08,
    y: 0.82,
    width: 0.84,
    height: 0.13,
  });

  // Trạng thái biến đổi video và lớp phủ hiển thị
  const [isFlippedH, setIsFlippedH] = useState<boolean>(false);
  const [isFlippedV, setIsFlippedV] = useState<boolean>(false);
  const [rotation, setRotation] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<ZoomMode>('fit');
  const [previewMask, setPreviewMask] = useState<boolean>(false);
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
        setStatusMessage(`Đã lưu câu phụ đề thành công!`);
      } catch (err) {
        console.error('Không thể lưu phụ đề xuống server:', err);
      }
    }
  };

  // Nạp danh sách dự án từ Backend
  const loadProjects = useCallback(async () => {
    try {
      const list = await apiClient.listProjects();
      setProjects(list);

      if (list.length > 0 && !activeProject) {
        selectProject(list[0]);
      }
    } catch (err: any) {
      console.error('Lỗi khi tải danh sách dự án:', err);
    }
  }, [activeProject]);

  // Chọn dự án để xử lý video
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
      setRoiRegion({
        region_id: 'roi-main',
        x: 0.08,
        y: 0.82,
        width: 0.84,
        height: 0.13,
      });
    }

    setStatusMessage(`Đã nạp: ${proj.title}`);
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
      } else if (evt.event_type === 'stage_completed') {
        setStatusMessage(`Hoàn thành: ${evt.payload?.stage_name || 'Tiến trình'}`);
      } else if (evt.event_type === 'pipeline_completed') {
        setIsScanning(false);
        setStatusMessage('Đã hoàn thành quét phụ đề toàn bộ video!');
        loadCues();
      } else if (evt.event_type === 'pipeline_failed') {
        setIsScanning(false);
        setErrorMessage(`Lỗi quét: ${evt.payload?.error || 'Không xác định'}`);
      }
    });

    return () => {
      unsub();
      if (localUrlRef.current) {
        URL.revokeObjectURL(localUrlRef.current);
      }
    };
  }, [checkHealth, loadProjects, loadCues]);

  // Polling tiến trình khi isScanning === true để hiển thị % và số frame thời gian thực
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
      return;
    }
    try {
      setStatusMessage('Đang phân tích khung hình để bắt dính vị trí chữ...');
      const res = await apiClient.autoDetectRoi(activeProject.project_id, currentTime);
      if (res.region) {
        setRoiRegion(res.region);
        setStatusMessage(`Đã bắt dính vùng chữ thành công! (${res.detected_count} vùng)`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Không thể tự động phát hiện vùng chữ');
    }
  };

  // Khởi chạy quét phụ đề
  const handleStartScan = async () => {
    if (!activeProject && !localVideoFile) {
      setErrorMessage('Vui lòng chọn hoặc nạp một video trước khi chạy');
      return;
    }

    try {
      setIsScanning(true);
      setErrorMessage(null);

      if (activeProject) {
        setStatusMessage('Đang lưu vùng quét phụ đề vào dự án...');
        await apiClient.saveRegions(activeProject.project_id, [roiRegion]);

        setStatusMessage('Đang khởi chạy tiến trình quét phụ đề trên máy chủ...');
        await apiClient.runPipeline(activeProject.project_id);

        setStatusMessage('Tiến trình quét phụ đề đang thực thi...');
      } else if (localVideoFile) {
        setStatusMessage('Đang tải video lên máy chủ và khởi tạo dự án...');
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
      }
    } catch (err: any) {
      setIsScanning(false);
      setErrorMessage(err?.message || 'Có lỗi xảy ra khi bắt đầu quét phụ đề');
    }
  };

  const handleResetTransform = () => {
    setIsFlippedH(false);
    setIsFlippedV(false);
    setRotation(0);
    setZoomLevel('fit');
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden select-none">
      {/* 1. Header Studio Chuẩn NLE (44px cố định, phẳng, tinh tế) */}
      <header className="h-11 shrink-0 border-b border-slate-800/80 bg-slate-900/95 backdrop-blur px-4 flex items-center justify-between z-50">
        {/* Trái: Logo + Bộ chọn Dự án */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-600/20 border border-indigo-500/30 rounded-md text-indigo-400">
              <Layers className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold text-white tracking-wide uppercase">
              Subtitle Studio
            </span>
          </div>

          <div className="h-4 w-px bg-slate-800" />

          {/* Chọn dự án dạng Pill */}
          {projects.length > 0 && (
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-md text-xs">
              <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <select
                value={activeProject?.project_id || ''}
                onChange={(e) => {
                  const p = projects.find((x) => x.project_id === e.target.value);
                  if (p) selectProject(p);
                }}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer max-w-[180px] sm:max-w-[240px] truncate text-[11px]"
              >
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id} className="bg-slate-900 text-slate-200">
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dòng trạng thái tích hợp tinh tế (thay cho banner tím to tướng) */}
          {statusMessage && (
            <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-2.5 py-0.5 rounded-full animate-in fade-in">
              <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="max-w-[260px] truncate">{statusMessage}</span>
            </div>
          )}
        </div>

        {/* Phải: Trạng thái Backend & Nút Bắt đầu Quét */}
        <div className="flex items-center gap-3">
          {/* Trạng thái Backend & Realtime */}
          <div className="hidden sm:flex items-center gap-2.5 text-[11px] bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
            <div className="flex items-center gap-1.5">
              {backendOnline ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              ) : (
                <XCircle className="w-3 h-3 text-rose-500" />
              )}
              <span className="text-slate-400">Server</span>
            </div>

            <span className="text-slate-700">|</span>

            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <span className="text-slate-400">Live</span>
            </div>
          </div>

          {/* Nút hành động chính: Bắt đầu quét */}
          <button
            onClick={handleStartScan}
            disabled={isScanning || !videoUrl}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow transition disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* 2. Vùng trung tâm: Sidebar CapCut bên trái + Video Player trung tâm */}
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
          isFlippedH={isFlippedH}
          onToggleFlipH={() => setIsFlippedH((prev) => !prev)}
          isFlippedV={isFlippedV}
          onToggleFlipV={() => setIsFlippedV((prev) => !prev)}
          rotation={rotation}
          onRotate={() => setRotation((prev) => (prev + 90) % 360)}
          zoomLevel={zoomLevel}
          onZoomChange={(z) => setZoomLevel(z)}
          onResetTransform={handleResetTransform}
          previewMask={previewMask}
          onTogglePreviewMask={() => setPreviewMask((prev) => !prev)}
          showSubtitleOverlay={showSubtitleOverlay}
          onToggleSubtitleOverlay={() => setShowSubtitleOverlay((prev) => !prev)}
        />
      </main>

      {/* 3. Thanh dưới: Timeline NLE với cột Track Header (Filmstrip + Waveform + Scrubber) */}
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
      />

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
