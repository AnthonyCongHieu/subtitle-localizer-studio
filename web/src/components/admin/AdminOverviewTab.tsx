import React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  DownloadCloud,
  ExternalLink,
  HardDrive,
  Server,
} from 'lucide-react';
import { LanOverview } from '../../types/api';
import { focusRing, MetricCard, StatusBadge, VramBar } from './LanUi';
import { AdminTabId, VideoPreviewTarget } from './types';

interface AdminOverviewTabProps {
  overview: LanOverview;
  isMockMode: boolean;
  onSwitchTab: (tab: AdminTabId) => void;
  onPreviewJob?: (jobTarget: VideoPreviewTarget) => void;
}

export const AdminOverviewTab: React.FC<AdminOverviewTabProps> = ({
  overview,
  isMockMode,
  onSwitchTab,
  onPreviewJob,
}) => {
  const totalVramMb = overview.workers.reduce(
    (sum, w) => sum + (w.is_online ? Number(w.vram_mb || 0) : 0),
    0
  );
  const totalVramGb = (totalVramMb / 1024).toFixed(1);

  const runningJobs = overview.jobs.filter((j) => j.status === 'running');
  const recentCompletedJob = overview.jobs.find((j) => j.status === 'completed');

  return (
    <div className="space-y-6">
      {isMockMode && (
        <div className="rounded-2xl border border-purple-800/60 bg-purple-950/30 p-3.5 text-xs text-purple-200 flex items-center justify-between">
          <span>Đang hiển thị số liệu từ cụm giả lập Sandbox (Tiến trình realtime đang chạy mô phỏng).</span>
          <span className="font-mono text-[10px] text-purple-400">MOCK_SANDBOX_ACTIVE</span>
        </div>
      )}

      {/* 1. Bento Grid Chỉ Số Tổng Quan */}
      <section aria-label="Bento Metrics Cụm" className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Trạm Worker Sẵn Sàng"
          value={`${overview.online_worker_count} / ${overview.worker_count}`}
          subtext={`${overview.workers.filter((w) => w.status === 'draining').length} node đang drain tải`}
          icon={Server}
          tone="emerald"
        />
        <MetricCard
          title="Tác Vụ Đang Thực Thi"
          value={overview.running_job_count}
          subtext={`${overview.queue_depth} job trong hàng đợi`}
          icon={Activity}
          tone="cyan"
        />
        <MetricCard
          title="Tổng Sức Mạnh VRAM Cụm"
          value={`${totalVramGb} GB`}
          subtext="Tài nguyên card đồ họa online"
          icon={HardDrive}
          tone="indigo"
        />
        <MetricCard
          title="Yêu Cầu Tải & Thất Bại"
          value={`${overview.pending_download_count} / ${overview.failed_job_count}`}
          subtext={`${overview.pending_download_count} tải chờ duyệt · ${overview.failed_job_count} lỗi`}
          icon={DownloadCloud}
          tone={overview.failed_job_count > 0 ? 'rose' : 'amber'}
        />
      </section>

      {/* 2. Cảnh báo hoặc Thông báo Tác Vụ Cần Chú Ý */}
      {(overview.failed_job_count > 0 || overview.pending_download_count > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-800/40 bg-gradient-to-r from-amber-950/40 to-slate-900 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-white">Cần người điều hành chú ý: </span>
              {overview.failed_job_count > 0 && (
                <span className="text-rose-300 font-medium mr-2">
                  {overview.failed_job_count} job gặp lỗi thực thi.
                </span>
              )}
              {overview.pending_download_count > 0 && (
                <span className="text-amber-300 font-medium">
                  {overview.pending_download_count} video đang chờ phê duyệt tải.
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {overview.failed_job_count > 0 && (
              <button
                onClick={() => onSwitchTab('jobs')}
                className={`rounded-xl border border-rose-800/60 bg-rose-950/60 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900 transition-colors ${focusRing}`}
              >
                Xử lý Job Lỗi
              </button>
            )}
            {overview.pending_download_count > 0 && (
              <button
                onClick={() => onSwitchTab('downloads')}
                className={`rounded-xl border border-amber-800/60 bg-amber-950/60 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900 transition-colors ${focusRing}`}
              >
                Duyệt Tải Ngay
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Phân Lưới 2 Cột: Worker Nodes Tóm Tắt & Live Jobs Monitor */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Cột Trái: Trạng thái Worker Nodes */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-emerald-950/70 p-1.5 text-emerald-400 border border-emerald-800/50">
                <Cpu className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-bold text-white">Trạm Worker Đang Trực Tuyến</h2>
            </div>
            <button
              onClick={() => onSwitchTab('workers')}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              Xem tất cả ({overview.workers.length})
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-3">
            {overview.workers.slice(0, 3).map((worker) => (
              <div
                key={worker.worker_id}
                className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-2 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-xs text-white flex items-center gap-2">
                      {worker.worker_id}
                      <span className="text-[10px] text-slate-500 font-mono">
                        {worker.platform || 'windows'}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-400">{worker.gpu_name || 'CPU Machine'}</p>
                  </div>
                  <StatusBadge
                    status={
                      !worker.is_online && worker.status !== 'disabled'
                        ? 'offline'
                        : worker.status
                    }
                  />
                </div>
                {worker.vram_mb ? (
                  <VramBar vramMb={worker.vram_mb} />
                ) : (
                  <p className="text-[11px] text-slate-500">Chế độ tính toán CPU đa luồng</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Cột Phải: Tiến Độ Job Thời Gian Thực */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-cyan-950/70 p-1.5 text-cyan-400 border border-cyan-800/50">
                <Activity className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-bold text-white">Tiến Độ Điều Phối Trực Tiếp</h2>
            </div>
            <button
              onClick={() => onSwitchTab('jobs')}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              Mở Hàng Đợi ({overview.jobs.length})
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-3">
            {!runningJobs.length && !recentCompletedJob ? (
              <div className="py-8 text-center text-xs text-slate-500 italic">
                Hiện không có job nào đang chạy trong cụm LAN.
              </div>
            ) : (
              <>
                {runningJobs.slice(0, 2).map((job) => {
                  const pct = Math.round(Number(job.progress || 0));
                  return (
                    <div
                      key={job.job_id}
                      className="rounded-xl border border-cyan-900/30 bg-slate-950/60 p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-cyan-300">
                          {job.job_id}
                        </span>
                        <span className="font-bold text-cyan-400 font-mono">{pct}%</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {job.current_stage || job.stage || 'Đang thực thi'}
                      </p>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full bg-cyan-500 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                {recentCompletedJob && onPreviewJob && (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3 text-xs">
                    <div>
                      <p className="font-semibold text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Job hoàn thành gần nhất: {recentCompletedJob.job_id}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Dự án: {recentCompletedJob.project_id || 'Drama Ep'}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        onPreviewJob({
                          job_id: recentCompletedJob.job_id,
                          project_id: recentCompletedJob.project_id,
                          title: `Video Kết Quả: ${recentCompletedJob.job_id}`,
                          video_url: '',
                          status: 'completed',
                          stage: recentCompletedJob.stage,
                          metrics: recentCompletedJob.metrics,
                          worker_id: recentCompletedJob.worker_id,
                        })
                      }
                      className={`rounded-lg bg-emerald-800/80 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-700 transition-colors ${focusRing}`}
                    >
                      Xem Video & Editor
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
