import type { Booking, BookingStatus } from "./types";

type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "brand";

export const STATUS_UI: Record<BookingStatus, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Awaiting host", tone: "info" },
  DECLINED: { label: "Not accepted", tone: "neutral" },
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warn" },
  CONFIRMED: { label: "Confirmed", tone: "ok" },
  CHECKED_IN: { label: "Checked in", tone: "info" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "bad" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

/** One line on where the guest's money is, or null when there is nothing to say. */
export function refundLine(b: Pick<Booking, "status" | "refundPaise" | "refundStatus">, fmt: (p: number) => string): string | null {
  if (b.status !== "CANCELLED" || b.refundPaise == null) return null;
  if (b.refundPaise === 0) return "No refund under the cancellation policy.";
  const amt = fmt(b.refundPaise);
  switch (b.refundStatus) {
    case "PROCESSED":
      return `${amt} refunded to your original payment method.`;
    case "FAILED":
      return `Your ${amt} refund hit a problem. Our team has been alerted and will retry it.`;
    default:
      return `${amt} refund on its way. Banks usually take 5–7 working days.`;
  }
}

export type TripGroup = "upcoming" | "past" | "cancelled";

/** Upcoming = not yet checked out; past = checked out; cancelled = cancelled or expired. */
export function tripGroup(b: Pick<Booking, "status" | "checkOut">, today: string): TripGroup {
  if (b.status === "CANCELLED" || b.status === "EXPIRED" || b.status === "DECLINED") return "cancelled";
  return b.checkOut > today ? "upcoming" : "past";
}
