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
  Sparkles,
  Film,
  Shield,
  Wifi,
  Gauge,
  RefreshCw,
  Smartphone,
  Copy,
  Check,
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
  Filter,
  CheckSquare,
  Square,
  Globe,
  QrCode,
  User,
  Key,
  ChevronLeft,
  LayoutDashboard,
  Eye,
  MessageSquare,
  Clock,
  Flame,
  Activity,
} from 'lucide-react';
import { appLogger, useAppLoggerCount } from '../common/GlobalActivityLogger';

export interface VideoDownloaderHubProps {
  onSwitchToDashboard: () => void;
  onSwitchToStudio?: () => void;
  onRefreshProjects: () => void;
  onBatchProjectsCreated?: (newProjects: ProjectManifestV1[]) => void;
  initialTab?: 'search' | 'direct' | 'queue' | 'auth' | 'settings';
}

export const VideoDownloaderHub: React.FC<VideoDownloaderHubProps> = ({
  onSwitchToDashboard,
  onSwitchToStudio,
  onRefreshProjects,
  onBatchProjectsCreated,
  initialTab = 'search',
}) => {
  const loggerCount = useAppLoggerCount();
  // Tab điều hướng chính
  const [activeTab, setActiveTab] = useState<'search' | 'direct' | 'queue' | 'auth' | 'settings'>(initialTab);

  // =========================================================================
  // 1. STATE: DIRECT LINK / SERIES ID PLATFORMS
  // =========================================================================
  const [urlInput, setUrlInput] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [targetInfo, setTargetInfo] = useState<DownloadTargetInfo | null>(null);

  // Custom Output Directory
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

  // Episode Selector Grid & Disk Scan
  const [episodesStatus, setEpisodesStatus] = useState<Record<number, 'completed' | 'corrupted' | 'missing'>>({});
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [isScanningEpisodes, setIsScanningEpisodes] = useState(false);

  // Cover/Thumbnail download
  const [isDownloadingCover, setIsDownloadingCover] = useState(false);
  const [coverDownloadMsg, setCoverDownloadMsg] = useState<string | null>(null);

  // Queue actions & Running task
  const [isAddingToQueue, setIsAddingToQueue] = useState(false);
  const [taskStatus, setTaskStatus] = useState<DownloadTaskStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollTimerRef = useRef<any>(null);

  // Range and download options
  const [autoCreateProject, setAutoCreateProject] = useState(true);
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('vi');
  const [selectedResolution, setSelectedResolution] = useState<string>('best');

  // Multi-thread Concurrency & Browser Cookies
  const [concurrency, setConcurrency] = useState<number>(() => {
    const saved = localStorage.getItem('sls_download_concurrency');
    return saved ? parseInt(saved, 10) : 3;
  });
  const [cookieSource, setCookieSource] = useState<string>(() => {
    return localStorage.getItem('sls_cookie_source') || 'none';
  });

  // =========================================================================
  // 2. STATE: SEARCH-FIRST PLATFORMS (BILIBILI, YOUTUBE)
  // =========================================================================
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchPlatform, setSearchPlatform] = useState('bilibili');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<VideoSearchResultItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Advanced Search & Topic Filter states
  const [searchOrder, setSearchOrder] = useState<string>('totalrank');
  const [searchDuration, setSearchDuration] = useState<number>(0);
  const [mustContain, setMustContain] = useState<string>('');
  const [mustNotContain, setMustNotContain] = useState<string>('');
  const [autoTranslateQuery, setAutoTranslateQuery] = useState<boolean>(true);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

  // Multi-select Batch Download from Search
  const [selectedSearchIds, setSelectedSearchIds] = useState<string[]>([]);
  const [isBatchAdding, setIsBatchAdding] = useState<boolean>(false);

  // =========================================================================
  // 3. STATE: SEQUENTIAL QUEUE
  // =========================================================================
  const [queueTasks, setQueueTasks] = useState<DownloadQueueTaskItem[]>([]);
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [queueActionMsg, setQueueActionMsg] = useState<string | null>(null);

  // =========================================================================
  // 4. STATE: PLATFORM AUTH & IN-APP QR
  // =========================================================================
  const [authStatus, setAuthStatus] = useState<PlatformAuthStatusResponse | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [biliQrDataUrl, setBiliQrDataUrl] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [biliQrStatusText, setBiliQrStatusText] = useState<string | null>(null);
  const [biliQrStatusType, setBiliQrStatusType] = useState<'waiting' | 'scanned' | 'success' | 'expired' | 'error' | null>(null);
  const qrPollIntervalRef = useRef<any>(null);

  // Manual Cookie Management
  const [customPlatform, setCustomPlatform] = useState<string>('bilibili');
  const [customCookieInput, setCustomCookieInput] = useState('');
  const [isSavingCookie, setIsSavingCookie] = useState(false);
  const [cookieFeedback, setCookieFeedback] = useState<string | null>(null);

  // =========================================================================
  // 5. STATE: DEVICE SETTINGS & PROXY
  // =========================================================================
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem('sls_proxy_url') || '');
  const [rateLimitDelay, setRateLimitDelay] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rate_limit_delay');
    return saved ? parseFloat(saved) : 2.0;
  });
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; ip?: string; latency_ms?: number; error?: string } | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);

  // Device identity
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

  // =========================================================================
  // DATA ESTIMATION
  // =========================================================================
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

  // Nhận diện nền tảng theo URL tự động
  const detectedPlatformInfo = useMemo(() => {
    const raw = urlInput.trim().toLowerCase();
    if (!raw) return null;
    if (raw.includes('novel.snssdk.com') || raw.includes('fanqienovel.com') || raw.includes('series_id=')) {
      return { name: 'Hồng Quả Short Drama', badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60', category: 'direct' };
    }
    if (raw.includes('bilibili.com') || raw.includes('b23.tv') || raw.startsWith('bv') || raw.startsWith('av')) {
      return { name: 'Bilibili Video (B站)', badgeClass: 'bg-sky-950/80 text-sky-300 border-sky-700/60', category: 'search_direct' };
    }
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) {
      return { name: 'YouTube Video / Playlist', badgeClass: 'bg-rose-950/80 text-rose-300 border-rose-700/60', category: 'direct' };
    }
    if (raw.includes('xiaohongshu.com') || raw.includes('xhslink.com')) {
      return { name: 'Xiaohongshu 1080p (Không Logo)', badgeClass: 'bg-red-950/80 text-red-300 border-red-700/60', category: 'direct' };
    }
    if (raw.includes('douyin.com') || raw.includes('iesdouyin.com') || raw.includes('tiktok.com')) {
      return { name: 'Douyin / TikTok (Không Logo)', badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-700/60', category: 'direct' };
    }
    if (raw.includes('.m3u8') || raw.includes('.mp4')) {
      return { name: 'Stream Trực Tiếp HLS / MP4', badgeClass: 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60', category: 'direct' };
    }
    return { name: 'Đường dẫn phổ thông / Đa nguồn', badgeClass: 'bg-slate-800 text-slate-300 border-slate-700', category: 'direct' };
  }, [urlInput]);

  // =========================================================================
  // INITIALIZATION & POLLING
  // =========================================================================
  useEffect(() => {
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

    const queueInterval = setInterval(() => {
      fetchQueueTasks(true);
    }, 2500);

    return () => {
      stopPolling();
      clearInterval(queueInterval);
      stopBiliQrPolling();
    };
  }, []);

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

  // =========================================================================
  // SEARCH IMPLEMENTATION
  // =========================================================================
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
    setSelectedSearchIds([]);
    try {
      const res = await apiClient.searchVideos(keyword, searchPlatform, 1, {
        order: searchOrder,
        duration: searchDuration,
        must_contain: mustContain.trim() || undefined,
        must_not_contain: mustNotContain.trim() || undefined,
        auto_translate: autoTranslateQuery,
        translate_titles: true,
      });
      setSearchResults(res.results || []);
      if (!res.results || res.results.length === 0) {
        setSearchError('Không tìm thấy video nào phù hợp với từ khóa và bộ lọc.');
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Lỗi khi tìm kiếm video.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleSelectSearchItem = (id: string) => {
    setSelectedSearchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllSearchResults = () => {
    setSelectedSearchIds(searchResults.map((r) => r.id || r.bvid || r.url));
  };

  const handleDeselectAllSearchResults = () => {
    setSelectedSearchIds([]);
  };

  const handleBatchAddSearchToQueue = async () => {
    if (selectedSearchIds.length === 0) return;
    const selectedItems = searchResults.filter((r) =>
      selectedSearchIds.includes(r.id || r.bvid || r.url)
    );
    if (selectedItems.length === 0) return;

    setIsBatchAdding(true);
    let successCount = 0;

    for (const item of selectedItems) {
      const videoUrl = item.url || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '');
      if (!videoUrl) continue;
      try {
        const parsedTarget = await apiClient.parseDownloadTarget(videoUrl);
        await apiClient.addToQueue({
          target_info: parsedTarget,
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
        successCount++;
      } catch (e: any) {
        console.warn(`Lỗi thêm video ${item.title} vào queue:`, e);
      }
    }

    setIsBatchAdding(false);
    showQueueFeedback(`Đã thêm thành công ${successCount}/${selectedItems.length} video vào hàng đợi tải!`);
    fetchQueueTasks(false);
    setSelectedSearchIds([]);
  };

  const handleSelectSearchResult = (item: VideoSearchResultItem) => {
    const link = item.url || item.arcurl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '');
    if (!link) return;
    setUrlInput(link);
    setActiveTab('direct');
    handleParse(link);
  };

  // =========================================================================
  // DIRECT PARSE & DOWNLOAD IMPLEMENTATION
  // =========================================================================
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
      if (episodesStatus[i] !== 'completed') {
        missingOrError.push(i);
      }
    }
    setSelectedEpisodes(missingOrError);
  };

  const handleDeselectAll = () => {
    setSelectedEpisodes([]);
  };

  const handleDownloadCover = async () => {
    if (!targetInfo?.cover_url) return;
    setIsDownloadingCover(true);
    setCoverDownloadMsg(null);
    try {
      const res = await apiClient.downloadCover(targetInfo.cover_url, outputDir.trim() || undefined);
      if (res.success) {
        setCoverDownloadMsg(`Đã lưu ảnh bìa: ${res.file_path || 'Thành công'}`);
      } else {
        setCoverDownloadMsg(res.message || 'Lỗi lưu ảnh bìa');
      }
    } catch (err: any) {
      setCoverDownloadMsg(`Lỗi tải ảnh bìa: ${err?.message}`);
    } finally {
      setIsDownloadingCover(false);
      setTimeout(() => setCoverDownloadMsg(null), 5000);
    }
  };

  const handleAddToQueue = async () => {
    if (!targetInfo) return;
    setIsAddingToQueue(true);

    const sortedEps = [...selectedEpisodes].sort((a, b) => a - b);
    const actualStart = sortedEps.length > 0 ? sortedEps[0] : 1;
    const actualEnd = sortedEps.length > 0 ? sortedEps[sortedEps.length - 1] : targetInfo.total_episodes;

    localStorage.setItem('sls_proxy_url', proxyUrl);
    localStorage.setItem('sls_rate_limit_delay', String(rateLimitDelay));
    localStorage.setItem('sls_rotation_interval', String(rotationInterval));
    localStorage.setItem('sls_download_concurrency', String(concurrency));
    localStorage.setItem('sls_cookie_source', cookieSource);

    try {
      const res = await apiClient.addToQueue({
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
      showQueueFeedback(`Đã thêm "${targetInfo.title}" (${selectedEpisodes.length} tập) vào hàng đợi tải (Vị trí #${res.position})!`);
      setActiveTab('queue');
      fetchQueueTasks(false);
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
    setCoverDownloadMsg(null);

    try {
      const res = await apiClient.parseDownloadTarget(raw);
      setTargetInfo(res);

      if (res.resolutions && res.resolutions.length > 0) {
        setSelectedResolution(res.resolutions[0].id);
      } else {
        setSelectedResolution('best');
      }

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

    localStorage.setItem('sls_proxy_url', proxyUrl);
    localStorage.setItem('sls_rate_limit_delay', String(rateLimitDelay));
    localStorage.setItem('sls_rotation_interval', String(rotationInterval));
    localStorage.setItem('sls_download_concurrency', String(concurrency));
    localStorage.setItem('sls_cookie_source', cookieSource);

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

      setActiveTab('queue');
      fetchQueueTasks(false);

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
    if (!proxyUrl.trim()) {
      alert('Vui lòng nhập URL Proxy trước khi kiểm tra.');
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const res = await apiClient.testProxy(proxyUrl.trim());
      setProxyTestResult(res);
    } catch (err: any) {
      setProxyTestResult({
        ok: false,
        error: err?.message || 'Lỗi kết nối kiểm tra proxy',
      });
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleCancelTask = async () => {
    try {
      await apiClient.cancelDownload();
      stopPolling();
      setTaskStatus((prev) => (prev ? { ...prev, status: 'cancelled', message: 'Người dùng đã hủy tiến trình tải' } : null));
    } catch (err: any) {
      alert(`Lỗi hủy tác vụ: ${err?.message}`);
    }
  };

  const handleQuickPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text.trim());
        handleParse(text.trim());
      }
    } catch {
      alert('Không thể đọc từ bộ nhớ tạm, vui lòng dán thủ công bằng Ctrl+V.');
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER THỐNG NHẤT */}
      {/* ========================================================================= */}
      <header className="h-12 shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-4 flex items-center justify-between z-40">
        {/* Trái: Quay lại Dashboard + Studio + Brand Hub */}
        <div className="flex items-center gap-3">
          <button
            onClick={onSwitchToDashboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-semibold shadow transition active:scale-95"
            title="Quay lại Dashboard"
          >
            <ChevronLeft className="w-4 h-4" />
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          {onSwitchToStudio && (
            <button
              onClick={onSwitchToStudio}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold shadow transition active:scale-95"
              title="Vào Studio"
            >
              <Film className="w-3.5 h-3.5 text-indigo-400" />
              <span>Studio</span>
            </button>
          )}

          <div className="h-5 w-px bg-slate-800 mx-1" />

          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-lg text-white shadow">
              <Globe className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs font-bold text-white tracking-wide uppercase">
                Tải Video Đa Nền Tảng
              </h1>
              <span className="px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-500/40 text-[9px] font-bold text-emerald-400 font-mono">
                PRO
              </span>
            </div>
          </div>
        </div>

        {/* Phải: Trạng thái Hàng đợi + Server + Nhật Ký */}
        <div className="flex items-center gap-2.5">
          {/* Concurrency badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Đa luồng: <strong>{concurrency}x</strong></span>
          </div>

          {/* Queue Count */}
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition active:scale-95 ${
              activeTaskId
                ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 animate-pulse'
                : queueTasks.length > 0
                ? 'bg-indigo-950/80 border-indigo-700/60 text-indigo-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            <span>
              Hàng đợi: <strong>{queueTasks.length}</strong>
            </span>
          </button>

          {/* Nút Nhật ký đồng bộ */}
          <button
            onClick={() => appLogger.toggle()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition cursor-pointer shadow-sm active:scale-95"
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

          {/* Server live indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="font-semibold">Engine Sẵn Sàng</span>
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. THANH SUB-TAB PHÂN LOẠI NỀN TẢNG (SEGMENTED TABS) */}
      {/* ========================================================================= */}
      <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {/* TAB 1: SEARCH-FIRST (BILIBILI) */}
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm ${
              activeTab === 'search'
                ? 'bg-sky-600 text-white shadow-sky-600/30 ring-1 ring-sky-400'
                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60'
            }`}
          >
            <Search className="w-4 h-4 text-sky-300" />
            <span>Tìm Kiếm</span>
            <span className="px-1.5 py-0.2 rounded bg-sky-950/70 border border-sky-400/40 text-[10px] font-bold text-sky-300">
              Bilibili Wbi
            </span>
          </button>

          {/* TAB 2: DIRECT LINK / SERIES ID */}
          <button
            onClick={() => setActiveTab('direct')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm ${
              activeTab === 'direct'
                ? 'bg-emerald-600 text-white shadow-emerald-600/30 ring-1 ring-emerald-400'
                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60'
            }`}
          >
            <Link className="w-4 h-4 text-emerald-300" />
            <span>Dán Link</span>
            <span className="px-1.5 py-0.2 rounded bg-emerald-950/70 border border-emerald-400/40 text-[10px] font-bold text-emerald-300">
              Hồng Quả, YouTube, XHS
            </span>
          </button>

          {/* TAB 3: QUEUE */}
          <button
            onClick={() => setActiveTab('queue')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm ${
              activeTab === 'queue'
                ? 'bg-indigo-600 text-white shadow-indigo-600/30 ring-1 ring-indigo-400'
                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60'
            }`}
          >
            <ListPlus className="w-4 h-4 text-indigo-300" />
            <span>Hàng Đợi</span>
            {queueTasks.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-400 text-slate-950 text-[10px] font-bold">
                {queueTasks.length}
              </span>
            )}
          </button>

          {/* TAB 4: AUTH & VIP */}
          <button
            onClick={() => setActiveTab('auth')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm ${
              activeTab === 'auth'
                ? 'bg-purple-600 text-white shadow-purple-600/30 ring-1 ring-purple-400'
                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60'
            }`}
          >
            <Shield className="w-4 h-4 text-purple-300" />
            <span>Tài Khoản & Cookie</span>
          </button>

          {/* TAB 5: SETTINGS */}
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm ${
              activeTab === 'settings'
                ? 'bg-slate-700 text-white shadow-slate-700/30 ring-1 ring-slate-500'
                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60'
            }`}
          >
            <Sliders className="w-4 h-4 text-slate-300" />
            <span>Thiết Bị & Proxy</span>
          </button>
        </div>

        {/* Thông báo thao tác hàng đợi nếu có */}
        {queueActionMsg && (
          <div className="flex items-center gap-1.5 text-xs text-indigo-300 bg-indigo-950/80 border border-indigo-700/50 px-3 py-1 rounded-full animate-in fade-in">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>{queueActionMsg}</span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. KHU VỰC NỘI DUNG CHÍNH (CUỘN ĐỘC LẬP) */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* ======================================================================= */}
        {/* PHÂN LOẠI 1: TÌM KIẾM TRƯỚC KHI TẢI (SEARCH-FIRST PLATFORMS) */}
        {/* ======================================================================= */}
        {activeTab === 'search' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Thanh Tìm Kiếm Gọn Gàng */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-lg">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-white tracking-wide uppercase">Tìm Kiếm Trực Tiếp</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-sky-950/70 border border-sky-400/40 text-[10px] font-bold text-sky-300">
                    Bilibili (B站 Wbi)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-semibold text-slate-300">
                    YouTube Search
                  </span>
                </div>
              </div>

              {/* Hộp Tìm Kiếm Lớn */}
              <div className="mt-5 flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearchVideos()}
                    placeholder="Nhập tên phim, từ khóa anime, review phim ngắn, bvid (Ví dụ: 短剧, 动漫, 影视解说, BV1xx...)..."
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 shadow-inner"
                  />
                </div>

                <select
                  value={searchPlatform}
                  onChange={(e) => setSearchPlatform(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-sky-300 font-semibold focus:outline-none focus:border-sky-500"
                >
                  <option value="bilibili">Nền tảng: Bilibili (B站 Wbi)</option>
                  <option value="youtube">Nền tảng: YouTube Search</option>
                </select>

                <button
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
                    showAdvancedFilters
                      ? 'bg-sky-950 border-sky-500 text-sky-300 shadow-inner'
                      : 'bg-slate-950 border-slate-700/80 text-slate-400 hover:text-slate-200'
                  }`}
                  title="Bộ lọc nâng cao & Dịch thuật"
                >
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span className="hidden sm:inline">Bộ lọc</span>
                </button>

                <button
                  onClick={() => handleSearchVideos()}
                  disabled={isSearching || !searchKeyword.trim()}
                  className="w-full sm:w-auto px-5 py-2.5 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-lg shadow-sky-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {isSearching ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang tìm kiếm...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Tìm Kiếm Ngay</span>
                    </>
                  )}
                </button>
              </div>

              {/* Bảng Bộ Lọc Nâng Cao (Advanced Filters Panel) */}
              {showAdvancedFilters && (
                <div className="mt-4 p-4 bg-slate-950/80 border border-sky-900/40 rounded-xl space-y-3.5 shadow-inner">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-semibold text-sky-300">
                    <span className="flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-sky-400" />
                      Bộ Lọc Tìm Kiếm Chuyên Sâu &amp; Tự Động Dịch
                    </span>
                    <span className="text-[11px] text-slate-400 font-normal">
                      Hỗ trợ Bilibili &amp; YouTube
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    {/* Sắp xếp thứ tự (Order) */}
                    <div>
                      <label className="block text-slate-400 text-[11px] font-medium mb-1">Thứ tự sắp xếp (Order)</label>
                      <select
                        value={searchOrder}
                        onChange={(e) => setSearchOrder(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                      >
                        <option value="totalrank">Mặc định (Toàn diện)</option>
                        <option value="click">Lượt xem nhiều nhất (Click)</option>
                        <option value="pubdate">Mới nhất (Ngày đăng)</option>
                        <option value="dm">Nhiều bình luận nhất (Danmaku)</option>
                      </select>
                    </div>

                    {/* Thời lượng (Duration) */}
                    <div>
                      <label className="block text-slate-400 text-[11px] font-medium mb-1">Thời lượng (Duration)</label>
                      <select
                        value={searchDuration}
                        onChange={(e) => setSearchDuration(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                      >
                        <option value={0}>Tất cả thời lượng</option>
                        <option value={1}>Dưới 10 phút (&lt;10m)</option>
                        <option value={2}>Từ 10 - 30 phút (10-30m)</option>
                        <option value={3}>Từ 30 - 60 phút (30-60m)</option>
                        <option value={4}>Trên 60 phút (&gt;60m)</option>
                      </select>
                    </div>

                    {/* Tự động dịch truy vấn VN -> ZH */}
                    <div className="flex flex-col justify-end">
                      <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-900/60 rounded-lg border border-slate-800 hover:border-slate-700 transition">
                        <input
                          type="checkbox"
                          checked={autoTranslateQuery}
                          onChange={(e) => setAutoTranslateQuery(e.target.checked)}
                          className="rounded border-slate-700 text-sky-600 focus:ring-0 w-3.5 h-3.5 bg-slate-950"
                        />
                        <span className="text-[11px] text-slate-300">
                          Tự dịch từ khóa <strong>Việt ➔ Trung</strong> khi tìm
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Hàng 2: Bộ lọc chủ đề Must Contain / Must Not Contain */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                    <div>
                      <label className="block text-slate-400 text-[11px] font-medium mb-1">
                        Từ khóa bắt buộc có trong tiêu đề (cách nhau bởi dấu phẩy):
                      </label>
                      <input
                        type="text"
                        value={mustContain}
                        onChange={(e) => setMustContain(e.target.value)}
                        placeholder="VD: 4k, vietsub, tập 1..."
                        className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-[11px] font-medium mb-1">
                        Từ khóa loại trừ / né tránh (cách nhau bởi dấu phẩy):
                      </label>
                      <input
                        type="text"
                        value={mustNotContain}
                        onChange={(e) => setMustNotContain(e.target.value)}
                        placeholder="VD: preview, trailer, cut..."
                        className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Thẻ Gợi Ý Từ Khóa Hot (Quick Tags) */}
              <div className="mt-3.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400 text-[11px] flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  Từ khóa hot:
                </span>
                {[
                  { label: '短剧 (Phim ngắn)', kw: '短剧' },
                  { label: '动漫 (Anime hot)', kw: '动漫' },
                  { label: '影视解说 (Review phim)', kw: '影视解说' },
                  { label: '搞笑 (Hài kịch)', kw: '搞笑' },
                  { label: '科幻电影 (Sci-Fi)', kw: '科幻电影' },
                  { label: '纪录片 (Tài liệu)', kw: '纪录片' },
                ].map((item) => (
                  <button
                    key={item.kw}
                    onClick={() => handleSearchVideos(item.kw)}
                    className="px-2.5 py-1 bg-slate-950/70 hover:bg-sky-950 hover:border-sky-500/50 border border-slate-800 rounded-lg text-[11px] text-slate-300 hover:text-sky-300 transition"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Thông Báo Lỗi Hoặc Trạng Thái Tìm Kiếm */}
            {searchError && (
              <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{searchError}</span>
              </div>
            )}

            {/* Lưới Kết Quả Tìm Kiếm (Video Cards Grid) */}
            {searchResults.length > 0 && (
              <div className="space-y-3">
                {/* Thanh Công Cụ Đa Chọn & Tác Vụ Hàng Loạt (Batch Toolbar) */}
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (selectedSearchIds.length === searchResults.length) {
                          handleDeselectAllSearchResults();
                        } else {
                          handleSelectAllSearchResults();
                        }
                      }}
                      className="flex items-center gap-1.5 text-slate-300 hover:text-white font-medium transition"
                    >
                      {selectedSearchIds.length === searchResults.length && searchResults.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-sky-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )}
                      <span>
                        {selectedSearchIds.length === searchResults.length && searchResults.length > 0
                          ? 'Bỏ chọn tất cả'
                          : `Chọn tất cả (${searchResults.length} video)`}
                      </span>
                    </button>

                    {selectedSearchIds.length > 0 && (
                      <span className="bg-sky-950 border border-sky-800/80 text-sky-300 font-bold px-2 py-0.5 rounded-full text-[11px]">
                        Đã chọn {selectedSearchIds.length}/{searchResults.length}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBatchAddSearchToQueue}
                      disabled={selectedSearchIds.length === 0 || isBatchAdding}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-lg shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {isBatchAdding ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Đang nạp vào hàng đợi...</span>
                        </>
                      ) : (
                        <>
                          <ListPlus className="w-3.5 h-3.5" />
                          <span>Thêm {selectedSearchIds.length > 0 ? selectedSearchIds.length : ''} video đã chọn vào Hàng Đợi Tải</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {searchResults.map((item, idx) => {
                    const itemId = item.id || item.bvid || item.url || String(idx);
                    const isSelected = selectedSearchIds.includes(itemId);
                    const isDownloaded = Boolean(item.downloaded);

                    return (
                      <div
                        key={itemId}
                        className={`group bg-slate-900 border ${
                          isSelected ? 'border-sky-500 ring-1 ring-sky-500/50' : 'border-slate-800 hover:border-sky-500/60'
                        } rounded-xl overflow-hidden shadow-lg transition-all duration-200 flex flex-col justify-between`}
                      >
                        {/* Thumbnail Container */}
                        <div className="relative aspect-video bg-slate-950 overflow-hidden">
                          {item.pic ? (
                            <img
                              src={item.pic.startsWith('//') ? `https:${item.pic}` : item.pic}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-700">
                              <Film className="w-8 h-8" />
                            </div>
                          )}

                          {/* Selection Checkbox (Top-Left) */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSelectSearchItem(itemId);
                            }}
                            className="absolute top-2 left-2 z-10 p-1 bg-slate-950/80 hover:bg-slate-900 rounded-md border border-slate-700 text-white transition active:scale-95"
                            title={isSelected ? 'Bỏ chọn video này' : 'Chọn video này để tải hàng loạt'}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-sky-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 hover:text-white" />
                            )}
                          </button>

                          {/* Downloaded Badge (Top-Right) */}
                          {isDownloaded ? (
                            <div className="absolute top-2 right-2 z-10 bg-emerald-600/90 text-white font-bold text-[10px] px-2 py-0.5 rounded shadow border border-emerald-400/50 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              <span>ĐÃ TẢI</span>
                            </div>
                          ) : item.bvid ? (
                            <div className="absolute top-2 right-2 bg-sky-950/80 border border-sky-600/60 text-sky-300 font-mono text-[9px] px-1.5 py-0.5 rounded">
                              {item.bvid}
                            </div>
                          ) : null}

                          {/* Thời lượng (Bottom-Right) */}
                          {item.duration && (
                            <div className="absolute bottom-2 right-2 bg-slate-950/90 text-white font-mono text-[10px] px-1.5 py-0.5 rounded border border-slate-700/60 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5 text-sky-400" />
                              <span>{item.duration}</span>
                            </div>
                          )}
                        </div>

                        {/* Video Info */}
                        <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                          <div>
                            {/* Tiêu đề tiếng Việt dịch tự động nếu có */}
                            {item.title_vi && item.title_vi !== item.title ? (
                              <div>
                                <h3
                                  className="text-xs font-bold text-white line-clamp-2 leading-snug group-hover:text-sky-300 transition-colors"
                                  title={item.title_vi}
                                >
                                  {item.title_vi}
                                </h3>
                                <div
                                  className="text-[11px] text-slate-400 line-clamp-1 italic mt-1 flex items-center gap-1"
                                  title={item.title}
                                >
                                  <Globe className="w-3 h-3 text-slate-500 shrink-0" />
                                  <span dangerouslySetInnerHTML={{ __html: item.title }} />
                                </div>
                              </div>
                            ) : (
                              <h3
                                className="text-xs font-semibold text-white line-clamp-2 leading-snug group-hover:text-sky-300 transition-colors"
                                dangerouslySetInnerHTML={{ __html: item.title }}
                              />
                            )}

                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                              <User className="w-3 h-3 text-slate-500" />
                              <span className="truncate">{item.author || (searchPlatform === 'youtube' ? 'Kênh YouTube' : 'Tác giả Bilibili')}</span>
                            </div>
                          </div>

                          {/* Meta: Views & Danmaku */}
                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                            <div className="flex items-center gap-2">
                              {item.play && (
                                <span className="flex items-center gap-1" title="Lượt xem">
                                  <Eye className="w-3 h-3 text-slate-500" />
                                  {typeof item.play === 'number' ? item.play.toLocaleString() : item.play}
                                </span>
                              )}
                              {item.danmaku && (
                                <span className="flex items-center gap-1" title="Bình luận chạy (Danmaku)">
                                  <MessageSquare className="w-3 h-3 text-slate-500" />
                                  {typeof item.danmaku === 'number' ? item.danmaku.toLocaleString() : item.danmaku}
                                </span>
                              )}
                            </div>

                            {item.pubdate && (
                              <span className="text-slate-500 font-mono text-[9px]">
                                {new Date(item.pubdate * 1000).toLocaleDateString('vi-VN')}
                              </span>
                            )}
                          </div>

                          {/* Action Button */}
                          <button
                            onClick={() => handleSelectSearchResult(item)}
                            className="w-full mt-2 py-1.5 bg-sky-950 hover:bg-sky-600 border border-sky-700/60 hover:border-sky-500 text-sky-300 hover:text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 shadow"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Chọn & Nạp Tải Ngay</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================================= */}
        {/* PHÂN LOẠI 2: DÁN LINK / SERIES ID TRỰC TIẾP (DIRECT LINK PLATFORMS) */}
        {/* ======================================================================= */}
        {activeTab === 'direct' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Thanh Dán Link Gọn Gàng */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-lg space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Link className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white tracking-wide uppercase">Dán Link / Series ID</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-300 font-semibold">Hồng Quả</span>
                  <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-500/30 text-rose-300 font-semibold">YouTube</span>
                  <span className="px-2 py-0.5 rounded bg-red-950/70 border border-red-500/30 text-red-300 font-semibold">Tiểu Hồng Thư</span>
                  <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-500/30 text-amber-300 font-semibold">Douyin</span>
                </div>
              </div>

              {/* Ô Nhập Link & Nhận Diện Tự Động */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="relative flex-1 w-full">
                    <Link className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleParse()}
                      placeholder="Dán link phim Hồng Quả (novel.snssdk.com), YouTube, Xiaohongshu (xhslink.com), Douyin hoặc m3u8..."
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-24 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 shadow-inner"
                    />
                    <button
                      onClick={handleQuickPaste}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                    >
                      Dán Link
                    </button>
                  </div>

                  <button
                    onClick={() => handleParse()}
                    disabled={isParsing || !urlInput.trim()}
                    className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                  >
                    {isParsing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Đang phân tích...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Phân Tích Video</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Badge Nhận Diện Nền Tảng Tự Động */}
                {detectedPlatformInfo && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400 text-[11px]">Tự động nhận diện:</span>
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${detectedPlatformInfo.badgeClass}`}>
                      {detectedPlatformInfo.name}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Parse Error Alert */}
            {parseError && (
              <div className="p-4 bg-rose-950/40 border border-rose-800/60 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{parseError}</span>
              </div>
            )}

            {/* Target Information & Download Configuration Panel */}
            {targetInfo && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
                {/* CỘT TRÁI (5 Cột): Poster, Thông Tin, Độ Phân Giải, Cấu Hình Tải */}
                <div className="lg:col-span-5 space-y-5">
                  {/* Card Thông Tin Video / Phim */}
                  <div className="flex gap-4 items-start bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                    <div className="relative w-24 h-32 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 shadow">
                      {targetInfo.cover_url ? (
                        <img
                          src={targetInfo.cover_url}
                          alt={targetInfo.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-700">
                          <Film className="w-8 h-8" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.2 rounded bg-indigo-950 border border-indigo-500/40 text-[10px] font-bold text-indigo-300 uppercase">
                          {targetInfo.platform}
                        </span>
                        <span className="px-2 py-0.2 rounded bg-emerald-950 border border-emerald-500/40 text-[10px] font-bold text-emerald-300">
                          {targetInfo.total_episodes} tập
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-white line-clamp-2 leading-snug">
                        {targetInfo.title}
                      </h3>

                      {targetInfo.author && (
                        <div className="text-xs text-slate-400 truncate">
                          Tác giả: <span className="text-slate-200">{targetInfo.author}</span>
                        </div>
                      )}

                      {/* Nút Tải Ảnh Bìa */}
                      {targetInfo.cover_url && (
                        <button
                          onClick={handleDownloadCover}
                          disabled={isDownloadingCover}
                          className="mt-1 flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] rounded-md transition"
                        >
                          <Image className="w-3 h-3 text-emerald-400" />
                          <span>{isDownloadingCover ? 'Đang tải...' : 'Lưu ảnh bìa'}</span>
                        </button>
                      )}
                      {coverDownloadMsg && (
                        <div className="text-[10px] text-emerald-400 mt-0.5">{coverDownloadMsg}</div>
                      )}
                    </div>
                  </div>

                  {/* BỘ CHỌN ĐỘ PHÂN GIẢI & TÍNH TOÁN DUNG LƯỢNG THỰC TẾ */}
                  <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Gauge className="w-4 h-4 text-emerald-400" />
                        Độ phân giải video:
                      </span>
                      {activeResItem?.size_mb ? (
                        <span className="text-[11px] font-mono text-emerald-400">
                          ~{activeResItem.size_mb.toFixed(1)} MB / tập
                        </span>
                      ) : null}
                    </div>

                    {targetInfo.resolutions && targetInfo.resolutions.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {targetInfo.resolutions.map((res) => (
                          <button
                            key={res.id}
                            onClick={() => setSelectedResolution(res.id)}
                            className={`p-2 rounded-lg border text-left text-xs transition ${
                              selectedResolution === res.id
                                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            <div className="font-bold">{res.label || res.id}</div>
                            {res.size_mb ? (
                              <div className="text-[10px] font-mono opacity-80">~{res.size_mb.toFixed(1)} MB</div>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">Độ phân giải mặc định (Tốt nhất theo nguồn)</div>
                    )}

                    {/* Dự toán tổng dung lượng */}
                    {totalEstimatedMb > 0 && (
                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-300 font-mono">
                        <span>Đã chọn {countSelected} tập:</span>
                        <span className="font-bold text-emerald-400">
                          ~{(totalEstimatedMb >= 1024 ? (totalEstimatedMb / 1024).toFixed(2) + ' GB' : totalEstimatedMb.toFixed(0) + ' MB')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* THƯ MỤC LƯU & QUYỀN GHI */}
                  <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 text-xs">
                    <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Folder className="w-4 h-4 text-amber-400" />
                      Thư mục lưu trữ:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={outputDir}
                        onChange={(e) => {
                          setOutputDir(e.target.value);
                          setDirValidation(null);
                        }}
                        onBlur={(e) => handleValidateDirectory(e.target.value)}
                        placeholder="uploads hoặc D:\Phim\..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-400 font-mono"
                      />
                      <button
                        onClick={() => handleValidateDirectory(outputDir)}
                        disabled={isValidatingDir}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition"
                      >
                        {isValidatingDir ? 'Kiểm tra...' : 'Kiểm tra'}
                      </button>
                    </div>
                    {dirValidation && (
                      <div className={`text-[11px] flex items-center gap-1 ${dirValidation.valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {dirValidation.valid ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        <span>{dirValidation.valid ? 'Thư mục hợp lệ, sẵn sàng ghi tệp' : dirValidation.error}</span>
                      </div>
                    )}
                  </div>

                  {/* CẤU HÌNH ĐA LUỒNG & COOKIE */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5">
                      <label className="font-semibold text-slate-300 flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        Đa luồng song song:
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={1}
                          max={8}
                          value={concurrency}
                          onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                          className="flex-1 accent-amber-400 cursor-pointer"
                        />
                        <span className="font-bold font-mono text-amber-400 w-6 text-right">{concurrency}x</span>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1.5">
                      <label className="font-semibold text-slate-300 flex items-center gap-1">
                        <Key className="w-3.5 h-3.5 text-sky-400" />
                        Cookie trình duyệt:
                      </label>
                      <select
                        value={cookieSource}
                        onChange={(e) => setCookieSource(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
                      >
                        <option value="none">Không dùng</option>
                        <option value="chrome">Google Chrome</option>
                        <option value="edge">Microsoft Edge</option>
                        <option value="firefox">Mozilla Firefox</option>
                        <option value="brave">Brave Browser</option>
                      </select>
                    </div>
                  </div>

                  {/* TÙY CHỌN DỰ ÁN & NGÔN NGỮ */}
                  <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoCreateProject}
                        onChange={(e) => setAutoCreateProject(e.target.checked)}
                        className="rounded accent-emerald-500 cursor-pointer"
                      />
                      <span className="font-semibold text-slate-200">
                        Tự động khởi tạo dự án trong Studio sau khi tải xong
                      </span>
                    </label>

                    {autoCreateProject && (
                      <div className="pt-1.5 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <label className="text-slate-400 block mb-0.5">Tiếng gốc:</label>
                          <select
                            value={sourceLang}
                            onChange={(e) => setSourceLang(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                          >
                            <option value="zh">Tiếng Trung (zh)</option>
                            <option value="en">Tiếng Anh (en)</option>
                            <option value="ja">Tiếng Nhật (ja)</option>
                            <option value="ko">Tiếng Hàn (ko)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-slate-400 block mb-0.5">Dịch sang:</label>
                          <select
                            value={targetLang}
                            onChange={(e) => setTargetLang(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                          >
                            <option value="vi">Tiếng Việt (vi)</option>
                            <option value="en">Tiếng Anh (en)</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CÁC NÚT HÀNH ĐỘNG CHÍNH */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                    <button
                      onClick={handleStartDownload}
                      disabled={isStarting || selectedEpisodes.length === 0}
                      className="w-full sm:flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Tải Ngay ({selectedEpisodes.length} tập)</span>
                    </button>

                    <button
                      onClick={handleAddToQueue}
                      disabled={isAddingToQueue || selectedEpisodes.length === 0}
                      className="w-full sm:flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                      <ListPlus className="w-4 h-4" />
                      <span>{isAddingToQueue ? 'Đang thêm...' : 'Thêm Vào Hàng Đợi'}</span>
                    </button>
                  </div>
                </div>

                {/* CỘT PHẢI (7 Cột): BỘ CHỌN TẬP PHIM (EPISODE SELECTOR GRID) */}
                <div className="lg:col-span-7 bg-slate-950/60 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Film className="w-4 h-4 text-emerald-400" />
                          Chọn Danh Sách Tập Cần Tải ({targetInfo.total_episodes} tập)
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Đã chọn: <strong className="text-emerald-400">{selectedEpisodes.length}</strong> / {targetInfo.total_episodes} tập
                        </p>
                      </div>

                      <button
                        onClick={() => scanDiskEpisodesForTarget(targetInfo.title, targetInfo.total_episodes, outputDir)}
                        disabled={isScanningEpisodes}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg flex items-center gap-1.5 transition self-start"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isScanningEpisodes ? 'animate-spin' : ''}`} />
                        <span>Quét tệp trên ổ cứng</span>
                      </button>
                    </div>

                    {/* Lưới các tập phim */}
                    <EpisodeSelectorGrid
                      totalEpisodes={targetInfo.total_episodes}
                      episodesStatus={episodesStatus}
                      selectedEpisodes={selectedEpisodes}
                      onToggleEpisode={handleToggleEpisode}
                      onSelectAll={handleSelectAll}
                      onSelectMissingOrError={handleSelectMissingOrError}
                      onDeselectAll={handleDeselectAll}
                      maxHeight="max-h-96"
                      isScanning={isScanningEpisodes}
                    />
                  </div>

                  {/* Ghi chú chân trang */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Xanh lá: Đã tải xong | Đỏ: Tệp lỗi | Xám: Chưa tải</span>
                    <span>Hỗ trợ tải bù tập thiếu tự động</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 3: QUẢN LÝ HÀNG ĐỢI TẢI (DOWNLOAD QUEUE & MULTITHREADING) */}
        {/* ======================================================================= */}
        {activeTab === 'queue' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header Điều Khiển Hàng Đợi */}
            <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-900 border border-indigo-700/40 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ListPlus className="w-5 h-5 text-indigo-400" />
                  Hàng Đợi Tải Phim Tuần Tự & Tối Ưu Băng Thông
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  Điều phối các bộ phim lần lượt, tự động retry khi mạng chập chờn, không làm nghẽn băng thông hệ thống.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleTogglePauseResumeQueue}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow transition active:scale-95 ${
                    isQueuePaused
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {isQueuePaused ? (
                    <>
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Tiếp Tục Hàng Đợi</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-white" />
                      <span>Tạm Dừng Hàng Đợi</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => fetchQueueTasks(false)}
                  disabled={isLoadingQueue}
                  className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition"
                  title="Làm mới hàng đợi"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingQueue ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Task Đang Chạy Trực Tiếp (Active Task Status Banner) */}
            {taskStatus && (taskStatus.status === 'running' || taskStatus.status === 'cancelling') && (
              <div className="p-4 bg-slate-900 border border-emerald-500/60 rounded-xl shadow-lg space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                    <span className="font-bold text-white text-sm">
                      Đang tải: {taskStatus.title} (Tập {taskStatus.current_ep} / {taskStatus.total_eps})
                    </span>
                  </div>
                  <button
                    onClick={handleCancelTask}
                    className="px-3 py-1 bg-rose-950 hover:bg-rose-900 border border-rose-700 text-rose-300 text-xs font-semibold rounded-md transition"
                  >
                    Hủy Tác Vụ
                  </button>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                      style={{ width: `${taskStatus.progress_percent || 0}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>{taskStatus.message || 'Đang bóc tách và giải mã luồng video...'}</span>
                    <span className="font-bold text-emerald-400">{(taskStatus.progress_percent || 0).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Danh Sách Hàng Đợi */}
            {queueTasks.length === 0 ? (
              <div className="p-12 text-center bg-slate-900/50 border border-slate-800 rounded-2xl space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto text-slate-500">
                  <ListPlus className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-300">Hàng đợi tải hiện đang trống</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Bạn có thể tìm kiếm video trên Bilibili hoặc dán link Hồng Quả, YouTube, Xiaohongshu rồi nhấn "Thêm Vào Hàng Đợi".
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => setActiveTab('search')}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-xl transition shadow"
                  >
                    Tìm Kiếm Video Ngay
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {queueTasks.map((task, idx) => (
                  <div
                    key={task.task_id}
                    className={`p-4 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      task.task_id === activeTaskId
                        ? 'bg-slate-900 border-emerald-500/80 shadow-md shadow-emerald-500/10'
                        : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0">
                        #{idx + 1}
                      </span>

                      {task.target_info?.cover_url ? (
                        <img
                          src={task.target_info.cover_url}
                          alt={task.target_info.title}
                          referrerPolicy="no-referrer"
                          className="w-10 h-14 object-cover rounded bg-slate-950 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-14 bg-slate-950 rounded flex items-center justify-center text-slate-700 shrink-0">
                          <Film className="w-5 h-5" />
                        </div>
                      )}

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.2 rounded bg-indigo-950 border border-indigo-600/40 text-[9px] font-bold text-indigo-300 uppercase">
                            {task.target_info?.platform || 'Video'}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                            task.status === 'completed'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                              : task.status === 'failed'
                              ? 'bg-rose-950 text-rose-300 border border-rose-700'
                              : task.task_id === activeTaskId
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-500 animate-pulse'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {task.status === 'completed' ? 'Hoàn thành' : task.status === 'failed' ? 'Lỗi' : task.task_id === activeTaskId ? 'Đang tải...' : 'Chờ tải'}
                          </span>
                        </div>

                        <h4 className="text-xs font-bold text-white truncate max-w-md">
                          {task.target_info?.title || 'Tác vụ tải video'}
                        </h4>

                        <div className="text-[11px] text-slate-400 flex items-center gap-3">
                          <span>Số tập: <strong className="text-slate-200">{task.episodes?.length || 0} tập</strong></span>
                          <span>Thư mục: <code className="font-mono text-slate-300">{task.output_dir || 'uploads'}</code></span>
                        </div>
                      </div>
                    </div>

                    {/* Nút điều khiển từng hàng đợi */}
                    <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => handleReorderQueue(task.task_id, 'up')}
                        disabled={idx === 0}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 rounded-lg transition"
                        title="Đẩy lên ưu tiên"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleReorderQueue(task.task_id, 'down')}
                        disabled={idx === queueTasks.length - 1}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 rounded-lg transition"
                        title="Đẩy xuống sau"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      {task.target_info?.cover_url && (
                        <button
                          onClick={() => handleDownloadQueueCover(task)}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg transition"
                          title="Lưu ảnh bìa phim"
                        >
                          <Image className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {task.status === 'failed' && (
                        <button
                          onClick={() => handleRetryQueueTask(task.task_id, task.target_info?.title || '')}
                          className="p-1.5 bg-amber-950 hover:bg-amber-900 text-amber-400 border border-amber-700 rounded-lg transition"
                          title="Thử lại tác vụ"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteQueueTask(task.task_id, task.target_info?.title || '')}
                        className="p-1.5 bg-rose-950 hover:bg-rose-900 text-rose-400 border border-rose-700/60 rounded-lg transition"
                        title="Xóa khỏi hàng đợi"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 4: QUẢN LÝ TÀI KHOẢN & VIP (PLATFORM AUTH & IN-APP QR) */}
        {/* ======================================================================= */}
        {activeTab === 'auth' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Header Quản Lý Tài Khoản & Cookie */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      Tài Khoản & Xác Thực Nền Tảng
                    </h2>
                    <p className="text-xs text-slate-400">
                      Tự động cấp phiên vãng lai cho Hồng Quả, YouTube, Tiểu Hồng Thư. Đăng nhập để mở khóa chất lượng cao.
                    </p>
                  </div>
                </div>

                <button
                  onClick={loadAuthStatus}
                  disabled={isLoadingAuth}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs rounded-lg flex items-center gap-1.5 transition shrink-0"
                  title="Kiểm tra lại trạng thái đăng nhập"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAuth ? 'animate-spin' : ''}`} />
                  <span>{isLoadingAuth ? 'Đang kiểm tra...' : 'Làm mới'}</span>
                </button>
              </div>
            </div>

            {/* Khối Đăng Nhập Bilibili Bằng Mã QR Trong App */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bilibili QR Login */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-sky-950 border border-sky-600/50 rounded-xl text-sky-400">
                      <QrCode className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Đăng Nhập Bilibili Bằng Mã QR</h3>
                      <p className="text-[11px] text-slate-400">Quét mã bằng app điện thoại để mở khóa 1080p 60fps & 4K VIP</p>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    authStatus?.platforms?.bilibili?.logged_in
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-600'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {authStatus?.platforms?.bilibili?.logged_in ? 'Đã Đăng Nhập VIP' : 'Chưa Đăng Nhập'}
                  </span>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 flex flex-col items-center justify-center min-h-[260px] space-y-3">
                  {biliQrDataUrl ? (
                    <div className="space-y-3 flex flex-col items-center">
                      <div className="p-2 bg-white rounded-xl shadow-lg">
                        <img src={biliQrDataUrl} alt="Bilibili QR Code" className="w-44 h-44" />
                      </div>
                      <div className="text-xs text-center">
                        <span className={`font-semibold ${
                          biliQrStatusType === 'success'
                            ? 'text-emerald-400'
                            : biliQrStatusType === 'scanned'
                            ? 'text-amber-400'
                            : biliQrStatusType === 'expired'
                            ? 'text-rose-400'
                            : 'text-sky-300'
                        }`}>
                          {biliQrStatusText}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-2 text-slate-400 text-xs">
                      <QrCode className="w-10 h-10 mx-auto text-slate-600" />
                      <p>Nhấn nút bên dưới để tạo mã QR đăng nhập chính thức từ Bilibili.</p>
                    </div>
                  )}

                  <button
                    onClick={handleGenerateBilibiliQr}
                    disabled={isGeneratingQr}
                    className="px-5 py-2 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-bold rounded-xl shadow transition disabled:opacity-50"
                  >
                    {isGeneratingQr ? 'Đang tạo mã...' : biliQrDataUrl ? 'Tạo Lại Mã QR Mới' : 'Tạo Mã QR Đăng Nhập'}
                  </button>
                </div>
              </div>

              {/* Dán Cookie Thủ Công & Netscape Exporter */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-purple-950 border border-purple-600/50 rounded-xl text-purple-400">
                    <Key className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Quản Lý Cookie Thủ Công (Netscape Store)</h3>
                    <p className="text-[11px] text-slate-400">Dán chuỗi Cookie hoặc SESSDATA để lưu trữ bảo mật cục bộ</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-300 font-semibold shrink-0">Nền tảng:</label>
                    <select
                      value={customPlatform}
                      onChange={(e) => setCustomPlatform(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-purple-300 font-semibold focus:outline-none"
                    >
                      <option value="bilibili">Bilibili (SESSDATA, bili_jct)</option>
                      <option value="douyin">Douyin (sessionid)</option>
                      <option value="xiaohongshu">Xiaohongshu (web_session)</option>
                      <option value="custom">Nền tảng khác</option>
                    </select>
                  </div>

                  <textarea
                    rows={4}
                    value={customCookieInput}
                    onChange={(e) => setCustomCookieInput(e.target.value)}
                    placeholder="Dán chuỗi cookie (Ví dụ: SESSDATA=abc123xyz; bili_jct=...)..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-purple-500"
                  />

                  {cookieFeedback && (
                    <div className="text-xs text-emerald-400 font-semibold">{cookieFeedback}</div>
                  )}

                  <div className="flex items-center justify-between">
                    <button
                      onClick={handleSavePlatformCookie}
                      disabled={isSavingCookie || !customCookieInput.trim()}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow transition disabled:opacity-50"
                    >
                      {isSavingCookie ? 'Đang lưu...' : 'Lưu Cookie Nền Tảng'}
                    </button>

                    {authStatus?.platforms?.[customPlatform]?.logged_in && (
                      <button
                        onClick={() => handleDeletePlatformCookie(customPlatform)}
                        className="px-3 py-1.5 bg-rose-950 hover:bg-rose-900 border border-rose-700 text-rose-300 text-xs rounded-xl transition"
                      >
                        Xóa Cookie Nền Tảng Này
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* TAB 5: CÀI ĐẶT THIẾT BỊ GIẢ LẬP & PROXY (SETTINGS) */}
        {/* ======================================================================= */}
        {activeTab === 'settings' && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* QUẢN LÝ ĐỊNH DANH THIẾT BỊ ANDROID (HỒNG QUẢ) */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-5 h-5 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Định Danh Thiết Bị Android Giả Lập</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={loadDeviceInfo}
                      disabled={isLoadingDevice}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                      title="Tải lại thông tin thiết bị"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevice ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={handleRotateDeviceNow}
                      disabled={isRotatingDevice}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow transition disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRotatingDevice ? 'animate-spin' : ''}`} />
                      <span>{isRotatingDevice ? 'Đang cấp...' : 'Cấp Thiết Bị Mới'}</span>
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-400">
                  Tự động cấp phát và xoay vòng định danh thiết bị Android để tránh giới hạn lượt tải.
                </p>

                {deviceRotateMessage && (
                  <div className="p-3 bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 text-xs rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{deviceRotateMessage}</span>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Device ID:</span>
                      <button
                        onClick={() => copyToClipboard(deviceInfo?.device_id || '', 'device')}
                        className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                      >
                        {copiedDeviceId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedDeviceId ? 'Đã chép' : 'Sao chép'}</span>
                      </button>
                    </div>
                    <div className="font-mono text-xs text-white font-bold truncate">
                      {deviceInfo?.device_id || 'Đang tải...'}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Install ID:</span>
                      <button
                        onClick={() => copyToClipboard(deviceInfo?.install_id || '', 'install')}
                        className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                      >
                        {copiedInstallId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedInstallId ? 'Đã chép' : 'Sao chép'}</span>
                      </button>
                    </div>
                    <div className="font-mono text-xs text-white font-bold truncate">
                      {deviceInfo?.install_id || 'Đang tải...'}
                    </div>
                  </div>

                  {/* Nhập thủ công Device ID tùy chỉnh */}
                  <div className="pt-2 border-t border-slate-800">
                    <button
                      onClick={() => setShowCustomDeviceInput(!showCustomDeviceInput)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                    >
                      {showCustomDeviceInput ? '▲ Ẩn nhập thiết bị tùy chỉnh' : '▼ Nhập Device ID / Install ID thủ công'}
                    </button>

                    {showCustomDeviceInput && (
                      <div className="mt-2.5 p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
                        <div>
                          <label className="text-slate-400 block mb-0.5">Device ID (64-bit Hex/Dec):</label>
                          <input
                            type="text"
                            value={customDeviceId}
                            onChange={(e) => setCustomDeviceId(e.target.value)}
                            placeholder="Nhập Device ID..."
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 block mb-0.5">Install ID (64-bit Hex/Dec):</label>
                          <input
                            type="text"
                            value={customInstallId}
                            onChange={(e) => setCustomInstallId(e.target.value)}
                            placeholder="Nhập Install ID..."
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <button
                          onClick={handleSaveCustomDevice}
                          disabled={isSavingCustomDevice}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold text-xs transition disabled:opacity-50"
                        >
                          {isSavingCustomDevice ? 'Đang lưu...' : 'Lưu Thiết Bị Tùy Chỉnh'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Tần suất xoay thiết bị */}
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                    <div className="text-xs text-slate-300 font-semibold flex items-center justify-between">
                      <span>Tự động xoay thiết bị sau mỗi:</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {rotationInterval === 0 ? 'Tắt tự động' : `${rotationInterval} tập`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={rotationInterval}
                      onChange={(e) => setRotationInterval(parseInt(e.target.value, 10))}
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* CẤU HÌNH PROXY & ĐỘ TRỄ MẠNG */}
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-sm font-bold text-white">Máy Chủ Ủy Quyền (Proxy) & Độ Trễ</h3>
                  </div>
                </div>

                <p className="text-xs text-slate-400">
                  Định tuyến qua HTTP, HTTPS hoặc SOCKS5 Proxy cho Bilibili, YouTube và dịch vụ mạng.
                </p>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 font-semibold">URL Proxy:</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={proxyUrl}
                        onChange={(e) => setProxyUrl(e.target.value)}
                        placeholder="http://user:pass@127.0.0.1:7890 hoặc socks5://..."
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={handleTestProxy}
                        disabled={isTestingProxy}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                      >
                        {isTestingProxy ? 'Đang đo...' : 'Kiểm Tra'}
                      </button>
                    </div>
                  </div>

                  {proxyTestResult && (
                    <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      proxyTestResult.ok
                        ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                        : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                    }`}>
                      {proxyTestResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                      <div>
                        {proxyTestResult.ok ? (
                          <span>Kết nối tốt! IP: {proxyTestResult.ip} | Độ trễ: <strong>{proxyTestResult.latency_ms} ms</strong></span>
                        ) : (
                          <span>Lỗi proxy: {proxyTestResult.error}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Giãn cách gọi API */}
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                    <div className="text-xs text-slate-300 font-semibold flex items-center justify-between">
                      <span>Thời gian giãn cách giữa các tập (Rate limit):</span>
                      <span className="font-mono text-indigo-400 font-bold">{rateLimitDelay}s</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={10.0}
                      step={0.5}
                      value={rateLimitDelay}
                      onChange={(e) => setRateLimitDelay(parseFloat(e.target.value))}
                      className="w-full accent-indigo-400 cursor-pointer"
                    />
                    <div className="text-[10px] text-slate-500">
                      Điều tiết tốc độ request tránh lỗi quá tải (HTTP 429).
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
