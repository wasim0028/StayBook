import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/cognito";
import { setTokenCookies } from "@/lib/cookies";
import { env } from "@/lib/env";
import { COOKIES, safeNext } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/?auth_error=${reason}`, env.appUrl()));
    res.cookies.set(COOKIES.pkce, "", { path: "/auth", maxAge: 0 });
    return res;
  };

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (req.nextUrl.searchParams.get("error")) return fail("denied");
  if (!code || !state) return fail("invalid");

  let saved: { v?: string; s?: string; n?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(COOKIES.pkce)?.value ?? "{}");
  } catch {
    /* handled below */
  }
  if (!saved.v || !saved.s || saved.s !== state) return fail("state");

  try {
    const tokens = await exchangeCode(code, saved.v);
    const res = NextResponse.redirect(new URL(safeNext(saved.n), env.appUrl()));
    setTokenCookies(res, tokens);
    res.cookies.set(COOKIES.pkce, "", { path: "/auth", maxAge: 0 });
    return res;
  } catch {
    return fail("exchange");
  }
}
