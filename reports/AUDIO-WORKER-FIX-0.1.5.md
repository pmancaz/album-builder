# Audio worker packaging fix — 0.1.5

Date: 29 October 2026 (Australia/Sydney).

## Cause

The 0.1.4 worker cleanup refactor passed a URL into a generic worker constructor. Vite could no longer recognize each worker entry point. It treated the small worker scripts as ordinary inline assets, leaving their relative imports inside `data:` URLs. Both loudness/waveform analysis and spectrogram analysis then failed to load their supporting code. Development-server tests passed because those source imports were available there. This was a regression introduced in 0.1.4, not evidence of a damaged MP3.

## Repair

`app.js` now passes a worker factory to the shared cleanup helper. Each caller retains Vite's recognizable `new Worker(new URL(..., import.meta.url), { type: 'module' })` expression, producing separate complete worker bundles. Timeouts, transfer handling and worker termination remain shared. Failures include an analysis label and a stable diagnostic code; worker failures no longer advise replacing the recording.

The version is 0.1.5. Project Overview, README, package versions and CHANGELOG are updated. The native backend and audio measurement algorithms did not change.

## Verification

- Preserved 0.1.4 production files reproduced the waveform and spectrum failures in both Chromium and WebKit: all four original probes failed with worker startup errors.
- The repaired production build passed three tests in each engine, with no skips: generated WAV analysis, generated MP3 analysis, and actual spectrogram energy. The test server serves only the finished `dist/` files, so source files cannot conceal missing bundled dependencies.
- All 14 existing audio/history/lifecycle regressions passed; all 10 JavaScript unit tests passed.
- The Tauri macOS arm64 build and strict ad-hoc signature check passed. The installed 0.1.5 app opened a disposable saved WAV/MP3 album with numeric loudness/peak measurements; its waveform and spectrogram were inspected in the native window.
- The previously open user album was then reopened in 0.1.5. All six tracks, including the reported MP3, showed numeric loudness/peak measurements without an analysis notice. No playback or physical-listening claim is made.
- Existing project JSON hashes remained unchanged. The disposable saved test album was removed after checking; only generated validation media remains in the ignored validation folder.

Run `npm run test:production` to rebuild and repeat the Chromium checks. Set `TEST_BROWSER=webkit` and the local `WEBKIT_EXECUTABLE` to repeat in WebKit. The tests accept `PRODUCTION_DIST` for a preserved build. Existing Playwright runtime variables are documented in README.

Evidence is under `validation/worker-packaging-0.1.5/`: baseline/fixed engine logs, audio regression log, build log, package identity and native project-integrity results. Native accessibility and screenshot evidence is recorded in the task transcript. One transient capture error (-3812) occurred during loading; the subsequent native state and screenshot succeeded.

Development app: `releases/Album Builder 0.1.5.app`.
Executable SHA-256: `a54c6aafa7061d32278b339145c14d786ca321ddca882c41fe96a03552feabed`.
