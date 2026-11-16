# Persistent analysis — Album Builder 0.2.2

Implemented and installed 8 November 2026. Both the installed app and versioned release are ad-hoc signed local builds. Licensing remains disabled for prototypes.

The chosen album library now holds `Analysis/v1/` alongside its album JSON records. Content-addressed waveform/loudness/peak/duration entries are generated during loading/import/replacement; spectrum entries are generated lazily when opening the spectrogram. Entries use SHA-256 of actual source bytes plus an analysis-version/decoder sample-rate profile. Even same-name, same-size, same-timestamp edits invalidate analysis. Identical audio can reuse it across albums, renamed sources and replacements.

The album record remains the authority for track order, names, notes, status, materials and references. The cache has no album-position state to go stale: reorder, removal and insertion recompose the current view from per-source data. Spectrum resolution is independent of album order; its stored Float32 data is fitted to the current album timeline. Undo retains the correct immutable source. Both ordinary tracks and materials/references use the waveform cache.

Cache reads validate data and treat absent/damaged entries as misses. Write failures do not block playback or loading. Native storage rejects traversal/non-cache filenames, pre-existing symlink folders/files, oversized records, and writes completed temporary files via atomic rename. Moving the library copies valid readable entries when possible; source caches remain. Cache-copy failures cannot prevent moving the album records. No album-format migration is needed, and older apps ignore the extra folder.

## Validation

- 47 JavaScript unit tests passed, including actual-byte identity despite unchanged names/size/time, profile invalidation, renaming reuse, corruption validation, spectrum serialization/resampling.
- 54 native tests passed. The actual Keychain-write test was intentionally excluded. New native tests cover cache disk round trip, damaged JSON, copying, traversal rejection and symlink/source preservation. Existing library relocation now verifies caches survive moving to custom storage and back.
- Full browser regression command passed: the previous 68 checks/groups plus the new analysis-cache integration journey.
- The new journey uses real browser decoding/FFT with generated two-track audio and a disposable native-storage stub. Cold: 4 decode calls (two waveform, two spectrum). Reopen: 0 calls, matching spectrum values. Reorder: 0. Same-name/size/time content edit: 2, only the changed source. Replacement with cached audio: 0. Corrupt waveform entries regenerate, and adding renamed identical audio reuses data.
- Three production-bundle worker tests passed for WAV, MP3 and optional FFT workers.
- Build, signatures, Rust formatting and `git diff --check` passed.
- CUA opened the installed app and the user's current album without editing it. First load generated 6 waveform records (5 tracks + 1 material), first spectrum generated 5 entries. Reopening displayed the album/spectrum with all 11 cache files' modification times and sizes unchanged. Cache total was 4,365,852 bytes. Album JSON and recovery files matched their pre-update hashes. The app remains open with the album/spectrum ready.

Evidence: `validation/analysis-cache-0.2.2/` contains command logs, `verification.json`, the before-warm cache stat snapshot and `installed.png`. Original records and previous installed app are backed up outside the repository in `~/Library/Application Support/Album Builder Development Backups/analysis-cache-0.2.2/`.

## Practical limits

Source audio still needs to be available locally and is read/hashed on reopening; audio loading is not eliminated. External edits are detected on reopen, not watched live while playing. First analysis and first spectrum still take time; changed tracks repeat only their required passes. Browser previews continue using memory analysis. Old source entries remain reusable for Undo/other albums and can accumulate: deleting the disposable `Analysis/` folder safely reclaims space but causes regeneration. There is no automatic garbage collection or manual cache-management UI in this change. Dropbox cloud-sync completion was not verified.
