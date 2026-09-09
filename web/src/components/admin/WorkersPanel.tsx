import { Ban, PauseCircle, PlayCircle } from 'lucide-react';
import { LanWorker } from '../../types/api';
import { EmptyState, focusRing, formatTime, StatusBadge } from './LanUi';

type Props = {
  workers: LanWorker[];
  isPending: (key: string) => boolean;
  onStatus: (worker: LanWorker, status: 'online' | 'draining' | 'disabled') => void;
};

function Capabilities({ worker }: { worker: LanWorker }) {
  const items = Object.entries(worker.capabilities || {}).filter(([, enabled]) => Boolean(enabled));
  if (!items.length) return <span className="text-slate-500">Chưa khai báo</span>;
  return <div className="flex flex-wrap gap-1">{items.map(([name, value]) => <span key={name} className="rounded bg-indigo-950/60 px-1.5 py-0.5 text-[11px] text-indigo-300">{name}{value === true ? '' : `: ${String(value)}`}</span>)}</div>;
}

function WorkerActions({ worker, isPending, onStatus }: Props & { worker: LanWorker }) {
  const busy = isPending(`worker:${worker.worker_id}`);
  const base = `rounded-md px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
  if (worker.status === 'disabled') return <button disabled={busy} aria-label={`Bật worker ${worker.worker_id}`} onClick={() => onStatus(worker, 'online')} className={`${base} bg-emerald-800 hover:bg-emerald-700`}><PlayCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Đang bật…' : 'Bật'}</button>;
  return <div className="flex flex-wrap gap-1.5"><button disabled={busy} aria-label={`${worker.status === 'draining' ? 'Cho nhận job' : 'Drain'} worker ${worker.worker_id}`} onClick={() => onStatus(worker, worker.status === 'draining' ? 'online' : 'draining')} className={`${base} bg-slate-800 hover:bg-slate-700`}>{worker.status === 'draining' ? <PlayCircle className="mr-1 inline h-3.5 w-3.5" /> : <PauseCircle className="mr-1 inline h-3.5 w-3.5" />}{worker.status === 'draining' ? 'Nhận job' : 'Drain'}</button><button disabled={busy} aria-label={`Vô hiệu hóa worker ${worker.worker_id}`} onClick={() => onStatus(worker, 'disabled')} className={`${base} bg-rose-950 text-rose-300 hover:bg-rose-900`}><Ban className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Vô hiệu hóa</span></button></div>;
}

export function WorkersPanel(props: Props) {
  const { workers } = props;
  return <section aria-labelledby="lan-workers-heading" className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
    <div className="border-b border-slate-800 p-4"><h2 id="lan-workers-heading" className="font-semibold">Workers</h2><p className="mt-0.5 text-xs text-slate-500">Năng lực, tải hiện tại và heartbeat gần nhất.</p></div>
    {!workers.length ? <EmptyState title="Chưa có worker đăng ký">Khởi chạy worker LAN với URL và token của coordinator. Worker sẽ xuất hiện sau heartbeat đầu tiên.</EmptyState> : <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="bg-slate-950/60 text-slate-400"><tr><th scope="col" className="p-3 text-left">Worker</th><th scope="col" className="p-3 text-left">Phần cứng & năng lực</th><th scope="col" className="p-3 text-left">Trạng thái</th><th scope="col" className="p-3 text-left">Tải</th><th scope="col" className="p-3 text-left">Heartbeat</th><th scope="col" className="p-3 text-left">Điều khiển</th></tr></thead><tbody>{workers.map(worker => <tr key={worker.worker_id} className="border-t border-slate-800 align-top hover:bg-slate-800/30"><td className="p-3"><p className="font-medium">{worker.worker_id}</p><p className="text-xs text-slate-500">{worker.hostname || worker.ip_address || 'Không rõ host'}{worker.platform ? ` · ${worker.platform}` : ''}</p>{worker.app_version && <p className="text-xs text-slate-600">App {worker.app_version}</p>}{worker.last_error && <p className="mt-1 max-w-64 text-xs text-rose-300" title={worker.last_error}>{worker.last_error}</p>}</td><td className="p-3"><p>{worker.gpu_name || 'CPU / chưa báo GPU'}</p><p className="mb-1 text-xs text-slate-500">{worker.vram_mb ? `${worker.vram_mb} MB VRAM` : 'VRAM chưa báo'}</p><Capabilities worker={worker} /></td><td className="p-3"><StatusBadge status={!worker.is_online && worker.status !== 'disabled' ? 'offline' : worker.status} /></td><td className="p-3"><p>{worker.queue_depth ?? 0} trong queue</p><p className="max-w-40 truncate font-mono text-xs text-slate-500" title={worker.active_job_id || undefined}>{worker.active_job_id || 'Không có job'}</p></td><td className="p-3 text-slate-400">{formatTime(worker.last_seen)}</td><td className="p-3"><WorkerActions {...props} worker={worker} /></td></tr>)}</tbody></table></div>
      <div className="grid gap-3 p-3 md:hidden">{workers.map(worker => <article key={worker.worker_id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-medium">{worker.worker_id}</h3><p className="text-xs text-slate-500">{worker.hostname || worker.ip_address || 'Không rõ host'}</p></div><StatusBadge status={!worker.is_online && worker.status !== 'disabled' ? 'offline' : worker.status} /></div><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Phần cứng</dt><dd>{worker.gpu_name || 'CPU'}</dd></div><div><dt className="text-xs text-slate-500">Queue</dt><dd>{worker.queue_depth ?? 0}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">Năng lực</dt><dd className="mt-1"><Capabilities worker={worker} /></dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">Heartbeat</dt><dd>{formatTime(worker.last_seen)}</dd></div></dl><div className="mt-4"><WorkerActions {...props} worker={worker} /></div></article>)}</div>
    </>}
  </section>;
}
