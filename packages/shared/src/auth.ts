import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./http.js";

/** analyst = digital & sales team: read-only business metrics. admin = operations staff. */
export type Role = "guest" | "host" | "admin" | "analyst";
const ROLES: readonly Role[] = ["guest", "host", "admin", "analyst"];

export interface AuthUser {
  sub: string;
  groups: Role[];
}

/** Anything that turns a bearer token into a user. Swappable in tests. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Verifies Cognito *access* tokens (signature, expiry, issuer, client id, token_use). JWKS is cached. */
export function cognitoVerifier(opts: { userPoolId: string; clientIds: string[] }): TokenVerifier {
  const v = CognitoJwtVerifier.create({
    userPoolId: opts.userPoolId,
    tokenUse: "access",
    clientId: opts.clientIds,
  });
  return {
    async verify(token) {
      const p = await v.verify(token);
      const groups = ((p["cognito:groups"] as string[] | undefined) ?? []).filter(
        (g): g is Role => (ROLES as readonly string[]).includes(g),
      );
      return { sub: p.sub, groups };
    },
  };
}

export function verifierFromEnv(): TokenVerifier {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientIds = (process.env.COGNITO_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!userPoolId || clientIds.length === 0) {
    throw new Error("COGNITO_USER_POOL_ID and COGNITO_CLIENT_IDS must be set");
  }
  return cognitoVerifier({ userPoolId, clientIds });
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const [scheme, token] = h.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}

/** preHandler: requires a valid token and (optionally) one of the given roles. */
export function requireAuth(verifier: TokenVerifier, roles: Role[] = []) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, "UNAUTHENTICATED", "missing bearer token");
    let user: AuthUser;
    try {
      user = await verifier.verify(token);
    } catch {
      throw new HttpError(401, "UNAUTHENTICATED", "invalid or expired token");
    }
    if (roles.length > 0 && !roles.some((r) => user.groups.includes(r))) {
      throw new HttpError(403, "FORBIDDEN", `requires role: ${roles.join(" or ")}`);
    }
    req.user = user;
  };
}

/** preHandler: attaches the user when a valid token is present, but never rejects. */
export function optionalAuth(verifier: TokenVerifier) {
  return async (req: FastifyRequest) => {
    const token = bearer(req);
    if (!token) return;
    try {
      req.user = await verifier.verify(token);
    } catch {
      /* anonymous */
    }
  };
}

export function isAdmin(u: AuthUser | undefined): boolean {
  return !!u && u.groups.includes("admin");
}
