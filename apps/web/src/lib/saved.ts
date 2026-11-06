import "server-only";
import { api } from "./api";
import type { Page, WishlistItem } from "./types";

/** Ids of the signed-in user's saved listings (first 50), so cards can show filled hearts. Never throws. */
export async function savedIds(signedIn: boolean): Promise<Set<string>> {
  if (!signedIn) return new Set();
  try {
    const r = await api<Page<WishlistItem>>("/v1/wishlist?limit=50", { auth: true });
    return new Set(r.items.map((i) => i.id));
  } catch {
    return new Set();
  }
}
