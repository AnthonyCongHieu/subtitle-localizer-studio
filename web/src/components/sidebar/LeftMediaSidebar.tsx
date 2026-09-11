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
  ChevronDown,
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
import { ProjectManifestV1, SubtitleCueV1, RegionTrackV1 } from '../../types/api';
import { PresetProfile, BUILTIN_PRESETS } from '../../types/presets';
import { apiClient } from '../../api/client';
import { sortProjectsNaturally } from '../../utils/drama';
import { appLogger } from '../common/GlobalActivityLogger';

export type LeftSidebarTab = 'media' | 'subtitles' | 'dubbing' | 'presets';
export type CueFilterMode = 'all' | 'untranslated' | 'translated';

import { detectVoiceProvider } from '../../constants/voiceCatalog';
import { VoiceCatalogPicker } from '../common/VoiceCatalogPicker';

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
  onSplitCue?: (
    splitTime?: number,
    targetCueId?: string,
    customTexts?: { text1?: string; text2?: string; trans1?: string; trans2?: string }
  ) => void;
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
  onUpdateActiveProject?: (patch: Partial<ProjectManifestV1>) => void;
  currentRoi?: RegionTrackV1;
  isScanning?: boolean;
  scanProgress?: number | null;
  statusMessage?: string | null;
  width?: number;
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
  onSplitCue: _onSplitCue,
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
  onUpdateActiveProject,
  currentRoi,
  isScanning = false,
  scanProgress,
  statusMessage,
  width,
}) => {
  const [activeTab, setActiveTab] = useState<LeftSidebarTab>('subtitles');
  const [searchQuery, setSearchQuery] = useState('');
  const [cueFilter, setCueFilter] = useState<CueFilterMode>('all');
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingSpokenText, setEditingSpokenText] = useState<string>('');
  const [editingSpeaker, setEditingSpeaker] = useState<string>('unknown');
  const [editingSpeakerId, setEditingSpeakerId] = useState<string>('');
  const [editingSpeakerRole, setEditingSpeakerRole] = useState<string>('main');
  const [adaptingSpoken, setAdaptingSpoken] = useState(false);
  const splitTextareaRef = useRef<HTMLTextAreaElement>(null);

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
  const [dubbingMode, setDubbingMode] = useState<'single' | 'multi'>('single');
  const [selectedVoice, setSelectedVoice] = useState('vi-VN-NamMinhNeural');
  const [selectedMaleVoice, setSelectedMaleVoice] = useState('vi-VN-NamMinhNeural');
  const [selectedFemaleVoice, setSelectedFemaleVoice] = useState('vi-VN-HoaiMyNeural');
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [testVoiceMsg, setTestVoiceMsg] = useState<string | null>(null);
  const [dubbingSpeed, setDubbingSpeed] = useState<number>(1.0);

  // Đồng bộ cấu hình lồng tiếng riêng của video hiện tại nếu có
  useEffect(() => {
    if (activeProject?.custom_pipeline_settings?.dubbing) {
      const dub = activeProject.custom_pipeline_settings.dubbing;
      if (dub.mode) setDubbingMode(dub.mode);
      if (dub.voice) setSelectedVoice(dub.voice);
      if (dub.voice_male) setSelectedMaleVoice(dub.voice_male);
      if (dub.voice_female) setSelectedFemaleVoice(dub.voice_female);
    }
  }, [activeProject?.project_id, activeProject?.custom_pipeline_settings]);

  // Preset CRUD state
  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPreset, setEditingPreset] = useState<PresetProfile | null>(null);

  // Nạp cấu hình giọng đọc từ Backend Pipeline Settings
  useEffect(() => {
    let isMounted = true;
    apiClient
      .getPipelineSettings()
      .then((pipe) => {
        if (isMounted && pipe?.dubbing) {
          const prov = pipe.dubbing.provider || 'edge';
          let voice = pipe.dubbing.voice || 'vi-VN-NamMinhNeural';
          // Nếu hệ thống đang cấu hình CapCut nhưng giọng lưu trữ là Edge, tự động ưu tiên chọn giọng CapCut hot trend
          if (prov === 'capcut' && detectVoiceProvider(voice) !== 'capcut') {
            voice = pipe.dubbing.voice_male || 'BV075_streaming';
          }
          setSelectedVoice(voice);
          if (pipe.dubbing.mode) {
            setDubbingMode(pipe.dubbing.mode === 'multi' ? 'multi' : 'single');
          }
          if (pipe.dubbing.voice_male) {
            setSelectedMaleVoice(pipe.dubbing.voice_male);
          }
          if (pipe.dubbing.voice_female) {
            setSelectedFemaleVoice(pipe.dubbing.voice_female);
          }
        }
      })
      .catch(() => {});

    const handleSettingsUpdate = (e: any) => {
      const updated = e.detail;
      if (updated?.dubbing && updated._source !== 'LeftMediaSidebar') {
        const prov = updated.dubbing.provider || 'edge';
        let voice = updated.dubbing.voice || 'vi-VN-NamMinhNeural';
        if (prov === 'capcut' && detectVoiceProvider(voice) !== 'capcut') {
          voice = updated.dubbing.voice_male || 'BV075_streaming';
        }
        setSelectedVoice(voice);
        if (updated.dubbing.mode) {
          setDubbingMode(updated.dubbing.mode === 'multi' ? 'multi' : 'single');
        }
        if (updated.dubbing.voice_male) {
          setSelectedMaleVoice(updated.dubbing.voice_male);
        }
        if (updated.dubbing.voice_female) {
          setSelectedFemaleVoice(updated.dubbing.voice_female);
        }
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
  const [currentTestingVoice, setCurrentTestingVoice] = useState<string>('');
  const cueAudioRef = useRef<HTMLAudioElement | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  // Tự động phát âm thanh mẫu trên thanh Trình phát DOM đồng bộ và giải phóng bộ nhớ blob URL
  useEffect(() => {
    if (testVoiceAudioUrl && testAudioRef.current) {
      testAudioRef.current.currentTime = 0;
      testAudioRef.current.play().catch(() => {});
    }
  }, [testVoiceAudioUrl]);

  useEffect(() => {
    return () => {
      if (testVoiceAudioUrl) {
        URL.revokeObjectURL(testVoiceAudioUrl);
      }
    };
  }, [testVoiceAudioUrl]);

  const handleRetranslateCue = async (cue: SubtitleCueV1, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeProject) return;
    setRetranslatingCueId(cue.cue_id);
    try {
      const updatedCue = await apiClient.retranslateCue(activeProject.project_id, cue.cue_id);
      if (onUpdateCue) onUpdateCue(updatedCue);
      if (onRefreshCues) onRefreshCues();
      appLogger.success('Đã dịch lại câu phụ đề thành công!', 'Dịch thuật');
    } catch (err: any) {
      appLogger.error(`Lỗi khi dịch lại câu: ${err?.message || 'Thất bại'}`, 'Dịch thuật');
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
      const rateStr = dubbingSpeed === 1.0 ? '+0%' : (dubbingSpeed > 1 ? `+${Math.round((dubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - dubbingSpeed) * 100)}%`);
      const res = await apiClient.dubSingleCue(activeProject.project_id, cue.cue_id, {
        voice: voiceToUse,
        provider: prov,
        rate: rateStr,
      });
      if (res.cue_audio_url) {
        playSingleCueAudio(cue.cue_id, res.cue_audio_url);
      }
      if (onUpdateActiveProject) {
        onUpdateActiveProject({
          has_voiceover: true,
          voiceover_path: res.audio_url,
        });
      }
      if (onRefreshCues) onRefreshCues();
      if (onRefreshProject) onRefreshProject();
      appLogger.success('Đã lồng tiếng câu phụ đề thành công!', 'Lồng tiếng');
    } catch (err: any) {
      appLogger.error(`Lỗi khi lồng tiếng câu: ${err?.message || 'Thất bại'}`, 'Lồng tiếng');
    } finally {
      setDubbingCueId(null);
    }
  };

  const handleCleanCueTranslation = async (cue: SubtitleCueV1, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activeProject || !window.confirm('Xóa bản dịch của câu này? Văn bản OCR gốc vẫn được giữ.')) return;
    try {
      const result = await apiClient.cleanCueTranslation(activeProject.project_id, cue.cue_id);
      onUpdateCue?.(result.cue);
      onRefreshCues?.();
      onRefreshProject?.();
      appLogger.success('Đã clean bản dịch câu này', 'Dịch thuật');
    } catch (err: any) {
      appLogger.error(`Clean dịch thất bại: ${err?.message || 'Thất bại'}`, 'Dịch thuật');
    }
  };

  const handleCleanCueVoice = async (cue: SubtitleCueV1, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activeProject || !window.confirm('Xóa voice của câu này? Voice master sẽ cần tạo lại.')) return;
    try {
      await apiClient.cleanCueVoiceover(activeProject.project_id, cue.cue_id);
      onRefreshCues?.();
      onRefreshProject?.();
      appLogger.success('Đã clean voice câu này', 'Lồng tiếng');
    } catch (err: any) {
      appLogger.error(`Clean voice thất bại: ${err?.message || 'Thất bại'}`, 'Lồng tiếng');
    }
  };

  const handleCleanAllTranslation = async () => {
    if (!activeProject || !window.confirm('Xóa toàn bộ bản dịch và voice phát sinh của tập này? OCR gốc vẫn được giữ.')) return;
    try {
      await apiClient.cleanTranslation(activeProject.project_id);
      onRefreshCues?.();
      onRefreshProject?.();
      appLogger.success('Đã clean toàn bộ bản dịch của tập', 'Dịch thuật');
    } catch (err: any) {
      appLogger.error(`Clean dịch tổng thất bại: ${err?.message || 'Thất bại'}`, 'Dịch thuật');
    }
  };

  const handleCleanAllVoice = async () => {
    if (!activeProject || !window.confirm('Xóa toàn bộ voice lồng tiếng của tập này? Bản dịch vẫn được giữ.')) return;
    try {
      await apiClient.cleanVoiceover(activeProject.project_id);
      onRefreshProject?.();
      appLogger.success('Đã clean toàn bộ voice của tập', 'Lồng tiếng');
    } catch (err: any) {
      appLogger.error(`Clean voice tổng thất bại: ${err?.message || 'Thất bại'}`, 'Lồng tiếng');
    }
  };

  const handleDubAllVideo = async () => {
    if (!activeProject) return;
    setIsDubbingAll(true);
    setDubAllMsg('Đang tạo thuyết minh lồng tiếng toàn bộ video...');
    try {
      const prov = detectVoiceProvider(dubbingMode === 'single' ? selectedVoice : selectedMaleVoice);
      const rateStr = dubbingSpeed === 1.0 ? '+0%' : (dubbingSpeed > 1 ? `+${Math.round((dubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - dubbingSpeed) * 100)}%`);
      const res = await apiClient.runDubbing(activeProject.project_id, {
        mode: dubbingMode,
        voice: selectedVoice,
        voice_male: selectedMaleVoice,
        voice_female: selectedFemaleVoice,
        provider: prov,
        rate: rateStr,
      });
      setDubAllMsg('✓ Lồng tiếng toàn video hoàn tất! Đã đồng bộ với Timeline.');
      if (onUpdateActiveProject) {
        onUpdateActiveProject({
          has_voiceover: true,
          voiceover_path: res.audio_url,
        });
      }
      if (onRefreshProject) onRefreshProject();
      if (onRefreshCues) onRefreshCues();
    } catch (err: any) {
      setDubAllMsg(`Lỗi: ${err?.message || 'Thất bại'}`);
    } finally {
      setIsDubbingAll(false);
      setTimeout(() => setDubAllMsg(null), 5000);
    }
  };

  const handleDubbingModeChange = async (mode: 'single' | 'multi') => {
    setDubbingMode(mode);
    try {
      const current = await apiClient.getPipelineSettings();
      if (current) {
        const updated = {
          ...current,
          dubbing: {
            ...current.dubbing,
            mode,
          },
          batch: {
            ...(current.batch || {}),
            dubbing_mode: mode === 'multi' ? ('gender_multi' as const) : ('single' as const),
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
      console.warn('Lỗi lưu chế độ lồng tiếng:', err);
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
            provider: detectVoiceProvider(newVoice) as any,
          },
          batch: {
            ...(current.batch || {}),
            dubbing_voice: newVoice,
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

  const handleMaleVoiceChange = async (newMaleVoice: string) => {
    setSelectedMaleVoice(newMaleVoice);
    try {
      const current = await apiClient.getPipelineSettings();
      if (current) {
        const updated = {
          ...current,
          dubbing: {
            ...current.dubbing,
            voice_male: newMaleVoice,
          },
          batch: {
            ...(current.batch || {}),
            dubbing_voice_male: newMaleVoice,
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
      console.warn('Lỗi lưu giọng nam sang backend:', err);
    }
  };

  const handleFemaleVoiceChange = async (newFemaleVoice: string) => {
    setSelectedFemaleVoice(newFemaleVoice);
    try {
      const current = await apiClient.getPipelineSettings();
      if (current) {
        const updated = {
          ...current,
          dubbing: {
            ...current.dubbing,
            voice_female: newFemaleVoice,
          },
          batch: {
            ...(current.batch || {}),
            dubbing_voice_female: newFemaleVoice,
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
      console.warn('Lỗi lưu giọng nữ sang backend:', err);
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
    const style = (cue.style || {}) as Record<string, any>;
    setEditingSpokenText(String(style.spoken_text || ''));
    setEditingSpeaker(String(style.speaker || 'unknown'));
    setEditingSpeakerId(String(style.speaker_id || ''));
    setEditingSpeakerRole(String(style.speaker_role || 'main'));
  };

  const handleSaveEdit = (cue: SubtitleCueV1) => {
    if (onUpdateCue) {
      const nextStyle: Record<string, any> = { ...(cue.style || {}) };
      nextStyle.speaker = editingSpeaker || 'unknown';
      nextStyle.speaker_id = editingSpeakerId.trim();
      nextStyle.speaker_role = editingSpeakerRole || 'main';
      if (editingSpokenText.trim()) nextStyle.spoken_text = editingSpokenText.trim();
      else delete nextStyle.spoken_text;
      onUpdateCue({
        ...cue,
        translated_text: editingText,
        style: nextStyle,
        status: 'reviewed',
      });
    }
    setEditingCueId(null);
  };

  const handleCancelEdit = () => {
    setEditingCueId(null);
    setEditingText('');
    setEditingSpokenText('');
    setEditingSpeaker('unknown');
    setEditingSpeakerId('');
    setEditingSpeakerRole('main');
  };

  const patchCueStyle = (cue: SubtitleCueV1, patch: Record<string, any>) => {
    if (!onUpdateCue) return;
    const nextStyle: Record<string, any> = { ...(cue.style || {}), ...patch };
    Object.keys(patch).forEach((k) => {
      if (patch[k] === '' || patch[k] === null || patch[k] === undefined) delete nextStyle[k];
    });
    onUpdateCue({ ...cue, style: nextStyle, status: 'reviewed' });
  };

  const handleAdaptSpokenCue = async (cue: SubtitleCueV1, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activeProject) return;
    setAdaptingSpoken(true);
    try {
      await apiClient.adaptSpoken(activeProject.project_id, { cue_id: cue.cue_id, force: true });
      onRefreshCues?.();
      appLogger.success('Đã rút gọn lời đọc theo thời lượng cue', 'Lồng tiếng');
    } catch (err: any) {
      appLogger.error(`Rút gọn lời đọc thất bại: ${err?.message || 'error'}`, 'Lồng tiếng');
    } finally {
      setAdaptingSpoken(false);
    }
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

  // Thử giọng đọc mẫu - Đồng bộ hóa 100% trực tiếp vào Trình phát DOM
  const handleTestVoice = async (voiceToTest?: string) => {
    const targetVoice = voiceToTest || (dubbingMode === 'single' ? selectedVoice : selectedMaleVoice);
    setCurrentTestingVoice(targetVoice);
    setIsTestingVoice(true);
    setTestVoiceMsg(`Đang tạo âm thanh mẫu (${targetVoice})...`);

    if (testAudioRef.current) {
      testAudioRef.current.pause();
    }

    try {
      const prov = detectVoiceProvider(targetVoice);
      const rateStr = dubbingSpeed === 1.0 ? '+0%' : (dubbingSpeed > 1 ? `+${Math.round((dubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - dubbingSpeed) * 100)}%`);
      const blob = await apiClient.testDubbing({
        text: 'Xin chào, đây là giọng đọc thử nghiệm của Subtitle Localizer Studio.',
        voice: targetVoice,
        provider: prov,
        rate: rateStr,
      });

      if (testVoiceAudioUrl) {
        URL.revokeObjectURL(testVoiceAudioUrl);
      }

      const url = URL.createObjectURL(blob);
      setTestVoiceAudioUrl(url);
      setTestVoiceMsg(`▶ Đang phát giọng đọc mẫu (${targetVoice})...`);
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
    <aside
      style={width ? { width: `${width}px` } : undefined}
      className="w-88 xl:w-96 bg-slate-950 border-r border-slate-800/80 flex flex-col shrink-0 select-none z-20 min-h-0 overflow-hidden shadow-lg"
    >
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
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCleanAllTranslation}
                disabled={!activeProject || cues.length === 0}
                className="flex-1 px-2 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800 text-rose-200 text-[10px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                title="Clean tổng bản dịch và voice phát sinh, giữ OCR"
              >
                <Trash2 className="inline w-3 h-3 mr-1 text-rose-400" />Clean dịch tổng
              </button>
              <button
                type="button"
                onClick={handleCleanAllVoice}
                disabled={!activeProject}
                className="flex-1 px-2 py-1 rounded-lg bg-orange-950/50 hover:bg-orange-900/70 border border-orange-800 text-orange-200 text-[10px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                title="Clean tổng voice lồng tiếng, giữ bản dịch"
              >
                <Trash2 className="inline w-3 h-3 mr-1 text-orange-400" />Clean voice tổng
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
                        ref={splitTextareaRef}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="w-full bg-slate-950 border border-indigo-500 rounded-lg p-2 text-xs text-white focus:outline-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="grid grid-cols-3 gap-1.5">
                        <select
                          value={editingSpeaker}
                          onChange={(e) => setEditingSpeaker(e.target.value)}
                          className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200"
                          title="Giới tính nhân vật"
                        >
                          <option value="unknown">Giới tính?</option>
                          <option value="male">Nam</option>
                          <option value="female">Nữ</option>
                        </select>
                        <select
                          value={editingSpeakerRole}
                          onChange={(e) => setEditingSpeakerRole(e.target.value)}
                          className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200"
                          title="Vai trò"
                        >
                          <option value="main">Chính</option>
                          <option value="support">Phụ</option>
                          <option value="narrator">Dẫn chuyện</option>
                          <option value="crowd">Quần chúng</option>
                        </select>
                        <input
                          value={editingSpeakerId}
                          onChange={(e) => setEditingSpeakerId(e.target.value)}
                          placeholder="speaker_id"
                          className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200"
                          title="Mã nhân vật (cùng giới tính khác id = khác giọng)"
                        />
                      </div>
                      <textarea
                        value={editingSpokenText}
                        onChange={(e) => setEditingSpokenText(e.target.value)}
                        placeholder="spoken_text (lời đọc TTS; có thể ngắn hơn bản dịch)"
                        className="w-full bg-slate-950 border border-amber-700/60 rounded-lg p-2 text-[11px] text-amber-100 focus:outline-none"
                        rows={2}
                      />
                      <div className="flex items-center justify-end gap-1.5 ml-auto">
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

                  {/* Speaker / timing badges */}
                  <div className="flex flex-wrap items-center gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={String((cue.style as any)?.speaker || 'unknown')}
                      onChange={(e) => patchCueStyle(cue, { speaker: e.target.value })}
                      className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[9px] text-slate-200"
                      title="Giới tính"
                    >
                      <option value="unknown">?</option>
                      <option value="male">Nam</option>
                      <option value="female">Nữ</option>
                    </select>
                    <select
                      value={String((cue.style as any)?.speaker_role || 'main')}
                      onChange={(e) => patchCueStyle(cue, { speaker_role: e.target.value })}
                      className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[9px] text-slate-200"
                      title="Vai trò"
                    >
                      <option value="main">main</option>
                      <option value="support">support</option>
                      <option value="narrator">narrator</option>
                      <option value="crowd">crowd</option>
                    </select>
                    <input
                      defaultValue={String((cue.style as any)?.speaker_id || '')}
                      key={`sid-${cue.cue_id}-${String((cue.style as any)?.speaker_id || '')}`}
                      onBlur={(e) => patchCueStyle(cue, { speaker_id: e.target.value.trim() })}
                      placeholder="id"
                      className="w-16 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[9px] text-slate-200"
                      title="speaker_id"
                    />
                    <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[9px] text-slate-300 font-mono">
                      {(cue.style as any)?.speaker === 'female' ? 'Nữ' : (cue.style as any)?.speaker === 'male' ? 'Nam' : '?'}
                      {(cue.style as any)?.speaker_id ? ` · ${(cue.style as any).speaker_id}` : ''}
                      {(cue.style as any)?.speaker_role ? ` · ${(cue.style as any).speaker_role}` : ''}
                    </span>
                    {(cue.style as any)?.timing_warning ? (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${(cue.style as any)?.timing_warning === 'hard' ? 'bg-rose-950 text-rose-300 border-rose-700' : 'bg-amber-950 text-amber-300 border-amber-700'}`}>
                        {(cue.style as any)?.timing_warning === 'hard' ? 'Quá dài' : 'Đã rút gọn'}
                      </span>
                    ) : null}
                    {(cue.style as any)?.spoken_text ? (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-800 text-[9px] text-indigo-300">spoken_text</span>
                    ) : null}
                  </div>

                  {/* Thanh công cụ cho từng câu: Dịch lại AI, Lồng tiếng đơn, Nghe audio, Tách câu */}
                  <div className="flex items-center justify-between gap-1 pt-1.5 mt-1 border-t border-slate-800/80 flex-wrap">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => handleAdaptSpokenCue(cue, e)}
                        disabled={adaptingSpoken}
                        className="px-1.5 py-0.5 rounded bg-amber-950/50 hover:bg-amber-900/70 border border-amber-800 text-amber-200 text-[10px] flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                        title="Rút gọn spoken_text cho khớp thời lượng"
                      >
                        <Sparkles className={`w-2.5 h-2.5 ${adaptingSpoken ? 'animate-pulse' : ''}`} />
                        <span>Rút gọn</span>
                      </button>
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
                        onClick={(e) => handleCleanCueTranslation(cue, e)}
                        className="px-1.5 py-0.5 rounded bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800 text-rose-200 text-[10px] flex items-center gap-1 transition cursor-pointer"
                        title="Xóa bản dịch câu này, giữ nguyên OCR"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-rose-400" />
                        <span>Clean dịch</span>
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
                      <div className="relative flex items-center">
                        <select
                          value={perCueVoices[cue.cue_id] || selectedVoice}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            setPerCueVoices((prev) => ({ ...prev, [cue.cue_id]: e.target.value }));
                          }}
                          className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg px-2 py-1 pr-5 text-[10px] text-slate-200 appearance-none focus:outline-none focus:border-indigo-500 max-w-[105px] truncate cursor-pointer transition shadow-sm font-medium"
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
                          <option value="Fenrir">Fenrir</option>
                          <option value="Aoede">Aoede</option>
                        </select>
                        <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 pointer-events-none" />
                      </div>

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
                      <button
                        type="button"
                        onClick={(e) => handleCleanCueVoice(cue, e)}
                        className="px-1.5 py-0.5 rounded bg-orange-950/50 hover:bg-orange-900/70 border border-orange-800 text-orange-200 text-[10px] flex items-center gap-1 transition cursor-pointer"
                        title="Xóa voice câu này và voice master"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-orange-400" />
                        <span>Clean voice</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredCues.length === 0 && (
              isScanning ? (
                <div className="p-8 text-center flex flex-col items-center justify-center gap-3 text-slate-300 text-xs">
                  <div className="relative flex items-center justify-center">
                    <div className="w-12 h-12 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    {scanProgress !== null && scanProgress !== undefined && (
                      <span className="absolute font-mono font-bold text-xs text-cyan-400">
                        {Math.round(scanProgress)}%
                      </span>
                    )}
                  </div>
                  <div className="font-medium text-indigo-300">
                    {statusMessage || 'Đang thực thi tiến trình quét phụ đề...'}
                  </div>
                  {scanProgress !== null && scanProgress !== undefined && (
                    <div className="w-full max-w-xs bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(0, Math.min(100, scanProgress))}%` }}
                      />
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                    Hệ thống đang trích xuất frame, chạy OCR và tinh chỉnh ranh giới. Danh sách câu sẽ tự động xuất hiện khi hoàn thành.
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Chưa có câu phụ đề nào. Hãy bấm "Bắt Đầu Quét Sub" ở góc trên hoặc bảng phải để nhận diện.
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: LỒNG TIẾNG AI (VOICEOVER) ================= */}
      {activeTab === 'dubbing' && (
        <div className="flex-1 min-h-0 flex flex-col p-3 pb-28 space-y-4 overflow-y-auto text-xs">
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2.5">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Mic className="w-4 h-4 text-amber-400" />
              <span>Kho Giọng Đọc AI (Chuẩn Cài Đặt)</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Tự động khớp và tạo giọng đọc AI tiếng Việt theo đúng thiết lập toàn cục của hệ thống.
            </p>

            {/* Chế độ phân vai lồng tiếng */}
            <div className="space-y-1.5 pt-1">
              <label className="text-slate-400 text-[10px] block font-medium">Chế độ phân vai:</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleDubbingModeChange('single')}
                  className={`py-1.5 rounded-lg border text-center transition text-xs font-semibold cursor-pointer active:scale-95 ${
                    dubbingMode === 'single'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Đơn giọng (1 người)
                </button>
                <button
                  type="button"
                  onClick={() => handleDubbingModeChange('multi')}
                  className={`py-1.5 rounded-lg border text-center transition text-xs font-semibold cursor-pointer active:scale-95 ${
                    dubbingMode === 'multi'
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Đa giọng (Nam / Nữ)
                </button>
              </div>
            </div>

            {dubbingMode === 'single' && (
              <VoiceCatalogPicker
                selectedVoiceId={selectedVoice}
                onChange={handleVoiceChange}
                onPreview={(voiceId) => handleTestVoice(voiceId)}
                previewingVoiceId={isTestingVoice ? currentTestingVoice : undefined}
              />
            )}

            {dubbingMode === 'multi' && (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <label className="text-slate-400 text-[10px] block font-medium">Giọng Nam (Phân vai thoại nam):</label>
                  <VoiceCatalogPicker
                    selectedVoiceId={selectedMaleVoice}
                    onChange={handleMaleVoiceChange}
                    gender="Nam"
                    onPreview={(voiceId) => handleTestVoice(voiceId)}
                    previewingVoiceId={isTestingVoice ? currentTestingVoice : undefined}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400 text-[10px] block font-medium">Giọng Nữ (Phân vai thoại nữ):</label>
                  <VoiceCatalogPicker
                    selectedVoiceId={selectedFemaleVoice}
                    onChange={handleFemaleVoiceChange}
                    gender="Nữ"
                    onPreview={(voiceId) => handleTestVoice(voiceId)}
                    previewingVoiceId={isTestingVoice ? currentTestingVoice : undefined}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleTestVoice(selectedMaleVoice)}
                    disabled={isTestingVoice}
                    className="py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg font-semibold flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer text-[11px]"
                  >
                    <Volume2 className="w-3 h-3 text-cyan-400" />
                    <span>Thử Giọng Nam</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestVoice(selectedFemaleVoice)}
                    disabled={isTestingVoice}
                    className="py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg font-semibold flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer text-[11px]"
                  >
                    <Volume2 className="w-3 h-3 text-rose-400" />
                    <span>Thử Giọng Nữ</span>
                  </button>
                </div>
              </div>
            )}

            {/* Tốc Độ Đọc Giọng AI */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[11px]">
                <label className="text-slate-300 font-medium">Tốc độ đọc giọng AI:</label>
                <span className="font-mono text-amber-400 font-bold bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-[10px]">
                  {dubbingSpeed.toFixed(2)}x ({dubbingSpeed === 1.0 ? 'Chuẩn' : dubbingSpeed > 1 ? `+${Math.round((dubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - dubbingSpeed) * 100)}%`})
                </span>
              </div>
              <div className="rounded-lg border border-indigo-900/60 bg-indigo-950/30 px-2 py-1.5 text-[10px] leading-relaxed text-indigo-200">
                <strong>Chuẩn CapCut:</strong> tốc độ đọc càng cao thời lượng voice càng ngắn. Tự động gọt hư từ thừa khi câu dài để giữ trọn ý nghĩa và giọng nói tự nhiên, không làm méo/vỡ tiếng.
              </div>

              {/* Preset Tốc Độ Nhanh */}
              <div className="grid grid-cols-4 gap-1">
                {[
                  { val: 0.9, label: '0.9x' },
                  { val: 1.0, label: '1.0x Chuẩn' },
                  { val: 1.15, label: '1.15x Review' },
                  { val: 1.3, label: '1.3x Nhanh' },
                ].map((preset) => (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() => setDubbingSpeed(preset.val)}
                    className={`py-1 rounded text-[10px] font-semibold transition cursor-pointer active:scale-95 ${
                      Math.abs(dubbingSpeed - preset.val) < 0.01
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-400 border border-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Slider tùy biến */}
              <input
                type="range"
                min="0.8"
                max="1.5"
                step="0.05"
                value={dubbingSpeed}
                onChange={(e) => setDubbingSpeed(parseFloat(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
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
                  <span className="text-slate-400 truncate max-w-[150px]">
                    {currentTestingVoice || (dubbingMode === 'single' ? selectedVoice : `${selectedMaleVoice} / ${selectedFemaleVoice}`)}
                  </span>
                </div>
                <audio
                  ref={testAudioRef}
                  controls
                  autoPlay
                  src={testVoiceAudioUrl}
                  className="w-full h-8"
                  onPlay={() => {
                    const voiceName = currentTestingVoice || (dubbingMode === 'single' ? selectedVoice : selectedMaleVoice);
                    setTestVoiceMsg(`▶ Đang phát giọng đọc mẫu (${voiceName})...`);
                  }}
                  onPause={() => {
                    if (testAudioRef.current && !testAudioRef.current.ended) {
                      const voiceName = currentTestingVoice || (dubbingMode === 'single' ? selectedVoice : selectedMaleVoice);
                      setTestVoiceMsg(`⏸ Đã tạm dừng (${voiceName})`);
                    }
                  }}
                  onEnded={() => {
                    setTestVoiceMsg('✓ Đã phát xong giọng đọc mẫu');
                    setTimeout(() => setTestVoiceMsg(null), 3500);
                  }}
                  onError={() => {
                    setTestVoiceMsg('Lỗi phát âm thanh trên trình duyệt');
                  }}
                />
              </div>
            )}

            {/* Lồng tiếng toàn bộ video */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <button
                type="button"
                onClick={handleDubAllVideo}
                disabled={isDubbingAll || !activeProject || cues.length === 0}
                title={cues.length === 0 ? "Cần quét hoặc nhập phụ đề trước khi lồng tiếng" : `Lồng Tiếng Toàn Bộ Video (${cues.length} câu)`}
                className={`w-full py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold rounded-lg flex items-center justify-center gap-2 shadow-md transition active:scale-98 disabled:opacity-50 ${cues.length === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {isDubbingAll ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                    <span>Đang Lồng Tiếng Toàn Bộ Video...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-slate-950" />
                    <span>Lồng Tiếng Toàn Bộ Video ({cues.length} câu)</span>
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
                const isEditing = editingPreset?.id === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      if (!isEditing) onSelectPreset?.(preset);
                    }}
                    className={`p-3 rounded-xl border transition flex flex-col gap-1.5 relative group/card ${
                      isEditing
                        ? 'bg-slate-900/95 border-indigo-500 shadow-xl cursor-default'
                        : isCurrentPreset
                        ? 'bg-indigo-950/90 border-indigo-500 ring-1 ring-indigo-500/50 shadow-md cursor-pointer'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60 cursor-pointer'
                    }`}
                  >
                    {isEditing && editingPreset ? (
                      <div className="space-y-2.5 p-1 text-xs" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                          <span className="text-[11px] font-bold text-indigo-300 flex items-center gap-1.5">
                            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                            Chỉnh Sửa Sâu Cấu Hình Preset
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingPreset(null)}
                            className="p-1 text-slate-400 hover:text-white"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* 1. Tên Preset */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-medium block">Tên Preset:</label>
                          <input
                            type="text"
                            value={editingPreset.name}
                            onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-indigo-400"
                            placeholder="Tên chuẩn cấu hình..."
                          />
                        </div>

                        {/* 2. Tỉ lệ khung hình & Khớp khung hình */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium block">Tỉ lệ khung hình:</label>
                            <div className="relative flex items-center">
                              <select
                                value={editingPreset.aspect_ratio}
                                onChange={(e) => setEditingPreset({ ...editingPreset, aspect_ratio: e.target.value as any })}
                                className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg p-1.5 pr-7 text-[11px] text-slate-200 appearance-none focus:outline-none focus:border-indigo-400 transition cursor-pointer"
                              >
                                <option value="9:16">9:16 (Dọc TikTok/Reels)</option>
                                <option value="16:9">16:9 (Ngang YouTube)</option>
                                <option value="1:1">1:1 (Vuông Facebook)</option>
                                <option value="2.35:1">2.35:1 (Điện ảnh)</option>
                                <option value="4:3">4:3 (Truyền hình)</option>
                                <option value="original">Gốc (Original)</option>
                              </select>
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400 font-medium block">Khớp khung hình:</label>
                            <div className="relative flex items-center">
                              <select
                                value={editingPreset.fit_mode || 'contain'}
                                onChange={(e) => setEditingPreset({ ...editingPreset, fit_mode: e.target.value as any })}
                                className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg p-1.5 pr-7 text-[11px] text-slate-200 appearance-none focus:outline-none focus:border-indigo-400 transition cursor-pointer"
                              >
                                <option value="contain">Contain (Giữ trọn)</option>
                                <option value="cover">Cover (Lấp đầy)</option>
                              </select>
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                            </div>
                          </div>
                        </div>

                        {/* 3. Kiểu che mờ & Độ mờ */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-medium block">Kiểu che mờ Sub gốc:</label>
                          <div className="relative flex items-center">
                            <select
                              value={editingPreset.mask_style}
                              onChange={(e) => setEditingPreset({ ...editingPreset, mask_style: e.target.value as any })}
                              className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg p-1.5 pr-7 text-[11px] text-slate-200 appearance-none focus:outline-none focus:border-indigo-400 transition cursor-pointer"
                            >
                              <option value="blur">Mờ hòa tan tự nhiên (blur)</option>
                              <option value="feather_tight">Mờ bám sát dòng chữ (feather_tight)</option>
                              <option value="optical_blend">Hòa tan quang học (optical_blend)</option>
                              <option value="soft_cinema">Gradient điện ảnh mềm (soft_cinema)</option>
                              <option value="glass">Kính mờ trong suốt (glass)</option>
                              <option value="ambient">Gradient đáy êm dịu (ambient)</option>
                              <option value="feather">Viền lông mềm (feather)</option>
                              <option value="mosaic">Khảm Mosaic (mosaic)</option>
                              <option value="box">Hộp đen Cinema (box)</option>
                            </select>
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
                          </div>
                        </div>

                        {/* Thanh trượt Độ mờ Blur */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>Độ mạnh mờ:</span>
                            <span className="text-amber-400 font-mono font-bold">{editingPreset.blur_strength ?? 20}px</span>
                          </div>
                          <input
                            type="range"
                            min="4"
                            max="50"
                            step="2"
                            value={editingPreset.blur_strength ?? 20}
                            onChange={(e) => setEditingPreset({ ...editingPreset, blur_strength: parseInt(e.target.value, 10) })}
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                          />
                        </div>

                        {/* 4. Vị trí phụ đề dịch */}
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-medium block">Vị trí hiển thị Sub dịch:</label>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingPreset({ ...editingPreset, subtitle_placement: 'roi' })}
                              className={`py-1 px-2 rounded-lg text-[10px] font-semibold border transition cursor-pointer ${
                                (editingPreset.subtitle_placement || 'roi') === 'roi'
                                  ? 'bg-indigo-600 border-indigo-400 text-white'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                              }`}
                            >
                              Theo vùng quét (ROI)
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingPreset({ ...editingPreset, subtitle_placement: 'bottom' })}
                              className={`py-1 px-2 rounded-lg text-[10px] font-semibold border transition cursor-pointer ${
                                editingPreset.subtitle_placement === 'bottom'
                                  ? 'bg-indigo-600 border-indigo-400 text-white'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                              }`}
                            >
                              Cố định đáy (Bottom)
                            </button>
                          </div>
                        </div>

                        {/* 5. Lật ngang Mirror */}
                        <label className="flex items-center gap-2 p-1.5 bg-slate-950/60 rounded-lg border border-slate-800/80 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(editingPreset.is_flipped_h)}
                            onChange={(e) => setEditingPreset({ ...editingPreset, is_flipped_h: e.target.checked })}
                            className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-[10px] text-slate-300 font-medium">Lật ngang khung hình (Mirror chống bản quyền)</span>
                        </label>

                        {/* 6. Vùng tọa độ ROI */}
                        <div className="space-y-1.5 p-2 bg-slate-950 rounded-lg border border-slate-800">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-400 font-medium">Tọa độ Vùng quét ROI:</span>
                            {currentRoi && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPreset({
                                    ...editingPreset,
                                    roi: {
                                      x: currentRoi.x,
                                      y: currentRoi.y,
                                      width: currentRoi.width,
                                      height: currentRoi.height,
                                    },
                                  });
                                }}
                                className="text-cyan-400 hover:text-cyan-300 font-semibold underline text-[9px] cursor-pointer"
                                title="Gán tọa độ vùng quét đang chọn trên màn hình vào Preset này"
                              >
                                📍 Lấy ROI hiện tại
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-1 text-[10px]">
                            <div>
                              <span className="text-slate-500 text-[9px] block">X (%):</span>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                max="100"
                                value={Math.round((editingPreset.roi?.x ?? 0.08) * 100)}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) / 100;
                                  setEditingPreset({ ...editingPreset, roi: { ...(editingPreset.roi || { x: 0, y: 0, width: 1, height: 1 }), x: val } });
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200 text-center text-[10px]"
                              />
                            </div>
                            <div>
                              <span className="text-slate-500 text-[9px] block">Y (%):</span>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                max="100"
                                value={Math.round((editingPreset.roi?.y ?? 0.78) * 100)}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) / 100;
                                  setEditingPreset({ ...editingPreset, roi: { ...(editingPreset.roi || { x: 0, y: 0, width: 1, height: 1 }), y: val } });
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200 text-center text-[10px]"
                              />
                            </div>
                            <div>
                              <span className="text-slate-500 text-[9px] block">Rộng (%):</span>
                              <input
                                type="number"
                                step="1"
                                min="5"
                                max="100"
                                value={Math.round((editingPreset.roi?.width ?? 0.84) * 100)}
                                onChange={(e) => {
                                  const val = Math.max(0.05, Math.min(1, parseFloat(e.target.value) || 0.1)) / 100;
                                  setEditingPreset({ ...editingPreset, roi: { ...(editingPreset.roi || { x: 0, y: 0, width: 1, height: 1 }), width: val } });
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200 text-center text-[10px]"
                              />
                            </div>
                            <div>
                              <span className="text-slate-500 text-[9px] block">Cao (%):</span>
                              <input
                                type="number"
                                step="1"
                                min="3"
                                max="100"
                                value={Math.round((editingPreset.roi?.height ?? 0.18) * 100)}
                                onChange={(e) => {
                                  const val = Math.max(0.02, Math.min(1, parseFloat(e.target.value) || 0.05)) / 100;
                                  setEditingPreset({ ...editingPreset, roi: { ...(editingPreset.roi || { x: 0, y: 0, width: 1, height: 1 }), height: val } });
                                }}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200 text-center text-[10px]"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Nút Hủy & Lưu */}
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
                          <button
                            type="button"
                            onClick={() => setEditingPreset(null)}
                            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition cursor-pointer"
                          >
                            Hủy
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdatePreset && editingPreset) {
                                onUpdatePreset(editingPreset);
                              }
                              setEditingPreset(null);
                            }}
                            className="px-3.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] flex items-center gap-1 shadow transition cursor-pointer"
                          >
                            <Save className="w-3 h-3" />
                            <span>Lưu Cấu Hình</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-200 text-xs flex items-center gap-1.5 min-w-0 flex-1">
                          <Sparkles className={`w-3.5 h-3.5 shrink-0 ${isCurrentPreset ? 'text-amber-400' : 'text-indigo-400'}`} />
                          <span className="truncate" title={preset.name}>{preset.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isCurrentPreset ? (
                            <span className="px-2 py-0.5 rounded-full bg-indigo-500/25 text-indigo-300 border border-indigo-500/50 text-[10px] font-bold whitespace-nowrap shrink-0 flex items-center gap-1 shadow-sm">
                              <span>✓</span>
                              <span>Đang chọn</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 group-hover/card:text-indigo-300 transition whitespace-nowrap shrink-0 font-medium">
                              Áp dụng
                            </span>
                          )}

                          {/* Phím sửa & xóa Preset */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingPreset({ ...preset, roi: { ...preset.roi } });
                            }}
                            className="opacity-0 group-hover/card:opacity-100 p-1 hover:text-white text-slate-400 transition cursor-pointer"
                            title="Chỉnh sửa sâu cấu hình preset"
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
                              className="opacity-0 group-hover/card:opacity-100 p-1 hover:text-rose-400 text-slate-400 transition cursor-pointer"
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
