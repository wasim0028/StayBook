import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { StatTile } from "@/components/admin/StatTile";
import { compactINR, count, dayLabel, dayTick, fmtMetric, pct } from "@/lib/admin-format";
import { METRIC_FIELDS, METRIC_LABEL, type Metrics } from "@/lib/admin-types";
import { api } from "@/lib/api";
import { CountChart, MoneyChart } from "../Charts";
import { CsvButton } from "./CsvButton";

export const metadata: Metadata = { title: "Metrics" };

const RANGES = [7, 30, 90, 365] as const;
const monthShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

export default async function MetricsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r) === sp.days) ?? 30;
  const to = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const fromD = new Date(`${to}T00:00:00Z`);
  fromD.setUTCDate(fromD.getUTCDate() - (days - 1));
  const m = await api<Metrics>(`/v1/admin/metrics?from=${fromD.toISOString().slice(0, 10)}&to=${to}`, { auth: true });
  const t = m.totals;
  const pts = (f: (typeof METRIC_FIELDS)[number]) => m.days.map((d) => ({ label: dayLabel(d.day), tick: days > 31 ? (d.day.endsWith("-01") ? monthShort(d.day) : "") : dayTick(d.day), value: d[f] }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Metrics</h1>
          <p className="mt-1 text-muted">{dayLabel(m.from)} – {dayLabel(m.to)} · India time</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <Link key={r} href={`/admin/metrics?days=${r}`} aria-current={r === days ? "page" : undefined} className={clsx("rounded-full border px-4 py-2 text-sm font-semibold", r === days ? "border-fg bg-fg text-bg" : "border-line hover:border-fg")}>
              {r === 365 ? "12 months" : `${r} days`}
            </Link>
          ))}
          <CsvButton metrics={m} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Gross bookings" value={compactINR(t.gmvPaise)} sub={`${count(t.bookings)} paid bookings`} />
        <StatTile label="Platform fees" value={compactINR(t.feePaise)} sub={t.gmvPaise ? `${pct(t.feePaise / t.gmvPaise)} of GMV` : undefined} />
        <StatTile label="Checkout conversion" value={pct(m.rates.conversion)} sub={`${count(t.checkouts)} checkouts · ${count(t.expired)} expired`} />
        <StatTile label="Cancellation rate" value={pct(m.rates.cancellation)} sub={`${compactINR(t.refundPaise)} refunded`} />
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        {[
          <CountChart key="b" title="Paid bookings" points={pts("bookings")} />,
          <MoneyChart key="g" title="Gross bookings (GMV)" points={pts("gmvPaise")} />,
          <CountChart key="s" title="Sign-ups" points={pts("signups")} />,
          <CountChart key="l" title="Listings published" points={pts("listingsPublished")} />,
        ].map((c, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">{c}</div>
        ))}
      </section>

      <section className="rounded-2xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-4 text-lg font-semibold">Totals</h2>
        <dl className="grid sm:grid-cols-2 lg:grid-cols-3">
          {METRIC_FIELDS.map((f) => (
            <div key={f} className="flex justify-between gap-4 border-b border-line px-5 py-3 text-[15px]">
              <dt className="text-muted">{METRIC_LABEL[f]}</dt>
              <dd className="font-semibold tabular-nums">{fmtMetric(f, t[f])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
