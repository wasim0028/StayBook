import { ddbFromEnv } from "@mp/shared";
import { evaluateAll } from "./evaluator.js";

const ddb = ddbFromEnv();

/** Daily (EventBridge Scheduler): recompute Superhost status for every host with a live listing. */
export const handler = () => evaluateAll(ddb, new Date(), (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx })));
