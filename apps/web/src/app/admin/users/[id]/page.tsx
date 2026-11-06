import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminAction } from "@/components/admin/AdminAction";
import { Mono, Table, Td } from "@/components/admin/Table";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import type { AdminUser } from "@/lib/admin-types";
import { api, ApiError } from "@/lib/api";
import { STATUS_UI } from "@/lib/booking-ui";
import { formatINR, formatRange } from "@/lib/format";
import type { BookingStatus } from "@/lib/types";

export const metadata: Metadata = { title: "User" };

type B = { bookingId: string; listingTitle?: string; checkIn: string; checkOut: string; totalPaise: number; status: BookingStatus };

function Bookings({ items, empty }: { items: B[]; empty: string }) {
  return (
    <Table head={["Booking", "Dates", "Total", "Status"]} empty={items.length === 0 && { title: empty }}>
      {items.map((b) => (
        <tr key={b.bookingId}>
          <Td><Link href={`/admin/bookings/${b.bookingId}`} className="font-semibold hover:underline">{b.listingTitle ?? b.bookingId.slice(0, 8)}</Link></Td>
          <Td>{formatRange(b.checkIn, b.checkOut)}</Td>
          <Td className="tabular-nums">{formatINR(b.totalPaise)}</Td>
          <Td><Badge tone={STATUS_UI[b.status].tone}>{STATUS_UI[b.status].label}</Badge></Td>
        </tr>
      ))}
    </Table>
  );
}

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let u: AdminUser;
  try {
    u = await api<AdminUser>(`/v1/admin/users/${id}`, { auth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const a = u.account;
  const p = (u.profile ?? {}) as Record<string, string | undefined>;
  const name = (p.displayName as string) ?? a?.name ?? a?.email ?? "User";
  const isAdminTarget = a?.groups?.includes("admin");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
            {a && (a.enabled ? <Badge tone="ok">Active</Badge> : <Badge tone="bad">Disabled</Badge>)}
            {a?.groups?.map((g) => <Badge key={g} tone={g === "admin" ? "brand" : "neutral"}>{g}</Badge>)}
          </div>
          <p className="mt-1 text-muted">{a?.email ?? "No sign-in account"} · <Mono>{u.userId}</Mono></p>
        </div>
        {a && id !== me.sub && !isAdminTarget && (a.enabled ? (
          <AdminAction path={`/v1/admin/users/${id}/disable`} label="Disable account" title={`Disable ${name}?`} body="They are signed out everywhere and can't sign in again until re-enabled. Their bookings and listings are not changed." confirmLabel="Disable account" variant="danger" size="md" reason />
        ) : (
          <AdminAction path={`/v1/admin/users/${id}/enable`} label="Re-enable account" title={`Re-enable ${name}?`} body="They can sign in again." confirmLabel="Re-enable" size="md" reason />
        ))}
      </div>

      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-3">
        <div><div className="text-sm text-muted">Phone</div><div className="font-medium">{p.phone ?? "—"}</div></div>
        <div><div className="text-sm text-muted">Joined</div><div className="font-medium">{a?.createdAt ? new Date(a.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"}</div></div>
        <div>
          <div className="text-sm text-muted">Payouts</div>
          <div className="font-medium">{p.onboardingStep ? `${p.razorpayAccountStatus ?? "—"} · step ${p.onboardingStep}` : "Not a host"}</div>
          {p.razorpayAccountId && <div className="mt-0.5"><Mono>{p.razorpayAccountId}</Mono></div>}
        </div>
      </section>

      {u.listings.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Listings</h2>
          <Table head={["Listing", "City", "Price", "Status"]}>
            {(u.listings as { id: string; title: string; city: string; basePricePaise: number; status: string }[]).map((l) => (
              <tr key={l.id}>
                <Td><Link href={`/listing/${l.id}`} target="_blank" className="font-semibold hover:underline">{l.title}</Link></Td>
                <Td>{l.city}</Td>
                <Td className="tabular-nums">{formatINR(l.basePricePaise)}</Td>
                <Td><Badge tone={l.status === "PUBLISHED" ? "ok" : l.status === "SUSPENDED" ? "bad" : "neutral"}>{l.status.toLowerCase()}</Badge></Td>
              </tr>
            ))}
          </Table>
        </section>
      )}
      {u.hostBookings.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Bookings as host (latest check-in first)</h2>
          <Bookings items={u.hostBookings as unknown as B[]} empty="" />
        </section>
      )}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Trips as guest</h2>
        <Bookings items={u.trips as unknown as B[]} empty="No trips" />
      </section>
    </div>
  );
}
