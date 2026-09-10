import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Film,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { LanJob } from '../../types/api';
import { EmptyState, focusRing, formatTime, StatusBadge } from './LanUi';
import { VideoPreviewTarget } from './types';

interface AdminJobsTabProps {
  jobs: LanJob[];
  isPending: (key: string) => boolean;
  onCancel: (job: LanJob) => void;
  onRetry: (job: LanJob) => void;
  onDelete?: (job: LanJob) => void;
  onPreviewJob: (target: VideoPreviewTarget) => void;
  onBatchRetryFailed?: () => void;
  onCreateJob?: () => void;
}

function progressPercent(job: LanJob) {
  const value = Number(job.progress ?? 0);
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function JobDetails({ job }: { job: LanJob }) {
  const metrics =
    job.metrics && Object.keys(job.metrics).length ? JSON.stringify(job.metrics, null, 2) : '';

  return (
    <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950 p-4 text-xs">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-slate-500 font-medium">Giai đoạn thực thi</p>
          <p className="font-semibold text-slate-200 mt-0.5">
            {job.current_stage || job.stage || job.job_type || '—'}
          </p>
        </div>
        <div>
          <p className="text-slate-500 font-medium">Số lần thử (Attempt)</p>
          <p className="font-mono text-slate-200 mt-0.5">
            {job.attempt ?? 1} / {job.max_attempts ?? 3}
          </p>
        </div>
        <div>
          <p className="text-slate-500 font-medium">Khóa tác vụ (Lease ID)</p>
          <p className="font-mono text-slate-300 truncate mt-0.5" title={job.lease_id || undefined}>
            {job.lease_id || '—'}
          </p>
          <p className="text-[10px] text-slate-500">{formatTime(job.lease_expires_at)}</p>
        </div>
        <div>
          <p className="text-slate-500 font-medium">Thời gian cập nhật</p>
          <p className="text-slate-300 mt-0.5">{formatTime(job.updated_at)}</p>
        </div>
      </div>

      {job.error && (
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-rose-300">
          <p className="font-bold flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-4 w-4" />
            Chi tiết lỗi xảy ra:
          </p>
          <p className="font-mono text-xs whitespace-pre-wrap">{job.error}</p>
        </div>
      )}

      {metrics && (
        <div>
          <p className="mb-1 text-slate-400 font-medium">Dữ liệu đo đạc (Metrics):</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2.5 font-mono text-[11px] text-slate-300">
            {metrics}
          </pre>
        </div>
      )}
    </div>
  );
}

export const AdminJobsTab: React.FC<AdminJobsTabProps> = ({
  jobs,
  isPending,
  onCancel,
  onRetry,
  onDelete,
  onPreviewJob,
  onBatchRetryFailed,
  onCreateJob,
}) => {
  const [filterText, setFilterText] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      const needle = filterText.trim().toLowerCase();
      const matchesSearch =
        !needle ||
        [job.job_id, job.project_id, job.worker_id, job.current_stage, job.job_type, job.stage].some(
          (val) => String(val || '').toLowerCase().includes(needle)
        );
      const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [jobs, filterText, statusFilter]);

  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <section
      aria-labelledby="jobs-tab-heading"
      className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm"
    >
      {/* Header & Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 id="jobs-tab-heading" className="text-base font-bold text-white flex items-center gap-2">
            Điều Phối Hàng Đợi & Tiến Độ Jobs ({jobs.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Theo dõi tiến trình thời gian thực, bóc tách lỗi và đưa video hoàn thành vào Editor.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Nút Thêm Job mới */}
          {onCreateJob && (
            <button
              onClick={onCreateJob}
              className={`flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-500 hover:to-cyan-500 transition-all ${focusRing}`}
            >
              <Plus className="h-3.5 w-3.5" />
              Thêm Job
            </button>
          )}

          {failedCount > 0 && onBatchRetryFailed && (
            <button
              onClick={onBatchRetryFailed}
              className={`flex items-center gap-1.5 rounded-xl border border-amber-800/60 bg-amber-950/60 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-900 transition-colors ${focusRing}`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry {failedCount} Job Lỗi
            </button>
          )}

          {/* Ô tìm kiếm */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Tìm job, project, worker…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className={`h-9 w-52 rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-xs text-slate-200 placeholder-slate-500 ${focusRing}`}
            />
          </div>

          {/* Lọc trạng thái */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`h-9 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200 ${focusRing}`}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="running">Đang chạy</option>
            <option value="queued">Hàng đợi</option>
            <option value="completed">Hoàn thành</option>
            <option value="failed">Thất bại</option>
            <option value="cancelled">Đã hủy</option>
          </select>
        </div>
      </div>

      {/* Danh sách Jobs */}
      {!visibleJobs.length ? (
        <EmptyState
          title={jobs.length ? 'Không có job nào phù hợp với bộ lọc' : 'Hàng đợi hiện đang trống'}
          icon={Activity}
        >
          {jobs.length
            ? 'Hãy thử thay đổi từ khóa tìm kiếm hoặc lọc theo trạng thái khác.'
            : 'Các tác vụ điều phối từ coordinator hoặc worker sẽ xuất hiện và cập nhật tiến trình tại đây.'}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {visibleJobs.map((job) => {
            const busy = isPending(`job:${job.job_id}`);
            const pct = progressPercent(job);
            const isRunning = job.status === 'running';
            const isCompleted = job.status === 'completed';
            const isFailed = job.status === 'failed';
            const isTerminal = ['failed', 'cancelled', 'completed'].includes(job.status || '');
            const isExpanded = expandedId === job.job_id;

            return (
              <div
                key={job.job_id}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 transition-all duration-200 hover:border-slate-700"
              >
                {/* Dòng chính */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                  {/* Cột 1: ID, Project & Worker */}
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : job.job_id)}
                      className={`rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors ${focusRing}`}
                      title={isExpanded ? 'Thu gọn chi tiết' : 'Mở rộng chi tiết'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-white">{job.job_id}</span>
                        <StatusBadge status={job.status} />
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        Dự án: <strong className="text-slate-300">{job.project_id || 'Chưa liên kết'}</strong> · Worker: {job.worker_id || 'Chưa gán'}
                      </p>
                    </div>
                  </div>

                  {/* Cột 2: Tiến độ & Stage */}
                  <div className="flex flex-1 items-center gap-3 min-w-[200px] max-w-md">
                    <div className="w-full space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 truncate max-w-[220px]">
                          {job.current_stage || job.stage || 'Đang xử lý'}
                        </span>
                        <span className="font-mono font-bold text-indigo-400">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isCompleted
                              ? 'bg-emerald-500'
                              : isFailed
                              ? 'bg-rose-500'
                              : 'bg-indigo-500 animate-pulse'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Cột 3: Nút Hành Động */}
                  <div className="flex items-center gap-2">
                    {/* Nút Xem Video & Đưa vào Editor khi Completed */}
                    {isCompleted && (
                      <button
                        onClick={() =>
                          onPreviewJob({
                            job_id: job.job_id,
                            project_id: job.project_id,
                            title: `Video Hoàn Thành: ${job.job_id}`,
                            video_url: '',
                            status: job.status,
                            stage: job.stage,
                            metrics: job.metrics,
                            worker_id: job.worker_id,
                          })
                        }
                        className={`flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-700 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-700/20 hover:from-emerald-600 hover:to-teal-600 transition-all ${focusRing}`}
                        title="Xem trước kết quả và đưa vào Studio Editor"
                      >
                        <Film className="h-3.5 w-3.5" />
                        Xem Video & Editor
                      </button>
                    )}

                    {/* Hủy job */}
                    {isRunning && (
                      <button
                        disabled={busy}
                        onClick={() => onCancel(job)}
                        className={`flex items-center gap-1 rounded-xl border border-rose-900/60 bg-rose-950/60 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900 transition-colors ${focusRing}`}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {busy ? 'Đang hủy…' : 'Hủy'}
                      </button>
                    )}

                    {/* Retry job */}
                    {['failed', 'cancelled'].includes(job.status || '') && (
                      <button
                        disabled={busy}
                        onClick={() => onRetry(job)}
                        className={`flex items-center gap-1 rounded-xl border border-amber-800/60 bg-amber-950/60 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-900 transition-colors ${focusRing}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {busy ? 'Đang thử lại…' : 'Retry'}
                      </button>
                    )}

                    {/* Xóa job */}
                    {isTerminal && onDelete && (
                      <button
                        disabled={busy}
                        onClick={() => onDelete(job)}
                        className={`rounded-xl border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:bg-rose-950 hover:text-rose-300 transition-colors ${focusRing}`}
                        title="Xóa job khỏi lịch sử"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Chi tiết khi mở rộng */}
                {isExpanded && (
                  <div className="border-t border-slate-800/80 bg-slate-950/40 p-4">
                    <JobDetails job={job} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
