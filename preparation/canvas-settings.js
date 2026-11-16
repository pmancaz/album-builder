/*
  This module is the shared "recipe book" for Spotify Canvases. It keeps the
  saved project format, preset values, loop mathematics, event timing, output
  names, and validation in one place. Keeping these rules outside app.js makes
  them easier to test without opening the desktop interface.
*/

export const CANVAS_PRESETS = Object.freeze([
  { id: 'clean-35mm', name: 'Clean 35 mm', description: 'Fine grain, very stable registration, minimal dirt, and restrained highlight glow.' },
  { id: 'used-16mm', name: 'Used 16 mm', description: 'Controlled moving grain, gentle weave, intermittent dust, mild softness, and rare scratches.' },
  { id: 'worn-16mm', name: 'Worn 16 mm', description: 'Stronger grain and weave with more dirt and occasional density faults.' },
  { id: 'aged-8mm', name: 'Aged 8 mm', description: 'Larger grain, softer focus, warmer density, and more visible mechanical instability.' },
  { id: 'archival-monochrome', name: 'Archival monochrome', description: 'Black-and-white density response, moderate silver-like grain, and gentle edge fall-off.' },
  { id: 'damaged-projection', name: 'Damaged projection', description: 'A deliberately stronger treatment with faults and rare damage; use carefully in a repeating loop.' },
]);

export const CANVAS_COMPOSITION_MODES = Object.freeze([
  { id: 'fill', name: 'Fill frame', description: 'Fill the portrait frame and crop the overflow.' },
  { id: 'fit', name: 'Fit complete image', description: 'Keep the complete image visible over a derived background.' },
  { id: 'artwork-background', name: 'Artwork with background', description: 'Place the square artwork over a quiet background derived from the same image.' },
  { id: 'crop', name: 'Full-bleed crop', description: 'Use manual scale and position for a full-frame portrait crop.' },
]);

export const CANVAS_BACKGROUND_TREATMENTS = Object.freeze([
  { id: 'blurred', name: 'Blurred enlargement' },
  { id: 'darkened', name: 'Darkened enlargement' },
  { id: 'solid', name: 'Solid colour' },
]);

// Presets change only the film behaviour. Composition, source image, output
// choices, and the random seed remain specific to the current release.
const PRESET_VALUES = Object.freeze({
  'clean-35mm': {
    filmFormat: '35mm', filmCondition: 'clean', intensity: 24, grainAmount: 24, grainSize: 20, grainClumping: 16,
    exposureFlicker: 16, colourInstability: 8, horizontalWeave: 12, verticalJitter: 10, rotation: 8, scaleBreathing: 8,
    opticalSoftness: 14, halation: 12, vignette: 18, dustAmount: 8, scratchProbability: 2, scratchPersistence: 8,
    hairProbability: 0, damageProbability: 0, lightLeakProbability: 0, cueMarks: 'off', monochrome: false,
  },
  'used-16mm': {
    filmFormat: '16mm', filmCondition: 'used', intensity: 32, grainAmount: 42, grainSize: 42, grainClumping: 34,
    exposureFlicker: 28, colourInstability: 12, horizontalWeave: 28, verticalJitter: 24, rotation: 18, scaleBreathing: 12,
    opticalSoftness: 30, halation: 16, vignette: 30, dustAmount: 28, scratchProbability: 12, scratchPersistence: 24,
    hairProbability: 0, damageProbability: 0, lightLeakProbability: 0, cueMarks: 'off', monochrome: false,
  },
  'worn-16mm': {
    filmFormat: '16mm', filmCondition: 'worn', intensity: 48, grainAmount: 58, grainSize: 48, grainClumping: 52,
    exposureFlicker: 44, colourInstability: 24, horizontalWeave: 48, verticalJitter: 44, rotation: 38, scaleBreathing: 24,
    opticalSoftness: 42, halation: 24, vignette: 42, dustAmount: 52, scratchProbability: 38, scratchPersistence: 46,
    hairProbability: 8, damageProbability: 8, lightLeakProbability: 2, cueMarks: 'off', monochrome: false,
  },
  'aged-8mm': {
    filmFormat: '8mm', filmCondition: 'aged', intensity: 54, grainAmount: 66, grainSize: 72, grainClumping: 62,
    exposureFlicker: 52, colourInstability: 34, horizontalWeave: 56, verticalJitter: 58, rotation: 48, scaleBreathing: 34,
    opticalSoftness: 58, halation: 28, vignette: 48, dustAmount: 58, scratchProbability: 34, scratchPersistence: 42,
    hairProbability: 8, damageProbability: 10, lightLeakProbability: 4, cueMarks: 'off', monochrome: false,
  },
  'archival-monochrome': {
    filmFormat: '35mm', filmCondition: 'archival', intensity: 34, grainAmount: 44, grainSize: 36, grainClumping: 38,
    exposureFlicker: 24, colourInstability: 0, horizontalWeave: 22, verticalJitter: 18, rotation: 14, scaleBreathing: 10,
    opticalSoftness: 28, halation: 8, vignette: 34, dustAmount: 24, scratchProbability: 10, scratchPersistence: 28,
    hairProbability: 1, damageProbability: 2, lightLeakProbability: 0, cueMarks: 'off', monochrome: true,
  },
  'damaged-projection': {
    filmFormat: '16mm', filmCondition: 'damaged', intensity: 74, grainAmount: 72, grainSize: 56, grainClumping: 70,
    exposureFlicker: 70, colourInstability: 46, horizontalWeave: 72, verticalJitter: 76, rotation: 66, scaleBreathing: 48,
    opticalSoftness: 56, halation: 38, vignette: 58, dustAmount: 76, scratchProbability: 72, scratchPersistence: 64,
    hairProbability: 30, damageProbability: 38, lightLeakProbability: 16, cueMarks: 'rare', monochrome: false,
  },
});

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};
const choose = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const percentage = (value, fallback) => clamp(value, 0, 100, fallback);

