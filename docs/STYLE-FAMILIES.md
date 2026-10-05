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
  youtube, mono, cinematic-glow, sticker, candy-pop, outline, shadow-pop, gradient-glow, retro, arcade.
* **REFINE** — same identity, changed composition/motion/size: bold, tiktok, punch, gaming, jump-pop, word-burst,
  karaoke, marker, minimal, podcast, comic, editorial, elegant, luxury, neon (motion only); and, after the P20.3
  visual audit, cinematic (fades out), cartoon (size), news (size).
* **REWORK (replace in place, id kept)** — color-sweep, modern, pulse-highlight, soft-shadow, vhs (P20.3: the cyan/pink
  outline merged into one pink smear; now clean cyan letters with a hard magenta fringe).
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

* **Rounded backgrounds** (P20.4): in geometry mode the export draws a caption's background as one rounded shape, like the
  preview. Only the legacy renderer (used when a font's metrics are unavailable) still draws ASS's per-line square box.
* **A scaled active word no longer bulges a boxed caption** (P20.4/P21): the box comes from the layout, not from the
  tallest run, so boxed presets may use scale word treatments too.
* **Glow is approximate** — a blurred copy of the glyphs, not CSS's exact gaussian; strength differs slightly.
* The preset-picker cards show position, alignment, container and the real word treatment, but are static: they do
  not play the entrance/exit (the motion is listed as text under the name).

## P20.3 visual-quality pass

All 49 visible presets were rendered in the real app (exported MP4) and graded A (strong) / B (good, could be
refined) / C (too similar) / D (visually weak) / E (technically problematic) before anything was changed.

**Changed, and why**

| Style(s) | Problem found | Change |
|---|---|---|
| Sentence-case styles (Minimal, Minimal Left, Classic, Elegant, Editorial, Cinematic, Cinematic Glow, Soft Shadow, Podcast, Marker Notes) | `sentence` case was applied per word, so every caption rendered in Title Case ("Every Great Story Begins …") in the preview, picker and export (E) | `applyWordTextCase`: only the caption's first visible word is capitalised |
| Film Title, Minimal, Minimal Left | thin outline-free text on a *hard* ghost shadow (blur below the glow threshold): doubled, dirty edges in the export (E/D) | soft glow shadows (blur ≥ 18); guard test added |
| Film Title, Minimal Left, Magazine, Luxury, Documentary, News, Cartoon, Karaoke, TikTok, Jump Pop, Editorial, Comic, Soft Shadow, Minimal | too small to read comfortably (D) | sizes raised; legibility floor (≥ 40px) enforced by a test |
| VHS | cyan text inside a thick pink outline merged into one pink smear (E) | unoutlined cyan letters + hard magenta offset fringe |
| Soft Shadow | near-duplicate of Minimal (C) | big, bold, rises in, fades out — a distinct "readable on busy footage" role |
| Minimal / Cinematic | two quiet bottom-centre styles (C) | Minimal sits a little higher and just appears; Cinematic fades in *and* out |
| Handwritten flagship | its name equalled its family name | renamed "Pen Script" (id unchanged) |
| Devanagari / Gujarati words in single-weight display faces (Anton, Bangers, Permanent Marker, Archivo Black, Bebas Neue) | the Noto fallback rendered at weight 400 — hairline next to heavy Latin capitals | fallback words are bolded in preview and export |

**Left unchanged on purpose:** the highlight chip on Highlight/Marker is tall by design (it mirrors the preview CSS);
Elegant stays close to Mono/Minimal because its font, colour and outline are locked by the website showcase.

**Similarity audit (genuinely similar, flagged for a future merge)**: Mono ~ Elegant, Punch ~ Word Burst,
Editorial ~ Luxury ~ Magazine (all gold/serif tracked caps), Retro ~ News (small solid bar). All flagship pairs differ
in ≥ 4 of 14 dimensions.

## Preview vs export text size (P20.4 — fixed)

P20.3 found that the same caption rendered **larger in the editor preview than in the exported MP4**, by a font-dependent
factor. P20.4 proved the cause, fixed it with one font-aware model shared by both renderers, and validated the result
against real exported MP4s.

### Root cause (confirmed against the font tables and real libass renders)

* The preview's `fontSize` is a CSS **em**. libass reads an ASS `Fontsize` as the font's **Windows cell height**
  (`winAscent + winDescent`), so it draws an em of `Fontsize × unitsPerEm ÷ (winAscent + winDescent)`.
  Every measured preview÷export ratio equals `(winAscent + winDescent) ÷ unitsPerEm` of that font to two decimals.
* libass also spaces lines by the whole cell (ignoring `lineHeight`) and never wraps (`WrapStyle: 2`), while the
  browser wraps at the box width and spaces lines by `lineHeight × em`.

### The model

* `lib/fonts/font-metrics.ts` — pure parser/maths: reads `head`, `hhea`, `OS/2`, `hmtx`, `cmap` from the same font file
  the export hands to libass; `assCellRatio`, `emToAssFontSize`, `cssContentMetrics`, `textAdvance`. No per-font numbers.
* `lib/subtitles/caption-layout.ts` — pure browser-equivalent layout (wrap, line boxes, alignment, block anchoring) from
  those metrics. The preview renders exactly its line breaks; the export emits one positioned event per visual line, so
  libass can never re-wrap or re-space them.
* `lib/subtitles/ass.ts` "geometry mode" (when a `fontMetrics` provider is supplied, which the export pipeline does):
  `Fontsize = em × cellRatio`, `an{1,2,3}pos` at layout baselines, the caption background drawn as **one rounded
  vector shape** (like the preview) instead of libass's per-line box, active-word chips and glow underlays taken from the
  layout. Without a provider the legacy single-event rendering is unchanged.
* Metrics are served to the preview by `/api/fonts/metrics` and cached once per font client-side
  (`client-font-metrics.ts`); the server parses each font file once per process. Nothing is parsed per frame and the
  preview writes nothing to the store. If a font's metrics are unavailable the preview falls back to the browser's own
  wrapping and the export to the legacy path.

### Result — preview ÷ export text width (same caption, fontSize 64)

| Font | Before | After |
|---|---|---|
| Inter 800 | 1.42 | 1.001 |
| Poppins 800 | 1.76 | 1.007 |
| Anton | 1.74 | 1.007 |
| Oswald 600 | 1.70 | 1.007 |
| Archivo 900 | 1.50 | 1.000 |
| Roboto 700 | 1.20 | 1.006 |
| DM Sans 700 | 1.32 | 1.000 |
| Baloo 2 800 | 1.57 | 1.006 |
| Playfair 700 | 1.40 | 0.997 |
| Montserrat 800 | 1.55 | 0.998 |
| Bebas Neue | 1.30 | 1.008 |
| Caveat 700 | 1.26 | 0.984 |

### Geometry validation (preview ink box from the editor DOM vs ink box measured in the exported MP4)

60 fixtures (12 fonts; 1–3 lines, long wrapping text, narrow/wide boxes, left/right/top/bottom/custom position, font size
40/110, mixed per-word size and spacing, letter spacing, line height 1.5, padding):

| | Cases within 5% (W and H) | Mean |ΔW| | Mean |ΔH| | Worst ΔW |
|---|---|---|---|---|
| Before (legacy renderer), 720×1280 | 0 / 60 | 33.5% | 32.4% | +136% (narrow box, wrapping) |
| After, 720×1280 | 60 / 60 | 0.7% | 0.7% | +2.6% |
| After, 1080×1920 | 60 / 60 | 0.7% | 0.5% | +2.7% |

Edges (left/right/top/bottom) agree within 0.9% of the canvas in every case.

Real presets (all 49 visible styles, both resolutions; text-only geometry, background boxes and active-word chips
measured separately): text 48/49 within 5%, boxes 8/8, chips 2/2 (worst chip: −2.1% H). The one exception is Punch
(−10.5% W) *when exported together with Archivo 900 in the same project* — see limitations.

### P20.3 enlarged styles re-evaluated

P20.3 raised the sizes of Film Title, Minimal Left, Magazine, Luxury, Documentary, News, Cartoon, Karaoke, TikTok, Jump
Pop, Editorial, Comic, Soft Shadow and Minimal because their *exported* captions looked small. With the export now
matching the preview those captions render at the size the presets say. All 14 were re-rendered in the real exporter on a
long caption: none overflows or clips, every one stays legible and clearly distinct, and the 40px legibility floor still
holds, so no preset values were changed.

### Remaining limitations

* **Archivo vs Archivo Black.** The Archivo 900 instance's full name (nameID 4) is also "Archivo Black". If one project
  uses both fonts, libass may resolve "Archivo Black" to the Archivo 900 file (visibly narrower glyphs). Exported alone,
  Punch matches the preview (+1.7% W / −0.7% H). A font-identity issue, not a size-model one.
* Glyph widths are summed advances; the browser also applies kerning, so widths agree to ~1–2% (kerning), not exactly.
* Outline, shadow and glow thickness are scaled with the same factor as before (not remeasured pixel-for-pixel); the
  glow remains an approximation of CSS's blur.

## Animation QA (P21)

QA of the existing animation system — no new animation types. Inventory (the real current ids):

| Group | Values |
|---|---|
| Entrance | none, fade, pop, slide-up, slide-down, slide-left, slide-right, bounce, typewriter ("Word Fade"), word-pop, char-pop — the last three are all the same capped (≤0.15 s) fade in both renderers |
| Exit | none, fade, slide-up, slide-down, slide-left, slide-right, pop (legacy "slide" = slide-up) |
| Word | none, highlight, color, scale, bounce, underline, bg-highlight |
| Controls | Animation panel: entrance, exit, word, duration (0.1/0.2/0.3/0.5/1 s); all captions or this/selected captions |

Entrance and exit are pure functions of time (`entrance-animation.ts`, `exit-animation.ts`) read by both the preview and
the ASS export, so seeking, replay and repeated captions cannot accumulate state. The preview animates only while
playing (a paused caption shows its settled state — by design).

**Defects found and fixed**

1. *Scaling animations on multi-line captions (export).* Since P20.4 each line is its own ASS event, and libass scales an
   event about its own anchor: a 2-line pop/bounce/pop-exit did not scale its line pitch and a corner-anchored caption
   drifted toward its anchor (up to 4.6% of the frame height). Every anchor is now moved by (scale − 1) × (anchor − block
   centre), the preview's transform-origin, and a scaling entrance runs one event per piecewise-linear scale segment.
2. *Scaled active word re-flowed its neighbours (export).* libass lays a line out as one run, so scaling one word moved
   the others (~20 px at 720p) and re-centred the line; the preview scales in place. A line holding a scaled active word
   is now emitted per word at layout positions, the active word scaling about its own inline-box centre.
3. *Previous caption leaked into the next (preview).* Word spans are keyed by index and carry a CSS transition, so a new
   caption reused the old DOM and animated the previous caption's last highlighted word into its first frames. The overlay
   is now keyed by caption id.

**Results** (real Electron app, real MP4 exports at 720×1280 and 1080×1920):

* Every entrance, exit, entrance+exit combination, custom position, size, box, font and 24 real presets (2 per family):
  64/64 cases at each resolution within tolerance — worst case, export vs the shared model: scale 0.06, centre 0.3% of
  frame height (corner-anchored captions), opacity 0.14; export vs the live preview (±12 ms clock alignment): scale 0.06,
  centre 0.3%, opacity 0.15.
* Word animations (scale, bounce, color, underline, bg-highlight, highlight) on 2-line captions with different active
  words per line, with entrance/exit, box, outline+glow, 3 fonts and 24 real preset typefaces: every comparison within
  1.2% of the canvas (worst 0.9%; one tracked-caps line 1.4% from kerning, inside 5% of its width).
* Playback in the real window: per-frame preview opacity/scale match the model to 0.01; pause/resume, seek mid-caption,
  seek back (entrance replays), rapid caption changes, project start/end all correct. 75 Hz playback, p95 frame 13.7 ms,
  no frame over 33 ms, no long tasks, no extra network requests.

**Remaining limitations**

* The preview skips entrance/exit while paused or scrubbing (by design); the active-word highlight still shows.
* Word-level bounce is a two-stage ramp in the export but its position offset is linear (≤ ~1% of frame height for
  ~70 ms); typewriter / word-pop / char-pop remain approximated fades.
* A scaled active word eases in over ~0.12 s in the export even for a caption's first word, where the preview (fresh DOM)
  shows it immediately.
* The legacy renderer (font metrics unavailable) still scales about each event's anchor.
* Opacity of real MP4s is estimated from backdrop-difference energy; peak-based estimates are biased by the H.264 encode.

## Caption templates (P22)

The **Templates** tab (right panel, between Animation and Presets) offers 16 curated, complete caption treatments —
typography, container, position, emphasis and motion — that apply to the selected captions or the whole project in one
click and undo in one step. A template is **not** a new kind of style:

```
resolveTemplate(t) = { style:     { ...preset(t.base).style,     ...t.style },      // an ordinary SubtitleStyle
                       animation: { ...preset(t.base).animation, ...t.animation } } // an ordinary AnimationConfig
```

`t.base` is one of the 49 visible built-in presets (typography, position, container); `t.style` may override only the
emphasis fields (`wordHighlight`, `highlightColor`, `activeWordScale`); `t.animation` is the template's complete motion
recipe (entrance, exit, word treatment, duration). Because it resolves to plain style + animation, the live preview, the ASS
export, the Style / Animation panels, autosave and undo all treat the result like hand-tuned settings — there is no
template renderer, and the typography (P20.4) and animation (P21) pipelines are unchanged. Code: `src/lib/caption-templates.ts`
(pure), store action `applyTemplate`, UI `src/components/editor/templates-panel.tsx`.

**Built-in only.** Templates are code, so nothing about them is persisted; only their *effect* (ordinary per-caption /
project style and animation) is stored in the project like any other style change, and so survives refresh, reopen and
restart. User-saved styles keep their own mechanism (Presets tab → My Styles). The dashboard's "Templates" page (starter
projects with an aspect ratio) is a separate, older feature.

