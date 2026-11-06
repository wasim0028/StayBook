import { GetCommand, QueryCommand, UpdateCommand, type NativeAttributeValue } from "@aws-sdk/lib-dynamodb";
import { addDays, hostStatsKey, isConditionalFailure, listingKey, userKey, type DdbContext } from "@mp/shared";

type Item = Record<string, NativeAttributeValue>;

/**
 * Superhost, as Airbnb defines it, over the last 365 days:
 *   - 10+ completed stays, or 3+ stays totalling 100+ nights
 *   - overall rating 4.8+ (from the host's listing ratings, with at least MIN_REVIEWS reviews)
 *   - cancellation rate under 1% (host-initiated cancellations / stays)
 *   - response rate 90%+ (replies within 24h; hosts nobody has messaged aren't penalised)
 */
export const CRITERIA = { stays: 10, staysForNights: 3, nights: 100, rating: 4.8, minReviews: 3, maxCancelRate: 0.01, responseRate: 0.9 };

export interface HostStats {
  stays: number;
  nights: number;
  hostCancellations: number;
  cancellationRate: number;
  ratingAvg: number | null;
  reviews: number;
  responseRate: number | null;
  responses: number;
}

export function qualifies(s: HostStats): boolean {
  const enoughStays = s.stays >= CRITERIA.stays || (s.stays >= CRITERIA.staysForNights && s.nights >= CRITERIA.nights);
  const rated = s.reviews >= CRITERIA.minReviews && (s.ratingAvg ?? 0) >= CRITERIA.rating;
  const reliable = s.cancellationRate < CRITERIA.maxCancelRate;
  const responsive = s.responseRate === null || s.responseRate >= CRITERIA.responseRate;
  return enoughStays && rated && reliable && responsive;
}

async function queryAll(ddb: DdbContext, input: Omit<ConstructorParameters<typeof QueryCommand>[0], "TableName" | "ExclusiveStartKey">): Promise<Item[]> {
  const out: Item[] = [];
  let start: Item | undefined;
  do {
    const r = await ddb.doc.send(new QueryCommand({ TableName: ddb.table, ...input, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** Hosts with at least one live listing (from ops-indexer's listings-published queue). */
export async function activeHosts(ddb: DdbContext): Promise<string[]> {
  const items = await queryAll(ddb, { IndexName: "GSI5", KeyConditionExpression: "GSI5PK = :q", ExpressionAttributeValues: { ":q": "QUEUE#listings-published" }, ProjectionExpression: "hostId" });
  return [...new Set(items.map((i) => String(i.hostId)).filter(Boolean))];
}

export async function statsFor(ddb: DdbContext, hostId: string, today: string): Promise<{ stats: HostStats; listingIds: string[] }> {
  const yearAgo = addDays(today, -365);
  const [bookings, listings, counters] = await Promise.all([
    queryAll(ddb, {
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :pk AND GSI2SK BETWEEN :a AND :b",
      ExpressionAttributeValues: { ":pk": `HOST#${hostId}`, ":a": `BOOKING#${yearAgo}`, ":b": `BOOKING#${today}~` },
    }),
    queryAll(ddb, { IndexName: "GSI2", KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :p)", ExpressionAttributeValues: { ":pk": `HOST#${hostId}`, ":p": "LISTING#" } }),
    ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: hostStatsKey(hostId) })).then((r) => r.Item ?? {}),
  ]);
  let stays = 0;
  let nights = 0;
  let hostCancellations = 0;
  for (const b of bookings) {
    const done = ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(String(b.status)) && String(b.checkOut) <= today;
    if (done) {
      stays++;
      nights += Array.isArray(b.nights) ? b.nights.length : 0;
    }
    if (b.status === "CANCELLED" && b.cancelledBy === "host") hostCancellations++;
  }
  let reviews = 0;
  let ratingSum = 0;
  for (const l of listings) {
    const n = Number(l.ratingCount ?? 0);
    reviews += n;
    ratingSum += Number(l.ratingAvg ?? 0) * n;
  }
  const responses = Number(counters.responses ?? 0);
  const stats: HostStats = {
    stays,
    nights,
    hostCancellations,
    cancellationRate: stays + hostCancellations ? hostCancellations / (stays + hostCancellations) : 0,
    ratingAvg: reviews ? Math.round((ratingSum / reviews) * 100) / 100 : null,
    reviews,
    responses,
    responseRate: responses ? Number(counters.responsesOnTime ?? 0) / responses : null,
  };
  return { stats, listingIds: listings.map((l) => String(l.id)) };
}

export async function evaluateHost(ddb: DdbContext, hostId: string, today: string, nowIso: string): Promise<{ superhost: boolean; changed: boolean }> {
  const { stats, listingIds } = await statsFor(ddb, hostId, today);
  const superhost = qualifies(stats);
  const prev = (await ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: userKey(hostId), ProjectionExpression: "superhost" }))).Item;
  const changed = !!prev?.superhost !== superhost;
  await ddb.doc.send(
    new UpdateCommand({
      TableName: ddb.table,
      Key: userKey(hostId),
      UpdateExpression: `SET superhost = :s, hostStats = :st, hostStatsAt = :at${superhost && changed ? ", superhostSince = :at" : ""}${!superhost ? " REMOVE superhostSince" : ""}`,
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":s": superhost, ":st": stats, ":at": nowIso },
    }),
  ).catch((e) => {
    if (!isConditionalFailure(e)) throw e; // profile gone: nothing to badge
  });
  // Denormalise onto the listings so search and listing pages show the badge without a lookup.
  for (const id of listingIds) {
    await ddb.doc
      .send(
        new UpdateCommand({
          TableName: ddb.table,
          Key: listingKey(id),
          UpdateExpression: "SET hostSuperhost = :s",
          ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(hostSuperhost) OR hostSuperhost <> :s)",
          ExpressionAttributeValues: { ":s": superhost },
        }),
      )
      .catch((e) => {
        if (!isConditionalFailure(e)) throw e; // already up to date
      });
  }
  return { superhost, changed };
}

export async function evaluateAll(ddb: DdbContext, now: Date, log: (m: string, c?: object) => void = () => {}) {
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const hosts = await activeHosts(ddb);
  let superhosts = 0;
  let changes = 0;
  for (const h of hosts) {
    const r = await evaluateHost(ddb, h, today, now.toISOString());
    if (r.superhost) superhosts++;
    if (r.changed) changes++;
  }
  log("hosts evaluated", { hosts: hosts.length, superhosts, changes });
  return { hosts: hosts.length, superhosts, changes };
}
