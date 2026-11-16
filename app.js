import { analysisKey, validWaveform, packSpectrum, unpackSpectrum, fitSpectrum } from './analysis-cache.js';
import { albumFromPreparation, preparationForAlbum, sharedFieldsFromPreparation, validatePreparation } from './release-preparation-data.js';
// The standards-based analyser is bundled before this interface code executes.
import './loudness.js';
import { normaliseProject, readBrowserProjects } from './project-data.js';
// Vite includes these Markdown files as text, giving the app and repository one shared legal source.
import privacyPolicy from './PRIVACY.md?raw';
import termsOfUse from './TERMS.md?raw';
// The report helper adds a local Copy button when an operation fails.
import { createErrorReporter } from './error-reports.js';
import { sanitizeNoteHtml, readNoteHtml } from './note-sanitizer.js';

/*
  Album Builder is a local-first application. This file owns the visible album
  session: imported demos, their simple comparison analysis, sequencing, saved
  project details, and playback. The Rust desktop layer only handles durable
  saving and export work that a web page cannot safely do on its own.
*/

// Tauri is loaded only inside the packaged desktop app. This keeps the visual prototype usable in a browser too.
const desktop = {};
async function initialiseDesktopBridge() {
  if (!(window.__TAURI__ || window.__TAURI_INTERNALS__)) return;
  const [core, dialog, webview, app, appWindow, events] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/webview'),
    import('@tauri-apps/api/app'),
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/event'),
  ]);
  desktop.invoke = core.invoke;
  desktop.convertFileSrc = core.convertFileSrc;
  desktop.open = dialog.open;
  desktop.getCurrentWebview = webview.getCurrentWebview;
  desktop.getVersion = app.getVersion;
  desktop.window = appWindow.getCurrentWindow();
  desktop.listen = events.listen;
}

const state = {
  projectId: null,
  // Each opened album gets a new generation, so old async work cannot publish into it.
  sessionGeneration: 0,
  savePromise: null,
  pendingEdits: new Set(),
  libraryRequest: 0,
  exporting: false,
  // This flag keeps an opened archived album in its archived collection when autosave runs.
  isProjectArchived: false,
  tracks: [],
  materials: [],
  references: [],
  albumNoteEntries: [],
  currentTrackId: null,
  currentReferenceId: null,
  currentStart: 0,
  isAlbumMode: false,
  replacingTrackId: null,
  draggingId: null,
  dragTargetIndex: null,
  loadingProjectId: null,
  artworkDataUrl: null,
  artworkNativePath: null,
  // Every edit increments this number so an older save can never incorrectly claim newer changes are already stored.
  saveRevision: 0,
  hasUnsavedChanges: false,
  autoSaveTimer: null,
  isSaving: false,
  history: [],
  historyIndex: -1,
  restoringHistory: false,
  meterAnimation: null,
  meterLevel: 0,
  playbackVisualFrame: null,
  outputRefreshRequested: false,
  statusTimer: null,
  preparation: null,
  releaseCopy: { presetId: '', links: {} },
  albumSpectrogram: null,
  albumSpectrogramSignature: '',
  spectrogramLoading: false,
  // Focused listening only needs a small temporary note target while its composer is open.
  isTrackedNotesView: false,
  trackedNoteDraft: null,
  noteTakingTracksCollapsed: false,
  // Transition placements are lightweight instructions: which source plays,
  // which of the three lanes it occupies, and where its fades begin and end.
  transitionPlacements: [],
  transitionSelectedId: null,
  transitionPlayhead: 0,
  transitionIsPlaying: false,
  transitionStartedAt: 0,
  transitionAnimation: null,
  transitionZoom: 1,
  transitionDrag: null,
  // The modal stays locked until a packaged copy has a current local activation.
  licenseGateLocked: false,
  licenseStatus: null,
};

const elements = {
  audioInput: document.querySelector('#audioInput'), chooseFilesButton: document.querySelector('#chooseFilesButton'), dropZone: document.querySelector('#dropZone'),
  trackList: document.querySelector('#trackList'), trackTemplate: document.querySelector('#trackTemplate'), albumWaveform: document.querySelector('#albumWaveform'),
  albumEmpty: document.querySelector('#albumEmpty'), albumRuler: document.querySelector('#albumRuler'),
  transportAlbumStartButton: document.querySelector('#transportAlbumStartButton'), transportRestartButton: document.querySelector('#transportRestartButton'), transportPlayButton: document.querySelector('#transportPlayButton'), transportPauseButton: document.querySelector('#transportPauseButton'), transportNextButton: document.querySelector('#transportNextButton'),
  replaceAudioInput: document.querySelector('#replaceAudioInput'),
  audioPlayer: document.querySelector('#audioPlayer'), audioPreloader: document.querySelector('#audioPreloader'), albumName: document.querySelector('#albumName'), albumTitle: document.querySelector('#albumTitle'),
  albumSummary: document.querySelector('#albumSummary'), runtimeMetric: document.querySelector('#runtimeMetric'), trackMetric: document.querySelector('#trackMetric'),
  lufsMetric: document.querySelector('#lufsMetric'), peakMetric: document.querySelector('#peakMetric'), trackCount: document.querySelector('#trackCount'),
  trackInstruction: document.querySelector('#trackInstruction'), nowPlaying: document.querySelector('#nowPlaying'), positionReadout: document.querySelector('#positionReadout'), trackListPositionReadout: document.querySelector('#trackListPositionReadout'),
  levelMeterFill: document.querySelector('#levelMeterFill'), albumVolume: document.querySelector('#albumVolume'),
  transitionTimeline: document.querySelector('#transitionTimeline'), transitionScroll: document.querySelector('#transitionScroll'), transitionPlayhead: document.querySelector('#transitionPlayhead'), transitionEmpty: document.querySelector('#transitionEmpty'),
  transitionStartButton: document.querySelector('#transitionStartButton'), transitionPlayButton: document.querySelector('#transitionPlayButton'), transitionPauseButton: document.querySelector('#transitionPauseButton'), transitionReadout: document.querySelector('#transitionReadout'), transitionZoom: document.querySelector('#transitionZoom'),
  transitionInspector: document.querySelector('#transitionInspector'), transitionSelectedName: document.querySelector('#transitionSelectedName'), transitionSelectedStart: document.querySelector('#transitionSelectedStart'), transitionLaneSelect: document.querySelector('#transitionLaneSelect'), transitionFadeIn: document.querySelector('#transitionFadeIn'), transitionFadeInValue: document.querySelector('#transitionFadeInValue'), transitionFadeOut: document.querySelector('#transitionFadeOut'), transitionFadeOutValue: document.querySelector('#transitionFadeOutValue'), transitionAddOverlayButton: document.querySelector('#transitionAddOverlayButton'), transitionRemoveOverlayButton: document.querySelector('#transitionRemoveOverlayButton'), transitionOverlayInput: document.querySelector('#transitionOverlayInput'),
  transitionPlayers: [document.querySelector('#transitionPlayer1'), document.querySelector('#transitionPlayer2'), document.querySelector('#transitionPlayer3')],
  albumSpectrogramPanel: document.querySelector('#albumSpectrogramPanel'), albumSpectrogram: document.querySelector('#albumSpectrogram'), albumSpectrogramEmpty: document.querySelector('#albumSpectrogramEmpty'),
  artworkInput: document.querySelector('#artworkInput'), artworkButton: document.querySelector('#artworkButton'), artworkPreview: document.querySelector('#artworkPreview'),
  artworkClearButton: document.querySelector('#artworkClearButton'),
  themeButton: document.querySelector('#themeButton'), tipsButton: document.querySelector('#tipsButton'), artBlurButton: document.querySelector('#artBlurButton'), artBlurControl: document.querySelector('#artBlurControl'), artBlurAdjustButton: document.querySelector('#artBlurAdjustButton'), artBlurOpacity: document.querySelector('#artBlurOpacity'), releaseCopyButton: document.querySelector('#releaseCopyButton'), returnToAlbumButton: document.querySelector('#returnToAlbumButton'), releaseCopyView: document.querySelector('#releaseCopyView'), releaseCopyTitle: document.querySelector('#releaseCopyTitle'), trackedNotesButton: document.querySelector('#trackedNotesButton'), trackedNotesView: document.querySelector('#trackedNotesView'), trackedNotesArtwork: document.querySelector('#trackedNotesArtwork'), trackedNotesArtworkEmpty: document.querySelector('#trackedNotesArtworkEmpty'), noteTakingProgress: document.querySelector('#noteTakingProgress'), noteTakingTracksPanel: document.querySelector('#noteTakingTracksPanel'), noteTakingTracksToggle: document.querySelector('#noteTakingTracksToggle'), noteTakingTrackList: document.querySelector('#noteTakingTrackList'), noteTakingBackButton: document.querySelector('#noteTakingBackButton'), noteTakingAlbumStartButton: document.querySelector('#noteTakingAlbumStartButton'), noteTakingRestartButton: document.querySelector('#noteTakingRestartButton'), noteTakingPlayButton: document.querySelector('#noteTakingPlayButton'), noteTakingPauseButton: document.querySelector('#noteTakingPauseButton'), noteTakingNextButton: document.querySelector('#noteTakingNextButton'), trackedNotesMakeButton: document.querySelector('#trackedNotesMakeButton'), trackedNoteComposer: document.querySelector('#trackedNoteComposer'), trackedNoteContext: document.querySelector('#trackedNoteContext'), trackedNoteInput: document.querySelector('#trackedNoteInput'),
  exportProjectButton: document.querySelector('#exportProjectButton'), newAlbumButton: document.querySelector('#newAlbumButton'), savedAlbums: document.querySelector('#savedAlbums'), archivedAlbums: document.querySelector('#archivedAlbums'),
  materialsList: document.querySelector('#materialsList'), materialTemplate: document.querySelector('#materialTemplate'), materialCount: document.querySelector('#materialCount'),
  artistInput: document.querySelector('#artistInput'), albumArtistInput: document.querySelector('#albumArtistInput'), yearInput: document.querySelector('#yearInput'), genreInput: document.querySelector('#genreInput'), composerInput: document.querySelector('#composerInput'), discNumberInput: document.querySelector('#discNumberInput'), labelInput: document.querySelector('#labelInput'), catalogueInput: document.querySelector('#catalogueInput'), commentInput: document.querySelector('#commentInput'), compilationInput: document.querySelector('#compilationInput'),
  albumNotesInput: document.querySelector('#albumNotesInput'), albumNotesToolbar: document.querySelector('#albumNotesToolbar'), saveAlbumNoteButton: document.querySelector('#saveAlbumNoteButton'), albumNoteLog: document.querySelector('#albumNoteLog'),
  referenceInput: document.querySelector('#referenceInput'), chooseReferencesButton: document.querySelector('#chooseReferencesButton'), referencesList: document.querySelector('#referencesList'), referenceTemplate: document.querySelector('#referenceTemplate'), referenceCount: document.querySelector('#referenceCount'),
  releaseDateInput: document.querySelector('#releaseDateInput'), releaseDescriptionInput: document.querySelector('#releaseDescriptionInput'), releaseCreditsInput: document.querySelector('#releaseCreditsInput'), downloadUrlInput: document.querySelector('#downloadUrlInput'), releaseCopyOutput: document.querySelector('#releaseCopyOutput'), copyReleaseCopyButton: document.querySelector('#copyReleaseCopyButton'), releasePresetSelect: document.querySelector('#releasePresetSelect'), releasePresetNameInput: document.querySelector('#releasePresetNameInput'), newReleasePresetButton: document.querySelector('#newReleasePresetButton'), saveReleasePresetButton: document.querySelector('#saveReleasePresetButton'), deleteReleasePresetButton: document.querySelector('#deleteReleasePresetButton'),
  sessionStatus: document.querySelector('#sessionStatus'), projectLoading: document.querySelector('#projectLoading'), projectLoadingLabel: document.querySelector('#projectLoadingLabel'),
  aboutButton: document.querySelector('#aboutButton'), legalDialog: document.querySelector('#legalDialog'), legalCloseButton: document.querySelector('#legalCloseButton'),
  privacyTab: document.querySelector('#privacyTab'), termsTab: document.querySelector('#termsTab'), legalDocument: document.querySelector('#legalDocument'), appVersion: document.querySelector('#appVersion'),
  licenseButton: document.querySelector('#licenseButton'), licenseDialog: document.querySelector('#licenseDialog'), licenseTitle: document.querySelector('#licenseTitle'), licenseIntro: document.querySelector('#licenseIntro'), licenseForm: document.querySelector('#licenseForm'), licenseKeyInput: document.querySelector('#licenseKeyInput'), licenseEmailInput: document.querySelector('#licenseEmailInput'), licenseActivateButton: document.querySelector('#licenseActivateButton'), licenseStatus: document.querySelector('#licenseStatus'), licenseCheckButton: document.querySelector('#licenseCheckButton'), licenseDeactivateButton: document.querySelector('#licenseDeactivateButton'), licenseCloseButton: document.querySelector('#licenseCloseButton'),
};

// Keep diagnostic context small and useful. Counts and playback state help us
// reproduce a problem without copying private notes or complete project data.
const errorReporter = createErrorReporter(() => ({
  Version: elements.appVersion.textContent,
  Runtime: isDesktop() ? 'Tauri desktop' : 'Browser preview',
  Platform: navigator.userAgent,
  Theme: document.body.dataset.theme || 'day',
  Workspace: state.isTrackedNotesView ? 'Note-taking' : elements.releaseCopyView.hidden ? 'Album' : 'Release Copy',
  Tracks: state.tracks.length,
  Materials: state.materials.length,
  References: state.references.length,
  'Unsaved changes': state.hasUnsavedChanges,
  'Save in progress': state.isSaving,
  'Playback seconds': elements.audioPlayer.currentTime,
  'Playback paused': elements.audioPlayer.paused,
  'Transition playback': state.transitionIsPlaying,
}), () => [elements.licenseKeyInput.value, elements.licenseEmailInput.value]);

// Unhandled errors still reach the console, and now have a copyable report too.
window.addEventListener('error', (event) => errorReporter.show('An unexpected interface error occurred', event.error || event.message));
window.addEventListener('unhandledrejection', (event) => errorReporter.show('An operation could not finish', event.reason));

function isDesktop() { return Boolean(desktop.invoke); }
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function getTotalDuration() { return state.tracks.reduce((total, track) => total + (track.duration || 0), 0); }
function getTrackStart(trackId) {
  let total = 0;
  for (const track of state.tracks) { if (track.id === trackId) return total; total += track.duration || 0; }
  return 0;
}

// A transition clip can use either an album track or a file kept in Other
// Materials. Looking in both places lets field recordings remain outside the
// numbered track list while still being available as overlays.
function transitionSource(trackId) {
  return state.tracks.find((track) => track.id === trackId) || state.materials.find((track) => track.id === trackId);
}
function transitionLayoutDuration() {
  return state.transitionPlacements.reduce((end, placement) => {
    const track = transitionSource(placement.trackId);
    return Math.max(end, placement.start + (track?.duration || 0));
  }, 0);
}

// New album tracks initially form the familiar uninterrupted sequence,
// alternating between lanes one and two. After the user moves a clip, its
// custom position is left alone.
function ensureTransitionPlacements() {
  const albumIds = new Set(state.tracks.map((track) => track.id));
  const materialIds = new Set(state.materials.map((track) => track.id));
  const seen = new Set();
  state.transitionPlacements = state.transitionPlacements.filter((placement) => {
    const available = albumIds.has(placement.trackId) || (placement.isOverlay && materialIds.has(placement.trackId));
    if (!available || seen.has(placement.trackId)) return false;
    seen.add(placement.trackId); placement.id ||= crypto.randomUUID();
    placement.lane = Number.isInteger(placement.lane) && placement.lane >= 0 && placement.lane < 3 ? placement.lane : 0;
    placement.start = Number.isFinite(placement.start) ? Math.max(0, placement.start) : 0;
    const duration = transitionSource(placement.trackId)?.duration || 0;
    for (const key of ['fadeIn', 'fadeOut']) placement[key] = Number.isFinite(placement[key]) ? Math.max(0, Math.min(duration, placement[key])) : 0;
    return true;
  });
  let sequentialStart = 0;
  state.tracks.forEach((track, index) => {
    if (!seen.has(track.id)) state.transitionPlacements.push({ id: crypto.randomUUID(), trackId: track.id, lane: index % 2, start: sequentialStart, fadeIn: 0, fadeOut: 0, isOverlay: false });
    sequentialStart += track.duration || 0;
  });
  reconcileTransitionPlacements();
  if (state.transitionSelectedId && !state.transitionPlacements.some((placement) => placement.id === state.transitionSelectedId)) state.transitionSelectedId = null;
}

// Each lane has one player. If a longer replacement reaches a following clip,
// move that following clip forward instead of silently making it unplayable.
function reconcileTransitionPlacements() {
  let moved = 0;
  for (let lane = 0; lane < 3; lane += 1) {
    let end = 0;
    const placements = state.transitionPlacements.filter((item) => item.lane === lane).sort((a, b) => a.start - b.start);
    for (const placement of placements) {
      if (placement.start < end) { placement.start = end; moved += 1; }
      end = transitionPlacementEnd(placement);
    }
  }
  state.transitionPlayhead = Math.min(state.transitionPlayhead, transitionLayoutDuration());
  return moved;
}

function findTransitionGap(lane, start, duration) {
  let candidate = Math.max(0, start);
  for (const placement of state.transitionPlacements.filter((item) => item.lane === lane).sort((a, b) => a.start - b.start)) {
    if (candidate + duration <= placement.start) break;
    if (candidate < transitionPlacementEnd(placement)) candidate = transitionPlacementEnd(placement);
  }
  return candidate;
}
function setStatus(text, tone = 'neutral', error = null) {
  clearTimeout(state.statusTimer); elements.sessionStatus.classList.remove('is-quiet');
  elements.sessionStatus.lastChild.textContent = ` ${text}`;
  elements.sessionStatus.classList.remove('is-saved', 'is-saving', 'is-error');
  if (tone === 'saved') elements.sessionStatus.classList.add('is-saved');
  if (tone === 'saving') elements.sessionStatus.classList.add('is-saving');
  if (tone === 'error') { elements.sessionStatus.classList.add('is-error'); errorReporter.show(text, error); }
  // Status is useful feedback, but it should not become a permanent second label in the interface.
  state.statusTimer = setTimeout(() => elements.sessionStatus.classList.add('is-quiet'), 8000);
}

function setProjectLoading(loading, label = 'Preparing project…') {
  elements.projectLoading.hidden = !loading; elements.projectLoadingLabel.textContent = label;
  // Inert blocks keyboard as well as pointer input while a project is changing.
  for (const surface of document.querySelectorAll('.topbar, .app-shell, .release-copy-view, .tracked-notes-view')) surface.inert = loading;
  // A save can redraw the library while it is locked; unlock those new buttons too.
  for (const button of document.querySelectorAll('.saved-album')) button.disabled = loading;
}

function scheduleAutoSave() {
  clearTimeout(state.autoSaveTimer);
  // A short pause keeps typing responsive while still storing notes and metadata almost immediately.
  state.autoSaveTimer = setTimeout(() => {
    saveProject({ automatic: true }).catch((error) => { console.error(error); setStatus('could not auto-save', 'error', error); });
  }, 700);
}

function markUnsaved() {
  // Background edits started before an operation locked the UI still count.
  // The final flush waits for them; ignoring them would lose a late replacement.
  state.saveRevision += 1; state.hasUnsavedChanges = true;
  setStatus('unsaved changes');
  if (!state.loadingProjectId) scheduleAutoSave();
}
function runPendingEdit(operation) {
  const pending = Promise.resolve(operation());
  state.pendingEdits.add(pending);
  pending.then(() => state.pendingEdits.delete(pending), () => state.pendingEdits.delete(pending));
  return pending;
}

