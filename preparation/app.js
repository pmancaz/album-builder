import './styles.css';
import './integrated.css';
import { applyFilenamePattern, buildPlatformCopies, formatDate } from './release-templates.js';
import { hashSeed, randomFromSeed } from './release-symbol.js';
import { coverPlacement, movedBackgroundPosition } from './artwork-position.js';
import { moveMasterAroundTarget, moveMasterToIndex } from './master-order.js';
import { applyArtistPresetToMasters, normaliseArtistPreset, refreshedArtistPresetTags } from './artist-presets.js';
import { normaliseSocialPosts } from './social-posts.js';
import { relinkPreparedMasters } from './prepared-masters.js';
import { buildAiDraftRequest, DEFAULT_OPENAI_MODEL, mergeDraftIntoProject } from './ai-drafting.js';
import { applyVideoTemplate, defaultVideoSettings, normaliseVideoSettings, videoOutputFileName, videoTemplateSettings } from './video-settings.js';
import { videoPreviewStyle } from './video-blur.js';
import { normaliseLeadSingles, selectedLeadSingle, setLeadSingle } from './master-flags.js';
import {
  CANVAS_COMPOSITION_MODES, CANVAS_PRESETS, activeCanvasEvents, applyCanvasPreset, canvasEventSchedule,
  canvasPreviewFrame, canvasValidationErrors, canvasVariants, defaultCanvasSettings, nextCanvasSeed,
  normaliseCanvasSettings,
} from './canvas-settings.js';

/*
  Release Preparer is intentionally local-first. The browser layer owns the
  editable workspace and previews; the small Rust layer reads real audio tags,
  stores projects, and exports finished files where web pages cannot.
*/

const host = window.parent !== window ? window.parent.AlbumPreparationHost : null;
let boundGeneration = null;
let applyingAlbum = false;
let preparationOperations = 0;
let albumTrackIds = [];
let masterPreviewRequest = 0;
let cancelMasterMetadataWait = null;
let artworkDrawing = Promise.resolve();
let mediaGeneration = 0;
let videoPreviewTimer = null;
let canvasPreviewTimer = null;
let previewsSuspended = false;
const videoPreviewElements = new Set();
const cancelVisualLoads = new Set();
const exportOperations = new Set();
const desktop = {};
async function initialiseDesktopBridge() {
  if (host) {
    desktop.invoke = host.invoke; desktop.open = host.open; desktop.listen = host.listen;
    desktop.convertFileSrc = host.convertFileSrc;
    return;
  }
  if (!(window.__TAURI__ || window.__TAURI_INTERNALS__)) return;
  const [core, dialog, event] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/event')]);
  desktop.invoke = core.invoke;
  desktop.convertFileSrc = core.convertFileSrc;
  desktop.open = dialog.open;
  desktop.listen = event.listen;
}

const DEFAULT_MARK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
    <rect x="8" y="8" width="484" height="484" fill="none" stroke="white" stroke-width="16"/>
    <circle cx="250" cy="250" r="138" fill="none" stroke="white" stroke-width="11"/>
    <path d="M250 112v276M112 250h276" stroke="white" stroke-width="7"/>
    <circle cx="250" cy="250" r="34" fill="white"/>
  </svg>`)}`;

const RELEASE_FIELD_IDS = [
  'releaseTitleInput', 'artistInput', 'albumArtistInput', 'releaseDateInput', 'yearInput', 'labelInput', 'catalogueInput',
  'composerInput', 'discNumberInput', 'commentInput', 'compilationInput', 'spotifyUrlInput', 'appleMusicUrlInput',
  'genreInput', 'upcInput', 'copyrightInput', 'shortDescriptionInput', 'longDescriptionInput', 'creditsInput',
  'downloadUrlInput', 'bandcampUrlInput', 'streamingUrlInput', 'websiteUrlInput', 'instagramUrlInput', 'youtubeUrlInput',
  'soundcloudUrlInput', 'tagsInput', 'mediaHeadlineInput', 'mediaAngleInput', 'playlistPitchInput', 'pressContactInput', 'filenamePatternInput', 'brainstormInput',
];

const ARTWORK_FIELD_IDS = [
  'artworkTextEnabledInput', 'artworkTitleInput', 'artworkArtistInput', 'artworkFontInput', 'artworkTextColorInput', 'artworkTextAlignInput',
  'artworkTextBoldInput', 'artworkTextItalicInput', 'artworkTitleSizeInput', 'artworkTextOpacityInput', 'artworkTextStretchInput',
  'artworkLetterSpacingInput', 'artworkTextXInput', 'artworkTextYInput', 'artworkLogoEnabledInput', 'artworkLogoColorInput',
  'artworkLogoOpacityInput', 'artworkLogoSizeInput', 'artworkLogoXInput', 'artworkLogoYInput', 'artworkSymbolEnabledInput',
  'artworkSymbolColorInput', 'artworkSymbolBoxColorInput', 'artworkSymbolBoxEnabledInput', 'artworkSymbolOpacityInput',
  'artworkSymbolSizeInput', 'artworkSymbolXInput', 'artworkSymbolYInput',
];

const state = {
  projectId: null,
  masters: [],
  backgroundDataUrl: '',
  backgroundName: '',
  backgroundPositionX: 50,
  backgroundPositionY: 50,
  backgroundPositioning: false,
  backgroundRenderedBounds: null,
  backgroundDrag: null,
  logoDataUrl: DEFAULT_MARK,
  logoName: 'Placeholder logo',
  logoIsPlaceholder: true,
  activeStage: 'release',
  activeCopyTab: 'bandcamp',
  dirty: false,
  changeRevision: 0,
  saving: false,
  saveQueued: false,
  saveTimer: null,
  updatingNonMusic: false,
  nonMusicUpdateQueued: false,
  generatingDraft: false,
  // This is only a live UI flag. The actual secret stays in macOS Keychain.
  openAiKeySaved: false,
  drawingNumber: 0,
  lastExportDir: '',
  lastExportFolderName: '',
  activeArtistPresetId: '',
  socialPosts: normaliseSocialPosts(),
  previewTrackId: null,
  previewLoadingTrackId: null,
  draggingMasterId: null,
  videoSettings: defaultVideoSettings(),
  videoPreviewPlaying: true,
  videoPreviewFrame: 0,
  videoPreviewMedia: new Map(),
  videoExportActiveId: '',
  videoExportCancelling: false,
  // The logo is cached separately so the preview does not decode the same image every frame.
  videoLogoPreviewSource: '',
  videoLogoPreviewPromise: null,
  activeVideoPanel: 'tracks',
  canvasSettings: defaultCanvasSettings(),
  canvasPreviewPlaying: true,
  canvasPreviewFrame: 0,
  canvasPreviewStartedAt: performance.now(),
  canvasPreviewMode: 'normal',
  canvasEventSchedule: null,
  canvasCompressedPreviewPath: '',
  canvasRenderedBounds: null,
  canvasPositioning: false,
  canvasDrag: null,
  canvasNoiseCanvas: null,
  canvasExportActiveId: '',
  canvasExportCancelling: false,
};

// A single shared audio element guarantees that starting one master stops the previous one.
const masterPreviewAudio = new Audio();

const byId = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  'projectNameInput', 'saveStatus', 'savedProjectSelect', 'artistPresetSelect', 'manageArtistPresetsButton', 'newProjectButton', 'saveProjectButton', 'quickExportButton', 'appSettingsButton', 'tipsButton', 'themeButton', 'progressBar', 'progressLabel',
  'releaseReadout', 'shortDescriptionCount', 'chooseMastersButton', 'filenamePatternInput', 'mastersList', 'mastersDropzone', 'masterCount', 'masterIssueCount',
  'masterRowTemplate', 'artworkCanvas', 'chooseBackgroundButton', 'backgroundPositionButton', 'chooseLogoButton', 'useDefaultMarkButton', 'saveArtworkPresetButton', 'saveArtworkPresetAsNewButton',
  'artworkPresetSelect', 'artworkPresetNameInput', 'duplicateArtworkPresetButton', 'deleteArtworkPresetButton', 'copyPreview', 'copyTextButton', 'checklist', 'checklistSummary',
  'overallReadout', 'folderTree', 'exportReleaseButton', 'updateNonMusicButton', 'chooseDifferentExportButton', 'exportStatus', 'recentReleasesList', 'logoStatus',
  'artistPresetDialog', 'closeArtistPresetDialogButton', 'artistPresetEditorSelect', 'newArtistPresetButton', 'deleteArtistPresetButton',
  'artistPresetNameInput', 'artistPresetPrimaryArtistInput', 'artistPresetAlbumArtistInput', 'artistPresetComposerInput',
  'artistPresetBandcampUrlInput', 'artistPresetWebsiteUrlInput', 'artistPresetInstagramUrlInput', 'artistPresetYoutubeUrlInput',
  'artistPresetSoundcloudUrlInput', 'artistPresetTagsInput', 'artistPresetPressContactInput', 'artistPresetStatus', 'applyArtistPresetButton',
  'saveArtistPresetAsNewButton', 'saveArtistPresetButton',
  'brainstormHandoffStatus', 'openAiSettingsDialog', 'closeOpenAiSettingsDialogButton', 'openAiSettingsStatus', 'openAiApiKeyInput', 'openAiModelInput', 'saveOpenAiKeyButton', 'removeOpenAiKeyButton', 'generateAiDraftButton', 'refreshAiDraftButton',
  'socialPostsList', 'socialPostCount', 'addSocialPostButton', 'playlistPitchLeadSingle',
  'videoReadout', 'videoPreviewBackgroundCanvas', 'videoPreviewCanvas', 'videoPreviewStatus', 'playVideoPreviewButton',
  'videoPresetSelect', 'videoPresetNameInput', 'defaultVideoPresetInput', 'saveVideoPresetButton', 'saveVideoPresetAsNewButton', 'duplicateVideoPresetButton', 'deleteVideoPresetButton',
  'videoForegroundName', 'videoBackgroundName', 'useArtworkForegroundButton', 'chooseVideoForegroundButton',
  'videoBackgroundMatchesInput', 'useArtworkBackgroundButton', 'chooseVideoBackgroundButton',
  'videoForegroundSizeInput', 'videoForegroundSizeReadout', 'videoForegroundShadowEnabledInput', 'videoForegroundShadowIntensityInput', 'videoForegroundShadowIntensityReadout', 'videoBackgroundBlurInput', 'videoBackgroundBlurReadout',
  'videoBackgroundOpacityInput', 'videoBackgroundOpacityReadout', 'videoLogoEnabledInput',
  'videoLogoOpacityInput', 'videoLogoOpacityReadout', 'videoLogoSizeInput', 'videoLogoSizeReadout',
  'videoLogoXInput', 'videoLogoXReadout', 'videoLogoYInput', 'videoLogoYReadout',
  'exportTrackVideosButton', 'cancelTrackVideosButton', 'videoExportProgress', 'videoExportProgressBar', 'videoExportProgressLabel', 'videoExportStatus',
  'showTrackVideosButton', 'showCanvasesButton', 'canvasPreviewBackgroundCanvas', 'canvasPreviewCanvas', 'canvasCompressedPreviewVideo', 'canvasSafeAreaOverlay',
  'playCanvasPreviewButton', 'canvasSeamPreviewButton', 'canvasCompressedPreviewButton', 'canvasPositionButton', 'canvasPreviewStatus',
  'canvasSourceName', 'useArtworkCanvasButton', 'chooseCanvasImageButton', 'canvasCompositionModeInput', 'canvasBackgroundTreatmentInput', 'canvasBackgroundColorInput',
  'canvasImageScaleInput', 'canvasImageScaleReadout', 'canvasSafeAreaInput', 'canvasPresetInput', 'canvasPresetDescription', 'canvasFilmFormatInput', 'canvasFilmConditionInput', 'canvasSeedInput', 'regenerateCanvasButton', 'resetCanvasDefaultsButton',
  'canvasIntensityInput', 'canvasIntensityReadout', 'canvasGrainAmountInput', 'canvasGrainAmountReadout', 'canvasGrainSizeInput', 'canvasGrainSizeReadout',
  'canvasGrainClumpingInput', 'canvasGrainClumpingReadout', 'canvasExposureFlickerInput', 'canvasExposureFlickerReadout', 'canvasColourInstabilityInput', 'canvasColourInstabilityReadout',
  'canvasHorizontalWeaveInput', 'canvasHorizontalWeaveReadout', 'canvasVerticalJitterInput', 'canvasVerticalJitterReadout', 'canvasRotationInput', 'canvasRotationReadout',
  'canvasScaleBreathingInput', 'canvasScaleBreathingReadout', 'canvasOpticalSoftnessInput', 'canvasOpticalSoftnessReadout', 'canvasHalationInput', 'canvasHalationReadout',
  'canvasVignetteInput', 'canvasVignetteReadout', 'canvasMonochromeInput', 'canvasDustAmountInput', 'canvasDustAmountReadout', 'canvasScratchProbabilityInput', 'canvasScratchProbabilityReadout',
  'canvasScratchPersistenceInput', 'canvasScratchPersistenceReadout', 'canvasHairProbabilityInput', 'canvasHairProbabilityReadout', 'canvasDamageProbabilityInput', 'canvasDamageProbabilityReadout',
  'canvasLightLeakProbabilityInput', 'canvasLightLeakProbabilityReadout', 'canvasCueMarksInput', 'canvasDurationInput', 'canvasDurationReadout', 'canvasFilmFrameRateInput', 'canvasOutputFrameRateInput',
  'canvasExportModeInput', 'canvasValidationNote',
  'exportCanvasesButton', 'cancelCanvasesButton', 'canvasExportProgress', 'canvasExportProgressBar', 'canvasExportProgressLabel', 'canvasExportStatus',
  ...RELEASE_FIELD_IDS, ...ARTWORK_FIELD_IDS,
].map((id) => [id, byId(id)]));

function isDesktop() { return host ? host.isDesktop() : Boolean(desktop.invoke); }
function value(id) { return byId(id)?.value?.trim() || ''; }
function setValue(id, next = '') { if (byId(id)) byId(id).value = next; }

const TIPS_PREFERENCE_KEY = 'release-preparer-tips-visible';
function setTipsVisible(visible) {
  document.documentElement.dataset.tips = visible ? 'visible' : 'hidden';
  elements.tipsButton.setAttribute('aria-pressed', String(visible));
  elements.tipsButton.title = visible ? 'Hide helpful notes' : 'Show helpful notes';
  localStorage.setItem(TIPS_PREFERENCE_KEY, visible ? 'true' : 'false');
}
function toggleTips() {
  setTipsVisible(document.documentElement.dataset.tips === 'hidden');
}
function safeStem(name) { return String(name || '').replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim(); }
function formatDuration(seconds) {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}

function releaseData() {
  return {
    spotifyUrl: value('spotifyUrlInput'), appleMusicUrl: value('appleMusicUrlInput'),
    title: value('releaseTitleInput'), artist: value('artistInput'), albumArtist: value('albumArtistInput') || value('artistInput'),
    releaseDate: value('releaseDateInput'), year: value('yearInput') || value('releaseDateInput').slice(0, 4), label: value('labelInput'),
    catalogue: value('catalogueInput'), genre: value('genreInput'), upc: value('upcInput'), copyright: value('copyrightInput'),
    shortDescription: value('shortDescriptionInput'), longDescription: value('longDescriptionInput'), credits: value('creditsInput'),
    downloadUrl: value('downloadUrlInput'), bandcampUrl: value('bandcampUrlInput'), streamingUrl: value('streamingUrlInput'),
    websiteUrl: value('websiteUrlInput'), instagramUrl: value('instagramUrlInput'), youtubeUrl: value('youtubeUrlInput'),
    soundcloudUrl: value('soundcloudUrlInput'), mediaHeadline: value('mediaHeadlineInput'), mediaAngle: value('mediaAngleInput'),
    playlistPitch: value('playlistPitchInput'),
    tags: value('tagsInput'), pressContact: value('pressContactInput'), socialPosts: state.socialPosts,
  };
}

