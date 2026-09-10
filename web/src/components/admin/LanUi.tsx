import React from 'react';
import {
  AlertTriangle,
  Cpu,
  HardDrive,
  Inbox,
  Loader2,
  ServerOff,
} from 'lucide-react';

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

export function EmptyState({
  title,
  children,
  icon: Icon = Inbox,
  action,
}: React.PropsWithChildren<{
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center text-slate-400">
      <div className="mb-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-inner">
        <Icon className="h-7 w-7 text-slate-500" />
      </div>
      <p className="font-semibold text-slate-200">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-400 leading-relaxed">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InitialState({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry: () => void;
}) {
  if (!error) {
    return (
      <div
        className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-400"
        role="status"
      >
        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
        <span className="text-sm font-medium text-slate-300">Đang đồng bộ Control Plane LAN…</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-rose-900/50 bg-gradient-to-b from-rose-950/20 to-slate-950 p-6 text-center shadow-lg">
      <div className="mb-3 rounded-xl border border-rose-800/60 bg-rose-950/60 p-3 text-rose-400">
        <ServerOff className="h-7 w-7" />
      </div>
      <h2 className="font-semibold text-rose-200 text-base">Không thể kết nối Coordinator</h2>
      <p className="mt-1.5 max-w-md text-xs text-rose-300/80">{error}</p>
      <button
        onClick={onRetry}
        className={`mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition-colors ${focusRing}`}
      >
        Thử lại kết nối
      </button>
    </div>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  const val = (status || 'unknown').toLowerCase();

  let tone = 'border-slate-700/70 bg-slate-800/50 text-slate-400';
  let dotColor = 'bg-slate-400';
  let label = status || 'Không rõ';

  if (['online', 'completed', 'downloaded', 'approved'].includes(val)) {
    tone = 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300';
    dotColor = 'bg-emerald-400';
    if (val === 'online') label = 'Online';
    if (val === 'completed') label = 'Hoàn tất';
    if (val === 'approved') label = 'Đã duyệt';
    if (val === 'downloaded') label = 'Đã tải';
  } else if (['running', 'downloading', 'preview_ready'].includes(val)) {
    tone = 'border-cyan-800/60 bg-cyan-950/40 text-cyan-300';
    dotColor = 'bg-cyan-400 animate-pulse';
    if (val === 'running') label = 'Đang chạy';
    if (val === 'downloading') label = 'Đang tải';
    if (val === 'preview_ready') label = 'Chờ duyệt';
  } else if (['draining', 'queued', 'requested'].includes(val)) {
    tone = 'border-amber-800/60 bg-amber-950/40 text-amber-300';
    dotColor = 'bg-amber-400';
    if (val === 'draining') label = 'Đang Drain';
    if (val === 'queued') label = 'Hàng đợi';
    if (val === 'requested') label = 'Chờ tải';
  } else if (['failed', 'cancelled', 'disabled', 'rejected', 'offline'].includes(val)) {
    tone = 'border-rose-800/60 bg-rose-950/40 text-rose-300';
    dotColor = 'bg-rose-400';
    if (val === 'failed') label = 'Thất bại';
    if (val === 'cancelled') label = 'Đã hủy';
    if (val === 'disabled') label = 'Vô hiệu';
    if (val === 'rejected') label = 'Từ chối';
    if (val === 'offline') label = 'Offline';
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}

export function VramBar({
  vramMb,
  estimatedUsedMb,
}: {
  vramMb?: number;
  estimatedUsedMb?: number;
}) {
  if (!vramMb || vramMb <= 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <Cpu className="h-3.5 w-3.5 text-slate-400" />
        <span>CPU / Không có VRAM</span>
      </div>
    );
  }

  const totalGb = (vramMb / 1024).toFixed(1);
  const usedMb = Math.min(vramMb, estimatedUsedMb ?? Math.round(vramMb * 0.28));
  const usedGb = (usedMb / 1024).toFixed(1);
  const percent = Math.min(100, Math.round((usedMb / vramMb) * 100));

  let barColor = 'bg-emerald-500';
  let textColor = 'text-emerald-400';
  if (percent > 85) {
    barColor = 'bg-rose-500';
    textColor = 'text-rose-400';
  } else if (percent > 65) {
    barColor = 'bg-amber-500';
    textColor = 'text-amber-400';
  }

  return (
    <div className="w-full space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-slate-400">
          <HardDrive className="h-3 w-3" />
          VRAM Tải
        </span>
        <span className={`font-mono font-medium ${textColor}`}>
          {usedGb} / {totalGb} GB ({percent}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80 p-0.5">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function LatencyPill({ pingMs }: { pingMs: number | null }) {
  if (pingMs === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <span className="h-2 w-2 rounded-full bg-slate-500" />
        Đang đo ping…
      </span>
    );
  }

  let color = 'text-emerald-400 border-emerald-800/50 bg-emerald-950/40';
  let dot = 'bg-emerald-400 shadow-emerald-500/50';

  if (pingMs > 100) {
    color = 'text-rose-400 border-rose-800/50 bg-rose-950/40';
    dot = 'bg-rose-400 shadow-rose-500/50';
  } else if (pingMs > 40) {
    color = 'text-amber-400 border-amber-800/50 bg-amber-950/40';
    dot = 'bg-amber-400 shadow-amber-500/50';
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-mono font-medium ${color}`}
      title="Độ trễ phản hồi WebSocket & API tới Coordinator"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot} animate-pulse`} />
      {pingMs} ms
    </span>
  );
}

export function MetricCard({
  title,
  value,
  subtext,
  icon: Icon,
  tone = 'indigo',
}: {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'indigo' | 'emerald' | 'amber' | 'violet' | 'cyan' | 'rose';
}) {
  const colors = {
    indigo: {
      border: 'border-indigo-500/20 hover:border-indigo-500/40',
      bg: 'bg-indigo-500/5',
      iconBg: 'bg-indigo-950/60 text-indigo-400 border-indigo-800/50',
    },
    emerald: {
      border: 'border-emerald-500/20 hover:border-emerald-500/40',
      bg: 'bg-emerald-500/5',
      iconBg: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50',
    },
    amber: {
      border: 'border-amber-500/20 hover:border-amber-500/40',
      bg: 'bg-amber-500/5',
      iconBg: 'bg-amber-950/60 text-amber-400 border-amber-800/50',
    },
    violet: {
      border: 'border-violet-500/20 hover:border-violet-500/40',
      bg: 'bg-violet-500/5',
      iconBg: 'bg-violet-950/60 text-violet-400 border-violet-800/50',
    },
    cyan: {
      border: 'border-cyan-500/20 hover:border-cyan-500/40',
      bg: 'bg-cyan-500/5',
      iconBg: 'bg-cyan-950/60 text-cyan-400 border-cyan-800/50',
    },
    rose: {
      border: 'border-rose-500/20 hover:border-rose-500/40',
      bg: 'bg-rose-500/5',
      iconBg: 'bg-rose-950/60 text-rose-400 border-rose-800/50',
    },
  }[tone];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${colors.border} ${colors.bg} bg-slate-900/60 p-4 transition-all duration-200 shadow-sm`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-white">{value}</p>
          {subtext && <p className="mt-1 text-[11px] text-slate-500">{subtext}</p>}
        </div>
        <div className={`rounded-xl border p-2.5 shadow-sm ${colors.iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = true,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  destructive?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lan-confirm-title"
        aria-describedby="lan-confirm-detail"
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex gap-3.5">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
              destructive
                ? 'border-rose-800/60 bg-rose-950/60 text-rose-400'
                : 'border-amber-800/60 bg-amber-950/60 text-amber-400'
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 id="lan-confirm-title" className="font-semibold text-slate-100 text-base">
              {title}
            </h2>
            <p id="lan-confirm-detail" className="mt-1 text-xs text-slate-400 leading-relaxed">
              {detail}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2.5">
          <button
            autoFocus
            onClick={onClose}
            className={`rounded-xl border border-slate-800 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors ${focusRing}`}
          >
            Quay lại
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-xs font-medium text-white shadow-md transition-colors ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
            } ${focusRing}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function formatTime(value?: number | string | null) {
  if (value === undefined || value === null || value === '') return '—';
  const numeric = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
