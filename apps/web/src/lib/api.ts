import "server-only";
import { cookies } from "next/headers";
import { env } from "./env";
import { COOKIES, sessionFromTokens, type Session } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return sessionFromTokens(jar.get(COOKIES.access)?.value, jar.get(COOKIES.id)?.value);
}

interface Opts {
  /** Send the signed-in user's token. */
  auth?: boolean;
  /** Seconds to cache public responses; omit for no caching. */
  revalidate?: number;
  signal?: AbortSignal;
}

/** Server-side API call (server components, route handlers). */
export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.auth) {
    const token = (await cookies()).get(COOKIES.access)?.value;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl()}${path}`, {
      headers,
      ...(opts.revalidate && !opts.auth ? { next: { revalidate: opts.revalidate } } : { cache: "no-store" as const }),
      signal: opts.signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(0, "UPSTREAM_UNAVAILABLE", "the service is unavailable");
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, body.error?.code ?? "HTTP_ERROR", body.error?.message ?? `request failed (${res.status})`, body.error?.details);
  }
  return (await res.json()) as T;
}
