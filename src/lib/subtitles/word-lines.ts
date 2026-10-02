import type { Word } from "../../types/subtitle.ts";

/**
 * Groups a caption's (non-removed) words into display lines, matching the caption text's own
 * "\n" line breaks. Shared by the live preview (components/editor/subtitle-overlay.tsx) and the
 * ASS export's active-word chip geometry (lib/subtitles/ass.ts), and walks the same way
 * joinWithOriginalLineBreaks does: ONE WORD OBJECT AT A TIME, accumulating each object's own
 * whitespace-token width until the line's token target is met, so a merged word object whose
 * text spans several tokens ("hello world") is assigned to exactly one line atomically instead
 * of shifting every following word onto the wrong line (the previous preview logic sliced the
 * word array by raw per-line token counts and mis-assigned words after any merged word).
 *
 * Every returned entry carries its index into the SAME (non-removed) `words` array, so the
 * preview's active-word index and per-word keys can never point at the wrong word.
 */
export interface LineWord<W extends Pick<Word, "text">> {
  word: W;
  /** Index into the non-removed words array passed in. */
  index: number;
}

export function groupWordsIntoLines<W extends Pick<Word, "text">>(text: string, words: W[]): LineWord<W>[][] {
  const lines = text.split("\n");
  const tokensPerLine = lines.map((l) => l.split(/\s+/).filter(Boolean).length);
  const out: LineWord<W>[][] = [];
  let cursor = 0;
  for (const target of tokensPerLine) {
    const line: LineWord<W>[] = [];
    let consumed = 0;
    while (cursor < words.length && consumed < target) {
      consumed += Math.max(1, words[cursor].text.split(/\s+/).filter(Boolean).length);
      line.push({ word: words[cursor], index: cursor });
      cursor++;
    }
    out.push(line);
  }
  // Defensive only (stale/hand-edited data): never silently drop words — append to the last line.
  while (cursor < words.length) {
    out[out.length - 1].push({ word: words[cursor], index: cursor });
    cursor++;
  }
  return out;
}
