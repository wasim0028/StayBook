import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { decodeCursor, encodeCursor, isConditionalFailure, type DdbContext } from "@mp/shared";

/** A host's review of a guest after a stay (Airbnb's two-way reviews). */
export interface GuestReview {
  bookingId: string;
  guestId: string;
  hostId: string;
  hostName: string;
  listingTitle: string;
  rating: number;
  comment: string;
  createdAt: string;
}

const sk = (createdAt: string, bookingId: string) => `GREVIEW#${createdAt}#${bookingId}`;
const guardKey = (bookingId: string) => ({ PK: `BOOKING#${bookingId}`, SK: "GUESTREVIEW" });
const aggKey = (guestId: string) => ({ PK: `USER#${guestId}`, SK: "GUESTRATING" });

export class AlreadyReviewedGuest extends Error {}

export class GuestReviewRepo {
  constructor(private readonly ddb: DdbContext) {}

  async create(r: Omit<GuestReview, "createdAt">, now: Date): Promise<GuestReview> {
    const review: GuestReview = { ...r, createdAt: now.toISOString() };
    for (let attempt = 0; attempt < 8; attempt++) {
      const cur = (await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: aggKey(r.guestId), ConsistentRead: true }))).Item;
      const count = Number(cur?.ratingCount ?? 0);
      const sum = Number(cur?.ratingSum ?? 0) + r.rating;
      try {
        await this.ddb.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              { Put: { TableName: this.ddb.table, Item: { ...guardKey(r.bookingId), guestId: r.guestId, sk: sk(review.createdAt, r.bookingId) }, ConditionExpression: "attribute_not_exists(PK)" } },
              { Put: { TableName: this.ddb.table, Item: { PK: `USER#${r.guestId}`, SK: sk(review.createdAt, r.bookingId), entity: "GUESTREVIEW", ...review } } },
              {
                Update: {
                  TableName: this.ddb.table,
                  Key: aggKey(r.guestId),
                  UpdateExpression: "SET ratingSum = :s, ratingCount = :c, ratingAvg = :a",
                  ConditionExpression: count === 0 ? "attribute_not_exists(ratingCount)" : "ratingCount = :old",
                  ExpressionAttributeValues: { ":s": sum, ":c": count + 1, ":a": Math.round((sum / (count + 1)) * 100) / 100, ...(count ? { ":old": count } : {}) },
                },
              },
            ],
          }),
        );
        return review;
      } catch (e) {
        if (!isConditionalFailure(e)) throw e;
        const reasons = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((x) => x.Code);
        if (reasons[0] === "ConditionalCheckFailed") throw new AlreadyReviewedGuest();
        await new Promise((res) => setTimeout(res, 20 + Math.random() * 40 * (attempt + 1)));
      }
    }
    throw new Error("could not update guest rating");
  }

  async byBooking(bookingId: string): Promise<GuestReview | undefined> {
    const g = (await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: guardKey(bookingId) }))).Item;
    if (!g) return undefined;
    return (await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: { PK: `USER#${g.guestId}`, SK: g.sk } }))).Item as GuestReview | undefined;
  }

  async forGuest(guestId: string, limit: number, cursor?: string) {
    const [agg, r] = await Promise.all([
      this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: aggKey(guestId) })).then((x) => x.Item),
      this.ddb.doc.send(
        new QueryCommand({
          TableName: this.ddb.table,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
          ExpressionAttributeValues: { ":pk": `USER#${guestId}`, ":p": "GREVIEW#" },
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: decodeCursor(cursor),
        }),
      ),
    ]);
    return {
      ratingAvg: agg?.ratingAvg ?? null,
      ratingCount: Number(agg?.ratingCount ?? 0),
      items: (r.Items ?? []) as GuestReview[],
      nextCursor: encodeCursor(r.LastEvaluatedKey) ?? null,
    };
  }

  /** Has this host ever had a booking or request from this guest? (who may read the guest's reviews) */
  async hostKnowsGuest(hostId: string, guestId: string): Promise<boolean> {
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.ddb.doc.send(
        new QueryCommand({
          TableName: this.ddb.table,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :b)",
          FilterExpression: "hostId = :h",
          ExpressionAttributeValues: { ":pk": `GUEST#${guestId}`, ":b": "BOOKING#", ":h": hostId },
          ProjectionExpression: "bookingId",
          ExclusiveStartKey: start,
        }),
      );
      if (r.Items?.length) return true;
      start = r.LastEvaluatedKey;
    } while (start);
    return false;
  }
}
