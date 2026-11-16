# Changelog

## 0.2.2 — 8 November 2026

- Added a content-addressed analysis cache inside the chosen library: waveform, loudness, peaks and duration load without repeat decoding; optional per-source spectra reuse FFT results across album openings and sequence edits.
- SHA-256 source checks invalidate changed/replaced audio even when names, lengths and timestamps match; unchanged sources share results across albums. Reordering recomposes spectra from the current sequence.
- Cache files are atomically written, validated and copied with library moves where possible. Missing, corrupt or unwritable cache entries never replace album decisions or prevent normal analysis.

## 0.2.1 — 8 November 2026

- Made prototype builds licence-free, with no activation screen or licensing network calls. Commercial licensing is an explicit `licensed-release` build feature.
- Wash fixes protect unreadable saves, reject relative library settings, contain export writes, isolate concurrent media jobs and previews, and reject non-local media sources.
- Bound preparation changes and save acknowledgments to the correct album/revision; preserve master metadata clears, newer AI edits and work in progress. Corrected multi-file numbering and stale playback responses.
- Improved preparation keyboard/screen-reader navigation and reduced-motion feedback. Updated Vite and affected dependencies; npm audit reports no known vulnerabilities at validation time.
- Expanded local regression coverage and recorded the audit in `reports/WASH-0.2.1.md`.

## 0.2.0 — 8 November 2026

- Integrated Release Preparer 0.1.29 as the Release Preparation stage: master metadata and naming, artist/artwork/video templates, promotional/media/playlist/social copy, optional AI drafting, 4K videos, Canvas loops and package exports.
- Consolidated release metadata and Release Copy into that stage. Shared fields and linked track titles/order feed the Album stage and exports; all preparation work saves with the album and follows its configured library location.
- Added non-destructive import of standalone Release Preparer JSON projects and migrated earlier Album Builder link presets into artist templates.
- Added schema version 2 with version-1 migration, preserving preparation data from older app saves; native media work runs on background workers and respects the Album Builder licence gate.
- Matched the preparation UI to the system-font Day/Night design. The full Wash remains deferred.


## 0.1.6 — 8 November 2026

- Replaced the drafting-paper / monospace presentation with system typography, neutral surfaces, softer controls and simpler Day and Night appearances across the workspace and supporting views.
- Added Settings with appearance choices, optional guidance and artwork tint, and the saved album library location.
- Changing library folders saves pending edits, copies and verifies album and recovery files, preserves the originals and refuses conflicting file contents. The location persists across launches, with a default-folder option and explicit disconnected-drive errors.
- Kept the existing sequencing, analysis, transition layouts, materials, references, metadata, release copy, note-taking, licence and export behavior.
- Removed the approved 0.1.3 and 0.1.4 release folders; retained 0.1.5 as the previous build. Full Wash deferred for UI review.


Short notes about each Album Builder version. This log starts with 0.1.3; earlier development changes remain described in the project overview and Git history.

## 0.1.5 — 2026-10-29

- Fixed packaged audio-analysis and spectrogram workers failing to load their supporting code when opening/importing audio.
- Kept worker cleanup and timeout handling, and added clearer diagnostic codes without suggesting that a valid recording needs replacing.
- Added production-build regression checks so development-server success alone cannot hide this packaging failure.

## 0.1.4 — 2026-10-29

- Protected New/Open/Archive/Delete and macOS close/quit with awaited edits and saves; failed loads retain the current album and missing source records.
- Added atomic JSON writes, previous-save recovery, record validation and exact saved-file access for external-drive albums.
- Export now creates a fresh folder, preserves source and previous output files, handles artwork per format, and reports individual failures.
- Moved native file, licence and FFmpeg operations to background workers.
- Sanitized rich notes, repaired checklist editing/persistence, saved unfinished album/listening drafts, and corrected text Undo and clipboard recovery.
- Fixed audio-source lifetime across Undo/Redo, overlapping transports, stale background work, lane collisions, spectrogram channel/cache handling and paused meters.
- Corrected long-content layouts, reference-card readouts and hidden popover focus; added keyboard sequencing controls.
- Added regression checks and the complete audit/evidence report in `reports/WASH-0.1.4.md`.

## 0.1.3 — 2026-10-29

- Updated the interface to the shared Zet, Journal, and Paper Pal design language: warm paper surfaces, fine borders, square controls, compact labels, and restrained cyan/copper construction marks.
- Matched the Day, Night, and Nautical palettes and bundled IBM Plex Mono locally so the interface no longer needs Google Fonts.
- Placed the track list directly after the album waveform and adapted the details panels and transport controls to smaller windows.
- Added a Copy error report action to error notices for easier troubleshooting.
- Increased the starting desktop window to 1440 × 940 while keeping the 900 × 620 minimum.
- Consolidated the two overview documents into one `Project Overview.md` and documented the versioned development app.
- Kept the existing audio, saved-project, transition-preview, and export behaviour; this revision changes presentation and error reporting, not the audio processing or native backend.
