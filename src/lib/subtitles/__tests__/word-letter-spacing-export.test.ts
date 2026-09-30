/**
 * Task 131508 (P19.8) — word-level letter-spacing ASS export tests.
 *
 * buildAssDocument (lib/subtitles/ass.ts) now emits an absolute `\fsp<value>` inline override
 * tag for a word carrying its own `style.letterSpacing`, scaled by the same
 * playResY/REFERENCE_HEIGHT factor buildStyleLine already uses for the caption-level Style-line
 * "Spacing" field. This suite is data-driven and deliberately does NOT re-test the general
 * ASS-generation machinery already covered by preset-library.test.ts / global-style-robustness.test.ts
 * or the color/fontSize/fontWeight word-style tags already covered by word-style-capabilities.test.ts.
 *
 * Run with: node --test src/lib/subtitles/__tests__/word-letter-spacing-export.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAssDocument } from "../ass.ts";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "../../../types/subtitle.ts";
import type { Subtitle } from "../../../types/subtitle.ts";

const THREE_WORDS: Subtitle[] = [
  {
    id: "1",
    index: 0,
    start: 0,
    end: 1.2,
    text: "WORD A WORD B WORD C",
    words: [
      { text: "WORD", start: 0, end: 0.1 },
      { text: "A", start: 0.1, end: 0.2 },
      { text: "WORD", start: 0.2, end: 0.3 },
      { text: "B", start: 0.3, end: 0.4, style: { letterSpacing: 20 } },
      { text: "WORD", start: 0.4, end: 0.5 },
      { text: "C", start: 0.5, end: 0.6 },
    ],
  },
];

function build(subtitles: Subtitle[], playResY = 1920) {
  return buildAssDocument({
    subtitles,
    globalStyle: DEFAULT_SUBTITLE_STYLE,
    globalAnimation: DEFAULT_ANIMATION,
    playResX: 1080,
    playResY,
  });
}

function textEventLine(doc: string): string {
  const match = doc.split("\n").find((l) => l.startsWith("Dialogue: 1,"));
  assert.ok(match, "expected exactly one Layer-1 text Dialogue event");
  return match!;
}

test("a word with a letterSpacing override emits an \\fsp tag scoped to just that word's run", () => {
  const line = textEventLine(build(THREE_WORDS));
  // playResY === REFERENCE_HEIGHT (1920) here, so scale === 1 and \fsp20 is exact.
  assert.match(line, /\{[^}]*\\fsp20[^}]*\}B\{\\r\}/, "the overridden word's own run should carry \\fsp20, reset by {\\r} right after");
});

test("neighboring words never inherit the word-specific \\fsp tag (isolation)", () => {
  const line = textEventLine(build(THREE_WORDS));
  // None of "A", "C", or any of the three (identical-text) "WORD" tokens — including the ones
  // immediately BEFORE and AFTER the overridden "B" — may ever be immediately preceded by \fsp.
  for (const neighborText of ["A", "C", "WORD"]) {
    const re = new RegExp(`\\\\fsp-?\\d+[^}]*\\}${neighborText}(\\{\\\\r\\}|\\s|$)`);
    assert.equal(re.test(line), false, `"${neighborText}" should never carry the \\fsp override meant for "B"`);
  }
});

test("\\fsp is scaled by playResY/REFERENCE_HEIGHT the same way the caption-level Spacing field is", () => {
  // Half the reference height -> half the pixel value, rounded.
  const line = textEventLine(build(THREE_WORDS, 960));
  assert.match(line, /\\fsp10[^0-9]/, "20px letterSpacing at half playResY should round to \\fsp10");
});

test("a zero letterSpacing override still emits an explicit \\fsp0 (distinct from no override)", () => {
  const subs: Subtitle[] = [
    {
      ...THREE_WORDS[0],
      words: THREE_WORDS[0].words.map((w) => (w.text === "B" ? { ...w, style: { letterSpacing: 0 } } : w)),
    },
  ];
  const line = textEventLine(build(subs));
  assert.match(line, /\\fsp0[^0-9]/);
});

test("a negative letterSpacing override (within the caption-level control's own -2..12 range) emits a negative \\fsp tag", () => {
  const subs: Subtitle[] = [
    {
      ...THREE_WORDS[0],
      words: THREE_WORDS[0].words.map((w) => (w.text === "B" ? { ...w, style: { letterSpacing: -2 } } : w)),
    },
  ];
  const line = textEventLine(build(subs));
  assert.match(line, /\\fsp-2[^0-9]/);
});

test("a word with no style override at all emits no \\fsp tag", () => {
  const line = textEventLine(build(THREE_WORDS));
  const fspCount = (line.match(/\\fsp/g) ?? []).length;
  assert.equal(fspCount, 1, "only the one overridden word should ever produce an \\fsp tag");
});

test("a word-level letterSpacing override never changes the caption-level Style-line Spacing field", () => {
  const withOverride = build(THREE_WORDS);
  const withoutOverride = build([
    { ...THREE_WORDS[0], words: THREE_WORDS[0].words.map((w) => ({ ...w, style: undefined })) },
  ]);
  const spacingLine = (doc: string) => doc.split("\n").find((l) => l.startsWith("Style:"));
  assert.equal(spacingLine(withOverride), spacingLine(withoutOverride), "the Style: line (including its Spacing field) is caption/global-level only and must be identical regardless of a per-word override");
});
