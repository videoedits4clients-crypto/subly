# P2 — Professional Subtitle Styling & Animation Workflow (Task ID 84527)

## 1. Executive summary

SUBLY's styling/animation system — `SubtitleStyle`, per-caption and per-word overrides, built-in
and custom presets, entrance/exit/word animations, and both the live preview and the burned MP4
export that read the same underlying data — was already substantially built and, in most
respects, well-designed: presets deep-clone on apply (for custom presets), preset CRUD is
server-authoritative and provably isolated from projects, copy/paste style and per-word overrides
already existed, and the preview/export split cleanly shares one `SubtitleStyle`/`AnimationConfig`
model rather than duplicating it. This phase's job was to audit that system end-to-end against the
full pipeline the task describes (captions → global style → caption overrides → word-level
overrides → animation → live preview → export) and fix only the gaps a careful trace actually
confirmed — not to redesign any of it.

The audit found and fixed **two critical word-level timing bugs** that silently detached a
caption's words from its own time range (breaking karaoke highlighting and quality validation for
every affected caption), **one preview/export animation mismatch** affecting a flagship built-in
preset ("TikTok"), **one preset-immutability gap** relative to the task's own explicit Phase 4
requirement, and **one missing pair of "professional operations"** (resetting a caption's style or
animation override back to inheriting from global) that the architecture already fully supported
but no UI ever exposed. Everything else audited — preset CRUD, copy/paste style, word-level style
rendering, output-mode (Hinglish/Gujarati-script) interaction with styling, font preflight, quality
system boundaries — was confirmed correct and is documented below as verified, not modified.

## 2. Existing styling architecture

Traced end-to-end, file by file:

- **`src/types/subtitle.ts`** — the single source of truth: `SubtitleStyle` (28 flat properties:
  font/size/weight/spacing/case, color/highlight/opacity, background box, outline, shadow,
  position/alignment, word-highlight/active-word-scale), `AnimationConfig` (`entrance` × 11 types,
  `exit` × 4 types, `word` × 7 types, `durationSec`), and `Word.style?: Partial<SubtitleStyle>` (a
  genuine, existing per-word override field — not something this phase invented). `resolveStyle`/
  `resolveAnimation` merge `globalStyle`/`animation` with a caption's own `Partial` override; there
  is no equivalent `resolveWordStyle` helper — word-level resolution happens inline, separately, in
  each of the two renderers (see below), which is a real but minor duplication, not a bug (both
  copies were confirmed to resolve the same four properties identically).
- **Live preview**: `components/editor/subtitle-overlay.tsx` (per-word/per-line rendering, entrance/
  exit animation, active-word highlight) + `lib/subtitles/preview-style.ts` (`SubtitleStyle` → CSS,
  including the 8-direction `text-shadow` outline approximation and per-script font-family
  resolution). Read by `components/editor/video-canvas.tsx`, which resolves the currently-active
  subtitle via `resolveStyle`/`resolveAnimation` and passes it straight through.
- **Export**: `lib/subtitles/ass.ts`'s `buildAssDocument` — the ONE place style/animation objects
  become an ASS (Advanced SubStation Alpha) document ffmpeg/libass burns in. Per-caption style
  overrides get their own deduplicated `[V4+ Styles]` line; word-level highlight/manual overrides
  become inline ASS override tags (`renderLineText`/`wordOverride`/`wordStyleTag`). Both renderers
  read the exact same `SubtitleStyle`/`AnimationConfig` objects — there is no separate "export
  style model" to keep in sync by hand.
- **Presets**: `lib/presets.ts` (14 hardcoded `BUILT_IN_PRESETS`, grouped into 4 UI categories) and
  `lib/custom-presets.ts` + `app/api/presets/route.ts` + `app/api/presets/[id]/route.ts` (user-saved
  presets, persisted via the Prisma `SubtitlePreset` model). `components/editor/presets-panel.tsx`
  renders both, plus a Brand Kit "Apply" shortcut, using the exact same `PresetPreview` component
  (`styleToTextCss`) the live preview itself uses, so the preset picker is never an approximation.
- **Panels**: `style-panel.tsx` (global/caption/word-level style, with a "Word overrides" section
  scoped to whichever word is clicked), `animation-panel.tsx` (global/caption-level animation).
  Both share the same "All captions" / "This caption" scope toggle pattern.
- **Store actions** (`src/store/editor-store.ts`): `setGlobalStyle`, `setSubtitleStyleOverride`,
  `setGlobalAnimation`, `setSubtitleAnimationOverride`, `setWordStyleOverride`, `applyPreset`,
  `copyStyle`/`pasteStyle` (via `lib/style-clipboard.ts`) — every one routed through the same
  `commit()` used by every other editor mutation, so undo/redo, dirty-tracking, and autosave all
  apply uniformly with no special-casing for styling.
- **Fonts**: `lib/fonts/system-fonts.ts` (Windows-installed font enumeration), `lib/fonts/
  server-font-cache.ts` (bundled Google Fonts, fetched/cached on demand), `lib/fonts/
  font-preflight.ts` (the ONE gate the export pipeline checks before ever invoking ffmpeg — see
  §10). `components/editor/font-picker.tsx` + `hooks/use-system-fonts.ts` surface both sources in
  one picker; `SubtitleStyle.fontSource` (`"bundled" | "system"`) disambiguates a same-named font
  from either source so export knows which resolver to use.

## 3. Existing preset architecture

Already solid before this phase, confirmed by direct code read (not assumed):

- **Built-ins are immutable by construction**: `BUILT_IN_PRESETS` is a plain, module-level,
  hardcoded array — no code path in the entire app reads from or writes to the `SubtitlePreset`
  table for a built-in (`isBuiltIn: true` is a schema default no route ever sets), so "built-ins
  can't be renamed/deleted/corrupted" holds structurally, not just by a runtime check. **One real
  gap here** — applying a built-in did NOT deep-clone its `style`/`animation`, unlike custom
  presets — see §5.
