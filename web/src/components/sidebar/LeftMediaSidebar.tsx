import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Subtitles,
  Film,
  Search,
  FolderDown,
  Check,
  Edit2,
  Upload,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  ArrowUpDown,
  CheckSquare,
  Square,
  Mic,
  Sliders,
  Volume2,
  Sparkles,
  Plus,
  Trash2,
  Save,
  RefreshCw,
} from 'lucide-react';
import { ProjectManifestV1, SubtitleCueV1 } from '../../types/api';
import { PresetProfile, BUILTIN_PRESETS } from '../../types/presets';
import { apiClient } from '../../api/client';
import { sortProjectsNaturally } from '../../utils/drama';

export type LeftSidebarTab = 'media' | 'subtitles' | 'dubbing' | 'presets';
export type CueFilterMode = 'all' | 'untranslated' | 'translated';

export const detectVoiceProvider = (voice: string): string => {
  if (['Puck', 'Kore', 'Fenrir', 'Aoede'].includes(voice)) return 'gemini';
  if (
    voice.startsWith('BV') ||
    voice.startsWith('vi_female_huong') ||
    voice.includes('_streaming') ||
    voice.includes('_dsp')
  ) {
    return 'capcut';
  }
  return 'edge';
};

interface LeftMediaSidebarProps {
  projects: ProjectManifestV1[];
  activeProject: ProjectManifestV1 | null;
  onSelectProject: (proj: ProjectManifestV1) => void;
  onPickLocalVideo?: (file: File) => void;
  cues: SubtitleCueV1[];
  currentTime: number;
  onRefreshCues?: () => void;
  onRefreshProject?: () => void;
  onSeekToCue: (startPts: number) => void;
  onUpdateCue?: (cue: SubtitleCueV1) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onBatchScanProjects?: (projectIds: string[]) => void;
  onBatchTranslateProjects?: (projectIds: string[]) => void;
  onDeleteProject?: (projectId: string) => void;
  presets?: PresetProfile[];
  activePresetId?: string;
  onSelectPreset?: (preset: PresetProfile) => void;
  onSaveCurrentAsPreset?: (name: string) => void;
  onDeletePreset?: (presetId: string) => void;
  onUpdatePreset?: (preset: PresetProfile) => void;
  selectedCueId?: string | null;
}