function imageSource(value = {}) {
  const source = value?.source === 'file' ? 'file' : 'artwork';
  return {
    source,
    path: source === 'file' ? String(value?.path || '') : '',
    name: String(value?.name || (source === 'file' ? 'Selected image' : 'Album artwork')),
    kind: 'image',
  };
}

export function defaultCanvasSettings() {
  return {
    source: imageSource(),
    compositionMode: 'artwork-background',
    backgroundTreatment: 'blurred',
    backgroundColor: '#111315',
    positionX: 50,
    positionY: 50,
    imageScale: 100,
    safeArea: true,
    preset: 'used-16mm',
    seed: 271828,
    durationSeconds: 8,
    filmFrameRate: 24,
    outputFrameRate: 24,
    exportMode: 'single',
    ...PRESET_VALUES['used-16mm'],
  };
}

export function normaliseCanvasSettings(value = {}) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = defaultCanvasSettings();
  // Releases saved by the first Canvas implementation had one of three effect
  // names. Map those projects into the closest new film preset automatically.
  const legacyPreset = value.effect === 'gate-weave'
    ? 'clean-35mm'
    : value.effect === 'emulsion-haze' ? 'aged-8mm' : 'used-16mm';
  const preset = CANVAS_PRESETS.some((item) => item.id === value.preset)
    ? value.preset
    : (value.effect ? legacyPreset : defaults.preset);
  const presetDefaults = PRESET_VALUES[preset];
  const duration = Math.round(clamp(value.durationSeconds, 3, 8, defaults.durationSeconds));
  const outputFrameRate = choose(Number(value.outputFrameRate), [24, 30], defaults.outputFrameRate);
  const filmFrameRate = choose(Number(value.filmFrameRate), [18, 24, 30], defaults.filmFrameRate);
  const legacyIntensity = value.intensity === undefined ? undefined : value.intensity;
  const legacyMovement = value.movement === undefined ? undefined : value.movement;
  return {
    source: imageSource(value.source),
    compositionMode: choose(value.compositionMode, CANVAS_COMPOSITION_MODES.map((item) => item.id), defaults.compositionMode),
    backgroundTreatment: choose(value.backgroundTreatment, CANVAS_BACKGROUND_TREATMENTS.map((item) => item.id), defaults.backgroundTreatment),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(String(value.backgroundColor || '')) ? value.backgroundColor : defaults.backgroundColor,
    positionX: percentage(value.positionX, defaults.positionX),
    positionY: percentage(value.positionY, defaults.positionY),
    imageScale: clamp(value.imageScale, 80, 160, defaults.imageScale),
    safeArea: value.safeArea === undefined ? defaults.safeArea : Boolean(value.safeArea),
    preset,
    seed: Math.round(clamp(value.seed, 1, 2_147_483_646, defaults.seed)),
    durationSeconds: duration,
    filmFrameRate,
    outputFrameRate,
    exportMode: value.exportMode === 'tracks' ? 'tracks' : 'single',
    filmFormat: choose(value.filmFormat, ['35mm', '16mm', '8mm'], presetDefaults.filmFormat),
    filmCondition: choose(value.filmCondition, ['clean', 'used', 'worn', 'aged', 'archival', 'damaged'], presetDefaults.filmCondition),
    intensity: percentage(value.intensity, presetDefaults.intensity),
    grainAmount: percentage(value.grainAmount ?? value.grain, presetDefaults.grainAmount),
    grainSize: percentage(value.grainSize, presetDefaults.grainSize),
    grainClumping: percentage(value.grainClumping, presetDefaults.grainClumping),
    exposureFlicker: percentage(value.exposureFlicker ?? value.flicker, presetDefaults.exposureFlicker),
    colourInstability: percentage(value.colourInstability, presetDefaults.colourInstability),
    horizontalWeave: percentage(value.horizontalWeave ?? legacyMovement, presetDefaults.horizontalWeave),
    verticalJitter: percentage(value.verticalJitter ?? legacyMovement, presetDefaults.verticalJitter),
    rotation: percentage(value.rotation, presetDefaults.rotation),
    scaleBreathing: percentage(value.scaleBreathing, presetDefaults.scaleBreathing),
    opticalSoftness: percentage(value.opticalSoftness, presetDefaults.opticalSoftness),
    halation: percentage(value.halation, presetDefaults.halation),
    vignette: percentage(value.vignette, presetDefaults.vignette),
    dustAmount: percentage(value.dustAmount, presetDefaults.dustAmount),
    scratchProbability: percentage(value.scratchProbability, presetDefaults.scratchProbability),
    scratchPersistence: percentage(value.scratchPersistence, presetDefaults.scratchPersistence),
    hairProbability: percentage(value.hairProbability, presetDefaults.hairProbability),
    damageProbability: percentage(value.damageProbability, presetDefaults.damageProbability),
    lightLeakProbability: percentage(value.lightLeakProbability, presetDefaults.lightLeakProbability),
    cueMarks: choose(value.cueMarks, ['off', 'rare', 'always'], presetDefaults.cueMarks),
    monochrome: value.monochrome === undefined ? presetDefaults.monochrome : Boolean(value.monochrome),
  };
}

