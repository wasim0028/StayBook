import {
  checkOutEpoch,
  createServer,
  ddbReady,
  HttpError,
  isAdmin,
  optionalAuth,
  parse,
  requireAuth,
  type DdbContext,
  type TokenVerifier,
} from "@mp/shared";
import { z } from "zod";
import { AlreadyReviewedGuest, GuestReviewRepo, type GuestReview } from "./guest-reviews.js";
import { AlreadyReviewed, ReviewRepo, type Review } from "./repo.js";

export interface AppDeps {
  ddb: DdbContext;
  verifier: TokenVerifier;
  /** Epoch seconds; injectable for tests. */
  clock?: () => number;
  logger?: boolean;
}

/** Guests can review from check-out until this long after. */
export const REVIEW_WINDOW_SECONDS = 30 * 24 * 3600;

const uuid = z.string().uuid();
const createSchema = z
  .object({
    bookingId: uuid,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).default(""),
  })
  .strict();
const replySchema = z.object({ text: z.string().trim().min(1).max(500) }).strict();
const bookingParam = z.object({ bookingId: uuid });
const listingParam = z.object({ listingId: uuid });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
});

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({
    name: "review-svc",
    ready: () => ddbReady(deps.ddb),
    logger: deps.logger === false ? false : undefined,
  });
  const repo = new ReviewRepo(deps.ddb);
  const now = () => deps.clock?.() ?? Math.floor(Date.now() / 1000);

  const present = (r: Review) => ({
    bookingId: r.bookingId,
    listingId: r.listingId,
    guestName: r.guestName,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    hostReply: r.hostReply ?? null,
    hostRepliedAt: r.hostRepliedAt ?? null,
  });

  /** Public: reviews of a listing, newest first. */
  app.get("/v1/reviews/listing/:listingId", { preHandler: optionalAuth(deps.verifier) }, async (req) => {
    const { listingId } = parse(listingParam, req.params);
    const { limit, cursor } = parse(listQuery, req.query);
    const { items, nextCursor } = await repo.listForListing(listingId, limit, cursor);
    return { items: items.map(present), nextCursor };
  });

  app.post("/v1/reviews", { preHandler: requireAuth(deps.verifier) }, async (req, reply) => {
    const input = parse(createSchema, req.body);
    const b = await repo.getBooking(input.bookingId);
    // Same answer for "missing" and "not yours", so booking ids can't be probed.
    if (!b || b.guestId !== req.user!.sub) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");

    if (!["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status)) {
      throw new HttpError(409, "NOT_REVIEWABLE", `a ${b.status.toLowerCase()} booking can't be reviewed`);
    }
    const t = now();
    const out = checkOutEpoch(b.checkOut);
    if (t < out) throw new HttpError(409, "STAY_NOT_FINISHED", "you can review after check-out");
    if (t > out + REVIEW_WINDOW_SECONDS) throw new HttpError(409, "REVIEW_WINDOW_CLOSED", "reviews close 30 days after check-out");

    try {
      const guestName = await repo.guestName(b.guestId);
      const r = await repo.create(
        { listingId: b.listingId, bookingId: b.bookingId, guestId: b.guestId, hostId: b.hostId, guestName, rating: input.rating, comment: input.comment },
        new Date(t * 1000),
      );
      return reply.status(201).send(present(r));
    } catch (e) {
      if (e instanceof AlreadyReviewed) throw new HttpError(409, "ALREADY_REVIEWED", "this booking already has a review");
      throw e;
    }
  });

  /** The guest's own review of a booking (404 if none yet), so the app knows whether to offer "Leave a review". */
  app.get("/v1/reviews/by-booking/:bookingId", { preHandler: requireAuth(deps.verifier) }, async (req) => {
    const { bookingId } = parse(bookingParam, req.params);
    const r = await repo.byBooking(bookingId);
    const u = req.user!;
    if (!r || (r.guestId !== u.sub && r.hostId !== u.sub && !isAdmin(u))) throw new HttpError(404, "REVIEW_NOT_FOUND", "no review");
    return present(r);
  });

  /** The listing's host answers a review, once. */
  app.post("/v1/reviews/by-booking/:bookingId/reply", { preHandler: requireAuth(deps.verifier, ["host"]) }, async (req) => {
    const { bookingId } = parse(bookingParam, req.params);
    const { text } = parse(replySchema, req.body);
    const r = await repo.byBooking(bookingId);
    if (!r || r.hostId !== req.user!.sub) throw new HttpError(404, "REVIEW_NOT_FOUND", "no review");
    if (r.hostReply) throw new HttpError(409, "ALREADY_REPLIED", "you've already replied");
    const ok = await repo.reply(r, req.user!.sub, text, new Date(now() * 1000));
    if (!ok) throw new HttpError(409, "ALREADY_REPLIED", "you've already replied");
    return present((await repo.byBooking(bookingId))!);
  });

  // ---------- hosts review guests ----------

  const guests = new GuestReviewRepo(deps.ddb);
  const guestParam = z.object({ guestId: z.string().min(1).max(64) });
  const presentGuestReview = (r: GuestReview) => ({ bookingId: r.bookingId, hostName: r.hostName, listingTitle: r.listingTitle, rating: r.rating, comment: r.comment, createdAt: r.createdAt });

  app.post("/v1/reviews/guests", { preHandler: requireAuth(deps.verifier, ["host"]) }, async (req, reply) => {
    const input = parse(createSchema, req.body);
    const b = await repo.getBooking(input.bookingId);
    if (!b || b.hostId !== req.user!.sub) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");
    if (!["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status)) throw new HttpError(409, "NOT_REVIEWABLE", `a ${b.status.toLowerCase()} booking can't be reviewed`);
    const t = now();
    const out = checkOutEpoch(b.checkOut);
    if (t < out) throw new HttpError(409, "STAY_NOT_FINISHED", "you can review after check-out");
    if (t > out + REVIEW_WINDOW_SECONDS) throw new HttpError(409, "REVIEW_WINDOW_CLOSED", "reviews close 30 days after check-out");
    try {
      const hostName = (await repo.guestName(b.hostId)).split(" ")[0]!;
      const r = await guests.create({ bookingId: b.bookingId, guestId: b.guestId, hostId: b.hostId, hostName, listingTitle: b.listingTitle, rating: input.rating, comment: input.comment }, new Date(t * 1000));
      return reply.status(201).send(presentGuestReview(r));
    } catch (e) {
      if (e instanceof AlreadyReviewedGuest) throw new HttpError(409, "ALREADY_REVIEWED", "you've already reviewed this guest for this stay");
      throw e;
    }
  });

  /** A guest's reviews from hosts: visible to the guest, admins, and hosts the guest has booked or asked. */
  app.get("/v1/reviews/guests/:guestId", { preHandler: requireAuth(deps.verifier) }, async (req) => {
    const { guestId } = parse(guestParam, req.params);
    const { limit, cursor } = parse(listQuery, req.query);
    const u = req.user!;
    const allowed = u.sub === guestId || isAdmin(u) || (u.groups.includes("host") && (await guests.hostKnowsGuest(u.sub, guestId)));
    if (!allowed) throw new HttpError(404, "NOT_FOUND", "not found");
    const r = await guests.forGuest(guestId, limit, cursor);
    return { ratingAvg: r.ratingAvg, ratingCount: r.ratingCount, items: r.items.map(presentGuestReview), nextCursor: r.nextCursor };
  });

  /** The host's review of a booking's guest, if written (404 otherwise). */
  app.get("/v1/reviews/guests/by-booking/:bookingId", { preHandler: requireAuth(deps.verifier) }, async (req) => {
    const { bookingId } = parse(bookingParam, req.params);
    const r = await guests.byBooking(bookingId);
    const u = req.user!;
    if (!r || (r.hostId !== u.sub && r.guestId !== u.sub && !isAdmin(u))) throw new HttpError(404, "REVIEW_NOT_FOUND", "no review");
    return presentGuestReview(r);
  });

  return { app, markDraining };
}
