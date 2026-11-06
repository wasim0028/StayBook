import { createHash, randomUUID } from "node:crypto";
import {
  actorOf,
  writeAudit,
  checkOutEpoch,
  createServer,
  ddbReady,
  eachNight,
  fullRefund,
  guestRefund,
  HttpError,
  isAdmin,
  isConditionalFailure,
  isNightAvailable,
  isValidDate,
  MAX_STAY_NIGHTS,
  nightsBetween,
  parse,
  PAYOUT_HOLD_AFTER_CHECKOUT_SECONDS,
  releaseNights,
  requireAuth,
  checkStayLength,
  PAY_AFTER_ACCEPT_SECONDS,
  REQUEST_WINDOW_SECONDS,
  pricingOf,
  quote as quoteStay,
  splitStay,
  StayRuleError,
  todayUtc,
  type AuthUser,
  type BookingRecord,
  type DdbContext,
  type RazorpayApi,
  type TokenVerifier,
} from "@mp/shared";
import { z } from "zod";
import { processRefund } from "./refunds.js";
import { BookingRepo, ReserveConflict } from "./repo.js";

export interface AppDeps {
  ddb: DdbContext;
  verifier: TokenVerifier;
  razorpay: RazorpayApi;
  /** Public key id, returned to clients to open Razorpay Checkout. */
  razorpayKeyId: string;
  cdnBaseUrl: string;
  platformFeePct: number;
  holdMinutes: number;
  /** Epoch seconds; injectable for tests. */
  clock?: () => number;
  logger?: boolean;
}

const date = z.string().refine(isValidDate, "expected YYYY-MM-DD");

const quoteQuery = z.object({
  listingId: z.string().uuid(),
  checkIn: z.string().refine(isValidDate, "expected YYYY-MM-DD"),
  checkOut: z.string().refine(isValidDate, "expected YYYY-MM-DD"),
  guests: z.coerce.number().int().min(1).max(50).default(1),
});

const createSchema = z
  .object({
    listingId: z.string().uuid(),
    checkIn: date,
    checkOut: date,
    guests: z.number().int().min(1).max(50),
    /** Request to book: a note to the host (also posted to the conversation by the client). */
    message: z.string().trim().max(1000).optional(),
  })
  .strict();

const declineSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

const idemHeader = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-]");
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
});

