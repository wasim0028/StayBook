import type { Metadata } from "next";
import Link from "next/link";
import { Mono, Pager, Table, Td } from "@/components/admin/Table";
import { requireAdmin } from "@/lib/admin";
import { dateTime } from "@/lib/admin-format";
import type { AuditItem } from "@/lib/admin-types";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export const metadata: Metadata = { title: "Audit log" };

const ACTION: Record<string, string> = {
  "listing.suspend": "Suspended listing",
  "listing.reinstate": "Reinstated listing",
  "booking.cancel": "Cancelled booking",
  "booking.retry_refund": "Retried refund",
  "user.disable": "Disabled account",
  "user.enable": "Re-enabled account",
};
const href = (a: AuditItem) => (a.targetType === "booking" ? `/admin/bookings/${a.targetId}` : a.targetType === "user" ? `/admin/users/${a.targetId}` : `/listing/${a.targetId}`);

function months(n: number): string[] {
  const d = new Date(Date.now() + 330 * 60_000);
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    return x.toISOString().slice(0, 7);
  });
}

export default async function Audit({ searchParams }: { searchParams: Promise<{ month?: string; cursor?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const opts = months(12);
  const month = sp.month && opts.includes(sp.month) ? sp.month : opts[0]!;
  const page = await api<Page<AuditItem>>(`/v1/admin/audit?month=${month}&limit=50${sp.cursor ? `&cursor=${encodeURIComponent(sp.cursor)}` : ""}`, { auth: true });
  const mLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
          <p className="mt-1 text-muted">Every staff action, newest first. Kept for 3 years.</p>
        </div>
        <form action="/admin/audit">
          <select name="month" defaultValue={month} aria-label="Month" className="h-10 rounded-xl border border-line bg-surface px-3">
            {opts.map((m) => <option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
          <button className="ml-2 h-10 rounded-xl border border-line px-4 text-sm font-semibold hover:border-fg">Show</button>
        </form>
      </div>
      <div className="mt-6">
        <Table head={["When", "Who", "Action", "Target", "Details"]} empty={page.items.length === 0 && { title: `No staff actions in ${mLabel(month)}` }}>
          {page.items.map((a, i) => (
            <tr key={`${a.at}-${i}`}>
              <Td className="whitespace-nowrap text-muted">{dateTime(a.at)}</Td>
              <Td><Link href={`/admin/users/${a.actor}`} className="hover:underline"><Mono>{a.actor.slice(0, 8)}</Mono></Link></Td>
              <Td className="font-medium">{ACTION[a.action] ?? a.action}</Td>
              <Td><Link href={href(a)} className="hover:underline"><Mono>{a.targetId.slice(0, 8)}</Mono></Link></Td>
              <Td className="max-w-96 text-muted">
                {typeof a.detail?.reason === "string" && <span className="text-fg">“{a.detail.reason}”</span>}
                {a.detail && <span className="ml-1 text-xs">{Object.entries(a.detail).filter(([k]) => k !== "reason").map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</span>}
              </Td>
            </tr>
          ))}
        </Table>
        <Pager next={page.nextCursor} base={`/admin/audit?month=${month}`} />
      </div>
    </div>
  );
}
