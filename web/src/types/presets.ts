export type AspectRatioType = 'original' | '16:9' | '9:16' | '1:1' | '4:3' | '2.35:1';

export type MaskStyleType = 'blur' | 'glass' | 'ambient' | 'feather' | 'box' | 'mosaic' | 'gradient';

export type ZoomMode = 'fit' | 0.5 | 0.75 | 1.0 | 1.25 | 1.5 | 2.0;

export interface PresetProfile {
  id: string;
  name: string;
  is_default?: boolean;
  source_lang: string;
  target_lang: string;
  mask_style: MaskStyleType;
  is_flipped_h: boolean;
  is_flipped_v: boolean;
  show_subtitle_overlay: boolean;
  zoom_level: ZoomMode;
  aspect_ratio: AspectRatioType;
  fit_mode?: 'contain' | 'cover';
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export const BUILTIN_PRESETS: PresetProfile[] = [
  {
    id: 'preset-tiktok-916',
    name: 'Chuẩn TikTok / Reels Dọc (9:16 Lật Ngang, Mờ Viền)',
    is_default: true,
    source_lang: 'zh',
    target_lang: 'vi',
    mask_style: 'blur',
    is_flipped_h: true,
    is_flipped_v: false,
    show_subtitle_overlay: true,
    zoom_level: 'fit',
    aspect_ratio: '9:16',
    fit_mode: 'contain',
    roi: {
      x: 0.05,
      y: 0.70,
      width: 0.90,
      height: 0.26,
    },
  },
  {
    id: 'preset-youtube-169',
    name: 'Chuẩn YouTube / Ngang (16:9 Điện Ảnh, Mờ Tự Nhiên)',
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
      y: 0.78,
      width: 0.84,
      height: 0.18,
    },
  },
  {
    id: 'preset-facebook-11',
    name: 'Chuẩn Facebook / Instagram Vuông (1:1 Kính Mờ)',
    is_default: false,
    source_lang: 'zh',
    target_lang: 'vi',
    mask_style: 'glass',
    is_flipped_h: false,
    is_flipped_v: false,
    show_subtitle_overlay: true,
    zoom_level: 'fit',
    aspect_ratio: '1:1',
    fit_mode: 'contain',
    roi: {
      x: 0.08,
      y: 0.78,
      width: 0.84,
      height: 0.14,
    },
  },
  {
    id: 'preset-cinema-235',
    name: 'Chuẩn Điện Ảnh (2.35:1 Gradient Đáy)',
    is_default: false,
    source_lang: 'zh',
    target_lang: 'vi',
    mask_style: 'ambient',
    is_flipped_h: false,
    is_flipped_v: false,
    show_subtitle_overlay: true,
    zoom_level: 'fit',
    aspect_ratio: '2.35:1',
    fit_mode: 'contain',
    roi: {
      x: 0.08,
      y: 0.84,
      width: 0.84,
      height: 0.12,
    },
  },
];

const PRESETS_STORAGE_KEY = 'sub_studio_presets_v1';

export function getStoredPresets(): PresetProfile[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return BUILTIN_PRESETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.warn('Lỗi đọc preset profiles từ localStorage:', err);
  }
  return BUILTIN_PRESETS;
}

export function saveStoredPresets(presets: PresetProfile[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch (err) {
    console.warn('Lỗi ghi preset profiles vào localStorage:', err);
  }
}

export function getDefaultPreset(presets?: PresetProfile[]): PresetProfile {
  const list = presets || getStoredPresets();
  const def = list.find((p) => p.is_default);
  return def || list[0] || BUILTIN_PRESETS[0];
}

export function exportPresetsAsJson(presets: PresetProfile[]): void {
  const jsonStr = JSON.stringify(presets, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `subtitle_studio_presets_${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parsePresetsJson(jsonString: string): PresetProfile[] {
  const parsed = JSON.parse(jsonString);
  if (!Array.isArray(parsed)) {
    throw new Error('Dữ liệu JSON không hợp lệ: Phải là một mảng danh sách các chuẩn.');
  }
  return parsed.map((item, idx) => ({
    id: item.id || `preset-imported-${Date.now()}-${idx}`,
    name: item.name || `Chuẩn Nhập #${idx + 1}`,
    is_default: Boolean(item.is_default),
    source_lang: item.source_lang || 'zh',
    target_lang: item.target_lang || 'vi',
    mask_style: item.mask_style || 'blur',
    is_flipped_h: Boolean(item.is_flipped_h),
    is_flipped_v: Boolean(item.is_flipped_v),
    show_subtitle_overlay: item.show_subtitle_overlay !== false,
    zoom_level: item.zoom_level || 'fit',
    aspect_ratio: item.aspect_ratio || 'original',
    fit_mode: item.fit_mode || 'contain',
    roi: item.roi || {
      x: 0.08,
      y: 0.82,
      width: 0.84,
      height: 0.13,
    },
  }));
}
