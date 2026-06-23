import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/** Lightweight gate: redirect unauthenticated users away from the app shell. */
export function middleware(req: NextRequest) {
  const cookie = getSessionCookie(req);
  if (!cookie) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Protect everything except auth, login, static assets, and the agent API
  // (agents authenticate with a bearer token, not a session cookie).
  matcher: ["/((?!api/auth|api/agents|login|_next/static|_next/image|favicon.ico).*)"],
};
