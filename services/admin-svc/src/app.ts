import { actorOf, createServer, ddbReady, HttpError, istMonth, OPS_QUEUES, parse, requireAuth, writeAudit, type DdbContext, type TokenVerifier } from "@mp/shared";
import { z } from "zod";
import type { Directory } from "./directory.js";
import { AdminRepo } from "./repo.js";

export interface AppDeps {
  ddb: DdbContext;
  verifier: TokenVerifier;
  directory: Directory;
  clock?: () => number;
  logger?: boolean;
}

/** Counters ops-indexer maintains per IST day (see lambdas/ops-indexer). */
export const METRIC_FIELDS = ["checkouts", "bookings", "gmvPaise", "feePaise", "nights", "cancellations", "refundPaise", "expired", "signups", "hostsOnboarded", "hostsActivated", "listingsPublished"] as const;
type MetricField = (typeof METRIC_FIELDS)[number];

const MAX_METRIC_DAYS = 366;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuid = z.string().uuid();
const page = { limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(2048).optional() };

const istDay = (epochSec: number) => new Date(epochSec * 1000 + 330 * 60_000).toISOString().slice(0, 10);
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({ name: "admin-svc", ready: () => ddbReady(deps.ddb), logger: deps.logger === false ? false : undefined });
  const repo = new AdminRepo(deps.ddb);
  const now = () => deps.clock?.() ?? Math.floor(Date.now() / 1000);
  const admin = requireAuth(deps.verifier, ["admin"]);
  const staff = requireAuth(deps.verifier, ["admin", "analyst"]);

  async function metrics(from: string, to: string) {
    const stored = await repo.metricDays(from, to);
    const days: (Record<MetricField, number> & { day: string })[] = [];
    const totals = Object.fromEntries(METRIC_FIELDS.map((f) => [f, 0])) as Record<MetricField, number>;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const i = stored.get(d) ?? {};
      const row = Object.fromEntries(METRIC_FIELDS.map((f) => [f, Number(i[f] ?? 0)])) as Record<MetricField, number>;
      for (const f of METRIC_FIELDS) totals[f] += row[f];
      days.push({ day: d, ...row });
    }
    const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
    return {
      from,
      to,
      currency: "INR",
      days,
      totals,
      rates: {
        /** paid bookings per checkout started */
        conversion: rate(totals.bookings, totals.checkouts),
        /** cancellations per paid booking (by day of each event, so approximate over short ranges) */
        cancellation: rate(totals.cancellations, totals.bookings),
        avgBookingPaise: totals.bookings ? Math.round(totals.gmvPaise / totals.bookings) : null,
      },
    };
  }

  // ---------- overview & metrics (admins and the digital/sales team) ----------

  app.get("/v1/admin/metrics", { preHandler: staff }, async (req) => {
    const today = istDay(now());
    const q = parse(z.object({ from: day.optional(), to: day.optional() }), req.query);
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -29);
    if (from > to) throw new HttpError(400, "INVALID_RANGE", "`from` must not be after `to`");
    if (daysBetween(from, to) + 1 > MAX_METRIC_DAYS) throw new HttpError(400, "INVALID_RANGE", `at most ${MAX_METRIC_DAYS} days`);
    return metrics(from, to);
  });

  app.get("/v1/admin/overview", { preHandler: staff }, async (req) => {
    const today = istDay(now());
    const [m, refunds, hosts] = await Promise.all([
      metrics(addDays(today, -6), today),
      req.user!.groups.includes("admin") ? repo.queueSize("refunds") : null,
      req.user!.groups.includes("admin") ? repo.queueSize("hosts") : null,
    ]);
    return { today: m.days[m.days.length - 1], last7: { totals: m.totals, rates: m.rates }, queues: refunds && hosts ? { refunds, hosts } : null };
  });

  // ---------- work queues (admins) ----------

  app.get("/v1/admin/queues/:queue", { preHandler: admin }, async (req) => {
    const { queue } = parse(z.object({ queue: z.enum(OPS_QUEUES) }), req.params);
    const { limit, cursor } = parse(z.object(page), req.query);
    const r = await repo.queue(queue, limit, cursor);
    // Attach names so staff can tell people apart at a glance.
    const ids = r.items.flatMap((i) => [i.guestId, i.hostId, i.userId].filter((x): x is string => typeof x === "string"));
    const names = await repo.profiles(ids);
    const nameOf = (id: unknown) => (typeof id === "string" ? ((names.get(id)?.displayName as string | undefined) ?? null) : null);
    return { items: r.items.map((i) => ({ ...i, guestName: nameOf(i.guestId), hostName: nameOf(i.hostId) })), nextCursor: r.nextCursor };
  });

  // ---------- users (admins) ----------

  app.get("/v1/admin/users", { preHandler: admin }, async (req) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().min(3).max(120).regex(/^[a-z0-9._%+@-]+$/, "letters, digits and . _ % + - @ only") }), req.query);
    return { items: await deps.directory.findByEmailPrefix(email, 20) };
  });

  app.get("/v1/admin/users/:id", { preHandler: admin }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [account, profile, listings, hostBookings, trips] = await Promise.all([
      deps.directory.get(id),
      repo.profile(id),
      repo.hostItems(id, "LISTING#", 50),
      repo.hostItems(id, "BOOKING#", 10),
      repo.guestBookings(id, 10),
    ]);
    if (!account && !profile) throw new HttpError(404, "USER_NOT_FOUND", "user not found");
    return { userId: id, account, profile, listings, hostBookings, trips };
  });

  for (const action of ["disable", "enable"] as const) {
    app.post(`/v1/admin/users/:id/${action}`, { preHandler: admin }, async (req) => {
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }).strict(), req.body ?? {});
      if (id === req.user!.sub) throw new HttpError(409, "SELF_ACTION", "you can't change your own account");
      const u = await deps.directory.get(id);
      if (!u) throw new HttpError(404, "USER_NOT_FOUND", "user not found");
      if (action === "disable" && u.groups?.includes("admin")) throw new HttpError(409, "PROTECTED_USER", "admins can't be disabled from the console");
      await deps.directory.setEnabled(id, action === "enable");
      await writeAudit(deps.ddb, { actor: actorOf(req.user), action: `user.${action}`, targetType: "user", targetId: id, detail: { reason, email: u.email } }, req.log, new Date(now() * 1000));
      req.log.info({ userId: id, admin: req.user!.sub, action }, "user account changed");
      return { ...u, enabled: action === "enable" };
    });
  }

  // ---------- audit log (admins) ----------

  app.get("/v1/admin/audit", { preHandler: admin }, async (req) => {
    const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), ...page }), req.query);
    return repo.audit(q.month ?? istMonth(new Date(now() * 1000)), q.limit, q.cursor);
  });

  return { app, markDraining };
}