export function applyCanvasPreset(current, presetId) {
  const preset = CANVAS_PRESETS.some((item) => item.id === presetId) ? presetId : 'used-16mm';
  return normaliseCanvasSettings({ ...current, preset, ...PRESET_VALUES[preset] });
}

function seededRandom(seed) {
  let state = Math.abs(Math.trunc(seed)) || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

// Integer-frequency sine waves always complete whole cycles. Combining three
// of them creates wandering movement without breaking the loop seam.
function periodicSignal(seed, phase, frequencies = [1, 2, 3]) {
  const random = seededRandom(seed);
  let value = 0;
  let total = 0;
  frequencies.forEach((frequency, index) => {
    const weight = 1 / (index + 1);
    const angle = random() * Math.PI * 2;
    value += Math.sin(Math.PI * 2 * frequency * phase + angle) * weight;
    total += weight;
  });
  return value / total;
}

export function canvasLoopFrame(value, elapsedSeconds, variantSeed = 1) {
  const settings = normaliseCanvasSettings(value);
  const phase = ((Number(elapsedSeconds) || 0) / settings.durationSeconds % 1 + 1) % 1;
  const seed = (Number(variantSeed) || settings.seed) >>> 0;
  const intensity = settings.intensity / 100;
  const lowActivity = 0.34 + intensity * 0.86;
  const formatFactor = settings.filmFormat === '35mm' ? 0.78 : settings.filmFormat === '8mm' ? 1.32 : 1;
  const conditionFactor = settings.filmCondition === 'clean' ? 0.72
    : settings.filmCondition === 'worn' ? 1.18
      : settings.filmCondition === 'aged' ? 1.28 : settings.filmCondition === 'damaged' ? 1.48 : 1;
  const horizontalAmplitude = (0.22 + settings.horizontalWeave / 100 * 2.6) * lowActivity * conditionFactor;
  const verticalAmplitude = (0.26 + settings.verticalJitter / 100 * 3.3) * lowActivity * conditionFactor;
  const rotationAmplitude = (0.008 + settings.rotation / 100 * 0.14) * lowActivity * conditionFactor;
  const scaleAmplitude = (0.0002 + settings.scaleBreathing / 100 * 0.0012) * lowActivity;
  const flickerAmplitude = (0.003 + settings.exposureFlicker / 100 * 0.022) * lowActivity;
  const overscan = 0.015 + intensity * 0.035;
  const grainFrameCount = Math.max(1, Math.round(settings.durationSeconds * settings.filmFrameRate));
  const grainFrame = Math.floor(phase * grainFrameCount) % grainFrameCount;
  return {
    phase,
    grainFrame,
    x: periodicSignal(seed + 11, phase, [1, 2, 5]) * horizontalAmplitude,
    y: periodicSignal(seed + 23, phase, [1, 3, 7]) * verticalAmplitude,
    rotation: periodicSignal(seed + 37, phase, [1, 2, 4]) * rotationAmplitude,
    scale: 1 + overscan + periodicSignal(seed + 41, phase, [1, 2]) * scaleAmplitude,
    brightness: 1
      + periodicSignal(seed + 53, phase, [1, 2, 6]) * flickerAmplitude * 0.72
      + periodicSignal(seed + 59, phase, [11, 17, 23]) * flickerAmplitude * 0.28,
    contrast: 1 + (settings.intensity / 100) * 0.018 + periodicSignal(seed + 61, phase, [1, 3]) * 0.006,
    warmth: periodicSignal(seed + 71, phase, [1, 2]) * settings.colourInstability / 100 * 0.012,
    softness: 0.18 + settings.opticalSoftness / 100 * 0.72 + (formatFactor - 0.78) * 0.18
      + periodicSignal(seed + 83, phase, [1, 2]) * settings.opticalSoftness / 100 * 0.10,
    halation: settings.halation / 100 * (0.012 + intensity * 0.035),
    vignette: settings.vignette / 100 * (0.03 + intensity * 0.075),
    grainAmount: settings.grainAmount / 100 * (0.06 + intensity * 0.20),
    grainSize: (0.45 + settings.grainSize / 100 * 1.75) * formatFactor,
    grainClumping: settings.grainClumping / 100,
  };
}

// Keep the earlier exported name available while app.js migrates to the more
// descriptive function name.
export const canvasPreviewFrame = canvasLoopFrame;

function eventActive(event, frame, totalFrames) {
  const distance = (frame - event.birthFrame + totalFrames) % totalFrames;
  return distance < event.lifeFrames;
}

export function canvasEventSchedule(value, variantSeed = 1) {
  const settings = normaliseCanvasSettings(value);
  const totalFrames = Math.max(1, Math.round(settings.durationSeconds * settings.filmFrameRate));
  const random = seededRandom((Number(variantSeed) || settings.seed) >>> 0);
  const dust = [];
  const dustEvents = Math.round(settings.durationSeconds * (1.4 + settings.dustAmount / 100 * 7.4));
  for (let index = 0; index < dustEvents; index += 1) {
    dust.push({
      birthFrame: Math.floor(random() * totalFrames),
      lifeFrames: random() < 0.74 ? 1 : 2 + Math.floor(random() * 3),
      x: random(), y: random(), size: 0.5 + random() * (2.1 + settings.dustAmount / 100 * 2.4),
      opacity: 0.07 + random() * 0.19, dark: random() < 0.36, gateSpace: random() < 0.18,
      shape: Math.floor(random() * 3), driftX: (random() - 0.5) * 2.2, driftY: (random() - 0.5) * 2.2,
    });
  }
  const scratches = [];
  if (random() < settings.scratchProbability / 100) {
    scratches.push({
      birthFrame: Math.floor(random() * totalFrames),
      lifeFrames: Math.max(4, Math.round(4 + settings.scratchPersistence / 100 * 26)),
      x: 0.08 + random() * 0.84, opacity: 0.04 + random() * 0.11, dark: random() < 0.3,
      bend: (random() - 0.5) * 0.018, gateSpace: random() < 0.25,
    });
  }
  const rareEvent = (probability, minimumFrames, maximumFrames) => random() < probability / 100
    ? [{ birthFrame: Math.floor(random() * totalFrames), lifeFrames: minimumFrames + Math.floor(random() * (maximumFrames - minimumFrames + 1)), x: random(), y: random(), opacity: 0.04 + random() * 0.10 }]
    : [];
  const hairs = rareEvent(settings.hairProbability * 0.45, 8, 28);
  const damage = rareEvent(settings.damageProbability * 0.35, 1, 7);
  const lightLeaks = rareEvent(settings.lightLeakProbability * 0.5, 6, 24);
  const cueProbability = settings.cueMarks === 'always' ? 100 : settings.cueMarks === 'rare' ? 20 : 0;
  const cueMarks = rareEvent(cueProbability, 3, 6);
  return { totalFrames, dust, scratches, hairs, damage, lightLeaks, cueMarks };
}

export function activeCanvasEvents(schedule, grainFrame) {
  const active = {};
  for (const key of ['dust', 'scratches', 'hairs', 'damage', 'lightLeaks', 'cueMarks']) {
    active[key] = schedule[key].filter((event) => eventActive(event, grainFrame, schedule.totalFrames));
  }
  return active;
}

export function nextCanvasSeed(currentSeed) {
  return ((Math.round(Number(currentSeed) || 1) * 1_103_515_245 + 12_345) >>> 0) || 1;
}

export function canvasOutputFileName(track, index, releaseTitle = 'Release') {
  const source = track
    ? String(track?.metadata?.title || track?.fileName || `Track ${index + 1}`)
    : String(releaseTitle || 'Release');
  const title = source.replace(/\.[^/.]+$/, '').replace(/[\/:*?"<>|]/g, '-').trim()
    || (track ? `Track ${index + 1}` : 'Release');
  return track
    ? `${String(index + 1).padStart(2, '0')} - ${title} - Canvas.mp4`
    : `${title} - Canvas.mp4`;
}

export function canvasVariants(settings, tracks = [], releaseTitle = 'Release') {
  const normalized = normaliseCanvasSettings(settings);
  const makeVariant = (track, index) => ({
    outputFileName: canvasOutputFileName(track, index, releaseTitle),
    seed: track ? (((normalized.seed + (index + 1) * 104_729) >>> 0) || index + 1) : normalized.seed,
  });
  return normalized.exportMode === 'tracks'
    ? tracks.map(makeVariant)
    : [makeVariant(null, 0)];
}

export function canvasValidationErrors(value, hasSource = true, trackCount = 0) {
  const settings = normaliseCanvasSettings(value);
  const errors = [];
  if (!hasSource) errors.push('Choose an album-artwork or image source.');
  if (settings.durationSeconds < 3 || settings.durationSeconds > 8) errors.push('Canvas duration must be between 3 and 8 seconds.');
  if (![24, 30].includes(settings.outputFrameRate)) errors.push('Output frame rate must be 24 or 30 fps.');
  if (settings.exportMode === 'tracks' && trackCount < 1) errors.push('Add at least one master for per-track Canvas export.');
  return errors;
}
