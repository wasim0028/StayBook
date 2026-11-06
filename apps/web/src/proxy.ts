import { NextResponse, type NextRequest } from "next/server";
import { refreshTokens } from "@/lib/cognito";
import { clearTokenCookies, setTokenCookies } from "@/lib/cookies";
import { COOKIES, needsRefresh } from "@/lib/session";

/** Pages that require a signed-in user. */
const PROTECTED = ["/trips", "/wishlist", "/account", "/host", "/admin", "/inbox"];

/**
 * Runs before every page and API request:
 *  1. silently renews the access token from the refresh token shortly before it expires, so server
 *     components and the API proxy always see a valid token (they can't set cookies themselves);
 *  2. sends signed-out visitors of account pages to sign-in, then back where they were headed.
 */
export async function proxy(req: NextRequest) {
  const access = req.cookies.get(COOKIES.access)?.value;
  const refresh = req.cookies.get(COOKIES.refresh)?.value;

  let renewed: Awaited<ReturnType<typeof refreshTokens>> | undefined;
  let refreshFailed = false;
  if (refresh && needsRefresh(access)) {
    try {
      renewed = await refreshTokens(refresh);
    } catch {
      refreshFailed = true;
    }
  }

  const signedIn = !!renewed || (!!access && !needsRefresh(access, undefined, 0));
  const path = req.nextUrl.pathname;
  if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const login = new URL("/auth/login", req.url);
    login.searchParams.set("next", path + req.nextUrl.search);
    const res = NextResponse.redirect(login);
    if (refreshFailed) clearTokenCookies(res);
    return res;
  }

  if (renewed) {
    // Make the new tokens visible to this same request's server components, and persist them for the browser.
    const headers = new Headers(req.headers);
    const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
    jar.set(COOKIES.access, renewed.access_token);
    if (renewed.id_token) jar.set(COOKIES.id, renewed.id_token);
    headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = NextResponse.next({ request: { headers } });
    setTokenCookies(res, renewed);
    return res;
  }

  const res = NextResponse.next();
  if (refreshFailed) clearTokenCookies(res);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|auth/|healthz/).*)"],
};
