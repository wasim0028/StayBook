"use client";

import clsx from "clsx";
import { Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { call, ClientApiError } from "@/lib/client-api";

/** Save/unsave. `signedIn` is decided by the server so signed-out visitors are sent to sign-in instead of getting an error. */
export function HeartButton({ listingId, saved: initial, signedIn, className }: { listingId: string; saved: boolean; signedIn: boolean; className?: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const next = !saved;
    setSaved(next); // optimistic
    start(async () => {
      try {
        await call(`/v1/wishlist/${listingId}`, { method: next ? "PUT" : "DELETE" });
        router.refresh();
      } catch (err) {
        if (!(err instanceof ClientApiError) || err.status !== 401) setSaved(!next);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      className={clsx("grid size-9 place-items-center rounded-full bg-black/25 text-white backdrop-blur transition hover:scale-110 hover:bg-black/40", className)}
    >
      <Heart className={clsx("size-5", saved ? "fill-brand text-brand" : "fill-black/20")} />
    </button>
  );
}
