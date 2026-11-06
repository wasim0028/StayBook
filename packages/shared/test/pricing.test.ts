import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING, firstNightCharge, gstRateFor, pricingOf, quote, splitStay, checkStayLength, StayRuleError } from "../src/index.js";

const r = (o: Partial<typeof DEFAULT_PRICING> = {}) => ({ ...DEFAULT_PRICING, guestsIncluded: 2, ...o });

describe("quote", () => {
  it("adds nightly prices, cleaning and 5% GST for stays up to ₹7,500 a night", () => {
    const q = quote(r({ cleaningFeePaise: 800_00 }), [3000_00, 3000_00, 4000_00], 2);
    expect(q).toMatchObject({ nights: 3, nightlySubtotalPaise: 10_000_00, cleaningFeePaise: 800_00, valuePaise: 10_800_00, gstRatePct: 5, gstPaise: 540_00, totalPaise: 11_340_00, discountPaise: 0 });
  });

  it("uses 18% once the value per night passes ₹7,500, including fees", () => {
    expect(quote(r(), [7500_00], 1).gstRatePct).toBe(5);
    expect(quote(r({ cleaningFeePaise: 1_00 }), [7500_00], 1).gstRatePct).toBe(18);
    expect(gstRateFor(7500_00)).toBe(5);
    expect(gstRateFor(7500_01)).toBe(18);
  });

  it("charges extra guests per night above those included", () => {
    const q = quote(r({ guestsIncluded: 2, extraGuestFeePaise: 500_00 }), [2000_00, 2000_00], 4);
    expect(q).toMatchObject({ extraGuests: 2, extraGuestPaise: 2000_00, valuePaise: 6000_00 });
  });

  it("applies the weekly discount from 7 nights and the monthly one from 28, to nightly prices only", () => {
    const rules = r({ weeklyDiscountPct: 10, monthlyDiscountPct: 25, cleaningFeePaise: 1000_00 });
    expect(quote(rules, Array(6).fill(1000_00), 2).discountPaise).toBe(0);
    const w = quote(rules, Array(7).fill(1000_00), 2);
    expect(w).toMatchObject({ discountKind: "weekly", discountPct: 10, discountPaise: 700_00, valuePaise: 7300_00 });
    const m = quote(rules, Array(28).fill(1000_00), 2);
    expect(m).toMatchObject({ discountKind: "monthly", discountPct: 25, discountPaise: 7000_00 });
    // no monthly rate set: the weekly one still applies to long stays
    expect(quote(r({ weeklyDiscountPct: 10 }), Array(30).fill(1000_00), 2).discountKind).toBe("weekly");
  });

  it("enforces minimum and maximum nights", () => {
    expect(() => checkStayLength({ minNights: 2, maxNights: 30 }, 1)).toThrow(StayRuleError);
    expect(() => checkStayLength({ minNights: 2, maxNights: 30 }, 31)).toThrow(/up to 30/);
    expect(() => checkStayLength({ minNights: 2, maxNights: 30 }, 2)).not.toThrow();
  });

  it("defaults old listings to no fees and all guests included", () => {
    expect(pricingOf({ maxGuests: 4 })).toEqual({ ...DEFAULT_PRICING, guestsIncluded: 4 });
  });
});

describe("splitStay", () => {
  const q = quote(r({ cleaningFeePaise: 1000_00 }), [4000_00, 4000_00], 2); // value 9000, gst 450
  it("takes the platform fee from the accommodation value, never from tax", () => {
    expect(splitStay(q, 12, false)).toEqual({ platformFeePaise: 1080_00, hostPayoutPaise: 7920_00, platformGstPaise: 450_00 });
  });
  it("passes GST through to GST-registered hosts", () => {
    expect(splitStay(q, 12, true)).toEqual({ platformFeePaise: 1080_00, hostPayoutPaise: 8370_00, platformGstPaise: 0 });
  });
  it("always adds up to what the guest paid", () => {
    for (const reg of [true, false]) {
      const s = splitStay(q, 12, reg);
      expect(s.platformFeePaise + s.hostPayoutPaise + s.platformGstPaise).toBe(q.totalPaise);
    }
  });
});

describe("late flexible cancellation", () => {
  it("keeps the first night after discount, with its tax, and refunds the cleaning fee", () => {
    const nightPrices = Array(7).fill(2000_00);
    const price = quote(r({ weeklyDiscountPct: 10, cleaningFeePaise: 500_00 }), nightPrices, 2);
    // first night 2000 - 10% = 1800, + 5% GST = 1890
    expect(firstNightCharge({ nightPrices, price, totalPaise: price.totalPaise })).toBe(1890_00);
  });
  it("falls back to the first night's price for old bookings", () => {
    expect(firstNightCharge({ nightPrices: [3000_00, 3000_00], totalPaise: 6000_00 })).toBe(3000_00);
  });
});
