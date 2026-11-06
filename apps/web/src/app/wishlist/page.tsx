import { Heart } from "lucide-react";
import type { Metadata } from "next";
import { ListingCard } from "@/components/ListingCard";
import { EmptyState, LinkButton } from "@/components/ui";
import { api } from "@/lib/api";
import type { Page, WishlistItem } from "@/lib/types";

export const metadata: Metadata = { title: "Wishlist" };

export default async function WishlistPage() {
  const page = await api<Page<WishlistItem>>("/v1/wishlist?limit=50", { auth: true });
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
      {page.items.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon={<Heart className="size-6" />} title="Nothing saved yet" body="Tap the heart on any stay to keep it here for later." action={<LinkButton href="/">Explore stays</LinkButton>} />
        </div>
      ) : (
        <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {page.items.map((l) => (
            <ListingCard key={l.id} l={l} saved signedIn />
          ))}
        </div>
      )}
    </div>
  );
}