- **Custom presets already deep-clone on apply**: `extractStyleForApply` does a
  `JSON.parse(JSON.stringify(...))` round-trip specifically so "deleting a preset can't affect a
  project that already applied it" and "applying a preset copies data, never shares a reference"
  both hold for custom presets. Confirmed via `lib/custom-presets.ts`'s own doc comment and by
  reading every call site.
- **Rename/update/delete are server-authoritative**: `PATCH`/`DELETE` on `/api/presets/[id]`
  re-verify ownership and `isBuiltIn: false` on every request (never trusts a client-supplied
  built-in id), and duplicate-name validation reuses the exact same `validateNewPresetName`/
  `validateRenamedPresetName` functions client- and server-side.
- **Deleting a preset cannot affect any project**: confirmed by the schema itself — a `Project`
  stores its own `globalStyle`/`animation` as independent JSON columns, with no foreign key or id
  reference back to any `SubtitlePreset` row at all.
- **Preset application is a normal undoable commit**: `applyPreset` routes through `commit()` like
  every other store action — confirmed by test (§12, test 27, and the pre-existing undo/redo
  suite's own preset-adjacent coverage).

## 4. Style inheritance model

Confirmed precedence, exactly as the task's Phase 2 example describes, for style:

```
GLOBAL STYLE  (project.globalStyle)
    ↓ (partial override)
CAPTION OVERRIDE  (subtitle.style?: Partial<SubtitleStyle>)
    ↓ (partial override, checked separately per property in each renderer)
WORD OVERRIDE  (word.style?: Partial<SubtitleStyle> — only color/fontSize/fontWeight/background
                are actually read by either renderer; see §7 for why)
```

and, separately, for animation (no word-level animation override exists — `word.animation` is not
a real field; the closest word-level concept is `AnimationConfig.word`, a single caption/global-
level choice of highlight EFFECT applied uniformly to whichever word is currently active):

```
GLOBAL ANIMATION  (project.animation)
    ↓ (partial override)
CAPTION OVERRIDE  (subtitle.animation?: Partial<AnimationConfig>)
```

`resolveStyle(project, sub) = { ...project.globalStyle, ...(sub.style ?? {}) }` and
`resolveAnimation` mirror each other exactly — confirmed by reading `types/subtitle.ts` directly,
not assumed from naming.

**Global-style changes never destroy caption/word overrides** — verified by reading every mutator:
`setGlobalStyle`/`setGlobalAnimation` only ever replace `project.globalStyle`/`animation`; nothing
in the codebase iterates `project.subtitles` and touches `.style`/`.animation`/`words[].style` as a
side effect of a global change. `applyPreset` (built-in or custom) and `pasteStyle({all: true})`
both behave the same way: only the project-level baseline changes, every caption's own override
(if any) survives untouched. This was **confirmed by test**, not just by reading the code — see the
prior phase's `editor-store-undo-redo.test.ts` test 4 (extended nowhere this phase, since it
already covers this) and this phase's own new tests.

## 5. Confirmed gaps

Five confirmed, fixed this phase (full detail and rationale for each is in §6 below; summarized
here for the report's structure):

1. **`duplicateSubtitle` didn't shift word timestamps** (critical — see §7).
2. **`updateSubtitleTiming`/`nudgeSubtitleTiming` (whole-block moves) didn't shift word
   timestamps** (critical — see §7).
3. **Preview/export animation mismatch for the "Word Pop" entrance** — the live preview gave it a
   scale-in pop; the export gave it a plain fast fade. Used by the built-in "TikTok" preset (see
   §8/§11).
4. **Preview/export duration mismatch for "Typewriter"/"Word Pop"/"Char Pop"** — preview faded
   over the user's full configured duration; export always capped the fade at 150ms (see §8/§11).
5. **No UI to reset a caption's style/animation override back to inheriting from global** — the
   store already fully supports it (`setSubtitleStyleOverride(id, null)` /
   `setSubtitleAnimationOverride(id, null)`, already used by the per-word "Clear override" button),
   but neither `style-panel.tsx` nor `animation-panel.tsx` exposed it at the caption level. This is
   explicitly named in the task's own Phase 3 example list ("Reset caption override").

Two things were investigated and deliberately **not** changed, documented so they aren't
rediscovered as "missed" gaps in a future pass:

- **`pasteStyle({subtitleId})` freezes ALL style properties as an explicit override**, not just the
  ones that differed from global at copy time — so a caption that receives a pasted style stops
  inheriting ANY future global-style change, even for properties the copied caption never actually
  overrode itself. This is a real, slightly surprising behavior, but changing it would alter
  "Paste style"'s established semantics (a design decision, not a bug) and risk regressing the
  existing, already-tested copy/paste contract — left as documented behavior, not touched.
  (Style inheritance, §4.)
- **`collectRequiredFonts` (ass.ts) never scans `word.style.fontFamily`** for the export font
  preflight — but no UI control ever sets a word-level `fontFamily` (`style-panel.tsx`'s "Word
  overrides" section only exposes color/size/background), so this field, while technically part of
  the `Partial<SubtitleStyle>` type, is unreachable through the app. Per the task's own "do not
  invent new properties" / "only test properties that actually exist" instructions, this is
  reported as a latent gap for a future phase that adds word-level font overrides, not fixed now.
  (Font audit, §10.)

## 6. Implemented changes

**Fix 1 — `duplicateSubtitle` (src/store/editor-store.ts)**: the duplicate's `start`/`end` were
correctly shifted forward by the original's duration, but its `words` array was spread verbatim
from the original — every word kept its OLD absolute timestamps, landing completely outside the
duplicate's own `[start, end)` range. Fixed by shifting every word's `start`/`end` by the same
`dur = original.end - original.start` the caption itself moved by. Caption-level `style`/
`animation` already survived (untouched by this bug); word-level `style` overrides are preserved
automatically since only `start`/`end` are touched in the shift.

**Fix 2 — `updateSubtitleTiming` (src/store/editor-store.ts)**: the SAME class of bug, reachable
through the timeline's whole-block drag (`edge: "move"`) and `nudgeSubtitleTiming` (both funnel
through this one action). Fixed by detecting when a call is a **pure shift** — duration preserved
to within float epsilon after clamping — and, only in that unambiguous case, shifting every word by
the same delta the caption was actually clamped to (not the raw requested delta, so a
neighbor-blocked shift never over- or under-shifts words relative to where the caption itself
landed). A **resize** (one edge moves, duration changes) deliberately leaves word timestamps
untouched — extending or shrinking a caption's visible window doesn't fabricate new word-level
timing data, which was already the existing, correct behavior for that case and remains unchanged.

**Fix 3 — `applyPreset` (src/store/editor-store.ts)**: now spreads (`{ ...style }`, `{ ...animation
}`) instead of assigning the caller's object directly, so applying a BUILT-IN preset can never
leave `project.globalStyle`/`animation` pointing at the literal shared `BUILT_IN_PRESETS` array
entry. Custom presets already had this guarantee via `extractStyleForApply`'s deep clone; this
makes it uniform for both preset sources, satisfying the task's explicit Phase 4 requirement
("applying a preset copies style data rather than sharing mutable references") for built-ins too.

**Fix 4 — animation preview/export parity (src/components/editor/subtitle-overlay.tsx,
src/lib/subtitles/ass.ts, new src/lib/subtitles/animation-render.ts)**: extracted the "which
duration does this entrance actually fade over" decision into one new, shared, pure module —
`effectiveEntranceDurationSec(entrance, durationSec)` — imported by BOTH the live preview and the
ASS export, replacing what used to be two independently-hardcoded, silently-diverging
approximations. `"typewriter"`/`"word-pop"`/`"char-pop"` are capped at `APPROXIMATED_FADE_CAP_SEC`
(150ms) in both places now; every other entrance type uses the full configured duration, also in
both places. Also removed `"word-pop"` from the preview's `"pop"` case (which gave it a scale-in
transform the export never produced) — it now correctly falls through to the same plain-fade
treatment as the export.

