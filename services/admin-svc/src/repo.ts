import { BatchGetCommand, GetCommand, QueryCommand, type NativeAttributeValue } from "@aws-sdk/lib-dynamodb";
import { decodeCursor, encodeCursor, metricDayKey, userKey, type DdbContext, type OpsQueue } from "@mp/shared";

type Item = Record<string, NativeAttributeValue>;

/** Attributes that are storage plumbing, never shown to staff. */
const INTERNAL = new Set(["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK", "GSI4PK", "GSI4SK", "GSI5PK", "GSI5SK", "entity", "ttl"]);
export const clean = (i: Item) => Object.fromEntries(Object.entries(i).filter(([k]) => !INTERNAL.has(k)));

export class AdminRepo {
  constructor(private readonly ddb: DdbContext) {}

  /** Newest first. */
  async queue(q: OpsQueue, limit: number, cursor?: string) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.ddb.table,
        IndexName: "GSI5",
        KeyConditionExpression: "GSI5PK = :q",
        ExpressionAttributeValues: { ":q": `QUEUE#${q}` },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []).map(clean), nextCursor: encodeCursor(r.LastEvaluatedKey) ?? null };
  }

  /** Size of a queue, counting at most `cap` entries (keeps the read bounded). */
  async queueSize(q: OpsQueue, cap = 1000): Promise<{ count: number; more: boolean }> {
    let count = 0;
    let start: Item | undefined;
    do {
      const r = await this.ddb.doc.send(
        new QueryCommand({ TableName: this.ddb.table, IndexName: "GSI5", KeyConditionExpression: "GSI5PK = :q", ExpressionAttributeValues: { ":q": `QUEUE#${q}` }, Select: "COUNT", Limit: cap - count, ExclusiveStartKey: start }),
      );
      count += r.Count ?? 0;
      start = r.LastEvaluatedKey;
    } while (start && count < cap);
    return { count, more: !!start };
  }

  async metricDays(from: string, to: string): Promise<Map<string, Item>> {
    const out = new Map<string, Item>();
    let start: Item | undefined;
    do {
      const r = await this.ddb.doc.send(
        new QueryCommand({
          TableName: this.ddb.table,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":pk": metricDayKey(from).PK, ":a": from, ":b": to },
          ExclusiveStartKey: start,
        }),
      );
      for (const i of r.Items ?? []) out.set(i.SK as string, i);
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }

  async profile(userId: string) {
    const r = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: userKey(userId) }));
    return r.Item ? clean(r.Item) : null;
  }

  /** A host's listings (GSI2 LISTING#) or bookings (GSI2 BOOKING#, latest check-in first). */
  async hostItems(hostId: string, prefix: "LISTING#" | "BOOKING#", limit: number) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.ddb.table,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :p)",
        ExpressionAttributeValues: { ":pk": `HOST#${hostId}`, ":p": prefix },
        ScanIndexForward: prefix === "LISTING#",
        Limit: limit,
      }),
    );
    return (r.Items ?? []).map(clean);
  }

  async guestBookings(guestId: string, limit: number) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.ddb.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :p)",
        ExpressionAttributeValues: { ":pk": `GUEST#${guestId}`, ":p": "BOOKING#" },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (r.Items ?? []).map(clean);
  }

  /** Profiles for many users at once (for names in queue rows). */
  async profiles(ids: string[]): Promise<Map<string, Item>> {
    const out = new Map<string, Item>();
    const unique = [...new Set(ids)].slice(0, 100);
    if (!unique.length) return out;
    const r = await this.ddb.doc.send(new BatchGetCommand({ RequestItems: { [this.ddb.table]: { Keys: unique.map(userKey), ProjectionExpression: "userId, displayName, legalBusinessName" } } }));
    for (const i of r.Responses?.[this.ddb.table] ?? []) out.set(i.userId as string, i);
    return out;
  }

  async audit(month: string, limit: number, cursor?: string) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.ddb.table,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `AUDIT#${month}` },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []).map(clean), nextCursor: encodeCursor(r.LastEvaluatedKey) ?? null };
  }
}
