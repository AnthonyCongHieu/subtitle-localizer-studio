export interface VoiceItem {
  id: string;
  name: string;
  gender: 'Nam' | 'Nữ';
  provider: 'capcut' | 'edge' | 'gemini';
  style: string;
  popular?: boolean;
}

const GEMINI_VOICES = new Set([
  'puck', 'kore', 'zephyr', 'fenrir', 'aoede', 'sulafat', 'charon', 'enceladus',
  'leda', 'orus', 'despina', 'algenib', 'callirrhoe', 'eurydice', 'hermes',
  'jupiter', 'ganymede', 'triton', 'proteus', 'titan',
]);

const CAPCUT_PREFIXES = [
  'BV', 'vi_female_huong', 'ICL_', 'DiT_', 'en_us_', 'zh_',
  'en_male_', 'en_female_', 'multi_', 'id_',
];

const CAPCUT_SUBSTRINGS = [
  '_uranus_', '_bigtts', '_streaming', '_dsp', '_mars_',
  '_moon_', '_wvae_',
];

export const isGeminiVoice = (voice?: string): boolean => {
  if (!voice) return false;
  return GEMINI_VOICES.has(voice.trim().toLowerCase());
};

export const isEdgeVoice = (voice?: string): boolean => {
  if (!voice) return false;
  const v = voice.trim();
  const lower = v.toLowerCase();
  if (v.includes('-') && lower.includes('neural')) return true;
  if (['vi-vn-namminhneural', 'vi-vn-hoaimyneural'].includes(lower)) return true;
  return false;
};

export const isCapCutVoice = (voice?: string): boolean => {
  if (!voice) return false;
  const v = voice.trim();
  const lower = v.toLowerCase();
  if (v === 'th' || v === 'en') return true;
  if (CAPCUT_PREFIXES.some(p => v.startsWith(p))) return true;
  if (CAPCUT_SUBSTRINGS.some(s => lower.includes(s))) return true;
  return false;
};

export const detectVoiceProvider = (voice: string): 'capcut' | 'edge' | 'gemini' => {
  if (!voice) return 'edge';
  if (isGeminiVoice(voice)) return 'gemini';
  if (isCapCutVoice(voice)) return 'capcut';
  if (isEdgeVoice(voice)) return 'edge';
  return 'edge';
};

export const VOICE_CATALOG: VoiceItem[] = [
  // CapCut Hot Trend
  { id: 'BV075_streaming', name: 'Thanh Niên Tự Tin', gender: 'Nam', provider: 'capcut', style: 'Review phim, TikTok hot', popular: true },
  { id: 'BV074_streaming', name: 'Cô Gái Hoạt Ngôn', gender: 'Nữ', provider: 'capcut', style: 'Tươi sáng, thu hút', popular: true },
  { id: 'BV421_vivn_streaming', name: 'Nhỏ Ngọt Ngào', gender: 'Nữ', provider: 'capcut', style: 'Tâm sự, nhẹ nhàng' },
  { id: 'BV562_streaming', name: 'Mai', gender: 'Nữ', provider: 'capcut', style: 'Thuyết minh chuẩn đài' },
  { id: 'vi_female_huong', name: 'Hương', gender: 'Nữ', provider: 'capcut', style: 'Nữ phổ thông miền Bắc' },
  { id: 'BV560_streaming', name: 'Alex Đại Đế', gender: 'Nam', provider: 'capcut', style: 'Nam trầm quyền uy' },
  { id: 'BV075_streaming_vibrato_dsp', name: 'Việt Méo', gender: 'Nam', provider: 'capcut', style: 'Hài hước, parody' },
  { id: 'BV074_streaming_dsp', name: 'Bé Nhí Nhảnh', gender: 'Nữ', provider: 'capcut', style: 'Trẻ em dễ thương' },

  // Edge-TTS
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh', gender: 'Nam', provider: 'edge', style: 'Nam trầm ấm, kịch tính', popular: true },
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My', gender: 'Nữ', provider: 'edge', style: 'Nữ truyền cảm, chuẩn phim', popular: true },

  // Gemini AI
  { id: 'Puck', name: 'Puck', gender: 'Nam', provider: 'gemini', style: 'Gemini AI Tự nhiên' },
  { id: 'Kore', name: 'Kore', gender: 'Nữ', provider: 'gemini', style: 'Gemini AI Truyền cảm' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'Nam', provider: 'gemini', style: 'Gemini AI Trầm ấm' },
  { id: 'Aoede', name: 'Aoede', gender: 'Nữ', provider: 'gemini', style: 'Gemini AI Thanh thoát' },

  // International English
  { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'Nữ', provider: 'edge', style: 'US Female Warm' },
  { id: 'en-US-GuyNeural', name: 'Guy', gender: 'Nam', provider: 'edge', style: 'US Male Broadcast' },
  { id: 'en-US-AriaNeural', name: 'Aria', gender: 'Nữ', provider: 'edge', style: 'US Dynamic Narrator' },
  { id: 'en-US-ChristopherNeural', name: 'Christopher', gender: 'Nam', provider: 'edge', style: 'US Deep Storyteller' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'Nam', provider: 'edge', style: 'British Classic Male' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'Nữ', provider: 'edge', style: 'British Elegant Female' },
];

