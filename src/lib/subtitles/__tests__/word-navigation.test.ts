/**
 * Pure tests for word-level Left/Right navigation resolution (Task 102741, P15 —
 * src/lib/subtitles/word-navigation.ts). No store, no React, no DOM.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-navigation.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveWordNavigation } from "../word-navigation.ts";
import type { Subtitle, Word } from "../../../types/subtitle.ts";

function word(text: string, start: number, end: number): Word {
  return { text, start, end };
}

function caption(id: string, words: Word[]): Pick<Subtitle, "id" | "words"> {
  return { id, words };
}

const THREE_CAPTIONS: Pick<Subtitle, "id" | "words">[] = [
  caption("a", [word("hello", 0, 1), word("world", 1, 2)]),
  caption("b", [word("this", 2, 2.5), word("is", 2.5, 3), word("subly", 3, 3.5)]),
  caption("c", [word("bye", 4, 5)]),
];

test("1. moves right within the same caption", () => {
  assert.deepEqual(resolveWordNavigation(THREE_CAPTIONS, "a", 0, 1), { captionId: "a", wordIndex: 1 });
});

test("2. moves left within the same caption", () => {
  assert.deepEqual(resolveWordNavigation(THREE_CAPTIONS, "b", 2, -1), { captionId: "b", wordIndex: 1 });
});

test("3. crossing the LAST word of a caption moves to the NEXT caption's FIRST word", () => {
  assert.deepEqual(resolveWordNavigation(THREE_CAPTIONS, "a", 1, 1), { captionId: "b", wordIndex: 0 });
});

test("4. crossing the FIRST word of a caption moves to the PREVIOUS caption's LAST word", () => {
  assert.deepEqual(resolveWordNavigation(THREE_CAPTIONS, "b", 0, -1), { captionId: "a", wordIndex: 1 });
});

test("5. at the very first word of the very first caption, Left is a no-op (null)", () => {
  assert.equal(resolveWordNavigation(THREE_CAPTIONS, "a", 0, -1), null);
});

test("6. at the very last word of the very last caption, Right is a no-op (null)", () => {
  assert.equal(resolveWordNavigation(THREE_CAPTIONS, "c", 0, 1), null);
});

test("7. a caption with no words is skipped when crossing — lands on the next caption that actually has one", () => {
  const withEmpty: Pick<Subtitle, "id" | "words">[] = [
    caption("a", [word("hello", 0, 1)]),
    caption("empty", []),
    caption("c", [word("bye", 2, 3)]),
  ];
  assert.deepEqual(resolveWordNavigation(withEmpty, "a", 0, 1), { captionId: "c", wordIndex: 0 });
});

test("8. a caption with no words is skipped going backward too", () => {
  const withEmpty: Pick<Subtitle, "id" | "words">[] = [
    caption("a", [word("hello", 0, 1)]),
    caption("empty", []),
    caption("c", [word("bye", 2, 3)]),
  ];
  assert.deepEqual(resolveWordNavigation(withEmpty, "c", 0, -1), { captionId: "a", wordIndex: 0 });
});

test("9. multiple consecutive empty captions are all skipped", () => {
  const withEmpties: Pick<Subtitle, "id" | "words">[] = [
    caption("a", [word("hello", 0, 1)]),
    caption("empty1", []),
    caption("empty2", []),
    caption("c", [word("bye", 2, 3)]),
  ];
  assert.deepEqual(resolveWordNavigation(withEmpties, "a", 0, 1), { captionId: "c", wordIndex: 0 });
});

test("10. returns null when the current caption id doesn't exist (defensive — caller shouldn't call this with a stale id)", () => {
  assert.equal(resolveWordNavigation(THREE_CAPTIONS, "does-not-exist", 0, 1), null);
});

test("11. returns null when the current word index is out of range for its caption", () => {
  assert.equal(resolveWordNavigation(THREE_CAPTIONS, "a", 5, 1), null);
  assert.equal(resolveWordNavigation(THREE_CAPTIONS, "a", -1, -1), null);
});

test("12. never mutates the input subtitles array", () => {
  const before = JSON.stringify(THREE_CAPTIONS);
  resolveWordNavigation(THREE_CAPTIONS, "a", 1, 1);
  assert.equal(JSON.stringify(THREE_CAPTIONS), before);
});
