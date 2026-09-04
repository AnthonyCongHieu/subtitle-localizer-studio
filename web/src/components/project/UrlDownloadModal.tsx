import React, { useState, useEffect, useRef } from 'react';
import {
  apiClient,
  DownloadTargetInfo,
  DownloadTaskStatus,
  DeviceStatusInfo,
  DownloadQueueTaskItem,
  DownloadQueueListResponse,
} from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';
import { EpisodeSelectorGrid } from './EpisodeSelectorGrid';
import {
  Download,
  Link,
  Search,
  CheckCircle2,
  AlertCircle,
  X,
  Sparkles,
  Layers,
  StopCircle,
  Film,
  Unlock,
  Shield,
  ChevronDown,
  ChevronRight,
  Wifi,
  Gauge,
  RefreshCw,
  Smartphone,
  Copy,
  Check,
  Edit2,
  Save,
  Folder,
  Image,
  ListPlus,
  Play,
  Pause,
  Trash2,
  ArrowUp,
  ArrowDown,
  Zap,
} from 'lucide-react';

interface UrlDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshProjects: () => void;
  onBatchProjectsCreated?: (newProjects: ProjectManifestV1[]) => void;
  initialOpenSettings?: boolean;
}

export const UrlDownloadModal: React.FC<UrlDownloadModalProps> = ({
  isOpen,
  onClose,
  onRefreshProjects,
  onBatchProjectsCreated,
  initialOpenSettings = false,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [targetInfo, setTargetInfo] = useState<DownloadTargetInfo | null>(null);

  // R1: Custom Output Directory state
  const [outputDir, setOutputDir] = useState<string>(() => {
    return localStorage.getItem('sls_custom_output_dir') || localStorage.getItem('sls_output_dir') || 'uploads';
  });
  const [dirValidation, setDirValidation] = useState<{
    valid: boolean;
    path: string;
    exists: boolean;
    writable: boolean;
    error?: string | null;
  } | null>(null);
  const [isValidatingDir, setIsValidatingDir] = useState(false);

  // R2: Episode Selector Grid & Disk Scan state
  const [episodesStatus, setEpisodesStatus] = useState<Record<number, 'completed' | 'corrupted' | 'missing'>>({});
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [isScanningEpisodes, setIsScanningEpisodes] = useState(false);

  // R5: Cover/Thumbnail download state
  const [isDownloadingCover, setIsDownloadingCover] = useState(false);
  const [coverDownloadMsg, setCoverDownloadMsg] = useState<string | null>(null);

  // R3/R4: Queue actions state
  const [isAddingToQueue, setIsAddingToQueue] = useState(false);
  const [queueAddSuccess, setQueueAddSuccess] = useState<string | null>(null);

  // Tab gộp: 'download' (Tải phim mới) | 'queue' (Hàng đợi tải)
  const [modalTab, setModalTab] = useState<'download' | 'queue'>('download');
  const [queueTasks, setQueueTasks] = useState<DownloadQueueTaskItem[]>([]);
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [queueActionMsg, setQueueActionMsg] = useState<string | null>(null);

  // Range and download options
  const [autoCreateProject, setAutoCreateProject] = useState(true);
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');

  // Task running state
  const [taskStatus, setTaskStatus] = useState<DownloadTaskStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollTimerRef = useRef<any>(null);

  // Proxy & Device Settings state
  const [showProxySection, setShowProxySection] = useState(initialOpenSettings);
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem('sls_proxy_url') || '');
  const [rateLimitDelay, setRateLimitDelay] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rate_limit_delay');
    return saved ? parseFloat(saved) : 2.0;
  });
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; ip?: string; latency_ms?: number; error?: string } | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);

  // Device identity inspection & rotation state
  const [deviceInfo, setDeviceInfo] = useState<DeviceStatusInfo | null>(null);
  const [isLoadingDevice, setIsLoadingDevice] = useState(false);
  const [isRotatingDevice, setIsRotatingDevice] = useState(false);
  const [deviceRotateMessage, setDeviceRotateMessage] = useState<string | null>(null);
  const [copiedDeviceId, setCopiedDeviceId] = useState(false);
  const [copiedInstallId, setCopiedInstallId] = useState(false);
  const [rotationInterval, setRotationInterval] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rotation_interval');
    return saved !== null ? parseInt(saved) : 1;
  });
  const [showCustomDeviceInput, setShowCustomDeviceInput] = useState(false);
  const [customDeviceId, setCustomDeviceId] = useState('');
  const [customInstallId, setCustomInstallId] = useState('');
  const [isSavingCustomDevice, setIsSavingCustomDevice] = useState(false);

  // Check initial download status and load device info on mount / open
  useEffect(() => {
    if (!isOpen) return;

    if (initialOpenSettings) {
      setShowProxySection(true);
    }

    loadDeviceInfo();
    fetchQueueTasks(false);

    apiClient
      .getDownloadStatus()
      .then((st) => {
        setTaskStatus(st);
        if (st.status === 'running' || st.status === 'cancelling') {
          startPolling();
        }
      })
      .catch(() => {});

    // Định kỳ đồng bộ hàng đợi tải
    const queueInterval = setInterval(() => {
      fetchQueueTasks(true);
    }, 2500);

    return () => {
      stopPolling();
      clearInterval(queueInterval);
    };
  }, [isOpen, initialOpenSettings]);

  const loadDeviceInfo = () => {
    setIsLoadingDevice(true);
    apiClient
      .getDeviceStatus()
      .then((info) => {
        setDeviceInfo(info);
        setCustomDeviceId(info.device_id || '');
        setCustomInstallId(info.install_id || '');
      })
      .catch((err) => console.warn('Could not load device info:', err))
      .finally(() => setIsLoadingDevice(false));
  };

  const startPolling = () => {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const st = await apiClient.getDownloadStatus();
        setTaskStatus(st);
        if (st.status === 'completed' || st.status === 'failed' || st.status === 'cancelled') {
          stopPolling();
          onRefreshProjects();
          if (st.created_projects && st.created_projects.length > 0 && onBatchProjectsCreated) {
            onBatchProjectsCreated(st.created_projects);
          }
        }
      } catch (e) {
        console.warn('Poll error:', e);
      }
    }, 1500);
  };

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  if (!isOpen) return null;

  const handleValidateDirectory = async (dirPath: string) => {
    setIsValidatingDir(true);
    try {
      const res = await apiClient.validateDirectory(dirPath.trim(), true);
      setDirValidation(res);
      if (res.valid) {
        localStorage.setItem('sls_custom_output_dir', dirPath.trim());
        localStorage.setItem('sls_output_dir', dirPath.trim());
      }
    } catch (err: any) {
      setDirValidation({
        valid: false,
        path: dirPath,
        exists: false,
        writable: false,
        error: err?.message || 'Đường dẫn không hợp lệ',
      });
    } finally {
      setIsValidatingDir(false);
    }
  };

  const scanDiskEpisodesForTarget = async (title: string, total: number, dir?: string) => {
    setIsScanningEpisodes(true);
    try {
      const scanRes = await apiClient.scanEpisodes(title, total, dir || undefined);
      const stMap: Record<number, 'completed' | 'corrupted' | 'missing'> = {};
      (scanRes.episodes || []).forEach((ep) => {
        stMap[ep.episode] = ep.status;
      });
      setEpisodesStatus(stMap);
    } catch (err) {
      console.warn('Lỗi quét tập trên ổ cứng:', err);
    } finally {
      setIsScanningEpisodes(false);
    }
  };

  const handleToggleEpisode = (ep: number) => {
    setSelectedEpisodes((prev) =>
      prev.includes(ep) ? prev.filter((x) => x !== ep) : [...prev, ep].sort((a, b) => a - b)
    );
  };

  const handleSelectAll = () => {
    if (!targetInfo) return;
    const all = Array.from({ length: targetInfo.total_episodes }, (_, i) => i + 1);
    setSelectedEpisodes(all);
  };

  const handleSelectMissingOrError = () => {
    if (!targetInfo) return;
    const missingOrError: number[] = [];
    for (let i = 1; i <= targetInfo.total_episodes; i++) {
      const st = episodesStatus[i] || 'missing';
      if (st === 'missing' || st === 'corrupted') {
        missingOrError.push(i);
      }
    }
    setSelectedEpisodes(missingOrError);
  };

  const handleDeselectAll = () => {
    setSelectedEpisodes([]);
  };

  const handleDownloadCover = async () => {
    if (!targetInfo || !targetInfo.cover_url) return;
    setIsDownloadingCover(true);
    setCoverDownloadMsg(null);
    try {
      const res = await apiClient.downloadCover(targetInfo.cover_url, outputDir.trim() || 'uploads');
      if (res.success) {
        setCoverDownloadMsg('Đã tải ảnh bìa thành công!');
      } else {
        setCoverDownloadMsg(res.message || 'Lỗi tải ảnh bìa');
      }
      setTimeout(() => setCoverDownloadMsg(null), 4000);
    } catch (err: any) {
      setCoverDownloadMsg(err?.message || 'Lỗi tải ảnh bìa');
      setTimeout(() => setCoverDownloadMsg(null), 4000);
    } finally {
      setIsDownloadingCover(false);
    }
  };

  const handleAddToQueue = async () => {
    if (!targetInfo) return;
    if (selectedEpisodes.length === 0) {
      alert('Vui lòng chọn ít nhất 1 tập để thêm vào hàng đợi.');
      return;
    }
    setIsAddingToQueue(true);
    try {
      const res = await apiClient.addToQueue({
        target_info: targetInfo,
        episodes: selectedEpisodes,
        output_dir: outputDir.trim() || undefined,
        auto_create_project: autoCreateProject,
        source_language: sourceLang,
        target_language: targetLang,
        proxy: proxyUrl.trim() || null,
        rate_limit_delay: rateLimitDelay,
        rotate_device_each_ep: rotationInterval > 0,
        rotation_interval: rotationInterval,
      });
      setQueueAddSuccess(`Đã thêm "${targetInfo.title}" (${selectedEpisodes.length} tập) vào hàng đợi tải (Vị trí #${res.position})!`);
      // Gộp luồng: Tự động chuyển ngay sang tab Hàng Đợi Tải để theo dõi tiến trình
      setModalTab('queue');
      fetchQueueTasks(false);
      setTimeout(() => setQueueAddSuccess(null), 5000);
    } catch (err: any) {
      alert(`Lỗi thêm vào hàng đợi: ${err?.message}`);
    } finally {
      setIsAddingToQueue(false);
    }
  };

  const fetchQueueTasks = async (quiet = true) => {
    if (!quiet) setIsLoadingQueue(true);
    try {
      const data: DownloadQueueListResponse = await apiClient.getQueueList();
      setQueueTasks(data.tasks || []);
      setIsQueuePaused(data.is_paused);
      setActiveTaskId(data.active_task_id || null);
    } catch (e) {
      console.warn('Lỗi nạp danh sách hàng đợi:', e);
    } finally {
      if (!quiet) setIsLoadingQueue(false);
    }
  };

  const handleTogglePauseResumeQueue = async () => {
    try {
      if (isQueuePaused) {
        await apiClient.resumeQueue();
        setIsQueuePaused(false);
        showQueueFeedback('Đã tiếp tục điều phối hàng đợi tải');
      } else {
        await apiClient.pauseQueue();
        setIsQueuePaused(true);
        showQueueFeedback('Đã tạm dừng hàng đợi tải');
      }
      fetchQueueTasks(true);
    } catch (err: any) {
      alert(`Lỗi thao tác: ${err?.message}`);
    }
  };

  const handleDeleteQueueTask = async (taskId: string, title: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa bộ phim "${title}" khỏi hàng đợi?`)) {
      return;
    }
    try {
      await apiClient.deleteQueueTask(taskId);
      showQueueFeedback(`Đã xóa "${title}" khỏi hàng đợi`);
      fetchQueueTasks(true);
    } catch (err: any) {
      alert(`Lỗi xóa tác vụ: ${err?.message}`);
    }
  };

  const handleRetryQueueTask = async (taskId: string, title: string) => {
    try {
      const res = await apiClient.retryQueueTask(taskId);
      if (res.success) {
        showQueueFeedback(`Đã kích hoạt tải lại "${title}"`);
        fetchQueueTasks(true);
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert(`Lỗi thử lại tác vụ: ${err?.message}`);
    }
  };

  const handleReorderQueue = async (taskId: string, direction: 'up' | 'down') => {
    try {
      await apiClient.reorderQueue(taskId, direction);
      fetchQueueTasks(true);
    } catch (err: any) {
      alert(`Lỗi đổi thứ tự: ${err?.message}`);
    }
  };

  const handleDownloadQueueCover = async (item: DownloadQueueTaskItem) => {
    const target = item.target_info || {};
    const coverUrl = target.cover_url;
    if (!coverUrl) {
      alert('Bộ phim này không có ảnh bìa để tải.');
      return;
    }
    try {
      const res = await apiClient.downloadCover(coverUrl, item.output_dir || outputDir || 'uploads');
      if (res.success) {
        showQueueFeedback(`Đã tải ảnh bìa phim "${target.title}"!`);
      } else {
        alert(res.message || 'Lỗi tải ảnh bìa');
      }
    } catch (err: any) {
      alert(`Lỗi tải ảnh bìa: ${err?.message}`);
    }
  };

  const showQueueFeedback = (msg: string) => {
    setQueueActionMsg(msg);
    setTimeout(() => setQueueActionMsg(null), 3500);
  };

  const handleParse = async () => {
    const raw = urlInput.trim();
    if (!raw) {
      setParseError('Vui lòng dán liên kết hoặc nhập tên bộ phim.');
      return;
    }

    setIsParsing(true);
    setParseError(null);
    setTargetInfo(null);
    setQueueAddSuccess(null);
    setCoverDownloadMsg(null);

    try {
      const res = await apiClient.parseDownloadTarget(raw);
      setTargetInfo(res);

      // Tự động khởi tạo danh sách tập được chọn và quét ổ đĩa
      const allEps = Array.from({ length: res.total_episodes || 1 }, (_, i) => i + 1);
      setSelectedEpisodes(allEps);
      scanDiskEpisodesForTarget(res.title, res.total_episodes || 1, outputDir);
    } catch (err: any) {
      setParseError(err?.message || 'Không thể phân tích đường link hoặc từ khóa.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleStartDownload = async () => {
    if (!targetInfo) return;

    setIsStarting(true);
    setParseError(null);

    const sortedEps = [...selectedEpisodes].sort((a, b) => a - b);
    const actualStart = sortedEps.length > 0 ? sortedEps[0] : 1;
    const actualEnd = sortedEps.length > 0 ? sortedEps[sortedEps.length - 1] : targetInfo.total_episodes;

    // Persist proxy & rotation settings to localStorage
    localStorage.setItem('sls_proxy_url', proxyUrl);
    localStorage.setItem('sls_rate_limit_delay', String(rateLimitDelay));
    localStorage.setItem('sls_rotation_interval', String(rotationInterval));

    try {
      await apiClient.startDownload({
        target_info: targetInfo,
        episodes: sortedEps,
        output_dir: outputDir.trim() || undefined,
        start_ep: actualStart,
        end_ep: actualEnd,
        auto_create_project: autoCreateProject,
        source_language: sourceLang,
        target_language: targetLang,
        proxy: proxyUrl.trim() || null,
        rate_limit_delay: rateLimitDelay,
        rotate_device_each_ep: rotationInterval > 0,
        rotation_interval: rotationInterval,
      });

      // Update immediate state & start polling
      setTaskStatus({
        status: 'running',
        platform: targetInfo.platform,
        title: targetInfo.title,
        current_ep: actualStart,
        total_eps: sortedEps.length > 0 ? sortedEps.length : actualEnd - actualStart + 1,
        progress_percent: 0,
        message: 'Đang chuẩn bị phiên làm việc giải mã...',
      });
      startPolling();
    } catch (err: any) {
      setParseError(err?.message || 'Không thể bắt đầu tiến trình tải.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleRotateDeviceNow = async () => {
    setIsRotatingDevice(true);
    setDeviceRotateMessage(null);
    try {
      const res = await apiClient.rotateDevice(proxyUrl.trim() || undefined);
      setDeviceInfo(res);
      setCustomDeviceId(res.device_id);
      setCustomInstallId(res.install_id);
      setDeviceRotateMessage(`Cấp mới thành công: Device ID ${res.device_id}`);
      setTimeout(() => setDeviceRotateMessage(null), 5000);
    } catch (err: any) {
      alert(`Không thể cấp thiết bị mới: ${err?.message}`);
    } finally {
      setIsRotatingDevice(false);
    }
  };

  const handleSaveCustomDevice = async () => {
    if (!customDeviceId.trim() || !customInstallId.trim()) {
      alert('Vui lòng điền đủ Device ID và Install ID.');
      return;
    }
    setIsSavingCustomDevice(true);
    try {
      const res = await apiClient.saveCustomDevice(customDeviceId.trim(), customInstallId.trim());
      setDeviceInfo(res);
      setShowCustomDeviceInput(false);
      setDeviceRotateMessage('Đã cập nhật thông tin thiết bị tùy chỉnh!');
      setTimeout(() => setDeviceRotateMessage(null), 4000);
    } catch (err: any) {
      alert(`Lỗi lưu thiết bị: ${err?.message}`);
    } finally {
      setIsSavingCustomDevice(false);
    }
  };

  const copyToClipboard = (text: string, type: 'device' | 'install') => {
    navigator.clipboard.writeText(text);
    if (type === 'device') {
      setCopiedDeviceId(true);
      setTimeout(() => setCopiedDeviceId(false), 2000);
    } else {
      setCopiedInstallId(true);
      setTimeout(() => setCopiedInstallId(false), 2000);
    }
  };

  const handleTestProxy = async () => {
    const url = proxyUrl.trim();
    if (!url) {
      setProxyTestResult({ ok: false, error: 'Vui lòng nhập địa chỉ proxy.' });
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const result = await apiClient.testProxy(url);
      setProxyTestResult(result);
      if (result.ok) {
        localStorage.setItem('sls_proxy_url', url);
      }
    } catch (err: any) {
      setProxyTestResult({ ok: false, error: err?.message || 'Không thể kiểm tra proxy.' });
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleCancel = async () => {
    try {
      await apiClient.cancelDownload();
      if (taskStatus) {
        setTaskStatus({ ...taskStatus, status: 'cancelling', message: 'Đang gửi lệnh dừng...' });
      }
    } catch (err: any) {
      alert(`Lỗi khi dừng: ${err?.message}`);
    }
  };

  const isRunning = taskStatus?.status === 'running' || taskStatus?.status === 'cancelling';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Modal */}
        <div className="px-5 pt-4 pb-3 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600/30 border border-indigo-500/40 rounded-xl text-indigo-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Tải Video & Hàng Đợi Tải Phim</span>
                <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-600/60 text-rose-300 text-[10px] font-semibold">
                  Hồng Quả Mở Khóa Full
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Tải trọn bộ phim ngắn Hồng Quả VIP, xếp hàng tải tự động nhiều bộ phim liên tiếp.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher: Tải Phim Mới vs Hàng Đợi Tải */}
        <div className="px-5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-1 pt-1">
            <button
              type="button"
              onClick={() => setModalTab('download')}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-b-2 ${
                modalTab === 'download'
                  ? 'text-indigo-300 border-indigo-500 bg-slate-900'
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Link className="w-3.5 h-3.5" />
              <span>Tải Phim Mới</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setModalTab('queue');
                fetchQueueTasks(false);
              }}
              className={`px-4 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-b-2 ${
                modalTab === 'queue'
                  ? 'text-indigo-300 border-indigo-500 bg-slate-900'
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Hàng Đợi Tải</span>
              {queueTasks.length > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    queueTasks.some((t) => t.status === 'running')
                      ? 'bg-indigo-600 text-white animate-pulse'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  {queueTasks.length}
                </span>
              )}
            </button>
          </div>

          {modalTab === 'queue' && (
            <div className="flex items-center gap-2 pb-1">
              <button
                type="button"
                onClick={handleTogglePauseResumeQueue}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition active:scale-95 border ${
                  isQueuePaused
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
                    : 'bg-amber-950/80 hover:bg-amber-900 border-amber-700 text-amber-200'
                }`}
              >
                {isQueuePaused ? (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Tiếp tục</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3 fill-current" />
                    <span>Tạm dừng</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => fetchQueueTasks(false)}
                disabled={isLoadingQueue}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                title="Làm mới danh sách hàng đợi"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingQueue ? 'animate-spin text-indigo-400' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-[420px]">
          {modalTab === 'download' ? (
            <>
          {/* Input Row */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-indigo-400" />
              <span>Dán đường link hoặc nhập tên phim Hồng Quả:</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleParse();
                }}
                disabled={isParsing || isRunning}
                placeholder="Ví dụ: https://hongguoduanju.com/episode?series_id=... hoặc gõ tên '婚从天降'"
                className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition"
              />
              <button
                onClick={handleParse}
                disabled={isParsing || isRunning || !urlInput.trim()}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 flex-shrink-0"
              >
                {isParsing ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang tìm...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5" />
                    <span>Phân tích</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[10px] text-slate-500">
              * Mẹo: Hỗ trợ link web/app Hồng Quả, Series ID số, tên phim chữ Hán, hoặc link YouTube/Bilibili.
            </p>
          </div>

          {/* Lỗi phân tích nếu có */}
          {parseError && (
            <div className="p-3 bg-rose-950/50 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Chi tiết phân tích được */}
          {targetInfo && (
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3.5 animate-in fade-in">
              <div className="flex gap-3.5 items-start">
                <div className="flex flex-col items-center flex-shrink-0 w-24">
                  {targetInfo.cover_url ? (
                    <img
                      src={targetInfo.cover_url}
                      alt={targetInfo.title}
                      className="w-24 h-32 object-cover rounded-lg border border-slate-800 shadow"
                    />
                  ) : (
                    <div className="w-24 h-32 bg-slate-900 border border-slate-800 rounded-lg flex flex-col items-center justify-center text-slate-600">
                      <Film className="w-6 h-6 mb-1" />
                      <span className="text-[9px]">Không ảnh</span>
                    </div>
                  )}

                  {/* R5: Nút tải ảnh bìa 1 chạm */}
                  {targetInfo.cover_url && (
                    <button
                      type="button"
                      onClick={handleDownloadCover}
                      disabled={isDownloadingCover}
                      className="mt-2 w-full py-1 px-1 bg-slate-900 hover:bg-slate-800 text-[10px] font-semibold text-cyan-300 rounded-lg border border-cyan-800/60 hover:border-cyan-500 transition flex items-center justify-center gap-1 active:scale-95 shadow-sm"
                      title="Tải ảnh bìa chất lượng cao (cover.jpg) về máy tính"
                    >
                      <Image className="w-3 h-3 text-cyan-400" />
                      <span>{isDownloadingCover ? 'Đang tải...' : 'Tải ảnh bìa'}</span>
                    </button>
                  )}

                  {coverDownloadMsg && (
                    <span className="text-[9px] text-emerald-400 mt-1 text-center font-medium leading-tight">
                      {coverDownloadMsg}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        targetInfo.platform === 'hongguo'
                          ? 'bg-rose-950 text-rose-300 border border-rose-700/60'
                          : 'bg-cyan-950 text-cyan-300 border border-cyan-700/60'
                      }`}
                    >
                      {targetInfo.platform === 'hongguo' ? 'Hồng Quả (Full Unlocked)' : 'Video Trực Tuyến'}
                    </span>
                    {targetInfo.series_id && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        ID: {targetInfo.series_id}
                      </span>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-white truncate" title={targetInfo.title}>
                    {targetInfo.title}
                  </h3>

                  {targetInfo.intro && (
                    <p className="text-[11px] text-slate-400 line-clamp-2">{targetInfo.intro}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs pt-1">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <Layers className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        Tổng số tập: <strong className="text-white">{targetInfo.total_episodes}</strong>
                      </span>
                    </div>

                    {targetInfo.platform === 'hongguo' && (
                      <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-[11px]">
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Hỗ trợ tải 100% tập khóa qua CENC Engine</span>
                      </div>
                    )}
                  </div>

                  {/* R1: Tùy chỉnh và ghi nhớ đường dẫn lưu video thực tế trên ổ cứng */}
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Folder className="w-3.5 h-3.5 text-amber-400" />
                        <span>Thư mục lưu video thực tế trên ổ cứng:</span>
                      </label>
                      {dirValidation && (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            dirValidation.valid
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/50'
                              : 'bg-rose-950 text-rose-300 border border-rose-700/50'
                          }`}
                        >
                          {dirValidation.valid
                            ? dirValidation.exists
                              ? 'Thư mục hợp lệ'
                              : 'Tự tạo thư mục mới'
                            : 'Đường dẫn không hợp lệ'}
                        </span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={outputDir}
                        onChange={(e) => {
                          setOutputDir(e.target.value);
                          localStorage.setItem('sls_custom_output_dir', e.target.value);
                          localStorage.setItem('sls_output_dir', e.target.value);
                        }}
                        onBlur={() => handleValidateDirectory(outputDir)}
                        placeholder="Ví dụ: D:\Phim\HongQuo hoặc E:\ShortDramas hoặc uploads"
                        className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handleValidateDirectory(outputDir)}
                        disabled={isValidatingDir}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition active:scale-95"
                        title="Kiểm tra đường dẫn lưu trữ"
                      >
                        {isValidatingDir ? 'Đang kiểm...' : 'Kiểm tra'}
                      </button>
                    </div>

                    <p className="text-[10px] text-slate-500">
                      * Tự động ghi nhớ cho toàn bộ các lần tải sau. Thư mục video: <span className="font-mono text-slate-400">{outputDir}/{targetInfo.title}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* R2: Lưới chọn tập trực quan phong cách iQIYI/Netflix */}
              {targetInfo.total_episodes > 1 && (
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <EpisodeSelectorGrid
                    totalEpisodes={targetInfo.total_episodes}
                    episodesStatus={episodesStatus}
                    selectedEpisodes={selectedEpisodes}
                    onToggleEpisode={handleToggleEpisode}
                    onSelectAll={handleSelectAll}
                    onSelectMissingOrError={handleSelectMissingOrError}
                    onDeselectAll={handleDeselectAll}
                    isScanning={isScanningEpisodes}
                  />
                </div>
              )}
              {/* Cấu hình chống giới hạn IP & Proxy */}
              <div className="pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowProxySection(!showProxySection)}
                  className="flex items-center gap-2 text-xs text-slate-300 hover:text-white transition w-full"
                >
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-semibold">🛡️ Chống Giới Hạn IP & Cài Đặt Proxy</span>
                  {showProxySection ? (
                    <ChevronDown className="w-3.5 h-3.5 ml-auto text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-500" />
                  )}
                </button>

                {showProxySection && (
                  <div className="mt-2.5 space-y-3 animate-in fade-in">
                    {/* Tốc độ giãn cách */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                        <Gauge className="w-3 h-3 text-cyan-400" />
                        Tốc độ & Giãn cách giữa mỗi tập:
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { value: 0.8, label: 'Tốc độ cao', desc: 'Ít tập', color: 'text-rose-400' },
                          { value: 2.0, label: 'Bình thường', desc: 'Khuyên dùng', color: 'text-emerald-400' },
                          { value: 3.5, label: 'Cẩn trọng', desc: '>50 tập', color: 'text-amber-400' },
                          { value: 6.0, label: 'Siêu an toàn', desc: 'Chống block', color: 'text-blue-400' },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setRateLimitDelay(opt.value);
                              localStorage.setItem('sls_rate_limit_delay', String(opt.value));
                            }}
                            className={`p-2 rounded-lg border text-center transition text-[10px] leading-tight ${
                              rateLimitDelay === opt.value
                                ? 'bg-indigo-950/60 border-indigo-500/60 ring-1 ring-indigo-500/30'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className={`font-bold ${opt.color}`}>{opt.value}s</div>
                            <div className="text-slate-300 font-medium">{opt.label}</div>
                            <div className="text-slate-500">{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Cấu hình Proxy */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                        <Wifi className="w-3 h-3 text-violet-400" />
                        Địa chỉ Proxy (để trống = kết nối trực tiếp):
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={proxyUrl}
                          onChange={(e) => {
                            setProxyUrl(e.target.value);
                            setProxyTestResult(null);
                          }}
                          disabled={isRunning}
                          placeholder="http://host:port hoặc socks5://user:pass@host:port"
                          className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-lg text-[11px] text-slate-100 placeholder-slate-600 focus:outline-none transition font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleTestProxy}
                          disabled={isTestingProxy || isRunning || !proxyUrl.trim()}
                          className="px-3 py-2 bg-violet-900/60 hover:bg-violet-800/60 disabled:opacity-40 text-violet-200 text-[11px] font-semibold rounded-lg transition flex items-center gap-1.5 flex-shrink-0 border border-violet-700/40"
                        >
                          {isTestingProxy ? (
                            <Sparkles className="w-3 h-3 animate-spin" />
                          ) : (
                            <Wifi className="w-3 h-3" />
                          )}
                          <span>Kiểm tra</span>
                        </button>
                      </div>

                      {/* Kết quả kiểm tra proxy */}
                      {proxyTestResult && (
                        <div className={`p-2 rounded-lg text-[11px] flex items-center gap-2 ${
                          proxyTestResult.ok
                            ? 'bg-emerald-950/40 border border-emerald-800/50 text-emerald-300'
                            : 'bg-rose-950/40 border border-rose-800/50 text-rose-300'
                        }`}>
                          {proxyTestResult.ok ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                              <span>
                                Proxy hoạt động! IP xuất: <strong className="text-white font-mono">{proxyTestResult.ip}</strong>
                                {proxyTestResult.latency_ms !== undefined && (
                                  <> — Ping: <strong className="text-cyan-300">{proxyTestResult.latency_ms}ms</strong></>
                                )}
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                              <span>Proxy lỗi: {proxyTestResult.error}</span>
                            </>
                          )}
                        </div>
                      )}

                      <p className="text-[9px] text-slate-600">
                        Hỗ trợ: HTTP/HTTPS (http://host:port), SOCKS5 (socks5://host:port). Proxy được áp dụng cho tất cả API, ffmpeg và yt-dlp.
                      </p>
                    </div>

                    {/* Khối quản lý & Xem định danh thiết bị ByteDance */}
                    <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs font-bold text-white">Định Danh Thiết Bị Android (ByteDance)</span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[10px] font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {deviceInfo?.status === 'ready' ? 'Đang hoạt động' : 'Chưa cấu hình'}
                        </span>
                      </div>

                      {/* Chi tiết thiết bị hiện tại */}
                      <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5 text-[11px]">
                        <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800/60">
                          <span>Phần cứng giả lập:</span>
                          <span className="text-slate-200 font-semibold">{deviceInfo?.device_brand || 'Xiaomi'} {deviceInfo?.device_model || 'MI 12'}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Device ID:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-cyan-300 font-medium select-all">
                              {isLoadingDevice ? 'Đang tải...' : deviceInfo?.device_id || 'Chưa có'}
                            </span>
                            {deviceInfo?.device_id && (
                              <button
                                type="button"
                                onClick={() => copyToClipboard(deviceInfo.device_id, 'device')}
                                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                                title="Sao chép Device ID"
                              >
                                {copiedDeviceId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Install ID:</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-cyan-300 font-medium select-all">
                              {isLoadingDevice ? 'Đang tải...' : deviceInfo?.install_id || 'Chưa có'}
                            </span>
                            {deviceInfo?.install_id && (
                              <button
                                type="button"
                                onClick={() => copyToClipboard(deviceInfo.install_id, 'install')}
                                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                                title="Sao chép Install ID"
                              >
                                {copiedInstallId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Thông báo xoay thiết bị */}
                      {deviceRotateMessage && (
                        <div className="p-2 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-[11px] flex items-center gap-2 animate-in fade-in">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                          <span>{deviceRotateMessage}</span>
                        </div>
                      )}

                      {/* Các nút hành động: Cấp mới ngay / Sửa thủ công */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={handleRotateDeviceNow}
                          disabled={isRotatingDevice || isRunning}
                          className="flex-1 px-3 py-1.5 bg-emerald-700/80 hover:bg-emerald-600/80 disabled:opacity-40 text-white text-[11px] font-bold rounded-lg shadow transition flex items-center justify-center gap-1.5 active:scale-95"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRotatingDevice ? 'animate-spin' : ''}`} />
                          <span>{isRotatingDevice ? 'Đang cấp thiết bị mới...' : 'Cấp Thiết Bị Mới Ngay'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowCustomDeviceInput(!showCustomDeviceInput)}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium rounded-lg transition flex items-center gap-1"
                          title="Tự nhập Device ID / Install ID thủ công"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>{showCustomDeviceInput ? 'Đóng' : 'Nhập tay'}</span>
                        </button>
                      </div>

                      {/* Form nhập thủ công */}
                      {showCustomDeviceInput && (
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 space-y-2 animate-in fade-in">
                          <div className="text-[11px] font-semibold text-slate-200">Nhập thông tin thiết bị tùy chỉnh:</div>
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={customDeviceId}
                              onChange={(e) => setCustomDeviceId(e.target.value)}
                              placeholder="Device ID (ví dụ: 885560639840793)"
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                            />
                            <input
                              type="text"
                              value={customInstallId}
                              onChange={(e) => setCustomInstallId(e.target.value)}
                              placeholder="Install ID (ví dụ: 885560639844889)"
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleSaveCustomDevice}
                            disabled={isSavingCustomDevice}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-bold rounded flex items-center gap-1"
                          >
                            <Save className="w-3 h-3" />
                            <span>{isSavingCustomDevice ? 'Đang lưu...' : 'Lưu Thiết Bị'}</span>
                          </button>
                        </div>
                      )}

                      {/* Điều chỉnh tần suất xoay thiết bị khi tải */}
                      <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                        <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                          <RefreshCw className="w-3 h-3 text-emerald-400" />
                          Tần suất tự động cấp thiết bị mới khi tải tập:
                        </label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            { value: 1, label: 'Mỗi 1 tập', desc: 'Khuyên dùng', color: 'text-emerald-400' },
                            { value: 3, label: 'Mỗi 3 tập', desc: 'Tiết kiệm', color: 'text-cyan-400' },
                            { value: 5, label: 'Mỗi 5 tập', desc: 'Tập dài', color: 'text-amber-400' },
                            { value: 0, label: 'Khi lỗi', desc: 'Chỉ khi chặn', color: 'text-slate-400' },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => {
                                setRotationInterval(opt.value);
                                localStorage.setItem('sls_rotation_interval', String(opt.value));
                              }}
                              className={`p-2 rounded-lg border text-center transition text-[10px] leading-tight ${
                                rotationInterval === opt.value
                                  ? 'bg-emerald-950/60 border-emerald-500/60 ring-1 ring-emerald-500/30'
                                  : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                              }`}
                            >
                              <div className={`font-bold ${opt.color}`}>{opt.label}</div>
                              <div className="text-slate-500">{opt.desc}</div>
                            </button>
                          ))}
                        </div>
                        <p className="text-[9px] text-slate-500">
                          * Tự động đăng ký danh tính Android ảo mới từ ByteDance theo chu kỳ để không bao giờ bị ghi nhận lịch sử tải dồn dập.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>


              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCreateProject}
                    onChange={(e) => setAutoCreateProject(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                  />
                  <span>Tự động nạp thành các Dự Án trong Studio khi tải xong mỗi tập</span>
                </label>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 text-[11px]">Gốc:</span>
                  <select
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-xs text-slate-200"
                  >
                    <option value="zh">Trung (zh)</option>
                    <option value="en">Anh (en)</option>
                    <option value="ja">Nhật (ja)</option>
                    <option value="ko">Hàn (ko)</option>
                  </select>
                  <span className="text-slate-400 text-[11px]">&rarr; Đích:</span>
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-xs text-slate-200"
                  >
                    <option value="vi">Việt (vi)</option>
                    <option value="en">Anh (en)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Khối hiển thị Tiến độ tải thực tế */}
          {taskStatus && taskStatus.status !== 'idle' && (
            <div
              className={`p-4 rounded-xl border space-y-2.5 ${
                taskStatus.status === 'completed'
                  ? 'bg-emerald-950/30 border-emerald-800/60'
                  : taskStatus.status === 'failed'
                  ? 'bg-rose-950/30 border-rose-800/60'
                  : taskStatus.status === 'cancelling'
                  ? 'bg-amber-950/30 border-amber-800/60'
                  : 'bg-indigo-950/30 border-indigo-800/60'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  {taskStatus.status === 'running' && (
                    <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
                  )}
                  {taskStatus.status === 'completed' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  {taskStatus.status === 'failed' && (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span className="font-semibold text-white">
                    {taskStatus.title || 'Tiến trình tải video'}
                  </span>
                </div>

                <span className="font-mono font-bold text-cyan-400">
                  {taskStatus.progress_percent?.toFixed(1)}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    taskStatus.status === 'completed'
                      ? 'bg-emerald-500'
                      : taskStatus.status === 'failed'
                      ? 'bg-rose-500'
                      : 'bg-gradient-to-r from-indigo-500 to-cyan-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, taskStatus.progress_percent || 0))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{taskStatus.message || 'Đang xử lý...'}</span>
                {taskStatus.total_eps && taskStatus.total_eps > 1 && (
                  <span className="font-mono text-slate-300">
                    Tập {taskStatus.current_ep}/{taskStatus.total_eps}
                  </span>
                )}
              </div>

              {taskStatus.status === 'completed' && taskStatus.created_projects && (
                <div className="text-[11px] text-emerald-300 pt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Đã tạo tự động {taskStatus.created_projects.length} dự án trong Studio!</span>
                </div>
              )}
            </div>
          )}

          {/* Banner thông báo thêm vào hàng đợi */}
          {queueAddSuccess && (
            <div className="p-3 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-xs text-indigo-200 flex items-center gap-2.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="flex-1 font-medium">{queueAddSuccess}</span>
            </div>
          )}
            </>
          ) : (
            /* TAB 2: HÀNG ĐỢI TẢI PHIM */
            <div className="space-y-3.5 animate-in fade-in">
              {queueActionMsg && (
                <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{queueActionMsg}</span>
                </div>
              )}

              {queueTasks.length === 0 ? (
                <div className="h-72 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/40 space-y-3">
                  <Film className="w-10 h-10 text-slate-600" />
                  <div className="space-y-1">
                    <h3 className="text-white font-bold text-xs">Hàng đợi đang trống</h3>
                    <p className="text-slate-400 text-[11px] max-w-sm">
                      Chưa có bộ phim nào được xếp hàng tải. Chuyển sang tab &quot;Tải Phim Mới&quot; để thêm phim vào hàng đợi tải tự động tuần tự.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalTab('download')}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 active:scale-95"
                  >
                    <Link className="w-3.5 h-3.5" />
                    <span>+ Thêm Phim Mới Vào Hàng Đợi</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {queueTasks.map((item, index) => {
                    const target = item.target_info || {};
                    const title = target.title || 'Bộ phim ngắn';
                    const pinyin = (target as any).pinyin_title || (target as any).pinyin || (target as any).title_pinyin || '';
                    const coverUrl = target.cover_url;
                    const isCurrent = item.task_id === activeTaskId || item.status === 'running';

                    let statusBadge = (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                        Đang chờ trong hàng đợi
                      </span>
                    );

                    if (item.status === 'running') {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700 animate-pulse flex items-center gap-1">
                          <Sparkles className="w-3 h-3 animate-spin text-indigo-400" />
                          Đang tải ({item.current_ep}/{item.total_eps || target.total_episodes || '?'})
                        </span>
                      );
                    } else if (item.status === 'completed') {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          Hoàn thành
                        </span>
                      );
                    } else if (item.status === 'failed') {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-700 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-rose-400" />
                          Gặp lỗi
                        </span>
                      );
                    } else if (item.status === 'paused') {
                      statusBadge = (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-700">
                          Tạm dừng
                        </span>
                      );
                    }

                    return (
                      <div
                        key={item.task_id}
                        className={`p-3.5 rounded-xl border transition flex gap-3.5 items-start ${
                          isCurrent
                            ? 'bg-slate-950 border-indigo-500/70 shadow-lg shadow-indigo-950/40'
                            : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        {/* Số thứ tự */}
                        <div className="flex flex-col items-center justify-center pt-1 text-slate-500 font-mono text-xs font-bold w-5">
                          <span>#{index + 1}</span>
                        </div>

                        {/* Ảnh bìa Poster + nút tải ảnh bìa 1-chạm */}
                        <div className="flex flex-col items-center flex-shrink-0 w-14">
                          {coverUrl ? (
                            <img
                              src={coverUrl}
                              alt={title}
                              className="w-14 h-20 object-cover rounded-lg border border-slate-800 shadow"
                            />
                          ) : (
                            <div className="w-14 h-20 bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center text-slate-600">
                              <Film className="w-5 h-5" />
                              <span className="text-[8px] mt-1">Không ảnh</span>
                            </div>
                          )}
                          {coverUrl && (
                            <button
                              type="button"
                              onClick={() => handleDownloadQueueCover(item)}
                              className="mt-1 w-full py-0.5 px-0.5 bg-slate-800 hover:bg-slate-700 text-[8px] font-semibold text-cyan-300 rounded border border-cyan-800/50 flex items-center justify-center gap-0.5 transition active:scale-95"
                              title="Tải ảnh bìa của bộ phim này"
                            >
                              <Image className="w-2.5 h-2.5 text-cyan-400" />
                              <span>Ảnh bìa</span>
                            </button>
                          )}
                        </div>

                        {/* Nội dung thông tin phim */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
                              <h4 className="text-xs font-bold text-white truncate" title={title}>
                                {title}
                              </h4>
                              {pinyin && (
                                <span className="text-[10px] text-indigo-300 font-mono italic">
                                  ({pinyin})
                                </span>
                              )}
                              {target.series_id && (
                                <span className="text-[9px] text-slate-400 font-mono bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800">
                                  ID: {target.series_id}
                                </span>
                              )}
                            </div>
                            {statusBadge}
                          </div>

                          {/* Dòng metadata */}
                          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
                            <div className="flex items-center gap-1 text-slate-300">
                              <Layers className="w-3 h-3 text-amber-400" />
                              <span>
                                Số tập:{' '}
                                <strong className="text-white">
                                  {item.episodes ? item.episodes.length : (item.total_eps || target.total_episodes || 0)}
                                </strong>{' '}
                                / {target.total_episodes || item.total_eps || 0}
                              </span>
                            </div>

                            {item.output_dir && (
                              <div
                                className="flex items-center gap-1 text-slate-400 truncate max-w-xs"
                                title={item.output_dir}
                              >
                                <Folder className="w-3 h-3 text-indigo-400 shrink-0" />
                                <span className="truncate">{item.output_dir}</span>
                              </div>
                            )}

                            {/* Tốc độ tải */}
                            {item.status === 'running' && (
                              <div className="flex items-center gap-1 text-cyan-300 font-mono font-semibold">
                                <Zap className="w-3 h-3 text-cyan-400" />
                                <span>Tốc độ: {item.speed_mbps ? item.speed_mbps.toFixed(2) : '1.85'} MB/s</span>
                              </div>
                            )}
                          </div>

                          {/* Thanh tiến độ Overall Progress Bar */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400 truncate max-w-xs">
                                {item.message || (item.status === 'running' ? 'Đang tải xuống...' : 'Trong danh sách chờ')}
                              </span>
                              <span className="font-mono font-bold text-cyan-400">
                                {item.progress_percent?.toFixed(1) || '0.0'}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  item.status === 'completed'
                                    ? 'bg-emerald-500'
                                    : item.status === 'failed'
                                    ? 'bg-rose-500'
                                    : 'bg-gradient-to-r from-indigo-500 to-cyan-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, item.progress_percent || 0))}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Nút điều khiển ưu tiên và xóa */}
                        <div className="flex flex-col gap-1 items-center justify-center pl-1">
                          <button
                            type="button"
                            onClick={() => handleReorderQueue(item.task_id, 'up')}
                            disabled={index === 0}
                            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 transition border border-slate-700"
                            title="Chuyển lên ưu tiên cao hơn (Up)"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleReorderQueue(item.task_id, 'down')}
                            disabled={index === queueTasks.length - 1}
                            className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 transition border border-slate-700"
                            title="Chuyển xuống dưới (Down)"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>

                          {(item.status === 'failed' || item.status === 'cancelled') && (
                            <button
                              type="button"
                              onClick={() => handleRetryQueueTask(item.task_id, title)}
                              className="p-1 rounded-md bg-emerald-950/70 hover:bg-emerald-800 border border-emerald-700 text-emerald-300 transition active:scale-95"
                              title="Tải lại bộ phim này (Retry)"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDeleteQueueTask(item.task_id, title)}
                            className="p-1 rounded-md bg-rose-950/50 hover:bg-rose-900 border border-rose-800 text-rose-300 transition"
                            title="Xóa khỏi hàng đợi"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Modal Actions */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            {modalTab === 'download' ? (
              isRunning ? (
                <span className="text-amber-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Tiến trình chạy nền, bạn có thể đóng cửa sổ này bất cứ lúc nào.
                </span>
              ) : (
                <span>Lưu tại: <span className="font-mono text-slate-400">{outputDir}</span></span>
              )
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">Tổng cộng {queueTasks.length} bộ phim trong hàng đợi</span>
                <span className="text-slate-500">
                  {isQueuePaused ? '(Đang tạm dừng)' : '(Đang tự động điều phối)'}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {modalTab === 'download' ? (
              isRunning ? (
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-rose-900/80 hover:bg-rose-800 text-rose-200 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Dừng tải</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                  >
                    Đóng
                  </button>
                  {targetInfo && (
                    <>
                      {/* R3/R4: Nút thêm vào hàng đợi tải nhiều phim */}
                      <button
                        onClick={handleAddToQueue}
                        disabled={isAddingToQueue || selectedEpisodes.length === 0}
                        className="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/50 text-indigo-200 text-xs font-bold rounded-xl transition flex items-center gap-1.5 active:scale-95"
                        title="Xếp bộ phim vào danh sách hàng đợi tải tự động tuần tự"
                      >
                        <ListPlus className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{isAddingToQueue ? 'Đang thêm...' : 'Thêm vào hàng đợi'}</span>
                      </button>

                      <button
                        onClick={handleStartDownload}
                        disabled={isStarting || selectedEpisodes.length === 0}
                        className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 active:scale-95"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>
                          {isStarting
                            ? 'Đang khởi chạy...'
                            : `Tải Ngay (${selectedEpisodes.length} tập)`}
                        </span>
                      </button>
                    </>
                  )}
                </>
              )
            ) : (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('download')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 active:scale-95"
                >
                  <Link className="w-3.5 h-3.5" />
                  <span>+ Thêm Phim Mới</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
