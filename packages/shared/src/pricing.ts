/**
 * Stay pricing, the same way Airbnb builds a total:
 *   nightly prices (base or per-date overrides)
 * + extra-guest fee (per night, for each guest above `guestsIncluded`)
 * − length-of-stay discount (weekly from 7 nights, monthly from 28; applied to the nightly subtotal)
 * + cleaning fee (once per stay)
 * = accommodation value (taxable)
 * + GST at the slab for the value per night
 * = what the guest pays.
 *
 * All amounts are integer paise. Used by booking-svc (the charge), search-svc (stay totals) and the
 * apps (the breakdown the guest sees), so everyone shows the same number.
 */

export interface PricingRules {
  cleaningFeePaise: number;
  /** % off the nightly subtotal for stays of 7+ nights. */
  weeklyDiscountPct: number;
  /** % off for stays of 28+ nights (replaces the weekly discount). */
  monthlyDiscountPct: number;
  minNights: number;
  maxNights: number;
  /** Guests covered by the nightly price. */
  guestsIncluded: number;
  /** Per extra guest, per night. */
  extraGuestFeePaise: number;
}

export const DEFAULT_PRICING: PricingRules = {
  cleaningFeePaise: 0,
  weeklyDiscountPct: 0,
  monthlyDiscountPct: 0,
  minNights: 1,
  maxNights: 90,
  guestsIncluded: 1,
  extraGuestFeePaise: 0,
};

/** Fills gaps for listings created before these fields existed. */
export function pricingOf(l: Partial<PricingRules> & { maxGuests?: number }): PricingRules {
  return {
    cleaningFeePaise: l.cleaningFeePaise ?? 0,
    weeklyDiscountPct: l.weeklyDiscountPct ?? 0,
    monthlyDiscountPct: l.monthlyDiscountPct ?? 0,
    minNights: l.minNights ?? 1,
    maxNights: l.maxNights ?? DEFAULT_PRICING.maxNights,
    guestsIncluded: l.guestsIncluded ?? l.maxGuests ?? 1,
    extraGuestFeePaise: l.extraGuestFeePaise ?? 0,
  };
}

/**
 * GST on accommodation by value per unit per day (rates in force since 22 Sep 2025).
 * Confirm with your CA before go-live; change only this table.
 */
export const GST_SLABS: { upToPaisePerNight: number; ratePct: number }[] = [
  { upToPaisePerNight: 7_500_00, ratePct: 5 },
  { upToPaisePerNight: Number.POSITIVE_INFINITY, ratePct: 18 },
];

export function gstRateFor(valuePerNightPaise: number): number {
  return GST_SLABS.find((s) => valuePerNightPaise <= s.upToPaisePerNight)!.ratePct;
}

export const WEEKLY_NIGHTS = 7;
export const MONTHLY_NIGHTS = 28;

export interface Quote {
  nights: number;
  nightlySubtotalPaise: number;
  extraGuests: number;
  extraGuestPaise: number;
  discountKind: "weekly" | "monthly" | null;
  discountPct: number;
  discountPaise: number;
  cleaningFeePaise: number;
  /** Accommodation value before tax. */
  valuePaise: number;
  gstRatePct: number;
  gstPaise: number;
  totalPaise: number;
}

export class StayRuleError extends Error {
  constructor(
    public readonly code: "MIN_NIGHTS" | "MAX_NIGHTS",
    message: string,
  ) {
    super(message);
  }
}

export function checkStayLength(rules: Pick<PricingRules, "minNights" | "maxNights">, nights: number): void {
  if (nights < rules.minNights) throw new StayRuleError("MIN_NIGHTS", `this place has a ${rules.minNights}-night minimum`);
  if (nights > rules.maxNights) throw new StayRuleError("MAX_NIGHTS", `this place allows stays of up to ${rules.maxNights} nights`);
}

export function quote(rules: PricingRules, nightPrices: number[], guests: number): Quote {
  const nights = nightPrices.length;
  if (nights < 1) throw new RangeError("a stay needs at least one night");
  const nightlySubtotalPaise = nightPrices.reduce((a, b) => a + b, 0);
  const extraGuests = Math.max(0, guests - rules.guestsIncluded);
  const extraGuestPaise = extraGuests * rules.extraGuestFeePaise * nights;
  const [discountKind, discountPct] =
    nights >= MONTHLY_NIGHTS && rules.monthlyDiscountPct > 0
      ? (["monthly", rules.monthlyDiscountPct] as const)
      : nights >= WEEKLY_NIGHTS && rules.weeklyDiscountPct > 0
        ? (["weekly", rules.weeklyDiscountPct] as const)
        : ([null, 0] as const);
  const discountPaise = Math.round((nightlySubtotalPaise * discountPct) / 100);
  const valuePaise = nightlySubtotalPaise + extraGuestPaise - discountPaise + rules.cleaningFeePaise;
  const gstRatePct = gstRateFor(valuePaise / nights);
  const gstPaise = Math.round((valuePaise * gstRatePct) / 100);
  return {
    nights,
    nightlySubtotalPaise,
    extraGuests,
    extraGuestPaise,
    discountKind,
    discountPct,
    discountPaise,
    cleaningFeePaise: rules.cleaningFeePaise,
    valuePaise,
    gstRatePct,
    gstPaise,
    totalPaise: valuePaise + gstPaise,
  };
}

/**
 * Who gets what. The platform fee is a % of the accommodation value (never of tax). GST goes to a
 * GST-registered host (they remit it); for other hosts the platform keeps it and remits it as the
 * e-commerce operator under section 9(5) of the CGST Act.
 */
export function splitStay(q: Pick<Quote, "valuePaise" | "gstPaise" | "totalPaise">, platformFeePct: number, hostGstRegistered: boolean) {
  if (platformFeePct < 0 || platformFeePct >= 100) throw new RangeError("fee pct out of range");
  const platformFeePaise = Math.round((q.valuePaise * platformFeePct) / 100);
  const hostPayoutPaise = q.valuePaise - platformFeePaise + (hostGstRegistered ? q.gstPaise : 0);
  return { platformFeePaise, hostPayoutPaise, platformGstPaise: hostGstRegistered ? 0 : q.gstPaise };
}
