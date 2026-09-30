/**
 * Devanagari -> native Gujarati script conversion.
 *
 * This is a SCRIPT conversion only — a mechanical Unicode remapping — never a
 * linguistic one. It does not correct, rewrite, translate, or reinterpret
 * Whisper's output: whatever Devanagari text Whisper produced (including any
 * transcription mistakes) is carried through unchanged in meaning, just
 * rendered in Gujarati glyphs instead of Devanagari ones. See the investigation
 * report this implements: Devanagari (U+0900-097F) and Gujarati (U+0A80-0AFF)
 * are laid out in Unicode at a fixed +0x180 offset because Gujarati script
 * historically derives from Devanagari letterforms (minus the shirorekha
 * head-line) — verified empirically against `Unicode Character Database`
 * names, and cross-validated word-for-word against the independent
 * `indic_transliteration` (sanscript) library on the real 61.3s Gujarati
 * benchmark transcript (0/167 words differed).
 */

const OFFSET = 0x0a80 - 0x0900;
const DEVANAGARI_START = 0x0900;
const DEVANAGARI_END = 0x097f;

/**
 * Devanagari codepoints that must NOT be shifted by +OFFSET because the
 * Gujarati block has no assigned character at the offset position (verified
 * empirically via the Unicode Character Database, not assumed) — passed
 * through unchanged rather than emitting a broken/unassigned codepoint.
 * Danda / double danda (U+0964/U+0965, sentence-ending punctuation) have no
 * Gujarati-block equivalent either; Gujarati prose conventionally still uses
 * the Devanagari danda glyph itself, so these are intentionally passed
 * through rather than mapped. The rest are rare Vedic/dialectal/regional
 * extension marks that don't occur in real transcribed speech, kept here only
 * as a defensive fallback so they never corrupt into a wrong codepoint if
 * they somehow appear.
 */
const PASSTHROUGH = new Set<number>([
  0x0900, 0x0904, 0x090e, 0x0912, 0x093a, 0x093b, 0x0946, 0x094a, 0x094e, 0x094f,
  0x0951, 0x0952, 0x0953, 0x0954, 0x0955, 0x0956, 0x0957,
  0x0964, 0x0965, // DANDA, DOUBLE DANDA
  0x0971, 0x0972, 0x0973, 0x0974, 0x0975, 0x0976, 0x0977, 0x0978,
  0x097a, 0x097b, 0x097c, 0x097d, 0x097e, 0x097f,
]);

/** Devanagari Unicode block (matches the range used by lib/subtitles/hinglish.ts's containsDevanagari). */
const DEVANAGARI_RUN = /[ऀ-ॿ]/;

/** True if `text` contains any Devanagari characters at all. */
export function containsDevanagariScript(text: string): boolean {
  return DEVANAGARI_RUN.test(text);
}

/**
 * Converts Devanagari text to native Gujarati script (Unicode block U+0A80-0AFF).
 *
 * NFD-decomposes first so nukta-modified compatibility letters (e.g. QA,
 * KHHA, NNNA, RRA, LLLA — Devanagari consonants formed with a combining
 * nukta) split into base-consonant + combining nukta, both of which DO have
 * clean Gujarati-block targets, even though the precomposed nukta letter
 * itself often doesn't. Every remaining Devanagari-block codepoint is then
 * shifted by the fixed +0x180 offset, except the handful in PASSTHROUGH.
 * Anything outside the Devanagari block — Latin/English text, digits,
 * punctuation, whitespace, emoji, URLs, hashtags, @mentions — is untouched by
 * construction, since only codepoints in U+0900-097F are ever remapped.
 * Finally NFC-recomposes (a no-op for the new nukta+base Gujarati sequences,
 * which have no precomposed form, but harmless/correct for anything that does
 * recompose).
 */
export function devanagariToGujaratiScript(text: string): string {
  if (!text) return text;
  const decomposed = text.normalize("NFD");
  let out = "";
  for (const ch of decomposed) {
    const cp = ch.codePointAt(0)!;
    if (cp >= DEVANAGARI_START && cp <= DEVANAGARI_END && !PASSTHROUGH.has(cp)) {
      out += String.fromCodePoint(cp + OFFSET);
    } else {
      out += ch;
    }
  }
  return out.normalize("NFC");
}
