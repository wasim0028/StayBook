"use client";

import { useRouter } from "next/navigation";
import { ListingForm } from "@/components/host/ListingForm";

export function NewListing() {
  const router = useRouter();
  return <ListingForm onSaved={(l) => router.push(`/host/listings/${l.id}?tab=photos`)} />;
}