function baseName(path) { return path.split(/[\\/]/).pop() || 'Untitled track'; }
function cleanFileName(name) { return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled album'; }
function metadata() {
  return {
    title: elements.albumName.value.trim() || 'Untitled album',
    artist: elements.artistInput.value.trim(), albumArtist: elements.albumArtistInput.value.trim(),
    year: elements.yearInput.value.trim(), genre: elements.genreInput.value.trim(), composer: elements.composerInput.value.trim(),
    discNumber: elements.discNumberInput.value.trim(), label: elements.labelInput.value.trim(), catalogue: elements.catalogueInput.value.trim(),
    comment: elements.commentInput.value.trim(), compilation: elements.compilationInput.checked,
  };
}

const RELEASE_LINK_FIELDS = ['website', 'instagram', 'bandcamp', 'soundcloud', 'youtube', 'spotify', 'appleMusic'];
const RELEASE_LINK_LABELS = { website: 'Website', instagram: 'Instagram', bandcamp: 'Bandcamp', soundcloud: 'SoundCloud', youtube: 'YouTube', spotify: 'Spotify', appleMusic: 'Apple Music' };
const RELEASE_PRESETS_KEY = 'album-builder-release-link-presets-v1';

function emptyReleaseLinks() { return Object.fromEntries(RELEASE_LINK_FIELDS.map((field) => [field, ''])); }
function readReleasePresets() {
  // Ignore damaged individual records rather than preventing the whole app
  // from opening. Only the fields this form understands cross into UI state.
  try {
    const saved = JSON.parse(localStorage.getItem(RELEASE_PRESETS_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    const seen = new Set();
    return saved.filter((preset) => {
      if (!preset || typeof preset.id !== 'string' || !preset.id || typeof preset.name !== 'string' || seen.has(preset.id)) return false;
      seen.add(preset.id); return true;
    }).map((preset) => ({ id: preset.id, name: preset.name, links: Object.fromEntries(RELEASE_LINK_FIELDS.map((field) => [field, typeof preset.links?.[field] === 'string' ? preset.links[field] : ''])) }));
  } catch { return []; }
}
function writeReleasePresets(presets) { localStorage.setItem(RELEASE_PRESETS_KEY, JSON.stringify(presets)); }
function readPresetFormLinks() { return Object.fromEntries(RELEASE_LINK_FIELDS.map((field) => [field, document.querySelector(`[data-release-link="${field}"]`).value.trim()])); }
function writePresetFormLinks(links = {}) { RELEASE_LINK_FIELDS.forEach((field) => { document.querySelector(`[data-release-link="${field}"]`).value = links[field] || ''; }); }
function releaseCopyData() {
  return { releaseDate: elements.releaseDateInput.value, description: elements.releaseDescriptionInput.value, credits: elements.releaseCreditsInput.value, downloadUrl: elements.downloadUrlInput.value.trim(), presetId: state.releaseCopy.presetId, links: { ...emptyReleaseLinks(), ...state.releaseCopy.links } };
}
function applyReleaseCopyData(data = {}) {
  elements.releaseDateInput.value = data.releaseDate || ''; elements.releaseDescriptionInput.value = data.description || ''; elements.releaseCreditsInput.value = data.credits || ''; elements.downloadUrlInput.value = data.downloadUrl || '';
  state.releaseCopy = { presetId: data.presetId || '', links: { ...emptyReleaseLinks(), ...(data.links || {}) } }; renderReleasePresetSelect(); updateReleaseCopyPreview();
}
function formatReleaseDate(value) { if (!value) return ''; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
function formatReleaseCopy() {
  const data = releaseCopyData(); const info = metadata(); const artist = info.albumArtist || info.artist; const lines = [];
  lines.push(artist ? `${info.title}\n${artist}` : info.title); if (data.releaseDate) lines.push(`Release date: ${formatReleaseDate(data.releaseDate)}`); if (data.description) lines.push(data.description.trim()); if (data.credits) lines.push(`Credits\n${data.credits.trim()}`);
  const releaseLinks = []; if (data.downloadUrl) releaseLinks.push(`Digital download: ${data.downloadUrl}`); if (releaseLinks.length) lines.push(releaseLinks.join('\n'));
  const followLinks = RELEASE_LINK_FIELDS.filter((field) => data.links[field]).map((field) => `${RELEASE_LINK_LABELS[field]}: ${data.links[field]}`); if (followLinks.length) lines.push(`Follow / listen\n${followLinks.join('\n')}`);
  return lines.join('\n\n');
}
function updateReleaseCopyPreview() { elements.releaseCopyTitle.textContent = metadata().title; elements.releaseCopyOutput.textContent = formatReleaseCopy() || 'Add release information to prepare a copyable text block.'; }
function renderReleasePresetSelect() {
  const presets = readReleasePresets(); const selected = state.releaseCopy.presetId; elements.releasePresetSelect.replaceChildren(new Option('No preset selected', ''));
  presets.forEach((preset) => elements.releasePresetSelect.add(new Option(preset.name, preset.id)));
  elements.releasePresetSelect.value = presets.some((preset) => preset.id === selected) ? selected : '';
  const active = presets.find((preset) => preset.id === elements.releasePresetSelect.value); elements.releasePresetNameInput.value = active?.name || ''; writePresetFormLinks(active?.links || {});
}
function applySelectedReleasePreset() {
  const preset = readReleasePresets().find((item) => item.id === elements.releasePresetSelect.value); state.releaseCopy = { presetId: preset?.id || '', links: { ...emptyReleaseLinks(), ...(preset?.links || {}) } }; renderReleasePresetSelect(); updateReleaseCopyPreview(); markUnsaved();
}
function newReleasePreset() { elements.releasePresetSelect.value = ''; elements.releasePresetNameInput.value = ''; writePresetFormLinks({}); }
function saveReleasePreset() {
  const name = elements.releasePresetNameInput.value.trim(); if (!name) { setStatus('name the link preset first', 'error'); return; }
  const presets = readReleasePresets(); const currentId = elements.releasePresetSelect.value; const preset = { id: currentId || crypto.randomUUID(), name, links: readPresetFormLinks() }; const index = presets.findIndex((item) => item.id === preset.id);
  if (index >= 0) presets.splice(index, 1, preset); else presets.push(preset); writeReleasePresets(presets); state.releaseCopy = { presetId: preset.id, links: { ...preset.links } }; renderReleasePresetSelect(); updateReleaseCopyPreview(); markUnsaved(); setStatus('link preset saved', 'saved');
}
function deleteReleasePreset() {
  const id = elements.releasePresetSelect.value; if (!id) return; writeReleasePresets(readReleasePresets().filter((preset) => preset.id !== id)); state.releaseCopy = { presetId: '', links: emptyReleaseLinks() }; renderReleasePresetSelect(); updateReleaseCopyPreview(); markUnsaved(); setStatus('link preset deleted', 'saved');
}
function setReleaseCopyView(open) {
  if (preparationApi?.busy()) { setStatus('wait for the current preparation operation to finish'); return; }
  elements.releaseCopyView.hidden = !open;
  const shell = document.querySelector('.app-shell'); shell.hidden = false; shell.classList.toggle('is-preparing', open);
  elements.releaseCopyButton.setAttribute('aria-pressed', String(open));
  document.querySelector('#albumWorkspaceButton').setAttribute('aria-pressed', String(!open));
  if (open) {
    elements.audioPlayer.pause(); pauseTransitionPlayback();
    if (!preparationFrame.src) preparationFrame.src = new URL('./preparation/index.html', window.location.href).href;
    else if (preparationApi) hydratePreparation().catch(preparationError);
  } else { preparationApi?.pause(); render(); }
  elements.exportProjectButton.innerHTML = open ? 'Review + export <span aria-hidden="true">↗</span>' : 'Export album <span aria-hidden="true">↗</span>';
}

async function copyReleaseCopy() {
  const text = formatReleaseCopy(); if (!text) return;
  try { await navigator.clipboard.writeText(text); setStatus('release copy copied', 'saved'); }
  catch (error) {
    // A denied clipboard request is not a successful copy. Try the older
    // browser command, then leave the actual release text selected for copying.
    let area = document.querySelector('#releaseCopyFallback');
    if (!area) { area = document.createElement('textarea'); area.id = 'releaseCopyFallback'; area.className = 'release-copy-fallback'; area.readOnly = true; area.setAttribute('aria-label', 'Release copy — select and copy this text'); elements.releaseCopyOutput.after(area); }
    area.value = text; area.hidden = false; area.focus(); area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* The selected text remains available below. */ }
    if (copied) { area.remove(); setStatus('release copy copied', 'saved'); }
    else setStatus('clipboard unavailable — select the release text and copy it manually', 'error', error);
  }
}

// The note-taking screen reads the existing album playback state; it does not create a second audio engine.
function syncTrackedNotesArtwork() {
  const hasArtwork = Boolean(state.artworkDataUrl);
  elements.trackedNotesArtwork.hidden = !hasArtwork;
  elements.trackedNotesArtworkEmpty.hidden = hasArtwork;
  if (hasArtwork) elements.trackedNotesArtwork.src = state.artworkDataUrl;
  else elements.trackedNotesArtwork.removeAttribute('src');
}
function closeTrackedNoteComposer() {
  restoreListeningDraft(null);
}
// A listening draft belongs to the album, even when the listening screen is
// closed. The persistence layer uses these helpers for save/load and recovery.
function getListeningDraft() {
  const draft = state.trackedNoteDraft;
  return draft ? { trackId: draft.trackId, seconds: draft.seconds, text: elements.trackedNoteInput.value } : null;
}
function restoreListeningDraft(value) {
  const track = value && state.tracks.find((item) => item.id === value.trackId);
  const valid = track && Number.isFinite(value.seconds) && value.seconds >= 0;
  state.trackedNoteDraft = valid ? { trackId: track.id, seconds: Math.floor(value.seconds), text: typeof value.text === 'string' ? value.text : '' } : null;
  elements.trackedNoteInput.value = state.trackedNoteDraft?.text || '';
  elements.trackedNoteInput.disabled = !valid;
  elements.trackedNoteContext.hidden = !valid;
  elements.trackedNoteContext.textContent = valid ? `${track.name} · ${formatTime(state.trackedNoteDraft.seconds)}` : '';
  document.querySelector('#discardListeningNoteButton').hidden = !valid;
}
function setTrackedNotesView(open) {
  if (open) {
    if (state.currentReferenceId || !state.tracks.length) { setStatus('add an album track before note-taking', 'error'); return; }
    // Opening before playback is useful: the listener can choose an individual track or begin the album from its own transport.
    if (!state.currentTrackId) cueTrack(state.tracks[0].id, 0, true);
    setReleaseCopyView(false); state.isTrackedNotesView = true; syncTrackedNotesArtwork(); restoreListeningDraft(getListeningDraft()); elements.trackedNotesView.hidden = false; elements.trackedNotesButton.setAttribute('aria-pressed', 'true'); document.body.classList.add('is-tracked-notes'); renderNoteTakingTrackList(); syncNoteTakingPlayback(); elements.noteTakingBackButton.focus(); return;
  }
  state.isTrackedNotesView = false; elements.trackedNotesView.hidden = true; elements.trackedNotesButton.setAttribute('aria-pressed', 'false'); document.body.classList.remove('is-tracked-notes'); elements.trackedNotesButton.focus();
  // Canvas dimensions are zero while the ordinary workspace is hidden. Wait for it to reflow, then redraw every small waveform.
  requestAnimationFrame(() => { drawAlbumWaveform(); redrawSmallWaveforms(); if (elements.albumSpectrogramPanel.open && state.albumSpectrogram) drawAlbumSpectrogram(); });
}
function openTrackedNoteComposer() {
  if (state.trackedNoteDraft && elements.trackedNoteInput.value.trim()) { elements.trackedNoteInput.focus(); return; }
  const track = state.tracks.find((item) => item.id === state.currentTrackId);
  if (!track) { setStatus('choose an album track first', 'error'); return; }
  // Capture the target before the person starts writing, so an album boundary cannot move this note to the next track.
  state.trackedNoteDraft = { trackId: track.id, seconds: Math.max(0, Math.floor(elements.audioPlayer.currentTime)), text: '' };
  elements.trackedNoteContext.textContent = `${track.name} · ${formatTime(state.trackedNoteDraft.seconds)}`;
  elements.trackedNoteContext.hidden = false; elements.trackedNoteInput.value = ''; elements.trackedNoteInput.disabled = false; document.querySelector('#discardListeningNoteButton').hidden = false; elements.trackedNoteInput.focus();
}
function saveTrackedNote(event) {
  event.preventDefault(); const text = elements.trackedNoteInput.value.trim(); const draft = state.trackedNoteDraft;
  if (!text || !draft) return;
  const track = state.tracks.find((item) => item.id === draft.trackId); if (!track) { closeTrackedNoteComposer(); return; }
  recordHistory(); track.trackedNotes ||= []; track.trackedNotes.push({ id: crypto.randomUUID(), seconds: draft.seconds, text, createdAt: new Date().toISOString() }); markUnsaved(); render(); closeTrackedNoteComposer();
}

// This small drawer offers optional track selection and waveform seeking without placing a running clock in the art field.
function renderNoteTakingTrackList() {
  if (!state.isTrackedNotesView) return;
  elements.noteTakingTrackList.replaceChildren();
  state.tracks.forEach((track) => {
    const row = document.createElement('div'); row.className = 'note-taking-track'; row.dataset.id = track.id; row.classList.toggle('is-current', track.id === state.currentTrackId);
    const name = document.createElement('button'); name.type = 'button'; name.className = 'note-taking-track-name'; name.textContent = track.name; name.addEventListener('click', () => playTrack(track.id, 0, false));
    const waveform = document.createElement('canvas'); waveform.className = 'note-taking-track-waveform'; waveform.setAttribute('aria-label', `${track.name} waveform. Click to listen from this point.`); waveform.addEventListener('click', (event) => { const rect = waveform.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))); playTrack(track.id, fraction * track.duration, false); });
    row.append(name, waveform); elements.noteTakingTrackList.append(row); drawTrackWaveform(waveform, track);
  });
}
function syncNoteTakingPlayback() {
  if (!state.isTrackedNotesView) return;
  const total = Math.max(1, getTotalDuration()); const position = state.currentTrackId ? getTrackStart(state.currentTrackId) + elements.audioPlayer.currentTime : 0;
  elements.noteTakingProgress.max = String(Math.ceil(total)); elements.noteTakingProgress.value = String(Math.max(0, Math.min(total, position))); elements.noteTakingProgress.style.setProperty('--note-taking-progress', `${(Math.max(0, Math.min(total, position)) / total) * 100}%`);
  const noTracks = !state.tracks.length; [elements.noteTakingAlbumStartButton, elements.noteTakingRestartButton, elements.noteTakingPlayButton, elements.noteTakingPauseButton, elements.noteTakingNextButton].forEach((button) => { button.disabled = noTracks; });
  document.querySelectorAll('.note-taking-track').forEach((row) => row.classList.toggle('is-current', row.dataset.id === state.currentTrackId));
}
function seekNoteTakingProgress() {
  const wasPlaying = !elements.audioPlayer.paused; const target = Number(elements.noteTakingProgress.value); let elapsed = 0;
  for (const track of state.tracks) { const end = elapsed + (track.duration || 0); if (target <= end || track === state.tracks.at(-1)) { cueTrack(track.id, Math.max(0, target - elapsed), state.isAlbumMode); if (wasPlaying) playMedia(); return; } elapsed = end; }
}

// History keeps lightweight copies of album decisions. Audio File objects and their analysed waveform data stay referenced, so undo is quick.
function historySnapshot() {
  return {
    // Copy note entries too, so Undo can restore a listening pass without sharing the live array.
    tracks: state.tracks.map((track) => ({ ...track, trackedNotes: (track.trackedNotes || []).map((entry) => ({ ...entry })) })), materials: state.materials.map((track) => ({ ...track, trackedNotes: (track.trackedNotes || []).map((entry) => ({ ...entry })) })), references: state.references.map((track) => ({ ...track, trackedNotes: (track.trackedNotes || []).map((entry) => ({ ...entry })) })), albumNoteEntries: state.albumNoteEntries.map((entry) => ({ ...entry })),
    transitionPlacements: state.transitionPlacements.map((placement) => ({ ...placement })),
    currentTrackId: state.currentTrackId, currentReferenceId: state.currentReferenceId, currentStart: state.currentStart, isAlbumMode: state.isAlbumMode,
    metadata: metadata(), releaseCopy: releaseCopyData(), releasePreparation: structuredClone(state.preparation), albumNotes: noteValue(elements.albumNotesInput), listeningDraft: getListeningDraft(), artworkDataUrl: state.artworkDataUrl, artworkNativePath: state.artworkNativePath,
  };
}
function snapshotSignature(snapshot) {
  return JSON.stringify({
    tracks: snapshot.tracks.map(({ id, sourceId, nativePath, name, status, notes, trackedNotes }) => ({ id, sourceId, nativePath, name, status, notes, trackedNotes })),
    materials: snapshot.materials.map(({ id, sourceId, nativePath, name, status, notes }) => ({ id, sourceId, nativePath, name, status, notes })), references: snapshot.references.map(({ id, sourceId, nativePath, name }) => ({ id, sourceId, nativePath, name })), albumNoteEntries: snapshot.albumNoteEntries,
    transitionPlacements: snapshot.transitionPlacements,
    metadata: snapshot.metadata, releaseCopy: snapshot.releaseCopy, releasePreparation: snapshot.releasePreparation, albumNotes: snapshot.albumNotes, listeningDraft: snapshot.listeningDraft, artworkDataUrl: snapshot.artworkDataUrl, artworkNativePath: snapshot.artworkNativePath,
  });
}
function recordHistory() {
  // An edit that began before Close/Open locked the UI still deserves Undo.
  if (state.restoringHistory || (state.loadingProjectId && !state.pendingEdits.size)) return;
  const snapshot = historySnapshot(); const current = state.history[state.historyIndex];
  // A fresh edit after Undo starts a new branch, even when its starting point is already the current checkpoint.
  if (current && snapshotSignature(current) === snapshotSignature(snapshot)) { state.history.splice(state.historyIndex + 1); releaseUnusedAudioSources(); return; }
  state.history.splice(state.historyIndex + 1); state.history.push(snapshot);
  // Keeping 80 edits is enough for normal writing without retaining an unbounded set of old audio references.
  if (state.history.length > 80) state.history.shift();
  state.historyIndex = state.history.length - 1; releaseUnusedAudioSources();
}
function resetHistory() { state.history = [historySnapshot()]; state.historyIndex = 0; releaseUnusedAudioSources(); }
function applyHistory(snapshot) {
  if (!snapshot) return;
  invalidatePreparationBinding(); state.sessionGeneration += 1; spectrumRequest += 1; state.spectrogramLoading = false; pauseTransitionPlayback();
  state.restoringHistory = true; elements.audioPlayer.pause(); elements.audioPlayer.removeAttribute('src'); state.currentReferenceId = null;
  state.tracks = snapshot.tracks.map(restoreHistoryTrack); state.materials = snapshot.materials.map(restoreHistoryTrack); state.references = snapshot.references.map(restoreHistoryTrack); state.albumNoteEntries = snapshot.albumNoteEntries.map((entry) => ({ ...entry }));
  state.transitionPlacements = (snapshot.transitionPlacements || []).map((placement) => ({ ...placement }));
  state.currentTrackId = snapshot.currentTrackId; state.currentReferenceId = snapshot.currentReferenceId || null; state.currentStart = snapshot.currentStart; state.isAlbumMode = snapshot.isAlbumMode;
  elements.albumName.value = snapshot.metadata.title; elements.albumTitle.textContent = snapshot.metadata.title;
  elements.artistInput.value = snapshot.metadata.artist; elements.albumArtistInput.value = snapshot.metadata.albumArtist; elements.yearInput.value = snapshot.metadata.year; elements.genreInput.value = snapshot.metadata.genre; elements.composerInput.value = snapshot.metadata.composer; elements.discNumberInput.value = snapshot.metadata.discNumber; elements.labelInput.value = snapshot.metadata.label; elements.catalogueInput.value = snapshot.metadata.catalogue; elements.commentInput.value = snapshot.metadata.comment; elements.compilationInput.checked = snapshot.metadata.compilation;
  state.preparation = validatePreparation(snapshot.releasePreparation);
  elements.albumNotesInput.innerHTML = noteHtml(snapshot.albumNotes); applyReleaseCopyData(snapshot.releaseCopy); state.artworkDataUrl = snapshot.artworkDataUrl; state.artworkNativePath = snapshot.artworkNativePath;
  if (state.artworkDataUrl) setArtworkPreview(state.artworkDataUrl); else clearArtwork(false);
  elements.nowPlaying.textContent = state.tracks.find((track) => track.id === state.currentTrackId)?.name || '—';
  state.albumSpectrogram = null; state.albumSpectrogramSignature = '';
  restoreListeningDraft(snapshot.listeningDraft);
  state.restoringHistory = false; reconcileTransitionPlacements(); render(); markUnsaved(); releaseUnusedAudioSources();
  if (!elements.releaseCopyView.hidden && preparationApi) hydratePreparation().catch(preparationError);
  const generation = state.sessionGeneration;
  [...state.tracks, ...state.materials, ...state.references].filter((track) => track.analysisState === 'analysing').forEach((track) => {
    analyseTrack(track).then(() => { if (generation === state.sessionGeneration) { reconcileTransitionPlacements(); render(); } }).catch((error) => { if (generation === state.sessionGeneration) setStatus('could not restore audio analysis', 'error', error); });
  });
}
function undo() {
  if (preparationApi?.busy()) { setStatus('finish the current preparation operation before Undo'); return; }
  const liveSnapshot = historySnapshot(); const current = state.history[state.historyIndex];
  // Text edits are recorded just before the browser changes the DOM. Add the live result here so it becomes available to Redo.
  if (!current || snapshotSignature(current) !== snapshotSignature(liveSnapshot)) { state.history.splice(state.historyIndex + 1); state.history.push(liveSnapshot); state.historyIndex = state.history.length - 1; }
  if (state.historyIndex <= 0) return; state.historyIndex -= 1; applyHistory(state.history[state.historyIndex]);
}
function redo() { if (preparationApi?.busy()) { setStatus('finish the current preparation operation before Redo'); return; } if (state.historyIndex >= state.history.length - 1) return; state.historyIndex += 1; applyHistory(state.history[state.historyIndex]); }

// Notes use a small rich text surface. It provides real lists and checkboxes while keeping the saved HTML compact and portable.
function escapeHtml(text) { const node = document.createElement('div'); node.textContent = text; return node.innerHTML; }
function checklistHtml(text = '', checked = false, level = 0) { return `<div class="checklist-item${checked ? ' is-checked' : ''}" contenteditable="false" style="--checklist-depth:${level}"><input class="note-checkbox" type="checkbox"${checked ? ' checked' : ''} aria-label="Mark checklist item complete"><span class="checklist-label" contenteditable="true">${escapeHtml(text) || '<br>'}</span></div>`; }
function noteHtml(value) {
  if (!value) return '';
  // Existing saved notes were plain text. Convert old checklist markers into the real controls on first open.
  if (!/<[a-z][\s\S]*>/i.test(value)) return sanitizeNoteHtml(value.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*-\s*\[\s*([xX ])\s*\]\s*(.*)$/);
    return match ? checklistHtml(match[2], /x/i.test(match[1])) : `<div>${escapeHtml(line)}</div>`;
  }).join(''));
  return sanitizeNoteHtml(value);
}
function noteValue(input) { return readNoteHtml(input); }
function selectionElement() { const node = window.getSelection()?.anchorNode; return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement; }
function placeCaretAtEnd(element) { const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.focus(); }
function currentChecklistItem() { return selectionElement()?.closest?.('.checklist-item') || null; }

