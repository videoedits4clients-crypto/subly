# Installing SUBLY on Windows

## 1. Download the installer

Download `SUBLY Setup 0.1.20.exe`.

## 2. Run the installer

Double-click the downloaded file. No administrator privileges are required — you can install for your own user account without an admin prompt. Choose an install location (or accept the default) and finish the wizard.

## 3. Launch SUBLY

Open SUBLY from the Start Menu or the desktop shortcut the installer created. On first launch, SUBLY sets up a fresh local database automatically — no configuration needed.

## 4. Import/create a project

Click **New project**, choose an aspect ratio, and upload a video (MP4, MOV, WebM, AVI, or MKV).

## 5. Transcribe

Pick a transcription language — **English**, **Hindi**, or **Auto Detect** — and start transcription. See **First transcription** below for what happens the very first time.

## 6. Edit captions

Use the Captions panel and timeline to adjust text, word timing, and word-level style. Every edit autosaves automatically.

## 7. Export

Click **Export** and choose MP4, SRT, VTT, or TXT. MP4 export burns your captions directly into the video using SUBLY's bundled FFmpeg.

---

### First transcription

The speech-recognition model is bundled inside the installer. On first launch SUBLY copies it into your own data folder (a few seconds, no internet needed), so your very first transcription works exactly like every later one — including on a machine that is offline or behind a firewall. (Builds before the P23.1 fix, such as v0.1.20, did not bundle the model and downloaded ~480 MB on first use; if that download was blocked, transcription failed.)

### Offline usage

Transcription runs entirely on your own machine — no internet connection is needed for transcribing English or Hindi audio, editing captions, or exporting MP4/SRT/VTT/TXT.

### AI tools

Local transcription (the core speech-to-text feature) is fully offline, from the first run. This is separate from the **AI text tools** (fix punctuation, remove filler words, rephrase/shorten) and **Translate** menu, which call a cloud text model and require a configured API capability to produce real output — without one, they run in a clearly-labeled Demo mode rather than failing silently. You do not need the AI text tools or Translate to use SUBLY's core transcribe-edit-export workflow.

### If transcription fails

SUBLY shows what went wrong (for example "SUBLY's transcription engine stopped unexpectedly") and **Retry** starts a genuinely new attempt. For support, attach the diagnostics file `%APPDATA%SUBLY datalogs	ranscription.log` — it records the stage, error code and exit codes of each attempt, with file paths reduced and no transcript text, file names or credentials.
