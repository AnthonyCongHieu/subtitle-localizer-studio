import React, { useEffect, useState, useRef } from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import { CueTable } from './CueTable';
import { ExportModal } from './ExportModal';
import { ProxyPlayer } from './ProxyPlayer';
import { RoiSelector } from './RoiSelector';
import { useUndoRedo } from './useUndoRedo';
import { WaveformTimeline } from './WaveformTimeline';
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Sparkles,
  Save,
  Download,
  CheckCircle2,
  Zap,
  Tv,
  Columns2,
  FileEdit,
} from 'lucide-react';

interface EditorViewProps {
  project: ProjectManifestV1;
  onBack: () => void;
}

export const EditorView: React.FC<EditorViewProps> = ({ project, onBack }) => {
  const {
    state: cues,
    set: setCues,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<SubtitleCueV1[]>([]);

  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = React.useRef(currentTime);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const pollTimerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [showRoiPanel, setShowRoiPanel] = useState(false);
  const [activeRegion, setActiveRegion] = useState<RegionTrackV1 | undefined>(
    project.regions && project.regions.length > 0 ? project.regions[0] : undefined,
  );
  const [previewMode, setPreviewMode] = useState<'mask_replace' | 'original' | 'rendered'>('mask_replace');
  const [layoutMode, setLayoutMode] = useState<'cinema' | 'split' | 'focus'>('cinema');

  const [isDirty, setIsDirty] = useState(false);
  const initialLoadDone = React.useRef(false);
  const cuesRef = React.useRef(cues);

  useEffect(() => {
    cuesRef.current = cues;
    if (initialLoadDone.current) {
      setIsDirty(true);
    }
  }, [cues]);

  const duration = cues.length > 0 ? Math.max(...cues.map((c) => c.end_pts)) + 2.0 : 30.0;

  const loadCues = async () => {
    try {
      const data = await apiClient.getCues(project.project_id);
      setCues(data);
      if (!initialLoadDone.current) initialLoadDone.current = true;
      if (data.length > 0) {
        setSelectedCueId(data[0].cue_id);
      }
    } catch (err) {
      console.error('Lỗi khi nạp cues:', err);
    }
  };

  useEffect(() => {
    loadCues();
  }, [project.project_id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (isInput) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          handleSave();
        }
        return;
      }

      if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCurrentTime((t) => Math.max(0, t - 2.0));
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setCurrentTime((t) => Math.min(duration, t + 2.0));
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        if (selectedCueId) {
          setCues(cues.map(c => c.cue_id === selectedCueId ? { ...c, start_pts: parseFloat(currentTimeRef.current.toFixed(2)) } : c));
        }
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (selectedCueId) {
          setCues(cues.map(c => c.cue_id === selectedCueId ? { ...c, end_pts: parseFloat(currentTimeRef.current.toFixed(2)) } : c));
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedCueId(undefined);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentTime((t) => Math.max(0, t - 1.0));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentTime((t) => Math.min(duration, t + 1.0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (cues.length > 0) {
          const idx = cues.findIndex((c) => c.cue_id === selectedCueId);
          if (idx > 0) {
            setSelectedCueId(cues[idx - 1].cue_id);
            setCurrentTime(cues[idx - 1].start_pts);
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (cues.length > 0) {
          const idx = cues.findIndex((c) => c.cue_id === selectedCueId);
          if (idx >= 0 && idx < cues.length - 1) {
            setSelectedCueId(cues[idx + 1].cue_id);
            setCurrentTime(cues[idx + 1].start_pts);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cues, selectedCueId, duration, canUndo, canRedo, isPlaying]);

  const handleSave = async () => {
    try {
      setStatusMessage('Đang lưu phụ đề...');
      await apiClient.saveCues(project.project_id, cuesRef.current);
      setStatusMessage('✓ Đã lưu thay đổi!');
      setIsDirty(false);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage(`Lỗi lưu: ${err.message}`);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (isDirty) {
        handleSave();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [isDirty, project.project_id]);

  const handleRunPipeline = async (maxDurationSeconds?: number) => {
    try {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setIsProcessing(true);
      setProgressPercent(5);
      const isQuick = maxDurationSeconds !== undefined && maxDurationSeconds > 0;
      setStatusMessage(isQuick ? '⚡ Đang lưu ROI & quét 3 phút đầu...' : '⚡ Đang lưu ROI & khởi chạy quét ngầm...');

      if (activeRegion) {
        try {
          const savedRegions = await apiClient.saveRegions(project.project_id, [activeRegion]);
          if (savedRegions && savedRegions.length > 0) {
            setActiveRegion(savedRegions[0]);
          }
        } catch (regionErr) {
          console.warn('Auto-save region warning:', regionErr);
        }
      }

      await apiClient.runPipeline(project.project_id, {
        max_duration_seconds: maxDurationSeconds,
      });

      // Poll pipeline stages every 1.0s
      pollTimerRef.current = setInterval(async () => {
        try {
          const stages = await apiClient.getStages(project.project_id);
          if (stages && stages.length > 0) {
            const latest = stages[stages.length - 1];
            const pct = Math.round((latest.progress || 0) * 100);
            setProgressPercent(pct);

            if (latest.metrics?.label) {
              setStatusMessage(latest.metrics.label);
            } else if (latest.stage_name === 'ocr_inference') {
              setStatusMessage(`Đang quét OCR: ${pct}%...`);
            } else if (latest.stage_name === 'cue_reconstruction') {
              setStatusMessage('Đang dựng và ghép câu phụ đề...');
            } else if (latest.stage_name === 'translation') {
              setStatusMessage('Đang dịch thuật AI sang tiếng Việt...');
            }

            // Chỉ dừng khi toàn bộ pipeline đã hoàn tất (stage_name === 'pipeline')
            if (latest.status === 'completed' && (latest.stage_name === 'pipeline' || latest.progress >= 1.0)) {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              setIsProcessing(false);
              const data = await apiClient.getCues(project.project_id);
              setCues(data);
              if (!initialLoadDone.current) initialLoadDone.current = true;
              if (data.length > 0) {
                setSelectedCueId(data[0].cue_id);
                setCurrentTime(data[0].start_pts);
                setStatusMessage(`✓ Hoàn tất! Đã trích xuất ${data.length} câu phụ đề.`);
              } else {
                setStatusMessage('✓ Quét hoàn tất nhưng không phát hiện chữ trong vùng ROI đã chọn.');
              }
              setTimeout(() => setStatusMessage(null), 6000);
            } else if (latest.status === 'failed') {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              setIsProcessing(false);
              const err = latest.errors?.[0] || 'Lỗi xử lý pipeline';
              setStatusMessage(`Lỗi: ${err}`);
              setTimeout(() => setStatusMessage(null), 8000);
            }
          }
        } catch (pollErr) {
          console.error('Polling error:', pollErr);
        }
      }, 1000);
    } catch (err: any) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setIsProcessing(false);
      setStatusMessage(`Lỗi khởi chạy: ${err.message}`);
      setTimeout(() => setStatusMessage(null), 6000);
    }
  };

  const handleUpdateCue = (updated: SubtitleCueV1) => {
    setCues(cues.map((c) => (c.cue_id === updated.cue_id ? updated : c)));
  };

  const handleToggleLock = (cueId: string) => {
    setCues(
      cues.map((c) =>
        c.cue_id === cueId
          ? { ...c, status: c.status === 'locked' ? 'reviewed' : 'locked' }
          : c,
      ),
    );
  };

  const handleRetranslate = async (cueId: string) => {
    try {
      setStatusMessage('Đang dịch lại với AI ngữ cảnh...');
      const updated = await apiClient.retranslateCue(project.project_id, cueId);
      setCues(cues.map((c) => (c.cue_id === cueId ? updated : c)));
      setStatusMessage('✓ Đã dịch lại câu phụ đề thành công!');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage(`Lỗi dịch lại: ${err.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleAutoDetectRoi = async () => {
    try {
      setStatusMessage('🎯 Đang quét khung hình để tự động bắt dính viền phụ đề...');
      const res = await apiClient.autoDetectRoi(project.project_id, currentTimeRef.current);
      setActiveRegion(res.region);
      setStatusMessage(`✓ Đã tự động co viền phụ đề vừa khít chữ (Y=${(res.region.y * 100).toFixed(1)}%, Cao=${(res.region.height * 100).toFixed(1)}%)!`);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage(`Lỗi bắt dính: ${err.message}`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleSplitCue = (cueId: string) => {
    const idx = cues.findIndex((c) => c.cue_id === cueId);
    if (idx === -1) return;
    const target = cues[idx];
    const midPts = (target.start_pts + target.end_pts) / 2;

    const cue1: SubtitleCueV1 = {
      ...target,
      cue_id: `${target.cue_id}_1`,
      end_pts: parseFloat(midPts.toFixed(3)),
    };
    const cue2: SubtitleCueV1 = {
      ...target,
      cue_id: `${target.cue_id}_2`,
      start_pts: parseFloat(midPts.toFixed(3)),
    };

    const newCues = [...cues.slice(0, idx), cue1, cue2, ...cues.slice(idx + 1)];
    setCues(newCues);
  };

  const handleMergeWithNext = (cueId: string) => {
    const idx = cues.findIndex((c) => c.cue_id === cueId);
    if (idx === -1 || idx >= cues.length - 1) return;
    const cur = cues[idx];
    const next = cues[idx + 1];

    const merged: SubtitleCueV1 = {
      ...cur,
      end_pts: next.end_pts,
      source_text: `${cur.source_text} ${next.source_text}`.trim(),
      translated_text: `${cur.translated_text} ${next.translated_text}`.trim(),
      confidence: (cur.confidence + next.confidence) / 2,
    };

    const newCues = [...cues.slice(0, idx), merged, ...cues.slice(idx + 2)];
    setCues(newCues);
  };

  const handleDeleteCue = (cueId: string) => {
    setCues(cues.filter((c) => c.cue_id !== cueId));
  };

  // Buffer mở rộng 0.18s trước và 0.22s sau để phụ đề che kín hoàn toàn chữ gốc không bị nháy lộ
  const activeCue = cues.find((c) => currentTime >= (c.start_pts - 0.18) && currentTime <= (c.end_pts + 0.22));

  // Tự động đồng bộ câu đang active sang Inspector và Table khi tua video
  useEffect(() => {
    if (activeCue && activeCue.cue_id !== selectedCueId) {
      setSelectedCueId(activeCue.cue_id);
    }
  }, [activeCue?.cue_id]);

  const videoUrl = apiClient.getVideoStreamUrl(project.project_id);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      {/* Studio Header Toolbar */}
      <div className="h-13 bg-zinc-900 border-b border-zinc-800 px-6 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay Lại</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100 text-sm">{project.title}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-950/60 border border-indigo-800 text-indigo-300">
              {project.source_language} &rarr; {project.target_language}
            </span>
          </div>
          {statusMessage && (
            <span className="text-indigo-400 font-medium animate-pulse flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{statusMessage}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {/* Workspace Layout Mode Switcher */}
          <div className="flex items-center bg-zinc-950 rounded-lg p-0.5 border border-zinc-800 gap-0.5">
            <button
              type="button"
              onClick={() => setLayoutMode('cinema')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
                layoutMode === 'cinema'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Chế độ Cinema (Player 68% - Bảng 32%): Tối ưu xem và đánh giá video"
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Cinema</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('split')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
                layoutMode === 'split'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Chế độ Cân bằng (50:50)"
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Cân Bằng</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('focus')}
              className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
                layoutMode === 'focus'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Chế độ Focus Biên Tập: Bảng phụ đề chiếm 68%"
            >
              <FileEdit className="w-3.5 h-3.5" />
              <span>Biên Tập</span>
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg font-mono text-[11px] transition-colors flex items-center gap-1"
            title="Hoàn tác (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg font-mono text-[11px] transition-colors flex items-center gap-1"
            title="Làm lại (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
            <span>Redo</span>
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* Dual Action Scan Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleRunPipeline(180)}
              disabled={isProcessing}
              className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-lg font-semibold shadow-md shadow-amber-600/25 transition-all disabled:opacity-50 flex items-center gap-1.5 text-xs"
              title="Quét 3 phút đầu để kiểm tra nhanh (15s)"
            >
              <Zap className="w-3.5 h-3.5 fill-current text-amber-200" />
              <span>{isProcessing ? `Đang Quét (${progressPercent}%)` : '⚡ Quét 3 Phút Đầu (15s)'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleRunPipeline()}
              disabled={isProcessing}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium shadow-md shadow-indigo-600/25 transition-all disabled:opacity-50 flex items-center gap-1.5 text-xs"
              title="Quét toàn bộ video ở chế độ chạy ngầm"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              <span className="hidden sm:inline">Toàn Bộ Video (Chạy ngầm)</span>
              <span className="sm:hidden">Toàn Bộ</span>
            </button>
          </div>

          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg font-medium transition-colors flex items-center gap-1.5"
            title="Lưu phụ đề vào database (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5 text-zinc-300" />
            <span>Lưu</span>
          </button>

          <button
            onClick={() => setIsExportOpen(true)}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold shadow-md shadow-emerald-600/30 transition-all flex items-center gap-1.5"
            title="Xuất file phụ đề hoặc render video MP4"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất MP4</span>
          </button>
        </div>
      </div>

      {/* Live Processing Linear Progress Bar */}
      {isProcessing && (
        <div className="w-full bg-zinc-800 h-1 relative overflow-hidden">
          <div
            className="bg-gradient-to-r from-indigo-500 via-amber-400 to-emerald-400 h-full transition-all duration-300 ease-out"
            style={{ width: `${Math.max(5, progressPercent)}%` }}
          />
        </div>
      )}

      {/* Main Studio Body: 2 Columns */}
      <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
        {/* Left Column: Player & ROI Settings */}
        <div
          className={`${
            layoutMode === 'cinema'
              ? 'w-full md:w-[68%]'
              : layoutMode === 'focus'
              ? 'w-full md:w-[32%]'
              : 'w-full md:w-1/2'
          } flex flex-col gap-3 overflow-y-auto transition-all duration-200`}
        >
          <ProxyPlayer
            videoUrl={videoUrl}
            renderedVideoUrl={apiClient.getRenderedVideoUrl(project.project_id)}
            currentTime={currentTime}
            isPlaying={isPlaying}
            activeCue={activeCue}
            region={activeRegion}
            previewMode={previewMode}
            onPreviewModeChange={setPreviewMode}
            onTimeUpdate={(t) => setCurrentTime(t)}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            onToggleRoi={() => setShowRoiPanel(!showRoiPanel)}
            onAutoDetectRoi={handleAutoDetectRoi}
          />

{showRoiPanel && (
          <RoiSelector
            region={activeRegion}
            onUpdateRegion={(r) => setActiveRegion(r)}
            onAutoDetect={handleAutoDetectRoi}
          />
          )}
        </div>

        {/* Right Column: Dual Bilingual Cue Table */}
        <div
          className={`${
            layoutMode === 'cinema'
              ? 'w-full md:w-[32%]'
              : layoutMode === 'focus'
              ? 'w-full md:w-[68%]'
              : 'w-full md:w-1/2'
          } flex flex-col overflow-hidden transition-all duration-200`}
        >
          <CueTable
            cues={cues}
            selectedCueId={selectedCueId}
            currentVideoTime={currentTime}
            onRunPipeline={() => handleRunPipeline()}
            onRunQuickScan={() => handleRunPipeline(180)}
            isProcessing={isProcessing}
            statusMessage={statusMessage}
            progressPercent={progressPercent}
            onSelectCue={(id) => {
              if (selectedCueId === id || !id) {
                setSelectedCueId(undefined);
              } else {
                setSelectedCueId(id);
                const cue = cues.find((c) => c.cue_id === id);
                if (cue) setCurrentTime(cue.start_pts);
              }
            }}
            onPlayCue={(pts) => {
              setCurrentTime(pts);
              setIsPlaying(true);
            }}
            onUpdateCue={handleUpdateCue}
            onSplitCue={handleSplitCue}
            onMergeWithNext={handleMergeWithNext}
            onDeleteCue={handleDeleteCue}
            onToggleLock={handleToggleLock}
            onRetranslate={handleRetranslate}
          />
        </div>
      </div>

      {/* Bottom Timeline Waveform Bar */}
      <div className="p-4 pt-0">
        <WaveformTimeline
          projectId={project.project_id}
          duration={duration}
          currentTime={currentTime}
          cues={cues}
          selectedCueId={selectedCueId}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
          onSelectCue={(id) => {
            setSelectedCueId(id);
            const cue = cues.find((c) => c.cue_id === id);
            if (cue) setCurrentTime(cue.start_pts);
          }}
          onSeek={(t) => setCurrentTime(t)}
        />
      </div>

      {/* Export Dialog */}
      <ExportModal
        isOpen={isExportOpen}
        project={project}
        onClose={() => setIsExportOpen(false)}
        onViewRendered={() => {
          setPreviewMode('rendered');
          setStatusMessage('✓ Đang phát video MP4 thành phẩm đã render!');
        }}
      />
    </div>
  );
};