function toggleChecklist(input) {
  const current = currentChecklistItem();
  if (current && input.contains(current)) {
    // Pressing the checklist button on a checklist item turns that line back into a normal editable paragraph.
    const paragraph = document.createElement('div'); paragraph.textContent = current.querySelector('.checklist-label')?.textContent || '';
    current.replaceWith(paragraph); placeCaretAtEnd(paragraph); input.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  const selectedText = window.getSelection()?.toString() || '';
  document.execCommand('insertHTML', false, checklistHtml(selectedText));
  const inserted = currentChecklistItem() || input.querySelector('.checklist-item:last-child'); const text = inserted?.querySelector('.checklist-label'); if (text) placeCaretAtEnd(text); else input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyListFormat(input, format) {
  input.focus(); recordHistory();
  if (format === 'bullet') document.execCommand('insertUnorderedList');
  else if (format === 'number') document.execCommand('insertOrderedList');
  else toggleChecklist(input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Checklists need a small amount of custom keyboard handling; browser-native lists take care of normal Enter behaviour.
function handleNotepadKeys(event) {
  const input = event.currentTarget; const checklist = currentChecklistItem(); const listItem = selectionElement()?.closest?.('li');
  if (event.key === 'Tab' && (checklist || listItem)) {
    event.preventDefault(); recordHistory();
    if (checklist) {
      const level = Number(checklist.style.getPropertyValue('--checklist-depth') || 0);
      checklist.style.setProperty('--checklist-depth', Math.max(0, Math.min(5, level + (event.shiftKey ? -1 : 1))));
    } else document.execCommand(event.shiftKey ? 'outdent' : 'indent');
    input.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  if (event.key === 'Enter' && checklist) {
    event.preventDefault(); recordHistory();
    const label = checklist.querySelector('.checklist-label');
    if (!label.textContent.trim()) {
      const paragraph = document.createElement('div'); checklist.replaceWith(paragraph); placeCaretAtEnd(paragraph);
    } else {
      const level = Number(checklist.style.getPropertyValue('--checklist-depth') || 0);
      checklist.insertAdjacentHTML('afterend', checklistHtml('', false, level)); placeCaretAtEnd(checklist.nextElementSibling.querySelector('.checklist-label'));
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function bindNotepadToolbar(toolbar, input) {
  toolbar.querySelectorAll('[data-list-format]').forEach((button) => {
    // Keeping focus in the note field preserves the user's selected line when they press a formatting button.
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => applyListFormat(input, button.dataset.listFormat));
  });
  input.addEventListener('keydown', handleNotepadKeys);
  // Pasted HTML can carry event handlers or remote images. Clean it before it
  // enters the live document, and keep normal text/list formatting portable.
  const insertCleanContent = (event, transfer) => {
    if (!transfer || transfer.files?.length) return;
    const html = transfer.getData('text/html'); const text = transfer.getData('text/plain');
    if (!html && !text) return;
    event.preventDefault(); event.stopPropagation(); recordHistory();
    document.execCommand('insertHTML', false, html ? sanitizeNoteHtml(html) : escapeHtml(text).replace(/\r?\n/g, '<br>'));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  input.addEventListener('paste', (event) => insertCleanContent(event, event.clipboardData));
  input.addEventListener('drop', (event) => insertCleanContent(event, event.dataTransfer));
  input.addEventListener('pointerdown', (event) => { if (event.target.matches('.note-checkbox')) recordHistory(); });
  input.addEventListener('change', (event) => {
    if (!event.target.matches('.note-checkbox')) return;
    event.target.toggleAttribute('checked', event.target.checked);
    event.target.closest('.checklist-item')?.classList.toggle('is-checked', event.target.checked);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const legalDocuments = { privacy: privacyPolicy, terms: termsOfUse };

// The legal Markdown uses only headings, paragraphs and lists. This small reader creates safe HTML elements without inserting raw document text as code.
function renderLegalDocument(documentName) {
  const markdown = legalDocuments[documentName];
  elements.legalDocument.replaceChildren();
  let currentList = null;
  markdown.split(/\r?\n/).forEach((sourceLine) => {
    const line = sourceLine.trim();
    if (!line) { currentList = null; return; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      currentList = null;
      const level = Math.min(4, heading[1].length + 1);
      const element = document.createElement(`h${level}`);
      element.textContent = heading[2];
      elements.legalDocument.append(element);
      return;
    }
    if (line.startsWith('- ')) {
      if (!currentList) { currentList = document.createElement('ul'); elements.legalDocument.append(currentList); }
      const item = document.createElement('li'); item.textContent = line.slice(2); currentList.append(item); return;
    }
    currentList = null;
    const paragraph = document.createElement('p'); paragraph.textContent = line.replace(/\*\*(.*?)\*\*/g, '$1'); elements.legalDocument.append(paragraph);
  });
  elements.privacyTab.setAttribute('aria-pressed', String(documentName === 'privacy'));
  elements.termsTab.setAttribute('aria-pressed', String(documentName === 'terms'));
  elements.legalDocument.scrollTop = 0;
}

function openAboutAndLegal() {
  renderLegalDocument('privacy');
  elements.legalDialog.showModal();
  elements.legalDocument.focus();
}

// Licensing is kept in the desktop layer so the full key never needs to be held
// in browser storage. This small UI only shows a masked key and activation state.
function openLicenseDialog() {
  if (!elements.licenseDialog.open) elements.licenseDialog.showModal();
}

function showLicenseStatus(status, error = '') {
  state.licenseStatus = status;
  const configured = Boolean(status?.configured);
  const active = Boolean(status?.active);
  const requiresActivation = Boolean(status?.requiresActivation);
  const savedActivation = Boolean(status?.keyHint || status?.lastValidatedAtMs);
  const licenceProblem = Boolean(error) || (configured && !active && savedActivation);
  const message = (error && (error.message || String(error))) || status?.message || 'Checking licence…';
  // Put this report inside the modal: a native dialog blocks buttons behind it.
  const reportHost = elements.licenseDialog.querySelector('.license-dialog__frame');
  if (licenceProblem) errorReporter.show(message, error || message, { host: reportHost });
  else errorReporter.clear(reportHost);
  elements.licenseTitle.textContent = active ? 'Album Builder is active' : configured && requiresActivation ? 'Activate Album Builder' : configured ? 'Check your saved activation' : 'Licensing setup needed';
  elements.licenseIntro.textContent = active
    ? `Activated for ${status.customerEmail || 'this purchase'} (${status.keyHint || 'licence key'}).`
    : configured && requiresActivation ? 'Enter the licence key and email address from your Lemon Squeezy receipt.' : configured ? 'Connect to the internet and choose check licence now. Your saved key will be reused.' : 'This copy still needs its Lemon Squeezy store, product, and variant IDs added before it can activate purchases.';
  elements.licenseStatus.textContent = message;
  elements.licenseStatus.classList.toggle('is-error', licenceProblem);
  elements.licenseForm.hidden = active || !configured || !requiresActivation;
  // Expired offline activations still need a retry button; hiding it would
  // strand the user until the next application launch.
  elements.licenseCheckButton.hidden = !configured || !(active || savedActivation || !requiresActivation);
  elements.licenseDeactivateButton.hidden = !active;
  elements.licenseCloseButton.hidden = !active || state.licenseGateLocked;
  elements.licenseActivateButton.disabled = !configured;
  if (status?.customerEmail && !elements.licenseEmailInput.value) elements.licenseEmailInput.value = status.customerEmail;
}

async function refreshLicense({ showDialogWhenInactive = true } = {}) {
  if (!isDesktop()) return null;
  elements.licenseCheckButton.disabled = true;
  try {
    const status = await desktop.invoke('validate_license');
    showLicenseStatus(status);
    if (status.active && state.licenseGateLocked) {
      state.licenseGateLocked = false;
      elements.licenseCloseButton.hidden = false;
      elements.licenseDialog.close();
      setStatus('licence verified', 'saved');
      renderSavedAlbums().catch((error) => setStatus('could not list saved albums', 'error', error));
    } else if (!status.active && showDialogWhenInactive) {
      state.licenseGateLocked = true;
      showLicenseStatus(status);
      openLicenseDialog();
    }
    return status;
  } catch (error) {
    showLicenseStatus(state.licenseStatus || { configured: true, active: false, requiresActivation: true }, error || 'Could not check the licence right now.');
    if (showDialogWhenInactive) openLicenseDialog();
    return null;
  } finally {
    elements.licenseCheckButton.disabled = false;
  }
}

async function activateLicense(event) {
  event.preventDefault();
  if (!isDesktop()) return;
  elements.licenseActivateButton.disabled = true;
  elements.licenseStatus.classList.remove('is-error');
  elements.licenseStatus.textContent = 'Activating this Mac…';
  try {
    const status = await desktop.invoke('activate_license', { request: { licenseKey: elements.licenseKeyInput.value, customerEmail: elements.licenseEmailInput.value } });
    showLicenseStatus(status);
    state.licenseGateLocked = false;
    elements.licenseDialog.close();
    setStatus('Album Builder activated', 'saved');
    renderSavedAlbums().catch((error) => setStatus('could not list saved albums', 'error', error));
  } catch (error) {
    showLicenseStatus(state.licenseStatus || { configured: true, active: false, requiresActivation: true }, error || 'Activation could not finish.');
  } finally {
    elements.licenseActivateButton.disabled = !state.licenseStatus?.configured;
  }
}

async function deactivateLicense() {
  if (!isDesktop() || !window.confirm('Deactivate Album Builder on this Mac? You can activate the licence on another Mac afterwards.')) return;
  elements.licenseDeactivateButton.disabled = true;
  try {
    const status = await desktop.invoke('deactivate_license');
    state.licenseGateLocked = true;
    showLicenseStatus(status);
    openLicenseDialog();
  } catch (error) {
    showLicenseStatus(state.licenseStatus || { configured: true, active: false, requiresActivation: true }, error || 'Deactivation could not finish.');
  } finally {
    elements.licenseDeactivateButton.disabled = false;
  }
}

async function initialiseLicense() {
  if (!isDesktop()) return;
  elements.licenseButton.hidden = false;
  try {
    const status = await desktop.invoke('get_license_state');
    if (status.licensingRequired === false) {
      state.licenseStatus = status;
      state.licenseGateLocked = false;
      elements.licenseButton.hidden = true;
      if (elements.licenseDialog.open) elements.licenseDialog.close();
      return;
    }
    showLicenseStatus(status);
    if (!status.active) {
      state.licenseGateLocked = true;
      showLicenseStatus(status);
      openLicenseDialog();
      // Once a customer has activated, the saved key is retried automatically.
      // The form appears only if Lemon Squeezy says that activation is invalid.
      if (!status.requiresActivation) await refreshLicense({ showDialogWhenInactive: true });
      return;
    }
    // A saved activation opens immediately, then refreshes quietly in the
    // background. This makes the 30-day offline allowance feel reliable.
    refreshLicense({ showDialogWhenInactive: true });
  } catch (error) {
    state.licenseGateLocked = true;
    showLicenseStatus({ configured: true, active: false, requiresActivation: true }, error || 'Could not read the local licence state.');
    openLicenseDialog();
  }
}

// A track row is created before analysis begins, so long recordings appear immediately instead of making the app look unresponsive.
// Blob URLs keep an imported file available to the browser. Keep them alive
// while either the current album or Undo history still needs that exact source.
const audioSources = new Map();
const pendingAudioSources = new Set();
const sourceAnalysisJobs = new Map();
let spectrumRequest = 0;
let spectrumPendingSignature = '';
let transitionTickTimer = null;

function releaseUnusedAudioSources(discardTracks = []) {
  discardTracks.forEach((track) => pendingAudioSources.delete(track.objectUrl));
  const live = [...state.tracks, ...state.materials, ...state.references];
  live.forEach((track) => pendingAudioSources.delete(track.objectUrl));
  const retained = new Set(live.map((track) => track.objectUrl));
  state.history.forEach((snapshot) => [...snapshot.tracks, ...snapshot.materials, ...snapshot.references].forEach((track) => retained.add(track.objectUrl)));
  for (const [url, track] of audioSources) {
    if (retained.has(url) || pendingAudioSources.has(url)) continue;
    URL.revokeObjectURL(url);
    if (track.artworkUrl) URL.revokeObjectURL(track.artworkUrl);
    audioSources.delete(url);
  }
}

function disposeAudioSession(preserveTracks = []) {
  pauseTransitionPlayback(); spectrumRequest += 1; state.spectrogramLoading = false;
  const preserve = new Set(preserveTracks.map((track) => track.objectUrl));
  for (const player of [elements.audioPlayer, elements.audioPreloader, ...elements.transitionPlayers]) {
    player.pause(); player.removeAttribute('src'); player.load();
    delete player.dataset.trackId; delete player.dataset.sourceUrl;
  }
  for (const [url, track] of audioSources) {
    if (preserve.has(url)) continue;
    URL.revokeObjectURL(url); if (track.artworkUrl) URL.revokeObjectURL(track.artworkUrl);
    audioSources.delete(url); pendingAudioSources.delete(url);
  }
}

// Each caller supplies a small function that creates its worker. Keeping the
// Worker(new URL(...)) expression at the call site lets Vite bundle the worker's
// imports into the installed app. Passing only a URL hides that link from Vite.
// All completion paths release the worker so a failed job cannot keep running.
function runAudioWorker(createWorker, payload, transfer = [], label = 'Audio analysis') {
  return new Promise((resolve, reject) => {
    const failure = (message, code) => Object.assign(new Error(`${label}: ${message}`), { code });
    let worker;
    try { worker = createWorker(); }
    catch (error) { reject(failure(`could not start the background worker. ${error.message || error}`, 'AUDIO_WORKER_START')); return; }
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(result); };
    const timeout = setTimeout(() => finish(failure('the background worker did not finish within two minutes.', 'AUDIO_WORKER_TIMEOUT')), 120000);
    worker.onmessage = (event) => finish(event.data?.error ? failure(event.data.error, 'AUDIO_WORKER_CALCULATION') : null, event.data);
    worker.onerror = (event) => finish(failure(event.message || 'the browser could not load or run the background worker.', 'AUDIO_WORKER_RUNTIME'));
    worker.onmessageerror = () => finish(failure('the background worker returned unreadable data.', 'AUDIO_WORKER_MESSAGE'));
    try { worker.postMessage(payload, transfer); }
    catch (error) { finish(failure(`could not send decoded audio to the background worker. ${error.message || error}`, 'AUDIO_WORKER_TRANSFER')); }
  });
}

function createTrack(file, nativePath = null) {
  const objectUrl = URL.createObjectURL(file);
  const track = { id: crypto.randomUUID(), sourceId: crypto.randomUUID(), file, nativePath, objectUrl, name: file.name.replace(/\.[^/.]+$/, ''), extension: file.name.split('.').pop()?.toLowerCase() || '', status: '', notes: '', trackedNotes: [], artworkUrl: null, duration: 0, waveform: [], peakDb: null, lufsEstimate: null, analysisState: 'analysing', analysisMessage: '' };
  audioSources.set(objectUrl, track); pendingAudioSources.add(objectUrl);
  return track;
}

// MP3 reference files can carry an APIC picture frame. Reading that small part
// of ID3 keeps the reference card useful without adding a large tag-reading library.
async function extractEmbeddedArtwork(track) {
  if (track.extension !== 'mp3') return;
  try {
    const generation = state.sessionGeneration;
    const bytes = new Uint8Array(await track.file.arrayBuffer());
    if (generation !== state.sessionGeneration || !audioSources.has(track.objectUrl)) return;
    if (String.fromCharCode(...bytes.slice(0, 3)) !== 'ID3') return;
    const version = bytes[3]; let cursor = 10;
    const tagEnd = Math.min(bytes.length, 10 + ((bytes[6] & 127) << 21 | (bytes[7] & 127) << 14 | (bytes[8] & 127) << 7 | (bytes[9] & 127)));
    while (cursor + 10 <= tagEnd) {
      const id = String.fromCharCode(...bytes.slice(cursor, cursor + 4));
      const rawSize = bytes.slice(cursor + 4, cursor + 8);
      const size = version === 4 ? ((rawSize[0] & 127) << 21 | (rawSize[1] & 127) << 14 | (rawSize[2] & 127) << 7 | (rawSize[3] & 127)) : ((rawSize[0] << 24) | (rawSize[1] << 16) | (rawSize[2] << 8) | rawSize[3]) >>> 0;
      cursor += 10;
      if (!id.trim() || !size || cursor + size > tagEnd) break;
      if (id === 'APIC') {
        const frame = bytes.slice(cursor, cursor + size); const mimeEnd = frame.indexOf(0, 1); if (mimeEnd < 0) return;
        const mime = new TextDecoder().decode(frame.slice(1, mimeEnd)) || 'image/jpeg'; const encoding = frame[0]; let imageStart = mimeEnd + 2;
        // The description is one byte per character in Latin-1, and two bytes in UTF-16 tags.
        if (encoding === 1 || encoding === 2) { while (imageStart + 1 < frame.length && (frame[imageStart] || frame[imageStart + 1])) imageStart += 2; imageStart += 2; } else { while (imageStart < frame.length && frame[imageStart]) imageStart += 1; imageStart += 1; }
        if (imageStart < frame.length) track.artworkUrl = URL.createObjectURL(new Blob([frame.slice(imageStart)], { type: mime }));
        return;
      }
      cursor += size;
    }
  } catch (error) { console.warn(`Could not read artwork from ${track.file.name}.`, error); }
}

// The browser decoder creates a visual envelope and measurements. It never writes to or changes a source file.
// History copies decisions, while analysis belongs to the immutable audio
// source. Rejoining its in-flight job prevents Undo from freezing a loading row.
function copySourceAnalysis(target, source) {
  for (const key of ['duration', 'waveform', 'peakDb', 'lufsEstimate', 'analysisState', 'analysisMessage', 'artworkUrl']) target[key] = source[key];
}
function restoreHistoryTrack(track) {
  const restored = { ...track, trackedNotes: (track.trackedNotes || []).map((entry) => ({ ...entry })) };
  const source = audioSources.get(track.objectUrl);
  if (source) copySourceAnalysis(restored, source);
  return restored;
}
async function analyseTrack(track) {
  let job = sourceAnalysisJobs.get(track.objectUrl);
  if (!job) { job = analyseTrackSource(track); sourceAnalysisJobs.set(track.objectUrl, job); }
  try { const result = await job; if (result !== track) copySourceAnalysis(track, result); return track; }
  finally { if (sourceAnalysisJobs.get(track.objectUrl) === job) sourceAnalysisJobs.delete(track.objectUrl); }
}
async function analyseTrackSource(track) {
  const generation = state.sessionGeneration;
  let metadataDuration;
  let context;
  try {
    context = new (window.AudioContext || window.webkitAudioContext)();
    const key = await cachedSourceKey(track, `waveform:${context.sampleRate}`);
    const cached = key ? await readAnalysisCache('waveform', key) : null;
    if (validWaveform(cached)) {
      track.duration = cached.duration; track.waveform = cached.waveform; track.peakDb = cached.peakDb; track.lufsEstimate = cached.lufs; track.analysisState = 'ready';
      return track;
    }
    metadataDuration = readDuration(track.objectUrl);
    const buffer = await context.decodeAudioData(await track.file.arrayBuffer());
    track.duration = buffer.duration;
    const analysis = await analyseDecodedBuffer(buffer);
    track.waveform = analysis.waveform; track.peakDb = analysis.peakDb; track.lufsEstimate = analysis.lufs; track.analysisState = 'ready';
    if (key) await writeAnalysisCache('waveform', key, { duration: track.duration, waveform: analysis.waveform, peakDb: Number.isFinite(analysis.peakDb) ? analysis.peakDb : null, lufs: Number.isFinite(analysis.lufs) ? analysis.lufs : null });
  } catch (error) {
    track.duration ||= await (metadataDuration || readDuration(track.objectUrl));
    // An unavailable waveform is left empty. Invented peaks would look like a
    // real measurement and could mislead a listening or sequencing decision.
    track.waveform = []; track.analysisState = 'unavailable';
    track.analysisMessage = error instanceof Error ? error.message : String(error);
    if (generation === state.sessionGeneration) {
      // A worker failure concerns the app's analysis code, so do not tell the
      // person to replace their recording when decoding already succeeded.
      const nextStep = String(error?.code || '').startsWith('AUDIO_WORKER_')
        ? 'The background analyser could not finish. Reopen the album to retry; copy this report if it continues.'
        : 'The audio could not be decoded. Check that the file is complete and plays in another app.';
      errorReporter.show(`Could not fully analyse ${track.file.name}. ${nextStep}`, error);
    }
  } finally {
    if (context) await context.close().catch(() => {});
  }
  return track;
}

// Derived data is optional: a damaged/unwritable cache must never block an album.
async function cachedSourceKey(track, profile) {
  if (!isDesktop()) return null;
  try { return await analysisKey(track.file, profile); } catch { return null; }
}
async function readAnalysisCache(kind, key) {
  try { return await desktop.invoke('read_analysis_cache', { kind, key }); } catch { return null; }
}
async function writeAnalysisCache(kind, key, value) {
  try { await desktop.invoke('write_analysis_cache', { kind, key, value }); }
  catch (error) { console.warn('Analysis cache could not be saved; it can be regenerated.', error); }
}
async function spectrumForTrack(track, context, rows) {
  const columns = Math.min(720, Math.max(260, Math.round(track.duration * 8)));
  const key = await cachedSourceKey(track, `spectrum:${context.sampleRate}:${columns}:${rows}`);
  const cached = key ? unpackSpectrum(await readAnalysisCache('spectrum', key), columns, rows) : null;
  if (cached) return cached;
  let buffer = await context.decodeAudioData(await track.file.arrayBuffer());
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  const job = { sampleRate: buffer.sampleRate, channelData, columns, rows }; buffer = null;
  const part = await buildAlbumSpectrogramInWorker(job);
  if (key) await writeAnalysisCache('spectrum', key, packSpectrum(part));
  return part;
}

function analyseDecodedBuffer(buffer) {
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  return runAudioWorker(() => new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }), { sampleRate: buffer.sampleRate, channelData }, [...new Set(channelData.map((channel) => channel.buffer))], 'Waveform and loudness analysis');
}

function readDuration(url) {
  return new Promise((resolve) => {
    const audio = new Audio(); let finished = false;
    const finish = (duration = 0) => { if (finished) return; finished = true; clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); resolve(Number.isFinite(duration) ? duration : 0); };
    // Two seconds is enough for a local metadata read; after that, decoding or the fallback waveform should continue.
    const timeout = setTimeout(() => finish(0), 2000);
    audio.preload = 'metadata'; audio.onloadedmetadata = () => finish(audio.duration || 0); audio.onerror = () => finish(0); audio.src = url;
  });
}
function makeFallbackWaveform() { return []; }

// Keep the complete edit registered until its file picker, reads and analysis
// finish, so switching albums or closing waits before taking the save snapshot.
function addFiles(fileList, nativePaths = [], savedTracks = [], destination = 'tracks') { return runPendingEdit(() => addFilesImpl(fileList, nativePaths, savedTracks, destination)); }
async function addFilesImpl(fileList, nativePaths = [], savedTracks = [], destination = 'tracks') {
  const generation = state.sessionGeneration;
  // Filter complete records so a rejected file cannot shift another file's path or notes.
  const records = [...fileList].map((file, index) => ({ file, path: nativePaths[index], saved: savedTracks[index] || {} }))
    .filter(({ file }) => file.type.startsWith('audio/') || /\.(wav|aif|aiff|flac|mp3|m4a|aac|ogg|opus)$/i.test(file.name));
  if (!records.length) { setStatus('no supported audio files found'); return []; }
  setStatus('analysing files');
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (generation !== state.sessionGeneration) return [];
  const collection = destination === 'materials' ? state.materials : destination === 'references' ? state.references : state.tracks;
  const addedTracks = []; const analysisProblems = []; recordHistory();
  for (const [index, { file, path, saved }] of records.entries()) {
    if (generation !== state.sessionGeneration) break;
    const track = createTrack(file, path || null);
    Object.assign(track, { id: saved.id || track.id, status: saved.status || '', notes: saved.notes || '', trackedNotes: saved.trackedNotes || [], name: saved.name || track.name });
    collection.push(track); pendingAudioSources.delete(track.objectUrl); addedTracks.push(track);
    setStatus(`analysing ${index + 1} of ${records.length}`); render();
    await Promise.all([analyseTrack(track), destination === 'references' ? extractEmbeddedArtwork(track) : Promise.resolve()]);
    if (generation !== state.sessionGeneration) break;
    if (track.analysisState !== 'ready') analysisProblems.push(track.name);
    reconcileTransitionPlacements(); render();
  }
  if (generation !== state.sessionGeneration) { releaseUnusedAudioSources(addedTracks); return []; }
  markUnsaved();
  if (analysisProblems.length) setStatus(`${analysisProblems.length} track ${analysisProblems.length === 1 ? 'needs' : 'need'} analysis attention`);
  return addedTracks;
}

// Desktop selections expose a safe app-local asset URL which the browser can decode for the waveform view.
function addNativePaths(paths, savedTracks = [], destination = 'tracks') { return runPendingEdit(() => addNativePathsImpl(paths, savedTracks, destination)); }
async function addNativePathsImpl(paths, savedTracks = [], destination = 'tracks') {
  const generation = state.sessionGeneration; const files = []; const usablePaths = []; const usableSavedTracks = [];
  for (const [index, path] of paths.entries()) {
    if (generation !== state.sessionGeneration) return [];
    try {
      const response = await fetch(desktop.convertFileSrc(path));
      if (!response.ok) throw new Error(`The app could not read this file (${response.status}).`);
      const blob = await response.blob();
      if (generation !== state.sessionGeneration) return [];
      files.push(new File([blob], baseName(path), { type: response.headers.get('content-type') || 'audio/*' }));
      usablePaths.push(path); usableSavedTracks.push(savedTracks[index] || {});
    } catch (error) {
      if (generation === state.sessionGeneration) setStatus(`could not open ${baseName(path)}`, 'error', error);
    }
  }
  if (!files.length || generation !== state.sessionGeneration) return [];
  return addFiles(files, usablePaths, usableSavedTracks, destination);
}

// Replacing a file creates a fresh analysis record but deliberately preserves the album decisions attached to its row.
function replaceTrackAudio(trackId, file, nativePath = null) { return runPendingEdit(() => replaceTrackAudioImpl(trackId, file, nativePath)); }
async function replaceTrackAudioImpl(trackId, file, nativePath = null) {
  const generation = state.sessionGeneration; const existing = state.tracks.find((track) => track.id === trackId);
  if (!existing || !file) return;
  // Analyse a candidate before changing the album. A bad replacement must not
  // discard the working source or overwrite decisions made while decoding.
  const replacement = createTrack(file, nativePath); setStatus('analysing replacement');
  await analyseTrack(replacement);
  if (generation !== state.sessionGeneration || !state.tracks.includes(existing)) { releaseUnusedAudioSources([replacement]); return; }
  if (replacement.analysisState !== 'ready') { releaseUnusedAudioSources([replacement]); return; }
  recordHistory(); pauseTransitionPlayback();
  Object.assign(replacement, { id: existing.id, name: existing.name, status: existing.status, notes: existing.notes, trackedNotes: (existing.trackedNotes || []).map((entry) => ({ ...entry })) });
  const wasCurrent = state.currentTrackId === trackId;
  if (wasCurrent) { elements.audioPlayer.pause(); elements.audioPlayer.removeAttribute('src'); }
  state.tracks.splice(state.tracks.indexOf(existing), 1, replacement); pendingAudioSources.delete(replacement.objectUrl);
  const movedClips = reconcileTransitionPlacements();
  if (wasCurrent) cueTrack(replacement.id, 0, false);
  state.albumSpectrogram = null; state.albumSpectrogramSignature = '';
  markUnsaved(); render(); releaseUnusedAudioSources();
  if (movedClips) setStatus(`moved ${movedClips} later ${movedClips === 1 ? 'clip' : 'clips'} to make room for the longer audio`);
}

function replaceTrackFromNativePath(trackId, path) { return runPendingEdit(() => replaceTrackFromNativePathImpl(trackId, path)); }
async function replaceTrackFromNativePathImpl(trackId, path) {
  const generation = state.sessionGeneration;
  try {
    const response = await fetch(desktop.convertFileSrc(path));
    if (!response.ok) throw new Error(`The app could not read this file (${response.status}).`);
    const file = new File([await response.blob()], baseName(path), { type: response.headers.get('content-type') || 'audio/*' });
    if (generation === state.sessionGeneration) await replaceTrackAudio(trackId, file, path);
  } catch (error) { if (generation === state.sessionGeneration) setStatus(`could not open ${baseName(path)}`, 'error', error); }
}

function chooseReplacementAudio(trackId) { return runPendingEdit(() => chooseReplacementAudioImpl(trackId)); }
async function chooseReplacementAudioImpl(trackId) {
  if (isDesktop()) {
    const selected = await desktop.open({ multiple: false, filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus'] }] });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) await replaceTrackFromNativePath(trackId, path);
    return;
  }
  state.replacingTrackId = trackId; elements.replaceAudioInput.value = ''; elements.replaceAudioInput.click();
}

function render() {
  renderTrackList(); renderMaterialsList(); renderReferencesList(); renderAlbumNotes(); renderAlbumReadout(); drawAlbumWaveform(); renderTransitionLayout();
  // The hidden attribute needs matching CSS because the overlay itself uses display:grid.
  elements.albumEmpty.hidden = state.tracks.length > 0;
  syncPlaybackControls();
  if (state.isTrackedNotesView) renderNoteTakingTrackList();
  if (elements.albumSpectrogramPanel.open) ensureAlbumSpectrogram();
}

// The transition editor deliberately remains separate from the numbered track
// list. It is a listening layout: moving a clip here never renames, trims, or
// rewrites its source file.
function renderTransitionLayout() {
  ensureTransitionPlacements();
  const duration = transitionLayoutDuration();
  elements.transitionTimeline.style.width = `${Math.max(1, state.transitionZoom) * 100}%`;
  elements.transitionTimeline.querySelectorAll('.transition-clip').forEach((clip) => clip.remove());
  elements.transitionEmpty.hidden = state.transitionPlacements.length > 0;
  elements.transitionReadout.textContent = `${formatTime(state.transitionPlayhead)} / ${formatTime(duration)}`;
  elements.transitionZoom.value = String(state.transitionZoom);

  state.transitionPlacements.forEach((placement) => {
    const track = transitionSource(placement.trackId);
    if (!track) return;
    const clip = document.createElement('article'); clip.className = 'transition-clip'; clip.dataset.placementId = placement.id;
    // Clips remain ordinary timeline items, with the same edit commands also
    // available to someone using a keyboard or screen reader.
    clip.tabIndex = 0; clip.setAttribute('role', 'button');
    clip.setAttribute('aria-label', `${track.name}, lane ${placement.lane + 1}, starts at ${placement.start.toFixed(2)} seconds`);
    clip.setAttribute('aria-pressed', String(placement.id === state.transitionSelectedId));
    clip.title = 'Enter or Space selects. Left/Right moves 0.25 seconds (Shift: 1 second). Up/Down changes lane.';
    clip.setAttribute('aria-keyshortcuts', 'Enter Space ArrowLeft ArrowRight ArrowUp ArrowDown');
    clip.addEventListener('keydown', (event) => handleTransitionKeys(event, placement));
    clip.classList.toggle('is-selected', placement.id === state.transitionSelectedId);
    clip.style.left = `${duration ? (placement.start / duration) * 100 : 0}%`;
    clip.style.width = `${duration ? ((track.duration || 0) / duration) * 100 : 0}%`;
    const name = document.createElement('span'); name.className = 'transition-clip-name'; name.textContent = track.name;
    const waveform = document.createElement('canvas'); waveform.className = 'transition-clip-waveform'; waveform.setAttribute('aria-hidden', 'true');
    const fadeIn = document.createElement('span'); fadeIn.className = 'transition-fade transition-fade--in'; fadeIn.style.width = `${track.duration ? Math.min(100, (placement.fadeIn / track.duration) * 100) : 0}%`;
    const fadeOut = document.createElement('span'); fadeOut.className = 'transition-fade transition-fade--out'; fadeOut.style.width = `${track.duration ? Math.min(100, (placement.fadeOut / track.duration) * 100) : 0}%`;
    clip.append(waveform, fadeIn, fadeOut, name);
    clip.addEventListener('pointerdown', (event) => beginTransitionDrag(event, placement, clip));
    elements.transitionTimeline.querySelector(`[data-lane="${placement.lane}"]`).append(clip);
    drawTransitionClipWaveform(waveform, track);
  });

  updateTransitionPlayhead();
  renderTransitionInspector();
  syncTransitionControls();
}

function focusTransitionClip(id) {
  [...elements.transitionTimeline.querySelectorAll('.transition-clip')].find((clip) => clip.dataset.placementId === id)?.focus();
}
function handleTransitionKeys(event, placement) {
  if (!['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault(); event.stopPropagation();
  state.transitionSelectedId = placement.id;
  if (event.key === 'Enter' || event.key === ' ') { renderTransitionLayout(); focusTransitionClip(placement.id); return; }
  const previous = { start: placement.start, lane: placement.lane };
  const step = event.shiftKey ? 1 : .25;
  const start = event.key === 'ArrowLeft' ? Math.max(0, placement.start - step) : event.key === 'ArrowRight' ? placement.start + step : placement.start;
  const lane = event.key === 'ArrowUp' ? Math.max(0, placement.lane - 1) : event.key === 'ArrowDown' ? Math.min(2, placement.lane + 1) : placement.lane;
  if (start === placement.start && lane === placement.lane) return;
  recordHistory(); placement.start = start; placement.lane = lane;
  if (placementOverlapsLane(placement)) {
    Object.assign(placement, previous); setStatus('clips in one lane cannot overlap', 'error');
  } else {
    applyAutomaticTransitionFades(placement); markUnsaved();
    setStatus(`clip moved to lane ${placement.lane + 1}, ${placement.start.toFixed(2)} seconds`);
  }
  renderTransitionLayout(); focusTransitionClip(placement.id);
}

function drawTransitionClipWaveform(canvas, track) {
  const { context, width, height } = prepareCanvas(canvas); context.clearRect(0, 0, width, height);
  drawEnvelope(context, track.waveform.length ? track.waveform : makeFallbackWaveform(track.name), 0, width, height, false, true);
}

function renderTransitionInspector() {
  const placement = state.transitionPlacements.find((item) => item.id === state.transitionSelectedId);
  const track = placement ? transitionSource(placement.trackId) : null;
  elements.transitionInspector.hidden = !placement || !track;
  if (!placement || !track) return;
  const fadeMaximum = Math.max(1, Math.min(120, track.duration || 1));
  elements.transitionSelectedName.textContent = track.name; elements.transitionSelectedStart.textContent = formatTime(placement.start); elements.transitionLaneSelect.value = String(placement.lane);
  elements.transitionFadeIn.max = String(fadeMaximum); elements.transitionFadeIn.value = String(Math.min(fadeMaximum, placement.fadeIn)); elements.transitionFadeInValue.textContent = `${placement.fadeIn.toFixed(1)}s`;
  elements.transitionFadeOut.max = String(fadeMaximum); elements.transitionFadeOut.value = String(Math.min(fadeMaximum, placement.fadeOut)); elements.transitionFadeOutValue.textContent = `${placement.fadeOut.toFixed(1)}s`;
  elements.transitionRemoveOverlayButton.hidden = !placement.isOverlay;
}

function updateTransitionPlayhead() {
  const duration = transitionLayoutDuration();
  elements.transitionPlayhead.style.left = `${duration ? Math.max(0, Math.min(100, (state.transitionPlayhead / duration) * 100)) : 0}%`;
  elements.transitionReadout.textContent = `${formatTime(state.transitionPlayhead)} / ${formatTime(duration)}`;
}

function syncTransitionControls() {
  const empty = state.transitionPlacements.length === 0;
  elements.transitionStartButton.disabled = empty; elements.transitionPlayButton.disabled = empty; elements.transitionPauseButton.disabled = empty;
  elements.transitionPlayButton.classList.toggle('is-active', state.transitionIsPlaying);
}

function transitionPlacementEnd(placement) {
  return placement.start + (transitionSource(placement.trackId)?.duration || 0);
}
function placementOverlapsLane(placement, lane = placement.lane) {
  const start = placement.start; const end = transitionPlacementEnd(placement);
  return state.transitionPlacements.some((other) => other.id !== placement.id && other.lane === lane && start < transitionPlacementEnd(other) && end > other.start);
}

function beginTransitionDrag(event, placement, clip) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation(); recordHistory();
  state.transitionSelectedId = placement.id;
  state.transitionDrag = { placementId: placement.id, pointerX: event.clientX, originalStart: placement.start, originalLane: placement.lane, originalDuration: transitionLayoutDuration(), moved: false };
  clip.classList.add('is-dragging', 'is-selected'); clip.setPointerCapture(event.pointerId);
  renderTransitionInspector();

  const move = (moveEvent) => {
    if (!state.transitionDrag || state.transitionDrag.placementId !== placement.id) return;
    const timelineRect = elements.transitionTimeline.getBoundingClientRect(); const duration = state.transitionDrag.originalDuration;
    const change = ((moveEvent.clientX - state.transitionDrag.pointerX) / Math.max(1, timelineRect.width)) * duration;
    placement.start = Math.max(0, state.transitionDrag.originalStart + change);
    const laneNodes = [...elements.transitionTimeline.querySelectorAll('.transition-lane')];
    const hoveredLane = laneNodes.findIndex((lane) => { const rect = lane.getBoundingClientRect(); return moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom; });
    if (hoveredLane >= 0) placement.lane = hoveredLane;
    state.transitionDrag.moved ||= Math.abs(change) > .05 || placement.lane !== state.transitionDrag.originalLane;
    clip.style.left = `${duration ? (placement.start / duration) * 100 : 0}%`;
    if (hoveredLane >= 0 && clip.parentElement !== laneNodes[hoveredLane]) laneNodes[hoveredLane].append(clip);
    elements.transitionSelectedStart.textContent = formatTime(placement.start); elements.transitionLaneSelect.value = String(placement.lane);
  };
  const finish = () => {
    clip.removeEventListener('pointermove', move); clip.removeEventListener('pointerup', finish); clip.removeEventListener('pointercancel', cancel);
    const drag = state.transitionDrag; state.transitionDrag = null;
    if (!drag) return;
    if (placementOverlapsLane(placement)) {
      placement.start = drag.originalStart; placement.lane = drag.originalLane;
      setStatus('clips in one lane cannot overlap', 'error');
    } else if (drag.moved) {
      applyAutomaticTransitionFades(placement); markUnsaved();
    }
    renderTransitionLayout();
  };
  const cancel = () => {
    const drag = state.transitionDrag; state.transitionDrag = null;
    if (drag) { placement.start = drag.originalStart; placement.lane = drag.originalLane; }
    renderTransitionLayout();
  };
  clip.addEventListener('pointermove', move); clip.addEventListener('pointerup', finish); clip.addEventListener('pointercancel', cancel);
}

// When a newly moved clip crosses another lane, a matching linear crossfade is
// a useful starting point. Existing hand-set fades are respected.
function applyAutomaticTransitionFades(movedPlacement) {
  state.transitionPlacements.forEach((other) => {
    if (other.id === movedPlacement.id || other.lane === movedPlacement.lane) return;
    const earlier = other.start <= movedPlacement.start ? other : movedPlacement;
    const later = earlier === other ? movedPlacement : other;
    const overlap = transitionPlacementEnd(earlier) - later.start;
    if (overlap <= 0) return;
    const earlierTrack = transitionSource(earlier.trackId); const laterTrack = transitionSource(later.trackId);
    const fade = Math.max(0, Math.min(overlap, earlierTrack?.duration || 0, laterTrack?.duration || 0, 120));
    if (!earlier.fadeOut) earlier.fadeOut = fade;
    if (!later.fadeIn) later.fadeIn = fade;
  });
}

function transitionGain(placement, track, position) {
  const local = position - placement.start; let gain = 1;
  if (placement.fadeIn > 0) gain = Math.min(gain, Math.max(0, local / placement.fadeIn));
  const remaining = track.duration - local;
  if (placement.fadeOut > 0) gain = Math.min(gain, Math.max(0, remaining / placement.fadeOut));
  return Math.max(0, Math.min(1, gain));
}

// Each lane is allowed one active clip. Media elements retain the Mac's native
// output route while their own volume properties create the transition fades.
function syncTransitionAudio(position, shouldPlay = state.transitionIsPlaying) {
  const masterVolume = Number(elements.albumVolume.value) / 100;
  elements.transitionPlayers.forEach((player, lane) => {
    const placement = state.transitionPlacements.find((item) => item.lane === lane && position >= item.start && position < transitionPlacementEnd(item));
    const track = placement ? transitionSource(placement.trackId) : null;
    if (!placement || !track) { player.pause(); player.volume = 0; delete player.dataset.placementId; return; }
    const localTime = Math.max(0, Math.min(Math.max(0, track.duration - .01), position - placement.start));
    if (player.dataset.sourceUrl !== track.objectUrl) {
      player.pause(); player.src = track.objectUrl; player.dataset.trackId = track.id; player.dataset.sourceUrl = track.objectUrl; player.load();
      const sourceUrl = track.objectUrl;
      const setInitialPosition = () => { if (player.dataset.sourceUrl === sourceUrl) player.currentTime = localTime; };
      setInitialPosition(); player.addEventListener('loadedmetadata', setInitialPosition, { once: true });
    } else if (Math.abs(player.currentTime - localTime) > .35) player.currentTime = localTime;
    player.dataset.placementId = placement.id;
    player.volume = masterVolume * transitionGain(placement, track, position);
    if (shouldPlay && player.paused && player.dataset.playPending !== track.objectUrl) {
      const sourceUrl = track.objectUrl; const generation = state.sessionGeneration;
      player.dataset.playPending = sourceUrl;
      player.play().catch((error) => {
        // Changing sources or deliberately pausing can reject a pending Play.
        // Only a failure for the still-active preview should interrupt it.
        if (generation !== state.sessionGeneration || player.dataset.sourceUrl !== sourceUrl || !state.transitionIsPlaying || error.name === 'AbortError') return;
        pauseTransitionPlayback(); setStatus(`could not play transition lane ${lane + 1}`, 'error', error);
      }).finally(() => { if (player.dataset.playPending === sourceUrl) delete player.dataset.playPending; });
    } else if (!shouldPlay) player.pause();
  });
}

function pauseTransitionPlayback() {
  state.transitionIsPlaying = false;
  if (state.transitionAnimation) cancelAnimationFrame(state.transitionAnimation);
  clearTimeout(transitionTickTimer); transitionTickTimer = null;
  state.transitionAnimation = null; elements.transitionPlayers.forEach((player) => player.pause()); syncTransitionControls();
}
function seekTransitionPlayback(position) {
  const duration = transitionLayoutDuration(); state.transitionPlayhead = Math.max(0, Math.min(duration, position));
  if (state.transitionIsPlaying) state.transitionStartedAt = performance.now() - state.transitionPlayhead * 1000;
  syncTransitionAudio(state.transitionPlayhead, state.transitionIsPlaying); updateTransitionPlayhead();
}
function playTransitionLayout() {
  if (!state.transitionPlacements.length || state.transitionIsPlaying) return;
  elements.audioPlayer.pause();
  const duration = transitionLayoutDuration(); if (state.transitionPlayhead >= duration) state.transitionPlayhead = 0;
  state.transitionIsPlaying = true; state.transitionStartedAt = performance.now() - state.transitionPlayhead * 1000;
  const tick = () => {
    if (!state.transitionIsPlaying) return;
    state.transitionPlayhead = (performance.now() - state.transitionStartedAt) / 1000;
    if (state.transitionPlayhead >= transitionLayoutDuration()) { state.transitionPlayhead = transitionLayoutDuration(); pauseTransitionPlayback(); updateTransitionPlayhead(); return; }
    syncTransitionAudio(state.transitionPlayhead, true); updateTransitionPlayhead();
    // Sound scheduling must not rely on animation frames, which stop when a
    // window is hidden. Browser timer throttling still limits exact timing.
    transitionTickTimer = setTimeout(tick, 25);
  };
  tick(); syncTransitionControls();
}

function updateSelectedTransitionFade(kind, value) {
  const placement = state.transitionPlacements.find((item) => item.id === state.transitionSelectedId); if (!placement) return;
  placement[kind] = Math.max(0, Number(value) || 0);
  const output = kind === 'fadeIn' ? elements.transitionFadeInValue : elements.transitionFadeOutValue; output.textContent = `${placement[kind].toFixed(1)}s`;
  const clip = elements.transitionTimeline.querySelector(`[data-placement-id="${placement.id}"]`); const track = transitionSource(placement.trackId);
  const line = clip?.querySelector(kind === 'fadeIn' ? '.transition-fade--in' : '.transition-fade--out');
  if (line && track?.duration) line.style.width = `${Math.min(100, (placement[kind] / track.duration) * 100)}%`;
  markUnsaved();
}
function noteHasContent(note) { const holder = document.createElement('div'); holder.innerHTML = noteHtml(note); return Boolean(holder.textContent.trim()); }
function renderTrackList() {
  elements.trackList.replaceChildren();
  state.tracks.forEach((track, index) => {
    const node = elements.trackTemplate.content.firstElementChild.cloneNode(true); node.dataset.id = track.id;
    const titleInput = node.querySelector('.track-name'); const statusSelect = node.querySelector('.track-status'); const waveformCanvas = node.querySelector('.track-waveform'); const notesInput = node.querySelector('.track-notes-input');
    node.querySelector('.track-number').textContent = String(index + 1).padStart(2, '0'); titleInput.value = track.name;
    node.querySelector('.duration').textContent = formatTime(track.duration); node.querySelector('.lufs').textContent = formatLufs(track); node.querySelector('.peak').textContent = formatPeak(track); statusSelect.value = track.status; statusSelect.classList.toggle('has-status', Boolean(track.status));
    if (track.analysisMessage) node.querySelector('.track-metrics').title = track.analysisMessage;
    node.classList.toggle('is-current', track.id === state.currentTrackId); node.querySelector('.track-play').addEventListener('click', () => toggleTrackPlayback(track.id)); node.querySelector('.replace-track').addEventListener('click', () => chooseReplacementAudio(track.id)); node.querySelector('.shelve-track').addEventListener('click', () => moveTrackToMaterials(track.id)); node.querySelector('.remove-track').addEventListener('click', () => removeTrack(track.id));
    waveformCanvas.addEventListener('click', (event) => seekTrackFromCanvas(track, event));
    titleInput.addEventListener('beforeinput', recordHistory); titleInput.addEventListener('input', () => { track.name = titleInput.value; if (track.id === state.currentTrackId) elements.nowPlaying.textContent = track.name || 'Untitled track'; markUnsaved(); });
    titleInput.addEventListener('blur', () => { if (!track.name.trim()) { track.name = 'Untitled track'; titleInput.value = track.name; } });
    titleInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') titleInput.blur(); if (event.key === 'Escape') { titleInput.value = track.name; titleInput.blur(); } });
    statusSelect.addEventListener('pointerdown', recordHistory); statusSelect.addEventListener('change', (event) => { track.status = event.target.value; statusSelect.classList.toggle('has-status', Boolean(track.status)); markUnsaved(); });
    notesInput.innerHTML = noteHtml(track.notes); const noteIndicator = node.querySelector('.track-note-indicator'); noteIndicator.hidden = !noteHasContent(track.notes) && !(track.trackedNotes || []).length; renderTrackedNoteLog(node.querySelector('.tracked-note-log'), track); notesInput.addEventListener('beforeinput', recordHistory); notesInput.addEventListener('input', () => { track.notes = noteValue(notesInput); noteIndicator.hidden = !noteHasContent(track.notes) && !(track.trackedNotes || []).length; markUnsaved(); }); bindNotepadToolbar(node.querySelector('.track-notes-tools'), notesInput); setupReorderEvents(node);
    elements.trackList.append(node); drawTrackWaveform(waveformCanvas, track);
  });
  elements.trackCount.textContent = String(state.tracks.length).padStart(2, '0');
  elements.trackInstruction.textContent = state.tracks.length ? 'Drag the dotted handle to change the sequence.' : 'Drop tracks here or use the plus button.';
}

// Listening notes stay as simple data rather than editor HTML, which makes their saved time and track unambiguous.
function renderTrackedNoteLog(container, track) {
  container.replaceChildren();
  (track.trackedNotes || []).forEach((entry) => {
    const row = document.createElement('div'); row.className = 'tracked-note-row';
    const seek = document.createElement('button'); seek.type = 'button'; seek.textContent = formatTime(entry.seconds); seek.title = 'Play from this note'; seek.addEventListener('click', () => playTrack(track.id, entry.seconds, false));
    const text = document.createElement('p'); text.textContent = entry.text;
    row.append(seek, text); container.append(row);
  });
}

function renderMaterialsList() {
  elements.materialsList.replaceChildren();
  state.materials.forEach((track) => {
    const node = elements.materialTemplate.content.firstElementChild.cloneNode(true); node.dataset.id = track.id;
    const titleInput = node.querySelector('.material-name'); titleInput.value = track.name;
    titleInput.addEventListener('beforeinput', recordHistory); titleInput.addEventListener('input', () => { track.name = titleInput.value; markUnsaved(); });
    titleInput.addEventListener('blur', () => { if (!track.name.trim()) { track.name = 'Untitled material'; titleInput.value = track.name; } });
    node.querySelector('.material-duration').textContent = formatTime(track.duration); node.querySelector('.material-lufs').textContent = `${formatLufs(track)} LUFS`;
    node.querySelector('.restore-material').addEventListener('click', () => moveMaterialToTracks(track.id)); node.querySelector('.remove-material').addEventListener('click', () => removeMaterial(track.id));
    elements.materialsList.append(node); drawTrackWaveform(node.querySelector('.material-waveform'), track, false);
  });
  elements.materialCount.textContent = String(state.materials.length).padStart(2, '0');
}
function renderReferencesList() {
  elements.referencesList.replaceChildren();
  state.references.forEach((track) => {
    const node = elements.referenceTemplate.content.firstElementChild.cloneNode(true); node.dataset.id = track.id;
    const referenceTime = track.id === state.currentReferenceId ? elements.audioPlayer.currentTime : 0; node.querySelector('.reference-name').textContent = track.name; node.querySelector('.reference-position').textContent = `${formatTime(referenceTime)} / ${formatTime(track.duration)}`; node.querySelector('.reference-lufs').textContent = `${formatLufs(track)} LUFS`; node.querySelector('.reference-peak').textContent = `PEAK ${formatPeak(track)}`;
    const artwork = node.querySelector('.reference-artwork-image'); if (track.artworkUrl) { artwork.src = track.artworkUrl; artwork.hidden = false; node.querySelector('.reference-artwork-fallback').hidden = true; }
    node.querySelector('.reference-play').addEventListener('click', () => toggleReferencePlayback(track.id)); node.querySelector('.remove-reference').addEventListener('click', () => removeReference(track.id)); node.querySelector('.reference-waveform').addEventListener('click', (event) => { const rect = event.currentTarget.getBoundingClientRect(); playReference(track.id, Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * track.duration); });
    elements.referencesList.append(node); drawTrackWaveform(node.querySelector('.reference-waveform'), track);
  });
  elements.referenceCount.textContent = String(state.references.length).padStart(2, '0');
}
function renderAlbumNotes() {
  elements.albumNoteLog.replaceChildren();
  state.albumNoteEntries.forEach((entry, index) => {
    const node = document.createElement('details'); node.className = 'album-note-entry';
    const summary = document.createElement('summary'); const label = document.createElement('span'); const date = document.createElement('span'); label.textContent = `note ${String(index + 1).padStart(2, '0')}`; date.textContent = new Date(entry.createdAt).toLocaleString(); summary.append(label, date);
    const content = document.createElement('div'); content.className = 'album-note-content'; content.innerHTML = noteHtml(entry.content);
    // Logged prose is read-only, but its task checkboxes remain useful and must
    // save their state just like checkboxes in a track's editable notes.
    content.querySelectorAll('[contenteditable]').forEach((element) => element.removeAttribute('contenteditable'));
    content.addEventListener('pointerdown', (event) => { if (event.target.matches('.note-checkbox')) recordHistory(); });
    content.addEventListener('keydown', (event) => { if (event.target.matches('.note-checkbox') && event.key === ' ') recordHistory(); });
    content.addEventListener('change', (event) => {
      if (!event.target.matches('.note-checkbox')) return;
      event.target.toggleAttribute('checked', event.target.checked);
      event.target.closest('.checklist-item')?.classList.toggle('is-checked', event.target.checked);
      entry.content = noteValue(content); markUnsaved();
    });
    node.append(summary, content); elements.albumNoteLog.append(node);
  });
}
function saveAlbumNote() {
  const content = noteValue(elements.albumNotesInput); if (!noteHasContent(content)) return;
  recordHistory(); state.albumNoteEntries.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), content }); elements.albumNotesInput.innerHTML = ''; markUnsaved(); renderAlbumNotes();
}
function formatLufs(track) { if (Number.isFinite(track.lufsEstimate)) return track.lufsEstimate.toFixed(1); if (track.analysisState === 'analysing') return 'analysing'; if (track.analysisState === 'unavailable' || track.analysisState === 'partial') return 'error'; if (track.duration > 0 && track.duration < .4) return 'too short'; return 'silence'; }
function formatPeak(track) { if (Number.isFinite(track.peakDb)) return `${track.peakDb.toFixed(1)} dB`; if (track.analysisState === 'analysing') return 'analysing'; if (track.analysisState === 'unavailable') return 'error'; return 'silence'; }
function renderAlbumReadout() {
  const total = getTotalDuration(); const measured = state.tracks.filter((track) => Number.isFinite(track.lufsEstimate)); const peaks = state.tracks.map((track) => track.peakDb).filter(Number.isFinite);
  const averageLufs = measured.length ? measured.reduce((sum, track) => sum + track.lufsEstimate, 0) / measured.length : null;
  elements.albumSummary.textContent = state.tracks.length ? `${state.tracks.length} ${state.tracks.length === 1 ? 'track' : 'tracks'} · ${formatTime(total)}` : '0 tracks · 00:00 · no audio loaded';
  elements.runtimeMetric.textContent = formatTime(total); elements.trackMetric.textContent = String(state.tracks.length).padStart(2, '0'); elements.lufsMetric.textContent = averageLufs === null ? '—' : averageLufs.toFixed(1); elements.peakMetric.textContent = peaks.length ? `${Math.max(...peaks).toFixed(1)} dB` : '—';
  if (!state.currentReferenceId) { const current = state.tracks.find((track) => track.id === state.currentTrackId); const elapsed = current ? getTrackStart(current.id) + elements.audioPlayer.currentTime : 0; elements.positionReadout.textContent = `${formatTime(elapsed)} / ${formatTime(total)}`; elements.trackListPositionReadout.textContent = current ? `${formatTime(elements.audioPlayer.currentTime)} / ${formatTime(current.duration)}` : '00:00 / 00:00'; }
  elements.albumRuler.replaceChildren(...(total ? [0, .25, .5, .75, 1].map((fraction) => { const tick = document.createElement('span'); tick.textContent = formatTime(total * fraction); return tick; }) : []));
}
// Canvas buffers are only resized when their on-screen size changes. Reallocating
// every playback tick can create a surprising amount of main-thread pressure.
function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(rect.width * ratio)); const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}
function getCssVariable(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }

// Native media-element volume keeps the sound path simple and lets macOS follow
// the active speakers or audio interface without a separate Web Audio output graph.
function applyAlbumVolume() {
  const volume = Number(elements.albumVolume.value) / 100;
  elements.albumVolume.style.setProperty('--volume-fill', `${Math.round(volume * 100)}%`);
  elements.audioPlayer.volume = volume;
  // Transition lanes receive the same album-wide setting, with their individual
  // fade envelopes applied on top.
  if (state.transitionPlacements.length) syncTransitionAudio(state.transitionPlayhead, state.transitionIsPlaying);
}

function updateReferencePosition() {
  const track = state.references.find((item) => item.id === state.currentReferenceId); if (!track) return;
  const row = document.querySelector(`.reference-row[data-id="${track.id}"]`); const position = row?.querySelector('.reference-position');
  if (position) position.textContent = `${formatTime(elements.audioPlayer.currentTime)} / ${formatTime(track.duration)}`;
}

// This visual meter reads the already-analysed waveform rather than inserting an
// audio-processing node between the file and the operating system's output device.
function startLevelMeter() {
  if (state.meterAnimation) return;
  const update = () => {
    const target = getPlaybackMeterTarget(); state.meterLevel = target > state.meterLevel ? state.meterLevel + (target - state.meterLevel) * .24 : state.meterLevel * .92; elements.levelMeterFill.style.height = `${Math.round(state.meterLevel * 100)}%`;
    if (elements.audioPlayer.paused && state.meterLevel < .01) { elements.levelMeterFill.style.height = '0%'; state.meterAnimation = null; return; }
    state.meterAnimation = requestAnimationFrame(update);
  };
  state.meterAnimation = requestAnimationFrame(update);
}

function getPlaybackMeterTarget() {
  if (elements.audioPlayer.paused) return 0;
  const track = state.currentTrackId ? state.tracks.find((item) => item.id === state.currentTrackId) : state.references.find((item) => item.id === state.currentReferenceId);
  if (!track?.waveform?.length || !track.duration) return 0;
  const index = Math.min(track.waveform.length - 1, Math.floor((elements.audioPlayer.currentTime / track.duration) * track.waveform.length)); const point = track.waveform[index];
  const peak = Array.isArray(point) ? Math.max(Math.abs(point[0]), Math.abs(point[1])) : Math.abs(point || 0);
  return Math.min(1, peak * 1.65 * (Number(elements.albumVolume.value) / 100));
}
function drawTrackWaveform(canvas, track, showProgress = true) {
  const { context, width, height } = prepareCanvas(canvas); const waveform = track.waveform.length ? track.waveform : makeFallbackWaveform(track.name); context.clearRect(0, 0, width, height);
  if (!waveform.length) { context.fillStyle = getCssVariable('--fg-muted'); context.font = '9px IBM Plex Mono, monospace'; context.fillText(track.analysisState === 'analysing' ? 'analysing…' : 'waveform unavailable', 4, Math.max(10, height / 2)); return; }
  drawEnvelope(context, waveform, 0, width, height, false, true);
  const isPlayingTrack = track.id === state.currentTrackId || track.id === state.currentReferenceId;
  if (!showProgress || !isPlayingTrack) return;
  const progress = track.duration ? Math.max(0, Math.min(1, elements.audioPlayer.currentTime / track.duration)) : 0; const playhead = width * progress;
  context.save(); context.beginPath(); context.rect(0, 0, playhead, height); context.clip(); drawEnvelope(context, waveform, 0, width, height, true, true); context.restore();
  context.strokeStyle = getCssVariable('--accent'); context.globalAlpha = .95; context.beginPath(); context.moveTo(playhead + .5, 0); context.lineTo(playhead + .5, height); context.stroke(); context.globalAlpha = 1;
}
function syncAlbumWaveformAccessibility() {
  const total = getTotalDuration();
  const position = state.currentTrackId ? getTrackStart(state.currentTrackId) + elements.audioPlayer.currentTime : 0;
  const bounded = Math.max(0, Math.min(total, position));
  elements.albumWaveform.tabIndex = 0; elements.albumWaveform.setAttribute('role', 'slider');
  elements.albumWaveform.setAttribute('aria-label', 'Album playback position');
  elements.albumWaveform.setAttribute('aria-valuemin', '0'); elements.albumWaveform.setAttribute('aria-valuemax', String(total));
  elements.albumWaveform.setAttribute('aria-valuenow', String(bounded));
  elements.albumWaveform.setAttribute('aria-valuetext', `${formatTime(bounded)} of ${formatTime(total)}`);
  elements.albumWaveform.setAttribute('aria-disabled', String(!state.tracks.length));
  elements.albumWaveform.title = 'Click to play. Left/Right seeks 5 seconds. Home/End goes to the album start/end.';
}
function drawAlbumWaveform() {
  syncAlbumWaveformAccessibility();
  const { context, width, height } = prepareCanvas(elements.albumWaveform); context.clearRect(0, 0, width, height); if (!state.tracks.length) return;
  const total = getTotalDuration() || state.tracks.length; drawAlbumSegments(context, width, height, total, false);
  if (state.currentTrackId) {
    const playhead = Math.max(0, Math.min(width, width * ((getTrackStart(state.currentTrackId) + elements.audioPlayer.currentTime) / total)));
    // Repaint only the completed section in the accent colour, leaving everything after the playhead grey.
    context.save(); context.beginPath(); context.rect(0, 0, playhead, height); context.clip(); drawAlbumSegments(context, width, height, total, true); context.restore();
    context.strokeStyle = getCssVariable('--accent'); context.globalAlpha = .95; context.beginPath(); context.moveTo(playhead + .5, 0); context.lineTo(playhead + .5, height); context.stroke(); context.globalAlpha = 1;
  }
  drawAlbumSeparators(context, width, height, total);
}
function drawBars(context, waveform, startX, availableWidth, height, active) { drawEnvelope(context, waveform, startX, availableWidth, height, active, false); }

function drawAlbumSegments(context, width, height, total, accented) {
  let xOffset = 0;
  state.tracks.forEach((track) => { const trackWidth = width * ((track.duration || 1) / total); drawBars(context, track.waveform.length ? track.waveform : makeFallbackWaveform(track.name), xOffset, trackWidth, height, accented); xOffset += trackWidth; });
}
function drawAlbumSeparators(context, width, height, total) {
  let xOffset = 0; context.strokeStyle = getCssVariable('--border'); context.globalAlpha = 1;
  state.tracks.forEach((track, index) => { if (index > 0) { context.beginPath(); context.moveTo(xOffset, 0); context.lineTo(xOffset, height); context.stroke(); } xOffset += width * ((track.duration || 1) / total); });
}

// The spectrum stays optional because FFT analysis is more expensive than the
// lightweight waveform pass. Its columns use the same windowed FFT method as Music Analyser.
function albumSpectrumSignature() { return state.tracks.map((track) => `${track.id}:${track.sourceId || track.objectUrl}:${track.duration}`).join('|'); }
async function ensureAlbumSpectrogram() {
  const signature = albumSpectrumSignature(); const generation = state.sessionGeneration;
  if (state.albumSpectrogram && state.albumSpectrogramSignature === signature) { drawAlbumSpectrogram(); return; }
  if (state.spectrogramLoading && spectrumPendingSignature === signature) return;
  const request = ++spectrumRequest; spectrumPendingSignature = signature;
  state.albumSpectrogram = null; state.albumSpectrogramSignature = '';
  const canvas = prepareCanvas(elements.albumSpectrogram); canvas.context.clearRect(0, 0, canvas.width, canvas.height);
  elements.albumSpectrogramEmpty.hidden = false;
  const tracks = [...state.tracks];
  if (!tracks.length || tracks.some((track) => track.analysisState === 'analysing')) {
    state.spectrogramLoading = false;
    elements.albumSpectrogramEmpty.textContent = tracks.length ? 'Waiting for track analysis…' : 'Add tracks to view an album spectrogram.';
    return;
  }
  state.spectrogramLoading = true; elements.albumSpectrogramEmpty.textContent = 'Analysing album spectrum…';
  const stillCurrent = () => request === spectrumRequest && generation === state.sessionGeneration && signature === albumSpectrumSignature();
  let context;
  try {
    context = new (window.AudioContext || window.webkitAudioContext)();
    const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0) || 1;
    const columns = Math.min(720, Math.max(260, Math.round(totalDuration * 8))); const rows = 180;
    const values = new Float32Array(columns * rows); values.fill(-160);
    let elapsed = 0; let columnOffset = 0; let peakDb = -160;
    for (const [index, track] of tracks.entries()) {
      if (!stillCurrent()) return;
      const part = await spectrumForTrack(track, context, rows);
      elapsed += track.duration;
      const endColumn = index === tracks.length - 1 ? columns : Math.min(columns, Math.round(columns * elapsed / totalDuration));
      if (!stillCurrent()) return;
      values.set(fitSpectrum(part, Math.max(0, endColumn - columnOffset)), columnOffset * rows); peakDb = Math.max(peakDb, part.peakDb); columnOffset = endColumn;
    }
    if (!stillCurrent()) return;
    state.albumSpectrogram = { values, columns, rows, peakDb }; state.albumSpectrogramSignature = signature;
    elements.albumSpectrogramEmpty.hidden = true; drawAlbumSpectrogram();
  } catch (error) {
    if (stillCurrent()) {
      errorReporter.show('The album spectrogram could not be prepared. Check or replace the unreadable track, then reopen this panel.', error);
      elements.albumSpectrogramEmpty.textContent = 'Spectrum unavailable. Check the audio files and reopen this section to retry.';
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (request === spectrumRequest) state.spectrogramLoading = false;
  }
}

function buildAlbumSpectrogramInWorker(track) {
  return runAudioWorker(() => new Worker(new URL('./spectrogram-worker.js', import.meta.url), { type: 'module' }), track, [...new Set(track.channelData.map((channel) => channel.buffer))], 'Spectrogram analysis');
}

function drawAlbumSpectrogram() {
  if (!state.albumSpectrogram) return;
  const { context, width, height } = prepareCanvas(elements.albumSpectrogram); const { values, columns, rows, peakDb } = state.albumSpectrogram; const imageCanvas = document.createElement('canvas'); imageCanvas.width = columns; imageCanvas.height = rows; const imageContext = imageCanvas.getContext('2d'); const image = imageContext.createImageData(columns, rows); const floor = peakDb - 78; const palette = [[7, 16, 34], [20, 49, 118], [35, 112, 178], [55, 177, 198], [111, 214, 188], [246, 201, 105], [255, 246, 215]];
  for (let column = 0; column < columns; column += 1) for (let row = 0; row < rows; row += 1) { let energy = (values[column * rows + row] - floor) / Math.max(1, peakDb - floor); energy = Math.pow(Math.max(0, Math.min(1, energy)), 1.15); const scaled = energy * (palette.length - 1); const lower = Math.floor(scaled); const upper = Math.min(palette.length - 1, lower + 1); const blend = scaled - lower; const pixel = (row * columns + column) * 4; for (let channel = 0; channel < 3; channel += 1) image.data[pixel + channel] = Math.round(palette[lower][channel] + (palette[upper][channel] - palette[lower][channel]) * blend); image.data[pixel + 3] = 255; }
  imageContext.putImageData(image, 0, 0); context.clearRect(0, 0, width, height); context.drawImage(imageCanvas, 0, 0, width, height);
}

// Each screen column combines all source slices that fall within it. This keeps narrow peaks visible while avoiding the old spaced-out barcode look.
function drawEnvelope(context, waveform, startX, availableWidth, height, active, muted) {
  if (!waveform.length || availableWidth <= 0) return;
  const middle = height / 2; const halfHeight = Math.max(1, height / 2 - (muted ? 1 : 6)); const columns = Math.max(1, Math.floor(availableWidth));
  context.strokeStyle = active ? getCssVariable('--accent') : getCssVariable(muted ? '--fg-muted' : '--fg'); context.globalAlpha = active ? .9 : muted ? .68 : .72; context.lineWidth = .75; context.beginPath();
  for (let column = 0; column < columns; column += 1) {
    const sourceStart = Math.floor((column / columns) * waveform.length); const sourceEnd = Math.max(sourceStart + 1, Math.ceil(((column + 1) / columns) * waveform.length)); let minimum = 0; let maximum = 0;
    for (let index = sourceStart; index < Math.min(sourceEnd, waveform.length); index += 1) { const point = waveform[index]; const low = Array.isArray(point) ? point[0] : -Math.abs(point || 0); const high = Array.isArray(point) ? point[1] : Math.abs(point || 0); minimum = Math.min(minimum, low); maximum = Math.max(maximum, high); }
    const x = startX + column + .5; context.moveTo(x, middle - Math.max(-1, Math.min(1, maximum)) * halfHeight); context.lineTo(x, middle - Math.max(-1, Math.min(1, minimum)) * halfHeight);
  }
  context.stroke(); context.globalAlpha = 1;
}

// Audio events can arrive while the interface is busy. This batches the visual
// work into at most one animation frame and redraws only the waveform that moves.
function schedulePlaybackVisuals() {
  if (state.playbackVisualFrame) return;
  state.playbackVisualFrame = requestAnimationFrame(() => {
    state.playbackVisualFrame = null;
    if (state.currentReferenceId) updateReferencePosition();
    else {
      const position = `${formatTime(state.currentStart + elements.audioPlayer.currentTime)} / ${formatTime(getTotalDuration())}`; const current = state.tracks.find((track) => track.id === state.currentTrackId);
      elements.positionReadout.textContent = position; elements.trackListPositionReadout.textContent = current ? `${formatTime(elements.audioPlayer.currentTime)} / ${formatTime(current.duration)}` : '00:00 / 00:00';
      drawAlbumWaveform();
    }
    redrawActivePlaybackWaveform();
    syncNoteTakingPlayback();
  });
}

function redrawActivePlaybackWaveform() {
  const activeId = state.currentTrackId || state.currentReferenceId; if (!activeId) return;
  const selector = state.currentTrackId ? '.track' : '.reference-row'; const waveformSelector = state.currentTrackId ? '.track-waveform' : '.reference-waveform';
  const track = state.currentTrackId ? state.tracks.find((item) => item.id === activeId) : state.references.find((item) => item.id === activeId);
  const row = document.querySelector(`${selector}[data-id="${activeId}"]`); if (track && row) drawTrackWaveform(row.querySelector(waveformSelector), track);
}

// Preparing the next file early avoids a last-moment disk read at an album boundary.
function preloadNextTrack() {
  const currentIndex = state.tracks.findIndex((track) => track.id === state.currentTrackId);
  const nextTrack = state.isAlbumMode ? state.tracks[currentIndex + 1] : null;
  if (!nextTrack) { elements.audioPreloader.removeAttribute('src'); delete elements.audioPreloader.dataset.sourceUrl; return; }
  if (elements.audioPreloader.dataset.sourceUrl === nextTrack.objectUrl) return;
  elements.audioPreloader.dataset.sourceUrl = nextTrack.objectUrl; elements.audioPreloader.src = nextTrack.objectUrl; elements.audioPreloader.load();
}

function waitForMediaReady() {
  if (elements.audioPlayer.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => { clearTimeout(timeout); elements.audioPlayer.removeEventListener('loadedmetadata', ready); elements.audioPlayer.removeEventListener('error', failed); callback(value); };
    const ready = () => finish(resolve); const failed = () => finish(reject, new Error('Audio file could not be refreshed.'));
    const timeout = setTimeout(() => finish(resolve), 1800);
    elements.audioPlayer.addEventListener('loadedmetadata', ready, { once: true }); elements.audioPlayer.addEventListener('error', failed, { once: true });
  });
}

// When a Mac wakes or its output device changes, a media element can retain an
// old native render route. Refreshing the paused file on the next user Play
// rebuilds that route without making the person close and reopen the app.
async function refreshOutputRouteIfNeeded() {
  if (!state.outputRefreshRequested || !elements.audioPlayer.src || !elements.audioPlayer.paused) return;
  const resumeAt = elements.audioPlayer.currentTime; const source = elements.audioPlayer.src; const generation = state.sessionGeneration; state.outputRefreshRequested = false;
  elements.audioPlayer.load(); await waitForMediaReady().catch(() => {});
  if (generation === state.sessionGeneration && elements.audioPlayer.src === source && Number.isFinite(resumeAt)) elements.audioPlayer.currentTime = resumeAt;
}

async function playMedia() {
  pauseTransitionPlayback();
  const generation = state.sessionGeneration; const source = elements.audioPlayer.src;
  try {
    await refreshOutputRouteIfNeeded();
    if (generation !== state.sessionGeneration || elements.audioPlayer.src !== source) return;
    await elements.audioPlayer.play();
  } catch (error) {
    if (generation === state.sessionGeneration && elements.audioPlayer.src === source && error.name !== 'AbortError') setStatus('playback could not start — try Play again', 'error', error);
  }
}

// Cueing changes the visible playhead but deliberately does not start sound. Transport navigation stays predictable this way.
function cueTrack(trackId, offset = 0, albumMode = false) {
  const track = state.tracks.find((item) => item.id === trackId); if (!track) return;
  pauseTransitionPlayback(); elements.audioPlayer.pause(); state.outputRefreshRequested = false; state.currentReferenceId = null; state.currentTrackId = trackId; state.currentStart = getTrackStart(trackId); state.isAlbumMode = albumMode;
  elements.audioPlayer.src = track.objectUrl;
  const targetTime = Math.min(offset, Math.max(0, track.duration - .01));
  // Some browsers need metadata before accepting a seek, so keep the same target ready for that event too.
  const sourceUrl = track.objectUrl;
  const setPosition = () => { if (elements.audioPlayer.getAttribute('src') === sourceUrl) elements.audioPlayer.currentTime = targetTime; };
  setPosition(); elements.audioPlayer.addEventListener('loadedmetadata', setPosition, { once: true });
  elements.nowPlaying.textContent = track.name; preloadNextTrack(); render();
}
function playTrack(trackId, offset = 0, albumMode = true) { cueTrack(trackId, offset, albumMode); playMedia(); }
function playReference(trackId, offset = 0) {
  const track = state.references.find((item) => item.id === trackId); if (!track) return;
  pauseTransitionPlayback(); elements.audioPlayer.pause(); state.outputRefreshRequested = false; state.currentTrackId = null; state.currentReferenceId = trackId; state.currentStart = 0; state.isAlbumMode = false; elements.audioPlayer.src = track.objectUrl; const sourceUrl = track.objectUrl; const setPosition = () => { if (elements.audioPlayer.getAttribute('src') === sourceUrl) elements.audioPlayer.currentTime = Math.min(offset, Math.max(0, track.duration - .01)); }; setPosition(); elements.audioPlayer.addEventListener('loadedmetadata', setPosition, { once: true }); elements.nowPlaying.textContent = `reference: ${track.name}`; playMedia(); render();
}
function toggleReferencePlayback(trackId) {
  if (state.currentReferenceId === trackId && elements.audioPlayer.src) { if (elements.audioPlayer.paused) playMedia(); else elements.audioPlayer.pause(); return; }
  playReference(trackId);
}
function toggleTrackPlayback(trackId) {
  if (state.currentTrackId === trackId && elements.audioPlayer.src) {
    // A second press pauses, and the next press resumes from the same point instead of restarting.
    state.isAlbumMode = false;
    if (!elements.audioPlayer.paused) elements.audioPlayer.pause(); else playMedia();
    return;
  }
  playTrack(trackId, 0, true);
}

function playAlbumSequence() {
  if (!state.tracks.length) return;
  if (state.currentTrackId && elements.audioPlayer.src) {
    state.isAlbumMode = true;
    if (elements.audioPlayer.paused) playMedia();
    syncPlaybackControls();
    return;
  }
  cueTrack(state.tracks[0].id, 0, true); playMedia();
}

function returnToAlbumStart() {
  if (!state.tracks.length) return;
  cueTrack(state.tracks[0].id, 0, false);
}

// Note-taking's album-start control intentionally arms playlist mode, while the main workspace's cue control remains silent and neutral.
function noteTakingAlbumStart() {
  if (!state.tracks.length) return;
  cueTrack(state.tracks[0].id, 0, true);
}
function noteTakingPlay() {
  // Resume the already selected track exactly as it was configured; only create an album sequence when nothing has been cued yet.
  if (state.currentTrackId && elements.audioPlayer.src) { playMedia(); return; }
  playAlbumSequence();
}

function restartCurrentTrack() {
  if (!state.tracks.length) return;
  cueTrack(state.currentTrackId || state.tracks[0].id, 0, false);
}

function skipToNextTrack() {
  if (!state.tracks.length) return;
  const currentIndex = state.tracks.findIndex((track) => track.id === state.currentTrackId);
  const nextTrack = state.tracks[currentIndex + 1] || (currentIndex < 0 ? state.tracks[0] : null);
  if (!nextTrack) { setStatus('already at the final track'); return; }
  cueTrack(nextTrack.id, 0, false);
}

function syncPlaybackControls() {
  document.querySelectorAll('.track').forEach((row) => { const button = row.querySelector('.track-play'); const isPlaying = row.dataset.id === state.currentTrackId && !elements.audioPlayer.paused; button.textContent = isPlaying ? 'Ⅱ' : '▶'; button.setAttribute('aria-label', isPlaying ? 'Pause track' : 'Play track'); });
  document.querySelectorAll('.reference-row').forEach((row) => { const button = row.querySelector('.reference-play'); const isPlaying = row.dataset.id === state.currentReferenceId && !elements.audioPlayer.paused; button.textContent = isPlaying ? 'Ⅱ' : '▶'; button.setAttribute('aria-label', isPlaying ? 'Pause reference track' : 'Play reference track'); });
  const noTracks = state.tracks.length === 0;
  // A transport button only greys out when there is no album at all. At the last track, Next simply explains that there is nowhere further to cue.
  elements.transportAlbumStartButton.disabled = noTracks;
  elements.transportRestartButton.disabled = noTracks;
  elements.transportPlayButton.disabled = noTracks;
  elements.transportPauseButton.disabled = noTracks;
  elements.transportNextButton.disabled = noTracks;
  syncNoteTakingPlayback();
}
function cueAlbumPosition(albumSeconds, shouldPlay = false) {
  let passed = 0; const position = Math.max(0, Math.min(getTotalDuration(), albumSeconds));
  for (const track of state.tracks) {
    const next = passed + (track.duration || 0);
    if (position < next || track === state.tracks.at(-1)) {
      cueTrack(track.id, Math.max(0, position - passed), true); if (shouldPlay) playMedia(); return;
    }
    passed = next;
  }
}
function playFromAlbumPosition(albumSeconds) { cueAlbumPosition(albumSeconds, true); }
function seekTrackFromCanvas(track, event) { const rect = event.currentTarget.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))); playTrack(track.id, fraction * track.duration, true); }
function removeTrack(trackId) { const index = state.tracks.findIndex((track) => track.id === trackId); if (index < 0) return; recordHistory(); pauseTransitionPlayback(); const [removed] = state.tracks.splice(index, 1); if (state.currentTrackId === trackId) { elements.audioPlayer.pause(); state.currentTrackId = null; elements.nowPlaying.textContent = '—'; } markUnsaved(); render(); }
function moveTrackToMaterials(trackId) {
  const index = state.tracks.findIndex((track) => track.id === trackId); if (index < 0) return; recordHistory(); pauseTransitionPlayback(); const [track] = state.tracks.splice(index, 1); state.materials.push(track);
  if (state.currentTrackId === trackId) { elements.audioPlayer.pause(); state.currentTrackId = null; elements.audioPlayer.removeAttribute('src'); elements.nowPlaying.textContent = '—'; elements.positionReadout.textContent = `00:00 / ${formatTime(getTotalDuration())}`; }
  markUnsaved(); render();
}
function moveMaterialToTracks(trackId) { const index = state.materials.findIndex((track) => track.id === trackId); if (index < 0) return; recordHistory(); const [track] = state.materials.splice(index, 1); state.tracks.push(track); markUnsaved(); render(); }
function removeMaterial(trackId) { const index = state.materials.findIndex((track) => track.id === trackId); if (index < 0) return; recordHistory(); pauseTransitionPlayback(); state.materials.splice(index, 1); markUnsaved(); render(); }
function removeReference(trackId) { const index = state.references.findIndex((track) => track.id === trackId); if (index < 0) return; recordHistory(); const [removed] = state.references.splice(index, 1); if (state.currentReferenceId === trackId) { elements.audioPlayer.pause(); elements.audioPlayer.removeAttribute('src'); state.currentReferenceId = null; elements.nowPlaying.textContent = '—'; } markUnsaved(); render(); }

// Pointer events are more dependable than browser HTML drag-and-drop inside the macOS WebView.
function setupReorderEvents(node) {
  const handle = node.querySelector('.drag-handle');
  handle.tabIndex = 0; handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', `Reorder ${node.querySelector('.track-name').value}`);
  handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown'); handle.title = 'Drag to rearrange, or use Up/Down arrow keys.';
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation();
    const index = state.tracks.findIndex((track) => track.id === node.dataset.id);
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (index < 0 || target < 0 || target >= state.tracks.length) return;
    recordHistory(); const [track] = state.tracks.splice(index, 1); state.tracks.splice(target, 0, track);
    state.currentStart = state.currentTrackId ? getTrackStart(state.currentTrackId) : 0;
    markUnsaved(); render();
    [...elements.trackList.querySelectorAll('.track')].find((row) => row.dataset.id === track.id)?.querySelector('.drag-handle')?.focus();
    setStatus(`track moved to position ${target + 1} of ${state.tracks.length}`);
  });
  const clearDragStyles = () => { document.querySelectorAll('.track').forEach((row) => row.classList.remove('is-dragging', 'is-drop-target', 'is-drop-target-after')); state.draggingId = null; state.dragTargetIndex = null; };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return; event.preventDefault(); state.draggingId = node.dataset.id; state.dragTargetIndex = state.tracks.findIndex((track) => track.id === state.draggingId); node.classList.add('is-dragging'); handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (state.draggingId !== node.dataset.id || !handle.hasPointerCapture(event.pointerId)) return; event.preventDefault();
    const otherRows = [...elements.trackList.querySelectorAll('.track')].filter((row) => row.dataset.id !== state.draggingId); let targetIndex = otherRows.length;
    for (let index = 0; index < otherRows.length; index += 1) { const rect = otherRows[index].getBoundingClientRect(); if (event.clientY < rect.top + rect.height / 2) { targetIndex = index; break; } }
    state.dragTargetIndex = targetIndex;
    otherRows.forEach((row, index) => {
      // Mark both sides of the insertion boundary so moving downward shows the same clear orange line as moving upward.
      row.classList.toggle('is-drop-target', index === targetIndex);
      row.classList.toggle('is-drop-target-after', index === targetIndex - 1);
    });
  });
  handle.addEventListener('pointerup', (event) => {
    if (state.draggingId !== node.dataset.id) return; event.preventDefault(); const originalIndex = state.tracks.findIndex((track) => track.id === state.draggingId); const targetIndex = state.dragTargetIndex;
    if (originalIndex >= 0 && targetIndex !== null) { if (targetIndex !== originalIndex) recordHistory(); const [dragged] = state.tracks.splice(originalIndex, 1); state.tracks.splice(Math.max(0, Math.min(targetIndex, state.tracks.length)), 0, dragged); state.currentStart = state.currentTrackId ? getTrackStart(state.currentTrackId) : 0; if (targetIndex !== originalIndex) markUnsaved(); }
    clearDragStyles(); render();
  });
  handle.addEventListener('pointercancel', clearDragStyles);
}

