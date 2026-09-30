import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { parsePresetRows, validateNewPresetName } from "@/lib/custom-presets";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_ANIMATION } from "@/types/subtitle";
import type { SubtitleStyle, AnimationConfig } from "@/types/subtitle";

/** Custom (user-created) caption presets — persisted via the SubtitlePreset Prisma model,
 * which already existed in the schema (and the real database) unused before this feature.
 * Built-in presets (src/lib/presets.ts) are never read from or written to this table — they
 * stay a separate, hardcoded, immutable array. Every row this route ever creates has
 * isBuiltIn left at its schema default (false); GET only ever returns isBuiltIn: false rows,
 * so a future built-in-seeding feature (if any) could never leak into "My Presets". */
export async function GET() {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const rows = await prisma.subtitlePreset.findMany({
    where: { ownerId: userId, isBuiltIn: false },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(parsePresetRows(rows));
}

const createSchema = z.object({
  name: z.string(),
  style: z.record(z.string(), z.unknown()),
  animation: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preset data." }, { status: 400 });

  const existing = await prisma.subtitlePreset.findMany({
    where: { ownerId: userId, isBuiltIn: false },
    select: { id: true, name: true },
  });
  const nameCheck = validateNewPresetName(existing, parsed.data.name);
  if (!nameCheck.ok) return NextResponse.json({ error: nameCheck.error }, { status: 409 });

  // Merged over the current defaults (not assumed complete) — same defensive pattern
  // lib/presets.ts's own `s()`/`a()` helpers use for built-in preset definitions.
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, ...parsed.data.style };
  const animation: AnimationConfig = { ...DEFAULT_ANIMATION, ...parsed.data.animation };

  const created = await prisma.subtitlePreset.create({
    data: { ownerId: userId, name: nameCheck.name, style: JSON.stringify(style), animation: JSON.stringify(animation) },
  });

  return NextResponse.json(parsePresetRows([created])[0]);
}
