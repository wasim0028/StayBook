import { ddbFromEnv, httpRazorpayAccounts, loadRazorpayCredentials, start, verifierFromEnv } from "@mp/shared";
import { buildApp } from "./app.js";
import { cognitoGroups } from "./cognito.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

async function main() {
  const creds = await loadRazorpayCredentials();
  const { app, markDraining } = buildApp({
    ddb: ddbFromEnv(),
    verifier: verifierFromEnv(),
    accounts: httpRazorpayAccounts(creds),
    groups: cognitoGroups(required("COGNITO_USER_POOL_ID")),
    cdnBaseUrl: required("CDN_BASE_URL"),
  });
  await start(app, markDraining);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "fatal", msg: "failed to start", err: String(err?.stack ?? err) }));
  process.exit(1);
});
