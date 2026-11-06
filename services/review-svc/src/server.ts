import { ddbFromEnv, start, verifierFromEnv } from "@mp/shared";
import { buildApp } from "./app.js";

const { app, markDraining } = buildApp({ ddb: ddbFromEnv(), verifier: verifierFromEnv() });

start(app, markDraining).catch((err) => {
  app.log.fatal({ err }, "failed to start");
  process.exit(1);
});
