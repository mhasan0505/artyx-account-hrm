import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { canAccessRoute } from "@/lib/auth/route-access";

const { auth } = NextAuth(authConfig);

// Next.js 16 requires a named `proxy` export instead of `export default`.
// auth() wraps the inner function and injects req.auth (the session).
export const proxy = (req: any) => {
  return NextResponse.next();
};

export const config = {
  matcher: [
    // Skip auth checks for framework internals and public static assets.
    "/((?!api|_next/static|_next/image|favicon.ico|icon|icons|images|logo_icons.webp|.*\\..*).*)",
  ],
};
