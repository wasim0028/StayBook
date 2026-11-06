/** Server-only configuration, read lazily so `next build` doesn't need it. */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

export const env = {
  appUrl: () => req("APP_URL").replace(/\/$/, ""),
  apiUrl: () => req("API_URL").replace(/\/$/, ""),
  cognitoDomain: () => req("COGNITO_DOMAIN").replace(/^https?:\/\//, "").replace(/\/$/, ""),
  clientId: () => req("COGNITO_WEB_CLIENT_ID"),
  secureCookies: () => (process.env.APP_URL ?? "").startsWith("https://"),
};