function renderSocialPosts() {
  elements.socialPostsList.replaceChildren();
  elements.socialPostCount.textContent = `${state.socialPosts.length} ${state.socialPosts.length === 1 ? 'POST' : 'POSTS'}`;

  state.socialPosts.forEach((post, index) => {
    const card = document.createElement('article'); card.className = 'social-post-card'; card.dataset.socialPostId = post.id;
    const header = document.createElement('header');
    const number = document.createElement('span'); number.className = 'social-post-number'; number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('input'); title.className = 'social-post-title'; title.value = post.title;
    title.placeholder = `Post ${String(index + 1).padStart(2, '0')} label`; title.setAttribute('aria-label', `Social post ${index + 1} label`);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'social-post-remove'; remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete social post ${index + 1}`);
    const content = document.createElement('textarea'); content.rows = index === 0 ? 4 : 3; content.value = post.content;
    content.placeholder = index === 0 ? 'The main release announcement.' : 'Write this social post.';
    content.setAttribute('aria-label', `Social post ${index + 1} copy`);

    // Titles and copy update the saved list without rebuilding the card while the user types.
    title.addEventListener('input', () => { post.title = title.value; markDirty(); updateCopyPreview(); });
    content.addEventListener('input', () => { post.content = content.value; markDirty(); updateCopyPreview(); updateProgress(); });
    remove.addEventListener('click', () => {
      if (remove.dataset.confirm !== 'true') {
        remove.dataset.confirm = 'true'; remove.textContent = 'sure?'; remove.classList.add('is-confirming');
        remove.setAttribute('aria-label', `Press again to delete social post ${index + 1}`); return;
      }
      state.socialPosts = state.socialPosts.filter((item) => item.id !== post.id);
      markDirty(); renderSocialPosts(); updateCopyPreview(); updateProgress();
    });
    header.append(number, title, remove); card.append(header, content); elements.socialPostsList.append(card);
  });
}

function addSocialPost() {
  const index = state.socialPosts.length + 1;
  state.socialPosts.push({ id: crypto.randomUUID(), title: `Post ${String(index).padStart(2, '0')}`, content: '' });
  markDirty(); renderSocialPosts(); updateCopyPreview(); updateProgress();
  const added = elements.socialPostsList.querySelector(`[data-social-post-id="${state.socialPosts.at(-1).id}"] .social-post-title`);
  added?.focus(); added?.select();
}

function artworkSettings() {
  return {
    textEnabled: byId('artworkTextEnabledInput').checked, title: value('artworkTitleInput'), artist: value('artworkArtistInput'),
    backgroundX: state.backgroundPositionX, backgroundY: state.backgroundPositionY,
    font: value('artworkFontInput') || 'Avenir Next', textColor: value('artworkTextColorInput') || '#ffffff',
    textAlign: value('artworkTextAlignInput') || 'center', titleSize: Number(value('artworkTitleSizeInput') || 180),
    textOpacity: Number(value('artworkTextOpacityInput') || 100), textStretch: Number(value('artworkTextStretchInput') || 100),
    letterSpacing: Number(value('artworkLetterSpacingInput') || 0), textBold: byId('artworkTextBoldInput').checked,
    textItalic: byId('artworkTextItalicInput').checked,
    textX: Number(value('artworkTextXInput') || 50), textY: Number(value('artworkTextYInput') || 82),
    logoEnabled: byId('artworkLogoEnabledInput').checked, logoSize: Number(value('artworkLogoSizeInput') || 16),
    logoOpacity: Number(value('artworkLogoOpacityInput') || 100), logoColor: value('artworkLogoColorInput') || '#ffffff',
    logoX: Number(value('artworkLogoXInput') || 10), logoY: Number(value('artworkLogoYInput') || 10),
    symbolEnabled: byId('artworkSymbolEnabledInput').checked, symbolColor: value('artworkSymbolColorInput') || '#000000',
    symbolBoxEnabled: byId('artworkSymbolBoxEnabledInput').checked, symbolBoxColor: value('artworkSymbolBoxColorInput') || '#ffffff',
    symbolOpacity: Number(value('artworkSymbolOpacityInput') || 100),
    symbolSize: Number(value('artworkSymbolSizeInput') || 11), symbolX: Number(value('artworkSymbolXInput') || 86),
    symbolY: Number(value('artworkSymbolYInput') || 10),
  };
}

function setArtworkSettings(settings = {}) {
  const defaults = {
    backgroundX: 50, backgroundY: 50, textEnabled: true, font: 'Avenir Next', textColor: '#ffffff', textAlign: 'center', titleSize: 180, textOpacity: 100,
    textStretch: 100, letterSpacing: 0, textBold: false, textItalic: false, textX: 50, textY: 82,
    logoEnabled: true, logoSize: 16, logoOpacity: 100, logoColor: '#ffffff', logoX: 10, logoY: 10,
    symbolEnabled: true, symbolColor: '#000000', symbolBoxEnabled: true, symbolBoxColor: '#ffffff',
    symbolOpacity: 100, symbolSize: 11, symbolX: 86, symbolY: 10,
  };
  const migratedSettings = { ...settings };
  // Version 0.1.2 briefly placed the box controls on the logo. Move those saved choices to the symbol when an older project or template opens.
  if (!Object.hasOwn(migratedSettings, 'symbolBoxEnabled') && Object.hasOwn(migratedSettings, 'logoBoxEnabled')) {
    migratedSettings.symbolBoxEnabled = migratedSettings.logoBoxEnabled;
    migratedSettings.symbolBoxColor = migratedSettings.logoBoxColor || defaults.symbolBoxColor;
    migratedSettings.symbolColor = migratedSettings.logoColor || defaults.symbolColor;
    if (migratedSettings.logoColor === '#000000') migratedSettings.logoColor = defaults.logoColor;
  }
  const merged = { ...defaults, ...migratedSettings };
  state.backgroundPositionX = Number(merged.backgroundX); state.backgroundPositionY = Number(merged.backgroundY);
  // Older projects used three fonts that are no longer offered; Avenir Next is the closest clean fallback.
  if (['IBM Plex Mono', 'Times New Roman', 'Courier New'].includes(merged.font)) merged.font = 'Avenir Next';
  byId('artworkTextEnabledInput').checked = Boolean(merged.textEnabled); setValue('artworkTitleInput', merged.title); setValue('artworkArtistInput', merged.artist);
  setValue('artworkFontInput', merged.font); setValue('artworkTextColorInput', merged.textColor); setValue('artworkTextAlignInput', merged.textAlign);
  byId('artworkTextBoldInput').checked = Boolean(merged.textBold); byId('artworkTextItalicInput').checked = Boolean(merged.textItalic);
  setValue('artworkTitleSizeInput', merged.titleSize); setValue('artworkTextXInput', merged.textX); setValue('artworkTextYInput', merged.textY);
  setValue('artworkTextOpacityInput', merged.textOpacity); setValue('artworkTextStretchInput', merged.textStretch); setValue('artworkLetterSpacingInput', merged.letterSpacing);
  byId('artworkLogoEnabledInput').checked = Boolean(merged.logoEnabled); setValue('artworkLogoSizeInput', merged.logoSize);
  setValue('artworkLogoOpacityInput', merged.logoOpacity); setValue('artworkLogoColorInput', merged.logoColor);
  setValue('artworkLogoXInput', merged.logoX); setValue('artworkLogoYInput', merged.logoY);
  byId('artworkSymbolEnabledInput').checked = Boolean(merged.symbolEnabled); setValue('artworkSymbolColorInput', merged.symbolColor);
  byId('artworkSymbolBoxEnabledInput').checked = Boolean(merged.symbolBoxEnabled); setValue('artworkSymbolBoxColorInput', merged.symbolBoxColor);
  setValue('artworkSymbolOpacityInput', merged.symbolOpacity);
  setValue('artworkSymbolSizeInput', merged.symbolSize); setValue('artworkSymbolXInput', merged.symbolX); setValue('artworkSymbolYInput', merged.symbolY);
  updateArtworkReadouts();
  syncCustomSelect(byId('artworkFontInput')); syncCustomSelect(byId('artworkTextAlignInput'));
}

function outputFilename(track, index) {
  const stem = applyFilenamePattern(value('filenamePatternInput'), track.metadata, releaseData(), index);
  return `${stem}.${track.extension}`;
}

function trackIssues(track, index) {
  const missing = [];
  if (!track.metadata.title?.trim()) missing.push('title');
  if (!track.metadata.artist?.trim()) missing.push('artist');
  if (!track.metadata.album?.trim()) missing.push('album');
  if (!track.metadata.trackNumber?.trim()) missing.push('track number');
  if (!track.path) missing.push('native source path');
  const name = outputFilename(track, index).toLowerCase();
  const duplicate = state.masters.some((other, otherIndex) => other.id !== track.id && outputFilename(other, otherIndex).toLowerCase() === name);
  if (duplicate) missing.push('unique filename');
  return missing;
}

function checklistGroups() {
  const data = releaseData();
  const allMasterMetadata = state.masters.length > 0 && state.masters.every((track, index) => trackIssues(track, index).length === 0);
  const uniqueNames = state.masters.length > 0 && new Set(state.masters.map(outputFilename).map((name) => name.toLowerCase())).size === state.masters.length;
  return [
    { name: 'Release identity', stage: 'release', items: [
      ['Release title entered', Boolean(data.title)], ['Primary artist entered', Boolean(data.artist)], ['Release date entered', Boolean(data.releaseDate)],
      ['Label and catalogue number entered', Boolean(data.label && data.catalogue)], ['Short and full descriptions written', Boolean(data.shortDescription && data.longDescription)],
      ['Credits written', Boolean(data.credits)],
    ] },
    { name: 'Masters', stage: 'masters', items: [
      ['At least one master loaded', state.masters.length > 0], ['Every master has title, artist, album, and track number', allMasterMetadata],
      ['Prepared filenames are unique', uniqueNames], ['All masters have native source files', state.masters.length > 0 && state.masters.every((track) => Boolean(track.path))],
    ] },
    { name: 'Artwork', stage: 'artwork', items: [
      ['Background image loaded', Boolean(state.backgroundDataUrl)],
      ['Placeholder logo replaced or logo intentionally turned off', !artworkSettings().logoEnabled || !state.logoIsPlaceholder],
      ['Artwork title is available or text is turned off', !artworkSettings().textEnabled || Boolean(artworkSettings().title || data.title)],
    ] },
    { name: 'Promotion', stage: 'promotion', items: [
      ['Streaming or smart link entered', Boolean(data.streamingUrl)], ['Media headline and angle written', Boolean(data.mediaHeadline && data.mediaAngle)],
      ['Press contact entered', Boolean(data.pressContact)], ['At least one social post written', data.socialPosts.some((post) => Boolean(post.content.trim()))],
    ] },
    { name: 'Videos', stage: 'video', items: [
      ['At least one master available for video export', state.masters.length > 0],
      ['Foreground visual available', state.videoSettings.foreground.source === 'artwork' ? Boolean(state.backgroundDataUrl) : Boolean(state.videoSettings.foreground.path)],
      ['Background visual available', effectiveVideoBackground().source === 'artwork' ? Boolean(state.backgroundDataUrl) : Boolean(effectiveVideoBackground().path)],
    ] },
  ];
}

function stageCompletion() {
  return Object.fromEntries(checklistGroups().map((group) => [group.stage, group.items.every(([, complete]) => complete)]));
}

function markDirty() {
  if (applyingAlbum) return;
  state.changeRevision += 1; state.dirty = true;
  elements.saveStatus.className = 'save-status'; elements.saveStatus.innerHTML = '<i></i> unsaved changes';
  clearTimeout(state.saveTimer);
  // The first edit creates the project automatically, so a new release is protected before the user ever presses Save.
  if (host) { host.changed(serialiseProject(), boundGeneration); return; }
  state.saveTimer = setTimeout(() => saveProject(true), 800);
}

function showStage(stage) {
  pauseVisualPreviews();
  previewsSuspended = false;
  state.activeStage = stage;
  document.querySelectorAll('[data-stage-view]').forEach((view) => { view.hidden = view.dataset.stageView !== stage; view.classList.toggle('is-active', view.dataset.stageView === stage); });
  document.querySelectorAll('[data-stage]').forEach((button) => {
    const active = button.dataset.stage === stage;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  if (stage === 'review') renderReview();
  if (stage === 'video') {
    if (state.activeVideoPanel === 'canvases') drawCanvasPreview();
    else drawVideoPreview();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateProgress() {
  const completion = stageCompletion();
  const completeCount = Object.values(completion).filter(Boolean).length;
  document.querySelectorAll('.stage-button').forEach((button) => {
    const complete = button.dataset.stage === 'review' ? completeCount === 5 : completion[button.dataset.stage];
    button.classList.toggle('is-complete', Boolean(complete));
    button.classList.toggle('has-issues', !complete);
  });
  elements.progressBar.style.width = `${(completeCount / 5) * 100}%`;
  elements.progressLabel.textContent = `${completeCount} of 5 preparation stages ready`;
  const releaseRequired = [releaseData().title, releaseData().artist, releaseData().releaseDate, releaseData().label, releaseData().catalogue, releaseData().shortDescription, releaseData().longDescription, releaseData().credits];
  elements.releaseReadout.textContent = `${releaseRequired.filter(Boolean).length} / ${releaseRequired.length} required`;
  updateVideoControls();
}

function clearMasterDropMarkers() {
  document.querySelectorAll('.master-card').forEach((card) => card.classList.remove('is-dragging', 'drop-before', 'drop-after'));
}

function updateMasterPlaybackControls() {
  document.querySelectorAll('.master-card').forEach((card) => {
    const track = state.masters.find((item) => item.id === card.dataset.trackId);
    if (!track) return;
    const active = state.previewTrackId === track.id;
    const playing = active && !masterPreviewAudio.paused && !masterPreviewAudio.ended;
    const loading = state.previewLoadingTrackId === track.id;
    const duration = active && Number.isFinite(masterPreviewAudio.duration) ? masterPreviewAudio.duration : Number(track.durationSeconds || 0);
    const currentTime = active && Number.isFinite(masterPreviewAudio.currentTime) ? masterPreviewAudio.currentTime : 0;
    const playButton = card.querySelector('.master-play-button');
    const scrubber = card.querySelector('.master-scrubber');
    playButton.textContent = playing ? 'Ⅱ' : '▶';
    playButton.classList.toggle('is-playing', playing);
    playButton.disabled = loading;
    playButton.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${track.metadata.title || track.fileName}`);
    scrubber.max = String(Math.max(duration, 0));
    scrubber.value = String(Math.min(currentTime, duration || currentTime));
    scrubber.disabled = loading || duration <= 0;
    card.querySelector('.master-current-time').textContent = formatDuration(currentTime);
    card.querySelector('.master-total-time').textContent = formatDuration(duration);
  });
}

function showMasterPlaybackError(trackId, message) {
  const status = elements.mastersList.querySelector(`[data-track-id="${CSS.escape(trackId)}"] .master-playback-status`);
  if (status) status.textContent = message;
}

function stopMasterPreview() {
  masterPreviewRequest += 1;
  cancelMasterMetadataWait?.();
  masterPreviewAudio.pause();
  masterPreviewAudio.removeAttribute('src');
  masterPreviewAudio.load();
  state.previewTrackId = null;
  state.previewLoadingTrackId = null;
  updateMasterPlaybackControls();
}

async function prepareMasterPreview(track) {
  if (!isDesktop() || !desktop.convertFileSrc) throw new Error('Playback is available in the packaged desktop app.');
  if (state.previewTrackId === track.id && masterPreviewAudio.src) {
    if (state.previewLoadingTrackId) {
      masterPreviewRequest += 1; cancelMasterMetadataWait?.();
      state.previewLoadingTrackId = null; updateMasterPlaybackControls();
    }
    return masterPreviewRequest;
  }
  const request = ++masterPreviewRequest;
  cancelMasterMetadataWait?.();
  masterPreviewAudio.pause();
  state.previewLoadingTrackId = track.id;
  updateMasterPlaybackControls();
  // Rust checks the file and grants the WebView access to this exact master only.
  const allowedPath = await desktop.invoke('allow_audio_preview', { path: track.path });
  if (request !== masterPreviewRequest || !state.masters.some((item) => item.id === track.id && item.path === track.path)) return null;
  state.previewTrackId = track.id;
  state.previewLoadingTrackId = null;
  masterPreviewAudio.src = desktop.convertFileSrc(allowedPath);
  masterPreviewAudio.load();
  updateMasterPlaybackControls();
  return request;
}

async function toggleMasterPlayback(track) {
  let request;
  try {
    const status = elements.mastersList.querySelector(`[data-track-id="${CSS.escape(track.id)}"] .master-playback-status`);
    if (status) status.textContent = '';
    request = await prepareMasterPreview(track);
    if (request === null || request !== masterPreviewRequest) return;
    if (masterPreviewAudio.paused || masterPreviewAudio.ended) {
      if (masterPreviewAudio.ended) masterPreviewAudio.currentTime = 0;
      await masterPreviewAudio.play();
    } else {
      masterPreviewAudio.pause();
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (request !== undefined && request !== masterPreviewRequest) return;
    if (state.previewLoadingTrackId && state.previewLoadingTrackId !== track.id) return;
    if (state.previewLoadingTrackId !== track.id && state.previewTrackId !== track.id) return;
    state.previewLoadingTrackId = null;
    showMasterPlaybackError(track.id, `Could not play this master: ${error}`);
    updateMasterPlaybackControls();
  }
}

async function seekMasterPreview(track, requestedTime) {
  let request;
  try {
    request = await prepareMasterPreview(track);
    if (request === null || request !== masterPreviewRequest) return;
    if (masterPreviewAudio.readyState < 1) {
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          masterPreviewAudio.removeEventListener('loadedmetadata', loaded);
          masterPreviewAudio.removeEventListener('error', failed);
          if (cancelMasterMetadataWait === cancelled) cancelMasterMetadataWait = null;
          error ? reject(error) : resolve();
        };
        const loaded = () => finish();
        const failed = () => finish(new Error('The audio format could not be opened.'));
        const cancelled = () => finish();
        const timer = setTimeout(() => finish(new Error('Timed out opening this master.')), 15000);
        cancelMasterMetadataWait = cancelled;
        masterPreviewAudio.addEventListener('loadedmetadata', loaded, { once: true });
        masterPreviewAudio.addEventListener('error', failed, { once: true });
      });
    }
    if (request !== masterPreviewRequest) return;
    masterPreviewAudio.currentTime = Math.max(0, Math.min(Number(requestedTime), masterPreviewAudio.duration || Number(requestedTime)));
    updateMasterPlaybackControls();
  } catch (error) {
    if (request !== undefined && request !== masterPreviewRequest) return;
    if (state.previewLoadingTrackId && state.previewLoadingTrackId !== track.id) return;
    if (state.previewLoadingTrackId !== track.id && state.previewTrackId !== track.id) return;
    state.previewLoadingTrackId = null;
    showMasterPlaybackError(track.id, `Could not seek through this master: ${error}`);
    updateMasterPlaybackControls();
  }
}

function commitMasterOrder(nextMasters) {
  if (nextMasters === state.masters) return;
  state.masters = nextMasters;
  markDirty();
  renderAll();
}

function renderMasters() {
  elements.mastersList.replaceChildren();
  if (!state.masters.length) {
    elements.mastersList.append(elements.mastersDropzone);
  } else {
    state.masters.forEach((track, index) => {
      const node = elements.masterRowTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.trackId = track.id;
      const issues = trackIssues(track, index);
      node.classList.toggle('has-issues', issues.length > 0);
      node.querySelector('.track-index').textContent = String(index + 1).padStart(2, '0');
      node.querySelector('.source-name').textContent = track.fileName;
      node.querySelector('.source-details').textContent = `${track.extension.toUpperCase()} · ${formatDuration(track.durationSeconds)}`;
      node.querySelector('.output-filename').textContent = outputFilename(track, index);
      node.querySelector('.issue-badge').textContent = issues.length ? `needs ${issues.join(', ')}` : 'metadata ready';
      node.querySelector('.move-master-up').disabled = index === 0;
      node.querySelector('.move-master-down').disabled = index === state.masters.length - 1;
      const leadSingleInput = node.querySelector('.lead-single-input');
      leadSingleInput.checked = Boolean(track.leadSingle);
      leadSingleInput.setAttribute('aria-label', `Use ${track.metadata.title || track.fileName} as the lead single`);
      leadSingleInput.addEventListener('change', () => {
        state.masters = setLeadSingle(state.masters, track.id, leadSingleInput.checked);
        markDirty(); renderAll();
      });
      node.querySelectorAll('[data-track-field]').forEach((input) => { input.value = track.metadata[input.dataset.trackField] || ''; });
      node.querySelector('.remove-master-button').addEventListener('click', () => {
        if (state.previewTrackId === track.id || state.previewLoadingTrackId === track.id) stopMasterPreview();
        state.masters = state.masters.filter((item) => item.id !== track.id); markDirty(); renderAll();
      });
      const revealButton = node.querySelector('.reveal-master-button');
      revealButton.disabled = !track.path;
      revealButton.addEventListener('click', async () => {
        const originalLabel = 'show in Finder';
        if (!isDesktop()) {
          showMasterPlaybackError(track.id, 'Finder access is available in the packaged desktop app.');
          return;
        }
        showMasterPlaybackError(track.id, '');
        revealButton.disabled = true; revealButton.textContent = 'opening…';
        try {
          await desktop.invoke('reveal_file_in_finder', { path: track.path });
          revealButton.textContent = 'shown';
        } catch (error) {
          revealButton.textContent = originalLabel;
          showMasterPlaybackError(track.id, `Could not show this master in Finder: ${error}`);
        }
        setTimeout(() => {
          revealButton.disabled = !track.path; revealButton.textContent = originalLabel;
        }, 1200);
      });
      node.querySelector('.master-play-button').addEventListener('click', () => toggleMasterPlayback(track));
      const scrubber = node.querySelector('.master-scrubber');
      scrubber.addEventListener('input', () => {
        if (state.previewTrackId === track.id && masterPreviewAudio.readyState >= 1) {
          masterPreviewAudio.currentTime = Number(scrubber.value);
          updateMasterPlaybackControls();
        }
      });
      scrubber.addEventListener('change', () => seekMasterPreview(track, scrubber.value));
      node.querySelector('.move-master-up').addEventListener('click', () => commitMasterOrder(moveMasterToIndex(state.masters, track.id, index - 1)));
      node.querySelector('.move-master-down').addEventListener('click', () => commitMasterOrder(moveMasterToIndex(state.masters, track.id, index + 1)));

      // Dragging starts only from the handle, so editing metadata fields never accidentally moves a card.
      const dragHandle = node.querySelector('.master-drag-handle');
      dragHandle.addEventListener('dragstart', (event) => {
        state.draggingMasterId = track.id;
        node.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', track.id);
      });
      node.addEventListener('dragover', (event) => {
        if (!state.draggingMasterId || state.draggingMasterId === track.id) return;
        event.preventDefault();
        const placeAfter = event.clientY > node.getBoundingClientRect().top + (node.offsetHeight / 2);
        node.classList.toggle('drop-before', !placeAfter);
        node.classList.toggle('drop-after', placeAfter);
      });
      node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
      node.addEventListener('drop', (event) => {
        event.preventDefault();
        const movingId = state.draggingMasterId || event.dataTransfer.getData('text/plain');
        const placeAfter = event.clientY > node.getBoundingClientRect().top + (node.offsetHeight / 2);
        state.draggingMasterId = null;
        clearMasterDropMarkers();
        commitMasterOrder(moveMasterAroundTarget(state.masters, movingId, track.id, placeAfter));
      });
      dragHandle.addEventListener('dragend', () => {
        state.draggingMasterId = null;
        clearMasterDropMarkers();
      });
      node.querySelectorAll('[data-track-field]').forEach((input) => input.addEventListener('input', () => {
        // Update only this visible card while typing. Rebuilding the entire list here would steal keyboard focus after each letter.
        track.metadata[input.dataset.trackField] = input.value;
        const currentIssues = trackIssues(track, index);
        node.classList.toggle('has-issues', currentIssues.length > 0);
        node.querySelector('.output-filename').textContent = outputFilename(track, index);
        node.querySelector('.issue-badge').textContent = currentIssues.length ? `needs ${currentIssues.join(', ')}` : 'metadata ready';
        markDirty(); updateProgress();
      }));
      elements.mastersList.append(node);
    });
  }
  const issueTotal = state.masters.reduce((total, track, index) => total + trackIssues(track, index).length, 0);
  elements.masterCount.textContent = `${state.masters.length} master${state.masters.length === 1 ? '' : 's'}`;
  elements.masterIssueCount.textContent = state.masters.length ? (issueTotal ? `${issueTotal} item${issueTotal === 1 ? '' : 's'} to resolve · drag to reorder` : 'all metadata ready · drag to reorder') : 'add audio files to begin';
  const leadSingle = selectedLeadSingle(state.masters);
  elements.playlistPitchLeadSingle.textContent = leadSingle
    ? `Lead single: ${leadSingle.metadata?.title || leadSingle.fileName}. The pitch should foreground this track and connect it to the full release.`
    : 'Choose a lead single in Masters. One adaptable pitch is used for Spotify for Artists, Apple Music for Artists, TIDAL, and similar services.';
  updateMasterPlaybackControls();
}

async function chooseMasters() {
  if (!isDesktop()) { alert('Master inspection is available in the packaged desktop app.'); return; }
  const paths = await desktop.open({ multiple: true, filters: [{ name: 'Audio masters', extensions: ['wav', 'wave', 'aif', 'aiff', 'flac', 'mp3', 'm4a'] }] });
  if (!paths?.length) return;
  elements.masterIssueCount.textContent = 'reading embedded metadata…';
  try {
    const inspected = await desktop.invoke('inspect_audio', { paths });
    const existing = new Set(state.masters.map((track) => track.path));
    const common = releaseData();
    const artistPreset = activeArtistPreset();
    inspected.forEach((track) => {
      if (existing.has(track.path)) return;
      existing.add(track.path);
      const sequence = state.masters.length + 1;
      state.masters.push({
        ...track, id: crypto.randomUUID(), leadSingle: false,
        metadata: {
          ...track.metadata, title: track.metadata.title || safeStem(track.fileName), artist: common.artist || artistPreset?.primaryArtist || track.metadata.artist,
          album: track.metadata.album || common.title, trackNumber: track.metadata.trackNumber || String(sequence),
          composer: artistPreset?.composer || track.metadata.composer || '', genre: track.metadata.genre || common.genre, isrc: track.metadata.isrc || '', comment: track.metadata.comment || '',
        },
      });
    });
    markDirty(); renderAll();
  } catch (error) {
    elements.masterIssueCount.textContent = `could not read files: ${error}`;
  }
}

function syncReleaseToMasters() {
  const common = releaseData();
  state.masters.forEach((track, index) => {
    track.metadata.artist = common.artist; track.metadata.album = common.title; track.metadata.trackNumber = String(index + 1);
    if (!track.metadata.genre) track.metadata.genre = common.genre;
  });
  markDirty(); renderAll();
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error) => { clearTimeout(timer); image.onload = null; image.onerror = null; error ? reject(error) : resolve(image); };
    const timer = setTimeout(() => finish(new Error('Timed out opening this image.')), 15000);
    image.onload = () => finish(); image.onerror = () => finish(new Error('The image format could not be opened.')); image.src = source;
  });
}

