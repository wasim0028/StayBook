import { ddbFromEnv, start, verifierFromEnv } from "@mp/shared";
import { buildApp } from "./app.js";

const cdn = process.env.CDN_BASE_URL;
if (!cdn) throw new Error("CDN_BASE_URL must be set");

const { app, markDraining } = buildApp({ ddb: ddbFromEnv(), verifier: verifierFromEnv(), cdnBaseUrl: cdn });
start(app, markDraining).catch((err) => {
  console.error(JSON.stringify({ level: "fatal", msg: "failed to start", err: String(err?.stack ?? err) }));
  process.exit(1);
});
