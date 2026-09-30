import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId, isErrorResponse } from "@/lib/api-auth";

/** Lists trashed (soft-deleted) projects for the current user. */
export async function GET() {
  const userId = await requireUserId();
  if (isErrorResponse(userId)) return userId;

  const projects = await prisma.project.findMany({
    where: { ownerId: userId, deletedAt: { not: null } },
    include: { video: true },
    orderBy: { deletedAt: "desc" },
  });

  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnailUrl: p.video?.url ?? null,
      deletedAt: p.deletedAt?.toISOString(),
    })),
  );
}
