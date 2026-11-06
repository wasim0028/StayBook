import { Home, ImageOff, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Rating } from "@/components/Stars";
import { Badge, EmptyState, LinkButton } from "@/components/ui";
import { PROPERTY_LABEL } from "@/lib/amenities";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { requireHost } from "@/lib/host-guard";
import type { Listing, Page } from "@/lib/types";

export const metadata: Metadata = { title: "Your listings" };

const STATUS = { PUBLISHED: { label: "Listed", tone: "ok" }, DRAFT: { label: "Draft", tone: "neutral" }, SUSPENDED: { label: "Suspended", tone: "bad" } } as const;

export default async function HostListings() {
  await requireHost();
  const page = await api<Page<Listing>>("/v1/host/listings?limit=50", { auth: true });
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Your listings</h1>
        <LinkButton href="/host/listings/new"><Plus className="size-4" /> Create listing</LinkButton>
      </div>
      {page.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<Home className="size-6" />} title="No listings yet" body="Create your first listing. It stays a private draft until you publish it." action={<LinkButton href="/host/listings/new">Create listing</LinkButton>} />
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {page.items.map((l) => (
            <Link key={l.id} href={`/host/listings/${l.id}`} className="group overflow-hidden rounded-2xl border border-line bg-surface transition hover:shadow-card">
              <div className="relative aspect-[4/3] bg-surface-2">
                {l.photoUrls[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.photoUrls[0]} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                ) : (
                  <div className="grid size-full place-items-center text-muted"><ImageOff className="size-8" /></div>
                )}
                <span className="absolute left-3 top-3"><Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge></span>
              </div>
              <div className="p-4">
                <h2 className="truncate font-semibold">{l.title}</h2>
                <p className="mt-0.5 text-sm text-muted">{PROPERTY_LABEL[l.propertyType]} · {l.city}</p>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span><span className="font-semibold">{formatINR(l.basePricePaise)}</span> <span className="text-muted">night</span></span>
                  <Rating avg={l.ratingAvg} count={l.ratingCount} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
