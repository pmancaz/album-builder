# Album Builder - Project Overview

## Wash and prototype update — 8 November 2026

Version 0.2.1 completes the merged-app Wash with storage/recovery safeguards, preparation state/race fixes, contained exports, media lifecycle cleanup and keyboard accessibility improvements. The default packaged build requires no licence, does not read stored licensing credentials and makes no licensing requests. Commercial builds opt in with the `licensed-release` Cargo feature. Audit and validation details are in `reports/WASH-0.2.1.md`.

## Integration update — 8 November 2026

Version 0.2.0 adds Release Preparation from Release Preparer 0.1.29. `preparation/` contains its UI and pure media/copy helpers; `src-tauri/src/preparation.rs` contains its background media and export commands, namespaced with `prep_` with commercial licence gates enabled only by the `licensed-release` feature. Its standalone project CRUD commands and app entry point were removed. Album Builder owns persistence, album identity, close/flush, library location and appearance. `release-preparation-data.js` maps legacy metadata/copy into the unified preparation stage, links sequence masters and imports standalone projects non-destructively. Both HTML entry points are packaged by `vite.config.js`. Album schema 2 retains preparation; schema-1 albums remain readable. The older Release Copy and metadata UI are hidden compatibility backing fields, not additional editing surfaces. The merged-app Wash was completed in 0.2.1.


## What this project is

Album Builder is a local-first music sequencing workspace. It helps compare demos, arrange them into an album order, review loudness and peak measurements, manage release metadata, and export tagged copies. Source audio is treated as read-only.

The app can run as a browser prototype, but the full save/load/export path is implemented for the packaged Tauri desktop app.

The current development version is **0.2.2**. Its interface uses a minimal system-font macOS design with Day, Night and optional Nautical appearances. The versioned local application is `releases/Album Builder 0.2.2.app`; patch notes live in `CHANGELOG.md`. This is the single project overview document.

## What it appears to be for

This is a practical pre-release album planning tool rather than a mastering tool.

It is meant for:

- loading multiple audio demos
- comparing them by waveform, duration, LUFS, and peak
- previewing album transitions in a three-lane layout, including real overlaps and linear fades
- keeping optional field recordings in `Other Materials` while using them as transition overlays
- moving tracks into and out of `Other Materials`
- tracking each song as a sketch, demo, or master, and replacing its audio as the work improves
- editing release metadata, artwork, notes, and track or album checklists
- keeping rich album and track notes with bullet lists, numbered lists, and checklists, with undo/redo for project edits
- writing copy-ready release descriptions, credits, dates, download links, and platform links
- comparing a reference track against the album without adding it to the sequence
- saving named album sessions
- exporting ordered copies with tags and artwork where supported

## Main technologies

- HTML, CSS, and vanilla JavaScript for the interface
- Web Audio API for decoding and waveform analysis
- `analysis-worker.js` for background loudness and waveform work
- `loudness.js` for the standards-based LUFS calculation
- Tauri and Rust for desktop persistence and FFmpeg-based exporting
- Markdown text imports for the in-app legal viewer
- Lemon Squeezy's public License API for purchase activation and periodic validation

## Important folders and files

- `index.html`
  The main UI shell. It contains the top bar, saved-album rail, sequencing workspace, collapsible utility rail, dedicated Release Copy workspace, About and Legal dialog, and the track/material/reference templates.
- `styles.css`
  The app's layout and control styling. It defines the framed studio workspace, responsive breakpoints, waveform panels, and the save-state indicator. Shared theme colours and locally bundled IBM Plex Mono match the sibling apps.
- `public/theme.css` and `public/fonts/`
  The shared Day, Night, and Nautical colours, plus locally bundled IBM Plex Mono and its OFL licence. The palette matches Zet, Journal, and Paper Pal.
- `error-reports.js`
  Builds local, copyable diagnostic reports with error details and basic interface state. It omits note/audio contents and redacts known credentials; blocked clipboard access offers selectable report text instead.
- `app.js`
  The main front-end controller. It loads audio, manages track/material/reference state, renders waveforms and the optional album spectrogram, handles ordinary playlist playback and the separate three-player transition preview, autosaves, opens legal text, and bridges to Tauri when the desktop app is available.
