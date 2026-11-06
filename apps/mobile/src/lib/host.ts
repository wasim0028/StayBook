import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";
import type { Me } from "@/api/types";
import type { Tone } from "@/components/theme";
import { config } from "@/config";

export function payoutUi(h: NonNullable<Me["host"]>): { tone: Tone; label: string; body: string } {
  if (h.onboardingStep !== "done") return { tone: "warn", label: "Setup incomplete", body: "Finish payout setup so you can publish listings and get paid." };
  switch (h.payoutStatus) {
    case "activated":
      return { tone: "ok", label: "Payouts active", body: `Paid to your account ending ${h.bankLast4 ?? "••••"}, 24 hours after each check-out.` };
    case "needs_clarification":
      return { tone: "warn", label: "Action needed", body: "Razorpay needs more details to verify your account. Check their email." };
    case "suspended":
    case "rejected":
      return { tone: "bad", label: h.payoutStatus === "suspended" ? "Payouts suspended" : "Verification failed", body: "Contact support to sort out your payout account." };
    default:
      return { tone: "info", label: "Under review", body: "Razorpay is verifying your details, usually within 1–2 working days." };
  }
}

/** Listing creation and editing (photos, map pin, calendar) happen in the web app. */
export async function openWebEditor(path: string) {
  if (!config.webUrl) {
    Alert.alert("Editing isn't set up", "Set EXPO_PUBLIC_WEB_URL to your web app's address to edit listings from the app.");
    return;
  }
  await WebBrowser.openBrowserAsync(`${config.webUrl}${path}`, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
}
