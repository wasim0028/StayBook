import { ddbFromEnv, start, verifierFromEnv } from "@mp/shared";
import { buildApp } from "./app.js";
import { s3PhotoStore } from "./photos.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const { app, markDraining } = buildApp({
  ddb: ddbFromEnv(),
  verifier: verifierFromEnv(),
  photos: s3PhotoStore(required("PHOTOS_BUCKET")),
  cdnBaseUrl: required("CDN_BASE_URL"),
  requirePayoutAccount: process.env.REQUIRE_PAYOUT_ACCOUNT !== "false",
  minPhotosToPublish: Number(process.env.MIN_PHOTOS_TO_PUBLISH ?? 3),
});

start(app, markDraining).catch((err) => {
  app.log.fatal({ err }, "failed to start");
  process.exit(1);
});
