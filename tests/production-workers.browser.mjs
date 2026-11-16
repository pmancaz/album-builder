// Run after `npm run build`. This deliberately serves only the finished dist
// folder: the development server can resolve imports that a packaged app lacks.
// Everything below uses generated audio and a disposable browser profile.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { access, readFile, stat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const artifact = resolve(process.env.PRODUCTION_DIST || 'dist');
const engine = process.env.TEST_BROWSER || 'chromium';
const bundledPlaywright = `${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`;
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || bundledPlaywright).href); }
let server, browser, baseURL, fixtureDirectory, mp3Fixture;

before(async () => {
  await stat(resolve(artifact, 'index.html'));
  // MP3 is encoded from our synthetic WAV, never copied from a personal album.
  // Missing FFmpeg skips only the codec-specific case; worker checks still run.
  let ffmpeg = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
  if (!process.env.FFMPEG_PATH) { try { await access(ffmpeg); } catch { ffmpeg = 'ffmpeg'; } }
  fixtureDirectory = await mkdtemp(resolve(tmpdir(), 'album-builder-workers-'));
  const wavPath = resolve(fixtureDirectory, 'synthetic.wav');
  const mp3Path = resolve(fixtureDirectory, 'synthetic.mp3');
  await writeFile(wavPath, syntheticStereoWav().buffer);
  try {
    await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '5', mp3Path]);
    mp3Fixture = { name: 'Production worker fixture.mp3', mimeType: 'audio/mpeg', buffer: await readFile(mp3Path) };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Missing files return 404. Falling back to index.html here could conceal a
  // missing JavaScript file, which is precisely what this regression protects.
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = resolve(artifact, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(`${artifact}${sep}`)) { response.writeHead(403).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' }[extname(filename)] || 'application/octet-stream';
      const contents = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      response.end(contents);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
  const executablePath = engine === 'webkit' ? process.env.WEBKIT_EXECUTABLE : (process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  browser = await playwright[engine].launch({ headless: true, ...(executablePath ? { executablePath } : {}), ...(engine === 'chromium' ? { args: ['--mute-audio'] } : {}) });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

function syntheticStereoWav() {
  const sampleRate = 16000, samples = sampleRate * 2, channels = 2;
  const bytes = Buffer.alloc(44 + samples * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let index = 0; index < samples; index++) {
    const sample = Math.round(4000 * Math.sin(2 * Math.PI * 440 * index / sampleRate));
    bytes.writeInt16LE(sample, 44 + index * 4); bytes.writeInt16LE(-sample, 46 + index * 4);
  }
  return { name: 'Production worker fixture.wav', mimeType: 'audio/wav', buffer: bytes };
}

async function withImportedTrack(run, fixture = syntheticStereoWav()) {
  const context = await browser.newContext();
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  // Observe real worker messages without replacing their behavior. A successful
  // numeric measurement proves that the worker's imported calculation ran.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.productionWorkerEvidence = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        const record = { protocol: new URL(url, location.href).protocol, results: [], errors: [] };
        window.productionWorkerEvidence.push(record);
        this.addEventListener('message', ({ data }) => {
          record.results.push({ waveformLength: data.waveform?.length, lufs: data.lufs, peakDb: data.peakDb, spectrumLength: data.values?.length, spectrumHasEnergy: data.values ? [...data.values].some((value) => value > -100) : undefined, error: data.error });
        });
        this.addEventListener('error', (event) => record.errors.push((event.message || 'Worker startup failed without a browser diagnostic.').slice(0, 500)));
      }
    };
  });
  try {
    await page.goto(baseURL);
    await page.locator('#audioInput').setInputFiles(fixture);
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 1 && document.querySelector('.track .lufs').textContent !== 'analysing');
    await run(page);
  } finally { await context.close(); }
}

test(`production ${engine}: packaged waveform/LUFS worker and its import run successfully`, () => withImportedTrack(async (page) => {
  const evidence = await page.evaluate(() => window.productionWorkerEvidence);
  const result = evidence.flatMap((worker) => worker.results).find((message) => message.waveformLength > 0);
  assert.ok(result, `No waveform result from production worker: ${JSON.stringify(evidence)}`);
  assert.ok(Number.isFinite(result.lufs) && Number.isFinite(result.peakDb), 'The production worker must return actual loudness/peak measurements.');
  assert.equal(await page.locator('.error-report-notice').count(), 0);
}));

test(`production ${engine}: a generated MP3 reaches real waveform/LUFS analysis`, async (context) => {
  if (!mp3Fixture) { context.skip('FFmpeg is not installed; cannot generate the synthetic MP3.'); return; }
  await withImportedTrack(async (page) => {
    const evidence = await page.evaluate(() => window.productionWorkerEvidence);
    const result = evidence.flatMap((worker) => worker.results).find((message) => message.waveformLength > 0);
    assert.ok(result && Number.isFinite(result.lufs) && Number.isFinite(result.peakDb), `No MP3 analysis result: ${JSON.stringify(evidence)}`);
    assert.equal(await page.locator('.error-report-notice').count(), 0);
  }, mp3Fixture);
});

test(`production ${engine}: optional spectrum worker and its import run successfully`, () => withImportedTrack(async (page) => {
  await page.locator('#albumSpectrogramPanel > summary').click();
  await page.waitForFunction(() => document.querySelector('#albumSpectrogramEmpty').hidden || document.querySelector('#albumSpectrogramEmpty').textContent.startsWith('Spectrum unavailable'));
  const evidence = await page.evaluate(() => window.productionWorkerEvidence);
  const result = evidence.flatMap((worker) => worker.results).find((message) => message.spectrumLength > 0);
  assert.ok(result, `No spectrum result from production worker: ${JSON.stringify(evidence)}`);
  assert.ok(result.spectrumHasEnergy && Number.isFinite(result.peakDb), 'A real stereo signal must have measured spectral energy.');
  assert.equal(await page.locator('#albumSpectrogramEmpty').isHidden(), true);
  assert.equal(await page.locator('.error-report-notice').count(), 0);
}));
