STATUS: RELEASE READY

# P19.17 — Release Preparation

## 1. Release Version

0.1.20

## 2. Engineering Release Status

Reference: `research/p19_16_final_release_candidate_audit.md` — **RELEASE CANDIDATE CLEAN**. 0 P0 open, 0 P1 open, 11 documented non-blocking P2 items, 1886/1886 tests passing, 0 TypeScript errors, 0 ESLint errors (5 pre-existing warnings), 14/14 packaged smoke test items passing. This task did not reopen or re-litigate any of that engineering backlog — see §6 for the only work performed here.

## 3. Marketing/Product Copy Changes

Located by searching the entire source tree for `Typewriter`/`typewriter`, `"Style every word"`, `"fonts, colors, animation"`, and related per-word phrasing (§2 of the task). Six occurrences found across 5 files; all six were directly connected to the two flagged overclaims and were corrected. No unrelated copy was touched.

### Fix #1 — "Typewriter" naming (implies a true character-by-character reveal that doesn't exist)

Confirmed via `src/lib/subtitles/animation-render.ts`: `typewriter`, `word-pop`, and `char-pop` are all rendered identically — a single capped ~150ms fade (`APPROXIMATED_FADE_ENTRANCES`, `APPROXIMATED_FADE_CAP_SEC = 0.15`) in both the live preview and the ASS export. There is no progressive/per-character reveal in either renderer. Three user-facing occurrences of the name were corrected; the internal `"typewriter"` enum value/preset `id` were left untouched everywhere (existing saved projects and presets reference them — renaming those would be a data-model change, not a copy fix).

| File | Before | After | Reason |
|---|---|---|---|
| `src/components/editor/animation-panel.tsx` | `{ value: "typewriter", label: "Typewriter" }` | `{ value: "typewriter", label: "Word Fade" }` | The in-app animation picker's label; "Word Fade" accurately names the actual fade behavior without implying a reveal effect. |
| `src/components/landing/features.tsx` | `"Fade, pop, bounce, slide, typewriter — entrance, exit and per-word animations."` | `"Fade, pop, bounce, slide, word fade — entrance and exit animations, with automatic word-by-word highlighting."` | Matches the in-app rename; also fixes the adjacent "per-word animations" overclaim (see Fix #2 rationale — animation has no per-word concept at all). |
| `src/lib/presets.ts` (the `"typewriter"` preset) | `name: "Typewriter"`, `description: "Even, wide spacing with a classic character-by-character reveal."` | `name: "Wide Type"`, `description: "Even, wide letter spacing with a quick fade-in."` | This was the most specific overclaim of the three — it explicitly promised "a classic character-by-character reveal," which is not what the preset does. |

### Fix #2 — "Style every word — fonts, colors, animation" (implies unsupported per-word capabilities)

Confirmed via `src/lib/subtitles/word-style-capabilities.ts` (the authoritative capability map): per-word `color`, `fontSize`, `fontWeight`, and `letterSpacing` are genuinely `"supported"` end-to-end (editor, preview, export). Per-word `fontFamily`, outline, shadow, text-case, and background-radius are all `"unsupported"` by explicit design. **There is no per-word `animation` concept at all** — animation is configured per caption/project only; the map has no entry for it because it isn't a `SubtitleStyle` property a word can override. The claim "fonts, colors, animation" — read as things you can style "every word" with — was therefore inaccurate on two of its three nouns (fonts and animation).

| File | Before | After | Reason |
|---|---|---|---|
| `src/components/landing/how-it-works.tsx` | `{ title: "Style every word", desc: "Pick a preset or craft your own look — fonts, colors, animation, word highlighting." }` | `{ title: "Style every word", desc: "Pick a preset for the whole caption, then fine-tune individual words — color, size and automatic highlighting." }` | The title is kept (color/size genuinely are styleable per word, so "style every word" remains true for those properties); the description now scopes preset/font/animation choice to the whole caption and lists only the genuinely per-word properties (color, size, automatic highlighting). |

### Adjacent occurrence also corrected (directly connected wording, found via the same search)

| File | Before | After | Reason |
|---|---|---|---|
| `src/lib/transcription/mock-provider.ts` (`SAMPLE_SCRIPT`, the offline/no-API-key demo transcript) | `"...and lets you style every single word. You can customize fonts, colors, animations, and even highlight words as they're spoken..."` | `"...and lets you fully customize the look — fonts, colors, animations and presets. Each word even highlights as it's spoken..."` | This mock transcript is genuinely reachable by a real user (used whenever transcription runs without an OpenAI key configured — `src/lib/transcription/index.ts`), and used nearly identical wording to the flagged overclaim ("style every single word... fonts, colors, animations"). Corrected to the same accurate scoping: caption-level customization plus real per-word highlighting. No test asserts on this string's exact content (checked before editing). |

`src/components/landing/pricing.tsx`'s similar-sounding line ("Full caption styling — fonts, colors, animation, word highlighting") was reviewed and **left unchanged** — it describes caption-level styling generically, never claims "every word," and was already reviewed/rewritten in P19.12's pricing fix.

## 4. Unchanged Product Functionality

**No feature implementation was changed.** Every edit in this task was a string literal (a UI label, a landing-page description, a preset's display name/description, or a demo transcript sentence). Specifically confirmed unchanged:
- The `typewriter` entrance animation's actual behavior (`animation-render.ts`'s fade-cap logic) — untouched.
- The `"typewriter"` preset's `id`, `style`, and `animation` config (font, weight, size, letter-spacing, entrance type, duration) — untouched, only `name`/`description` changed.
- Word-level style capabilities (`word-style-capabilities.ts`) — untouched; no property's support was added, removed, or reclassified.
- All other application code (store, autosave, undo/redo, timeline, rendering, export, packaging, transcription pipeline) — untouched, per this task's explicit scope.

## 5. Remaining Known Limitations

(User-relevant subset of P19.16's documented list — none require action before release, per that audit's own conclusion.)

- AI text tools (fix punctuation, rephrase, shorten) and translation require a cloud OpenAI API key; without one, they run in a "(Demo)" no-op mode. Not disclosed in marketing copy today. Reviewed in this task's §5 pass — judged not materially misleading (the app's own UI already labels demo mode explicitly when reached), left unchanged per this task's narrow scope.
- Translation resets word-level (karaoke) timing to evenly-spaced synthetic values while preserving caption-level timing — not disclosed. Same judgment as above; left unchanged.
- Gujarati (and other) ASR transcription remains deferred; GPU transcription deferred; cloud sync/real-time collaboration out of scope.
- No file associations; no auto-updater (install-new-version model); no in-app About/version display.
- 5 pre-existing ESLint warnings, unchanged since P19.12.