- `project-data.js`
  Validates saved album records before a project change. Rejects malformed/future records without overwriting the open session.
- `note-sanitizer.js`
  Allows only local rich-note formatting and checklist controls; removes executable markup and external embeds.
- `src-tauri/src/storage.rs` and `src-tauri/src/export.rs`
  Atomic JSON writes and recovery, plus fresh-folder exports that preserve all source and prior output files.
- `tests/` and `reports/WASH-0.1.4.md`
  Synthetic regressions and the full Wash findings, coverage, evidence and remaining native acceptance limits.
- `analysis-worker.js` and `spectrogram-worker.js`
  Run the heavier audio and optional spectrogram analysis away from the main interface thread. Keep each `new Worker(new URL(..., import.meta.url), { type: 'module' })` expression visible at its call site: Vite needs that pattern to bundle the worker and its imports. A generic URL-only worker helper can appear to work in development but fail in the installed app. `spectrogram-analysis.js` combines per-channel energy; the main controller decodes one track at a time to bound memory.
- `loudness.js`
  Holds the LUFS implementation used across the app.
- `PRIVACY.md` and `TERMS.md`
  Source files for the in-app legal reader and repository legal copy.
- `README.md`
  Short setup and platform notes.
- `CHANGELOG.md`
  Short version notes, beginning with the 0.1.3 interface update.
- `Album Builder Website Content.txt`
  Plain-language public-facing copy that explains the artist workflow, practical use, and common questions without implementing a webpage.
- `src-tauri/src/main.rs`
  Tiny Rust entry point that hands off to the shared desktop logic.
- `src-tauri/src/lib.rs`
  Desktop commands for saving, loading, deleting, exporting, and the local Lemon Squeezy licence record. It contains the configured public IDs for the live Album Builder Lemon Squeezy store, product, and variant.
- `src-tauri/tauri.conf.json`
  Tauri app configuration, window size, asset access, build commands, and the explicit ad-hoc macOS signing identity used for local installer builds.
- `assets/icon-source.png`
  Source artwork for the app icon.
- `dist/` and `src-tauri/gen/`
  Build outputs and generated files. These are useful to inspect, but they are not the main source of truth.
- `releases/`, `validation/`, and `test-results/`
  Ignored local outputs for versioned development apps and generated validation evidence. A build or screenshot is not evidence that physical listening or native export acceptance has been completed.

## How the main flow works

1. The interface loads in `index.html` and `app.js` wires up the controls.
2. Audio files are added by file picker or drag and drop.
3. Each track is analysed locally for duration, waveform slices, peak, and LUFS.
4. Tracks can be reordered, renamed, relabelled, or moved into `Other Materials`; playing a track continues through the rest of the album sequence.
5. Transition Layout creates one placement per album track, alternating between lanes one and two. A clip can be dragged earlier, moved between three lanes, and given fade-in or fade-out times. Cross-lane overlaps receive a matching crossfade as a starting point.
6. `+ overlay` imports an extra audio file into `Other Materials` and places it on lane three at the transition playhead. Removing that overlay from the timeline leaves the source available in Other Materials.
7. Three direct HTML media players preview the transition lanes at once. The global volume slider attenuates the combined preview, and the transition layout has its own playhead and transport.
8. Reference tracks stay separate from the sequence, expose their own playback time, LUFS and peak readout, and can be clicked to A/B from any waveform position.
9. Album notes are saved as timestamped, collapsible log entries; per-track notes show a small marker when present.
10. Note-taking opens an artwork-led listening workspace. It provides an optional collapsible track-and-waveform drawer, quiet transport controls, a non-numeric progress slider, and timestamped notes saved against the active track.
11. Saved albums can be archived without removing their project data. The left rail keeps Archived Albums below Saved Albums, where a project can be opened, restored, or permanently deleted.
12. Notes, metadata, Release Copy, and transition placements stay in the project state and autosave after edits.
13. Artist and label link presets are local reusable defaults; applying one records its link snapshot with the current release.
14. Loading a desktop project uses a quiet overlay while its source files and analysis state are restored in the background.
15. In the desktop app, save/load/delete calls go through Tauri and projects are stored as compact JSON in the app data folder.
16. Exports run through Rust and FFmpeg. WAV files are copied unchanged, while supported formats get metadata and artwork embedded. Export also attempts to write a readable `album-metadata.txt` companion; a failed companion write is reported and may leave that file absent or incomplete.
17. Default prototype builds run without activation or licence checks. In a commercial desktop build enabled with `licensed-release`, a customer enters their Lemon Squeezy licence key and checkout email before using saved projects or exports. The native layer checks the expected store, product, and variant IDs, records a single Mac activation, and rechecks that saved activation online when possible without asking the customer to type it again. A successful check grants up to 30 days of offline use; each purchase is configured for two Mac activations in Lemon Squeezy.

