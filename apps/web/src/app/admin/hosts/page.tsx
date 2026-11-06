import type { Metadata } from "next";
import Link from "next/link";
import { Pager, Table, Td } from "@/components/admin/Table";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/admin";
import { age, dateTime } from "@/lib/admin-format";
import type { HostEntry } from "@/lib/admin-types";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export const metadata: Metadata = { title: "Hosts" };

const REASON: Record<string, { label: string; tone: "warn" | "bad" | "info"; next: string }> = {
  onboarding_incomplete: { label: "Setup incomplete", tone: "info", next: "Stopped part-way. Nudge the host to finish payout setup; it resumes where it stopped." },
  needs_clarification: { label: "Needs clarification", tone: "warn", next: "Razorpay asked for more documents. Help the host reply to Razorpay's email." },
  rejected: { label: "Rejected", tone: "bad", next: "Razorpay rejected verification. Check the reason in the Razorpay dashboard." },
  suspended: { label: "Suspended", tone: "bad", next: "Payouts suspended by Razorpay. Bookings can't be taken; contact Razorpay support." },
};
const STEP: Record<string, string> = { account: "Account created", stakeholder: "Owner details", product: "Route requested", settlement: "Bank details", done: "Submitted" };

export default async function Hosts({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  await requireAdmin();
  const { cursor } = await searchParams;
  const page = await api<Page<HostEntry>>(`/v1/admin/queues/hosts?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { auth: true });
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Hosts stuck in payout setup</h1>
      <p className="mt-1 max-w-2xl text-muted">These hosts can&apos;t publish or be paid until Razorpay activates their account. Hosts under normal review aren&apos;t listed.</p>
      <div className="mt-6">
        <Table head={["Host", "Issue", "Last step", "Since", "What to do"]} empty={page.items.length === 0 && { title: "No hosts need help", body: "Hosts stuck in payout setup appear here automatically." }}>
          {page.items.map((h) => {
            const r = REASON[h.reason] ?? { label: h.reason, tone: "info" as const, next: "" };
            return (
              <tr key={h.userId}>
                <Td>
                  <Link href={`/admin/users/${h.userId}`} className="font-semibold hover:underline">{h.displayName ?? h.legalBusinessName ?? "Host"}</Link>
                  {h.legalBusinessName && h.legalBusinessName !== h.displayName && <div className="text-muted">{h.legalBusinessName}</div>}
                </Td>
                <Td><Badge tone={r.tone}>{r.label}</Badge></Td>
                <Td className="text-muted">{STEP[h.onboardingStep ?? ""] ?? "—"}</Td>
                <Td><span title={dateTime(h.since)}>{age(h.since)}</span></Td>
                <Td className="max-w-80 text-muted">{r.next}</Td>
              </tr>
            );
          })}
        </Table>
        <Pager next={page.nextCursor} base="/admin/hosts" />
      </div>
    </div>
  );
}