function serialiseProject() {
  const serialiseTrack = (track) => ({ id: track.id, nativePath: track.nativePath, name: track.name, status: track.status, notes: noteHtml(track.notes || ''), trackedNotes: (track.trackedNotes || []).map((entry) => ({ ...entry })) });
  return { schemaVersion: 2, listeningDraft: getListeningDraft(), id: state.projectId, name: metadata().title, updatedAt: new Date().toISOString(), archived: state.isProjectArchived, metadata: metadata(), releaseCopy: releaseCopyData(), releasePreparation: canonicalPreparation(), albumNotes: noteValue(elements.albumNotesInput), albumNoteEntries: state.albumNoteEntries.map((entry) => ({ ...entry, content: noteHtml(entry.content) })), artworkDataUrl: state.artworkDataUrl, artworkNativePath: state.artworkNativePath, tracks: state.tracks.map(serialiseTrack), materials: state.materials.map(serialiseTrack), references: state.references.map(serialiseTrack), transitionLayout: { placements: state.transitionPlacements.map((placement) => ({ ...placement })) } };
}
function canonicalPreparation() {
  if (!state.preparation) return null;
  return preparationForAlbum({ id: state.projectId, metadata: metadata(), releaseCopy: releaseCopyData(),
    tracks: state.tracks, artworkDataUrl: state.artworkDataUrl, releasePreparation: state.preparation });
}
function preparationContentSignature(project) {
  if (!project) return '';
  const { id, name, updatedAt, ...content } = project;
  return JSON.stringify(content);
}
// Saves share one promise. A caller switching albums waits for the actual disk
// acknowledgement, then flushes any edits made while that write was running.
async function saveProject({ automatic = false } = {}) {
  clearTimeout(state.autoSaveTimer);
  if (state.savePromise) {
    await state.savePromise;
    return state.hasUnsavedChanges ? saveProject({ automatic }) : true;
  }
  const generation = state.sessionGeneration;
  const revision = state.saveRevision;
  const binding = preparationBinding?.generation === generation ? preparationBinding : null;
  const preparationRevision = binding?.api.revision?.() ?? null;
  const project = serialiseProject();
  project.id ||= crypto.randomUUID();
  if (project.releasePreparation) project.releasePreparation.id = project.id;
  state.isSaving = true; setStatus('saving…', 'saving');
  const operation = (async () => {
    if (isDesktop()) {
      if ([...project.tracks, ...project.materials, ...project.references].some((track) => !track.nativePath)) throw new Error('Some audio files have no desktop path. Add them using the desktop file picker before saving.');
      await desktop.invoke('save_project', { project });
    } else {
      const projects = readBrowserProjects().filter((item) => item.id !== project.id);
      projects.unshift(project); localStorage.setItem('album-builder-projects', JSON.stringify(projects));
    }
    if (generation !== state.sessionGeneration) return true;
    state.projectId = project.id;
    state.hasUnsavedChanges = state.saveRevision !== revision;
    if (state.preparation) state.preparation = state.hasUnsavedChanges
      ? { ...state.preparation, id: state.projectId }
      : structuredClone(project.releasePreparation);
    // The iframe can still contain another album, or an older hidden view of
    // this one. Never acknowledge it just because a parent save succeeded.
    if (!state.hasUnsavedChanges && binding && preparationBinding === binding && !binding.api.busy() && project.releasePreparation) {
      let acknowledgedRevision = preparationRevision;
      if (preparationContentSignature(binding.api.snapshot()) !== preparationContentSignature(project.releasePreparation)) {
        await hydratePreparation({ project: project.releasePreparation });
        acknowledgedRevision = binding.api.revision?.() ?? null;
      }
      if (generation === state.sessionGeneration && revision === state.saveRevision
          && preparationBinding?.generation === generation && preparationBinding.api === binding.api) {
        await binding.api.saved(state.projectId, generation, acknowledgedRevision);
      }
    }
    setStatus(state.hasUnsavedChanges ? 'unsaved changes' : automatic ? 'saved' : 'album saved', state.hasUnsavedChanges ? 'neutral' : 'saved');
    // A library refresh failure must not turn an acknowledged write into a failed save.
    await renderSavedAlbums().catch((error) => setStatus('album saved; library could not refresh', 'error', error));
    return true;
  })();
  state.savePromise = operation;
  try { return await operation; }
  catch (error) { if (generation === state.sessionGeneration) state.hasUnsavedChanges = true; throw error; }
  finally {
    if (state.savePromise === operation) state.savePromise = null;
    state.isSaving = false;
    if (state.hasUnsavedChanges && state.saveRevision !== revision && !state.loadingProjectId) scheduleAutoSave();
  }
}
async function flushCurrentProject() {
  if (preparationApi?.busy()) throw new Error('Finish or cancel the current Release Preparation operation before changing albums or closing.');
  if (preparationHydration) await preparationHydration;
  // Wait for a file picker/read/decoder that can still change this album before
  // taking the final save snapshot. Nested imports may add another promise.
  while (state.pendingEdits.size) await Promise.all([...state.pendingEdits]);
  clearTimeout(state.autoSaveTimer);
  if (state.savePromise) await state.savePromise;
  // A just-imported track may still be analysing, but its source and notes can
  // already be saved before a deliberate New/Open action.
  if (state.hasUnsavedChanges || [...state.tracks, ...state.materials, ...state.references].some((track) => track.analysisState === 'analysing')) await saveProject();
  if (state.hasUnsavedChanges) await saveProject();
}
async function renderSavedAlbums() {
  const request = ++state.libraryRequest;
  const projects = isDesktop() ? await desktop.invoke('list_projects') : readBrowserProjects();
  if (request !== state.libraryRequest) return;
  const saved = projects.filter((project) => !project.archived); const archived = projects.filter((project) => project.archived);
  elements.savedAlbums.replaceChildren(); elements.archivedAlbums.replaceChildren();
  renderProjectCollection(elements.savedAlbums, saved, 'No saved albums yet.', false); renderProjectCollection(elements.archivedAlbums, archived, 'No archived albums.', true);
}

