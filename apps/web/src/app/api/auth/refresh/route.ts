import { NextResponse, type NextRequest } from "next/server";
import { refreshTokens } from "@/lib/cognito";
import { clearTokenCookies, setTokenCookies } from "@/lib/cookies";
import { COOKIES, sessionFromTokens } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Forces a token refresh. The app calls it right after host onboarding, because Cognito only
 * puts the user in the "host" group in tokens issued after the group was assigned.
 */
export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  if (!refresh) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "signed out" } }, { status: 401 });
  try {
    const t = await refreshTokens(refresh);
    const res = NextResponse.json({ ok: true, isHost: sessionFromTokens(t.access_token, t.id_token)?.isHost ?? false });
    setTokenCookies(res, t);
    return res;
  } catch {
    const res = NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "session expired" } }, { status: 401 });
    clearTokenCookies(res);
    return res;
  }
}
