import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  bookingKey,
  epochPad,
  GSI,
  HOLD_SHARDS,
  isConditionalFailure,
  releaseNights,
  type BookingRecord,
  type DdbContext,
} from "@mp/shared";

export interface ExpirerDeps {
  ddb: DdbContext;
  /** Epoch seconds. */
  clock: () => number;
  /**
   * Extra time after holdExpiresAt before a hold is closed. Search and new bookings already treat a
   * lapsed hold as free; the grace only gives an in-flight payment time to land before we say "expired".
   */
  graceSeconds: number;
  maxPerRun: number;
  log: (msg: string, ctx?: object) => void;
}

export interface ExpirerResult {
  expired: number;
  nightsReleased: number;
  nightsSkipped: number;
}

/**
 * Closes unpaid holds (PENDING_PAYMENT -> EXPIRED) and unanswered booking requests (REQUESTED -> DECLINED),
 * then deletes the HELD night items they still own.
 * Reads the sparse GSI4 (only pending bookings have it), one query per shard.
 * Safe to run concurrently or twice: every write is conditional.
 */
export async function expireHolds(deps: ExpirerDeps): Promise<ExpirerResult> {
  const { ddb } = deps;
  const cutoff = deps.clock() - deps.graceSeconds;
  const result: ExpirerResult = { expired: 0, nightsReleased: 0, nightsSkipped: 0 };
  let budget = deps.maxPerRun;

  for (let shard = 0; shard < HOLD_SHARDS && budget > 0; shard++) {
    let start: Record<string, unknown> | undefined;
    do {
      const page = await ddb.doc.send(
        new QueryCommand({
          TableName: ddb.table,
          IndexName: GSI.holds,
          KeyConditionExpression: "GSI4PK = :pk AND GSI4SK < :cutoff",
          ExpressionAttributeValues: { ":pk": `HOLD#${shard}`, ":cutoff": epochPad(cutoff) },
          Limit: Math.min(budget, 100),
          ExclusiveStartKey: start,
        }),
      );
      for (const key of page.Items ?? []) {
        if (budget-- <= 0) break;
        const bookingId = String(key.PK).slice("BOOKING#".length);
        const b = (await ddb.doc.send(new GetCommand({ TableName: ddb.table, Key: bookingKey(bookingId), ConsistentRead: true })))
          .Item as BookingRecord | undefined;
        if (!b) continue;
        try {
          await ddb.doc.send(
            new UpdateCommand({
              TableName: ddb.table,
              Key: bookingKey(bookingId),
              // An unanswered request ends as DECLINED (the host didn't respond); an unpaid hold as EXPIRED.
              UpdateExpression: "SET #s = :to, expiredReason = :r, updatedAt = :now REMOVE GSI4PK, GSI4SK",
              ConditionExpression: "#s = :from AND holdExpiresAt < :cutoff",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: {
                ":to": b.status === "REQUESTED" ? "DECLINED" : "EXPIRED",
                ":from": b.status === "REQUESTED" ? "REQUESTED" : "PENDING_PAYMENT",
                ":r": b.status === "REQUESTED" ? "REQUEST_NOT_ANSWERED" : "HOLD_LAPSED",
                ":cutoff": cutoff,
                ":now": new Date(deps.clock() * 1000).toISOString(),
              },
            }),
          );
        } catch (e) {
          if (isConditionalFailure(e)) continue; // paid or cancelled meanwhile
          throw e;
        }
        result.expired++;
        const nights = await releaseNights(ddb, b.listingId, b.nights, b.bookingId, ["HELD"]);
        result.nightsReleased += nights.released.length;
        result.nightsSkipped += nights.skipped.length;
      }
      start = page.LastEvaluatedKey;
    } while (start && budget > 0);
  }

  if (result.expired) deps.log("holds expired", { ...result });
  return result;
}
