import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  bookingKey,
  decodeCursor,
  encodeCursor,
  isConditionalFailure,
  listingKey,
  userKey,
  type BookingRecord,
  type DdbContext,
} from "@mp/shared";

export interface Review {
  listingId: string;
  bookingId: string;
  guestId: string;
  hostId: string;
  guestName: string;
  rating: number;
  comment: string;
  createdAt: string;
  hostReply?: string;
  hostRepliedAt?: string;
}

const reviewSk = (createdAt: string, bookingId: string) => `REVIEW#${createdAt}#${bookingId}`;
/** One-per-booking guard that also points at the review. */
const guardKey = (bookingId: string) => ({ PK: `BOOKING#${bookingId}`, SK: "REVIEW" });

export class AlreadyReviewed extends Error {}

const MAX_RETRIES = 8;

export class ReviewRepo {
  constructor(private readonly ddb: DdbContext) {}

  async getBooking(id: string): Promise<BookingRecord | undefined> {
    const r = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: bookingKey(id), ConsistentRead: true }));
    return r.Item as BookingRecord | undefined;
  }

  async guestName(userId: string): Promise<string> {
    const r = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: userKey(userId) }));
    const name = (r.Item?.displayName as string | undefined)?.trim();
    return name || "Guest";
  }

  /**
   * One transaction: guard (once per booking) + review + the listing's rating aggregate.
   * The aggregate is read-modify-write guarded by the previous count, so concurrent reviews of one
   * listing retry instead of losing an update.
   */
  async create(r: Omit<Review, "createdAt">, now: Date): Promise<Review> {
    const createdAt = now.toISOString();
    const review: Review = { ...r, createdAt };
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const cur = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: listingKey(r.listingId), ConsistentRead: true }));
      if (!cur.Item) throw new Error("listing missing");
      const count = Number(cur.Item.ratingCount ?? 0);
      const sum = Number(cur.Item.ratingSum ?? 0);
      const newCount = count + 1;
      const newSum = sum + r.rating;
      try {
        await this.ddb.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.ddb.table,
                  Item: { ...guardKey(r.bookingId), entity: "REVIEWGUARD", listingId: r.listingId, reviewSk: reviewSk(createdAt, r.bookingId), rating: r.rating },
                  ConditionExpression: "attribute_not_exists(PK)",
                },
              },
              {
                Put: {
                  TableName: this.ddb.table,
                  Item: { PK: `LISTING#${r.listingId}`, SK: reviewSk(createdAt, r.bookingId), entity: "REVIEW", ...review },
                },
              },
              {
                Update: {
                  TableName: this.ddb.table,
                  Key: listingKey(r.listingId),
                  UpdateExpression: "SET ratingSum = :s, ratingCount = :c, ratingAvg = :a",
                  ConditionExpression: count === 0 ? "attribute_exists(PK) AND attribute_not_exists(ratingCount)" : "ratingCount = :old",
                  ExpressionAttributeValues: {
                    ":s": newSum,
                    ":c": newCount,
                    ":a": Math.round((newSum / newCount) * 100) / 100,
                    ...(count === 0 ? {} : { ":old": count }),
                  },
                },
              },
            ],
          }),
        );
        return review;
      } catch (e) {
        if (!isConditionalFailure(e)) throw e;
        const reasons = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((x) => x.Code);
        if (reasons[0] === "ConditionalCheckFailed") throw new AlreadyReviewed();
        // else the aggregate moved under us (or a transaction conflict): re-read and try again
        await new Promise((res) => setTimeout(res, 20 + Math.random() * 40 * (attempt + 1)));
      }
    }
    throw new Error("could not update rating aggregate");
  }

  async byBooking(bookingId: string): Promise<Review | undefined> {
    const g = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: guardKey(bookingId) }));
    if (!g.Item) return undefined;
    const r = await this.ddb.doc.send(
      new GetCommand({ TableName: this.ddb.table, Key: { PK: `LISTING#${g.Item.listingId}`, SK: g.Item.reviewSk } }),
    );
    return r.Item as Review | undefined;
  }

  async listForListing(listingId: string, limit: number, cursor?: string) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.ddb.table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": `LISTING#${listingId}`, ":p": "REVIEW#" },
        ScanIndexForward: false, // newest first
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []) as (Review & { SK: string })[], nextCursor: encodeCursor(r.LastEvaluatedKey) };
  }

  /** Host reply, once. Returns false if the review already has a reply or the host doesn't own it. */
  async reply(review: Review & { SK?: string }, hostId: string, text: string, now: Date): Promise<boolean> {
    const g = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: guardKey(review.bookingId) }));
    if (!g.Item) return false;
    try {
      await this.ddb.doc.send(
        new UpdateCommand({
          TableName: this.ddb.table,
          Key: { PK: `LISTING#${g.Item.listingId}`, SK: g.Item.reviewSk },
          UpdateExpression: "SET hostReply = :t, hostRepliedAt = :at",
          ConditionExpression: "hostId = :h AND attribute_not_exists(hostReply)",
          ExpressionAttributeValues: { ":t": text, ":at": now.toISOString(), ":h": hostId },
        }),
      );
      return true;
    } catch (e) {
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw e;
    }
  }
}
