/**
 * Store-level tests for the caption-text clipboard workflow (Task 101583, P14) — exercises the
 * REAL editor store exactly the way hooks/use-keyboard-shortcuts.ts's copySelectedCaptions/
 * cutSelectedCaptions/pasteIntoSelectedCaptions actually drive it: buildCaptionClipboard/
 * resolvePasteMapping (pure, tested separately in
 * lib/subtitles/__tests__/caption-clipboard.test.ts) feeding the EXISTING applyTextMap/
 * updateSubtitleText/setCaptionClipboard store actions. Covers word-timing safety, one-commit
 * undo/redo guarantees, quality-report staleness, and the EMPTY_CAPTION cut behavior — the parts
 * of the spec that only make sense against the real store (commit/undo/redo, remapWordsToText,
 * quality-analyzer).
 *
 * Run with: node --test src/store/__tests__/editor-store-clipboard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { useEditorStore } from "../editor-store.ts";
import {
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_ANIMATION,
  DEFAULT_COMPOSITION,
  DEFAULT_TIMING_RULES,
} from "../../types/subtitle.ts";
import type { ProjectData, Subtitle } from "../../types/subtitle.ts";
import { analyzeSubtitleQuality, isQualityReportStale } from "../../lib/subtitles/quality-analyzer.ts";
import { isWordTimingStale } from "../../lib/subtitles/word-timing.ts";
import {
  buildCaptionClipboard,
  formatClipboardAsPlainText,
  mappingToTextRecord,
  resolveMismatchPasteMapping,
  resolvePasteMapping,
} from "../../lib/subtitles/caption-clipboard.ts";

function fixtureProject(overrides: Partial<ProjectData> = {}): ProjectData {
  const subtitles: Subtitle[] = [
    {
      id: "a",
      index: 0,
      start: 0,
      end: 1,
      text: "Hello world",
      words: [
        { text: "Hello", start: 0, end: 0.5, confidence: 0.9 },
        { text: "world", start: 0.5, end: 1, confidence: 0.8 },
      ],
    },
    {
      id: "b",
      index: 1,
      start: 1,
      end: 2,
      text: "This is SUBLY",
      words: [
        { text: "This", start: 1, end: 1.3 },
        { text: "is", start: 1.3, end: 1.6 },
        { text: "SUBLY", start: 1.6, end: 2 },
      ],
    },
    {
      id: "c",
      index: 2,
      start: 2,
      end: 3,
      text: "Third caption",
      words: [
        { text: "Third", start: 2, end: 2.5 },
        { text: "caption", start: 2.5, end: 3 },
      ],
    },
  ];
  return {
    id: "p1",
    name: "Fixture project",
    status: "READY",
    language: "en",
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

// ============================== copy ==============================

test("copy: setCaptionClipboard does not create a history entry", () => {
  const before = useEditorStore.getState().past.length;
  const clip = buildCaptionClipboard(useEditorStore.getState().project!.subtitles, ["a", "b"]);
  useEditorStore.getState().setCaptionClipboard(clip);
  assert.equal(useEditorStore.getState().past.length, before, "copy must never push a history entry");
  assert.equal(useEditorStore.getState().captionClipboard?.captions.length, 2);
});

test("copy: clipboard is reset to null on load() (a new project's clipboard never carries over)", () => {
  useEditorStore.getState().setCaptionClipboard(buildCaptionClipboard(useEditorStore.getState().project!.subtitles, ["a"]));
  assert.ok(useEditorStore.getState().captionClipboard);
  useEditorStore.getState().load(fixtureProject());
  assert.equal(useEditorStore.getState().captionClipboard, null);
});

// ============================== cut ==============================

test("cut: clears text but leaves the caption (and its words array) in place — one commit total", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const clip = buildCaptionClipboard(store.project!.subtitles, ["a"]);
  store.setCaptionClipboard(clip);
  store.applyTextMap(mappingToTextRecord([{ targetId: "a", text: "" }]));

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "cutting one caption must be exactly one undo step");
  const a = after.project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "", "cut must empty the text");
  assert.equal(a.words.length, 2, "cut must NOT delete the words array — words are never fabricated or discarded");
});

test("cut: cutting multiple selected captions is exactly ONE undo step for the whole batch", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const clip = buildCaptionClipboard(store.project!.subtitles, ["a", "b", "c"]);
  store.setCaptionClipboard(clip);
  store.applyTextMap(mappingToTextRecord(clip.captions.map((_, i) => ({ targetId: ["a", "b", "c"][i], text: "" }))));

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1);
  assert.ok(after.project!.subtitles.every((s) => s.text === ""));
});

test("cut: the emptied caption is flagged EMPTY_CAPTION by the existing quality analyzer, not silently deleted", () => {
  const store = useEditorStore.getState();
  store.applyTextMap(mappingToTextRecord([{ targetId: "b", text: "" }]));
  const after = useEditorStore.getState();
  assert.equal(after.project!.subtitles.length, 3, "the caption itself must still exist");
  const report = analyzeSubtitleQuality(after.project!.subtitles, after.project!.timingRules);
  const issue = report.issues.find((i) => i.captionId === "b");
  assert.ok(issue, "an emptied caption must be surfaced by the quality analyzer");
  assert.equal(issue!.type, "EMPTY_CAPTION");
});

test("cut: undo restores the exact original text and word timing", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  store.applyTextMap(mappingToTextRecord([{ targetId: "a", text: "" }]));
  useEditorStore.getState().undo();
  const restored = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(restored.text, "Hello world");
  assert.deepEqual(restored.words, originalWords);
});

test("cut: undo → redo restores the exact cut (empty) state", () => {
  useEditorStore.getState().applyTextMap(mappingToTextRecord([{ targetId: "a", text: "" }]));
  useEditorStore.getState().undo();
  useEditorStore.getState().redo();
  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "");
});

// ============================== paste: word-timing safety ==============================

test("paste: same token count preserves every word's own timestamp exactly; confidence is preserved ONLY for a word whose own text didn't change (Task 108762, P18.1)", () => {
  const store = useEditorStore.getState();
  const clip = buildCaptionClipboard(store.project!.subtitles, ["a"]); // "Hello world"
  // Simulate copying elsewhere then pasting "Hi world" (still 2 tokens) into the same caption.
  // "Hello" -> "Hi" is a genuinely different token at that position; "world" -> "world" is not.
  const pastedClip = { captions: [{ ...clip.captions[0], text: "Hi world" }] };
  const resolution = resolvePasteMapping(pastedClip, ["a"]);
  assert.equal(resolution.kind, "match");
  if (resolution.kind !== "match") return;
  store.applyTextMap(mappingToTextRecord(resolution.mapping));

  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "Hi world");
  assert.equal(a.words.length, 2);
  assert.equal(a.words[0].text, "Hi");
  assert.equal(a.words[0].start, 0, "start timestamp must be preserved exactly");
  assert.equal(a.words[0].end, 0.5, "end timestamp must be preserved exactly");
  assert.equal(a.words[1].text, "world");
  assert.equal(a.words[1].start, 0.5);
  assert.equal(a.words[1].end, 1);
  // Task 108762 (P18.1) fix: "Hello" -> "Hi" is different text at this position, so its
  // confidence — a measured probability for "Hello", never for "Hi" — must NOT be carried over
  // (previously this asserted the OLD, buggy behavior: confidence 0.9 silently attached to "Hi").
  assert.equal(a.words[0].confidence, undefined, "confidence must NOT survive onto genuinely different replacement text");
  // "world" -> "world" is the SAME token text at this position — nothing about this word actually
  // changed, so its own real confidence measurement is still valid and must be preserved.
  assert.equal(a.words[1].confidence, 0.8, "confidence must be preserved for a word whose own text is unchanged");
  assert.ok(!isWordTimingStale({ text: a.text, words: a.words }));
});

test("paste: a changed token count leaves the words array completely untouched and becomes stale", () => {
  const store = useEditorStore.getState();
  const originalWords = store.project!.subtitles[0].words;
  const clip = { captions: [{ text: "Hello beautiful world", words: [], start: 0, end: 1 }] }; // 3 tokens vs 2 original
  const resolution = resolvePasteMapping(clip, ["a"]);
  assert.equal(resolution.kind, "match");
  if (resolution.kind !== "match") return;
  store.applyTextMap(mappingToTextRecord(resolution.mapping));

  const a = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(a.text, "Hello beautiful world");
  assert.deepEqual(a.words, originalWords, "word timing must never be fabricated or redistributed on a token-count change");
  assert.ok(isWordTimingStale({ text: a.text, words: a.words }), "must be surfaced as stale via the existing derivation");
});

// ============================== paste: one commit, mapping correctness ==============================

test("paste: N copied into N selected is one commit and maps by position", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const clip = buildCaptionClipboard(store.project!.subtitles, ["a", "b"]); // ["Hello world", "This is SUBLY"]
  const resolution = resolvePasteMapping(clip, ["c", "a"]); // paste onto c and a
  assert.equal(resolution.kind, "match");
  if (resolution.kind !== "match") return;
  store.applyTextMap(mappingToTextRecord(resolution.mapping));

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1);
  assert.equal(after.project!.subtitles.find((s) => s.id === "c")!.text, "Hello world");
  assert.equal(after.project!.subtitles.find((s) => s.id === "a")!.text, "This is SUBLY");
  assert.equal(after.project!.subtitles.find((s) => s.id === "b")!.text, "This is SUBLY", "b (the copy source) must be untouched by a paste that never targeted it");
});

test("paste: destination timing (start/end) is never touched by a text paste", () => {
  const store = useEditorStore.getState();
  const before = store.project!.subtitles.find((s) => s.id === "a")!;
  const clip = buildCaptionClipboard(store.project!.subtitles, ["b"]);
  const resolution = resolvePasteMapping(clip, ["a"]);
  assert.equal(resolution.kind, "match");
  if (resolution.kind !== "match") return;
  store.applyTextMap(mappingToTextRecord(resolution.mapping));
  const after = useEditorStore.getState().project!.subtitles.find((s) => s.id === "a")!;
  assert.equal(after.start, before.start);
  assert.equal(after.end, before.end);
});

test("paste: a mismatched count (confirmed) pastes only the min(copied, selected) pairs, in one commit, never repeating", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const clip = buildCaptionClipboard(store.project!.subtitles, ["a"]); // 1 copied
  const targetIds = ["a", "b", "c"]; // 3 selected
  const resolution = resolvePasteMapping(clip, targetIds);
  assert.equal(resolution.kind, "mismatch");
  const mapping = resolveMismatchPasteMapping(clip, targetIds);
  store.applyTextMap(mappingToTextRecord(mapping));

  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1, "a confirmed mismatch paste is still one undo step");
  assert.equal(after.project!.subtitles.find((s) => s.id === "a")!.text, "Hello world");
  assert.equal(after.project!.subtitles.find((s) => s.id === "b")!.text, "This is SUBLY", "b was not one of the first pasteCount targets — must be untouched");
  assert.equal(after.project!.subtitles.find((s) => s.id === "c")!.text, "Third caption", "c was not one of the first pasteCount targets — must be untouched");
});

// ============================== quality staleness ==============================

test("quality: the report becomes stale after a cut, and running analysis again is never automatic", () => {
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const reportBefore = useEditorStore.getState().qualityReport;
  assert.ok(reportBefore);

  store.applyTextMap(mappingToTextRecord([{ targetId: "a", text: "" }]));

  const after = useEditorStore.getState();
  assert.equal(after.qualityReport, reportBefore, "cut must never silently re-run analysis — the existing (now stale) report object is left exactly as it was");
  assert.ok(isQualityReportStale(after.project!.subtitles, after.qualityReportSubtitles), "the existing staleness derivation must detect the cut");
});

test("quality: the report becomes stale after a token-count-changing paste", () => {
  const store = useEditorStore.getState();
  store.runQualityAnalysis();
  const clip = { captions: [{ text: "Hello beautiful world", words: [], start: 0, end: 1 }] };
  const resolution = resolvePasteMapping(clip, ["a"]);
  if (resolution.kind !== "match") throw new Error("expected match");
  store.applyTextMap(mappingToTextRecord(resolution.mapping));
  const after = useEditorStore.getState();
  assert.ok(isQualityReportStale(after.project!.subtitles, after.qualityReportSubtitles));
});

// ============================== plain OS-clipboard-style single-caption paste ==============================

test("paste: plain text (no internal clipboard) uses updateSubtitleText — one commit, exact text, timing untouched", () => {
  const store = useEditorStore.getState();
  const pastBefore = store.past.length;
  const before = store.project!.subtitles.find((s) => s.id === "b")!;
  store.updateSubtitleText("b", "Pasted from Notepad");
  const after = useEditorStore.getState();
  assert.equal(after.past.length, pastBefore + 1);
  const b = after.project!.subtitles.find((s) => s.id === "b")!;
  assert.equal(b.text, "Pasted from Notepad");
  assert.equal(b.start, before.start);
  assert.equal(b.end, before.end);
});

// ============================== plain-text formatting sanity ==============================

test("copy then format round-trip: multi-caption plain text is one caption's text per line, in timeline order", () => {
  const store = useEditorStore.getState();
  const clip = buildCaptionClipboard(store.project!.subtitles, ["c", "a", "b"]); // deliberately out of order
  assert.equal(formatClipboardAsPlainText(clip), "Hello world\nThis is SUBLY\nThird caption");
});
