import { createServer, ddbReady, HttpError, isAdmin, maskContactInfo, parse, requireAuth, THREAD_ID_RE, type AuthUser, type DdbContext, type TokenVerifier } from "@mp/shared";
import { z } from "zod";
import { AlreadySent, LIVE_BOOKING, MessageRepo, type Message, type Participant, type Thread } from "./repo.js";

export interface AppDeps {
  ddb: DdbContext;
  verifier: TokenVerifier;
  cdnBaseUrl: string;
  clock?: () => number;
  logger?: boolean;
}

export const MAX_MESSAGE_CHARS = 2000;

const uuid = z.string().uuid();
const threadParam = z.object({ id: z.string().regex(THREAD_ID_RE, "invalid thread id") });
const startSchema = z.union([z.object({ listingId: uuid }).strict(), z.object({ bookingId: uuid }).strict()]);
const sendSchema = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_CHARS), clientId: uuid }).strict();
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  cursor: z.string().max(2048).optional(),
  /** SK of the newest message the client has; returns only newer ones (oldest first). */
  after: z.string().regex(/^MSG#/).max(200).optional(),
});
const pushSchema = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[\w-]+\]$/, "Expo push token"), platform: z.enum(["ios", "android"]) }).strict();

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({ name: "message-svc", ready: () => ddbReady(deps.ddb), logger: deps.logger === false ? false : undefined });
  const repo = new MessageRepo(deps.ddb);
  const now = () => new Date((deps.clock?.() ?? Date.now() / 1000) * 1000);
  const authed = requireAuth(deps.verifier);
  const cdn = deps.cdnBaseUrl.replace(/\/$/, "");
  const cover = (listingId: string, photoId?: string) => (photoId ? `${cdn}/listings/${listingId}/${photoId}/w360.webp` : null);

  /** Participants see their thread; admins can read any (disputes), but never post. */
  async function load(threadId: string, u: AuthUser, forWrite = false): Promise<{ t: Thread; me: "guest" | "host" | "admin" }> {
    const t = await repo.thread(threadId);
    const me = t && (t.guestId === u.sub ? "guest" : t.hostId === u.sub ? "host" : !forWrite && isAdmin(u) ? "admin" : null);
    if (!t || !me) throw new HttpError(404, "THREAD_NOT_FOUND", "conversation not found");
    return { t, me };
  }

  const presentMessage = (m: Message, viewer: string) => ({
    messageId: m.messageId,
    senderId: m.senderId,
    senderName: m.senderName,
    mine: m.senderId === viewer,
    body: m.body,
    masked: m.masked,
    createdAt: m.createdAt,
    cursor: m.sk,
  });

  const presentInbox = (p: Participant) => ({
    threadId: p.threadId,
    role: p.role,
    otherUserId: p.otherUserId,
    otherName: p.otherName,
    listingId: p.listingId,
    listingTitle: p.listingTitle,
    coverPhotoUrl: cover(p.listingId, p.coverPhotoId),
    unread: Number(p.unread ?? 0),
    lastMessageAt: p.lastMessageAt ?? null,
    lastPreview: p.lastPreview ?? null,
    lastFromMe: p.lastSenderId === p.userId,
  });

  // ---------- start a conversation ----------

  app.post("/v1/threads", { preHandler: authed }, async (req, reply) => {
    const input = parse(startSchema, req.body);
    const u = req.user!;
    let listing: Record<string, unknown> | undefined;
    let guestId: string;
    if ("listingId" in input) {
      // A guest asking about a place, before or after booking.
      listing = await repo.listing(input.listingId);
      if (!listing || listing.status !== "PUBLISHED") throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
      if (listing.hostId === u.sub) throw new HttpError(409, "OWN_LISTING", "you can't message yourself");
      guestId = u.sub;
    } else {
      // Either side of a booking (lets a host reach a guest who never wrote first).
      const b = await repo.booking(input.bookingId);
      if (!b || (b.guestId !== u.sub && b.hostId !== u.sub)) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");
      listing = await repo.listing(b.listingId as string);
      if (!listing) throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
      guestId = b.guestId as string;
    }
    const photos = Array.isArray(listing.photos) ? (listing.photos as string[]) : [];
    const t = await repo.ensureThread({ id: listing.id as string, title: listing.title as string, hostId: listing.hostId as string, coverPhotoId: photos[0] }, guestId, now());
    return reply.status(201).send({ threadId: t.threadId });
  });

  // ---------- inbox ----------

  app.get("/v1/threads", { preHandler: authed }, async (req) => {
    const { limit, cursor } = parse(listQuery, req.query);
    const r = await repo.inbox(req.user!.sub, Math.min(limit, 50), cursor);
    return { items: r.items.map(presentInbox), nextCursor: r.nextCursor };
  });

  /** Cheap to poll: `version` changes on every new message or read, so clients refetch only then. */
  app.get("/v1/inbox/summary", { preHandler: authed }, async (req) => repo.inboxState(req.user!.sub));

  app.get("/v1/threads/:id", { preHandler: authed }, async (req) => {
    const { id } = parse(threadParam, req.params);
    const { t, me } = await load(id, req.user!);
    const [mine, bookings] = await Promise.all([me === "admin" ? undefined : repo.participant(req.user!.sub, id), repo.bookingsBetween(t.guestId, t.listingId)]);
    return {
      threadId: t.threadId,
      role: me,
      listingId: t.listingId,
      listingTitle: t.listingTitle,
      coverPhotoUrl: cover(t.listingId, t.coverPhotoId),
      guestId: t.guestId,
      hostId: t.hostId,
      otherUserId: mine?.otherUserId ?? null,
      otherName: mine?.otherName ?? null,
      contactSharing: t.bookingConfirmed || bookings.some((b) => LIVE_BOOKING.has(b.status)),
      bookings,
    };
  });

  app.get("/v1/threads/:id/messages", { preHandler: authed }, async (req) => {
    const { id } = parse(threadParam, req.params);
    const q = parse(listQuery, req.query);
    await load(id, req.user!);
    const r = await repo.messages(id, q);
    return { items: r.items.map((m) => presentMessage(m, req.user!.sub)), nextCursor: r.nextCursor };
  });

  app.post("/v1/threads/:id/messages", { preHandler: authed }, async (req, reply) => {
    const { id } = parse(threadParam, req.params);
    const { body, clientId } = parse(sendSchema, req.body);
    const { t, me } = await load(id, req.user!, true);

    let confirmed = !!t.bookingConfirmed;
    if (!confirmed) confirmed = (await repo.bookingsBetween(t.guestId, t.listingId)).some((b) => LIVE_BOOKING.has(b.status));
    const { text, masked } = confirmed ? { text: body, masked: false } : maskContactInfo(body);

    const senderName = await repo.displayName(req.user!.sub);
    try {
      const m = await repo.send(t, { id: req.user!.sub, name: senderName }, text, masked, clientId, now(), confirmed);
      req.log.info({ threadId: id, from: me, masked }, "message sent");
      return reply.status(201).send(presentMessage(m, req.user!.sub));
    } catch (e) {
      if (!(e instanceof AlreadySent)) throw e;
      const m = await repo.byClientId(id, clientId);
      if (!m || m.senderId !== req.user!.sub) throw new HttpError(409, "DUPLICATE_ID", "clientId already used");
      return reply.status(200).send(presentMessage(m, req.user!.sub));
    }
  });

  app.post("/v1/threads/:id/read", { preHandler: authed }, async (req, reply) => {
    const { id } = parse(threadParam, req.params);
    await load(id, req.user!, true);
    await repo.markRead(req.user!.sub, id, now());
    return reply.status(204).send();
  });

  // ---------- push notification tokens (mobile app) ----------

  app.put("/v1/push-tokens", { preHandler: authed }, async (req, reply) => {
    const { token, platform } = parse(pushSchema, req.body);
    await repo.savePushToken(req.user!.sub, token, platform, now());
    return reply.status(204).send();
  });

  app.delete("/v1/push-tokens/:token", { preHandler: authed }, async (req, reply) => {
    const { token } = parse(z.object({ token: pushSchema.shape.token }), req.params);
    await repo.deletePushToken(req.user!.sub, token);
    return reply.status(204).send();
  });

  return { app, markDraining };
}
