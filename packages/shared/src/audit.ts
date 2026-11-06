import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { AuthUser } from "./auth.js";
import type { DdbContext } from "./ddb.js";
import { auditKey } from "./keys.js";

export interface AuditEntry {
  actor: string;
  action: string;
  targetType: "booking" | "listing" | "user";
  targetId: string;
  detail?: Record<string, unknown>;
}

const RETENTION_SECONDS = 3 * 365 * 24 * 3600;

/** IST calendar month (YYYY-MM) of an instant. */
export function istMonth(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 7);
}

/**
 * Records a staff action. Called after the action succeeds; a failed audit write is logged loudly but
 * does not undo or fail the action (the request log carries the same facts as a fallback).
 */
export async function writeAudit(ddb: DdbContext, e: AuditEntry, log?: { error: (o: object, m: string) => void }, now = new Date()): Promise<void> {
  const iso = now.toISOString();
  try {
    await ddb.doc.send(
      new PutCommand({
        TableName: ddb.table,
        Item: { ...auditKey(istMonth(now), iso, randomUUID()), entity: "AUDIT", at: iso, ...e, ttl: Math.floor(now.getTime() / 1000) + RETENTION_SECONDS },
      }),
    );
  } catch (err) {
    log?.error({ err: (err as Error).message, audit: e }, "AUDIT WRITE FAILED");
  }
}

export const actorOf = (u: AuthUser | undefined) => u?.sub ?? "unknown";
