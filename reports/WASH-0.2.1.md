# Album Builder 0.2.1 Wash

8 November 2026. Sustained audit of the merged Album Builder / Release Preparation app, with confirmed local fixes. The prototype is installed at `/Applications/Album Builder.app`; a versioned copy is in `releases/Album Builder 0.2.1.app`. Default builds require no licence key or activation. Commercial licensing remains available through the explicit `licensed-release` build feature.

The pre-existing uncommitted integration work was preserved. Baseline source/settings and the previous installed app are backed up outside this checkout under `~/Library/Application Support/Album Builder Development Backups/wash-0.2.0-baseline/`. No publication, Git commit/push, live AI request, licensing request or credential write was performed. The real library's two files and settings compare byte-for-byte with their audit baseline; tests used disposable albums and generated media.

## Findings fixed

| Area / trigger | Failure and correction | Evidence / regression |
| --- | --- | --- |
| Existing JSON cannot be read | Saving ignored the read error and could replace the record; loading could restore an older backup over the unreadable primary. Both now stop without changing the file on non-missing I/O errors. Corrupt/missing records still recover. | `storage-repro.log`, `storage-fixed.log`; two permission-error native regressions. |
| Future album format beside an older backup | A valid schema-3 primary was mistaken for corruption and silently rolled back to schema 2. Compatibility is now checked inside the same locked read before recovery; newer records and their backups remain unchanged. | `future-schema-before.log`; `wash_future_album_version_is_never_rolled_back_to_an_older_backup`. |
| Relative configured library path | Settings accepted paths resolved through an unpredictable process directory. Both primary and recovered settings now require an absolute library path. | Native relative-path regression. Existing relocation/conflict/disconnected-location tests pass. |
| New/Open/Undo and an old preparation iframe | Save acknowledgments could update a previous album's exported package; Undo left child edits bound to an obsolete session. Album generation, preparation binding and exact revision now govern hydration and acknowledgment. | `bridge-baseline.txt`, `bridge-operation-baseline.txt`, `bridge-after.txt`; eight browser regressions. |
| Preparation edits and master reconstruction | Explicitly cleared metadata reappeared, bonus masters moved to the end, malformed data escaped preflight, and legacy masters without extension details crashed rendering. Defaults now apply only to missing fields, interleaved additions retain position, and validation precedes replacement. | Mapper/shape unit tests and real-iframe legacy regression. |
| Work in progress / late async responses | Navigation or saves could reconstruct an active preparation operation. Late AI drafts replaced newer writing/facts, and old preview authorizations could play a different track. Busy-operation guards, generation/revision checks, three-way draft merging and preview cancellation preserve current work. | Preparation async suite; bridge active-operation regression. |
| Import several masters | Mutating list length produced track numbers 1,3,5; duplicate paths were accepted. A fixed starting index produces contiguous numbers and existing paths are skipped. | Batch-import regression. |
| Encoder setup failure / duplicate export | A rejected listener left the app permanently busy; rapid submissions could start duplicate work. Setup and cleanup now belong to the complete guarded operation. | Listener rejection tests for video/Canvas/compressed preview; duplicate-export regression. |
| Export while artwork is decoding | Exports captured an unfinished/stale canvas; invalid selected artwork replaced a usable image. Exports now await the newest render and selected images decode before committing. Native artwork staging also preserves previous full/web covers on encoding failure. | Controlled render/decode regressions; `native-artwork-baseline.txt`; real native invalid-artwork preservation test. |
| Package links and aliased files | Pre-existing symlinks redirected output outside the package, hardlinks were truncated, and text refresh could target Masters. Native preflight rejects links, restricts refresh to Copy/Admin outputs and commits sidecars atomically. | Four failing-before/passing-after native boundary tests in `native-baseline.txt`. |
| One track's output aliases another source | An earlier output could destroy a later input before it was processed. Every destination is preflighted against all sources by canonical path and file identity; safe same-master updates remain supported. | Cross-track collision/source-preservation regression. |
| Concurrent jobs / previews | Duplicate IDs stole cancellation registrations; simultaneous Canvas previews deleted shared scratch files. Scoped job ownership and isolated temporary folders now preserve each operation and clean failed work. | Real cancellation and overlapping-encoder preview regressions. |
| Non-file media source | FFmpeg accepted a protocol string from recovered data. Inspection and export inputs now resolve to regular local files and media tools receive canonical absolute paths. | `native-media-input-baseline.txt`: local-only `concat:` reproduction, no network request. |
| Damaged reusable templates | One malformed entry could prevent preparation startup or discard valid neighboring presets. Invalid rows are filtered independently and malformed settings normalize safely. | Mixed valid/damaged startup browser regression and pure helper tests. |
| Preparation keyboard / screen-reader use | Active stage lacked programmatic state; copy/video tabs lacked relationships and arrow navigation; duplicate select controls exposed invisible keyboard focus. Current step, tab/panel semantics and standard keys are now present. One native accessible select becomes fully visible on focus; pointer menus remain available. | Browser keyboard/accessibility tests; CUA confirmed Space, Down, Return, Escape, Tab on native Compilation selection. |
| Reduced motion / numeric spacing | The iframe's export feedback still animated indefinitely with reduced motion enabled. Wide track rows also allowed peak values to run into the status selector. Shared motion rules and intrinsic numeric columns fix both. | `motion-before.json` 1.1s/infinite → `motion-after.json` .01ms/one; `metrics-before.png` / `metrics-after.png`; two durable UI tests. |
| Development dependencies | Baseline npm audit reported five advisories. Updated Vite to 6.4.5 and patched affected transitive packages, then rebuilt and tested the actual production bundle. | `dependency-baseline.json`, `dependency-final.json`: zero known npm advisories at audit time. [Vite migration](https://vite.dev/guide/migration), [Vite advisory](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). |

Detailed investigation ledgers and reproductions are local under `validation/wash-0.2.0/`: `audit-ledger.md`, `bridge-ledger.md`, `preparation-ledger.md` and `native-ledger.md`. The folder name identifies the audited baseline; the resulting release is 0.2.1. These generated artifacts are ignored by Git.

## User-requested licence-free prototype

Native startup, validation, activation, deactivation and operation guards return before licence-file access or HTTP in the default build. The frontend hides its licence control and skips validation/activation UI when `licensingRequired` is false. Existing credentials are left untouched. Synthetic native save/export tests verify no activation or validation calls; the installed app visibly opens both workspaces without the gate. Terms/privacy/build documentation now distinguish prototype and explicitly enabled commercial behavior.

## Final validation

| Check | Result |
| --- | --- |
| `npm test` | 45 passed, 0 failed. |
| Native library suite, generated local media | 52 passed, 0 failed. One real Keychain-write test explicitly excluded. |
| Full browser regression command | 68 checks/groups passed: 15 lifecycle, 14 audio, 10 UI, 5 settings, 4 preparation integration, 8 bridge, 12 preparation async/accessibility. |
| Finished production files / workers | 3 passed: generated WAV and MP3 analysis, plus optional spectrum worker and its import. No development-server fallback. |
| Commercial feature compile / pure status test | `cargo test --features licensed-release --lib prototype_status_never_requests_an_activation_or_exposes_stored_credentials`: passed; no live activation. |
| macOS build | Default prototype `npm run tauri:build -- --bundles app`: successful, ad-hoc signed. Installed and versioned copies verify with `codesign --verify --deep --strict`. |
| Working-tree hygiene | `git diff --check` and Rust formatting checks passed. Personal `/database/` excluded from Git. |
| Data preservation | Existing library records/recovery copies and settings unchanged; no test record added to the real library. |

Final command logs: `final-unit.log`, `final-native.log`, `final-browser.log`, `final-production.log`, `licensed-build-check.log`, `final-build.log`. Installation/hash and preservation evidence: `installed-build.json`, `preserved-user-data.json`.

## UI exercised

CUA inspected populated/long-content Album and all preparation stages (Release, Masters, Artwork, Promotion, Videos, Canvas, Review), Settings and AI-settings dialogs, Day/Night/Nautical appearances, and 1440×940, 1150×800 and 900×620 viewports. Browser zoom reached 200% (575×400 CSS viewport); the stacked layout scrolled without horizontal page overflow. The native installed app opened both workspaces without activation. Screenshot/AX evidence is in `installed-prototype.png` and `installed-prototype-ax.txt`. Automated tests additionally exercise empty/error/disabled states, clipboard failure, malformed saved data, close/save failure and minimum-window layouts.

## Remaining coverage limits

- No live OpenAI generation, real credentials/Keychain writes, licensing-service call, third-party publishing or public notarization. The signed app is a local development build.
- No recovery/relinking experiment on the user's recordings, real external-drive disconnection, or claim about Dropbox cloud-sync completion. Referenced audio still needs to exist at the saved paths and be available offline.
- macOS is the supported/tested package. Windows/Linux, full VoiceOver operation, a standalone WebKit automation suite, long-recording thermal/performance endurance, power-loss/disk-full behavior and a RustSec dependency scan were not exercised in this pass.
- Package updates remain progressive rather than a multi-file transaction. Pre-existing link checks do not constitute a sandbox against a hostile process concurrently swapping filesystem directories. Third-party codecs and embedded references in unusual media containers were not fuzzed.

Further local passes reached diminishing returns after the confirmed integrity/lifecycle/accessibility defects and full regressions. This audit does not establish that every defect is absent.
