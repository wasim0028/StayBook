import { ddbFromEnv, start } from "@mp/shared";
import { buildApp } from "./app.js";

const cdnBaseUrl = process.env.CDN_BASE_URL;
if (!cdnBaseUrl) throw new Error("CDN_BASE_URL must be set");

// search-svc is anonymous and read-only: no token verifier, and its IAM role only allows Query/GetItem.
const { app, markDraining } = buildApp({ ddb: ddbFromEnv(), cdnBaseUrl });

start(app, markDraining).catch((err) => {
  app.log.fatal({ err }, "failed to start");
  process.exit(1);
});
