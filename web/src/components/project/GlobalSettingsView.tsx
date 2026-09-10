import React, { useState, useEffect, useRef } from 'react';
import {
  apiClient,
  GlobalPipelineSettings,
  HardwareInfoResponse,
  TestTranslationResult,
  GeminiPoolStatus,
  DeviceStatusInfo,
  /** @deprecated retired provider; kept for migration-only hidden markup */
  GroqPoolStatus,
} from '../../api/client';
import {
  PresetProfile,
  exportPresetsAsJson,
  parsePresetsJson,
  BUILTIN_PRESETS,
} from '../../types/presets';
import { appLogger } from '../common/GlobalActivityLogger';
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
  AlertTriangle,
  Flame,
  Wand2,
  Square,
  Smartphone,
  Wifi,
  AlertCircle,
  Video,
} from 'lucide-react';
import { detectVoiceProvider } from '../../constants/voiceCatalog';
import { VoiceCatalogPicker } from '../common/VoiceCatalogPicker';
import {
  loadBatchExportConfig,
  saveBatchExportConfig,
  reconcileBatchConfigWithBackend,
  BatchExportConfig,
} from '../../utils/batchSettingsStorage';
const DEFAULT_TTS_CATALOG: Record<string, Array<{
  voice_id: string;
  display_name: string;
  lang: string;
  gender: string;
  description: string;
  tags: string[];
}>> = {
  edge: [
    { voice_id: 'vi-VN-NamMinhNeural', display_name: 'Nam Minh (Truyền cảm)', lang: 'vi', gender: 'male', description: 'Giọng nam trầm ấm, phát âm chuẩn đài tiếng nói, phù hợp phim kịch tính và truyện ngắn.', tags: ['Nam truyền cảm', 'Chuẩn đài', 'Kịch tính'] },
    { voice_id: 'vi-VN-HoaiMyNeural', display_name: 'Hoài My (Dịu dàng)', lang: 'vi', gender: 'female', description: 'Giọng nữ trong trẻo, nhẹ nhàng, tự nhiên, phù hợp vlog đời sống, tâm lý và ẩm thực.', tags: ['Nữ dịu dàng', 'Đời sống', 'Tâm lý'] },
    { voice_id: 'en-US-JennyNeural', display_name: 'Jenny (US Expressive)', lang: 'en', gender: 'female', description: 'Standard American female voice with lifelike warmth and clarity.', tags: ['American', 'Conversational', 'Warm'] },
    { voice_id: 'en-US-GuyNeural', display_name: 'Guy (US Broadcast)', lang: 'en', gender: 'male', description: 'Professional American male broadcast voice for news, explainers and recaps.', tags: ['American', 'News', 'Professional'] },
    { voice_id: 'en-US-AriaNeural', display_name: 'Aria (US Dynamic)', lang: 'en', gender: 'female', description: 'Dynamic, clear American female narrator suited for energetic storytelling.', tags: ['Dynamic', 'Narrator', 'Clear'] },
    { voice_id: 'en-US-ChristopherNeural', display_name: 'Christopher (US Deep)', lang: 'en', gender: 'male', description: 'Deep and soothing American male storytelling voice.', tags: ['Deep', 'Storytelling', 'Soothing'] },
    { voice_id: 'en-GB-RyanNeural', display_name: 'Ryan (British Classic)', lang: 'en', gender: 'male', description: 'Classic British English male voice for documentary and literature.', tags: ['British', 'Classic', 'Documentary'] },
    { voice_id: 'en-GB-SoniaNeural', display_name: 'Sonia (British Elegant)', lang: 'en', gender: 'female', description: 'Elegant and articulate British female voice.', tags: ['British', 'Elegant', 'Articulate'] },
  ],
  capcut: [
    { voice_id: 'BV075_streaming', display_name: 'Thanh Niên Tự Tin', lang: 'vi', gender: 'male', description: 'Giọng nam năng động, tự tin, phát âm chuẩn, phù hợp review phim và truyện tranh.', tags: ['Nam sôi nổi', 'Review phim', 'TikTok Hot'] },
    { voice_id: 'BV074_streaming', display_name: 'Cô Gái Hoạt Ngôn', lang: 'vi', gender: 'female', description: 'Giọng nữ hoạt bát, tươi sáng, biểu cảm tốt, rất cuốn hút người xem.', tags: ['Nữ trẻ trung', 'Kể chuyện', 'TikTok Hot'] },
    { voice_id: 'BV421_vivn_streaming', display_name: 'Nhỏ Ngọt Ngào', lang: 'vi', gender: 'female', description: 'Giọng nữ nhẹ nhàng, ngọt ngào, ấm áp, phù hợp tâm sự, vlog và tóm tắt phim tình cảm.', tags: ['Nữ ngọt ngào', 'Tâm sự', 'Truyền cảm'] },
    { voice_id: 'BV562_streaming', display_name: 'Mai (Thuyết Minh)', lang: 'vi', gender: 'female', description: 'Giọng nữ thanh lịch, phát âm chuẩn đài truyền hình, thuyết minh tài liệu chuyên nghiệp.', tags: ['Nữ thanh lịch', 'Thuyết minh', 'Chuẩn đài'] },
    { voice_id: 'vi_female_huong', display_name: 'Giọng Nữ Phổ Thông (Hương)', lang: 'vi', gender: 'female', description: 'Giọng nữ phổ thông miền Bắc, rõ ràng, dễ nghe, phù hợp tin tức tổng hợp.', tags: ['Nữ phổ thông', 'Tin tức', 'Miền Bắc'] },
    { voice_id: 'BV560_streaming', display_name: 'Alex Đại Đế', lang: 'vi', gender: 'male', description: 'Giọng nam trầm ấm, quyền uy, cực kỳ phù hợp phim hành động, khoa học viễn tưởng.', tags: ['Nam trầm', 'Hành động', 'Kịch tính'] },
    { voice_id: 'BV075_streaming_vibrato_dsp', display_name: 'Việt Méo (Hài Hước)', lang: 'vi', gender: 'male', description: 'Giọng rung ngân độc lạ, hài hước, giải trí cao độ cho meme và clip ngắn.', tags: ['Hài hước', 'Parody', 'Độc lạ'] },
    { voice_id: 'BV074_streaming_dsp', display_name: 'Giọng Bé Nhí Nhảnh', lang: 'vi', gender: 'female', description: 'Giọng trẻ em dễ thương, ngộ nghĩnh, dùng cho nội dung thiếu nhi hoạt hình.', tags: ['Trẻ em', 'Hoạt hình', 'Dễ thương'] },
    { voice_id: 'multi_female_peiqi_uranus_bigtts', display_name: 'Giọng Gái Mới Lớn', lang: 'vi', gender: 'female', description: 'Giọng nữ trẻ trung, điệu đà, phong cách Gen Z năng động.', tags: ['Gen Z', 'Điệu đà', 'Nữ sinh'] },
    { voice_id: 'multi_female_tianmeijieshuo_uranus_bigtts', display_name: 'Nữ Thuyết Minh Ngọt Ngào', lang: 'vi', gender: 'female', description: 'Giọng nữ thuyết minh chuyên nghiệp cho các phim ngắn, drama gia đình.', tags: ['Thuyết minh', 'Drama', 'Kể chuyện'] },
    { voice_id: 'ICL_en_male_philosopher_dsp', display_name: 'Narrator (Cinematic Deep)', lang: 'en', gender: 'male', description: 'Deep, authoritative cinematic narrator voice. Perfect for movie recaps and documentaries.', tags: ['Cinematic', 'Deep', 'Narrator'] },
    { voice_id: 'DiT_en_female_jessie', display_name: 'Jessie (TikTok Viral)', lang: 'en', gender: 'female', description: 'The iconic, upbeat viral female TikTok voice recognized worldwide.', tags: ['TikTok Iconic', 'Viral', 'Upbeat'] },
    { voice_id: 'en_male_deadpool', display_name: 'Deadpool (Witty & Comic)', lang: 'en', gender: 'male', description: 'Sarcastic, humorous, energetic voice full of attitude and personality.', tags: ['Comic', 'Sarcastic', 'Hero'] },
    { voice_id: 'en_female_emotional_moon_bigtts', display_name: 'Emotional Drama', lang: 'en', gender: 'female', description: 'Highly expressive female voice with dramatic nuances and emotional range.', tags: ['Emotional', 'Drama', 'Storytelling'] },
    { voice_id: 'en_female_soothing_mars_bigtts', display_name: 'Female Teacher (Soothing)', lang: 'en', gender: 'female', description: 'Warm, gentle, clear and soothing educational storytelling voice.', tags: ['Soothing', 'Warm', 'Educational'] },
    { voice_id: 'en_us_002', display_name: 'EN US Standard Male', lang: 'en', gender: 'male', description: 'Clean, broadcast-grade standard American male voice.', tags: ['Standard', 'Broadcast', 'American'] },
    { voice_id: 'en_female_sherry', display_name: 'Sherry (Natural Chat)', lang: 'en', gender: 'female', description: 'Casual, friendly conversational American female voice.', tags: ['Casual', 'Friendly', 'Natural'] },
  ],
  gemini: [
    { voice_id: 'Puck', display_name: 'Puck (Upbeat & Energetic)', lang: 'all', gender: 'male', description: 'Giọng nam vui tươi, hoạt náo, tràn đầy năng lượng, phù hợp giải trí và vlog ngắn.', tags: ['Vui tươi', 'Sôi nổi', 'Hoạt náo'] },
    { voice_id: 'Kore', display_name: 'Kore (Firm & Decisive)', lang: 'all', gender: 'female', description: 'Giọng nữ đanh thép, quyết đoán, rõ ràng, phù hợp bài giảng và phóng sự tin tức.', tags: ['Quyết đoán', 'Rõ ràng', 'Phóng sự'] },
    { voice_id: 'Zephyr', display_name: 'Zephyr (Bright & Friendly)', lang: 'all', gender: 'female', description: 'Giọng nữ tươi sáng, thân thiện, mang lại cảm giác ấm áp và gần gũi.', tags: ['Tươi sáng', 'Thân thiện', 'Tự nhiên'] },
    { voice_id: 'Fenrir', display_name: 'Fenrir (Excitable & Bold)', lang: 'all', gender: 'male', description: 'Giọng nam phấn khích, hào hứng, tạo kịch tính cho phim hành động và thể thao.', tags: ['Hào hứng', 'Kịch tính', 'Hành động'] },
    { voice_id: 'Aoede', display_name: 'Aoede (Breezy & Relaxed)', lang: 'all', gender: 'female', description: 'Giọng nữ phóng khoáng, thư giãn, êm ả, phù hợp nội dung du lịch và ẩm thực.', tags: ['Thư giãn', 'Phóng khoáng', 'Du lịch'] },
    { voice_id: 'Sulafat', display_name: 'Sulafat (Warm Storyteller)', lang: 'all', gender: 'female', description: 'Giọng nữ ấm áp, truyền cảm, hoàn hảo cho kể chuyện và tóm tắt tiểu thuyết.', tags: ['Ấm áp', 'Kể chuyện', 'Truyền cảm'] },
    { voice_id: 'Charon', display_name: 'Charon (Informative & Steady)', lang: 'all', gender: 'male', description: 'Giọng nam trầm ổn, chuẩn mực chuyên gia, thích hợp thuyết minh tài liệu khoa học.', tags: ['Trầm ổn', 'Tài liệu', 'Khoa học'] },
    { voice_id: 'Enceladus', display_name: 'Enceladus (Breathy & Mysterious)', lang: 'all', gender: 'male', description: 'Giọng nam thì thầm, hơi thở bí ẩn, thích hợp phim kinh dị, trinh thám.', tags: ['Thì thầm', 'Bí ẩn', 'Trinh thám'] },
    { voice_id: 'Leda', display_name: 'Leda (Youthful & Casual)', lang: 'all', gender: 'female', description: 'Giọng nữ thanh thiếu niên trẻ trung, đối thoại tự nhiên hàng ngày.', tags: ['Trẻ trung', 'Gen Z', 'Hàng ngày'] },
    { voice_id: 'Orus', display_name: 'Orus (Authoritative Deep)', lang: 'all', gender: 'male', description: 'Giọng nam quyền lực, trầm vang, phong thái lãnh đạo và giới thiệu phim điện ảnh.', tags: ['Quyền lực', 'Trầm vang', 'Trailer Phim'] },
    { voice_id: 'Despina', display_name: 'Despina (Smooth Narrator)', lang: 'all', gender: 'female', description: 'Giọng nữ mượt mà, phát âm lưu loát, chuẩn audiobook chuyên nghiệp.', tags: ['Mượt mà', 'Audiobook', 'Chuyên nghiệp'] },
    { voice_id: 'Algenib', display_name: 'Algenib (Gravelly & Gritty)', lang: 'all', gender: 'male', description: 'Giọng nam khàn gai góc, phong trần, đậm chất nhân vật điện ảnh cổ điển.', tags: ['Khàn', 'Gai góc', 'Điện ảnh'] },
  ],
};

const GEMINI_STYLE_PRESETS = [
  { id: 'dramatic', label: '🎬 Kịch Tính', desc: 'Cao trào, dồn dập, phim điện ảnh giật gân' },
  { id: 'cheerful', label: '😄 Vui Tươi', desc: 'Năng động, tươi sáng, hài hước, hoạt hình' },
  { id: 'whisper', label: '🤫 Thì Thầm', desc: 'Bí ẩn, chậm rãi, phim kinh dị / trinh thám' },
  { id: 'serious', label: '🎙️ Trang Trọng', desc: 'Trầm ổn, chuyên nghiệp, tin tức & phóng sự' },
  { id: 'emotional', label: '💔 Xúc Động', desc: 'Nghẹn ngào, lắng đọng, tâm lý xã hội sâu sắc' },
  { id: 'natural', label: '☕ Tự Nhiên', desc: 'Gần gũi, đời thường, vlog & review đời sống' },
];

interface GlobalSettingsViewProps {
  presets: PresetProfile[];
  onSavePresets: (presets: PresetProfile[]) => void;
  onSelectPreset?: (preset: PresetProfile) => void;
  onSwitchToDashboard: () => void;
  onSwitchToStudio?: () => void;
  onOpenKeyPool?: () => void;
  initialTab?: 'ocr' | 'translation' | 'dubbing' | 'render' | 'device' | 'batch';
  onTabChange?: (tab: 'ocr' | 'translation' | 'dubbing' | 'render' | 'device' | 'batch') => void;
}

/** OCR tuning fields introduced by the PP-OCRv5/NVDEC pipeline.
 * Kept local to this view until the shared API contract is versioned; values
 * are still persisted transparently by apiClient.savePipelineSettings().
 */
type OcrEnhancementSettings = {
  primary_backend?: 'rapidocr' | 'ppocrv5' | 'paddle' | 'auto';
  ppocr_model_tier?: 'mobile' | 'server';
  recognition_batch_size?: number;
  enable_nvdec_hwaccel?: boolean;
  nvdec_device_id?: number;
  enable_anti_noise_funnel?: boolean;
  anti_noise_ar_min?: number;
  anti_noise_h_max?: number;
  anti_noise_swt_cov_max?: number;
  anti_noise_lum_min?: number;
  hardware_tuning_mode?: 'auto' | 'manual';
};

type EnhancedOcrSettings = GlobalPipelineSettings['ocr'] & OcrEnhancementSettings;

