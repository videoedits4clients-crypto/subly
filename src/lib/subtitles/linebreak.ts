/**
 * Intelligent line-breaking: wraps `text` into at most `maxLines` lines of at
 * most `maxCharsPerLine` characters each, never splitting a word, and
 * preferring to balance line lengths so a 2-line caption doesn't read as one
 * long line + one short trailing word.
 */
export function breakIntoLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  // Greedy wrap first.
  const greedy: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharsPerLine && line) {
      greedy.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) greedy.push(line);

  if (greedy.length <= maxLines) {
    return maxLines === 1 ? [greedy.join(" ")] : balance(words, greedy.length || 1, maxCharsPerLine);
  }

  // Too many lines for the greedy wrap — force into maxLines by balancing,
  // accepting lines longer than maxCharsPerLine only if unavoidable (never
  // splitting a word).
  return balance(words, maxLines, Infinity);
}

/** Distributes words across `lineCount` lines with lengths as close as possible. */
function balance(words: string[], lineCount: number, hardCap: number): string[] {
  if (lineCount <= 1) return [words.join(" ")];

  const totalLen = words.join(" ").length;
  const target = totalLen / lineCount;

  const lines: string[] = [];
  let line = "";
  let remainingLines = lineCount;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = line ? `${line} ${word}` : word;
    const remainingWords = words.slice(i + 1).join(" ");

    const wouldOverCap = candidate.length > hardCap;
    const closerToTargetIfBreakNow =
      line.length > 0 &&
      remainingLines > 1 &&
      Math.abs(line.length - target) <= Math.abs(candidate.length - target) &&
      // don't break so early that remaining lines can't fit remaining words reasonably
      remainingWords.length <= hardCap * (remainingLines - 1) + hardCap;

    if (wouldOverCap || (closerToTargetIfBreakNow && remainingLines > 1 && i < words.length)) {
      lines.push(line);
      line = word;
      remainingLines -= 1;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  // If balancing produced more lines than allowed (edge case), fall back to greedy-cap.
  if (lines.length > lineCount) {
    return lines.slice(0, lineCount - 1).concat(lines.slice(lineCount - 1).join(" "));
  }
  return lines;
}
