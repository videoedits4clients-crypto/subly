# P19.18 — Release Distribution Package

**Task ID:** SUBLY-P19.18-RELEASE-DISTRIBUTION-PACKAGE-148731
**Date:** 2026-09-30

This was a documentation/distribution-preparation task only. **No product code was modified.** Confirmed via `find src scripts electron -newer "release/SUBLY Setup 0.1.20.exe"` returning empty both before and after this task's work — zero files under `src/`, `scripts/`, or `electron/` have a modification time newer than the P19.17 installer build.

## 1. Release artifact verification

| Item | Value | Method |
|---|---|---|
| File exists | `release/SUBLY Setup 0.1.20.exe` | Direct filesystem check |
| Size | **566,402,175 bytes** | `Get-Item.Length` |
| SHA-256 | **6ada3a2c2e65b41cc54fb8a55640aa68bb0bb4dabcfb5842352ec0c5f02d1b08** | Computed independently via both `certutil -hashfile` and PowerShell `Get-FileHash -Algorithm SHA256` — both agree exactly |
| FileVersion / ProductVersion (exe metadata) | `0.1.20` / `0.1.20` | `.VersionInfo` |
| ProductName | `SUBLY` | `.VersionInfo` |
| CompanyName | `Akshay Creations` | `.VersionInfo` |
| Matches the P19.17 release build | **Yes** | Size (566,402,175 bytes) matches P19.17's own report byte-for-byte; timestamp (2026-09-30 16:31) matches that build's own log; `electron-builder`'s build log for that run explicitly names `release\SUBLY Setup 0.1.20.exe` as its output |
| No newer installer has replaced it | **Confirmed** | `find release -newer "release/SUBLY Setup 0.1.20.exe"` returns only the blockmap and `builder-debug.yml`, both produced by electron-builder a few seconds after the exe as part of the *same* build run — not a later, separate build |

## 2. Files created

- `docs/releases/SUBLY-0.1.20.md` — release notes.
- `docs/INSTALL-WINDOWS.md` — installation guide.
- `release/SUBLY-0.1.20-SHA256.txt` — checksum file, containing the exact value computed above (`6ada3a2c2e65b41cc54fb8a55640aa68bb0bb4dabcfb5842352ec0c5f02d1b08  SUBLY Setup 0.1.20.exe`).
- `docs/releases/SUBLY-0.1.20-DISTRIBUTION-CHECKLIST.md` — distribution checklist, every item individually verified before being checked off (see checklist file itself for what backs each one).
- `research/p19_18_release_distribution_report.md` — this file.

**Not created:** `docs/releases/SUBLY-0.1.20-GITHUB-RELEASE.md` (Step 6). This repository is **not** clearly configured for GitHub distribution: `git remote -v` returns no remotes at all, `package.json` has no `repository`/`homepage`/`bugs` field, and there is no `.github/` directory. Per the task's own explicit condition ("If this repository is clearly configured for GitHub distribution, create..."), that condition isn't met, so this file was intentionally not created rather than fabricating GitHub-specific material for a repo with no evident GitHub configuration.

## 3. Content sources for the release notes (evidence, not invention)

Every capability and limitation listed in the release notes was checked directly against source, not assumed:

- **English/Hindi + Auto Detect, Gujarati deferred:** `src/lib/language-policy.ts`'s `LANGUAGE_POLICY` — `en`/`hi` are the only entries with `status: "supported"`; every other language (including `gu`) is `"deferred"`. `TRANSCRIPTION_LANGUAGE_OPTIONS` (`src/types/subtitle.ts`) includes an explicit `"auto"` entry.
- **Gujarati Script for legacy projects only:** `src/lib/subtitles/output-mode.ts`'s `projectSupportsGujaratiScript` gates purely on `project.language === "gu"`; since the language policy above prevents any *new* project from ever reaching `"gu"`, this path is only reachable by a project that already had it before the freeze — documented as "legacy" accordingly.
- **Word-level style capabilities:** `src/lib/subtitles/word-style-capabilities.ts` — `color`, `fontSize`, `fontWeight`, `letterSpacing` are `"supported"`; there is no per-word `animation` property at all (consistent with P19.17's own marketing-copy fix).
- **Bundled runtime (no separate Python/Node/FFmpeg needed):** re-confirmed directly inside the current installer's own packaged contents (`release/win-unpacked/resources/app-server/`) — `python/dist/whisper-worker.exe`, `node_modules/ffmpeg-static/ffmpeg.exe`, and `node_modules/@ffprobe-installer/win32-x64/ffprobe.exe` are all present, matching every prior packaged-QA task (P19.13–P19.17).
- **First-run model download / offline-after-that:** established and repeatedly reproduced in P19.13/P19.14/P19.15 (a fresh install's first-ever transcription downloads `faster-whisper-small` once; every subsequent transcription in that and every other language pair uses the already-cached model with no network call).
- **AI tools/translation cloud dependency and Demo-mode fallback, synthetic translation word timing, no cloud sync, no auto-updater, no file associations, uninstall leaves user data:** all directly carried over from the confirmed, source-verified findings in `research/p19_11_release_candidate_gap_audit.md` and re-confirmed still accurate (unchanged) in `research/p19_16_final_release_candidate_audit.md`.
- **Crash recovery:** re-verified working as recently as P19.16's own packaged smoke test (item 13).
- **No admin elevation required:** `package.json`'s `build.nsis` config has no `perMachine: true`; every silent install performed across P19.13–P19.17 completed with no UAC prompt.

No capability was described that isn't backed by one of the above.

## 4. Step 7 — Release directory hygiene

Full inventory of `release/` as it exists on this machine right now, classified:

| Path | Classification | Should it be distributed? |
|---|---|---|
| `SUBLY Setup 0.1.20.exe` | **The official release artifact** | **Yes** — this is what gets distributed. |
| `SUBLY-0.1.20-SHA256.txt` | **Official release companion file** (created this task) | **Yes, optionally** — lets recipients verify integrity; not required but recommended. |
| `SUBLY Setup 0.1.20.exe.blockmap` | Build artifact (electron-builder's differential-update block map) | **No** — only useful for an auto-updater, which SUBLY doesn't have. Harmless to keep locally, not meant for end users. |
| `builder-debug.yml` | Build artifact (electron-builder's internal debug/config dump) | **No** — a build-machine diagnostic file, not application content. May contain local build-machine paths; no reason to ship it. |
| `.icon-ico/icon.ico` | Build intermediate (icon-conversion byproduct of the build step) | **No** — the icon is already embedded in the `.exe` and inside the packaged app; this is a leftover conversion artifact, not a deliverable. |
| `win-unpacked/` (entire directory) | Build intermediate — the unpacked application tree electron-builder assembles before compressing it into the NSIS installer | **No** — this is not a distributable format (no installer/uninstaller experience, no single file to hand out); it's working output, already fully represented inside the `.exe`. |

**Recommendation:** distribute only `SUBLY Setup 0.1.20.exe` (and, optionally, `SUBLY-0.1.20-SHA256.txt` alongside it for integrity verification). Nothing else in `release/` should be uploaded. Per the task's explicit instruction, nothing was deleted — this is a classification report only.

## 5. Validation performed

- Installer existence, size, and SHA-256: verified directly (§1).
- Version: verified via the installer's own embedded file-version metadata, not just its filename.
- No product-code change: verified via `find -newer` against the installer's own build timestamp, both before starting this task and again after finishing it.
- Packaging hygiene still holds: re-checked directly inside the current build's own `resources/app-server/` — `AGENTS.md`/`CLAUDE.md`/`README.md`/stray `.db.bak` all confirmed absent (the P19.14 fix holds for this exact artifact).
- The full P19 regression suite (`npm test`/`tsc`/`eslint`) was **not** re-run — per the task's own instruction, this was only required "to establish that no source code changed," and the `find -newer` check already established that directly and more precisely (a test-suite pass doesn't prove *zero* files changed; a timestamp diff does).

## 6. Outstanding issues

None. No source, test, or packaging-configuration change was needed or made. The GitHub-release file was intentionally not created (§2) — this is a scope decision based on the task's own stated condition, not an unfinished item.
