import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";

export async function GET() {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const kit = await prisma.brandKit.findFirst({ where: { ownerId: userId } });
  return NextResponse.json(kit);
}

const schema = z.object({
  name: z.string().min(1).max(80).default("My Brand"),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  accentColor: z.string(),
  fontFamily: z.string(),
});

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid brand kit data." }, { status: 400 });

  const existing = await prisma.brandKit.findFirst({ where: { ownerId: userId } });
  const kit = existing
    ? await prisma.brandKit.update({ where: { id: existing.id }, data: parsed.data })
    : await prisma.brandKit.create({ data: { ownerId: userId, ...parsed.data } });

  return NextResponse.json(kit);
}
