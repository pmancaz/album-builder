/*
  Video settings are normalised in one place so older releases automatically
  receive sensible defaults when the Video section is introduced.
*/

export function defaultVideoSettings() {
  return {
    foreground: { source: 'artwork', path: '', name: 'Album artwork', kind: 'image' },
    background: { source: 'artwork', path: '', name: 'Album artwork', kind: 'image' },
    backgroundMatchesForeground: true,
    backgroundBlur: 28,
    backgroundOpacity: 72,
    foregroundSize: 78,
    foregroundShadowEnabled: false,
    foregroundShadowIntensity: 35,
    logoEnabled: true,
    logoOpacity: 100,
    logoSize: 10,
    logoX: 6,
    logoY: 8,
  };
}

function mediaSource(value, fallback) {
  const source = value?.source === 'file' ? 'file' : 'artwork';
  return {
    source,
    path: source === 'file' ? String(value?.path || '') : '',
    name: String(value?.name || fallback),
    kind: value?.kind === 'video' ? 'video' : 'image',
  };
}

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

export function normaliseVideoSettings(value = {}) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = defaultVideoSettings();
  return {
    foreground: mediaSource(value.foreground, 'Album artwork'),
    background: mediaSource(value.background, 'Album artwork'),
    backgroundMatchesForeground: value.backgroundMatchesForeground ?? defaults.backgroundMatchesForeground,
    // 200 gives the video background an intentionally extreme, image-editor
    // style blur while still accepting every older project's 0–80 value.
    backgroundBlur: clamp(value.backgroundBlur, 0, 200, defaults.backgroundBlur),
    backgroundOpacity: clamp(value.backgroundOpacity, 0, 100, defaults.backgroundOpacity),
    foregroundSize: clamp(value.foregroundSize, 20, 100, defaults.foregroundSize),
    foregroundShadowEnabled: value.foregroundShadowEnabled ?? defaults.foregroundShadowEnabled,
    foregroundShadowIntensity: clamp(value.foregroundShadowIntensity, 0, 100, defaults.foregroundShadowIntensity),
    logoEnabled: value.logoEnabled ?? defaults.logoEnabled,
    logoOpacity: clamp(value.logoOpacity, 0, 100, defaults.logoOpacity),
    logoSize: clamp(value.logoSize, 2, 30, defaults.logoSize),
    logoX: clamp(value.logoX, 0, 100, defaults.logoX),
    logoY: clamp(value.logoY, 0, 100, defaults.logoY),
  };
}

export function videoTemplateSettings(value = {}) {
  const settings = normaliseVideoSettings(value);
  // Imported visual paths belong to one release. Templates deliberately keep
  // only layout/effect choices so the next release can supply its own artwork.
  return {
    backgroundMatchesForeground: settings.backgroundMatchesForeground,
    backgroundBlur: settings.backgroundBlur,
    backgroundOpacity: settings.backgroundOpacity,
    foregroundSize: settings.foregroundSize,
    foregroundShadowEnabled: settings.foregroundShadowEnabled,
    foregroundShadowIntensity: settings.foregroundShadowIntensity,
    logoEnabled: settings.logoEnabled,
    logoOpacity: settings.logoOpacity,
    logoSize: settings.logoSize,
    logoX: settings.logoX,
    logoY: settings.logoY,
  };
}

export function applyVideoTemplate(current = {}, template = {}) {
  return normaliseVideoSettings({
    ...current,
    ...videoTemplateSettings(template),
    // Never replace the current release's selected image or video files.
    foreground: current.foreground,
    background: current.background,
  });
}

export function videoOutputFileName(track, index) {
  const title = String(track?.metadata?.title || track?.fileName || `Track ${index + 1}`)
    .replace(/\.[^/.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim() || `Track ${index + 1}`;
  return `${String(index + 1).padStart(2, '0')} - ${title}.mp4`;
}
