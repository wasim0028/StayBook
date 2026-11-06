import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { metricDayKey, metricMarkKey, opsEntryKey, opsGsiKeys, type DdbContext, type OpsQueue } from "@mp/shared";

export interface StreamRecord {
  eventID?: string;
  eventName?: "INSERT" | "MODIFY" | "REMOVE" | string;
  dynamodb?: {
    SequenceNumber?: string;
    ApproximateCreationDateTime?: number;
    NewImage?: Record<string, AttributeValue>;
    OldImage?: Record<string, AttributeValue>;
  };
}

export interface Logger {
  info(msg: string, ctx?: object): void;
  error(msg: string, ctx?: object): void;
}

export interface Deps {
  ddb: DdbContext;
  log: Logger;
  clock?: () => number;
}

type Img = Record<string, unknown>;

/** Metric counters kept per IST day. Money is paise. */
export const METRICS = [
  "checkouts", // holds created (checkout started)
  "bookings", // confirmed (paid) bookings
  "gmvPaise",
  "feePaise",
  "nights",
  "cancellations",
  "refundPaise",
  "expired", // holds nobody paid for
  "signups",
  "hostsOnboarded",
  "hostsActivated",
  "listingsPublished",
] as const;
export type Metric = (typeof METRICS)[number];

/** Stream marks only need to outlive the stream's 24h retention. */
const MARK_TTL_SECONDS = 3 * 86_400;

