import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { canAccessRoute } from "@/lib/auth/route-access";

const { auth } = NextAuth(authConfig);

// Next.js 16 requires a named `proxy` export instead of `export default`.
// auth() wraps the inner function and injects req.auth (the session).
export const proxy = auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // Public routes
  if (pathname === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // Protected routes
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    // Only set callbackUrl when it won't cause a redirect loop
    if (pathname !== "/login") {
      loginUrl.searchParams.set("callbackUrl", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth?.user?.role;
  if (!canAccessRoute(role, pathname)) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip auth checks for framework internals and public static assets.
    "/((?!api|_next/static|_next/image|favicon.ico|icon|icons|images|logo_icons.webp|.*\\..*).*)",
  ],
};