## Likely places to edit

- Layout, wording, and interaction changes: `index.html` and `app.js`
- Visual tuning: `styles.css`
- Audio analysis changes: `analysis-worker.js` and `loudness.js`
- Save/load/export behaviour: `src-tauri/src/lib.rs`, `storage.rs`, `export.rs`, and frontend `project-data.js`
- Desktop app setup or build config: `src-tauri/tauri.conf.json`
- Legal text or support copy: `PRIVACY.md`, `TERMS.md`, and `README.md`
- Lemon Squeezy release IDs and activation behaviour: `src-tauri/src/lib.rs`

## Things future agents should know

- Source audio is not normalised or rewritten inside the UI. The analysis is for comparison only.
- Transition Layout is currently an experimental preview on the `cdx/three-lane-transitions` branch. It saves clip positions and fades with the project, but `Export Album` still exports the ordinary ordered source tracks; it does not render the three-lane layout into new mixed masters.
- One media element is assigned to each transition lane. Clips may overlap across lanes, but the interface rejects overlaps within the same lane so that its single player always has one unambiguous source.
- Saved audio items now retain stable IDs in project JSON. This is what lets transition placements reconnect to their source tracks and Other Materials after reopening a project.
- The album volume slider only attenuates from 100% down to silence; it never adds gain. Playback uses the browser's direct native media path so macOS can follow speaker/interface changes reliably. The level meter uses the analysed waveform data and deliberately smooths both rise and fall to avoid a distracting flicker.
- The vertical meter is attached to the right of the album waveform. Reference cards use any embedded MP3 cover artwork that can be read locally and otherwise show a small neutral placeholder.
- The collapsible album spectrogram is built on demand with the same windowed, logarithmic FFT approach used by Music Analyser. It is intentionally not calculated until its panel is opened.
- The album waveform and spectrogram are both time-seek surfaces. Clicking either one starts the matching place in the album sequence.
- Playback does not redraw the whole project on every media event. It batches the playhead into a single animation frame, redraws only the active waveform, and preloads the next album track to reduce disk/cache work at track boundaries.
- When the window returns after sleep, gains focus, or macOS reports an audio-device change, the next deliberate Play refreshes the paused media element at the same position. This avoids needing to restart the app after changing between an audio interface and laptop speakers.
- Every right-hand panel is a native `details` disclosure. Reference tracks and logged album notes are saved with the project but are never part of the album export.
- The collapsible right rail is ordered for active compilation work: readout, references, notes, other materials, then metadata.
- Release Copy is a second workspace reached from the top bar. It formats plain text for direct paste into release platforms, while its artist/label presets persist locally for reuse across projects.
- Artwork blur is an optional local appearance setting. When enabled, the current album artwork supplies a very low-opacity blurred tint behind the workspace.
- Note-taking uses the same native player as normal playback, so it keeps the album sequence moving while a note is being written. The visible Back control returns to the builder; Escape remains a shortcut. Timestamp buttons in a track’s notes jump back to that listening moment.
- Saved desktop projects keep references to the original audio files, so reopening depends on those files still being available.
- The app supports two storage paths: `localStorage` in browser mode and Tauri-backed JSON files in desktop mode.
- `archived` is a small project-level flag stored in both persistence paths. Old project files without it are treated as normal saved albums.
- `save album` and `export album` only make sense in the desktop app when native file paths are available.
- The legal dialog reads the Markdown legal files directly, so the repository copy and in-app copy stay aligned.
- Licensing has no developer-operated server and uses Lemon Squeezy's HTTPS Licence API directly from the Tauri layer. The complete key stays in the local app-data record; the interface only receives a masked ending. The live Album Builder store, product, and variant IDs are configured in `src-tauri/src/lib.rs`; keep the Lemon Squeezy activation limit at two and the licence length perpetual.
- The local licence record also stores the customer email, activation instance, and last successful validation time. Do not include private keys or customer details in error reports.
- Appearance uses locally bundled IBM Plex Mono, a 10px outer frame, square controls, thin rules, compact labels, and restrained cyan/copper construction marks. Day uses warm paper and teal; Night uses charcoal and cyan; Nautical uses deep blue-black, cyan structure, and orange active controls. Keep these aligned with the current Zet, Journal, and Paper Pal sources.
- Error notices provide a Copy error report action so a user can share diagnostic context when reporting a problem. Keep diagnostic text useful without adding private audio or licence credentials.
- Local macOS builds use `bundle.macOS.signingIdentity: "-"`. This makes Tauri seal the complete app bundle with an ad-hoc signature instead of leaving only the Rust executable linker-signed. It is suitable for Pat's local install workflow, but it is not Apple notarisation.
- The starting desktop window is 1440 × 940, with a 900 × 620 minimum. UI changes must also remain usable at the minimum window size.
- Increment only the patch version unless Pat explicitly requests a minor or major version change. Keep `package.json`, the root package entries in `package-lock.json`, `src-tauri/Cargo.toml`, this app's entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` in agreement.
- When the selected Xcode installation blocks Git or a build with its licence prompt on this Mac, `DEVELOPER_DIR=/Library/Developer/CommandLineTools` selects the available command-line tools without changing the machine's global developer-directory setting.

