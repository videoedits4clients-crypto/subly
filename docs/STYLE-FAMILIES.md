# SUBLY style families (P20.2)

The built-in caption library is organised into **12 style families**. A family is a visual *system* — a
typographic personality, a layout and position, a container treatment, an emphasis strategy and a motion
language — not a colour scheme. Each family has two flagship ("representative") styles that define its look;
the other presets in the family are variations on it.

`family` is plain data on each preset (`src/lib/presets.ts`). The preview and the ASS export never read it or a
preset id — they only consume the resolved `SubtitleStyle` / `AnimationConfig`.

## Why the old library felt samey

Measured on the 45 presets that existed before P20.2 (`lib/preset-audit.ts` buckets colours and sizes so
"58px vs 60px" does not count as a difference):

| Dimension | Before | After |
|---|---|---|
| Presets at the default spot (centred, y = 82) | 41 of 45 | 18 of 49 |
| Distinct position/alignment compositions | 2 | 9 |
| Distinct entrance animations | 5 | 8 |
| Distinct exit values (none, fade, slide, pop) | 1 (all `none`) | 4 (`none`, fade, slide-left, pop) |
| Background-container treatments | 4 | 7 |
| Fonts | 18 | 24 |

## The families

| Family | Typography | Layout / position | Container | Emphasis | Motion |
|---|---|---|---|---|---|
| **Minimal** | Small (≤46px), light, sentence/lower case | Bottom, or tucked bottom-left | None | None / soft colour | Slow fade; slide-up in |
| **Bold Creator** | Huge heavy caps (≥76px) + fat outline | Dead-centre, upper third, top-left HUD | None | Scale/bounce hit on the active word | Pop / bounce / slide in |
| **Karaoke** | Readable mid-weight line | Steady lower area | None | Strong active-word treatment (scale, underline, chip, dim→bright) | None or fade — the line is persistent |
| **Editorial** | Serif, placed deliberately | Flush-left lower third; top-right byline | None | None (restrained colour) | Slow fade / slide + fade out |
| **Cinematic** | Serif or ultra-wide-tracked caps, ≤52px | Very low (y ≥ 86) | None | None | Slow (≥0.4s) fade / rise |
| **Neon** | Bright, high-contrast | Lower / centre | None | Colour change on the word | Pop / bounce in, fade out |
| **Sticker** | Rounded, playful | Lower / mid | Solid rounded chip (opacity ≥ 0.9) | Word colour | Pop / bounce in, pop out |
| **Comic** | Comic / rounded lettering, thick outline | Upper third | None | Scale / bounce | Pop / bounce |
| **Podcast** | Highly readable sentence case | Left-aligned lower third | Soft dark panel | Colour on the word | Slide-up, fade out |
| **Documentary** | Small tracked caps | Flush-left at the very bottom | Solid square bar | Amber word accent | Calm fade |
| **Meme** | Enormous (≥90px), ≥12px outline | Pinned to the top or bottom edge | None | None | Pop or none |
| **Handwritten** | Pen / marker fonts, natural case | Off-centre or top-left | None | Underline / bounce word | Word fade / slide, fade out |

`src/lib/__tests__/style-family-audit.test.ts` encodes each row as an executable **contract** for the family's
two flagships, and requires every pair of flagships to differ in at least 4 of 14 audit dimensions and every
pair of visible presets in at least 3.

### Flagships (24)

minimal · minimal-left · bold · mrbeast · karaoke · word-focus · editorial · magazine · cinematic · film-title ·
neon · neon-tube · sticker · sticker-pill · comic · cartoon · podcast · youtube · news · documentary ·
meme-impact · meme-yellow · handwritten-caveat · handwritten-marker

New in P20.2: minimal-left, magazine, film-title, neon-tube, sticker-pill, documentary, meme-impact,
meme-yellow, handwritten-caveat, handwritten-marker.

## What happened to the existing 45 presets

