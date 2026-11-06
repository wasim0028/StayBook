import {
  actorOf,
  type HostProfile,
  writeAudit,
  createServer,
  ddbReady,
  HttpError,
  isAdmin,
  optionalAuth,
  parse,
  requireAuth,
  type AuthUser,
  type DdbContext,
  type Listing,
  type TokenVerifier,
} from "@mp/shared";
import { z } from "zod";
import { photoUrl, type PhotoStore } from "./photos.js";
import { pricingProblems } from "./schemas.js";
import { ListingRepo } from "./repo.js";
import {
  attachPhotoSchema,
  calendarQuerySchema,
  calendarUpdateSchema,
  createListingSchema,
  listQuerySchema,
  photoUploadSchema,
  reorderPhotosSchema,
  updateListingSchema,
} from "./schemas.js";

export interface AppDeps {
  ddb: DdbContext;
  verifier: TokenVerifier;
  photos: PhotoStore;
  cdnBaseUrl: string;
  /** Hosts must finish Razorpay Route KYC before publishing. Disable only in dev. */
  requirePayoutAccount: boolean;
  minPhotosToPublish: number;
  logger?: boolean;
}

const idParam = z.object({ id: z.string().uuid() });

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({
    name: "listing-svc",
    ready: () => ddbReady(deps.ddb),
    logger: deps.logger === false ? false : undefined,
  });
  const repo = new ListingRepo(deps.ddb);
  const auth = (roles: Parameters<typeof requireAuth>[1] = []) => requireAuth(deps.verifier, roles);

  const present = (l: Listing) => ({
    ...l,
    photoUrls: l.photos.map((p) => photoUrl(deps.cdnBaseUrl, l.id, p)),
  });

  async function load(id: string): Promise<Listing> {
    const l = await repo.get(id);
    if (!l) throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    return l;
  }

  async function loadOwned(id: string, user: AuthUser | undefined): Promise<Listing> {
    const l = await load(id);
    if (!user || (l.hostId !== user.sub && !isAdmin(user))) {
      // 404, not 403: don't reveal that someone else's draft exists
      throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    }
    return l;
  }

  /** What guests see about the host: name, how long they've hosted, and trust badges. */
  async function hostSummary(hostId: string) {
    const p = (await repo.hostProfile(hostId)) as (HostProfile & { displayName?: string; hostSince?: string; createdAt?: string; superhost?: boolean; hostStats?: { responseRate?: number | null; reviews?: number; ratingAvg?: number | null } }) | undefined;
    if (!p) return null;
    const rate = p.hostStats?.responseRate;
    return {
      name: p.displayName?.split(" ")[0] ?? "Your host",
      hostingSince: p.hostSince ?? p.createdAt ?? null,
      superhost: !!p.superhost,
      // Razorpay KYC (PAN + bank account) has been completed and activated.
      identityVerified: p.razorpayAccountStatus === "activated",
      responseRatePct: typeof rate === "number" ? Math.round(rate * 100) : null,
      reviews: p.hostStats?.reviews ?? null,
      ratingAvg: p.hostStats?.ratingAvg ?? null,
    };
  }

  // ---------- public ----------

  app.get("/v1/listings/:id", { preHandler: optionalAuth(deps.verifier) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const l = await load(id);
    const isOwner = req.user && (req.user.sub === l.hostId || isAdmin(req.user));
    if (l.status !== "PUBLISHED" && !isOwner) throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    if (l.status === "PUBLISHED" && !isOwner) reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
    return { ...present(l), host: await hostSummary(l.hostId) };
  });

  app.get("/v1/listings/:id/calendar", { preHandler: optionalAuth(deps.verifier) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { from, to } = parse(calendarQuerySchema, req.query);
    const l = await load(id);
    const isOwner = req.user && (req.user.sub === l.hostId || isAdmin(req.user));
    if (l.status !== "PUBLISHED" && !isOwner) throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    const nights = await repo.calendar(l, from, to);
    // Guests see only "available or not"; hosts see why (BLOCKED vs HELD vs BOOKED).
    return {
      listingId: id,
      currency: "INR",
      nights: isOwner
        ? nights
        : nights.map((n) => ({ date: n.date, available: n.status === "FREE", pricePaise: n.pricePaise })),
    };
  });

  // ---------- host ----------

  app.post("/v1/listings", { preHandler: auth(["host"]) }, async (req, reply) => {
    const input = parse(createListingSchema, req.body);
    const l = await repo.create(req.user!.sub, input);
    return reply.status(201).send(present(l));
  });

  app.patch("/v1/listings/:id", { preHandler: auth(["host", "admin"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(updateListingSchema, req.body);
    const l = await loadOwned(id, req.user);
    if (l.status === "SUSPENDED" && !isAdmin(req.user)) throw new HttpError(409, "SUSPENDED", "listing is suspended");
    const problem = pricingProblems({ ...l, ...input });
    if (problem) throw new HttpError(400, "VALIDATION_FAILED", problem, { formErrors: [problem], fieldErrors: {} });
    return present(await repo.update(l, input));
  });

  app.post("/v1/listings/:id/publish", { preHandler: auth(["host"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const l = await loadOwned(id, req.user);
    if (l.photos.length < deps.minPhotosToPublish) {
      throw new HttpError(409, "PHOTOS_REQUIRED", `add at least ${deps.minPhotosToPublish} photo(s) before publishing`);
    }
    if (deps.requirePayoutAccount) {
      const host = await repo.hostProfile(l.hostId);
      if (host?.razorpayAccountStatus !== "activated") {
        throw new HttpError(409, "PAYOUT_ACCOUNT_REQUIRED", "complete payout (Razorpay) onboarding before publishing");
      }
    }
    return present(await repo.publish(l));
  });

  app.post("/v1/listings/:id/unpublish", { preHandler: auth(["host"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const l = await loadOwned(id, req.user);
    return present(await repo.unpublish(l, "DRAFT", ["PUBLISHED"]));
  });

  app.get("/v1/host/listings", { preHandler: auth(["host"]) }, async (req) => {
    const { limit, cursor } = parse(listQuerySchema, req.query);
    const page = await repo.listByHost(req.user!.sub, limit, cursor);
    return { items: page.items.map(present), nextCursor: page.nextCursor ?? null };
  });

  app.put("/v1/listings/:id/calendar", { preHandler: auth(["host"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(calendarUpdateSchema, req.body);
    await loadOwned(id, req.user);
    try {
      return await repo.updateCalendar(id, body);
    } catch (e) {
      if (e instanceof RangeError) throw new HttpError(400, "INVALID_RANGE", e.message);
      throw e;
    }
  });

  app.post("/v1/listings/:id/photos/upload-url", { preHandler: auth(["host"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { contentType } = parse(photoUploadSchema, req.body);
    await loadOwned(id, req.user);
    return deps.photos.presignUpload(id, contentType);
  });

  app.post("/v1/listings/:id/photos", { preHandler: auth(["host"]) }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { photoId } = parse(attachPhotoSchema, req.body);
    await loadOwned(id, req.user);
    if (!(await deps.photos.exists(id, photoId))) {
      throw new HttpError(409, "UPLOAD_NOT_FOUND", "upload the photo before attaching it");
    }
    return reply.status(201).send(present(await repo.attachPhoto(id, photoId)));
  });

  app.put("/v1/listings/:id/photos", { preHandler: auth(["host"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { photos, version } = parse(reorderPhotosSchema, req.body);
    const l = await loadOwned(id, req.user);
    return present(await repo.setPhotos(l, photos, version));
  });

  // ---------- admin ----------

  /** Staff must say why; the reason goes to the audit log. Optional so older clients keep working. */
  const adminReason = z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict();

  app.post("/v1/admin/listings/:id/suspend", { preHandler: auth(["admin"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const l = await load(id);
    const { reason } = parse(adminReason, req.body ?? {});
    const out = present(await repo.unpublish(l, "SUSPENDED", ["PUBLISHED", "DRAFT"]));
    req.log.info({ listingId: id, admin: req.user!.sub }, "listing suspended");
    await writeAudit(deps.ddb, { actor: actorOf(req.user), action: "listing.suspend", targetType: "listing", targetId: id, detail: { reason, title: l.title, hostId: l.hostId, from: l.status } }, req.log);
    return out;
  });

  app.post("/v1/admin/listings/:id/reinstate", { preHandler: auth(["admin"]) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(adminReason, req.body ?? {});
    const l = await load(id);
    const out = present(await repo.unpublish(l, "DRAFT", ["SUSPENDED"]));
    await writeAudit(deps.ddb, { actor: actorOf(req.user), action: "listing.reinstate", targetType: "listing", targetId: id, detail: { reason, title: l.title, hostId: l.hostId } }, req.log);
    return out;
  });

  return { app, markDraining };
}
