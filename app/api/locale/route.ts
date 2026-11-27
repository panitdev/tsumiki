// Persists the viewer's explicit language choice. The cookie is read by
// src/i18n/request.ts and takes precedence over Accept-Language.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isLocale, localeCookieName } from "../../../src/i18n/config";

const oneYear = 60 * 60 * 24 * 365;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const requested = typeof body === "object" && body !== null
    ? (body as { locale?: unknown }).locale
    : undefined;

  if (typeof requested !== "string" || !isLocale(requested)) {
    return NextResponse.json(
      { error: "Unsupported locale." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { locale: requested },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(localeCookieName, requested, {
    path: "/",
    maxAge: oneYear,
    httpOnly: true,
    sameSite: "lax",
  });
  return response;
}
