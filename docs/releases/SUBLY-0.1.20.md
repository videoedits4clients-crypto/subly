# SUBLY 0.1.20

## Release status

Preview release. SUBLY is free to use during this preview period — see the in-app Pricing section for current details.

## Highlights

- **Local, offline transcription** — SUBLY runs Whisper transcription entirely on your machine via a bundled worker, with no cloud speech-to-text API involved. The very first transcription on a brand-new install needs a one-time network connection to download the local model; every transcription after that runs fully offline.
- **English and Hindi transcription, with Auto Detect** — these are the two languages currently supported for new projects, plus an "Auto Detect" option.
- **Word-level timestamps** — every transcribed word carries its own start/end time, the foundation for karaoke-style caption highlighting and word-by-word editing.
- **Professional subtitle editing** — reorder, insert, delete, split, and merge words; trim, split, merge, resize, and reorder captions on the timeline; ripple delete; full undo/redo.
- **Caption styling** — font, size, weight, color, background, outline, shadow, and position, all live-updating in the preview.
- **Word-level styling** — color, size, weight, and letter-spacing can each be overridden per individual word; automatic word-by-word highlighting follows playback.
- **Caption animations** — Fade, Pop, Bounce, Slide, Word Fade, Word Pop, and Char Pop entrance/exit presets, applied per caption.
- **Timeline editing** — zoom, fit-to-project/selection, a scrollable ruler, snapping, waveform display, and drag-based timing adjustment with full undo/redo support.
- **Export** — MP4 (burned-in captions, up to 4K, portrait/landscape/square), SRT, VTT, and TXT, all generated locally via the bundled FFmpeg.
- **Hindi/Hinglish workflow** — Hindi projects can display and export either the original Devanagari transcript or a deterministic Romanized ("Hinglish") conversion.
- **Gujarati Script conversion for supported legacy workflows** — projects already set to Gujarati continue to support native Gujarati-script display/export; Gujarati is not offered as a transcription language for new projects (see Limitations).
- **Project persistence and crash recovery** — edits autosave automatically; a project interrupted by a forced app close or crash is detected on next launch and can be retried rather than left stuck.
- **Windows desktop installer** — a standard NSIS installer; no administrator privileges required.

## Important limitations / requirements

- **First transcription requires a one-time network connection.** A brand-new install has no local model yet; the first time you transcribe anything, SUBLY downloads the required Whisper model once. After that, transcription runs locally/offline with no network dependency.
- **New-project transcription currently supports English and Hindi, plus Auto Detect.** Gujarati and other languages are not presented as transcription options for new projects. (Existing projects that were already set to Gujarati before this policy continue to work — see Highlights.)
- **AI text tools and translation require a configured cloud OpenAI capability.** Punctuation fixing, filler-word removal, rephrasing, and translation all call a cloud text model. Without a configured key, these run in a visibly-labeled Demo mode instead of failing silently.
- **Translation uses synthetic, evenly-spaced word timing.** When a caption is translated, its caption-level timing is preserved, but the translated text's word-level (karaoke) timing is regenerated as evenly-spaced values rather than reflecting the new language's actual speech rhythm.
- **No cloud sync or real-time collaboration.** Projects are local to the machine they're created on.
- **No automatic updater.** Installing a newer version means downloading and running a new installer.
- **No file associations.** SUBLY does not currently register itself to open video files from Windows Explorer.
- **Uninstalling does not automatically remove your project data.** Per the standard Windows installer behavior this app uses, uninstalling SUBLY leaves your projects, database, and cached files in place; remove them manually if you want a completely clean uninstall.

## Installation

1. Download `SUBLY Setup 0.1.20.exe`.
2. Run the installer. No administrator privileges are required.
3. Choose an install location (or accept the default) and finish the wizard.
4. Launch SUBLY from the Start Menu or desktop shortcut it creates.

See `docs/INSTALL-WINDOWS.md` for a full first-run walkthrough.

## System behavior

SUBLY bundles everything its core workflow needs — the transcription worker, FFmpeg, and FFprobe are all packaged inside the installer. You do not need to separately install Python, Node.js, or FFmpeg for local transcription, editing, or export to work.
