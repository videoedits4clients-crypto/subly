/**
 * Pure, DOM-free tests for src/lib/subtitles/caption-clipboard.ts (Task 101583, P14) — the
 * internal caption-text clipboard's data model and its copy/paste-mapping logic. Nothing here
 * touches the store or React; word-timing safety and undo/redo behavior for the actual
 * applyTextMap mutation are covered separately in
 * src/store/__tests__/editor-store-clipboard.test.ts.
 *
 * Run with: node --test src/lib/subtitles/__tests__/caption-clipboard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptionClipboard,
  formatClipboardAsPlainText,
  mappingToTextRecord,
  resolveMismatchPasteMapping,
  resolvePasteMapping,
} from "../caption-clipboard.ts";
import type { Subtitle } from "../../../types/subtitle.ts";

function sub(id: string, index: number, text: string, start: number, end: number): Subtitle {
  const tokens = text.split(/\s+/).filter(Boolean);
  const per = tokens.length ? (end - start) / tokens.length : 0;
  return {
    id,
    index,
    start,
    end,
    text,
    words: tokens.map((t, i) => ({ text: t, start: start + i * per, end: start + (i + 1) * per })),
  };
}

const SUBTITLES: Subtitle[] = [
  sub("a", 0, "Hello world", 0, 1),
  sub("b", 1, "This is SUBLY", 1, 2),
  sub("c", 2, "Third caption\nsecond line", 2, 3),
];

// ============================== buildCaptionClipboard ==============================

test("buildCaptionClipboard: single caption copies its text/words/timing", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a"]);
  assert.equal(clip.captions.length, 1);
  assert.equal(clip.captions[0].text, "Hello world");
  assert.equal(clip.captions[0].words.length, 2);
  assert.equal(clip.captions[0].start, 0);
  assert.equal(clip.captions[0].end, 1);
});

test("buildCaptionClipboard: multiple captions are returned in TIMELINE order regardless of id order given", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["c", "a", "b"]); // deliberately out of order
  assert.deepEqual(
    clip.captions.map((c) => c.text),
    ["Hello world", "This is SUBLY", "Third caption\nsecond line"],
  );
});

test("buildCaptionClipboard: accepts a Set as well as an array", () => {
  const clip = buildCaptionClipboard(SUBTITLES, new Set(["b"]));
  assert.equal(clip.captions.length, 1);
  assert.equal(clip.captions[0].text, "This is SUBLY");
});

test("buildCaptionClipboard: empty id set returns an empty clipboard, not an error", () => {
  const clip = buildCaptionClipboard(SUBTITLES, []);
  assert.deepEqual(clip.captions, []);
});

test("buildCaptionClipboard: an id not present in subtitles is silently skipped", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a", "does-not-exist"]);
  assert.equal(clip.captions.length, 1);
});

test("buildCaptionClipboard: never mutates the source subtitles array or its captions", () => {
  const before = JSON.stringify(SUBTITLES);
  buildCaptionClipboard(SUBTITLES, ["a", "b", "c"]);
  assert.equal(JSON.stringify(SUBTITLES), before);
});

test("buildCaptionClipboard: stays fast (O(n)) at 5,400 captions", () => {
  const many: Subtitle[] = [];
  for (let i = 0; i < 5400; i++) many.push(sub(`s${i}`, i, `Caption number ${i}`, i, i + 1));
  const ids = many.filter((_, i) => i % 3 === 0).map((s) => s.id); // 1,800 selected
  const start = performance.now();
  const clip = buildCaptionClipboard(many, ids);
  const elapsed = performance.now() - start;
  assert.equal(clip.captions.length, 1800);
  assert.ok(elapsed < 200, `buildCaptionClipboard took ${elapsed}ms at 5,400 captions — expected well under 200ms`);
});

// ============================== formatClipboardAsPlainText ==============================

test("formatClipboardAsPlainText: single caption is just its own text", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a"]);
  assert.equal(formatClipboardAsPlainText(clip), "Hello world");
});

test("formatClipboardAsPlainText: multiple captions are one per line, in timeline order", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a", "b"]);
  assert.equal(formatClipboardAsPlainText(clip), "Hello world\nThis is SUBLY");
});

test("formatClipboardAsPlainText: a caption's own internal line breaks are preserved verbatim", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["c"]);
  assert.equal(formatClipboardAsPlainText(clip), "Third caption\nsecond line");
});

test("formatClipboardAsPlainText: empty clipboard formats as an empty string", () => {
  assert.equal(formatClipboardAsPlainText({ captions: [] }), "");
});

// ============================== resolvePasteMapping ==============================

test("resolvePasteMapping: empty clipboard resolves to 'empty'", () => {
  const resolution = resolvePasteMapping({ captions: [] }, ["a"]);
  assert.deepEqual(resolution, { kind: "empty" });
});

test("resolvePasteMapping: 1 copied into 1 selected is a 'match' with a direct mapping", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a"]);
  const resolution = resolvePasteMapping(clip, ["b"]);
  assert.equal(resolution.kind, "match");
  if (resolution.kind === "match") {
    assert.deepEqual(resolution.mapping, [{ targetId: "b", text: "Hello world" }]);
  }
});

test("resolvePasteMapping: N copied into N selected maps by position, in the given order", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a", "b"]); // ["Hello world", "This is SUBLY"]
  const resolution = resolvePasteMapping(clip, ["c", "a"]); // arbitrary destination order
  assert.equal(resolution.kind, "match");
  if (resolution.kind === "match") {
    assert.deepEqual(resolution.mapping, [
      { targetId: "c", text: "Hello world" },
      { targetId: "a", text: "This is SUBLY" },
    ]);
  }
});

test("resolvePasteMapping: more copied than selected (3 into 2) is a 'mismatch', never truncated automatically", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a", "b", "c"]);
  const resolution = resolvePasteMapping(clip, ["a", "b"]);
  assert.equal(resolution.kind, "mismatch");
  if (resolution.kind === "mismatch") {
    assert.equal(resolution.copiedCount, 3);
    assert.equal(resolution.selectedCount, 2);
    assert.equal(resolution.pasteCount, 2);
    assert.deepEqual(resolution.preview, ["Hello world", "This is SUBLY"]);
  }
});

test("resolvePasteMapping: fewer copied than selected (1 into 3) is a 'mismatch', never repeated automatically", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a"]);
  const resolution = resolvePasteMapping(clip, ["a", "b", "c"]);
  assert.equal(resolution.kind, "mismatch");
  if (resolution.kind === "mismatch") {
    assert.equal(resolution.copiedCount, 1);
    assert.equal(resolution.selectedCount, 3);
    assert.equal(resolution.pasteCount, 1);
    assert.deepEqual(resolution.preview, ["Hello world"]);
  }
});

test("resolvePasteMapping: 0 selected targets (nothing to paste into) is a 'mismatch' with pasteCount 0", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a", "b"]);
  const resolution = resolvePasteMapping(clip, []);
  assert.equal(resolution.kind, "mismatch");
  if (resolution.kind === "mismatch") {
    assert.equal(resolution.pasteCount, 0);
    assert.deepEqual(resolution.preview, []);
  }
});

// ============================== resolveMismatchPasteMapping ==============================

test("resolveMismatchPasteMapping: copied > selected truncates the COPIED list to fit, in order", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a", "b", "c"]);
  const mapping = resolveMismatchPasteMapping(clip, ["x", "y"]);
  assert.deepEqual(mapping, [
    { targetId: "x", text: "Hello world" },
    { targetId: "y", text: "This is SUBLY" },
  ]);
});

test("resolveMismatchPasteMapping: selected > copied only maps the first N destinations, rest untouched", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a"]);
  const mapping = resolveMismatchPasteMapping(clip, ["x", "y", "z"]);
  assert.deepEqual(mapping, [{ targetId: "x", text: "Hello world" }]);
});

test("resolveMismatchPasteMapping: never repeats a copied caption's text across multiple targets", () => {
  const clip = buildCaptionClipboard(SUBTITLES, ["a"]);
  const mapping = resolveMismatchPasteMapping(clip, ["x", "y", "z"]);
  assert.equal(mapping.length, 1, "must map only as many targets as there are copied captions — never repeat");
});

// ============================== mappingToTextRecord ==============================

test("mappingToTextRecord: converts an ordered mapping array into an id->text record", () => {
  const record = mappingToTextRecord([
    { targetId: "x", text: "one" },
    { targetId: "y", text: "two" },
  ]);
  assert.deepEqual(record, { x: "one", y: "two" });
});

test("mappingToTextRecord: empty mapping yields an empty record", () => {
  assert.deepEqual(mappingToTextRecord([]), {});
});