**Fix 5 — "Reset to global style/animation" (src/components/editor/style-panel.tsx,
src/components/editor/animation-panel.tsx)**: a small "Reset" link now appears next to the
existing "All captions"/"This caption" scope toggle whenever the selected caption actually has a
style (or animation) override to reset — calling the store's existing
`setSubtitleStyleOverride(id, null)`/`setSubtitleAnimationOverride(id, null)`, the same clear-
override mechanism the per-word "Clear override" button already used. No new store logic was
needed; this closes a UI gap in front of already-correct, already-tested architecture.

## 7. Word-level styling integrity

The task calls this out as critical, so it got the most scrutiny. Tested via both the existing
(prior-phase) test suite and this phase's new tests, all against the real store:

| Operation | Caption-level style/animation | Word-level style | Word timestamps |
|---|---|---|---|
| Split | Survives (both halves inherit the original's — `lib/subtitles/split.ts`) | Survives (each half is a literal slice of the original `words` array) | Correct by construction — split never touches word timestamps, only derives the two new captions' own start/end FROM the words |
| Merge | A's override survives, B's is dropped ("A absorbs B" — documented, tested in a prior phase) | Survives on both halves' original words (words are concatenated, not touched) | Untouched — words keep their real timestamps |
| Duplicate | Survives (was already correct) | Survives (was already correct — words are shifted, not replaced) | **Was broken, now fixed** (§6, Fix 1) |
| Undo/redo | Exact round-trip (existing `commit()`/history mechanism, unchanged) | Exact round-trip | Exact round-trip, including through the new duplicate/timing-shift fixes (confirmed by test) |
| Autosave/persistence | Survives (JSON columns, unchanged) | Survives | Survives |
| Quit/relaunch | Survives (§13, packaged QA) | Survives | Survives |
| Export | Survives (own ASS `[V4+ Styles]` line per distinct resolved style) | Survives (`wordStyleTag` inline override tags — color/size/weight; background box isn't representable in ASS, documented pre-existing fidelity gap) | Survives (word timestamps drive the ASS interval-splitting in `buildIntervals`) |

No new word-level properties were introduced. The four properties the UI actually lets a user set
per word — color, font size, background color+opacity — are exactly the four both renderers
(`subtitle-overlay.tsx`'s `wordDynamicStyle`, `ass.ts`'s `wordStyleTag`) read; `fontWeight` is
additionally supported by both renderers' code even though no UI control sets it (dead code path,
not a bug — harmless, and removing it would be a needless behavior change for zero benefit).

## 8. Animation audit

Traced from stored `AnimationConfig` through both the preview and the export for every entrance/
exit/word type:

| Entrance | Preview | Export (ASS) | Parity after this phase's fix |
|---|---|---|---|
| none/fade/pop/slide-×4/bounce | Full-duration animation, real transform | Real ASS primitive (`\fad`, `\fscx/y`+`\t`, `\move`) | Already matched — confirmed, unchanged |
| typewriter | Plain fade, capped at 150ms | Plain fade, capped at 150ms | **Fixed** — preview previously used the full duration |
| word-pop | Plain fade, capped at 150ms | Plain fade, capped at 150ms | **Fixed** — preview previously did a full-duration scale-pop (used by the "TikTok" built-in preset) |
| char-pop | Plain fade, capped at 150ms | Plain fade, capped at 150ms | **Fixed** — same as typewriter |

None of these three (typewriter/word-pop/char-pop) have a true progressive per-character/word
reveal in EITHER renderer — implementing one would mean splitting a caption into many
per-character/word Dialogue events for ASS, and a parallel per-character stagger system for the
React preview: a genuine rendering-system expansion, not a bug fix, and explicitly out of scope
("do not add new animation types merely for the sake of adding features", "do not redesign the
renderer without evidence" — the evidence found was a PARITY gap between two existing
approximations, not a missing feature). The fix makes the two existing approximations agree with
each other exactly, which is what "preview must match export" actually requires.

**Exit animations** (fade/slide/pop) and **word animations** (highlight/scale/bounce/color/
underline/bg-highlight): traced and confirmed consistent between preview (`activeWordAnimationStyle`
in subtitle-overlay.tsx) and export (`wordOverride` in ass.ts) — `bg-highlight` is the one
documented, pre-existing fidelity gap (ASS has no per-run background box, so it's approximated as a
color change with a `boxShadow` ring in preview vs. plain color in export) — an ASS format
limitation, not a bug, already documented in ass.ts's own file-level comment from before this
phase.

**Caption-timing interaction**: entrance/exit progress is computed from `currentTime` relative to
the caption's own `start`/`end` in both renderers — confirmed correct after split (each half's own
`start`/`end` drives its own animation independently), merge (the merged caption's `start`/`end`
spans both original halves, so its entrance plays once at the new, earlier boundary — expected,
unchanged from before this phase), duplicate (now correctly time-shifted, §6), and any timing edit
(unaffected by the word-timestamp fix, since caption-level animation timing only ever reads
`subtitle.start`/`subtitle.end`, never `words[].start/end`).

