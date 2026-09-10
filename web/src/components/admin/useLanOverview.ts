import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, GlobalPipelineSettings } from '../../api/client';
import { wsClient, WsConnectionStatus } from '../../api/websocket';
import { BridgeEventV1, LanOverview } from '../../types/api';
import { getInitialMockOverview } from './mockData';
import { WorkerEngineOverride } from './types';

const POLL_MS = 10_000;
const STALE_MS = 25_000;
const WORKER_OVERRIDES_STORAGE_KEY = 'sls_worker_engine_overrides_v1';
const MOCK_STORAGE_KEY = 'sls_admin_mock_mode_active';

const LAN_EVENTS = new Set([
  'worker_registered',
  'worker_heartbeat',
  'worker_updated',
  'worker_status_changed',
  'worker_deleted',
  'job_updated',
  'job_cancelled',
  'job_retried',
  'job_deleted',
  'download_updated',
  'download_preview',
  'download_decided',
]);

type Notice = { tone: 'success' | 'error'; message: string } | null;

export function useLanOverview() {
  const [isMockMode, setIsMockMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MOCK_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [overview, setOverview] = useState<LanOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [connection, setConnection] = useState<WsConnectionStatus>(wsClient.getStatus());
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState(Date.now());

  // Quản lý cấu hình Engine từng Worker
  const [workerOverrides, setWorkerOverrides] = useState<Record<string, WorkerEngineOverride>>(() => {
    try {
      const saved = localStorage.getItem(WORKER_OVERRIDES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Cấu hình Pipeline Tổng
  const [globalSettings, setGlobalSettings] = useState<GlobalPipelineSettings | null>(null);

  const mounted = useRef(true);
  const pendingRef = useRef(new Set<string>());
  const requestId = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const mockTickerRef = useRef<number | null>(null);

  // Nạp cấu hình Pipeline Tổng
  const loadGlobalSettings = useCallback(async () => {
    try {
      const settings = await apiClient.getPipelineSettings();
      if (mounted.current) setGlobalSettings(settings);
    } catch {
      // Bỏ qua nếu backend chưa sẵn sàng
    }
  }, []);

  // Bật / Tắt Mock Mode
  const toggleMockMode = useCallback((forceState?: boolean) => {
    setIsMockMode((prev) => {
      const next = forceState !== undefined ? forceState : !prev;
      try {
        localStorage.setItem(MOCK_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // Làm mới dữ liệu Coordinator Thật
  const refreshReal = useCallback((forceAfter = false): Promise<void> => {
    if (inFlight.current) {
      refreshQueued.current = refreshQueued.current || forceAfter;
      return inFlight.current;
    }
    const id = ++requestId.current;
    setRefreshing(true);
    const startTime = Date.now();

    const run = apiClient
      .getLanOverview()
      .then((data) => {
        if (!mounted.current || id !== requestId.current) return;
        setOverview(data);
        setError(null);
        setPingMs(Date.now() - startTime);
      })
      .catch((caught: unknown) => {
        if (!mounted.current || id !== requestId.current) return;
        setError(caught instanceof Error ? caught.message : 'Không thể tải trạng thái LAN');
        setPingMs(null);
      })
      .finally(() => {
        if (!mounted.current) return;
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
        inFlight.current = null;
        if (refreshQueued.current) {
          refreshQueued.current = false;
          void refreshReal();
        }
      });

    inFlight.current = run;
    return run;
  }, []);

  // Khởi chạy vòng lặp Mock Ticker
  useEffect(() => {
    if (isMockMode) {
      setLoading(false);
      setConnection('connected');
      setPingMs(12);
      setOverview(getInitialMockOverview());

      // Ticker giả lập tiến độ thời gian thực
      mockTickerRef.current = window.setInterval(() => {
        setOverview((prev) => {
          if (!prev) return getInitialMockOverview();
          const updatedJobs = prev.jobs.map((job) => {
            if (job.status === 'running') {
              const currentProg = Number(job.progress || 0);
              const nextProg = Math.min(100, currentProg + 3);
              if (nextProg >= 100) {
                return {
                  ...job,
                  progress: 100,
                  status: 'completed',
                  current_stage: 'Hoàn tất toàn bộ pipeline OCR & Dịch',
                  metrics: {
                    total_time_seconds: 78.5,
                    cues_detected: 32,
                    accuracy_score: '98.8%',
                    fps: 52.4,
                  },
                };
              }
              return {
                ...job,
                progress: nextProg,
              };
            }
            return job;
          });

          return {
            ...prev,
            jobs: updatedJobs,
            running_job_count: updatedJobs.filter((j) => j.status === 'running').length,
            failed_job_count: updatedJobs.filter((j) => j.status === 'failed').length,
            fetched_at: Date.now(),
          };
        });
      }, 1800);

      return () => {
        if (mockTickerRef.current) clearInterval(mockTickerRef.current);
      };
    } else {
      mounted.current = true;
      void refreshReal();
      void loadGlobalSettings();
      wsClient.connect();

      const poll = window.setInterval(() => void refreshReal(), POLL_MS);
      const tick = window.setInterval(() => setClock(Date.now()), 1_000);

      const unsubscribeStatus = wsClient.onStatusChange((status) => {
        setConnection(status);
        if (status === 'connected') void refreshReal(true);
      });

      const unsubscribeEvent = wsClient.onEvent((event: BridgeEventV1) => {
        if (event.project_id === '__lan__' || LAN_EVENTS.has(event.event_type)) {
          void refreshReal(true);
        }
      });

      return () => {
        mounted.current = false;
        requestId.current += 1;
        window.clearInterval(poll);
        window.clearInterval(tick);
        unsubscribeEvent();
        unsubscribeStatus();
      };
    }
  }, [isMockMode, refreshReal, loadGlobalSettings]);

  // Hành động Thực Thi An Toàn (hỗ trợ cả Real và Mock)
  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string, mockHandler?: () => void) => {
      if (pendingRef.current.has(key)) return;
      pendingRef.current.add(key);
      setPending(new Set(pendingRef.current));
      setNotice(null);

      try {
        if (isMockMode) {
          // Xử lý giả lập trong Sandbox Mode
          await new Promise((r) => setTimeout(r, 400));
          if (mockHandler) mockHandler();
          setNotice({ tone: 'success', message: `[Sandbox] ${success}` });
        } else {
          await action();
          if (!mounted.current) return;
          setNotice({ tone: 'success', message: success });
          await refreshReal(true);
        }
      } catch (caught: unknown) {
        if (!mounted.current) return;
        const message = caught instanceof Error ? caught.message : 'Thao tác thất bại';
        setNotice({ tone: 'error', message });
        setError(message);
      } finally {
        pendingRef.current.delete(key);
        if (mounted.current) setPending(new Set(pendingRef.current));
      }
    },
    [isMockMode, refreshReal]
  );

  // Lưu cấu hình tùy biến cho một worker
  const saveWorkerOverride = useCallback((override: WorkerEngineOverride) => {
    setWorkerOverrides((prev) => {
      const updated = { ...prev, [override.worker_id]: override };
      try {
        localStorage.setItem(WORKER_OVERRIDES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setNotice({
      tone: 'success',
      message: `Đã lưu cấu hình Engine cho worker ${override.worker_id}.`,
    });
  }, []);

  // Đồng bộ lại 1 worker về Setting Tổng
  const resetWorkerOverride = useCallback((workerId: string) => {
    setWorkerOverrides((prev) => {
      const updated = { ...prev };
      delete updated[workerId];
      try {
        localStorage.setItem(WORKER_OVERRIDES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setNotice({
      tone: 'success',
      message: `Worker ${workerId} đã chuyển về kế thừa từ Thiết Lập Tổng.`,
    });
  }, []);

  // Đồng bộ toàn bộ Worker về Setting Tổng
  const syncAllWithGlobal = useCallback(async () => {
    await loadGlobalSettings();
    setWorkerOverrides({});
    try {
      localStorage.removeItem(WORKER_OVERRIDES_STORAGE_KEY);
    } catch {}
    setNotice({
      tone: 'success',
      message: 'Đã đồng bộ toàn bộ Worker theo Thiết Lập Pipeline Tổng.',
    });
  }, [loadGlobalSettings]);

  const ageMs = overview ? Math.max(0, clock - overview.fetched_at) : null;

  return {
    overview,
    loading,
    refreshing,
    error,
    notice,
    connection,
    pingMs,
    ageMs,
    stale: !isMockMode && ageMs !== null && ageMs > STALE_MS,
    isMockMode,
    toggleMockMode,
    globalSettings,
    workerOverrides,
    saveWorkerOverride,
    resetWorkerOverride,
    syncAllWithGlobal,
    refresh: () => (isMockMode ? setOverview(getInitialMockOverview()) : refreshReal(true)),
    isPending: (key: string) => pending.has(key),

    // Các hành động thao tác
    decide: (id: string, approved: boolean) =>
      runAction(
        `download:${id}`,
        () => apiClient.decideDownload(id, approved),
        approved ? 'Đã duyệt yêu cầu tải video.' : 'Đã từ chối yêu cầu tải video.',
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              downloads: prev.downloads.map((d) =>
                d.request_id === id ? { ...d, status: approved ? 'approved' : 'rejected' } : d
              ),
              pending_download_count: Math.max(0, prev.pending_download_count - 1),
            };
          });
        }
      ),

    setWorkerStatus: (id: string, status: 'online' | 'draining' | 'disabled') =>
      runAction(
        `worker:${id}`,
        () => apiClient.setWorkerStatus(id, status),
        `Đã cập nhật trạng thái worker ${id} sang ${status}.`,
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              workers: prev.workers.map((w) => (w.worker_id === id ? { ...w, status } : w)),
              online_worker_count: prev.workers.filter(
                (w) => (w.worker_id === id ? status === 'online' : w.status === 'online')
              ).length,
            };
          });
        }
      ),

    deleteWorker: (id: string) =>
      runAction(
        `worker:${id}`,
        () => apiClient.deleteWorker(id),
        `Đã xóa worker ${id}.`,
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            const workers = prev.workers.filter((w) => w.worker_id !== id);
            return {
              ...prev,
              workers,
              worker_count: workers.length,
              online_worker_count: workers.filter((w) => w.is_online && w.status === 'online').length,
            };
          });
        }
      ),

    cancelJob: (id: string) =>
      runAction(
        `job:${id}`,
        () => apiClient.cancelAdminJob(id),
        `Đã hủy job ${id}.`,
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              jobs: prev.jobs.map((j) => (j.job_id === id ? { ...j, status: 'cancelled' } : j)),
              running_job_count: Math.max(0, prev.running_job_count - 1),
            };
          });
        }
      ),

    retryJob: (id: string) =>
      runAction(
        `job:${id}`,
        () => apiClient.retryAdminJob(id),
        `Đã đưa job ${id} vào hàng đợi xử lý lại.`,
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              jobs: prev.jobs.map((j) =>
                j.job_id === id
                  ? {
                      ...j,
                      status: 'running',
                      progress: 5,
                      current_stage: 'Thử lại tác vụ bóc tách OCR',
                      error: null,
                    }
                  : j
              ),
              running_job_count: prev.running_job_count + 1,
              failed_job_count: Math.max(0, prev.failed_job_count - 1),
            };
          });
        }
      ),

    batchRetryFailed: () =>
      runAction(
        'job:batch-retry',
        async () => {
          const failed = overview?.jobs.filter((j) => j.status === 'failed') || [];
          for (const f of failed) {
            await apiClient.retryAdminJob(f.job_id);
          }
        },
        'Đã gửi yêu cầu retry toàn bộ các job gặp lỗi.',
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              jobs: prev.jobs.map((j) =>
                j.status === 'failed'
                  ? { ...j, status: 'running', progress: 5, error: null }
                  : j
              ),
              failed_job_count: 0,
            };
          });
        }
      ),

    deleteJob: (id: string) =>
      runAction(
        `job:${id}`,
        () => apiClient.deleteAdminJob(id),
        `Đã xóa job ${id}.`,
        () => {
          setOverview((prev) => {
            if (!prev) return null;
            const jobs = prev.jobs.filter((j) => j.job_id !== id);
            return {
              ...prev,
              jobs,
            };
          });
        }
      ),

    // Tạo job mới — hỗ trợ cả mock và real mode
    createJob: (payload: {
      projectId: string;
      jobType: string;
      idempotencyKey: string;
      videoUrl?: string;
      seriesName?: string;
    }) =>
      runAction(
        `job:create:${payload.idempotencyKey}`,
        () =>
          apiClient.createAdminJob({
            project_id: payload.projectId,
            job_type: payload.jobType,
            idempotency_key: payload.idempotencyKey,
          }),
        `Đã tạo job mới cho project ${payload.projectId}.`,
        () => {
          // Mock mode: tạo job giả lập
          const now = Date.now();
          const mockJobId = `job-new-${now}`;
          setOverview((prev) => {
            if (!prev) return null;
            const newJob = {
              job_id: mockJobId,
              project_id: payload.projectId,
              worker_id: undefined,
              job_type: payload.jobType,
              stage: payload.jobType,
              current_stage: 'Chờ worker có slot trống tiếp nhận',
              status: 'queued',
              progress: 0,
              attempt: 0,
              max_attempts: 3,
              created_at: now,
              updated_at: now,
            };
            return {
              ...prev,
              jobs: [newJob, ...prev.jobs],
              queue_depth: prev.queue_depth + 1,
            };
          });
        }
      ),
  };
}

