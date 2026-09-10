import React, { useMemo, useState } from 'react';
import {
  Ban,
  Cpu,
  PauseCircle,
  PlayCircle,
  Search,
  Sliders,
  Trash2,
} from 'lucide-react';
import { LanWorker } from '../../types/api';
import { EmptyState, focusRing, formatTime, StatusBadge, VramBar } from './LanUi';
import { WorkerEngineOverride } from './types';

interface AdminWorkersTabProps {
  workers: LanWorker[];
  isPending: (key: string) => boolean;
  onStatus: (worker: LanWorker, status: 'online' | 'draining' | 'disabled') => void;
  onDelete?: (worker: LanWorker) => void;
  onOpenConfig: (worker: LanWorker) => void;
  workerOverrides: Record<string, WorkerEngineOverride>;
}

function CapabilitiesBadgeList({ worker }: { worker: LanWorker }) {
  const caps = Object.entries(worker.capabilities || {}).filter(([, enabled]) => Boolean(enabled));
  if (!caps.length) return <span className="text-xs text-slate-500">Chưa khai báo</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {caps.map(([name, val]) => (
        <span
          key={name}
          className="rounded-md border border-indigo-900/60 bg-indigo-950/40 px-1.5 py-0.5 text-[10px] font-mono text-indigo-300"
        >
          {name}
          {val === true ? '' : `: ${String(val)}`}
        </span>
      ))}
    </div>
  );
}