**Families.** A template's family is its base preset's family, from the existing 12-family taxonomy; the filter chips are
those families that have a template (11 of 12 — Neon has none). "Social" content maps to the Sticker family, "News" to
Documentary.

| Template | Family | Base | Motion | Why it exists |
|---|---|---|---|---|
| Creator Punch | Bold Creator | `mrbeast` | bounce in · bounce | The loud, high-energy short-form look. Lower-third placement and a bouncing entrance; the one to pick for hype and commentary. |
| Creator Bold | Bold Creator | `bold` | pop in · scale | Hook lines and statements that should own the screen. Centre-frame rather than lower-third, with a pop-in and a scale emphasis. |
| Karaoke Focus | Karaoke | `word-focus` | fade in · color | Readable long captions where the viewer's eye should follow along without anything moving. Colour-only emphasis, a soft fade between captions. |
| Karaoke Pop | Karaoke | `highlight` | pop in · bg-highlight | Sing-along and tutorial captions where the active word needs a strong, boxed marker. The chip (not colour or scale) is its signature. |
| Podcast Clean | Podcast | `podcast` | slide-up in · fade out · color | Long-form talking-head video: highly readable, left-aligned like a broadcast lower third, sliding up and fading out so it never distracts. |
| Podcast Highlight | Podcast | `youtube` | fade in · fade out · bg-highlight | Clips lifted from podcasts for social: centred and bar-backed like a video caption, with the spoken word boxed so it reads at phone size. |
| Cinematic Title | Cinematic | `film-title` | slide-up in · fade out | Trailers, teasers and title cards: spaced capitals that rise slowly (0.6 s) and fade out. A statement, not a transcript. |
| Cinematic Minimal | Cinematic | `cinematic` | fade in · fade out | Film-style dialogue subtitles: understated serif type with a quiet fade, for footage that should stay in front. |
| Social Pop | Sticker | `sticker` | pop in | Friendly, lifestyle and explainer posts: a solid sticker behind the text keeps it legible on any footage. No word emphasis — the chip is the style. |
| Social Bounce | Sticker | `candy-pop` | bounce in · scale | Playful, youthful content without a box: outlined candy colours and a bouncing entrance plus a scale on the spoken word. |
| Editorial Serif | Editorial | `editorial` | fade in · fade out | Essays, interviews and brand films: serif type placed like a magazine caption, fading gently in and out. |
| News Bar | Documentary | `news` | slide-left in | News, updates and announcements: a broadcast-style solid bar across the lower frame that reads as 'information'. |
| Meme Impact | Meme | `meme-impact` | pop in | Classic top-text memes and reaction clips: the biggest type in the library, hard-edged, popping in instantly. |
| Comic Burst | Comic | `comic` | word-pop in · scale | Cartoon-style comedy and kids' content: comic-book lettering placed high in the frame with a springy word-by-word burst — the playful alternative to the meme caption. |
| Handwritten Marker | Handwritten | `handwritten-marker` | slide-right in · fade out · bounce | Notes, doodle-style explainers and personal vlogs: organic, off-centre lettering that feels drawn rather than typeset. |
| Minimal Clean | Minimal | `minimal` | static | When the footage is the star: the quietest template — small, still, no emphasis, no motion beyond appearing. |

