import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import type { BookingRecord, DdbContext } from "@mp/shared";
import { guestCancelled, guestConfirmed, guestRequestAccepted, guestRequestDeclined, hostCancelled, hostNewBooking, hostNewRequest, type Email } from "./templates.js";

export interface Mailer {
  send(to: string, email: Email): Promise<void>;
}
export interface Directory {
  /** Email address for a Cognito user id (sub), or undefined if the user is gone. */
  emailOf(userId: string): Promise<string | undefined>;
}
export interface Logger {
  info(msg: string, ctx?: object): void;
  warn(msg: string, ctx?: object): void;
  error(msg: string, ctx?: object): void;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}
export interface Pusher {
  /** Sends to Expo; returns the tokens Expo says are no longer registered (to be forgotten). */
  send(messages: PushMessage[]): Promise<{ deadTokens: string[] }>;
}

export interface Deps {
  ddb: DdbContext;
  /** Undefined when no verified sender address is configured: booking emails are skipped. */
  mailer?: Mailer;
  pusher?: Pusher;
  directory: Directory;
  log: Logger;
  clock?: () => number;
}

export interface StreamRecord {
  eventName?: string;
  dynamodb?: {
    SequenceNumber?: string;
    NewImage?: Record<string, AttributeValue>;
    OldImage?: Record<string, AttributeValue>;
  };
}

type Kind = "CONFIRMED" | "CANCELLED" | "REQUESTED" | "ACCEPTED" | "DECLINED";

/** Which notification, if any, a booking change calls for. */
export function kindOf(rec: StreamRecord): { kind: Kind; booking: BookingRecord } | undefined {
  if ((rec.eventName !== "MODIFY" && rec.eventName !== "INSERT") || !rec.dynamodb?.NewImage) return undefined;
  const n = unmarshall(rec.dynamodb.NewImage) as Record<string, unknown>;
  if (typeof n.PK !== "string" || !n.PK.startsWith("BOOKING#") || n.SK !== "META") return undefined;
  const o = rec.dynamodb.OldImage ? (unmarshall(rec.dynamodb.OldImage) as Record<string, unknown>) : {};
  if (n.status === o.status) return undefined;
  if (n.status === "REQUESTED") return { kind: "REQUESTED", booking: n as unknown as BookingRecord };
  if (n.status === "PENDING_PAYMENT" && o.status === "REQUESTED") return { kind: "ACCEPTED", booking: n as unknown as BookingRecord };
  if (n.status === "DECLINED") return { kind: "DECLINED", booking: n as unknown as BookingRecord };
  if (rec.eventName === "INSERT") return undefined;
  if (n.status === "CONFIRMED") return { kind: "CONFIRMED", booking: n as unknown as BookingRecord };
  if (n.status === "CANCELLED" && o.status === "CONFIRMED") return { kind: "CANCELLED", booking: n as unknown as BookingRecord };
  return undefined;
}

const DEDUPE_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Streams deliver at least once and Lambda retries failed batches, so each (booking, kind, recipient) is
 * claimed with a conditional put before sending. If the send fails the claim is released and the error
 * is rethrown so the record is retried; a crash between send and ack can at worst repeat one email.
 */
