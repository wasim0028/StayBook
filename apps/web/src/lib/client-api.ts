"use client";

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

interface Opts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Browser call to the API through the same-origin proxy (/api/bff). Cookies carry the session. */
export async function call<T>(path: string, opts: Opts = {}): Promise<T> {
  const res = await fetch(`/api/bff${path}`, {
    method: opts.method ?? "GET",
    headers: { ...(opts.body !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    // Session ended: send the user through sign-in and back to this page.
    window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ClientApiError(401, "UNAUTHENTICATED", "please sign in");
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = undefined;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON */
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ClientApiError(res.status, e?.code ?? "HTTP_ERROR", e?.message ?? `request failed (${res.status})`, e?.details);
  }
  return data as T;
}

/** Human-readable text for an error from `call`. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ClientApiError) return e.message;
  return fallback;
}

/** Per-field messages from a VALIDATION_FAILED response (zod's flattened shape: { fieldErrors: { name: [msg] } }). */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ClientApiError) || e.code !== "VALIDATION_FAILED") return {};
  const fe = (e.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined)?.fieldErrors ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fe)) if (v?.[0]) out[k] = v[0];
  return out;
}
