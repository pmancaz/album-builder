// Settings integration tests use disposable browser storage and a fake native
// bridge; real file migration and persistence are covered by library.rs tests.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--mute-audio'] });
const url = process.env.TEST_BASE_URL || 'http://127.0.0.1:4174';
const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
const page = await context.newPage();
page.setDefaultTimeout(8000);
await page.route('**/@vite/client', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
await page.route('**/app.js', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: await response.text() + '\nwindow.settingsTest = { desktop, state, markUnsaved, openSettings, serialiseProject };' });
});
try {
  await page.goto(url); await page.waitForFunction(() => window.settingsTest);
  await page.locator('#settingsButton').click();
  assert.match(await page.locator('#libraryPath').textContent(), /Browser preview/);
  assert.equal(await page.locator('#chooseLibraryButton').isDisabled(), true);
  await page.locator('[data-appearance=night]').click();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'night');
  await page.locator('#settingsDoneButton').click();
  await page.reload(); await page.waitForFunction(() => window.settingsTest);
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'night');
  console.log('PASS appearance persists across reopen and browser storage controls are disabled');

  await page.evaluate(() => {
    const { desktop } = settingsTest;
    window.calls = [];
    window.selectedFolder = '/fixture/custom';
    window.failSave = false;
    window.locationInfo = { path: '/fixture/default', defaultPath: '/fixture/default', isDefault: true };
    desktop.open = async () => selectedFolder;
    desktop.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'get_library_location') return locationInfo;
      if (cmd === 'list_projects') return [];
      if (cmd === 'save_project') { if (failSave) throw Error('Synthetic save failure'); return args.project; }
      if (cmd === 'change_library_location') {
        locationInfo = { ...locationInfo, path: args.path || '/fixture/default', isDefault: !args.path };
        return locationInfo;
      }
    };
  });
  await page.locator('#albumName').fill('Unsaved album');
  await page.locator('#settingsButton').click();
  await page.locator('#chooseLibraryButton').click();
  await page.waitForFunction(() => document.querySelector('#libraryMessage').textContent.startsWith('Library updated'));
  const calls = await page.evaluate(() => window.calls.map(call => call.cmd));
  assert.ok(calls.indexOf('save_project') >= 0 && calls.indexOf('save_project') < calls.indexOf('change_library_location'));
  assert.equal(await page.locator('#libraryPath').textContent(), '/fixture/custom');
  await page.locator('#resetLibraryButton').click();
  await page.waitForFunction(() => document.querySelector('#libraryPath').textContent === '/fixture/default');
  console.log('PASS relocation flushes unsaved album first, updates the folder and can return to default');

  await page.evaluate(() => { selectedFolder = null; calls.length = 0; });
  await page.locator('#chooseLibraryButton').click();
  assert.equal(await page.evaluate(() => calls.some(call => call.cmd === 'change_library_location')), false);
  assert.equal(await page.locator('#chooseLibraryButton').isEnabled(), true);
  console.log('PASS cancelling the picker leaves location unchanged and controls enabled');

  await page.locator('#settingsDoneButton').click();
  await page.evaluate(() => { selectedFolder = '/fixture/other'; failSave = true; calls.length = 0; settingsTest.markUnsaved(); });
  await page.locator('#settingsButton').click();
  await page.locator('#chooseLibraryButton').click();
  await page.waitForFunction(() => document.querySelector('#libraryMessage').textContent.includes('Synthetic save failure'));
  assert.equal(await page.evaluate(() => calls.some(call => call.cmd === 'change_library_location')), false);
  assert.equal(await page.evaluate(() => settingsTest.state.hasUnsavedChanges), true);
  assert.equal(await page.locator('#settingsDoneButton').isEnabled(), true);
  console.log('PASS failed save blocks relocation, preserves edits and leaves Settings usable');

  // Prove normal desktop, minimum native window and narrow preview remain usable.
  await page.evaluate(() => { failSave = false; settingsTest.state.hasUnsavedChanges = false; clearTimeout(settingsTest.state.autoSaveTimer); });
  await page.locator('#settingsDoneButton').click();
  for (const width of [1440, 1150, 900, 600, 390]) {
    await page.setViewportSize({ width, height: width === 900 ? 620 : 940 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    await page.locator('#settingsButton').click();
    assert.equal(await page.locator('#settingsDoneButton').isVisible(), true);
    assert.equal(await page.locator('#settingsDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.locator('#settingsDoneButton').click();
  }
  console.log('PASS Settings and workspace fit desktop and minimum native window sizes');
} finally { await context.close(); await browser.close(); }
