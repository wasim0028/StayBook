import { BadgeCheck, Banknote, CalendarRange, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Alert, Badge, LinkButton } from "@/components/ui";
import { api, getSession } from "@/lib/api";
import { payoutUi } from "@/lib/host";
import type { Me } from "@/lib/types";
import { OnboardingForm } from "./OnboardingForm";
import { RefreshStatus } from "./RefreshStatus";

export const metadata: Metadata = { title: "Payouts" };

export default async function OnboardingPage() {
  const [me, session] = await Promise.all([api<Me>("/v1/me", { auth: true }), getSession()]);
  const h = me.host;

  if (h?.onboardingStep === "done") {
    const ui = payoutUi(h);
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-full bg-surface-2"><Banknote className="size-6" /></div>
              <div>
                <div className="font-semibold">{h.legalBusinessName}</div>
                <div className="text-sm text-muted">Bank account ending {h.bankLast4 ?? "••••"}</div>
              </div>
            </div>
            <Badge tone={ui.tone}>{ui.label}</Badge>
          </div>
          <p className="mt-4 text-[15px] text-muted">{ui.body}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {h.payoutStatus !== "activated" && <RefreshStatus />}
            <LinkButton href="/host/listings" variant="outline">Go to listings</LinkButton>
          </div>
        </div>
        <p className="mt-6 text-sm text-muted">Payments are collected by Razorpay. Your share of each booking is held until 24 hours after check-out, then settled to your bank on Razorpay&apos;s next settlement cycle.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">{me.isHost || session?.isHost ? "Finish your payout setup" : "Become a host"}</h1>
          <p className="mt-2 max-w-xl text-muted">Tell us where to send your earnings. We create a Razorpay payout account in your name; they verify your PAN and bank details.</p>
          {h && (
            <div className="mt-6"><Alert tone="warn">Setup stopped part-way last time. Submit the form again and we&apos;ll pick up where it left off.</Alert></div>
          )}
          <OnboardingForm defaultEmail={session?.email} defaultName={me.displayName ?? session?.name} />
        </div>
        <aside className="space-y-5 lg:pt-16">
          {[
            { icon: CalendarRange, title: "Start drafting now", body: "You can create and price listings while Razorpay verifies your account." },
            { icon: ShieldCheck, title: "Guests pay upfront", body: "Every booking is prepaid through Razorpay, so there's no cash to chase." },
            { icon: BadgeCheck, title: "Paid after check-out", body: "Your share is released 24 hours after the guest checks out. Platform fee: 12%." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4 rounded-2xl border border-line bg-surface p-5">
              <Icon className="size-6 shrink-0 text-brand" />
              <div>
                <div className="font-semibold">{title}</div>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
