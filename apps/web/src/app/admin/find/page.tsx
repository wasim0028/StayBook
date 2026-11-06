import { notFound, redirect } from "next/navigation";
import { EmptyState, LinkButton } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { api, ApiError } from "@/lib/api";
import { SearchX } from "lucide-react";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function exists(path: string): Promise<boolean> {
  try {
    await api(path, { auth: true });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

/** One box for everything: an id is tried as a booking, listing, then user; anything else is an email. */
export default async function Find({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const q = (await searchParams).q?.trim() ?? "";
  if (!q) notFound();
  if (UUID.test(q)) {
    const id = q.toLowerCase();
    const [booking, listing, user] = await Promise.all([exists(`/v1/bookings/${id}`), exists(`/v1/listings/${id}`), exists(`/v1/admin/users/${id}`)]);
    if (booking) redirect(`/admin/bookings/${id}`);
    if (listing) redirect(`/listing/${id}`);
    if (user) redirect(`/admin/users/${id}`);
  } else if (q.length >= 3) {
    redirect(`/admin/users?email=${encodeURIComponent(q)}`);
  }
  return <EmptyState icon={<SearchX className="size-6" />} title="Nothing found" body={`No booking, listing or user matches “${q}”.`} action={<LinkButton href="/admin">Back to overview</LinkButton>} />;
}
