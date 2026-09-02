import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { ProjectManifestV1, RegionTrackV1, SubtitleCueV1 } from '../../types/api';
import { CueTable } from './CueTable';
import { ExportModal } from './ExportModal';
import { ProxyPlayer } from './ProxyPlayer';
import { RoiSelector } from './RoiSelector';
import { useUndoRedo } from './useUndoRedo';
import { WaveformTimeline } from './WaveformTimeline';

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [activeRegion, setActiveRegion] = useState<RegionTrackV1 | undefined>(
    project.regions && project.regions.length > 0 ? project.regions[0] : undefined,
  );

  const loadCues = async () => {
    try {
      const data = await apiClient.getCues(project.project_id);
      setCues(data);
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

  const handleSave = async () => {
    try {
      setStatusMessage('Đang lưu phụ đề...');
      await apiClient.saveCues(project.project_id, cues);
      setStatusMessage('✓ Đã lưu thay đổi!');
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err: any) {
      setStatusMessage(`Lỗi lưu: ${err.message}`);
    }
  };

  const handleRunPipeline = async () => {
    try {
      setIsProcessing(true);
      setStatusMessage('⚡ Đang quét frame video, nhận diện chữ (RapidOCR) và dịch tiếng Việt...');
      await apiClient.runPipeline(project.project_id);
      const data = await apiClient.getCues(project.project_id);
      setCues(data);
      if (data.length > 0) {
        setSelectedCueId(data[0].cue_id);
        setCurrentTime(data[0].start_pts);
        setStatusMessage(`✓ Hoàn tất! Đã trích xuất ${data.length} câu phụ đề.`);
      } else {
        setStatusMessage('✓ Quét hoàn tất nhưng không phát hiện chữ trong vùng ROI đã chọn.');
      }
      setTimeout(() => setStatusMessage(null), 5000);
    } catch (err: any) {
      setStatusMessage(`Lỗi: ${err.message}`);
    } finally {
      setIsProcessing(false);
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

  const duration = cues.length > 0 ? Math.max(...cues.map((c) => c.end_pts)) + 2.0 : 10.0;
  const activeCue = cues.find((c) => currentTime >= c.start_pts && currentTime <= c.end_pts);
  const videoUrl = apiClient.getVideoStreamUrl(project.project_id);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      {/* Studio Header Toolbar */}
      <div className="h-13 bg-zinc-900 border-b border-zinc-800 px-6 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-colors"
          >
            &larr; Quay Lại
          </button>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-100 text-sm">{project.title}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-950/60 border border-indigo-800 text-indigo-300">
              {project.source_language} &rarr; {project.target_language}
            </span>
          </div>
          {statusMessage && (
            <span className="text-indigo-400 font-medium animate-pulse">{statusMessage}</span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg font-mono text-[11px] transition-colors"
            title="Hoàn tác (Ctrl+Z)"
          >
            ↩ Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 rounded-lg font-mono text-[11px] transition-colors"
            title="Làm lại (Ctrl+Y)"
          >
            ↪ Redo
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          <button
            onClick={handleRunPipeline}
            disabled={isProcessing}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50"
          >
            {isProcessing ? 'Đang Xử Lý...' : '⚡ OCR & Dịch Tự Động'}
          </button>

          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg font-medium transition-colors"
          >
            💾 Lưu Cues
          </button>

          <button
            onClick={() => setIsExportOpen(true)}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium shadow-md shadow-emerald-600/30 transition-all flex items-center gap-1.5"
          >
            <span>📥</span> Xuất File
          </button>
        </div>
      </div>

      {/* Main Studio Body: 2 Columns */}
      <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden">
        {/* Left Column: Player & ROI Settings */}
        <div className="w-full md:w-5/12 flex flex-col gap-4 overflow-y-auto">
          <ProxyPlayer
            videoUrl={videoUrl}
            currentTime={currentTime}
            isPlaying={isPlaying}
            activeCue={activeCue}
            onTimeUpdate={(t) => setCurrentTime(t)}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
          />

          <RoiSelector
            region={activeRegion}
            onUpdateRegion={(r) => setActiveRegion(r)}
          />
        </div>

        {/* Right Column: Dual Bilingual Cue Table */}
        <div className="w-full md:w-7/12 flex flex-col overflow-hidden">
          <CueTable
            cues={cues}
            selectedCueId={selectedCueId}
            onSelectCue={(id) => {
              setSelectedCueId(id);
              const cue = cues.find((c) => c.cue_id === id);
              if (cue) setCurrentTime(cue.start_pts);
            }}
            onPlayCue={(pts) => setCurrentTime(pts)}
            onUpdateCue={handleUpdateCue}
            onSplitCue={handleSplitCue}
            onMergeWithNext={handleMergeWithNext}
            onDeleteCue={handleDeleteCue}
            onToggleLock={handleToggleLock}
          />
        </div>
      </div>

      {/* Bottom Timeline Waveform Bar */}
      <div className="p-4 pt-0">
        <WaveformTimeline
          duration={duration}
          currentTime={currentTime}
          cues={cues}
          selectedCueId={selectedCueId}
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
      />
    </div>
  );
};
