# SUBLY Download Page

Ready-to-paste page content. Source facts verified against `research/p19_18_release_distribution_report.md` and the current source tree — see `SUBLY-PUBLIC-LAUNCH-COPY.md` for the full copy deck this page draws from.

---

## HERO

# SUBLY

### Professional subtitles, locally processed on Windows.

**[DOWNLOAD SUBLY FOR WINDOWS](https://github.com/videoedits4clients-crypto/subly/releases/download/v0.1.20/SUBLY.Setup.0.1.20.exe)**

Version 0.1.20 · Windows · ~566 MB

---

## WHY SUBLY

Most subtitle tools either lock your video behind a cloud upload or charge per minute of transcription. SUBLY transcribes on your own PC using a locally-downloaded model, gives you a real word-level caption editor with timeline control, and exports broadcast-ready MP4s — all without sending your video anywhere.

---

## FEATURES

- Local transcription with word-level timestamps — English and Hindi, plus Auto Detect
- Full word-level caption editing — reorder, insert, delete, split, merge
- Caption styling — font, size, weight, color, background, outline, shadow, position
- Per-word style overrides — color, size, weight, letter-spacing, with automatic word-by-word highlighting
- Animation presets — Fade, Pop, Bounce, Slide, Word Fade, Word Pop, Char Pop
- Timeline editor — zoom, snapping, waveform, drag-based timing, ripple delete, full undo/redo
- MP4, SRT, VTT, and TXT export
- Hindi/Hinglish display toggle
- Autosave and crash recovery

---

## HOW IT WORKS

1. **Import your video** — MP4, MOV, WebM, AVI, or MKV.
2. **Transcribe** — English, Hindi, or Auto Detect, processed locally.
3. **Edit and style** — fine-tune text, timing, and look.
4. **Export** — burned-in MP4, or SRT/VTT/TXT.

---

## LOCAL PROCESSING

Your video and project data stay on your computer — SUBLY doesn't upload them. Transcription runs locally using a model downloaded once to your machine. The optional AI text tools and Translate feature are the exception: they call a cloud service to produce real output, and otherwise run in a clearly-labeled Demo mode. Your video is always local; a couple of optional text features are cloud-dependent.

---

## EXPORT

| Format | What you get |
|---|---|
| MP4 | Captions burned directly into the video — portrait, landscape, or square, up to 4K |
| SRT | Standard subtitle file |
| VTT | WebVTT, for web video players |
| TXT | Plain-text transcript |

---

## SUPPORTED LANGUAGES

**Transcription:** English and Hindi, plus Auto Detect. Other languages aren't currently offered for new projects.

**Hindi display:** toggle between the original Devanagari transcript and an automatic Hinglish (Romanized) conversion.

**Gujarati:** not currently offered for new-project transcription; existing Gujarati Script projects continue to work.

---

## FIRST-RUN MODEL DOWNLOAD

**Why does SUBLY need internet on first use?**

SUBLY's local transcription model needs to be downloaded once on a new installation — this requires an internet connection. Once that one-time download completes, transcription runs fully locally, with no ongoing internet requirement. This is separate from the optional AI text tools and Translate feature, which remain cloud-dependent every time they're used.

---

## FAQ

**Is SUBLY free?** Yes — free during this preview period, no locked features.
**Does it require an account?** No.
**Does it require Python, Node.js, or FFmpeg?** No — everything needed is bundled in the installer.
**Does transcription happen locally?** Yes, after the one-time model download.
**Does it work offline?** Editing, styling, and export always work offline. Transcription works offline after the first-run download. AI text tools/Translate need a cloud connection.
**Which languages are supported?** English and Hindi, plus Auto Detect, for new-project transcription.
**Can I export SRT / VTT / TXT / MP4?** Yes to all four.
**What happens if I uninstall?** The app is removed; your project data is left in place by default.
**Does SUBLY auto-update?** Not currently — install new versions manually.
**Does SUBLY upload my videos?** No.
**What requires a cloud connection?** Only the one-time model download and the optional AI text tools/Translate.

---

## KNOWN LIMITATIONS

- New-project transcription: English and Hindi, plus Auto Detect, only.
- AI text tools/Translate require a cloud connection; otherwise Demo mode.
- Translation uses evenly-spaced word timing, not the original speech rhythm.
- No cloud sync or collaboration.
- No automatic updater.
- No file-type associations.
- Uninstall doesn't remove project data automatically.

---

## DOWNLOAD / CHECKSUM

**SUBLY for Windows**
Version 0.1.20

Filename: `SUBLY Setup 0.1.20.exe`
Size: approximately 566 MB
SHA-256: `6ada3a2c2e65b41cc54fb8a55640aa68bb0bb4dabcfb5842352ec0c5f02d1b08`

**[Download SUBLY Setup 0.1.20.exe](https://github.com/videoedits4clients-crypto/subly/releases/download/v0.1.20/SUBLY.Setup.0.1.20.exe)**

**Verifying your download (optional, recommended):**
Open PowerShell in the folder where you saved the installer and run:

```powershell
Get-FileHash "SUBLY Setup 0.1.20.exe" -Algorithm SHA256
```

The result should exactly match the SHA-256 value above. If it doesn't, the file may be corrupted or incomplete — download it again rather than running it.
