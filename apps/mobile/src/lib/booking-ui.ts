import type { Booking, BookingStatus } from "@/api/types";
import type { Tone } from "@/components/theme";

export const STATUS_UI: Record<BookingStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Awaiting host", tone: "info" },
  DECLINED: { label: "Declined", tone: "neutral" },
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warn" },
  CONFIRMED: { label: "Confirmed", tone: "ok" },
  CHECKED_IN: { label: "Checked in", tone: "info" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "bad" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export const POLICY_COPY: Record<string, { name: string; summary: string }> = {
  FLEXIBLE: { name: "Flexible", summary: "Full refund until 24 hours before check-in. After that, everything except the first night is refunded." },
  MODERATE: { name: "Moderate", summary: "Full refund until 5 days before check-in. After that, 50% is refunded." },
  STRICT: { name: "Strict", summary: "50% refund until 7 days before check-in. After that, no refund." },
};

export function refundLine(b: Booking, fmt: (p: number) => string): string | null {
  if (b.status !== "CANCELLED" || b.refundPaise == null) return null;
  if (b.refundPaise === 0) return "No refund under the cancellation policy.";
  const amt = fmt(b.refundPaise);
  if (b.refundStatus === "PROCESSED") return `${amt} refunded to your original payment method.`;
  if (b.refundStatus === "FAILED") return `Your ${amt} refund hit a problem. Our team has been alerted and will retry it.`;
  return `${amt} refund on its way. Banks usually take 5–7 working days.`;
}

export type TripGroup = "upcoming" | "past" | "cancelled";
export function tripGroup(b: Pick<Booking, "status" | "checkOut">, today: string): TripGroup {
  if (b.status === "CANCELLED" || b.status === "EXPIRED" || b.status === "DECLINED") return "cancelled";
  return b.checkOut > today ? "upcoming" : "past";
}

/** Check-out is 11:00 IST; reviews open then and close 30 days later (mirrors review-svc). */
export function reviewWindowOpen(b: Booking, nowSec = Date.now() / 1000): boolean {
  if (!["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(b.status)) return false;
  const out = Date.parse(`${b.checkOut}T11:00:00+05:30`) / 1000;
  return nowSec >= out && nowSec <= out + 30 * 86_400;
}