**Distinctness.** Every pair of templates differs in at least 5 of the 14 perceptual dimensions of `lib/preset-audit.ts`
(font, weight, size, case, colour, outline, shadow, background, position, spacing, entrance, exit, word, highlight — colours
and sizes are bucketed, so "58 px vs 60 px" or a slightly different colour never counts); no two share a base preset. The
test suite enforces ≥ 4 for every pair and ≥ 5 within a family.

**Apply semantics**

* *This caption / N selected* — each chosen caption receives the template's complete style and animation as its own override.
  Other captions and the project defaults are untouched.
* *All captions* — the project style and animation become the template and every caption's own style/animation override is
  cleared, so afterwards every caption really looks like the template (a caption with a custom position or font loses it —
  Undo brings it back). "Reset changes" in the Presets tab then refers to the template.
* Only style and animation change. Caption text, timing, word timestamps, order, ids, per-word manual styling (colour, size…)
  and every other project setting are preserved (tests assert object identity for the word arrays).
* One application = one undo step, whatever the number of captions; re-applying what is already applied changes nothing and
  adds no history entry. The active template is recognised by comparing the target caption's effective style + animation, so
  the "applied" ring disappears as soon as you tweak anything.

**Picker previews.** Cards reuse the Presets tab's real-CSS preview (the same CSS as the live preview: font, case, outline,
glow, container, position, active-word treatment). They are still images — the picker says so — and the motion is listed in
words under each name; it plays in the editor preview as soon as the template is applied.

**Known limitations**

* Applying to selected captions writes the full style as a per-caption override, so later edits in the Style tab's
  "All captions" scope do not affect those captions (use "This caption" or re-apply).
* Templates reuse existing presets, so they inherit those presets' limitations (e.g. the Archivo / Archivo Black font-name
  collision when both are used in one export; typewriter / word-pop / char-pop are approximated fades).
* There are no user-defined templates; a custom look is saved as a preset instead.
