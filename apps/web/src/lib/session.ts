export const COOKIES = {
  access: "mp_at",
  id: "mp_id",
  refresh: "mp_rt",
  pkce: "mp_pkce",
} as const;

export interface Session {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
  isHost: boolean;
  isAdmin: boolean;
  /** Digital & sales team: read-only metrics. */
  isAnalyst: boolean;
}

/** Decodes a JWT payload without verifying it. The API verifies tokens; this is only for rendering the UI. */
export function decodeJwt(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part, "base64url").toString("utf8");
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function sessionFromTokens(access: string | undefined, idToken: string | undefined, nowSec = Math.floor(Date.now() / 1000)): Session | null {
  const a = decodeJwt(access);
  if (!a || typeof a.sub !== "string") return null;
  if (typeof a.exp === "number" && a.exp <= nowSec) return null;
  const id = decodeJwt(idToken);
  const groups = Array.isArray(a["cognito:groups"]) ? (a["cognito:groups"] as string[]) : [];
  return {
    sub: a.sub,
    email: typeof id?.email === "string" ? id.email : undefined,
    name: typeof id?.name === "string" ? id.name : undefined,
    groups,
    isHost: groups.includes("host"),
    isAdmin: groups.includes("admin"),
    isAnalyst: groups.includes("analyst"),
  };
}

/** True when the access token is missing, expired or about to expire. */
export function needsRefresh(access: string | undefined, nowSec = Math.floor(Date.now() / 1000), skewSec = 120): boolean {
  const exp = decodeJwt(access)?.exp;
  return typeof exp !== "number" || exp - skewSec <= nowSec;
}

/** Only same-site relative paths are valid post-login targets (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