// Both library lists use the same small row: archive changes where an album is shown, while delete still removes it completely.
function renderProjectCollection(container, projects, emptyMessage, isArchived) {
  if (!projects.length) { container.innerHTML = `<p class="empty-library">${emptyMessage}</p>`; return; }
  projects.forEach((project) => {
    const row = document.createElement('div'); row.className = 'saved-album-row'; row.classList.toggle('is-selected', project.id === state.projectId);
    const openButton = document.createElement('button'); openButton.className = 'saved-album'; openButton.type = 'button'; openButton.disabled = Boolean(state.loadingProjectId); const name = document.createElement('span'); const date = document.createElement('small'); name.textContent = project.name || 'Untitled album'; date.textContent = new Date(project.updatedAt).toLocaleDateString(); openButton.append(name, date); openButton.addEventListener('click', () => loadProject(project.id).catch((error) => { console.error(error); setStatus('could not load album', 'error', error); }));
    const actions = document.createElement('div'); actions.className = 'saved-album-actions'; const archiveButton = document.createElement('button'); archiveButton.className = isArchived ? 'restore-saved-album' : 'archive-saved-album'; archiveButton.type = 'button'; archiveButton.textContent = isArchived ? 'restore' : 'archive'; archiveButton.addEventListener('click', () => setProjectArchived(project.id, !isArchived).catch((error) => { console.error(error); setStatus('could not update archive', 'error', error); }));
    const deleteButton = document.createElement('button'); deleteButton.className = 'delete-saved-album'; deleteButton.type = 'button'; deleteButton.textContent = 'delete'; deleteButton.addEventListener('click', () => armProjectDeletion(project.id, deleteButton)); actions.append(archiveButton, deleteButton); row.append(openButton, actions); container.append(row);
  });
}
// Prepare a complete replacement offscreen. Missing files or damaged records
// leave the current album and its source URLs intact instead of saving a partial album.
async function loadProject(id) {
  if (state.loadingProjectId) return false;
  state.loadingProjectId = id; setProjectLoading(true, 'Saving current album…');
  const staged = [];
  let committed = false;
  try {
    await flushCurrentProject();
    const raw = isDesktop() ? await desktop.invoke('load_project', { id }) : readBrowserProjects().find((item) => item.id === id);
    if (!raw) throw new Error('This saved album could not be found. Refresh the library and try again.');
    const project = normaliseProject(raw);
    const collections = {};
    setProjectLoading(true, 'Restoring audio and analysis…');
    for (const kind of ['tracks', 'materials', 'references']) {
      collections[kind] = [];
      for (const saved of project[kind]) {
        if (!isDesktop()) throw new Error('The browser preview cannot restore source audio after reopening. Use the desktop app for saved audio albums. The saved record has been left unchanged.');
        if (!saved.nativePath) throw new Error(`The saved source path for ${saved.name} is missing. The album has been left unchanged.`);
        const response = await fetch(desktop.convertFileSrc(saved.nativePath));
        if (!response.ok) throw new Error(`Could not restore ${saved.name} (${response.status}). Put its source file back at ${saved.nativePath} and try again.`);
        const file = new File([await response.blob()], baseName(saved.nativePath), { type: response.headers.get('content-type') || 'audio/*' });
        const track = Object.assign(createTrack(file, saved.nativePath), saved);
        staged.push(track); collections[kind].push(track);
        await analyseTrack(track);
        if (kind === 'references') await extractEmbeddedArtwork(track);
      }
    }
    // The saved preview is a recovery copy if the original cover has moved.
    let artwork = project.artworkDataUrl || null;
    if (!artwork && project.artworkNativePath && isDesktop()) artwork = await readNativeArtwork(project.artworkNativePath);
    await resetAlbumState(staged);
    state.projectId = project.id; state.isProjectArchived = project.archived;
    state.tracks = collections.tracks; state.materials = collections.materials; state.references = collections.references;
    elements.albumName.value = project.metadata.title; elements.albumTitle.textContent = project.metadata.title;
    for (const [key, input] of Object.entries({ artist: elements.artistInput, albumArtist: elements.albumArtistInput, year: elements.yearInput, genre: elements.genreInput, composer: elements.composerInput, discNumber: elements.discNumberInput, label: elements.labelInput, catalogue: elements.catalogueInput, comment: elements.commentInput })) input.value = project.metadata[key];
    elements.compilationInput.checked = project.metadata.compilation; applyReleaseCopyData(project.releaseCopy);
    state.preparation = validatePreparation(project.releasePreparation);
    state.albumNoteEntries = project.albumNoteEntries; elements.albumNotesInput.innerHTML = noteHtml(project.albumNotes);
    state.artworkNativePath = project.artworkNativePath || null;
    if (artwork) setArtworkPreview(artwork);
    state.transitionPlacements = project.transitionLayout.placements;
    restoreListeningDraft(project.listeningDraft);
    state.hasUnsavedChanges = false; committed = true;
    setReleaseCopyView(false); render(); resetHistory(); setStatus('saved', 'saved'); return true;
  } finally {
    if (!committed) releaseUnusedAudioSources(staged);
    state.loadingProjectId = null; setProjectLoading(false);
    await renderSavedAlbums().catch((error) => setStatus('library could not refresh', 'error', error));
  }
}

