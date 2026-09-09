import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { wsClient, WsConnectionStatus } from '../../api/websocket';
import { BridgeEventV1, LanOverview } from '../../types/api';

const POLL_MS = 10_000;
const STALE_MS = 25_000;
const LAN_EVENTS = new Set([
  'worker_registered', 'worker_heartbeat', 'worker_updated', 'worker_status_changed',
  'job_updated', 'job_cancelled', 'job_retried',
  'download_updated', 'download_preview', 'download_decided',
]);

type Notice = { tone: 'success' | 'error'; message: string } | null;

export function useLanOverview() {
  const [overview, setOverview] = useState<LanOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [connection, setConnection] = useState<WsConnectionStatus>(wsClient.getStatus());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState(Date.now());
  const mounted = useRef(true);
  const pendingRef = useRef(new Set<string>());
  const requestId = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);

  const refresh = useCallback((forceAfter = false): Promise<void> => {
    if (inFlight.current) {
      refreshQueued.current = refreshQueued.current || forceAfter;
      return inFlight.current;
    }
    const id = ++requestId.current;
    setRefreshing(true);
    const run = apiClient.getLanOverview().then(data => {
      if (!mounted.current || id !== requestId.current) return;
      setOverview(data);
      setError(null);
    }).catch((caught: unknown) => {
      if (!mounted.current || id !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : 'Không thể tải trạng thái LAN');
    }).finally(() => {
      if (!mounted.current) return;
      if (id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
      inFlight.current = null;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        void refresh();
      }
    });
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    wsClient.connect();
    const poll = window.setInterval(() => void refresh(), POLL_MS);
    const tick = window.setInterval(() => setClock(Date.now()), 1_000);
    const unsubscribeStatus = wsClient.onStatusChange(status => {
      setConnection(status);
      if (status === 'connected') void refresh(true);
    });
    const unsubscribeEvent = wsClient.onEvent((event: BridgeEventV1) => {
      if (event.project_id === '__lan__' || LAN_EVENTS.has(event.event_type)) void refresh(true);
    });
    return () => {
      mounted.current = false;
      requestId.current += 1;
      window.clearInterval(poll);
      window.clearInterval(tick);
      unsubscribeEvent();
      unsubscribeStatus();
    };
  }, [refresh]);

  const runAction = useCallback(async (key: string, action: () => Promise<unknown>, success: string) => {
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setNotice(null);
    try {
      await action();
      if (!mounted.current) return;
      setNotice({ tone: 'success', message: success });
      await refresh(true);
    } catch (caught: unknown) {
      if (!mounted.current) return;
      const message = caught instanceof Error ? caught.message : 'Thao tác thất bại';
      setNotice({ tone: 'error', message });
      setError(message);
    } finally {
      pendingRef.current.delete(key);
      if (mounted.current) setPending(new Set(pendingRef.current));
    }
  }, [refresh]);

  const ageMs = overview ? Math.max(0, clock - overview.fetched_at) : null;
  return {
    overview, loading, refreshing, error, notice, connection, ageMs,
    stale: ageMs !== null && ageMs > STALE_MS,
    refresh: () => refresh(true),
    isPending: (key: string) => pending.has(key),
    decide: (id: string, approved: boolean) => runAction(`download:${id}`, () => apiClient.decideDownload(id, approved), approved ? 'Đã duyệt yêu cầu tải.' : 'Đã từ chối yêu cầu tải.'),
    setWorkerStatus: (id: string, status: 'online' | 'draining' | 'disabled') => runAction(`worker:${id}`, () => apiClient.setWorkerStatus(id, status), 'Đã cập nhật trạng thái worker.'),
    cancelJob: (id: string) => runAction(`job:${id}`, () => apiClient.cancelAdminJob(id), 'Đã hủy job.'),
    retryJob: (id: string) => runAction(`job:${id}`, () => apiClient.retryAdminJob(id), 'Đã đưa job vào hàng đợi lại.'),
  };
}
