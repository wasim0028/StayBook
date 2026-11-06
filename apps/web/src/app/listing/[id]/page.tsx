import { BedDouble, Bath, DoorOpen, MapPin, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeartButton } from "@/components/HeartButton";
import { HostCard } from "@/components/HostCard";
import { MessageButton } from "@/components/inbox/MessageButton";
import { Rating } from "@/components/Stars";
import { Alert } from "@/components/ui";
import { AMENITY_META, POLICY_COPY, PROPERTY_LABEL } from "@/lib/amenities";
import { api, ApiError, getSession } from "@/lib/api";
import { plural } from "@/lib/format";
import { savedIds } from "@/lib/saved";
import type { Listing, Page, Review } from "@/lib/types";
import { BookingCard } from "./BookingCard";
import { Gallery } from "./Gallery";
import { LocationMap } from "./LocationMap";
import { Reviews } from "./Reviews";

type Params = { id: string };
type SP = { checkIn?: string; checkOut?: string; guests?: string };

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  try {
    // Signed-in owners can preview drafts; for everyone else this is the public listing.
    return await api<Listing>(`/v1/listings/${id}`, { auth: true });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  try {
    const l = await load((await params).id);
    return { title: l.title, description: l.description.slice(0, 160), openGraph: { images: l.photoUrls.slice(0, 1) } };
  } catch {
    return { title: "Stay" };
  }
}

export default async function ListingPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SP> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [l, session] = await Promise.all([load(id), getSession()]);
  const [reviews, saved] = await Promise.all([
    api<Page<Review>>(`/v1/reviews/listing/${id}?limit=6`, { revalidate: 60 }).catch(() => ({ items: [], nextCursor: null })),
    savedIds(!!session),
  ]);
  const isOwner = session?.sub === l.hostId;
  const policy = POLICY_COPY[l.cancellationPolicy]!;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
      {l.status !== "PUBLISHED" && (
        <div className="mb-4">
          <Alert tone="warn">Preview: this listing is {l.status.toLowerCase()} and only you can see it.</Alert>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
            <Rating avg={l.ratingAvg} count={l.ratingCount} />
            <span className="inline-flex items-center gap-1 text-muted">
              <MapPin className="size-4" /> {l.city}, India
            </span>
          </div>
        </div>
        {!isOwner && <HeartButton listingId={l.id} saved={saved.has(l.id)} signedIn={!!session} className="!bg-surface-2 !text-fg" />}
      </div>

      <div className="mt-5">
        <Gallery photos={l.photoUrls} title={l.title} />
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <section className="border-b border-line pb-8">
            <h2 className="text-xl font-semibold">
              {PROPERTY_LABEL[l.propertyType]} in {l.city}
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: Users, text: plural(l.maxGuests, "guest") },
                { icon: DoorOpen, text: plural(l.bedrooms, "bedroom") },
                { icon: BedDouble, text: plural(l.beds, "bed") },
                { icon: Bath, text: plural(l.bathrooms, "bath") },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 rounded-xl border border-line px-3 py-3 text-sm">
                  <Icon className="size-5 text-muted" /> {text}
                </li>
              ))}
            </ul>
          </section>

          <section className="border-b border-line py-8">
            <h2 className="text-xl font-semibold">About this place</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-fg/90">{l.description}</p>
          </section>

          {l.amenities.length > 0 && (
            <section className="border-b border-line py-8">
              <h2 className="text-xl font-semibold">What this place offers</h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {l.amenities.map((a) => {
                  const m = AMENITY_META[a];
                  const Icon = m?.icon;
                  return (
                    <li key={a} className="flex items-center gap-3">
                      {Icon && <Icon className="size-5 text-muted" />} {m?.label ?? a}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section className="border-b border-line py-8">
            <h2 className="text-xl font-semibold">Where you&apos;ll be</h2>
            <p className="mt-1 text-sm text-muted">The exact address is shared after booking.</p>
            <div className="mt-4 h-72 overflow-hidden rounded-2xl border border-line">
              <LocationMap lat={l.lat} lng={l.lng} />
            </div>
          </section>

          <section className="border-b border-line py-8">
            <Reviews listingId={l.id} initial={reviews} ratingAvg={l.ratingAvg} ratingCount={l.ratingCount} />
          </section>

          {l.host && (
            <section className="border-b border-line py-8">
              <HostCard h={l.host} />
              {!isOwner && l.status === "PUBLISHED" && (
                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <MessageButton start={{ listingId: l.id }} label="Contact host" signedIn={!!session} />
                  <p className="text-sm text-muted">To protect your payment, never pay or message outside StayBook.</p>
                </div>
              )}
            </section>
          )}

          <section className="py-8">
            <h2 className="text-xl font-semibold">Things to know</h2>
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="font-semibold">House rules</h3>
                <p className="mt-1 text-sm text-muted">Check-in after 2:00 pm · Check-out before 11:00 am · {plural(l.maxGuests, "guest")} maximum</p>
              </div>
              <div>
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <ShieldCheck className="size-4" /> {policy.name} cancellation
                </h3>
                <p className="mt-1 text-sm text-muted">{policy.summary}</p>
              </div>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <BookingCard
            listing={{ id: l.id, title: l.title, basePricePaise: l.basePricePaise, maxGuests: l.maxGuests, ratingAvg: l.ratingAvg, ratingCount: l.ratingCount, policyName: policy.name, minNights: l.minNights, instantBook: l.instantBook !== false, hostName: l.host?.name }}
            initial={{ checkIn: sp.checkIn, checkOut: sp.checkOut, guests: Number(sp.guests) || 1 }}
            signedIn={!!session}
            email={session?.email}
            isOwner={isOwner}
            bookable={l.status === "PUBLISHED"}
          />
        </aside>
      </div>
    </div>
  );
}