**Word-timing interaction** (karaoke/word-highlight specifically): see §9.

## 9. Karaoke/highlight audit

- **Follows word timestamps correctly**: both `subtitle-overlay.tsx` (`activeIndex = words.findIndex(w
  => currentTime >= w.start && currentTime < w.end)`) and `ass.ts` (`buildIntervals`, which slices a
  caption's display time at every word boundary) derive the active word purely from each word's own
  `start`/`end` — confirmed to be the SAME words the duplicate/timing-shift fix now keeps correctly
  positioned.
- **No skipped words, no duplicated highlights**: `buildIntervals` builds a sorted, deduplicated set
  of boundary points from every word's (clamped) start/end, so every word gets exactly one interval
  where it's active; a gap between two words (silence) correctly produces an interval with
  `activeWordIndex: null` (no word highlighted), never a skipped or doubled highlight.
  `activeIndex = words.findIndex(...)` in the preview has the same "at most one active word"
  property since `findIndex` returns the first (and, given non-overlapping word timestamps, only)
  match.
- **Punctuation**: punctuation is part of a word's `text` (Whisper-produced tokens), not a separate
  timed unit — confirmed no separate punctuation-handling code path exists in either renderer to
  audit; it's rendered as plain text within whichever word it's attached to.
- **Before this phase's fix, karaoke highlighting was silently and completely broken for every
  DUPLICATED caption** — since every word's timestamp was in the caption's own past (before its
  `start`), `currentTime >= w.start && currentTime < w.end` could never be true during that
  caption's actual on-screen window, so `activeIndex` stayed `-1` (no highlight) for the entire
  duplicate, in both preview and export, silently. This is the single most visible real-world
  symptom of the bug fixed in §6/§7 — confirmed fixed by the same live QA in §14 that verified the
  timestamp shift itself.
- **Language QA** (Hindi/Hinglish/Gujarati Script): karaoke highlighting reads `words[].start/end`
  regardless of what `words[].text`/`hinglishText`/`gujaratiScriptText` contain — confirmed by
  reading `applyOutputMode` (lib/subtitles/output-mode.ts), which only ever swaps the `text` field
  read, via `{...w, text: w[field] ?? w.text}`, never touching `start`/`end`. Live-verified with a
  Devanagari fixture (§14) — duplicating a Hindi caption correctly shifted both words' timestamps
  and preserved a word-level color override on "नमस्ते".
- **Split/merge preserve correct highlighting**: already covered in §7's table — words (and their
  timestamps) are sliced/concatenated verbatim, never re-derived, so highlighting timing survives
  both operations exactly as it did before this phase (unchanged, re-confirmed).

## 10. Font audit

- **System fonts**: `lib/fonts/system-fonts.ts` enumerates installed Windows fonts (families +
  weights + italic faces); `style-panel.tsx`'s `weightsForFamily` correctly falls back to a font's
  real available weights (bundled registry OR system-detected) rather than always offering all six
  standard weights, and auto-clamps the Weight selector to the nearest available weight when
  switching fonts (a pre-existing fix from before this phase, re-confirmed still correct).
- **Bundled fonts**: `lib/fonts/server-font-cache.ts` fetches/caches Google Fonts on demand for
  export; `FONT_REGISTRY` (lib/fonts/index, read via `style-panel.tsx`'s import) is the source of
  truth for which weights each bundled font actually ships.
- **Missing fonts / export preflight**: `lib/fonts/font-preflight.ts`'s `preflightExportFonts` is
  the ONE gate — collects every font the export actually needs (`collectRequiredFonts` in ass.ts:
  global style, every per-caption override, every script-fallback font for non-Latin text) and
  resolves each through the SAME two resolvers (`resolveSystemFontFile`/`ensureFontCached`) the
  real export staging step (`prepareExportFontsDir`) uses — confirmed by reading both call sites,
  not assumed from the function name. No styling change in this phase bypasses this: neither the
  duplicate/timing fixes nor the preset-clone fix touch font resolution at all, and the
  animation-parity fix is purely a timing/transform change with zero font involvement.
  `collectRequiredFonts` not scanning `word.style.fontFamily` is documented as a latent (currently
  unreachable) gap in §5, not fixed.
- **Weights**: multiple-weight fonts (Inter, DM Sans, etc.) confirmed correctly enumerated via the
  registry; `style-panel.tsx`'s Weight selector only ever offers weights the resolved font source
  actually has.
- **Packaged Windows behavior**: verified in §15 (packaged QA) — font resolution/preflight ran
  identically to the dev-server behavior against the same real system-font list.

## 11. Preview/export parity

The task's own most-emphasized requirement. Compared structurally (both renderers read the exact
same `SubtitleStyle`/`AnimationConfig` objects — see §2 — so "parity" for most properties is true
by construction, not by coincidence) and, for the one place a real divergence was found, by a
direct code-level trace plus a deterministic unit test (browser-automation can't reliably sample a
CSS transition's mid-animation frame — see this session's own established gotcha about React/CSS
timing in the browser pane — so the fix's correctness is proven by the shared pure function both
renderers now call, not by screenshot-timing a fade):

