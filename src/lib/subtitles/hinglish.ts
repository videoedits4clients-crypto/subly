/**
 * Devanagari Hindi → Hinglish (Romanized Hindi) transliteration.
 *
 * This is TRANSLITERATION, not translation — "बहुत अच्छी है" becomes "Bahut achhi
 * hai" (still Hindi, just Latin script), never "It is very good". No cloud AI, no
 * network call, no external dependency: a deterministic local engine, built
 * because general-purpose transliteration libraries (e.g. Sanscript-style ITRANS/
 * IAST schemes, meant for Sanskrit) retain the Devanagari inherent vowel and
 * produce things like "bahuta" — technically a valid transliteration, but not the
 * natural spelling anyone actually writes in a Hindi social-media caption. Getting
 * that naturalness requires schwa deletion, which is exactly what this file does.
 *
 * Two layers, tried in order:
 *  1. A curated dictionary of common words (function words, pronouns, verb forms,
 *     greetings — the highest-frequency words in casual spoken Hindi) with
 *     hand-picked natural spellings. Guarantees correctness for the words people
 *     actually say most.
 *  2. A rule-based fallback for everything else: walks the Devanagari consonant/
 *     matra/halant structure and applies word-final schwa deletion (the single
 *     biggest lever for naturalness — "बहुत" ends in a bare consonant त with no
 *     matra, so the implicit final "a" is dropped: "bahut", not "bahuta").
 *
 * Script-aware: only Devanagari runs are transliterated. Latin words, numbers,
 * currency symbols, URLs, emails, hashtags, mentions, and emoji pass through
 * completely unchanged (see `transliterateToHinglish`'s tokenizer).
 */

