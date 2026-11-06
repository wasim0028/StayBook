import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { COOKIES } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Same-origin proxy to the API for the browser. Tokens live in httpOnly cookies, so this is where they
 * become an Authorization header. Only /v1/* is forwarded (it is not an open proxy).
 */
async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] !== "v1" || path.some((p) => p === ".." || p === ".")) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "route not found" } }, { status: 404 });
  }

  const headers = new Headers();
  const token = req.cookies.get(COOKIES.access)?.value;
  if (token) headers.set("authorization", `Bearer ${token}`);
  for (const h of ["content-type", "idempotency-key", "accept"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiUrl()}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return NextResponse.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "the service is unavailable, please retry" } }, { status: 502 });
  }

  const out = new Headers({ "cache-control": "no-store" });
  const ct = upstream.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  return new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