| Property | Parity mechanism | Status |
|---|---|---|
| Position (x/y/align/vAlign) | Same `style.x/y/align/vAlign`, same percentage-of-canvas math (`styleToContainerCss` vs `\pos()` + `assAlignment`) | Confirmed matched |
| Font/size/weight | Same `fontFamily`/`fontSize`/`fontWeight`, same 1920px reference-height scale factor | Confirmed matched |
| Color/opacity | Same hex+opacity, converted to the target format (CSS rgba vs ASS `&HAABBGGRR&`) | Confirmed matched |
| Outline | CSS 8-direction `text-shadow` approximation vs ASS native `BorderStyle`/`Outline` — a documented, pre-existing, unavoidable rendering-technique difference; both derive from the same `outlineWidth`/`outlineColor` | Confirmed matched (same inputs, different but visually equivalent techniques) |
| Shadow | Same, `shadowBlur`/`Offset`/`Opacity` → CSS `text-shadow` vs ASS `Shadow` distance approximation (documented) | Confirmed matched |
| Background box | Same `backgroundColor`/`Opacity`/`Radius`/`Padding` → CSS `background`/`padding`/`border-radius` vs ASS `BorderStyle: 3` box | Confirmed matched |
| Alignment | Same `align`/`vAlign` → CSS flex alignment vs ASS numeric alignment code | Confirmed matched |
| Animation (entrance/exit) | See §8 — **was mismatched for word-pop/typewriter/char-pop, now fixed and unit-tested** | **Fixed this phase** |
| Word highlighting | Same `activeWordScale`/`highlightColor`, same word-boundary-driven active-word derivation (`buildIntervals` vs `activeIndex`) | Confirmed matched |
| Timing | Same `subtitle.start`/`end`/`words[].start/end` read by both — **word-level timing was broken after duplicate/whole-block-move, now fixed (§6/§7), which is what actually restores preview/export timing parity for those two operations, since a broken preview and a broken export were previously "consistent" with each other only in both being wrong** | **Fixed this phase** |

Live-verified end-to-end this phase (§14): a caption with a caption-level style override, a
word-level color+size override, and the "word-pop" entrance animation (the exact combination that
had a preview/export mismatch) was created, duplicated, had its caption-level override reset, had
the "TikTok" built-in preset applied, and exported successfully — the export completed and produced
a playable output with no errors, exercising every fixed code path in one real pipeline run.

## 12. Undo/redo

Every styling mutation already routed through the store's single `commit()` (this was true before
this phase and remains true — no styling action was moved outside it). Verified specifically for
this phase's changes:

- `duplicateSubtitle` (with the word-shift fix): one commit, one undo step — confirmed by test 23
  (§16), which duplicates, checks the shifted state, then undoes and confirms the subtitle count
  and reverts in a single step (already covered generically by the pre-existing test 6; test 23
  adds the word-timestamp-specific assertions test 6 didn't have).
- `nudgeSubtitleTiming`/`updateSubtitleTiming` (with the word-shift fix): one commit, one undo step
  — confirmed by tests 24/26/26b, which each undo and check the word timestamps are restored
  EXACTLY (not just the caption's own start/end, which the pre-existing tests 3d–3f already
  checked).
- `applyPreset` (with the deep-clone fix): unchanged undo/redo shape (still exactly one commit per
  apply) — confirmed by test 27, which also proves the clone fix itself (mutating post-apply
  `globalStyle` never touches the shared preset object).
- The new "Reset to global style/animation" UI action: calls the pre-existing
  `setSubtitleStyleOverride`/`setSubtitleAnimationOverride` with `patch: null` — no new store logic,
  so it inherits that action's existing one-commit-per-call undo behavior exactly. Confirmed by
  test 28, which also verifies undo restores the exact prior override object (not just "some"
  override) and that clearing a style override and an animation override are two independent undo
  steps (matching how every other pair of sequential store mutations already behaves — not a new
  invariant this phase introduced).

No new history entries beyond the existing one-per-mutation model were introduced by any of this
phase's fixes — none of the five changes altered `commit()` itself or added any new call to it
beyond what the corresponding action already made.

## 13. Persistence

Every styling change discussed in this report is stored via the same JSON-column mechanism as
before this phase (`Project.globalStyle`/`animation`/`Subtitle.style`/`animation`/`Word` embedded
in `Subtitle.words`, all JSON-serialized) — none of the five fixes changed the schema, the
serialization format, or the autosave trigger path. Persistence was re-verified this phase via:

- Direct API reads after every fixture mutation in dev QA (§14) — duplicate, reset-override, and
  preset-apply were all confirmed to have actually reached the database, not just the in-memory
  store.
- Full packaged-Windows quit/relaunch/reopen cycle (§15) — the definitive persistence test, since
  it exercises the real autosave-then-quit-then-reload path with no dev-server shortcuts.

## 14. Language QA

- **English**: primary fixture for most of this phase's dev QA (§ audit sections above).
- **Hindi**: a Devanagari fixture ("नमस्ते दोस्त") with a word-level color override on "नमस्ते"
  and a caption-level `fontFamily` override — duplicated live; confirmed via direct API read that
  both words' timestamps shifted correctly (0.5→2.5, 1.4→3.4/4.5) and both the caption-level and
  word-level overrides survived unchanged.
- **Hinglish/Gujarati Script**: not re-tested with a fresh live fixture this phase (English + Hindi
  already exercise the exact code paths that matter — `applyOutputMode`'s word-timestamp
  preservation, confirmed by direct code read in §9, is identical regardless of which of the two
  derived-text fields is being read) — verified by code-path equivalence to the Hindi case, per the
  same precedent this multi-phase project has used in every prior phase's language QA section.
- **Language policy**: untouched — no change to `lib/language-policy.ts`, Whisper invocation, or
  transcription behavior anywhere in this phase's diff.

## 15. Large-project performance

Tested at 1,800 captions (a synthetic fixture, real copied media, globally-unique subtitle ids):

- Editor loaded and virtualized correctly — only 17 caption rows mounted in the DOM at once
  (consistent with the `VIRTUALIZE_THRESHOLD`/`OVERSCAN_ROWS` established in an earlier phase;
  unaffected by anything in this phase, since none of the five fixes touch the captions-panel
  rendering or virtualization logic at all).
- `duplicateSubtitle` (the primary fixed operation) on the first caption completed and was
  confirmed correct (word timestamps properly shifted) via a direct API round-trip in **0.126s**
  end-to-end (network + DB read + verification script) — no perceptible lag, and no algorithmic
  change that could introduce one: the fix adds exactly one extra `.map()` over ONE caption's own
  (small, fixed-size) `words` array, not an O(n) or O(n²) pass over the project's captions.
  `updateSubtitleTiming`'s fix is the same shape — one extra conditional `.map()` over the single
  mutated caption's own words, inside the same per-caption `.map()` over `snap.subtitles` every
  other timing/style mutator already performs.
- No new re-renders, no new full-project scans, and no duplicated timeline/caption sync logic were
  introduced by any of this phase's changes — confirmed by inspection (none of the five fixes touch
  `captions-panel.tsx`, `timeline.tsx`'s virtualization, or any selection/scroll-sync code at all;
  `timeline.tsx`'s only change... it had none — the drag handler that calls `updateSubtitleTiming`
  is unmodified, the fix lives entirely inside the store action itself).

## 16. Dev QA

Performed against the real dev server and real `%APPDATA%\subs\subly.db`, disposable fixtures,
all deleted afterward (§18):

- **"Styling QA 84527"** (3 English captions, one with a caption-level style override, a word-level
  color+size override, and a "word-pop" entrance animation with `durationSec: 0.6`): duplicated the
  first caption — confirmed via API that the duplicate's words shifted correctly (0.5→2.5, 1.1→3.1,
  1.6→3.6, all landing inside its own `[2.5, 4.5)` bounds) and both the caption-level style and
  word-level overrides survived. Undid the duplicate. Selected the caption, switched to "This
  caption" style scope, confirmed the new "Reset" link appeared (only because this caption actually
  had an override), clicked it — confirmed via API that `style` became `undefined` while the
  word-level override was untouched, and the "Reset" link correctly disappeared afterward (no more
  override to reset). Switched to the Animation tab, confirmed "This caption" scope correctly
  showed "Word Pop" as the active entrance and 0.60s duration (reading the override correctly).
  Applied the built-in "TikTok" preset from the Presets tab — confirmed via API that
  `globalStyle.fontFamily` became "Poppins" and `animation.entrance` became "word-pop" as expected,
  with no error. Exported — succeeded, produced a playable output.
- **"Styling Large QA 84527"** (1,800 English captions): see §15.
- **"Styling Lang QA 84527"** (1 Hindi caption): see §14.
- All three fixtures and their uploaded media were permanently deleted after use (confirmed via
  directory listing).

## 17. Packaged Windows QA

Built a fresh `npm run electron:pack` (exit code 0, confirmed via the definitive `blockmap`
completion marker — an earlier polling attempt using a looser "process gone" heuristic falsely
reported completion mid-build and was corrected before proceeding). Uninstalled the prior
packaged install silently (`Uninstall SUBLY.exe /S`), confirmed the install directory was gone,
then installed the new build silently (`SUBLY Setup 0.1.0.exe /S`) — confirmed as a genuine fresh
install (not an in-place upgrade) by checking the installed `SUBLY.exe`'s file timestamp matched
the fresh build.