## 6. P2/P3 Deferred Work

Unchanged from P19.16 — 11 open P2 items (export-dialog quality staleness, a narrow autosave success-handler race, `TOO_FAST`/`TOO_SHORT` counting, apostrophe path escaping, malformed style-data type-checking, word-level `fontWeight` font-bundling, offline font-cache coverage, `afterPack`'s soft ffmpeg/ffprobe check, multi-selection overlay virtualization, `boxWidthPercent`/ASS margin mismatch — packaging-hygiene and installer-staleness were already resolved) plus the large, stable P3/known-by-design inventory. None were touched, none were silently reclassified as blockers, and none required action for this release — consistent with P19.16's own conclusion.

## 7. Release Artifact

- **Installer filename:** `release/SUBLY Setup 0.1.20.exe`
- **Installer size:** 566,402,175 bytes (previous, pre-copy-fix build: 566,397,087 bytes — the ~5KB difference is consistent with the six small text changes)
- **Version:** 0.1.20 (unchanged — no bump, per this task's explicit instruction)
- **Whether rebuild was required:** **Yes.** All five edited files (`animation-panel.tsx`, `features.tsx`, `how-it-works.tsx`, `presets.ts`, `mock-provider.ts`) are part of the Next.js application bundled into `.next/standalone` and shipped inside the installer via `extraResources` — the corrected copy would not have reached end users without a fresh build. Ran the real, complete, unmodified `npm run electron:pack` pipeline (no step substituted); confirmed the resulting installer is still version 0.1.20 (`electron-builder`'s own build log: `file=release\SUBLY Setup 0.1.20.exe`).

## 8. Final Release Checklist

- [x] Version correct (0.1.20, unchanged)
- [x] Installer current (freshly rebuilt this task; matches current source exactly)
- [x] No P0
- [x] No P1
- [x] Tests passing (1886/1886, unchanged count — no test was added/removed/modified, only landing/preset/demo-copy strings)
- [x] TypeScript clean (0 errors)
- [x] ESLint clean except known warnings (0 errors, same 5 pre-existing warnings)
- [x] Packaged smoke test previously passed (P19.16's 14/14; this task additionally re-ran a minimal 3-point check — app launch, corrected copy present in the compiled bundle and rendered HTML, and a real caption edit + isolated Ctrl+Z persisted correctly — against the freshly rebuilt installer, all passing)
- [x] Marketing copy truthful (both flagged overclaims corrected; one directly-connected adjacent occurrence also corrected; nearby copy reviewed against P19.16's known-limitations list, no further change judged necessary)
- [x] No unrelated source changes (six string-literal edits only, confirmed via the diff scope — no logic, architecture, test, or config file touched)
- [x] Release artifact identified (`release/SUBLY Setup 0.1.20.exe`, 566,402,175 bytes)

## 9. Source Regression (run after the copy edits)

- `npm test`: **1886/1886 passing**, 0 failing — identical count to P19.16 (no test file was touched; the six edits were all non-test string literals in components/lib files with no test asserting on their exact content, confirmed before editing).
- `npx tsc --noEmit`: **0 errors.**
- `npx eslint .`: **0 errors**, the same 5 pre-existing warnings, no new warning.

No regression occurred; no further investigation was needed.

---

**Final technical assessment:** Both marketing overclaims P19.16 flagged are corrected, along with one directly-connected adjacent occurrence found during the required source-tree search. No product functionality changed. Source regression is clean and unchanged from P19.16. The packaged 0.1.20 installer was rebuilt (genuinely necessary, since the copy lives inside the packaged bundle) and re-verified: it launches, contains the corrected copy, and preserves the existing core workflow including the P19.15 undo/redo fix. SUBLY 0.1.20 is release-ready.
