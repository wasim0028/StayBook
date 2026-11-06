import { ddbFromEnv, httpRazorpay, loadRazorpayCredentials } from "@mp/shared";
import { createWebhookHandler, type Logger, type WebhookDeps } from "./webhook.js";

const log: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx })),
  warn: (msg, ctx) => console.warn(JSON.stringify({ level: "warn", msg, ...ctx })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: "error", msg, ...ctx })),
};

// Created once per execution environment and reused across invocations.
let deps: Promise<WebhookDeps> | undefined;

function prodDeps(): Promise<WebhookDeps> {
  deps ??= (async () => {
    const creds = await loadRazorpayCredentials();
    if (!creds.webhookSecret) throw new Error("razorpay secret must contain webhook_secret");
    return { ddb: ddbFromEnv(), razorpay: httpRazorpay(creds), webhookSecret: creds.webhookSecret, log };
  })().catch((e) => {
    deps = undefined; // don't cache a failed cold start
    throw e;
  });
  return deps;
}

export const handler = createWebhookHandler(prodDeps);
