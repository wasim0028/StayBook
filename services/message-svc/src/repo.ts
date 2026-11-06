import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, DeleteCommand, type NativeAttributeValue } from "@aws-sdk/lib-dynamodb";
import {
  bookingKey,
  decodeCursor,
  encodeCursor,
  inboxGsiKeys,
  hostStatsKey,
  inboxStateKey,
  RESPONSE_WINDOW_SECONDS,
  listingKey,
  messageGuardKey,
  messageSk,
  participantKey,
  pushTokenKey,
  threadIdOf,
  threadKey,
  userKey,
  type DdbContext,
} from "@mp/shared";

type Item = Record<string, NativeAttributeValue>;

export interface Thread {
  threadId: string;
  listingId: string;
  listingTitle: string;
  coverPhotoId?: string;
  hostId: string;
  guestId: string;
  createdAt: string;
  lastMessageAt?: string;
  messageCount?: number;
  /** Set once a confirmed booking exists between the two; contact details stop being masked. */
  bookingConfirmed?: boolean;
  /** When the guest's oldest unanswered message was sent (cleared by the host's reply). */
  awaitingHostSince?: string;
}

export interface Participant {
  threadId: string;
  userId: string;
  role: "guest" | "host";
  otherUserId: string;
  otherName: string;
  listingId: string;
  listingTitle: string;
  coverPhotoId?: string;
  unread: number;
  lastMessageAt?: string;
  lastPreview?: string;
  lastSenderId?: string;
  lastReadAt?: string;
}

export interface Message {
  messageId: string;
  threadId: string;
  senderId: string;
  senderName: string;
  body: string;
  masked: boolean;
  createdAt: string;
  sk: string;
}

const PREVIEW_CHARS = 120;
const PUSH_TOKEN_TTL_SECONDS = 90 * 86_400;
export const LIVE_BOOKING = new Set(["CONFIRMED", "CHECKED_IN", "COMPLETED"]);

export class AlreadySent extends Error {}

export class MessageRepo {
  constructor(private readonly ddb: DdbContext) {}
  private get t() {
    return this.ddb.table;
  }

