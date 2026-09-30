# SUBLY 0.1.20 — Distribution Checklist

Every item below was individually verified against the actual release artifact before being checked off (see `research/p19_18_release_distribution_report.md` for the exact evidence behind each one).

- [x] Installer exists — `release/SUBLY Setup 0.1.20.exe`, confirmed present.
- [x] SHA-256 generated — `6ada3a2c2e65b41cc54fb8a55640aa68bb0bb4dabcfb5842352ec0c5f02d1b08`, computed independently via both `certutil` and PowerShell's `Get-FileHash`, both agree. Recorded in `release/SUBLY-0.1.20-SHA256.txt`.
- [x] Version verified — installer's own `FileVersion`/`ProductVersion` metadata both read `0.1.20`.
- [x] Installer size recorded — 566,402,175 bytes, matching the P19.17 release-build report exactly.
- [x] Release notes prepared — `docs/releases/SUBLY-0.1.20.md`.
- [x] Installation instructions prepared — `docs/INSTALL-WINDOWS.md`.
- [x] Supported languages documented — English + Hindi + Auto Detect for new-project transcription; Gujarati Script conversion documented as legacy-project-only, not a new-project transcription option.
- [x] First-run model download documented — in both the release notes and the install guide.
- [x] Offline behavior documented — in both documents.
- [x] Cloud AI requirements documented — AI text tools/Translate's cloud dependency and Demo-mode fallback documented, distinguished from fully-local transcription.
- [x] Known limitations documented — translation's synthetic word timing, no cloud sync, no auto-updater, no file associations, uninstall leaves user data — all in the release notes.
- [x] No development/debug files included in release package — directly re-verified inside the installer's own packaged contents (`resources/app-server/`): `AGENTS.md`, `CLAUDE.md`, `README.md`, and the stray `.db.bak` marker fixed in P19.14 are all confirmed absent.
- [x] Release artifact identified as 0.1.20 — confirmed by file-version metadata, not just the filename.
- [x] Ready for upload/distribution — all items above verified true at the same point in time, against the same file, with no source change since.

## Note on the `release/` working directory vs. the distributable artifact

Only **`release/SUBLY Setup 0.1.20.exe`** (plus, optionally, its checksum file) should actually be uploaded/distributed. Everything else currently in the local `release/` directory is a build-time working file — see `research/p19_18_release_distribution_report.md` §7 for the full breakdown of what's there and why none of it belongs in the distributed package.