// Canvas does not apply letter spacing consistently, so each character is placed by hand.
// This also lets horizontal stretch behave the same in the preview and the exported PNG.
function drawMangledText(context, text, x, y, settings, size) {
  const safeFont = settings.font.replace(/["\\]/g, '') || 'Avenir Next';
  const style = settings.textItalic ? 'italic' : 'normal';
  const weight = settings.textBold ? 700 : 400;
  context.font = `${style} ${weight} ${size}px "${safeFont}", sans-serif`;
  const characters = Array.from(text);
  const naturalWidth = characters.reduce((total, character) => total + context.measureText(character).width, 0)
    + Math.max(0, characters.length - 1) * settings.letterSpacing;
  const requestedScale = settings.textStretch / 100;
  const maximumWidth = context.canvas.width * .9;
  const scaleX = naturalWidth > 0 ? Math.min(requestedScale, maximumWidth / naturalWidth) : requestedScale;
  let cursor = settings.textAlign === 'center' ? -naturalWidth / 2 : settings.textAlign === 'right' ? -naturalWidth : 0;

  context.save(); context.translate(x, y); context.scale(scaleX, 1); context.textAlign = 'left';
  characters.forEach((character) => {
    context.fillText(character, cursor, 0);
    cursor += context.measureText(character).width + settings.letterSpacing;
  });
  context.restore();
}

// Imported PNG/SVG logos are treated as an alpha mask. The chosen mark colour
// therefore works for the built-in placeholder and for transparent label marks.
function drawColouredLogo(context, logo, x, y, width, height, colour) {
  const mask = document.createElement('canvas'); mask.width = Math.max(1, Math.round(width)); mask.height = Math.max(1, Math.round(height));
  const maskContext = mask.getContext('2d'); maskContext.drawImage(logo, 0, 0, mask.width, mask.height);
  maskContext.globalCompositeOperation = 'source-in'; maskContext.fillStyle = colour; maskContext.fillRect(0, 0, mask.width, mask.height);
  context.drawImage(mask, x, y, width, height);
}

function drawReleaseSymbol(context, canvas, seedText, settings) {
  const random = randomFromSeed(hashSeed(seedText));
  const pick = (values) => values[Math.floor(random() * values.length)];
  const size = canvas.width * settings.symbolSize / 100;
  const originX = (canvas.width - size) * settings.symbolX / 100;
  const originY = (canvas.height - size) * settings.symbolY / 100;
  const direction = Math.floor(random() * 4);
  const primaryCount = random() > .45 ? 4 : 3;
  const primaryWidth = random() > .72 ? 2 : 1;
  const anchors = [];

  context.save(); context.globalAlpha = settings.symbolOpacity / 100;
  if (settings.symbolBoxEnabled) {
    // The symbol box is part of the generated release mark and follows the same opacity control.
    const padding = Math.max(18, size * .1); context.fillStyle = settings.symbolBoxColor;
    context.fillRect(originX - padding, originY - padding, size + padding * 2, size + padding * 2);
  }
  context.translate(originX, originY); context.scale(size / 96, size / 96);
  context.strokeStyle = settings.symbolColor; context.fillStyle = settings.symbolColor; context.globalAlpha *= .9; context.lineCap = 'square';
  const line = (x1, y1, x2, y2, width = 1) => {
    context.beginPath(); context.lineWidth = width; context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  };

  // Parallel grid lines give every release mark a related label-family structure.
  if (direction === 0) {
    const startY = pick([24, 32, 40]); const x1 = pick([16, 24]); const x2 = pick([72, 80]);
    for (let index = 0; index < primaryCount; index += 1) { const y = startY + index * 8; line(x1, y, x2, y, index ? 1 : primaryWidth); anchors.push([pick([x1, x2, 48]), y]); }
  } else if (direction === 1) {
    const startX = pick([24, 32, 40]); const y1 = pick([16, 24]); const y2 = pick([72, 80]);
    for (let index = 0; index < primaryCount; index += 1) { const x = startX + index * 8; line(x, y1, x, y2, index ? 1 : primaryWidth); anchors.push([x, pick([y1, y2, 48])]); }
  } else if (direction === 2) {
    const startY = pick([16, 24, 32]);
    for (let index = 0; index < primaryCount; index += 1) { const y = startY + index * 8; line(16, y, 80, y + 32, index ? 1 : primaryWidth); anchors.push([48, y + 16]); }
  } else {
    const startY = pick([48, 56].filter((number) => number + (primaryCount - 1) * 8 <= 80));
    for (let index = 0; index < primaryCount; index += 1) { const y = startY + index * 8; line(16, y, 80, y - 32, index ? 1 : primaryWidth); anchors.push([48, y - 16]); }
  }

  const crossStart = pick([32, 40, 48, 56]);
  if (direction === 1) { line(24, crossStart, 72, crossStart); line(24, crossStart + 8, 72, crossStart + 8); }
  else { line(crossStart, 24, crossStart, 72); line(crossStart + 8, 24, crossStart + 8, 72); }

  const bracketX = pick([16, 64]); const bracketY = pick([16, 64]); const step = bracketX < 48 ? 8 : -8;
  context.beginPath(); context.lineWidth = 1; context.moveTo(bracketX, bracketY + 16); context.lineTo(bracketX, bracketY);
  context.lineTo(bracketX + step * 2, bracketY); context.lineTo(bracketX + step * 2, bracketY + 8); context.stroke();
  anchors.slice(0, 3).forEach(([x, y], index) => {
    const markerSize = index === 0 ? 7 : 5; const filled = random() > .68;
    context.beginPath();
    if ((index + direction) % 2 === 0) context.arc(x, y, markerSize / 2, 0, Math.PI * 2);
    else context.rect(x - markerSize / 2, y - markerSize / 2, markerSize, markerSize);
    if (filled) context.fill(); context.stroke();
  });
  context.restore();
}

function drawArtwork() {
  artworkDrawing = renderArtwork();
  return artworkDrawing;
}

async function ensureArtworkReady() {
  // Editing can replace a render while its image is decoding. Export only
  // after the most recent complete render, including a replacement render.
  let pending;
  do { pending = artworkDrawing; await pending; } while (pending !== artworkDrawing);
}

async function renderArtwork() {
  const drawing = ++state.drawingNumber;
  const canvas = elements.artworkCanvas; const context = canvas.getContext('2d'); const settings = artworkSettings(); const data = releaseData();
  context.fillStyle = '#171918'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (state.backgroundDataUrl) {
    try {
      const image = await loadImage(state.backgroundDataUrl); if (drawing !== state.drawingNumber) return;
      const placement = coverPlacement(canvas.width, canvas.height, image.width, image.height, state.backgroundPositionX, state.backgroundPositionY);
      state.backgroundRenderedBounds = { overflowX: placement.overflowX, overflowY: placement.overflowY };
      context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
    } catch { if (drawing !== state.drawingNumber) return; state.backgroundRenderedBounds = null; }
  } else {
    state.backgroundRenderedBounds = null;
    context.fillStyle = '#242726'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(255,255,255,.13)'; context.lineWidth = 3; context.strokeRect(120, 120, 2760, 2760);
    context.fillStyle = 'rgba(255,255,255,.42)'; context.font = '44px IBM Plex Mono, monospace'; context.textAlign = 'center'; context.fillText('CHOOSE A BACKGROUND IMAGE', 1500, 1500);
  }
  if (settings.logoEnabled && state.logoDataUrl) {
    try {
      const logo = await loadImage(state.logoDataUrl); if (drawing !== state.drawingNumber) return;
      const size = canvas.width * settings.logoSize / 100; const ratio = logo.height / logo.width; const x = (canvas.width - size) * settings.logoX / 100; const y = (canvas.height - size * ratio) * settings.logoY / 100;
      context.save(); context.globalAlpha = settings.logoOpacity / 100;
      drawColouredLogo(context, logo, x, y, size, size * ratio, settings.logoColor); context.restore();
    } catch { if (drawing !== state.drawingNumber) return; /* The default mark can always be restored from the button below the preview. */ }
  }
  // Artwork-specific wording controls the release mark immediately as it is typed.
  const symbolTitle = settings.title || data.title || 'UNTITLED RELEASE';
  const symbolArtist = settings.artist || data.artist || 'ARTIST';
  if (settings.symbolEnabled) drawReleaseSymbol(context, canvas, `${symbolArtist}|${symbolTitle}`, settings);
  if (settings.textEnabled) {
    const title = settings.title || data.title || 'UNTITLED RELEASE'; const artist = settings.artist || data.artist || 'ARTIST';
    context.save(); context.globalAlpha = settings.textOpacity / 100; context.fillStyle = settings.textColor; context.textBaseline = 'alphabetic';
    const x = canvas.width * settings.textX / 100; const y = canvas.height * settings.textY / 100;
    drawMangledText(context, title, x, y, settings, settings.titleSize);
    drawMangledText(context, artist, x, y + settings.titleSize * .62, settings, Math.max(44, settings.titleSize * .36)); context.restore();
  }
}

function updateArtworkReadouts() {
  const settings = artworkSettings();
  byId('titleSizeReadout').value = `${settings.titleSize} px`; byId('textXReadout').value = `${settings.textX}%`; byId('textYReadout').value = `${settings.textY}%`;
  byId('textOpacityReadout').value = `${settings.textOpacity}%`; byId('textStretchReadout').value = `${settings.textStretch}%`; byId('letterSpacingReadout').value = `${settings.letterSpacing} px`;
  byId('logoOpacityReadout').value = `${settings.logoOpacity}%`;
  byId('logoSizeReadout').value = `${settings.logoSize}%`; byId('logoXReadout').value = `${settings.logoX}%`; byId('logoYReadout').value = `${settings.logoY}%`;
  byId('symbolOpacityReadout').value = `${settings.symbolOpacity}%`;
  byId('symbolSizeReadout').value = `${settings.symbolSize}%`; byId('symbolXReadout').value = `${settings.symbolX}%`; byId('symbolYReadout').value = `${settings.symbolY}%`;
  elements.logoStatus.textContent = state.logoIsPlaceholder ? 'Placeholder logo — replace it with the record label logo or turn it off.' : `Label logo: ${state.logoName}`;
  elements.logoStatus.classList.toggle('is-replaced', !state.logoIsPlaceholder);
  updateBackgroundPositionControl();
}

function updateBackgroundPositionControl() {
  if (!state.backgroundDataUrl) state.backgroundPositioning = false;
  elements.backgroundPositionButton.disabled = !state.backgroundDataUrl;
  elements.backgroundPositionButton.textContent = state.backgroundPositioning ? 'lock background position' : 'reposition background';
  elements.backgroundPositionButton.setAttribute('aria-pressed', String(state.backgroundPositioning));
  elements.artworkCanvas.classList.toggle('is-repositioning', state.backgroundPositioning);
}

function toggleBackgroundPositioning() {
  if (!state.backgroundDataUrl) return;
  state.backgroundPositioning = !state.backgroundPositioning;
  state.backgroundDrag = null; updateBackgroundPositionControl();
}

function beginBackgroundDrag(event) {
  if (!state.backgroundPositioning || !state.backgroundDataUrl || event.button !== 0) return;
  const rect = elements.artworkCanvas.getBoundingClientRect();
  state.backgroundDrag = {
    pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY,
    startX: state.backgroundPositionX, startY: state.backgroundPositionY, rect, changed: false,
  };
  elements.artworkCanvas.setPointerCapture(event.pointerId); elements.artworkCanvas.classList.add('is-dragging'); event.preventDefault();
}

function moveBackgroundDrag(event) {
  const drag = state.backgroundDrag; if (!drag || drag.pointerId !== event.pointerId) return;
  const bounds = state.backgroundRenderedBounds || { overflowX: 0, overflowY: 0 };
  const canvasDeltaX = (event.clientX - drag.startClientX) * elements.artworkCanvas.width / drag.rect.width;
  const canvasDeltaY = (event.clientY - drag.startClientY) * elements.artworkCanvas.height / drag.rect.height;
  const nextX = movedBackgroundPosition(drag.startX, canvasDeltaX, bounds.overflowX);
  const nextY = movedBackgroundPosition(drag.startY, canvasDeltaY, bounds.overflowY);
  drag.changed ||= nextX !== state.backgroundPositionX || nextY !== state.backgroundPositionY;
  state.backgroundPositionX = nextX; state.backgroundPositionY = nextY; drawArtwork(); event.preventDefault();
}

function endBackgroundDrag(event) {
  const drag = state.backgroundDrag; if (!drag || drag.pointerId !== event.pointerId) return;
  state.backgroundDrag = null; elements.artworkCanvas.classList.remove('is-dragging');
  if (elements.artworkCanvas.hasPointerCapture(event.pointerId)) elements.artworkCanvas.releasePointerCapture(event.pointerId);
  if (drag.changed) markDirty();
}

const RANGE_CONTROLS = [
  ['artworkTitleSizeInput', 'titleSizeReadout', ' px'], ['artworkTextXInput', 'textXReadout', '%'], ['artworkTextYInput', 'textYReadout', '%'],
  ['artworkTextOpacityInput', 'textOpacityReadout', '%'], ['artworkTextStretchInput', 'textStretchReadout', '%'], ['artworkLetterSpacingInput', 'letterSpacingReadout', ' px'],
  ['artworkLogoOpacityInput', 'logoOpacityReadout', '%'],
  ['artworkLogoSizeInput', 'logoSizeReadout', '%'], ['artworkLogoXInput', 'logoXReadout', '%'], ['artworkLogoYInput', 'logoYReadout', '%'],
  ['artworkSymbolOpacityInput', 'symbolOpacityReadout', '%'],
  ['artworkSymbolSizeInput', 'symbolSizeReadout', '%'], ['artworkSymbolXInput', 'symbolXReadout', '%'], ['artworkSymbolYInput', 'symbolYReadout', '%'],
];

function bindEditableRangeValues() {
  RANGE_CONTROLS.forEach(([rangeId, readoutId, suffix]) => {
    const range = byId(rangeId); const readout = byId(readoutId);
    const restore = () => { readout.value = `${range.value}${suffix}`; readout.readOnly = true; };
    const apply = () => {
      const typed = Number.parseFloat(readout.value.replace(',', '.'));
      if (Number.isFinite(typed)) {
        const bounded = Math.min(Number(range.max), Math.max(Number(range.min), typed));
        range.value = String(bounded); range.dispatchEvent(new Event('input', { bubbles: true }));
      }
      restore();
    };
    readout.addEventListener('dblclick', () => { readout.readOnly = false; readout.focus(); readout.select(); });
    readout.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      if (event.key === 'Escape') { event.preventDefault(); restore(); readout.blur(); }
    });
    readout.addEventListener('blur', () => { if (!readout.readOnly) apply(); });
  });
}