function armProjectDeletion(id, button) {
  if (button.dataset.armed === 'true') { deleteSavedProject(id).catch((error) => { console.error(error); setStatus('could not delete album', 'error', error); }); return; }
  button.dataset.armed = 'true'; button.textContent = 'sure?'; setTimeout(() => { if (button.isConnected) { button.dataset.armed = 'false'; button.textContent = 'delete'; } }, 3000);
}
async function deleteSavedProject(id) {
  if (state.loadingProjectId) return;
  state.loadingProjectId = '__delete__'; setProjectLoading(true, 'Updating album library…');
  try {
    await flushCurrentProject();
    if (isDesktop()) await desktop.invoke('delete_project', { id });
    else localStorage.setItem('album-builder-projects', JSON.stringify(readBrowserProjects().filter((project) => project.id !== id)));
    if (state.projectId === id) { state.projectId = null; state.hasUnsavedChanges = false; clearTimeout(state.autoSaveTimer); }
    setStatus('saved album deleted'); await renderSavedAlbums();
  } finally { state.loadingProjectId = null; setProjectLoading(false); }
}
async function setProjectArchived(id, archived) {
  if (state.loadingProjectId) return;
  state.loadingProjectId = '__archive__'; setProjectLoading(true, 'Updating album library…');
  try {
    await flushCurrentProject();
    if (isDesktop()) await desktop.invoke('set_project_archived', { id, archived });
    else localStorage.setItem('album-builder-projects', JSON.stringify(readBrowserProjects().map((project) => project.id === id ? { ...project, archived } : project)));
    if (state.projectId === id) state.isProjectArchived = archived;
    setStatus(archived ? 'album archived' : 'album restored', 'saved'); await renderSavedAlbums();
  } finally { state.loadingProjectId = null; setProjectLoading(false); }
}

