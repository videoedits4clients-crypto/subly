# SUBLY — Public Launch Copy

Source copy deck for SUBLY 0.1.20's public launch. Every claim below is backed by the product's actual implementation and the verified release documentation (`docs/releases/SUBLY-0.1.20.md`, `docs/INSTALL-WINDOWS.md`, `research/p19_16_final_release_candidate_audit.md`, `research/p19_18_release_distribution_report.md`). No capability is described that isn't confirmed in source or a prior verified report.

---

## 1. Product headline

**SUBLY — Professional subtitles, processed locally on Windows.**

## 2. One-line value proposition

Transcribe, edit, style, and export video captions on your own PC — no cloud transcription service, no per-minute fees, no watermark.

## 3. Short product description

SUBLY is a Windows desktop app for turning raw video into polished, styled subtitles. It transcribes speech locally using a bundled speech-recognition model, gives you a full word-level caption editor with timeline-based timing control, and exports burned-in MP4 captions plus SRT/VTT/TXT files — all processed on your own machine.

## 4. Feature overview

- **Local transcription** with word-level timestamps, currently supporting English and Hindi (plus Auto Detect).
- **Full caption editor** — reorder, insert, delete, split, and merge individual words; edit caption text directly.
- **Caption styling** — font, size, weight, color, background, outline, shadow, and position, live in the preview.
- **Word-level style overrides** — color, size, weight, and letter-spacing can each be set per individual word, with automatic word-by-word highlighting as your video plays.
- **Animation presets** — Fade, Pop, Bounce, Slide, Word Fade, Word Pop, and Char Pop entrance/exit effects, applied per caption.
- **Timeline editor** — zoom, snapping, waveform display, drag-based timing adjustment, ripple delete, and full undo/redo.
- **Export** — MP4 with burned-in captions (portrait, landscape, or square, up to 4K), plus SRT, VTT, and TXT.
- **Hindi/Hinglish display** — Hindi projects can show and export either the original Devanagari script or a Romanized ("Hinglish") conversion.
- **Autosave and crash recovery** — edits save automatically; an interrupted transcription is detected on next launch and can be retried.

## 5. How it works

1. **Import your video.** Drag in an MP4, MOV, WebM, AVI, or MKV file.
2. **Transcribe.** Choose English, Hindi, or Auto Detect — SUBLY generates word-level timestamps locally.
3. **Edit and style.** Fine-tune caption text, timing, and appearance in the editor; pick a preset or build your own look.
4. **Export.** Burn styled captions into an MP4, or export SRT/VTT/TXT — ready for Reels, Shorts, YouTube, or anywhere else.

## 6. Supported languages

**Transcription (new projects):** English and Hindi, plus an Auto Detect option.
Other languages are not currently offered for new-project transcription.

**Hindi display:** Hindi projects can toggle between the original Devanagari transcript and an automatic Hinglish (Romanized) conversion.

**Gujarati:** Gujarati is not currently offered as a transcription language for new projects. Existing projects already using Gujarati Script continue to be supported.

## 7. Local/offline transcription explanation

SUBLY runs its transcription model on your own computer — your audio is never sent to a cloud transcription API. The one exception is the very first transcription on a brand-new installation: SUBLY needs to download the local model once, which requires an internet connection. After that one-time download, transcription works fully offline for as long as you use the app.

## 8. Export formats

- **MP4** — captions burned directly into the video, in portrait, landscape, or square, up to 4K.
- **SRT** — the standard subtitle format, widely supported by video players and platforms.
- **VTT** — WebVTT, for web-based video players.
- **TXT** — a plain-text transcript.

## 9. Privacy/local-processing explanation

Your project files, video, and database all stay on your own computer — SUBLY does not upload them anywhere. Transcription runs locally, using a model downloaded once to your machine. This does **not** mean every feature is fully offline: the optional AI text tools (punctuation fixing, filler-word removal, rephrasing) and the Translate feature send text to a cloud service to work, and only function fully when that's configured — otherwise they run in a clearly-labeled Demo mode. In short: your video and your project data are local; a small number of optional text-based AI features are cloud-dependent.

