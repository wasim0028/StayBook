import type { Metadata } from "next";
import Link from "next/link";
import { AdminAction } from "@/components/admin/AdminAction";
import { Mono, Pager, Table, Td } from "@/components/admin/Table";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { age, dateTime } from "@/lib/admin-format";
import type { RefundEntry } from "@/lib/admin-types";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/format";
import type { Page } from "@/lib/types";

export const metadata: Metadata = { title: "Refunds" };
const STUCK_MINUTES = 10;

export default async function Refunds({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await requireAdmin();
  const { cursor } = await searchParams;
  const page = await api<Page<RefundEntry>>(`/v1/admin/queues/refunds?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { auth: true });
  const now = Date.now();

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Refunds needing attention</h1>
      <p className="mt-1 max-w-2xl text-muted">Refunds Razorpay rejected, and refunds that haven&apos;t finished within {STUCK_MINUTES} minutes. Retrying is safe: a host transfer is never reversed twice.</p>
      <div className="mt-6">
        <Table head={["Booking", "Guest / host", "Refund", "Status", "Waiting", ""]} empty={page.items.length === 0 && { title: "No refunds need attention", body: "Failed or stuck refunds appear here automatically." }}>
          {page.items.map((r) => {
            const mins = (now - Date.parse(r.since)) / 60_000;
            const stuck = r.refundStatus !== "FAILED" && mins >= STUCK_MINUTES;
            return (
              <tr key={r.bookingId}>
                <Td>
                  <Link href={`/admin/bookings/${r.bookingId}`} className="font-semibold hover:underline">{r.listingTitle ?? "Booking"}</Link>
                  <div className="mt-0.5"><Mono>{r.bookingId.slice(0, 8)}</Mono></div>
                </Td>
                <Td>
                  <Link href={`/admin/users/${r.guestId}`} className="hover:underline">{r.guestName ?? "Guest"}</Link>
                  <div className="text-muted"><Link href={`/admin/users/${r.hostId}`} className="hover:underline">{r.hostName ?? "Host"}</Link></div>
                </Td>
                <Td className="tabular-nums">
                  <div className="font-semibold">{formatINR(r.refundPaise ?? 0)}</div>
                  <div className="text-muted">of {formatINR(r.totalPaise)}</div>
                </Td>
                <Td>
                  <Badge tone={r.refundStatus === "FAILED" ? "bad" : stuck ? "warn" : "info"}>{r.refundStatus === "FAILED" ? "Failed" : stuck ? "Stuck" : "In progress"}</Badge>
                  {r.refundError && <div className="mt-1 max-w-56 text-xs text-muted">{r.refundError}</div>}
                </Td>
                <Td><span title={dateTime(r.since)}>{age(r.since, now)}</span></Td>
                <Td className="text-right">
                  {(r.refundStatus === "FAILED" || (r.refundStatus === "PENDING" && stuck)) && (
                    <AdminAction path={`/v1/admin/bookings/${r.bookingId}/retry-refund`} label="Retry" title="Retry this refund?" body={`Asks Razorpay again to refund ${formatINR(r.refundPaise ?? 0)} to the guest. The attempt is recorded in the audit log.`} confirmLabel="Retry refund" variant="primary" />
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        <Pager next={page.nextCursor} base="/admin/refunds" />
      </div>
    </div>
  );
}
