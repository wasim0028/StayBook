import { ArrowRight, BadgeIndianRupee, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { ListingCard } from "@/components/ListingCard";
import { SearchBar } from "@/components/SearchBar";
import { Alert, LinkButton } from "@/components/ui";
import { api, getSession } from "@/lib/api";
import { DESTINATIONS, destinationBbox } from "@/lib/destinations";
import { savedIds } from "@/lib/saved";
import type { SearchResponse } from "@/lib/types";

const AUTH_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  state: "Your sign-in link expired. Please try again.",
  exchange: "We couldn't complete sign-in. Please try again.",
  invalid: "We couldn't complete sign-in. Please try again.",
};

async function featured() {
  const goa = DESTINATIONS[0]!;
  try {
    const r = await api<SearchResponse>(`/v1/search?bbox=${destinationBbox(goa)}&limit=8`, { revalidate: 60 });
    return r.results;
  } catch {
    return [];
  }
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error } = await searchParams;
  const [session, stays] = await Promise.all([getSession(), featured()]);
  const saved = await savedIds(!!session);

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--brand-soft),transparent_65%)]" />
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-14 sm:px-6 md:pt-20">
          {auth_error && (
            <div className="mx-auto mb-6 max-w-xl">
              <Alert tone="warn">{AUTH_ERRORS[auth_error] ?? AUTH_ERRORS.invalid}</Alert>
            </div>
          )}
          <h1 className="mx-auto max-w-3xl text-center text-4xl font-extrabold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Stay somewhere <span className="text-brand">worth remembering</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted text-pretty">Villas by the sea, cabins in the hills and homestays in the heart of the city, booked in a minute.</p>
          <div className="mt-10">
            <SearchBar />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Explore India</h2>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {DESTINATIONS.map((d) => (
            <Link key={d.slug} href={`/search?dest=${d.slug}`} className="group relative aspect-[4/5] overflow-hidden rounded-2xl">
              <div className={`absolute inset-0 bg-gradient-to-br ${d.gradient} transition duration-500 group-hover:scale-105`} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <div className="text-lg font-bold">{d.name}</div>
                <div className="text-sm text-white/85">{d.tagline}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Stays in Goa</h2>
            <p className="text-muted">Guest favourites by the beach</p>
          </div>
          <Link href="/search?dest=goa" className="inline-flex items-center gap-1 text-sm font-semibold hover:underline">
            Show all <ArrowRight className="size-4" />
          </Link>
        </div>
        {stays.length > 0 ? (
          <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {stays.map((s) => (
              <ListingCard key={s.id} l={s} saved={saved.has(s.id)} signedIn={!!session} />
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">New stays are being added. Check back soon, or explore another destination.</p>
        )}
      </section>

      <section className="mx-auto mt-20 grid max-w-7xl gap-6 px-4 sm:px-6 md:grid-cols-3">
        {[
          { icon: ShieldCheck, title: "Pay securely", body: "UPI, cards and netbanking through Razorpay. Your dates are held while you pay." },
          { icon: BadgeIndianRupee, title: "Clear refunds", body: "Every listing shows its cancellation policy up front, and refunds go back automatically." },
          { icon: Sparkles, title: "Real reviews", body: "Only guests who stayed can leave a review, and hosts can reply." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-line bg-surface p-6">
            <div className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
              <Icon className="size-5" />
            </div>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto mt-20 max-w-7xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-fg px-8 py-12 text-bg md:px-14 md:py-16">
          <div className="absolute -right-24 -top-24 size-72 rounded-full bg-brand/40 blur-3xl" />
          <div className="relative max-w-xl">
            <h2 className="text-3xl font-bold tracking-tight">Earn from your space</h2>
            <p className="mt-3 opacity-80">Set up a payout account in minutes, publish your listing, and get paid straight to your bank account after every stay.</p>
            <LinkButton href={session?.isHost ? "/host" : "/host/onboarding"} className="mt-6">
              {session?.isHost ? "Go to host dashboard" : "Become a host"}
            </LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}