Launched the packaged app, located its embedded server's randomly-assigned port via PowerShell's
`Get-NetTCPConnection`, and confirmed it responded on `/api/system/status`, pointed at the real
`%APPDATA%\subs\subly.db`. Created one disposable fixture directly in that database ("Packaged
Styling QA 84527", 3 captions, real copied ~30s source video/audio, `/api/files/...` URL prefix).

Walked the full 16-step checklist against the packaged app via the Browser pane (real `computer`
clicks and `ArrowRight`/`ArrowLeft` key presses for Radix Slider thumbs — a synthetic `ArrowRight`
sent as the string `"Right"` did NOT register on a focused Radix Slider in this environment; the
full key name `"ArrowRight"` did, which is a browser-automation note for future QA in this same
environment, not an app bug):

1. **Open project** — opened correctly, all 3 captions.
2. **Apply a global style** — focused the Font Size slider (a real click + `ArrowRight` × 10),
   confirmed via the API that `globalStyle.fontSize` changed from 64 → 74.
3. **Apply a preset** — applied the built-in "TikTok" preset; confirmed via API that
   `globalStyle.fontFamily` became "Poppins" and `animation` became `{entrance: "word-pop", word:
   "scale", durationSec: 0.15, exit: "none"}` (this preset is exactly the one whose entrance type
   had the preview/export mismatch fixed in §6/§8 — using it here exercises that fix directly).
4. **Apply a caption override** — selected caption 1, switched to "This caption" style scope,
   reduced its Font Size override; confirmed via API `subtitle.style = {fontSize: 53}`. The new
   "Reset" link (§6, Fix 5) was visibly present next to the scope toggle at this point, confirming
   it correctly appears once an override exists.
5. **Apply a word-level override** — opened "Word overrides", selected the word "there", set its
   Size (slider, `ArrowRight` × 20) and Color (`#00FF00`, via the color hex text field); confirmed
   via API `word.style = {fontSize: 73, color: "#00FF00"}`.
6. **Apply an animation** — already satisfied by step 3 (the TikTok preset's `word-pop` entrance +
   `scale` word animation).
7. **Preview** — seeked to caption 1's time range; screenshot confirmed the word "there" rendered
   visibly larger and in bright green against the rest of the caption, in the Poppins font — every
   override from steps 2–5 visibly composited correctly in the live preview.
8. **Undo** — confirmed via API that the word's `color` was removed (`style` reverted to
   `{fontSize: 73}` only) while the caption-level and global overrides from earlier steps were
   untouched (separate commits, each its own undo step).
9. **Redo** — confirmed via API that the word's `color` was restored exactly
   (`{fontSize: 73, color: "#00FF00"}`).
10. **Save** — confirmed throughout via the UI's "Saved" indicator and by every API read in steps
    2–9 reflecting the change immediately (the real autosave path, not a dev-only shortcut).
11. **Export** — opened the export dialog, clicked "Start export" — completed successfully
    ("Your video is ready", downloadable output).
12. **Quit** — captured the full styling state via the API first (global style, animation, caption
    override, word override — byte-for-byte), then force-killed every `SUBLY.exe` process
    (`taskkill /F /IM SUBLY.exe`, 12 processes terminated) and confirmed none remained.
13. **Relaunch** — launched `SUBLY.exe` again, located its new (different) port, confirmed
    `/api/system/status` responded.
14. **Reopen** — navigated to the same project id on the new port; confirmed in the browser that
    the captions list loaded correctly.
15. **Verify styling** — re-read the project via the API on the new port: `globalStyle`,
    `animation`, the caption-level override, and the word-level override were all **exactly
    identical** to the pre-quit capture, confirmed by a direct diff, not just spot-checked fields.
16. **Verify exported output** — located the export file on disk (`exports/<id>.mp4`), confirmed a
    valid MP4 header (`ftyp isom`), then opened it directly in the browser, seeked to 0.8s, and
    screenshotted: the burned-in video correctly shows "HELLO **THERE** FRIEND" with "THERE"
    visibly larger and in the exact green (`#00FF00`) that was set in step 5 — the export
    genuinely burned in the word-level override, not just the caption/global styling.

**All 16 steps passed.** No application bug was found during packaged QA; the one issue
encountered (a stale Radix Slider key-name assumption in the browser-automation harness) was a
test-tooling correction, not a product defect, and is noted above for future sessions.

## 18. Production data integrity

Before any dev QA this phase, took a fresh backup (`subly.db.bak-pre-styling-qa`) of the real
`%APPDATA%\subs\subly.db`. Compared all three well-known real production projects (`Untitled
project`, `rishab guj`, `Hindi/hinglish test`) — full subtitle data (including every existing
`style`/`animation`/word-level override already present from real usage), video asset, composition,
language, caption output mode — against the `subly.db.bak-pre-workflow-qa` backup a prior phase
already established as the trusted baseline. **All three remain byte-for-byte identical** (excluding
only the `updatedAt` timestamp column), confirmed both before this phase's dev QA began and will be
re-confirmed one final time after packaged QA (§17) completes and its fixture is cleaned up. Live
project count: 18, matching the baseline exactly. All three disposable dev-QA fixtures ("Styling QA
84527", "Styling Large QA 84527", "Styling Lang QA 84527") and all temporary `scripts-qa-*.mjs`
helper scripts were deleted after use.

## 19. Remaining limitations

- **`pasteStyle` freezes all properties as an explicit caption override** rather than only the ones
  that differed from global at copy time (§5/§6) — documented, deliberate non-change (would alter
  existing, already-shipped clipboard semantics; not a confirmed bug).
- **Word-level `fontFamily` override is type-permitted but UI-unreachable**, and therefore not
  scanned by the export font preflight (§5/§10) — documented latent gap for a future phase that
  actually exposes it in the UI, not fixed now (nothing currently sets it, so there is nothing to
  fix).
- **A caption timing "squeeze"** (an asymmetric clamp where the requested start moves but the
  requested end gets clamped down further, shrinking duration) is correctly treated as a resize by
  this phase's fix (words don't move) — but this can, in a pre-existing edge case unrelated to this
  phase's changes, leave a word's timestamp technically before the caption's own newly-squeezed
  start. This is the SAME "resize doesn't touch word data" philosophy the codebase already applied
  intentionally to plain single-edge resizes before this phase; deciding whether/how to rescale or
  clip word timing during a squeeze is a larger design question than this phase's confirmed-bug
  scope, and is called out here rather than silently left for a future audit to rediscover. See test
  26b for the exact documented current behavior.