async function exportProject() {
  if (state.exporting || state.loadingProjectId) return;
  if (!isDesktop()) { setStatus('export is available in the desktop app'); return; }
  if (!state.tracks.length) { setStatus('add tracks before exporting'); return; }
  if (state.tracks.some((track) => !track.nativePath)) { setStatus('desktop file paths needed to export', 'error'); return; }
  // Capture the album before the folder picker opens, so later edits cannot mix
  // one album's source paths with another album's export metadata.
  const request = { artworkPath: state.artworkNativePath, metadata: metadata(), tracks: state.tracks.map((track, index) => ({ path: track.nativePath, title: track.name, index: index + 1 })) };
  state.exporting = true; elements.exportProjectButton.disabled = true;
  try {
    const outputDir = await desktop.open({ directory: true, multiple: false, title: 'Choose an export folder' });
    if (!outputDir) return;
    setStatus('exporting album');
    const result = await desktop.invoke('export_album', { request: { ...request, outputDir } });
    if (result.failed) setStatus(`exported ${result.exported}; ${result.failed} failed — see report`, 'error', [...(result.failures || []).map((failure) => `${failure.path}: ${failure.message}`), ...(result.warnings || []).map((warning) => `Warning: ${warning}`)].join('\n') || 'No file-specific details were returned.');
    else if (result.warnings?.length) {
      setStatus(`exported ${result.exported} tracks to ${baseName(result.outputDir || outputDir)}; see export notes`, 'saved');
      errorReporter.show('Export finished with these notes', result.warnings.join('\n'), { kind: 'info' });
    }
    else setStatus(`exported ${result.exported} tracks to ${baseName(result.outputDir || outputDir)}`, 'saved');
  } finally { state.exporting = false; elements.exportProjectButton.disabled = false; }
}

