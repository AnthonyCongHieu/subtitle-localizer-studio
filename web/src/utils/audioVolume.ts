/** Unified editor audio volume helpers for original track + voiceover track. */
export const ORIGINAL_AUDIO_VOLUME_KEY = 'studio_original_audio_volume';
export const VOICEOVER_VOLUME_KEY = 'studio_voiceover_volume';

/** Legacy key kept only for one-time migration. */
const LEGACY_VOICEOVER_VOLUME_KEY = 'sls_voiceover_volume';

export function clampVolumePercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Convert UI percent (0-100) to HTMLMediaElement.volume gain (0-1).
 * Linear 1:1 mapping keeps VideoPlayer and Timeline identical.
 */
export function toAudioGain(volumePercent: number): number {
  const pct = clampVolumePercent(volumePercent);
  if (pct <= 0) return 0;
  if (pct >= 100) return 1;
  return pct / 100;
}

export function readStoredVolumePercent(key: string, fallback = 100): number {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return clampVolumePercent(parseInt(saved, 10));
    if (key === VOICEOVER_VOLUME_KEY) {
      const legacy = localStorage.getItem(LEGACY_VOICEOVER_VOLUME_KEY);
      if (legacy !== null) {
        const migrated = clampVolumePercent(parseInt(legacy, 10));
        localStorage.setItem(VOICEOVER_VOLUME_KEY, String(migrated));
        localStorage.removeItem(LEGACY_VOICEOVER_VOLUME_KEY);
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return clampVolumePercent(fallback);
}

export function writeStoredVolumePercent(key: string, value: number): number {
  const clamped = clampVolumePercent(value);
  try {
    localStorage.setItem(key, String(clamped));
    if (key === VOICEOVER_VOLUME_KEY) {
      localStorage.removeItem(LEGACY_VOICEOVER_VOLUME_KEY);
    }
  } catch {
    /* ignore */
  }
  return clamped;
}
