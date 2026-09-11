import React, { useCallback, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Clock3,
  DownloadCloud,
  FlaskConical,
  LayoutDashboard,
  RefreshCw,
  Server,
  Sparkles,
} from 'lucide-react';
import { LanDownload, LanJob, LanWorker, SubtitleCueV1 } from '../../types/api';
import { AdminDownloadsTab } from './AdminDownloadsTab';
import { AdminJobsTab } from './AdminJobsTab';
import { AdminOverviewTab } from './AdminOverviewTab';
import { AdminWorkersTab } from './AdminWorkersTab';
import { CreateJobModal, CreateJobPayload } from './CreateJobModal';
import { JobVideoPreviewModal } from './JobVideoPreviewModal';
import { ConfirmDialog, focusRing, InitialState, LatencyPill } from './LanUi';
import { MOCK_COMPLETED_CUES } from './mockData';
import { AdminTabId, VideoPreviewTarget } from './types';
import { useLanOverview } from './useLanOverview';
import { WorkerConfigDrawer } from './WorkerConfigDrawer';

type Confirmation = {
  title: string;
  detail: string;
  label: string;
  run: () => void;
  destructive?: boolean;
} | null;

interface AdminLanViewProps {
  onBack: () => void;
  onOpenInStudio?: (projectId?: string, videoUrl?: string, cues?: SubtitleCueV1[]) => void;
}

