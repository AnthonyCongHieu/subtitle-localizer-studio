import { GlobalPipelineSettings } from '../api/client';

export interface BatchExportConfig {
  batchTargetLang: string;
  batchDuckingVolume: number;
  batchDubbingEnabled: boolean;
  batchDubbingMode: 'single' | 'gender_multi';
  batchDubbingVoice: string;
  batchExportFormat: 'mp4' | 'mkv';
  batchExportResolution: 'original' | '1080p' | '720p' | '2k';
  batchExportAspectRatio: 'original' | '9:16' | '16:9';
  batchStages: {
    ocr: boolean;
    translate: boolean;
    dubbing: boolean;
    export: boolean;
  };
  activeBatchPresetId: string;
  sortMode?: 'ep_asc' | 'ep_desc' | 'name_asc' | 'name_desc' | 'status' | 'duration';
  gridCols?: 2 | 3 | 4;
}

export const BATCH_EXPORT_CONFIG_KEY = 'sub_studio_batch_export_config_v1';

export const DEFAULT_BATCH_EXPORT_CONFIG: BatchExportConfig = {
  batchTargetLang: 'vi',
  batchDuckingVolume: 25,
  batchDubbingEnabled: true,
  batchDubbingMode: 'single',
  batchDubbingVoice: 'vi-VN-NamMinhNeural',
  batchExportFormat: 'mp4',
  batchExportResolution: 'original',
  batchExportAspectRatio: 'original',
  batchStages: {
    ocr: true,
    translate: true,
    dubbing: true,
    export: true,
  },
  activeBatchPresetId: '',
  sortMode: 'ep_asc',
  gridCols: 3,
};

export function loadBatchExportConfig(): BatchExportConfig {
  try {
    const raw = localStorage.getItem(BATCH_EXPORT_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_BATCH_EXPORT_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      batchTargetLang:
        typeof parsed.batchTargetLang === 'string' ? parsed.batchTargetLang : DEFAULT_BATCH_EXPORT_CONFIG.batchTargetLang,
      batchDuckingVolume:
        typeof parsed.batchDuckingVolume === 'number'
          ? Math.max(0, Math.min(100, parsed.batchDuckingVolume))
          : DEFAULT_BATCH_EXPORT_CONFIG.batchDuckingVolume,
      batchDubbingEnabled:
        typeof parsed.batchDubbingEnabled === 'boolean'
          ? parsed.batchDubbingEnabled
          : DEFAULT_BATCH_EXPORT_CONFIG.batchDubbingEnabled,
      batchDubbingMode: parsed.batchDubbingMode === 'gender_multi' ? 'gender_multi' : 'single',
      batchDubbingVoice:
        typeof parsed.batchDubbingVoice === 'string' && parsed.batchDubbingVoice
          ? parsed.batchDubbingVoice
          : DEFAULT_BATCH_EXPORT_CONFIG.batchDubbingVoice,
      batchExportFormat: parsed.batchExportFormat === 'mkv' ? 'mkv' : 'mp4',
      batchExportResolution: ['original', '1080p', '720p', '2k'].includes(parsed.batchExportResolution)
        ? parsed.batchExportResolution
        : DEFAULT_BATCH_EXPORT_CONFIG.batchExportResolution,
      batchExportAspectRatio: ['original', '9:16', '16:9'].includes(parsed.batchExportAspectRatio)
        ? parsed.batchExportAspectRatio
        : DEFAULT_BATCH_EXPORT_CONFIG.batchExportAspectRatio,
      batchStages: {
        ocr: typeof parsed.batchStages?.ocr === 'boolean' ? parsed.batchStages.ocr : true,
        translate: typeof parsed.batchStages?.translate === 'boolean' ? parsed.batchStages.translate : true,
        dubbing: typeof parsed.batchStages?.dubbing === 'boolean' ? parsed.batchStages.dubbing : true,
        export: typeof parsed.batchStages?.export === 'boolean' ? parsed.batchStages.export : true,
      },
      activeBatchPresetId:
        typeof parsed.activeBatchPresetId === 'string' ? parsed.activeBatchPresetId : '',
      sortMode: ['ep_asc', 'ep_desc', 'name_asc', 'name_desc', 'status', 'duration'].includes(parsed.sortMode)
        ? parsed.sortMode
        : DEFAULT_BATCH_EXPORT_CONFIG.sortMode,
      gridCols: [2, 3, 4].includes(parsed.gridCols) ? parsed.gridCols : DEFAULT_BATCH_EXPORT_CONFIG.gridCols,
    };
  } catch {
    return { ...DEFAULT_BATCH_EXPORT_CONFIG };
  }
}

