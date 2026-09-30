import { z } from "zod";

/**
 * Structural validation for a project's `globalStyle` PATCH payload — see
 * src/app/api/projects/[id]/route.ts's patchSchema, which used to accept `globalStyle` as a
 * bare `z.record(z.string(), z.unknown())` (any object, any shape at all). That let a malformed
 * PATCH replace the whole style object with something like `{ fontFamily, fontSize }` and have
 * it accepted as "valid" — reaching export with e.g. `color` genuinely `undefined` and crashing
 * lib/subtitles/ass.ts's assColorWithAlpha() (`hex.trim()` on undefined). Reproduced live during
 * the P3 installer-hardening phase's own QA.
 *
 * Every field is optional (a submitted globalStyle may legitimately omit fields — see
 * types/subtitle.ts's resolveGlobalStyle, which fills any gap from DEFAULT_SUBTITLE_STYLE, the
 * one canonical source of truth for what a missing field should become), but a field that IS
 * present must have the right type. A wrong-typed field (e.g. `color: 123`) fails this schema —
 * the route treats that as a fundamentally invalid payload and rejects it with a structured 400
 * rather than silently accepting garbage that would only surface as a crash later, at export
 * time, for a different request entirely.
 *
 * Colors are validated as `z.string()` only (not a strict hex pattern): assColorWithAlpha()
 * already tolerates a non-hex-matching string gracefully (falls back to white internally via its
 * own regex, no crash) — the actual crash-causing gap was the TYPE (undefined, not a wrong
 * format), so that's the only thing this schema tightens. Preserves every existing color format
 * the renderer already accepted.
 */
export const globalStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSource: z.enum(["bundled", "system"]).optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900)]).optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().optional(),
  textCase: z.enum(["none", "uppercase", "lowercase", "sentence"]).optional(),

  color: z.string().optional(),
  highlightColor: z.string().optional(),
  opacity: z.number().optional(),

  backgroundColor: z.string().optional(),
  backgroundOpacity: z.number().optional(),
  backgroundRadius: z.number().optional(),
  backgroundPaddingX: z.number().optional(),
  backgroundPaddingY: z.number().optional(),
  boxWidthPercent: z.number().optional(),

  outlineEnabled: z.boolean().optional(),
  outlineColor: z.string().optional(),
  outlineWidth: z.number().optional(),

  shadowEnabled: z.boolean().optional(),
  shadowColor: z.string().optional(),
  shadowBlur: z.number().optional(),
  shadowOffsetX: z.number().optional(),
  shadowOffsetY: z.number().optional(),
  shadowOpacity: z.number().optional(),

  x: z.number().optional(),
  y: z.number().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  vAlign: z.enum(["top", "center", "bottom"]).optional(),

  wordHighlight: z.boolean().optional(),
  activeWordScale: z.number().optional(),
});
