import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { requireHost } from "@/lib/host-guard";
import type { Listing, Me } from "@/lib/types";
import { ListingEditor } from "./ListingEditor";

export const metadata: Metadata = { title: "Edit listing" };

export default async function EditListingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireHost();
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let listing: Listing;
  try {
    listing = await api<Listing>(`/v1/listings/${id}`, { auth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const me = await api<Me>("/v1/me", { auth: true });
  return <ListingEditor initial={listing} payoutActive={me.host?.payoutStatus === "activated"} initialTab={tab === "photos" || tab === "calendar" ? tab : "details"} />;
}
