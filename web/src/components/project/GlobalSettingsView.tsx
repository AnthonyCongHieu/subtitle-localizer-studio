import React, { useState, useEffect, useRef } from 'react';
import {
  apiClient,
  GlobalPipelineSettings,
  HardwareInfoResponse,
  TestTranslationResult,
  GeminiPoolStatus,
} from '../../api/client';
import {
  PresetProfile,
  exportPresetsAsJson,
  parsePresetsJson,
  BUILTIN_PRESETS,
} from '../../types/presets';
import {
  Sliders,
  FileText,
  Languages,
  Mic,
  Cpu,
  Sparkles,
  Save,
  Play,
  Volume2,
  RefreshCw,
  Download,
  Upload,
  Plus,
  Trash2,
  Edit2,
  Star,
  RotateCcw,
  CheckCircle2,
  Key,
  Zap,
  ChevronLeft,
  LayoutDashboard,
  Layers,
  Search,
  Check,
  Copy,
} from 'lucide-react';

interface GlobalSettingsViewProps {
  presets: PresetProfile[];
  onSavePresets: (presets: PresetProfile[]) => void;
  onSelectPreset?: (preset: PresetProfile) => void;
  onSwitchToDashboard: () => void;
  onSwitchToStudio?: () => void;
  onOpenKeyPool?: () => void;
  initialTab?: 'ocr' | 'translation' | 'dubbing' | 'render';
}

