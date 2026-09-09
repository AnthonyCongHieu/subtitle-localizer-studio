import React, { useState } from 'react';
import { Activity, BriefcaseBusiness, Clock3, RefreshCw, Server, Wifi } from 'lucide-react';
import { LanDownload, LanJob, LanWorker } from '../../types/api';
import { DownloadsPanel } from './DownloadsPanel';
import { JobsPanel } from './JobsPanel';
import { ConfirmDialog, focusRing, InitialState } from './LanUi';
import { useLanOverview } from './useLanOverview';
import { WorkersPanel } from './WorkersPanel';

type Confirmation = { title: string; detail: string; label: string; run: () => void; destructive?: boolean } | null;

export const AdminLanView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const lan = useLanOverview();
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  if (!lan.overview) return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6"><div className="mx-auto max-w-7xl"><InitialState error={lan.loading ? null : lan.error} onRetry={lan.refresh} /></div></main>;
  const { overview } = lan;
  const askWorkerStatus = (worker: LanWorker, status: 'online' | 'draining' | 'disabled') => {
    if (status !== 'disabled') { void lan.setWorkerStatus(worker.worker_id, status); return; }
    setConfirmation({ title: 'Vô hiệu hóa worker?', detail: `Worker ${worker.worker_id} sẽ không nhận job hoặc download mới cho tới khi được bật lại.`, label: 'Vô hiệu hóa', run: () => void lan.setWorkerStatus(worker.worker_id, status) });
  };
  const askCancel = (job: LanJob) => setConfirmation({ title: 'Hủy job đang xử lý?', detail: `Job ${job.job_id} sẽ chuyển sang cancelled. Bạn có thể retry sau.`, label: 'Hủy job', run: () => void lan.cancelJob(job.job_id) });
  const askDecision = (item: LanDownload, approved: boolean) => {
    if (approved) { void lan.decide(item.request_id, true); return; }
    setConfirmation({ title: 'Từ chối yêu cầu tải?', detail: `${item.title || item.source || item.request_id} sẽ không được worker tải.`, label: 'Từ chối tải', run: () => void lan.decide(item.request_id, false) });
  };
  const connectionLabel = lan.connection === 'connected' ? 'Realtime đã kết nối' : lan.connection === 'reconnecting' ? 'Đang kết nối lại' : lan.connection === 'connecting' ? 'Đang kết nối' : 'Realtime mất kết nối';
  const ageSeconds = Math.round((lan.ageMs || 0) / 1000);
  const stats = [
    { label: 'Worker đã đăng ký', value: overview.worker_count, icon: Server, tone: 'text-cyan-400' },
    { label: 'Đang sẵn sàng', value: `${overview.online_worker_count} / ${overview.worker_count}`, icon: Wifi, tone: 'text-emerald-400' },
    { label: 'Job đang chạy', value: overview.running_job_count, icon: BriefcaseBusiness, tone: 'text-amber-400' },
    { label: 'Item trong queue', value: overview.queue_depth, icon: Activity, tone: 'text-violet-400' },
  ];
  return <main className="min-h-screen overflow-auto bg-slate-950 p-4 text-slate-100 md:p-6">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-indigo-400">Admin LAN · Control plane</p><h1 className="text-2xl font-bold">Điều phối Worker & Job</h1><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400"><span className={lan.connection === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{connectionLabel}</span><span aria-hidden="true">·</span><span className={lan.stale ? 'text-amber-300' : ''}><Clock3 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Cập nhật {ageSeconds < 2 ? 'vừa xong' : `${ageSeconds} giây trước`}{lan.stale ? ' · dữ liệu cũ' : ''}</span><span aria-hidden="true">·</span><span>Polling dự phòng 10 giây</span></div></div><div className="flex gap-2"><button onClick={lan.refresh} disabled={lan.refreshing} className={`rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700 disabled:opacity-50 ${focusRing}`}><RefreshCw className={`mr-2 inline h-4 w-4 ${lan.refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />{lan.refreshing ? 'Đang đồng bộ…' : 'Đồng bộ'}</button><button onClick={onBack} className={`rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500 ${focusRing}`}>Về Dashboard</button></div></header>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{lan.notice?.message}</div>
      {lan.notice && <div role={lan.notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${lan.notice.tone === 'error' ? 'border-rose-800 bg-rose-950/40 text-rose-300' : 'border-emerald-800 bg-emerald-950/30 text-emerald-300'}`}>{lan.notice.message}</div>}
      {lan.error && !lan.notice && <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">Lần đồng bộ gần nhất thất bại: {lan.error}. Đang giữ dữ liệu trước đó và sẽ thử lại.</div>}
      <section aria-label="Tổng quan LAN" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{stats.map(({ label, value, icon: Icon, tone }) => <article key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" /><p className="mt-2 text-2xl font-bold">{value}</p><p className="text-sm text-slate-400">{label}</p></article>)}</section>
      {(overview.failed_job_count > 0 || overview.pending_download_count > 0) && <p className="text-sm text-slate-400">Cần chú ý: <span className="text-rose-300">{overview.failed_job_count} job lỗi</span> · <span className="text-amber-300">{overview.pending_download_count} yêu cầu tải chờ duyệt</span></p>}
      <WorkersPanel workers={overview.workers} isPending={lan.isPending} onStatus={askWorkerStatus} />
      <JobsPanel jobs={overview.jobs} isPending={lan.isPending} onCancel={askCancel} onRetry={job => void lan.retryJob(job.job_id)} />
      <DownloadsPanel downloads={overview.downloads} isPending={lan.isPending} onDecision={askDecision} />
    </div>
    {confirmation && <ConfirmDialog title={confirmation.title} detail={confirmation.detail} confirmLabel={confirmation.label} destructive={confirmation.destructive} onClose={() => setConfirmation(null)} onConfirm={() => { confirmation.run(); setConfirmation(null); }} />}
  </main>;
};
