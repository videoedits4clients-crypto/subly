import type { Subtitle, Word, CaptionOutputMode, ProjectData } from "../../types/subtitle.ts";
import { transliterateWord, containsDevanagari } from "./hinglish.ts";
import { devanagariToGujaratiScript } from "./gujarati-script.ts";
import { joinWithOriginalLineBreaks } from "./ass.ts";
import { tokenizeCaptionText, sumWordTokens } from "./word-timing.ts";

/** The two OUTPUT modes that actually have their own derived text to go stale/regenerate — plainly
 * excludes "original" (see getDerivedWordTextSyncStatus/regenerateHinglishForSubtitle/
 * regenerateGujaratiScriptForSubtitle below, Task 106284, P17.1: none of those concepts apply to
 * the authoritative mode itself). */
export type DerivedCaptionOutputMode = Exclude<CaptionOutputMode, "original">;

/**
 * Fills in `hinglishText` (per word, and the whole-caption text) for one subtitle —
 * the ONE place Hinglish generation happens. Called once, lazily, the first time a
 * project's caption output mode is switched to "hinglish" (see
 * store/editor-store.ts's setCaptionOutputMode); never re-run automatically after
 * that, so a user's own edits to the generated Hinglish text stick instead of being
 * silently overwritten on every render.
 *
 * Only touches words that don't already have a `hinglishText` (or, for a caption
 * being regenerated fresh, all of them) — the original `text`/`words[].text` are
 * never read as anything but a source to transliterate FROM, and are never written.
 */
export function generateHinglishForSubtitle(sub: Subtitle): Subtitle {
  const words: Word[] = sub.words.map((w) => ({
    ...w,
    hinglishText: w.hinglishText ?? transliterateWord(w.text),
  }));
  // Capitalize the first (non-removed) word — matches normal caption casing
  // ("Bahut achhi hai", not "bahut achhi hai") — applied at the WORD level, not
  // just when joining the caption text, so per-word rendering (live preview,
  // karaoke highlighting, ASS export) shows the same capitalization as the
  // captions-panel textarea; joining words that are already correctly cased
  // just inherits it instead of needing a second capitalization pass.
  const firstIdx = words.findIndex((w) => !w.removed && w.hinglishText);
  if (firstIdx !== -1 && sub.words[firstIdx].hinglishText === undefined) {
    const w = words[firstIdx];
    words[firstIdx] = { ...w, hinglishText: capitalizeFirstLetter(w.hinglishText!) };
  }
  const nonRemoved = words.filter((w) => !w.removed);
  const rendered = nonRemoved.map((w) => w.hinglishText ?? w.text);
  const hinglishText = sub.hinglishText ?? joinWithOriginalLineBreaks(sub.text, rendered, nonRemoved.map((w) => w.text));
  return { ...sub, words, hinglishText };
}