export const LeftMediaSidebar: React.FC<LeftMediaSidebarProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onPickLocalVideo,
  cues,
  currentTime,
  onRefreshCues,
  onRefreshProject,
  onSeekToCue,
  onUpdateCue,
  isCollapsed = false,
  onToggleCollapse,
  onBatchScanProjects: _onBatchScanProjects,
  onBatchTranslateProjects: _onBatchTranslateProjects,
  onDeleteProject: _onDeleteProject,
  presets = [],
  activePresetId,
  onSelectPreset,
  onSaveCurrentAsPreset,
  onDeletePreset,
  onUpdatePreset,
  selectedCueId: _selectedCueId,
}) => {
  const [activeTab, setActiveTab] = useState<LeftSidebarTab>('subtitles');
  const [searchQuery, setSearchQuery] = useState('');
  const [cueFilter, setCueFilter] = useState<CueFilterMode>('all');
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');

  // Media tab state: Tự động sort & Chọn nhiều tập
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  // CapCut draft import state
  const [showCapcutModal, setShowCapcutModal] = useState(false);
  const [capcutDraftsList, setCapcutDraftsList] = useState<any[]>([]);
  const [isLoadingCapcutList, setIsLoadingCapcutList] = useState(false);
  const [capcutImportMsg, setCapcutImportMsg] = useState<string | null>(null);

  // Dubbing tab state: Đồng bộ giọng đọc với Backend Settings
  const [selectedVoice, setSelectedVoice] = useState('vi-VN-NamMinhNeural');
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [testVoiceMsg, setTestVoiceMsg] = useState<string | null>(null);

  // Preset CRUD state
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');

  // Nạp cấu hình giọng đọc từ Backend Pipeline Settings
  useEffect(() => {
    let isMounted = true;
    apiClient
      .getPipelineSettings()
      .then((pipe) => {
        if (isMounted && pipe?.dubbing?.voice) {
          setSelectedVoice(pipe.dubbing.voice);
        }
      })
      .catch(() => {});

    const handleSettingsUpdate = (e: any) => {
      const updated = e.detail;
      if (updated?.dubbing?.voice && updated._source !== 'LeftMediaSidebar') {
        setSelectedVoice(updated.dubbing.voice);
      }
    };
    window.addEventListener('pipeline-settings-updated', handleSettingsUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('pipeline-settings-updated', handleSettingsUpdate);
    };
  }, []);

  // Single cue & Master dubbing state
  const [dubbingCueId, setDubbingCueId] = useState<string | null>(null);
  const [retranslatingCueId, setRetranslatingCueId] = useState<string | null>(null);
  const [playingCueAudioId, setPlayingCueAudioId] = useState<string | null>(null);
  const [perCueVoices, setPerCueVoices] = useState<Record<string, string>>({});
  const [isDubbingAll, setIsDubbingAll] = useState<boolean>(false);
  const [dubAllMsg, setDubAllMsg] = useState<string | null>(null);
  const [testVoiceAudioUrl, setTestVoiceAudioUrl] = useState<string | null>(null);
  const cueAudioRef = useRef<HTMLAudioElement | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleRetranslateCue = async (cue: SubtitleCueV1, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeProject) return;
    setRetranslatingCueId(cue.cue_id);
    try {
      const updatedCue = await apiClient.retranslateCue(activeProject.project_id, cue.cue_id);
      if (onUpdateCue) onUpdateCue(updatedCue);
      if (onRefreshCues) onRefreshCues();
    } catch (err: any) {
      alert(`Lỗi khi dịch lại câu: ${err?.message || 'Thất bại'}`);
    } finally {
      setRetranslatingCueId(null);
    }
  };

  const playSingleCueAudio = (cueId: string, customUrl?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeProject) return;
    const url = customUrl || apiClient.getCueAudioUrl(activeProject.project_id, cueId);
    if (playingCueAudioId === cueId) {
      if (cueAudioRef.current) {
        cueAudioRef.current.pause();
        cueAudioRef.current = null;
      }
      setPlayingCueAudioId(null);
      return;
    }
    if (cueAudioRef.current) {
      cueAudioRef.current.pause();
    }
    const audio = new Audio(url);
    cueAudioRef.current = audio;
    setPlayingCueAudioId(cueId);
    audio.play().catch(() => {
      setPlayingCueAudioId(null);
    });
    audio.onended = () => {
      setPlayingCueAudioId(null);
    };
    audio.onerror = () => {
      setPlayingCueAudioId(null);
    };
  };

  const handleDubSingleCue = async (cue: SubtitleCueV1, customVoice?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeProject) return;
    setDubbingCueId(cue.cue_id);
    try {
      const voiceToUse = customVoice || perCueVoices[cue.cue_id] || selectedVoice;
      const prov = detectVoiceProvider(voiceToUse);
      const res = await apiClient.dubSingleCue(activeProject.project_id, cue.cue_id, {
        voice: voiceToUse,
        provider: prov,
      });
      if (res.cue_audio_url) {
        playSingleCueAudio(cue.cue_id, res.cue_audio_url);
      }
      if (onRefreshCues) onRefreshCues();
      if (onRefreshProject) onRefreshProject();
    } catch (err: any) {
      alert(`Lỗi khi lồng tiếng câu: ${err?.message || 'Thất bại'}`);
    } finally {
      setDubbingCueId(null);
    }
  };

  const handleDubAllVideo = async () => {
    if (!activeProject) return;
    setIsDubbingAll(true);
    setDubAllMsg('Đang tạo thuyết minh lồng tiếng toàn bộ video...');
    try {
      const prov = detectVoiceProvider(selectedVoice);
      await apiClient.runDubbing(activeProject.project_id, {
        voice: selectedVoice,
        provider: prov,
      });
      setDubAllMsg('✓ Lồng tiếng toàn video hoàn tất!');
      if (onRefreshProject) onRefreshProject();
      if (onRefreshCues) onRefreshCues();
    } catch (err: any) {
      setDubAllMsg(`Lỗi: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsDubbingAll(false);
      setTimeout(() => setDubAllMsg(null), 4000);
    }
  };

  const handleVoiceChange = async (newVoice: string) => {
    setSelectedVoice(newVoice);
    setTestVoiceAudioUrl(null);
    setTestVoiceMsg(null);
    try {
      const current = await apiClient.getPipelineSettings();
      if (current) {
        const updated = {
          ...current,
          dubbing: {
            ...current.dubbing,
            voice: newVoice,
          },
        };
        await apiClient.savePipelineSettings(updated);
        window.dispatchEvent(
          new CustomEvent('pipeline-settings-updated', {
            detail: { ...updated, _source: 'LeftMediaSidebar' },
          })
        );
      }
    } catch (err) {
      console.warn('Lỗi lưu giọng đọc sang backend:', err);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phân loại phụ đề
  const isCueTranslated = (cue: SubtitleCueV1) => {
    if (!cue.translated_text || cue.translated_text.trim().length === 0) return false;
    if (cue.translated_text.trim() !== cue.source_text.trim()) return true;
    return /^[\d\s.,:;!?%#\-+*\/()]+$/.test(cue.source_text.trim());
  };

  const translatedCues = useMemo(() => cues.filter(isCueTranslated), [cues]);
  const untranslatedCues = useMemo(() => cues.filter((c) => !isCueTranslated(c)), [cues]);

  const filteredCues = useMemo(() => {
    let list = cues;
    if (cueFilter === 'translated') list = translatedCues;
    if (cueFilter === 'untranslated') list = untranslatedCues;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) =>
          c.source_text.toLowerCase().includes(q) ||
          (c.translated_text && c.translated_text.toLowerCase().includes(q))
      );
    }
    return list;
  }, [cues, cueFilter, searchQuery, translatedCues, untranslatedCues]);

  // Sắp xếp danh sách tập phim tự nhiên (Tập 1 -> Tập 100)
  const filteredAndSortedProjects = useMemo(() => {
    let list = [...projects];
    if (mediaSearchQuery.trim()) {
      const q = mediaSearchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.project_id.toLowerCase().includes(q)
      );
    }
    const sorted = sortProjectsNaturally(list);
    return sortOrder === 'asc' ? sorted : [...sorted].reverse();
  }, [projects, mediaSearchQuery, sortOrder]);

  const handleStartEdit = (cue: SubtitleCueV1) => {
    setEditingCueId(cue.cue_id);
    setEditingText(cue.translated_text || cue.source_text);
  };

  const handleSaveEdit = (cue: SubtitleCueV1) => {
    if (onUpdateCue) {
      onUpdateCue({
        ...cue,
        translated_text: editingText,
        status: 'reviewed',
      });
    }
    setEditingCueId(null);
  };

  const handleCancelEdit = () => {
    setEditingCueId(null);
    setEditingText('');
  };

  // Mở modal lấy danh sách CapCut drafts
  const handleOpenCapcutDrafts = async () => {
    setShowCapcutModal(true);
    setIsLoadingCapcutList(true);
    setCapcutImportMsg(null);
    try {
      const res = await apiClient.getCapCutDrafts();
      setCapcutDraftsList(res?.drafts || []);
    } catch (err: any) {
      setCapcutImportMsg('Không thể quét danh sách dự án CapCut trên máy.');
    } finally {
      setIsLoadingCapcutList(false);
    }
  };

  // Nhập phụ đề từ 1 dự án CapCut được chọn
  const handleImportCapcutProject = async (draftId: string) => {
    if (!activeProject) return;
    setIsLoadingCapcutList(true);
    try {
      const res = await apiClient.importCapCutDraft(activeProject.project_id, draftId);
      setCapcutImportMsg(`Đã nhập thành công ${res?.imported_count || 0} câu phụ đề từ CapCut!`);
      if (onRefreshCues) onRefreshCues();
      if (onRefreshProject) onRefreshProject();
      setTimeout(() => setShowCapcutModal(false), 1500);
    } catch (err: any) {
      setCapcutImportMsg(`Lỗi nhập: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsLoadingCapcutList(false);
    }
  };

  // Chọn / Bỏ chọn tập phim
  const handleToggleProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSelectAllProjects = () => {
    if (selectedProjectIds.length === filteredAndSortedProjects.length) {
      setSelectedProjectIds([]);
    } else {
      setSelectedProjectIds(filteredAndSortedProjects.map((p) => p.project_id));
    }
  };

  // Thử giọng đọc mẫu
  const handleTestVoice = async () => {
    setIsTestingVoice(true);
    setTestVoiceMsg('Đang tạo âm thanh giọng đọc mẫu thật...');
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current = null;
    }
    try {
      const prov = detectVoiceProvider(selectedVoice);
      const blob = await apiClient.testDubbing({
        text: 'Xin chào, đây là giọng đọc thử nghiệm của Subtitle Localizer Studio.',
        voice: selectedVoice,
        provider: prov,
      });
      const url = URL.createObjectURL(blob);
      setTestVoiceAudioUrl(url);
      setTestVoiceMsg('▶ Đang phát giọng đọc mẫu thật...');
      const audio = new Audio(url);
      testAudioRef.current = audio;
      audio.onended = () => {
        setTestVoiceMsg('✓ Đã phát xong giọng đọc mẫu');
        setTimeout(() => setTestVoiceMsg(null), 3000);
      };
      audio.onerror = () => {
        setTestVoiceMsg('Lỗi phát âm thanh trên trình duyệt');
      };
      await audio.play();
    } catch (err: any) {
      setTestVoiceMsg(`Chưa thể phát giọng đọc thử: ${err?.message || 'Lỗi kết nối'}`);
    } finally {
      setIsTestingVoice(false);
    }
  };

  if (isCollapsed) {
    return (
      <aside className="w-12 bg-slate-950 border-r border-slate-800/80 flex flex-col items-center py-3 shrink-0 select-none z-20 transition-all duration-200">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition mb-4"
          title="Mở rộng Hộp Quản Lý Media"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('media');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-xl transition mb-2 ${
            activeTab === 'media' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Tệp Media / Tập Phim"
        >
          <Film className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('subtitles');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-xl transition mb-2 ${
            activeTab === 'subtitles' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Văn Bản / Phụ Đề Dịch"
        >
          <Subtitles className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('dubbing');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-xl transition mb-2 ${
            activeTab === 'dubbing' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Lồng Tiếng AI"
        >
          <Mic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('presets');
            onToggleCollapse?.();
          }}
          className={`p-2 rounded-xl transition ${
            activeTab === 'presets' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
          title="Preset Cấu Hình"
        >
          <Sliders className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-88 xl:w-96 bg-slate-950 border-r border-slate-800/80 flex flex-col shrink-0 select-none z-20 min-h-0 overflow-hidden shadow-lg transition-all duration-200">
      {/* 1. Header Tab Bar (4 Tab Chuẩn CapCut PC) */}
      <div className="h-11 bg-slate-900/60 border-b border-slate-800/80 px-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] flex-1 mr-2">
          <button
            type="button"
            onClick={() => setActiveTab('media')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition flex items-center justify-center gap-1 ${
              activeTab === 'media'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Tệp Media & Tập Phim"
          >
            <Film className="w-3 h-3" />
            <span>Media</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('subtitles')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition flex items-center justify-center gap-1 ${
              activeTab === 'subtitles'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Văn Bản & Phụ Đề Dịch"
          >
            <Subtitles className="w-3 h-3" />
            <span>Văn Bản</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dubbing')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition flex items-center justify-center gap-1 ${
              activeTab === 'dubbing'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Lồng Tiếng AI"
          >
            <Mic className="w-3 h-3" />
            <span>Voice</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`flex-1 py-1 rounded-md font-medium text-center transition flex items-center justify-center gap-1 ${
              activeTab === 'presets'
                ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Chuẩn Preset"
          >
            <Sliders className="w-3 h-3" />
            <span>Preset</span>
          </button>
        </div>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-900 transition"
            title="Thu gọn Hộp Media"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 2. Nội dung Chi Tiết Từng Tab */}
      {/* ================= TAB 1: TỆP MEDIA / TẬP PHIM ================= */}
      {activeTab === 'media' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 space-y-3 overflow-hidden">
          {/* Thanh tìm kiếm & Sắp xếp */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Tìm tập phim..."
                value={mediaSearchQuery}
                onChange={(e) => setMediaSearchQuery(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition"
              title={`Sắp xếp: ${sortOrder === 'asc' ? 'Tập 1 -> 100' : 'Tập 100 -> 1'}`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Chọn tất cả & Tải lên tập mới */}
          <div className="flex items-center justify-between text-xs px-1">
            <button
              type="button"
              onClick={handleSelectAllProjects}
              className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200"
            >
              {selectedProjectIds.length === filteredAndSortedProjects.length && filteredAndSortedProjects.length > 0 ? (
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-600" />
              )}
              <span>Chọn tất cả ({filteredAndSortedProjects.length})</span>
            </button>

            {onPickLocalVideo && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onPickLocalVideo(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition"
                >
                  <Upload className="w-3 h-3" />
                  <span>+ Thêm Video</span>
                </button>
              </>
            )}
          </div>

          {/* Danh sách các thẻ tập phim */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
            {filteredAndSortedProjects.map((proj) => {
              const isCurrent = activeProject?.project_id === proj.project_id;
              const isChecked = selectedProjectIds.includes(proj.project_id);

              return (
                <div
                  key={proj.project_id}
                  onClick={() => onSelectProject(proj)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                    isCurrent
                      ? 'bg-indigo-950/90 border-indigo-500 ring-1 ring-indigo-500/50 shadow-md'
                      : isChecked
                      ? 'bg-slate-900/90 border-indigo-800/80 shadow-sm'
                      : 'bg-slate-900/50 hover:bg-slate-900 border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => handleToggleProject(proj.project_id, e)}
                      className="p-1 text-slate-500 hover:text-indigo-400 transition shrink-0 rounded"
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                      )}
                    </button>

                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : isChecked
                          ? 'bg-indigo-900 text-indigo-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Film className="w-3.5 h-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className={`font-semibold truncate text-xs ${isCurrent ? 'text-white font-bold' : 'text-slate-200'}`}>
                        {proj.title}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>{proj.project_id.slice(0, 8)}</span>
                        {proj.cues_count !== undefined && <span>• {proj.cues_count} câu</span>}
                      </div>
                    </div>
                  </div>

                  {isCurrent && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold shrink-0 ml-2">
                      Đang mở
                    </span>
                  )}
                </div>
              );
            })}

            {filteredAndSortedProjects.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs">
                Không tìm thấy tập phim nào khớp với từ khóa.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 2: VĂN BẢN / PHỤ ĐỀ DỊCH ================= */}
      {activeTab === 'subtitles' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 space-y-3 overflow-hidden">
          {/* Thanh Tìm kiếm & Bộ Lọc */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Tìm câu tiếng Trung hoặc tiếng Việt..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setCueFilter('all')}
                  className={`px-2 py-0.5 rounded-md font-medium transition ${
                    cueFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tất cả ({cues.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCueFilter('untranslated')}
                  className={`px-2 py-0.5 rounded-md font-medium transition ${
                    cueFilter === 'untranslated' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Chưa dịch ({untranslatedCues.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCueFilter('translated')}
                  className={`px-2 py-0.5 rounded-md font-medium transition ${
                    cueFilter === 'translated' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Đã dịch ({translatedCues.length})
                </button>
              </div>

              {/* Nút Nhập từ CapCut Desktop */}
              <button
                type="button"
                onClick={handleOpenCapcutDrafts}
                className="p-1 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-slate-900 transition flex items-center gap-1"
                title="Nhập phụ đề từ dự án CapCut Desktop Drafts"
              >
                <FolderDown className="w-3.5 h-3.5" />
                <span className="text-[10px]">CapCut</span>
              </button>
            </div>
          </div>

          {/* Danh sách phụ đề cuộn được */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {filteredCues.map((cue, idx) => {
              const isPlayingNow = (currentTime + 0.05) >= cue.start_pts && (currentTime - 0.05) <= cue.end_pts;
              const isEditing = editingCueId === cue.cue_id;
              const isTrans = isCueTranslated(cue);

              return (
                <div
                  key={cue.cue_id || idx}
                  onClick={() => onSeekToCue(cue.start_pts)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                    isPlayingNow
                      ? 'bg-indigo-950/90 border-indigo-500 ring-1 ring-indigo-500/50 shadow-md'
                      : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80'
                  }`}
                >
                  {/* Header câu phụ đề */}
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span className="font-semibold text-slate-400">#{idx + 1}</span>
                    <span className="text-indigo-300">
                      {cue.start_pts.toFixed(2)}s ➔ {cue.end_pts.toFixed(2)}s
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                        isTrans
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                          : 'bg-amber-950 text-amber-300 border border-amber-800/60'
                      }`}
                    >
                      {isTrans ? 'Đã Dịch' : 'Chưa Dịch'}
                    </span>
                  </div>

                  {/* Câu Gốc Tiếng Trung */}
                  <div className="text-slate-400 text-xs font-sans select-text">{cue.source_text}</div>

                  {/* Câu Dịch Tiếng Việt */}
                  {isEditing ? (
                    <div className="space-y-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="w-full bg-slate-950 border border-indigo-500 rounded-lg p-2 text-xs text-white focus:outline-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(cue)}
                          className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" />
                          <span>Lưu</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-1 group/item">
                      <div
                        className={`text-xs font-semibold select-text leading-snug ${
                          isTrans ? 'text-amber-300' : 'text-slate-500 italic'
                        }`}
                      >
                        {cue.translated_text || 'Chưa có bản dịch...'}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(cue);
                        }}
                        className="opacity-0 group-hover/item:opacity-100 p-1 text-slate-400 hover:text-indigo-300 transition"
                        title="Chỉnh sửa câu dịch này"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Thanh công cụ cho từng câu: Dịch lại AI, Lồng tiếng đơn, Nghe audio */}
                  <div className="flex items-center justify-between gap-1 pt-1.5 mt-1 border-t border-slate-800/80 flex-wrap">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetranslateCue(cue);
                        }}
                        disabled={retranslatingCueId === cue.cue_id}
                        className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10px] flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                        title="Dịch lại riêng câu này bằng AI"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${retranslatingCueId === cue.cue_id ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} />
                        <span>Dịch lại</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => playSingleCueAudio(cue.cue_id, undefined, e)}
                        className={`px-1.5 py-0.5 rounded border text-[10px] flex items-center gap-1 transition cursor-pointer ${
                          playingCueAudioId === cue.cue_id
                            ? 'bg-emerald-950 border-emerald-600 text-emerald-300 animate-pulse'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                        title="Nghe audio câu này"
                      >
                        <Volume2 className="w-2.5 h-2.5 text-emerald-400" />
                        <span>{playingCueAudioId === cue.cue_id ? 'Đang phát' : 'Nghe'}</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <select
                        value={perCueVoices[cue.cue_id] || selectedVoice}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          setPerCueVoices((prev) => ({ ...prev, [cue.cue_id]: e.target.value }));
                        }}
                        className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[9px] text-slate-300 focus:outline-none focus:border-amber-500 max-w-[90px] truncate"
                        title="Chọn giọng đọc riêng cho câu này"
                      >
                        <option value="vi-VN-NamMinhNeural">Nam Minh</option>
                        <option value="vi-VN-HoaiMyNeural">Hoài My</option>
                        <option value="BV075_streaming">Thanh Niên</option>
                        <option value="BV074_streaming">Cô Gái</option>
                        <option value="BV421_vivn_streaming">Ngọt Ngào</option>
                        <option value="BV562_streaming">Mai (Đài TH)</option>
                        <option value="vi_female_huong">Hương (Bắc)</option>
                        <option value="BV560_streaming">Alex</option>
                        <option value="Puck">Puck</option>
                        <option value="Kore">Kore</option>
                      </select>

                      <button
                        type="button"
                        onClick={(e) => handleDubSingleCue(cue, perCueVoices[cue.cue_id], e)}
                        disabled={dubbingCueId === cue.cue_id}
                        className="px-2 py-0.5 rounded bg-amber-950/80 hover:bg-amber-900 border border-amber-800/80 text-amber-300 text-[10px] font-medium flex items-center gap-1 transition cursor-pointer shadow-sm disabled:opacity-50"
                        title="Lồng tiếng đơn câu này"
                      >
                        {dubbingCueId === cue.cue_id ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-300" />
                        ) : (
                          <Mic className="w-2.5 h-2.5 text-amber-400" />
                        )}
                        <span>Lồng tiếng</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredCues.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs">
                Chưa có câu phụ đề nào. Hãy bấm "Bắt Đầu Quét Sub" ở góc trên hoặc bảng phải để nhận diện.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: LỒNG TIẾNG AI (VOICEOVER) ================= */}
      {activeTab === 'dubbing' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 space-y-4 overflow-y-auto text-xs">
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Mic className="w-4 h-4 text-amber-400" />
              <span>Kho Giọng Đọc AI (Chuẩn Cài Đặt)</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Tự động khớp và tạo giọng đọc AI tiếng Việt theo đúng thiết lập toàn cục của hệ thống.
            </p>

            <div className="space-y-1.5 pt-1">
              <label className="text-slate-400 text-[10px] block">Chọn giọng đọc chính:</label>
              <select
                value={selectedVoice}
                onChange={(e) => handleVoiceChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 text-xs focus:border-indigo-500 focus:outline-none"
              >
                <optgroup label="🇻🇳 Giọng Đọc Chuẩn Edge TTS (Miễn phí & Tự nhiên)">
                  <option value="vi-VN-NamMinhNeural">Nam Minh (Nam trầm ấm, kịch tính, chuẩn đài)</option>
                  <option value="vi-VN-HoaiMyNeural">Hoài My (Nữ truyền cảm, dịu dàng, chuẩn phim)</option>
                </optgroup>

                <optgroup label="🎬 Giọng Đọc CapCut Hot Trend (Review Phim & TikTok)">
                  <option value="BV075_streaming">Thanh Niên Tự Tin (Review phim)</option>
                  <option value="BV074_streaming">Cô Gái Hoạt Ngôn (Tươi sáng, thu hút)</option>
                  <option value="BV421_vivn_streaming">Nhỏ Ngọt Ngào (Tâm sự, nhẹ nhàng)</option>
                  <option value="BV562_streaming">Mai (Thuyết minh chuẩn đài truyền hình)</option>
                  <option value="vi_female_huong">Hương (Nữ phổ thông miền Bắc)</option>
                  <option value="BV560_streaming">Alex Đại Đế (Nam trầm quyền uy)</option>
                  <option value="BV075_streaming_vibrato_dsp">Việt Méo (Hài hước, parody)</option>
                  <option value="BV074_streaming_dsp">Bé Nhí Nhảnh (Trẻ em dễ thương)</option>
                </optgroup>

                <optgroup label="🌟 Giọng Đọc Gemini AI TTS (Đa sắc thái)">
                  <option value="Puck">Puck (Gemini Tự Nhiên)</option>
                  <option value="Kore">Kore (Gemini Truyền Cảm)</option>
                  <option value="Fenrir">Fenrir (Gemini Trầm Ấm)</option>
                  <option value="Aoede">Aoede (Gemini Thanh Thoát)</option>
                </optgroup>

                <optgroup label="🌍 Giọng Đọc Quốc Tế (English)">
                  <option value="en-US-JennyNeural">Jenny (US Female Warm)</option>
                  <option value="en-US-GuyNeural">Guy (US Male Broadcast)</option>
                  <option value="en-US-AriaNeural">Aria (US Dynamic Narrator)</option>
                  <option value="en-US-ChristopherNeural">Christopher (US Deep Storyteller)</option>
                  <option value="en-GB-RyanNeural">Ryan (British Classic)</option>
                  <option value="en-GB-SoniaNeural">Sonia (British Elegant)</option>
                </optgroup>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTestVoice}
                disabled={isTestingVoice}
                className="flex-1 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                {isTestingVoice ? <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400" />}
                <span>Nghe Thử Giọng Mẫu</span>
              </button>
            </div>

            {testVoiceMsg && (
              <div className="p-2 bg-indigo-950/60 border border-indigo-800/80 rounded text-[10px] text-indigo-300 text-center font-medium">
                {testVoiceMsg}
              </div>
            )}

            {testVoiceAudioUrl && (
              <div className="p-2 bg-slate-950 rounded-lg border border-slate-800 space-y-1 animate-in fade-in">
                <div className="text-[10px] text-amber-300 font-mono flex items-center justify-between">
                  <span>Trình phát giọng đọc mẫu:</span>
                  <span className="text-slate-400 truncate max-w-[150px]">{selectedVoice}</span>
                </div>
                <audio
                  key={testVoiceAudioUrl}
                  controls
                  src={testVoiceAudioUrl}
                  className="w-full h-8"
                />
              </div>
            )}

            {/* Lồng tiếng toàn bộ video */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <button
                type="button"
                onClick={handleDubAllVideo}
                disabled={isDubbingAll || !activeProject}
                className="w-full py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold rounded-lg flex items-center justify-center gap-2 shadow-md transition active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                {isDubbingAll ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                    <span>Đang Lồng Tiếng Toàn Bộ Video...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-slate-950" />
                    <span>Lồng Tiếng Toàn Bộ Video</span>
                  </>
                )}
              </button>

              {dubAllMsg && (
                <div className="p-2 bg-amber-950/60 border border-amber-800/80 rounded text-[11px] text-amber-300 text-center font-medium">
                  {dubAllMsg}
                </div>
              )}
            </div>

            {/* Trình phát file audio Master hoàn chỉnh nếu đã có voiceover */}
            {activeProject && (activeProject.has_voiceover || (activeProject as any).voiceover_path || (activeProject as any).status === 'completed') && (
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-slate-300 font-semibold text-[11px]">
                  <span className="flex items-center gap-1.5 text-amber-300">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>File Thuyết Minh Master Đã Tạo:</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">voiceover.mp3</span>
                </div>
                <audio
                  controls
                  src={apiClient.getVoiceoverAudioUrl(activeProject.project_id)}
                  className="w-full h-8 rounded-lg"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 4: PRESET CẤU HÌNH (PRESET PROFILES) ================= */}
      {activeTab === 'presets' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 space-y-3 overflow-y-auto text-xs">
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between font-semibold text-slate-200">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>Chuẩn Cấu Hình Sẵn</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingPreset(true);
                  setNewPresetName(`Preset ${presets.length + 1}`);
                }}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold transition shadow-sm cursor-pointer"
                title="Lưu toàn bộ tỷ lệ, vùng quét và kiểu che hiện tại thành preset mới"
              >
                <Plus className="w-3 h-3" />
                <span>Lưu Preset</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Áp dụng tức thì tỷ lệ khung hình, vị trí vùng quét sub, và phong cách che mờ cho phim bộ.
            </p>

            {/* Form tạo mới Preset từ cấu hình video hiện tại */}
            {isCreatingPreset && (
              <div className="p-2.5 bg-slate-950 border border-indigo-500 rounded-xl space-y-2 animate-in fade-in">
                <label className="text-[10px] text-slate-300 font-semibold block">Tên Preset Mới:</label>
                <input
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Ví dụ: TikTok 9:16 Vùng Đáy..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-400"
                  autoFocus
                />
                <div className="flex justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingPreset(false)}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onSaveCurrentAsPreset) {
                        onSaveCurrentAsPreset(newPresetName);
                      }
                      setIsCreatingPreset(false);
                    }}
                    className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 shadow"
                  >
                    <Save className="w-3 h-3" />
                    <span>Lưu</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 pt-1">
              {((presets && presets.length > 0) ? presets : BUILTIN_PRESETS).map((preset) => {
                const isCurrentPreset = preset.id === activePresetId;
                const isEditing = editingPresetId === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => onSelectPreset?.(preset)}
                    className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 relative group/card ${
                      isCurrentPreset
                        ? 'bg-indigo-950/90 border-indigo-500 ring-1 ring-indigo-500/50 shadow-md'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingPresetName}
                          onChange={(e) => setEditingPresetName(e.target.value)}
                          className="w-full bg-slate-900 border border-indigo-400 rounded px-2 py-1 text-xs text-white focus:outline-none"
                          autoFocus
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingPresetId(null)}
                            className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdatePreset) {
                                onUpdatePreset({ ...preset, name: editingPresetName });
                              }
                              setEditingPresetId(null);
                            }}
                            className="px-2 py-0.5 rounded bg-indigo-600 text-[10px] text-white font-semibold"
                          >
                            Lưu
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-200 text-xs flex items-center gap-1.5 truncate max-w-[170px]">
                          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isCurrentPreset ? 'text-amber-400' : 'text-indigo-400'}`} />
                          <span className="truncate">{preset.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {isCurrentPreset ? (
                            <span className="px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-500/50 text-[10px] font-bold">
                              ✓ Đang chọn
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500 group-hover/card:text-slate-300">
                              Áp dụng
                            </span>
                          )}

                          {/* Phím sửa & xóa Preset */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPresetId(preset.id);
                              setEditingPresetName(preset.name);
                            }}
                            className="opacity-0 group-hover/card:opacity-100 p-1 hover:text-white text-slate-400 transition"
                            title="Đổi tên preset"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          {onDeletePreset && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Bạn có chắc muốn xóa preset "${preset.name}"?`)) {
                                  onDeletePreset(preset.id);
                                }
                              }}
                              className="opacity-0 group-hover/card:opacity-100 p-1 hover:text-rose-400 text-slate-400 transition"
                              title="Xóa preset này"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px] text-slate-400">
                      <span className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 font-mono text-cyan-300">
                        📐 {preset.aspect_ratio}
                      </span>
                      <span className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 text-slate-300">
                        🎨 {preset.mask_style}
                      </span>
                      {preset.is_flipped_h && (
                        <span className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 text-amber-300">
                          ↔ Lật ngang
                        </span>
                      )}
                      {preset.is_flipped_v && (
                        <span className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 text-indigo-300">
                          ↕ Lật dọc
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CapCut Desktop Draft Import Modal */}
      {showCapcutModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FolderDown className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Nhập Phụ Đề từ CapCut Desktop Draft</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCapcutModal(false)}
                className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Chọn một dự án CapCut trên máy tính của bạn để trích xuất phụ đề tự động:
            </p>

            {capcutImportMsg && (
              <div className="p-2.5 rounded-lg bg-indigo-950/60 border border-indigo-800/80 text-indigo-300 text-xs text-center font-medium">
                {capcutImportMsg}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-2 text-xs pr-1">
              {isLoadingCapcutList ? (
                <div className="p-8 flex items-center justify-center gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Đang quét các dự án CapCut trên máy...</span>
                </div>
              ) : capcutDraftsList.length > 0 ? (
                capcutDraftsList.map((draft, idx) => {
                  const draftId = draft.id || draft.draft_id || '';
                  const cueCount = draft.cue_count ?? 0;
                  return (
                    <div
                      key={draftId || idx}
                      onClick={() => draftId && handleImportCapcutProject(draftId)}
                      className="p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-indigo-500 flex items-center justify-between gap-3 cursor-pointer transition"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200 truncate" title={draft.name || draftId}>
                            {draft.name || draftId}
                          </span>
                          {cueCount > 0 && (
                            <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 text-[10px] font-mono shrink-0">
                              {cueCount} câu
                            </span>
                          )}
                        </div>
                        {draft.preview_cues && draft.preview_cues.length > 0 && (
                          <div className="text-[10px] text-slate-400 italic truncate max-w-xs">
                            "{draft.preview_cues[0]}"
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                          <span>{draft.updated_at || 'Gần đây'}</span>
                          {draft.duration_sec > 0 && <span>{draft.duration_sec}s</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (draftId) handleImportCapcutProject(draftId);
                        }}
                        disabled={isLoadingCapcutList}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shrink-0 transition shadow disabled:opacity-50 cursor-pointer"
                      >
                        Nhập
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                  Không tìm thấy dự án CapCut Desktop nào trong thư mục chuẩn.
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCapcutModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
};
