import { NextResponse } from "next/server";
import { auth } from "@/auth";

/** The desktop build has no login screen (section 1 of the desktop spec: no account, no login) —
 * every request is scoped to one fixed local account instead, seeded into prisma/template.db by
 * scripts/build-db-template.js. Set by electron/main.js; never set for the regular web build. */
export const DESKTOP_USER_ID = "local-user";

/** Resolves the current session's user id, or throws a 401 NextResponse (caught by route handlers via try/catch pattern below). */
export async function requireUserId(): Promise<string | NextResponse> {
  if (process.env.SUBLY_DESKTOP === "1") return DESKTOP_USER_ID;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return session.user.id;
}

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
