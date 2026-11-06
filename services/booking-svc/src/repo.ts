import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type NativeAttributeValue,
} from "@aws-sdk/lib-dynamodb";
import {
  bookingKey,
  decodeCursor,
  encodeCursor,
  GSI,
  guestBookingGsiKeys,
  holdGsiKeys,
  hostBookingGsiKeys,
  idempotencyKey,
  isConditionalFailure,
  listingKey,
  nightKey,
  nightSk,
  nightTtl,
  orderKey,
  userKey,
  type BookingRecord,
  type BookingStatus,
  type DdbContext,
  type HostProfile,
  type RefundDecision,
} from "@mp/shared";

type Item = Record<string, NativeAttributeValue>;

export class ReserveConflict extends Error {
  constructor(
    public readonly kind: "IDEMPOTENCY" | "DATES",
    public readonly dates: string[] = [],
  ) {
    super(kind === "DATES" ? `dates unavailable: ${dates.join(", ")}` : "idempotency key already used");
    this.name = "ReserveConflict";
  }
}

const INTERNAL_KEYS = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI4PK", "GSI4SK", "entity"];

export function toRecord(item: Item): BookingRecord {
  const out = { ...item };
  for (const k of INTERNAL_KEYS) delete out[k];
  return out as BookingRecord;
}

export interface IdempotencyRecord {
  bookingId: string;
  requestHash: string;
  createdAt: number;
}

export class BookingRepo {
  constructor(private readonly ctx: DdbContext) {}

  private get t() {
    return this.ctx.table;
  }

  async getListing(id: string): Promise<Item | undefined> {
    return (await this.ctx.doc.send(new GetCommand({ TableName: this.t, Key: listingKey(id) }))).Item;
  }

  async hostProfile(hostId: string): Promise<HostProfile | undefined> {
    return (await this.ctx.doc.send(new GetCommand({ TableName: this.t, Key: userKey(hostId) }))).Item as HostProfile | undefined;
  }

