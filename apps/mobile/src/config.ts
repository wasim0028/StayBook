function env(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  return value.replace(/\/$/, "");
}

// EXPO_PUBLIC_* must be referenced literally so Metro can inline them at build time.
export const config = {
  apiUrl: env("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL),
  cognito: {
    region: env("EXPO_PUBLIC_COGNITO_REGION", process.env.EXPO_PUBLIC_COGNITO_REGION),
    userPoolId: env("EXPO_PUBLIC_COGNITO_USER_POOL_ID", process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID),
    clientId: env("EXPO_PUBLIC_COGNITO_CLIENT_ID", process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID),
    domain: env("EXPO_PUBLIC_COGNITO_DOMAIN", process.env.EXPO_PUBLIC_COGNITO_DOMAIN),
  },
  /** Web app, for the listing editor (photos, map pin, calendar). Optional. */
  webUrl: process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, "") ?? null,
  scheme: "staybook",
} as const;

export const cognitoIssuer = `https://cognito-idp.${config.cognito.region}.amazonaws.com/${config.cognito.userPoolId}`;
