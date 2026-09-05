import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  apiClient,
  DownloadTargetInfo,
  DownloadTaskStatus,
  DeviceStatusInfo,
  DownloadQueueTaskItem,
  DownloadQueueListResponse,
  PlatformAuthStatusResponse,
  VideoSearchResultItem,
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
  Sliders,
  HardDrive,
  Globe,
  QrCode,
  User,
  Key,
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

  // Tab điều hướng: 'download' (Dán link) | 'search' (Tìm kiếm Bilibili) | 'queue' (Hàng đợi) | 'auth' (Tài khoản & VIP)
  const [modalTab, setModalTab] = useState<'download' | 'search' | 'queue' | 'auth'>('download');
  const [queueTasks, setQueueTasks] = useState<DownloadQueueTaskItem[]>([]);
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [queueActionMsg, setQueueActionMsg] = useState<string | null>(null);

  // Search video state
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchPlatform] = useState('bilibili');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<VideoSearchResultItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Platform Auth & In-App QR login state
  const [authStatus, setAuthStatus] = useState<PlatformAuthStatusResponse | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [biliQrDataUrl, setBiliQrDataUrl] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [biliQrStatusText, setBiliQrStatusText] = useState<string | null>(null);
  const [biliQrStatusType, setBiliQrStatusType] = useState<'waiting' | 'scanned' | 'success' | 'expired' | 'error' | null>(null);
  const qrPollIntervalRef = useRef<any>(null);

  // Manual Cookie Management state
  const [customPlatform, setCustomPlatform] = useState<string>('bilibili');
  const [customCookieInput, setCustomCookieInput] = useState('');
  const [isSavingCookie, setIsSavingCookie] = useState(false);
  const [cookieFeedback, setCookieFeedback] = useState<string | null>(null);

  // Range and download options
  const [autoCreateProject, setAutoCreateProject] = useState(true);
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');

  // Video Resolution & Real Data Size Estimation state
  const [selectedResolution, setSelectedResolution] = useState<string>('best');

  // Multi-thread Concurrency & Universal Browser Cookies state
  const [concurrency, setConcurrency] = useState<number>(() => {
    const saved = localStorage.getItem('sls_download_concurrency');
    return saved ? parseInt(saved, 10) : 3;
  });
  const [cookieSource, setCookieSource] = useState<string>(() => {
    return localStorage.getItem('sls_cookie_source') || 'none';
  });

  const activeResItem = useMemo(() => {
    if (!targetInfo?.resolutions || targetInfo.resolutions.length === 0) return null;
    if (selectedResolution === 'best' || !selectedResolution) {
      return targetInfo.resolutions[0];
    }
    const found = targetInfo.resolutions.find(r => 
      r.id.toLowerCase().includes(selectedResolution.toLowerCase()) || 
      selectedResolution.toLowerCase().includes(r.id.toLowerCase())
    );
    return found || targetInfo.resolutions[0];
  }, [targetInfo?.resolutions, selectedResolution]);

  const singleEpisodeMb = useMemo(() => {
    if (!activeResItem?.size_mb) return 0;
    return activeResItem.size_mb;
  }, [activeResItem]);

  const countSelected = useMemo(() => {
    if (selectedEpisodes.length > 0) return selectedEpisodes.length;
    return targetInfo?.total_episodes || 1;
  }, [selectedEpisodes, targetInfo?.total_episodes]);

  const totalEstimatedMb = useMemo(() => {
    return singleEpisodeMb * countSelected;
  }, [singleEpisodeMb, countSelected]);

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
    loadAuthStatus();
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
      stopBiliQrPolling();
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

  const loadAuthStatus = () => {
    setIsLoadingAuth(true);
    apiClient
      .getPlatformAuthStatus()
      .then((st) => setAuthStatus(st))
      .catch((err) => console.warn('Could not load auth status:', err))
      .finally(() => setIsLoadingAuth(false));
  };

  const stopBiliQrPolling = () => {
    if (qrPollIntervalRef.current) {
      clearInterval(qrPollIntervalRef.current);
      qrPollIntervalRef.current = null;
    }
  };

  const handleGenerateBilibiliQr = async () => {
    stopBiliQrPolling();
    setIsGeneratingQr(true);
    setBiliQrStatusText('Đang tạo mã QR Bilibili...');
    setBiliQrStatusType('waiting');
    try {
      const res = await apiClient.generateBilibiliQr();
      const dataUrl = await QRCode.toDataURL(res.url, { width: 220, margin: 2 });
      setBiliQrDataUrl(dataUrl);
      setBiliQrStatusText('Mở ứng dụng Bilibili trên điện thoại để quét mã QR.');

      qrPollIntervalRef.current = setInterval(async () => {
        try {
          const pollRes = await apiClient.pollBilibiliQr(res.qrcode_key);
          if (pollRes.code === 0) {
            stopBiliQrPolling();
            setBiliQrStatusType('success');
            setBiliQrStatusText('Đăng nhập Bilibili thành công! VIP & Video HD đã mở khóa.');
            loadAuthStatus();
          } else if (pollRes.code === 86090) {
            setBiliQrStatusType('scanned');
            setBiliQrStatusText('Đã quét mã! Vui lòng nhấn [Xác nhận đăng nhập] trên ứng dụng Bilibili.');
          } else if (pollRes.code === 86038) {
            stopBiliQrPolling();
            setBiliQrStatusType('expired');
            setBiliQrStatusText('Mã QR đã hết hạn. Vui lòng bấm tạo mã mới.');
          }
        } catch (pollErr) {
          console.warn('Lỗi polling Bilibili QR:', pollErr);
        }
      }, 2500);
    } catch (err: any) {
      setBiliQrStatusType('error');
      setBiliQrStatusText(`Lỗi tạo mã QR: ${err?.message || err}`);
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleSavePlatformCookie = async () => {
    if (!customCookieInput.trim()) {
      alert('Vui lòng nhập chuỗi Cookie');
      return;
    }
    setIsSavingCookie(true);
    setCookieFeedback(null);
    try {
      const res = await apiClient.savePlatformCookie(customPlatform, customCookieInput.trim());
      setCookieFeedback(res.message);
      setCustomCookieInput('');
      loadAuthStatus();
      setTimeout(() => setCookieFeedback(null), 4000);
    } catch (err: any) {
      setCookieFeedback(`Lỗi: ${err?.message}`);
    } finally {
      setIsSavingCookie(false);
    }
  };

  const handleDeletePlatformCookie = async (plat: string) => {
    if (!confirm(`Bạn có chắc muốn xóa cookie của nền tảng ${plat}?`)) return;
    try {
      await apiClient.deletePlatformCookie(plat);
      loadAuthStatus();
    } catch (err: any) {
      alert(`Lỗi: ${err?.message}`);
    }
  };

  const handleSearchVideos = async (kw?: string) => {
    const keyword = (kw || searchKeyword).trim();
    if (!keyword) {
      setSearchError('Vui lòng nhập từ khóa tìm kiếm.');
      return;
    }
    if (kw) {
      setSearchKeyword(kw);
    }
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await apiClient.searchVideos(keyword, searchPlatform, 1);
      setSearchResults(res.results || []);
      if (!res.results || res.results.length === 0) {
        setSearchError('Không tìm thấy video nào với từ khóa này.');
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Lỗi khi tìm kiếm video.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (item: VideoSearchResultItem) => {
    const link = item.url || item.arcurl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '');
    if (!link) return;
    setUrlInput(link);
    setModalTab('download');
    handleParse(link);
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
        target_resolution: selectedResolution,
        concurrency: concurrency,
        cookie_source: cookieSource,
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

  const handleParse = async (overrideTarget?: string) => {
    const raw = (overrideTarget || urlInput).trim();
    if (!raw) {
      setParseError('Vui lòng dán liên kết hoặc nhập tên bộ phim.');
      return;
    }
    if (overrideTarget) {
      setUrlInput(overrideTarget);
    }

    setIsParsing(true);
    setParseError(null);
    setTargetInfo(null);
    setTaskStatus(null);
    setQueueAddSuccess(null);
    setCoverDownloadMsg(null);

    try {
      const res = await apiClient.parseDownloadTarget(raw);
      setTargetInfo(res);

      if (res.resolutions && res.resolutions.length > 0) {
        setSelectedResolution(res.resolutions[0].id);
      } else {
        setSelectedResolution('best');
      }

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
        target_resolution: selectedResolution,
        concurrency: concurrency,
        cookie_source: cookieSource,
      });

      // Tự động chuyển ngay sang tab Hàng Đợi Tải và nạp danh sách để người dùng thấy rõ tiến trình
      setModalTab('queue');
      fetchQueueTasks(false);

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

        {/* Tab Switcher: Dán Link Tải vs Tìm Kiếm Bilibili vs Hàng Đợi Tải vs Tài Khoản & VIP */}
        <div className="px-5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-1 pt-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setModalTab('download')}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 whitespace-nowrap ${
                modalTab === 'download'
                  ? 'text-indigo-300 border-indigo-500 bg-slate-900'
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Link className="w-3.5 h-3.5" />
              <span>Dán Link Tải</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setModalTab('search');
                if (searchResults.length === 0 && !searchKeyword) {
                  handleSearchVideos('短剧');
                }
              }}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 whitespace-nowrap ${
                modalTab === 'search'
                  ? 'text-indigo-300 border-indigo-500 bg-slate-900'
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <Search className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tìm Kiếm Bilibili</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
                0 Cần Nick
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setModalTab('queue');
                fetchQueueTasks(false);
              }}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 whitespace-nowrap ${
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

            <button
              type="button"
              onClick={() => {
                setModalTab('auth');
                loadAuthStatus();
              }}
              className={`px-3.5 py-2 text-xs font-bold rounded-t-xl transition flex items-center gap-1.5 border-b-2 whitespace-nowrap ${
                modalTab === 'auth'
                  ? 'text-indigo-300 border-indigo-500 bg-slate-900'
                  : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <User className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tài Khoản & VIP</span>
              {authStatus?.platforms?.bilibili?.logged_in ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Bilibili VIP / Đã đăng nhập" />
              ) : null}
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
          {modalTab === 'download' && (
            <>
          {/* Input Row */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Link className="w-3.5 h-3.5 text-indigo-400" />
                <span>Dán liên kết (Bilibili, Xiaohongshu, Hồng Quả, Douyin, YouTube) hoặc tên phim:</span>
              </span>
              <span className="text-[10px] font-medium text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>Tải được ngay 0 cần tài khoản</span>
              </span>
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
                placeholder="Dán link Bilibili (BV...), Xiaohongshu (xhslink...), Douyin, YouTube, Hồng Quả hoặc gõ tên phim..."
                className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition"
              />
              <button
                onClick={() => handleParse()}
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
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>* Hỗ trợ tự động: Bilibili (720p/480p), Tiểu Hồng Thư (1080p sạch không logo), Douyin, YouTube, Hồng Quả (mở khóa full).</span>
              <button
                type="button"
                onClick={() => setModalTab('search')}
                className="text-cyan-400 hover:underline flex items-center gap-1"
              >
                <Search className="w-3 h-3" />
                <span>Tìm kiếm video trên Bilibili &rarr;</span>
              </button>
            </div>
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

                  {/* Lựa chọn độ phân giải và ước tính dung lượng REAL DATA */}
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Độ phân giải tải xuống:</span>
                      </label>
                      <select
                        value={selectedResolution}
                        onChange={(e) => setSelectedResolution(e.target.value)}
                        className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 text-cyan-300 font-medium text-xs rounded-lg focus:outline-none focus:border-cyan-500 cursor-pointer"
                      >
                        <option value="best">Tự động (Chất lượng cao nhất)</option>
                        {targetInfo.resolutions && targetInfo.resolutions.length > 0 ? (
                          targetInfo.resolutions.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label} {r.size_mb ? `(~${r.size_mb} MB/tập)` : ''}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="1080p">1080p (Full HD - Nét nhất)</option>
                            <option value="720p">720p (HD - Chuẩn khuyên dùng)</option>
                            <option value="540p">540p (Tiết kiệm dung lượng)</option>
                            <option value="480p">480p (SD - Mượt nhẹ)</option>
                            <option value="360p">360p (Dung lượng thấp nhất)</option>
                          </>
                        )}
                      </select>
                    </div>

                    {/* Hộp ước tính dung lượng thực tế (REAL DATA TỪ MÁY CHỦ) */}
                    <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-xs flex flex-wrap items-center justify-between gap-2 text-cyan-200">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                        <div>
                          <span className="text-slate-300">Dung lượng 1 tập (Real Data): </span>
                          <strong className="text-white font-mono">
                            {singleEpisodeMb > 0 ? `~${singleEpisodeMb.toFixed(2)} MB` : 'Đang đồng bộ...'}
                          </strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 bg-slate-900/90 px-2.5 py-1 rounded-md border border-slate-700/60">
                        <span className="text-slate-400">
                          Tổng dung lượng ước tính ({countSelected} tập):
                        </span>
                        <strong className="text-emerald-400 font-bold font-mono">
                          {totalEstimatedMb > 0
                            ? totalEstimatedMb >= 1024
                              ? `${(totalEstimatedMb / 1024).toFixed(2)} GB (~${totalEstimatedMb.toFixed(0)} MB)`
                              : `~${totalEstimatedMb.toFixed(1)} MB`
                            : '—'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Cấu hình Đa luồng tải cùng lúc & Trình duyệt Cookies */}
                  <div className="pt-2 border-t border-slate-800 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>Số luồng tải đồng thời (Multi-threading):</span>
                      </label>
                      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                        {[
                          { value: 1, label: '1 luồng', tag: 'Tuần tự' },
                          { value: 2, label: '2 luồng', tag: '' },
                          { value: 3, label: '3 luồng', tag: 'Khuyên dùng' },
                          { value: 5, label: '5 luồng', tag: 'Nhanh' },
                          { value: 8, label: '8 luồng', tag: 'Siêu tốc' },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setConcurrency(opt.value);
                              localStorage.setItem('sls_download_concurrency', String(opt.value));
                            }}
                            className={`px-2 py-1 rounded text-xs font-semibold transition flex items-center gap-1 ${
                              concurrency === opt.value
                                ? 'bg-amber-500 text-slate-950 shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {opt.tag && (
                              <span className={`text-[9px] px-1 py-0.2 rounded font-normal ${
                                concurrency === opt.value
                                  ? 'bg-amber-600 text-slate-950 font-bold'
                                  : 'bg-slate-800 text-slate-500'
                              }`}>
                                {opt.tag}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Lựa chọn Cookies trình duyệt cho nguồn video mạng xã hội */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Cookies đăng nhập (Facebook / YouTube / Bilibili):</span>
                      </label>
                      <select
                        value={cookieSource}
                        onChange={(e) => {
                          setCookieSource(e.target.value);
                          localStorage.setItem('sls_cookie_source', e.target.value);
                        }}
                        className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 text-indigo-300 font-medium text-xs rounded-lg focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="none">Tự động nhận diện (Khuyên dùng)</option>
                        <option value="chrome">Google Chrome</option>
                        <option value="edge">Microsoft Edge</option>
                        <option value="firefox">Mozilla Firefox</option>
                      </select>
                    </div>
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

                        {proxyUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setProxyUrl('');
                              localStorage.removeItem('sls_proxy_url');
                              setProxyTestResult(null);
                            }}
                            disabled={isRunning}
                            className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold rounded-lg transition border border-slate-700"
                            title="Xóa proxy để tải trực tiếp bằng mạng Internet của máy"
                          >
                            Xóa
                          </button>
                        )}
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

                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-cyan-400">
                    {taskStatus.progress_percent?.toFixed(1)}%
                  </span>
                  {(taskStatus.status === 'completed' || taskStatus.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => setTaskStatus(null)}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800/80 transition-colors"
                      title="Đóng thông báo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
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
          )}

          {/* TAB 2: TÌM KIẾM VIDEO TRÊN BILIBILI (0 CẦN NICK) */}
          {modalTab === 'search' && (
            <div className="space-y-4 animate-in fade-in">
              {/* Thanh tìm kiếm */}
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold text-white">Tìm Kiếm Video & Phim Ngắn Bilibili</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Chế độ Khách (Guest Fingerprint + Wbi): 0 Cần Nick</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSearchVideos();
                    }}
                    placeholder="Nhập từ khóa tìm kiếm (Ví dụ: 短剧, phim ngắn, anime, vlog, review...)"
                    className="flex-1 px-3.5 py-2.5 bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none transition"
                  />
                  <button
                    onClick={() => handleSearchVideos()}
                    disabled={isSearching || !searchKeyword.trim()}
                    className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 flex-shrink-0 active:scale-95"
                  >
                    {isSearching ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang tìm...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        <span>Tìm Kiếm</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Từ khóa gợi ý nhanh */}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Gợi ý:
                  </span>
                  {['短剧 (Phim ngắn)', '逆袭', '战神', '都市', '仙侠', 'Hoạt hình', 'Review Phim'].map((tag) => {
                    const cleanTag = tag.split(' ')[0];
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleSearchVideos(cleanTag)}
                        className="px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] text-slate-300 hover:text-cyan-300 transition"
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Lỗi tìm kiếm nếu có */}
              {searchError && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>{searchError}</span>
                </div>
              )}

              {/* Danh sách kết quả tìm kiếm */}
              {isSearching ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-slate-800 rounded-2xl bg-slate-950/40 space-y-3">
                  <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                  <p className="text-xs text-slate-300 font-medium">Đang ký chữ ký bảo mật Wbi & tìm kiếm video trên Bilibili...</p>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[480px] overflow-y-auto pr-1">
                  {searchResults.map((item) => {
                    const cleanTitle = item.title.replace(/<[^>]+>/g, '');
                    const cleanPic = item.pic.startsWith('//') ? `https:${item.pic}` : item.pic;
                    return (
                      <div
                        key={item.id || item.bvid}
                        className="p-2.5 bg-slate-950/70 hover:bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl transition flex gap-3 group"
                      >
                        <div className="relative w-28 h-20 flex-shrink-0 overflow-hidden rounded-lg bg-slate-900 border border-slate-800">
                          {cleanPic ? (
                            <img
                              src={cleanPic}
                              alt={cleanTitle}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600">
                              <Film className="w-6 h-6" />
                            </div>
                          )}
                          {item.duration && (
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.2 bg-black/80 rounded text-[9px] font-mono text-white font-medium">
                              {item.duration}
                            </span>
                          )}
                        </div>

                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                          <div>
                            <h4 className="text-xs font-bold text-white line-clamp-2 leading-tight group-hover:text-cyan-300 transition" title={cleanTitle}>
                              {cleanTitle}
                            </h4>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                              <span className="truncate max-w-[120px]">{item.author}</span>
                              {item.play !== undefined && (
                                <span>{item.play > 10000 ? `${(item.play / 10000).toFixed(1)}vạn view` : `${item.play} view`}</span>
                              )}
                            </div>
                          </div>

                          <div className="pt-1.5 flex items-center justify-between">
                            <span className="text-[9px] font-mono text-slate-500">{item.bvid}</span>
                            <button
                              type="button"
                              onClick={() => handleSelectSearchResult(item)}
                              className="px-2.5 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600 border border-cyan-500/50 hover:border-cyan-400 text-cyan-200 hover:text-white text-[10px] font-bold flex items-center gap-1 transition active:scale-95 shadow-sm"
                            >
                              <Download className="w-3 h-3" />
                              <span>Tải & Phân tích</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/40 space-y-3">
                  <Search className="w-10 h-10 text-slate-600" />
                  <div className="space-y-1">
                    <h3 className="text-white font-bold text-xs">Sẵn sàng tìm kiếm video trên Bilibili</h3>
                    <p className="text-slate-400 text-[11px] max-w-sm">
                      Nhập từ khóa hoặc bấm chọn từ khóa gợi ý phía trên để bắt đầu tìm kiếm video trực tiếp.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: HÀNG ĐỢI TẢI PHIM */}
          {modalTab === 'queue' && (
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

          {/* TAB 4: TÀI KHOẢN & VIP / NỀN TẢNG */}
          {modalTab === 'auth' && (
            <div className="space-y-4 animate-in fade-in">
              {/* BANNER GIẢI ĐÁP QUAN TRỌNG: CHẾ ĐỘ 0 CẦN TÀI KHOẢN */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/50 via-slate-950 to-slate-900 border border-emerald-800/60 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Shield className="w-4 h-4" />
                  <h3 className="text-xs font-bold uppercase tracking-wider">
                    Khả Năng Hoạt Động Không Cần Tài Khoản (Zero-Account System)
                  </h3>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  <strong className="text-emerald-300">Không cần đăng nhập trước!</strong> Hệ thống đã được trang bị các thuật toán vượt rào và giả lập danh tính tự động, cho phép bạn tìm kiếm, xem trước và tải xuống trọn vẹn từ các nền tảng:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        Bilibili (B站)
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold">Tự động cấp Guest</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      Tự động tạo Dynamic Fingerprint (<code className="text-cyan-300 font-mono">buvid3/buvid4</code>) + Ký Wbi SHA-256. Tìm kiếm video, xem và tải 720p/480p không cần đăng nhập.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-rose-400" />
                        Xiaohongshu (Tiểu Hồng Thư)
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold">1080p Không Watermark</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      Trích xuất trực tiếp CDN ByteDance (<code className="text-rose-300 font-mono">originVideoKey</code>), tải video 1080p sạch không dính logo watermark, 0 cần tài khoản.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        Hồng Quả (Hongguo)
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold">100% Mở Khóa VIP</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      Cơ chế thiết bị di động ảo hóa (<code className="text-amber-300 font-mono">device_register</code>) giải mã DRM CENC, tải trọn vẹn 100% tập khóa mà không cần đăng nhập.
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        YouTube & Douyin
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold">1080p - 4K Direct</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-tight">
                      Mô phỏng Web Embedded & Android Client qua yt-dlp + Node.js runtime, tải video chất lượng cao mà không cần đăng nhập tài khoản.
                    </p>
                  </div>
                </div>
              </div>

              {/* KHU VỰC ĐĂNG NHẬP NÂNG CAO CHO NGƯỜI CÓ TÀI KHOẢN HOẶC VIP */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Bilibili In-App QR Scan */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <QrCode className="w-4 h-4 text-cyan-400" />
                        <h4 className="text-xs font-bold text-white">Đăng Nhập Bilibili Bằng Mã QR</h4>
                      </div>
                      {authStatus?.platforms?.bilibili?.logged_in ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-bold">
                          Đã đăng nhập
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">
                          Chế độ Khách
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400">
                      {authStatus?.platforms?.bilibili?.logged_in
                        ? 'Tài khoản Bilibili đã được kết nối. Bạn có thể tải video chất lượng cao nhất (1080p 60fps / 4K) và nội dung VIP.'
                        : 'Quét mã QR bằng App Bilibili trên điện thoại để mở khóa chất lượng 1080p 60fps, 4K hoặc phim VIP.'}
                    </p>

                    {authStatus?.platforms?.bilibili?.logged_in ? (
                      <div className="p-3 bg-emerald-950/30 border border-emerald-800/40 rounded-xl space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300">Tên người dùng:</span>
                          <strong className="text-white">{authStatus.platforms.bilibili.user_name || 'Bilibili Member'}</strong>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-300">Cấp bậc VIP:</span>
                          <span className="font-semibold text-amber-300">{authStatus.platforms.bilibili.vip_status || 'Thường'}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeletePlatformCookie('bilibili')}
                          className="w-full mt-2 py-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Đăng Xuất / Xóa Cookie Bilibili</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3 pt-1">
                        {biliQrDataUrl ? (
                          <div className="flex flex-col items-center p-3 bg-white/5 border border-slate-800 rounded-xl space-y-2.5">
                            <img
                              src={biliQrDataUrl}
                              alt="Bilibili QR Code"
                              className="w-44 h-44 rounded-lg bg-white p-2 shadow-lg"
                            />
                            <div className="text-center space-y-1">
                              <p className={`text-xs font-semibold ${
                                biliQrStatusType === 'success' ? 'text-emerald-400' :
                                biliQrStatusType === 'scanned' ? 'text-amber-400' :
                                biliQrStatusType === 'expired' ? 'text-rose-400' : 'text-cyan-300'
                              }`}>
                                {biliQrStatusText}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                Mở app Bilibili &rarr; Nhấn biểu tượng Quét mã ở góc trên &rarr; Quét mã này
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={handleGenerateBilibiliQr}
                              disabled={isGeneratingQr}
                              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded-lg border border-slate-700 transition"
                            >
                              Làm mới mã QR
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handleGenerateBilibiliQr}
                            disabled={isGeneratingQr}
                            className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow transition flex items-center justify-center gap-2 active:scale-95"
                          >
                            <QrCode className="w-4 h-4" />
                            <span>{isGeneratingQr ? 'Đang tạo mã QR...' : 'Tạo Mã QR Đăng Nhập Bilibili'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Quản lý Cookie Thủ Công Cho Các Nền Tảng Khác */}
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Key className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-xs font-bold text-white">Quản Lý Cookie Nền Tảng (Tùy Chọn)</h4>
                      </div>
                      <button
                        type="button"
                        onClick={loadAuthStatus}
                        className="text-slate-400 hover:text-white p-1"
                        title="Tải lại trạng thái"
                      >
                        <RefreshCw className={`w-3 h-3 ${isLoadingAuth ? 'animate-spin text-indigo-400' : ''}`} />
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400">
                      Dán chuỗi Cookie từ trình duyệt nếu bạn muốn đăng nhập thủ công cho Douyin, Tiểu Hồng Thư, YouTube hoặc Bilibili:
                    </p>

                    <div className="space-y-2 pt-1">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-slate-300 font-semibold">Nền tảng:</label>
                        <select
                          value={customPlatform}
                          onChange={(e) => setCustomPlatform(e.target.value)}
                          className="px-2 py-1 bg-slate-900 border border-slate-700 text-xs text-white rounded-lg focus:outline-none"
                        >
                          <option value="bilibili">Bilibili</option>
                          <option value="douyin">Douyin</option>
                          <option value="xhs">Xiaohongshu (Tiểu Hồng Thư)</option>
                          <option value="youtube">YouTube</option>
                        </select>

                        <span className="text-[10px] text-slate-500 font-mono">
                          {authStatus?.platforms?.[customPlatform]?.logged_in ? (
                            <span className="text-emerald-400 font-semibold">● Đã có cookie</span>
                          ) : (
                            <span className="text-slate-500">○ Đang dùng Guest</span>
                          )}
                        </span>
                      </div>

                      <textarea
                        value={customCookieInput}
                        onChange={(e) => setCustomCookieInput(e.target.value)}
                        placeholder="Dán chuỗi Cookie (Ví dụ: SESSDATA=...; bili_jct=... hoặc cookie Netscape)..."
                        rows={3}
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-xl text-[11px] font-mono text-slate-200 placeholder-slate-600 focus:outline-none transition resize-none"
                      />

                      {cookieFeedback && (
                        <p className="text-[11px] text-emerald-400 font-medium">{cookieFeedback}</p>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleSavePlatformCookie}
                          disabled={isSavingCookie || !customCookieInput.trim()}
                          className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{isSavingCookie ? 'Đang lưu...' : 'Lưu Cookie'}</span>
                        </button>

                        {authStatus?.platforms?.[customPlatform]?.logged_in && (
                          <button
                            type="button"
                            onClick={() => handleDeletePlatformCookie(customPlatform)}
                            className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-lg text-xs font-semibold transition"
                            title="Xóa cookie nền tảng này"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal Actions */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            {modalTab === 'download' && (
              isRunning ? (
                <span className="text-amber-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Tiến trình chạy nền, bạn có thể đóng cửa sổ này bất cứ lúc nào.
                </span>
              ) : (
                <span>Lưu tại: <span className="font-mono text-slate-400">{outputDir}</span></span>
              )
            )}
            {modalTab === 'search' && (
              <span className="text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Tìm kiếm và tải video đa nền tảng.</span>
              </span>
            )}
            {modalTab === 'queue' && (
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-300">{queueTasks.length} tác vụ trong hàng đợi</span>
                <span className="text-slate-500">
                  {isQueuePaused ? '(Tạm dừng)' : '(Đang điều phối)'}
                </span>
              </span>
            )}
            {modalTab === 'auth' && (
              <span className="text-slate-400 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Đăng nhập tài khoản nền tảng khi cần tải chất lượng cao (1080p/4K).</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {modalTab === 'download' && (
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
            )}

            {modalTab === 'search' && (
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
                  <span>Dán Link Trực Tiếp</span>
                </button>
              </>
            )}

            {modalTab === 'queue' && (
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

            {modalTab === 'auth' && (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={loadAuthStatus}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAuth ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>Làm mới trạng thái</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('download')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Đến Tải Phim</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
