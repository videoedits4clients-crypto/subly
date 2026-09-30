import type { Word } from "@/types/subtitle";

// Multi-word fillers are matched as consecutive-word sequences; single-word
// fillers as exact (case-insensitive) token matches.
const SINGLE_FILLERS = new Set([
  "um", "umm", "uh", "uhh", "uhm", "hmm", "hm", "er", "erm",
  "basically", "actually", "literally", "seriously",
]);
const PHRASE_FILLERS = [
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
];

function clean(w: string) {
  return w.toLowerCase().replace(/[^a-z']/g, "");
}

/** Returns a NEW word array with filler words/phrases flagged `removed: true`. Never mutates input, never deletes — see requirement to keep transcript history. */
export function markFillerWords(words: Word[]): Word[] {
  const out = words.map((w) => ({ ...w }));

  for (let i = 0; i < out.length; i++) {
    const token = clean(out[i].text);
    if (token === "like") {
      // "like" is only a filler when not preceded/followed by clear verb usage;
      // heuristic: treat as filler except after "I/we/they/would/looks/feels/sounds".
      const prev = i > 0 ? clean(out[i - 1].text) : "";
      const guardWords = ["would", "looks", "feels", "sounds", "seems", "look", "feel", "sound", "seem"];
      if (!guardWords.includes(prev)) {
        out[i].removed = true;
      }
      continue;
    }
    if (SINGLE_FILLERS.has(token)) {
      out[i].removed = true;
      continue;
    }
  }

  for (const phrase of PHRASE_FILLERS) {
    for (let i = 0; i <= out.length - phrase.length; i++) {
      const slice = out.slice(i, i + phrase.length).map((w) => clean(w.text));
      if (slice.join(" ") === phrase.join(" ")) {
        for (let j = i; j < i + phrase.length; j++) out[j].removed = true;
      }
    }
  }

  return out;
}

export function countFillerWords(words: Word[]): number {
  return words.filter((w) => w.removed).length;
}
