import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminAction } from "@/components/admin/AdminAction";
import { Pager, Table, Td } from "@/components/admin/Table";
import { requireAdmin } from "@/lib/admin";
import { age, dateTime } from "@/lib/admin-format";
import type { ListingEntry } from "@/lib/admin-types";
import { api } from "@/lib/api";
import { formatINR, formatRating } from "@/lib/format";
import type { Page } from "@/lib/types";

export const metadata: Metadata = { title: "Listings" };

const TABS = [
  { k: "published", label: "Live" },
  { k: "draft", label: "Drafts" },
  { k: "suspended", label: "Suspended" },
] as const;

export default async function Listings({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.k === sp.status) ?? TABS[0];
  const page = await api<Page<ListingEntry>>(`/v1/admin/queues/listings-${tab.k}?limit=50${sp.cursor ? `&cursor=${encodeURIComponent(sp.cursor)}` : ""}`, { auth: true });
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Listings</h1>
      <p className="mt-1 text-muted">Most recently changed first. Suspending hides a listing from search and stops new bookings; existing bookings stand.</p>
      <div className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.k} href={`/admin/listings?status=${t.k}`} aria-current={t.k === tab.k ? "page" : undefined} className={clsx("rounded-full border px-4 py-2 text-sm font-semibold", t.k === tab.k ? "border-fg bg-fg text-bg" : "border-line hover:border-fg")}>{t.label}</Link>
        ))}
      </div>
      <div className="mt-6">
        <Table head={["Listing", "Host", "Price", "Photos", "Rating", "Changed", ""]} empty={page.items.length === 0 && { title: `No ${tab.label.toLowerCase()} listings` }}>
          {page.items.map((l) => (
            <tr key={l.listingId}>
              <Td>
                <Link href={`/listing/${l.listingId}`} className="font-semibold hover:underline" target="_blank">{l.title}</Link>
                <div className="text-muted">{l.city}</div>
              </Td>
              <Td><Link href={`/admin/users/${l.hostId}`} className="hover:underline">{l.hostName ?? "Host"}</Link></Td>
              <Td className="tabular-nums">{formatINR(l.basePricePaise)}</Td>
              <Td className="tabular-nums">{l.photoCount}</Td>
              <Td className="tabular-nums">{l.ratingCount ? `${formatRating(l.ratingAvg)} (${l.ratingCount})` : "—"}</Td>
              <Td><span title={dateTime(l.since)}>{age(l.since)}</span></Td>
              <Td className="text-right">
                {l.status === "SUSPENDED" ? (
                  <AdminAction path={`/v1/admin/listings/${l.listingId}/reinstate`} label="Reinstate" title={`Reinstate “${l.title}”?`} body="It returns to the host as a draft; they choose when to publish again." confirmLabel="Reinstate" reason />
                ) : (
                  <AdminAction path={`/v1/admin/listings/${l.listingId}/suspend`} label="Suspend" title={`Suspend “${l.title}”?`} body="The listing disappears from search and can't be booked or edited by the host. Existing bookings are not cancelled." confirmLabel="Suspend listing" variant="danger" reason />
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <Pager next={page.nextCursor} base={`/admin/listings?status=${tab.k}`} />
      </div>
    </div>
  );
}