No id was removed. Every pre-P20.2 id still resolves through `getPreset()`.

* **KEEP** — byte-identical (hash-locked in the audit test): reels, mrbeast, bounce, highlight, word-focus, classic,
  youtube, news, mono, cinematic, cinematic-glow, sticker, candy-pop, cartoon, outline, shadow-pop, gradient-glow,
  retro, vhs, arcade.
* **REFINE** — same identity, changed composition/motion: bold, tiktok, punch, gaming, jump-pop, word-burst, karaoke,
  marker, minimal, podcast, comic, editorial, elegant, luxury, neon (motion only).
* **REWORK (replace in place, id kept)** — color-sweep, modern, pulse-highlight, soft-shadow.
* **MERGE** — folded into a survivor; stays in the array, byte-identical, flagged `replacedBy`, hidden from the picker:
  power-words → bold, creator-bold → bold, active-highlight → highlight, clean → classic, clean-white → classic,
  typewriter ("Wide Type") → mono.

Deviations from the P20.1 recommendation, and why:

* **Elegant is REFINED, not replaced**, and tiktok / karaoke / gaming / news / mrbeast keep every field the public
  website's style showcase renders (name, description, font, weight, colour, case, outline, highlight colour). The
  website is deployed from this repo; refining those presets must not change what it shows. Locked by a test.
* **Highlight is the merge survivor**, so it is KEEP rather than REFINE.
* **Editorial and Neon are REFINED** (placement / motion) rather than kept as-is — a centred serif and a fade-in glow
  were exactly the "same composition" problem.

## Export rendering fixes made for the families

Found with real FFmpeg frames while verifying the new styles; all three also affected the pre-existing library.

1. **Background box colour.** A caption background is an ASS BorderStyle-3 box, which libass draws in `OutlineColour`
   (its shadow in `BackColour`). The box colour was in `BackColour`, so News (red), Retro (orange) and Sticker (yellow)
   exported as a *black* box with a sliver of colour. Fixed in `buildStyleLine`.
2. **Glow.** ASS has no blurred shadow; Neon, Cinematic Glow, Gradient Glow, Soft Shadow and Cinematic exported a hard
   ghost copy of the text. Captions with a large centred shadow (`isGlowStyle`) now render a blurred Layer-0 underlay
   in the shadow colour under the crisp text; it follows the entrance/exit motion and fades with it.
3. **Font names.** Cached Google Fonts weights carry names like "Inter ExtraBold"; libass could not match the plain
   family the export asks for and fell back to **Arial** on any machine without that font installed (Archivo, Inter,
   Baloo 2, Poppins weights …; fonts the developer had installed hid it). `lib/fonts/font-name-normalize.ts` rewrites
   the cached face's family name; it runs on every cache hit, so existing caches and the offline seed are repaired.
4. **Preview fonts.** An unquoted `Baloo 2` made the whole CSS `font-family` invalid, so Comic/Cartoon rendered in
   Inter in the editor and the picker (export unaffected). Names are now quoted.

New fonts (all SIL OFL, bundled in the offline seed): Caveat, Kalam, Permanent Marker (Handwritten) and Bangers
(Display).

## Known limitations

* **Rounded backgrounds are preview-only.** An ASS box is square; `backgroundRadius` (Sticker, Sticker Pill, Podcast,
  Reels) renders rounded in the editor and square in the exported MP4. Boxes are drawn per line at the width of that
  line, so a two-line caption's box is stepped in the export and a single rectangle in the preview.
* **A scaled active word bulges a boxed caption in the export** (the box follows the tallest run). Boxed presets
  therefore use colour-only word treatments.
* **Glow is approximate** — a blurred copy of the glyphs, not CSS's exact gaussian; strength differs slightly.
* The preset-picker cards show position, alignment, container and the real word treatment, but are static: they do
  not play the entrance/exit (the motion is listed as text under the name).