async function chooseImage(kind) {
  if (!isDesktop()) { alert('Image selection is available in the packaged desktop app.'); return; }
  const path = await desktop.open({ multiple: false, filters: [{ name: kind === 'logo' ? 'Logo or vector mark' : 'Artwork image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
  if (!path) return;
  try {
    const file = await desktop.invoke('read_file_data_url', { path });
    await loadImage(file.dataUrl);
    if (kind === 'logo') { state.logoDataUrl = file.dataUrl; state.logoName = file.fileName; state.logoIsPlaceholder = false; }
    else {
      state.backgroundDataUrl = file.dataUrl; state.backgroundName = file.fileName; state.backgroundPositionX = 50; state.backgroundPositionY = 50;
      state.backgroundPositioning = false; state.backgroundDrag = null;
    }
    markDirty(); updateArtworkReadouts(); drawArtwork(); updateProgress();
  } catch (error) { alert(`Could not open that image: ${error}`); }
}

/*
  The operating system draws native select menus differently in every context.
  These small custom controls keep the menu inside Release Preparer's visual
  language while the hidden select remains the accessible source of truth.
*/
const customSelectControllers = new Map();
function syncCustomSelect(select) { customSelectControllers.get(select)?.sync(); }
function enhanceSelect(select) {
  if (!select || customSelectControllers.has(select)) return;
  const wrapper = document.createElement('div'); wrapper.className = 'custom-select';
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'custom-select-trigger'; trigger.setAttribute('aria-hidden', 'true'); trigger.tabIndex = -1;
  const menu = document.createElement('div'); menu.className = 'custom-select-menu'; menu.setAttribute('aria-hidden', 'true');
  select.before(wrapper); wrapper.append(select, trigger, menu); select.classList.add('native-select-source');

  const close = () => { wrapper.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); };
  const rebuild = () => {
    menu.replaceChildren();
    Array.from(select.options).forEach((option) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'custom-select-option'; button.textContent = option.textContent; button.dataset.value = option.value; button.tabIndex = -1;
      button.disabled = option.disabled || option.parentElement?.disabled === true;
      const selected = option.value === select.value; button.classList.toggle('is-selected', selected); button.setAttribute('aria-selected', String(selected));
      button.addEventListener('click', (event) => {
        event.preventDefault(); select.value = option.value;
        // Input redraws live artwork controls; change handles project/template loading.
        select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); close();
      });
      button.addEventListener('mousedown', (event) => event.preventDefault());
      menu.append(button);
    });
    trigger.textContent = select.selectedOptions[0]?.textContent || select.options[0]?.textContent || 'choose';
    trigger.disabled = select.disabled;
  };
  trigger.addEventListener('click', (event) => {
    event.preventDefault(); const opening = !wrapper.classList.contains('is-open');
    document.querySelectorAll('.custom-select.is-open').forEach((other) => { if (other !== wrapper) { other.classList.remove('is-open'); other.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false'); } });
    wrapper.classList.toggle('is-open', opening); trigger.setAttribute('aria-expanded', String(opening));
  });
  // Keyboard and assistive technology use the labelled native select. It is
  // revealed at full control size on focus; the custom menu is pointer-only.
  trigger.addEventListener('mousedown', (event) => event.preventDefault());
  select.addEventListener('focus', close);
  select.addEventListener('change', rebuild);
  new MutationObserver(rebuild).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label'] });
  customSelectControllers.set(select, { sync: rebuild, close }); rebuild();
}
function enhanceSelects() {
  document.querySelectorAll('select').forEach(enhanceSelect);
  document.addEventListener('click', (event) => {
    customSelectControllers.forEach((controller, select) => { if (!select.parentElement.contains(event.target)) controller.close(); });
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') customSelectControllers.forEach((controller) => controller.close()); });
}

const ARTIST_PRESETS_KEY = 'release-preparer-artist-presets-v1';
const ARTIST_PRESET_EDITOR_FIELDS = {
  name: 'artistPresetNameInput',
  primaryArtist: 'artistPresetPrimaryArtistInput',
  albumArtist: 'artistPresetAlbumArtistInput',
  composer: 'artistPresetComposerInput',
  bandcampUrl: 'artistPresetBandcampUrlInput',
  websiteUrl: 'artistPresetWebsiteUrlInput',
  instagramUrl: 'artistPresetInstagramUrlInput',
  youtubeUrl: 'artistPresetYoutubeUrlInput',
  soundcloudUrl: 'artistPresetSoundcloudUrlInput',
  spotifyUrl: 'artistPresetSpotifyUrlInput', appleMusicUrl: 'artistPresetAppleMusicUrlInput',
  tags: 'artistPresetTagsInput',
  pressContact: 'artistPresetPressContactInput',
};

function readArtistPresets() {
  try {
    const result = JSON.parse(localStorage.getItem(ARTIST_PRESETS_KEY) || '[]');
    return Array.isArray(result) ? result.filter((preset) => preset && typeof preset === 'object' && !Array.isArray(preset)).map(normaliseArtistPreset).filter((preset) => preset.id && preset.name) : [];
  } catch { return []; }
}
function writeArtistPresets(presets) { localStorage.setItem(ARTIST_PRESETS_KEY, JSON.stringify(presets)); }
function activeArtistPreset() { return readArtistPresets().find((preset) => preset.id === state.activeArtistPresetId) || null; }
function artistPresetFromEditor(id = '') {
  return normaliseArtistPreset(Object.fromEntries([
    ['id', id],
    ...Object.entries(ARTIST_PRESET_EDITOR_FIELDS).map(([key, fieldId]) => [key, value(fieldId)]),
  ]));
}
function fillArtistPresetEditor(preset = {}) {
  const clean = normaliseArtistPreset(preset);
  Object.entries(ARTIST_PRESET_EDITOR_FIELDS).forEach(([key, fieldId]) => setValue(fieldId, clean[key]));
  elements.artistPresetStatus.textContent = '';
}
function updateArtistPresetActions() {
  const editing = Boolean(elements.artistPresetEditorSelect.value);
  elements.saveArtistPresetButton.textContent = editing ? 'update template' : 'save template';
  elements.saveArtistPresetAsNewButton.disabled = !editing;
  elements.deleteArtistPresetButton.disabled = !editing;
  elements.applyArtistPresetButton.disabled = !editing;
  elements.deleteArtistPresetButton.textContent = 'delete template';
  delete elements.deleteArtistPresetButton.dataset.confirm;
}
function renderArtistPresets() {
  const presets = readArtistPresets();
  const editorSelection = elements.artistPresetEditorSelect.value;
  elements.artistPresetSelect.replaceChildren(new Option('artist template', ''));
  elements.artistPresetEditorSelect.replaceChildren(new Option('new artist template', ''));
  presets.forEach((preset) => {
    elements.artistPresetSelect.add(new Option(preset.name, preset.id));
    elements.artistPresetEditorSelect.add(new Option(preset.name, preset.id));
  });
  elements.artistPresetSelect.value = presets.some((preset) => preset.id === state.activeArtistPresetId) ? state.activeArtistPresetId : '';
  elements.artistPresetEditorSelect.value = presets.some((preset) => preset.id === editorSelection) ? editorSelection : '';
  syncCustomSelect(elements.artistPresetSelect); syncCustomSelect(elements.artistPresetEditorSelect); updateArtistPresetActions();
}
function openArtistPresetDialog() {
  renderArtistPresets();
  const selected = readArtistPresets().find((preset) => preset.id === state.activeArtistPresetId);
  if (selected) {
    elements.artistPresetEditorSelect.value = selected.id; fillArtistPresetEditor(selected);
    syncCustomSelect(elements.artistPresetEditorSelect); updateArtistPresetActions();
  }
  elements.artistPresetDialog.showModal();
}
function clearArtistPresetEditor() {
  elements.artistPresetEditorSelect.value = '';
  fillArtistPresetEditor();
  syncCustomSelect(elements.artistPresetEditorSelect); updateArtistPresetActions();
  elements.artistPresetNameInput.focus();
}
function selectArtistPresetInEditor(preset) {
  renderArtistPresets(); elements.artistPresetEditorSelect.value = preset.id; fillArtistPresetEditor(preset);
  syncCustomSelect(elements.artistPresetEditorSelect); updateArtistPresetActions();
}
function saveArtistPreset() {
  const presets = readArtistPresets(); const selected = elements.artistPresetEditorSelect.value;
  const preset = artistPresetFromEditor(selected || crypto.randomUUID());
  if (!preset.name || !preset.primaryArtist) { elements.artistPresetStatus.textContent = 'Template name and primary artist are required.'; return; }
  const index = presets.findIndex((item) => item.id === preset.id);
  const previousPreset = index >= 0 ? presets[index] : null;
  if (index >= 0) presets.splice(index, 1, preset); else presets.push(preset);
  writeArtistPresets(presets);

  const currentArtist = value('artistInput').trim().toLocaleLowerCase();
  const presetArtist = preset.primaryArtist.trim().toLocaleLowerCase();
  const belongsToCurrentRelease = state.activeArtistPresetId === preset.id || (!state.activeArtistPresetId && currentArtist && currentArtist === presetArtist);
  let refreshedCurrentTags = false;
  if (belongsToCurrentRelease) {
    const currentTags = value('tagsInput');
    const nextTags = refreshedArtistPresetTags(currentTags, previousPreset?.tags, preset.tags);
    if (nextTags !== currentTags) {
      setValue('tagsInput', nextTags);
      state.activeArtistPresetId = preset.id;
      refreshedCurrentTags = true;
      markDirty(); renderAll();
    }
  }

  selectArtistPresetInEditor(preset);
  const savedMessage = index >= 0 ? 'Artist template updated.' : 'Artist template saved.';
  elements.artistPresetStatus.textContent = refreshedCurrentTags ? `${savedMessage} Platform tags refreshed for this release.` : savedMessage;
}
function saveArtistPresetAsNew() {
  const source = readArtistPresets().find((preset) => preset.id === elements.artistPresetEditorSelect.value);
  if (!source) return;
  const preset = artistPresetFromEditor(crypto.randomUUID());
  if (!preset.name || !preset.primaryArtist) { elements.artistPresetStatus.textContent = 'Template name and primary artist are required.'; return; }
  if (preset.name === source.name) preset.name = `${preset.name} copy`;
  const presets = readArtistPresets(); presets.push(preset); writeArtistPresets(presets); selectArtistPresetInEditor(preset);
  elements.artistPresetStatus.textContent = 'New artist template saved.';
}
function applyArtistPreset(preset) {
  if (!preset) return;
  state.activeArtistPresetId = preset.id;
  if (preset.primaryArtist) { setValue('artistInput', preset.primaryArtist); setValue('albumArtistInput', preset.albumArtist || preset.primaryArtist); }
  const releaseFields = {
    bandcampUrlInput: preset.bandcampUrl,
    websiteUrlInput: preset.websiteUrl,
    instagramUrlInput: preset.instagramUrl,
    youtubeUrlInput: preset.youtubeUrl,
    soundcloudUrlInput: preset.soundcloudUrl,
    spotifyUrlInput: preset.spotifyUrl, appleMusicUrlInput: preset.appleMusicUrl,
    tagsInput: preset.tags,
    pressContactInput: preset.pressContact,
  };
  // Empty optional template values do not erase release-specific work already entered.
  Object.entries(releaseFields).forEach(([fieldId, next]) => { if (next) setValue(fieldId, next); });
  if (preset.primaryArtist) state.masters = applyArtistPresetToMasters(state.masters, preset);
  elements.artistPresetSelect.value = preset.id; syncCustomSelect(elements.artistPresetSelect);
  markDirty(); renderAll();
}
function applyArtistPresetFromEditor() {
  const selected = elements.artistPresetEditorSelect.value;
  if (!selected) return;
  // Current editor values are applied so the user may try an adjustment before deciding to update the saved template.
  const preset = artistPresetFromEditor(selected);
  if (!preset.primaryArtist) { elements.artistPresetStatus.textContent = 'Primary artist is required before applying.'; return; }
  applyArtistPreset(preset);
  elements.artistPresetStatus.textContent = `${preset.name} applied. All populated fields remain editable.`;
}
function deleteArtistPreset() {
  const id = elements.artistPresetEditorSelect.value; if (!id) return;
  if (elements.deleteArtistPresetButton.dataset.confirm !== 'true') {
    elements.deleteArtistPresetButton.dataset.confirm = 'true'; elements.deleteArtistPresetButton.textContent = 'sure?'; return;
  }
  writeArtistPresets(readArtistPresets().filter((preset) => preset.id !== id));
  if (state.activeArtistPresetId === id) state.activeArtistPresetId = '';
  clearArtistPresetEditor(); renderArtistPresets();
  elements.artistPresetStatus.textContent = 'Artist template deleted.';
}

const ARTWORK_PRESETS_KEY = 'release-preparer-artwork-presets-v1';
function readTemplateRows(key) {
  try {
    const result = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(result) ? result.filter((preset) => preset && typeof preset === 'object' && !Array.isArray(preset) && typeof preset.id === 'string' && preset.id && typeof preset.name === 'string') : [];
  } catch { return []; }
}
function readArtworkPresets() { return readTemplateRows(ARTWORK_PRESETS_KEY); }
function writeArtworkPresets(presets) { localStorage.setItem(ARTWORK_PRESETS_KEY, JSON.stringify(presets)); }
function renderArtworkPresets() {
  const selected = elements.artworkPresetSelect.value; elements.artworkPresetSelect.replaceChildren(new Option('current settings', ''));
  readArtworkPresets().forEach((preset) => elements.artworkPresetSelect.add(new Option(preset.name, preset.id)));
  elements.artworkPresetSelect.value = readArtworkPresets().some((preset) => preset.id === selected) ? selected : '';
  syncCustomSelect(elements.artworkPresetSelect); updateArtworkTemplateActions();
}
function updateArtworkTemplateActions() {
  const editing = Boolean(elements.artworkPresetSelect.value);
  elements.saveArtworkPresetButton.textContent = editing ? 'update template' : 'save template';
  elements.saveArtworkPresetAsNewButton.disabled = !editing;
  elements.duplicateArtworkPresetButton.disabled = !editing; elements.deleteArtworkPresetButton.disabled = !editing;
}
function currentArtworkPreset(id, name) {
  return { id, name, settings: artworkSettings(), logoDataUrl: state.logoDataUrl, logoName: state.logoName, logoIsPlaceholder: state.logoIsPlaceholder };
}
function selectSavedArtworkPreset(preset) {
  renderArtworkPresets(); elements.artworkPresetSelect.value = preset.id; setValue('artworkPresetNameInput', preset.name);
  syncCustomSelect(elements.artworkPresetSelect); updateArtworkTemplateActions();
}
function saveArtworkPreset() {
  const name = value('artworkPresetNameInput'); if (!name) { alert('Name the artwork template first.'); return; }
  const presets = readArtworkPresets(); const selected = elements.artworkPresetSelect.value;
  const preset = currentArtworkPreset(selected || crypto.randomUUID(), name);
  const index = presets.findIndex((item) => item.id === preset.id); if (index >= 0) presets.splice(index, 1, preset); else presets.push(preset);
  writeArtworkPresets(presets); selectSavedArtworkPreset(preset);
}
function saveArtworkPresetAsNew() {
  const presets = readArtworkPresets(); const source = presets.find((item) => item.id === elements.artworkPresetSelect.value); if (!source) return;
  const enteredName = value('artworkPresetNameInput'); if (!enteredName) { alert('Name the new artwork template first.'); return; }
  // If the name was not edited, add “copy” so the two templates remain easy to distinguish.
  const name = enteredName === source.name ? `${enteredName} copy` : enteredName;
  const preset = currentArtworkPreset(crypto.randomUUID(), name); presets.push(preset); writeArtworkPresets(presets); selectSavedArtworkPreset(preset);
}
function applyArtworkPreset() {
  const preset = readArtworkPresets().find((item) => item.id === elements.artworkPresetSelect.value);
  updateArtworkTemplateActions(); if (!preset) { setValue('artworkPresetNameInput', ''); return; }
  setArtworkSettings(preset.settings); state.logoDataUrl = preset.logoDataUrl || DEFAULT_MARK; state.logoName = preset.logoName || 'Placeholder logo';
  state.logoIsPlaceholder = preset.logoIsPlaceholder ?? (!preset.logoDataUrl || preset.logoDataUrl === DEFAULT_MARK); setValue('artworkPresetNameInput', preset.name);
  markDirty(); updateArtworkReadouts(); drawArtwork(); updateProgress();
}
function duplicateArtworkPreset() {
  const presets = readArtworkPresets(); const source = presets.find((item) => item.id === elements.artworkPresetSelect.value); if (!source) return;
  const copy = { ...source, id: crypto.randomUUID(), name: `${source.name} copy`, settings: { ...source.settings } };
  presets.push(copy); writeArtworkPresets(presets); renderArtworkPresets(); elements.artworkPresetSelect.value = copy.id;
  setValue('artworkPresetNameInput', copy.name); syncCustomSelect(elements.artworkPresetSelect); updateArtworkTemplateActions();
}
function deleteArtworkPreset() {
  const id = elements.artworkPresetSelect.value; if (!id) return;
  writeArtworkPresets(readArtworkPresets().filter((item) => item.id !== id)); elements.artworkPresetSelect.value = ''; setValue('artworkPresetNameInput', ''); renderArtworkPresets();
}

const VIDEO_PRESETS_KEY = 'release-preparer-video-presets-v1';
const DEFAULT_VIDEO_PRESET_KEY = 'release-preparer-default-video-preset-v1';
function readVideoPresets() {
  return readTemplateRows(VIDEO_PRESETS_KEY);
}
function writeVideoPresets(presets) { localStorage.setItem(VIDEO_PRESETS_KEY, JSON.stringify(presets)); }
function defaultVideoPresetId() { return localStorage.getItem(DEFAULT_VIDEO_PRESET_KEY) || ''; }
function settingsForNewVideoProject() {
  const preset = readVideoPresets().find((item) => item.id === defaultVideoPresetId());
  return preset ? applyVideoTemplate(defaultVideoSettings(), preset.settings) : defaultVideoSettings();
}
function showDefaultVideoPresetSelection() {
  const preset = readVideoPresets().find((item) => item.id === defaultVideoPresetId());
  if (!preset) return;
  elements.videoPresetSelect.value = preset.id;
  setValue('videoPresetNameInput', preset.name);
  syncCustomSelect(elements.videoPresetSelect);
  updateVideoTemplateActions();
}
function renderVideoPresets() {
  const selected = elements.videoPresetSelect.value;
  const presets = readVideoPresets();
  elements.videoPresetSelect.replaceChildren(new Option('current settings', ''));
  presets.forEach((preset) => elements.videoPresetSelect.add(new Option(preset.name, preset.id)));
  elements.videoPresetSelect.value = presets.some((preset) => preset.id === selected) ? selected : '';
  syncCustomSelect(elements.videoPresetSelect);
  updateVideoTemplateActions();
}
function updateVideoTemplateActions() {
  const selected = elements.videoPresetSelect.value;
  const editing = Boolean(selected);
  elements.saveVideoPresetButton.textContent = editing ? 'update template' : 'save template';
  elements.saveVideoPresetAsNewButton.disabled = !editing;
  elements.duplicateVideoPresetButton.disabled = !editing;
  elements.deleteVideoPresetButton.disabled = !editing;
  elements.defaultVideoPresetInput.checked = editing && selected === defaultVideoPresetId();
}
function currentVideoPreset(id, name) {
  return { id, name, settings: videoTemplateSettings(state.videoSettings) };
}
function selectSavedVideoPreset(preset) {
  renderVideoPresets();
  elements.videoPresetSelect.value = preset.id;
  setValue('videoPresetNameInput', preset.name);
  syncCustomSelect(elements.videoPresetSelect);
  updateVideoTemplateActions();
}
function saveVideoPreset() {
  const name = value('videoPresetNameInput');
  if (!name) { alert('Name the video template first.'); return; }
  const presets = readVideoPresets();
  const selected = elements.videoPresetSelect.value;
  const preset = currentVideoPreset(selected || crypto.randomUUID(), name);
  const index = presets.findIndex((item) => item.id === preset.id);
  if (index >= 0) presets.splice(index, 1, preset); else presets.push(preset);
  writeVideoPresets(presets);
  if (elements.defaultVideoPresetInput.checked) localStorage.setItem(DEFAULT_VIDEO_PRESET_KEY, preset.id);
  selectSavedVideoPreset(preset);
}
function saveVideoPresetAsNew() {
  const presets = readVideoPresets();
  const source = presets.find((item) => item.id === elements.videoPresetSelect.value);
  if (!source) return;
  const enteredName = value('videoPresetNameInput');
  if (!enteredName) { alert('Name the new video template first.'); return; }
  const name = enteredName === source.name ? `${enteredName} copy` : enteredName;
  const preset = currentVideoPreset(crypto.randomUUID(), name);
  presets.push(preset); writeVideoPresets(presets); selectSavedVideoPreset(preset);
}
function applyVideoPreset() {
  const preset = readVideoPresets().find((item) => item.id === elements.videoPresetSelect.value);
  updateVideoTemplateActions();
  if (!preset) { setValue('videoPresetNameInput', ''); return; }
  state.videoSettings = applyVideoTemplate(state.videoSettings, preset.settings);
  setValue('videoPresetNameInput', preset.name);
  applyVideoSettingsToControls(); markDirty(); drawVideoPreview(); updateProgress();
}
function duplicateVideoPreset() {
  const presets = readVideoPresets();
  const source = presets.find((item) => item.id === elements.videoPresetSelect.value);
  if (!source) return;
  const copy = { ...source, id: crypto.randomUUID(), name: `${source.name} copy`, settings: { ...source.settings } };
  presets.push(copy); writeVideoPresets(presets); selectSavedVideoPreset(copy);
}
function deleteVideoPreset() {
  const id = elements.videoPresetSelect.value;
  if (!id) return;
  writeVideoPresets(readVideoPresets().filter((item) => item.id !== id));
  if (defaultVideoPresetId() === id) localStorage.removeItem(DEFAULT_VIDEO_PRESET_KEY);
  elements.videoPresetSelect.value = ''; setValue('videoPresetNameInput', ''); renderVideoPresets();
}
function updateDefaultVideoPreset() {
  const id = elements.videoPresetSelect.value;
  if (!id) {
    elements.defaultVideoPresetInput.checked = false;
    return;
  }
  if (elements.defaultVideoPresetInput.checked) localStorage.setItem(DEFAULT_VIDEO_PRESET_KEY, id);
  else if (defaultVideoPresetId() === id) localStorage.removeItem(DEFAULT_VIDEO_PRESET_KEY);
  renderVideoPresets();
}

function applyVideoSettingsToControls() {
  const settings = state.videoSettings;
  elements.videoBackgroundMatchesInput.checked = settings.backgroundMatchesForeground;
  elements.videoForegroundShadowEnabledInput.checked = settings.foregroundShadowEnabled;
  elements.videoLogoEnabledInput.checked = settings.logoEnabled;
  setValue('videoForegroundSizeInput', settings.foregroundSize);
  setValue('videoForegroundShadowIntensityInput', settings.foregroundShadowIntensity);
  setValue('videoBackgroundBlurInput', settings.backgroundBlur);
  setValue('videoBackgroundOpacityInput', settings.backgroundOpacity);
  setValue('videoLogoOpacityInput', settings.logoOpacity);
  setValue('videoLogoSizeInput', settings.logoSize);
  setValue('videoLogoXInput', settings.logoX);
  setValue('videoLogoYInput', settings.logoY);
  updateVideoControls();
}

function readVideoControlValues() {
  state.videoSettings = normaliseVideoSettings({
    ...state.videoSettings,
    backgroundMatchesForeground: elements.videoBackgroundMatchesInput.checked,
    backgroundBlur: elements.videoBackgroundBlurInput.value,
    backgroundOpacity: elements.videoBackgroundOpacityInput.value,
    foregroundSize: elements.videoForegroundSizeInput.value,
    foregroundShadowEnabled: elements.videoForegroundShadowEnabledInput.checked,
    foregroundShadowIntensity: elements.videoForegroundShadowIntensityInput.value,
    logoEnabled: elements.videoLogoEnabledInput.checked,
    logoOpacity: elements.videoLogoOpacityInput.value,
    logoSize: elements.videoLogoSizeInput.value,
    logoX: elements.videoLogoXInput.value,
    logoY: elements.videoLogoYInput.value,
  });
}

function effectiveVideoBackground() {
  return state.videoSettings.backgroundMatchesForeground
    ? state.videoSettings.foreground
    : state.videoSettings.background;
}

function updateVideoControls() {
  const settings = state.videoSettings;
  const background = effectiveVideoBackground();
  elements.videoForegroundName.textContent = settings.foreground.name;
  elements.videoBackgroundName.textContent = settings.backgroundMatchesForeground ? `Same as foreground · ${background.name}` : background.name;
  elements.useArtworkBackgroundButton.disabled = settings.backgroundMatchesForeground;
  elements.chooseVideoBackgroundButton.disabled = settings.backgroundMatchesForeground;
  elements.videoForegroundSizeReadout.value = `${settings.foregroundSize}%`;
  elements.videoForegroundShadowIntensityReadout.value = `${settings.foregroundShadowIntensity}%`;
  elements.videoForegroundShadowIntensityInput.disabled = !settings.foregroundShadowEnabled;
  elements.videoBackgroundBlurReadout.value = `${settings.backgroundBlur}`;
  elements.videoBackgroundOpacityReadout.value = `${settings.backgroundOpacity}%`;
  elements.videoLogoOpacityReadout.value = `${settings.logoOpacity}%`;
  elements.videoLogoSizeReadout.value = `${settings.logoSize}%`;
  elements.videoLogoXReadout.value = `${settings.logoX}%`;
  elements.videoLogoYReadout.value = `${settings.logoY}%`;
  elements.videoReadout.textContent = `${state.masters.length} master${state.masters.length === 1 ? '' : 's'} ready`;
  elements.exportTrackVideosButton.disabled = !state.masters.length || exportOperations.has('video');
  elements.videoPreviewStatus.textContent = `${settings.foreground.name} foreground · ${background.name} background`;
}

async function chooseVideoLayer(layer) {
  if (!isDesktop()) return;
  const paths = await desktop.open({
    multiple: false,
    filters: [{ name: 'Images or videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'm4v'] }],
  });
  const path = Array.isArray(paths) ? paths[0] : paths;
  if (!path) return;
  const extension = path.split('.').pop().toLocaleLowerCase();
  const kind = ['mp4', 'mov', 'm4v'].includes(extension) ? 'video' : 'image';
  state.videoSettings[layer] = { source: 'file', path, name: path.split('/').pop(), kind };
  if (layer === 'background') state.videoSettings.backgroundMatchesForeground = false;
  clearVisualPreviewMedia();
  applyVideoSettingsToControls();
  markDirty();
  drawVideoPreview();
}

function useArtworkForVideoLayer(layer) {
  clearVisualPreviewMedia();
  state.videoSettings[layer] = { source: 'artwork', path: '', name: 'Album artwork', kind: 'image' };
  if (layer === 'background') state.videoSettings.backgroundMatchesForeground = false;
  applyVideoSettingsToControls();
  markDirty();
  drawVideoPreview();
}

function visualPreviewPlaying() {
  return !previewsSuspended && state.activeStage === 'video' && state.activeVideoPanel === 'tracks' && state.videoPreviewPlaying;
}

function pauseVisualPreviews() {
  clearTimeout(videoPreviewTimer); clearTimeout(canvasPreviewTimer);
  videoPreviewTimer = null; canvasPreviewTimer = null;
  state.videoPreviewFrame += 1; state.canvasPreviewFrame += 1;
  for (const media of videoPreviewElements) media.pause?.();
  elements.canvasCompressedPreviewVideo.pause();
}

function clearVisualPreviewMedia() {
  mediaGeneration += 1;
  pauseVisualPreviews();
  for (const cancel of cancelVisualLoads) cancel();
  for (const media of videoPreviewElements) {
    media.pause?.(); media.removeAttribute('src'); media.load?.();
  }
  videoPreviewElements.clear(); state.videoPreviewMedia.clear();
}

function resumePreviews() {
  previewsSuspended = false;
  if (state.activeStage === 'video') {
    if (state.activeVideoPanel === 'canvases') drawCanvasPreview();
    else drawVideoPreview();
  }
}

async function loadVideoPreviewMedia(media) {
  const generation = mediaGeneration;
  if (media.source === 'artwork') return elements.artworkCanvas;
  if (state.videoPreviewMedia.has(media.path)) {
    const cached = await state.videoPreviewMedia.get(media.path);
    if (generation !== mediaGeneration) throw new Error('Preview was replaced.');
    if (cached instanceof HTMLVideoElement && visualPreviewPlaying()) cached.play().catch(() => {});
    return cached;
  }
  const loaded = (async () => {
    const allowedPath = await desktop.invoke('allow_visual_preview', { path: media.path });
    if (generation !== mediaGeneration) throw new Error('Preview was replaced.');
    const source = desktop.convertFileSrc(allowedPath);
    const item = media.kind === 'video' ? document.createElement('video') : new Image();
    videoPreviewElements.add(item);
    try {
      await new Promise((resolve, reject) => {
        const successEvent = media.kind === 'video' ? 'loadeddata' : 'load';
        const finish = (error) => {
          clearTimeout(timer); cancelVisualLoads.delete(cancel);
          item.removeEventListener(successEvent, ready); item.removeEventListener('error', failed);
          error ? reject(error) : resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error('The visual format could not be opened.'));
        const cancel = () => finish(new Error('Preview was replaced.'));
        const timer = setTimeout(() => finish(new Error('Timed out opening the preview.')), 15000);
        cancelVisualLoads.add(cancel);
        item.addEventListener(successEvent, ready, { once: true }); item.addEventListener('error', failed, { once: true });
        if (media.kind === 'video') { item.muted = true; item.loop = true; item.playsInline = true; }
        item.src = source;
      });
    } catch (error) {
      videoPreviewElements.delete(item); item.pause?.(); item.removeAttribute('src'); item.load?.();
      throw error;
    }
    if (generation !== mediaGeneration) {
      item.pause?.(); item.removeAttribute('src'); item.load?.();
      throw new Error('Preview was replaced.');
    }
    if (media.kind === 'video' && visualPreviewPlaying()) item.play().catch(() => {});
    return item;
  })();
  state.videoPreviewMedia.set(media.path, loaded);
  try { return await loaded; }
  catch (error) { if (state.videoPreviewMedia.get(media.path) === loaded) state.videoPreviewMedia.delete(media.path); throw error; }
}

function mediaDimensions(media) {
  return {
    width: media.videoWidth || media.naturalWidth || media.width,
    height: media.videoHeight || media.naturalHeight || media.height,
  };
}

function drawMediaCover(context, media, canvas) {
  const size = mediaDimensions(media);
  const placement = coverPlacement(canvas.width, canvas.height, size.width, size.height, 50, 50);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(media, placement.x, placement.y, placement.width, placement.height);
}

function drawMediaContain(context, media, canvas, percentage, shadowEnabled = false, shadowIntensity = 0) {
  const size = mediaDimensions(media);
  const maximumWidth = canvas.width * percentage / 100;
  const maximumHeight = canvas.height * percentage / 100;
  const scale = Math.min(maximumWidth / size.width, maximumHeight / size.height);
  const width = size.width * scale; const height = size.height * scale;
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (shadowEnabled && shadowIntensity > 0) {
    const intensity = Math.min(1, Math.max(0, Number(shadowIntensity) / 100));
    context.shadowColor = `rgba(0, 0, 0, ${(0.2 + intensity * 0.65).toFixed(3)})`;
    context.shadowBlur = canvas.width * (0.006 + intensity * 0.024);
    context.shadowOffsetY = canvas.height * (0.004 + intensity * 0.012);
  }
  context.drawImage(media, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  context.restore();
}

async function drawVideoPreview() {
  clearTimeout(videoPreviewTimer);
  videoPreviewTimer = null;
  const drawing = ++state.videoPreviewFrame;
  const canvas = elements.videoPreviewCanvas;
  const backgroundCanvas = elements.videoPreviewBackgroundCanvas;
  const context = canvas.getContext('2d');
  const backgroundContext = backgroundCanvas.getContext('2d');
  const settings = state.videoSettings;
  const backgroundSettings = effectiveVideoBackground();
  try {
    const [background, foreground] = await Promise.all([
      loadVideoPreviewMedia(backgroundSettings),
      loadVideoPreviewMedia(settings.foreground),
    ]);
    if (drawing !== state.videoPreviewFrame) return;
    backgroundContext.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
    drawMediaCover(backgroundContext, background, backgroundCanvas);
    const displayedWidth = backgroundCanvas.clientWidth || backgroundCanvas.width;
    const previewStyle = videoPreviewStyle(settings.backgroundBlur, backgroundCanvas.width, displayedWidth);
    // WKWebView does not consistently implement CanvasRenderingContext2D.filter.
    // A separate background canvas lets WebKit apply its reliable CSS Gaussian
    // blur while this foreground canvas remains completely sharp.
    backgroundCanvas.style.filter = previewStyle.filter;
    backgroundCanvas.style.opacity = String(settings.backgroundOpacity / 100);
    backgroundCanvas.style.transform = `scale(${previewStyle.scale.toFixed(4)})`;
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawMediaContain(
      context,
      foreground,
      canvas,
      settings.foregroundSize,
      settings.foregroundShadowEnabled,
      settings.foregroundShadowIntensity,
    );
    if (settings.logoEnabled && state.logoDataUrl) {
      if (state.videoLogoPreviewSource !== state.logoDataUrl) {
        state.videoLogoPreviewSource = state.logoDataUrl;
        state.videoLogoPreviewPromise = loadImage(state.logoDataUrl);
      }
      const logo = await state.videoLogoPreviewPromise;
      if (drawing !== state.videoPreviewFrame) return;
      const width = canvas.width * settings.logoSize / 100;
      const height = width * logo.height / logo.width;
      const x = (canvas.width - width) * settings.logoX / 100;
      const y = (canvas.height - height) * settings.logoY / 100;
      context.save(); context.globalAlpha = settings.logoOpacity / 100;
      drawColouredLogo(context, logo, x, y, width, height, artworkSettings().logoColor);
      context.restore();
    }
  } catch (error) {
    if (drawing !== state.videoPreviewFrame) return;
    backgroundContext.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
    backgroundCanvas.style.filter = 'none'; backgroundCanvas.style.transform = 'none';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#aaa'; context.font = '18px IBM Plex Mono'; context.textAlign = 'center';
    context.fillText('VIDEO PREVIEW UNAVAILABLE', canvas.width / 2, canvas.height / 2);
    elements.videoPreviewStatus.textContent = `Preview error: ${error}`;
  }
  if (visualPreviewPlaying() && drawing === state.videoPreviewFrame) {
    // Fifteen preview frames per second is enough for positioning while keeping
    // the editor responsive on Macs that are also decoding two source videos.
    videoPreviewTimer = setTimeout(() => drawVideoPreview(), 66);
  }
}

function toggleVideoPreview() {
  state.videoPreviewPlaying = !state.videoPreviewPlaying;
  elements.playVideoPreviewButton.textContent = state.videoPreviewPlaying ? 'pause preview' : 'play preview';
  for (const promise of state.videoPreviewMedia.values()) {
    Promise.resolve(promise).then((media) => {
      if (media instanceof HTMLVideoElement) {
        if (visualPreviewPlaying()) media.play().catch(() => {});
        else media.pause();
      }
    }).catch(() => {});
  }
  drawVideoPreview();
}

async function videoLogoPngDataUrl() {
  if (!state.videoSettings.logoEnabled || !state.logoDataUrl) return '';
  const logo = await loadImage(state.logoDataUrl);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1200;
  const context = canvas.getContext('2d');
  const ratio = logo.height / logo.width;
  const width = 1000; const height = Math.min(1000, width * ratio);
  drawColouredLogo(context, logo, 100, (1200 - height) / 2, width, height, artworkSettings().logoColor);
  return canvas.toDataURL('image/png');
}

function videoMediaRequest(media) {
  return { usesArtwork: media.source === 'artwork', path: media.path || '', kind: media.kind };
}

function resetVideoExportProgress() {
  elements.videoExportProgress.hidden = true;
  elements.videoExportProgress.classList.remove('is-encoding');
  elements.videoExportProgress.setAttribute('aria-valuenow', '0');
  elements.videoExportProgressBar.style.width = '0%';
  elements.videoExportProgressLabel.hidden = true;
  elements.videoExportProgressLabel.textContent = '';
}

function showVideoExportProgress(progress) {
  if (!progress || progress.exportId !== state.videoExportActiveId) return;
  const total = Math.max(1, Number(progress.total) || 1);
  const completed = Math.min(total, Math.max(0, Number(progress.completed) || 0));
  const trackPercent = Math.min(100, Math.max(0, Number(progress.trackPercent) || 0));
  const percent = progress.phase === 'finished'
    ? 100
    : Math.round((completed + (progress.phase === 'encoding' ? trackPercent / 100 : 0)) / total * 100);
  const track = progress.currentTrack ? ` — ${progress.currentTrack}` : '';
  const label = progress.phase === 'preparing'
    ? `Preparing ${total} track video${total === 1 ? '' : 's'}…`
    : progress.phase === 'compositing'
      ? 'Preparing the reusable 4K artwork frame…'
    : progress.phase === 'finished'
      ? `${completed} of ${total} track videos processed.`
      : progress.phase === 'cancelled'
        ? `Video export cancelled · ${completed} of ${total} completed.`
      : progress.phase === 'processed'
        ? `${completed} of ${total} track videos processed.`
        : `Encoding ${Math.min(total, completed + 1)} of ${total} · ${Math.round(trackPercent)}%${track}`;
  elements.videoExportProgress.hidden = false;
  elements.videoExportProgress.classList.toggle('is-encoding', progress.phase === 'encoding');
  elements.videoExportProgress.setAttribute('aria-valuenow', String(percent));
  elements.videoExportProgressBar.style.width = `${percent}%`;
  elements.videoExportProgressLabel.hidden = false;
  elements.videoExportProgressLabel.textContent = label;
}

async function cancelTrackVideos() {
  if (!isDesktop() || !state.videoExportActiveId || state.videoExportCancelling) return;
  state.videoExportCancelling = true;
  elements.cancelTrackVideosButton.disabled = true;
  elements.cancelTrackVideosButton.textContent = 'cancelling…';
  elements.videoExportStatus.textContent = 'Stopping the active encoder and removing its unfinished temporary file…';
  try {
    const found = await desktop.invoke('cancel_video_export', { exportId: state.videoExportActiveId });
    if (!found) {
      state.videoExportCancelling = false;
      elements.cancelTrackVideosButton.disabled = false;
      elements.cancelTrackVideosButton.textContent = 'cancel video export';
      elements.videoExportStatus.textContent = 'The encoder is starting or has just finished. Press cancel again if the export continues.';
    }
  } catch (error) {
    state.videoExportCancelling = false;
    elements.cancelTrackVideosButton.disabled = false;
    elements.cancelTrackVideosButton.textContent = 'cancel video export';
    elements.videoExportStatus.className = 'is-error';
    elements.videoExportStatus.textContent = `Could not cancel the video export: ${error}`;
  }
}

async function exportTrackVideos() {
  if (!isDesktop() || !state.masters.length) return;
  let outputDir = state.lastExportDir;
  let folderName = state.lastExportFolderName;
  if (!outputDir || !folderName) {
    outputDir = await desktop.open({ directory: true, multiple: false, title: 'Choose where to create the video package' });
    folderName = packageName();
  }
  if (!outputDir) return;
  const exportId = crypto.randomUUID();
  state.videoExportActiveId = exportId;
  resetVideoExportProgress();
  let unlisten;
  elements.exportTrackVideosButton.disabled = true;
  elements.exportTrackVideosButton.textContent = 'exporting 4K videos…';
  state.videoExportCancelling = false;
  elements.cancelTrackVideosButton.hidden = true;
  elements.videoExportStatus.className = '';
  elements.videoExportStatus.textContent = 'Encoding one video per master. Longer releases can take some time.';
  try {
    unlisten = await desktop.listen('release-preparer://video-export-progress', (event) => showVideoExportProgress(event.payload));
    await ensureArtworkReady();
    const foreground = state.videoSettings.foreground;
    const background = effectiveVideoBackground();
    const request = {
      outputDir,
      folderName,
      artworkDataUrl: elements.artworkCanvas.toDataURL('image/png'),
      logoDataUrl: await videoLogoPngDataUrl(),
      foreground: videoMediaRequest(foreground),
      background: videoMediaRequest(background),
      backgroundBlur: state.videoSettings.backgroundBlur,
      backgroundOpacity: state.videoSettings.backgroundOpacity,
      foregroundSize: state.videoSettings.foregroundSize,
      foregroundShadowEnabled: state.videoSettings.foregroundShadowEnabled,
      foregroundShadowIntensity: state.videoSettings.foregroundShadowIntensity,
      logoEnabled: state.videoSettings.logoEnabled,
      logoOpacity: state.videoSettings.logoOpacity,
      logoSize: state.videoSettings.logoSize,
      logoX: state.videoSettings.logoX,
      logoY: state.videoSettings.logoY,
      exportId,
      tracks: state.masters.map((track, index) => ({
        path: track.path,
        outputFileName: videoOutputFileName(track, index),
        durationSeconds: Number(track.durationSeconds) || 0,
      })),
    };
    elements.cancelTrackVideosButton.hidden = false;
    elements.cancelTrackVideosButton.disabled = false;
    elements.cancelTrackVideosButton.textContent = 'cancel video export';
    const result = await desktop.invoke('export_track_videos', { request });
    if (result.cancelled) {
      elements.videoExportStatus.className = '';
      elements.videoExportStatus.textContent = `Video export cancelled. ${result.exported} completed video${result.exported === 1 ? '' : 's'} remain in ${result.destination}; the unfinished temporary file was removed.`;
      return;
    }
    const failed = result.failed ? ` ${result.failed} failed. ${result.message}` : '';
    elements.videoExportStatus.className = result.failed ? 'is-error' : 'is-success';
    elements.videoExportStatus.textContent = `${result.exported} 4K video${result.exported === 1 ? '' : 's'} exported with ${result.encoder} to ${result.destination}.${failed}`;
  } catch (error) {
    elements.videoExportStatus.className = 'is-error';
    elements.videoExportStatus.textContent = `Video export failed: ${error}`;
  } finally {
    try { unlisten?.(); } catch { /* The export state must still be released if the WebView listener has already gone away. */ }
    state.videoExportActiveId = '';
    state.videoExportCancelling = false;
    elements.cancelTrackVideosButton.hidden = true;
    elements.cancelTrackVideosButton.disabled = false;
    elements.cancelTrackVideosButton.textContent = 'cancel video export';
    elements.exportTrackVideosButton.textContent = 'export 4K track videos';
    updateVideoControls();
  }
}

function showVideoPanel(panel) {
  pauseVisualPreviews();
  state.activeVideoPanel = panel === 'canvases' ? 'canvases' : 'tracks';
  document.querySelectorAll('[data-video-panel]').forEach((section) => {
    section.hidden = section.dataset.videoPanel !== state.activeVideoPanel;
  });
  const canvasesActive = state.activeVideoPanel === 'canvases';
  elements.showTrackVideosButton.classList.toggle('is-active', !canvasesActive);
  elements.showCanvasesButton.classList.toggle('is-active', canvasesActive);
  elements.showTrackVideosButton.setAttribute('aria-selected', String(!canvasesActive));
  elements.showCanvasesButton.setAttribute('aria-selected', String(canvasesActive));
  elements.showTrackVideosButton.tabIndex = canvasesActive ? -1 : 0;
  elements.showCanvasesButton.tabIndex = canvasesActive ? 0 : -1;
  if (canvasesActive) drawCanvasPreview();
  else drawVideoPreview();
}

const CANVAS_RANGE_CONTROLS = Object.freeze({
  imageScale: ['canvasImageScaleInput', 'canvasImageScaleReadout'],
  intensity: ['canvasIntensityInput', 'canvasIntensityReadout'],
  grainAmount: ['canvasGrainAmountInput', 'canvasGrainAmountReadout'],
  grainSize: ['canvasGrainSizeInput', 'canvasGrainSizeReadout'],
  grainClumping: ['canvasGrainClumpingInput', 'canvasGrainClumpingReadout'],
  exposureFlicker: ['canvasExposureFlickerInput', 'canvasExposureFlickerReadout'],
  colourInstability: ['canvasColourInstabilityInput', 'canvasColourInstabilityReadout'],
  horizontalWeave: ['canvasHorizontalWeaveInput', 'canvasHorizontalWeaveReadout'],
  verticalJitter: ['canvasVerticalJitterInput', 'canvasVerticalJitterReadout'],
  rotation: ['canvasRotationInput', 'canvasRotationReadout'],
  scaleBreathing: ['canvasScaleBreathingInput', 'canvasScaleBreathingReadout'],
  opticalSoftness: ['canvasOpticalSoftnessInput', 'canvasOpticalSoftnessReadout'],
  halation: ['canvasHalationInput', 'canvasHalationReadout'],
  vignette: ['canvasVignetteInput', 'canvasVignetteReadout'],
  dustAmount: ['canvasDustAmountInput', 'canvasDustAmountReadout'],
  scratchProbability: ['canvasScratchProbabilityInput', 'canvasScratchProbabilityReadout'],
  scratchPersistence: ['canvasScratchPersistenceInput', 'canvasScratchPersistenceReadout'],
  hairProbability: ['canvasHairProbabilityInput', 'canvasHairProbabilityReadout'],
  damageProbability: ['canvasDamageProbabilityInput', 'canvasDamageProbabilityReadout'],
  lightLeakProbability: ['canvasLightLeakProbabilityInput', 'canvasLightLeakProbabilityReadout'],
});

const CANVAS_SELECT_IDS = [
  'canvasCompositionModeInput', 'canvasBackgroundTreatmentInput', 'canvasPresetInput', 'canvasCueMarksInput',
  'canvasFilmFormatInput', 'canvasFilmConditionInput', 'canvasFilmFrameRateInput', 'canvasOutputFrameRateInput', 'canvasExportModeInput',
];

function applyCanvasSettingsToControls() {
  const settings = normaliseCanvasSettings(state.canvasSettings);
  state.canvasSettings = settings;
  elements.canvasCompositionModeInput.value = settings.compositionMode;
  elements.canvasBackgroundTreatmentInput.value = settings.backgroundTreatment;
  elements.canvasBackgroundColorInput.value = settings.backgroundColor;
  elements.canvasSafeAreaInput.checked = settings.safeArea;
  elements.canvasPresetInput.value = settings.preset;
  elements.canvasFilmFormatInput.value = settings.filmFormat;
  elements.canvasFilmConditionInput.value = settings.filmCondition;
  elements.canvasSeedInput.value = settings.seed;
  elements.canvasMonochromeInput.checked = settings.monochrome;
  elements.canvasCueMarksInput.value = settings.cueMarks;
  elements.canvasDurationInput.value = settings.durationSeconds;
  elements.canvasFilmFrameRateInput.value = String(settings.filmFrameRate);
  elements.canvasOutputFrameRateInput.value = String(settings.outputFrameRate);
  elements.canvasExportModeInput.value = settings.exportMode;
  Object.entries(CANVAS_RANGE_CONTROLS).forEach(([field, [inputId]]) => {
    elements[inputId].value = settings[field];
  });
  updateCanvasControls();
  CANVAS_SELECT_IDS.map((id) => elements[id]).forEach(syncCustomSelect);
}

function readCanvasControlValues() {
  const ranges = Object.fromEntries(Object.entries(CANVAS_RANGE_CONTROLS).map(([field, [inputId]]) => [field, elements[inputId].value]));
  state.canvasSettings = normaliseCanvasSettings({
    ...state.canvasSettings,
    ...ranges,
    compositionMode: elements.canvasCompositionModeInput.value,
    backgroundTreatment: elements.canvasBackgroundTreatmentInput.value,
    backgroundColor: elements.canvasBackgroundColorInput.value,
    safeArea: elements.canvasSafeAreaInput.checked,
    preset: elements.canvasPresetInput.value,
    filmFormat: elements.canvasFilmFormatInput.value,
    filmCondition: elements.canvasFilmConditionInput.value,
    seed: elements.canvasSeedInput.value,
    monochrome: elements.canvasMonochromeInput.checked,
    cueMarks: elements.canvasCueMarksInput.value,
    durationSeconds: elements.canvasDurationInput.value,
    filmFrameRate: elements.canvasFilmFrameRateInput.value,
    outputFrameRate: elements.canvasOutputFrameRateInput.value,
    exportMode: elements.canvasExportModeInput.value,
  });
}

function hideCompressedCanvasPreview() {
  const video = elements.canvasCompressedPreviewVideo;
  video.pause();
  video.removeAttribute('src'); video.load();
  video.hidden = true;
  elements.canvasPreviewCanvas.hidden = false;
  elements.canvasPreviewBackgroundCanvas.hidden = false;
  elements.canvasCompressedPreviewButton.classList.remove('is-active');
  elements.canvasCompressedPreviewButton.textContent = 'preview compressed output';
}

function invalidateCanvasVariation() {
  state.canvasEventSchedule = null;
  hideCompressedCanvasPreview();
}

function canvasSourceAvailable() {
  return state.canvasSettings.source.source === 'artwork'
    ? Boolean(state.backgroundDataUrl)
    : Boolean(state.canvasSettings.source.path);
}

function updateCanvasControls() {
  const settings = state.canvasSettings;
  const preset = CANVAS_PRESETS.find((item) => item.id === settings.preset) || CANVAS_PRESETS[1];
  const composition = CANVAS_COMPOSITION_MODES.find((item) => item.id === settings.compositionMode) || CANVAS_COMPOSITION_MODES[2];
  elements.canvasSourceName.textContent = settings.source.name;
  elements.canvasPresetDescription.textContent = `${preset.description} ${composition.description}`;
  Object.entries(CANVAS_RANGE_CONTROLS).forEach(([field, [, readoutId]]) => {
    elements[readoutId].value = `${settings[field]}%`;
  });
  elements.canvasDurationReadout.value = `${settings.durationSeconds} s`;
  // The colour picker only affects the Solid background treatment. Hiding its
  // whole field keeps the other composition modes uncluttered and avoids a
  // disabled colour swatch looking like part of the artwork preview.
  const backgroundColourField = elements.canvasBackgroundColorInput.closest('.canvas-colour-field');
  if (backgroundColourField) backgroundColourField.hidden = settings.backgroundTreatment !== 'solid';
  elements.canvasSafeAreaOverlay.hidden = !settings.safeArea;
  const errors = canvasValidationErrors(settings, canvasSourceAvailable(), state.masters.length);
  elements.exportCanvasesButton.disabled = errors.length > 0 || exportOperations.has('canvas');
  elements.canvasCompressedPreviewButton.disabled = exportOperations.has('canvas');
  elements.exportCanvasesButton.textContent = settings.exportMode === 'tracks'
    ? `export ${state.masters.length || 0} track Canvas${state.masters.length === 1 ? '' : 'es'}`
    : 'export Canvas';
  elements.canvasValidationNote.textContent = errors.length
    ? errors.join(' ')
    : `Ready: 576 × 1024 · ${settings.durationSeconds} seconds · ${settings.outputFrameRate} fps · H.264 yuv420p · silent · Rec.709.`;
  const mode = state.canvasPreviewMode === 'seam' ? ' · seam check' : '';
  elements.canvasPreviewStatus.textContent = `${settings.source.name} · ${preset.name} · seed ${settings.seed}${mode}`;
}

async function chooseCanvasImage() {
  if (!isDesktop()) return;
  const paths = await desktop.open({
    multiple: false,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  const path = Array.isArray(paths) ? paths[0] : paths;
  if (!path) return;
  state.canvasSettings.source = { source: 'file', path, name: path.split('/').pop(), kind: 'image' };
  clearVisualPreviewMedia();
  state.canvasSettings.positionX = 50;
  state.canvasSettings.positionY = 50;
  invalidateCanvasVariation();
  applyCanvasSettingsToControls();
  markDirty();
  drawCanvasPreview();
}

function useArtworkForCanvas() {
  clearVisualPreviewMedia();
  state.canvasSettings.source = { source: 'artwork', path: '', name: 'Album artwork', kind: 'image' };
  state.canvasSettings.positionX = 50;
  state.canvasSettings.positionY = 50;
  invalidateCanvasVariation();
  applyCanvasSettingsToControls();
  markDirty();
  drawCanvasPreview();
}

async function loadCanvasPreviewSource() {
  if (state.canvasSettings.source.source === 'artwork') return elements.artworkCanvas;
  return loadVideoPreviewMedia(state.canvasSettings.source);
}

function canvasNoiseLayer(width, height, seed, amount, grainSize = 1, clumping = 0) {
  // Generate below output resolution, then scale softly. This avoids harsh
  // digital pixel noise and gives H.264 some medium-frequency structure to keep.
  const divisor = Math.max(2.2, 5.8 - grainSize * 1.6);
  const noiseWidth = Math.max(72, Math.round(width / divisor));
  const noiseHeight = Math.max(128, Math.round(height / divisor));
  const noise = state.canvasNoiseCanvas || document.createElement('canvas');
  state.canvasNoiseCanvas = noise;
  noise.width = noiseWidth;
  noise.height = noiseHeight;
  const context = noise.getContext('2d');
  const pixels = context.createImageData(noiseWidth, noiseHeight);
  const random = randomFromSeed(seed);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const fine = random();
    const clustered = (fine * (1 - clumping) + ((index / 4 + seed) % 17) / 17 * clumping);
    const value = Math.round(84 + clustered * 104);
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = Math.round(255 * amount);
  }
  context.putImageData(pixels, 0, 0);
  return { noise, width, height };
}

function drawCanvasVignette(context, canvas, strength, seed) {
  if (strength <= 0) return;
  const offsetX = ((seed % 17) - 8) / 100;
  const offsetY = ((seed % 23) - 11) / 120;
  const gradient = context.createRadialGradient(
    canvas.width * (0.5 + offsetX),
    canvas.height * (0.5 + offsetY),
    canvas.width * 0.12,
    canvas.width * (0.5 + offsetX),
    canvas.height * (0.5 + offsetY),
    canvas.height * 0.63,
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(0.72, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, `rgba(0, 0, 0, ${Math.min(0.42, strength).toFixed(3)})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function canvasCompositionPlacement(canvas, source, settings) {
  const size = mediaDimensions(source);
  const scaleControl = settings.imageScale / 100;
  const contained = ['fit', 'artwork-background'].includes(settings.compositionMode);
  if (contained) {
    const maximumWidth = canvas.width * (settings.compositionMode === 'fit' ? 0.94 : 0.84) * scaleControl;
    const maximumHeight = canvas.height * (settings.compositionMode === 'fit' ? 0.94 : 0.74) * scaleControl;
    const scale = Math.min(maximumWidth / size.width, maximumHeight / size.height);
    const width = size.width * scale; const height = size.height * scale;
    const overflowX = Math.max(0, canvas.width - width);
    const overflowY = Math.max(0, canvas.height - height);
    return { x: overflowX * settings.positionX / 100, y: overflowY * settings.positionY / 100, width, height, overflowX, overflowY, contained: true };
  }
  const scale = Math.max(canvas.width / size.width, canvas.height / size.height) * scaleControl;
  const width = size.width * scale; const height = size.height * scale;
  const overflowX = Math.max(0, width - canvas.width);
  const overflowY = Math.max(0, height - canvas.height);
  return { x: -overflowX * settings.positionX / 100, y: -overflowY * settings.positionY / 100, width, height, overflowX, overflowY, contained: false };
}

function drawCanvasBackground(source, settings) {
  const canvas = elements.canvasPreviewBackgroundCanvas;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!['fit', 'artwork-background'].includes(settings.compositionMode) || settings.backgroundTreatment === 'solid') {
    canvas.style.setProperty('--canvas-background-filter', 'none');
    return;
  }
  const placement = coverPlacement(canvas.width, canvas.height, ...Object.values(mediaDimensions(source)), 50, 50);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, placement.x, placement.y, placement.width, placement.height);
  canvas.style.setProperty('--canvas-background-filter', settings.backgroundTreatment === 'blurred'
    ? 'blur(24px) brightness(.56) saturate(.82)'
    : 'brightness(.42) saturate(.72)');
}

function drawCanvasMaterialEvents(context, canvas, events, frame) {
  context.save();
  for (const particle of events.dust) {
    const x = particle.x * canvas.width + (particle.gateSpace ? 0 : frame.x);
    const y = particle.y * canvas.height + (particle.gateSpace ? 0 : frame.y);
    const colour = particle.dark ? `rgba(24, 20, 16, ${particle.opacity})` : `rgba(246, 239, 216, ${particle.opacity})`;
    context.fillStyle = colour;
    context.beginPath();
    if (particle.shape === 0) context.ellipse(x, y, particle.size * 1.25, particle.size * 0.72, particle.driftX, 0, Math.PI * 2);
    else if (particle.shape === 1) context.rect(x, y, particle.size * 1.7, Math.max(0.7, particle.size * 0.55));
    else {
      context.moveTo(x, y - particle.size); context.lineTo(x + particle.size, y + particle.size * 0.6); context.lineTo(x - particle.size * 0.7, y + particle.size); context.closePath();
    }
    context.fill();
  }
  for (const scratch of events.scratches) {
    const x = scratch.x * canvas.width + (scratch.gateSpace ? 0 : frame.x);
    context.strokeStyle = scratch.dark ? `rgba(12, 10, 8, ${scratch.opacity})` : `rgba(245, 239, 220, ${scratch.opacity})`;
    context.lineWidth = 0.6;
    for (let section = 0; section < 5; section += 1) {
      const top = canvas.height * (0.05 + section * 0.19);
      context.beginPath(); context.moveTo(x + section % 2, top); context.lineTo(x + scratch.bend * canvas.width, top + canvas.height * 0.12); context.stroke();
    }
  }
  for (const hair of events.hairs) {
    context.strokeStyle = `rgba(20, 17, 14, ${hair.opacity})`; context.lineWidth = 1.1;
    context.beginPath(); context.moveTo(hair.x * canvas.width, -10); context.bezierCurveTo(canvas.width * 0.35, canvas.height * 0.2, canvas.width * 0.68, canvas.height * 0.72, hair.y * canvas.width, canvas.height + 10); context.stroke();
  }
  for (const damage of events.damage) {
    const x = damage.x * canvas.width; const y = damage.y * canvas.height;
    context.fillStyle = `rgba(239, 222, 183, ${damage.opacity})`;
    context.beginPath(); context.moveTo(x - 12, y); context.lineTo(x - 3, y - 16); context.lineTo(x + 15, y - 7); context.lineTo(x + 9, y + 12); context.lineTo(x - 8, y + 8); context.closePath(); context.fill();
  }
  for (const leak of events.lightLeaks) {
    const fromLeft = leak.x < 0.5;
    const gradient = context.createLinearGradient(fromLeft ? 0 : canvas.width, 0, fromLeft ? canvas.width * 0.55 : canvas.width * 0.45, 0);
    gradient.addColorStop(0, `rgba(235, 105, 48, ${leak.opacity})`); gradient.addColorStop(1, 'rgba(235, 105, 48, 0)');
    context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const cue of events.cueMarks) {
    context.strokeStyle = `rgba(245, 234, 205, ${Math.min(0.2, cue.opacity + 0.06)})`; context.lineWidth = 2;
    context.beginPath(); context.arc(canvas.width * 0.82, canvas.height * 0.14, 13, 0, Math.PI * 2); context.stroke();
  }
  context.restore();
}

function canvasPreviewElapsed(elapsed, duration) {
  if (state.canvasPreviewMode !== 'seam') return elapsed % duration;
  const seamSecond = elapsed % 1;
  return seamSecond < 0.5 ? duration - 0.5 + seamSecond : seamSecond - 0.5;
}

async function drawCanvasPreview() {
  clearTimeout(canvasPreviewTimer);
  canvasPreviewTimer = null;
  const drawing = ++state.canvasPreviewFrame;
  const canvas = elements.canvasPreviewCanvas;
  const context = canvas.getContext('2d');
  try {
    const source = await loadCanvasPreviewSource();
    if (drawing !== state.canvasPreviewFrame) return;
    const settings = state.canvasSettings;
    const rawElapsed = (performance.now() - state.canvasPreviewStartedAt) / 1000;
    const elapsed = canvasPreviewElapsed(rawElapsed, settings.durationSeconds);
    const previewSeed = settings.seed || hashSeed(`${state.projectId || releaseData().title}`) || 1;
    const frame = canvasPreviewFrame(settings, elapsed, previewSeed);
    const placement = canvasCompositionPlacement(canvas, source, settings);
    state.canvasRenderedBounds = { overflowX: placement.overflowX, overflowY: placement.overflowY, contained: placement.contained };
    drawCanvasBackground(source, settings);

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.translate(canvas.width / 2 + frame.x, canvas.height / 2 + frame.y);
    context.rotate(frame.rotation * Math.PI / 180);
    context.scale(frame.scale, frame.scale);
    context.translate(-canvas.width / 2, -canvas.height / 2);
    const monochrome = settings.monochrome ? ' grayscale(1)' : '';
    const warmth = settings.monochrome ? '' : ` sepia(${Math.max(0, frame.warmth * 2).toFixed(4)}) hue-rotate(${(frame.warmth * 18).toFixed(3)}deg)`;
    context.filter = `blur(${Math.max(0, frame.softness).toFixed(3)}px) brightness(${frame.brightness.toFixed(4)}) contrast(${frame.contrast.toFixed(4)})${monochrome}${warmth}`;
    if (frame.halation > 0) {
      context.save();
      context.globalCompositeOperation = 'screen'; context.globalAlpha = frame.halation;
      context.filter = `blur(${(frame.softness + 3.2).toFixed(3)}px) sepia(.18)`;
      context.drawImage(source, placement.x, placement.y, placement.width, placement.height);
      context.restore();
    }
    context.drawImage(source, placement.x, placement.y, placement.width, placement.height);
    context.restore();

    if (frame.grainAmount > 0) {
      const { noise } = canvasNoiseLayer(canvas.width, canvas.height, previewSeed + frame.grainFrame * 7_919, frame.grainAmount, frame.grainSize, frame.grainClumping);
      context.save();
      context.globalCompositeOperation = 'soft-light';
      context.imageSmoothingEnabled = true;
      context.drawImage(noise, 0, 0, canvas.width, canvas.height);
      context.restore();
    }
    state.canvasEventSchedule ||= canvasEventSchedule(settings, previewSeed);
    drawCanvasMaterialEvents(context, canvas, activeCanvasEvents(state.canvasEventSchedule, frame.grainFrame), frame);
    drawCanvasVignette(context, canvas, frame.vignette, previewSeed);
    updateCanvasControls();
  } catch (error) {
    if (drawing !== state.canvasPreviewFrame) return;
    state.canvasRenderedBounds = null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#aaa'; context.font = '16px IBM Plex Mono'; context.textAlign = 'center';
    context.fillText('CANVAS PREVIEW UNAVAILABLE', canvas.width / 2, canvas.height / 2);
    elements.canvasPreviewStatus.textContent = `Preview error: ${error}`;
  }
  if (!previewsSuspended && state.canvasPreviewPlaying && state.activeStage === 'video' && state.activeVideoPanel === 'canvases' && drawing === state.canvasPreviewFrame) {
    canvasPreviewTimer = setTimeout(() => drawCanvasPreview(), 66);
  }
}

function toggleCanvasPreview() {
  state.canvasPreviewPlaying = !state.canvasPreviewPlaying;
  elements.playCanvasPreviewButton.textContent = state.canvasPreviewPlaying ? 'pause preview' : 'play preview';
  if (state.canvasPreviewPlaying) state.canvasPreviewStartedAt = performance.now();
  drawCanvasPreview();
}

function toggleCanvasSeamPreview() {
  state.canvasPreviewMode = state.canvasPreviewMode === 'seam' ? 'normal' : 'seam';
  elements.canvasSeamPreviewButton.classList.toggle('is-active', state.canvasPreviewMode === 'seam');
  elements.canvasSeamPreviewButton.textContent = state.canvasPreviewMode === 'seam' ? 'show complete loop' : 'preview loop boundary';
  state.canvasPreviewStartedAt = performance.now();
  hideCompressedCanvasPreview();
  updateCanvasControls();
  drawCanvasPreview();
}

function regenerateCanvasVariation() {
  state.canvasSettings.seed = nextCanvasSeed(state.canvasSettings.seed);
  state.canvasEventSchedule = null;
  elements.canvasSeedInput.value = state.canvasSettings.seed;
  hideCompressedCanvasPreview();
  markDirty(); updateCanvasControls(); drawCanvasPreview();
}

function selectCanvasPreset() {
  state.canvasSettings = applyCanvasPreset(state.canvasSettings, elements.canvasPresetInput.value);
  invalidateCanvasVariation();
  applyCanvasSettingsToControls();
  markDirty(); drawCanvasPreview();
}

function resetCanvasDefaults() {
  const source = state.canvasSettings.source;
  const exportMode = state.canvasSettings.exportMode;
  state.canvasSettings = { ...defaultCanvasSettings(), source, exportMode };
  state.canvasEventSchedule = null;
  state.canvasPreviewMode = 'normal';
  elements.canvasSeamPreviewButton.classList.remove('is-active');
  elements.canvasSeamPreviewButton.textContent = 'preview loop boundary';
  applyCanvasSettingsToControls(); markDirty(); drawCanvasPreview();
}

function toggleCanvasPositioning() {
  if (!canvasSourceAvailable()) return;
  state.canvasPositioning = !state.canvasPositioning;
  state.canvasDrag = null;
  elements.canvasPreviewCanvas.classList.toggle('is-positioning', state.canvasPositioning);
  elements.canvasPositionButton.textContent = state.canvasPositioning ? 'lock image position' : 'reposition image';
  elements.canvasPositionButton.classList.toggle('is-active', state.canvasPositioning);
}

function beginCanvasDrag(event) {
  if (!state.canvasPositioning) return;
  elements.canvasPreviewCanvas.setPointerCapture(event.pointerId);
  state.canvasDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: state.canvasSettings.positionX,
    startY: state.canvasSettings.positionY,
    rect: elements.canvasPreviewCanvas.getBoundingClientRect(),
  };
}

function moveCanvasDrag(event) {
  const drag = state.canvasDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const bounds = state.canvasRenderedBounds || { overflowX: 0, overflowY: 0 };
  const canvasDeltaX = (event.clientX - drag.startClientX) * elements.canvasPreviewCanvas.width / drag.rect.width;
  const canvasDeltaY = (event.clientY - drag.startClientY) * elements.canvasPreviewCanvas.height / drag.rect.height;
  const movedPosition = (start, delta, available) => bounds.contained
    ? Math.min(100, Math.max(0, start + (available ? delta / available * 100 : 0)))
    : movedBackgroundPosition(start, delta, available);
  state.canvasSettings.positionX = movedPosition(drag.startX, canvasDeltaX, bounds.overflowX);
  state.canvasSettings.positionY = movedPosition(drag.startY, canvasDeltaY, bounds.overflowY);
  invalidateCanvasVariation(); markDirty();
  drawCanvasPreview();
}

function endCanvasDrag(event) {
  if (state.canvasDrag?.pointerId !== event.pointerId) return;
  state.canvasDrag = null;
  if (elements.canvasPreviewCanvas.hasPointerCapture(event.pointerId)) elements.canvasPreviewCanvas.releasePointerCapture(event.pointerId);
}

function resetCanvasExportProgress() {
  elements.canvasExportProgress.hidden = true;
  elements.canvasExportProgress.classList.remove('is-encoding');
  elements.canvasExportProgress.setAttribute('aria-valuenow', '0');
  elements.canvasExportProgressBar.style.width = '0%';
  elements.canvasExportProgressLabel.hidden = true;
  elements.canvasExportProgressLabel.textContent = '';
}

function showCanvasExportProgress(progress) {
  if (!progress || progress.exportId !== state.canvasExportActiveId) return;
  const total = Math.max(1, Number(progress.total) || 1);
  const completed = Math.min(total, Math.max(0, Number(progress.completed) || 0));
  const itemPercent = Math.min(100, Math.max(0, Number(progress.trackPercent) || 0));
  const percent = progress.phase === 'finished'
    ? 100
    : Math.round((completed + (progress.phase === 'encoding' ? itemPercent / 100 : 0)) / total * 100);
  const current = progress.currentTrack ? ` — ${progress.currentTrack}` : '';
  const label = progress.phase === 'preparing'
    ? `Preparing ${total} Canvas file${total === 1 ? '' : 's'}…`
    : progress.phase === 'finished'
      ? `${completed} of ${total} Canvas files processed.`
      : progress.phase === 'cancelled'
        ? `Canvas export cancelled · ${completed} of ${total} completed.`
        : progress.phase === 'processed'
          ? `${completed} of ${total} Canvas files processed.`
          : `Encoding ${Math.min(total, completed + 1)} of ${total} · ${Math.round(itemPercent)}%${current}`;
  elements.canvasExportProgress.hidden = false;
  elements.canvasExportProgress.classList.toggle('is-encoding', progress.phase === 'encoding');
  elements.canvasExportProgress.setAttribute('aria-valuenow', String(percent));
  elements.canvasExportProgressBar.style.width = `${percent}%`;
  elements.canvasExportProgressLabel.hidden = false;
  elements.canvasExportProgressLabel.textContent = label;
}

async function cancelCanvases() {
  if (!isDesktop() || !state.canvasExportActiveId || state.canvasExportCancelling) return;
  state.canvasExportCancelling = true;
  elements.cancelCanvasesButton.disabled = true;
  elements.cancelCanvasesButton.textContent = 'cancelling…';
  elements.canvasExportStatus.textContent = 'Stopping the active Canvas encoder and removing its unfinished temporary file…';
  try {
    const found = await desktop.invoke('cancel_video_export', { exportId: state.canvasExportActiveId });
    if (!found) {
      state.canvasExportCancelling = false;
      elements.cancelCanvasesButton.disabled = false;
      elements.cancelCanvasesButton.textContent = 'cancel Canvas export';
      elements.canvasExportStatus.textContent = 'The encoder is starting or has just finished. Press cancel again if the export continues.';
    }
  } catch (error) {
    state.canvasExportCancelling = false;
    elements.cancelCanvasesButton.disabled = false;
    elements.cancelCanvasesButton.textContent = 'cancel Canvas export';
    elements.canvasExportStatus.className = 'is-error';
    elements.canvasExportStatus.textContent = `Could not cancel the Canvas export: ${error}`;
  }
}

function canvasNativeRequest(exportId, outputDir, folderName, variants) {
  const settings = state.canvasSettings;
  return {
    exportId,
    outputDir,
    folderName,
    artworkDataUrl: elements.artworkCanvas.toDataURL('image/png'),
    source: videoMediaRequest(settings.source),
    compositionMode: settings.compositionMode,
    backgroundTreatment: settings.backgroundTreatment,
    backgroundColor: settings.backgroundColor,
    positionX: settings.positionX,
    positionY: settings.positionY,
    imageScale: settings.imageScale,
    preset: settings.preset,
    filmFormat: settings.filmFormat,
    filmCondition: settings.filmCondition,
    seed: settings.seed,
    intensity: settings.intensity,
    grainAmount: settings.grainAmount,
    grainSize: settings.grainSize,
    grainClumping: settings.grainClumping,
    exposureFlicker: settings.exposureFlicker,
    colourInstability: settings.colourInstability,
    horizontalWeave: settings.horizontalWeave,
    verticalJitter: settings.verticalJitter,
    rotation: settings.rotation,
    scaleBreathing: settings.scaleBreathing,
    opticalSoftness: settings.opticalSoftness,
    halation: settings.halation,
    vignette: settings.vignette,
    dustAmount: settings.dustAmount,
    scratchProbability: settings.scratchProbability,
    scratchPersistence: settings.scratchPersistence,
    hairProbability: settings.hairProbability,
    damageProbability: settings.damageProbability,
    lightLeakProbability: settings.lightLeakProbability,
    cueMarks: settings.cueMarks,
    monochrome: settings.monochrome,
    durationSeconds: settings.durationSeconds,
    filmFrameRate: settings.filmFrameRate,
    outputFrameRate: settings.outputFrameRate,
    variants,
  };
}

async function previewCompressedCanvas() {
  if (!elements.canvasCompressedPreviewVideo.hidden) {
    hideCompressedCanvasPreview();
    drawCanvasPreview();
    return;
  }
  // A compressed preview is a single temporary file, so it does not require a
  // master even when the final export mode is currently set to per-track.
  const previewTrackCount = state.canvasSettings.exportMode === 'tracks'
    ? Math.max(1, state.masters.length)
    : state.masters.length;
  const errors = canvasValidationErrors(state.canvasSettings, canvasSourceAvailable(), previewTrackCount);
  if (!isDesktop()) {
    elements.canvasExportStatus.className = 'is-error';
    elements.canvasExportStatus.textContent = 'Compressed preview is available in the packaged desktop app.';
    return;
  }
  if (errors.length) {
    elements.canvasExportStatus.className = 'is-error';
    elements.canvasExportStatus.textContent = errors.join(' ');
    return;
  }
  const exportId = crypto.randomUUID();
  state.canvasExportActiveId = exportId;
  state.canvasExportCancelling = false;
  resetCanvasExportProgress();
  let unlisten;
  elements.canvasCompressedPreviewButton.disabled = true;
  elements.canvasCompressedPreviewButton.textContent = 'encoding preview…';
  elements.cancelCanvasesButton.hidden = false;
  elements.canvasExportStatus.className = '';
  elements.canvasExportStatus.textContent = 'Encoding the complete loop with the final H.264 settings.';
  try {
    unlisten = await desktop.listen('release-preparer://canvas-export-progress', (event) => showCanvasExportProgress(event.payload));
    await ensureArtworkReady();
    const variants = [{ outputFileName: 'Canvas Compression Preview.mp4', seed: state.canvasSettings.seed }];
    const path = await desktop.invoke('render_canvas_preview', { request: canvasNativeRequest(exportId, '', '', variants) });
    const allowedPath = await desktop.invoke('allow_visual_preview', { path });
    const video = elements.canvasCompressedPreviewVideo;
    video.src = desktop.convertFileSrc(allowedPath);
    video.hidden = false;
    elements.canvasPreviewCanvas.hidden = true;
    elements.canvasPreviewBackgroundCanvas.hidden = true;
    elements.canvasCompressedPreviewButton.classList.add('is-active');
    elements.canvasCompressedPreviewButton.textContent = 'show working preview';
    await video.play();
    state.canvasCompressedPreviewPath = path;
    elements.canvasExportStatus.className = 'is-success';
    elements.canvasExportStatus.textContent = 'Playing the compressed H.264 loop used for delivery checking.';
  } catch (error) {
    hideCompressedCanvasPreview();
    elements.canvasExportStatus.className = 'is-error';
    elements.canvasExportStatus.textContent = `Compressed preview failed: ${error}`;
  } finally {
    try { unlisten?.(); } catch { /* Always release the operation below. */ }
    state.canvasExportActiveId = '';
    state.canvasExportCancelling = false;
    elements.canvasCompressedPreviewButton.disabled = false;
    elements.cancelCanvasesButton.hidden = true;
    elements.cancelCanvasesButton.disabled = false;
    elements.cancelCanvasesButton.textContent = 'cancel Canvas export';
    if (elements.canvasCompressedPreviewVideo.hidden) elements.canvasCompressedPreviewButton.textContent = 'preview compressed output';
  }
}

async function exportCanvases() {
  const settings = state.canvasSettings;
  const errors = canvasValidationErrors(settings, canvasSourceAvailable(), state.masters.length);
  if (!isDesktop() || errors.length) {
    if (errors.length) {
      elements.canvasExportStatus.className = 'is-error';
      elements.canvasExportStatus.textContent = errors.join(' ');
    }
    return;
  }
  let outputDir = state.lastExportDir;
  let folderName = state.lastExportFolderName;
  if (!outputDir || !folderName) {
    outputDir = await desktop.open({ directory: true, multiple: false, title: 'Choose where to create the Canvas package' });
    folderName = packageName();
  }
  if (!outputDir) return;
  const exportId = crypto.randomUUID();
  state.canvasExportActiveId = exportId;
  resetCanvasExportProgress();
  let unlisten;
  elements.exportCanvasesButton.disabled = true;
  elements.exportCanvasesButton.textContent = 'exporting Canvases…';
  state.canvasExportCancelling = false;
  elements.cancelCanvasesButton.hidden = false;
  elements.cancelCanvasesButton.disabled = false;
  elements.cancelCanvasesButton.textContent = 'cancel Canvas export';
  elements.canvasExportStatus.className = '';
  elements.canvasExportStatus.textContent = 'Rendering the loop-aware film states, material events, and portrait composition.';
  try {
    unlisten = await desktop.listen('release-preparer://canvas-export-progress', (event) => showCanvasExportProgress(event.payload));
    await ensureArtworkReady();
    const request = canvasNativeRequest(exportId, outputDir, folderName, canvasVariants(settings, state.masters, releaseData().title));
    const result = await desktop.invoke('export_canvases', { request });
    if (result.cancelled) {
      elements.canvasExportStatus.textContent = `Canvas export cancelled. ${result.exported} completed file${result.exported === 1 ? '' : 's'} remain in ${result.destination}; the unfinished temporary file was removed.`;
      return;
    }
    const failed = result.failed ? ` ${result.failed} failed. ${result.message}` : '';
    elements.canvasExportStatus.className = result.failed ? 'is-error' : 'is-success';
    elements.canvasExportStatus.textContent = `${result.exported} Canvas file${result.exported === 1 ? '' : 's'} exported to ${result.destination}.${failed}`;
  } catch (error) {
    elements.canvasExportStatus.className = 'is-error';
    elements.canvasExportStatus.textContent = `Canvas export failed: ${error}`;
  } finally {
    try { unlisten?.(); } catch { /* Always release the operation below. */ }
    state.canvasExportActiveId = '';
    state.canvasExportCancelling = false;
    elements.cancelCanvasesButton.hidden = true;
    elements.cancelCanvasesButton.disabled = false;
    elements.cancelCanvasesButton.textContent = 'cancel Canvas export';
    updateCanvasControls();
  }
}

function updateCopyPreview() {
  const copies = buildPlatformCopies(releaseData());
  elements.copyPreview.textContent = copies[state.activeCopyTab] || 'Fill in the release details to generate platform copy.';
}

function showCopyTab(button) {
  state.activeCopyTab = button.dataset.copyTab;
  document.querySelectorAll('.copy-tab').forEach((tab) => {
    const active = tab === button;
    tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  });
  elements.copyPreview.setAttribute('aria-labelledby', button.id);
  updateCopyPreview();
}

function bindTabNavigation(buttons, activate) {
  buttons.forEach((button, index) => button.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault(); activate(buttons[next]); buttons[next].focus();
  }));
}

async function copyCurrentText() {
  const text = elements.copyPreview.textContent; if (!text) return;
  try {
    await writeClipboardText(text);
    elements.copyTextButton.textContent = 'copied';
  } catch {
    elements.copyTextButton.textContent = 'Select the text below to copy';
    let fallback = byId('preparationCopyFallback');
    if (!fallback) { fallback = document.createElement('textarea'); fallback.id = 'preparationCopyFallback'; fallback.className = 'copy-fallback'; fallback.readOnly = true; fallback.setAttribute('aria-label', 'Copy preview — select and copy this text'); elements.copyPreview.after(fallback); }
    fallback.value = text; fallback.focus(); fallback.select();
  }
  setTimeout(() => { elements.copyTextButton.textContent = 'copy current text'; }, 1600);
}

async function writeClipboardText(text) {
  // The desktop app uses macOS directly because WebView clipboard permissions
  // can reject an otherwise normal button click. Browser previews keep a small
  // fallback so their copy buttons remain useful too.
  if (isDesktop()) {
    await desktop.invoke('copy_text_to_clipboard', { text });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text; document.body.append(area); area.select();
    const copied = document.execCommand('copy'); area.remove();
    if (!copied) throw new Error('The clipboard is unavailable.');
  }
}

function renderReview() {
  const groups = checklistGroups(); const items = groups.flatMap((group) => group.items); const completed = items.filter(([, ready]) => ready).length; const ready = completed === items.length;
  elements.checklist.replaceChildren();
  groups.forEach((group) => {
    const section = document.createElement('section'); section.className = 'checklist-group'; section.innerHTML = `<h3>${group.name}</h3>`;
    group.items.forEach(([label, complete]) => { const row = document.createElement('div'); row.className = `checklist-item${complete ? ' is-complete' : ''}`; row.innerHTML = `<i></i><span>${label}</span>`; section.append(row); });
    elements.checklist.append(section);
  });
  elements.checklistSummary.textContent = `${completed} / ${items.length} complete`;
  elements.overallReadout.textContent = ready ? 'release package complete' : `${items.length - completed} items still to prepare`;
  const folder = state.lastExportFolderName || packageName();
  // Videos and Canvases are made from their own stage buttons. Listing them here
  // helps a new user understand where those optional exports will be collected.
  elements.folderTree.textContent = `${folder}/\n├── Masters/\n│   ├── ${state.masters.length} tagged prepared master${state.masters.length === 1 ? '' : 's'}\n│   └── MP3/ (320 kbps · metadata + cover artwork)\n├── Artwork/\n│   ├── ${safeStem(folder)} - Cover.png\n│   └── ${safeStem(folder)} - Cover - Web.jpg (under 2 MB)\n├── Copy/\n│   ├── Bandcamp.txt\n│   ├── YouTube.txt\n│   ├── SoundCloud.txt\n│   ├── Media Release.txt\n│   ├── Playlist Pitch.txt\n│   ├── Social Posts.txt\n│   └── Platform Tags.txt\n├── Admin/\n│   ├── Release Summary.txt\n│   ├── Release Data.json\n│   └── Release Checklist.txt\n├── Videos/ (after track-video export)\n└── Canvases/ (after Canvas export)`;
  updateExportControls();
}

function updateExportControls() {
  const canUpdate = Boolean(state.lastExportDir && state.lastExportFolderName);
  elements.quickExportButton.textContent = canUpdate ? 'update export' : 'export';
  elements.exportReleaseButton.textContent = canUpdate ? 'update exported release files' : 'export current release files';
  elements.exportReleaseButton.disabled = exportOperations.has('release'); elements.quickExportButton.disabled = exportOperations.has('release');
  elements.updateNonMusicButton.disabled = !canUpdate || state.updatingNonMusic;
  elements.updateNonMusicButton.textContent = state.updatingNonMusic ? 'updating non-music files…' : 'update non-music files';
  elements.chooseDifferentExportButton.hidden = !canUpdate; elements.chooseDifferentExportButton.disabled = exportOperations.has('release');
  if (canUpdate && !elements.exportStatus.textContent) {
    elements.exportStatus.textContent = `Updates will be written to ${state.lastExportDir}/${state.lastExportFolderName}`;
  }
}

function packageName() {
  const data = releaseData(); return [data.catalogue, data.artist, data.title].filter(Boolean).join(' - ') || 'Prepared release';
}

function releaseSummary() {
  const data = releaseData();
  const tracks = state.masters.map((track, index) => `${String(index + 1).padStart(2, '0')}. ${track.metadata.title} — ${track.metadata.artist}`).join('\n');
  return `RELEASE SUMMARY\n_______________\nTitle: ${data.title}\nArtist: ${data.artist}\nAlbum artist: ${data.albumArtist}\nRelease date: ${formatDate(data.releaseDate)}\nLabel: ${data.label}\nCatalogue number: ${data.catalogue}\nGenre: ${data.genre}\nUPC / EAN: ${data.upc}\nCopyright: ${data.copyright}\n\nTRACK LIST\n__________\n${tracks}\n\nCREDITS\n_______\n${data.credits}\n`;
}

function packageTextFiles(outputDir, folderName) {
  const data = releaseData();
  const copies = buildPlatformCopies(data);
  const checklistText = checklistGroups()
    .flatMap((group) => [`${group.name.toUpperCase()}`, ...group.items.map(([label, complete]) => `${complete ? '[x]' : '[ ]'} ${label}`), ''])
    .join('\n');
  const projectSnapshot = { ...serialiseProject(), exportState: { outputDir, folderName } };

  // Both full export and the lightweight copy update use this one list. This
  // prevents a newly added text document from being missed by either route.
  return [
    { relativePath: 'Copy/Bandcamp.txt', content: copies.bandcamp },
    { relativePath: 'Copy/YouTube.txt', content: copies.youtube },
    { relativePath: 'Copy/SoundCloud.txt', content: copies.soundcloud },
    { relativePath: 'Copy/Media Release.txt', content: copies.media },
    { relativePath: 'Copy/Playlist Pitch.txt', content: copies.playlistPitch },
    { relativePath: 'Copy/Social Posts.txt', content: copies.social },
    { relativePath: 'Copy/Platform Tags.txt', content: copies.tags },
    { relativePath: 'Admin/Release Summary.txt', content: releaseSummary() },
    { relativePath: 'Admin/Release Checklist.txt', content: checklistText },
    { relativePath: 'Admin/Release Data.json', content: JSON.stringify(projectSnapshot, null, 2) },
  ];
}

async function updateNonMusicFiles(automatic = false) {
  if (!isDesktop() || !state.lastExportDir || !state.lastExportFolderName) {
    if (!automatic) elements.exportStatus.textContent = 'Export this release once before updating its non-music files.';
    return false;
  }
  if (state.updatingNonMusic) {
    state.nonMusicUpdateQueued = true;
    return false;
  }

  state.updatingNonMusic = true;
  state.nonMusicUpdateQueued = false;
  const revisionAtStart = state.changeRevision;
  updateExportControls();
  elements.exportStatus.className = 'export-status';
  elements.exportStatus.textContent = automatic ? 'Updating exported copy and admin files…' : 'Saving the release and updating its non-music files…';

  try {
    // A manual update first saves the current release. The automatic route is
    // already called immediately after a successful autosave.
    if (!automatic) await waitForProjectSave();
    const request = {
      outputDir: state.lastExportDir,
      folderName: state.lastExportFolderName,
      textFiles: packageTextFiles(state.lastExportDir, state.lastExportFolderName),
    };
    const result = await desktop.invoke('update_non_music_files', { request });
    elements.exportStatus.className = 'export-status is-success';
    elements.exportStatus.textContent = `${result.updated} non-music files updated at ${result.destination}. No masters or artwork were processed.`;
    return true;
  } catch (error) {
    elements.exportStatus.className = 'export-status is-error';
    elements.exportStatus.textContent = `Non-music files could not be updated: ${error}`;
    return false;
  } finally {
    state.updatingNonMusic = false;
    updateExportControls();
    const needsAnotherUpdate = state.nonMusicUpdateQueued
      || (revisionAtStart !== state.changeRevision && !state.dirty);
    state.nonMusicUpdateQueued = false;
    if (needsAnotherUpdate) void updateNonMusicFiles(true);
  }
}

async function waitForProjectSave(syncExport = true) {
  // If autosave is already running, wait for it, then always write the current
  // project shape. This also upgrades older fixed-social projects before Codex
  // receives their exact file path.
  while (state.saving) await new Promise((resolve) => setTimeout(resolve, 40));
  const saved = await saveProject(true, syncExport);
  while (state.saving) await new Promise((resolve) => setTimeout(resolve, 40));
  return Boolean(saved && !state.dirty);
}

async function refreshOpenAiKeyStatus() {
  if (!isDesktop()) {
    state.openAiKeySaved = false;
    setOpenAiSettingsStatus('OpenAI drafting is available in the packaged desktop app.', 'error');
    elements.saveOpenAiKeyButton.disabled = true;
    elements.removeOpenAiKeyButton.disabled = true;
    elements.generateAiDraftButton.disabled = true;
    elements.refreshAiDraftButton.disabled = true;
    return;
  }
  try {
    const status = await desktop.invoke('openai_api_key_status');
    state.openAiKeySaved = status.saved;
    elements.openAiApiKeyInput.value = '';
    elements.openAiApiKeyInput.placeholder = status.saved ? `Saved in macOS Keychain · ${status.hint}` : 'Paste an OpenAI API key';
    setOpenAiSettingsStatus(status.saved ? `Saved in macOS Keychain · ${status.hint}` : 'No API key saved yet.', status.saved ? 'success' : 'neutral');
    elements.removeOpenAiKeyButton.disabled = !status.saved;
    // Keeping these available means an unfinished setup explains itself instead
    // of looking like an unresponsive disabled button on the Release page.
    elements.generateAiDraftButton.disabled = false;
    elements.refreshAiDraftButton.disabled = false;
    const setupHint = status.saved ? '' : 'Save an OpenAI API key in Settings first.';
    elements.generateAiDraftButton.title = setupHint;
    elements.refreshAiDraftButton.title = setupHint;
  } catch (error) {
    state.openAiKeySaved = false;
    setOpenAiSettingsStatus(`Could not read macOS Keychain: ${error}`, 'error');
    elements.removeOpenAiKeyButton.disabled = true;
    elements.generateAiDraftButton.disabled = false;
    elements.refreshAiDraftButton.disabled = false;
  }
}

function setOpenAiSettingsStatus(message = '', tone = 'neutral') {
  elements.openAiSettingsStatus.textContent = message;
  elements.openAiSettingsStatus.dataset.tone = tone;
}

async function saveOpenAiKey() {
  if (!isDesktop()) return;
  const apiKey = elements.openAiApiKeyInput.value.trim();
  if (!apiKey) {
    setOpenAiSettingsStatus('Paste an API key before saving it.', 'error');
    return;
  }
  elements.saveOpenAiKeyButton.disabled = true;
  elements.saveOpenAiKeyButton.textContent = 'saving…';
  try {
    const status = await desktop.invoke('save_openai_api_key', { apiKey });
    // Trust only the native command's verified read-back result. Previously the
    // interface announced success even when the storage backend lost the key.
    state.openAiKeySaved = Boolean(status.saved);
    elements.openAiApiKeyInput.value = '';
    elements.openAiApiKeyInput.placeholder = status.saved ? `Saved in macOS Keychain · ${status.hint}` : 'Paste an OpenAI API key';
    elements.removeOpenAiKeyButton.disabled = !status.saved;
    if (!status.saved) throw new Error('macOS Keychain could not read the saved key back.');
    setOpenAiSettingsStatus(`API key saved securely in macOS Keychain · ${status.hint}. Drafting is ready.`, 'success');
  } catch (error) {
    state.openAiKeySaved = false;
    setOpenAiSettingsStatus(`API key could not be saved: ${error}`, 'error');
  } finally {
    elements.saveOpenAiKeyButton.disabled = false;
    elements.saveOpenAiKeyButton.textContent = 'save settings';
  }
}

async function removeOpenAiKey() {
  if (!isDesktop()) return;
  elements.removeOpenAiKeyButton.disabled = true;
  elements.removeOpenAiKeyButton.textContent = 'removing…';
  try {
    await desktop.invoke('remove_openai_api_key');
    await refreshOpenAiKeyStatus();
    setOpenAiSettingsStatus('API key removed from macOS Keychain.', 'neutral');
  } catch (error) {
    setOpenAiSettingsStatus(`API key could not be removed: ${error}`, 'error');
  } finally {
    elements.removeOpenAiKeyButton.textContent = 'remove key';
  }
}

// OpenAI credentials and model choice are app-wide settings, not project data.
// Opening the dialog always refreshes its Keychain status before it is shown.
async function openOpenAiSettingsDialog() {
  await refreshOpenAiKeyStatus();
  elements.openAiSettingsDialog.showModal();
  elements.openAiApiKeyInput.focus();
}

async function loadPreviousProjectsForDrafting() {
  const summaries = await desktop.invoke('list_projects');
  const candidates = summaries.filter((summary) => summary.id !== state.projectId);
  const projects = [];
  // Release libraries are normally small. Reading the project JSON here allows
  // the pure drafting helper to prefer same-artist examples accurately.
  for (const summary of candidates) {
    try { projects.push(await desktop.invoke('load_project', { id: summary.id })); } catch { /* One damaged old project should not block a new draft. */ }
  }
  return projects;
}

async function generateAiDraft(mode = 'draft') {
  if (!isDesktop() || state.generatingDraft) return;
  state.generatingDraft = true;
  try {
    // Re-check the shared Keychain setting at the moment the user drafts. This
    // avoids sending them back to Settings because of an old in-memory flag.
    if (!state.openAiKeySaved) await refreshOpenAiKeyStatus();
    if (!state.openAiKeySaved) {
      await openOpenAiSettingsDialog();
      setOpenAiSettingsStatus('Save an OpenAI API key to draft this release.', 'error');
      return;
    }
    if (!value('brainstormInput') && !value('longDescriptionInput')) {
      elements.brainstormHandoffStatus.textContent = 'Add brainstorm notes or some existing release information first.';
      return;
    }
    elements.generateAiDraftButton.disabled = true;
    elements.refreshAiDraftButton.disabled = true;
    elements.generateAiDraftButton.textContent = mode === 'refresh' ? 'refreshing copy…' : 'drafting copy…';
    elements.brainstormHandoffStatus.textContent = 'Reading the current release and previous writing style…';

    await waitForProjectSave();
    const project = serialiseProject();
    const previousProjects = await loadPreviousProjectsForDrafting();
    const request = buildAiDraftRequest({
      project,
      previousProjects,
      mode,
      model: value('openAiModelInput') || DEFAULT_OPENAI_MODEL,
    });
    elements.brainstormHandoffStatus.textContent = 'Drafting release copy with OpenAI…';
    const draft = await desktop.invoke('generate_release_copy', { request });
    const merged = mergeDraftIntoProject(serialiseProject(), draft, project);
    RELEASE_FIELD_IDS.forEach((id) => setValue(id, merged.fields?.[id] || ''));
    state.socialPosts = normaliseSocialPosts(merged.socialPosts, merged.fields);
    renderSocialPosts();
    markDirty();
    renderAll();
    await waitForProjectSave();
    elements.brainstormHandoffStatus.textContent = mode === 'refresh'
      ? 'Copy refreshed from the latest release information.'
      : 'Release copy drafted and saved. Review and edit every field as needed.';
  } catch (error) {
    elements.brainstormHandoffStatus.textContent = `Drafting failed: ${error}`;
  } finally {
    state.generatingDraft = false;
    elements.generateAiDraftButton.textContent = 'draft release copy';
    await refreshOpenAiKeyStatus();
  }
}

async function exportRelease(chooseDifferentLocation = false) {
  if (!isDesktop()) { elements.exportStatus.textContent = 'Export is available in the packaged desktop app.'; return; }
  const updatingExisting = !chooseDifferentLocation && Boolean(state.lastExportDir && state.lastExportFolderName);
  let outputDir = updatingExisting ? state.lastExportDir : '';
  if (!outputDir) outputDir = await desktop.open({ directory: true, multiple: false, title: 'Choose where to create the release package' });
  if (!outputDir) return;
  const folderName = updatingExisting ? state.lastExportFolderName : packageName();
  elements.exportReleaseButton.disabled = true; elements.quickExportButton.disabled = true; elements.chooseDifferentExportButton.disabled = true;
  elements.updateNonMusicButton.disabled = true;
  elements.exportReleaseButton.textContent = 'preparing release…'; elements.quickExportButton.textContent = 'preparing…';
  elements.exportStatus.className = 'export-status'; elements.exportStatus.textContent = 'Preparing tagged masters and highest-quality 320 kbps MP3 copies. Your originals will remain unchanged.';
  try {
    await ensureArtworkReady();
    const revisionAtExportStart = state.changeRevision;
    const data = releaseData();
    const request = {
      outputDir, folderName, artworkDataUrl: elements.artworkCanvas.toDataURL('image/png'),
      artworkFileName: `${safeStem(folderName)} - Cover.png`,
      webArtworkFileName: `${safeStem(folderName)} - Cover - Web.jpg`,
      release: { album: data.title, albumArtist: data.albumArtist, year: data.year, genre: data.genre, label: data.label, catalogue: data.catalogue, copyright: data.copyright, upc: data.upc },
      tracks: state.masters.map((track, index) => ({ id: track.id, path: track.path, outputFileName: outputFilename(track, index), metadata: { ...track.metadata, albumArtist: data.albumArtist, year: data.year, label: data.label, catalogue: data.catalogue, copyright: data.copyright } })),
      textFiles: packageTextFiles(outputDir, folderName),
    };
    const result = await desktop.invoke('export_release', { request });
    state.lastExportDir = outputDir; state.lastExportFolderName = folderName;
    const preparedTracks = Array.isArray(result.preparedTracks) ? result.preparedTracks : [];
    let inspectedTracks = [];
    let relinkWarning = '';

    if (preparedTracks.length) {
      stopMasterPreview();
      elements.exportStatus.textContent = 'Audio files created. Rechecking the prepared masters and saving their new links…';
      try {
        inspectedTracks = await desktop.invoke('inspect_audio', { paths: preparedTracks.map((track) => track.path) });
      } catch (error) {
        // The new paths are still safe to use when a metadata recheck fails.
        // Existing card details remain in place, and the warning asks the user
        // to keep their originals until they have checked the package.
        relinkWarning = `The prepared files were linked, but their metadata could not be rechecked: ${error}`;
      }

      // If anything was edited while a long encode was running, do not let
      // metadata written at export start replace those newer in-app changes.
      const safeInspection = state.changeRevision === revisionAtExportStart
        ? inspectedTracks
        : inspectedTracks.map((track) => ({ ...track, metadata: {} }));
      state.masters = relinkPreparedMasters(state.masters, preparedTracks, safeInspection);
      renderMasters(); updateProgress();
    }

    state.changeRevision += 1; state.dirty = true; clearTimeout(state.saveTimer);
    const saved = await waitForProjectSave(false);
    const isPartial = Boolean(result.failed || result.mp3Failed || relinkWarning || !saved);
    const preparedSummary = `${result.exported} prepared master${result.exported === 1 ? '' : 's'}`;
    const mp3Summary = `${result.mp3Exported} metadata-tagged 320 kbps MP3${result.mp3Exported === 1 ? '' : 's'}`;
    const webArtworkSize = `${(Number(result.webArtworkBytes || 0) / 1_000_000).toFixed(2)} MB`;
    const linkedSummary = preparedTracks.length ? ` ${preparedTracks.length} master card${preparedTracks.length === 1 ? '' : 's'} now use the prepared ${preparedTracks.length === 1 ? 'copy' : 'copies'}.` : '';
    const failureSummary = [
      result.failed ? `${result.failed} master${result.failed === 1 ? '' : 's'} could not be prepared.` : '',
      result.mp3Failed ? `${result.mp3Failed} MP3${result.mp3Failed === 1 ? '' : 's'} could not be created.` : '',
      result.message || '',
      relinkWarning,
      !saved ? 'The package exists, but the new master links could not be saved. Keep the originals available for now.' : '',
    ].filter(Boolean).join(' ');
    elements.exportStatus.className = isPartial ? 'export-status is-error' : 'export-status is-success';
    elements.exportStatus.textContent = `${updatingExisting ? 'Release package updated' : 'Release package created'} at ${result.destination}. ${preparedSummary}, ${mp3Summary}, and web artwork (${webArtworkSize}) created.${linkedSummary}${failureSummary ? ` ${failureSummary}` : ''}`;
  } catch (error) { elements.exportStatus.className = 'export-status is-error'; elements.exportStatus.textContent = `Export failed: ${error}`; }
  updateExportControls(); if (state.activeStage === 'review') renderReview();
}

function serialiseProject() {
  return {
    version: 10, albumTrackIds, id: state.projectId, name: value('projectNameInput') || packageName(), updatedAt: new Date().toISOString(),
    fields: Object.fromEntries(RELEASE_FIELD_IDS.map((id) => [id, byId(id).value])), masters: structuredClone(state.masters),
    socialPosts: state.socialPosts.map((post) => ({ ...post })),
    artwork: { backgroundDataUrl: state.backgroundDataUrl, backgroundName: state.backgroundName, logoDataUrl: state.logoDataUrl, logoName: state.logoName, logoIsPlaceholder: state.logoIsPlaceholder, settings: artworkSettings() },
    video: normaliseVideoSettings(state.videoSettings),
    canvases: normaliseCanvasSettings(state.canvasSettings),
    exportState: { outputDir: state.lastExportDir, folderName: state.lastExportFolderName },
    artistPresetId: state.activeArtistPresetId,
  };
}

async function saveProject(automatic = false, syncExport = true) {
  if (host) {
    const revision = state.changeRevision;
    try {
      const summary = await host.save(serialiseProject(), boundGeneration);
      state.projectId = summary.id;
      if (revision === state.changeRevision) { state.dirty = false; elements.saveStatus.className = 'save-status is-saved'; elements.saveStatus.textContent = 'Saved with album'; }
      return true;
    } catch (error) { elements.saveStatus.className = 'save-status is-error'; elements.saveStatus.textContent = `Save failed: ${error}`; return false; }
  }
  if (state.saving) { state.saveQueued = true; return false; }
  state.saving = true;
  const revisionBeingSaved = state.changeRevision;
  const project = serialiseProject();
  let saved = false;
  try {
    if (isDesktop()) {
      const summary = await desktop.invoke('save_project', { project }); state.projectId = summary.id;
    } else {
      state.projectId ||= `release-${Date.now()}`; project.id = state.projectId; localStorage.setItem(`release-preparer-project-${state.projectId}`, JSON.stringify(project));
    }
    saved = true;
    if (revisionBeingSaved === state.changeRevision) {
      state.dirty = false; elements.saveStatus.className = 'save-status is-saved'; elements.saveStatus.innerHTML = `<i></i> ${automatic ? 'autosaved' : 'saved'}`;
      // Once a package exists, saving the newest revision also keeps its
      // generated copy current without running the audio export again.
      if (syncExport && isDesktop() && state.lastExportDir && state.lastExportFolderName && !state.updatingNonMusic) {
        void updateNonMusicFiles(true);
      }
    }
    await renderSavedProjects();
  } catch (error) { elements.saveStatus.className = 'save-status is-error'; elements.saveStatus.innerHTML = '<i></i> save failed'; console.error(error); }
  finally {
    state.saving = false;
    if (state.saveQueued) { state.saveQueued = false; saveProject(true); }
  }
  return saved;
}

function renderRecentReleases(summaries) {
  elements.recentReleasesList.replaceChildren();
  if (!summaries.length) { const empty = document.createElement('span'); empty.className = 'recent-empty'; empty.textContent = 'Saved releases will appear here.'; elements.recentReleasesList.append(empty); return; }
  summaries.slice(0, 5).forEach((summary) => {
    const row = document.createElement('div'); row.className = 'recent-release-row';
    const button = document.createElement('button'); button.className = 'recent-release-button'; button.classList.toggle('is-current', summary.id === state.projectId);
    const name = document.createElement('strong'); name.textContent = summary.name || 'Untitled release';
    const date = document.createElement('small'); const savedAt = new Date(summary.updatedAt); date.textContent = Number.isNaN(savedAt.getTime()) ? 'saved release' : `edited ${savedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'recent-delete-button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Delete ${summary.name || 'release'}`);
    remove.addEventListener('click', async () => {
      if (remove.dataset.confirm !== 'true') {
        remove.dataset.confirm = 'true'; remove.textContent = 'sure?'; remove.classList.add('is-confirming');
        remove.setAttribute('aria-label', `Press again to delete ${summary.name || 'release'}`); return;
      }
      await deleteRecentProject(summary.id);
    });
    button.append(name, date); button.addEventListener('click', () => loadProject(summary.id)); row.append(button, remove); elements.recentReleasesList.append(row);
  });
}

async function deleteRecentProject(id) {
  try {
    if (isDesktop()) await desktop.invoke('delete_project', { id });
    else localStorage.removeItem(`release-preparer-project-${id}`);
    if (state.projectId === id) await newProject(false);
    else await renderSavedProjects();
  } catch (error) { alert(`Could not delete that release: ${error}`); }
}

async function renderSavedProjects() {
  if (host) return;
  let summaries = [];
  if (isDesktop()) summaries = await desktop.invoke('list_projects');
  else summaries = Object.keys(localStorage).filter((key) => key.startsWith('release-preparer-project-')).map((key) => { try { const project = JSON.parse(localStorage.getItem(key)); return { id: project.id, name: project.name, updatedAt: project.updatedAt }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  elements.savedProjectSelect.replaceChildren(new Option('saved releases', ''));
  summaries.forEach((summary) => elements.savedProjectSelect.add(new Option(summary.name, summary.id)));
  elements.savedProjectSelect.value = state.projectId || '';
  syncCustomSelect(elements.savedProjectSelect);
  renderRecentReleases(summaries);
}

async function loadProject(id, supplied = null) {
  if (!id && !supplied) return;
  try {
    const project = supplied || (isDesktop() ? await desktop.invoke('load_project', { id }) : JSON.parse(localStorage.getItem(`release-preparer-project-${id}`)));
    await newProject(false); state.projectId = project.id; setValue('projectNameInput', project.name || 'Untitled release');
    RELEASE_FIELD_IDS.forEach((fieldId) => setValue(fieldId, project.fields?.[fieldId] || '')); byId('releaseTitleInput').dataset.previousTitle = value('releaseTitleInput');
    // Very early project files predate stable master IDs. Supplying one here
    // lets those releases use safe prepared-file relinking after export.
    state.masters = normaliseLeadSingles((project.masters || []).map((track) => ({ ...track, id: track.id || crypto.randomUUID() })));
    // Version 4 and earlier kept five fixed social fields. Convert them into the expandable list without losing any copy.
    state.socialPosts = normaliseSocialPosts(project.socialPosts, project.fields);
    state.backgroundDataUrl = project.artwork?.backgroundDataUrl || ''; state.backgroundName = project.artwork?.backgroundName || '';
    state.backgroundPositioning = false; state.backgroundDrag = null; state.backgroundRenderedBounds = null;
    state.logoDataUrl = project.artwork?.logoDataUrl || DEFAULT_MARK; state.logoName = project.artwork?.logoName || 'Placeholder logo';
    state.logoIsPlaceholder = project.artwork?.logoIsPlaceholder ?? (!project.artwork?.logoDataUrl || project.artwork?.logoDataUrl === DEFAULT_MARK); setArtworkSettings(project.artwork?.settings || {});
    state.videoSettings = normaliseVideoSettings(project.video);
    applyVideoSettingsToControls();
    state.canvasSettings = normaliseCanvasSettings(project.canvases);
    state.canvasPositioning = false; state.canvasDrag = null; state.canvasRenderedBounds = null; state.canvasPreviewStartedAt = performance.now();
    state.canvasPreviewMode = 'normal'; state.canvasEventSchedule = null; state.canvasCompressedPreviewPath = ''; hideCompressedCanvasPreview();
    elements.canvasPreviewCanvas.classList.remove('is-positioning'); elements.canvasPositionButton.textContent = 'reposition image';
    applyCanvasSettingsToControls();
    // A saved release owns its current video values; do not imply that merely
    // opening it reapplied the default template.
    elements.videoPresetSelect.value = ''; setValue('videoPresetNameInput', ''); syncCustomSelect(elements.videoPresetSelect); updateVideoTemplateActions();
    state.lastExportDir = project.exportState?.outputDir || ''; state.lastExportFolderName = project.exportState?.folderName || '';
    state.activeArtistPresetId = project.artistPresetId || ''; renderArtistPresets();
    elements.exportStatus.textContent = '';
    state.changeRevision = 0; state.dirty = false; elements.saveStatus.className = 'save-status is-saved'; elements.saveStatus.innerHTML = '<i></i> saved'; renderSocialPosts(); renderAll(); await renderSavedProjects();
  } catch (error) { if (host) throw error; alert(`Could not load that release: ${error}`); }
}

async function newProject(confirmFirst = true) {
  if (confirmFirst && state.dirty && !confirm('Start a new release and leave the current unsaved changes?')) return;
  clearTimeout(state.saveTimer); stopMasterPreview(); state.projectId = null; state.masters = []; state.backgroundDataUrl = ''; state.backgroundName = '';
  state.backgroundPositionX = 50; state.backgroundPositionY = 50; state.backgroundPositioning = false; state.backgroundRenderedBounds = null; state.backgroundDrag = null;
  state.logoDataUrl = DEFAULT_MARK; state.logoName = 'Placeholder logo'; state.logoIsPlaceholder = true; state.lastExportDir = ''; state.lastExportFolderName = ''; state.activeArtistPresetId = ''; state.changeRevision = 0; state.dirty = false;
  state.socialPosts = normaliseSocialPosts();
  state.videoSettings = settingsForNewVideoProject(); clearVisualPreviewMedia(); applyVideoSettingsToControls();
  state.canvasSettings = defaultCanvasSettings(); state.canvasPositioning = false; state.canvasDrag = null; state.canvasRenderedBounds = null; state.canvasPreviewStartedAt = performance.now();
  state.canvasPreviewMode = 'normal'; state.canvasEventSchedule = null; state.canvasCompressedPreviewPath = ''; hideCompressedCanvasPreview();
  elements.canvasPreviewCanvas.classList.remove('is-positioning'); elements.canvasPositionButton.textContent = 'reposition image'; applyCanvasSettingsToControls();
  renderVideoPresets(); showDefaultVideoPresetSelection();
  setValue('projectNameInput', 'Untitled release'); RELEASE_FIELD_IDS.forEach((id) => setValue(id, id === 'filenamePatternInput' ? '{track} - {artist} - {title}' : '')); byId('releaseTitleInput').dataset.previousTitle = ''; setArtworkSettings({});
  elements.saveStatus.className = 'save-status'; elements.saveStatus.innerHTML = '<i></i> not saved'; elements.exportStatus.textContent = ''; elements.brainstormHandoffStatus.textContent = ''; renderArtistPresets(); renderSocialPosts(); showStage('release'); renderAll(); await renderSavedProjects();
}

function renderAll() {
  elements.shortDescriptionCount.textContent = String(value('shortDescriptionInput').length);
  renderMasters(); updateArtworkReadouts(); drawArtwork(); updateCopyPreview(); updateProgress(); updateCanvasControls(); updateExportControls();
  if (state.activeStage === 'review') renderReview();
}

function wireEvents() {
  document.querySelectorAll('.stage-button').forEach((button) => button.addEventListener('click', () => showStage(button.dataset.stage)));
  const copyTabs = Array.from(document.querySelectorAll('.copy-tab'));
  copyTabs.forEach((button) => button.addEventListener('click', () => showCopyTab(button)));
  bindTabNavigation(copyTabs, showCopyTab);
  bindTabNavigation([elements.showTrackVideosButton, elements.showCanvasesButton], (button) => showVideoPanel(button === elements.showCanvasesButton ? 'canvases' : 'tracks'));
  RELEASE_FIELD_IDS.forEach((id) => byId(id).addEventListener('input', () => {
    if (id === 'brainstormInput') {
      markDirty();
      elements.brainstormHandoffStatus.textContent = '';
      return;
    }
    if (id === 'releaseTitleInput') {
      const previousTitle = byId(id).dataset.previousTitle || '';
      const currentProjectName = value('projectNameInput');
      if (!currentProjectName || currentProjectName === 'Untitled release' || currentProjectName === previousTitle) setValue('projectNameInput', value(id) || 'Untitled release');
      byId(id).dataset.previousTitle = value(id);
    }
    markDirty(); renderAll();
  }));
  elements.projectNameInput.addEventListener('input', markDirty);
  ARTWORK_FIELD_IDS.forEach((id) => byId(id).addEventListener('input', () => { updateArtworkReadouts(); markDirty(); drawArtwork(); updateProgress(); }));
  elements.chooseMastersButton.addEventListener('click', chooseMasters); elements.mastersDropzone.addEventListener('click', chooseMasters);
  elements.chooseBackgroundButton.addEventListener('click', () => chooseImage('background')); elements.backgroundPositionButton.addEventListener('click', toggleBackgroundPositioning);
  elements.artworkCanvas.addEventListener('pointerdown', beginBackgroundDrag); elements.artworkCanvas.addEventListener('pointermove', moveBackgroundDrag);
  elements.artworkCanvas.addEventListener('pointerup', endBackgroundDrag); elements.artworkCanvas.addEventListener('pointercancel', endBackgroundDrag);
  elements.chooseLogoButton.addEventListener('click', () => chooseImage('logo'));
  elements.useDefaultMarkButton.addEventListener('click', () => { state.logoDataUrl = DEFAULT_MARK; state.logoName = 'Placeholder logo'; state.logoIsPlaceholder = true; markDirty(); updateArtworkReadouts(); drawArtwork(); updateProgress(); });
  elements.saveArtworkPresetButton.addEventListener('click', saveArtworkPreset); elements.saveArtworkPresetAsNewButton.addEventListener('click', saveArtworkPresetAsNew);
  elements.artworkPresetSelect.addEventListener('change', applyArtworkPreset);
  elements.duplicateArtworkPresetButton.addEventListener('click', duplicateArtworkPreset); elements.deleteArtworkPresetButton.addEventListener('click', deleteArtworkPreset);
  elements.copyTextButton.addEventListener('click', copyCurrentText); elements.exportReleaseButton.addEventListener('click', () => exportRelease(false));
  elements.updateNonMusicButton.addEventListener('click', () => updateNonMusicFiles(false));
  elements.quickExportButton.addEventListener('click', () => exportRelease(false)); elements.chooseDifferentExportButton.addEventListener('click', () => exportRelease(true));
  elements.saveProjectButton.addEventListener('click', () => saveProject(false)); elements.newProjectButton.addEventListener('click', () => newProject(true)); elements.savedProjectSelect.addEventListener('change', (event) => loadProject(event.target.value));
  elements.appSettingsButton.addEventListener('click', openOpenAiSettingsDialog);
  elements.tipsButton.addEventListener('click', toggleTips);
  elements.closeOpenAiSettingsDialogButton.addEventListener('click', () => elements.openAiSettingsDialog.close());
  elements.openAiSettingsDialog.addEventListener('click', (event) => { if (event.target === elements.openAiSettingsDialog) elements.openAiSettingsDialog.close(); });
  elements.saveOpenAiKeyButton.addEventListener('click', saveOpenAiKey);
  elements.removeOpenAiKeyButton.addEventListener('click', removeOpenAiKey);
  elements.generateAiDraftButton.addEventListener('click', () => generateAiDraft('draft'));
  elements.refreshAiDraftButton.addEventListener('click', () => generateAiDraft('refresh'));
  elements.openAiModelInput.addEventListener('input', () => {
    // The model is a preference for the whole app, so it is intentionally not
    // included in serialiseProject() or any release JSON file.
    localStorage.setItem('release-preparer-openai-model', elements.openAiModelInput.value);
    setOpenAiSettingsStatus('Model saved for future releases.', 'success');
  });
  elements.addSocialPostButton.addEventListener('click', addSocialPost);
  elements.useArtworkForegroundButton.addEventListener('click', () => useArtworkForVideoLayer('foreground'));
  elements.chooseVideoForegroundButton.addEventListener('click', () => chooseVideoLayer('foreground'));
  elements.useArtworkBackgroundButton.addEventListener('click', () => useArtworkForVideoLayer('background'));
  elements.chooseVideoBackgroundButton.addEventListener('click', () => chooseVideoLayer('background'));
  elements.playVideoPreviewButton.addEventListener('click', toggleVideoPreview);
  elements.exportTrackVideosButton.addEventListener('click', exportTrackVideos);
  elements.cancelTrackVideosButton.addEventListener('click', cancelTrackVideos);
  elements.showTrackVideosButton.addEventListener('click', () => showVideoPanel('tracks'));
  elements.showCanvasesButton.addEventListener('click', () => showVideoPanel('canvases'));
  elements.useArtworkCanvasButton.addEventListener('click', useArtworkForCanvas);
  elements.chooseCanvasImageButton.addEventListener('click', chooseCanvasImage);
  elements.playCanvasPreviewButton.addEventListener('click', toggleCanvasPreview);
  elements.canvasSeamPreviewButton.addEventListener('click', toggleCanvasSeamPreview);
  elements.canvasCompressedPreviewButton.addEventListener('click', previewCompressedCanvas);
  elements.canvasPositionButton.addEventListener('click', toggleCanvasPositioning);
  elements.regenerateCanvasButton.addEventListener('click', regenerateCanvasVariation);
  elements.resetCanvasDefaultsButton.addEventListener('click', resetCanvasDefaults);
  elements.canvasPreviewCanvas.addEventListener('pointerdown', beginCanvasDrag);
  elements.canvasPreviewCanvas.addEventListener('pointermove', moveCanvasDrag);
  elements.canvasPreviewCanvas.addEventListener('pointerup', endCanvasDrag);
  elements.canvasPreviewCanvas.addEventListener('pointercancel', endCanvasDrag);
  elements.exportCanvasesButton.addEventListener('click', exportCanvases);
  elements.cancelCanvasesButton.addEventListener('click', cancelCanvases);
  elements.canvasPresetInput.addEventListener('change', selectCanvasPreset);
  elements.videoPresetSelect.addEventListener('change', applyVideoPreset);
  elements.saveVideoPresetButton.addEventListener('click', saveVideoPreset);
  elements.saveVideoPresetAsNewButton.addEventListener('click', saveVideoPresetAsNew);
  elements.duplicateVideoPresetButton.addEventListener('click', duplicateVideoPreset);
  elements.deleteVideoPresetButton.addEventListener('click', deleteVideoPreset);
  elements.defaultVideoPresetInput.addEventListener('change', updateDefaultVideoPreset);
  [
    'videoBackgroundMatchesInput', 'videoForegroundSizeInput', 'videoForegroundShadowEnabledInput', 'videoForegroundShadowIntensityInput', 'videoBackgroundBlurInput', 'videoBackgroundOpacityInput',
    'videoLogoEnabledInput', 'videoLogoOpacityInput', 'videoLogoSizeInput', 'videoLogoXInput', 'videoLogoYInput',
  ].forEach((id) => byId(id).addEventListener('input', () => {
    readVideoControlValues(); updateVideoControls(); markDirty(); drawVideoPreview(); updateProgress();
  }));
  [
    'canvasCompositionModeInput', 'canvasBackgroundTreatmentInput', 'canvasBackgroundColorInput', 'canvasImageScaleInput', 'canvasSafeAreaInput', 'canvasFilmFormatInput', 'canvasFilmConditionInput', 'canvasSeedInput',
    'canvasIntensityInput', 'canvasGrainAmountInput', 'canvasGrainSizeInput', 'canvasGrainClumpingInput', 'canvasExposureFlickerInput', 'canvasColourInstabilityInput',
    'canvasHorizontalWeaveInput', 'canvasVerticalJitterInput', 'canvasRotationInput', 'canvasScaleBreathingInput', 'canvasOpticalSoftnessInput', 'canvasHalationInput',
    'canvasVignetteInput', 'canvasMonochromeInput', 'canvasDustAmountInput', 'canvasScratchProbabilityInput', 'canvasScratchPersistenceInput', 'canvasHairProbabilityInput',
    'canvasDamageProbabilityInput', 'canvasLightLeakProbabilityInput', 'canvasCueMarksInput', 'canvasDurationInput', 'canvasFilmFrameRateInput', 'canvasOutputFrameRateInput', 'canvasExportModeInput',
  ].forEach((id) => byId(id).addEventListener('input', () => {
    readCanvasControlValues(); invalidateCanvasVariation(); updateCanvasControls(); markDirty(); drawCanvasPreview();
  }));
  elements.artistPresetSelect.addEventListener('change', () => {
    const preset = readArtistPresets().find((item) => item.id === elements.artistPresetSelect.value);
    if (preset) applyArtistPreset(preset);
  });
  elements.manageArtistPresetsButton.addEventListener('click', openArtistPresetDialog);
  elements.closeArtistPresetDialogButton.addEventListener('click', () => elements.artistPresetDialog.close());
  elements.artistPresetDialog.addEventListener('click', (event) => { if (event.target === elements.artistPresetDialog) elements.artistPresetDialog.close(); });
  elements.artistPresetEditorSelect.addEventListener('change', () => {
    const preset = readArtistPresets().find((item) => item.id === elements.artistPresetEditorSelect.value);
    if (preset) fillArtistPresetEditor(preset); else fillArtistPresetEditor();
    updateArtistPresetActions();
  });
  elements.newArtistPresetButton.addEventListener('click', clearArtistPresetEditor);
  elements.saveArtistPresetButton.addEventListener('click', saveArtistPreset);
  elements.saveArtistPresetAsNewButton.addEventListener('click', saveArtistPresetAsNew);
  elements.applyArtistPresetButton.addEventListener('click', applyArtistPresetFromEditor);
  elements.deleteArtistPresetButton.addEventListener('click', deleteArtistPreset);
  elements.themeButton.addEventListener('click', () => { const themes = ['day', 'night', 'nautical']; const current = document.documentElement.dataset.theme || 'day'; const next = themes[(themes.indexOf(current) + 1) % themes.length]; document.documentElement.dataset.theme = next; localStorage.setItem('release-preparer-theme', next); });
  window.addEventListener('beforeunload', (event) => { if (!host && state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'ended'].forEach((eventName) => masterPreviewAudio.addEventListener(eventName, updateMasterPlaybackControls));
  masterPreviewAudio.addEventListener('error', () => {
    if (state.previewTrackId) showMasterPlaybackError(state.previewTrackId, 'This master could not be played in the app.');
    updateMasterPlaybackControls();
  });
}

function trackOperation(operation, onError) {
  return async (...args) => {
    preparationOperations += 1;
    try { return await operation(...args); }
    catch (error) { if (onError) onError(error); else throw error; }
    finally { preparationOperations -= 1; }
  };
}
function exclusiveExport(key, operation, status, refresh) {
  return trackOperation(async (...args) => {
    if (exportOperations.has(key)) return;
    exportOperations.add(key);
    refresh();
    try { return await operation(...args); }
    catch (error) { status.className = 'is-error'; status.textContent = `Export failed: ${error}`; }
    finally { exportOperations.delete(key); refresh(); }
  });
}
chooseMasters = trackOperation(chooseMasters, (error) => { elements.masterIssueCount.textContent = `Could not select masters: ${error}`; });
chooseImage = trackOperation(chooseImage, (error) => alert(`Could not select that image: ${error}`));
chooseVideoLayer = trackOperation(chooseVideoLayer, (error) => { elements.videoPreviewStatus.textContent = `Could not select a visual: ${error}`; });
chooseCanvasImage = trackOperation(chooseCanvasImage, (error) => { elements.canvasPreviewStatus.textContent = `Could not select an image: ${error}`; });
exportRelease = exclusiveExport('release', exportRelease, elements.exportStatus, updateExportControls);
exportTrackVideos = exclusiveExport('video', exportTrackVideos, elements.videoExportStatus, updateVideoControls);
exportCanvases = exclusiveExport('canvas', exportCanvases, elements.canvasExportStatus, updateCanvasControls);
previewCompressedCanvas = exclusiveExport('canvas', previewCompressedCanvas, elements.canvasExportStatus, updateCanvasControls);

async function start() {
  await initialiseDesktopBridge(); document.documentElement.dataset.theme = host?.theme() || localStorage.getItem('release-preparer-theme') || 'day';
  setTipsVisible(localStorage.getItem(TIPS_PREFERENCE_KEY) !== 'false');
  setValue('openAiModelInput', localStorage.getItem('release-preparer-openai-model') || DEFAULT_OPENAI_MODEL);
  state.videoSettings = settingsForNewVideoProject();
  state.canvasSettings = defaultCanvasSettings();
  if (host) {
    const presets = readArtistPresets(); let added = false;
    for (const legacy of host.linkPresets()) {
      const id = `album-links-${legacy.id}`;
      if (presets.some(preset => preset.id === id)) continue;
      presets.push(normaliseArtistPreset({ id, name: legacy.name, ...Object.fromEntries(Object.entries(legacy.links || {}).map(([key, value]) => [key === 'website' ? 'websiteUrl' : `${key}Url`, value])) })); added = true;
    }
    if (added) writeArtistPresets(presets);
  }
  wireEvents(); enhanceSelects(); bindEditableRangeValues(); renderArtistPresets(); renderArtworkPresets(); renderVideoPresets(); showDefaultVideoPresetSelection(); renderSocialPosts(); applyVideoSettingsToControls(); applyCanvasSettingsToControls(); showVideoPanel('tracks'); await renderSavedProjects(); if (!host) await refreshOpenAiKeyStatus(); renderAll();
  // This compact control belongs with the naming rule and avoids overwriting imported tags without permission.
  const syncButton = document.createElement('button'); syncButton.className = 'text-button bordered'; syncButton.textContent = 'apply release artist, album + sequence'; syncButton.addEventListener('click', syncReleaseToMasters);
  document.querySelector('.naming-row').append(syncButton);
  if (host) {
    byId('useAlbumSequenceButton').addEventListener('click', () => host.syncSequence().catch(error => { elements.masterIssueCount.textContent = String(error); }));
    window.albumPreparation = {
      async hydrate(project, generation) {
        applyingAlbum = true;
        try { await loadProject(project.id, project); albumTrackIds = project.albumTrackIds || []; boundGeneration = generation; }
        finally { applyingAlbum = false; }
      },
      snapshot: serialiseProject,
      revision: () => state.changeRevision,
      busy: () => Boolean(applyingAlbum || preparationOperations || state.generatingDraft || state.videoExportActiveId || state.canvasExportActiveId || state.updatingNonMusic),
      pause() { previewsSuspended = true; stopMasterPreview(); pauseVisualPreviews(); },
      resume: resumePreviews,
      theme(theme) { document.documentElement.dataset.theme = theme; },
      async saved(id, generation, revision) {
        if (applyingAlbum || generation !== boundGeneration || revision !== state.changeRevision) return false;
        state.projectId = id; state.dirty = false; elements.saveStatus.textContent = 'Saved with album';
        if (state.lastExportDir && state.lastExportFolderName && !state.updatingNonMusic) await updateNonMusicFiles(true);
        return true;
      },
      export: () => showStage('review'),
    };
    await host.ready(window.albumPreparation);
  }
}

start().catch((error) => { console.error(error); elements.saveStatus.className = 'save-status is-error'; elements.saveStatus.innerHTML = '<i></i> startup error'; });