export const AdminWorkersTab: React.FC<AdminWorkersTabProps> = ({
  workers,
  isPending,
  onStatus,
  onDelete,
  onOpenConfig,
  workerOverrides,
}) => {
  const [search, setSearch] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filteredWorkers = useMemo(() => {
    return workers.filter((w) => {
      const q = search.trim().toLowerCase();
      const matchText =
        !q ||
        [w.worker_id, w.hostname, w.ip_address, w.gpu_name, w.platform].some((field) =>
          String(field || '').toLowerCase().includes(q)
        );
      const isOnline = w.is_online && w.status !== 'disabled';
      const actualStatus = !isOnline && w.status !== 'disabled' ? 'offline' : w.status;
      const matchStatus = filterStatus === 'all' || actualStatus === filterStatus;
      return matchText && matchStatus;
    });
  }, [workers, search, filterStatus]);

  return (
    <section
      aria-labelledby="workers-tab-heading"
      className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm"
    >
      {/* Header & Bộ lọc */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 id="workers-tab-heading" className="text-base font-bold text-white flex items-center gap-2">
            Trạm Worker Nodes ({workers.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Giám sát sức mạnh phần cứng, VRAM và gán vai trò xử lý chuyên biệt cho từng máy.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Ô tìm kiếm */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Tìm theo worker, IP, GPU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`h-9 w-52 rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-slate-200 placeholder-slate-500 ${focusRing}`}
            />
          </div>

          {/* Lọc trạng thái */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={`h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 ${focusRing}`}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="online">Online</option>
            <option value="draining">Draining</option>
            <option value="disabled">Vô hiệu hóa</option>
            <option value="offline">Offline</option>
          </select>
        </div>
      </div>

      {/* Danh sách Worker */}
      {!filteredWorkers.length ? (
        <EmptyState
          title={workers.length ? 'Không tìm thấy worker phù hợp' : 'Chưa có worker nào đăng ký'}
          icon={Cpu}
        >
          {workers.length
            ? 'Hãy thử thay đổi từ khóa tìm kiếm hoặc bỏ chọn bộ lọc trạng thái.'
            : 'Khởi chạy worker LAN với URL và Token của Coordinator để máy trạm xuất hiện tự động.'}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredWorkers.map((worker) => {
            const busy = isPending(`worker:${worker.worker_id}`);
            const override = workerOverrides[worker.worker_id];
            const isCustom = Boolean(override?.is_custom);
            const isOfflineOrDisabled = !worker.is_online || worker.status === 'disabled';

            return (
              <div
                key={worker.worker_id}
                className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition-all duration-200 hover:border-slate-700 hover:shadow-md"
              >
                <div className="space-y-3">
                  {/* Dòng 1: ID & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-white truncate font-mono" title={worker.worker_id}>
                        {worker.worker_id}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {worker.hostname || worker.ip_address || '127.0.0.1'} · {worker.platform}
                      </p>
                    </div>
                    <StatusBadge
                      status={
                        !worker.is_online && worker.status !== 'disabled'
                          ? 'offline'
                          : worker.status
                      }
                    />
                  </div>

                  {/* Dòng 2: Phần cứng & VRAM */}
                  <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 space-y-2">
                    <p className="text-xs font-semibold text-slate-200 truncate" title={worker.gpu_name}>
                      {worker.gpu_name || 'CPU Machine (No GPU)'}
                    </p>
                    <VramBar vramMb={worker.vram_mb} />
                  </div>

                  {/* Dòng 3: Năng lực & Chế độ cấu hình */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Cấu hình Engine:</span>
                      {isCustom ? (
                        <span className="rounded-md border border-purple-800/60 bg-purple-950/40 px-2 py-0.5 font-semibold text-purple-300">
                          Tùy biến riêng
                        </span>
                      ) : (
                        <span className="rounded-md border border-slate-800 bg-slate-800/70 px-2 py-0.5 text-slate-400">
                          Theo Setting Tổng
                        </span>
                      )}
                    </div>
                    <CapabilitiesBadgeList worker={worker} />
                  </div>

                  {/* Dòng 4: Tải & Heartbeat */}
                  <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                    <span>Hàng đợi: <strong className="text-white">{worker.queue_depth ?? 0}</strong> job</span>
                    <span>Heartbeat: {formatTime(worker.last_seen)}</span>
                  </div>

                  {worker.last_error && (
                    <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2 text-[11px] text-rose-300">
                      Lỗi: {worker.last_error}
                    </div>
                  )}
                </div>

                {/* Dòng 5: Action Controls */}
                <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 gap-1.5">
                  <button
                    disabled={busy}
                    onClick={() => onOpenConfig(worker)}
                    className={`flex items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors ${focusRing}`}
                    title="Cấu hình Engine và gán vai trò"
                  >
                    <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                    Cấu hình
                  </button>

                  <div className="flex items-center gap-1">
                    {worker.status === 'disabled' ? (
                      <button
                        disabled={busy}
                        onClick={() => onStatus(worker, 'online')}
                        className={`flex items-center gap-1 rounded-xl bg-emerald-800 px-2.5 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-700 transition-colors ${focusRing}`}
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Bật
                      </button>
                    ) : (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            onStatus(worker, worker.status === 'draining' ? 'online' : 'draining')
                          }
                          className={`flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors ${focusRing}`}
                          title={worker.status === 'draining' ? 'Cho nhận job lại' : 'Drain worker để bảo trì'}
                        >
                          {worker.status === 'draining' ? (
                            <>
                              <PlayCircle className="h-3.5 w-3.5 text-emerald-400" />
                              Nhận job
                            </>
                          ) : (
                            <>
                              <PauseCircle className="h-3.5 w-3.5 text-amber-400" />
                              Drain
                            </>
                          )}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => onStatus(worker, 'disabled')}
                          className={`rounded-xl border border-rose-900/60 bg-rose-950/50 p-1.5 text-rose-300 hover:bg-rose-900 transition-colors ${focusRing}`}
                          title="Vô hiệu hóa worker"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}

                    {isOfflineOrDisabled && onDelete && (
                      <button
                        disabled={busy}
                        onClick={() => onDelete(worker)}
                        className={`rounded-xl border border-slate-800 bg-slate-900 p-1.5 text-rose-400 hover:bg-rose-950 hover:text-rose-200 transition-colors ${focusRing}`}
                        title="Xóa worker offline khỏi danh sách"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
