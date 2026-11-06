import { config } from "@/config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
let onUnauthorized: () => void = () => {};

/** Called once by AuthProvider so every request can attach a fresh access token. */
export function configureApiAuth(getter: TokenGetter, unauthorized: () => void) {
  getToken = getter;
  onUnauthorized = unauthorized;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const token = await getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  else if (opts.auth) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in");

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? 15_000);
  opts.signal?.addEventListener("abort", () => timeout.abort());

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: timeout.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