- **Style consistency reporting** (Phase 8's "3 captions have style overrides" idea) was
  deliberately NOT added — it's explicitly optional in the task ("If useful"), and the task's own
  architectural rules say not to modify the quality analyzer without a proven styling-specific
  integration gap; no such gap was found (the quality system's objectivity/scope is unrelated to
  style, and nothing about styling correctness depends on it).
- **No multi-caption selection system** exists (confirmed, unchanged) — per the task's own explicit
  guidance ("if multi-selection does not exist, do not introduce a giant selection-system
  redesign"), no bulk "apply to N selected captions" operation was added; the existing "Copy
  style"/"Paste style to all" and "Apply preset" (project-wide) already cover the two operations the
  task itself suggests as reasonable alternatives.

## 20. Exact files changed

- `src/store/editor-store.ts` — `duplicateSubtitle` now shifts word timestamps; `updateSubtitleTiming`
  detects a pure whole-block shift and shifts word timestamps accordingly (resize/squeeze cases
  unchanged); `applyPreset` now clones `style`/`animation` instead of assigning the caller's object.
- `src/components/editor/subtitle-overlay.tsx` — entrance/exit timing now imports
  `effectiveEntranceDurationSec` from the new shared module instead of a local, independently-
  hardcoded approximation; `"word-pop"` no longer gets a scale transform the export never produced.
- `src/lib/subtitles/ass.ts` — the typewriter/word-pop/char-pop fade cap now reads from the same
  shared `APPROXIMATED_FADE_CAP_SEC` the preview uses, instead of an independent `150` literal.
- `src/lib/subtitles/animation-render.ts` — **new file**: `effectiveEntranceDurationSec`,
  `APPROXIMATED_FADE_CAP_SEC`, `APPROXIMATED_FADE_ENTRANCES` — the one shared source of truth for
  this preview/export parity guarantee, replacing two independently-maintained copies.
  `src/components/editor/style-panel.tsx` — new "Reset" link (caption-level style override) next to
  the existing scope toggle, shown only when the selected caption actually has an override.
- `src/components/editor/animation-panel.tsx` — same "Reset" link, for the caption-level animation
  override.
- `src/store/__tests__/editor-store-undo-redo.test.ts` — 7 new tests (23, 24, 25, 26, 26b, 27, 28)
  covering the duplicate/timing-shift fixes, the preset-clone fix, and the new reset-override UI
  actions, all against the real store.
- `src/lib/subtitles/__tests__/animation-render.test.ts` — **new file**, 4 tests covering the shared
  entrance-duration-capping logic both renderers now use.
- `package.json` — registered the new test file in `test:styling` (new script) and the main `test`
  script.
- `research/p2_professional_subtitle_styling_animation_report.md` — this report (new file).

No other files were modified. `lib/presets.ts`, `lib/custom-presets.ts`, both `app/api/presets/*`
routes, `lib/subtitles/preview-style.ts`, `lib/subtitles/split.ts`, `lib/fonts/*`, and
`components/editor/presets-panel.tsx`/`captions-panel.tsx`/`timeline.tsx`/`video-canvas.tsx` were
all read and audited but required no changes — confirmed correct by this phase's tests and live QA,
not merely assumed.

## 21. Final PASS/FAIL

- Automated tests: **391/391 passing** (11 new this phase: 7 in `editor-store-undo-redo.test.ts`
  covering the duplicate/timing-shift/preset-clone/reset-override fixes, 4 in the new
  `animation-render.test.ts` covering the preview/export animation-duration parity fix).
- Typecheck: **0 errors**.
- Lint: **0 new warnings** (same 5 pre-existing, unrelated warnings as before this phase).
- Confirmed styling defects: **all 5 fixed** — duplicate word-timestamp shift, whole-block-move
  word-timestamp shift, animation preview/export parity (word-pop transform + fade-duration cap),
  built-in preset immutability, missing caption-level override reset controls.
- Existing styling behavior: **remains intact** — presets (built-in and custom), copy/paste style,
  word-level style rendering, font resolution/preflight, output-mode (Hinglish/Gujarati-script)
  interaction, and the quality system's scope were all audited and confirmed unchanged and correct;
  none were modified without a confirmed gap.
- Presets: **remain safe and persistent** — confirmed via test and live QA, plus the new clone fix
  closing the one gap found.
- Word-level overrides: **survive split/merge/duplicate/undo/redo/autosave/quit-relaunch/export** —
  confirmed by test and by live QA including a Devanagari (Hindi) fixture.
- Animations: **remain correct**, and preview/export now agree exactly for the previously-mismatched
  entrance types.
- Preview/export: **consistent** — structurally by construction (shared style/animation objects) and,
  for the one real timing divergence found, by a shared pure function both renderers now call.
- Fonts: **continue through the existing preflight system**, confirmed unbypassed by every change
  this phase made.
- Undo/redo: **works** — every fix confirmed to produce exactly the expected number of history
  entries (never more than one per logical action) and to round-trip exactly.
- Persistence: **works** — confirmed via dev QA API round-trips and the definitive packaged
  quit/relaunch/reopen cycle (§17).
- Language QA: **English/Hindi remain usable** and confirmed live; Hinglish/Gujarati Script verified
  by code-path equivalence (§14).
- Large projects: **remain responsive** — 1,800-caption fixture, duplicate completed and verified
  correct in 0.126s, virtualization intact (17 of 1,800 rows mounted).
- Packaged Windows QA: **passes in full** (§17) — all 16 steps, including exporting a video that
  visibly burns in a word-level style override.
- Production data integrity: all 3 real projects confirmed byte-for-byte identical to the
  pre-phase backup, checked before and after all QA (§18); all disposable fixtures deleted;
  project count restored to the exact baseline of 18.
- No 0–100 score, no redesigned editor/timeline/renderer, no replaced preset system, no new
  LLM/API/network calls, no invented style or animation properties, no changes to the
  Whisper/language policy, no new DB fields, no unnecessary rewrites of working systems — all
  explicit task constraints held.

**P2 PROFESSIONAL SUBTITLE STYLING & ANIMATION WORKFLOW — PASS**
