/**
 * Store-level tests for caption display modes (Task 105631/106284, P17/P17.1) — exercises the REAL
 * editor store. Covers:
 *   - the Task 105631 fix to remapHinglishWordsToText/remapGujaratiScriptWordsToText (a
 *     word-count-changing derived-text edit must never fabricate `Word.text`)
 *   - that word-level operations (timing/split/merge/delete/insert) remain fully functional at the
 *     STORE layer regardless of `captionOutputMode` — the P17/P17.1 safety gating lives in the UI
 *     (word-timing-popover.tsx), not in these store actions themselves, so a caller (or a future
 *     UI) is never blocked by data-layer restrictions that don't actually exist
 *   - lazy hinglishText/gujaratiScriptText regeneration (ensureHinglishCoverage/
 *     ensureGujaratiScriptCoverage) after mode switches and word-count-changing edits
 *   - one-commit-per-operation, undo/redo, quality-report staleness — the same invariants every
 *     other mutation in this file already proves
 *   - Task 106284 (P17.1): mergeWordWithNext now preserves derived fields when both source words
 *     have them (lib/subtitles/word-edit.ts mergeWords), and the new regenerateDerivedWordText
 *     store action (feasibility, one commit, undo/redo, reading only the authoritative Original
 *     words)
 *   - Task 106731 (P17.2): a hardening/verification pass over the SAME mechanisms above, none of
 *     which needed to change — `isQualityReportStale` (quality-analyzer.ts) is a pure reference
 *     check between `project.subtitles` and whatever array `qualityReport` was analyzed from;
 *     since `commit()` (and therefore mergeWordWithNext/deleteWord/regenerateDerivedWordText) and
 *     undo/redo ALWAYS install a different `subtitles` array reference, staleness detection for
 *     every P17.1 mutation already worked correctly with zero new code — this file's own new
 *     tests below PROVE that (Phase 1 of Task 106731), rather than assume it, and add the
 *     six-mutation undo/redo matrix and the full mode-switch-integrity sequence Task 106731 asks
 *     for. No production code changed for P17.2 — see research/p17_2_derived_mode_review_
 *     persistence_report.md.
 *
 * Run with: node --test src/store/__tests__/editor-store-output-mode.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION, DEFAULT_COMPOSITION, DEFAULT_TIMING_RULES } from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { isWordTimingStale } from "../../lib/subtitles/word-timing.ts";
import { applyOutputModeToWords, isDerivedWordTextStale, getDerivedWordTextSyncStatus } from "../../lib/subtitles/output-mode.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 2,
      text: "नमस्ते दुनिया",
      words: [
        { text: "नमस्ते", start: 0, end: 1, confidence: 0.95 },
        { text: "दुनिया", start: 1, end: 2, confidence: 0.9 },
      ],
    },
    {
      id: "b",
      index: 1,
      start: 2,
      end: 3,
      text: "hello world",
      words: [
        { text: "hello", start: 2, end: 2.5 },
        { text: "world", start: 2.5, end: 3 },
      ],
    },
  ];
  return {
    id: "p1",
    name: "Fixture project",
    status: "READY",
    language: "hi",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles,
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    animation: DEFAULT_ANIMATION,
    timingRules: DEFAULT_TIMING_RULES,
    composition: DEFAULT_COMPOSITION,
    updatedAt: new Date().toISOString(),
    trimStart: 0,
    trimEnd: null,
    cutRanges: [],
    ...overrides,
  };
}

test.beforeEach(() => {
  useEditorStore.getState().load(fixtureProject());
});

// ============================== updateSubtitleHinglishText — same word count ==============================

test("updateSubtitleHinglishText: same word count updates each word's own hinglishText, never touching .text/timestamps", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words.map((w) => ({ ...w }));
  store.updateSubtitleHinglishText("a", "namaste duniya");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.hinglishText, "namaste duniya");
  assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "दुनिया"], ".text must stay the real original transcript");
  assert.deepEqual(a.words.map((w) => [w.start, w.end, w.confidence]), originalWords.map((w) => [w.start, w.end, w.confidence]));
  assert.deepEqual(a.words.map((w) => w.hinglishText), ["namaste", "duniya"]);
});

test("updateSubtitleGujaratiScriptText: same word count updates each word's own gujaratiScriptText, never touching .text/timestamps", () => {
  const store = useEditorStore.getState();
  store.updateSubtitleGujaratiScriptText("a", "નમસ્તે દુનિયા");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.gujaratiScriptText, "નમસ્તે દુનિયા");
  assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "दुनिया"]);
  assert.deepEqual(a.words.map((w) => w.gujaratiScriptText), ["નમસ્તે", "દુનિયા"]);
});

// ============================== Task 105631 fix: word-count-changing derived edit ==============================

test("updateSubtitleHinglishText: a WORD-COUNT-CHANGING edit never fabricates Word.text — words array is left completely untouched", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  // 2 words -> 3 words (user added "bilkul" while editing the Hinglish text).
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.hinglishText, "namaste bilkul duniya", "the whole-caption field reflects exactly what the user typed");
  assert.deepEqual(a.words, originalWords, "the words array itself must be byte-for-byte unchanged — no fabricated word");
  for (const w of a.words) {
    assert.doesNotMatch(w.text, /^[a-z ]+$/i, "no ORIGINAL word.text may have been replaced with Latin/Hinglish-looking content");
  }
});

test("updateSubtitleGujaratiScriptText: a WORD-COUNT-CHANGING edit never fabricates Word.text either", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  store.updateSubtitleGujaratiScriptText("a", "નમસ્તે બિલકુલ દુનિયા");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.gujaratiScriptText, "નમસ્તે બિલકુલ દુનિયા");
  assert.deepEqual(a.words, originalWords, "the words array itself must be byte-for-byte unchanged");
  assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "दुनिया"], "still real Devanagari, never Gujarati-script content");
});

test("updateSubtitleHinglishText: a word-count-DECREASING edit also leaves words untouched (not just increasing)", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  store.updateSubtitleHinglishText("a", "namaste"); // 2 words -> 1
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.hinglishText, "namaste");
  assert.deepEqual(a.words, originalWords);
});

test("updateSubtitleHinglishText/updateSubtitleGujaratiScriptText: each is still exactly one commit (one undo step), even on the word-count-changing path", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya");
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
});

test("updateSubtitleHinglishText: undo restores the exact original hinglishText/words, redo re-applies — including the word-count-changing case", () => {
  const store = useEditorStore.getState();
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya");
  useEditorStore.getState().undo();
  const afterUndo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(afterUndo.hinglishText, before.hinglishText);
  assert.deepEqual(afterUndo.words, before.words);
  useEditorStore.getState().redo();
  const afterRedo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(afterRedo.hinglishText, "namaste bilkul duniya");
});

// ============================== word-level store actions remain mode-agnostic ==============================
// The P17 safety gating (no split/merge/delete/insert in a derived mode) lives entirely in the UI
// (word-timing-popover.tsx). These store actions themselves have no notion of captionOutputMode —
// confirmed here so a future change never accidentally assumes otherwise, and so P16/P15's own
// existing behavior is proven completely unaffected by P17.

test("updateWordTiming works identically regardless of captionOutputMode", () => {
  useEditorStore.getState().load(fixtureProject({ captionOutputMode: "hinglish" }));
  const ok = useEditorStore.getState().updateWordTiming("a", 0, 0, 0.6);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].end, 0.6);
  assert.equal(ok, undefined); // void return, same as Original mode — just confirming no throw
});

test("splitWord/mergeWordWithNext/deleteWord/insertWord all still work at the store layer while captionOutputMode is 'gujarati-script' — P17 does not gate the store, only the UI", () => {
  useEditorStore.getState().load(fixtureProject({ captionOutputMode: "gujarati-script" }));
  const store = useEditorStore.getState();
  const splitOk = store.splitWord("b", 0, "hel", "lo");
  assert.equal(splitOk, true);
  let b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["hel", "lo", "world"]);

  const mergeOk = useEditorStore.getState().mergeWordWithNext("b", 0);
  assert.equal(mergeOk, true);
  b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["hel lo", "world"]);

  useEditorStore.getState().deleteWord("b", 1);
  b = useEditorStore.getState().project!.subtitles.find((s) => s.id === "b")!;
  assert.deepEqual(b.words.map((w) => w.text), ["hel lo"]);

  // Caption "a"'s two words touch edge-to-edge with no gap anywhere (0-1, 1-2, caption bounds
  // 0-2) — nudge "नमस्ते" 's own end earlier first to open a real gap, exactly like the P16
  // insertion tests do, before attempting the insert.
  useEditorStore.getState().updateWordTiming("a", 0, 0, 0.8);
  const insertOk = useEditorStore.getState().insertWord("a", 0, "after", "arre");
  assert.equal(insertOk, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "arre", "दुनिया"]);
});

// ============================== mergeWordWithNext preserves derived fields (Task 106284, P17.1) ==============================

test("mergeWordWithNext preserves hinglishText when BOTH merged words already had one — even while captionOutputMode is still 'original'", () => {
  useEditorStore.getState().load(
    fixtureProject({
      subtitles: [
        {
          id: "a",
          index: 0,
          start: 0,
          end: 2,
          text: "नमस्ते दुनिया",
          hinglishText: "Namaste duniya",
          words: [
            { text: "नमस्ते", start: 0, end: 1, hinglishText: "Namaste" },
            { text: "दुनिया", start: 1, end: 2, hinglishText: "duniya" },
          ],
        },
      ],
    }),
  );
  const ok = useEditorStore.getState().mergeWordWithNext("a", 0);
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "नमस्ते दुनिया");
  assert.equal(a.words[0].hinglishText, "Namaste duniya", "preserved by the same join rule as .text — never fabricated");
});

test("mergeWordWithNext leaves hinglishText undefined when only one (or neither) merged word had one, then the caption-level cache is regenerated correctly once the project is actually viewing Hinglish mode", () => {
  useEditorStore.getState().load(
    fixtureProject({
      captionOutputMode: "hinglish",
      subtitles: [
        {
          id: "a",
          index: 0,
          start: 0,
          end: 2,
          text: "नमस्ते दुनिया",
          hinglishText: "Namaste duniya",
          words: [
            { text: "नमस्ते", start: 0, end: 1, hinglishText: "Namaste" },
            { text: "दुनिया", start: 1, end: 2 }, // no hinglishText yet
          ],
        },
      ],
    }),
  );
  useEditorStore.getState().mergeWordWithNext("a", 0);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "नमस्ते दुनिया");
  // ensureHinglishCoverage (commit()'s own lazy-fill, mode is "hinglish") fills the gap fresh from
  // the merged word's own real .text — never fabricated from the discarded "Namaste" alone.
  assert.ok(a.words[0].hinglishText);
  assert.equal(a.hinglishText, a.words[0].hinglishText);
});

// ============================== regenerateDerivedWordText (Task 106284, P17.1) ==============================

test("regenerateDerivedWordText: rejects (no commit) when the caption is NOT actually stale for the mode", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish"); // generates a fresh, synchronized hinglishText for "a"
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().regenerateDerivedWordText("a", "hinglish");
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore, "nothing to regenerate — no pointless undo entry");
});

test("regenerateDerivedWordText: rejects (no commit) for a caption that doesn't exist", () => {
  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().regenerateDerivedWordText("does-not-exist", "hinglish");
  assert.equal(ok, false);
  assert.equal(useEditorStore.getState().past.length, pastBefore);
});

test("regenerateDerivedWordText: succeeds (one commit) when the caption IS stale, resolving it back to synchronized", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya"); // creates the word-count-mismatch
  let a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(isDerivedWordTextStale(a, "hinglish"), true);

  const pastBefore = useEditorStore.getState().past.length;
  const ok = useEditorStore.getState().regenerateDerivedWordText("a", "hinglish");
  assert.equal(ok, true);
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one commit");

  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(getDerivedWordTextSyncStatus(a, "hinglish"), "synchronized");
});

test("regenerateDerivedWordText: reads ONLY the authoritative words[].text — the stale/mismatched hinglishText itself is never consulted", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  // Deliberately corrupt the caption-level hinglishText with unrelated garbage that does NOT
  // correspond to the real words at all — regeneration must ignore it completely.
  store.updateSubtitleHinglishText("a", "completely unrelated garbage text here now");
  const ok = store.regenerateDerivedWordText("a", "hinglish");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.hinglishText, "Namaste duniya", "regenerated fresh from words[].text ('नमस्ते दुनिया'), not from the garbage caption-level value");
  assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "दुनिया"], "authoritative .text completely untouched throughout");
});

test("regenerateDerivedWordText: undo restores the exact stale state, redo re-applies the regeneration", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya");
  const staleSnapshot = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;

  store.regenerateDerivedWordText("a", "hinglish");
  useEditorStore.getState().undo();
  const afterUndo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(afterUndo, staleSnapshot);
  assert.equal(isDerivedWordTextStale(afterUndo, "hinglish"), true, "back to the exact stale state");

  useEditorStore.getState().redo();
  const afterRedo = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(getDerivedWordTextSyncStatus(afterRedo, "hinglish"), "synchronized");
});

test("regenerateDerivedWordText: works for Gujarati Script too, independently of Hinglish", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("gujarati-script");
  store.updateSubtitleGujaratiScriptText("a", "નમસ્તે બિલકુલ દુનિયા");
  const ok = store.regenerateDerivedWordText("a", "gujarati-script");
  assert.equal(ok, true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.gujaratiScriptText, "નમસ્તે દુનિયા");
  assert.equal(getDerivedWordTextSyncStatus(a, "gujarati-script"), "synchronized");
});

test("regenerateDerivedWordText: preserves authoritative timestamps/confidence exactly, only touching the requested derived field", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya");
  const before = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  store.regenerateDerivedWordText("a", "hinglish");
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.deepEqual(
    after.words.map((w) => [w.start, w.end, w.confidence]),
    before.words.map((w) => [w.start, w.end, w.confidence]),
  );
  assert.equal(after.gujaratiScriptText, before.gujaratiScriptText, "the OTHER derived mode is untouched by a Hinglish-only regeneration");
});

// ============================== lazy regeneration (ensureHinglishCoverage / ensureGujaratiScriptCoverage) ==============================

test("switching to Hinglish mode generates hinglishText for every caption that doesn't have it yet, in one go", () => {
  const store = useEditorStore.getState();
  assert.equal(store.project!.subtitles[0].hinglishText, undefined);
  store.setCaptionOutputMode("hinglish");
  const subs = useEditorStore.getState().project!.subtitles;
  assert.ok(subs[0].hinglishText);
  assert.ok(subs[1].hinglishText); // "hello world" — no Devanagari, still gets a (pass-through) hinglishText
});

test("a word-count-changing Hinglish edit, followed by a word-count-changing ORIGINAL text edit, still ends up correctly regenerated and correctly flagged — never a silent fabrication or a permanently-missing hinglishText", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya"); // word-count-changing; words untouched (per the P17 fix)
  let a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words.length, 2, "words array is untouched by the word-count-changing Hinglish edit itself");

  // A SEPARATE, word-count-changing ORIGINAL-text edit on top of that: remapWordsToText follows
  // its own pre-existing (P7.2) policy here too — word count changed, so `words` is left
  // completely untouched rather than silently redistributed (the user must explicitly call
  // rebuildWordTiming for that) — this is not a P17 change, just confirming P17 didn't disturb it.
  store.updateSubtitleText("a", "नमस्ते दुनिया आज");
  a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "नमस्ते दुनिया आज");
  assert.equal(a.words.length, 2, "words still untouched — original-text word-count changes are never auto-redistributed");
  assert.ok(a.hinglishText, "hinglishText must be regenerated from whatever real words exist, never left permanently undefined");
  // The mismatch between the (untouched, now-2-word) words array and the new 3-token original
  // text is exactly what the EXISTING isWordTimingStale mechanism is for — reused here, not a
  // new concept — confirming this caption correctly reads as needing a timing rebuild.
  assert.equal(isWordTimingStale(a), true);
});

// ============================== quality report staleness ==============================

test("updateSubtitleHinglishText marks the quality report stale via the existing derivation, no silent re-analysis", () => {
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBefore = useEditorStore.getState().qualityReport;
  store.updateSubtitleHinglishText("a", "namaste duniya");
  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore, "no silent re-analysis");
  assert.notEqual(after.project!.subtitles, after.qualityReportSubtitles);
});

// ============================== reload / persistence ==============================

test("reloading a project already in hinglish mode with pre-generated hinglishText leaves it untouched (no regeneration of already-generated text)", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  const generated = useEditorStore.getState().project!.subtitles;
  const snapshot = JSON.parse(JSON.stringify(generated));
  useEditorStore.getState().load({ ...useEditorStore.getState().project!, subtitles: generated });
  const reloaded = useEditorStore.getState().project!.subtitles;
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded)), snapshot);
});

// ============================== performance (Task 105631, P17 §8) ==============================
// setCaptionOutputMode's own ensureHinglishCoverage/ensureGujaratiScriptCoverage is the ONE place
// in this whole feature that legitimately walks every caption in the project (everything else —
// word chips, timing edits, a single caption's own text edit — is per-caption, unaffected by
// total project size) — so this is the one operation actually worth a scale test.

function buildLargeHindiProject(captionCount: number): ProjectData {
  const subtitles: Subtitle[] = [];
  for (let i = 0; i < captionCount; i++) {
    const start = i * 2;
    subtitles.push({
      id: `s${i}`,
      index: i,
      start,
      end: start + 2,
      text: "नमस्ते दुनिया आज",
      words: [
        { text: "नमस्ते", start, end: start + 0.6 },
        { text: "दुनिया", start: start + 0.6, end: start + 1.2 },
        { text: "आज", start: start + 1.2, end: start + 2 },
      ],
    });
  }
  return {
    id: "big",
    name: "Large Hindi fixture",
    status: "READY",
    language: "hi",
    aspectRatio: "9:16",
    captionOutputMode: "original",
    subtitles,
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    animation: DEFAULT_ANIMATION,
    timingRules: DEFAULT_TIMING_RULES,
    composition: DEFAULT_COMPOSITION,
    updatedAt: new Date().toISOString(),
    trimStart: 0,
    trimEnd: null,
    cutRanges: [],
  };
}

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: switching to Hinglish mode (generating hinglishText for every caption) stays fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeHindiProject(captionCount));

    const start = performance.now();
    useEditorStore.getState().setCaptionOutputMode("hinglish");
    const elapsedMs = performance.now() - start;

    const subs = useEditorStore.getState().project!.subtitles;
    assert.equal(subs.length, captionCount);
    assert.ok(subs.every((s) => s.hinglishText !== undefined), "every caption must have generated hinglishText");
    assert.ok(elapsedMs < 2000, `generating hinglishText for ${captionCount} captions took ${elapsedMs.toFixed(1)}ms — expected well under 2000ms`);
  });
}

test("performance: a single caption's word chip display transform (applyOutputModeToWords) is O(that caption's own word count), never O(project size)", () => {
  useEditorStore.getState().load(buildLargeHindiProject(5400));
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  const target = useEditorStore.getState().project!.subtitles[2700];

  const start = performance.now();
  const displayWords = applyOutputModeToWords(target.words, "hinglish");
  const elapsedMs = performance.now() - start;

  assert.equal(displayWords.length, 3);
  assert.ok(elapsedMs < 10, `applyOutputModeToWords for one caption took ${elapsedMs.toFixed(2)}ms — expected near-instant regardless of the 5400-caption project it came from`);
});

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: regenerateDerivedWordText on a single stale caption stays fast at ${captionCount} total captions (proportional to that ONE caption only, never the whole project)`, () => {
    useEditorStore.getState().load(buildLargeHindiProject(captionCount));
    useEditorStore.getState().setCaptionOutputMode("hinglish");
    const targetId = `s${Math.floor(captionCount / 2)}`;
    useEditorStore.getState().updateSubtitleHinglishText(targetId, "namaste bilkul duniya aaj"); // force a mismatch

    const start = performance.now();
    const ok = useEditorStore.getState().regenerateDerivedWordText(targetId, "hinglish");
    const elapsedMs = performance.now() - start;

    assert.equal(ok, true);
    assert.ok(elapsedMs < 150, `regenerateDerivedWordText took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions — expected well under 150ms`);
    assert.equal(useEditorStore.getState().project!.subtitles.length, captionCount, "no caption was added or removed");
  });
}

// ==============================================================================================
// Task 106731 (P17.2) — quality-report staleness after P17.1 mutations (Phase 1)
// ==============================================================================================
// isQualityReportStale (quality-analyzer.ts) is a pure `currentSubtitles !== analyzedSubtitles`
// reference check. commit() (which mergeWordWithNext/deleteWord/regenerateDerivedWordText all
// route through) and undo/redo ALWAYS install a different `subtitles` array reference — so this
// mechanism already covers every P17.1 mutation correctly with ZERO new code. These tests PROVE
// that rather than assume it, per this task's own explicit "do not assume the answers" audit
// instruction — no production code changed for any of this section.

test("A. Analyze establishes a fresh (non-stale) report", () => {
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const s = useEditorStore.getState();
  assert.ok(s.qualityReport);
  assert.equal(s.qualityReportSubtitles, s.project!.subtitles, "analyzed against the CURRENT subtitles reference");
});

test("B/C. Merge in Hinglish mode marks a fresh report stale, without auto-re-analyzing", () => {
  useEditorStore.getState().load(fixtureProject({ captionOutputMode: "hinglish" }));
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBefore = useEditorStore.getState().qualityReport;
  const ok = useEditorStore.getState().mergeWordWithNext("a", 0);
  assert.equal(ok, true);
  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore, "the SAME report object — never silently replaced");
  assert.notEqual(after.project!.subtitles, after.qualityReportSubtitles, "stale: subtitles reference changed");
});

test("D/E. Delete in Gujarati Script mode marks a fresh report stale, without auto-re-analyzing", () => {
  useEditorStore.getState().load(fixtureProject({ captionOutputMode: "gujarati-script" }));
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBefore = useEditorStore.getState().qualityReport;
  useEditorStore.getState().deleteWord("a", 0);
  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore);
  assert.notEqual(after.project!.subtitles, after.qualityReportSubtitles);
});

test("F/G. Regenerate marks a fresh report stale, without auto-re-analyzing", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  store.updateSubtitleHinglishText("a", "namaste bilkul duniya"); // creates the mismatch
  store.runQualityAnalysis(); // analyze AFTER the mismatch exists — report is fresh relative to it
  const reportBefore = useEditorStore.getState().qualityReport;
  const ok = useEditorStore.getState().regenerateDerivedWordText("a", "hinglish");
  assert.equal(ok, true);
  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore);
  assert.notEqual(after.project!.subtitles, after.qualityReportSubtitles);
});

test("H/I. Undo can un-stale a report — returning to the EXACT analyzed subtitles array makes the report fresh again, and redo correctly re-staless it", () => {
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBeforeMerge = useEditorStore.getState().qualityReport;
  const analyzedSubtitles = useEditorStore.getState().qualityReportSubtitles;
  store.mergeWordWithNext("a", 0);
  assert.notEqual(useEditorStore.getState().project!.subtitles, analyzedSubtitles, "stale immediately after the merge");

  useEditorStore.getState().undo();
  assert.equal(useEditorStore.getState().project!.subtitles, analyzedSubtitles, "undo restores the EXACT same array reference that was analyzed");
  assert.equal(useEditorStore.getState().qualityReport, reportBeforeMerge, "report object itself untouched by undo — never silently replaced or cleared");

  useEditorStore.getState().redo();
  assert.notEqual(useEditorStore.getState().project!.subtitles, analyzedSubtitles, "redo brings back the merge — stale again, correctly following the ACTUAL data, not a one-way flag");
});

test("I. reviewedIssueIds is untouched by Merge/Delete/Regenerate — only load()/runQualityAnalysis() reset it (Task 99261, P12 review model preserved)", () => {
  const store = useEditorStore.getState();
  store.setCaptionOutputMode("hinglish");
  store.runQualityAnalysis();
  // Manually seed a reviewed id the same way navigateQualityIssue does, without depending on
  // there actually being an issue in this tiny fixture.
  useEditorStore.setState({ reviewedIssueIds: new Set(["fake-issue-1"]) });
  store.mergeWordWithNext("a", 0);
  store.deleteWord("b", 0);
  store.regenerateDerivedWordText("a", "hinglish"); // may be a no-op if already synchronized; either way must not touch reviewedIssueIds
  assert.deepEqual(useEditorStore.getState().reviewedIssueIds, new Set(["fake-issue-1"]), "not cleared by ordinary mutations");
  store.runQualityAnalysis();
  assert.deepEqual(useEditorStore.getState().reviewedIssueIds, new Set(), "cleared only by a fresh analysis, exactly as documented");
});

// ==============================================================================================
// Task 106731 (P17.2) — undo/redo matrix: 6 mutation types × derived mode (Phase 3)
// ==============================================================================================
// For each: one commit, undo restores the exact previous state, redo restores the exact mutated
// state, and confidence/style/removed/timestamps/derived-field policy all follow the P17.1 rules
// established in word-edit.ts/output-mode.ts — none of that changed here, this only proves it
// survives undo/redo intact.

function loadDerivedFixture(mode: "hinglish" | "gujarati-script") {
  const field = mode === "hinglish" ? "hinglishText" : "gujaratiScriptText";
  useEditorStore.getState().load(
    fixtureProject({
      captionOutputMode: mode,
      subtitles: [
        {
          id: "a",
          index: 0,
          start: 0,
          end: 3,
          text: "नमस्ते दुनिया आज",
          words: [
            { text: "नमस्ते", start: 0, end: 1, confidence: 0.95, style: { color: "red" }, [field]: "A1" },
            { text: "दुनिया", start: 1, end: 2, confidence: 0.9, [field]: "A2" },
            { text: "आज", start: 2, end: 3, confidence: 0.8, removed: true, [field]: "A3" },
          ],
        },
      ],
    }),
  );
}

for (const mode of ["hinglish", "gujarati-script"] as const) {
  const field = mode === "hinglish" ? "hinglishText" : "gujaratiScriptText";

  test(`undo/redo matrix: ${mode} Merge — one commit, undo/redo exact, derived field preserved (both sides had one), confidence dropped, style/removed carried per existing policy`, () => {
    loadDerivedFixture(mode);
    const before = useEditorStore.getState().project!.subtitles[0];
    const pastBefore = useEditorStore.getState().past.length;

    const ok = useEditorStore.getState().mergeWordWithNext("a", 0);
    assert.equal(ok, true);
    assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one commit");
    let a = useEditorStore.getState().project!.subtitles[0];
    assert.equal(a.words[0].text, "नमस्ते दुनिया");
    assert.equal(a.words[0][field], "A1 A2", "both sides had a value — preserved by the same join rule as .text");
    assert.equal(a.words[0].confidence, undefined, "confidence policy unchanged — never fabricated");
    assert.deepEqual(a.words[0].style, { color: "red" }, "style: first word's override wins — unchanged policy");
    assert.equal(a.words[0].start, 0);
    assert.equal(a.words[0].end, 2);

    useEditorStore.getState().undo();
    assert.deepEqual(useEditorStore.getState().project!.subtitles[0], before, "undo restores the EXACT previous state");

    useEditorStore.getState().redo();
    a = useEditorStore.getState().project!.subtitles[0];
    assert.equal(a.words[0].text, "नमस्ते दुनिया");
    assert.equal(a.words[0][field], "A1 A2", "redo restores the exact mutated state, including the preserved derived field");
  });

  test(`undo/redo matrix: ${mode} Delete — one commit, undo/redo exact, neighbor absorbs timing, confidence/style/removed of the SURVIVING word untouched`, () => {
    loadDerivedFixture(mode);
    const before = useEditorStore.getState().project!.subtitles[0];
    const pastBefore = useEditorStore.getState().past.length;

    useEditorStore.getState().deleteWord("a", 1); // delete "दुनिया" (middle word)
    assert.equal(useEditorStore.getState().past.length, pastBefore + 1);
    let a = useEditorStore.getState().project!.subtitles[0];
    assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "आज"]);
    assert.equal(a.words[0].end, 2, "previous word absorbs the deleted word's own end");
    assert.equal(a.words[0].confidence, 0.95, "surviving word's own confidence untouched by the deletion of its neighbor");
    assert.deepEqual(a.words[0].style, { color: "red" });
    assert.equal(a.words[1].removed, true, "the OTHER surviving word's own removed flag untouched");

    useEditorStore.getState().undo();
    assert.deepEqual(useEditorStore.getState().project!.subtitles[0], before);

    useEditorStore.getState().redo();
    a = useEditorStore.getState().project!.subtitles[0];
    assert.deepEqual(a.words.map((w) => w.text), ["नमस्ते", "आज"]);
  });

  test(`undo/redo matrix: ${mode} Regenerate — one commit, undo/redo exact, reads ONLY the authoritative words[].text, preserves confidence/style/removed/timestamps`, () => {
    loadDerivedFixture(mode);
    const store = useEditorStore.getState();
    // Force a mismatch first (word-count-changing derived edit), matching how this state
    // actually arises in real usage.
    if (mode === "hinglish") store.updateSubtitleHinglishText("a", "totally different garbage now");
    else store.updateSubtitleGujaratiScriptText("a", "totally different garbage now");
    const stale = useEditorStore.getState().project!.subtitles[0];
    assert.equal(isDerivedWordTextStale(stale, mode), true);

    const pastBefore = useEditorStore.getState().past.length;
    const ok = useEditorStore.getState().regenerateDerivedWordText("a", mode);
    assert.equal(ok, true);
    assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "exactly one commit");

    const a = useEditorStore.getState().project!.subtitles[0];
    assert.equal(getDerivedWordTextSyncStatus(a, mode), "synchronized");
    assert.deepEqual(
      a.words.map((w) => [w.text, w.start, w.end, w.confidence, w.style, w.removed]),
      stale.words.map((w) => [w.text, w.start, w.end, w.confidence, w.style, w.removed]),
      "every authoritative/metadata field completely untouched by regeneration",
    );

    useEditorStore.getState().undo();
    assert.deepEqual(useEditorStore.getState().project!.subtitles[0], stale, "undo restores the exact stale state");

    useEditorStore.getState().redo();
    assert.equal(getDerivedWordTextSyncStatus(useEditorStore.getState().project!.subtitles[0], mode), "synchronized", "redo restores the regeneration");
  });
}

// ==============================================================================================
// Task 106731 (P17.2) — mode-switch integrity: full sequence (Phase 4)
// ==============================================================================================
// Original -> Hinglish -> Gujarati Script -> Original -> Hinglish -> Original. At every stage,
// the authoritative Word.text/count/timestamps/confidence/style/removed must be byte-identical to
// the very first Original snapshot — mode switching is a pure, reference-preserving READ
// projection (ensureHinglishCoverage/ensureGujaratiScriptCoverage only ever ADD hinglishText/
// gujaratiScriptText fields, never touch anything else) — no cross-mode contamination.

test("mode-switch integrity: Original -> Hinglish -> Gujarati Script -> Original -> Hinglish -> Original never mutates authoritative data", () => {
  useEditorStore.getState().load(fixtureProject());
  const originalWords = useEditorStore.getState().project!.subtitles[0].words.map((w) => ({ ...w }));
  const originalText = useEditorStore.getState().project!.subtitles[0].text;

  function assertAuthoritativeUnchanged(label: string) {
    const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
    assert.equal(a.text, originalText, `${label}: authoritative .text unchanged`);
    assert.equal(a.words.length, originalWords.length, `${label}: word count unchanged`);
    for (let i = 0; i < originalWords.length; i++) {
      assert.equal(a.words[i].text, originalWords[i].text, `${label}: word ${i} .text unchanged`);
      assert.equal(a.words[i].start, originalWords[i].start, `${label}: word ${i} .start unchanged`);
      assert.equal(a.words[i].end, originalWords[i].end, `${label}: word ${i} .end unchanged`);
      assert.equal(a.words[i].confidence, originalWords[i].confidence, `${label}: word ${i} .confidence unchanged`);
      assert.equal(a.words[i].style, originalWords[i].style, `${label}: word ${i} .style unchanged`);
      assert.equal(a.words[i].removed, originalWords[i].removed, `${label}: word ${i} .removed unchanged`);
    }
  }

  assertAuthoritativeUnchanged("Original (initial)");
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  assertAuthoritativeUnchanged("after -> Hinglish");
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  assertAuthoritativeUnchanged("after -> Gujarati Script");
  useEditorStore.getState().setCaptionOutputMode("original");
  assertAuthoritativeUnchanged("after -> Original");
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  assertAuthoritativeUnchanged("after -> Hinglish (again)");
  useEditorStore.getState().setCaptionOutputMode("original");
  assertAuthoritativeUnchanged("after -> Original (final)");

  // And the derived fields themselves are present, not lost, at the end of the whole sequence.
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.ok(a.hinglishText, "hinglishText generated somewhere along the sequence and never cleared by a later mode switch");
  assert.ok(a.gujaratiScriptText, "gujaratiScriptText generated somewhere along the sequence and never cleared by a later mode switch");
});

test("mode-switch integrity: switching modes never creates an undo entry (view-only, not a data mutation)", () => {
  useEditorStore.getState().load(fixtureProject());
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  useEditorStore.getState().setCaptionOutputMode("original");
  assert.equal(useEditorStore.getState().past.length, pastBefore, "mode switches are never undo steps");
});

// ==============================================================================================
// Task 106731 (P17.2) — performance: derived-mode Merge/Delete + quality-stale derivation (Phase 6)
// ==============================================================================================

function buildLargeHindiProjectWithConfidence(captionCount: number): ProjectData {
  const project = buildLargeHindiProject(captionCount);
  return { ...project, captionOutputMode: "hinglish" };
}

for (const captionCount of [30, 300, 1800, 3600, 5400]) {
  test(`performance: mergeWordWithNext in Hinglish mode stays fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeHindiProjectWithConfidence(captionCount));
    useEditorStore.getState().setCaptionOutputMode("hinglish");
    const targetId = `s${Math.floor(captionCount / 2)}`;

    const start = performance.now();
    const ok = useEditorStore.getState().mergeWordWithNext(targetId, 0);
    const elapsedMs = performance.now() - start;

    assert.equal(ok, true);
    assert.ok(elapsedMs < 150, `mergeWordWithNext took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions`);
  });

  test(`performance: deleteWord in Gujarati Script mode stays fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeHindiProjectWithConfidence(captionCount));
    useEditorStore.getState().setCaptionOutputMode("gujarati-script");
    const targetId = `s${Math.floor(captionCount / 2)}`;

    const start = performance.now();
    useEditorStore.getState().deleteWord(targetId, 0);
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 150, `deleteWord took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions`);
  });

  test(`performance: undo/redo after a derived-mode merge stay fast at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeHindiProjectWithConfidence(captionCount));
    useEditorStore.getState().setCaptionOutputMode("hinglish");
    const targetId = `s${Math.floor(captionCount / 2)}`;
    useEditorStore.getState().mergeWordWithNext(targetId, 0);

    const start = performance.now();
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 150, `undo+redo took ${elapsedMs.toFixed(1)}ms at ${captionCount} captions`);
  });

  test(`performance: quality-report stale derivation (isQualityReportStale) stays O(1) at ${captionCount} total captions`, () => {
    useEditorStore.getState().load(buildLargeHindiProjectWithConfidence(captionCount));
    useEditorStore.getState().runQualityAnalysis();
    useEditorStore.getState().mergeWordWithNext(`s${Math.floor(captionCount / 2)}`, 0);

    const start = performance.now();
    const stale = useEditorStore.getState().project!.subtitles !== useEditorStore.getState().qualityReportSubtitles;
    const elapsedMs = performance.now() - start;

    assert.equal(stale, true);
    assert.ok(elapsedMs < 5, `staleness check took ${elapsedMs.toFixed(2)}ms at ${captionCount} captions — expected a trivial O(1) reference comparison`);
  });
}

// ============================== Task 107284 (P17.3) — store-level regression: removed-word timing
// safety in derived modes ==============================
//
// The `text` field below deliberately mirrors the REAL pipeline (lib/subtitles/segment.ts's
// segmentWords, used at transcription time and after filler-word removal), which excludes removed
// words when joining — NOT what P17.1/P17.2's own `loadDerivedFixture` above used (its `text`
// happened to include the removed word's own text too, which sidestepped the exact bug this task
// fixes). `language: "gu"` so all three display modes (Original/Hinglish/Gujarati Script) are
// available on the same fixture (see projectSupportsGujaratiScript).
function loadRemovedWordFixture() {
  useEditorStore.getState().load(
    fixtureProject({
      language: "gu",
      captionOutputMode: "original",
      subtitles: [
        {
          id: "a",
          index: 0,
          start: 0,
          end: 3,
          text: "नमस्ते आज", // excludes "दुनिया" (removed) — matches segmentWords' own convention
          words: [
            { text: "नमस्ते", start: 0, end: 1, confidence: 0.95, style: { color: "red" } },
            { text: "दुनिया", start: 1, end: 2, confidence: 0.9, removed: true },
            { text: "आज", start: 2, end: 3, confidence: 0.8 },
          ],
        },
      ],
    }),
  );
}

test("P17.3: 1. removed-word fixture loads", () => {
  loadRemovedWordFixture();
  const sub = useEditorStore.getState().project!.subtitles[0];
  assert.equal(sub.words.length, 3);
  assert.equal(sub.words[1].removed, true);
});

test("P17.3: 2. Original mode — word chips remain available (isWordTimingStale is false, matching captions-panel.tsx's own computation)", () => {
  loadRemovedWordFixture();
  const sub = useEditorStore.getState().project!.subtitles[0];
  assert.equal(isWordTimingStale({ text: sub.text, words: sub.words }), false);
});

test("P17.3: 3. Hinglish mode — word chips remain available after switching (lazy generation + isWordTimingStale false)", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  const sub = useEditorStore.getState().project!.subtitles[0];
  assert.ok(sub.hinglishText, "hinglishText must have been lazily generated by the mode switch");
  const displayWords = applyOutputModeToWords(sub.words, "hinglish");
  assert.equal(isWordTimingStale({ text: sub.hinglishText!, words: displayWords }), false);
});

test("P17.3: 4. Gujarati Script mode — word chips remain available after switching", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  const sub = useEditorStore.getState().project!.subtitles[0];
  assert.ok(sub.gujaratiScriptText, "gujaratiScriptText must have been lazily generated by the mode switch");
  const displayWords = applyOutputModeToWords(sub.words, "gujarati-script");
  assert.equal(isWordTimingStale({ text: sub.gujaratiScriptText!, words: displayWords }), false);
});

test("P17.3: 5. Merge is available on the removed-word fixture (Hinglish mode)", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  const ok = useEditorStore.getState().mergeWordWithNext("a", 0);
  assert.equal(ok, true);
  assert.equal(useEditorStore.getState().project!.subtitles[0].words[0].text, "नमस्ते दुनिया");
});

test("P17.3: 6. Delete is available on the removed-word fixture (Gujarati Script mode)", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  const pastBefore = useEditorStore.getState().past.length;
  useEditorStore.getState().deleteWord("a", 2); // delete the non-removed last word ("आज")
  assert.equal(useEditorStore.getState().past.length, pastBefore + 1, "delete committed");
  assert.equal(useEditorStore.getState().project!.subtitles[0].words.length, 2);
});

test("P17.3: 7. Word timing controls are available (updateWordTiming applies on the removed-word fixture)", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().updateWordTiming("a", 0, 0.1, 0.8);
  const w = useEditorStore.getState().project!.subtitles[0].words[0];
  assert.equal(w.start, 0.1);
  assert.equal(w.end, 0.8);
});

test("P17.3: 8. Existing timing edits still clamp correctly (a removed word still participates in neighbor-clamping, since it retains a real timestamp)", () => {
  loadRemovedWordFixture();
  // Try to push word 0 ("नमस्ते") past word 1's ("दुनिया", removed but still timed 1-2) start.
  useEditorStore.getState().updateWordTiming("a", 0, 0.1, 1.5);
  const w = useEditorStore.getState().project!.subtitles[0].words[0];
  assert.equal(w.end, 1, "must still clamp against the REMOVED word's own end — removed words keep real timestamps and still participate in clamping");
});

test("P17.3: 9. Undo/redo still work on the removed-word fixture", () => {
  loadRemovedWordFixture();
  const before = useEditorStore.getState().project!.subtitles[0];
  useEditorStore.getState().mergeWordWithNext("a", 0);
  useEditorStore.getState().undo();
  assert.deepEqual(useEditorStore.getState().project!.subtitles[0], before);
  useEditorStore.getState().redo();
  assert.equal(useEditorStore.getState().project!.subtitles[0].words[0].text, "नमस्ते दुनिया");
});

test("P17.3: 10. Derived regeneration still works on the removed-word fixture", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().updateSubtitleHinglishText("a", "totally different garbage now");
  assert.equal(useEditorStore.getState().regenerateDerivedWordText("a", "hinglish"), true);
  const sub = useEditorStore.getState().project!.subtitles[0];
  assert.equal(getDerivedWordTextSyncStatus(sub, "hinglish"), "synchronized");
});

test("P17.3: 11. Quality-report staleness remains independent of the removed-word fix (still a pure reference check)", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().runQualityAnalysis();
  const analyzed = useEditorStore.getState().qualityReportSubtitles;
  useEditorStore.getState().mergeWordWithNext("a", 0);
  assert.notEqual(useEditorStore.getState().project!.subtitles, analyzed);
});

test("P17.3: 12. reviewedIssueIds behavior is unchanged (still untouched by ordinary mutations on the removed-word fixture)", () => {
  loadRemovedWordFixture();
  useEditorStore.getState().runQualityAnalysis();
  useEditorStore.getState().reviewedIssueIds.add("fake-issue-id");
  const before = useEditorStore.getState().reviewedIssueIds;
  useEditorStore.getState().mergeWordWithNext("a", 0);
  assert.equal(useEditorStore.getState().reviewedIssueIds, before, "same Set reference, untouched by an ordinary commit");
});

// ============================== Task 108762 (P18.1) — display-mode safety for the metadata fix ==============================
// Full sequence: Original -> edit text -> Hinglish -> Gujarati Script -> Original. Confirms the
// P18.1 confidence fix composes correctly with the existing P17/P17.1/P17.2/P17.3 architecture:
// authoritative text/confidence stay authoritative, confidence is never fabricated in a derived
// mode, and regeneration/derived-word-staleness are both completely unaffected.

test("19. Original mode: a same-token-count edit clears confidence ONLY for the word whose text actually changed", () => {
  useEditorStore.getState().load(fixtureProject({ language: "gu" }));
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते आज"); // "दुनिया" (0.9) -> "आज"
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, 0.95, "'नमस्ते' unchanged -> confidence preserved");
  assert.equal(a.words[1].text, "आज");
  assert.equal(a.words[1].confidence, undefined, "'दुनिया'->'आज' is different text -> confidence cleared");
});

test("20. Hinglish mode: switching modes never fabricates or alters authoritative confidence; derived per-word text carries the SAME confidence through applyOutputModeToWords", () => {
  useEditorStore.getState().load(fixtureProject({ language: "gu" }));
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते आज");
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, 0.95, "mode switch never touches authoritative confidence");
  assert.equal(a.words[1].confidence, undefined);
  const hinglishWords = applyOutputModeToWords(a.words, "hinglish");
  assert.equal(hinglishWords[0].confidence, 0.95, "confidence is carried straight through the display-mode word transform (only .text is swapped)");
  assert.equal(hinglishWords[1].confidence, undefined);
});

test("21. Gujarati Script mode: same confidence-preservation property as Hinglish, for a legacy 'gu' project", () => {
  useEditorStore.getState().load(fixtureProject({ language: "gu" }));
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते आज");
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].confidence, 0.95);
  assert.equal(a.words[1].confidence, undefined);
  const gujaratiWords = applyOutputModeToWords(a.words, "gujarati-script");
  assert.equal(gujaratiWords[0].confidence, 0.95);
  assert.equal(gujaratiWords[1].confidence, undefined);
});

test("22. Derived-mode text editing (Hinglish textarea) never touches authoritative confidence — only hinglishText changes", () => {
  useEditorStore.getState().load(fixtureProject({ language: "gu" }));
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().updateSubtitleHinglishText("a", "Totally different hinglish text");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.words[0].text, "नमस्ते", "authoritative text is NEVER touched by a derived-mode edit");
  assert.equal(a.words[0].confidence, 0.95, "authoritative confidence is NEVER touched by a derived-mode edit either");
  assert.equal(a.words[1].confidence, 0.9);
});

test("23. Derived regeneration reads only authoritative words[].text/keeps confidence completely untouched, and derived-word staleness is resolved exactly as P17.1 already established", () => {
  useEditorStore.getState().load(fixtureProject({ language: "gu" }));
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().updateSubtitleHinglishText("a", "totally different garbage now");
  assert.equal(useEditorStore.getState().regenerateDerivedWordText("a", "hinglish"), true);
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(getDerivedWordTextSyncStatus(a, "hinglish"), "synchronized", "P17.1 regeneration behavior is completely unaffected by the P18.1 metadata fix");
  assert.equal(a.words[0].confidence, 0.95, "regeneration only ever recomputes hinglishText/gujaratiScriptText — confidence is untouched");
  assert.equal(a.words[1].confidence, 0.9);
});

test("full sequence Original -> edit -> Hinglish -> Gujarati Script -> Original: authoritative confidence survives every hop unchanged", () => {
  useEditorStore.getState().load(fixtureProject({ language: "gu" }));
  useEditorStore.getState().updateSubtitleText("a", "नमस्ते आज"); // clears word[1]'s confidence, by design
  useEditorStore.getState().setCaptionOutputMode("hinglish");
  useEditorStore.getState().setCaptionOutputMode("gujarati-script");
  useEditorStore.getState().setCaptionOutputMode("original");
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "नमस्ते आज", "authoritative text unchanged by the mode round-trip");
  assert.equal(a.words[0].confidence, 0.95, "survives the full round-trip exactly as it was after the edit");
  assert.equal(a.words[1].confidence, undefined, "still cleared from the earlier text edit — mode switching neither restores nor re-clears it");
});