// ---------------------------------------------------------------------------
// Layer 1: curated dictionary of common words — natural spellings that a rule
// engine would either get wrong (irregular vowels) or merely get less-idiomatic.
// Keys are bare Devanagari words (no punctuation); matched case-sensitively
// against a word after stripping leading/trailing punctuation.
// ---------------------------------------------------------------------------
const COMMON_WORDS: Record<string, string> = {
  // Pronouns
  "मैं": "main",
  "मुझे": "mujhe",
  "मुझको": "mujhko",
  "मेरा": "mera",
  "मेरी": "meri",
  "मेरे": "mere",
  "हम": "hum",
  "हमें": "hamein",
  "हमारा": "hamara",
  "हमारी": "hamari",
  "हमारे": "hamare",
  "तू": "tu",
  "तुझे": "tujhe",
  "तेरा": "tera",
  "तेरी": "teri",
  "तेरे": "tere",
  "तुम": "tum",
  "तुम्हें": "tumhein",
  "तुम्हारा": "tumhara",
  "तुम्हारी": "tumhari",
  "तुम्हारे": "tumhare",
  "आप": "aap",
  "आपको": "aapko",
  "आपने": "aapne",
  "आपका": "aapka",
  "आपकी": "aapki",
  "आपके": "aapke",
  "वह": "vah",
  "वो": "vo",
  "उसे": "use",
  "उसका": "uska",
  "उसकी": "uski",
  "उसके": "uske",
  "वे": "ve",
  "उन्हें": "unhein",
  "उनका": "unka",
  "उनकी": "unki",
  "उनके": "unke",
  // "yeh" (not the more formal/Sanskrit-ish "yah") — how creators actually write यह.
  "यह": "yeh",
  "ये": "ye",
  "इसे": "ise",
  "इस": "is",
  "इसका": "iska",
  "इसकी": "iski",
  "इसके": "iske",
  "इन्हें": "inhein",
  "कोई": "koi",
  "कुछ": "kuchh",
  "सब": "sab",
  "सभी": "sabhi",

  // Question / negation words
  "क्या": "kya",
  "क्यों": "kyun",
  "कौन": "kaun",
  "किसे": "kise",
  "किसका": "kiska",
  // Short "kahan" (not "kahaan") — the common casual spelling.
  "कहाँ": "kahan",
  "कहां": "kahan",
  "कब": "kab",
  "कैसे": "kaise",
  "कैसा": "kaisa",
  "कैसी": "kaisi",
  "कितना": "kitna",
  "कितनी": "kitni",
  "नहीं": "nahi",
  "ना": "na",
  "मत": "mat",

  // Common verb forms
  "है": "hai",
  "हैं": "hain",
  "था": "tha",
  "थी": "thi",
  "थे": "the",
  "हो": "ho",
  "होना": "hona",
  "होगा": "hoga",
  "होगी": "hogi",
  "हुआ": "hua",
  "हुई": "hui",
  "हुए": "hue",
  "हूँ": "hoon",
  "हूं": "hoon",
  "करना": "karna",
  "करता": "karta",
  "करती": "karti",
  "करते": "karte",
  "करते हैं": "karte hain",
  "करके": "karke",
  "किया": "kiya",
  "की": "ki",
  "किए": "kiye",
  "करूंगा": "karunga",
  "करूँगा": "karunga",
  "करूंगी": "karungi",
  "देना": "dena",
  "देता": "deta",
  "देती": "deti",
  "देते": "dete",
  "दिया": "diya",
  "लेना": "lena",
  "लेता": "leta",
  "लेती": "leti",
  "लेते": "lete",
  "लिया": "liya",
  "जाना": "jaana",
  "जा": "ja",
  "जाता": "jaata",
  "जाती": "jaati",
  "जाते": "jaate",
  "गया": "gaya",
  "गई": "gai",
  "गए": "gaye",
  "आना": "aana",
  "आता": "aata",
  "आती": "aati",
  "आते": "aate",
  "आया": "aaya",
  "आई": "aai",
  "आए": "aaye",
  // Present-continuous auxiliary ("X raha/rahe/rahi hai") — extremely common in
  // casual speech ("जा रहा हूँ", "कर रहे हो").
  "रहा": "raha",
  "रहे": "rahe",
  "रही": "rahi",
  "देखना": "dekhna",
  "देखा": "dekha",
  "देखो": "dekho",
  "सुनना": "sunna",
  "सुना": "suna",
  "बताना": "batana",
  "बताओ": "batao",
  "बताता": "batata",
  "बताती": "batati",
  "बोलना": "bolna",
  "बोला": "bola",
  "पसंद": "pasand",
  "प्यार": "pyaar",
  "चाहिए": "chahiye",
  "चाहता": "chahta",
  "चाहती": "chahti",
  "कर": "kar",
  "करने": "karne",
  "लग": "lag",
  // समझ (noun, "understanding") keeps its medial vowel; समझा (verb, past tense
  // "understood") drops it; समझना (infinitive) keeps it again — three genuinely
  // different, irregular romanizations for words that share the same root, which
  // is exactly the kind of case a general schwa-deletion rule can't get right for
  // all three at once (see the file-level comment on why this stays dictionary-first).
  "समझ": "samajh",
  "समझा": "samjha",
  "समझना": "samajhna",
  "पता": "pata",
  "खाना": "khaana",
  "खाया": "khaaya",
  "खाई": "khaai",
  "खाए": "khaaye",
  "मिलना": "milna",
  "मिलता": "milta",
  "मिलती": "milti",
  "मिलते": "milte",
  "मिला": "mila",
  "मिली": "mili",
  "मिले": "mile",
  "पूरा": "poora",
  "पूरी": "poori",
  "वाला": "wala",
  "वाली": "wali",
  "वाले": "wale",

  // Common adjectives / adverbs
  "बहुत": "bahut",
  "अच्छा": "achha",
  "अच्छी": "achhi",
  "अच्छे": "achhe",
  "बुरा": "bura",
  "बुरी": "buri",
  "बड़ा": "bada",
  "बड़ी": "badi",
  "छोटा": "chhota",
  "छोटी": "chhoti",
  "नया": "naya",
  "नई": "nai",
  "पुराना": "purana",
  "कम": "kam",
  "ज्यादा": "zyada",
  "ज़्यादा": "zyada",
  "ज़रूरी": "zaroori",
  "जरूरी": "zaroori",
  "थोड़ा": "thoda",
  "थोड़ी": "thodi",
  "फिर": "phir",
  "अभी": "abhi",
  "कभी": "kabhi",
  "हमेशा": "hamesha",
  "सच": "sach",
  "सही": "sahi",
  "गलत": "galat",
  "बढ़िया": "badhiya",

  // Common nouns
  "लोग": "log",
  "बात": "baat",
  "चीज़": "cheez",
  "चीज": "cheez",
  "समय": "samay",
  "दिन": "din",
  "साल": "saal",
  "घर": "ghar",
  "काम": "kaam",
  "पैसा": "paisa",
  "पैसे": "paise",
  "जगह": "jagah",
  "बच्चा": "bachcha",
  "आदमी": "aadmi",
  "औरत": "aurat",
  "पानी": "paani",
  "कहानी": "kahaani",
  "फ़ोन": "phone",
  "फोन": "phone",
  "लड़की": "ladki",
  "लड़का": "ladka",
  "दोस्त": "dost",

  // Postpositions / conjunctions / particles
  "का": "ka",
  "के": "ke",
  "को": "ko",
  "से": "se",
  "में": "mein",
  "पर": "par",
  "तक": "tak",
  "साथ": "saath",
  "और": "aur",
  "या": "ya",
  "लेकिन": "lekin",
  "पर भी": "par bhi",
  "क्योंकि": "kyunki",
  // "to" (not "toh") — matches creator convention in casual captions.
  "तो": "to",
  "अगर": "agar",
  "भी": "bhi",
  "सिर्फ": "sirf",
  "बस": "bas",

  // Greetings / interjections
  "नमस्ते": "namaste",
  "धन्यवाद": "dhanyavaad",
  "शुक्रिया": "shukriya",
  "अरे": "arre",
  "वाह": "wah",
  "अच्छा तो": "achha toh",

  // Time words
  "आज": "aaj",
  "कल": "kal",
  "परसों": "parson",
  "अभी अभी": "abhi abhi",
};

