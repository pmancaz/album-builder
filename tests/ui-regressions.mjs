// Browser regression checks use fresh profiles and generated audio only.
// Run against npm run dev. PLAYWRIGHT_MODULE can point to a locally installed
// Playwright index.mjs without adding a second browser runtime to this project.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.TEST_BROWSER || 'chromium';
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4174';
let browser;
before(async () => {
  const executablePath = engine === 'webkit' ? process.env.WEBKIT_EXECUTABLE : process.env.CHROMIUM_EXECUTABLE;
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(engine === 'webkit' ? {} : { args: ['--mute-audio'] }) });
});
after(async () => { await browser?.close(); });
async function withPage(run, seed) {
  const context = await browser.newContext({ viewport: { width: 900, height: 620 } });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  if (seed) await page.addInitScript(seed);
  await page.goto(baseURL); await page.evaluate(() => document.fonts.ready);
  try { await run(page); } finally { await context.close(); }
}
function syntheticWav() {
  const rate = 16000, samples = rate * 3, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 1000), 44 + i * 2);
  return bytes;
}
async function addTrack(page) {
  await page.locator('#audioInput').setInputFiles({ name: 'Synthetic.wav', mimeType: 'audio/wav', buffer: syntheticWav() });
  await page.waitForFunction(() => document.querySelectorAll('#trackList .track').length === 1 && /\d/.test(document.querySelector('#trackList .lufs').textContent));
  await page.locator('#audioPlayer').evaluate((audio) => { audio.muted = true; });
}

test('W-007: note sanitizer removes active markup but preserves formatted text and old checklist words', () => withPage(async (page) => {
  const result = await page.evaluate(async () => {
    const { sanitizeNoteHtml } = await import('/note-sanitizer.js');
    const clean = sanitizeNoteHtml('<div onclick="window.syntheticAttack=1">Keep <strong>bold</strong><script>window.syntheticAttack=2</script><img src="invalid" onerror="window.syntheticAttack=3"><iframe src="https://example.invalid"></iframe></div><div class="checklist-item is-checked" style="--checklist-depth:99;color:red"><input type="checkbox">Old words<span class="checklist-label"></span></div>');
    const holder = document.createElement('div'); holder.innerHTML = clean; document.body.append(holder);
    return { html: clean, text: holder.textContent, bad: holder.querySelectorAll('script,img,iframe,[onclick],[onerror]').length, checked: holder.querySelector('input').checked, depth: holder.querySelector('.checklist-item').style.getPropertyValue('--checklist-depth'), executed: Boolean(window.syntheticAttack) };
  });
  assert.equal(result.bad, 0); assert.equal(result.executed, false); assert.match(result.html, /<strong>bold<\/strong>/); assert.match(result.text, /Old words/); assert.equal(result.checked, true); assert.equal(result.depth, '5');
  await page.locator('#albumNotesInput').click();
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.setData('text/html', '<p>Safe paste <strong>format</strong><img src="invalid" onerror="window.syntheticAttack=4"></p>');
    document.querySelector('#albumNotesInput').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.locator('#saveAlbumNoteButton').click();
  assert.match(await page.locator('#albumNoteLog').textContent(), /Safe paste format/);
  assert.equal(await page.locator('#albumNoteLog img').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(window.syntheticAttack)), false);
}));

test('W-018: checklist typing, Enter, checked state and logged toggles survive rendering', () => withPage(async (page) => {
  await addTrack(page);
  await page.locator('#albumNotesInput').click(); await page.locator('#albumNotesToolbar [data-list-format=checklist]').click();
  await page.keyboard.insertText('First task'); await page.keyboard.press('Enter'); await page.keyboard.insertText('Second task');
  assert.deepEqual(await page.locator('#albumNotesInput .checklist-label').allTextContents(), ['First task', 'Second task']);
  await page.locator('#albumNotesInput .note-checkbox').first().check(); await page.locator('#saveAlbumNoteButton').click();
  await page.locator('#albumNoteLog summary').first().click(); assert.equal(await page.locator('#albumNoteLog .note-checkbox').first().isChecked(), true);
  await page.locator('#albumNoteLog .note-checkbox').first().uncheck(); await page.locator('#themeButton').click();
  await page.locator('#albumNoteLog summary').first().click(); assert.equal(await page.locator('#albumNoteLog .note-checkbox').first().isChecked(), false);
  assert.equal(await page.locator('#albumNoteLog [contenteditable=true]').count(), 0);
}));