export const VOICE_CATEGORIES = [
  { id: 'all', label: 'Tất cả' },
  { id: 'capcut', label: '🎬 CapCut Trend' },
  { id: 'edge', label: '⚡ Edge-TTS' },
  { id: 'gemini', label: '🌟 Gemini AI' },
] as const;

export type VoiceCategory = typeof VOICE_CATEGORIES[number]['id'];

export interface VoiceGroup {
  label: string;
  options: { id: string; name: string }[];
}

export function filterVoiceCatalog(options: {
  category?: VoiceCategory;
  gender?: VoiceItem['gender'];
} = {}): VoiceItem[] {
  const category = options.category ?? 'all';
  const gender = options.gender;
  return VOICE_CATALOG.filter((voice) => {
    if (category !== 'all' && voice.provider !== category) return false;
    if (gender && voice.gender !== gender) return false;
    return true;
  });
}

type VoiceDropdownGroupKey = 'capcut' | 'edge' | 'gemini' | 'international';

function dropdownGroupKey(voice: VoiceItem): VoiceDropdownGroupKey {
  if (voice.provider === 'edge' && voice.id.startsWith('en-')) return 'international';
  return voice.provider;
}

const DROPDOWN_GROUP_DEFS: { key: VoiceDropdownGroupKey; label: string }[] = [
  { key: 'capcut', label: '🎬 Giọng Đọc CapCut Hot Trend (Review Phim & TikTok)' },
  { key: 'edge', label: '🇻🇳 Giọng Đọc Chuẩn Edge TTS (Miễn phí & Tự nhiên)' },
  { key: 'gemini', label: '🌟 Giọng Đọc Gemini AI TTS (Đa sắc thái)' },
  { key: 'international', label: '🌍 Giọng Đọc Quốc Tế (English)' },
];

export function voiceDropdownLabel(voice: VoiceItem): string {
  return voice.name + ' (' + voice.style + ')';
}

export function getVoiceDropdownGroups(voices: VoiceItem[] = VOICE_CATALOG): VoiceGroup[] {
  return DROPDOWN_GROUP_DEFS
    .map((def) => ({
      label: def.label,
      options: voices
        .filter((voice) => dropdownGroupKey(voice) === def.key)
        .map((voice) => ({ id: voice.id, name: voiceDropdownLabel(voice) })),
    }))
    .filter((group) => group.options.length > 0);
}

export const MALE_VOICE_GROUPS: VoiceGroup[] = getVoiceDropdownGroups(
  filterVoiceCatalog({ gender: 'Nam' }),
);
export const FEMALE_VOICE_GROUPS: VoiceGroup[] = getVoiceDropdownGroups(
  filterVoiceCatalog({ gender: 'Nữ' }),
);

export const MALE_VOICE_OPTIONS = MALE_VOICE_GROUPS.flatMap((g) => g.options);
export const FEMALE_VOICE_OPTIONS = FEMALE_VOICE_GROUPS.flatMap((g) => g.options);
