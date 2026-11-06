import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { configureApiAuth } from "@/api/client";
import { cognitoIssuer, config } from "@/config";

// Completes the auth popup on web; a no-op on native.
WebBrowser.maybeCompleteAuthSession();

const REFRESH_KEY = "auth.refreshToken";

export interface SessionUser {
  sub: string;
  email?: string;
  groups: string[];
}

interface AuthState {
  ready: boolean;
  user: SessionUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  /** Fetch new tokens now, e.g. after host onboarding adds the user to the "host" group. */
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Display-only JWT decode. Signature checks happen on the server, never here. */
function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  try {
    return JSON.parse(globalThis.atob(b64)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function userFrom(tokens: AuthSession.TokenResponse): SessionUser {
  const access = decodeJwt(tokens.accessToken);
  const id = tokens.idToken ? decodeJwt(tokens.idToken) : {};
  return {
    sub: String(access.sub ?? id.sub ?? ""),
    email: typeof id.email === "string" ? id.email : undefined,
    groups: Array.isArray(access["cognito:groups"]) ? (access["cognito:groups"] as string[]) : [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const discovery = AuthSession.useAutoDiscovery(cognitoIssuer);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: config.scheme, path: "auth/callback" });

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.cognito.clientId,
      redirectUri,
      scopes: ["openid", "email", "profile"],
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    discovery,
  );

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const tokens = useRef<AuthSession.TokenResponse | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);

  const clear = useCallback(async () => {
    tokens.current = null;
    setUser(null);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  }, []);

  const store = useCallback(async (t: AuthSession.TokenResponse, previousRefresh?: string) => {
    // Cognito does not rotate refresh tokens by default, so keep the old one if none is returned.
    const refreshToken = t.refreshToken ?? previousRefresh;
    const merged = new AuthSession.TokenResponse({ ...t.getRequestConfig(), refreshToken });
    tokens.current = merged;
    if (refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    setUser(userFrom(merged));
  }, []);

  const refresh = useCallback(
    async (refreshToken: string): Promise<string | null> => {
      if (!discovery) return null;
      try {
        const t = await AuthSession.refreshAsync({ clientId: config.cognito.clientId, refreshToken }, discovery);
        await store(t, refreshToken);
        return t.accessToken;
      } catch {
        await clear(); // refresh token expired or revoked
        return null;
      }
    },
    [discovery, store, clear],
  );

  // Restore the session on launch.
  useEffect(() => {
    if (!discovery) return;
    let cancelled = false;
    (async () => {
      const saved = await SecureStore.getItemAsync(REFRESH_KEY);
      if (saved && !cancelled) await refresh(saved);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [discovery, refresh]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const t = tokens.current;
    if (!t) return null;
    // Refresh a minute before the token's own `exp`; share one in-flight refresh across concurrent requests.
    const exp = Number(decodeJwt(t.accessToken).exp ?? 0);
    if (exp - 60 > Date.now() / 1000) return t.accessToken;
    if (!t.refreshToken) return t.accessToken;
    refreshing.current ??= refresh(t.refreshToken).finally(() => {
      refreshing.current = null;
    });
    return refreshing.current;
  }, [refresh]);

  const refreshSession = useCallback(async () => {
    const rt = tokens.current?.refreshToken;
    if (rt) await refresh(rt);
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (!request || !discovery) throw new Error("Sign-in is still loading. Try again in a moment.");
    const result = await promptAsync();
    if (result.type !== "success") return; // cancelled or dismissed
    const t = await AuthSession.exchangeCodeAsync(
      {
        clientId: config.cognito.clientId,
        code: result.params.code ?? "",
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier ?? "" },
      },
      discovery,
    );
    await store(t);
  }, [request, discovery, promptAsync, redirectUri, store]);

  const signOut = useCallback(async () => {
    await clear();
    // End the hosted-UI session too, or the next sign-in would be silent.
    const logoutUri = AuthSession.makeRedirectUri({ scheme: config.scheme, path: "auth/logout" });
    const url = `${config.cognito.domain}/logout?client_id=${encodeURIComponent(config.cognito.clientId)}&logout_uri=${encodeURIComponent(logoutUri)}`;
    await WebBrowser.openAuthSessionAsync(url, logoutUri).catch(() => undefined);
  }, [clear]);

  useEffect(() => {
    configureApiAuth(getAccessToken, () => void clear());
  }, [getAccessToken, clear]);

  const value = useMemo(
    () => ({ ready, user, signIn, signOut, getAccessToken, refreshSession }),
    [ready, user, signIn, signOut, getAccessToken, refreshSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
