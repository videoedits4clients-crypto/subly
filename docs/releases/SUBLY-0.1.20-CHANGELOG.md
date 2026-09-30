# SUBLY 0.1.20 — Changelog

This is SUBLY's first public Windows release. Rather than listing every internal engineering task that led here, this changelog summarizes what's included, grouped by area.

## Subtitle editing

- Full caption editor with text editing, undo/redo, and autosave.
- Reliable undo/redo: pressing Ctrl+Z or Ctrl+Shift+Z inside a caption now always correctly saves the result, including when nothing else is edited afterward.

## Word-level editing

- Reorder, insert, delete, split, and merge individual words within a caption.
- Word-level timestamps generated automatically during transcription.
- Filler words removed during editing stay removed, even after further edits to the same caption.
- Merging two words into one (e.g. combining "hello" and "world") is handled correctly, including in multi-line captions.

## Styling

- Full caption-level styling: font, size, weight, color, background, outline, shadow, and position.
- Word-level style overrides for color, size, weight, and letter-spacing, correctly scaled at any preview size and in the exported video.
- Automatic word-by-word highlighting as your video plays.
- Animation presets: Fade, Pop, Bounce, Slide, Word Fade, Word Pop, and Char Pop.

## Timeline

- Zoom, fit-to-project/selection, a scrollable ruler, and snapping.
- Waveform display for precise timing.
- Drag-based caption timing adjustment, with the entire drag gesture undoable as a single step.
- Ripple delete.

## Export

- MP4 export with burned-in captions, in portrait, landscape, or square, up to 4K.
- SRT, VTT, and TXT export.

## Reliability

- Project autosave and crash recovery: an interrupted transcription is detected on next launch and can be retried instead of getting stuck.
- Fresh install verified to create a clean project database with no leftover development data.
- No developer-only files included in the installed application.

## Windows desktop

- Standard Windows installer (NSIS) — no administrator privileges required.
- All required components (transcription engine, video processing) are bundled; no separate Python, Node.js, or FFmpeg install needed.
- Single-instance behavior — launching SUBLY while it's already running won't open a duplicate instance.

## Language support

- Local transcription for English and Hindi, plus an Auto Detect option.
- Hindi projects can switch between the original Devanagari transcript and an automatic Hinglish (Romanized) conversion.
- Legacy Gujarati Script projects continue to be supported for display/export (Gujarati is not offered as a transcription language for new projects).
