import { ddbFromEnv, start, verifierFromEnv } from "@mp/shared";
import { buildApp } from "./app.js";
import { cognitoDirectory } from "./directory.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

async function main() {
  const { app, markDraining } = buildApp({
    ddb: ddbFromEnv(),
    verifier: verifierFromEnv(),
    directory: cognitoDirectory(required("COGNITO_USER_POOL_ID")),
  });
  await start(app, markDraining);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "fatal", msg: "failed to start", err: String(err?.stack ?? err) }));
  process.exit(1);
});
