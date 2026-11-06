import {
  createServer,
  ddbReady,
  HttpError,
  normalizeAccountStatus,
  parse,
  RazorpayError,
  requireAuth,
  type DdbContext,
  type RazorpayAccounts,
  type TokenVerifier,
} from "@mp/shared";
import { z } from "zod";
import type { GroupAdmin } from "./cognito.js";
import { UserRepo, type OnboardingStep, type UserProfile } from "./repo.js";
import { onboardingSchema, profileUpdateSchema, type OnboardingInput } from "./schemas.js";

export interface AppDeps {
  ddb: DdbContext;
  verifier: TokenVerifier;
  accounts: RazorpayAccounts;
  groups: GroupAdmin;
  cdnBaseUrl: string;
  logger?: boolean;
}

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
});
const refreshQuery = z.object({ refresh: z.enum(["true", "false"]).default("false") });

const STEPS: OnboardingStep[] = ["account", "stakeholder", "product", "settlement", "done"];
const atLeast = (cur: OnboardingStep | undefined, step: OnboardingStep) =>
  cur !== undefined && STEPS.indexOf(cur) >= STEPS.indexOf(step);

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({
    name: "user-svc",
    ready: () => ddbReady(deps.ddb),
    logger: deps.logger === false ? false : undefined,
  });
  const repo = new UserRepo(deps.ddb);
  const cdn = deps.cdnBaseUrl.replace(/\/$/, "");
  const authed = requireAuth(deps.verifier);

  function presentMe(p: UserProfile) {
    return {
      userId: p.userId,
      displayName: p.displayName ?? null,
      bio: p.bio ?? null,
      phone: p.phone ?? null,
      isHost: !!p.razorpayAccountId,
      host: p.razorpayAccountId
        ? {
            onboardingStep: p.onboardingStep ?? "account",
            payoutStatus: p.razorpayAccountStatus ?? "created",
            canPublish: p.razorpayAccountStatus === "activated",
            legalBusinessName: p.legalBusinessName ?? null,
            bankLast4: p.bankLast4 ?? null,
          }
        : null,
      createdAt: p.createdAt,
    };
  }

  // ---------- profile ----------

  app.get("/v1/me", { preHandler: authed }, async (req) => presentMe(await repo.ensure(req.user!.sub)));

  app.put("/v1/me", { preHandler: authed }, async (req) => {
    const patch = parse(profileUpdateSchema, req.body);
    return presentMe(await repo.update(req.user!.sub, patch));
  });

  // ---------- host onboarding (Razorpay Route linked account) ----------

  function razorpayFailure(e: unknown, step: string): never {
    if (e instanceof RazorpayError) {
      // 4xx from Razorpay means our input was rejected (bad PAN, IFSC...): the host can fix and retry.
      if (e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 429) {
        throw new HttpError(422, "ONBOARDING_REJECTED", e.message, { step });
      }
      app.log.error({ step, status: e.status, code: e.code }, "razorpay onboarding failed");
    }
    throw new HttpError(502, "PAYOUT_PROVIDER_ERROR", "could not reach the payout provider, please retry", { step });
  }

  /**
   * Resumable: each Razorpay call is recorded as a step on the profile, so a retry after a failure
   * continues where it stopped and never creates a second linked account.
   */
  app.post("/v1/host/onboarding", { preHandler: authed }, async (req, reply) => {
    const input: OnboardingInput = parse(onboardingSchema, req.body);
    const userId = req.user!.sub;
    let p = await repo.ensure(userId);

    if (atLeast(p.onboardingStep, "done")) {
      throw new HttpError(409, "ALREADY_ONBOARDED", "payout account already set up");
    }

    const address = input.address;
    let step: OnboardingStep = p.onboardingStep ?? "account";

    try {
      if (!p.razorpayAccountId) {
        const acc = await deps.accounts.createAccount({
          referenceId: userId,
          email: input.email,
          phone: input.phone,
          legalBusinessName: input.legalBusinessName,
          businessType: input.businessType,
          contactName: input.contactName,
          pan: input.pan,
          gstin: input.gstin,
          address,
        });
        await repo.linkAccount(acc.id, userId);
        p = await repo.update(userId, {
          razorpayAccountId: acc.id,
          razorpayAccountStatus: normalizeAccountStatus(acc.status) ?? "created",
          onboardingStep: "account",
          legalBusinessName: input.legalBusinessName,
          // A GSTIN means the host remits GST on their stays; otherwise the platform does (section 9(5)).
          ...(input.gstin ? { gstin: input.gstin } : {}),
          hostSince: new Date().toISOString(),
        });
        step = "account";
      }
      const accountId = p.razorpayAccountId!;

      // Hosts may draft listings right away; publishing stays gated on payoutStatus === "activated".
      await deps.groups.addToGroup(userId, "host");

      if (!atLeast(step, "stakeholder")) {
        await deps.accounts.addStakeholder(accountId, {
          name: input.contactName,
          email: input.email,
          phone: input.phone,
          pan: input.pan,
          address,
        });
        p = await repo.update(userId, { onboardingStep: "stakeholder" });
        step = "stakeholder";
      }

      if (!atLeast(step, "product")) {
        const prod = await deps.accounts.requestRouteProduct(accountId);
        p = await repo.update(userId, { razorpayProductId: prod.id, onboardingStep: "product" });
        step = "product";
      }

      if (!atLeast(step, "settlement")) {
        const r = await deps.accounts.setSettlement(accountId, p.razorpayProductId!, input.bank);
        p = await repo.update(userId, {
          onboardingStep: "done",
          bankLast4: input.bank.accountNumber.slice(-4),
          razorpayAccountStatus: normalizeAccountStatus(r.activationStatus) ?? p.razorpayAccountStatus ?? "under_review",
        });
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      return razorpayFailure(e, step);
    }

    return reply.status(201).send(presentMe(p));
  });

  /** Onboarding progress. `?refresh=true` asks Razorpay for the live status (the webhook normally keeps it current). */
  app.get("/v1/host/onboarding", { preHandler: authed }, async (req) => {
    const { refresh } = parse(refreshQuery, req.query);
    let p = await repo.ensure(req.user!.sub);
    if (!p.razorpayAccountId) throw new HttpError(404, "NOT_ONBOARDING", "host onboarding has not started");
    if (refresh === "true") {
      try {
        const live = await deps.accounts.getAccount(p.razorpayAccountId);
        const status = normalizeAccountStatus(live.status);
        if (status && status !== p.razorpayAccountStatus) p = await repo.update(p.userId, { razorpayAccountStatus: status });
      } catch (e) {
        return razorpayFailure(e, "refresh");
      }
    }
    return presentMe(p);
  });

  // ---------- wishlist ----------

  const present = (l: Record<string, unknown>) => ({
    id: l.id,
    title: l.title,
    city: l.city,
    propertyType: l.propertyType,
    pricePaise: l.basePricePaise,
    coverPhotoUrl: l.coverPhotoId ? `${cdn}/listings/${l.id}/${l.coverPhotoId}/w720.webp` : null,
    ...(l.ratingCount ? { ratingAvg: l.ratingAvg, ratingCount: l.ratingCount } : {}),
  });

  app.get("/v1/wishlist", { preHandler: authed }, async (req) => {
    const { limit, cursor } = parse(listQuery, req.query);
    const { ids, nextCursor } = await repo.listWishIds(req.user!.sub, limit, cursor);
    // Listings that were suspended or deleted since being saved are simply left out.
    const listings = (await repo.getListings(ids)).filter((l) => l.status === "PUBLISHED");
    return { items: listings.map(present), nextCursor };
  });

  app.put("/v1/wishlist/:id", { preHandler: authed }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [l] = await repo.getListings([id]);
    if (!l || l.status !== "PUBLISHED") throw new HttpError(404, "LISTING_NOT_FOUND", "listing not found");
    await repo.addWish(req.user!.sub, id);
    return reply.status(204).send();
  });

  app.delete("/v1/wishlist/:id", { preHandler: authed }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await repo.removeWish(req.user!.sub, id);
    return reply.status(204).send();
  });

  return { app, markDraining, repo };
}