function syncArtBlur() { const enabled = localStorage.getItem('album-builder-art-blur') === 'true'; const opacity = Number(localStorage.getItem('album-builder-art-blur-opacity') || 20); const boundedOpacity = Math.max(4, Math.min(32, opacity)); elements.artBlurOpacity.value = String(boundedOpacity); elements.artBlurOpacity.style.setProperty('--art-blur-fill', `${((boundedOpacity - 4) / 28) * 100}%`); document.body.style.setProperty('--art-blur-opacity', String(boundedOpacity / 100)); document.body.classList.toggle('art-blur', enabled && Boolean(state.artworkDataUrl)); elements.artBlurButton.setAttribute('aria-pressed', String(enabled)); if (state.artworkDataUrl) document.body.style.setProperty('--album-art-blur', `url(${JSON.stringify(state.artworkDataUrl)})`); else document.body.style.removeProperty('--album-art-blur'); }
function setArtworkPreview(url) { state.artworkDataUrl = url; elements.artworkPreview.src = url; elements.artworkPreview.hidden = false; elements.artworkClearButton.hidden = false; document.querySelector('.artwork-empty').hidden = true; syncArtBlur(); }
function clearArtwork(updateStatus = true) { if (updateStatus) recordHistory(); state.artworkDataUrl = null; state.artworkNativePath = null; elements.artworkPreview.hidden = true; elements.artworkPreview.removeAttribute('src'); elements.artworkInput.value = ''; elements.artworkClearButton.hidden = true; document.querySelector('.artwork-empty').hidden = false; syncArtBlur(); if (updateStatus) markUnsaved(); }
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the artwork file.'));
    reader.onabort = () => reject(new Error('The artwork read was cancelled.'));
    reader.readAsDataURL(file);
  });
}
async function readNativeArtwork(path) {
  const response = await fetch(desktop.convertFileSrc(path));
  if (!response.ok) throw new Error(`Could not read album artwork (${response.status}): ${path}`);
  return fileToDataUrl(await response.blob());
}
async function setArtworkFromNativePath(path) {
  const generation = state.sessionGeneration;
  const preview = await readNativeArtwork(path);
  if (generation !== state.sessionGeneration) return false;
  state.artworkNativePath = path; setArtworkPreview(preview); return true;
}
function chooseArtwork() { return runPendingEdit(chooseArtworkImpl); }
async function chooseArtworkImpl() {
  if (state.loadingProjectId) return;
  const generation = state.sessionGeneration;
  if (isDesktop()) {
    const path = await desktop.open({ multiple: false, filters: [{ name: 'Artwork', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (path && generation === state.sessionGeneration) { recordHistory(); if (await setArtworkFromNativePath(path)) markUnsaved(); }
  } else elements.artworkInput.click();
}

async function newAlbum() {
  if (state.loadingProjectId) return false;
  state.loadingProjectId = '__new__'; setProjectLoading(true, 'Saving current album…');
  try { await flushCurrentProject(); await resetAlbumState(); setReleaseCopyView(false); setStatus('new album'); return true; }
  finally { state.loadingProjectId = null; setProjectLoading(false); }
}
async function resetAlbumState(preserveTracks = []) {
  invalidatePreparationBinding(); preparationApi?.pause(); state.preparation = null;
  disposeAudioSession(preserveTracks); state.sessionGeneration += 1; state.projectId = null; state.isProjectArchived = false; state.tracks = []; state.materials = []; state.references = []; state.albumNoteEntries = []; state.transitionPlacements = []; state.transitionSelectedId = null; state.transitionPlayhead = 0; state.currentTrackId = null; state.currentReferenceId = null; state.albumSpectrogram = null; state.albumSpectrogramSignature = ''; elements.audioPlayer.pause(); elements.audioPlayer.removeAttribute('src'); elements.albumName.value = 'Untitled album'; elements.albumTitle.textContent = 'Untitled album';
  clearTimeout(state.autoSaveTimer); state.hasUnsavedChanges = false;
  [elements.artistInput, elements.albumArtistInput, elements.yearInput, elements.genreInput, elements.composerInput, elements.discNumberInput, elements.labelInput, elements.catalogueInput, elements.commentInput].forEach((input) => { input.value = ''; }); elements.albumNotesInput.innerHTML = ''; elements.compilationInput.checked = false; applyReleaseCopyData(); clearArtwork(false); elements.nowPlaying.textContent = '—'; elements.positionReadout.textContent = '00:00 / 00:00'; elements.trackListPositionReadout.textContent = '00:00 / 00:00'; restoreListeningDraft(null); setTrackedNotesView(false); render(); resetHistory();
}

function placeTransitionOverlays(tracks) {
  if (!tracks?.length) return;
  let start = state.transitionPlayhead;
  tracks.filter((track) => state.materials.includes(track)).forEach((track) => {
    start = findTransitionGap(2, start, track.duration || 0);
    const placement = { id: crypto.randomUUID(), trackId: track.id, lane: 2, start, fadeIn: 0, fadeOut: 0, isOverlay: true };
    state.transitionPlacements.push(placement); state.transitionSelectedId = placement.id; start += track.duration || 0;
  });
  markUnsaved(); renderTransitionLayout();
}

function chooseTransitionOverlays() { return runPendingEdit(() => chooseTransitionOverlaysImpl()); }
async function chooseTransitionOverlaysImpl() {
  if (isDesktop()) {
    const paths = await desktop.open({ multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus'] }] });
    if (paths) placeTransitionOverlays(await addNativePaths(paths, [], 'materials'));
  } else {
    elements.transitionOverlayInput.value = ''; elements.transitionOverlayInput.click();
  }
}

// Input, drag/drop, transport and appearance controls all call the small helpers above.
elements.chooseFilesButton.addEventListener('click', () => runPendingEdit(async () => { if (isDesktop()) { const paths = await desktop.open({ multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus'] }] }); if (paths) await addNativePaths(paths); } else elements.audioInput.click(); }));
elements.audioInput.addEventListener('change', (event) => addFiles(event.target.files));
elements.chooseReferencesButton.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); return runPendingEdit(async () => { if (isDesktop()) { const paths = await desktop.open({ multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus'] }] }); if (paths) await addNativePaths(paths, [], 'references'); } else elements.referenceInput.click(); }); });
elements.referenceInput.addEventListener('change', (event) => addFiles(event.target.files, [], [], 'references'));
elements.replaceAudioInput.addEventListener('change', (event) => {
  const [file] = event.target.files;
  const trackId = state.replacingTrackId; state.replacingTrackId = null;
  if (file && trackId) replaceTrackAudio(trackId, file).catch((error) => { console.error(error); setStatus('could not replace track', 'error', error); });
});
['dragenter', 'dragover'].forEach((name) => elements.dropZone.addEventListener(name, (event) => { event.preventDefault(); elements.dropZone.classList.add('is-dragging'); })); ['dragleave', 'drop'].forEach((name) => elements.dropZone.addEventListener(name, (event) => { event.preventDefault(); elements.dropZone.classList.remove('is-dragging'); })); elements.dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
elements.albumWaveform.addEventListener('click', (event) => { const rect = elements.albumWaveform.getBoundingClientRect(); playFromAlbumPosition(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * getTotalDuration()); });
elements.albumWaveform.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault(); if (!state.tracks.length) return;
  const current = state.currentTrackId ? getTrackStart(state.currentTrackId) + elements.audioPlayer.currentTime : 0;
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? getTotalDuration() : current + (event.key === 'ArrowLeft' ? -5 : 5);
  cueAlbumPosition(target, !elements.audioPlayer.paused);
});
// The spectrogram is another time view of the same album, so it uses the same seek behaviour as the waveform above it.
elements.albumSpectrogram.addEventListener('click', (event) => { const rect = elements.albumSpectrogram.getBoundingClientRect(); playFromAlbumPosition(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * getTotalDuration()); });
elements.transportAlbumStartButton.addEventListener('click', returnToAlbumStart); elements.transportRestartButton.addEventListener('click', restartCurrentTrack); elements.transportPlayButton.addEventListener('click', playAlbumSequence); elements.transportPauseButton.addEventListener('click', () => elements.audioPlayer.pause()); elements.transportNextButton.addEventListener('click', skipToNextTrack);
// The transition surface has its own transport because it may be playing two or
// three files at once, independently of the ordinary sequential album player.
elements.transitionStartButton.addEventListener('click', () => { pauseTransitionPlayback(); seekTransitionPlayback(0); });
elements.transitionPlayButton.addEventListener('click', playTransitionLayout); elements.transitionPauseButton.addEventListener('click', pauseTransitionPlayback);
elements.transitionTimeline.addEventListener('click', (event) => { if (event.target.closest('.transition-clip')) return; const rect = elements.transitionTimeline.getBoundingClientRect(); seekTransitionPlayback(((event.clientX - rect.left) / Math.max(1, rect.width)) * transitionLayoutDuration()); });
elements.transitionZoom.addEventListener('input', () => { state.transitionZoom = Number(elements.transitionZoom.value); renderTransitionLayout(); });
elements.transitionAddOverlayButton.addEventListener('click', () => chooseTransitionOverlays().catch((error) => { console.error(error); setStatus('could not add overlay', 'error', error); }));
elements.transitionOverlayInput.addEventListener('change', async (event) => placeTransitionOverlays(await addFiles(event.target.files, [], [], 'materials')));
elements.transitionFadeIn.addEventListener('pointerdown', recordHistory); elements.transitionFadeOut.addEventListener('pointerdown', recordHistory);
elements.transitionFadeIn.addEventListener('input', () => updateSelectedTransitionFade('fadeIn', elements.transitionFadeIn.value));
elements.transitionFadeOut.addEventListener('input', () => updateSelectedTransitionFade('fadeOut', elements.transitionFadeOut.value));
elements.transitionLaneSelect.addEventListener('pointerdown', recordHistory);
elements.transitionLaneSelect.addEventListener('change', () => {
  const placement = state.transitionPlacements.find((item) => item.id === state.transitionSelectedId); if (!placement) return;
  const oldLane = placement.lane; placement.lane = Number(elements.transitionLaneSelect.value);
  if (placementOverlapsLane(placement)) { placement.lane = oldLane; setStatus('clips in one lane cannot overlap', 'error'); }
  else markUnsaved();
  renderTransitionLayout();
});
elements.transitionRemoveOverlayButton.addEventListener('click', () => {
  const index = state.transitionPlacements.findIndex((placement) => placement.id === state.transitionSelectedId && placement.isOverlay); if (index < 0) return;
  recordHistory(); state.transitionPlacements.splice(index, 1); state.transitionSelectedId = null; markUnsaved(); renderTransitionLayout();
});
// Note-taking has its own transport surface, but delegates to the same proven playback helpers as the main workspace.
elements.noteTakingBackButton.addEventListener('click', () => setTrackedNotesView(false));
elements.noteTakingAlbumStartButton.addEventListener('click', noteTakingAlbumStart); elements.noteTakingRestartButton.addEventListener('click', restartCurrentTrack); elements.noteTakingPlayButton.addEventListener('click', noteTakingPlay); elements.noteTakingPauseButton.addEventListener('click', () => elements.audioPlayer.pause()); elements.noteTakingNextButton.addEventListener('click', skipToNextTrack);
elements.noteTakingProgress.addEventListener('change', seekNoteTakingProgress);
elements.noteTakingTracksToggle.addEventListener('click', () => { state.noteTakingTracksCollapsed = !state.noteTakingTracksCollapsed; elements.noteTakingTracksPanel.classList.toggle('is-collapsed', state.noteTakingTracksCollapsed); elements.trackedNotesView.classList.toggle('is-tracks-collapsed', state.noteTakingTracksCollapsed); elements.noteTakingTracksToggle.setAttribute('aria-expanded', String(!state.noteTakingTracksCollapsed)); elements.noteTakingTracksToggle.querySelector('span').textContent = state.noteTakingTracksCollapsed ? '›' : '⌃'; });
// Keep media callbacks short. Heavy canvas rendering is deferred to one visual frame instead of running inside every audio event.
elements.audioPlayer.addEventListener('timeupdate', schedulePlaybackVisuals); elements.audioPlayer.addEventListener('play', () => { startLevelMeter(); syncPlaybackControls(); schedulePlaybackVisuals(); }); elements.audioPlayer.addEventListener('pause', () => { syncPlaybackControls(); schedulePlaybackVisuals(); }); elements.audioPlayer.addEventListener('ended', () => { const index = state.tracks.findIndex((track) => track.id === state.currentTrackId); if (state.isAlbumMode && state.tracks[index + 1]) playTrack(state.tracks[index + 1].id, 0, true); else { schedulePlaybackVisuals(); syncPlaybackControls(); } }); elements.audioPlayer.addEventListener('error', () => { setStatus('this track could not be played', 'error', elements.audioPlayer.error); syncPlaybackControls(); });
elements.albumVolume.addEventListener('input', applyAlbumVolume);
elements.albumName.addEventListener('beforeinput', recordHistory); elements.albumName.addEventListener('input', () => { const title = elements.albumName.value.trim() || 'Untitled album'; elements.albumTitle.textContent = title; document.title = `${title} — Album Builder`; updateReleaseCopyPreview(); markUnsaved(); }); [elements.artistInput, elements.albumArtistInput, elements.yearInput, elements.genreInput, elements.composerInput, elements.discNumberInput, elements.labelInput, elements.catalogueInput, elements.commentInput, elements.compilationInput].forEach((input) => { input.addEventListener('beforeinput', recordHistory); input.addEventListener('input', () => { updateReleaseCopyPreview(); markUnsaved(); }); }); bindNotepadToolbar(elements.albumNotesToolbar, elements.albumNotesInput); elements.saveAlbumNoteButton.addEventListener('click', saveAlbumNote);
// Release copy fields are normal project edits: they participate in autosave and undo just like metadata.
[elements.releaseDateInput, elements.releaseDescriptionInput, elements.releaseCreditsInput, elements.downloadUrlInput].forEach((input) => { input.addEventListener('beforeinput', recordHistory); input.addEventListener('input', () => { updateReleaseCopyPreview(); markUnsaved(); }); input.addEventListener('change', () => { updateReleaseCopyPreview(); markUnsaved(); }); });
// Release Copy is a toggle in the shared header, so the same familiar button always returns to album building.
elements.releaseCopyButton.addEventListener('click', () => setReleaseCopyView(true)); document.querySelector('#albumWorkspaceButton').addEventListener('click', () => setReleaseCopyView(false)); elements.returnToAlbumButton.addEventListener('click', () => setReleaseCopyView(false)); elements.copyReleaseCopyButton.addEventListener('click', copyReleaseCopy);
// Focused listening uses the current album track or sequence; it never switches the source audio behind the listener's back.
elements.trackedNotesButton.addEventListener('click', () => setTrackedNotesView(!state.isTrackedNotesView));
elements.trackedNotesMakeButton.addEventListener('click', openTrackedNoteComposer); elements.trackedNoteComposer.addEventListener('submit', saveTrackedNote);
elements.trackedNoteInput.addEventListener('input', () => { if (state.trackedNoteDraft) { state.trackedNoteDraft.text = elements.trackedNoteInput.value; markUnsaved(); } });
// Uncommitted album-note text is also a draft worth saving, even before it is
// moved into the dated note log with Save Note.
elements.albumNotesInput.addEventListener('beforeinput', recordHistory);
elements.albumNotesInput.addEventListener('input', markUnsaved);
document.querySelector('#discardListeningNoteButton').addEventListener('click', () => { closeTrackedNoteComposer(); markUnsaved(); elements.trackedNotesMakeButton.focus(); });
elements.trackedNoteInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); elements.trackedNoteComposer.requestSubmit(); } });
elements.releasePresetSelect.addEventListener('change', applySelectedReleasePreset); elements.newReleasePresetButton.addEventListener('click', newReleasePreset); elements.saveReleasePresetButton.addEventListener('click', saveReleasePreset); elements.deleteReleasePresetButton.addEventListener('click', deleteReleasePreset);
elements.artworkButton.addEventListener('click', chooseArtwork); elements.artworkClearButton.addEventListener('click', (event) => { event.stopPropagation(); clearArtwork(); }); elements.artworkInput.addEventListener('change', (event) => runPendingEdit(async () => { const [file] = event.target.files; const generation = state.sessionGeneration; if (file) { const preview = await fileToDataUrl(file); if (generation !== state.sessionGeneration) return; recordHistory(); state.artworkNativePath = null; setArtworkPreview(preview); markUnsaved(); } }));
elements.tipsButton.addEventListener('click', () => { const enabled = !document.body.classList.contains('show-tips'); document.body.classList.toggle('show-tips', enabled); elements.tipsButton.setAttribute('aria-pressed', String(enabled)); });
elements.themeButton.addEventListener('click', () => { const current = document.body.dataset.theme || 'day'; const next = current === 'day' ? 'night' : 'day'; applyTheme(next); });
// The artwork button controls the background tint; the neighbouring icon only reveals its strength slider.
elements.artBlurButton.addEventListener('click', () => { const enabled = localStorage.getItem('album-builder-art-blur') !== 'true'; localStorage.setItem('album-builder-art-blur', String(enabled)); syncArtBlur(); });
function setArtBlurSliderOpen(open) {
  const slider = elements.artBlurControl.querySelector('.art-blur-slider');
  // Hidden controls should leave the Tab order. Return keyboard focus before
  // closing the popover so Escape never leaves an invisible focused slider.
  if (!open && slider.contains(document.activeElement)) elements.artBlurAdjustButton.focus();
  slider.hidden = !open;
  elements.artBlurControl.classList.toggle('is-open', open); elements.artBlurAdjustButton.setAttribute('aria-expanded', String(open));
}
elements.artBlurAdjustButton.addEventListener('click', (event) => { event.stopPropagation(); setArtBlurSliderOpen(!elements.artBlurControl.classList.contains('is-open')); });
elements.artBlurOpacity.addEventListener('input', () => { localStorage.setItem('album-builder-art-blur-opacity', elements.artBlurOpacity.value); syncArtBlur(); });
// A click outside this small control returns the header to its clean, compact state.
document.addEventListener('click', (event) => { if (!elements.artBlurControl.contains(event.target)) setArtBlurSliderOpen(false); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setArtBlurSliderOpen(false); });
// Leaving focused listening keeps the album's draft; discarding is explicit.
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.isTrackedNotesView) setTrackedNotesView(false); });
elements.aboutButton.addEventListener('click', openAboutAndLegal); elements.legalCloseButton.addEventListener('click', () => elements.legalDialog.close());
elements.privacyTab.addEventListener('click', () => renderLegalDocument('privacy')); elements.termsTab.addEventListener('click', () => renderLegalDocument('terms'));
elements.legalDialog.addEventListener('click', (event) => { if (event.target === elements.legalDialog) elements.legalDialog.close(); });
elements.licenseButton.addEventListener('click', openLicenseDialog); elements.licenseForm.addEventListener('submit', activateLicense); elements.licenseCheckButton.addEventListener('click', () => refreshLicense()); elements.licenseDeactivateButton.addEventListener('click', deactivateLicense);
elements.licenseCloseButton.addEventListener('click', () => { if (!state.licenseGateLocked) elements.licenseDialog.close(); });
// Escape and a backdrop click should never bypass activation when this is the gate.
elements.licenseDialog.addEventListener('cancel', (event) => { if (state.licenseGateLocked) event.preventDefault(); });
elements.licenseDialog.addEventListener('click', (event) => { if (event.target === elements.licenseDialog && !state.licenseGateLocked) elements.licenseDialog.close(); });
elements.exportProjectButton.addEventListener('click', () => (elements.releaseCopyView.hidden ? exportProject() : Promise.resolve(preparationApi?.export())).catch((error) => { console.error(error); setStatus('export could not finish', 'error', error); })); elements.newAlbumButton.addEventListener('click', () => newAlbum().catch((error) => setStatus('could not save the current album; it remains open', 'error', error)));
// Keep the familiar desktop editing shortcuts available everywhere in the album workspace.
document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || state.loadingProjectId) return;
  if (event.target.closest?.('.license-dialog, .legal-dialog, .settings-dialog, #trackedNoteInput, .release-preset-controls, .release-preset-fields')) return;
  const key = event.key.toLowerCase();
  if (key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
  if (key === 'y') { event.preventDefault(); redo(); }
});
elements.albumSpectrogramPanel.addEventListener('toggle', () => { if (elements.albumSpectrogramPanel.open) ensureAlbumSpectrogram(); });
window.addEventListener('resize', () => { drawAlbumWaveform(); redrawSmallWaveforms(); renderTransitionLayout(); if (elements.albumSpectrogramPanel.open && state.albumSpectrogram) drawAlbumSpectrogram(); });

// macOS can replace an interface with laptop speakers while this window is asleep.
// The next deliberate Play then refreshes the paused native media route at its current position.
function requestOutputRouteRefresh() { if (elements.audioPlayer.src) state.outputRefreshRequested = true; }
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestOutputRouteRefresh(); });
window.addEventListener('focus', requestOutputRouteRefresh);
navigator.mediaDevices?.addEventListener?.('devicechange', requestOutputRouteRefresh);

function redrawSmallWaveforms() {
  document.querySelectorAll('.track').forEach((row) => { const track = state.tracks.find((item) => item.id === row.dataset.id); if (track) drawTrackWaveform(row.querySelector('.track-waveform'), track); });
  document.querySelectorAll('.material-row').forEach((row) => { const track = state.materials.find((item) => item.id === row.dataset.id); if (track) drawTrackWaveform(row.querySelector('.material-waveform'), track, false); });
  document.querySelectorAll('.reference-row').forEach((row) => { const track = state.references.find((item) => item.id === row.dataset.id); if (track) drawTrackWaveform(row.querySelector('.reference-waveform'), track); });
}
function applyTheme(theme) { preparationApi?.theme(theme); document.body.dataset.theme = theme === 'day' ? '' : theme; elements.themeButton.textContent = `${theme[0].toUpperCase() + theme.slice(1)} view`; document.querySelectorAll('[data-appearance]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.appearance === theme)));  localStorage.setItem('album-builder-theme', theme); render(); }

const preparationFrame = document.querySelector('#preparationFrame');
let preparationApi = null;
let preparationHydration = null;
let preparationBinding = null;
let preparationHydrationToken = 0;
function invalidatePreparationBinding() {
  preparationBinding = null;
  preparationHydrationToken += 1;
}
function preparationError(error) {
  document.querySelector('#preparationLoading').hidden = false;
  document.querySelector('#preparationLoading').textContent = `Release Preparation could not open: ${error}`;
  setStatus('could not open Release Preparation', 'error', error);
}
async function hydratePreparation({ project: suppliedProject = null } = {}) {
  const generation = state.sessionGeneration;
  const api = preparationApi;
  const token = ++preparationHydrationToken;
  const project = suppliedProject || preparationForAlbum({ ...serialiseProject(), tracks: state.tracks });
  const previous = preparationHydration;
  preparationFrame.hidden = true; document.querySelector('#preparationLoading').hidden = false;
  const operation = (async () => {
    // Serialize reconstruction so a slower first request cannot replace a newer
    // album or Undo result inside the iframe after its parent has moved on.
    if (previous) await previous.catch(() => {});
    if (generation !== state.sessionGeneration || token !== preparationHydrationToken || api !== preparationApi) return false;
    await api.hydrate(project, generation);
    if (generation !== state.sessionGeneration || token !== preparationHydrationToken || api !== preparationApi) return false;
    preparationBinding = { generation, api };
    api.theme(document.body.dataset.theme || 'day');
    preparationFrame.hidden = false; document.querySelector('#preparationLoading').hidden = true;
    if (!elements.releaseCopyView.hidden) api.resume?.();
    return true;
  })();
  preparationHydration = operation;
  try { return await operation; }
  finally { if (preparationHydration === operation) preparationHydration = null; }
}
function receivePreparation(project, generation) {
  if (generation !== state.sessionGeneration) throw Error('This preparation belongs to an album that is no longer open.');
  const preparation = validatePreparation(project);
  const shared = sharedFieldsFromPreparation(preparation);
  recordHistory();
  state.preparation = preparation;
  elements.albumName.value = shared.metadata.title; elements.albumTitle.textContent = shared.metadata.title;
  for (const [key, input] of Object.entries({ artist: elements.artistInput, albumArtist: elements.albumArtistInput, year: elements.yearInput, genre: elements.genreInput, composer: elements.composerInput, discNumber: elements.discNumberInput, label: elements.labelInput, catalogue: elements.catalogueInput, comment: elements.commentInput })) input.value = shared.metadata[key];
  elements.compilationInput.checked = shared.metadata.compilation;
  applyReleaseCopyData({ ...shared.releaseCopy, presetId: state.releaseCopy.presetId });
  const masterOrder = new Map((preparation.masters || []).filter(master => master.sourceTrackId).map((master, index) => [master.sourceTrackId, index]));
  state.tracks.sort((a, b) => (masterOrder.get(a.id) ?? Infinity) - (masterOrder.get(b.id) ?? Infinity));
  state.currentStart = state.currentTrackId ? getTrackStart(state.currentTrackId) : 0;
  for (const master of preparation.masters || []) {
    const track = state.tracks.find(track => track.id === master.sourceTrackId);
    if (track && master.metadata?.title) track.name = master.metadata.title;
  }
  document.title = `${shared.metadata.title} — Album Builder`;
  markUnsaved();
}
const preparationCommands = new Set(['inspect_audio', 'allow_audio_preview', 'allow_visual_preview', 'read_file_data_url', 'reveal_file_in_finder', 'openai_api_key_status', 'save_openai_api_key', 'remove_openai_api_key', 'generate_release_copy', 'copy_text_to_clipboard', 'update_non_music_files', 'export_release', 'export_track_videos', 'export_canvases', 'render_canvas_preview', 'cancel_video_export']);
window.AlbumPreparationHost = {
  isDesktop,
  theme: () => document.body.dataset.theme || 'day',
  convertFileSrc: (...args) => desktop.convertFileSrc(...args),
  open: (...args) => desktop.open(...args),
  listen: (...args) => desktop.listen(...args),
  async invoke(command, args) {
    if (command === 'list_projects') return isDesktop() ? desktop.invoke(command) : readBrowserProjects();
    if (command === 'load_project') {
      const album = isDesktop() ? await desktop.invoke(command, args) : readBrowserProjects().find(album => album.id === args.id);
      return preparationForAlbum(normaliseProject(album));
    }
    if (!preparationCommands.has(command)) throw Error('Unsupported preparation operation.');
    return desktop.invoke(`prep_${command}`, args);
  },
  async syncSequence() {
    if (preparationApi?.busy()) throw Error('Finish the current preparation operation first.');
    if (state.preparation) state.preparation = { ...state.preparation, albumTrackIds: [] };
    await hydratePreparation();
    receivePreparation(preparationApi.snapshot(), state.sessionGeneration);
  },
  linkPresets: readReleasePresets,
  changed: receivePreparation,
  async save(project, generation) {
    receivePreparation(project, generation);
    await saveProject();
    return { id: state.projectId };
  },
  async ready(api) {
    preparationApi = api;
    try { await hydratePreparation(); } catch (error) { preparationError(error); throw error; }
  },
};

const settingsUI = {
  dialog: document.querySelector('#settingsDialog'),
  path: document.querySelector('#libraryPath'),
  message: document.querySelector('#libraryMessage'),
  choose: document.querySelector('#chooseLibraryButton'),
  reset: document.querySelector('#resetLibraryButton'),
};
let libraryLocation = null;
let changingLibrary = false;
function showLibraryLocation(location) {
  libraryLocation = location;
  settingsUI.path.textContent = location.path;
  document.querySelector('#libraryLocationLabel').textContent = location.isDefault ? 'Default folder' : 'Custom folder';
  settingsUI.choose.disabled = false;
  settingsUI.reset.disabled = location.isDefault;
}
async function openSettings() {
  settingsUI.message.textContent = '';
  settingsUI.message.classList.remove('is-error');
  settingsUI.dialog.showModal();
  settingsUI.choose.disabled = true; settingsUI.reset.disabled = true;
  document.querySelector('#importPreparationButton').disabled = !isDesktop();
  if (!isDesktop()) {
    settingsUI.path.textContent = 'Browser preview — open the desktop app to choose a library folder.';
    return;
  }
  try { showLibraryLocation(await desktop.invoke('get_library_location')); }
  catch (error) { settingsUI.path.textContent = 'Library location unavailable'; settingsUI.message.textContent = String(error); settingsUI.message.classList.add('is-error'); }
}
function closeSettings() { if (!changingLibrary) settingsUI.dialog.close(); }
async function changeLibraryLocation(reset = false) {
  if (changingLibrary || state.loadingProjectId || state.exporting || !isDesktop()) return;
  changingLibrary = true;
  settingsUI.choose.disabled = true; settingsUI.reset.disabled = true;
  settingsUI.message.textContent = ''; settingsUI.message.classList.remove('is-error');
  let locked = false;
  try {
    const path = reset ? null : await desktop.open({ directory: true, multiple: false, title: 'Choose an album library folder', defaultPath: libraryLocation?.path });
    if (!reset && !path) return;
    settingsUI.message.textContent = 'Saving your album and copying the library…';
    state.loadingProjectId = '__library__'; locked = true;
    // The modal prevents edits; pending imports and saves settle before the pointer changes.
    await flushCurrentProject();
    clearTimeout(state.autoSaveTimer);
    showLibraryLocation(await desktop.invoke('change_library_location', { path }));
    await renderSavedAlbums();
    settingsUI.message.textContent = 'Library updated. Future saves use this folder. Original files have been kept.';
    setStatus('album library location updated', 'saved');
  } catch (error) {
    settingsUI.message.textContent = String(error);
    settingsUI.message.classList.add('is-error');
  } finally {
    changingLibrary = false;
    if (locked) state.loadingProjectId = null;
    settingsUI.choose.disabled = false; settingsUI.reset.disabled = !libraryLocation || libraryLocation.isDefault;
    if (state.hasUnsavedChanges) scheduleAutoSave();
  }
}
document.querySelector('#importPreparationButton').addEventListener('click', async () => {
  if (!isDesktop() || state.loadingProjectId || changingLibrary) return;
  try {
    const path = await desktop.open({ multiple: false, title: 'Import a Release Preparer project', filters: [{ name: 'Release Preparer project', extensions: ['json'] }] });
    if (!path) return;
    const album = normaliseProject(albumFromPreparation(await desktop.invoke('prep_read_project', { path })));
    await flushCurrentProject();
    await desktop.invoke('save_project', { project: album });
    closeSettings();
    await loadProject(album.id);
    setReleaseCopyView(true);
    setStatus('Release Preparer project imported into a new album', 'saved');
  } catch (error) { settingsUI.message.textContent = `Import could not finish: ${error}`; settingsUI.message.classList.add('is-error'); }
});
document.querySelector('#settingsButton').addEventListener('click', openSettings);
document.querySelector('#settingsCloseButton').addEventListener('click', closeSettings);
document.querySelector('#settingsDoneButton').addEventListener('click', closeSettings);
settingsUI.dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && elements.artBlurControl.classList.contains('is-open')) {
    event.preventDefault(); event.stopPropagation(); setArtBlurSliderOpen(false);
  }
});
settingsUI.dialog.addEventListener('cancel', (event) => { if (changingLibrary) event.preventDefault(); });
settingsUI.dialog.addEventListener('click', (event) => { if (event.target === settingsUI.dialog) closeSettings(); });
settingsUI.dialog.addEventListener('close', () => document.querySelector('#settingsButton').focus());
settingsUI.choose.addEventListener('click', () => changeLibraryLocation());
settingsUI.reset.addEventListener('click', () => changeLibraryLocation(true));
document.querySelectorAll('[data-appearance]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.appearance)));

async function requestApplicationClose() {
  if (state.loadingProjectId) { setStatus('wait for the current album operation before closing'); return; }
  if (state.exporting) { setStatus('wait for the current export before closing'); return; }
  state.loadingProjectId = '__close__'; setProjectLoading(true, 'Saving before closing…');
  try { await flushCurrentProject(); await desktop.invoke('confirm_app_close'); }
  catch (error) { setStatus('could not save before closing; the album remains open', 'error', error); }
  finally { state.loadingProjectId = null; setProjectLoading(false); }
}

// The bridge loads before the first library draw, so a packaged app sees its saved albums immediately.
async function startApplication() {
  await initialiseDesktopBridge();
  if (desktop.window) {
    await desktop.window.onCloseRequested(async (event) => { event.preventDefault(); await requestApplicationClose(); });
    // macOS Quit is a separate native event from the red window-close button.
    await desktop.listen('album-builder://request-close', requestApplicationClose);
  }
  if (desktop.getVersion) elements.appVersion.textContent = await desktop.getVersion().catch(() => '0.2.2');
  applyTheme(localStorage.getItem('album-builder-theme') || 'day');
  applyReleaseCopyData();
  syncArtBlur();
  // Finder drops in a packaged Tauri app arrive through this native event, not only through HTML DataTransfer.
  if (isDesktop()) {
    await desktop.getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (payload.type === 'over') { elements.dropZone.classList.add('is-dragging'); setStatus('drop audio files to add'); }
      if (payload.type === 'leave') elements.dropZone.classList.remove('is-dragging');
      if (payload.type === 'drop' && !state.loadingProjectId && !document.querySelector('#settingsDialog').open && elements.releaseCopyView.hidden) { elements.dropZone.classList.remove('is-dragging'); await addNativePaths(payload.paths); }
    });
  }
  render();
  resetHistory();
  await initialiseLicense();
  // Licensed builds open the library after activation. Prototype builds and the
  // browser preview can open it immediately.
  if (!state.licenseGateLocked) renderSavedAlbums().catch((error) => setStatus('could not list saved albums', 'error', error));
}

window.addEventListener('beforeunload', (event) => { if (!isDesktop() && (state.hasUnsavedChanges || state.isSaving)) { event.preventDefault(); event.returnValue = ''; } });
startApplication();
