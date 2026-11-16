// Run against `npm run dev`. Test-only routing exposes internal helpers in an
// isolated browser; the application itself never exposes this diagnostic API.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const bundled = `${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`;
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || bundled).href); }
const browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const baseURL = process.env.ALBUM_BUILDER_URL || 'http://127.0.0.1:4174';
const context = await browser.newContext(); const page = await context.newPage();
const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
await page.route('**/app.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, body: await response.text() + '\nwindow.audioTest = {state,elements,createTrack,addFiles,newAlbum,replaceTrackAudio,undo,redo,resetHistory,playTrack,playAlbumSequence,playTransitionLayout,pauseTransitionPlayback,syncTransitionAudio,placeTransitionOverlays,placementOverlapsLane,reconcileTransitionPlacements,ensureAlbumSpectrogram,albumSpectrumSignature,render,releaseUnusedAudioSources,historySnapshot,applyHistory,resetAlbumState,requestApplicationClose,desktop};' });
});
function wav(name, seconds = 1, frequency = 220) {
  const rate = 16000, samples = rate * seconds, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(5000 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + i * 2);
  return { name, mimeType: 'audio/wav', buffer };
}
let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
async function reset(files = [wav('one.wav', 1), wav('two.wav', 1.5), wav('three.wav', 2)]) {
  await page.goto(baseURL); await page.waitForFunction(() => window.audioTest);
  await page.evaluate(() => { localStorage.clear(); audioTest.newAlbum(); });
  await page.locator('#audioInput').setInputFiles(files);
  await page.waitForFunction(() => audioTest.state.tracks.length === 3 && audioTest.state.tracks.every((track) => track.analysisState === 'ready'));
}
try {
  await reset();
  await check('main playback stops transition preview and repeated preview Play is idempotent', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest; a.playTrack(a.state.tracks[0].id); await new Promise((r) => setTimeout(r, 80));
      a.playTransitionLayout(); const started = a.state.transitionStartedAt; a.playTransitionLayout(); const sameClock = started === a.state.transitionStartedAt;
      a.playAlbumSequence(); await new Promise((r) => setTimeout(r, 80));
      const result = { sameClock, mainPlaying: !a.elements.audioPlayer.paused, previewStopped: !a.state.transitionIsPlaying && a.elements.transitionPlayers.every((player) => player.paused) };
      a.elements.audioPlayer.pause(); return result;
    });
    assert.deepEqual(result, { sameClock: true, mainPlaying: true, previewStopped: true });
  });
  await check('replacement Undo and Redo keep both browser sources readable', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest; const old = a.state.tracks[0]; const oldURL = old.objectUrl;
      const oldSignature = a.albumSpectrumSignature();
      const bytes = await old.file.arrayBuffer(); const samples = new Int16Array(bytes, 44); for (let i = 0; i < samples.length; i++) samples[i] = Math.round(samples[i] * .5);
      await a.replaceTrackAudio(old.id, new File([bytes], 'same-size.wav', { type: 'audio/wav' }));
      if (old.file.size !== a.state.tracks[0].file.size || old.duration !== a.state.tracks[0].duration) throw Error('Fixture must preserve byte size and duration');
      const nextURL = a.state.tracks[0].objectUrl; const changed = oldSignature !== a.albumSpectrumSignature();
      a.undo(); const original = a.state.tracks[0].objectUrl === oldURL && (await fetch(oldURL)).ok;
      a.redo(); const replacement = a.state.tracks[0].objectUrl === nextURL && (await fetch(nextURL)).ok;
      return { original, replacement, changed };
    });
    assert.deepEqual(result, { original: true, replacement: true, changed: true });
  });
  await check('bad replacement retains the existing playable source', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest, old = a.state.tracks[0];
      await a.replaceTrackAudio(old.id, new File(['broken'], 'bad.wav', { type: 'audio/wav' }));
      return a.state.tracks[0] === old && (await fetch(old.objectUrl)).ok;
    }); assert.equal(result, true);
  });
  await check('overlay insertion skips a chain of occupied intervals', async () => {
    const result = await page.evaluate(() => {
      const a = audioTest; const tracks = a.state.tracks; a.state.tracks = []; a.state.materials = tracks; tracks.forEach((t) => t.duration = 10);
      a.state.transitionPlacements = [{ id: 'a', trackId: tracks[0].id, lane: 2, start: 0, fadeIn: 0, fadeOut: 0, isOverlay: true }, { id: 'b', trackId: tracks[1].id, lane: 2, start: 15, fadeIn: 0, fadeOut: 0, isOverlay: true }];
      a.state.transitionPlayhead = 0; a.placeTransitionOverlays([tracks[2]]);
      const placed = a.state.transitionPlacements.find((p) => p.trackId === tracks[2].id);
      return { start: placed.start, overlaps: a.placementOverlapsLane(placed) };
    }); assert.deepEqual(result, { start: 25, overlaps: false });
  });
  await reset();
  await check('longer replacement preserves one active source per lane and changes lane source URL', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest; const first = a.state.tracks[0]; a.syncTransitionAudio(0, false);
      const oldSource = a.elements.transitionPlayers[0].src; await a.replaceTrackAudio(first.id, a.state.tracks[2].file);
      // Grow it further to exercise placement reconciliation without huge media fixtures.
      a.state.tracks[0].duration = 10; a.reconcileTransitionPlacements(); a.syncTransitionAudio(0, false);
      return { changed: oldSource !== a.elements.transitionPlayers[0].src, valid: a.state.transitionPlacements.every((p) => !a.placementOverlapsLane(p)) };
    }); assert.deepEqual(result, { changed: true, valid: true });
  });
  await reset();
  await check('spectrogram closes a failed decoder and rejects a stale project result', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest, Real = window.AudioContext; let closed = 0;
      window.AudioContext = class { decodeAudioData() { throw Error('synthetic failure'); } close() { closed++; return Promise.resolve(); } };
      await a.ensureAlbumSpectrogram();
      let release; let started; const gate = new Promise((r) => release = r), ready = new Promise((r) => started = r);
      window.AudioContext = class extends Real { async decodeAudioData(data) { const buffer = await super.decodeAudioData(data); started(); await gate; return buffer; } };
      const pending = a.ensureAlbumSpectrogram(); await ready; await a.newAlbum(); release(); await pending; window.AudioContext = Real;
      return { closed, hasOldSpectrum: Boolean(a.state.albumSpectrogram), tracks: a.state.tracks.length };
    }); assert.deepEqual(result, { closed: 1, hasOldSpectrum: false, tracks: 0 });
  });
  await reset();
  await check('late import cannot dirty or add tracks to a new session', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest, Real = window.AudioContext, file = a.state.tracks[0].file;
      await a.newAlbum(); let release, started; const gate = new Promise((r) => release = r), ready = new Promise((r) => started = r);
      window.AudioContext = class extends Real { async decodeAudioData(data) { const buffer = await super.decodeAudioData(data); started(); await gate; return buffer; } };
      const pending = a.addFiles([file]); await ready; await a.resetAlbumState(); release(); await pending; window.AudioContext = Real;
      return { tracks: a.state.tracks.length, dirty: a.state.hasUnsavedChanges };
    }); assert.deepEqual(result, { tracks: 0, dirty: false });
  });
  await reset();
  await check('Undo snapshots rejoin pending source analysis instead of keeping a loading row forever', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest, Real = window.AudioContext, file = a.state.tracks[0].file;
      await a.newAlbum(); let release, started, decodes = 0;
      const gate = new Promise((r) => release = r), ready = new Promise((r) => started = r);
      window.AudioContext = class extends Real { async decodeAudioData(data) { decodes++; const buffer = await super.decodeAudioData(data); started(); await gate; return buffer; } };
      const pending = a.addFiles([file]); await ready; a.applyHistory(a.historySnapshot()); release(); await pending;
      await new Promise((r) => setTimeout(r, 0)); window.AudioContext = Real;
      return { decodes, state: a.state.tracks[0].analysisState, hasWaveform: a.state.tracks[0].waveform.length > 0 };
    }); assert.deepEqual(result, { decodes: 1, state: 'ready', hasWaveform: true });
    await page.evaluate(() => audioTest.newAlbum());
  });
  await reset([wav('one.wav', 8), wav('two.wav', 10), wav('three.wav', 12)]);
  await check('keyboard reorders tracks and restores focus on the moved handle', async () => {
    const before = await page.evaluate(() => audioTest.state.tracks.map((track) => track.id));
    await page.locator('#trackList .drag-handle').first().focus(); await page.keyboard.press('ArrowDown');
    const after = await page.evaluate(() => ({ ids: audioTest.state.tracks.map((track) => track.id), focused: document.activeElement.closest('.track')?.dataset.id, announcement: document.querySelector('#sessionStatus').textContent }));
    assert.deepEqual(after.ids, [before[1], before[0], before[2]]); assert.equal(after.focused, before[0]); assert.match(after.announcement, /position 2 of 3/);
    await page.keyboard.press('ArrowUp');
  });
  await check('keyboard selects/nudges transition clips and rejects overlapping lane changes', async () => {
    const id = await page.evaluate(() => audioTest.state.transitionPlacements.find((p) => p.trackId === audioTest.state.tracks[0].id).id);
    const clip = page.locator(`[data-placement-id="${id}"]`); await clip.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight');
    let placement = await page.evaluate((id) => audioTest.state.transitionPlacements.find((p) => p.id === id), id);
    assert.equal(placement.start, .25); assert.equal(placement.lane, 0);
    await page.keyboard.press('ArrowDown');
    placement = await page.evaluate((id) => audioTest.state.transitionPlacements.find((p) => p.id === id), id); assert.equal(placement.lane, 0);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown');
    placement = await page.evaluate((id) => audioTest.state.transitionPlacements.find((p) => p.id === id), id); assert.equal(placement.start, 0); assert.equal(placement.lane, 1);
    assert.equal(await clip.getAttribute('aria-pressed'), 'true');
    assert.equal(await clip.evaluate((el) => el === document.activeElement), true);
  });
  await check('keyboard seeks the album waveform without starting paused playback', async () => {
    await page.locator('#albumWaveform').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => Math.abs(Number(document.querySelector('#albumWaveform').getAttribute('aria-valuenow')) - 5) < .1);
    assert.equal(await page.locator('#albumWaveform').getAttribute('role'), 'slider'); assert.equal(await page.locator('#albumWaveform').getAttribute('aria-valuemax'), '30');
    assert.equal(await page.locator('#audioPlayer').evaluate((player) => player.paused), true);
    await page.keyboard.press('End'); await page.waitForFunction(() => Number(document.querySelector('#albumWaveform').getAttribute('aria-valuenow')) > 29.9);
    await page.keyboard.press('Home'); await page.waitForFunction(() => Number(document.querySelector('#albumWaveform').getAttribute('aria-valuenow')) < .1);
    await page.evaluate(() => audioTest.newAlbum());
  });
  await reset();
  await check('close waits for a pending replacement and saves its final source before confirming quit', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest, Real = window.AudioContext;
      for (const [index, track] of a.state.tracks.entries()) track.nativePath = `/synthetic/original-${index}.wav`;
      const original = a.state.tracks[0]; let release, started, finishSave;
      const gate = new Promise((resolve) => release = resolve), ready = new Promise((resolve) => started = resolve);
      window.AudioContext = class extends Real { async decodeAudioData(data) { const buffer = await super.decodeAudioData(data); started(); await gate; return buffer; } };
      const replacement = a.replaceTrackAudio(original.id, original.file, '/synthetic/replacement.wav'); await ready;
      const commands = []; let saved; const previousInvoke = a.desktop.invoke;
      a.desktop.invoke = async (command, args) => {
        commands.push(command);
        if (command === 'save_project') { saved = structuredClone(args.project); return new Promise((resolve) => finishSave = resolve); }
        if (command === 'list_projects') return [];
      };
      const closing = a.requestApplicationClose(); await new Promise((resolve) => setTimeout(resolve, 0));
      const waitedForAnalysis = !commands.includes('save_project') && !commands.includes('confirm_app_close');
      release(); await replacement;
      while (!finishSave) await new Promise((resolve) => setTimeout(resolve, 0));
      const waitedForSave = !commands.includes('confirm_app_close'); finishSave({ id: 'fixture-album' }); await closing;
      window.AudioContext = Real; a.desktop.invoke = previousInvoke;
      return { waitedForAnalysis, waitedForSave, savedPath: saved.tracks[0].nativePath, quitConfirmed: commands.includes('confirm_app_close'), dirty: a.state.hasUnsavedChanges, pending: a.state.pendingEdits.size };
    });
    assert.deepEqual(result, { waitedForAnalysis: true, waitedForSave: true, savedPath: '/synthetic/replacement.wav', quitConfirmed: true, dirty: false, pending: 0 });
    await page.evaluate(() => audioTest.newAlbum());
  });
  await reset();
  await page.locator('#albumName').fill('Keep this latest title');
  await check('failed close preserves the completed replacement and its immediate Undo checkpoint', async () => {
    const result = await page.evaluate(async () => {
      const a = audioTest, Real = window.AudioContext;
      for (const [index, track] of a.state.tracks.entries()) track.nativePath = `/synthetic/original-${index}.wav`;
      const original = a.state.tracks[0]; let release, started;
      const gate = new Promise((resolve) => release = resolve), ready = new Promise((resolve) => started = resolve);
      window.AudioContext = class extends Real { async decodeAudioData(data) { const buffer = await super.decodeAudioData(data); started(); await gate; return buffer; } };
      const replacement = a.replaceTrackAudio(original.id, original.file, '/synthetic/replacement.wav'); await ready;
      const commands = [], previousInvoke = a.desktop.invoke;
      a.desktop.invoke = async (command) => { commands.push(command); if (command === 'save_project') throw Error('Synthetic disk failure'); if (command === 'list_projects') return []; };
      const closing = a.requestApplicationClose(); await new Promise((resolve) => setTimeout(resolve, 0)); release(); await replacement; await closing;
      const keptReplacement = a.state.tracks[0].nativePath === '/synthetic/replacement.wav'; const dirty = a.state.hasUnsavedChanges;
      a.undo(); window.AudioContext = Real; a.desktop.invoke = previousInvoke;
      return { keptReplacement, dirty, quitConfirmed: commands.includes('confirm_app_close'), restoredPath: a.state.tracks[0].nativePath, title: a.elements.albumName.value };
    });
    assert.deepEqual(result, { keptReplacement: true, dirty: true, quitConfirmed: false, restoredPath: '/synthetic/original-0.wav', title: 'Keep this latest title' });
    await page.evaluate(() => audioTest.newAlbum());
  });
  await check('failed analysis never invents a waveform', async () => {
    const result = await page.evaluate(async () => { const a = audioTest; await a.addFiles([new File(['broken'], 'bad.wav', { type: 'audio/wav' })]); const track = a.state.tracks[0]; return { waveformPoints: track.waveform.length, state: track.analysisState }; });
    assert.deepEqual(result, { waveformPoints: 0, state: 'unavailable' });
  });
  assert.deepEqual(pageErrors, []); console.log(`${checks} audio regression checks passed.`);
} finally { await browser.close(); }
