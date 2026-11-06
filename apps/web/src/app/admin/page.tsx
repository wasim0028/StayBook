import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import { StatTile } from "@/components/admin/StatTile";
import { requireStaff } from "@/lib/admin";
import { compactINR, dayLabel, dayTick, pct } from "@/lib/admin-format";
import type { Metrics, Overview } from "@/lib/admin-types";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { MoneyChart, CountChart } from "./Charts";

export const metadata: Metadata = { title: "Overview" };

/** By India time: the server runs in UTC. */
function greeting(): string {
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export default async function AdminHome() {
  const s = await requireStaff();
  const [ov, m] = await Promise.all([api<Overview>("/v1/admin/overview", { auth: true }), api<Metrics>("/v1/admin/metrics", { auth: true })]);
  const t = ov.last7.totals;
  const q = ov.queues;
  const qv = (c: { count: number; more: boolean }) => `${c.count}${c.more ? "+" : ""}`;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Good {greeting()}{s.name ? `, ${s.name.split(" ")[0]}` : ""}</h1>
        <p className="mt-1 text-muted">Last 7 days, India time. Numbers update within a minute of each booking.</p>
      </div>

      {q && (q.refunds.count > 0 || q.hosts.count > 0) && (
        <div className="flex items-start gap-3 rounded-2xl bg-warn-soft p-4 text-warn">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="text-[15px] font-medium">
            {q.refunds.count > 0 && <>{qv(q.refunds)} refund{q.refunds.count === 1 ? "" : "s"} need attention. </>}
            {q.hosts.count > 0 && <>{qv(q.hosts)} host{q.hosts.count === 1 ? " is" : "s are"} stuck in payout setup.</>}
          </p>
        </div>
      )}

      <section aria-label="Last 7 days" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Paid bookings" value={t.bookings.toLocaleString("en-IN")} sub={`${ov.today.bookings} today`} />
        <StatTile label="Gross bookings" value={compactINR(t.gmvPaise)} sub={`Avg ${ov.last7.rates.avgBookingPaise ? formatINR(ov.last7.rates.avgBookingPaise) : "—"}`} />
        <StatTile label="Platform fees" value={compactINR(t.feePaise)} sub={`${compactINR(ov.today.feePaise)} today`} />
        <StatTile label="Checkout conversion" value={pct(ov.last7.rates.conversion)} sub={`Cancellation rate ${pct(ov.last7.rates.cancellation)}`} />
      </section>

      {q && (
        <section aria-label="Work queues" className="grid gap-4 sm:grid-cols-2">
          <StatTile label="Refunds needing attention" value={qv(q.refunds)} sub="Failed or stuck refunds" href="/admin/refunds" attention={q.refunds.count > 0} />
          <StatTile label="Hosts stuck in payout setup" value={qv(q.hosts)} sub="Incomplete, needs clarification, rejected or suspended" href="/admin/hosts" attention={q.hosts.count > 0} />
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Last 30 days</h2>
        <div className="mt-5 grid gap-10 lg:grid-cols-2">
          <CountChart title="Paid bookings" points={m.days.map((d) => ({ label: dayLabel(d.day), tick: dayTick(d.day), value: d.bookings }))} />
          <MoneyChart title="Gross bookings (GMV)" points={m.days.map((d) => ({ label: dayLabel(d.day), tick: dayTick(d.day), value: d.gmvPaise }))} />
        </div>
      </section>
    </div>
  );
}