async function sendOnce(deps: Deps, bookingId: string, kind: Kind, role: "guest" | "host", userId: string, email: (to: string) => Promise<void>): Promise<boolean> {
  const key = { PK: `NOTIF#${bookingId}#${kind}#${role}`, SK: "META" };
  const now = deps.clock?.() ?? Math.floor(Date.now() / 1000);
  try {
    await deps.ddb.doc.send(
      new PutCommand({
        TableName: deps.ddb.table,
        Item: { ...key, userId, sentAt: new Date(now * 1000).toISOString(), ttl: now + DEDUPE_TTL_SECONDS },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
    throw e;
  }
  try {
    const to = await deps.directory.emailOf(userId);
    if (!to) {
      deps.log.warn("recipient has no email; skipping", { bookingId, role, userId });
      return false;
    }
    await email(to);
    return true;
  } catch (e) {
    await deps.ddb.doc.send(new DeleteCommand({ TableName: deps.ddb.table, Key: key })).catch(() => undefined);
    throw e;
  }
}

// ---------- new chat messages -> push ----------

export interface NewMessage {
  threadId: string;
  messageId: string;
  recipientId: string;
  senderName: string;
  body: string;
}

/** A newly posted chat message (THREAD#<id> / MSG#...), or undefined. */
export function messageOf(rec: StreamRecord): NewMessage | undefined {
  if (rec.eventName !== "INSERT" || !rec.dynamodb?.NewImage) return undefined;
  const n = unmarshall(rec.dynamodb.NewImage) as Record<string, unknown>;
  if (typeof n.PK !== "string" || !n.PK.startsWith("THREAD#") || typeof n.SK !== "string" || !n.SK.startsWith("MSG#")) return undefined;
  if (typeof n.recipientId !== "string") return undefined;
  return { threadId: String(n.threadId), messageId: String(n.messageId), recipientId: n.recipientId, senderName: String(n.senderName ?? "New message"), body: String(n.body ?? "") };
}

const PUSH_PREVIEW = 140;

async function pushMessage(deps: Deps, m: NewMessage): Promise<number> {
  if (!deps.pusher) return 0;
  const r = await deps.ddb.doc.send(
    new QueryCommand({ TableName: deps.ddb.table, KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)", ExpressionAttributeValues: { ":pk": `USER#${m.recipientId}`, ":p": "PUSH#" } }),
  );
  const tokens = (r.Items ?? []).map((i) => String(i.token));
  if (tokens.length === 0) return 0;
  const claim = { PK: `NOTIF#${m.messageId}#push`, SK: "META" };
  const now = deps.clock?.() ?? Math.floor(Date.now() / 1000);
  try {
    await deps.ddb.doc.send(new PutCommand({ TableName: deps.ddb.table, Item: { ...claim, ttl: now + DEDUPE_TTL_SECONDS }, ConditionExpression: "attribute_not_exists(PK)" }));
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") return 0;
    throw e;
  }
  const body = m.body.length > PUSH_PREVIEW ? `${m.body.slice(0, PUSH_PREVIEW - 1)}…` : m.body;
  try {
    const { deadTokens } = await deps.pusher.send(tokens.map((to) => ({ to, title: m.senderName, body, data: { type: "message", threadId: m.threadId } })));
    for (const t of deadTokens) {
      await deps.ddb.doc.send(new DeleteCommand({ TableName: deps.ddb.table, Key: { PK: `USER#${m.recipientId}`, SK: `PUSH#${t}` } }));
    }
    return tokens.length - deadTokens.length;
  } catch (e) {
    await deps.ddb.doc.send(new DeleteCommand({ TableName: deps.ddb.table, Key: claim })).catch(() => undefined);
    throw e;
  }
}

export async function notify(deps: Deps, rec: StreamRecord): Promise<number> {
  const msg = messageOf(rec);
  if (msg) return pushMessage(deps, msg);
  const change = kindOf(rec);
  if (!change || !deps.mailer) return 0;
  const mailer = deps.mailer;
  const { kind, booking: b } = change;
  // Who hears about what: [email to guest, email to host]; null = nobody on that side.
  const pair: [Email | null, Email | null] =
    kind === "CONFIRMED" ? [guestConfirmed(b), hostNewBooking(b)]
    : kind === "CANCELLED" ? [guestCancelled(b), hostCancelled(b)]
    : kind === "REQUESTED" ? [null, hostNewRequest(b)]
    : kind === "ACCEPTED" ? [guestRequestAccepted(b), null]
    : [guestRequestDeclined(b), null];
  const [toGuest, toHost] = pair;

  let sent = 0;
  if (toGuest && (await sendOnce(deps, b.bookingId, kind, "guest", b.guestId, (to) => mailer.send(to, toGuest)))) sent++;
  if (toHost && (await sendOnce(deps, b.bookingId, kind, "host", b.hostId, (to) => mailer.send(to, toHost)))) sent++;
  deps.log.info("notified", { bookingId: b.bookingId, kind, sent });
  return sent;
}

/** Processes a stream batch, reporting only the failed records so the rest are not retried. */
export async function handleBatch(deps: Deps, records: StreamRecord[]): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> {
  const failures: { itemIdentifier: string }[] = [];
  for (const rec of records) {
    try {
      await notify(deps, rec);
    } catch (e) {
      deps.log.error("notification failed", { err: String((e as Error).message), seq: rec.dynamodb?.SequenceNumber });
      if (rec.dynamodb?.SequenceNumber) failures.push({ itemIdentifier: rec.dynamodb.SequenceNumber });
      break; // keep ordering: everything after the first failure is retried too
    }
  }
  if (failures.length > 0) {
    const idx = records.findIndex((r) => r.dynamodb?.SequenceNumber === failures[0]!.itemIdentifier);
    for (const r of records.slice(idx + 1)) if (r.dynamodb?.SequenceNumber) failures.push({ itemIdentifier: r.dynamodb.SequenceNumber });
  }
  return { batchItemFailures: failures };
}