// ---------------------------------------------------------------------------
// Layer 2: rule-based fallback for anything not in the dictionary above.
// ---------------------------------------------------------------------------

// Independent vowels (word-initial / standalone, not following a consonant).
const INDEPENDENT_VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};

// Dependent vowel signs (matras) — attach to the preceding consonant, replacing
// its inherent "a". Order doesn't matter here (lookup by exact character).
const MATRAS: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
};

// Consonants, in their BASE form including the inherent "a" — stripped by the
// engine when followed by a matra, a halant (conjunct), or at certain word-final
// positions (schwa deletion).
const CONSONANTS: Record<string, string> = {
  "क": "ka", "ख": "kha", "ग": "ga", "घ": "gha", "ङ": "nga",
  "च": "cha", "छ": "chha", "ज": "ja", "झ": "jha", "ञ": "nya",
  "ट": "ta", "ठ": "tha", "ड": "da", "ढ": "dha", "ण": "na",
  "त": "ta", "थ": "tha", "द": "da", "ध": "dha", "न": "na",
  "प": "pa", "फ": "pha", "ब": "ba", "भ": "bha", "म": "ma",
  "य": "ya", "र": "ra", "ल": "la", "व": "va",
  "श": "sha", "ष": "sha", "स": "sa", "ह": "ha", "ळ": "la",
};

// Nukta (combining, U+093C — referenced by escape rather than as a bare literal,
// since editing tools/terminals can silently mangle a standalone combining mark)
// turns a base consonant into a different loanword sound: क+़ = "क़" (qa), ड+़ =
// "ड़" (an "r"-like flap), etc. Devanagari nukta letters are, unusually, EXCLUDED
// from Unicode's own NFC/NFKC recomposition (a documented
// Full_Composition_Exclusion) — a base consonant followed by this combining mark
// never becomes one precomposed codepoint automatically, so it must be handled
// as its own two-character step in the main loop below, keyed by the BASE
// consonant (not any precomposed character, which is exactly what broke here the
// first time: even the "precomposed" character typed into this very file's
// source turned out to already be a decomposed base+nukta pair, not one
// codepoint — confirmed by inspecting its codepoints directly, not assumed).
const NUKTA = "़";
const NUKTA_CONSONANTS: Record<string, string> = {
  "क": "qa", "ख": "kha", "ग": "ga", "ज": "za", "ड": "ra", "ढ": "rha", "फ": "fa", "य": "ya",
};

