import type { NextResponse } from "next/server";
import { env } from "./env";
import { COOKIES } from "./session";
import type { Tokens } from "./cognito";

const base = () => ({ httpOnly: true, secure: env.secureCookies(), sameSite: "lax" as const, path: "/" });

/** Stores tokens as httpOnly cookies: page scripts (and any XSS) can't read them. */
export function setTokenCookies(res: NextResponse, t: Tokens, refreshDays = 30) {
  res.cookies.set(COOKIES.access, t.access_token, { ...base(), maxAge: t.expires_in });
  if (t.id_token) res.cookies.set(COOKIES.id, t.id_token, { ...base(), maxAge: t.expires_in });
  if (t.refresh_token) res.cookies.set(COOKIES.refresh, t.refresh_token, { ...base(), maxAge: refreshDays * 86_400 });
}

export function clearTokenCookies(res: NextResponse) {
  for (const name of [COOKIES.access, COOKIES.id, COOKIES.refresh]) res.cookies.set(name, "", { ...base(), maxAge: 0 });
}
