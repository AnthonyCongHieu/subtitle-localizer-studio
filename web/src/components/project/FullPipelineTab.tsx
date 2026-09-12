import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Zap,
  Play,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Film,
  Subtitles,
  Volume2,
  ArrowRight,
  X,
  Copy,
  ExternalLink,
  Loader2,
  Layers,
  Sliders,
  History,
} from 'lucide-react';
import {
  apiClient,
  FullPipelineWorkflow,
  FullPipelinePreviewResponse,
  FullPipelineCreatePayload,
} from '../../api/client';
import { ProjectManifestV1 } from '../../types/api';
import { appLogger } from '../common/GlobalActivityLogger';

export interface FullPipelineTabProps {
  onOpenProject?: (project: ProjectManifestV1) => void;
  onRefreshProjects?: () => void;
}

export const FullPipelineTab: React.FC<FullPipelineTabProps> = ({
  onOpenProject,
  onRefreshProjects,
}) => {
  // 1. Input & Preview State
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewData, setPreviewData] = useState<FullPipelinePreviewResponse | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // 2. Settings Modal / Panel State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetResolution, setTargetResolution] = useState('best');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('vi');
  const [dubbingEnabled, setDubbingEnabled] = useState(true);
  const [voice, setVoice] = useState('vi-VN-HoaiMyNeural');
  const [speedFit, setSpeedFit] = useState(true);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [maskSubtitles, setMaskSubtitles] = useState(true);
  const [maskMode, setMaskMode] = useState('blur');
  const [exportSrtAss, setExportSrtAss] = useState(true);
  const [outputDir, setOutputDir] = useState('');

  // 3. Active Workflow & Polling State
  const [activeWorkflow, setActiveWorkflow] = useState<FullPipelineWorkflow | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const pollIntervalRef = useRef<any>(null);
  const autoOpenedRef = useRef<string | null>(null);

  // 4. History Workflows State
  const [historyWorkflows, setHistoryWorkflows] = useState<FullPipelineWorkflow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Load history on mount
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await apiClient.listFullPipelineWorkflows(20);
      setHistoryWorkflows(res.workflows || []);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Analyze URL
  const handleAnalyze = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setAnalyzeError('Vui lòng nhập hoặc dán đường link video hợp lệ.');
      return;
    }
    setAnalyzeError(null);
    setIsAnalyzing(true);
    try {
      const res = await apiClient.previewFullPipeline({
        url: trimmed,
        source_language: sourceLang,
        target_language: targetLang,
      });
      setPreviewData(res);
      setIsModalOpen(true);
      appLogger.success(`Đã phân tích thành công: ${res.title}`, 'Full Pipeline');
    } catch (err: any) {
      const msg = err?.message || 'Không thể phân tích video từ đường link này.';
      setAnalyzeError(msg);
      appLogger.warn(msg, 'Full Pipeline');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Quick paste from clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
      }
    } catch {
      // ignore
    }
  };

  // Start Workflow
  const handleStartWorkflow = async () => {
    if (!previewData && !url.trim()) return;
    setIsStarting(true);
    try {
      const payload: FullPipelineCreatePayload = {
        url: previewData?.url || url.trim(),
        source_language: sourceLang,
        target_language: targetLang,
        target_resolution: targetResolution,
        dubbing_enabled: dubbingEnabled,
        voice,
        speed_fit: speedFit,
        burn_subtitles: burnSubtitles,
        mask_subtitles: maskSubtitles,
        mask_mode: maskMode,
        export_srt_ass: exportSrtAss,
        output_dir: outputDir.trim() || undefined,
      };

      const wf = await apiClient.createFullPipelineWorkflow(payload);
      setActiveWorkflow(wf);
      setIsModalOpen(false);
      autoOpenedRef.current = null;
      fetchHistory();
      appLogger.success('Đã khởi chạy quy trình tự động hóa AI!', 'Full Pipeline');
    } catch (err: any) {
      appLogger.error(`Khởi chạy thất bại: ${err?.message || 'Lỗi không xác định'}`, 'Full Pipeline');
    } finally {
      setIsStarting(false);
    }
  };

  // Cancel Workflow
  const handleCancelWorkflow = async () => {
    if (!activeWorkflow) return;
    setIsCancelling(true);
    try {
      await apiClient.cancelFullPipelineWorkflow(activeWorkflow.workflow_id);
      const updated = await apiClient.getFullPipelineWorkflow(activeWorkflow.workflow_id);
      setActiveWorkflow(updated);
      fetchHistory();
      appLogger.info('Đã gửi yêu cầu dừng quy trình.', 'Full Pipeline');
    } catch (err: any) {
      appLogger.error(`Hủy thất bại: ${err.message}`, 'Full Pipeline');
    } finally {
      setIsCancelling(false);
    }
  };

  // Retry Workflow
  const handleRetryWorkflow = async (stage?: string) => {
    if (!activeWorkflow) return;
    setIsRetrying(true);
    try {
      await apiClient.retryFullPipelineWorkflow(activeWorkflow.workflow_id, stage);
      const updated = await apiClient.getFullPipelineWorkflow(activeWorkflow.workflow_id);
      setActiveWorkflow(updated);
      fetchHistory();
      appLogger.success('Đang thực thi lại stage...', 'Full Pipeline');
    } catch (err: any) {
      appLogger.error(`Thử lại thất bại: ${err.message}`, 'Full Pipeline');
    } finally {
      setIsRetrying(false);
    }
  };

  // Auto-open editor when workflow completes
  const handleOpenEditor = useCallback(
    async (projectId: string) => {
      if (!onOpenProject) return;
      try {
        onRefreshProjects?.();
        const proj = await apiClient.getProject(projectId);
        if (proj) {
          appLogger.success(`Tự động mở dự án '${proj.title}' trong Studio Editor!`, 'Full Pipeline');
          onOpenProject(proj);
        }
      } catch (err: any) {
        loggerWarn('Không thể nạp dự án vào editor:', err);
      }
    },
    [onOpenProject, onRefreshProjects]
  );

  // Helper for logging
  const loggerWarn = (msg: string, err: any) => {
    console.warn(msg, err);
  };

  // Real-time polling for active workflow
  useEffect(() => {
    if (!activeWorkflow) return;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(activeWorkflow.state);
    if (isTerminal && activeWorkflow.state === 'completed' && activeWorkflow.project_id) {
      if (autoOpenedRef.current !== activeWorkflow.workflow_id) {
        autoOpenedRef.current = activeWorkflow.workflow_id;
        handleOpenEditor(activeWorkflow.project_id);
      }
      return;
    }
    if (isTerminal) return;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const updated = await apiClient.getFullPipelineWorkflow(activeWorkflow.workflow_id);
        setActiveWorkflow(updated);
        if (updated.state === 'completed' && updated.project_id) {
          clearInterval(pollIntervalRef.current);
          fetchHistory();
          if (autoOpenedRef.current !== updated.workflow_id) {
            autoOpenedRef.current = updated.workflow_id;
            handleOpenEditor(updated.project_id);
          }
        } else if (['failed', 'cancelled', 'needs_review'].includes(updated.state)) {
          clearInterval(pollIntervalRef.current);
          fetchHistory();
        }
      } catch {
        // ignore network glitches
      }
    }, 1200);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [activeWorkflow, handleOpenEditor, fetchHistory]);

  const STAGE_LABELS: Record<string, { label: string; icon: any }> = {
    downloading: { label: 'Tải video', icon: Film },
    detecting_roi: { label: 'Dò vùng chữ ROI', icon: Sliders },
    ocr: { label: 'Quét chữ OCR', icon: Subtitles },
    translating: { label: 'Dịch sang tiếng Việt', icon: Sparkles },
    dubbing: { label: 'Lồng tiếng AI TTS', icon: Volume2 },
    exporting: { label: 'Che sub & Xuất MP4', icon: Layers },
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto">
      {/* Top Banner Header */}
      <div className="border-b border-slate-800/80 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 px-6 py-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 max-w-6xl mx-auto">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-xl shadow-lg shadow-indigo-500/20">
                <Zap className="w-5 h-5 text-white animate-pulse" />
              </span>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
                Quy Trình Tự Động Hóa Toàn Trình (Full Pipeline)
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                All-in-One AI
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Dán link → Tải → Tự dò ROI → OCR → Dịch → Lồng tiếng AI → Che Sub → Xuất MP4 → Mở Editor Studio
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition shadow-sm w-fit"
          >
            <History className="w-4 h-4 text-indigo-400" />
            <span>Lịch sử quy trình ({historyWorkflows.length})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-6xl w-full mx-auto p-6 space-y-6 flex-1">
        {/* 1. INPUT BOX */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl shadow-black/40">
          <label htmlFor="pipeline-url-input" className="block text-xs font-semibold text-slate-300 mb-2">
            Đường link video (YouTube, Douyin, Bilibili, TikTok, Xiaohongshu, Hồng Quả hoặc file trực tiếp):
          </label>
          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            <div className="relative flex-1">
              <input
                id="pipeline-url-input"
                type="text"
                placeholder="Dán đường dẫn video tại đây (ví dụ: https://www.youtube.com/watch?v=...)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={handlePasteClipboard}
                title="Dán từ Clipboard"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <button
              id="pipeline-analyze-button"
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing || !url.trim()}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang phân tích...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Phân tích & Tiếp tục</span>
                </>
              )}
            </button>
          </div>

          {analyzeError && (
            <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{analyzeError}</span>
            </div>
          )}
        </div>

        {/* 2. ACTIVE WORKFLOW TRACKER */}
        {activeWorkflow && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            {/* Header / State */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {activeWorkflow.workflow_id}
                  </span>
                  <h2 className="text-base font-bold text-white truncate max-w-md">
                    {activeWorkflow.title || 'Video Đang Xử Lý'}
                  </h2>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Bắt đầu: {new Date(activeWorkflow.created_at * 1000).toLocaleTimeString()}</span>
                  </span>
                  {activeWorkflow.retry_count > 0 && (
                    <span className="text-amber-400 font-medium">Thử lại: {activeWorkflow.retry_count} lần</span>
                  )}
                </div>
              </div>

              {/* Status Badge & Actions */}
              <div className="flex items-center gap-2.5">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                    activeWorkflow.state === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : activeWorkflow.state === 'failed'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : activeWorkflow.state === 'needs_review'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : activeWorkflow.state === 'cancelled'
                      ? 'bg-slate-700/50 text-slate-300 border border-slate-600'
                      : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  }`}
                >
                  {activeWorkflow.state === 'completed' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : activeWorkflow.state === 'failed' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  ) : activeWorkflow.state === 'needs_review' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  ) : activeWorkflow.state === 'cancelled' ? (
                    <X className="w-3.5 h-3.5" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  )}
                  <span className="capitalize">{activeWorkflow.state.replace('_', ' ')}</span>
                </span>

                {activeWorkflow.state === 'completed' && activeWorkflow.project_id && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditor(activeWorkflow.project_id!)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-emerald-600/30 flex items-center gap-1.5 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở Studio Editor</span>
                  </button>
                )}

                {activeWorkflow.state === 'needs_review' && activeWorkflow.project_id && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditor(activeWorkflow.project_id!)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-amber-600/30 flex items-center gap-1.5 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở Studio Editor (Cần xem xét)</span>
                  </button>
                )}

                {['failed', 'needs_review'].includes(activeWorkflow.state) && (
                  <button
                    type="button"
                    onClick={() => handleRetryWorkflow()}
                    disabled={isRetrying}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 text-xs font-semibold rounded-xl shadow-lg flex items-center gap-1.5 transition"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                    <span>Thử lại</span>
                  </button>
                )}

                {!['completed', 'failed', 'cancelled'].includes(activeWorkflow.state) && (
                  <button
                    type="button"
                    onClick={handleCancelWorkflow}
                    disabled={isCancelling}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl border border-slate-700 transition"
                  >
                    {isCancelling ? 'Đang dừng...' : 'Hủy quy trình'}
                  </button>
                )}
              </div>
            </div>

            {/* Overall Monotonic Progress Bar */}
            <div className="mt-5">
              <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5">
                <span className="font-medium">Tiến độ tổng thể:</span>
                <span className="font-bold text-white">{Math.round(activeWorkflow.progress * 100)}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-500 transition-all duration-500 rounded-full"
                  style={{ width: `${Math.max(3, Math.round(activeWorkflow.progress * 100))}%` }}
                />
              </div>
            </div>

            {/* 6 Stages Step Tracker Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
              {activeWorkflow.stages.map((st, idx) => {
                const isCurrent = st.status === 'running' || (activeWorkflow.current_stage === st.stage_name && !['completed', 'failed', 'cancelled'].includes(activeWorkflow.state));
                const isCompleted = st.status === 'completed';
                const isFailed = st.status === 'failed';
                const isSkipped = st.status === 'skipped';
                const meta = STAGE_LABELS[st.stage_name] || { label: st.display_name || st.stage_name, icon: Layers };
                const IconComponent = meta.icon;

                return (
                  <div
                    key={st.stage_name}
                    className={`p-3 rounded-xl border flex flex-col justify-between transition ${
                      isCompleted
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : isFailed
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                        : isCurrent
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200 shadow-md shadow-indigo-500/10'
                        : isSkipped
                        ? 'bg-slate-800/30 border-slate-800 text-slate-500'
                        : 'bg-slate-950/60 border-slate-800/60 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800/60">
                        0{idx + 1}
                      </span>
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : isFailed ? (
                        <AlertCircle className="w-4 h-4 text-rose-400" />
                      ) : isCurrent ? (
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-slate-700" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 my-1">
                      <IconComponent className="w-4 h-4 flex-shrink-0" />
                      <span className="text-xs font-semibold truncate">{meta.label}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 capitalize mt-1">
                      {st.status === 'completed'
                        ? 'Hoàn tất'
                        : st.status === 'running'
                        ? 'Đang chạy...'
                        : st.status === 'failed'
                        ? 'Lỗi'
                        : st.status === 'skipped'
                        ? 'Bỏ qua'
                        : 'Chờ'}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Warnings Alert Banner */}
            {activeWorkflow.warnings && activeWorkflow.warnings.length > 0 && (
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Cảnh báo chất lượng / Cần lưu ý ({activeWorkflow.warnings.length}):</span>
                </div>
                {activeWorkflow.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-200/90 pl-6">
                    • {w}
                  </p>
                ))}
              </div>
            )}

            {/* Fallback Badges */}
            {activeWorkflow.fallback_events && activeWorkflow.fallback_events.length > 0 && (
              <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Đã ghi nhận sự kiện chuyển đổi dự phòng (Fallback):</span>
                </div>
                {activeWorkflow.fallback_events.map((ev, i) => (
                  <p key={i} className="text-xs text-amber-200/90 pl-6">
                    • <strong>Stage {ev.stage}:</strong> {ev.from_provider} → {ev.to_provider} ({ev.error})
                  </p>
                ))}
              </div>
            )}

            {/* Error Message if Failed */}
            {activeWorkflow.errors && activeWorkflow.errors.length > 0 && (
              <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                <strong>Lỗi phát sinh:</strong> {activeWorkflow.errors.join('; ')}
              </div>
            )}
          </div>
        )}

        {/* 3. WORKFLOW HISTORY DRAWER / TABLE */}
        {showHistory && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" />
                <span>Lịch sử các phiên chạy gần đây</span>
              </h3>
              <button
                type="button"
                onClick={fetchHistory}
                disabled={loadingHistory}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <RotateCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                <span>Làm mới</span>
              </button>
            </div>

            {historyWorkflows.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">Chưa có quy trình tự động nào được ghi nhận.</p>
            ) : (
              <div className="divide-y divide-slate-800/60 max-h-72 overflow-y-auto">
                {historyWorkflows.map((wf) => (
                  <div key={wf.workflow_id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="truncate max-w-sm">
                      <p className="font-semibold text-white truncate">{wf.title || wf.source_url}</p>
                      <p className="text-[11px] text-slate-500">
                        {new Date(wf.created_at * 1000).toLocaleString()} • {wf.workflow_id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                          wf.state === 'completed'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : wf.state === 'failed'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-indigo-500/20 text-indigo-300'
                        }`}
                      >
                        {wf.state}
                      </span>
                      {wf.project_id && onOpenProject && (
                        <button
                          type="button"
                          onClick={() => handleOpenEditor(wf.project_id!)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded font-medium flex items-center gap-1"
                        >
                          <span>Mở Editor</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. CONFIRMATION & SETTINGS MODAL */}
      {isModalOpen && previewData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-indigo-600/30 rounded-lg text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-white text-base">Xác Nhận Cấu Hình Tinh Gọn</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-300 flex-1">
              {/* Preview Card */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex gap-4 items-center">
                {previewData.cover_url || previewData.thumbnail ? (
                  <img
                    src={previewData.cover_url || previewData.thumbnail}
                    alt={previewData.title}
                    className="w-28 h-16 object-cover rounded-lg bg-slate-900 border border-slate-800 flex-shrink-0"
                  />
                ) : (
                  <div className="w-28 h-16 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
                    <Film className="w-6 h-6 text-slate-600" />
                  </div>
                )}
                <div className="truncate flex-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600/30 text-indigo-300 uppercase">
                    {previewData.platform || 'Video'}
                  </span>
                  <h4 className="text-sm font-bold text-white mt-1 truncate">{previewData.title}</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Thời lượng: {formatDuration(previewData.duration)} • Độ phân giải sẵn có: {previewData.resolutions?.length || 1}
                  </p>
                </div>
              </div>

              {/* Settings Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. Nguồn & Tải */}
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                  <h5 className="font-bold text-indigo-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" />
                    <span>Nguồn & Tải Video</span>
                  </h5>
                  <div>
                    <label className="block text-slate-400 mb-1">Chất lượng tải về:</label>
                    <select
                      value={targetResolution}
                      onChange={(e) => setTargetResolution(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="best">Cao nhất (Tự động)</option>
                      <option value="1080p">1080p Full HD</option>
                      <option value="720p">720p HD</option>
                      <option value="480p">480p SD</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Ngôn ngữ gốc:</label>
                    <select
                      value={sourceLang}
                      onChange={(e) => setSourceLang(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="auto">Tự động nhận diện</option>
                      <option value="zh">Tiếng Trung (Phim ngắn / Drama)</option>
                      <option value="en">Tiếng Anh</option>
                      <option value="ko">Tiếng Hàn</option>
                      <option value="ja">Tiếng Nhật</option>
                    </select>
                  </div>
                </div>

                {/* 2. Dịch thuật & OCR */}
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                  <h5 className="font-bold text-indigo-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                    <Subtitles className="w-3.5 h-3.5" />
                    <span>Xử Lý Phụ Đề (OCR & Dịch)</span>
                  </h5>
                  <div>
                    <label className="block text-slate-400 mb-1">Ngôn ngữ đích:</label>
                    <select
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="vi">Tiếng Việt (vi)</option>
                      <option value="en">Tiếng Anh (en)</option>
                      <option value="zh">Tiếng Trung (zh)</option>
                      <option value="ja">Tiếng Nhật (ja)</option>
                      <option value="ko">Tiếng Hàn (ko)</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span>OCR tự động (PP-OCRv5/Rapid):</span>
                    <span className="text-emerald-400 font-semibold">Tối ưu</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Dịch thuật AI:</span>
                    <span className="text-emerald-400 font-semibold">Tự động Fallback</span>
                  </div>
                </div>

                {/* 3. Lồng tiếng AI (TTS) */}
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="font-bold text-indigo-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Lồng Tiếng AI (TTS)</span>
                    </h5>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dubbingEnabled}
                        onChange={(e) => setDubbingEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  {dubbingEnabled ? (
                    <>
                      <div>
                        <label className="block text-slate-400 mb-1">Giọng đọc tiếng Việt:</label>
                        <select
                          value={voice}
                          onChange={(e) => setVoice(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"
                        >
                          <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ miền Nam, truyền cảm)</option>
                          <option value="vi-VN-NamMinhNeural">Nam Minh (Nam miền Bắc, ấm áp)</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={speedFit}
                          onChange={(e) => setSpeedFit(e.target.checked)}
                          className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                        />
                        <span>Tự động khớp tốc độ theo từng câu thoại</span>
                      </label>
                    </>
                  ) : (
                    <p className="text-slate-500 italic">Lồng tiếng đã tắt cho lượt chạy này.</p>
                  )}
                </div>

                {/* 4. Xuất bản video */}
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                  <h5 className="font-bold text-indigo-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Xuất Bản & Hoàn Tất</span>
                  </h5>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={maskSubtitles}
                      onChange={(e) => setMaskSubtitles(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Tự động che phụ đề gốc (Làm mờ mịn)</span>
                  </label>
                  {maskSubtitles && (
                    <div className="pl-6 pt-0.5">
                      <label className="block text-[10px] text-slate-400 mb-1">Kiểu che:</label>
                      <select
                        value={maskMode}
                        onChange={(e) => setMaskMode(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-1.5 text-xs text-white"
                      >
                        <option value="blur">Làm mờ mịn (Gaussian Blur)</option>
                        <option value="box">Hộp màu mờ (Solid / Box)</option>
                        <option value="delogo">Xóa logo (Delogo Filter)</option>
                      </select>
                    </div>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={burnSubtitles}
                      onChange={(e) => setBurnSubtitles(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Khắc (Burn-in) phụ đề tiếng Việt vào MP4</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exportSrtAss}
                      onChange={(e) => setExportSrtAss(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    <span>Xuất kèm file phụ đề rời (.SRT / .ASS)</span>
                  </label>
                </div>
              </div>

              {/* Output directory override if needed */}
              <div>
                <label className="block text-slate-400 mb-1">Thư mục xuất kết quả (để trống để lưu mặc định):</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Mặc định: outputs/{project_id}/"
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end gap-3 bg-slate-950/60">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition"
              >
                Hủy bỏ
              </button>
              <button
                id="pipeline-modal-confirm-button"
                type="button"
                onClick={handleStartWorkflow}
                disabled={isStarting}
                className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang khởi động...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Bắt Đầu Quy Trình Ngay</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