const s = (v: unknown) => (typeof v === "string" ? v : undefined);
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** IST calendar day of an ISO timestamp or epoch seconds. */
export function istDay(t: string | number): string {
  const ms = typeof t === "number" ? t * 1000 : Date.parse(t);
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

function kindOf(img: Img | undefined): "BOOKING" | "LISTING" | "USER" | undefined {
  const pk = s(img?.PK);
  const sk = s(img?.SK);
  if (!pk) return undefined;
  if (pk.startsWith("BOOKING#") && sk === "META") return "BOOKING";
  if (pk.startsWith("LISTING#") && sk === "META") return "LISTING";
  if (pk.startsWith("USER#") && sk === "PROFILE") return "USER";
  return undefined; // nights, wishes, idempotency keys, our own OPSQ#/METRIC#/OPSMARK# items...
}

// ---------- queues ----------

const REFUND_ATTENTION = new Set(["FAILED", "PENDING", "IN_PROGRESS"]);
const HOST_ATTENTION = new Set(["needs_clarification", "rejected", "suspended"]);

type Mirror = { key: { PK: string; SK: string }; item?: Record<string, unknown> };

/** The queue entry an item should have right now: `item` to upsert, or none to delete. */
export function mirrorOf(kind: "BOOKING" | "LISTING" | "USER", img: Img | undefined, id: string): Mirror {
  if (kind === "BOOKING") {
    const key = opsEntryKey("BOOKING", id, "refunds");
    if (!img || img.status !== "CANCELLED" || !REFUND_ATTENTION.has(s(img.refundStatus) ?? "")) return { key };
    const since = s(img.cancelledAt) ?? s(img.updatedAt) ?? new Date(0).toISOString();
    return {
      key,
      item: {
        ...key,
        ...opsGsiKeys("refunds", since, id),
        entity: "OPSQ",
        queue: "refunds",
        id,
        since,
        bookingId: id,
        listingId: img.listingId,
        listingTitle: img.listingTitle,
        guestId: img.guestId,
        hostId: img.hostId,
        totalPaise: img.totalPaise,
        refundPaise: img.refundPaise,
        refundStatus: img.refundStatus,
        refundError: img.refundError,
        cancelledBy: img.cancelledBy,
      },
    };
  }
  if (kind === "USER") {
    const key = opsEntryKey("USER", id, "hosts");
    const step = s(img?.onboardingStep);
    const status = s(img?.razorpayAccountStatus);
    const attention = !!img && !!step && (step !== "done" || HOST_ATTENTION.has(status ?? ""));
    if (!attention) return { key };
    const since = s(img!.updatedAt) ?? new Date(0).toISOString();
    return {
      key,
      item: {
        ...key,
        ...opsGsiKeys("hosts", since, id),
        entity: "OPSQ",
        queue: "hosts",
        id,
        since,
        userId: id,
        displayName: img!.displayName,
        legalBusinessName: img!.legalBusinessName,
        onboardingStep: step,
        payoutStatus: status,
        reason: step !== "done" ? "onboarding_incomplete" : status,
      },
    };
  }
  const key = opsEntryKey("LISTING", id, "listings");
  const st = s(img?.status);
  if (!img || !st) return { key };
  const queue = `listings-${st.toLowerCase()}` as OpsQueue;
  const since = s(img.updatedAt) ?? new Date(0).toISOString();
  const photos = Array.isArray(img.photos) ? (img.photos as string[]) : [];
  return {
    key,
    item: {
      ...key,
      ...opsGsiKeys(queue, since, id),
      entity: "OPSQ",
      queue,
      id,
      since,
      listingId: id,
      hostId: img.hostId,
      title: img.title,
      city: img.city,
      status: st,
      basePricePaise: img.basePricePaise,
      photoCount: photos.length,
      coverPhotoId: photos[0],
      ratingAvg: img.ratingAvg,
      ratingCount: img.ratingCount,
    },
  };
}

// ---------- metrics ----------

export type Deltas = { day: string; add: Partial<Record<Metric, number>> }[];

/** Business events a single change represents, grouped by the IST day they belong to. */
export function metricsOf(eventName: string | undefined, kind: "BOOKING" | "LISTING" | "USER", o: Img | undefined, nw: Img | undefined, eventTime: number): Deltas {
  const out = new Map<string, Partial<Record<Metric, number>>>();
  const add = (when: string | number | undefined, m: Partial<Record<Metric, number>>) => {
    const day = istDay(when ?? eventTime);
    const cur = out.get(day) ?? {};
    for (const [k, v] of Object.entries(m) as [Metric, number][]) cur[k] = (cur[k] ?? 0) + v;
    out.set(day, cur);
  };
  if (!nw) return [];
  const before = s(o?.status);
  const after = s(nw.status);

  if (kind === "BOOKING") {
    if (eventName === "INSERT" && after === "PENDING_PAYMENT") add(s(nw.createdAt), { checkouts: 1 });
    if (after !== before) {
      if (after === "CONFIRMED") {
        add(s(nw.confirmedAt), { bookings: 1, gmvPaise: n(nw.totalPaise), feePaise: n(nw.platformFeePaise), nights: Array.isArray(nw.nights) ? nw.nights.length : 0 });
      } else if (after === "CANCELLED" && before === "CONFIRMED") {
        add(s(nw.cancelledAt), { cancellations: 1, refundPaise: n(nw.refundPaise) });
      } else if (after === "EXPIRED") {
        add(s(nw.updatedAt), { expired: 1 });
      }
    }
  } else if (kind === "USER") {
    if (eventName === "INSERT") add(s(nw.createdAt), { signups: 1 });
    if (nw.onboardingStep === "done" && o?.onboardingStep !== "done") add(s(nw.updatedAt), { hostsOnboarded: 1 });
    if (nw.razorpayAccountStatus === "activated" && o?.razorpayAccountStatus !== "activated") add(s(nw.updatedAt), { hostsActivated: 1 });
  } else if (after === "PUBLISHED" && before !== "PUBLISHED") {
    add(s(nw.updatedAt), { listingsPublished: 1 });
  }
  return [...out].map(([day, a]) => ({ day, add: a }));
}

function isMarkConflict(e: unknown): boolean {
  const x = e as { name?: string; CancellationReasons?: { Code?: string }[] };
  return x.name === "TransactionCanceledException" && x.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed";
}

/** Adds the deltas exactly once per stream record: the record's id is claimed in the same transaction. */
async function count(deps: Deps, eventId: string, deltas: Deltas, now: number): Promise<boolean> {
  if (deltas.length === 0) return false;
  const updates = deltas.map(({ day, add }) => {
    const names: Record<string, string> = {};
    const values: Record<string, number> = {};
    const parts = Object.entries(add).map(([k, v], i) => {
      names[`#m${i}`] = k;
      values[`:v${i}`] = v;
      return `#m${i} :v${i}`;
    });
    return {
      Update: {
        TableName: deps.ddb.table,
        Key: metricDayKey(day),
        UpdateExpression: `ADD ${parts.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    };
  });
  try {
    await deps.ddb.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: deps.ddb.table, Item: { ...metricMarkKey(eventId), ttl: now + MARK_TTL_SECONDS }, ConditionExpression: "attribute_not_exists(PK)" } },
          ...updates,
        ],
      }),
    );
    return true;
  } catch (e) {
    if (isMarkConflict(e)) return false; // already counted on an earlier delivery
    throw e;
  }
}

export async function processRecord(deps: Deps, rec: StreamRecord): Promise<{ mirrored: boolean; counted: boolean }> {
  const d = rec.dynamodb;
  const nw = d?.NewImage ? (unmarshall(d.NewImage) as Img) : undefined;
  const o = d?.OldImage ? (unmarshall(d.OldImage) as Img) : undefined;
  const kind = kindOf(nw ?? o);
  if (!kind) return { mirrored: false, counted: false };
  const pk = s((nw ?? o)!.PK)!;
  const id = pk.slice(pk.indexOf("#") + 1);
  const now = deps.clock?.() ?? Math.floor(Date.now() / 1000);

  const m = mirrorOf(kind, rec.eventName === "REMOVE" ? undefined : nw, id);
  if (m.item) await deps.ddb.doc.send(new PutCommand({ TableName: deps.ddb.table, Item: m.item }));
  else await deps.ddb.doc.send(new DeleteCommand({ TableName: deps.ddb.table, Key: m.key }));

  const eventTime = d?.ApproximateCreationDateTime ?? now;
  const eventId = rec.eventID ?? d?.SequenceNumber;
  const deltas = metricsOf(rec.eventName, kind, o, rec.eventName === "REMOVE" ? undefined : nw, eventTime);
  const counted = eventId ? await count(deps, eventId, deltas, now) : false;
  if (deltas.length && !eventId) deps.log.error("record has no id; metrics skipped", { pk });
  return { mirrored: !!m.item, counted };
}

/** Same contract as the notifier: report the first failure and everything after it, so order is kept. */
export async function handleBatch(deps: Deps, records: StreamRecord[]): Promise<{ batchItemFailures: { itemIdentifier: string }[] }> {
  for (let i = 0; i < records.length; i++) {
    try {
      await processRecord(deps, records[i]!);
    } catch (e) {
      deps.log.error("ops index failed", { err: (e as Error).message, seq: records[i]!.dynamodb?.SequenceNumber });
      return { batchItemFailures: records.slice(i).flatMap((r) => (r.dynamodb?.SequenceNumber ? [{ itemIdentifier: r.dynamodb.SequenceNumber }] : [])) };
    }
  }
  return { batchItemFailures: [] };
}