## 10. AI/cloud feature explanation

SUBLY has two distinct kinds of "smart" features, and it's worth knowing the difference:

- **Transcription** (turning speech into timed text) is local — it runs on your machine using a downloaded model, with no cloud speech API involved.
- **AI text tools** (fix punctuation, remove filler words, rephrase/shorten) and **Translate** are cloud-dependent — they call a cloud text model to work. Without a configured connection to that service, they run in a visibly-labeled Demo mode instead of silently failing. You do not need either of these to use SUBLY's core transcribe → edit → export workflow.

## 11. Installation/download section

See §3 of this document's companion, `SUBLY-DOWNLOAD-PAGE.md`, for the ready-to-paste download block. In short: download `SUBLY Setup 0.1.20.exe`, run it (no administrator rights needed), and launch SUBLY from the Start Menu.

## 12. System requirements

- **OS:** Windows 10 or later, 64-bit (x64). SUBLY is built as a 64-bit Windows application and does not target 32-bit systems or earlier Windows versions.
- **Disk space:** roughly 1 GB for the installed application, plus about 500 MB for the one-time downloaded transcription model (~1.5 GB free space recommended in total).
- **Internet connection:** required once, for the first transcription's model download (see §7). Not required afterward for transcription, editing, or export.
- **CPU / RAM / GPU:** Not formally benchmarked. SUBLY has not undergone dedicated minimum-hardware testing; no specific CPU, RAM, or GPU requirement is published at this time.

## 13. FAQ

**Is SUBLY free?**
Yes — SUBLY is free to use during this preview period, with no locked features or plan tiers.

**Does SUBLY require an account?**
No account or sign-in is required to use the desktop app.

**Does SUBLY require Python?**
No. The transcription engine is bundled inside the installer; you don't need to install Python separately.

**Does SUBLY require Node.js?**
No. SUBLY bundles everything its core workflow needs.

**Does SUBLY require FFmpeg?**
No. FFmpeg is bundled inside the installer for video processing and export — no separate install needed.

**Does transcription happen locally?**
Yes, after the one-time model download on first use (see §7).

**Does it work offline?**
Editing, styling, and exporting always work offline. Transcription works offline after the first-time model download. AI text tools and Translate require a cloud connection to produce real output.

**Which languages are supported?**
English and Hindi for new-project transcription, plus Auto Detect. See §6 for the full picture, including Hinglish display and legacy Gujarati Script support.

**Can I export SRT?** Yes.
**Can I export VTT?** Yes.
**Can I export TXT?** Yes.
**Can I export MP4?** Yes, with captions burned in, up to 4K.

**What happens if I uninstall SUBLY?**
The application is removed, but your project data and local database are left in place by default — uninstalling does not automatically delete your projects.

**Does SUBLY automatically update?**
Not currently. Installing a newer version means downloading and running a new installer.

**Does SUBLY upload my videos?**
No. Your video files and project data stay on your computer.

**What requires a cloud connection?**
Only two things: the one-time transcription-model download on first use, and the optional AI text tools/Translate feature (which is otherwise Demo mode).

## 14. Known limitations

- New-project transcription currently supports English and Hindi, plus Auto Detect — not other languages.
- AI text tools and Translate require a cloud connection to produce real results; without one, they run in Demo mode.
- Translation regenerates word-level timing as evenly-spaced values rather than preserving the original speech rhythm.
- No cloud sync or real-time collaboration — projects are local to the machine they're created on.
- No automatic updater — new versions are installed manually.
- No file-type associations — SUBLY doesn't currently register itself to open video files from File Explorer.
- Uninstalling does not remove your project data automatically.

## 15. Short CTA

**Download SUBLY for Windows — transcribe, style, and export your first subtitle in minutes.**
`[DOWNLOAD LINK]`
