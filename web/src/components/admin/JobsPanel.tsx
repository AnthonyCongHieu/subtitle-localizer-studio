import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { LanJob } from '../../types/api';
import { EmptyState, focusRing, formatTime, StatusBadge } from './LanUi';

type Props = {
  jobs: LanJob[];
  isPending: (key: string) => boolean;
  onCancel: (job: LanJob) => void;
  onRetry: (job: LanJob) => void;
  onDelete?: (job: LanJob) => void;
};

function progressPercent(job: LanJob) {
  const value = Number(job.progress ?? 0);
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function JobDetails({ job }: { job: LanJob }) {
  const metrics = job.metrics && Object.keys(job.metrics).length ? JSON.stringify(job.metrics, null, 2) : '';
  return <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-slate-500">Stage / loại</p><p>{job.current_stage || job.stage || job.job_type || '—'}</p></div><div><p className="text-slate-500">Attempt</p><p>{job.attempt ?? '—'}{job.max_attempts ? ` / ${job.max_attempts}` : ''}</p></div><div><p className="text-slate-500">Lease</p><p className="break-all font-mono">{job.lease_id || '—'}</p><p className="text-slate-500">{formatTime(job.lease_expires_at)}</p></div><div><p className="text-slate-500">Cập nhật</p><p>{formatTime(job.updated_at)}</p></div>{job.error && <div className="sm:col-span-2 lg:col-span-4 rounded border border-rose-900/60 bg-rose-950/30 p-2 text-rose-300">Lỗi: {job.error}</div>}{metrics && <div className="sm:col-span-2 lg:col-span-4"><p className="mb-1 text-slate-500">Metrics</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-slate-300">{metrics}</pre></div>}</div>;
}

function JobActions({ job, isPending, onCancel, onRetry, onDelete }: Props & { job: LanJob }) {
  const busy = isPending(`job:${job.job_id}`);
  const base = `rounded-md px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
  const isTerminal = ['failed', 'cancelled', 'completed'].includes(job.status || '');

  return <div className="flex flex-wrap items-center gap-1.5">
    {['queued', 'running'].includes(job.status || '') && (
      <button disabled={busy} onClick={() => onCancel(job)} className={`${base} bg-rose-950 text-rose-300 hover:bg-rose-900`}>
        <XCircle className="mr-1 inline h-3.5 w-3.5" />{busy ? 'Đang hủy…' : 'Hủy'}
      </button>
    )}
    {['failed', 'cancelled'].includes(job.status || '') && (
      <button disabled={busy} onClick={() => onRetry(job)} className={`${base} bg-amber-800 text-amber-50 hover:bg-amber-700`}>
        <RotateCcw className="mr-1 inline h-3.5 w-3.5" />{busy ? 'Đang retry…' : 'Retry'}
      </button>
    )}
    {isTerminal && onDelete && (
      <button disabled={busy} aria-label={`Xóa job ${job.job_id}`} title="Xóa job khỏi danh sách" onClick={() => onDelete(job)} className={`${base} bg-slate-800 text-rose-400 hover:bg-rose-950 hover:text-rose-200`}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Xóa</span>
      </button>
    )}
  </div>;
}

export function JobsPanel(props: Props) {
  const [filter, setFilter] = useState(''); const [status, setStatus] = useState('all'); const [expanded, setExpanded] = useState<string | null>(null);
  const visible = useMemo(() => props.jobs.filter(job => {
    const needle = filter.trim().toLowerCase();
    const matches = !needle || [job.job_id, job.project_id, job.worker_id, job.current_stage, job.job_type].some(value => String(value || '').toLowerCase().includes(needle));
    return matches && (status === 'all' || job.status === status);
  }), [filter, props.jobs, status]);
  return <section aria-labelledby="lan-jobs-heading" className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-4"><div className="mr-auto"><h2 id="lan-jobs-heading" className="font-semibold">Jobs</h2><p className="mt-0.5 text-xs text-slate-500">Theo dõi stage, tiến độ, attempt và lease.</p></div><label className="sr-only" htmlFor="lan-job-search">Tìm job</label><input id="lan-job-search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Tìm job / project / worker" className={`w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm sm:w-64 ${focusRing}`} /><label className="sr-only" htmlFor="lan-job-status">Lọc trạng thái job</label><select id="lan-job-status" value={status} onChange={event => setStatus(event.target.value)} className={`rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm ${focusRing}`}><option value="all">Tất cả trạng thái</option>{['queued', 'running', 'completed', 'failed', 'cancelled'].map(item => <option key={item}>{item}</option>)}</select></div>
    {!visible.length ? <EmptyState title={props.jobs.length ? 'Không có job phù hợp' : 'Chưa có job LAN'}>{props.jobs.length ? 'Thử đổi từ khóa hoặc trạng thái lọc.' : 'Job được tạo từ coordinator sẽ xuất hiện ở đây và được gán cho worker khả dụng.'}</EmptyState> : <><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="bg-slate-950/40 text-slate-400"><tr><th className="p-3 text-left">Job</th><th className="p-3 text-left">Project / Worker</th><th className="p-3 text-left">Stage</th><th className="p-3 text-left">Trạng thái</th><th className="p-3 text-left">Tiến độ</th><th className="p-3 text-left">Điều khiển</th></tr></thead><tbody>{visible.map(job => <React.Fragment key={job.job_id}><tr className="border-t border-slate-800"><td className="p-3"><button aria-expanded={expanded === job.job_id} onClick={() => setExpanded(expanded === job.job_id ? null : job.job_id)} className={`flex items-center gap-1 font-mono text-xs text-indigo-300 hover:text-indigo-200 ${focusRing}`}>{expanded === job.job_id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{job.job_id}</button></td><td className="p-3"><p>{job.project_id || '—'}</p><p className="text-xs text-slate-500">{job.worker_id || 'Chưa gán'}</p></td><td className="p-3">{job.current_stage || job.stage || job.job_type || '—'}</td><td className="p-3"><StatusBadge status={job.status} /></td><td className="p-3"><div className="flex min-w-28 items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800"><div className="h-full bg-indigo-500" style={{ width: `${progressPercent(job)}%` }} /></div><span className="text-xs">{progressPercent(job)}%</span></div></td><td className="p-3"><JobActions {...props} job={job} /></td></tr>{expanded === job.job_id && <tr className="border-t border-slate-800 bg-slate-950/70"><td colSpan={6} className="p-4"><JobDetails job={job} /></td></tr>}</React.Fragment>)}</tbody></table></div>
      <div className="grid gap-3 p-3 md:hidden">{visible.map(job => <article key={job.job_id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><button aria-expanded={expanded === job.job_id} onClick={() => setExpanded(expanded === job.job_id ? null : job.job_id)} className={`flex w-full items-start justify-between gap-2 text-left ${focusRing}`}><span><span className="block break-all font-mono text-xs text-indigo-300">{job.job_id}</span><span className="text-xs text-slate-500">{job.project_id || 'Không rõ project'} · {job.worker_id || 'Chưa gán'}</span></span><StatusBadge status={job.status} /></button><div className="mt-3 flex items-center gap-2 text-xs"><div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800"><div className="h-full bg-indigo-500" style={{ width: `${progressPercent(job)}%` }} /></div><span>{progressPercent(job)}%</span></div><p className="mt-2 text-sm">Stage: {job.current_stage || job.stage || job.job_type || '—'}</p>{expanded === job.job_id && <div className="mt-3 border-t border-slate-800 pt-3"><JobDetails job={job} /></div>}<div className="mt-4"><JobActions {...props} job={job} /></div></article>)}</div></>}
  </section>;
}