test('W-013: a listening draft survives Make Note, Back and Escape until explicitly discarded', () => withPage(async (page) => {
  await addTrack(page); await page.locator('#trackedNotesButton').click(); await page.locator('#trackedNotesMakeButton').click();
  await page.locator('#trackedNoteInput').fill('A draft worth preserving'); await page.locator('#trackedNotesMakeButton').click();
  assert.equal(await page.locator('#trackedNoteInput').inputValue(), 'A draft worth preserving');
  await page.locator('#noteTakingBackButton').click(); await page.locator('#trackedNotesButton').click();
  assert.equal(await page.locator('#trackedNoteInput').inputValue(), 'A draft worth preserving');
  await page.keyboard.press('Escape'); await page.locator('#trackedNotesButton').click();
  assert.equal(await page.locator('#trackedNoteInput').inputValue(), 'A draft worth preserving');
  await page.locator('#discardListeningNoteButton').click(); assert.equal(await page.locator('#trackedNoteInput').inputValue(), ''); assert.equal(await page.locator('#trackedNoteInput').isDisabled(), true);
}));

test('release preparation retains selectable copy when clipboard access is denied', () => withPage(async (page) => {
  await page.locator('#releaseCopyButton').click();
  const prep = page.frameLocator('#preparationFrame');
  await prep.locator('#longDescriptionInput').fill('Exact text to copy');
  await prep.locator('[data-stage=promotion]').click();
  const frame = page.frames().find(frame => frame.url().includes('/preparation/'));
  await frame.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic clipboard denial'); } } }); document.execCommand = () => false; });
  await prep.locator('#copyTextButton').click();
  assert.match(await prep.locator('#preparationCopyFallback').inputValue(), /Exact text to copy/);
}));

test('legacy link presets migrate into the unified artist-template selector', () => withPage(async (page) => {
  await page.locator('#releaseCopyButton').click();
  const prep = page.frameLocator('#preparationFrame');
  await prep.locator('#artistPresetSelect option[value="album-links-good"]').waitFor({ state: 'attached' });
  assert.deepEqual(await prep.locator('#artistPresetSelect option').allTextContents(), ['artist template', 'Valid preset']);
  await prep.locator('#artistPresetSelect').selectOption('album-links-good');
  await prep.locator('[data-stage=promotion]').click();
  assert.equal(await prep.locator('#websiteUrlInput').inputValue(), 'https://example.com');
}, () => localStorage.setItem('album-builder-release-link-presets-v1', JSON.stringify([null, 7, {}, { id: 'good', name: 'Valid preset', links: { website: 'https://example.com', youtube: {} } }, { id: 'good', name: 'Duplicate' }]))));

test('W-012 and W-019: long names, resized notes and popover keyboard focus remain reachable', () => withPage(async (page) => {
  await page.locator('#settingsButton').click();
  await page.locator('#artBlurAdjustButton').focus(); await page.keyboard.press('Tab'); assert.notEqual(await page.evaluate(() => document.activeElement.id), 'artBlurOpacity');
  await page.locator('#artBlurAdjustButton').click(); await page.locator('#artBlurOpacity').focus(); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'artBlurAdjustButton');
  await page.locator('#settingsDoneButton').click();
  await page.locator('#albumName').fill('W'.repeat(80)); await addTrack(page); await page.locator('.track-name').fill('W'.repeat(180)); await page.locator('.track-name').blur();
  await page.locator('#trackedNotesButton').click(); await page.locator('#trackedNotesMakeButton').click();
  assert.equal(await page.locator('#trackedNoteContext').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
  await page.locator('#trackedNoteInput').fill('A long-screen note'); await page.locator('#trackedNoteInput').evaluate((el) => { el.style.height = '650px'; });
  const submit = page.locator('#trackedNoteComposer button[type=submit]'); await submit.scrollIntoViewIfNeeded();
  const bounds = await submit.boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 620); await submit.click();
  await page.locator('#noteTakingBackButton').click(); await page.locator('#releaseCopyButton').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const back = await page.locator('#albumWorkspaceButton').boundingBox(); assert.ok(back.x >= 0 && back.x + back.width <= 900);
}));

