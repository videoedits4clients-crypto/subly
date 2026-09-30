import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";
import { parsePresetRows, validateRenamedPresetName } from "@/lib/custom-presets";

const patchSchema = z.object({
  name: z.string().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  animation: z.record(z.string(), z.unknown()).optional(),
});

/** Renames and/or overwrites the style/animation of an existing custom preset — used by both
 * "Rename" and "Update preset" in the UI (a single PATCH, just with a different subset of the
 * body). `isBuiltIn: true` is (defensively) rejected the same as a preset owned by someone
 * else — no row this route can reach is ever actually built-in in practice, since nothing in
 * this app inserts a built-in preset into this table, but the check costs nothing and means
 * "built-ins can't be renamed" holds even if that ever changed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const existing = await prisma.subtitlePreset.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== userId || existing.isBuiltIn) {
    return NextResponse.json({ error: "Preset not found." }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preset data." }, { status: 400 });

  let name = existing.name;
  if (parsed.data.name !== undefined) {
    const rows = await prisma.subtitlePreset.findMany({
      where: { ownerId: userId, isBuiltIn: false },
      select: { id: true, name: true },
    });
    const check = validateRenamedPresetName(rows, id, parsed.data.name);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 409 });
    name = check.name;
  }

  const updated = await prisma.subtitlePreset.update({
    where: { id },
    data: {
      name,
      style: parsed.data.style ? JSON.stringify(parsed.data.style) : undefined,
      animation: parsed.data.animation ? JSON.stringify(parsed.data.animation) : undefined,
    },
  });

  return NextResponse.json(parsePresetRows([updated])[0]);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;
  const { id } = await params;

  const existing = await prisma.subtitlePreset.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== userId || existing.isBuiltIn) {
    return NextResponse.json({ error: "Preset not found." }, { status: 404 });
  }

  // Only removes this one SubtitlePreset row. Projects store their own globalStyle/animation
  // as independent JSON columns (see lib/db-json.ts) — nothing references this row by id, so
  // deleting it cannot affect any project, caption, brand kit, font, or export.
  await prisma.subtitlePreset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
