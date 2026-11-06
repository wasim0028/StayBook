import { formatINR, plural } from "@/lib/format";
import type { PriceBreakdown as P } from "@/lib/types";

/** The itemised price, as on Airbnb: every line the guest pays, adding up to the total. */
export function PriceBreakdown({ p, totalLabel = "Total" }: { p: P; totalLabel?: string }) {
  const avg = Math.round(p.nightlySubtotalPaise / p.nights);
  const row = "flex justify-between gap-4";
  return (
    <dl className="space-y-2 text-[15px]">
      <div className={row}><dt className="text-muted">{formatINR(avg)} × {plural(p.nights, "night")}</dt><dd className="tabular-nums">{formatINR(p.nightlySubtotalPaise)}</dd></div>
      {p.extraGuestPaise > 0 && <div className={row}><dt className="text-muted">Extra guests ({p.extraGuests})</dt><dd className="tabular-nums">{formatINR(p.extraGuestPaise)}</dd></div>}
      {p.discountPaise > 0 && <div className={`${row} text-ok`}><dt>{p.discountKind === "monthly" ? "Monthly" : "Weekly"} stay discount ({p.discountPct}%)</dt><dd className="tabular-nums">−{formatINR(p.discountPaise)}</dd></div>}
      {p.cleaningFeePaise > 0 && <div className={row}><dt className="text-muted">Cleaning fee</dt><dd className="tabular-nums">{formatINR(p.cleaningFeePaise)}</dd></div>}
      <div className={row}><dt className="text-muted">GST ({p.gstRatePct}%)</dt><dd className="tabular-nums">{formatINR(p.gstPaise)}</dd></div>
      <div className={`${row} border-t border-line pt-3 font-semibold`}><dt>{totalLabel}</dt><dd className="tabular-nums">{formatINR(p.totalPaise)}</dd></div>
    </dl>
  );
}