// Common conjuncts handled as a single unit so they read naturally instead of
// as two concatenated consonants (े.g. क्ष -> "ksh", not "kasha").
const CONJUNCTS: Record<string, string> = {
  "क्ष": "ksh",
  "ज्ञ": "gya",
  "त्र": "tra",
  "श्र": "shra",
};

const HALANT = "्"; // ् — virama, suppresses inherent vowel / joins a conjunct
const ANUSVARA = "ं"; // ं — nasalization, -> "n"
const CHANDRABINDU = "ँ"; // ँ — nasalization, -> "n"
const VISARGA = "ः"; // ः -> "h"
const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};
const DANDA = "।"; // । -> "."
const DOUBLE_DANDA = "॥"; // ॥ -> "."

/** True if `ch` is a Devanagari consonant (base or nukta form) this engine can map. */
function isConsonant(ch: string): boolean {
  return ch in CONSONANTS;
}

/** Strips the trailing inherent "a" a bare-consonant mapping carries, e.g. "ka" -> "k". */
function stripInherentA(romanized: string): string {
  return romanized.endsWith("a") && !romanized.endsWith("aa") ? romanized.slice(0, -1) : romanized;
}

/**
 * Romanizes ONE Devanagari word (no whitespace) using the character-level rules —
 * consonant clusters via halant, matras replacing the inherent vowel, and a
 * word-final schwa deletion pass so a word doesn't end in a dangling "a" it
 * wouldn't be pronounced with (this is the rule that turns "bahuta" into "bahut").
 */
function transliterateWordByRule(word: string): string {
  const chars = [...word];
  let out = "";
  let i = 0;

  // Multi-character conjuncts first (checked at each position via lookahead).
  function matchConjunctAt(pos: number): { text: string; length: number } | null {
    for (const [conjunct, roman] of Object.entries(CONJUNCTS)) {
      const conjunctChars = [...conjunct];
      if (chars.slice(pos, pos + conjunctChars.length).join("") === conjunct) {
        return { text: roman, length: conjunctChars.length };
      }
    }
    return null;
  }

  while (i < chars.length) {
    const ch = chars[i];

    if (ch in DEVANAGARI_DIGITS) {
      out += DEVANAGARI_DIGITS[ch];
      i++;
      continue;
    }
    if (ch === DANDA || ch === DOUBLE_DANDA) {
      out += ".";
      i++;
      continue;
    }
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      out += "n";
      i++;
      continue;
    }
    if (ch === VISARGA) {
      out += "h";
      i++;
      continue;
    }
    if (ch in MATRAS) {
      // A matra with no preceding consonant shouldn't normally occur; skip defensively.
      out += MATRAS[ch];
      i++;
      continue;
    }
    if (ch in INDEPENDENT_VOWELS) {
      out += INDEPENDENT_VOWELS[ch];
      i++;
      continue;
    }

    const conjunctMatch = matchConjunctAt(i);
    if (conjunctMatch) {
      i += conjunctMatch.length;
      // A conjunct consumes the halant itself; treat its output like a consonant
      // base (inherent vowel present) so the same matra/halant/final logic applies.
      const next = chars[i];
      if (next === HALANT) {
        out += conjunctMatch.text; // already suppressed further down via halant skip
        i++; // consume halant
        continue;
      }
      if (next && next in MATRAS) {
        out += conjunctMatch.text + MATRAS[next];
        i++;
        continue;
      }
      const isLast = i >= chars.length || !chars.slice(i).some(isConsonant);
      out += isLast ? conjunctMatch.text : conjunctMatch.text + "a";
      continue;
    }

    if (isConsonant(ch)) {
      // A nukta (combining mark, U+093C) immediately after a base consonant turns it
      // into a different loanword sound (ड + nukta -> the "ड़" flap, etc.) — see the
      // NUKTA_CONSONANTS comment above for why this is handled here, as a two-character
      // step keyed by the base consonant, rather than via any precomposed character.
      const hasNukta = chars[i + 1] === NUKTA && ch in NUKTA_CONSONANTS;
      const base = hasNukta ? NUKTA_CONSONANTS[ch] : CONSONANTS[ch];
      const consumed = hasNukta ? 2 : 1;
      const next = chars[i + consumed];

      if (next === HALANT) {
        // Conjunct: emit consonant WITHOUT inherent vowel, skip the halant, continue
        // directly into the next consonant (which will get its own vowel/halant logic).
        out += stripInherentA(base);
        i += consumed + 1;
        continue;
      }
      if (next && next in MATRAS) {
        out += stripInherentA(base) + MATRAS[next];
        i += consumed + 1;
        continue;
      }
      if (next === ANUSVARA || next === CHANDRABINDU) {
        out += stripInherentA(base) + "n";
        i += consumed + 1;
        continue;
      }
      // Bare consonant with no matra/halant following — inherent "a" applies,
      // UNLESS this is the last consonant in the word (schwa deletion), in which
      // case it's dropped: बहुत ends in bare त with nothing after -> "t", not "ta".
      const isWordFinal = i + consumed - 1 === chars.length - 1;
      out += isWordFinal ? stripInherentA(base) : base;
      i += consumed;
      continue;
    }

    // Unrecognized character (shouldn't normally happen for a pure Devanagari
    // run) — pass it through unchanged rather than dropping it silently.
    out += ch;
    i++;
  }

  return out;
}