export function saveBatchExportConfig(config: BatchExportConfig): void {
  try {
    localStorage.setItem(BATCH_EXPORT_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Không thể lưu cấu hình xuất hàng loạt vào localStorage:', err);
  }
}

export function reconcileBatchConfigWithBackend(
  current: BatchExportConfig,
  pipe: GlobalPipelineSettings
): BatchExportConfig {
  const result: BatchExportConfig = { ...current };

  if (pipe.batch) {
    if (typeof pipe.batch.target_lang === 'string') result.batchTargetLang = pipe.batch.target_lang;
    if (typeof pipe.batch.ducking_volume === 'number') result.batchDuckingVolume = pipe.batch.ducking_volume;
    if (typeof pipe.batch.dubbing_enabled === 'boolean') result.batchDubbingEnabled = pipe.batch.dubbing_enabled;
    if (pipe.batch.dubbing_mode === 'single' || pipe.batch.dubbing_mode === 'gender_multi') {
      result.batchDubbingMode = pipe.batch.dubbing_mode;
    }
    if (typeof pipe.batch.dubbing_voice === 'string' && pipe.batch.dubbing_voice) {
      result.batchDubbingVoice = pipe.batch.dubbing_voice;
    }
    if (pipe.batch.export_format === 'mp4' || pipe.batch.export_format === 'mkv') {
      result.batchExportFormat = pipe.batch.export_format;
    }
    if (['original', '1080p', '720p', '2k'].includes(pipe.batch.export_resolution as any)) {
      result.batchExportResolution = pipe.batch.export_resolution as any;
    }
    if (['original', '9:16', '16:9'].includes(pipe.batch.export_aspect_ratio as any)) {
      result.batchExportAspectRatio = pipe.batch.export_aspect_ratio as any;
    }
    if (typeof pipe.batch.active_preset_id === 'string' && pipe.batch.active_preset_id.trim()) {
      result.activeBatchPresetId = pipe.batch.active_preset_id;
    }
    if (['ep_asc', 'ep_desc', 'name_asc', 'name_desc', 'status', 'duration'].includes(pipe.batch.sort_mode as any)) {
      result.sortMode = pipe.batch.sort_mode as any;
    }
    if ([2, 3, 4].includes(pipe.batch.grid_cols as any)) {
      result.gridCols = pipe.batch.grid_cols as any;
    }
    result.batchStages = {
      ocr: typeof pipe.batch.stage_ocr === 'boolean' ? pipe.batch.stage_ocr : result.batchStages.ocr,
      translate: typeof pipe.batch.stage_translate === 'boolean' ? pipe.batch.stage_translate : result.batchStages.translate,
      dubbing: typeof pipe.batch.stage_dubbing === 'boolean' ? pipe.batch.stage_dubbing : result.batchStages.dubbing,
      export: typeof pipe.batch.stage_export === 'boolean' ? pipe.batch.stage_export : result.batchStages.export,
    };
  } else {
    // Only check direct pipeline sections if batch was not explicitly set
    if (pipe.dubbing) {
      if (typeof pipe.dubbing.enabled === 'boolean') {
        result.batchDubbingEnabled = pipe.dubbing.enabled;
      }
      if (typeof pipe.dubbing.ducking_volume === 'number') {
        result.batchDuckingVolume = Math.round(pipe.dubbing.ducking_volume * 100);
      }
      if (pipe.dubbing.voice) {
        result.batchDubbingVoice = pipe.dubbing.voice;
      }
      if (pipe.dubbing.mode) {
        result.batchDubbingMode = pipe.dubbing.mode === 'multi' ? 'gender_multi' : 'single';
      }
    }

    if (pipe.translation?.target_language && pipe.translation.target_language !== 'none') {
      result.batchTargetLang = pipe.translation.target_language;
    }
  }

  return result;
}