export const GlobalSettingsView: React.FC<GlobalSettingsViewProps> = ({
  presets,
  onSavePresets,
  onSelectPreset,
  onSwitchToDashboard,
  onSwitchToStudio,
  onOpenKeyPool,
  initialTab = 'ocr',
}) => {
  const [activeTab, setActiveTab] = useState<'ocr' | 'translation' | 'dubbing' | 'render'>(initialTab);

  // Settings state
  const [settings, setSettings] = useState<GlobalPipelineSettings>({
    ocr: {
      mode: 'local',
      local_engine: 'rapidocr',
      api_provider: 'gemini',
      capcut_api_endpoint: 'https://edit-api-sg.capcut.com',
      capcut_session_token: '',
      method: 'ocr',
      engine: 'rapidocr',
      default_source_lang: 'auto',
      sample_fps: 2.0,
      diff_threshold: 3.5,
      enable_gap_rescue: true,
      enable_roi_tightening: true,
      whisper_model: 'medium',
      whisper_device: 'cuda',
      whisper_compute_type: 'float16',
      whisper_vad_filter: true,
      vlm_provider: 'gemini',
      vlm_prompt_style: 'accurate_dialogue',
      demux_fallback_to_ocr: true,
      demux_stream_lang: 'auto',
    },
    translation: {
      provider: 'gemini',
      target_language: 'vi',
      gemini_model: 'gemini-2.5-flash',
      batch_size: 35,
      prompt_tone: 'dramatic',
      use_glossary: true,
    },
    dubbing: {
      voice: 'vi-VN-NamMinhNeural',
      rate: '+0%',
      pitch: '+0Hz',
      ducking_volume: 0.25,
    },
    render: {
      ffmpeg_encoder: 'auto',
      default_mask_style: 'feather_tight',
      default_blur_strength: 24,
      burn_subtitles: true,
    },
  });

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Live Test Translation State
  const [testText, setTestText] = useState('打车五分钟到，车都在来的路上了');
  const [testTransResult, setTestTransResult] = useState<TestTranslationResult | null>(null);
  const [isTranslatingTest, setIsTranslatingTest] = useState(false);

  // Live Test Dubbing State
  const [testDubbingText, setTestDubbingText] = useState('Xin chào, đây là giọng đọc thử nghiệm của Subtitle Localizer Studio.');
  const [isDubbingTest, setIsDubbingTest] = useState(false);

  // Hardware Info State
  const [hardwareInfo, setHardwareInfo] = useState<HardwareInfoResponse | null>(null);
  const [isLoadingHardware, setIsLoadingHardware] = useState(false);

  // Preset Editor State
  const [editingPreset, setEditingPreset] = useState<PresetProfile | null>(null);
  const [isCreatingNewPreset, setIsCreatingNewPreset] = useState(false);
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gemini Key Pool State (Tích hợp quản lý Keys ngay trong Tab Thiết Lập)
  const [geminiPoolStatus, setGeminiPoolStatus] = useState<GeminiPoolStatus | null>(null);
  const [poolInputKeys, setPoolInputKeys] = useState<string>('');
  const [isVerifyingPool, setIsVerifyingPool] = useState(false);
  const [isSavingPoolKeys, setIsSavingPoolKeys] = useState(false);
  const [poolKeyFilter, setPoolKeyFilter] = useState<'all' | 'usable' | 'cooldown'>('all');
  const [poolSearchQuery, setPoolSearchQuery] = useState('');
  const [copiedKeyIndex, setCopiedKeyIndex] = useState<number | null>(null);
  const [activePoolSubTab, setActivePoolSubTab] = useState<'list' | 'input'>('list');

  // CapCut Cloud Connection Test State
  const [isTestingCapCut, setIsTestingCapCut] = useState(false);
  const [capcutTestResult, setCapcutTestResult] = useState<{
    ok: boolean;
    endpoint: string;
    latency_ms: number;
    message: string;
    status_code?: number;
    has_token?: boolean;
  } | null>(null);

  const handleTestCapCutConnection = async () => {
    setIsTestingCapCut(true);
    setCapcutTestResult(null);
    try {
      const res = await apiClient.testCapCutConnection({
        endpoint: settings.ocr.capcut_api_endpoint || 'https://edit-api-sg.capcut.com',
        session_token: settings.ocr.capcut_session_token || '',
      });
      setCapcutTestResult(res);
    } catch (err: any) {
      setCapcutTestResult({
        ok: false,
        endpoint: settings.ocr.capcut_api_endpoint || 'https://edit-api-sg.capcut.com',
        latency_ms: 0,
        message: `Lỗi kết nối máy chủ CapCut: ${err?.message || 'Không phản hồi'}`,
      });
    } finally {
      setIsTestingCapCut(false);
    }
  };

  useEffect(() => {
    loadPipelineSettings();
    loadHardwareInfo();
    loadGeminiPool();
  }, []);

  const loadGeminiPool = async () => {
    try {
      const res = await apiClient.getGeminiPoolStatus();
      setGeminiPoolStatus(res);
    } catch (err) {
      console.warn('Could not load Gemini Pool status:', err);
    }
  };

  const handleSavePoolKeys = async () => {
    const lines = poolInputKeys
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k.length > 5);
    if (lines.length === 0) return;
    setIsSavingPoolKeys(true);
    try {
      const res = await apiClient.saveGeminiPool(lines);
      setGeminiPoolStatus(res.pool_status);
      setPoolInputKeys('');
      setActivePoolSubTab('list');
    } catch (err: any) {
      alert(`Lỗi khi lưu keys: ${err.message}`);
    } finally {
      setIsSavingPoolKeys(false);
    }
  };

  const handleVerifyAllKeys = async () => {
    setIsVerifyingPool(true);
    try {
      const res = await apiClient.verifyGeminiKeys();
      setGeminiPoolStatus(res.pool_status);
    } catch (err: any) {
      alert(`Lỗi khi kiểm tra keys: ${err.message}`);
    } finally {
      setIsVerifyingPool(false);
    }
  };

  const handleDeleteSingleKey = async (idx: number) => {
    if (!confirm('Bạn có chắc muốn xoá API Key này khỏi Pool?')) return;
    try {
      const res = await apiClient.deleteGeminiKey(idx);
      setGeminiPoolStatus(res.pool_status);
    } catch (err: any) {
      alert(`Lỗi khi xoá key: ${err.message}`);
    }
  };

  const loadPipelineSettings = async () => {
    try {
      const res = await apiClient.getPipelineSettings();
      setSettings(res);
    } catch (err: any) {
      console.warn('Could not load pipeline settings from server, using local fallback:', err);
    }
  };

  const loadHardwareInfo = async () => {
    setIsLoadingHardware(true);
    try {
      const res = await apiClient.getHardwareInfo();
      setHardwareInfo(res);
    } catch (err) {
      console.warn('Could not check hardware:', err);
    } finally {
      setIsLoadingHardware(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSaveSuccessMessage(null);
    try {
      await apiClient.savePipelineSettings(settings);
      setSaveSuccessMessage('Đã lưu cấu hình Pipeline toàn cục thành công!');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } catch (err: any) {
      alert(`Lỗi khi lưu cấu hình: ${err?.message || 'Không thể lưu'}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Run live test translation
  const handleTestTranslation = async () => {
    if (!testText.trim()) return;
    setIsTranslatingTest(true);
    setTestTransResult(null);
    try {
      const res = await apiClient.testTranslation({
        text: testText.trim(),
        source_lang: 'zh',
        target_lang: 'vi',
        provider: settings.translation.provider,
        gemini_model: settings.translation.gemini_model,
        prompt_tone: settings.translation.prompt_tone,
        use_glossary: settings.translation.use_glossary,
      });
      setTestTransResult(res);
    } catch (err: any) {
      setTestTransResult({
        original: testText,
        translated: `[Lỗi: ${err?.message || 'Không thể dịch'}]`,
        provider_used: settings.translation.provider,
        latency_ms: 0,
      });
    } finally {
      setIsTranslatingTest(false);
    }
  };

  // Run live test TTS
  const handleTestDubbing = async () => {
    if (!testDubbingText.trim()) return;
    setIsDubbingTest(true);
    try {
      const blob = await apiClient.testDubbing({
        text: testDubbingText.trim(),
        voice: settings.dubbing.voice,
        rate: settings.dubbing.rate,
        pitch: settings.dubbing.pitch,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (err: any) {
      alert(`Không thể tạo giọng đọc thử nghiệm: ${err?.message}`);
    } finally {
      setIsDubbingTest(false);
    }
  };

  // Preset operations
  const handleStartCreatePreset = () => {
    setIsCreatingNewPreset(true);
    setEditingPreset({
      id: `preset-${Date.now()}`,
      name: 'Chuẩn Cấu Hình Mới',
      is_default: false,
      source_lang: 'zh',
      target_lang: 'vi',
      mask_style: 'blur',
      is_flipped_h: false,
      is_flipped_v: false,
      show_subtitle_overlay: true,
      zoom_level: 'fit',
      aspect_ratio: '16:9',
      fit_mode: 'contain',
      roi: {
        x: 0.08,
        y: 0.82,
        width: 0.84,
        height: 0.13,
      },
    });
  };

  const handleStartEditPreset = (p: PresetProfile) => {
    setIsCreatingNewPreset(false);
    setEditingPreset({ ...p });
  };

  const handleSavePresetEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPreset) return;
    if (!editingPreset.name.trim()) {
      setPresetMessage('Vui lòng nhập tên cho chuẩn cấu hình');
      return;
    }

    let nextPresets: PresetProfile[];
    if (isCreatingNewPreset) {
      nextPresets = [...presets, editingPreset];
      setPresetMessage(`Đã tạo chuẩn mới: "${editingPreset.name}"`);
    } else {
      nextPresets = presets.map((p) => (p.id === editingPreset.id ? editingPreset : p));
      setPresetMessage(`Đã cập nhật chuẩn: "${editingPreset.name}"`);
    }

    onSavePresets(nextPresets);
    setEditingPreset(null);
    setIsCreatingNewPreset(false);
  };

  const handleDeletePreset = (id: string, name: string) => {
    if (presets.length <= 1) {
      setPresetMessage('Cần giữ lại ít nhất 1 chuẩn mặc định.');
      return;
    }
    if (confirm(`Bạn có chắc muốn xóa chuẩn "${name}"?`)) {
      const next = presets.filter((p) => p.id !== id);
      if (!next.some((p) => p.is_default) && next.length > 0) {
        next[0].is_default = true;
      }
      onSavePresets(next);
      if (editingPreset?.id === id) setEditingPreset(null);
      setPresetMessage(`Đã xóa chuẩn: "${name}"`);
    }
  };

  const handleSetDefaultPreset = (id: string) => {
    const next = presets.map((p) => ({
      ...p,
      is_default: p.id === id,
    }));
    onSavePresets(next);
    setPresetMessage('Đã cập nhật chuẩn mặc định!');
  };

  const handleImportPresetFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parsePresetsJson(text);
      if (parsed.length === 0) {
        setPresetMessage('File JSON không chứa chuẩn nào hợp lệ.');
        return;
      }
      const existingIds = new Set(presets.map((p) => p.id));
      const cleanNew = parsed.map((p) => ({
        ...p,
        id: existingIds.has(p.id) ? `preset-${Date.now()}-${Math.random().toString(36).substring(2, 6)}` : p.id,
      }));
      const merged = [...presets, ...cleanNew];
      onSavePresets(merged);
      setPresetMessage(`Đã nhập thành công ${cleanNew.length} chuẩn từ file JSON!`);
    } catch (err: any) {
      setPresetMessage(`Lỗi nhập file: ${err?.message || 'File JSON không hợp lệ'}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleResetPresetsToBuiltin = () => {
    if (confirm('Khôi phục toàn bộ danh sách về 4 chuẩn mặc định gốc của Studio?')) {
      onSavePresets(BUILTIN_PRESETS);
      setEditingPreset(null);
      setPresetMessage('Đã khôi phục các chuẩn gốc thành công!');
    }
  };

  return (
    <div className="flex-1 w-full h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* 1. Header Bar Chuyên Nghiệp */}
      <header className="h-12 shrink-0 bg-slate-900/95 border-b border-slate-800 px-4 flex items-center justify-between z-40 backdrop-blur">
        {/* Cụm Trái: Nút Quay Lại Dashboard & Logo */}
        <div className="flex items-center gap-4">
          <button
            onClick={onSwitchToDashboard}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-xs font-semibold shadow transition active:scale-95 cursor-pointer"
            title="Quay lại Màn hình Dashboard Batch"
          >
            <ChevronLeft className="w-4 h-4" />
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          {onSwitchToStudio && (
            <button
              onClick={onSwitchToStudio}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold shadow transition active:scale-95 cursor-pointer"
              title="Chuyển sang Studio biên tập"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Studio</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
            <div className="p-1 bg-indigo-600 rounded text-white shadow">
              <Sliders className="w-3.5 h-3.5" />
            </div>
            <span>Thiết Lập Hệ Thống & Cấu Hình Pipeline</span>
          </div>

          <span className="hidden md:flex px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-600/40 text-emerald-300 text-[10px] font-semibold items-center gap-1">
            <Zap className="w-3 h-3 text-emerald-400" />
            <span>Cấu Hình Toàn Cục (Global Defaults)</span>
          </span>
        </div>

        {/* Cụm Phải: Nút Lưu & Quản Lý Keys */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              if (onOpenKeyPool) {
                onOpenKeyPool();
              } else {
                setActiveTab('translation');
              }
            }}
            className="px-3 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 hover:border-amber-500/50 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            title="Quản lý Gemini Key Pool"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">
              Keys Pool ({geminiPoolStatus ? `${geminiPoolStatus.active_keys}/${geminiPoolStatus.total_keys}` : '...'})
            </span>
          </button>

          <button
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1.5 shadow transition disabled:opacity-50 cursor-pointer"
            title="Lưu cấu hình toàn cục vào hệ thống"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSavingSettings ? 'Đang lưu...' : 'Lưu Cấu Hình'}</span>
          </button>
        </div>
      </header>

      {saveSuccessMessage && (
        <div className="px-6 py-2 bg-emerald-950/90 border-b border-emerald-700/60 text-emerald-300 text-xs flex items-center justify-between animate-in fade-in">
          <span className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{saveSuccessMessage}</span>
          </span>
          <button onClick={() => setSaveSuccessMessage(null)} className="text-emerald-400 hover:text-white font-bold">✕</button>
        </div>
      )}

      {/* 2. Thân Trang Tab Riêng (Full View Layout) */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-800 overflow-hidden">
        {/* Sidebar Trái (Chọn 4 Tab & Thẻ Phần Cứng) */}
        <div className="w-full md:w-64 shrink-0 bg-slate-900/60 p-4 space-y-2 overflow-y-auto flex flex-col justify-between">
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 mb-2">
              Danh Mục Cấu Hình
            </div>

            <button
              onClick={() => setActiveTab('ocr')}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'ocr'
                  ? 'bg-indigo-600/25 text-indigo-300 border border-indigo-500/50 shadow-md ring-1 ring-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${activeTab === 'ocr' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <FileText className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div>1. Trích Xuất Phụ Đề</div>
                <div className="text-[10px] font-normal text-slate-500 truncate max-w-[120px]">
                  {settings.ocr.method === 'asr_whisper'
                    ? 'Whisper ASR (Âm thanh)'
                    : settings.ocr.method === 'vlm_gemini'
                    ? 'Gemini VLM (AI Vision)'
                    : settings.ocr.method === 'demux_stream'
                    ? 'FFmpeg Demux (Có sẵn)'
                    : 'RapidOCR / Paddle (Hình)'}
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('translation')}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'translation'
                  ? 'bg-amber-600/25 text-amber-300 border border-amber-500/50 shadow-md ring-1 ring-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${activeTab === 'translation' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <Languages className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div>2. Dịch Thuật AI</div>
                <div className="text-[10px] font-normal text-slate-500">Gemini Pool / Văn phong</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('dubbing')}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'dubbing'
                  ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${activeTab === 'dubbing' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <Mic className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div>3. Giọng Đọc TTS</div>
                <div className="text-[10px] font-normal text-slate-500">Edge-TTS / Dìm nhạc nền</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('render')}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'render'
                  ? 'bg-purple-600/25 text-purple-300 border border-purple-500/50 shadow-md ring-1 ring-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${activeTab === 'render' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <Cpu className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div>4. Render & Presets</div>
                <div className="text-[10px] font-normal text-slate-500">GPU NVENC / Chuẩn mẫu</div>
              </div>
            </button>
          </div>

          {/* Thẻ Phần Cứng & GPU ở Chân Sidebar */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-[11px] font-mono">
            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1.5 text-[10px]">
              <span className="uppercase font-bold text-slate-500">Tài Nguyên Máy</span>
              <span className="text-emerald-400 font-bold">READY</span>
            </div>
            <div className="text-slate-300 truncate" title={hardwareInfo?.gpu.name}>
              🎮 {hardwareInfo?.gpu.has_gpu ? hardwareInfo.gpu.name.replace('NVIDIA GeForce ', '') : 'CPU Graphics'}
            </div>
            <div className="text-slate-400">
              ⚡ {hardwareInfo?.ffmpeg.has_nvenc ? 'NVENC: Có hỗ trợ' : 'libx264: CPU'}
            </div>
            <div className="text-cyan-400">
              🧠 {hardwareInfo?.cpu.cores || 4} CPU Cores / Threads
            </div>
          </div>
        </div>

        {/* Nội Dung Chi Tiết (Khung Giữa Rộng Rãi) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 lg:p-8 space-y-6 max-w-5xl">
          {/* ================= TAB 1: 2 MASTER MODES (LOCAL VS API) ================= */}
          {activeTab === 'ocr' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-400" />
                  <span>1. Cấu Hình Động Cơ Trích Xuất Phụ Đề (Subtitle Extraction Engine)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Phân chia 2 Mode kiến trúc độc lập: <strong>Mode Local</strong> (100% chạy cục bộ trên GPU NVIDIA RTX 3050 & CPU Cores) và <strong>Mode API</strong> (Đám mây AI Big Tech: Google Gemini hoặc ByteDance CapCut).
                </p>
              </div>

              {/* BỘ CHỌN 2 MASTER MODE: LOCAL VS API */}
              <div>
                <label className="text-xs font-bold text-slate-200 block mb-2.5">
                  Chọn Chế Độ Trích Xuất Phụ Đề (Master Mode):
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* MASTER MODE 1: CHẠY CỤC BỘ (MODE LOCAL) */}
                  <div
                    onClick={() => {
                      const curEngine = settings.ocr.local_engine || 'rapidocr';
                      setSettings({
                        ...settings,
                        ocr: {
                          ...settings.ocr,
                          mode: 'local',
                          local_engine: curEngine,
                          method: curEngine === 'whisper' ? 'asr_whisper' : curEngine === 'demux' ? 'demux_stream' : 'ocr',
                        },
                      });
                    }}
                    className={`p-5 rounded-2xl border cursor-pointer transition flex flex-col justify-between gap-3 ${
                      (settings.ocr.mode === 'local' || !settings.ocr.mode)
                        ? 'bg-gradient-to-br from-indigo-950/80 via-slate-900 to-indigo-950/40 border-indigo-500 text-white ring-2 ring-indigo-500/50 shadow-xl'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xl">🖥️</span>
                          <div>
                            <span className="font-black text-sm text-white tracking-wide">MODE LOCAL</span>
                            <span className="block text-[10px] text-indigo-300 font-mono">Chạy Cục Bộ (Tối Đa Phần Cứng)</span>
                          </div>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-indigo-950 border border-indigo-500/60 text-indigo-300 text-[10px] font-mono font-bold">
                          100% Offline • 0đ
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Khai thác tối đa phần cứng máy bạn (<strong>NVIDIA GeForce RTX 3050 Laptop GPU + 16 CPU Cores</strong>). Tốc độ cao nhất (~140 FPS), bảo mật 100% không upload video lên mạng, không tốn chi phí API.
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-indigo-300 bg-indigo-950/60 px-3 py-1.5 rounded-lg border border-indigo-800/40">
                      <span>✓ RapidOCR ONNX CUDA</span>
                      <span>•</span>
                      <span>✓ Faster-Whisper</span>
                      <span>•</span>
                      <span>✓ FFmpeg Demux</span>
                    </div>
                  </div>

                  {/* MASTER MODE 2: ĐÁM MÂY (MODE API) */}
                  <div
                    onClick={() => {
                      const curProv = settings.ocr.api_provider || 'gemini';
                      setSettings({
                        ...settings,
                        ocr: {
                          ...settings.ocr,
                          mode: 'api',
                          api_provider: curProv,
                          method: curProv === 'capcut' ? 'asr_whisper' : 'vlm_gemini',
                        },
                      });
                    }}
                    className={`p-5 rounded-2xl border cursor-pointer transition flex flex-col justify-between gap-3 ${
                      settings.ocr.mode === 'api'
                        ? 'bg-gradient-to-br from-amber-950/80 via-slate-900 to-purple-950/40 border-amber-500 text-white ring-2 ring-amber-500/50 shadow-xl'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xl">☁️</span>
                          <div>
                            <span className="font-black text-sm text-white tracking-wide">MODE API</span>
                            <span className="block text-[10px] text-amber-300 font-mono">Đám Mây (Cloud AI Big Tech)</span>
                          </div>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-950 border border-amber-500/60 text-amber-300 text-[10px] font-mono font-bold">
                          Cloud Engine • 0% VRAM
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Tận dụng hạ tầng đám mây siêu mạnh của <strong>Google Gemini</strong> (AI nhìn hình hiểu cốt truyện) hoặc <strong>ByteDance CapCut</strong> (Nhận diện giọng nói TikTok/Douyin cực chuẩn tiếng Việt, Trung, Anh).
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-300 bg-amber-950/60 px-3 py-1.5 rounded-lg border border-amber-800/40">
                      <span>✓ Google Gemini 2.5 Flash</span>
                      <span>•</span>
                      <span>✓ CapCut ByteDance ASR</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* BỘ CHỌN ĐỘNG CƠ CON (SUB-ENGINE CHO MODE TƯƠNG ỨNG) */}
              {(settings.ocr.mode === 'local' || !settings.ocr.mode) ? (
                <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-900/50 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <span>🖥️</span>
                      <span>Chọn Động Cơ Cục Bộ Trong Mode Local:</span>
                    </label>
                    <span className="text-[10px] text-emerald-400 font-mono font-semibold">100% Cục Bộ Trên Máy</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Sub-engine 1: RapidOCR ONNX */}
                    <div
                      onClick={() =>
                        setSettings({
                          ...settings,
                          ocr: {
                            ...settings.ocr,
                            local_engine: 'rapidocr',
                            method: 'ocr',
                          },
                        })
                      }
                      className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        (settings.ocr.local_engine === 'rapidocr' || !settings.ocr.local_engine)
                          ? 'bg-indigo-950/90 border-indigo-400 text-white ring-1 ring-indigo-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span>🏎️</span>
                          <span>RapidOCR ONNX</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[9px] font-mono border border-emerald-700/50">
                          Khuyên dùng
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Quét điểm ảnh hardsub trên video qua CUDA GPU (~140 FPS). Chuẩn xác và tốc độ số 1 cho video có chữ sẵn.
                      </p>
                    </div>

                    {/* Sub-engine 2: Faster-Whisper */}
                    <div
                      onClick={() =>
                        setSettings({
                          ...settings,
                          ocr: {
                            ...settings.ocr,
                            local_engine: 'whisper',
                            method: 'asr_whisper',
                          },
                        })
                      }
                      className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        settings.ocr.local_engine === 'whisper'
                          ? 'bg-indigo-950/90 border-indigo-400 text-white ring-1 ring-indigo-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span>🎙️</span>
                          <span>Faster-Whisper</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 text-[9px] font-mono border border-indigo-700/50">
                          RTX 3050 CUDA
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Nghe âm thanh giọng nói nhân vật bằng OpenAI Whisper FP16. Dùng khi video không có chữ hoặc chữ bị mờ.
                      </p>
                    </div>

                    {/* Sub-engine 3: Demux */}
                    <div
                      onClick={() =>
                        setSettings({
                          ...settings,
                          ocr: {
                            ...settings.ocr,
                            local_engine: 'demux',
                            method: 'demux_stream',
                          },
                        })
                      }
                      className={`p-3.5 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        settings.ocr.local_engine === 'demux'
                          ? 'bg-indigo-950/90 border-indigo-400 text-white ring-1 ring-indigo-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span>⚡</span>
                          <span>FFmpeg Demux</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 text-[9px] font-mono border border-cyan-700/50">
                          0.1s tức thì
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Bóc tách luồng phụ đề softsub đóng gói sẵn trong file MKV/MP4 (Netflix, Anime, YouTube) mà không cần quét AI.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Sub-engine chooser for Mode API */
                <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-900/50 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <span>☁️</span>
                      <span>Chọn Nhà Cung Cấp API Trong Mode API:</span>
                    </label>
                    <span className="text-[10px] text-amber-400 font-mono font-semibold">Đám Mây Trực Tuyến</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* API Provider 1: Google Gemini */}
                    <div
                      onClick={() =>
                        setSettings({
                          ...settings,
                          ocr: {
                            ...settings.ocr,
                            api_provider: 'gemini',
                            method: 'vlm_gemini',
                          },
                        })
                      }
                      className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        (settings.ocr.api_provider === 'gemini' || !settings.ocr.api_provider)
                          ? 'bg-amber-950/90 border-amber-400 text-white ring-1 ring-amber-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span>Google Gemini API</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 text-[9px] font-mono border border-amber-700/50">
                          VLM 2.5 Flash (Key Pool)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        AI thị giác video đa phương thức. Vừa nhìn hình vừa hiểu cốt truyện, đọc chuẩn chữ thư pháp/uốn lượn cổ trang và tự lọc sạch logo rác. Tự động xoay tua 43 keys.
                      </p>
                    </div>

                    {/* API Provider 2: CapCut Cloud API */}
                    <div
                      onClick={() =>
                        setSettings({
                          ...settings,
                          ocr: {
                            ...settings.ocr,
                            api_provider: 'capcut',
                            method: 'asr_whisper',
                          },
                        })
                      }
                      className={`p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        settings.ocr.api_provider === 'capcut'
                          ? 'bg-amber-950/90 border-amber-400 text-white ring-1 ring-amber-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span className="text-base">🎵</span>
                          <span>CapCut Cloud API</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 text-[9px] font-mono border border-purple-700/50">
                          ByteDance Volcano Engine
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Công nghệ nhận diện giọng nói (ASR) của CapCut / TikTok. Chuẩn âm điệu đối thoại phim ảnh, hỗ trợ xuất sắc Tiếng Việt (vi-VN), Tiếng Trung (zh-CN), Tiếng Anh (en-US).
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ================= LUỒNG NGÔN NGỮ TOÀN CẦU (AUTO-DETECT -> TARGET SELECT) ================= */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <div>
                    <label className="text-xs font-bold text-white flex items-center gap-2">
                      <Languages className="w-4 h-4 text-indigo-400" />
                      <span>Luồng Ngôn Ngữ: Tự Động Nhận Diện Nguồn → Ngôn Ngữ Dịch Sang</span>
                    </label>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Áp dụng thống nhất cho cả Mode Local và Mode API: Hệ thống tự động phát hiện ngôn ngữ gốc và dịch sang ngôn ngữ đích bạn chọn.
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 text-[10px] font-mono border border-indigo-700/40">
                    Auto-Detect & Select
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-center">
                  {/* 1. Bên Trái (Cột 5/11): Ngôn Ngữ Nguồn (Mặc định Auto) */}
                  <div className="lg:col-span-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300">1. Ngôn ngữ nguồn (Gốc trong video):</span>
                      <span className="text-[10px] text-emerald-400 font-mono font-bold">Auto Detect (Tự động)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, default_source_lang: 'auto' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between ${
                          (settings.ocr.default_source_lang === 'auto' || !settings.ocr.default_source_lang)
                            ? 'bg-indigo-950/80 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <span>🌐</span>
                          <span>Tự Động</span>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-medium">Khuyên dùng</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, default_source_lang: 'zh' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          settings.ocr.default_source_lang === 'zh'
                            ? 'bg-indigo-950/80 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <span>🇨🇳</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">Tiếng Trung</div>
                          <div className="text-[9px] text-slate-500 font-mono">zh (Chinese)</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, default_source_lang: 'en' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          settings.ocr.default_source_lang === 'en'
                            ? 'bg-indigo-950/80 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <span>🇬🇧</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">Tiếng Anh</div>
                          <div className="text-[9px] text-slate-500 font-mono">en (English)</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, default_source_lang: 'vi' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          settings.ocr.default_source_lang === 'vi'
                            ? 'bg-indigo-950/80 border-indigo-500 text-white ring-1 ring-indigo-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <span>🇻🇳</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">Tiếng Việt</div>
                          <div className="text-[9px] text-slate-500 font-mono">vi (Vietnamese)</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* 2. Ở Giữa (Cột 1/11): Mũi Tên Chuyển Dịch */}
                  <div className="lg:col-span-1 flex flex-col items-center justify-center py-2">
                    <div className="p-2 rounded-full bg-slate-800/80 border border-slate-700 text-indigo-400 shadow">
                      <span className="text-sm font-bold block rotate-90 lg:rotate-0">➔</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-semibold mt-1 hidden lg:block">Dịch sang</span>
                  </div>

                  {/* 3. Bên Phải (Cột 5/11): Ngôn Ngữ Dịch Sang (Select Chọn) */}
                  <div className="lg:col-span-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300">2. Ngôn ngữ dịch sang (Target Output):</span>
                      <span className="text-[10px] text-amber-400 font-mono font-bold">Select chọn</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, translation: { ...settings.translation, target_language: 'vi' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center justify-between ${
                          (settings.translation?.target_language === 'vi' || !settings.translation?.target_language)
                            ? 'bg-amber-950/70 border-amber-500 text-white ring-1 ring-amber-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <span>🇻🇳</span>
                          <span>Tiếng Việt</span>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 font-medium">Mặc định</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, translation: { ...settings.translation, target_language: 'en' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          settings.translation?.target_language === 'en'
                            ? 'bg-amber-950/70 border-amber-500 text-white ring-1 ring-amber-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <span>🇬🇧</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">Tiếng Anh</div>
                          <div className="text-[9px] text-slate-500 font-mono">en (English)</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, translation: { ...settings.translation, target_language: 'zh' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          settings.translation?.target_language === 'zh'
                            ? 'bg-amber-950/70 border-amber-500 text-white ring-1 ring-amber-500/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <span>🇨🇳</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">Tiếng Trung</div>
                          <div className="text-[9px] text-slate-500 font-mono">zh (Chinese)</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, translation: { ...settings.translation, target_language: 'none' } })}
                        className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                          settings.translation?.target_language === 'none'
                            ? 'bg-slate-800 border-slate-400 text-white ring-1 ring-slate-400/50 shadow'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-400'
                        }`}
                      >
                        <span>🚫</span>
                        <div className="truncate">
                          <div className="font-bold text-xs">Không Dịch</div>
                          <div className="text-[9px] text-slate-500 font-mono">Chỉ lấy sub gốc</div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ================= KHU VỰC CẤU HÌNH CHI TIẾT TƯƠNG ỨNG TỪNG LỰA CHỌN ================= */}

              {/* 1. CHI TIẾT KHI CHỌN MODE LOCAL: RAPIDOCR */}
              {(settings.ocr.mode === 'local' || !settings.ocr.mode) && (settings.ocr.local_engine === 'rapidocr' || !settings.ocr.local_engine) && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                    <label className="text-xs font-bold text-slate-200 block">Động Cơ OCR (OCR Engine):</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label
                        onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, engine: 'rapidocr' } })}
                        className={`p-4 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 ${
                          settings.ocr.engine === 'rapidocr'
                            ? 'bg-indigo-950/60 border-indigo-500 text-white ring-1 ring-indigo-500/50'
                            : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs">RapidOCR ONNX (Khuyên dùng)</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[10px] font-mono border border-emerald-700/50">
                            100% Local GPU
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Chạy mô hình PP-OCRv4 tối ưu qua ONNX Runtime. Tốc độ ~10ms/frame trên GPU NVIDIA RTX 3050 (CUDA).
                        </p>
                      </label>

                      <label
                        onClick={() => setSettings({ ...settings, ocr: { ...settings.ocr, engine: 'paddle' } })}
                        className={`p-4 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 ${
                          settings.ocr.engine === 'paddle'
                            ? 'bg-indigo-950/60 border-indigo-500 text-white ring-1 ring-indigo-500/50'
                            : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs">PaddleOCR Adapter (Baidu)</span>
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono border border-slate-700">
                            Local Python
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Thư viện PaddlePaddle gốc. Chuẩn xác cao cho chữ Hán cổ trang phức tạp, chữ viết dọc.
                        </p>
                      </label>
                    </div>
                  </div>

                  {/* Tần suất lấy mẫu FPS & Ngưỡng sai khác */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-200">Tần Suất Lấy Mẫu Frame (Sample FPS):</label>
                        <span className="font-mono font-bold text-indigo-400 text-xs px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800">
                          {settings.ocr.sample_fps} FPS
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="4.0"
                        step="0.5"
                        value={settings.ocr.sample_fps}
                        onChange={(e) =>
                          setSettings({ ...settings, ocr: { ...settings.ocr, sample_fps: parseFloat(e.target.value) } })
                        }
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                        <span>1.0 FPS (Nhanh)</span>
                        <span>2.0 FPS (Mặc định)</span>
                        <span>4.0 FPS (Tỷ mỷ)</span>
                      </div>
                    </div>

                    <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-200">Ngưỡng Lọc Frame Trùng (Diff Threshold):</label>
                        <span className="font-mono font-bold text-indigo-400 text-xs px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800">
                          {settings.ocr.diff_threshold}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="6.0"
                        step="0.5"
                        value={settings.ocr.diff_threshold}
                        onChange={(e) =>
                          setSettings({ ...settings, ocr: { ...settings.ocr, diff_threshold: parseFloat(e.target.value) } })
                        }
                        className="w-full accent-indigo-500 cursor-pointer"
                      />
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                        <span>1.0 (Quét dày)</span>
                        <span>3.5 (Cân bằng)</span>
                        <span>6.0 (Bỏ qua nhiều)</span>
                      </div>
                    </div>
                  </div>

                  {/* Gap-Rescue & ROI Tightening */}
                  <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                    <div className="text-xs font-bold text-slate-200">Tính Năng Tự Động Hóa Thông Minh:</div>
                    <div className="space-y-3">
                      <label className="flex items-start gap-3.5 cursor-pointer p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:bg-slate-950/80 transition">
                        <input
                          type="checkbox"
                          checked={settings.ocr.enable_gap_rescue}
                          onChange={(e) =>
                            setSettings({ ...settings, ocr: { ...settings.ocr, enable_gap_rescue: e.target.checked } })
                          }
                          className="mt-1 rounded accent-indigo-500 cursor-pointer"
                        />
                        <div>
                          <div className="text-xs font-bold text-white">Auto Gap-Rescue (Cứu phụ đề chớp nhoáng)</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Tự động rà soát khoảng trống giữa các câu và quét sâu để không bỏ sót câu phụ đề mờ hoặc hiển thị quá nhanh.
                          </div>
                        </div>
                      </label>

                      <label className="flex items-start gap-3.5 cursor-pointer p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:bg-slate-950/80 transition">
                        <input
                          type="checkbox"
                          checked={settings.ocr.enable_roi_tightening}
                          onChange={(e) =>
                            setSettings({ ...settings, ocr: { ...settings.ocr, enable_roi_tightening: e.target.checked } })
                          }
                          className="mt-1 rounded accent-indigo-500 cursor-pointer"
                        />
                        <div>
                          <div className="text-xs font-bold text-white">Smart ROI Tightening (Tự co gọn khung che)</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Tự động bóp gọn khung che mờ theo kích thước chữ thực tế, tránh che lấn vào nhân vật hay bối cảnh video.
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. CHI TIẾT KHI CHỌN MODE LOCAL: FASTER-WHISPER */}
              {(settings.ocr.mode === 'local' || !settings.ocr.mode) && settings.ocr.local_engine === 'whisper' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <Mic className="w-4 h-4 text-emerald-400" />
                        <span>Cấu Hình OpenAI Faster-Whisper (ASR Speech-to-Text)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Tách âm thanh và nhận diện giọng nói nhân vật chuẩn xác từng timecode trên GPU NVIDIA.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-700/60 text-emerald-300 text-[10px] font-mono font-bold">
                      GPU 6GB Tối Ưu
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Phiên Bản Mô Hình Whisper:</label>
                      <select
                        value={settings.ocr.whisper_model || 'medium'}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, whisper_model: e.target.value as any },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="medium">Whisper Medium (~2.2GB VRAM - Cân bằng tuyệt đối, khuyên dùng)</option>
                        <option value="large-v3">Whisper Large-v3 (~3.8GB VRAM - Chuẩn xác cao nhất thế giới)</option>
                        <option value="small">Whisper Small (~1.0GB VRAM - Siêu nhanh)</option>
                        <option value="base">Whisper Base (~500MB VRAM - Cực nhẹ)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Bộ Xử Lý & Kiểu Tính Toán:</label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={settings.ocr.whisper_device || 'cuda'}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              ocr: { ...settings.ocr, whisper_device: e.target.value as any },
                            })
                          }
                          className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                        >
                          <option value="cuda">GPU NVIDIA (CUDA)</option>
                          <option value="cpu">CPU Đa Luồng</option>
                        </select>

                        <select
                          value={settings.ocr.whisper_compute_type || 'float16'}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              ocr: { ...settings.ocr, whisper_compute_type: e.target.value as any },
                            })
                          }
                          className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                        >
                          <option value="float16">FP16 (Tốc độ tối đa)</option>
                          <option value="int8_float16">INT8-FP16 (Tiết kiệm VRAM)</option>
                          <option value="int8">INT8 (CPU Quantized)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={settings.ocr.whisper_vad_filter ?? true}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, whisper_vad_filter: e.target.checked },
                          })
                        }
                        className="rounded accent-emerald-500 cursor-pointer"
                      />
                      <span className="text-slate-300 font-medium">
                        Bật Silero VAD (Voice Activity Detection - Tự động loại bỏ khoảng lặng & nhạc nền không lời)
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* 3. CHI TIẾT KHI CHỌN MODE LOCAL: DEMUX SOFTSUB */}
              {(settings.ocr.mode === 'local' || !settings.ocr.mode) && settings.ocr.local_engine === 'demux' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <Download className="w-4 h-4 text-cyan-400" />
                        <span>Cấu Hình Bóc Tách Luồng Phụ Đề Mềm (FFmpeg Demuxer)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Tự động rà soát container video (MP4/MKV) và xuất trực tiếp file phụ đề mà không cần chạy mô hình AI.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-cyan-950 border border-cyan-700/60 text-cyan-300 text-[10px] font-mono font-bold">
                      Tốc độ: 0.1s
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Ngôn Ngữ Phụ Đề Ưu Tiên Bóc:</label>
                      <select
                        value={settings.ocr.demux_stream_lang || 'auto'}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, demux_stream_lang: e.target.value },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500"
                      >
                        <option value="auto">Tự động (Ưu tiên Tiếng Trung -&gt; Tiếng Anh -&gt; Track đầu tiên)</option>
                        <option value="zh">Tiếng Trung (chi / zho / cmn)</option>
                        <option value="en">Tiếng Anh (eng)</option>
                        <option value="vi">Tiếng Việt (vie)</option>
                      </select>
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={settings.ocr.demux_fallback_to_ocr ?? true}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              ocr: { ...settings.ocr, demux_fallback_to_ocr: e.target.checked },
                            })
                          }
                          className="rounded accent-cyan-500 cursor-pointer"
                        />
                        <span className="text-slate-300 font-medium">
                          Tự động chuyển sang RapidOCR (Fallback) nếu video không chứa track sub mềm nào
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. CHI TIẾT KHI CHỌN MODE API: GOOGLE GEMINI VLM */}
              {settings.ocr.mode === 'api' && (settings.ocr.api_provider === 'gemini' || !settings.ocr.api_provider) && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>Cấu Hình Google Gemini API (Video Multimodal AI)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Gửi video hoặc keyframe lên Gemini để AI "xem hình, hiểu kịch bản" và tự xuất phụ đề sạch.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-amber-950 border border-amber-700/60 text-amber-300 text-[10px] font-mono font-bold">
                      Key Pool 43 Keys
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Phiên Bản Gemini Model:</label>
                      <select
                        value={settings.ocr.vlm_provider || 'gemini'}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-amber-500"
                        disabled
                      >
                        <option value="gemini">Google Gemini 2.5 Flash Multimodal (Khuyên dùng)</option>
                      </select>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Mục Tiêu Trích Xuất Phim:</label>
                      <select
                        value={settings.ocr.vlm_prompt_style || 'accurate_dialogue'}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, vlm_prompt_style: e.target.value },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-amber-500"
                      >
                        <option value="accurate_dialogue">Tập trung tuyệt đối vào lời thoại nhân vật (Lọc sạch logo rác)</option>
                        <option value="detailed_scene">Bao gồm cả biển hiệu, ghi chú thời gian và lời dẫn truyện</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 flex items-center justify-between text-[11px] text-amber-300/90">
                    <div>
                      💡 Đang sử dụng <strong>Gemini Key Pool</strong> ({geminiPoolStatus ? `${geminiPoolStatus.active_keys}/${geminiPoolStatus.total_keys} keys hoạt động` : '43 keys'}) tự động xoay tua Round-Robin.
                    </div>
                    {onOpenKeyPool && (
                      <button
                        type="button"
                        onClick={onOpenKeyPool}
                        className="px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 font-semibold cursor-pointer shrink-0 ml-2"
                      >
                        Xem Key Pool
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* 5. CHI TIẾT KHI CHỌN MODE API: CAPCUT CLOUD API */}
              {settings.ocr.mode === 'api' && settings.ocr.api_provider === 'capcut' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <span className="text-base">🎵</span>
                        <span>Cấu Hình CapCut Cloud API (ByteDance Volcano Engine ASR)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Tích hợp theo tài liệu nghiên cứu <code className="text-purple-300 font-mono">docs/CAPCUT_API_RESEARCH.md</code> (edit-api-sg.capcut.com).
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-purple-950 border border-purple-700/60 text-purple-300 text-[10px] font-mono font-bold">
                      TikTok / CapCut Engine
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">CapCut API Endpoint URL:</label>
                      <input
                        type="text"
                        value={settings.ocr.capcut_api_endpoint || 'https://edit-api-sg.capcut.com'}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, capcut_api_endpoint: e.target.value },
                          })
                        }
                        placeholder="https://edit-api-sg.capcut.com hoặc http://127.0.0.1:5500"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]"
                      />
                      <div className="text-[10px] text-slate-500 mt-1">
                        Mặc định máy chủ Singapore của ByteDance hoặc Local Proxy Server.
                      </div>
                    </div>

                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Session Token / Cookie (Tùy chọn):</label>
                      <input
                        type="password"
                        value={settings.ocr.capcut_session_token || ''}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, capcut_session_token: e.target.value },
                          })
                        }
                        placeholder="Để trống nếu dùng chế độ Sandbox/Local Proxy..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-purple-500 font-mono text-[11px]"
                      />
                      <div className="text-[10px] text-slate-500 mt-1">
                        Mã xác thực tài khoản CapCut Web hoặc Device ID.
                      </div>
                    </div>
                  </div>

                  {/* Cụm Kiểm Tra Kết Nối CapCut */}
                  <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-950/20 border border-purple-900/40 p-3.5 rounded-xl">
                    <div className="text-xs">
                      <div className="font-bold text-purple-300 flex items-center gap-1.5">
                        <span>📡</span>
                        <span>Kiểm Tra Trạng Thái Kết Nối Máy Chủ CapCut:</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Gửi gói tin ping kiểm tra thông tuyến và đo độ trễ mạng (latency) tới hạ tầng ByteDance.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleTestCapCutConnection}
                      disabled={isTestingCapCut}
                      className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      {isTestingCapCut ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Đang kiểm tra...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          <span>Kiểm Tra Kết Nối (Ping)</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Hiển thị kết quả kiểm tra CapCut */}
                  {capcutTestResult && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs flex items-center justify-between animate-in fade-in ${
                        capcutTestResult.ok
                          ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                          : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {capcutTestResult.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <span className="text-base shrink-0">⚠️</span>
                        )}
                        <span>{capcutTestResult.message}</span>
                      </div>
                      <div className="font-mono text-[10px] bg-slate-950/80 px-2 py-1 rounded border border-slate-800 shrink-0 ml-2">
                        Độ trễ: {capcutTestResult.latency_ms}ms
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 2: DỊCH THUẬT AI ================= */}
          {activeTab === 'translation' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Languages className="w-5 h-5 text-amber-400" />
                    <span>2. Cấu Hình Động Cơ Dịch Thuật (Translation Engine)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Sử dụng Google Gemini AI kèm xoay tua Key Pool hoặc dịch máy dự phòng tự động.
                  </p>
                </div>

                {onOpenKeyPool && (
                  <button
                    onClick={onOpenKeyPool}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>Quản Lý Keys Pool</span>
                  </button>
                )}
              </div>

              {/* Chọn Nhà Cung Cấp Dịch */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label
                  onClick={() => setSettings({ ...settings, translation: { ...settings.translation, provider: 'gemini' } })}
                  className={`p-4 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 ${
                    settings.translation.provider === 'gemini'
                      ? 'bg-amber-950/60 border-amber-500 text-white ring-1 ring-amber-500/50'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>Google Gemini AI (Khuyên dùng)</span>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 text-[10px] font-mono border border-amber-700/50">
                      Chuẩn Phim
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Dịch theo ngữ cảnh câu chuyện, xưng hô nhân vật chuẩn xác (mẹ/con, anh/em), văn phong tự nhiên.
                  </p>
                </label>

                <label
                  onClick={() => setSettings({ ...settings, translation: { ...settings.translation, provider: 'google_web' } })}
                  className={`p-4 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 ${
                    settings.translation.provider === 'google_web'
                      ? 'bg-amber-950/60 border-amber-500 text-white ring-1 ring-amber-500/50'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">Google Translate Web (deep-translator)</span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono border border-slate-700">
                      Miễn phí 100%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Không cần API key. Thích hợp làm dự phòng khi toàn bộ API Keys trong pool đều bận hoặc hết hạn ngạch.
                  </p>
                </label>
              </div>

              {/* Các tùy chọn chi tiết của Gemini AI */}
              {settings.translation.provider === 'gemini' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1.5">Phiên Bản Gemini Model:</label>
                      <select
                        value={settings.translation.gemini_model}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            translation: { ...settings.translation, gemini_model: e.target.value },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                      >
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash (Mới nhất, siêu nhanh & thông minh)</option>
                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1.5">Phong Cách Kịch Bản (Tone):</label>
                      <select
                        value={settings.translation.prompt_tone}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            translation: {
                              ...settings.translation,
                              prompt_tone: e.target.value as any,
                            },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500"
                      >
                        <option value="dramatic">Kịch tính, điện ảnh (Phim truyền hình / Tiểu phẩm)</option>
                        <option value="daily">Đời thường, tự nhiên, gần gũi</option>
                        <option value="humorous">Hài hước, dí dỏm, tiếng lóng giới trẻ</option>
                        <option value="literal">Sát nghĩa gốc (Tài liệu / Bản tin)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={settings.translation.use_glossary}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            translation: { ...settings.translation, use_glossary: e.target.checked },
                          })
                        }
                        className="rounded accent-amber-500 cursor-pointer"
                      />
                      <span className="text-slate-300 font-medium">
                        Áp dụng Từ điển tiếng lóng & khẩu ngữ Trung-Việt (打车, 换平台, 小姐姐, 破防...)
                      </span>
                    </label>
                    <span className="text-[11px] font-mono text-slate-500">Mẻ 35 câu/lần</span>
                  </div>
                </div>
              )}

              {/* Quản Lý Gemini Key Pool Toàn Diện (Tích hợp trong Tab, không cần Popup) */}
              {settings.translation.provider === 'gemini' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                        <Key className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white flex items-center gap-2">
                          <span>Gemini Key Pool (Xoay Tua Tự Động & Chống Quá Tải)</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-700/50 text-indigo-300 font-mono">
                            Round-Robin
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Tự động phân bổ 15 RPM qua từng key, cách ly tạm thời 60s khi gặp 429
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleVerifyAllKeys}
                        disabled={isVerifyingPool || (geminiPoolStatus?.total_keys || 0) === 0}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow cursor-pointer"
                        title="Ping kiểm tra trạng thái tất cả các keys trong pool"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${isVerifyingPool ? 'animate-spin text-amber-300' : ''}`} />
                        <span>{isVerifyingPool ? 'Đang kiểm tra...' : 'Kiểm Tra Tất Cả Keys'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={loadGeminiPool}
                        className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                        title="Tải lại trạng thái pool"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 4 Chỉ Số Thông Lượng */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 block font-medium">Tổng số Keys</span>
                      <span className="text-base font-bold text-white font-mono">
                        {geminiPoolStatus?.total_keys || 0}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-emerald-900/40 text-center">
                      <span className="text-[10px] text-emerald-400 block font-medium">Khả Dụng</span>
                      <span className="text-base font-bold text-emerald-300 font-mono">
                        {geminiPoolStatus?.active_keys || 0}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-amber-900/40 text-center">
                      <span className="text-[10px] text-amber-400 block font-medium">Đang Nghỉ (429)</span>
                      <span className="text-base font-bold text-amber-300 font-mono">
                        {geminiPoolStatus?.cooldown_keys || 0}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-cyan-900/40 text-center">
                      <span className="text-[10px] text-cyan-400 block font-medium">Thông Lượng Tối Đa</span>
                      <span className="text-base font-bold text-cyan-300 font-mono">
                        {(geminiPoolStatus?.active_keys || 0) * 15} <span className="text-[10px] font-normal text-slate-400">RPM</span>
                      </span>
                    </div>
                  </div>

                  {/* Sub-tabs: Danh sách Keys vs Nhập Hàng Loạt */}
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActivePoolSubTab('list')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          activePoolSubTab === 'list'
                            ? 'bg-amber-600 text-white shadow'
                            : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>Danh Sách Keys ({geminiPoolStatus?.total_keys || 0})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActivePoolSubTab('input')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          activePoolSubTab === 'input'
                            ? 'bg-amber-600 text-white shadow'
                            : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Thêm / Cập Nhật Keys</span>
                      </button>
                    </div>

                    {activePoolSubTab === 'list' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPoolKeyFilter('all')}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                            poolKeyFilter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'
                          }`}
                        >
                          Tất cả ({geminiPoolStatus?.total_keys || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPoolKeyFilter('usable')}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                            poolKeyFilter === 'usable' ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50' : 'text-slate-400 hover:text-emerald-400'
                          }`}
                        >
                          Khả dụng ({geminiPoolStatus?.active_keys || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setPoolKeyFilter('cooldown')}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                            poolKeyFilter === 'cooldown' ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50' : 'text-slate-400 hover:text-amber-400'
                          }`}
                        >
                          Đang nghỉ ({geminiPoolStatus?.cooldown_keys || 0})
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Sub-tab 1: Danh Sách Keys */}
                  {activePoolSubTab === 'list' && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={poolSearchQuery}
                          onChange={(e) => setPoolSearchQuery(e.target.value)}
                          placeholder="Tìm kiếm theo đuôi key..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                        {(!geminiPoolStatus?.items || geminiPoolStatus.items.length === 0) ? (
                          <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl">
                            <Key className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                            <p className="text-xs text-slate-400">Chưa có API key nào trong Pool.</p>
                            <button
                              type="button"
                              onClick={() => setActivePoolSubTab('input')}
                              className="mt-2 text-xs font-semibold text-amber-400 hover:underline cursor-pointer"
                            >
                              + Thêm Key Ngay
                            </button>
                          </div>
                        ) : (
                          (geminiPoolStatus.items || [])
                            .filter((item) => {
                              if (poolKeyFilter === 'usable' && !item.is_usable) return false;
                              if (poolKeyFilter === 'cooldown' && item.status !== 'cooldown') return false;
                              if (poolSearchQuery.trim()) {
                                return item.masked_key.toLowerCase().includes(poolSearchQuery.toLowerCase());
                              }
                              return true;
                            })
                            .map((item, idx) => (
                              <div
                                key={idx}
                                className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition ${
                                  item.status === 'cooldown'
                                    ? 'bg-amber-950/20 border-amber-900/40'
                                    : !item.is_usable
                                    ? 'bg-rose-950/20 border-rose-900/40'
                                    : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-[10px] text-slate-500 w-5 text-right">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-mono text-slate-200 font-medium truncate">
                                    {item.masked_key}
                                  </span>
                                  {item.latency_ms !== undefined && item.latency_ms > 0 && (
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      ({item.latency_ms}ms)
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(item.masked_key);
                                      setCopiedKeyIndex(idx);
                                      setTimeout(() => setCopiedKeyIndex(null), 1500);
                                    }}
                                    className="p-1 text-slate-500 hover:text-slate-300 transition cursor-pointer"
                                    title="Copy masked key"
                                  >
                                    {copiedKeyIndex === idx ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {item.status === 'cooldown' ? (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-950 border border-amber-800 text-amber-300 text-[10px] font-mono">
                                      Nghỉ {item.remaining_seconds}s
                                    </span>
                                  ) : item.is_usable ? (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 text-[10px] font-mono">
                                      Khả dụng
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-rose-950 border border-rose-800 text-rose-300 text-[10px] font-mono">
                                      {item.status_label || 'Lỗi'}
                                    </span>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSingleKey(idx)}
                                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                                    title="Xoá Key khỏi Pool"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Sub-tab 2: Nhập Hàng Loạt */}
                  {activePoolSubTab === 'input' && (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-slate-300">
                            Dán danh sách API Keys (Mỗi dòng một key):
                          </label>
                          <span className="text-[10px] text-slate-500">
                            Hỗ trợ dán nhiều key cùng lúc từ Google AI Studio
                          </span>
                        </div>
                        <textarea
                          rows={5}
                          value={poolInputKeys}
                          onChange={(e) => setPoolInputKeys(e.target.value)}
                          placeholder="AIzaSy...\nAIzaSy...\nAIzaSy..."
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-amber-500 resize-none"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          Số keys phát hiện:{' '}
                          <span className="font-bold text-amber-300 font-mono">
                            {
                              poolInputKeys
                                .split('\n')
                                .map((k) => k.trim())
                                .filter((k) => k.length > 5).length
                            }
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={handleSavePoolKeys}
                          disabled={
                            isSavingPoolKeys ||
                            poolInputKeys
                              .split('\n')
                              .map((k) => k.trim())
                              .filter((k) => k.length > 5).length === 0
                          }
                          className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 active:scale-95 disabled:opacity-50 text-white text-xs font-bold transition shadow cursor-pointer flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{isSavingPoolKeys ? 'Đang lưu...' : 'Lưu Danh Sách Keys'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Khối Thử Nghiệm Dịch Tức Thì (Live Test) */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Thử Nghiệm Dịch Trực Tiếp (Live Test)</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleTestTranslation}
                    disabled={isTranslatingTest}
                    className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 active:scale-95 text-white font-bold text-xs transition disabled:opacity-50 flex items-center gap-1 shadow cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-white" />
                    <span>{isTranslatingTest ? 'Đang dịch...' : 'Dịch thử ngay'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Câu gốc tiếng Trung:</span>
                    <input
                      type="text"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-sans text-xs focus:outline-none focus:border-amber-500"
                      placeholder="Nhập câu tiếng Trung..."
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-slate-400">Kết quả tiếng Việt:</span>
                      {testTransResult && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {testTransResult.provider_used} ({testTransResult.latency_ms}ms)
                        </span>
                      )}
                    </div>
                    <div className="w-full bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 text-cyan-300 font-medium text-xs min-h-[40px] flex items-center">
                      {testTransResult ? testTransResult.translated : <span className="text-slate-500 italic">Bấm "Dịch thử ngay" để xem...</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 3: GIỌNG ĐỌC TTS & ÂM THANH ================= */}
          {activeTab === 'dubbing' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Mic className="w-5 h-5 text-emerald-400" />
                  <span>3. Cấu Hình Giọng Đọc Thuyết Minh (Edge-TTS) & Âm Thanh</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Tự động tạo giọng đọc tiếng Việt khớp timecode và hòa âm với nhạc nền (Audio Ducking).
                </p>
              </div>

              {/* Chọn Giọng Đọc */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                <label className="text-xs font-bold text-slate-200 block">Giọng Đọc Microsoft Neural TTS:</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label
                    onClick={() => setSettings({ ...settings, dubbing: { ...settings.dubbing, voice: 'vi-VN-NamMinhNeural' } })}
                    className={`p-4 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 ${
                      settings.dubbing.voice === 'vi-VN-NamMinhNeural'
                        ? 'bg-emerald-950/60 border-emerald-500 text-white ring-1 ring-emerald-500/50'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">Nam Minh (vi-VN-NamMinhNeural)</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-mono border border-emerald-700/50">
                        Nam truyền cảm
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Giọng nam trầm ấm, rõ ràng, phát âm chuẩn tiếng Việt, rất phù hợp phim kịch tính và truyện ngắn.
                    </p>
                  </label>

                  <label
                    onClick={() => setSettings({ ...settings, dubbing: { ...settings.dubbing, voice: 'vi-VN-HoaiMyNeural' } })}
                    className={`p-4 rounded-xl border cursor-pointer transition flex flex-col gap-1.5 ${
                      settings.dubbing.voice === 'vi-VN-HoaiMyNeural'
                        ? 'bg-emerald-950/60 border-emerald-500 text-white ring-1 ring-emerald-500/50'
                        : 'bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">Hoài My (vi-VN-HoaiMyNeural)</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-mono border border-emerald-700/50">
                        Nữ dịu dàng
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Giọng nữ nhẹ nhàng, trong trẻo, phù hợp thể loại tâm lý xã hội, ẩm thực và đời sống.
                    </p>
                  </label>
                </div>
              </div>

              {/* Tốc độ nói & Tỷ lệ giảm nhạc nền */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200">Tốc Độ Đọc (Speech Rate):</label>
                    <span className="font-mono font-bold text-emerald-400 text-xs px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                      {settings.dubbing.rate}
                    </span>
                  </div>
                  <select
                    value={settings.dubbing.rate}
                    onChange={(e) =>
                      setSettings({ ...settings, dubbing: { ...settings.dubbing, rate: e.target.value } })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value="-10%">-10% (Chậm rãi, lắng đọng)</option>
                    <option value="+0%">+0% (Chuẩn tự nhiên)</option>
                    <option value="+10%">+10% (Nhanh vừa, khớp thoại gấp)</option>
                    <option value="+20%">+20% (Nhanh, cho câu dài)</option>
                  </select>
                </div>

                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200">Dìm Nhạc Nền (Audio Ducking):</label>
                    <span className="font-mono font-bold text-emerald-400 text-xs px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                      {Math.round(settings.dubbing.ducking_volume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="0.45"
                    step="0.05"
                    value={settings.dubbing.ducking_volume}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        dubbing: { ...settings.dubbing, ducking_volume: parseFloat(e.target.value) },
                      })
                    }
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                    <span>10% (Nhạc rất nhỏ)</span>
                    <span>25% (Chuẩn điện ảnh)</span>
                    <span>45% (Nhạc to)</span>
                  </div>
                </div>
              </div>

              {/* Khối Thử Nghiệm Nghe Giọng Đọc Trực Tiếp */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Nghe Thử Giọng Đọc (Live Audio Preview)</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleTestDubbing}
                    disabled={isDubbingTest}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs transition disabled:opacity-50 flex items-center gap-1.5 shadow cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-white" />
                    <span>{isDubbingTest ? 'Đang tạo âm thanh...' : 'Nghe thử ngay'}</span>
                  </button>
                </div>

                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Đoạn văn thử nghiệm:</span>
                  <input
                    type="text"
                    value={testDubbingText}
                    onChange={(e) => setTestDubbingText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 4: RENDER & PRESET ================= */}
          {activeTab === 'render' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-purple-400" />
                  <span>4. Render Phần Cứng & Quản Lý Chuẩn Cấu Hình (Presets)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Quản lý GPU tăng tốc render, kiểu che mờ và lưu trữ các Preset tái sử dụng cho hàng loạt phim.
                </p>
              </div>

              {/* Phần cứng & Bộ mã hóa FFmpeg */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Khả Năng Tăng Tốc Phần Cứng & GPU:</span>
                  <button
                    type="button"
                    onClick={loadHardwareInfo}
                    disabled={isLoadingHardware}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1 transition cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingHardware ? 'animate-spin text-purple-400' : ''}`} />
                    <span>Kiểm tra lại</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Vi Xử Lý (CPU)</div>
                    <div className="font-bold text-white text-xs">{hardwareInfo?.cpu.cores || 4} Cores / Threads</div>
                    <div className="text-[10px] text-slate-500 truncate" title={hardwareInfo?.cpu.model}>
                      {hardwareInfo?.cpu.model}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Card Đồ Họa (GPU)</div>
                    <div className="font-bold text-cyan-300 text-xs truncate" title={hardwareInfo?.gpu.name}>
                      {hardwareInfo?.gpu.has_gpu ? hardwareInfo.gpu.name : 'Không có GPU rời'}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      VRAM: {hardwareInfo?.gpu.vram_total_mb || 0} MB | CUDA: {hardwareInfo?.gpu.cuda_available ? 'Có' : 'Không'}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Bộ Mã Hóa FFmpeg</div>
                    <div className="font-bold text-emerald-400 text-xs">
                      {hardwareInfo?.ffmpeg.recommended_encoder === 'h264_nvenc'
                        ? 'h264_nvenc (NVIDIA GPU)'
                        : 'libx264 (CPU)'}
                    </div>
                    <div className="text-[10px] text-slate-500">FFmpeg v{hardwareInfo?.ffmpeg.version}</div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Bộ Mã Hóa FFmpeg:</label>
                    <select
                      value={settings.render.ffmpeg_encoder}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          render: { ...settings.render, ffmpeg_encoder: e.target.value as any },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500"
                    >
                      <option value="auto">Tự động (Ưu tiên GPU NVENC, fallback CPU)</option>
                      <option value="nvenc">Ép buộc NVIDIA NVENC (Cực nhanh)</option>
                      <option value="cpu">Ép buộc CPU libx264 (Tương thích cao nhất)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Kiểu Che Mờ Mặc Định Toàn Cục:</label>
                    <select
                      value={settings.render.default_mask_style}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          render: { ...settings.render, default_mask_style: e.target.value },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500"
                    >
                      <option value="feather_tight">feather_tight (Viền lông vũ mịn - Khuyên dùng)</option>
                      <option value="optical_blend">optical_blend (Hòa trộn quang học)</option>
                      <option value="blur">blur (Mờ chuẩn truyền thống)</option>
                      <option value="glass">glass (Kính mờ trong suốt)</option>
                      <option value="mosaic">mosaic (Điểm chấm kính mờ)</option>
                      <option value="box">box (Hộp đen Cinema)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Quản lý danh sách Preset Profiles */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white">Danh Sách Chuẩn Cấu Hình (Presets):</span>
                    <p className="text-[11px] text-slate-400">Tạo mẫu tỷ lệ màn hình (16:9, 9:16) và tọa độ ROI cho từng kênh</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => exportPresetsAsJson(presets)}
                      className="px-2.5 py-1.5 rounded bg-slate-850 hover:bg-slate-750 text-slate-300 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer"
                      title="Xuất danh sách chuẩn ra file JSON"
                    >
                      <Download className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Xuất JSON</span>
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportPresetFile}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1.5 rounded bg-slate-850 hover:bg-slate-750 text-slate-300 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer"
                      title="Nhập file JSON cấu hình chuẩn từ máy tính"
                    >
                      <Upload className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Nhập JSON</span>
                    </button>

                    <button
                      onClick={handleResetPresetsToBuiltin}
                      className="p-1.5 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
                      title="Khôi phục chuẩn gốc ban đầu"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleStartCreatePreset}
                      className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 shadow transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm Chuẩn</span>
                    </button>
                  </div>
                </div>

                {presetMessage && (
                  <div className="p-2.5 rounded bg-indigo-950/60 border border-indigo-800 text-indigo-300 text-xs flex items-center justify-between">
                    <span>{presetMessage}</span>
                    <button onClick={() => setPresetMessage(null)} className="text-indigo-400 hover:text-white">✕</button>
                  </div>
                )}

                {/* Form sửa preset nếu đang mở */}
                {editingPreset && (
                  <form onSubmit={handleSavePresetEdit} className="p-4 rounded-xl bg-slate-950 border border-indigo-500/50 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-bold text-xs text-white flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{isCreatingNewPreset ? 'Tạo Chuẩn Mới' : `Sửa: ${editingPreset.name}`}</span>
                      </span>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(editingPreset.is_default)}
                            onChange={(e) => setEditingPreset({ ...editingPreset, is_default: e.target.checked })}
                            className="rounded accent-amber-500"
                          />
                          <span className="text-amber-300 text-[11px]">Mặc định</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setEditingPreset(null)}
                          className="text-slate-400 hover:text-white text-xs cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Tên Chuẩn:</label>
                        <input
                          type="text"
                          value={editingPreset.name}
                          onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-slate-100 text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Tỉ lệ khung hình:</label>
                        <select
                          value={editingPreset.aspect_ratio || '16:9'}
                          onChange={(e) => setEditingPreset({ ...editingPreset, aspect_ratio: e.target.value as any })}
                          className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-slate-100 text-xs"
                        >
                          <option value="16:9">16:9 (Ngang TV / Youtube)</option>
                          <option value="9:16">9:16 (Dọc TikTok / Reels / Shorts)</option>
                          <option value="4:3">4:3 (Truyền thống)</option>
                          <option value="1:1">1:1 (Vuông)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Kiểu che mờ:</label>
                        <select
                          value={editingPreset.mask_style || 'blur'}
                          onChange={(e) => setEditingPreset({ ...editingPreset, mask_style: e.target.value as any })}
                          className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-slate-100 text-xs"
                        >
                          <option value="feather_tight">feather_tight (Viền lông vũ mịn)</option>
                          <option value="optical_blend">optical_blend (Quang học)</option>
                          <option value="blur">blur (Mờ tiêu chuẩn)</option>
                          <option value="glass">glass (Kính mờ)</option>
                          <option value="box">box (Hộp đen)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow cursor-pointer"
                      >
                        Lưu Chuẩn
                      </button>
                    </div>
                  </form>
                )}

                {/* Bảng danh sách các preset */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {presets.map((p) => {
                    const isEditing = editingPreset?.id === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`p-3.5 rounded-xl border transition flex flex-col justify-between gap-2.5 ${
                          isEditing
                            ? 'bg-indigo-950/60 border-indigo-500 text-white shadow-md'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-xs text-white leading-snug">{p.name}</div>
                            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400">
                              <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 font-mono text-cyan-300">
                                {p.aspect_ratio || '16:9'}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 font-mono text-emerald-400">
                                {p.mask_style}
                              </span>
                            </div>
                          </div>

                          {p.is_default ? (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1">
                              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                              <span>Mặc định</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultPreset(p.id)}
                              className="text-slate-500 hover:text-amber-400 p-0.5 text-[10px] cursor-pointer"
                              title="Đặt làm mặc định"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px]">
                          {onSelectPreset && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectPreset(p);
                                onSwitchToDashboard();
                              }}
                              className="text-indigo-400 hover:text-indigo-300 font-medium text-[11px] cursor-pointer"
                            >
                              Áp dụng ngay
                            </button>
                          )}
                          <div className="flex items-center gap-1.5 ml-auto">
                            <button
                              type="button"
                              onClick={() => handleStartEditPreset(p)}
                              className="text-slate-400 hover:text-white p-1 cursor-pointer"
                              title="Sửa chuẩn này"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePreset(p.id, p.name)}
                              className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                              title="Xóa chuẩn này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