export const AdminLanView: React.FC<AdminLanViewProps> = ({ onBack, onOpenInStudio }) => {
  const lan = useLanOverview();
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  // Drawer Cấu hình Worker
  const [editingWorker, setEditingWorker] = useState<LanWorker | null>(null);

  // Modal Xem trước Video Job
  const [previewTarget, setPreviewTarget] = useState<VideoPreviewTarget | null>(null);

  // Modal Thêm Job mới
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  // Xử lý submit tạo job từ modal
  const handleCreateJobSubmit = useCallback(
    async (payload: CreateJobPayload) => {
      setIsCreatingJob(true);
      try {
        if (payload.mode === 'batch' && payload.batchItems?.length) {
          // Batch mode: tạo nhiều job cùng lúc
          for (const item of payload.batchItems) {
            const projectId = payload.seriesName
              ? `${payload.seriesName.replace(/\s+/g, '-').toLowerCase()}-${item.label.replace(/\s+/g, '-').toLowerCase()}`
              : `batch-${Date.now()}-${item.label.replace(/\s+/g, '-').toLowerCase()}`;
            await lan.createJob({
              projectId,
              jobType: payload.jobType || 'full_pipeline',
              idempotencyKey: `create-${projectId}-${Date.now()}`,
              videoUrl: item.sourceType === 'url' ? item.source : undefined,
              seriesName: payload.seriesName,
            });
          }
        } else {
          // Single mode (local hoặc url)
          const projectId = payload.mode === 'url'
            ? `url-${Date.now()}`
            : `local-${payload.localFile?.name?.replace(/\.\w+$/, '').replace(/\s+/g, '-').toLowerCase() || Date.now()}`;
          await lan.createJob({
            projectId,
            jobType: payload.jobType || 'full_pipeline',
            idempotencyKey: `create-${projectId}-${Date.now()}`,
            videoUrl: payload.mode === 'url' ? payload.videoUrl : undefined,
          });
        }
        setShowCreateJob(false);
      } catch {
        // Lỗi đã được xử lý trong runAction của useLanOverview
      } finally {
        setIsCreatingJob(false);
      }
    },
    [lan]
  );

  if (!lan.overview) {
    return (
      <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
        <div className="mx-auto max-w-7xl">
          <InitialState error={lan.loading ? null : lan.error} onRetry={lan.refresh} />
        </div>
      </main>
    );
  }

  const { overview } = lan;

  // Xử lý Thay đổi trạng thái Worker
  const askWorkerStatus = (worker: LanWorker, status: 'online' | 'draining' | 'disabled') => {
    if (status !== 'disabled') {
      void lan.setWorkerStatus(worker.worker_id, status);
      return;
    }
    setConfirmation({
      title: 'Vô hiệu hóa worker này?',
      detail: `Worker ${worker.worker_id} sẽ không nhận job hoặc tác vụ tải mới cho tới khi được bật lại.`,
      label: 'Vô hiệu hóa',
      run: () => void lan.setWorkerStatus(worker.worker_id, status),
    });
  };

  // Xử lý Xóa Worker
  const askDeleteWorker = (worker: LanWorker) => {
    setConfirmation({
      title: 'Xóa worker này khỏi cụm?',
      detail: `Worker ${worker.worker_id} (${worker.gpu_name || 'CPU'}) sẽ bị xóa hoàn toàn khỏi hệ thống điều phối LAN.`,
      label: 'Xóa worker',
      destructive: true,
      run: () => void lan.deleteWorker(worker.worker_id),
    });
  };

  // Xử lý Hủy Job
  const askCancel = (job: LanJob) =>
    setConfirmation({
      title: 'Hủy tác vụ đang chạy?',
      detail: `Job ${job.job_id} sẽ bị dừng và chuyển sang trạng thái cancelled.`,
      label: 'Hủy job',
      run: () => void lan.cancelJob(job.job_id),
    });

  // Xử lý Xóa Job
  const askDeleteJob = (job: LanJob) => {
    setConfirmation({
      title: 'Xóa job khỏi hàng đợi / lịch sử?',
      detail: `Job ${job.job_id} (${job.project_id || 'Không rõ project'}) sẽ bị xóa vĩnh viễn.`,
      label: 'Xóa job',
      destructive: true,
      run: () => void lan.deleteJob(job.job_id),
    });
  };

  // Xử lý Phê duyệt / Từ chối Tải
  const askDecision = (item: LanDownload, approved: boolean) => {
    if (approved) {
      void lan.decide(item.request_id, true);
      return;
    }
    setConfirmation({
      title: 'Từ chối yêu cầu tải video?',
      detail: `Yêu cầu cho "${item.title || item.source}" sẽ bị hủy và worker sẽ không tải file nguồn.`,
      label: 'Từ chối tải',
      run: () => void lan.decide(item.request_id, false),
    });
  };

  // Kích hoạt xem trước video của Job
  const handleOpenPreview = (target: VideoPreviewTarget) => {
    // Nếu là mock job completed, gắn cues mẫu vào
    if (!target.cues || target.cues.length === 0) {
      target.cues = MOCK_COMPLETED_CUES;
    }
    setPreviewTarget(target);
  };

  // Xử lý chuyển thẳng từ Preview sang Studio Timeline
  const handleTransferToStudio = (target: VideoPreviewTarget) => {
    if (onOpenInStudio) {
      onOpenInStudio(target.project_id, target.video_url, target.cues || MOCK_COMPLETED_CUES);
    } else {
      onBack();
    }
  };

  const connectionLabel =
    lan.connection === 'connected'
      ? 'Realtime đã kết nối'
      : lan.connection === 'reconnecting'
      ? 'Đang kết nối lại'
      : lan.connection === 'connecting'
      ? 'Đang kết nối…'
      : 'Mất kết nối WebSocket';

  const ageSeconds = Math.round((lan.ageMs || 0) / 1000);

  const tabs = [
    {
      id: 'overview' as AdminTabId,
      label: 'Tổng Quan Cụm',
      icon: LayoutDashboard,
      badge: `${overview.online_worker_count}/${overview.worker_count}`,
    },
    {
      id: 'workers' as AdminTabId,
      label: 'Trạm Workers',
      icon: Server,
      badge: overview.worker_count,
    },
    {
      id: 'jobs' as AdminTabId,
      label: 'Hàng Đợi & Jobs',
      icon: Activity,
      badge: overview.running_job_count > 0 ? overview.running_job_count : overview.jobs.length,
      badgeColor: overview.running_job_count > 0 ? 'bg-cyan-500 text-slate-950 font-bold' : undefined,
    },
    {
      id: 'downloads' as AdminTabId,
      label: 'Duyệt Tải Media',
      icon: DownloadCloud,
      badge: overview.pending_download_count,
      badgeColor: overview.pending_download_count > 0 ? 'bg-amber-500 text-slate-950 font-bold' : undefined,
    },
  ];

  return (
    <main className="min-h-screen overflow-y-auto bg-slate-950 p-4 text-slate-100 md:p-6 select-none">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* ========================================================================= */}
        {/* 1. HEADER ĐIỀU HÀNH TRUNG TÂM (OPERATIONS CONTROL PLANE HEADER) */}
        {/* ========================================================================= */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-sm backdrop-blur-md">
          {/* Cụm Tiêu đề & Thông số Realtime */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-400">
                ADMIN LAN · CONTROL PLANE
              </span>
              {lan.isMockMode && (
                <span className="flex items-center gap-1 rounded-full border border-purple-800/80 bg-purple-950/80 px-2 py-0.5 text-[10px] font-bold text-purple-300 shadow-sm animate-pulse">
                  <FlaskConical className="h-3 w-3" />
                  CHẾ ĐỘ GIẢ LẬP MOCK
                </span>
              )}
            </div>

            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
              Trung Tâm Điều Phối Worker & Jobs
            </h1>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <LatencyPill pingMs={lan.pingMs} />
              <span className="flex items-center gap-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    lan.connection === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {connectionLabel}
              </span>
              <span>·</span>
              <span className={lan.stale ? 'text-amber-300' : ''}>
                <Clock3 className="mr-1 inline h-3.5 w-3.5" />
                Cập nhật {ageSeconds < 2 ? 'vừa xong' : `${ageSeconds}s trước`}
              </span>
              {!lan.isMockMode && <span>· Polling 10s</span>}
            </div>
          </div>

          {/* Nhóm Nút Công Cụ Điều Hành */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Công tắc Bật/Tắt Mock Sandbox */}
            <button
              onClick={() => lan.toggleMockMode()}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${focusRing} ${
                lan.isMockMode
                  ? 'border-purple-600 bg-purple-950/80 text-purple-200 shadow-md shadow-purple-900/30'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
              title="Bật/Tắt dữ liệu giả lập để thử nghiệm mọi tính năng không cần worker thật"
            >
              <FlaskConical className={`h-4 w-4 ${lan.isMockMode ? 'text-purple-400' : 'text-slate-400'}`} />
              {lan.isMockMode ? 'Tắt Giả Lập' : 'Bật Giả Lập Mock'}
            </button>

            {/* Đồng bộ Setting Tổng */}
            <button
              onClick={() => void lan.syncAllWithGlobal()}
              className={`flex items-center gap-1.5 rounded-xl border border-indigo-800/60 bg-indigo-950/40 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/60 transition-colors ${focusRing}`}
              title="Đồng bộ lại toàn bộ cấu hình Worker theo Thiết Lập Hệ Thống Tổng"
            >
              <Sparkles className="h-4 w-4 text-indigo-400" />
              Đồng Bộ Setting Tổng
            </button>

            {/* Nút Làm mới / Refresh */}
            <button
              onClick={lan.refresh}
              disabled={lan.refreshing}
              className={`flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition-colors ${focusRing}`}
            >
              <RefreshCw className={`h-4 w-4 ${lan.refreshing ? 'animate-spin' : ''}`} />
              {lan.refreshing ? 'Đang tải…' : 'Làm mới'}
            </button>

            {/* Về Dashboard / Studio */}
            <button
              onClick={onBack}
              className={`flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 transition-colors ${focusRing}`}
            >
              <ArrowLeft className="h-4 w-4" />
              Về Dashboard
            </button>
          </div>
        </header>

        {/* Thông báo Tác Vụ Toàn Cục (Toasts / Alerts) */}
        {lan.notice && (
          <div
            role={lan.notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={lan.notice.tone === 'error' ? 'assertive' : 'polite'}
            className={`rounded-xl border p-3.5 text-xs font-medium ${
              lan.notice.tone === 'error'
                ? 'border-rose-800 bg-rose-950/50 text-rose-200'
                : 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
            }`}
          >
            {lan.notice.message}
          </div>
        )}
        {lan.error && !lan.notice && (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-xl border border-rose-800 bg-rose-950/40 p-3.5 text-xs text-rose-300"
          >
            Lỗi đồng bộ: {lan.error}. Đang lưu giữ trạng thái trước đó.
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. THANH ĐIỀU HƯỚNG TABS (4 TABS CHUYÊN BIỆT) */}
        {/* ========================================================================= */}
        <nav
          aria-label="Tabs Điều Hành Admin"
          className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-3"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer ${focusRing} ${
                  isActive
                    ? 'border border-indigo-500/50 bg-indigo-600/20 text-white shadow-sm'
                    : 'border border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900/60 hover:text-slate-200'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-mono ${
                    tab.badgeColor
                      ? tab.badgeColor
                      : isActive
                      ? 'bg-indigo-600/40 text-indigo-200'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </nav>

        {/* ========================================================================= */}
        {/* 3. NỘI DUNG TỪNG TAB */}
        {/* ========================================================================= */}
        {activeTab === 'overview' && (
          <AdminOverviewTab
            overview={overview}
            isMockMode={lan.isMockMode}
            onSwitchTab={setActiveTab}
            onPreviewJob={handleOpenPreview}
          />
        )}

        {activeTab === 'workers' && (
          <AdminWorkersTab
            workers={overview.workers}
            isPending={lan.isPending}
            onStatus={askWorkerStatus}
            onDelete={askDeleteWorker}
            onOpenConfig={(w) => setEditingWorker(w)}
            workerOverrides={lan.workerOverrides}
          />
        )}

        {activeTab === 'jobs' && (
          <AdminJobsTab
            jobs={overview.jobs}
            isPending={lan.isPending}
            onCancel={askCancel}
            onRetry={(j) => void lan.retryJob(j.job_id)}
            onDelete={askDeleteJob}
            onPreviewJob={handleOpenPreview}
            onBatchRetryFailed={overview.failed_job_count > 0 ? lan.batchRetryFailed : undefined}
            onCreateJob={() => setShowCreateJob(true)}
          />
        )}

        {activeTab === 'downloads' && (
          <AdminDownloadsTab
            downloads={overview.downloads}
            isPending={lan.isPending}
            onDecision={askDecision}
          />
        )}
      </div>

      {/* ========================================================================= */}
      {/* 4. MODALS & SLIDE-OVER DRAWERS */}
      {/* ========================================================================= */}

      {/* Drawer Cấu hình Engine Worker */}
      <WorkerConfigDrawer
        isOpen={Boolean(editingWorker)}
        worker={editingWorker}
        onClose={() => setEditingWorker(null)}
        globalSettings={lan.globalSettings}
        currentOverride={editingWorker ? lan.workerOverrides[editingWorker.worker_id] : undefined}
        onSaveOverride={lan.saveWorkerOverride}
        onResetToGlobal={lan.resetWorkerOverride}
      />

      {/* Modal Quick Preview Video & Đưa vào Studio Editor */}
      <JobVideoPreviewModal
        isOpen={Boolean(previewTarget)}
        target={previewTarget}
        onClose={() => setPreviewTarget(null)}
        onOpenInStudio={handleTransferToStudio}
      />

      {/* Modal Thêm Job Mới (3 đường: local / URL / batch) */}
      <CreateJobModal
        isOpen={showCreateJob}
        onClose={() => setShowCreateJob(false)}
        onSubmit={handleCreateJobSubmit}
        isSubmitting={isCreatingJob}
      />

      {/* Dialog Xác nhận Thao tác Nguy hiểm */}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          detail={confirmation.detail}
          confirmLabel={confirmation.label}
          destructive={confirmation.destructive}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            confirmation.run();
            setConfirmation(null);
          }}
        />
      )}
    </main>
  );
};
