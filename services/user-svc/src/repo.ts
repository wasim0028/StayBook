import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { decodeCursor, encodeCursor, listingKey, userKey, type DdbContext, type RazorpayAccountStatus } from "@mp/shared";

export type OnboardingStep = "account" | "stakeholder" | "product" | "settlement" | "done";

export interface UserProfile {
  userId: string;
  displayName?: string;
  bio?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
  // host fields (read by listing-svc and booking-svc: keep these names)
  razorpayAccountId?: string;
  razorpayProductId?: string;
  razorpayAccountStatus?: RazorpayAccountStatus;
  onboardingStep?: OnboardingStep;
  legalBusinessName?: string;
  gstin?: string;
  bankLast4?: string;
  hostSince?: string;
}

/** Razorpay account id -> user id, so account.* webhooks can find the host. */
export const rzpAccountKey = (accountId: string) => ({ PK: `RZPACC#${accountId}`, SK: "META" });
const wishKey = (userId: string, listingId: string) => ({ PK: `USER#${userId}`, SK: `WISH#${listingId}` });

export class UserRepo {
  constructor(private readonly ddb: DdbContext) {}

  async get(userId: string): Promise<UserProfile | undefined> {
    const r = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: userKey(userId), ConsistentRead: true }));
    return r.Item as UserProfile | undefined;
  }

  /** Creates the profile on first use. Safe under concurrent first requests. */
  async ensure(userId: string): Promise<UserProfile> {
    const existing = await this.get(userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const item: UserProfile & { PK: string; SK: string; entity: string } = {
      ...userKey(userId),
      entity: "USER",
      userId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.ddb.doc.send(new PutCommand({ TableName: this.ddb.table, Item: item, ConditionExpression: "attribute_not_exists(PK)" }));
    } catch (e) {
      if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
    }
    return (await this.get(userId))!;
  }

  async update(userId: string, patch: Record<string, unknown>): Promise<UserProfile> {
    await this.ensure(userId);
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ":at": new Date().toISOString() };
    const sets = ["updatedAt = :at"];
    entries.forEach(([k, v], i) => {
      names[`#k${i}`] = k;
      values[`:v${i}`] = v;
      sets.push(`#k${i} = :v${i}`);
    });
    const r = await this.ddb.doc.send(
      new UpdateCommand({
        TableName: this.ddb.table,
        Key: userKey(userId),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return r.Attributes as UserProfile;
  }

  async linkAccount(accountId: string, userId: string): Promise<void> {
    await this.ddb.doc.send(new PutCommand({ TableName: this.ddb.table, Item: { ...rzpAccountKey(accountId), userId } }));
  }

  async userForAccount(accountId: string): Promise<string | undefined> {
    const r = await this.ddb.doc.send(new GetCommand({ TableName: this.ddb.table, Key: rzpAccountKey(accountId) }));
    return r.Item?.userId as string | undefined;
  }

  // ---------- wishlist ----------

  async addWish(userId: string, listingId: string): Promise<void> {
    await this.ddb.doc.send(
      new PutCommand({
        TableName: this.ddb.table,
        Item: { ...wishKey(userId, listingId), listingId, createdAt: new Date().toISOString() },
        ConditionExpression: "attribute_not_exists(PK)", // keeps the original timestamp on repeats
      }),
    ).catch((e) => {
      if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
    });
  }

  async removeWish(userId: string, listingId: string): Promise<void> {
    await this.ddb.doc.send(new DeleteCommand({ TableName: this.ddb.table, Key: wishKey(userId, listingId) }));
  }

  async listWishIds(userId: string, limit: number, cursor?: string) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.ddb.table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :p)",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":p": "WISH#" },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { ids: (r.Items ?? []).map((i) => i.listingId as string), nextCursor: encodeCursor(r.LastEvaluatedKey) };
  }

  async getListings(ids: string[]): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    const r = await this.ddb.doc.send(
      new BatchGetCommand({ RequestItems: { [this.ddb.table]: { Keys: ids.map(listingKey) } } }),
    );
    const byId = new Map((r.Responses?.[this.ddb.table] ?? []).map((i) => [i.id as string, i]));
    return ids.map((id) => byId.get(id)).filter((x): x is Record<string, unknown> => !!x);
  }
}
