import { ddbFromEnv } from "@mp/shared";
import { expireHolds, type ExpirerResult } from "./expirer.js";

const ddb = ddbFromEnv();

/** Invoked every minute by EventBridge Scheduler. */
export async function handler(): Promise<ExpirerResult> {
  return expireHolds({
    ddb,
    clock: () => Math.floor(Date.now() / 1000),
    graceSeconds: Number(process.env.GRACE_SECONDS ?? 300),
    maxPerRun: Number(process.env.MAX_PER_RUN ?? 500),
    log: (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx })),
  });
}
