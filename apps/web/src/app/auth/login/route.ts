import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, challengeFor, randomToken } from "@/lib/cognito";
import { env } from "@/lib/env";
import { COOKIES, safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Starts Authorization Code + PKCE. The verifier never leaves an httpOnly cookie. */
export async function GET(req: NextRequest) {
  const verifier = randomToken(48);
  const state = randomToken(16);
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const signup = req.nextUrl.searchParams.get("mode") === "signup";

  const res = NextResponse.redirect(authorizeUrl({ state, challenge: await challengeFor(verifier), screenHint: signup ? "signup" : undefined }));
  res.cookies.set(COOKIES.pkce, JSON.stringify({ v: verifier, s: state, n: next }), {
    httpOnly: true,
    secure: env.secureCookies(),
    sameSite: "lax",
    path: "/auth",
    maxAge: 600,
  });
  return res;
}
