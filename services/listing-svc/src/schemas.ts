import { z } from "zod";
import { AMENITIES, isValidDate, MAX_PRICE_PAISE, PROPERTY_TYPES } from "@mp/shared";

const paise = z.number().int().min(100_00, "minimum nightly price is INR 100").max(MAX_PRICE_PAISE);
const date = z.string().refine(isValidDate, "expected YYYY-MM-DD");

const pct = z.number().int().min(0).max(90);
const nightsCount = z.number().int().min(1).max(365);

/** Airbnb-style pricing knobs; defaults mean "no fees, no discounts, any stay length up to 90 nights". */
const pricingFields = {
  cleaningFeePaise: z.number().int().min(0).max(5_000_000).default(0), // up to INR 50,000
  weeklyDiscountPct: pct.default(0),
  monthlyDiscountPct: pct.default(0),
  minNights: nightsCount.default(1),
  maxNights: nightsCount.default(90),
  guestsIncluded: z.number().int().min(1).max(50).optional(),
  extraGuestFeePaise: z.number().int().min(0).max(1_000_000).default(0),
  instantBook: z.boolean().default(true),
};

const createListingBase = z
  .object({
    title: z.string().trim().min(5).max(100),
    description: z.string().trim().min(20).max(5000),
    propertyType: z.enum(PROPERTY_TYPES as [string, ...string[]]),
    city: z.string().trim().min(2).max(80),
    country: z.string().trim().length(2).toUpperCase().default("IN"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    basePricePaise: paise,
    maxGuests: z.number().int().min(1).max(50),
    bedrooms: z.number().int().min(0).max(50),
    beds: z.number().int().min(1).max(100),
    bathrooms: z.number().min(0).max(50).multipleOf(0.5),
    amenities: z.array(z.enum(AMENITIES)).max(AMENITIES.length).default([]),
    cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT"]).default("MODERATE"),
    ...pricingFields,
  })
  .strict();

/** Cross-field rules, checked on the merged listing for updates too. */
export function pricingProblems(l: { minNights?: number; maxNights?: number; guestsIncluded?: number; maxGuests?: number; weeklyDiscountPct?: number; monthlyDiscountPct?: number }): string | null {
  if ((l.minNights ?? 1) > (l.maxNights ?? 90)) return "minimum nights can't be more than maximum nights";
  if (l.guestsIncluded !== undefined && l.maxGuests !== undefined && l.guestsIncluded > l.maxGuests) return "guests included can't be more than the guest limit";
  if ((l.monthlyDiscountPct ?? 0) > 0 && (l.monthlyDiscountPct ?? 0) < (l.weeklyDiscountPct ?? 0)) return "the monthly discount should be at least the weekly discount";
  return null;
}

export const createListingSchema = createListingBase.superRefine((v, ctx) => {
  const p = pricingProblems(v);
  if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p });
});

export const updateListingSchema = createListingBase
  .partial()
  .extend({ version: z.number().int().min(1) })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "no fields to update");

export const calendarQuerySchema = z.object({ from: date, to: date });

export const calendarUpdateSchema = z
  .object({
    from: date,
    to: date,
    /** BLOCKED = host unavailable; FREE = re-open. HELD/BOOKED are owned by booking-svc. */
    status: z.enum(["BLOCKED", "FREE"]).optional(),
    /** Per-night price override; null clears the override back to the base price. */
    pricePaise: paise.nullable().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.pricePaise !== undefined, "set status and/or pricePaise");

export const photoUploadSchema = z
  .object({
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })
  .strict();

export const attachPhotoSchema = z.object({ photoId: z.string().uuid() }).strict();

export const reorderPhotosSchema = z
  .object({ photos: z.array(z.string().uuid()).max(30), version: z.number().int().min(1) })
  .strict();

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2048).optional(),
});
