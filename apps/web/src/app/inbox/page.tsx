import type { Metadata } from "next";
import { getSession } from "@/lib/api";
import { Inbox } from "@/components/inbox/Inbox";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const [{ t }, session] = await Promise.all([searchParams, getSession()]);
  return <Inbox initialThread={t ?? null} isHost={!!session?.isHost} />;
}