  async listing(id: string) {
    return (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: listingKey(id) }))).Item;
  }
  async booking(id: string) {
    return (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: bookingKey(id) }))).Item;
  }
  async displayName(userId: string): Promise<string> {
    const r = await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: userKey(userId), ProjectionExpression: "displayName" }));
    return (r.Item?.displayName as string | undefined)?.split(" ")[0] ?? "StayBook user";
  }
  async thread(threadId: string): Promise<Thread | undefined> {
    return (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: threadKey(threadId), ConsistentRead: true }))).Item as Thread | undefined;
  }
  async participant(userId: string, threadId: string): Promise<Participant | undefined> {
    return (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: participantKey(userId, threadId), ConsistentRead: true }))).Item as Participant | undefined;
  }

  /** Creates the thread and both memberships if they don't exist yet. Safe to call concurrently. */
  async ensureThread(l: { id: string; title: string; hostId: string; coverPhotoId?: string }, guestId: string, now: Date): Promise<Thread> {
    const threadId = threadIdOf(l.id, guestId);
    const existing = await this.thread(threadId);
    if (existing) return existing;
    const [guestName, hostName] = await Promise.all([this.displayName(guestId), this.displayName(l.hostId)]);
    const at = now.toISOString();
    const thread: Thread = { threadId, listingId: l.id, listingTitle: l.title, coverPhotoId: l.coverPhotoId, hostId: l.hostId, guestId, createdAt: at, messageCount: 0 };
    const member = (userId: string, role: "guest" | "host", otherUserId: string, otherName: string): Participant => ({
      threadId, userId, role, otherUserId, otherName, listingId: l.id, listingTitle: l.title, coverPhotoId: l.coverPhotoId, unread: 0,
    });
    try {
      await this.ddb.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.t, Item: { ...threadKey(threadId), entity: "THREAD", ...thread }, ConditionExpression: "attribute_not_exists(PK)" } },
            { Put: { TableName: this.t, Item: { ...participantKey(guestId, threadId), entity: "PARTICIPANT", ...member(guestId, "guest", l.hostId, hostName) } } },
            { Put: { TableName: this.t, Item: { ...participantKey(l.hostId, threadId), entity: "PARTICIPANT", ...member(l.hostId, "host", guestId, guestName) } } },
          ],
        }),
      );
      return thread;
    } catch (e) {
      if ((e as { name?: string }).name !== "TransactionCanceledException") throw e;
      const t = await this.thread(threadId); // created by a concurrent request
      if (!t) throw e;
      return t;
    }
  }

  /** Bookings between this guest and listing, newest first (guest's GSI1 partition, filtered). */
  async bookingsBetween(guestId: string, listingId: string, limit = 5) {
    const out: Item[] = [];
    let start: Item | undefined;
    do {
      const r = await this.ddb.doc.send(
        new QueryCommand({
          TableName: this.t,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :b)",
          FilterExpression: "listingId = :l",
          ExpressionAttributeValues: { ":pk": `GUEST#${guestId}`, ":b": "BOOKING#", ":l": listingId },
          ScanIndexForward: false,
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(r.Items ?? []));
      start = r.LastEvaluatedKey;
    } while (start && out.length < limit);
    return out.slice(0, limit).map((b) => ({ bookingId: b.bookingId as string, checkIn: b.checkIn as string, checkOut: b.checkOut as string, status: b.status as string, guests: b.guests as number }));
  }

  /**
   * Posts a message in one transaction: the message, a guard on the client's id (so retries don't
   * double-post), thread and both memberships (inbox order, preview, recipient unread), and both
   * users' inbox counters.
   */
  async send(t: Thread, sender: { id: string; name: string }, body: string, masked: boolean, clientId: string, now: Date, confirmed: boolean): Promise<Message> {
    const at = now.toISOString();
    const sk = messageSk(at, clientId);
    const recipient = sender.id === t.guestId ? t.hostId : t.guestId;
    const preview = body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS - 1)}…` : body;
    const msg: Message = { messageId: clientId, threadId: t.threadId, senderId: sender.id, senderName: sender.name, body, masked, createdAt: at, sk };
    const member = (userId: string, unreadAdd: number) => ({
      Update: {
        TableName: this.t,
        Key: participantKey(userId, t.threadId),
        UpdateExpression: `SET GSI1PK = :gpk, GSI1SK = :gsk, lastMessageAt = :at, lastPreview = :p, lastSenderId = :s${unreadAdd ? " ADD unread :one" : ", lastReadAt = :at"}`,
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: { ":gpk": inboxGsiKeys(userId, at, t.threadId).GSI1PK, ":gsk": inboxGsiKeys(userId, at, t.threadId).GSI1SK, ":at": at, ":p": preview, ":s": sender.id, ...(unreadAdd ? { ":one": 1 } : {}) },
      },
    });
    const counter = (userId: string, unreadAdd: number) => ({
      Update: {
        TableName: this.t,
        Key: inboxStateKey(userId),
        UpdateExpression: unreadAdd ? "ADD version :one, unread :one" : "ADD version :one",
        ExpressionAttributeValues: { ":one": 1 },
      },
    });
    // Response-rate bookkeeping: a guest message starts the clock (if it isn't running); the host's
    // reply stops it and counts as on time if it came within RESPONSE_WINDOW_SECONDS.
    const fromHost = sender.id === t.hostId;
    const threadUpdate = () => {
      const sets = ["lastMessageAt = :at"];
      const removes: string[] = [];
      const values: Record<string, NativeAttributeValue> = { ":at": at, ":one": 1 };
      if (confirmed && !t.bookingConfirmed) (sets.push("bookingConfirmed = :y"), (values[":y"] = true));
      if (!fromHost) sets.push("awaitingHostSince = if_not_exists(awaitingHostSince, :at)");
      else if (t.awaitingHostSince) removes.push("awaitingHostSince");
      return { Update: { TableName: this.t, Key: threadKey(t.threadId), UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""} ADD messageCount :one`, ExpressionAttributeValues: values } };
    };
    const responseStats = () => {
      if (!fromHost || !t.awaitingHostSince) return [];
      const waited = Math.max(0, Math.round((now.getTime() - Date.parse(t.awaitingHostSince)) / 1000));
      return [
        {
          Update: {
            TableName: this.t,
            Key: hostStatsKey(t.hostId),
            UpdateExpression: "ADD responses :one, responsesOnTime :ontime, responseSecondsTotal :w",
            ExpressionAttributeValues: { ":one": 1, ":ontime": waited <= RESPONSE_WINDOW_SECONDS ? 1 : 0, ":w": waited },
          },
        },
      ];
    };
    try {
      await this.ddb.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: this.t, Item: { ...messageGuardKey(t.threadId, clientId), sk, ttl: Math.floor(now.getTime() / 1000) + 7 * 86_400 }, ConditionExpression: "attribute_not_exists(PK)" } },
            { Put: { TableName: this.t, Item: { PK: threadKey(t.threadId).PK, SK: sk, entity: "MESSAGE", recipientId: recipient, ...msg } } },
            threadUpdate(),
            ...responseStats(),
            member(sender.id, 0),
            member(recipient, 1),
            counter(sender.id, 0),
            counter(recipient, 1),
          ],
        }),
      );
    } catch (e) {
      const x = e as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (x.name === "TransactionCanceledException" && x.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed") throw new AlreadySent();
      throw e;
    }
    return msg;
  }

  /** The message a client id was posted as (to answer a retried send with the original). */
  async byClientId(threadId: string, clientId: string): Promise<Message | undefined> {
    const g = (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: messageGuardKey(threadId, clientId) }))).Item;
    if (!g) return undefined;
    return (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: { PK: threadKey(threadId).PK, SK: g.sk } }))).Item as Message | undefined;
  }

  /** Newest first, or (with `after`) everything after a known message, oldest first, for polling. */
  async messages(threadId: string, opts: { limit: number; cursor?: string; after?: string }) {
    const after = opts.after;
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.t,
        KeyConditionExpression: after ? "PK = :pk AND SK > :after" : "PK = :pk AND begins_with(SK, :m)",
        ExpressionAttributeValues: after ? { ":pk": threadKey(threadId).PK, ":after": after } : { ":pk": threadKey(threadId).PK, ":m": "MSG#" },
        ScanIndexForward: !!after,
        Limit: opts.limit,
        ExclusiveStartKey: decodeCursor(opts.cursor),
      }),
    );
    // `SK > after` also matches the CLIENTID#/META siblings that sort after MSG#; keep messages only.
    const items = (r.Items ?? []).filter((i) => String(i.SK).startsWith("MSG#")) as Message[];
    return { items, nextCursor: after ? null : (encodeCursor(r.LastEvaluatedKey) ?? null) };
  }

  async inbox(userId: string, limit: number, cursor?: string) {
    const r = await this.ddb.doc.send(
      new QueryCommand({
        TableName: this.t,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `INBOX#${userId}` },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
      }),
    );
    return { items: (r.Items ?? []) as Participant[], nextCursor: encodeCursor(r.LastEvaluatedKey) ?? null };
  }

  async inboxState(userId: string): Promise<{ unread: number; version: number }> {
    const i = (await this.ddb.doc.send(new GetCommand({ TableName: this.t, Key: inboxStateKey(userId) }))).Item;
    return { unread: Math.max(0, Number(i?.unread ?? 0)), version: Number(i?.version ?? 0) };
  }

  /** Clears the user's unread count for a thread and takes it off their total, exactly once. */
  async markRead(userId: string, threadId: string, now: Date): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await this.participant(userId, threadId);
      const n = Number(p?.unread ?? 0);
      if (!p || n === 0) return;
      try {
        await this.ddb.doc.send(
          new TransactWriteCommand({
            TransactItems: [
              { Update: { TableName: this.t, Key: participantKey(userId, threadId), UpdateExpression: "SET unread = :z, lastReadAt = :at", ConditionExpression: "unread = :n", ExpressionAttributeValues: { ":z": 0, ":n": n, ":at": now.toISOString() } } },
              { Update: { TableName: this.t, Key: inboxStateKey(userId), UpdateExpression: "ADD unread :neg, version :one", ExpressionAttributeValues: { ":neg": -n, ":one": 1 } } },
            ],
          }),
        );
        return;
      } catch (e) {
        if ((e as { name?: string }).name !== "TransactionCanceledException") throw e; // a new message arrived; re-read
      }
    }
  }

  async savePushToken(userId: string, token: string, platform: string, now: Date) {
    await this.ddb.doc.send(new PutCommand({ TableName: this.t, Item: { ...pushTokenKey(userId, token), token, platform, updatedAt: now.toISOString(), ttl: Math.floor(now.getTime() / 1000) + PUSH_TOKEN_TTL_SECONDS } }));
  }
  async deletePushToken(userId: string, token: string) {
    await this.ddb.doc.send(new DeleteCommand({ TableName: this.t, Key: pushTokenKey(userId, token) }));
  }
}