export const GlobalSettingsView: React.FC<GlobalSettingsViewProps> = ({
  presets,
  onSavePresets,
  onSelectPreset,
  onSwitchToDashboard,
  onSwitchToStudio,
  onOpenKeyPool,
  initialTab = 'ocr',
  onTabChange,
}) => {
  const [activeTab, setActiveTab] = useState<'ocr' | 'translation' | 'dubbing' | 'render' | 'device' | 'batch'>(initialTab);

  useEffect(() => {
    if (initialTab && initialTab !== activeTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    onTabChange?.(activeTab);
  }, [activeTab, onTabChange]);

  // Settings state
  const [settings, setSettings] = useState<GlobalPipelineSettings>({
    ocr: {
      mode: 'api',
      local_engine: 'pure_ocr',
      api_provider: 'capcut',
      api_fusion_mode: 'hybrid_ocr',
      capcut_api_endpoint: 'https://editor-api-sg.capcutapi.com',
      capcut_session_token: '',
      capcut_mode: 'cloud_api',
      method: 'ocr',
      engine: 'rapidocr',
      default_source_lang: 'auto',
      sample_fps: 2.5,
      diff_threshold: 2.5,
      enable_gap_rescue: true,
      enable_roi_tightening: true,
      vlm_provider: 'gemini',
      vlm_prompt_style: 'accurate_dialogue',
      demux_fallback_to_ocr: true,
      demux_stream_lang: 'auto',
      // PP-OCRv5 acceleration defaults (safe on CPU-only machines)
      primary_backend: 'rapidocr',
      ppocr_model_tier: 'mobile',
      recognition_batch_size: 16,
      enable_nvdec_hwaccel: false,
      nvdec_device_id: 0,
      enable_anti_noise_funnel: true,
      anti_noise_ar_min: 0.88,
      anti_noise_h_max: 130,
      anti_noise_swt_cov_max: 0.4,
      anti_noise_lum_min: 135,
      hardware_tuning_mode: 'auto',
    } as EnhancedOcrSettings,
    translation: {
      provider: 'gemini',
      target_language: 'vi',
      gemini_model: 'gemini-2.5-flash',
      local_model: 'qwen2.5:7b-instruct',
      local_endpoint: 'http://localhost:11434',
      auto_fallback: true,
      batch_size: 35,
      prompt_tone: 'dramatic',
      use_glossary: true,
    },

    dubbing: {
      provider: 'capcut',
      mode: 'single',
      voice: 'vi-VN-NamMinhNeural',
      voice_male: 'vi-VN-NamMinhNeural',
      voice_female: 'vi-VN-HoaiMyNeural',
      auto_detect_speakers: true,
      gemini_prompt_style: 'dramatic',
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
  } as GlobalPipelineSettings);

  const enhancedOcr = settings.ocr as EnhancedOcrSettings;
  const updateOcrEnhancement = (patch: Partial<EnhancedOcrSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ocr: { ...prev.ocr, ...patch } as EnhancedOcrSettings,
    }));
  };

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const isInitialSettingsLoaded = useRef(false);

  // Live Test Translation State
  const [testText, setTestText] = useState('打车五分钟到，车都在来的路上了');
  const [testTransResult, setTestTransResult] = useState<TestTranslationResult | null>(null);
  const [isTranslatingTest, setIsTranslatingTest] = useState(false);

  // Live Test Dubbing & Multi-Provider State
  const [ttsCatalog, setTtsCatalog] = useState<Record<string, Array<{
    voice_id: string;
    display_name: string;
    lang: string;
    gender: string;
    description: string;
    tags: string[];
    resource_id?: string;
  }>>>(DEFAULT_TTS_CATALOG);
  const [ttsLangFilter, setTtsLangFilter] = useState<'all' | 'vi' | 'en' | 'zh' | 'ja' | 'ko' | 'other'>('all');
  const [ttsGenderFilter, setTtsGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [ttsSearchQuery, setTtsSearchQuery] = useState<string>('');
  const [activeVoicePreviewing, setActiveVoicePreviewing] = useState<string | null>(null);
  const [playingPreviewVoice, setPlayingPreviewVoice] = useState<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
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
      const ep =
        !settings.ocr.capcut_api_endpoint || settings.ocr.capcut_api_endpoint.includes('edit-api-sg.capcut.com')
          ? 'https://editor-api-sg.capcutapi.com'
          : settings.ocr.capcut_api_endpoint;
      const res = await apiClient.testCapCutConnection({
        endpoint: ep,
      });
      setCapcutTestResult(res);
    } catch (err: any) {
      setCapcutTestResult({
        ok: false,
        endpoint: 'https://editor-api-sg.capcutapi.com',
        latency_ms: 0,
        message: `Lỗi kết nối máy chủ CapCut: ${err?.message || 'Không phản hồi'}`,
      });
    } finally {
      setIsTestingCapCut(false);
    }
  };

  // Retired Groq state is intentionally inert and never loaded/rendered.
  // Kept only to avoid breaking persisted legacy settings during migration.
  const [isTestingGroq] = useState(false);
  const [groqTestResult] = useState<{
    ok: boolean; latency_ms: number; message: string; models_count?: number;
  } | null>(null);
  const handleTestGroqConnection = async () => undefined;
  // Local LLM (Qwen 2.5) Connection Test State
  const [isTestingLocalLlm, setIsTestingLocalLlm] = useState(false);
  const [localLlmTestResult, setLocalLlmTestResult] = useState<{
    ok: boolean;
    latency_ms: number;
    message: string;
    models: string[];
    has_target_model: boolean;
  } | null>(null);

  const handleTestLocalLlm = async () => {
    setIsTestingLocalLlm(true);
    setLocalLlmTestResult(null);
    try {
      const res = await apiClient.testLocalLlmConnection({
        endpoint: settings.translation.local_endpoint || 'http://localhost:11434',
        model: settings.translation.local_model || 'qwen2.5:7b-instruct',
      });
      setLocalLlmTestResult(res);
    } catch (err: any) {
      setLocalLlmTestResult({
        ok: false,
        latency_ms: 0,
        message: `Lỗi kết nối máy chủ Local LLM: ${err?.message || 'Không phản hồi'}`,
        models: [],
        has_target_model: false,
      });
    } finally {
      setIsTestingLocalLlm(false);
    }
  };

  const [isStartingLocalLlm, setIsStartingLocalLlm] = useState(false);

  const [groqPoolStatus] = useState<GroqPoolStatus | null>(null);
  const [groqPoolInputKeys] = useState<string>('');
  const [isVerifyingGroqPool] = useState(false);
  const [isSavingGroqPoolKeys] = useState(false);
  const [groqPoolKeyFilter] = useState<'all' | 'usable' | 'cooldown'>('all');
  const [groqPoolSearchQuery] = useState('');
  const [copiedGroqKeyIndex] = useState<number | null>(null);
  const [activeGroqPoolSubTab] = useState<'list' | 'input'>('list');
  const handleSaveGroqPoolKeys = async () => undefined;
  const handleVerifyAllGroqKeys = async () => undefined;
  const handleDeleteSingleGroqKey = async (_idx: number) => undefined;
  const setActiveGroqPoolSubTab = (_value: 'list' | 'input') => undefined;
  const setGroqPoolKeyFilter = (_value: 'all' | 'usable' | 'cooldown') => undefined;
  const setGroqPoolSearchQuery = (_value: string) => undefined;
  const setCopiedGroqKeyIndex = (_value: number | null) => undefined;
  const setGroqPoolInputKeys = (_value: string) => undefined;
  const loadGroqPool = async () => undefined;

  const handleStartLocalLlm = async () => {
    setIsStartingLocalLlm(true);
    appLogger.loading('Đang khởi động tiến trình Ollama cục bộ...', { taskKey: 'start-ollama', category: 'Ollama' });
    try {
      const res = await apiClient.startLocalLlm();
      appLogger.success(res.message || 'Đã khởi động Ollama thành công!', { taskKey: 'start-ollama', category: 'Ollama' });
      await handleTestLocalLlm();
    } catch (err: any) {
      appLogger.error(`Lỗi khởi động Ollama: ${err?.message || 'Không thành công'}`, { taskKey: 'start-ollama', category: 'Ollama' });
    } finally {
      setIsStartingLocalLlm(false);
    }
  };

  // =========================================================================
  // 5. Cấu hình Thiết Bị Giả Lập & Mạng Proxy State
  // =========================================================================
  const [deviceInfo, setDeviceInfo] = useState<DeviceStatusInfo | null>(null);
  const [isLoadingDevice, setIsLoadingDevice] = useState(false);
  const [isRotatingDevice, setIsRotatingDevice] = useState(false);
  const [deviceRotateMessage, setDeviceRotateMessage] = useState<string | null>(null);
  const [copiedDeviceId, setCopiedDeviceId] = useState(false);
  const [copiedInstallId, setCopiedInstallId] = useState(false);
  const [showCustomDeviceInput, setShowCustomDeviceInput] = useState(false);
  const [customDeviceId, setCustomDeviceId] = useState('');
  const [customInstallId, setCustomInstallId] = useState('');
  const [isSavingCustomDevice, setIsSavingCustomDevice] = useState(false);

  const [isProxyEnabled, setIsProxyEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('sls_proxy_enabled');
    return saved !== null ? saved === 'true' : Boolean(localStorage.getItem('sls_proxy_url'));
  });
  const [rotationInterval, setRotationInterval] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rotation_interval');
    return saved !== null ? parseInt(saved) : 1;
  });
  const [rateLimitDelay, setRateLimitDelay] = useState<number>(() => {
    const saved = localStorage.getItem('sls_rate_limit_delay');
    return saved ? parseFloat(saved) : 2.0;
  });
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem('sls_proxy_url') || '');
  const [proxyTestResult, setProxyTestResult] = useState<{
    ok: boolean;
    ip?: string;
    direct_ip?: string;
    is_masked?: boolean;
    latency_ms?: number;
    error?: string;
  } | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxySaveSuccess, setProxySaveSuccess] = useState(false);

  // =========================================================================
  // 6. Cấu Hình Xuất Hàng Loạt (Batch Export Config) State & Handlers
  // =========================================================================
  const [batchTargetLang, setBatchTargetLang] = useState<string>(() => loadBatchExportConfig().batchTargetLang);
  const [batchDuckingVolume, setBatchDuckingVolume] = useState<number>(() => loadBatchExportConfig().batchDuckingVolume);
  const [batchDubbingEnabled, setBatchDubbingEnabled] = useState<boolean>(() => loadBatchExportConfig().batchDubbingEnabled);
  const [batchDubbingMode, setBatchDubbingMode] = useState<'single' | 'gender_multi'>(() => loadBatchExportConfig().batchDubbingMode);
  const [batchDubbingVoice, setBatchDubbingVoice] = useState<string>(() => loadBatchExportConfig().batchDubbingVoice);
  const [batchDubbingVoiceMale, setBatchDubbingVoiceMale] = useState<string>(() => loadBatchExportConfig().batchDubbingVoiceMale || 'vi-VN-NamMinhNeural');
  const [batchDubbingVoiceFemale, setBatchDubbingVoiceFemale] = useState<string>(() => loadBatchExportConfig().batchDubbingVoiceFemale || 'vi-VN-HoaiMyNeural');
  const [batchDubbingSpeed, setBatchDubbingSpeed] = useState<number>(() => loadBatchExportConfig().batchDubbingSpeed ?? 1.0);
  const [batchExportFormat, setBatchExportFormat] = useState<'mp4' | 'mkv'>(() => loadBatchExportConfig().batchExportFormat);
  const [batchExportResolution, setBatchExportResolution] = useState<'original' | '1080p' | '720p' | '2k'>(() => loadBatchExportConfig().batchExportResolution);
  const [batchExportAspectRatio, setBatchExportAspectRatio] = useState<'original' | '9:16' | '16:9'>(() => loadBatchExportConfig().batchExportAspectRatio);
  const [batchStages, setBatchStages] = useState<{
    ocr: boolean;
    translate: boolean;
    dubbing: boolean;
    export: boolean;
  }>(() => loadBatchExportConfig().batchStages);
  const [activeBatchPresetId, setActiveBatchPresetId] = useState<string>(() => loadBatchExportConfig().activeBatchPresetId || '');
  const [isBatchTestingVoice, setIsBatchTestingVoice] = useState(false);
  const [currentTestingBatchVoice, setCurrentTestingBatchVoice] = useState<string | null>(null);
  const [batchVoiceTestMsg, setBatchVoiceTestMsg] = useState<string | null>(null);

  // Đồng bộ cấu hình Batch khi settings từ server hoặc external event thay đổi
  useEffect(() => {
    if (settings.batch) {
      const reconciled = reconcileBatchConfigWithBackend(loadBatchExportConfig(), settings);
      setBatchTargetLang(reconciled.batchTargetLang);
      setBatchDuckingVolume(reconciled.batchDuckingVolume);
      setBatchDubbingEnabled(reconciled.batchDubbingEnabled);
      setBatchDubbingMode(reconciled.batchDubbingMode);
      setBatchDubbingVoice(reconciled.batchDubbingVoice);
      if (reconciled.batchDubbingVoiceMale) setBatchDubbingVoiceMale(reconciled.batchDubbingVoiceMale);
      if (reconciled.batchDubbingVoiceFemale) setBatchDubbingVoiceFemale(reconciled.batchDubbingVoiceFemale);
      if (reconciled.batchDubbingSpeed !== undefined) setBatchDubbingSpeed(reconciled.batchDubbingSpeed);
      setBatchExportFormat(reconciled.batchExportFormat);
      setBatchExportResolution(reconciled.batchExportResolution);
      setBatchExportAspectRatio(reconciled.batchExportAspectRatio);
      setBatchStages(reconciled.batchStages);
      if (reconciled.activeBatchPresetId) setActiveBatchPresetId(reconciled.activeBatchPresetId);
    }
  }, [settings.batch]);

  // Hàm lưu cấu hình Batch vào cả localStorage và settings.batch
  const handleUpdateBatchConfig = (patch: Partial<BatchExportConfig>) => {
    const updated: BatchExportConfig = {
      batchTargetLang: patch.batchTargetLang !== undefined ? patch.batchTargetLang : batchTargetLang,
      batchDuckingVolume: patch.batchDuckingVolume !== undefined ? patch.batchDuckingVolume : batchDuckingVolume,
      batchDubbingEnabled: patch.batchDubbingEnabled !== undefined ? patch.batchDubbingEnabled : batchDubbingEnabled,
      batchDubbingMode: patch.batchDubbingMode !== undefined ? patch.batchDubbingMode : batchDubbingMode,
      batchDubbingVoice: patch.batchDubbingVoice !== undefined ? patch.batchDubbingVoice : batchDubbingVoice,
      batchDubbingVoiceMale: patch.batchDubbingVoiceMale !== undefined ? patch.batchDubbingVoiceMale : batchDubbingVoiceMale,
      batchDubbingVoiceFemale: patch.batchDubbingVoiceFemale !== undefined ? patch.batchDubbingVoiceFemale : batchDubbingVoiceFemale,
      batchDubbingSpeed: patch.batchDubbingSpeed !== undefined ? patch.batchDubbingSpeed : batchDubbingSpeed,
      batchExportFormat: patch.batchExportFormat !== undefined ? patch.batchExportFormat : batchExportFormat,
      batchExportResolution: patch.batchExportResolution !== undefined ? patch.batchExportResolution : batchExportResolution,
      batchExportAspectRatio: patch.batchExportAspectRatio !== undefined ? patch.batchExportAspectRatio : batchExportAspectRatio,
      batchStages: patch.batchStages !== undefined ? patch.batchStages : batchStages,
      activeBatchPresetId: patch.activeBatchPresetId !== undefined ? patch.activeBatchPresetId : activeBatchPresetId,
    };

    if (patch.batchTargetLang !== undefined) setBatchTargetLang(patch.batchTargetLang);
    if (patch.batchDuckingVolume !== undefined) setBatchDuckingVolume(patch.batchDuckingVolume);
    if (patch.batchDubbingEnabled !== undefined) setBatchDubbingEnabled(patch.batchDubbingEnabled);
    if (patch.batchDubbingMode !== undefined) setBatchDubbingMode(patch.batchDubbingMode);
    if (patch.batchDubbingVoice !== undefined) setBatchDubbingVoice(patch.batchDubbingVoice);
    if (patch.batchDubbingVoiceMale !== undefined) setBatchDubbingVoiceMale(patch.batchDubbingVoiceMale);
    if (patch.batchDubbingVoiceFemale !== undefined) setBatchDubbingVoiceFemale(patch.batchDubbingVoiceFemale);
    if (patch.batchDubbingSpeed !== undefined) setBatchDubbingSpeed(patch.batchDubbingSpeed);
    if (patch.batchExportFormat !== undefined) setBatchExportFormat(patch.batchExportFormat);
    if (patch.batchExportResolution !== undefined) setBatchExportResolution(patch.batchExportResolution);
    if (patch.batchExportAspectRatio !== undefined) setBatchExportAspectRatio(patch.batchExportAspectRatio);
    if (patch.batchStages !== undefined) setBatchStages(patch.batchStages);
    if (patch.activeBatchPresetId !== undefined) setActiveBatchPresetId(patch.activeBatchPresetId);

    saveBatchExportConfig(updated);

    // Cập nhật settings state để trigger debounced auto-save xuống backend
    setSettings((prev) => ({
      ...prev,
      translation: {
        ...prev.translation,
        target_language: (['zh', 'en', 'vi', 'none'].includes(updated.batchTargetLang) ? updated.batchTargetLang : prev.translation.target_language) as any,
      },
      dubbing: {
        ...prev.dubbing,
        enabled: updated.batchDubbingEnabled,
        ducking_volume: updated.batchDuckingVolume / 100,
        voice: updated.batchDubbingVoice || prev.dubbing.voice,
        voice_male: updated.batchDubbingVoiceMale || prev.dubbing.voice_male,
        voice_female: updated.batchDubbingVoiceFemale || prev.dubbing.voice_female,
        speed: updated.batchDubbingSpeed,
        mode: updated.batchDubbingMode === 'gender_multi' ? 'multi' : 'single',
      },
      batch: {
        target_lang: updated.batchTargetLang,
        ducking_volume: updated.batchDuckingVolume,
        dubbing_enabled: updated.batchDubbingEnabled,
        dubbing_mode: updated.batchDubbingMode,
        dubbing_voice: updated.batchDubbingVoice,
        dubbing_voice_male: updated.batchDubbingVoiceMale,
        dubbing_voice_female: updated.batchDubbingVoiceFemale,
        dubbing_speed: updated.batchDubbingSpeed,
        export_format: updated.batchExportFormat,
        export_resolution: updated.batchExportResolution,
        export_aspect_ratio: updated.batchExportAspectRatio,
        stage_ocr: updated.batchStages.ocr,
        stage_translate: updated.batchStages.translate,
        stage_dubbing: updated.batchStages.dubbing,
        stage_export: updated.batchStages.export,
        active_preset_id: updated.activeBatchPresetId,
      },
    }));
  };

  const handleTestBatchVoice = async (targetVoice: string) => {
    if (isBatchTestingVoice && currentTestingBatchVoice === targetVoice) {
      stopCurrentAudio();
      setIsBatchTestingVoice(false);
      setCurrentTestingBatchVoice(null);
      setBatchVoiceTestMsg(null);
      return;
    }

    stopCurrentAudio();
    setIsBatchTestingVoice(true);
    setCurrentTestingBatchVoice(targetVoice);
    setBatchVoiceTestMsg(`Đang tạo âm thanh mẫu (${targetVoice})...`);

    try {
      const prov = detectVoiceProvider(targetVoice);
      const rateStr = batchDubbingSpeed === 1.0 ? '+0%' : (batchDubbingSpeed > 1 ? `+${Math.round((batchDubbingSpeed - 1) * 100)}%` : `-${Math.round((1 - batchDubbingSpeed) * 100)}%`);
      const blob = await apiClient.testDubbing({
        text: 'Xin chào, đây là giọng đọc thử nghiệm của Subtitle Localizer Studio.',
        voice: targetVoice,
        provider: prov,
        rate: rateStr,
      });

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
          setIsBatchTestingVoice(false);
          setCurrentTestingBatchVoice(null);
          setBatchVoiceTestMsg(null);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
          setIsBatchTestingVoice(false);
          setCurrentTestingBatchVoice(null);
          setBatchVoiceTestMsg('Lỗi phát âm thanh');
        }
      };

      await audio.play();
      setBatchVoiceTestMsg(`▶ Đang phát giọng đọc mẫu (${targetVoice})...`);
    } catch (err: any) {
      setBatchVoiceTestMsg(`Chưa thể phát giọng đọc thử: ${err?.message || 'Lỗi kết nối'}`);
      setIsBatchTestingVoice(false);
      setCurrentTestingBatchVoice(null);
    }
  };
  const [proxyHistory, setProxyHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('sls_proxy_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveToProxyHistory = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setProxyHistory((prev) => {
      const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, 4);
      localStorage.setItem('sls_proxy_history', JSON.stringify(next));
      return next;
    });
  };

  const loadDeviceInfo = () => {
    setIsLoadingDevice(true);
    apiClient
      .getDeviceStatus()
      .then((info) => {
        setDeviceInfo(info);
        setCustomDeviceId(info.device_id || '');
        setCustomInstallId(info.install_id || '');
      })
      .catch((err) => console.warn('Could not load device info:', err))
      .finally(() => setIsLoadingDevice(false));
  };

  const handleRotateDeviceNow = async () => {
    setIsRotatingDevice(true);
    setDeviceRotateMessage(null);
    try {
      const res = await apiClient.rotateDevice(proxyUrl.trim() || undefined);
      setDeviceInfo(res);
      setCustomDeviceId(res.device_id);
      setCustomInstallId(res.install_id);
      setDeviceRotateMessage(`Đã cấp thiết bị mới thành công: Device ID ${res.device_id}`);
      appLogger.success(`Đã cấp thiết bị mới thành công: Device ID ${res.device_id}`, 'Thiết bị');
      setTimeout(() => setDeviceRotateMessage(null), 5000);
    } catch (err: any) {
      appLogger.error(`Không thể cấp thiết bị mới: ${err?.message}`, 'Thiết bị');
    } finally {
      setIsRotatingDevice(false);
    }
  };

  const handleSaveCustomDevice = async () => {
    if (!customDeviceId.trim() || !customInstallId.trim()) {
      alert('Vui lòng nhập đầy đủ Device ID và Install ID');
      return;
    }
    setIsSavingCustomDevice(true);
    try {
      const res = await apiClient.saveCustomDevice(customDeviceId.trim(), customInstallId.trim());
      setDeviceInfo(res);
      setShowCustomDeviceInput(false);
      setDeviceRotateMessage('Đã cập nhật định danh thiết bị tùy chỉnh thành công!');
      appLogger.success('Đã cập nhật định danh thiết bị tùy chỉnh', 'Thiết bị');
      setTimeout(() => setDeviceRotateMessage(null), 4000);
    } catch (err: any) {
      appLogger.error(`Lỗi cập nhật thiết bị: ${err?.message}`, 'Thiết bị');
    } finally {
      setIsSavingCustomDevice(false);
    }
  };

  const handleTestProxyConnection = async () => {
    const trimmed = proxyUrl.trim();
    if (!trimmed) {
      setProxyTestResult({ ok: false, error: 'Vui lòng nhập URL Proxy để kiểm tra' });
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const res = await apiClient.testProxy(trimmed);
      setProxyTestResult(res);
      if (res.ok) {
        saveToProxyHistory(trimmed);
        appLogger.success(`Kiểm tra Proxy thành công: IP ${res.ip} (${res.latency_ms}ms)`, 'Mạng Proxy');
      } else {
        appLogger.error(`Kiểm tra Proxy thất bại: ${res.error}`, 'Mạng Proxy');
      }
    } catch (err: any) {
      setProxyTestResult({
        ok: false,
        error: err?.message || 'Không thể kết nối đến Proxy',
      });
      appLogger.error(`Lỗi kiểm tra proxy: ${err?.message}`, 'Mạng Proxy');
    } finally {
      setIsTestingProxy(false);
    }
  };

  const handleSaveProxyAndDeviceConfig = () => {
    const trimmed = proxyUrl.trim();
    localStorage.setItem('sls_proxy_url', trimmed);
    localStorage.setItem('sls_proxy_enabled', String(isProxyEnabled));
    localStorage.setItem('sls_rate_limit_delay', String(rateLimitDelay));
    localStorage.setItem('sls_rotation_interval', String(rotationInterval));
    localStorage.setItem('sls_rotate_device', String(rotationInterval > 0));
    if (trimmed) {
      saveToProxyHistory(trimmed);
    }
    setProxySaveSuccess(true);
    appLogger.success('Đã lưu cấu hình thiết bị & proxy!', 'Hệ thống');
    setTimeout(() => {
      setProxySaveSuccess(false);
    }, 2500);
  };

  const copyToClipboard = (text: string, type: 'device' | 'install') => {
    navigator.clipboard.writeText(text);
    if (type === 'device') {
      setCopiedDeviceId(true);
      setTimeout(() => setCopiedDeviceId(false), 2000);
    } else {
      setCopiedInstallId(true);
      setTimeout(() => setCopiedInstallId(false), 2000);
    }
  };

  useEffect(() => {
    loadPipelineSettings();
    loadHardwareInfo();
    loadGeminiPool();
    loadDeviceInfo();
    // Groq/Whisper retired: no network/API call.
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
      appLogger.success(`Đã lưu thành công ${lines.length} keys vào Gemini Pool!`, 'Gemini Pool');
    } catch (err: any) {
      appLogger.error(`Lỗi khi lưu keys: ${err.message}`, 'Gemini Pool');
    } finally {
      setIsSavingPoolKeys(false);
    }
  };

  const handleVerifyAllKeys = async () => {
    setIsVerifyingPool(true);
    appLogger.loading('Đang kiểm tra tính khả dụng của toàn bộ Gemini keys...', { taskKey: 'verify-gemini', category: 'Gemini Pool' });
    try {
      const res = await apiClient.verifyGeminiKeys();
      setGeminiPoolStatus(res.pool_status);
      const usableCount = (res.pool_status as any)?.usable_keys_count ?? res.pool_status?.active_keys ?? 0;
      const totalCount = res.pool_status?.total_keys ?? 0;
      appLogger.success(`Đã kiểm tra xong Gemini Pool: ${usableCount}/${totalCount} keys khả dụng`, { taskKey: 'verify-gemini', category: 'Gemini Pool' });
    } catch (err: any) {
      appLogger.error(`Lỗi khi kiểm tra keys: ${err.message}`, { taskKey: 'verify-gemini', category: 'Gemini Pool' });
    } finally {
      setIsVerifyingPool(false);
    }
  };

  const handleDeleteSingleKey = async (idx: number) => {
    if (!confirm('Bạn có chắc muốn xoá API Key này khỏi Pool?')) return;
    try {
      const res = await apiClient.deleteGeminiKey(idx);
      setGeminiPoolStatus(res.pool_status);
      appLogger.info('Đã xóa API Key khỏi Gemini Pool', 'Gemini Pool');
    } catch (err: any) {
      appLogger.error(`Lỗi khi xoá key: ${err.message}`, 'Gemini Pool');
    }
  };

  const lastSavedSettingsJson = useRef<string>('');
  const isSyncingFromExternal = useRef<boolean>(false);

  const loadPipelineSettings = async () => {
    try {
      const res = await apiClient.getPipelineSettings();
      setSettings(res);
      lastSavedSettingsJson.current = JSON.stringify(res);
      setTimeout(() => {
        isInitialSettingsLoaded.current = true;
      }, 300);
    } catch (err: any) {
      console.warn('Could not load pipeline settings from server, using local fallback:', err);
      setTimeout(() => {
        isInitialSettingsLoaded.current = true;
      }, 300);
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
      lastSavedSettingsJson.current = JSON.stringify(settings);
      window.dispatchEvent(
        new CustomEvent('pipeline-settings-updated', {
          detail: { ...settings, _source: 'GlobalSettingsView' },
        })
      );
      setSaveSuccessMessage('Đã lưu cấu hình Pipeline toàn cục thành công!');
      appLogger.success('Đã lưu cấu hình Pipeline toàn cục thành công!', 'Cấu hình');
      setTimeout(() => setSaveSuccessMessage(null), 3500);
    } catch (err: any) {
      appLogger.error(`Lỗi khi lưu cấu hình: ${err?.message || 'Không thể lưu'}`, 'Cấu hình');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Tự động lưu cấu hình Pipeline khi có thay đổi từ người dùng (Debounced Auto-Save)
  useEffect(() => {
    const currentJson = JSON.stringify(settings);

    if (!isInitialSettingsLoaded.current) {
      lastSavedSettingsJson.current = currentJson;
      return;
    }

    if (isSyncingFromExternal.current) {
      isSyncingFromExternal.current = false;
      lastSavedSettingsJson.current = currentJson;
      return;
    }

    if (currentJson === lastSavedSettingsJson.current) {
      return;
    }

    lastSavedSettingsJson.current = currentJson;
    setIsSavingSettings(true);

    const timer = setTimeout(async () => {
      try {
        await apiClient.savePipelineSettings(settings);
        window.dispatchEvent(
          new CustomEvent('pipeline-settings-updated', {
            detail: { ...settings, _source: 'GlobalSettingsView' },
          })
        );
        setSaveSuccessMessage('✓ Đã tự động lưu cấu hình');
        setTimeout(() => setSaveSuccessMessage(null), 2500);
      } catch (err: any) {
        console.warn('Lỗi tự động lưu pipeline settings:', err);
      } finally {
        setIsSavingSettings(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [settings]);

  // Lắng nghe cập nhật cấu hình từ các view khác (DashboardBatchHub, Studio Inspector)
  useEffect(() => {
    const handleExternalUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<GlobalPipelineSettings & { _source?: string }>;
      if (!customEvent.detail || customEvent.detail._source === 'GlobalSettingsView') return;

      const newJson = JSON.stringify(customEvent.detail);
      if (newJson === lastSavedSettingsJson.current) return;

      isSyncingFromExternal.current = true;
      lastSavedSettingsJson.current = newJson;

      setSettings((prev) => ({
        ...prev,
        ...customEvent.detail,
      }));
    };
    window.addEventListener('pipeline-settings-updated', handleExternalUpdate);
    return () => {
      window.removeEventListener('pipeline-settings-updated', handleExternalUpdate);
    };
  }, []);

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
        local_model: settings.translation.local_model || 'qwen2.5:7b-instruct',
        local_endpoint: settings.translation.local_endpoint || 'http://localhost:11434',
        auto_fallback: settings.translation.auto_fallback ?? true,
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

  const loadTTSCatalog = async () => {
    try {
      const res = await apiClient.getTTSCatalog();
      if (res && Object.keys(res).length > 0) {
        setTtsCatalog(res);
      }
    } catch (err) {
      console.warn('Could not load TTS catalog:', err);
    }
  };

  const stopCurrentAudio = () => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    setPlayingPreviewVoice(null);
    setActiveVoicePreviewing(null);
  };

  useEffect(() => {
    loadPipelineSettings();
    loadHardwareInfo();
    loadTTSCatalog();

    return () => {
      stopCurrentAudio();
    };
  }, []);

  // Run live test TTS
  const handleTestDubbing = async (overrideVoice?: string, overrideProvider?: string) => {
    if (!testDubbingText.trim()) return;
    const v = overrideVoice || settings.dubbing.voice;
    const detected = detectVoiceProvider(v);
    const p = (detected === 'capcut' || detected === 'gemini' || v.includes('Neural'))
      ? detected
      : (overrideProvider || detected || 'edge');

    // If already playing or generating this voice, clicking acts as Stop
    if (playingPreviewVoice === v || activeVoicePreviewing === v) {
      stopCurrentAudio();
      return;
    }

    // Stop any previous audio playback immediately to avoid overlap
    stopCurrentAudio();

    setActiveVoicePreviewing(v);
    setIsDubbingTest(true);
    try {
      const blob = await apiClient.testDubbing({
        text: testDubbingText.trim(),
        provider: p,
        voice: v,
        rate: settings.dubbing.rate,
        pitch: settings.dubbing.pitch,
        prompt_style: settings.dubbing.gemini_prompt_style || 'dramatic',
      });

      // Singleton Audio Playback
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current = audio;
      setPlayingPreviewVoice(v);

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
          setPlayingPreviewVoice(null);
        }
      };

      audio.onerror = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
          setPlayingPreviewVoice(null);
        }
      };

      await audio.play();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        appLogger.error(`Không thể tạo giọng đọc thử nghiệm (${p}/${v}): ${err?.message}`, 'Lồng tiếng TTS');
      }
    } finally {
      setIsDubbingTest(false);
      setActiveVoicePreviewing(null);
    }
  };

  const handleSelectDubbingProvider = (newProvider: 'edge' | 'capcut' | 'gemini') => {
    let defaultVoice = 'vi-VN-NamMinhNeural';
    let defaultMale = 'vi-VN-NamMinhNeural';
    let defaultFemale = 'vi-VN-HoaiMyNeural';

    if (newProvider === 'capcut') {
      defaultVoice = 'BV075_streaming';
      defaultMale = 'BV075_streaming';
      defaultFemale = 'BV074_streaming';
    } else if (newProvider === 'gemini') {
      defaultVoice = 'Puck';
      defaultMale = 'Puck';
      defaultFemale = 'Kore';
    }

    setSettings({
      ...settings,
      dubbing: {
        ...settings.dubbing,
        provider: newProvider,
        voice: defaultVoice,
        voice_male: defaultMale,
        voice_female: defaultFemale,
        gemini_prompt_style: settings.dubbing.gemini_prompt_style || 'dramatic',
      },
    });
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
      {/* 1. Header Bar Chuyên Nghiệp (Đồng bộ 100% Studio) */}
      <header className="relative h-12 shrink-0 bg-slate-950 border-b border-slate-800/90 px-3 sm:px-4 flex items-center justify-between z-40 text-xs select-none shadow-md gap-2 overflow-x-auto no-scrollbar">
        {/* Cụm Trái: Nút Quay Lại Dashboard & Logo */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <button
            onClick={onSwitchToDashboard}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold shadow-sm transition active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
            title="Quay lại Màn hình Dashboard Batch"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <LayoutDashboard className="w-3.5 h-3.5 shrink-0" />
            <span>Dashboard</span>
          </button>

          {onSwitchToStudio && (
            <button
              onClick={onSwitchToStudio}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold shadow-sm transition active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
              title="Chuyển sang Studio biên tập"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>Studio</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-800 hidden sm:block shrink-0" />

          <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider shrink-0 whitespace-nowrap">
            <div className="p-1 bg-indigo-600 rounded text-white shadow shrink-0">
              <Sliders className="w-3.5 h-3.5" />
            </div>
            <span className="hidden lg:inline">Thiết Lập Hệ Thống</span>
          </div>

          <span className="hidden xl:flex px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-600/40 text-emerald-300 text-[10px] font-semibold items-center gap-1 shrink-0 whitespace-nowrap">
            <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>Cấu Hình Toàn Cục</span>
          </span>
        </div>

        {/* Cụm Phải: Nút Lưu & Quản Lý Keys */}
        <div className="flex items-center gap-2 min-w-0 shrink-0 justify-end ml-auto">
          <button
            onClick={() => {
              if (onOpenKeyPool) {
                onOpenKeyPool();
              } else {
                setActiveTab('translation');
              }
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 text-amber-300 font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
            title="Quản lý Gemini Key Pool"
          >
            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden sm:inline">
              Keys Pool ({geminiPoolStatus ? `${geminiPoolStatus.active_keys}/${geminiPoolStatus.total_keys}` : '...'})
            </span>
          </button>

          <button
            onClick={handleSaveSettings}
            disabled={isSavingSettings}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition disabled:opacity-50 cursor-pointer shrink-0 whitespace-nowrap"
            title="Lưu cấu hình toàn cục vào hệ thống"
          >
            <Save className="w-3.5 h-3.5 shrink-0" />
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
                    : enhancedOcr.primary_backend === 'ppocrv5'
                    ? `PP-OCRv5 ${enhancedOcr.ppocr_model_tier || 'mobile'} (Hình)`
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

            <button
              onClick={() => setActiveTab('device')}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'device'
                  ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/50 shadow-md ring-1 ring-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${activeTab === 'device' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <Smartphone className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div>5. Thiết Bị & Proxy</div>
                <div className="text-[10px] font-normal text-slate-500">Android ID / HTTP Proxy</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('batch')}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                activeTab === 'batch'
                  ? 'bg-cyan-600/25 text-cyan-300 border border-cyan-500/50 shadow-md ring-1 ring-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${activeTab === 'batch' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <Sliders className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div>6. Xuất Hàng Loạt</div>
                <div className="text-[10px] font-normal text-slate-500">Ngôn ngữ, Dubbing, Công đoạn</div>
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
        <div className="flex-1 min-h-0 overflow-y-auto p-6 lg:p-8 space-y-6">
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

              {/* BỘ CHỌN 2 MASTER MODE: LOCAL VS API (COMPACT & CLEAN) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* MASTER MODE 1: LOCAL */}
                <div
                  onClick={() => {
                    setSettings({
                      ...settings,
                      ocr: {
                        ...settings.ocr,
                        mode: 'local',
                        local_engine: 'pure_ocr',
                        method: 'ocr',
                      },
                    });
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between gap-3 ${
                    (settings.ocr.mode === 'local' || !settings.ocr.mode)
                      ? 'bg-indigo-950/80 border-indigo-500 text-white ring-1 ring-indigo-500/60 shadow-md'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🖥️</span>
                    <div>
                      <div className="font-bold text-xs text-white flex items-center gap-2">
                        <span>Mode 1: Pure Local OCR</span>
                        <span className="px-1.5 py-0.2 rounded bg-indigo-900 text-indigo-300 text-[9px] font-mono border border-indigo-700/50 font-bold">
                          Không Whisper
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        RapidOCR ONNX FP16 • Siêu nhẹ ~550MB VRAM • 100% Offline
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-indigo-950 border border-indigo-500/50 text-indigo-300 text-[10px] font-mono font-bold shrink-0">
                    100% Offline • 0đ
                  </span>
                </div>

                {/* MASTER MODE 2: ĐÁM MÂY (MODE API + LOCAL OCR) */}
                <div
                  onClick={() => {
                    const curProv = settings.ocr.api_provider || 'capcut';
                    setSettings({
                      ...settings,
                      ocr: {
                        ...settings.ocr,
                        mode: 'api',
                        api_provider: curProv,
                        api_fusion_mode: 'hybrid_ocr',
                        method: 'ocr',
                      },
                    });
                  }}
                  className={`p-3.5 rounded-xl border cursor-pointer transition flex items-center justify-between gap-3 ${
                    settings.ocr.mode === 'api'
                      ? 'bg-amber-950/80 border-amber-500 text-white ring-1 ring-amber-500/60 shadow-md'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">⚡</span>
                    <div>
                      <div className="font-bold text-xs text-white flex items-center gap-1.5">
                        <span>Mode 2: Cloud ASR + Voice-Gated OCR</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-bold">Siêu Tốc 2.5x</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        CapCut ASR dẫn đường (120x) + RapidOCR GPU quét tập trung • Khớp từng frame (&lt;33ms)
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-amber-950 border border-amber-500/50 text-amber-300 text-[10px] font-mono font-bold shrink-0">
                    Nhanh gấp 2.25x • Auto Fallback
                  </span>
                </div>
              </div>

              {/* Tự động Fallback về Local khi Cloud lỗi */}
              <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800 flex items-center justify-between text-xs">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.ocr.auto_fallback ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        ocr: { ...settings.ocr, auto_fallback: e.target.checked },
                      })
                    }
                    className="rounded accent-emerald-500 cursor-pointer"
                  />
                  <span className="text-slate-300 font-medium">
                    🛡️ Cứu hộ tự động (Auto-Failover): Tự động chuyển sang Pure Local OCR (GPU RTX 3050) nếu Cloud API gặp sự cố hoặc mất mạng
                  </span>
                </label>
                <span className="text-[10px] text-emerald-400 font-mono font-bold shrink-0 ml-2">Luôn sẵn sàng</span>
              </div>

              {/* PP-OCRv5 + NVDEC acceleration controls */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-cyan-900/60 space-y-4 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-cyan-400" />
                      <span>PP-OCRv5 Tăng Tốc & Lọc Nhiễu</span>
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Nhận dạng chữ chuyên sâu trên GPU, giải mã NVDEC và tự tối ưu batch theo VRAM.
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${enhancedOcr.primary_backend === 'ppocrv5' ? 'bg-cyan-950 border-cyan-700 text-cyan-300' : enhancedOcr.primary_backend === 'auto' ? 'bg-indigo-950 border-indigo-700 text-indigo-300' : 'bg-slate-950 border-slate-700 text-slate-400'}`}>
                    {enhancedOcr.primary_backend === 'ppocrv5' ? 'PP-OCRv5 ACTIVE' : enhancedOcr.primary_backend === 'auto' ? 'AUTO-TUNED' : 'RAPIDOCR'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">Động cơ OCR chính:</label>
                    <select
                      value={enhancedOcr.primary_backend || enhancedOcr.engine || 'rapidocr'}
                      onChange={(e) => {
                        const value = e.target.value as OcrEnhancementSettings['primary_backend'];
                        updateOcrEnhancement({ primary_backend: value, engine: value === 'ppocrv5' ? 'ppocrv5-mobile' : 'rapidocr' });
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="rapidocr">RapidOCR (tương thích / nhẹ)</option>
                      <option value="ppocrv5">PP-OCRv5 (chính xác cao, khuyên dùng)</option>
                      <option value="auto">Tự động (hardware tuner)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">PP-OCRv5 model:</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['mobile', 'server'] as const).map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => updateOcrEnhancement({ ppocr_model_tier: tier, primary_backend: 'ppocrv5', engine: tier === 'server' ? 'ppocrv5-server' : 'ppocrv5-mobile' })}
                          className={`p-2.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${enhancedOcr.ppocr_model_tier === tier ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200 ring-1 ring-cyan-500/40' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'}`}
                        >
                          {tier === 'mobile' ? 'Mobile · VRAM thấp' : 'Server · chính xác cao'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold text-slate-300">Recognition batch:</label>
                      <span className="text-[10px] text-cyan-300 font-mono">{enhancedOcr.recognition_batch_size || 16}</span>
                    </div>
                    <select
                      value={enhancedOcr.recognition_batch_size || 16}
                      onChange={(e) => updateOcrEnhancement({ recognition_batch_size: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                    >
                      {[8, 16, 32, 64].map((size) => <option key={size} value={size}>{size} ảnh/lô{size === 64 ? ' (VRAM cao)' : ''}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">Hardware tuning:</label>
                    <select
                      value={enhancedOcr.hardware_tuning_mode || 'auto'}
                      onChange={(e) => updateOcrEnhancement({ hardware_tuning_mode: e.target.value as OcrEnhancementSettings['hardware_tuning_mode'] })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value="auto">Tự động (khuyến nghị)</option>
                      <option value="manual">Thủ công (giữ batch đã chọn)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-slate-800/70">
                  <label className="flex items-start gap-2.5 cursor-pointer text-xs p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={enhancedOcr.enable_nvdec_hwaccel ?? false}
                      onChange={(e) => updateOcrEnhancement({ enable_nvdec_hwaccel: e.target.checked })}
                      className="rounded accent-cyan-500 cursor-pointer mt-0.5"
                    />
                    <span><span className="text-slate-200 font-medium">Giải mã video bằng NVDEC</span><span className="block text-[10px] text-slate-500 mt-0.5">Giảm tải CPU khi đọc video (tự fallback CPU nếu không khả dụng).</span></span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer text-xs p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={enhancedOcr.enable_anti_noise_funnel ?? true}
                      onChange={(e) => updateOcrEnhancement({ enable_anti_noise_funnel: e.target.checked })}
                      className="rounded accent-emerald-500 cursor-pointer mt-0.5"
                    />
                    <span><span className="text-slate-200 font-medium">Anti-Noise Funnel</span><span className="block text-[10px] text-slate-500 mt-0.5">Loại box/logo rác trước khi nhận dạng, tăng precision phụ đề.</span></span>
                  </label>
                </div>
              </div>

              {/* BỘ CHỌN SUB-ENGINE KHI Ở MODE API */}
              {settings.ocr.mode === 'api' && (
                /* Sub-engine chooser for Mode API */
                <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-900/50 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                      <span>☁️</span>
                      <span>Chọn Nhà Cung Cấp API Trong Mode API:</span>
                    </label>
                    <span className="text-[10px] text-amber-400 font-mono font-semibold">Đám Mây Trực Tuyến</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                          VLM 2.5 Flash
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        AI thị giác video đa phương thức. Vừa nhìn hình vừa hiểu cốt truyện, đọc chuẩn chữ thư pháp và tự động xoay tua 43 keys.
                      </p>
                    </div>

                    {/* API Provider 2: CapCut Cloud AI */}
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
                          ? 'bg-purple-950/90 border-purple-400 text-white ring-1 ring-purple-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <span className="text-base">🎵</span>
                          <span>CapCut Cloud AI</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 text-[9px] font-mono border border-purple-700/50">
                          Miễn Phí • No Login
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Trích xuất phụ đề tự động trực tiếp từ hạ tầng đám mây ByteDance AI. Nhanh, chuẩn xác từng microsecond, hoàn toàn miễn phí và không cần tài khoản.
                      </p>
                    </div>

                    {/* API Provider 3 removed: Groq/Whisper is not supported */}
                    <div
                      onClick={() =>
                        setSettings({
                          ...settings,
                          ocr: {
                            ...settings.ocr,
                            api_provider: 'groq',
                            method: 'asr_whisper',
                          },
                        })
                      }
                      className={`hidden p-4 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                        settings.ocr.api_provider === 'groq'
                          ? 'bg-emerald-950/90 border-emerald-400 text-white ring-1 ring-emerald-400 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-xs flex items-center gap-1.5">
                          <Zap className="w-4 h-4 text-emerald-400" />
                          <span>Groq Whisper Cloud</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[9px] font-mono border border-emerald-700/50">
                          Large-v3 • 0.5s
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Chíp chuyên dụng LPU siêu tốc (~250x realtime). Độ chính xác Whisper Large-v3 cao nhất thế giới, miễn phí 2,000 req/ngày.
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

              {/* CẤU HÌNH MODE 1: PURE LOCAL OCR ENGINE (NHẸ - 0 MB WHISPER - TỐI ƯU TOÀN CẦU) */}
              {(settings.ocr.mode === 'local' || !settings.ocr.mode) && (
                <div className="hidden p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span className="text-base">⚙️</span>
                      <span>Tinh Chỉnh Động Cơ Thị Giác Cục Bộ (Pure Local OCR Engine)</span>
                    </div>
                    <span className="text-[10px] text-cyan-300 font-mono font-semibold bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-800/50">
                      RapidOCR ONNX FP16 • Siêu nhẹ ~550MB VRAM • 0 MB Whisper
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* CỘT 1: LẤY MẪU & ĐỊNH VỊ KHUNG HÌNH */}
                    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                      <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5 border-b border-slate-800/60 pb-1.5">
                        <span>👁️</span>
                        <span>Kênh Lấy Mẫu & Định Vị Khung Hình</span>
                      </div>

                      <div className="space-y-3 pt-1">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-slate-300">Tần suất lấy mẫu (Adaptive FPS):</span>
                            <span className="font-mono font-bold text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800/60 text-[11px]">
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
                            className="w-full accent-cyan-500 cursor-pointer"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-slate-300">Ngưỡng phát hiện biến đổi cảnh:</span>
                            <span className="font-mono font-bold text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800/60 text-[11px]">
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
                            className="w-full accent-cyan-500 cursor-pointer"
                          />
                        </div>

                        <div className="space-y-2 pt-1 border-t border-slate-800/50">
                          <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={settings.ocr.enable_roi_tightening ?? true}
                              onChange={(e) =>
                                setSettings({ ...settings, ocr: { ...settings.ocr, enable_roi_tightening: e.target.checked } })
                              }
                              className="rounded accent-cyan-500 cursor-pointer"
                            />
                            <span className="text-slate-200">Tự co gọn khung che theo chữ (Smart ROI)</span>
                          </label>

                          <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={settings.ocr.enable_gap_rescue ?? true}
                              onChange={(e) =>
                                setSettings({ ...settings, ocr: { ...settings.ocr, enable_gap_rescue: e.target.checked } })
                              }
                              className="rounded accent-cyan-500 cursor-pointer"
                            />
                            <span className="text-slate-200">Cứu phụ đề chớp nhoáng (Auto Gap-Rescue)</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* CỘT 2: BỘ THUẬT TOÁN TỐI ƯU TỐC ĐỘ & CHỐNG RÁC */}
                    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                      <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5 border-b border-slate-800/60 pb-1.5">
                        <span>⚡</span>
                        <span>Bộ Thuật Toán Tăng Tốc & Chống Sub Rác</span>
                      </div>

                      <div className="space-y-2.5 pt-1">
                        <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={settings.ocr.enable_early_exit ?? true}
                            onChange={(e) =>
                              setSettings({ ...settings, ocr: { ...settings.ocr, enable_early_exit: e.target.checked } })
                            }
                            className="rounded accent-emerald-500 cursor-pointer mt-0.5"
                          />
                          <div>
                            <span className="text-slate-200 font-medium">Thoát sớm đa ứng viên (Early-Exit Cascade)</span>
                            <p className="text-[10px] text-slate-400">Dừng suy luận khi độ tin cậy ≥ 0.92, tăng tốc 60% - 70% OCR.</p>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={(settings.ocr.edge_gating_threshold ?? 0.0) >= 0.0}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                ocr: { ...settings.ocr, edge_gating_threshold: e.target.checked ? 1.5 : 0.0 },
                              })
                            }
                            className="rounded accent-emerald-500 cursor-pointer mt-0.5"
                          />
                          <div>
                            <span className="text-slate-200 font-medium">Lọc năng lượng cạnh (VideoSubFinder Edge Gating)</span>
                            <p className="text-[10px] text-slate-400">Bỏ qua frame không có chữ tại Sampler (0ms), giảm 35-45% crops GPU.</p>
                          </div>
                        </label>

                        <div className="pt-2 border-t border-slate-800/50 space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-300">
                            <span className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Bộ lọc chống sub rác (Anti-Trash Lexicon)</span>
                            </span>
                            <span className="text-[10px] text-emerald-400 font-mono font-bold">100% Sạch rác C/CC/D/Y</span>
                          </div>

                          <div className="flex items-center justify-between text-xs text-slate-300">
                            <span className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Căn chỉnh ranh giới Onset (Lead-in -0.06s)</span>
                            </span>
                            <span className="text-[10px] text-cyan-400 font-mono font-bold">Khớp frame &lt;33ms</span>
                          </div>
                        </div>
                      </div>
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

              {/* 5. CHI TIẾT KHI CHỌN MODE API: CAPCUT CLOUD AI */}
              {settings.ocr.mode === 'api' && settings.ocr.api_provider === 'capcut' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <span className="text-base">🎵</span>
                        <span>Cấu Hình CapCut Cloud AI (ByteDance Volcano Engine)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Kết nối trực tiếp hạ tầng đám mây ByteDance Singapore (<code className="text-purple-300 font-mono">editor-api-sg.capcutapi.com</code>).
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-purple-950 border border-purple-700/60 text-purple-300 text-[10px] font-mono font-bold">
                      Trực Tiếp • Không Cần Tài Khoản
                    </span>
                  </div>

                  {/* Thẻ thông tin hoạt động tối giản */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-purple-900/40 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-semibold mb-0.5">CƠ CHẾ KẾT NỐI</div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>Guest Device Identity</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">Không cần tài khoản / Cookie</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-semibold mb-0.5">HẠ TẦNG LƯU TRỮ VOD</div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span>AWS SigV4 Pure Python</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">Tự động nén & upload 16kHz</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                        <div className="text-[10px] text-slate-400 font-semibold mb-0.5">ĐỘ CHUẨN XÁC ASR</div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>ByteDance Auto Caption</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">Chuẩn xác từng từ & microsecond</div>
                      </div>
                    </div>

                    {/* Cụm Kiểm Tra Kết Nối CapCut Cloud */}
                    <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-950/20 border border-purple-900/30 p-3 rounded-lg">
                      <div className="text-xs">
                        <div className="font-bold text-purple-300 flex items-center gap-1.5">
                          <span>📡</span>
                          <span>Trạng Thái Kết Nối Máy Chủ ByteDance:</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Kiểm tra thông tuyến và xác thực VOD token tới cụm máy chủ CapCut AI Singapore.
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

                    {/* Hiển thị kết quả kiểm tra CapCut Cloud */}
                    {capcutTestResult && (
                      <div
                        className={`p-3 rounded-lg text-xs font-mono border flex items-center justify-between animate-in fade-in ${
                          capcutTestResult.ok
                            ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                            : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {capcutTestResult.ok ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          )}
                          <span className="truncate">{capcutTestResult.message}</span>
                        </div>
                        {capcutTestResult.latency_ms && (
                          <div className="font-mono text-[10px] bg-slate-950/80 px-2 py-1 rounded border border-slate-800 shrink-0 ml-2">
                            Độ trễ: {capcutTestResult.latency_ms}ms
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 6. CHI TIẾT KHI CHỌN MODE API: GROQ CLOUD WHISPER LPU */}
              {false && settings.ocr.mode === 'api' && settings.ocr.api_provider === 'groq' && (
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <Zap className="w-4 h-4 text-emerald-400" />
                        <span>Cấu Hình Groq Cloud ASR (Whisper Large-v3 LPU Siêu Tốc)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Tốc độ siêu tốc ~250x-300x realtime (xử lý 1 tập phim 10 phút chỉ trong ~2 giây). Mô hình OpenAI Whisper Large-v3 nguyên bản.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-700/60 text-emerald-300 text-[10px] font-mono font-bold">
                      2,000 Req / Ngày Miễn Phí
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 text-xs">
                    <div>
                      <label className="font-semibold text-slate-300 block mb-1.5">Phiên Bản Whisper LPU:</label>
                      <select
                        value={settings.ocr.groq_model || 'whisper-large-v3'}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, groq_model: e.target.value as any },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="whisper-large-v3">Whisper Large-v3 (Độ chuẩn xác cao nhất thế giới • Khuyên dùng)</option>
                        <option value="whisper-large-v3-turbo">Whisper Large-v3 Turbo (Tối ưu tốc độ phản hồi cực đoan)</option>
                      </select>
                      <div className="text-[10px] text-slate-500 mt-1">
                        Chạy trực tiếp trên cụm chip bán dẫn Groq LPU không cần GPU của bạn.
                      </div>
                    </div>
                  </div>

                  {/* Groq Key Pool Management Panel */}
                  <div className="p-4 rounded-xl bg-slate-950/80 border border-emerald-900/50 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Key className="w-4 h-4 text-emerald-400" />
                          <h4 className="text-xs font-bold text-white">Groq API Key Pool & Tự Động Xoay Tua</h4>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 text-[10px] font-mono">
                            Round-Robin & Cooldown 429
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Tự động phân phối tải qua nhiều keys. Khi một key dính HTTP 429, hệ thống tự chuyển sang key tiếp theo và cách ly tạm thời.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleVerifyAllGroqKeys}
                          disabled={isVerifyingGroqPool || (groqPoolStatus?.total_keys || 0) === 0}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow cursor-pointer"
                          title="Ping kiểm tra trạng thái tất cả các Groq keys trong pool"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${isVerifyingGroqPool ? 'animate-spin text-amber-300' : ''}`} />
                          <span>{isVerifyingGroqPool ? 'Đang kiểm tra...' : 'Kiểm Tra Tất Cả Keys'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={loadGroqPool}
                          className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                          title="Tải lại trạng thái pool"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* 4 Chỉ Số Thông Lượng Groq Pool */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                        <span className="text-[10px] text-slate-400 block font-medium">Tổng số Keys</span>
                        <span className="text-base font-bold text-white font-mono">
                          {groqPoolStatus?.total_keys || 0}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-emerald-900/40 text-center">
                        <span className="text-[10px] text-emerald-400 block font-medium">Khả Dụng</span>
                        <span className="text-base font-bold text-emerald-300 font-mono">
                          {groqPoolStatus?.active_keys || 0}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-amber-900/40 text-center">
                        <span className="text-[10px] text-amber-400 block font-medium">Đang Nghỉ (429)</span>
                        <span className="text-base font-bold text-amber-300 font-mono">
                          {groqPoolStatus?.cooldown_keys || 0}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-cyan-900/40 text-center">
                        <span className="text-[10px] text-cyan-400 block font-medium">Quota Ước Tính</span>
                        <span className="text-base font-bold text-cyan-300 font-mono">
                          {((groqPoolStatus?.active_keys || 0) * 2000).toLocaleString()}{' '}
                          <span className="text-[10px] font-normal text-slate-400">Req/ngày</span>
                        </span>
                      </div>
                    </div>

                    {/* Sub-tabs: Danh sách Keys vs Nhập Hàng Loạt */}
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveGroqPoolSubTab('list')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                            activeGroqPoolSubTab === 'list'
                              ? 'bg-emerald-600 text-white shadow'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          <Key className="w-3.5 h-3.5" />
                          <span>Danh Sách Keys ({groqPoolStatus?.total_keys || 0})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveGroqPoolSubTab('input')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                            activeGroqPoolSubTab === 'input'
                              ? 'bg-emerald-600 text-white shadow'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Thêm / Cập Nhật Keys</span>
                        </button>
                      </div>

                      {activeGroqPoolSubTab === 'list' && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setGroqPoolKeyFilter('all')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                              groqPoolKeyFilter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'
                            }`}
                          >
                            Tất cả ({groqPoolStatus?.total_keys || 0})
                          </button>
                          <button
                            type="button"
                            onClick={() => setGroqPoolKeyFilter('usable')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                              groqPoolKeyFilter === 'usable'
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50'
                                : 'text-slate-400 hover:text-emerald-400'
                            }`}
                          >
                            Khả dụng ({groqPoolStatus?.active_keys || 0})
                          </button>
                          <button
                            type="button"
                            onClick={() => setGroqPoolKeyFilter('cooldown')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                              groqPoolKeyFilter === 'cooldown'
                                ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50'
                                : 'text-slate-400 hover:text-amber-400'
                            }`}
                          >
                            Đang nghỉ ({groqPoolStatus?.cooldown_keys || 0})
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Sub-tab 1: Danh Sách Keys */}
                    {activeGroqPoolSubTab === 'list' && (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={groqPoolSearchQuery}
                            onChange={(e) => setGroqPoolSearchQuery(e.target.value)}
                            placeholder="Tìm kiếm theo đuôi key..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                          />
                        </div>

                        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                          {(!groqPoolStatus?.items || groqPoolStatus!.items.length === 0) ? (
                            <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl">
                              <Key className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                              <p className="text-xs text-slate-400">Chưa có API key nào trong Groq Key Pool.</p>
                              <div className="flex items-center justify-center gap-3 mt-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveGroqPoolSubTab('input')}
                                  className="text-xs font-semibold text-emerald-400 hover:underline cursor-pointer"
                                >
                                  + Thêm Key Ngay
                                </button>
                                <span className="text-slate-600">•</span>
                                <a
                                  href="https://console.groq.com/keys"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-slate-400 hover:text-emerald-300 hover:underline flex items-center gap-1"
                                >
                                  <span>Lấy key miễn phí (console.groq.com)</span>
                                  <span>↗</span>
                                </a>
                              </div>
                            </div>
                          ) : (
                            (groqPoolStatus!.items || [])
                              .filter((item) => {
                                if (groqPoolKeyFilter === 'usable' && !item.is_usable) return false;
                                if (groqPoolKeyFilter === 'cooldown' && item.status !== 'cooldown') return false;
                                if (groqPoolSearchQuery.trim()) {
                                  return item.masked_key.toLowerCase().includes(groqPoolSearchQuery.toLowerCase());
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
                                      : 'bg-slate-900 border-slate-800/80 hover:border-slate-700'
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
                                        setCopiedGroqKeyIndex(idx);
                                        setTimeout(() => setCopiedGroqKeyIndex(null), 1500);
                                      }}
                                      className="p-1 text-slate-500 hover:text-slate-300 transition cursor-pointer"
                                      title="Copy masked key"
                                    >
                                      {copiedGroqKeyIndex === idx ? (
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
                                      onClick={() => handleDeleteSingleGroqKey(item.index)}
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
                    {activeGroqPoolSubTab === 'input' && (
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-slate-300">
                              Dán danh sách Groq API Keys (Mỗi dòng một key):
                            </label>
                            <a
                              href="https://console.groq.com/keys"
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1"
                            >
                              <span>Tạo key tại console.groq.com/keys</span>
                              <span>↗</span>
                            </a>
                          </div>
                          <textarea
                            rows={4}
                            value={groqPoolInputKeys}
                            onChange={(e) => setGroqPoolInputKeys(e.target.value)}
                            placeholder={"gsk_1234567890abcdef...\ngsk_abcdef1234567890..."}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">
                            Số keys phát hiện:{' '}
                            <span className="font-bold text-emerald-300 font-mono">
                              {
                                groqPoolInputKeys
                                  .split('\n')
                                  .map((k) => k.trim())
                                  .filter((k) => k.length > 5).length
                              }
                            </span>
                          </span>

                          <button
                            type="button"
                            onClick={handleSaveGroqPoolKeys}
                            disabled={
                              isSavingGroqPoolKeys ||
                              groqPoolInputKeys
                                .split('\n')
                                .map((k) => k.trim())
                                .filter((k) => k.length > 5).length === 0
                            }
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white text-xs font-bold transition shadow cursor-pointer flex items-center gap-1.5"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>{isSavingGroqPoolKeys ? 'Đang lưu...' : 'Lưu Danh Sách Keys'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cụm Kiểm Tra Thử Nghiệm 1 Key Riêng Lẻ */}
                  <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-xl">
                    <div className="text-xs">
                      <div className="font-bold text-slate-200 flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Kiểm Tra Nhanh 1 API Key Riêng Lẻ:</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Xác thực API Key cụ thể và đo độ trễ đường truyền tới cụm máy chủ Groq.
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <input
                        type="password"
                        value={settings.ocr.groq_api_key || ''}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            ocr: { ...settings.ocr, groq_api_key: e.target.value },
                          })
                        }
                        placeholder="gsk_..."
                        className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 font-mono text-[11px] w-48"
                      />
                      <button
                        type="button"
                        onClick={handleTestGroqConnection}
                        disabled={isTestingGroq || !settings.ocr.groq_api_key}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition shadow disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {isTestingGroq ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Kiểm tra...</span>
                          </>
                        ) : (
                          <>
                            <Zap className="w-3 h-3 text-emerald-400" />
                            <span>Test Key</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Hiển thị kết quả kiểm tra Groq */}
                  {groqTestResult && (
                    <div
                      className={`p-3 rounded-xl border text-xs flex items-center justify-between animate-in fade-in ${
                        groqTestResult!.ok
                          ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                          : 'bg-rose-950/60 border-rose-700/60 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {groqTestResult!.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <span className="text-base shrink-0">⚠️</span>
                        )}
                        <span>{groqTestResult!.message}</span>
                      </div>
                      {groqTestResult!.latency_ms > 0 && (
                        <div className="font-mono text-[10px] bg-slate-950/80 px-2 py-1 rounded border border-slate-800 shrink-0 ml-2">
                          Độ trễ: {groqTestResult!.latency_ms}ms
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 2: DỊCH THUẬT AI ================= */}
          {activeTab === 'translation' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* ── Header ── */}
              <div className="pb-4 border-b border-slate-800/60">
                <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-500/15">
                    <Languages className="w-4.5 h-4.5 text-amber-400" />
                  </div>
                  Động Cơ Dịch Thuật
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 ml-9">
                  Chọn engine dịch chính, cấu hình văn phong và quản lý API keys.
                </p>
              </div>

              {/* ── Mode Selector ── */}
              <div className="grid grid-cols-2 gap-3">
                {/* API Mode */}
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, translation: { ...settings.translation, provider: 'gemini' } })}
                  className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                    settings.translation.provider === 'gemini'
                      ? 'bg-amber-500/8 border-amber-500/70 shadow-lg shadow-amber-500/5'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  {settings.translation.provider === 'gemini' && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="w-4.5 h-4.5 text-amber-400" />
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`p-2 rounded-lg ${settings.translation.provider === 'gemini' ? 'bg-amber-500/20' : 'bg-slate-800'}`}>
                      <Sparkles className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Google Gemini AI</div>
                      <div className="text-[10px] text-slate-500 font-mono">Cloud API</div>
                    </div>
                  </div>
                  <p className="text-[10.5px] text-slate-400 leading-relaxed">
                    Dịch theo ngữ cảnh, xưng hô chuẩn xác, văn phong điện ảnh.
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300/80 text-[9px] font-mono border border-amber-800/30">
                      {geminiPoolStatus?.active_keys || 0} keys
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400/80 text-[9px] font-semibold border border-emerald-800/30">
                      Mặc định
                    </span>
                  </div>
                </button>

                {/* Local Mode */}
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, translation: { ...settings.translation, provider: 'local' } })}
                  className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                    settings.translation.provider === 'local' || settings.translation.provider === 'local_model'
                      ? 'bg-cyan-500/8 border-cyan-500/70 shadow-lg shadow-cyan-500/5'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  {(settings.translation.provider === 'local' || settings.translation.provider === 'local_model') && (
                    <div className="absolute top-3 right-3">
                      <CheckCircle2 className="w-4.5 h-4.5 text-cyan-400" />
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`p-2 rounded-lg ${(settings.translation.provider === 'local' || settings.translation.provider === 'local_model') ? 'bg-cyan-500/20' : 'bg-slate-800'}`}>
                      <Cpu className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Qwen 2.5 Local</div>
                      <div className="text-[10px] text-slate-500 font-mono">Ollama • Offline</div>
                    </div>
                  </div>
                  <p className="text-[10.5px] text-slate-400 leading-relaxed">
                    Mô hình mã nguồn mở, chạy 100% cục bộ trên GPU.
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300/80 text-[9px] font-mono border border-cyan-800/30">
                      RTX 3050
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-mono border border-slate-700/50">
                      Riêng tư 100%
                    </span>
                  </div>
                </button>
              </div>

              {/* ── Engine Configuration (conditional on selected mode) ── */}
              {settings.translation.provider === 'gemini' && (
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 overflow-hidden animate-in fade-in duration-200">
                  <div className="px-5 py-3 bg-slate-800/30 border-b border-slate-800/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-slate-200">Cấu Hình Gemini</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {(geminiPoolStatus?.active_keys || 0) * 15} RPM tối đa
                    </span>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Model</label>
                        <select
                          value={settings.translation.gemini_model}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              translation: { ...settings.translation, gemini_model: e.target.value },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500/60 transition"
                        >
                          <option value="gemini-2.5-flash">Gemini 2.5 Flash — Khuyên dùng (Ổn định, siêu nhanh)</option>
                          <option value="gemini-3.7-flash">Gemini 3.7 Flash — Logic mạnh</option>
                          <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                          <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <div className="w-full p-3 rounded-lg bg-amber-950/15 border border-amber-900/20 text-[11px] text-amber-300/80 leading-relaxed">
                          <span className="font-semibold">⚡ {geminiPoolStatus?.active_keys || 0} keys</span> hoạt động • Phân bổ 15 RPM/key • Tự cách ly 60s khi quá tải
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(settings.translation.provider === 'local' || settings.translation.provider === 'local_model') && (
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 overflow-hidden animate-in fade-in duration-200">
                  <div className="px-5 py-3 bg-slate-800/30 border-b border-slate-800/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-xs font-bold text-slate-200">Cấu Hình Local LLM</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">Offline • Không cần mạng</span>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Model</label>
                        <select
                          value={settings.translation.local_model || 'qwen2.5:7b-instruct'}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              translation: { ...settings.translation, local_model: e.target.value },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/60 transition"
                        >
                          <option value="qwen2.5:7b-instruct">qwen2.5:7b — Khuyên dùng (VRAM ~4.5 GB)</option>
                          <option value="qwen2.5:3b-instruct">qwen2.5:3b — Siêu nhẹ (VRAM ~2.2 GB)</option>
                          <option value="qwen2.5:14b-instruct">qwen2.5:14b — Cao cấp (Cần GPU lớn)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Endpoint</label>
                        <input
                          type="text"
                          value={settings.translation.local_endpoint || 'http://localhost:11434'}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              translation: { ...settings.translation, local_endpoint: e.target.value },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500/60 transition"
                          placeholder="http://localhost:11434"
                        />
                      </div>
                    </div>

                    {/* Connection Controls */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/80 border border-slate-800/60">
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <span>💡</span>
                        <code className="text-cyan-300/80 font-mono px-1 py-0.5 bg-slate-900 rounded text-[10px]">ollama run qwen2.5:7b</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleStartLocalLlm}
                          disabled={isStartingLocalLlm}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                        >
                          {isStartingLocalLlm ? <RefreshCw className="w-3 h-3 animate-spin" /> : <span>🚀</span>}
                          <span>{isStartingLocalLlm ? 'Đang bật...' : 'Khởi động'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleTestLocalLlm}
                          disabled={isTestingLocalLlm}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                        >
                          {isTestingLocalLlm ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          <span>{isTestingLocalLlm ? 'Đang ping...' : 'Ping'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Connection result */}
                    {localLlmTestResult && (
                      <div className={`p-3 rounded-lg border text-xs flex items-center justify-between animate-in fade-in ${
                        localLlmTestResult.ok
                          ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300'
                          : 'bg-amber-950/40 border-amber-800/40 text-amber-300'
                      }`}>
                        <div className="flex items-center gap-2">
                          {localLlmTestResult.ok
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          }
                          <div>
                            <div>{localLlmTestResult.message}</div>
                            {localLlmTestResult.models.length > 0 && (
                              <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                Models: {localLlmTestResult.models.slice(0, 5).join(', ')}
                                {localLlmTestResult.models.length > 5 ? ` (+${localLlmTestResult.models.length - 5})` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0 ml-2">{localLlmTestResult.latency_ms}ms</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Translation Options (always visible) ── */}
              <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 overflow-hidden">
                <div className="px-5 py-3 bg-slate-800/30 border-b border-slate-800/60">
                  <span className="text-xs font-bold text-slate-200">Tùy Chọn Dịch Thuật</span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    {/* Tone */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5">Phong cách</label>
                      <select
                        value={settings.translation.prompt_tone}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            translation: { ...settings.translation, prompt_tone: e.target.value as any },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-amber-500/60 transition"
                      >
                        <option value="dramatic">Kịch tính, điện ảnh</option>
                        <option value="daily">Đời thường, tự nhiên</option>
                        <option value="humorous">Hài hước, dí dỏm</option>
                        <option value="literal">Sát nghĩa gốc</option>
                      </select>
                    </div>

                    {/* Glossary toggle */}
                    <div className="flex items-end">
                      <label className="flex items-center gap-2.5 cursor-pointer w-full p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition text-xs">
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
                        <span className="text-slate-300 font-medium leading-tight">
                          Từ điển tiếng lóng Trung-Việt
                        </span>
                      </label>
                    </div>

                    {/* Auto-failover toggle */}
                    <div className="flex items-end">
                      <label className="flex items-center gap-2.5 cursor-pointer w-full p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition text-xs">
                        <input
                          type="checkbox"
                          checked={settings.translation.auto_fallback ?? true}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              translation: { ...settings.translation, auto_fallback: e.target.checked },
                            })
                          }
                          className="rounded accent-emerald-500 cursor-pointer"
                        />
                        <span className="text-slate-300 font-medium leading-tight">
                          Cứu hộ tự động (Failover)
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Cascade info bar */}
                  <div className="px-3.5 py-2.5 rounded-lg bg-slate-950/60 border border-slate-800/50 text-[10.5px] text-slate-500 flex items-center gap-2">
                    <span className="text-amber-400/70">🛡️</span>
                    <span>
                      <span className="text-slate-400 font-medium">Cascade Fallback:</span> Gemini AI → Local AI (Qwen 2.5 Local)
                    </span>
                    <span className="ml-auto text-slate-600 font-mono shrink-0">35 câu/mẻ</span>
                  </div>
                </div>
              </div>

              {/* ── Gemini Key Pool (only when Gemini selected) ── */}
              {settings.translation.provider === 'gemini' && (
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 overflow-hidden">
                  {/* Pool header */}
                  <div className="px-5 py-3 bg-slate-800/30 border-b border-slate-800/60 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-slate-200">Gemini Key Pool</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/40 text-indigo-300 font-mono">
                        Round-Robin
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleVerifyAllKeys}
                        disabled={isVerifyingPool || (geminiPoolStatus?.total_keys || 0) === 0}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                      >
                        <Sparkles className={`w-3 h-3 ${isVerifyingPool ? 'animate-spin' : ''}`} />
                        <span>{isVerifyingPool ? 'Checking...' : 'Verify All'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={loadGeminiPool}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/60 text-center">
                        <div className="text-[9px] text-slate-500 font-medium uppercase tracking-wider">Total</div>
                        <div className="text-sm font-bold text-white font-mono mt-0.5">{geminiPoolStatus?.total_keys || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/80 border border-emerald-900/30 text-center">
                        <div className="text-[9px] text-emerald-500 font-medium uppercase tracking-wider">Active</div>
                        <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{geminiPoolStatus?.active_keys || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/80 border border-amber-900/30 text-center">
                        <div className="text-[9px] text-amber-500 font-medium uppercase tracking-wider">Cooldown</div>
                        <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">{geminiPoolStatus?.cooldown_keys || 0}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/80 border border-cyan-900/30 text-center">
                        <div className="text-[9px] text-cyan-500 font-medium uppercase tracking-wider">Throughput</div>
                        <div className="text-sm font-bold text-cyan-400 font-mono mt-0.5">
                          {(geminiPoolStatus?.active_keys || 0) * 15}
                          <span className="text-[9px] text-slate-500 font-normal ml-0.5">rpm</span>
                        </div>
                      </div>
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-slate-950/80">
                        <button
                          type="button"
                          onClick={() => setActivePoolSubTab('list')}
                          className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                            activePoolSubTab === 'list'
                              ? 'bg-amber-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Keys ({geminiPoolStatus?.total_keys || 0})
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivePoolSubTab('input')}
                          className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                            activePoolSubTab === 'input'
                              ? 'bg-amber-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Thêm Keys
                        </button>
                      </div>

                      {activePoolSubTab === 'list' && (
                        <div className="flex items-center gap-1">
                          {(['all', 'usable', 'cooldown'] as const).map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setPoolKeyFilter(f)}
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition cursor-pointer ${
                                poolKeyFilter === f
                                  ? f === 'usable' ? 'bg-emerald-900/50 text-emerald-300' : f === 'cooldown' ? 'bg-amber-900/50 text-amber-300' : 'bg-slate-700 text-white'
                                  : 'text-slate-500 hover:text-slate-300'
                              }`}
                            >
                              {f === 'all' ? `Tất cả (${geminiPoolStatus?.total_keys || 0})` : f === 'usable' ? `Active (${geminiPoolStatus?.active_keys || 0})` : `Rest (${geminiPoolStatus?.cooldown_keys || 0})`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Key list */}
                    {activePoolSubTab === 'list' && (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={poolSearchQuery}
                            onChange={(e) => setPoolSearchQuery(e.target.value)}
                            placeholder="Tìm key..."
                            className="w-full bg-slate-950/80 border border-slate-800/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60 transition"
                          />
                        </div>

                        <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5 scrollbar-thin">
                          {(!geminiPoolStatus?.items || geminiPoolStatus.items.length === 0) ? (
                            <div className="text-center py-8">
                              <Key className="w-6 h-6 text-slate-700 mx-auto mb-2" />
                              <p className="text-[11px] text-slate-500">Chưa có key nào.</p>
                              <button type="button" onClick={() => setActivePoolSubTab('input')} className="mt-1.5 text-[11px] font-semibold text-amber-400 hover:underline cursor-pointer">
                                + Thêm key
                              </button>
                            </div>
                          ) : (
                            (geminiPoolStatus.items || [])
                              .filter((item) => {
                                if (poolKeyFilter === 'usable' && !item.is_usable) return false;
                                if (poolKeyFilter === 'cooldown' && item.status !== 'cooldown') return false;
                                if (poolSearchQuery.trim()) return item.masked_key.toLowerCase().includes(poolSearchQuery.toLowerCase());
                                return true;
                              })
                              .map((item, idx) => (
                                <div
                                  key={idx}
                                  className={`px-3 py-2 rounded-lg border flex items-center justify-between text-xs transition ${
                                    item.status === 'cooldown' ? 'bg-amber-950/15 border-amber-900/30'
                                    : !item.is_usable ? 'bg-rose-950/15 border-rose-900/30'
                                    : 'bg-slate-950/60 border-slate-800/50 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono text-[9px] text-slate-600 w-4 text-right">#{idx + 1}</span>
                                    <span className="font-mono text-[11px] text-slate-300 truncate">{item.masked_key}</span>
                                    {item.latency_ms !== undefined && item.latency_ms > 0 && (
                                      <span className="text-[9px] text-slate-600 font-mono">({item.latency_ms}ms)</span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(item.masked_key);
                                        setCopiedKeyIndex(idx);
                                        setTimeout(() => setCopiedKeyIndex(null), 1500);
                                      }}
                                      className="p-0.5 text-slate-600 hover:text-slate-300 transition cursor-pointer"
                                    >
                                      {copiedKeyIndex === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    </button>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {item.status === 'cooldown' ? (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 text-[9px] font-mono border border-amber-800/30">
                                        Rest {item.remaining_seconds}s
                                      </span>
                                    ) : item.is_usable ? (
                                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 text-[9px] font-mono border border-emerald-800/30">OK</span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-400 text-[9px] font-mono border border-rose-800/30">
                                        {item.status_label || 'Err'}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSingleKey(idx)}
                                      className="p-1 rounded text-slate-600 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Add keys */}
                    {activePoolSubTab === 'input' && (
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[11px] font-semibold text-slate-400">Dán API Keys (mỗi dòng 1 key)</label>
                            <span className="text-[10px] text-slate-600">Google AI Studio</span>
                          </div>
                          <textarea
                            rows={4}
                            value={poolInputKeys}
                            onChange={(e) => setPoolInputKeys(e.target.value)}
                            placeholder="AIzaSy...&#10;AIzaSy...&#10;AIzaSy..."
                            className="w-full bg-slate-950/80 border border-slate-800/60 rounded-lg p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 resize-none transition"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-500">
                            Phát hiện: <span className="font-bold text-amber-300 font-mono">
                              {poolInputKeys.split('\n').map((k) => k.trim()).filter((k) => k.length > 5).length}
                            </span> keys
                          </span>
                          <button
                            type="button"
                            onClick={handleSavePoolKeys}
                            disabled={isSavingPoolKeys || poolInputKeys.split('\n').map((k) => k.trim()).filter((k) => k.length > 5).length === 0}
                            className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-bold transition shadow cursor-pointer flex items-center gap-1.5"
                          >
                            <Save className="w-3 h-3" />
                            <span>{isSavingPoolKeys ? 'Saving...' : 'Lưu Keys'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Live Test (compact) ── */}
              <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 overflow-hidden">
                <div className="px-5 py-3 bg-slate-800/30 border-b border-slate-800/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Play className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-slate-200">Dịch Thử Trực Tiếp</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestTranslation}
                    disabled={isTranslatingTest}
                    className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 transition disabled:opacity-50 cursor-pointer"
                  >
                    {isTranslatingTest ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    <span>{isTranslatingTest ? 'Đang dịch...' : 'Dịch thử'}</span>
                  </button>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Câu gốc (Trung)</label>
                      <input
                        type="text"
                        value={testText}
                        onChange={(e) => setTestText(e.target.value)}
                        className="w-full bg-slate-950/80 border border-slate-800/60 rounded-lg p-2.5 text-slate-100 text-xs focus:outline-none focus:border-amber-500/60 transition"
                        placeholder="Nhập câu tiếng Trung..."
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] text-slate-500">Kết quả (Việt)</label>
                        {testTransResult && (
                          <span className="text-[9px] text-slate-600 font-mono">
                            {testTransResult.provider_used} • {testTransResult.latency_ms}ms
                          </span>
                        )}
                      </div>
                      <div className="w-full bg-slate-950/60 border border-slate-800/60 rounded-lg p-2.5 text-cyan-300 font-medium text-xs min-h-[38px] flex items-center">
                        {testTransResult ? testTransResult.translated : <span className="text-slate-600 italic text-[11px]">Kết quả hiển thị ở đây...</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 3: GIỌNG ĐỌC TTS & ÂM THANH ================= */}
          {activeTab === 'dubbing' && (() => {
            const currentProvider = (settings.dubbing.provider as 'edge' | 'capcut' | 'gemini') || 'edge';
            const currentVoiceList = ttsCatalog[currentProvider] || DEFAULT_TTS_CATALOG[currentProvider] || [];

            const countByLang = (langKey: 'all' | 'vi' | 'en' | 'zh' | 'ja' | 'ko' | 'other') => {
              if (langKey === 'all') return currentVoiceList.length;
              if (langKey === 'vi') return currentVoiceList.filter((v) => v.lang === 'vi' || v.lang === 'all').length;
              if (langKey === 'en') return currentVoiceList.filter((v) => v.lang === 'en' || v.lang === 'all').length;
              if (langKey === 'zh') return currentVoiceList.filter((v) => v.lang === 'zh' || v.lang.startsWith('zh')).length;
              if (langKey === 'ja') return currentVoiceList.filter((v) => v.lang === 'ja').length;
              if (langKey === 'ko') return currentVoiceList.filter((v) => v.lang === 'ko').length;
              return currentVoiceList.filter(
                (v) => !['vi', 'en', 'all'].includes(v.lang) && !v.lang.startsWith('zh') && v.lang !== 'ja' && v.lang !== 'ko'
              ).length;
            };

            const filteredVoices = currentVoiceList.filter((v) => {
              // Language filter
              if (ttsLangFilter === 'vi' && !(v.lang === 'vi' || v.lang === 'all')) return false;
              if (ttsLangFilter === 'en' && !(v.lang === 'en' || v.lang === 'all')) return false;
              if (ttsLangFilter === 'zh' && !(v.lang === 'zh' || v.lang.startsWith('zh'))) return false;
              if (ttsLangFilter === 'ja' && v.lang !== 'ja') return false;
              if (ttsLangFilter === 'ko' && v.lang !== 'ko') return false;
              if (ttsLangFilter === 'other' && (['vi', 'en', 'all'].includes(v.lang) || v.lang.startsWith('zh') || v.lang === 'ja' || v.lang === 'ko')) return false;

              // Gender filter
              if (ttsGenderFilter === 'male' && v.gender !== 'male' && v.gender !== 'neutral') return false;
              if (ttsGenderFilter === 'female' && v.gender !== 'female' && v.gender !== 'neutral') return false;

              // Search query
              if (ttsSearchQuery.trim()) {
                const q = ttsSearchQuery.toLowerCase();
                const matchName = (v.display_name || '').toLowerCase().includes(q);
                const matchId = (v.voice_id || '').toLowerCase().includes(q);
                const matchDesc = (v.description || '').toLowerCase().includes(q);
                const matchTags = (v.tags || []).some((t) => (t || '').toLowerCase().includes(q));
                if (!matchName && !matchId && !matchDesc && !matchTags) return false;
              }

              return true;
            });

            const maleVoices = currentVoiceList.filter((v) => v.gender === 'male' || v.gender === 'neutral');
            const femaleVoices = currentVoiceList.filter((v) => v.gender === 'female' || v.gender === 'neutral');

            return (
              <div className="space-y-6 animate-in fade-in duration-150">
                {/* Header */}
                <div className="pb-4 border-b border-slate-800/60 flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-emerald-500/15">
                        <Mic className="w-4.5 h-4.5 text-emerald-400" />
                      </div>
                      Động Cơ Thuyết Minh & Lồng Tiếng Đa Nền Tảng (Multi-Provider TTS)
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 ml-9">
                      Kết hợp Microsoft Edge-TTS, CapCut ByteDance Voice Studio và Google Gemini 3.1 Speech với cơ chế tự động dự phòng (failover).
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      {currentVoiceList.length} giọng sẵn sàng
                    </span>
                  </div>
                </div>

                {/* 1. BỘ CHỌN NỀN TẢNG TTS (PROVIDER SELECTOR) */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>1. Chọn Nền Tảng Giọng Đọc (TTS Provider):</span>
                    </label>
                    <span className="text-[10px] text-slate-500 font-mono">Tự động chuyển tiếp khi gặp sự cố mạng</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Provider 1: Edge-TTS */}
                    <button
                      type="button"
                      onClick={() => handleSelectDubbingProvider('edge')}
                      className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                        currentProvider === 'edge'
                          ? 'bg-emerald-500/10 border-emerald-500/80 shadow-lg shadow-emerald-500/10'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      {currentProvider === 'edge' && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className={`p-2 rounded-lg ${currentProvider === 'edge' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                          <Zap className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">Microsoft Edge-TTS</div>
                          <div className="text-[10px] text-emerald-400 font-mono">Neural Voice • Miễn Phí</div>
                        </div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 leading-relaxed mb-3">
                        Tốc độ sinh âm cực nhanh, ổn định 100%, không cần API Key, chuẩn phát âm truyền cảm.
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[9px] font-mono border border-emerald-800/40">
                          Siêu Tốc & Ổn Định
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-mono border border-slate-700/50">
                          {ttsCatalog.edge?.length || DEFAULT_TTS_CATALOG.edge.length} giọng
                        </span>
                      </div>
                    </button>

                    {/* Provider 2: CapCut */}
                    <button
                      type="button"
                      onClick={() => handleSelectDubbingProvider('capcut')}
                      className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                        currentProvider === 'capcut'
                          ? 'bg-cyan-500/10 border-cyan-500/80 shadow-lg shadow-cyan-500/10'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      {currentProvider === 'capcut' && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle2 className="w-4.5 h-4.5 text-cyan-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className={`p-2 rounded-lg ${currentProvider === 'capcut' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400'}`}>
                          <Flame className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">CapCut Voice Studio</div>
                          <div className="text-[10px] text-cyan-400 font-mono">ByteDance Cloud • Trending</div>
                        </div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 leading-relaxed mb-3">
                        Bộ sưu tập giọng hot TikTok: Thanh Niên Tự Tin, Nhỏ Ngọt Ngào, Mai, Jessie, Deadpool...
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 text-[9px] font-mono border border-cyan-800/40">
                          Viral TikTok / Short
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-mono border border-slate-700/50">
                          {ttsCatalog.capcut?.length || DEFAULT_TTS_CATALOG.capcut.length} giọng
                        </span>
                      </div>
                    </button>

                    {/* Provider 3: Gemini */}
                    <button
                      type="button"
                      onClick={() => handleSelectDubbingProvider('gemini')}
                      className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                        currentProvider === 'gemini'
                          ? 'bg-purple-500/10 border-purple-500/80 shadow-lg shadow-purple-500/10'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      {currentProvider === 'gemini' && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle2 className="w-4.5 h-4.5 text-purple-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className={`p-2 rounded-lg ${currentProvider === 'gemini' ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-800 text-slate-400'}`}>
                          <Wand2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">Google Gemini Speech</div>
                          <div className="text-[10px] text-purple-400 font-mono">Gemini 3.1 Flash • AI Biểu Cảm</div>
                        </div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 leading-relaxed mb-3">
                        Tùy biến sắc thái cảm xúc (kịch tính, thì thầm, phấn khích), tận dụng cụm Key Pool 40+ keys.
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 text-[9px] font-mono border border-purple-800/40">
                          AI Cảm Xúc • Key Pool
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-mono border border-slate-700/50">
                          {ttsCatalog.gemini?.length || DEFAULT_TTS_CATALOG.gemini.length} giọng
                        </span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 2. CẤU HÌNH GEMINI PROMPT STYLE (Nếu chọn Gemini) */}
                {currentProvider === 'gemini' && (
                  <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-900/40 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wand2 className="w-4 h-4 text-purple-400" />
                        <span className="text-xs font-bold text-purple-200">Sắc Thái Cảm Xúc AI (Gemini Speech Style Prompt)</span>
                      </div>
                      <span className="text-[10px] text-purple-400 font-mono">Mô hình: gemini-3.1-flash-tts-preview</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                      {GEMINI_STYLE_PRESETS.map((pst) => (
                        <button
                          key={pst.id}
                          type="button"
                          onClick={() =>
                            setSettings({
                              ...settings,
                              dubbing: { ...settings.dubbing, gemini_prompt_style: pst.id },
                            })
                          }
                          className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                            settings.dubbing.gemini_prompt_style === pst.id
                              ? 'bg-purple-900/50 border-purple-400 text-white shadow'
                              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                          }`}
                        >
                          <div className="font-bold text-xs">{pst.label}</div>
                          <div className="text-[9.5px] text-slate-400 mt-1 line-clamp-2">{pst.desc}</div>
                        </button>
                      ))}
                    </div>
                    <div className="pt-1">
                      <label className="text-[10.5px] text-slate-400 block mb-1">
                        Tuỳ chỉnh câu lệnh sắc thái hoặc chỉ dẫn diễn đạt cho Gemini:
                      </label>
                      <input
                        type="text"
                        value={settings.dubbing.gemini_prompt_style || 'dramatic'}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            dubbing: { ...settings.dubbing, gemini_prompt_style: e.target.value },
                          })
                        }
                        placeholder="Nhập sắc thái mong muốn (ví dụ: dramatic, cinematic trailer, warm bedtime story...)"
                        className="w-full bg-slate-950/80 border border-slate-800/80 rounded-lg p-2 text-xs text-purple-200 focus:outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* 3. BỘ CHỌN 2 MODE: ĐƠN THOẠI (1 NGƯỜI) VS ĐA THOẠI (NHIỀU NGƯỜI PHÂN VAI) */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                    <span>2. Chế Độ Lồng Tiếng:</span>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    {/* Mode 1: Single Speaker */}
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, dubbing: { ...settings.dubbing, mode: 'single' } })}
                      className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                        (!settings.dubbing.mode || settings.dubbing.mode === 'single')
                          ? 'bg-emerald-500/8 border-emerald-500/70 shadow-lg shadow-emerald-500/5'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      {(!settings.dubbing.mode || settings.dubbing.mode === 'single') && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className={`p-2 rounded-lg ${(!settings.dubbing.mode || settings.dubbing.mode === 'single') ? 'bg-emerald-500/20' : 'bg-slate-800'}`}>
                          <Volume2 className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">Lồng Tiếng 1 Người (Đơn Thoại)</div>
                          <div className="text-[10px] text-slate-500 font-mono">Single Speaker • Review / Kể Chuyện</div>
                        </div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 leading-relaxed">
                        Sử dụng 1 giọng đọc duy nhất xuyên suốt video. Phù hợp cho tóm tắt phim, review, tin tức, đọc truyện.
                      </p>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 text-[9px] font-mono border border-emerald-800/30">
                          1 Giọng đọc chính
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-mono border border-slate-700/50">
                          Mặc định ổn định
                        </span>
                      </div>
                    </button>

                    {/* Mode 2: Multi-Speaker */}
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, dubbing: { ...settings.dubbing, mode: 'multi' } })}
                      className={`group relative p-4 rounded-xl border-2 text-left transition-all duration-200 cursor-pointer ${
                        settings.dubbing.mode === 'multi'
                          ? 'bg-purple-500/8 border-purple-500/70 shadow-lg shadow-purple-500/5'
                          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      {settings.dubbing.mode === 'multi' && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle2 className="w-4.5 h-4.5 text-purple-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className={`p-2 rounded-lg ${settings.dubbing.mode === 'multi' ? 'bg-purple-500/20' : 'bg-slate-800'}`}>
                          <Sparkles className="w-4 h-4 text-purple-400" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">Lồng Tiếng Nhiều Người (Phân Vai)</div>
                          <div className="text-[10px] text-purple-400 font-mono">Multi-Speaker • Phim Truyền Hình</div>
                        </div>
                      </div>
                      <p className="text-[10.5px] text-slate-400 leading-relaxed">
                        Tự động nhận diện nhân vật Nam/Nữ theo ngữ cảnh câu thoại. Thoại nam giọng Nam, thoại nữ giọng Nữ.
                      </p>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 text-[9px] font-mono border border-purple-800/30">
                          Đa nhân vật (Nam + Nữ)
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 text-[9px] font-semibold border border-indigo-800/30">
                          AI Tự động phân vai
                        </span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* 4. BỘ LỌC & TÌM KIẾM GIỌNG ĐỌC */}
                <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2.5">
                    {/* Language Tabs */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-300 mr-1">Ngôn ngữ:</span>
                      {[
                        { id: 'all', label: 'Tất Cả', icon: '🌐' },
                        { id: 'vi', label: 'Tiếng Việt', icon: '🇻🇳' },
                        { id: 'en', label: 'English', icon: '🇬🇧' },
                        { id: 'zh', label: 'Trung', icon: '🇨🇳' },
                        { id: 'ja', label: 'Nhật', icon: '🇯🇵' },
                        { id: 'ko', label: 'Hàn', icon: '🇰🇷' },
                        { id: 'other', label: 'Khác', icon: '🌍' },
                      ].map((tab) => {
                        const count = countByLang(tab.id as any);
                        if (count === 0 && tab.id !== 'all' && tab.id !== 'vi' && tab.id !== 'en') return null;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setTtsLangFilter(tab.id as any)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer flex items-center gap-1.5 ${
                              ttsLangFilter === tab.id
                                ? 'bg-emerald-600 text-white font-bold shadow'
                                : 'bg-slate-950/70 border border-slate-800/60 text-slate-400 hover:text-white hover:border-slate-700'
                            }`}
                          >
                            <span>{tab.icon}</span>
                            <span>{tab.label}</span>
                            <span className={`text-[10px] px-1 rounded-full ${ttsLangFilter === tab.id ? 'bg-emerald-700/80 text-white' : 'bg-slate-800 text-slate-400'}`}>
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Gender Filter Buttons */}
                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 px-1 font-medium">Giới tính:</span>
                      <button
                        type="button"
                        onClick={() => setTtsGenderFilter('all')}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition cursor-pointer ${
                          ttsGenderFilter === 'all'
                            ? 'bg-slate-800 text-white font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => setTtsGenderFilter('male')}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition cursor-pointer flex items-center gap-1 ${
                          ttsGenderFilter === 'male'
                            ? 'bg-cyan-900/60 text-cyan-200 border border-cyan-700/50 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>👨 Nam</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTtsGenderFilter('female')}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-medium transition cursor-pointer flex items-center gap-1 ${
                          ttsGenderFilter === 'female'
                            ? 'bg-pink-900/60 text-pink-200 border border-pink-700/50 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>👩 Nữ</span>
                      </button>
                    </div>
                  </div>

                  {/* Search Bar + Active Playing Audio Indicator / Stop Button */}
                  <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-800/60">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Tìm theo tên, ID, sắc thái, thể loại (review phim, kịch tính...)..."
                        value={ttsSearchQuery}
                        onChange={(e) => setTtsSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-1.5 bg-slate-950/90 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/60 transition"
                      />
                      {ttsSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setTtsSearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {playingPreviewVoice && (
                        <button
                          type="button"
                          onClick={stopCurrentAudio}
                          className="px-2.5 py-1 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-medium hover:bg-red-500/30 flex items-center gap-1.5 animate-pulse cursor-pointer"
                          title="Dừng âm thanh đang phát"
                        >
                          <Square className="w-3 h-3 fill-current" />
                          <span>Dừng ({playingPreviewVoice})</span>
                        </button>
                      )}

                      <span className="text-[11px] text-slate-500 font-mono">
                        Hiển thị <strong className="text-emerald-400">{filteredVoices.length}</strong> / {currentVoiceList.length} giọng ({currentProvider.toUpperCase()})
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5. CẤU HÌNH GIỌNG ĐỌC THEO MODE */}
                {(!settings.dubbing.mode || settings.dubbing.mode === 'single') ? (
                  /* Single Speaker: Grid Voice Cards */
                  <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 overflow-hidden animate-in fade-in duration-150">
                    <div className="px-5 py-3 bg-slate-800/30 border-b border-slate-800/60 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">
                        Chọn Giọng Đọc Chính ({currentProvider.toUpperCase()})
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Đang chọn: <strong className="text-emerald-400">{settings.dubbing.voice}</strong>
                      </span>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {filteredVoices.map((v) => {
                          const isSelected = settings.dubbing.voice === v.voice_id;
                          return (
                            <div
                              key={v.voice_id}
                              onClick={() => setSettings({ ...settings, dubbing: { ...settings.dubbing, voice: v.voice_id } })}
                              className={`p-3.5 rounded-xl border cursor-pointer transition relative flex flex-col justify-between ${
                                isSelected
                                  ? currentProvider === 'capcut'
                                    ? 'bg-cyan-950/40 border-cyan-500/80 text-white ring-1 ring-cyan-500/50 shadow-lg shadow-cyan-500/10'
                                    : currentProvider === 'gemini'
                                    ? 'bg-purple-950/40 border-purple-500/80 text-white ring-1 ring-purple-500/50 shadow-lg shadow-purple-500/10'
                                    : 'bg-emerald-950/40 border-emerald-500/80 text-white ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-500/10'
                                  : 'bg-slate-950/80 border-slate-800/70 hover:border-slate-700 text-slate-300 hover:bg-slate-900/60'
                              }`}
                            >
                              <div>
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-sm">{v.gender === 'female' ? '👩' : '👨'}</span>
                                    <span className="font-bold text-xs text-white">{v.display_name}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${
                                      v.lang === 'vi'
                                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/40'
                                        : v.lang === 'en'
                                        ? 'bg-blue-950/80 text-blue-300 border-blue-800/40'
                                        : 'bg-purple-950/80 text-purple-300 border-purple-800/40'
                                    }`}>
                                      {v.lang === 'vi' ? '🇻🇳 Việt' : v.lang === 'en' ? '🇬🇧 Eng' : '🌐 Đa ngữ'}
                                    </span>
                                  </div>
                                  {isSelected && (
                                    <CheckCircle2 className={`w-4 h-4 shrink-0 ${
                                      currentProvider === 'capcut' ? 'text-cyan-400' : currentProvider === 'gemini' ? 'text-purple-400' : 'text-emerald-400'
                                    }`} />
                                  )}
                                </div>

                                <div className="text-[10px] text-slate-500 font-mono mb-1.5 truncate" title={v.voice_id}>
                                  ID: {v.voice_id}
                                </div>

                                <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5 line-clamp-2">
                                  {v.description}
                                </p>
                              </div>

                              <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {v.tags.slice(0, 2).map((t, idx) => (
                                    <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 text-[9px] border border-slate-800">
                                      {t}
                                    </span>
                                  ))}
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTestDubbing(v.voice_id, currentProvider);
                                  }}
                                  disabled={isDubbingTest && activeVoicePreviewing !== v.voice_id}
                                  className={`px-2 py-1 rounded text-[10px] font-medium transition flex items-center gap-1 shrink-0 ${
                                    playingPreviewVoice === v.voice_id
                                      ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse shadow-md shadow-red-500/20 cursor-pointer'
                                      : activeVoicePreviewing === v.voice_id
                                      ? 'bg-emerald-600 text-white animate-pulse cursor-wait'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white cursor-pointer'
                                  }`}
                                  title={playingPreviewVoice === v.voice_id ? 'Dừng phát âm thanh' : 'Nghe thử giọng này'}
                                >
                                  {playingPreviewVoice === v.voice_id ? (
                                    <>
                                      <Square className="w-2.5 h-2.5 fill-current" />
                                      <span>Dừng</span>
                                    </>
                                  ) : activeVoicePreviewing === v.voice_id ? (
                                    <>
                                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                      <span>Đang tạo...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Play className="w-2.5 h-2.5 fill-current" />
                                      <span>Nghe thử</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Multi-Speaker Voice Allocation */
                  <div className="rounded-xl bg-slate-900/60 border border-purple-900/40 overflow-hidden animate-in fade-in duration-150">
                    <div className="px-5 py-3 bg-purple-950/20 border-b border-purple-900/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-xs font-bold text-purple-200">Phân Vai Giọng Đọc Đa Nhân Vật ({currentProvider.toUpperCase()})</span>
                      </div>
                      <span className="text-[10px] text-purple-400 font-mono">Tự động nhận vai Nam / Nữ</span>
                    </div>
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Giọng Nam */}
                        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/60 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                              <span>👨</span>
                              <span>Vai Nam / Nhân Vật Nam:</span>
                            </span>
                            {(() => {
                              const maleVoiceId = settings.dubbing.voice_male || currentVoiceList[0]?.voice_id;
                              const isPlaying = playingPreviewVoice === maleVoiceId;
                              const isPreviewing = activeVoicePreviewing === maleVoiceId;
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleTestDubbing(maleVoiceId, currentProvider)}
                                  disabled={isDubbingTest && !isPreviewing}
                                  className={`px-2 py-0.5 rounded border text-[10px] flex items-center gap-1 cursor-pointer transition ${
                                    isPlaying
                                      ? 'bg-red-600/30 border-red-500 text-red-300 animate-pulse'
                                      : isPreviewing
                                      ? 'bg-cyan-900 border-cyan-500 text-white animate-pulse'
                                      : 'bg-cyan-950 hover:bg-cyan-900 border-cyan-700/50 text-cyan-300'
                                  }`}
                                >
                                  {isPlaying ? (
                                    <Square className="w-2.5 h-2.5 fill-current" />
                                  ) : (
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                  )}
                                  <span>{isPlaying ? 'Dừng' : isPreviewing ? 'Đang tạo...' : 'Nghe thử'}</span>
                                </button>
                              );
                            })()}
                          </div>
                          <select
                            value={settings.dubbing.voice_male || currentVoiceList[0]?.voice_id}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                dubbing: { ...settings.dubbing, voice_male: e.target.value },
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/60"
                          >
                            {(maleVoices.length > 0 ? maleVoices : currentVoiceList).map((mv) => (
                              <option key={mv.voice_id} value={mv.voice_id}>
                                {mv.display_name} ({mv.voice_id}) — {mv.lang.toUpperCase()}
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] text-slate-500">
                            Áp dụng cho thoại nam: anh, bố, chú, chàng trai, [Nam], v.v.
                          </p>
                        </div>

                        {/* Giọng Nữ */}
                        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/60 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-pink-300 flex items-center gap-1.5">
                              <span>👩</span>
                              <span>Vai Nữ / Nhân Vật Nữ:</span>
                            </span>
                            {(() => {
                              const femaleVoiceId = settings.dubbing.voice_female || currentVoiceList[0]?.voice_id;
                              const isPlaying = playingPreviewVoice === femaleVoiceId;
                              const isPreviewing = activeVoicePreviewing === femaleVoiceId;
                              return (
                                <button
                                  type="button"
                                  onClick={() => handleTestDubbing(femaleVoiceId, currentProvider)}
                                  disabled={isDubbingTest && !isPreviewing}
                                  className={`px-2 py-0.5 rounded border text-[10px] flex items-center gap-1 cursor-pointer transition ${
                                    isPlaying
                                      ? 'bg-red-600/30 border-red-500 text-red-300 animate-pulse'
                                      : isPreviewing
                                      ? 'bg-pink-900 border-pink-500 text-white animate-pulse'
                                      : 'bg-pink-950 hover:bg-pink-900 border-pink-700/50 text-pink-300'
                                  }`}
                                >
                                  {isPlaying ? (
                                    <Square className="w-2.5 h-2.5 fill-current" />
                                  ) : (
                                    <Play className="w-2.5 h-2.5 fill-current" />
                                  )}
                                  <span>{isPlaying ? 'Dừng' : isPreviewing ? 'Đang tạo...' : 'Nghe thử'}</span>
                                </button>
                              );
                            })()}
                          </div>
                          <select
                            value={settings.dubbing.voice_female || currentVoiceList[0]?.voice_id}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                dubbing: { ...settings.dubbing, voice_female: e.target.value },
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-200 text-xs focus:outline-none focus:border-pink-500/60"
                          >
                            {(femaleVoices.length > 0 ? femaleVoices : currentVoiceList).map((fv) => (
                              <option key={fv.voice_id} value={fv.voice_id}>
                                {fv.display_name} ({fv.voice_id}) — {fv.lang.toUpperCase()}
                              </option>
                            ))}
                          </select>
                          <p className="text-[10px] text-slate-500">
                            Áp dụng cho thoại nữ: em, mẹ, chị, cô gái, [Nữ], v.v.
                          </p>
                        </div>
                      </div>

                      <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-lg bg-purple-950/20 border border-purple-900/30 text-xs text-purple-200">
                        <input
                          type="checkbox"
                          checked={settings.dubbing.auto_detect_speakers ?? true}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              dubbing: { ...settings.dubbing, auto_detect_speakers: e.target.checked },
                            })
                          }
                          className="rounded accent-purple-500 cursor-pointer"
                        />
                        <span className="font-medium">
                          Tự động phân tích đại từ xưng hô (anh/em, mẹ/con, cô/chú) để nhận dạng giọng đọc cho từng câu thoại
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {/* 6. TỐC ĐỘ NÓI & DÌM NHẠC NỀN (AUDIO DUCKING) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
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

                  <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
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

                {/* 7. KHỐI NGHE THỬ TRỰC TIẾP (LIVE AUDIO PREVIEW) */}
                <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Nghe Thử Giọng Đọc Trực Tiếp (Live Audio Preview)</span>
                    </span>

                    <div className="flex items-center gap-2">
                      {settings.dubbing.mode === 'multi' ? (
                        <>
                          {(() => {
                            const maleVoice = settings.dubbing.voice_male;
                            const isPlaying = playingPreviewVoice === maleVoice;
                            const isPreviewing = activeVoicePreviewing === maleVoice;
                            return (
                              <button
                                type="button"
                                onClick={() => handleTestDubbing(maleVoice, currentProvider)}
                                disabled={isDubbingTest && !isPreviewing}
                                className={`px-3 py-1.5 rounded-lg text-white font-bold text-[11px] transition flex items-center gap-1 shadow cursor-pointer ${
                                  isPlaying
                                    ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                                    : isPreviewing
                                    ? 'bg-cyan-700 animate-pulse cursor-wait'
                                    : 'bg-cyan-600 hover:bg-cyan-500'
                                }`}
                              >
                                {isPlaying ? <Square className="w-3 h-3 fill-white" /> : <Play className="w-3 h-3 fill-white" />}
                                <span>{isPlaying ? `Dừng (${maleVoice})` : isPreviewing ? 'Đang tạo...' : `Thử Giọng Nam (${maleVoice})`}</span>
                              </button>
                            );
                          })()}
                          {(() => {
                            const femaleVoice = settings.dubbing.voice_female;
                            const isPlaying = playingPreviewVoice === femaleVoice;
                            const isPreviewing = activeVoicePreviewing === femaleVoice;
                            return (
                              <button
                                type="button"
                                onClick={() => handleTestDubbing(femaleVoice, currentProvider)}
                                disabled={isDubbingTest && !isPreviewing}
                                className={`px-3 py-1.5 rounded-lg text-white font-bold text-[11px] transition flex items-center gap-1 shadow cursor-pointer ${
                                  isPlaying
                                    ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                                    : isPreviewing
                                    ? 'bg-pink-700 animate-pulse cursor-wait'
                                    : 'bg-pink-600 hover:bg-pink-500'
                                }`}
                              >
                                {isPlaying ? <Square className="w-3 h-3 fill-white" /> : <Play className="w-3 h-3 fill-white" />}
                                <span>{isPlaying ? `Dừng (${femaleVoice})` : isPreviewing ? 'Đang tạo...' : `Thử Giọng Nữ (${femaleVoice})`}</span>
                              </button>
                            );
                          })()}
                        </>
                      ) : (
                        (() => {
                          const mainVoice = settings.dubbing.voice;
                          const isPlaying = playingPreviewVoice === mainVoice;
                          const isPreviewing = activeVoicePreviewing === mainVoice;
                          return (
                            <button
                              type="button"
                              onClick={() => handleTestDubbing(mainVoice, currentProvider)}
                              disabled={isDubbingTest && !isPreviewing}
                              className={`px-3.5 py-1.5 rounded-lg active:scale-95 text-white font-bold text-xs transition flex items-center gap-1.5 shadow cursor-pointer ${
                                isPlaying
                                  ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                                  : isPreviewing
                                  ? 'bg-emerald-700 animate-pulse cursor-wait'
                                  : 'bg-emerald-600 hover:bg-emerald-500'
                              }`}
                            >
                              {isPlaying ? <Square className="w-3 h-3 fill-white" /> : <Play className="w-3 h-3 fill-white" />}
                              <span>
                                {isPlaying
                                  ? `Dừng đọc (${mainVoice})`
                                  : isPreviewing
                                  ? 'Đang tạo âm thanh...'
                                  : `Nghe thử giọng: ${mainVoice}`}
                              </span>
                            </button>
                          );
                        })()
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Đoạn văn thử nghiệm:</label>
                    <input
                      type="text"
                      value={testDubbingText}
                      onChange={(e) => setTestDubbingText(e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-800/60 rounded-lg p-2.5 text-slate-100 text-xs focus:outline-none focus:border-emerald-500/60 transition"
                    />
                  </div>
                </div>
              </div>
            );
          })()}

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

          {/* ================= TAB 5: THIẾT BỊ & MẠNG PROXY ================= */}
          {activeTab === 'device' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-emerald-400" />
                  <span>5. Cấu Hình Thiết Bị Giả Lập & Mạng Proxy</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Định danh thiết bị Android giả lập (ByteDance SNSSDK / Hồng Quả) và cấu hình máy chủ Proxy để vượt rào cản địa lý và chống chặn IP.
                </p>
              </div>

              {/* Thông báo xoay tua thiết bị */}
              {deviceRotateMessage && (
                <div className="p-3 bg-emerald-950/80 border border-emerald-700/60 rounded-xl text-xs text-emerald-300 flex items-center justify-between shadow animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{deviceRotateMessage}</span>
                  </div>
                  <button onClick={() => setDeviceRotateMessage(null)} className="text-emerald-400 hover:text-white font-bold">✕</button>
                </div>
              )}

              {/* CARD 1: ĐỊNH DANH THIẾT BỊ ANDROID HIỆN TẠI */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Định Danh Thiết Bị Đang Dùng</h4>
                      <p className="text-[11px] text-slate-400">Hồ sơ thiết bị gửi kèm các API request</p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[11px] font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {deviceInfo?.status === 'ready' ? 'Sẵn sàng gửi request' : 'Đang khởi tạo'}
                  </span>
                </div>

                {/* Chi tiết thiết bị */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-slate-800/80">
                    <span>Thiết bị giả lập:</span>
                    <span className="text-slate-100 font-semibold">
                      {deviceInfo?.device_brand || 'Xiaomi'} {deviceInfo?.device_model || 'MI 12'} (Kernel v32.9.0)
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-slate-800/80">
                    <span>Máy chủ cấp phát:</span>
                    <span className="text-emerald-300 font-mono text-[11px]">
                      {deviceInfo?.server_source || 'https://log.snssdk.com (ByteDance SNSSDK)'}
                    </span>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Device ID:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-cyan-300 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          {deviceInfo?.device_id || 'Đang tải...'}
                        </span>
                        {deviceInfo?.device_id && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(deviceInfo.device_id, 'device')}
                            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                            title="Sao chép Device ID"
                          >
                            {copiedDeviceId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-slate-400">
                      <span>Install ID:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-cyan-300 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          {deviceInfo?.install_id || 'Đang tải...'}
                        </span>
                        {deviceInfo?.install_id && (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(deviceInfo.install_id, 'install')}
                            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                            title="Sao chép Install ID"
                          >
                            {copiedInstallId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Các nút hành động thiết bị */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    onClick={handleRotateDeviceNow}
                    disabled={isRotatingDevice}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-sm transition disabled:opacity-50 cursor-pointer active:scale-95"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isRotatingDevice ? 'animate-spin' : ''}`} />
                    <span>{isRotatingDevice ? 'Đang cấp mới...' : 'Cấp Mới Thiết Bị (Rotate)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCustomDeviceInput(!showCustomDeviceInput)}
                    className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>{showCustomDeviceInput ? 'Hủy Điền Thủ Công' : 'Điền Thủ Công'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={loadDeviceInfo}
                    disabled={isLoadingDevice}
                    className="p-2 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white border border-slate-700 rounded-xl transition cursor-pointer"
                    title="Tải lại trạng thái thiết bị"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevice ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {/* Khung điền thủ công */}
                {showCustomDeviceInput && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-600/40 space-y-3 animate-in fade-in">
                    <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Nhập thông số thiết bị thủ công</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Custom Device ID:</label>
                        <input
                          type="text"
                          value={customDeviceId}
                          onChange={(e) => setCustomDeviceId(e.target.value)}
                          placeholder="Ví dụ: 123456789012345"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">Custom Install ID:</label>
                        <input
                          type="text"
                          value={customInstallId}
                          onChange={(e) => setCustomInstallId(e.target.value)}
                          placeholder="Ví dụ: 987654321098765"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveCustomDevice}
                        disabled={isSavingCustomDevice}
                        className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition cursor-pointer shadow"
                      >
                        {isSavingCustomDevice ? 'Đang lưu...' : 'Lưu Định Danh'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* CARD 2: CẤU HÌNH PROXY & CHỐNG CHẶN */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4 shadow-sm">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-cyan-400">
                      <Wifi className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Máy Chủ Proxy (Định Tuyến Mạng)</h4>
                      <p className="text-[11px] text-slate-400">Hỗ trợ HTTP, HTTPS, SOCKS5</p>
                    </div>
                  </div>

                  {/* Toggle Bật/Tắt Proxy */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs font-semibold text-slate-300">
                      {isProxyEnabled ? 'Đang bật' : 'Đang tắt'}
                    </span>
                    <input
                      type="checkbox"
                      checked={isProxyEnabled}
                      onChange={(e) => setIsProxyEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600 relative" />
                  </label>
                </div>

                <div className="space-y-3">
                  {/* Ô nhập URL Proxy */}
                  <div>
                    <label className="text-xs text-slate-300 font-semibold block mb-1.5">
                      Địa chỉ Proxy:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={proxyUrl}
                        onChange={(e) => {
                          setProxyUrl(e.target.value);
                          setProxyTestResult(null);
                        }}
                        placeholder="http://user:pass@ip:port hoặc socks5://ip:port"
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 transition"
                      />
                      <button
                        type="button"
                        onClick={handleTestProxyConnection}
                        disabled={isTestingProxy || !proxyUrl.trim()}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-cyan-300 hover:text-cyan-200 border border-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition disabled:opacity-40 cursor-pointer shrink-0"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isTestingProxy ? 'animate-spin' : ''}`} />
                        <span>{isTestingProxy ? 'Đang test...' : 'Kiểm Tra'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Preset và Lịch sử */}
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className="text-slate-500">Mẫu:</span>
                    {[
                      { label: 'HTTP Cục Bộ', val: 'http://127.0.0.1:7890' },
                      { label: 'SOCKS5 Cục Bộ', val: 'socks5://127.0.0.1:10808' },
                    ].map((ps) => (
                      <button
                        key={ps.label}
                        type="button"
                        onClick={() => {
                          setProxyUrl(ps.val);
                          setIsProxyEnabled(true);
                          setProxyTestResult(null);
                        }}
                        className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 transition font-mono text-[10px]"
                      >
                        {ps.label}
                      </button>
                    ))}
                    {proxyHistory.length > 0 && (
                      <>
                        <span className="text-slate-600 pl-1">• Gần đây:</span>
                        {proxyHistory.map((hist) => (
                          <button
                            key={hist}
                            type="button"
                            onClick={() => {
                              setProxyUrl(hist);
                              setIsProxyEnabled(true);
                              setProxyTestResult(null);
                            }}
                            className="px-2 py-0.5 rounded bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 border border-cyan-800/40 transition font-mono text-[10px] truncate max-w-[150px]"
                            title={hist}
                          >
                            {hist}
                          </button>
                        ))}
                      </>
                    )}
                  </div>

                  {/* Kết quả kiểm tra proxy */}
                  {proxyTestResult && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                        proxyTestResult.ok
                          ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                          : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                      }`}
                    >
                      {proxyTestResult.ok ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">IP thật của máy:</span>
                            <span className="font-mono text-slate-300">{proxyTestResult.direct_ip || '115.76.50.129'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-emerald-300 font-semibold">IP xuất ngoại qua Proxy:</span>
                            <span className="font-mono text-emerald-200 font-bold text-sm">{proxyTestResult.ip}</span>
                          </div>
                          <div className="flex items-center justify-between pt-1.5 border-t border-emerald-800/40 text-[11px]">
                            <span>Độ trễ Ping: <strong className="text-cyan-300">{proxyTestResult.latency_ms}ms</strong></span>
                            <span className="text-emerald-400 font-bold">
                              {proxyTestResult.is_masked ? '✓ Đã ẩn danh (Khác IP gốc)' : '⚠ Trùng IP gốc máy'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>{proxyTestResult.error}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Giãn cách & Tự động đổi thiết bị */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800">
                    <div>
                      <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                        <span>Giãn cách giữa các lượt tải:</span>
                        <span className="text-cyan-400 font-mono font-bold">{rateLimitDelay}s</span>
                      </label>
                      <input
                        type="range"
                        min="0.5"
                        max="10.0"
                        step="0.5"
                        value={rateLimitDelay}
                        onChange={(e) => setRateLimitDelay(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500 cursor-pointer"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">Tránh bị máy chủ giới hạn tần suất (Rate-limit 429)</p>
                    </div>

                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        Chu kỳ tự đổi thiết bị:
                      </label>
                      <select
                        value={rotationInterval}
                        onChange={(e) => setRotationInterval(parseInt(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-semibold focus:outline-none focus:border-cyan-500"
                      >
                        <option value={1}>Mỗi 1 video / request (Khuyên dùng)</option>
                        <option value={3}>Mỗi 3 video</option>
                        <option value={5}>Mỗi 5 video</option>
                        <option value={10}>Mỗi 10 video</option>
                        <option value={0}>Không tự động đổi (Thủ công)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Nút lưu cấu hình proxy & thiết bị */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                  <div>
                    {proxySaveSuccess && (
                      <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Đã lưu cấu hình thiết bị & proxy!
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveProxyAndDeviceConfig}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Lưu Cấu Hình Mạng & Thiết Bị</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 6: CẤU HÌNH XUẤT HÀNG LOẠT ================= */}
          {activeTab === 'batch' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-cyan-400" />
                  <span>6. Cấu Hình Xử Lý & Xuất Hàng Loạt (Batch Export Pipeline)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Thiết lập chuẩn hóa áp dụng đồng loạt cho tất cả các tập phim trong danh mục: ngôn ngữ dịch, độ nén nhạc nền gốc, lồng tiếng AI và định dạng xuất thành phẩm.
                </p>
              </div>

              {/* CARD 1: CÔNG ĐOẠN XỬ LÝ & CHUẨN MẪU (PRESET) */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">1. Công Đoạn Thực Hiện & Chuẩn Áp Dụng</h4>
                      <p className="text-[11px] text-slate-400">Chọn các bước tự động chạy tuần tự khi nhấn Xử lý hàng loạt</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={batchStages.ocr}
                      onChange={(e) => handleUpdateBatchConfig({ batchStages: { ...batchStages, ocr: e.target.checked } })}
                      className="w-4 h-4 rounded accent-cyan-500 cursor-pointer"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">1. Quét OCR</div>
                      <div className="text-[10px] text-slate-500">Trích xuất phụ đề gốc</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-amber-500/50 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={batchStages.translate}
                      onChange={(e) => handleUpdateBatchConfig({ batchStages: { ...batchStages, translate: e.target.checked } })}
                      className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">2. Dịch Thuật AI</div>
                      <div className="text-[10px] text-slate-500">Chuyển ngữ sang đích</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={batchStages.dubbing}
                      onChange={(e) => handleUpdateBatchConfig({ batchStages: { ...batchStages, dubbing: e.target.checked } })}
                      className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">3. Lồng Tiếng AI</div>
                      <div className="text-[10px] text-slate-500">Tạo audio thuyết minh</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500/50 cursor-pointer transition">
                    <input
                      type="checkbox"
                      checked={batchStages.export}
                      onChange={(e) => handleUpdateBatchConfig({ batchStages: { ...batchStages, export: e.target.checked } })}
                      className="w-4 h-4 rounded accent-purple-500 cursor-pointer"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-200">4. Render Xuất</div>
                      <div className="text-[10px] text-slate-500">Mã hóa MP4 / MKV</div>
                    </div>
                  </label>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      Chuẩn Cấu Hình Áp Dụng (Preset Profile):
                    </label>
                    <select
                      value={activeBatchPresetId || ''}
                      onChange={(e) => handleUpdateBatchConfig({ activeBatchPresetId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 transition cursor-pointer"
                    >
                      <option value="">-- Mặc định hệ thống --</option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                          {p.name} ({p.aspect_ratio || '16:9'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-slate-400">
                    Preset xác định vùng che sub (ROI), tỉ lệ khung hình và kiểu làm mờ.
                  </div>
                </div>
              </div>

              {/* CARD 2: NGÔN NGỮ VÀ ÂM LƯỢNG GỐC */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 2.1 Ngôn ngữ dịch */}
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Languages className="w-4 h-4" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Ngôn Ngữ Dịch Thuật</h4>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Chọn ngôn ngữ đích cần dịch sang:</label>
                    <select
                      value={batchTargetLang}
                      onChange={(e) => handleUpdateBatchConfig({ batchTargetLang: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
                    >
                      <option value="vi">Tiếng Việt (vi) - Phổ biến</option>
                      <option value="en">Tiếng Anh (en)</option>
                      <option value="zh">Tiếng Trung (zh)</option>
                      <option value="none">Giữ nguyên phụ đề gốc (Không dịch)</option>
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Sử dụng mô hình AI đã cấu hình trong Tab 2 (Gemini / Local LLM) để dịch ngữ cảnh chuẩn điện ảnh.
                  </p>
                </div>

                {/* 2.2 Giảm âm lượng video gốc */}
                <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Volume2 className="w-4 h-4" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Giảm Âm Lượng Gốc (Ducking)</h4>
                    </div>
                    <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded">
                      {batchDuckingVolume}%
                    </span>
                  </div>
                  <div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={batchDuckingVolume}
                      onChange={(e) => handleUpdateBatchConfig({ batchDuckingVolume: Number(e.target.value) })}
                      className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                      <span>0% (Tắt hoàn toàn tiếng gốc)</span>
                      <span>25% (Khuyên dùng)</span>
                      <span>100% (Giữ nguyên âm lượng gốc)</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Tự động hạ âm lượng video gốc khi có giọng đọc AI để lời thoại rõ ràng, không bị lẫn tiếng nhân vật gốc.
                  </p>
                </div>
              </div>

              {/* CARD 3: CẤU HÌNH LỒNG TIẾNG AI (TTS) */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
                      <Mic className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Lồng Tiếng AI Toàn Cục</h4>
                      <p className="text-[11px] text-slate-400">Tự động lồng tiếng cho toàn bộ các tập video được xuất</p>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs font-semibold text-slate-300">
                      {batchDubbingEnabled ? 'Đang bật' : 'Đang tắt'}
                    </span>
                    <input
                      type="checkbox"
                      checked={batchDubbingEnabled}
                      onChange={(e) => handleUpdateBatchConfig({ batchDubbingEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {batchDubbingEnabled && (
                  <div className="space-y-4 pt-1">
                    {/* Chế độ giọng đọc: Đơn giọng vs Nam / Nữ */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div
                        onClick={() => handleUpdateBatchConfig({ batchDubbingMode: 'single' })}
                        className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                          batchDubbingMode === 'single'
                            ? 'bg-emerald-950/40 border-emerald-500/60 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold">Chế độ Đơn Giọng</div>
                          <div className="text-[10px] text-slate-500">1 giọng đọc cố định cho toàn bộ video</div>
                        </div>
                        <input
                          type="radio"
                          name="batchDubbingMode"
                          checked={batchDubbingMode === 'single'}
                          onChange={() => handleUpdateBatchConfig({ batchDubbingMode: 'single' })}
                          className="accent-emerald-500"
                        />
                      </div>

                      <div
                        onClick={() => handleUpdateBatchConfig({ batchDubbingMode: 'gender_multi' })}
                        className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                          batchDubbingMode === 'gender_multi'
                            ? 'bg-emerald-950/40 border-emerald-500/60 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold">Chế độ Đa Giọng Nam / Nữ</div>
                          <div className="text-[10px] text-slate-500">Tự phân loại nhân vật Nam & Nữ theo kịch bản</div>
                        </div>
                        <input
                          type="radio"
                          name="batchDubbingMode"
                          checked={batchDubbingMode === 'gender_multi'}
                          onChange={() => handleUpdateBatchConfig({ batchDubbingMode: 'gender_multi' })}
                          className="accent-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Chọn giọng đọc chi tiết */}
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                      {batchDubbingMode === 'single' ? (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-300 block">
                            Giọng đọc áp dụng:
                          </label>
                          <VoiceCatalogPicker
                            selectedVoiceId={batchDubbingVoice}
                            onChange={(v) => handleUpdateBatchConfig({ batchDubbingVoice: v })}
                            onPreview={handleTestBatchVoice}
                            previewingVoiceId={currentTestingBatchVoice || undefined}
                          />
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-sky-300 block flex items-center gap-1.5">
                              <span>♂ Giọng Nam Chính:</span>
                            </label>
                            <VoiceCatalogPicker
                              selectedVoiceId={batchDubbingVoiceMale}
                              onChange={(v) => handleUpdateBatchConfig({ batchDubbingVoiceMale: v })}
                              gender="Nam"
                              onPreview={handleTestBatchVoice}
                              previewingVoiceId={currentTestingBatchVoice || undefined}
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-pink-300 block flex items-center gap-1.5">
                              <span>♀ Giọng Nữ Chính:</span>
                            </label>
                            <VoiceCatalogPicker
                              selectedVoiceId={batchDubbingVoiceFemale}
                              onChange={(v) => handleUpdateBatchConfig({ batchDubbingVoiceFemale: v })}
                              gender="Nữ"
                              onPreview={handleTestBatchVoice}
                              previewingVoiceId={currentTestingBatchVoice || undefined}
                            />
                          </div>
                        </div>
                      )}

                      {/* Tốc độ đọc */}
                      <div className="pt-3 border-t border-slate-800 flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-slate-300">Tốc độ đọc giọng AI:</span>
                          <div className="flex items-center gap-2">
                            {[0.85, 1.0, 1.15, 1.25, 1.35].map((spd) => (
                              <button
                                key={spd}
                                type="button"
                                onClick={() => handleUpdateBatchConfig({ batchDubbingSpeed: spd })}
                                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                                  batchDubbingSpeed === spd
                                    ? 'bg-amber-500 text-slate-950 shadow'
                                    : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white'
                                }`}
                              >
                                {spd.toFixed(2)}x
                              </button>
                            ))}
                          </div>
                        </div>

                        {batchVoiceTestMsg && (
                          <div className="text-xs text-amber-300 animate-pulse font-medium">
                            {batchVoiceTestMsg}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* CARD 4: ĐỊNH DẠNG & ĐỘ PHÂN GIẢI XUẤT */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                <div className="flex items-center gap-2 text-purple-400 pb-2 border-b border-slate-800">
                  <Video className="w-4 h-4" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Định Dạng & Độ Phân Giải Khi Xuất Video</h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Container Video:</label>
                    <select
                      value={batchExportFormat}
                      onChange={(e) => handleUpdateBatchConfig({ batchExportFormat: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
                    >
                      <option value="mp4">MP4 (Khuyên dùng - Chuẩn tương thích cao)</option>
                      <option value="mkv">MKV (Chứa đa luồng subtitle)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Độ Phân Giải:</label>
                    <select
                      value={batchExportResolution}
                      onChange={(e) => handleUpdateBatchConfig({ batchExportResolution: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
                    >
                      <option value="original">Gốc (100% giữ nguyên kích thước)</option>
                      <option value="1080p">1080p Full HD (1920x1080 / 1080x1920)</option>
                      <option value="720p">720p HD (1280x720 / 720x1280)</option>
                      <option value="2k">2K QHD (2560x1440)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">Tỷ Lệ Khung Hình:</label>
                    <select
                      value={batchExportAspectRatio}
                      onChange={(e) => handleUpdateBatchConfig({ batchExportAspectRatio: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 text-xs focus:outline-none focus:border-purple-500 cursor-pointer"
                    >
                      <option value="original">Gốc (Theo video đầu vào)</option>
                      <option value="16:9">16:9 (Màn hình ngang - YouTube)</option>
                      <option value="9:16">9:16 (Màn hình dọc - TikTok / Reels / Shorts)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 text-[11px] text-slate-500">
                  Quá trình render sẽ tự động tận dụng card đồ họa GPU NVIDIA (NVENC) để tăng tốc độ xuất video nhanh gấp 5-10 lần so với CPU.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

