import React, { useCallback, useEffect, useState } from 'react';
import { Activity, BriefcaseBusiness, RefreshCw, Server } from 'lucide-react';
import { apiClient } from '../../api/client';
import { wsClient } from '../../api/websocket';

export const AdminLanView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [workers, setWorkers] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [jobFilter, setJobFilter] = useState('');
  const [jobStatus, setJobStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [w, j, d] = await Promise.all([apiClient.listWorkers(), apiClient.listAdminJobs(), apiClient.listDownloadApprovals()]); setWorkers(w); setJobs(j); setDownloads(d); }
    catch (e: any) { setError(e?.message || 'Không thể tải trạng thái LAN'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10000);
    wsClient.connect();
    const unsubscribe = wsClient.onEvent(() => { refresh(); });
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, [refresh]);
  const decide = async (requestId: string, approved: boolean) => {
    try { await apiClient.decideDownload(requestId, approved); await refresh(); }
    catch (e: any) { setError(e?.message || 'Không thể cập nhật quyết định tải'); }
  };
  const setWorkerStatus = async (workerId: string, status: 'draining' | 'online') => {
    try { await apiClient.setWorkerStatus(workerId, status); await refresh(); }
    catch (e: any) { setError(e?.message || 'Không thể cập nhật worker'); }
  };
  const cancelJob = async (jobId: string) => {
    try { await apiClient.cancelAdminJob(jobId); await refresh(); }
    catch (e: any) { setError(e?.message || 'Không thể hủy job'); }
  };
  const retryJob = async (jobId: string) => {
    try { await apiClient.retryAdminJob(jobId); await refresh(); }
    catch (e: any) { setError(e?.message || 'Không thể retry job'); }
  };
  const visibleJobs = jobs.filter(j => {
    const needle = jobFilter.trim().toLowerCase();
    const matchesText = !needle || [j.job_id, j.project_id, j.worker_id].some(v => String(v || '').toLowerCase().includes(needle));
    return matchesText && (jobStatus === 'all' || j.status === jobStatus);
  });
  return <div className="h-screen bg-slate-950 text-slate-100 p-6 overflow-auto">
    <div className="max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-widest text-indigo-400">Admin LAN</p><h1 className="text-2xl font-bold">Quản lý Worker & Job</h1></div><div className="flex gap-2"><button onClick={refresh} className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700"><RefreshCw className="w-4 h-4 inline mr-2"/>Làm mới</button><button onClick={onBack} className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500">Về Dashboard</button></div></header>
      {error && <div className="p-3 rounded border border-rose-800 bg-rose-950/40 text-rose-300">{error}</div>}
      <section className="grid md:grid-cols-3 gap-4"><div className="p-4 rounded-xl bg-slate-900 border border-slate-800"><Server className="text-cyan-400"/><p className="text-2xl font-bold mt-2">{workers.length}</p><p className="text-slate-400 text-sm">Worker đã đăng ký</p></div><div className="p-4 rounded-xl bg-slate-900 border border-slate-800"><Activity className="text-emerald-400"/><p className="text-2xl font-bold mt-2">{workers.filter(w => w.is_online).length}</p><p className="text-slate-400 text-sm">Đang online</p></div><div className="p-4 rounded-xl bg-slate-900 border border-slate-800"><BriefcaseBusiness className="text-amber-400"/><p className="text-2xl font-bold mt-2">{jobs.filter(j => j.status === 'running').length}</p><p className="text-slate-400 text-sm">Job đang chạy</p></div></section>
      <section className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"><h2 className="p-4 font-semibold border-b border-slate-800">Workers</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-slate-400"><tr><th className="p-3 text-left">Worker</th><th className="p-3 text-left">GPU</th><th className="p-3 text-left">Trạng thái</th><th className="p-3 text-left">Job</th><th className="p-3 text-left">Queue</th><th className="p-3 text-left">Heartbeat</th><th className="p-3 text-left">Điều khiển</th></tr></thead><tbody>{workers.map(w => <tr key={w.worker_id} className="border-t border-slate-800"><td className="p-3">{w.worker_id}<div className="text-xs text-slate-500">{w.hostname || w.ip_address || '—'}</div>{w.last_error && <div className="text-xs text-rose-300 truncate max-w-48" title={w.last_error}>Lỗi: {w.last_error}</div>}</td><td className="p-3">{w.gpu_name || 'CPU'}<div className="text-xs text-slate-500">{w.vram_mb ? `${w.vram_mb} MB` : ''}</div></td><td className="p-3"><span className={w.is_online ? 'text-emerald-400' : 'text-slate-500'}>{w.is_online ? 'Online' : 'Offline'}</span>{w.status === 'draining' && <div className="text-xs text-amber-400">Draining</div>}</td><td className="p-3">{w.active_job_id || '—'}</td><td className="p-3">{w.queue_depth ?? 0}</td><td className="p-3 text-slate-400">{new Date(w.last_seen * 1000).toLocaleTimeString()}</td><td className="p-3"><button onClick={() => setWorkerStatus(w.worker_id, w.status === 'draining' ? 'online' : 'draining')} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs">{w.status === 'draining' ? 'Nhận job mới' : 'Drain'}</button></td></tr>)}{!workers.length && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Chưa có worker đăng ký</td></tr>}</tbody></table></div></section>
      <section className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"><div className="p-4 border-b border-slate-800 flex flex-wrap gap-2 items-center"><h2 className="font-semibold mr-auto">Jobs</h2><input aria-label="Tìm job" value={jobFilter} onChange={e => setJobFilter(e.target.value)} placeholder="Tìm job / project / worker" className="px-3 py-2 rounded bg-slate-950 border border-slate-700 text-sm"/><select aria-label="Lọc trạng thái" value={jobStatus} onChange={e => setJobStatus(e.target.value)} className="px-3 py-2 rounded bg-slate-950 border border-slate-700 text-sm"><option value="all">Tất cả trạng thái</option><option value="queued">queued</option><option value="running">running</option><option value="completed">completed</option><option value="failed">failed</option><option value="cancelled">cancelled</option></select></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-slate-400"><tr><th className="p-3 text-left">Job</th><th className="p-3 text-left">Project</th><th className="p-3 text-left">Worker</th><th className="p-3 text-left">Trạng thái</th><th className="p-3 text-left">Tiến độ</th><th className="p-3 text-left">Điều khiển</th></tr></thead><tbody>{visibleJobs.map(j => <React.Fragment key={j.job_id}><tr className="border-t border-slate-800"><td className="p-3 font-mono text-xs"><button className="text-indigo-300 hover:underline" onClick={() => setExpandedJob(expandedJob === j.job_id ? null : j.job_id)}>{j.job_id}</button></td><td className="p-3">{j.project_id}</td><td className="p-3">{j.worker_id}</td><td className="p-3">{j.status}</td><td className="p-3">{Math.round((j.progress || 0) * 100)}%</td><td className="p-3">{['queued', 'running'].includes(j.status) ? <button onClick={() => cancelJob(j.job_id)} className="px-2 py-1 rounded bg-rose-800 hover:bg-rose-700 text-xs">Hủy</button> : ['failed', 'cancelled'].includes(j.status) ? <button onClick={() => retryJob(j.job_id)} className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs">Retry</button> : <span className="text-slate-500">—</span>}</td></tr>{expandedJob === j.job_id && <tr className="bg-slate-950"><td colSpan={6} className="p-3 text-xs"><div className="text-slate-400 mb-1">Metrics / stage</div><pre className="whitespace-pre-wrap text-slate-300">{JSON.stringify(j.metrics || {}, null, 2)}</pre>{j.error && <div className="text-rose-300 mt-2">Lỗi: {j.error}</div>}</td></tr>}</React.Fragment>)}{!visibleJobs.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Không có job phù hợp</td></tr>}</tbody></table></div></section>
      <section className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden"><h2 className="p-4 font-semibold border-b border-slate-800">Duyệt tải video</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-slate-400"><tr><th className="p-3 text-left">Video</th><th className="p-3 text-left">Worker</th><th className="p-3 text-left">Thời lượng</th><th className="p-3 text-left">Trạng thái</th><th className="p-3 text-left">Quyết định</th></tr></thead><tbody>{downloads.map(d => <tr key={d.request_id} className="border-t border-slate-800"><td className="p-3"><div>{d.title || d.source}</div><div className="text-xs text-slate-500 max-w-xl truncate">{d.source}</div></td><td className="p-3">{d.worker_id}</td><td className="p-3">{d.duration_seconds ? `${Math.round(d.duration_seconds)} giây` : '—'}</td><td className="p-3">{d.status}</td><td className="p-3">{d.status === 'preview_ready' ? <div className="flex gap-2"><button onClick={() => decide(d.request_id, true)} className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500">Duyệt tải</button><button onClick={() => decide(d.request_id, false)} className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-600">Từ chối</button></div> : <span className="text-slate-500">Đã xử lý</span>}</td></tr>)}{!downloads.length && <tr><td colSpan={5} className="p-6 text-center text-slate-500">Chưa có yêu cầu chờ duyệt</td></tr>}</tbody></table></div></section>
      {loading && <p className="text-xs text-slate-500">Đang đồng bộ...</p>}
    </div>
  </div>;
};