/** An in-flight request with the same key gets 409 for this long before we assume it died. */
const IN_PROGRESS_WINDOW_SECONDS = 30;

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({
    name: "booking-svc",
    ready: () => ddbReady(deps.ddb),
    logger: deps.logger === false ? false : undefined,
  });
  const repo = new BookingRepo(deps.ddb);
  const now = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  const cdn = deps.cdnBaseUrl.replace(/\/$/, "");
  const guestOrHost = requireAuth(deps.verifier, ["guest", "host"]);

  type Viewer = "guest" | "host" | "admin";

  function viewerOf(b: BookingRecord, u: AuthUser | undefined): Viewer | null {
    if (!u) return null;
    if (isAdmin(u)) return "admin";
    if (b.guestId === u.sub) return "guest";
    if (b.hostId === u.sub) return "host";
    return null;
  }

  function present(b: BookingRecord, viewer: Viewer) {
    const { coverPhotoId, platformFeePaise, hostPayoutPaise, platformGstPaise, hostReversalId, refundError, ...rest } = b;
    return {
      ...rest,
      coverPhotoUrl: coverPhotoId ? `${cdn}/listings/${b.listingId}/${coverPhotoId}/w720.webp` : null,
      ...(viewer !== "guest" ? { platformFeePaise, hostPayoutPaise, platformGstPaise } : {}),
      ...(viewer === "admin" ? { hostReversalId, refundError } : {}),
    };
  }

  function checkoutResponse(b: BookingRecord) {
    return {
      bookingId: b.bookingId,
      status: b.status,
      totalPaise: b.totalPaise,
      holdExpiresAt: b.holdExpiresAt,
      // A request has no payment until the host accepts it.
      payment: b.orderId ? { orderId: b.orderId, keyId: deps.razorpayKeyId, amountPaise: b.totalPaise } : null,
    };
  }

  /** Answer a repeated Idempotency-Key: same request -> same result; different request -> 422. */
  async function replay(userId: string, key: string, requestHash: string) {
    const idem = await repo.getIdempotency(userId, key);
    if (!idem) return null;
    if (idem.requestHash !== requestHash) {
      throw new HttpError(422, "IDEMPOTENCY_KEY_REUSED", "this Idempotency-Key was used for a different request");
    }
    const b = await repo.get(idem.bookingId);
    if (b?.orderId || b?.status === "REQUESTED") return b;
    if (now() - idem.createdAt < IN_PROGRESS_WINDOW_SECONDS) {
      throw new HttpError(409, "REQUEST_IN_PROGRESS", "the original request is still being processed; retry shortly");
    }
    throw new HttpError(409, "REQUEST_FAILED", "the original request did not complete; retry with a new Idempotency-Key");
  }

  /** The listing's price for these nights and guests, enforcing its stay-length rules. */
  function priceOrThrow(listing: Record<string, unknown>, nightPrices: number[], guests: number) {
    const rules = pricingOf(listing as Parameters<typeof pricingOf>[0]);
    try {
      checkStayLength(rules, nightPrices.length);
    } catch (e) {
      if (e instanceof StayRuleError) throw new HttpError(400, e.code, e.message, { minNights: rules.minNights, maxNights: rules.maxNights });
      throw e;
    }
    return quoteStay(rules, nightPrices, guests);
  }

  // ---------- quote (no hold; what the guest would pay) ----------

  app.get("/v1/quote", async (req) => {
    const q = parse(quoteQuery, req.query);
    const nightsCount = nightsBetween(q.checkIn, q.checkOut);
    if (nightsCount < 1 || nightsCount > MAX_STAY_NIGHTS) throw new HttpError(400, "INVALID_DATES", `stay must be 1-${MAX_STAY_NIGHTS} nights`);
    const listing = await repo.getListing(q.listingId);
    if (!listing || listing.status !== "PUBLISHED") throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    if (q.guests > Number(listing.maxGuests)) throw new HttpError(400, "TOO_MANY_GUESTS", `this place allows up to ${listing.maxGuests} guests`);
    const nights = eachNight(q.checkIn, q.checkOut, MAX_STAY_NIGHTS);
    const stored = await repo.nightItems(q.listingId, nights);
    const t = now();
    const unavailable = nights.filter((d) => {
      const n = stored.get(d);
      return n && !isNightAvailable({ status: n.status, holdExpiresAt: n.holdExpiresAt }, t);
    });
    const nightPrices = nights.map((d) => Number(stored.get(d)?.pricePaise ?? listing.basePricePaise));
    return { listingId: q.listingId, checkIn: q.checkIn, checkOut: q.checkOut, guests: q.guests, available: unavailable.length === 0, unavailable, nightPrices, ...priceOrThrow(listing, nightPrices, q.guests), currency: "INR" };
  });

  // ---------- create (hold + Razorpay order) ----------

  app.post("/v1/bookings", { preHandler: guestOrHost }, async (req, reply) => {
    const user = req.user!;
    const key = parse(idemHeader, req.headers["idempotency-key"]);
    const body = parse(createSchema, req.body);
    const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");

    const previous = await replay(user.sub, key, requestHash);
    if (previous) return reply.status(200).send(checkoutResponse(previous));

    const nightsCount = nightsBetween(body.checkIn, body.checkOut);
    if (nightsCount < 1 || nightsCount > MAX_STAY_NIGHTS) {
      throw new HttpError(400, "INVALID_DATES", `stay must be 1-${MAX_STAY_NIGHTS} nights`);
    }
    if (body.checkIn < todayUtc(new Date(now() * 1000))) throw new HttpError(400, "INVALID_DATES", "check-in is in the past");

    const listing = await repo.getListing(body.listingId);
    if (!listing || listing.status !== "PUBLISHED") throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    if (listing.hostId === user.sub) throw new HttpError(403, "OWN_LISTING", "you can't book your own listing");
    if (body.guests > Number(listing.maxGuests)) {
      throw new HttpError(400, "TOO_MANY_GUESTS", `this place allows up to ${listing.maxGuests} guests`);
    }

    const host = await repo.hostProfile(String(listing.hostId));
    if (!host?.razorpayAccountId || host.razorpayAccountStatus !== "activated") {
      throw new HttpError(409, "LISTING_NOT_BOOKABLE", "this host can't accept payments right now");
    }

    // Price from stored nights (overrides) or the base price, and fail fast on known conflicts.
    const nights = eachNight(body.checkIn, body.checkOut, MAX_STAY_NIGHTS);
    const stored = await repo.nightItems(body.listingId, nights);
    const t = now();
    const taken = nights.filter((d) => {
      const n = stored.get(d);
      return n && !isNightAvailable({ status: n.status, holdExpiresAt: n.holdExpiresAt }, t);
    });
    if (taken.length) throw new HttpError(409, "DATES_UNAVAILABLE", "some nights are no longer available", { dates: taken });

    const nightPrices = nights.map((d) => Number(stored.get(d)?.pricePaise ?? listing.basePricePaise));
    const price = priceOrThrow(listing, nightPrices, body.guests);
    const instant = listing.instantBook !== false;
    const totalPaise = price.totalPaise;
    const { platformFeePaise, hostPayoutPaise, platformGstPaise } = splitStay(price, deps.platformFeePct, !!host.gstin);
    const createdAt = new Date(t * 1000).toISOString();

    const booking: BookingRecord = {
      bookingId: randomUUID(),
      listingId: body.listingId,
      hostId: String(listing.hostId),
      guestId: user.sub,
      listingTitle: String(listing.title),
      coverPhotoId: listing.coverPhotoId ? String(listing.coverPhotoId) : undefined,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      nights,
      nightPrices,
      guests: body.guests,
      totalPaise,
      price,
      platformGstPaise,
      platformFeePaise,
      hostPayoutPaise,
      currency: "INR",
      cancellationPolicy: listing.cancellationPolicy ?? "MODERATE",
      status: instant ? "PENDING_PAYMENT" : "REQUESTED",
      instantBook: instant,
      ...(body.message ? { requestMessage: body.message } : {}),
      holdExpiresAt: t + (instant ? deps.holdMinutes * 60 : REQUEST_WINDOW_SECONDS),
      createdAt,
      updatedAt: createdAt,
    };

    try {
      await repo.reserve(booking, { userId: user.sub, key, requestHash }, t);
    } catch (e) {
      if (e instanceof ReserveConflict && e.kind === "DATES") {
        throw new HttpError(409, "DATES_UNAVAILABLE", "some nights were just booked by someone else", { dates: e.dates });
      }
      if (e instanceof ReserveConflict && e.kind === "IDEMPOTENCY") {
        const raced = await replay(user.sub, key, requestHash); // concurrent duplicate
        if (raced) return reply.status(200).send(checkoutResponse(raced));
        throw new HttpError(409, "REQUEST_IN_PROGRESS", "retry shortly");
      }
      // Still colliding after the repo's retries: tell the client to try again, not a 500.
      if ((e as { name?: string }).name === "TransactionCanceledException") throw new HttpError(409, "BUSY", "lots of people are booking right now; please try again");
      throw e;
    }

    // Request to book: nothing is charged until the host accepts.
    if (!instant) return reply.status(201).send(checkoutResponse(booking));

    // Order with an on-hold Route transfer: the host's share is frozen until 24h after check-out.
    let orderId: string;
    try {
      const order = await deps.razorpay.createOrder({
        amountPaise: totalPaise,
        receipt: booking.bookingId,
        notes: { bookingId: booking.bookingId, listingId: booking.listingId },
        transfer: {
          account: host.razorpayAccountId,
          amountPaise: hostPayoutPaise,
          onHoldUntil: checkOutEpoch(body.checkOut) + PAYOUT_HOLD_AFTER_CHECKOUT_SECONDS,
          notes: { bookingId: booking.bookingId },
        },
      });
      orderId = order.id;
    } catch (e) {
      req.log.error({ err: e, bookingId: booking.bookingId }, "razorpay order creation failed; releasing hold");
      await repo.abandonUnpaid(booking, { userId: user.sub, key }, "ORDER_FAILED");
      await releaseNights(deps.ddb, booking.listingId, booking.nights, booking.bookingId, ["HELD"]);
      throw new HttpError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "couldn't start the payment; please try again");
    }

    try {
      await repo.attachOrder(booking.bookingId, orderId);
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "HOLD_EXPIRED", "the hold expired; please start again");
      throw e;
    }

    return reply.status(201).send(checkoutResponse({ ...booking, orderId }));
  });

  // ---------- read ----------

  app.get("/v1/bookings/:id", { preHandler: requireAuth(deps.verifier) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = await repo.get(id);
    const viewer = b ? viewerOf(b, req.user) : null;
    if (!b || !viewer) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");
    // A guest returning to an unpaid hold can reopen Checkout for the same order.
    if (viewer === "guest" && b.status === "PENDING_PAYMENT" && b.orderId && (b.holdExpiresAt ?? 0) > now()) {
      return { ...present(b, viewer), payment: checkoutResponse(b).payment };
    }
    return present(b, viewer);
  });

  app.get("/v1/trips", { preHandler: requireAuth(deps.verifier) }, async (req) => {
    const { limit, cursor } = parse(listQuery, req.query);
    const page = await repo.listByGuest(req.user!.sub, limit, cursor);
    return { items: page.items.map((b) => present(b, "guest")), nextCursor: page.nextCursor ?? null };
  });

  app.get("/v1/host/reservations", { preHandler: requireAuth(deps.verifier, ["host"]) }, async (req) => {
    const { limit, cursor } = parse(listQuery, req.query);
    const page = await repo.listByHost(req.user!.sub, limit, cursor);
    return { items: page.items.map((b) => present(b, "host")), nextCursor: page.nextCursor ?? null };
  });

  // ---------- request to book: host answers ----------

  async function loadRequestForHost(id: string, u: AuthUser) {
    const b = await repo.get(id);
    if (!b || (b.hostId !== u.sub && !isAdmin(u))) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");
    if (b.status !== "REQUESTED") throw new HttpError(409, "NOT_A_REQUEST", `this booking is ${b.status.toLowerCase().replace("_", " ")}`);
    if ((b.holdExpiresAt ?? 0) <= now()) throw new HttpError(409, "REQUEST_EXPIRED", "this request has expired");
    return b;
  }

  /** Accept: create the Razorpay order and give the guest PAY_AFTER_ACCEPT_SECONDS to pay. */
  app.post("/v1/bookings/:id/accept", { preHandler: requireAuth(deps.verifier, ["host", "admin"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = await loadRequestForHost(id, req.user!);
    const host = await repo.hostProfile(b.hostId);
    if (!host?.razorpayAccountId || host.razorpayAccountStatus !== "activated") {
      throw new HttpError(409, "PAYOUTS_NOT_ACTIVE", "your payout account isn't active, so you can't accept bookings right now");
    }
    let orderId: string;
    try {
      const order = await deps.razorpay.createOrder({
        amountPaise: b.totalPaise,
        receipt: b.bookingId,
        notes: { bookingId: b.bookingId, listingId: b.listingId },
        transfer: {
          account: host.razorpayAccountId,
          amountPaise: b.hostPayoutPaise,
          onHoldUntil: checkOutEpoch(b.checkOut) + PAYOUT_HOLD_AFTER_CHECKOUT_SECONDS,
          notes: { bookingId: b.bookingId },
        },
      });
      orderId = order.id;
    } catch (e) {
      req.log.error({ err: e, bookingId: b.bookingId }, "razorpay order creation failed on accept");
      throw new HttpError(502, "PAYMENT_PROVIDER_UNAVAILABLE", "couldn't set up the payment; please try again");
    }
    const t = now();
    try {
      const accepted = await repo.acceptRequest(b, orderId, t + PAY_AFTER_ACCEPT_SECONDS, new Date(t * 1000));
      return present(accepted, viewerOf(accepted, req.user) ?? "host");
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "STATE_CHANGED", "the request changed; reload and try again");
      throw e;
    }
  });

  app.post("/v1/bookings/:id/decline", { preHandler: requireAuth(deps.verifier, ["host", "admin"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(declineSchema, req.body ?? {});
    const b = await loadRequestForHost(id, req.user!);
    const declined = await cancelOr409(() =>
      repo.transition(b.bookingId, ["REQUESTED"], "DECLINED", { declinedAt: new Date(now() * 1000).toISOString(), ...(reason ? { declineReason: reason } : {}) }, ["GSI4PK", "GSI4SK"]),
    );
    await releaseNights(deps.ddb, b.listingId, b.nights, b.bookingId, ["HELD"]);
    return present(declined, viewerOf(declined, req.user) ?? "host");
  });

  // ---------- cancel ----------

  app.post("/v1/bookings/:id/cancel", { preHandler: requireAuth(deps.verifier) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = await repo.get(id);
    const viewer = b ? viewerOf(b, req.user) : null;
    if (!b || !viewer) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");
    const t = now();

    if (b.status === "PENDING_PAYMENT" || b.status === "REQUESTED") {
      if (viewer === "host") throw new HttpError(409, "NOT_CONFIRMED", b.status === "REQUESTED" ? "decline the request instead" : "this booking isn't confirmed yet");
      const cancelled = await cancelOr409(() => repo.markCancelled(b, null, viewer));
      await releaseNights(deps.ddb, b.listingId, b.nights, b.bookingId, ["HELD"]);
      return present(cancelled, viewer);
    }
    if (b.status !== "CONFIRMED") {
      throw new HttpError(409, "NOT_CANCELLABLE", `a ${b.status.toLowerCase().replace("_", " ")} booking can't be cancelled`);
    }

    let decision;
    if (viewer === "guest") {
      decision = guestRefund(b, t);
      if (!decision) throw new HttpError(409, "TOO_LATE_TO_CANCEL", "check-in has passed; contact support");
    } else {
      if (viewer === "host" && guestRefund(b, t) === null) {
        throw new HttpError(409, "TOO_LATE_TO_CANCEL", "check-in has passed; contact support");
      }
      decision = fullRefund(b, viewer);
    }

    const cancelled = await cancelOr409(() => repo.markCancelled(b, decision, viewer));
    req.log.info({ bookingId: b.bookingId, by: viewer, refund: decision.refundPaise, rule: decision.rule }, "booking cancelled");
    await releaseNights(deps.ddb, b.listingId, b.nights, b.bookingId, ["BOOKED"]);
    const final = await processRefund(repo, deps.razorpay, cancelled, req.log);
    if (viewer === "admin") {
      await writeAudit(deps.ddb, { actor: actorOf(req.user), action: "booking.cancel", targetType: "booking", targetId: b.bookingId, detail: { refundPaise: decision.refundPaise, refundStatus: final.refundStatus, guestId: b.guestId, hostId: b.hostId } }, req.log);
    }
    return present(final, viewer);
  });

  app.post("/v1/admin/bookings/:id/retry-refund", { preHandler: requireAuth(deps.verifier, ["admin"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = await repo.get(id);
    if (!b) throw new HttpError(404, "BOOKING_NOT_FOUND", "booking not found");
    if (b.refundStatus !== "FAILED" && b.refundStatus !== "PENDING") {
      throw new HttpError(409, "NOTHING_TO_RETRY", `refund status is ${b.refundStatus ?? "none"}`);
    }
    const out = await processRefund(repo, deps.razorpay, b, req.log);
    await writeAudit(deps.ddb, { actor: actorOf(req.user), action: "booking.retry_refund", targetType: "booking", targetId: id, detail: { before: b.refundStatus, after: out.refundStatus, refundPaise: b.refundPaise } }, req.log);
    return present(out, "admin");
  });

  async function cancelOr409(fn: () => Promise<BookingRecord>) {
    try {
      return await fn();
    } catch (e) {
      if (isConditionalFailure(e)) throw new HttpError(409, "STATE_CHANGED", "the booking changed; reload and try again");
      throw e;
    }
  }

  return { app, markDraining };
}
