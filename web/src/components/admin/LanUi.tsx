import React from 'react';
import { AlertTriangle, Inbox, Loader2, ServerOff } from 'lucide-react';

export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

export function EmptyState({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return <div className="px-5 py-10 text-center text-slate-400">
    <Inbox className="mx-auto mb-3 h-7 w-7 text-slate-600" aria-hidden="true" />
    <p className="font-medium text-slate-300">{title}</p>
    <p className="mx-auto mt-1 max-w-xl text-sm">{children}</p>
  </div>;
}

export function InitialState({ error, onRetry }: { error?: string | null; onRetry: () => void }) {
  if (!error) return <div className="flex min-h-64 items-center justify-center gap-3 text-slate-400" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Đang tải bảng điều phối LAN…</div>;
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-rose-900/60 bg-rose-950/20 p-6 text-center">
    <ServerOff className="mb-3 h-8 w-8 text-rose-400" aria-hidden="true" />
    <h2 className="font-semibold text-rose-200">Không thể kết nối control plane</h2>
    <p className="mt-1 max-w-lg text-sm text-rose-300">{error}</p>
    <button onClick={onRetry} className={`mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 ${focusRing}`}>Thử lại</button>
  </div>;
}

export function StatusBadge({ status }: { status?: string }) {
  const value = status || 'unknown';
  const tone = value === 'online' || value === 'completed' || value === 'downloaded' || value === 'approved'
    ? 'border-emerald-800/70 bg-emerald-950/50 text-emerald-300'
    : value === 'running' || value === 'downloading' || value === 'preview_ready'
      ? 'border-cyan-800/70 bg-cyan-950/50 text-cyan-300'
      : value === 'draining' || value === 'queued' || value === 'requested'
        ? 'border-amber-800/70 bg-amber-950/50 text-amber-300'
        : value === 'failed' || value === 'cancelled' || value === 'disabled' || value === 'rejected'
          ? 'border-rose-800/70 bg-rose-950/50 text-rose-300'
          : 'border-slate-700 bg-slate-800/60 text-slate-400';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{value}</span>;
}

export function ConfirmDialog({ title, detail, confirmLabel, onConfirm, onClose, destructive = true }: {
  title: string; detail: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; destructive?: boolean;
}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="alertdialog" aria-modal="true" aria-labelledby="lan-confirm-title" aria-describedby="lan-confirm-detail" className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
      <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" /><div><h2 id="lan-confirm-title" className="font-semibold">{title}</h2><p id="lan-confirm-detail" className="mt-1 text-sm text-slate-400">{detail}</p></div></div>
      <div className="mt-5 flex justify-end gap-2"><button autoFocus onClick={onClose} className={`rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700 ${focusRing}`}>Quay lại</button><button onClick={onConfirm} className={`rounded-lg px-3 py-2 text-sm font-medium ${destructive ? 'bg-rose-700 hover:bg-rose-600' : 'bg-indigo-600 hover:bg-indigo-500'} ${focusRing}`}>{confirmLabel}</button></div>
    </div>
  </div>;
}

export function formatTime(value?: number | string | null) {
  if (value === undefined || value === null || value === '') return '—';
  const numeric = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB']; let value = bytes; let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
