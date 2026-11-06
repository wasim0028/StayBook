import type { BookingRecord } from "@mp/shared";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 123456789 paise -> "₹12,34,567.89" (Indian digit grouping). */
export function inr(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const frac = paise % 100;
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `₹${grouped}${frac ? `.${String(frac).padStart(2, "0")}` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const ref = (b: BookingRecord) => b.bookingId.slice(0, 8).toUpperCase();

function wrap(title: string, lines: [string, string][], footer: string): { text: string; html: string } {
  const text = [title, "", ...lines.map(([k, v]) => `${k}: ${v}`), "", footer].join("\n");
  const rows = lines
    .map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#6b7280">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" style="max-width:100%;background:#fff;border-radius:16px;padding:28px">
<tr><td><h1 style="margin:0 0 16px;font-size:22px">${esc(title)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px">${rows}</table>
<p style="margin:24px 0 0;color:#6b7280;font-size:13px">${esc(footer)}</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

const stay = (b: BookingRecord): [string, string][] => [
  ["Property", b.listingTitle],
  ["Check-in", `${prettyDate(b.checkIn)}, after 2:00 pm`],
  ["Check-out", `${prettyDate(b.checkOut)}, before 11:00 am`],
  ["Guests", String(b.guests)],
  ["Booking ref", ref(b)],
];

export function guestConfirmed(b: BookingRecord): Email {
  const subject = `Booking confirmed: ${b.listingTitle} (${prettyDate(b.checkIn)})`;
  return { subject, ...wrap("Your stay is confirmed", [...stay(b), ["Total paid", inr(b.totalPaise)]], "You can view or cancel this booking from the Trips tab in the app.") };
}

export function hostNewBooking(b: BookingRecord): Email {
  const subject = `New booking: ${b.listingTitle} (${prettyDate(b.checkIn)})`;
  return {
    subject,
    ...wrap(
      "You have a new booking",
      [...stay(b), ["Your payout", inr(b.hostPayoutPaise)]],
      "Payouts are released 24 hours after check-out.",
    ),
  };
}

export function guestCancelled(b: BookingRecord): Email {
  const refund = b.refundPaise ?? 0;
  const who = b.cancelledBy === "guest" ? "You cancelled this booking." : "This booking was cancelled by the host.";
  return {
    subject: `Booking cancelled: ${b.listingTitle}`,
    ...wrap(
      "Your booking was cancelled",
      [...stay(b), ["Refund", refund > 0 ? `${inr(refund)} (to your original payment method in 5-7 working days)` : "No refund due under the cancellation policy"]],
      who,
    ),
  };
}

export function hostCancelled(b: BookingRecord): Email {
  return {
    subject: `Booking cancelled: ${b.listingTitle} (${prettyDate(b.checkIn)})`,
    ...wrap("A booking was cancelled", stay(b), "The nights have been released back to your calendar."),
  };
}

// ---------- request to book ----------

export function hostNewRequest(b: BookingRecord): Email {
  return {
    subject: `Booking request: ${b.listingTitle} (${prettyDate(b.checkIn)})`,
    ...wrap(
      "A guest wants to stay. Please reply within 24 hours",
      [...stay(b), ["Your payout if accepted", inr(b.hostPayoutPaise)], ...(b.requestMessage ? ([["Their message", b.requestMessage]] as [string, string][]) : [])],
      "Accept or decline from Reservations in the app. Unanswered requests expire after 24 hours and count against your response rate.",
    ),
  };
}

export function guestRequestAccepted(b: BookingRecord): Email {
  return {
    subject: `Accepted! Complete your booking: ${b.listingTitle}`,
    ...wrap("Your host accepted. Pay within 12 hours to confirm", [...stay(b), ["Total", inr(b.totalPaise)]], "Open your trip in the app to pay. If you don't pay in time, the dates are released."),
  };
}

export function guestRequestDeclined(b: BookingRecord): Email {
  const expired = (b as BookingRecord & { expiredReason?: string }).expiredReason === "REQUEST_NOT_ANSWERED";
  return {
    subject: expired ? `Your request expired: ${b.listingTitle}` : `Your request wasn't accepted: ${b.listingTitle}`,
    ...wrap(expired ? "The host didn't respond in time" : "The host can't host you on these dates", stay(b), "You weren't charged. Similar places may still be free on your dates."),
  };
}
