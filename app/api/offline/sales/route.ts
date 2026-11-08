import { auth } from "@/auth";
import { checkout } from "@/lib/actions/sales";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    // OFF-008 / CACHE-003: Rate limiting on offline sales sync endpoint
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const userIdentifier = session.user.id || ip;
    const rateLimit = await checkRateLimit(`offline-sales:${userIdentifier}`, 60, 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many offline sales sync requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds || 60),
          },
        }
      );
    }

    const payload = await request.json();

    // OFF-005: Preserve local queue createdAt time as the effective saleDate on sync
    const originalDate = payload.createdAt
      ? new Date(payload.createdAt)
      : payload.saleDate
      ? new Date(payload.saleDate)
      : undefined;

    const result = await checkout({
      ...payload,
      isOfflineSync: true,
      saleDate: originalDate,
    });

    if (!result.success) {
      if (result.error?.toLowerCase().includes("unauthorized")) {
        return NextResponse.json(
          { ok: false, error: result.error },
          { status: 401 },
        );
      }

      const isConflict =
        result.error.includes("Insufficient stock") ||
        result.error.includes("Serial") ||
        result.error.includes("not available");

      return NextResponse.json(
        { ok: false, error: result.error },
        { status: isConflict ? 409 : 400 },
      );
    }

    return NextResponse.json({ ok: true, saleId: result.data.id });
  } catch (err: any) {
    if (err?.message?.toLowerCase().includes("unauthorized")) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to sync offline sale" },
      { status: 500 },
    );
  }
}
