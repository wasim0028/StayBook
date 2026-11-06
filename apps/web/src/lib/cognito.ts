import { env } from "./env";

export interface Tokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function challengeFor(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

export const redirectUri = () => `${env.appUrl()}/auth/callback`;

export function authorizeUrl(p: { state: string; challenge: string; screenHint?: "signup" }): string {
  const u = new URL(`https://${env.cognitoDomain()}/oauth2/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.clientId());
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  // Cognito's hosted UI shows the sign-up tab from /signup; /oauth2/authorize shows sign-in.
  if (p.screenHint === "signup") u.pathname = "/signup";
  return u.toString();
}

export function logoutUrl(): string {
  const u = new URL(`https://${env.cognitoDomain()}/logout`);
  u.searchParams.set("client_id", env.clientId());
  u.searchParams.set("logout_uri", `${env.appUrl()}/`);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`https://${env.cognitoDomain()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.clientId(), ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`cognito token endpoint returned ${res.status}`);
  return (await res.json()) as Tokens;
}

export const exchangeCode = (code: string, verifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() });

/** Cognito does not rotate the refresh token, so the response carries only access/id tokens. */
export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