function capitalizeFirstLetter(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** True if any caption in the project actually contains Devanagari text — used to decide
 * whether the Hinglish toggle is even worth showing in the UI (see
 * components/editor/left-panel.tsx / language-switcher.tsx). */
export function projectHasDevanagari(subtitles: Pick<Subtitle, "text">[]): boolean {
  return subtitles.some((s) => containsDevanagari(s.text));
}

/**
 * Fills in `gujaratiScriptText` (per word, and the whole-caption text) for one
 * subtitle — the Gujarati-script analogue of generateHinglishForSubtitle. Only
 * touches words that don't already have a `gujaratiScriptText`, so a user's own
 * edits to the generated text stick instead of being silently overwritten.
 * Unlike Hinglish, there's no capitalization pass here — Gujarati script has no
 * case — and no dictionary/rule-based reinterpretation: this is a pure,
 * mechanical Devanagari -> Gujarati-block Unicode remap (see
 * lib/subtitles/gujarati-script.ts), so whatever Whisper produced (mistakes
 * included) is preserved verbatim in the new script.
 */
export function generateGujaratiScriptForSubtitle(sub: Subtitle): Subtitle {
  const words: Word[] = sub.words.map((w) => ({
    ...w,
    gujaratiScriptText: w.gujaratiScriptText ?? devanagariToGujaratiScript(w.text),
  }));
  const nonRemoved = words.filter((w) => !w.removed);
  const rendered = nonRemoved.map((w) => w.gujaratiScriptText ?? w.text);
  const gujaratiScriptText = sub.gujaratiScriptText ?? joinWithOriginalLineBreaks(sub.text, rendered, nonRemoved.map((w) => w.text));
  return { ...sub, words, gujaratiScriptText };
}

/** Gujarati Script mode is only meaningful for a Gujarati-language project — see
 * types/subtitle.ts CaptionOutputMode. Used to gate the mode's UI/availability instead
 * of a content-based check (unlike Hinglish, which can apply to any Devanagari-scripted
 * language), since Devanagari->Gujarati-script conversion is specific to this one
 * language pair.
 *
 * Gujarati transcription itself is DEFERRED in the V1 language policy (see
 * lib/language-policy.ts) — the transcription-settings picker and backend validation
 * (api/projects/route.ts, api/projects/[id]/route.ts) both restrict Project.language to
 * "auto" or an officially-supported code, so no NEW project can ever reach language "gu"
 * going forward. This function's check is therefore only ever true for a project that
 * already had "gu" set before that restriction existed — its data and this rendering
 * feature are intentionally preserved (not deleted), exactly as instructed; the gating
 * that matters happens upstream, at the points where language gets SET, not here. */
export function projectSupportsGujaratiScript(project: Pick<ProjectData, "language">): boolean {
  return project.language === "gu";
}

/**
 * Returns a VIEW of `subtitles` with the requested output mode applied — for
 * "hinglish", each subtitle/word's displayed `text` is swapped for its
 * `hinglishText`; for "gujarati-script", for its `gujaratiScriptText` (both fall
 * back to the original when a word has none, e.g. an English word in an
 * otherwise-Hindi/Gujarati caption, or a caption that hasn't been lazily
 * generated yet). Returns NEW objects; never mutates `subtitles` or loses the
 * original `text`/derived-text fields — this is purely a read-time projection,
 * used identically by the live preview, ASS export, and SRT/VTT/TXT export so
 * all three always agree on what's actually displayed.
 *
 * The whole-caption text is rebuilt from the per-word data on every call rather
 * than trusting the cached `s.hinglishText`/`s.gujaratiScriptText` directly —
 * per-word timestamps (and their derived text) survive trim/cut remapping
 * (lib/timeline/edit-model.ts's remapWordsToEdited spreads `{...w, start, end}`,
 * keeping every other field), but the export pipeline rebuilds `s.text` fresh
 * from the post-cut word set while the cached whole-caption field is just
 * carried over unchanged — so trusting it directly would silently show pre-cut
 * derived text against a post-cut caption. Rebuilding from words every time
 * means cuts/trim can never desync the two representations.
 */
export function applyOutputMode<T extends Pick<Subtitle, "text" | "words" | "hinglishText" | "gujaratiScriptText">>(
  subtitles: T[],
  mode: CaptionOutputMode,
): T[] {
  if (mode === "original") return subtitles;
  return subtitles.map((s) => {
    const words = applyOutputModeToWords(s.words, mode);
    const nonRemoved = words.filter((w) => !w.removed);
    const rendered = nonRemoved.map((w) => w.text);
    // sourceTexts must reflect s.text's OWN (pre-mode-projection) line/token structure — the
    // ORIGINAL words' own .text, not the mode-projected `w.text` used for `rendered` above (which,
    // post-applyOutputModeToWords, may already be the derived Hinglish/Gujarati text).
    const sourceTexts = s.words.filter((w) => !w.removed).map((w) => w.text);
    return { ...s, text: joinWithOriginalLineBreaks(s.text, rendered, sourceTexts), words };
  });
}

/**
 * The per-word half of `applyOutputMode`, extracted (Task 105631, P17) so a caller that only
 * needs the WORD list for one already-selected caption — captions-panel.tsx's word chips, in
 * particular — doesn't have to rebuild that caption's own whole-caption `.text` too (which
 * `applyOutputMode` deliberately does from `words`, not from the cached `s.hinglishText`/
 * `s.gujaratiScriptText` field — see this file's own `applyOutputMode` doc comment for why; that
 * rebuild is the RIGHT behavior for export/preview/timeline-label rendering, but would be the
 * WRONG source for a caption's own textarea, which must keep showing exactly what the user last
 * typed there, verbatim, even if per-word derived text hasn't caught up yet — see
 * editor-store.ts's own `remapHinglishWordsToText`/`remapGujaratiScriptWordsToText`).
 * `applyOutputMode` itself now calls this — pure extraction, no behavior change (covered by this
 * file's own existing tests, which still pass unmodified).
 */
export function applyOutputModeToWords(words: Word[], mode: CaptionOutputMode): Word[] {
  if (mode === "original") return words;
  const field = mode === "hinglish" ? "hinglishText" : "gujaratiScriptText";
  return words.map((w) => ({ ...w, text: w[field] ?? w.text }));
}

function derivedField(mode: DerivedCaptionOutputMode): "hinglishText" | "gujaratiScriptText" {
  return mode === "hinglish" ? "hinglishText" : "gujaratiScriptText";
}

/**
 * Task 106284 (P17.1) — whether a caption's PER-WORD derived text (`words[].hinglishText`/
 * `.gujaratiScriptText`) can still faithfully reconstruct its own CAPTION-LEVEL derived text
 * (`sub.hinglishText`/`.gujaratiScriptText`) for `mode`. Distinct from `isWordTimingStale`
 * (word-timing.ts), which compares `words[].text` against the AUTHORITATIVE `sub.text` — this
 * compares `words[].{derived field}` against the caption's own CACHED derived text instead; the
 * two can genuinely disagree independently of each other (e.g. word timing can be perfectly fresh
 * while the Hinglish breakdown is stale, or vice versa), so they are deliberately never combined
 * into one flag.
 *
 * Three possible outcomes:
 *   - `"synchronized"` — every real word's own derived text, joined, has the same TOKEN COUNT as
 *     the caption's own cached derived text. (Not necessarily character-identical — a caption-level
 *     edit that only reworded existing tokens without changing the count is still "synchronized"
 *     by this definition, matching `isWordTimingStale`'s own identical token-count-only philosophy
 *     for the analogous original-text case.)
 *   - `"pending-generation"` — the caption's own cached derived text for `mode` doesn't exist yet
 *     at all (`undefined`). NOT an error: `ensureHinglishCoverage`/`ensureGujaratiScriptCoverage`
 *     (editor-store.ts) already resolve this automatically, synchronously, the moment the project
 *     switches into `mode` — by the time a caption is actually ON SCREEN in that mode, this state
 *     should never be visible to a user. Exposed anyway, purely for correctness (a caller reading
 *     store state directly, outside the normal switch-mode-first flow, can still tell the two
 *     "not synchronized" cases apart).
 *   - `"word-count-mismatch"` — the caption HAS a cached derived text for `mode`, but the per-word
 *     breakdown's own token count doesn't match it. The one case that actually needs a user-visible
 *     "stale" signal and a `regenerateHinglishForSubtitle`/`regenerateGujaratiScriptForSubtitle`
 *     affordance: the direct residue of the P17 fix to `remapHinglishWordsToText`/
 *     `remapGujaratiScriptWordsToText` (editor-store.ts) — a word-count-changing edit to the
 *     caption's own derived textarea deliberately leaves `words` completely untouched (to never
 *     fabricate `Word.text`), which is exactly what leaves the per-word breakdown behind.
 */
export type DerivedWordTextSyncStatus = "synchronized" | "pending-generation" | "word-count-mismatch";

export function getDerivedWordTextSyncStatus(
  sub: Pick<Subtitle, "words" | "hinglishText" | "gujaratiScriptText">,
  mode: DerivedCaptionOutputMode,
): DerivedWordTextSyncStatus {
  const field = derivedField(mode);
  const captionLevel = sub[field];
  if (captionLevel === undefined) return "pending-generation";
  // Task 106731 (P17.2) fix, now sharing its counting convention with `isWordTimingStale`
  // (word-timing.ts) via `sumWordTokens` (Task 107284, P17.3) — EXCLUDES removed (soft-deleted)
  // words from the per-word sum, matching how the caption-level cached text was actually built.
  // `generateHinglishForSubtitle`/`regenerateHinglishForSubtitle` (and their Gujarati-script
  // siblings) both filter `!w.removed` when joining the whole-caption derived text (removed words
  // are kept for history but never rendered) — summing ALL words here, including removed ones,
  // produced a false `"word-count-mismatch"` for any caption with a removed word, even immediately
  // after a correct `regenerateHinglishForSubtitle` call.
  const wordTokenCount = sumWordTokens(sub.words, field);
  const captionTokenCount = tokenizeCaptionText(captionLevel).length;
  return wordTokenCount === captionTokenCount ? "synchronized" : "word-count-mismatch";
}

/** True only for the one status that actually needs surfacing to a user (see
 * `getDerivedWordTextSyncStatus`'s own doc comment for why `"pending-generation"` does not count —
 * it resolves itself automatically). Named to match this task's own suggested shape
 * (`isDerivedWordTextStale`) for a simple boolean gate; call `getDerivedWordTextSyncStatus`
 * directly wherever the finer distinction matters. */
export function isDerivedWordTextStale(
  sub: Pick<Subtitle, "words" | "hinglishText" | "gujaratiScriptText">,
  mode: DerivedCaptionOutputMode,
): boolean {
  return getDerivedWordTextSyncStatus(sub, mode) === "word-count-mismatch";
}

/**
 * Task 106284 (P17.1) — the one safe way to resolve a `"word-count-mismatch"`: recomputes BOTH the
 * per-word AND the whole-caption `hinglishText` from scratch, reading ONLY the authoritative
 * `words[].text` (never the stale/mismatched derived text itself, never the caption's own current
 * `hinglishText`) — the same transliteration `generateHinglishForSubtitle` uses, just forced to
 * OVERWRITE every word instead of only filling gaps left `undefined`. `text`/`start`/`end`/
 * `confidence`/`style`/`removed` are completely untouched on every word; only `hinglishText`
 * changes, on every word and at the caption level. Deterministic: the same input always produces
 * the same output (transliterateWord itself is pure). Safe to call even when NOT actually stale
 * (e.g. a caption with zero words) — it is simply a no-op-equivalent full regeneration in that
 * case, never a rejection; editor-store.ts's own store action is the one that decides whether it's
 * worth offering to the user at all (only when `isDerivedWordTextStale` is true).
 */
export function regenerateHinglishForSubtitle(sub: Subtitle): Subtitle {
  const words: Word[] = sub.words.map((w) => ({ ...w, hinglishText: transliterateWord(w.text) }));
  const firstIdx = words.findIndex((w) => !w.removed);
  if (firstIdx !== -1) {
    const w = words[firstIdx];
    words[firstIdx] = { ...w, hinglishText: capitalizeFirstLetter(w.hinglishText!) };
  }
  const nonRemoved = words.filter((w) => !w.removed);
  const rendered = nonRemoved.map((w) => w.hinglishText!);
  const hinglishText = joinWithOriginalLineBreaks(sub.text, rendered, nonRemoved.map((w) => w.text));
  return { ...sub, words, hinglishText };
}

/** Gujarati-script analogue of `regenerateHinglishForSubtitle` — same Task 106284 (P17.1) fix,
 * same "read ONLY the authoritative `words[].text`, overwrite every word's own `gujaratiScriptText`
 * from scratch" behavior. No capitalization pass, for the same reason `generateGujaratiScriptForSubtitle`
 * has none — Gujarati script has no case. */
export function regenerateGujaratiScriptForSubtitle(sub: Subtitle): Subtitle {
  const words: Word[] = sub.words.map((w) => ({ ...w, gujaratiScriptText: devanagariToGujaratiScript(w.text) }));
  const nonRemoved = words.filter((w) => !w.removed);
  const rendered = nonRemoved.map((w) => w.gujaratiScriptText!);
  const gujaratiScriptText = joinWithOriginalLineBreaks(sub.text, rendered, nonRemoved.map((w) => w.text));
  return { ...sub, words, gujaratiScriptText };
}
