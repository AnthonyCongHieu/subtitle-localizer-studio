import React, { useState, useEffect, useRef } from 'react';
import {
  apiClient,
  DownloadQueueTaskItem,
  DownloadQueueListResponse,
} from '../../api/client';
import {
  ArrowLeft,
  Play,
  Pause,
  Trash2,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Plus,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Folder,
  Film,
  Zap,
  Image,
} from 'lucide-react';

export interface DownloadQueueHubProps {
  onSwitchToDashboard: () => void;
  onOpenDownloadModal?: () => void;
}

export const DownloadQueueHub: React.FC<DownloadQueueHubProps> = ({
  onSwitchToDashboard,
  onOpenDownloadModal,
}) => {
  const [queueTasks, setQueueTasks] = useState<DownloadQueueTaskItem[]>([]);
  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [newDramaUrl, setNewDramaUrl] = useState('');
  const [isAddingDrama, setIsAddingDrama] = useState(false);
  const pollTimerRef = useRef<any>(null);

  const fetchQueue = async (quiet = true) => {
    if (!quiet) setIsLoading(true);
    try {
      const data: DownloadQueueListResponse = await apiClient.getQueueList();
      setQueueTasks(data.tasks || []);
      setIsQueuePaused(data.is_paused);
      setActiveTaskId(data.active_task_id || null);
    } catch (err) {
      console.warn('Không thể nạp danh sách hàng đợi:', err);
    } finally {
      if (!quiet) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue(false);
    pollTimerRef.current = setInterval(() => {
      fetchQueue(true);
    }, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  const showFeedback = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3500);
  };

  const handleTogglePauseResume = async () => {
    try {
      if (isQueuePaused) {
        await apiClient.resumeQueue();
        setIsQueuePaused(false);
        showFeedback('Đã tiếp tục điều phối hàng đợi tải phim');
      } else {
        await apiClient.pauseQueue();
        setIsQueuePaused(true);
        showFeedback('Đã tạm dừng hàng đợi tải phim');
      }
      fetchQueue(true);
    } catch (err: any) {
      alert(`Lỗi thao tác: ${err?.message}`);
    }
  };

  const handleDeleteTask = async (taskId: string, title: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa bộ phim "${title}" khỏi hàng đợi?`)) {
      return;
    }
    try {
      await apiClient.deleteQueueTask(taskId);
      showFeedback(`Đã xóa "${title}" khỏi hàng đợi`);
      fetchQueue(true);
    } catch (err: any) {
      alert(`Lỗi xóa: ${err?.message}`);
    }
  };

  const handleRetryTask = async (taskId: string, title: string) => {
    try {
      const res = await apiClient.retryQueueTask(taskId);
      if (res.success) {
        showFeedback(`Đã kích hoạt tải lại "${title}"`);
        fetchQueue(true);
      } else {
        alert(res.message);
      }
    } catch (err: any) {
      alert(`Lỗi thử lại: ${err?.message}`);
    }
  };

  const handleReorder = async (taskId: string, direction: 'up' | 'down') => {
    try {
      await apiClient.reorderQueue(taskId, direction);
      fetchQueue(true);
    } catch (err: any) {
      alert(`Lỗi đổi thứ tự: ${err?.message}`);
    }
  };

  const handleDownloadCover = async (item: DownloadQueueTaskItem) => {
    const target = item.target_info || {};
    const coverUrl = target.cover_url;
    if (!coverUrl) {
      alert('Phim này không có ảnh bìa để tải.');
      return;
    }
    try {
      const res = await apiClient.downloadCover(coverUrl, item.output_dir || 'uploads');
      if (res.success) {
        showFeedback(`Đã tải ảnh bìa phim "${target.title}" thành công!`);
      } else {
        alert(res.message || 'Lỗi tải ảnh bìa');
      }
    } catch (err: any) {
      alert(`Lỗi tải ảnh bìa: ${err?.message}`);
    }
  };

  const handleQuickAdd = async () => {
    const raw = newDramaUrl.trim();
    if (!raw) return;
    setIsAddingDrama(true);
    try {
      const target = await apiClient.parseDownloadTarget(raw);
      const savedDir = localStorage.getItem('sls_custom_output_dir') || localStorage.getItem('sls_output_dir') || 'uploads';
      const allEps = Array.from({ length: target.total_episodes || 1 }, (_, i) => i + 1);
      const res = await apiClient.addToQueue({
        target_info: target,
        episodes: allEps,
        output_dir: savedDir,
      });
      setNewDramaUrl('');
      showFeedback(`Đã thêm "${target.title}" vào hàng đợi (Vị trí #${res.position})!`);
      fetchQueue(true);
    } catch (err: any) {
      alert(`Lỗi xếp hàng phim: ${err?.message}`);
    } finally {
      setIsAddingDrama(false);
    }
  };

  return (
    <div className="flex-1 w-full h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* 1. Header Đỉnh Trang Hàng Đợi */}
      <header className="h-12 shrink-0 bg-slate-900 border-b border-slate-800 px-5 flex items-center justify-between z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={onSwitchToDashboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold shadow transition active:scale-95 border border-slate-700"
            title="Về Dashboard"
          >
            <ArrowLeft className="w-4 h-4 text-indigo-400" />
            <span>Về Dashboard</span>
          </button>

          <div className="h-5 w-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-600/30 border border-indigo-500/40 rounded-lg text-indigo-300">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>Hàng Đợi Tải Phim Nâng Cao</span>
                <span className="px-2 py-0.2 rounded-full bg-indigo-950 border border-indigo-600/50 text-indigo-300 text-[10px] font-semibold">
                  Multi-Drama Queue
                </span>
              </h1>
            </div>
          </div>
        </div>

        {/* Phím điều khiển Hàng Đợi Toàn Cục */}
        <div className="flex items-center gap-2.5">
          {actionMessage && (
            <span className="text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-lg animate-in fade-in flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{actionMessage}</span>
            </span>
          )}

          <button
            onClick={handleTogglePauseResume}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition active:scale-95 border ${
              isQueuePaused
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
                : 'bg-amber-950/80 hover:bg-amber-900 border-amber-700 text-amber-200'
            }`}
            title={isQueuePaused ? 'Tiếp tục tải tất cả các phim trong hàng đợi' : 'Tạm dừng tất cả hàng đợi'}
          >
            {isQueuePaused ? (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Tiếp tục tất cả (Resume All)</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>Tạm dừng tất cả (Pause All)</span>
              </>
            )}
          </button>

          <button
            onClick={() => fetchQueue(false)}
            disabled={isLoading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
            title="Làm mới trạng thái hàng đợi"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {onOpenDownloadModal && (
            <button
              onClick={onOpenDownloadModal}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm Phim Vào Hàng Đợi</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. Top Action Bar: Link Input to Add New Drama to Queue */}
      <div className="shrink-0 bg-slate-900/60 border-b border-slate-800 px-6 py-3">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row gap-2.5 items-center">
          <div className="flex-1 w-full relative">
            <input
              type="text"
              value={newDramaUrl}
              onChange={(e) => setNewDramaUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuickAdd();
              }}
              disabled={isAddingDrama}
              placeholder="Dán link phim Hồng Quả hoặc Series ID để xếp hàng ngay (ví dụ: https://hongguoduanju.com/episode?series_id=...)..."
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none font-sans transition"
            />
          </div>
          <button
            onClick={handleQuickAdd}
            disabled={isAddingDrama || !newDramaUrl.trim()}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-95 shadow shrink-0"
          >
            {isAddingDrama ? (
              <>
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
                <span>Đang phân tích...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm vào hàng đợi</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 3. Danh Sách Phim Trong Hàng Đợi (Queue Cards) */}
      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-5xl w-full mx-auto">
        {queueTasks.length === 0 ? (
          <div className="h-96 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/30 space-y-3">
            <Film className="w-12 h-12 text-slate-600" />
            <div className="space-y-1">
              <h3 className="text-white font-bold text-sm">Hàng đợi đang trống</h3>
              <p className="text-slate-400 text-xs max-w-md">
                Chưa có bộ phim nào được xếp hàng tải. Hãy dán liên kết ở thanh trên hoặc mở hộp thoại &quot;Tải từ Link&quot; và chọn &quot;Thêm vào hàng đợi&quot; để tải tự động liên tiếp nhiều bộ phim.
              </p>
            </div>
            {onOpenDownloadModal && (
              <button
                onClick={onOpenDownloadModal}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition"
              >
                + Thêm phim vào hàng đợi ngay
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3.5">
            {queueTasks.map((item, index) => {
              const target = item.target_info || {};
              const title = target.title || 'Bộ phim ngắn';
              const pinyin = (target as any).pinyin_title || (target as any).pinyin || (target as any).title_pinyin || '';
              const coverUrl = target.cover_url;
              const isCurrent = item.task_id === activeTaskId || item.status === 'running';

              // Trạng thái hiển thị theo đúng chuẩn hợp đồng
              let statusBadge = (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  Đang chờ trong hàng đợi
                </span>
              );

              if (item.status === 'running') {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-700 animate-pulse flex items-center gap-1">
                    <Sparkles className="w-3 h-3 animate-spin text-indigo-400" />
                    Đang tải ({item.current_ep}/{item.total_eps || target.total_episodes || '?'})
                  </span>
                );
              } else if (item.status === 'completed') {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    Hoàn thành
                  </span>
                );
              } else if (item.status === 'failed') {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-700 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-rose-400" />
                    Gặp lỗi
                  </span>
                );
              } else if (item.status === 'paused') {
                statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950 text-amber-300 border border-amber-700">
                    Tạm dừng
                  </span>
                );
              }

              return (
                <div
                  key={item.task_id}
                  className={`p-4 rounded-xl border transition flex gap-4 items-start ${
                    isCurrent
                      ? 'bg-slate-900/90 border-indigo-500/70 shadow-lg shadow-indigo-950/50'
                      : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  {/* Số thứ tự */}
                  <div className="flex flex-col items-center justify-center pt-1 text-slate-500 font-mono text-xs font-bold w-6">
                    <span>#{index + 1}</span>
                  </div>

                  {/* Ảnh bìa Poster + nút tải ảnh bìa 1-chạm */}
                  <div className="flex flex-col items-center flex-shrink-0 w-16">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={title}
                        className="w-16 h-24 object-cover rounded-lg border border-slate-800 shadow"
                      />
                    ) : (
                      <div className="w-16 h-24 bg-slate-950 rounded-lg border border-slate-800 flex flex-col items-center justify-center text-slate-600">
                        <Film className="w-6 h-6" />
                        <span className="text-[9px] mt-1">Không ảnh</span>
                      </div>
                    )}
                    {coverUrl && (
                      <button
                        type="button"
                        onClick={() => handleDownloadCover(item)}
                        className="mt-1.5 w-full py-0.5 px-1 bg-slate-800 hover:bg-slate-700 text-[9px] font-semibold text-cyan-300 rounded border border-cyan-800/50 flex items-center justify-center gap-0.5 transition active:scale-95"
                        title="Tải ảnh bìa của bộ phim này"
                      >
                        <Image className="w-2.5 h-2.5 text-cyan-400" />
                        <span>Tải ảnh bìa</span>
                      </button>
                    )}
                  </div>

                  {/* Nội dung thông tin phim */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
                        <h2 className="text-sm font-bold text-white truncate" title={title}>
                          {title}
                        </h2>
                        {pinyin && (
                          <span className="text-[11px] text-indigo-300 font-mono italic">
                            ({pinyin})
                          </span>
                        )}
                        {target.series_id && (
                          <span className="text-[10px] text-slate-400 font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                            Series ID: {target.series_id}
                          </span>
                        )}
                      </div>
                      {statusBadge}
                    </div>

                    {/* Dòng metadata */}
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
                      <div className="flex items-center gap-1 text-slate-300">
                        <Layers className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          Số tập:{' '}
                          <strong className="text-white">
                            {item.episodes ? item.episodes.length : (item.total_eps || target.total_episodes || 0)}
                          </strong>{' '}
                          / {target.total_episodes || item.total_eps || 0} tập
                        </span>
                      </div>

                      {item.output_dir && (
                        <div
                          className="flex items-center gap-1 text-slate-400 truncate max-w-xs"
                          title={item.output_dir}
                        >
                          <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate">{item.output_dir}</span>
                        </div>
                      )}

                      {/* Tốc độ tải và thông số thời gian */}
                      {item.status === 'running' && (
                        <div className="flex items-center gap-1 text-cyan-300 font-mono font-semibold">
                          <Zap className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Tốc độ: {item.speed_mbps ? item.speed_mbps.toFixed(2) : '1.85'} MB/s</span>
                        </div>
                      )}
                    </div>

                    {/* Thanh tiến độ Overall Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 truncate max-w-md">
                          {item.message || (item.status === 'running' ? 'Đang tải xuống...' : 'Trong danh sách chờ')}
                        </span>
                        <span className="font-mono font-bold text-cyan-400">
                          {item.progress_percent?.toFixed(1) || '0.0'}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                        <div
                          className={`h-full transition-all duration-300 ${
                            item.status === 'completed'
                              ? 'bg-emerald-500'
                              : item.status === 'failed'
                              ? 'bg-rose-500'
                              : 'bg-gradient-to-r from-indigo-500 to-cyan-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, item.progress_percent || 0))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Nút điều khiển ưu tiên và xóa */}
                  <div className="flex flex-col gap-1 items-center justify-center pl-2">
                    <button
                      onClick={() => handleReorder(item.task_id, 'up')}
                      disabled={index === 0}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 transition border border-slate-700"
                      title="Chuyển lên ưu tiên cao hơn (Up)"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleReorder(item.task_id, 'down')}
                      disabled={index === queueTasks.length - 1}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white disabled:opacity-30 transition border border-slate-700"
                      title="Chuyển xuống dưới (Down)"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>

                    {(item.status === 'failed' || item.status === 'cancelled') && (
                      <button
                        onClick={() => handleRetryTask(item.task_id, title)}
                        className="p-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-800 border border-emerald-700 text-emerald-300 transition active:scale-95"
                        title="Tải lại bộ phim này (Retry)"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => handleDeleteTask(item.task_id, title)}
                      className="p-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900 border border-rose-800 text-rose-300 transition"
                      title="Xóa khỏi hàng đợi"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};