## Reliability contracts after Wash 0.1.4

- New/Open/Archive/Delete wait for pending imports, replacements and artwork edits, then flush the current save. Window Close and macOS Quit use the same frontend flush and native `confirm_app_close` handshake; an error leaves the app open. Closing during export asks the user to wait and try again.
- A project is validated and its files are prepared before the current session is replaced. Missing source audio leaves both the current album and saved record untouched. Stored cover preview can restore artwork when its original has moved.
- A generation counter invalidates asynchronous work after a project/history change. Audio sources are retained while live state, pending work or Undo/Redo history references them, then their temporary URLs are released.
- Native writes use a prepared sibling file, sync and rename, with a previous-save `.bak`. Damaged primary records can recover from a validated backup while preserving the damaged file. Library corruption produces a diagnostic instead of silently hiding a project.
- Native commands run blocking filesystem, HTTP and FFmpeg work on background workers. Record mutations are serialized. Existing licensing/product/offline policies are unchanged.
- Each export gets a new folder. Export never overwrites a source or previous export; per-file diagnostics and format notes accompany partial outcomes.
- Rich notes are sanitized on input/render/serialization. Checklist state is written into saved HTML. Unfinished album and listening notes are saved separately from committed note logs.
- Transition lanes keep non-overlapping clips per lane; automatic repairs move colliding placements forward. Main and transition transports are mutually exclusive.
- Error reports remain local and copy only when requested. Test fixtures use synthetic media and isolated profiles. Native GUI, physical audio devices/listening, live licensing and real external-drive acceptance must be named separately from browser/unit/build evidence.

## Production-worker verification

- Version 0.1.5 repairs the worker-packaging regression introduced in 0.1.4. Both analysis workers must appear as built assets with their supporting code included.
- Run `npm run test:production` after worker/build changes. It serves only `dist/`, imports synthetic MP3/WAV files through the real interface, and checks spectrum work; it does not expose internal app helpers.
- Worker errors include a stable diagnostic code and the analysis stage, without copying audio buffers into reports.

## Open questions

- Whether browser mode is still an active target or only a lightweight prototype.
- Whether the desktop app will remain macOS-first or continue toward broader packaging.
- Whether the current FFmpeg lookup path is enough for all target environments.

## Persistent analysis — 0.2.2

`analysis-cache.js` keys derived waveform/loudness and per-source spectrum data by SHA-256 audio content, algorithm version and decoder profile. `src-tauri/src/analysis_cache.rs` atomically stores bounded disposable records under `Analysis/v1/` in the configured library and copies them when relocating the library. Corrupt/missing/unwritable cache falls back to ordinary analysis. Sequence edits recompose the displayed spectrum from individual track spectra; source changes invalidate by content. See `reports/ANALYSIS-CACHE-0.2.2.md`.