test('W-013: typing only an album-note draft saves it before New and restores it on Open', () => withPage(async (page) => {
  await page.locator('#albumNotesInput').fill('Album draft without a Save Note click');
  await page.locator('#newAlbumButton').click(); await page.waitForFunction(() => document.querySelector('#albumNotesInput').textContent === '');
  await page.locator('#savedAlbums .saved-album').first().click();
  await page.waitForFunction(() => document.querySelector('#albumNotesInput').textContent === 'Album draft without a Save Note click');
  assert.equal(await page.locator('.error-report-notice').count(), 0);
}));

test('W-022: reference measurements stay within the normal desktop side rail', () => withPage(async (page) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.locator('#referenceInput').setInputFiles({ name: 'Synthetic reference.wav', mimeType: 'audio/wav', buffer: syntheticWav() });
  await page.waitForFunction(() => document.querySelectorAll('.reference-row').length === 1 && /\d/.test(document.querySelector('.reference-lufs').textContent));
  await page.locator('.references-panel > summary').click();
  const bounds = await page.locator('.reference-row').evaluate((row) => {
    const rect = (selector) => row.querySelector(selector).getBoundingClientRect().toJSON();
    return { row: row.getBoundingClientRect().toJSON(), main: rect('.reference-main'), stats: rect('.reference-stats'), remove: rect('.remove-reference'), scroll: row.querySelector('.reference-main').scrollWidth, client: row.querySelector('.reference-main').clientWidth };
  });
  assert.ok(bounds.scroll <= bounds.client + 1); assert.ok(bounds.stats.left >= bounds.row.left && bounds.stats.right <= bounds.row.right); assert.ok(bounds.stats.top > bounds.remove.bottom);
}));

test('Wash: preparation respects reduced motion for repeated export feedback', () => withPage(async (page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#releaseCopyButton').click();
  const frame = page.frameLocator('#preparationFrame');
  await frame.locator('#releaseTitleInput').waitFor();
  const motion = await frame.locator('body').evaluate(body => {
    const feedback = body.ownerDocument.createElement('div');
    feedback.className = 'video-export-progress is-encoding';
    body.append(feedback);
    const style = getComputedStyle(feedback, '::after');
    const result = { duration: parseFloat(style.animationDuration), iterations: style.animationIterationCount };
    feedback.remove(); return result;
  });
  assert.ok(motion.duration <= 0.001, `Repeated motion remains enabled: ${motion.duration}s`);
  assert.equal(motion.iterations, '1');
}));

test('Wash: track loudness and peak readouts fit before the status selector', () => withPage(async (page) => {
  await page.setViewportSize({ width: 1600, height: 940 });
  await addTrack(page);
  const bounds = await page.locator('#trackList .track').first().evaluate(track => {
    const metrics = track.querySelector('.track-metrics');
    const values = [...metrics.querySelectorAll('dd')];
    return {
      clipped: values.some(value => value.scrollWidth > value.clientWidth + 1),
      metricsRight: Math.max(...values.map(value => value.getBoundingClientRect().right)),
      statusLeft: track.querySelector('.track-status-wrap').getBoundingClientRect().left,
    };
  });
  assert.equal(bounds.clipped, false);
  assert.ok(bounds.metricsRight < bounds.statusLeft, JSON.stringify(bounds));
}));
