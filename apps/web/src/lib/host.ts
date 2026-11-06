import type { Me } from "./types";

type Tone = "neutral" | "ok" | "warn" | "bad" | "info";

/** What the host should see about their payout (Razorpay Route linked account) status. */
export function payoutUi(h: NonNullable<Me["host"]>): { tone: Tone; label: string; body: string } {
  if (h.onboardingStep !== "done") {
    return { tone: "warn", label: "Setup incomplete", body: "Finish payout setup so you can publish listings and get paid." };
  }
  switch (h.payoutStatus) {
    case "activated":
      return { tone: "ok", label: "Payouts active", body: `Payouts go to your bank account ending ${h.bankLast4 ?? "••••"}, 24 hours after each check-out.` };
    case "needs_clarification":
      return { tone: "warn", label: "Action needed", body: "Razorpay needs more details to verify your account. Check the email they sent you." };
    case "suspended":
    case "rejected":
      return { tone: "bad", label: h.payoutStatus === "suspended" ? "Payouts suspended" : "Verification failed", body: "Contact support to sort out your payout account." };
    default:
      return { tone: "info", label: "Under review", body: "Razorpay is verifying your details, usually within 1–2 working days. You can draft listings meanwhile." };
  }
}
