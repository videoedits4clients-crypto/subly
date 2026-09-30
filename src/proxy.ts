import { NextResponse } from "next/server";
import { auth } from "@/auth";

const DESKTOP_ENTRY_PAGES = ["/", "/login", "/register"];
const PROTECTED_PREFIXES = ["/dashboard", "/editor", "/projects"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (process.env.SUBLY_DESKTOP === "1") {
    // No account, no login — the marketing homepage and the login/register
    // forms all exist for the web SaaS product. In desktop mode they must be
    // genuinely unreachable (not just skipped as the initial URL), or a
    // stray link/back-navigation lands the user on "Create your account"
    // with no way to actually use it (there's no cloud account system to
    // register against in desktop mode — every request is already
    // authenticated as the one local user; see src/lib/api-auth.ts).
    if (DESKTOP_ENTRY_PAGES.includes(pathname)) {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  // Web mode: only the app's own protected pages require a session. "/",
  // "/login", "/register" are matched (see below) purely so the desktop
  // branch above can intercept them — they must NOT also fall into this
  // unauthenticated-redirect check below, or an unauthenticated visitor
  // hitting the homepage/login page itself would be redirected to
  // "/login?callbackUrl=/login", an infinite-redirect-shaped bug (caught by
  // actually testing the regular web server after adding those paths to the
  // matcher for the desktop fix — not just reasoning about it).
  if (!PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const isAuthed = Boolean(req.auth?.user);
  if (!isAuthed) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/", "/login", "/register", "/dashboard/:path*", "/editor/:path*", "/projects/:path*"],
};
