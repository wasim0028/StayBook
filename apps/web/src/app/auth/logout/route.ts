import { NextResponse } from "next/server";
import { logoutUrl } from "@/lib/cognito";
import { clearTokenCookies } from "@/lib/cookies";

export const dynamic = "force-dynamic";

/** Clears our cookies, then ends the Cognito hosted-UI session so "sign in" asks for credentials again. */
export async function GET() {
  const res = NextResponse.redirect(logoutUrl());
  clearTokenCookies(res);
  return res;
}