  /** Stored night items for the stay (sparse: a missing date is FREE at the base price). */
  async nightItems(listingId: string, nights: string[]): Promise<Map<string, Item>> {
    const out = new Map<string, Item>();
    let start: Item | undefined;
    do {
      const r = await this.ctx.doc.send(
        new QueryCommand({
          TableName: this.t,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
          ExpressionAttributeValues: {
            ":pk": `LISTING#${listingId}`,
            ":a": nightSk(nights[0]!),
            ":b": nightSk(nights[nights.length - 1]!),
          },
          ExclusiveStartKey: start,
        }),
      );
      for (const it of r.Items ?? []) out.set(String(it.SK).slice("NIGHT#".length), it);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }

  async getIdempotency(userId: string, key: string): Promise<IdempotencyRecord | undefined> {
    const r = await this.ctx.doc.send(new GetCommand({ TableName: this.t, Key: idempotencyKey(userId, key) }));
    return r.Item as IdempotencyRecord | undefined;
  }

  async get(bookingId: string): Promise<BookingRecord | undefined> {
    const r = await this.ctx.doc.send(new GetCommand({ TableName: this.t, Key: bookingKey(bookingId), ConsistentRead: true }));
    return r.Item ? toRecord(r.Item) : undefined;
  }

  /**
   * One atomic transaction: claim the idempotency key, create the booking, and HOLD every night.
   * A night can be held if it has no item (FREE), is FREE, or carries a lapsed hold. BLOCKED, BOOKED
   * and live holds make the whole transaction fail, so two guests can never hold the same night.
   */
  /**
   * Holds the nights. DynamoDB may cancel a transaction that collides with a concurrent one
   * ("TransactionConflict") without any condition failing; nothing was written, so retry briefly.
   * The retry then sees the winner's nights and fails cleanly with DATES.
   */
  async reserve(b: BookingRecord, idem: { userId: string; key: string; requestHash: string }, now: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.reserveOnce(b, idem, now);
      } catch (e) {
        const reasons = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code);
        const conflictOnly = (e as { name?: string }).name === "TransactionCanceledException" && reasons.includes("TransactionConflict") && !reasons.includes("ConditionalCheckFailed");
        if (!conflictOnly || attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 35 * (attempt + 1)));
      }
    }
  }

  private async reserveOnce(b: BookingRecord, idem: { userId: string; key: string; requestHash: string }, now: number): Promise<void> {
    if (b.nights.length > 98) throw new RangeError("too many nights for one transaction"); // 100-item limit
    const createdAtEpoch = Math.floor(Date.parse(b.createdAt) / 1000);
    try {
      await this.ctx.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.t,
                Item: {
                  ...idempotencyKey(idem.userId, idem.key),
                  bookingId: b.bookingId,
                  requestHash: idem.requestHash,
                  createdAt: createdAtEpoch,
                  ttl: now + 86_400,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Put: {
                TableName: this.t,
                Item: {
                  ...bookingKey(b.bookingId),
                  entity: "Booking",
                  ...guestBookingGsiKeys(b.guestId, b.createdAt, b.bookingId),
                  ...hostBookingGsiKeys(b.hostId, b.checkIn, b.bookingId),
                  ...holdGsiKeys(b.bookingId, b.holdExpiresAt!),
                  ...b,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            ...b.nights.map((date) => ({
              Update: {
                TableName: this.t,
                Key: nightKey(b.listingId, date),
                UpdateExpression: "SET #s = :held, bookingId = :b, holdExpiresAt = :exp, #ttl = :ttl",
                ConditionExpression: "attribute_not_exists(SK) OR #s = :free OR (#s = :held AND holdExpiresAt < :now)",
                ExpressionAttributeNames: { "#s": "status", "#ttl": "ttl" },
                ExpressionAttributeValues: {
                  ":held": "HELD",
                  ":free": "FREE",
                  ":b": b.bookingId,
                  ":exp": b.holdExpiresAt!,
                  ":now": now,
                  ":ttl": nightTtl(date),
                },
              },
            })),
          ],
        }),
      );
    } catch (e) {
      if ((e as { name?: string }).name !== "TransactionCanceledException") throw e;
      const reasons = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code);
      if (reasons[0] === "ConditionalCheckFailed") throw new ReserveConflict("IDEMPOTENCY");
      const dates = b.nights.filter((_, i) => reasons[i + 2] === "ConditionalCheckFailed");
      if (dates.length) throw new ReserveConflict("DATES", dates);
      throw e; // e.g. TransactionConflict: let the client retry
    }
  }

  /** Records the Razorpay order on the booking and writes the order -> booking pointer for the webhook. */
  async attachOrder(bookingId: string, orderId: string): Promise<void> {
    await this.ctx.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.t,
              Key: bookingKey(bookingId),
              UpdateExpression: "SET orderId = :o, updatedAt = :now",
              ConditionExpression: "#s = :pending AND attribute_not_exists(orderId)",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":o": orderId, ":pending": "PENDING_PAYMENT", ":now": new Date().toISOString() },
            },
          },
          {
            Put: {
              TableName: this.t,
              Item: { ...orderKey(orderId), bookingId },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      }),
    );
  }

  /**
   * Request accepted: REQUESTED -> PENDING_PAYMENT with the order attached, a new payment deadline on
   * the booking (and its GSI4 hold entry) and on every night it holds, all or nothing.
   */
  async acceptRequest(b: BookingRecord, orderId: string, payBy: number, now: Date): Promise<BookingRecord> {
    const at = now.toISOString();
    await this.ctx.doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.t,
              Key: bookingKey(b.bookingId),
              UpdateExpression: "SET #s = :pending, orderId = :o, holdExpiresAt = :exp, acceptedAt = :at, updatedAt = :at, GSI4PK = :g4pk, GSI4SK = :g4sk",
              ConditionExpression: "#s = :requested AND attribute_not_exists(orderId)",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":pending": "PENDING_PAYMENT", ":requested": "REQUESTED", ":o": orderId, ":exp": payBy, ":at": at, ":g4pk": holdGsiKeys(b.bookingId, payBy).GSI4PK, ":g4sk": holdGsiKeys(b.bookingId, payBy).GSI4SK },
            },
          },
          { Put: { TableName: this.t, Item: { ...orderKey(orderId), bookingId: b.bookingId }, ConditionExpression: "attribute_not_exists(PK)" } },
          ...b.nights.map((date) => ({
            Update: {
              TableName: this.t,
              Key: nightKey(b.listingId, date),
              UpdateExpression: "SET holdExpiresAt = :exp",
              ConditionExpression: "bookingId = :b AND #s = :held",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":exp": payBy, ":b": b.bookingId, ":held": "HELD" },
            },
          })),
        ],
      }),
    );
    return (await this.get(b.bookingId))!;
  }

  /** Compensation when the order could not be created: free the hold and the idempotency key so the client can retry. */
  async abandonUnpaid(b: BookingRecord, idem: { userId: string; key: string }, reason: string): Promise<void> {
    try {
      await this.transition(b.bookingId, ["PENDING_PAYMENT"], "EXPIRED", { expiredReason: reason }, ["GSI4PK", "GSI4SK"]);
    } catch (e) {
      if (!isConditionalFailure(e)) throw e;
    }
    await this.ctx.doc.send(new DeleteCommand({ TableName: this.t, Key: idempotencyKey(idem.userId, idem.key) }));
  }

  /** Conditional status change. Throws ConditionalCheckFailedException if the booking is not in `from`. */
  async transition(
    bookingId: string,
    from: BookingStatus[],
    to: BookingStatus,
    set: Record<string, NativeAttributeValue> = {},
    remove: string[] = [],
  ): Promise<BookingRecord> {
    const names: Record<string, string> = { "#s": "status" };
    const values: Record<string, NativeAttributeValue> = { ":to": to, ":now": new Date().toISOString() };
    from.forEach((s, i) => (values[`:f${i}`] = s));
    const sets = ["#s = :to", "updatedAt = :now"];
    Object.entries(set).forEach(([k, v], i) => {
      names[`#a${i}`] = k;
      values[`:a${i}`] = v;
      sets.push(`#a${i} = :a${i}`);
    });
    const r = await this.ctx.doc.send(
      new UpdateCommand({
        TableName: this.t,
        Key: bookingKey(bookingId),
        UpdateExpression: `SET ${sets.join(", ")}${remove.length ? ` REMOVE ${remove.join(", ")}` : ""}`,
        ConditionExpression: `#s IN (${from.map((_, i) => `:f${i}`).join(", ")})`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return toRecord(r.Attributes!);
  }

  async markCancelled(b: BookingRecord, decision: RefundDecision | null, by: "guest" | "host" | "admin"): Promise<BookingRecord> {
    const set: Record<string, NativeAttributeValue> = { cancelledAt: new Date().toISOString(), cancelledBy: by };
    if (decision) {
      set.refundPaise = decision.refundPaise;
      set.hostReversalPaise = decision.hostReversalPaise;
      set.cancelRule = decision.rule;
      if (decision.refundPaise > 0) set.refundStatus = "PENDING";
    }
    return this.transition(b.bookingId, [b.status], "CANCELLED", set, b.status === "PENDING_PAYMENT" ? ["GSI4PK", "GSI4SK"] : []);
  }

  // ---------- refund bookkeeping (a tiny state machine so a refund is never sent twice) ----------

  /** PENDING|FAILED -> IN_PROGRESS. Returns false if another worker already owns the refund. */
  async beginRefund(bookingId: string): Promise<boolean> {
    try {
      await this.ctx.doc.send(
        new UpdateCommand({
          TableName: this.t,
          Key: bookingKey(bookingId),
          UpdateExpression: "SET refundStatus = :ip, updatedAt = :now REMOVE refundError",
          ConditionExpression: "refundStatus IN (:pending, :failed)",
          ExpressionAttributeValues: { ":ip": "IN_PROGRESS", ":pending": "PENDING", ":failed": "FAILED", ":now": new Date().toISOString() },
        }),
      );
      return true;
    } catch (e) {
      if (isConditionalFailure(e)) return false;
      throw e;
    }
  }

  async setRefundFields(bookingId: string, fields: Record<string, NativeAttributeValue>): Promise<BookingRecord> {
    const names: Record<string, string> = {};
    const values: Record<string, NativeAttributeValue> = { ":now": new Date().toISOString() };
    const sets = ["updatedAt = :now"];
    Object.entries(fields).forEach(([k, v], i) => {
      names[`#r${i}`] = k;
      values[`:r${i}`] = v;
      sets.push(`#r${i} = :r${i}`);
    });
    const r = await this.ctx.doc.send(
      new UpdateCommand({
        TableName: this.t,
        Key: bookingKey(bookingId),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return toRecord(r.Attributes!);
  }

  // ---------- lists ----------

  async listByGuest(guestId: string, limit: number, cursor?: string) {
    const r = await this.ctx.doc.send(
      new QueryCommand({
        TableName: this.t,
        IndexName: GSI.guestBookings,
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
        ExpressionAttributeValues: { ":pk": `GUEST#${guestId}`, ":sk": "BOOKING#" },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []).map(toRecord), nextCursor: encodeCursor(r.LastEvaluatedKey) };
  }

  /** Host reservations by check-in date. Unpaid and expired holds are hidden from hosts. */
  async listByHost(hostId: string, limit: number, cursor?: string) {
    const r = await this.ctx.doc.send(
      new QueryCommand({
        TableName: this.t,
        IndexName: GSI.hostItems,
        KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :sk)",
        FilterExpression: "NOT (#s IN (:pending, :expired))",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":pk": `HOST#${hostId}`, ":sk": "BOOKING#", ":pending": "PENDING_PAYMENT", ":expired": "EXPIRED" },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []).map(toRecord), nextCursor: encodeCursor(r.LastEvaluatedKey) };
  }
}
