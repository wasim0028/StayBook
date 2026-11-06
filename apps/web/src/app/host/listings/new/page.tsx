import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { requireHost } from "@/lib/host-guard";
import { NewListing } from "./NewListing";

export const metadata: Metadata = { title: "New listing" };

export default async function NewListingPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await requireHost();
  const { welcome } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {welcome && <div className="mb-6"><Alert tone="ok">Payout account created. Razorpay will verify it shortly. Meanwhile, set up your first listing.</Alert></div>}
      <h1 className="text-3xl font-bold tracking-tight">Create a listing</h1>
      <p className="mt-2 text-muted">Start with the details. You&apos;ll add photos and set your calendar next.</p>
      <div className="mt-8"><NewListing /></div>
    </div>
  );
}
