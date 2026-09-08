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
];

export const VOICE_CATEGORIES = [
  { id: 'all', label: 'Tất cả' },
  { id: 'capcut', label: '🎬 CapCut Trend' },
  { id: 'edge', label: '⚡ Edge-TTS' },
  { id: 'gemini', label: '🌟 Gemini AI' },
] as const;

export type VoiceCategory = typeof VOICE_CATEGORIES[number]['id'];

export const MALE_VOICE_OPTIONS = [
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Edge-TTS trầm ấm)' },
  { id: 'BV075_streaming', name: 'Thanh Niên Tự Tin (CapCut Review)' },
  { id: 'BV560_streaming', name: 'Alex Đại Đế (CapCut Uy quyền)' },
  { id: 'BV075_streaming_vibrato_dsp', name: 'Việt Méo (CapCut Parody)' },
  { id: 'Fenrir', name: 'Fenrir (Gemini Trầm)' },
  { id: 'Puck', name: 'Puck (Gemini Tự nhiên)' },
];

export const FEMALE_VOICE_OPTIONS = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Edge-TTS Dịu dàng)' },
  { id: 'BV074_streaming', name: 'Cô Gái Hoạt Ngôn (CapCut)' },
  { id: 'BV421_vivn_streaming', name: 'Nhỏ Ngọt Ngào (CapCut)' },
  { id: 'BV562_streaming', name: 'Mai (CapCut Thuyết minh)' },
  { id: 'vi_female_huong', name: 'Hương (CapCut Miền Bắc)' },
  { id: 'Kore', name: 'Kore (Gemini Nữ)' },
  { id: 'Aoede', name: 'Aoede (Gemini Thanh thoát)' },
];