/** Devanagari Unicode block, including vowel signs, virama, nasalization, digits, danda. */
const DEVANAGARI_RUN = /[ऀ-ॿ]+/g;

/** True if `text` contains any Devanagari characters at all. */
export function containsDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/**
 * Transliterates one Devanagari word/token to natural Hinglish — dictionary
 * lookup first (case- and punctuation-insensitive against the bare word), then
 * the rule-based engine. Leading/trailing punctuation attached to the token
 * (e.g. a trailing "।" or "?") is preserved around whichever form wins.
 */
function transliterateDevanagariToken(token: string): string {
  const match = /^([^ऀ-ॿ]*)([ऀ-ॿ]+)([^ऀ-ॿ]*)$/.exec(token);
  if (!match) return transliterateWordByRule(token);
  const [, lead, core, trail] = match;
  const dictHit = COMMON_WORDS[core];
  const romanCore = dictHit ?? transliterateWordByRule(core);
  return lead + romanCore + trail;
}

/**
 * Transliterates a full string of (possibly mixed-script) text to Hinglish.
 * Devanagari runs are romanized word-by-word (dictionary first, rules as
 * fallback); everything else — Latin words, numbers, currency symbols, URLs,
 * email addresses, hashtags, @mentions, emoji, and punctuation — passes through
 * completely unchanged. The first letter of the result is capitalized to match
 * normal caption casing; other words stay lowercase unless the dictionary/rules
 * produced a capital (never done automatically) so "product", "comfortable" etc
 * keep whatever casing they already had.
 */
export function transliterateToHinglish(text: string): string {
  if (!text) return text;
  // NFC-normalize first (harmless general-purpose cleanup; nukta letters
  // specifically are handled separately in the main loop — see NUKTA_CONSONANTS —
  // since Unicode excludes them from NFC/NFKC recomposition entirely).
  text = text.normalize("NFC");
  let firstWordEmitted = false;

  const result = text.replace(DEVANAGARI_RUN, (run) => {
    // A "run" can contain multiple space-separated words if there's no Latin
    // text between them in the original — split so each gets its own
    // dictionary lookup / schwa-deletion pass rather than treating the whole
    // run as one giant word.
    const romanized = run
      .split(/(\s+)/)
      .map((piece) => (/^\s+$/.test(piece) || piece === "" ? piece : transliterateDevanagariToken(piece)))
      .join("");
    return romanized;
  });

  // Capitalize the first alphabetic character of the whole string (matches
  // every example: "Bahut achhi hai", "Ye product bahut comfortable hai.").
  return result.replace(/[A-Za-z]/, (ch) => {
    if (firstWordEmitted) return ch;
    firstWordEmitted = true;
    return ch.toUpperCase();
  });
}

/**
 * Transliterates a single Word's text in isolation (used to build per-word
 * Hinglish so timestamps/highlighting stay word-aligned — see
 * lib/subtitles/hinglish-words.ts). No sentence-level capitalization is
 * applied here; that's handled once, at the caption-text level, by whichever
 * word ends up first.
 */
export function transliterateWord(text: string): string {
  if (!containsDevanagari(text)) return text;
  return transliterateDevanagariToken(text.normalize("NFC"));
}
