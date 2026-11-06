import { ddbFromEnv } from "@mp/shared";
import { handleBatch, type Logger, type StreamRecord } from "./indexer.js";

const log: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: "info", msg, ...ctx })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: "error", msg, ...ctx })),
};
const ddb = ddbFromEnv();

export const handler = (event: { Records: StreamRecord[] }) => handleBatch({ ddb, log }, event.Records);
