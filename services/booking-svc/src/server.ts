import { ddbFromEnv, httpRazorpay, loadRazorpayCredentials, start, verifierFromEnv } from "@mp/shared";
import { buildApp } from "./app.js";

async function main() {
  const cdnBaseUrl = process.env.CDN_BASE_URL;
  if (!cdnBaseUrl) throw new Error("CDN_BASE_URL must be set");

  // Keys come from Secrets Manager via this pod's IAM role (RAZORPAY_SECRET_ID); never from Git.
  const creds = await loadRazorpayCredentials();

  const { app, markDraining } = buildApp({
    ddb: ddbFromEnv(),
    verifier: verifierFromEnv(),
    razorpay: httpRazorpay(creds),
    razorpayKeyId: creds.keyId,
    cdnBaseUrl,
    platformFeePct: Number(process.env.PLATFORM_FEE_PCT ?? 12),
    holdMinutes: Number(process.env.HOLD_MINUTES ?? 15),
  });
  await start(app, markDraining);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "fatal", msg: "failed to start", err: String(err?.stack ?? err) }));
  process.exit(1);
});
