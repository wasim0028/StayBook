import {
  AMENITIES,
  createServer,
  ddbReady,
  HttpError,
  isValidDate,
  MAX_STAY_NIGHTS,
  nightsBetween,
  parse,
  parseBBox,
  PROPERTY_TYPES,
  todayUtc,
  TooManyCellsError,
  type DdbContext,
} from "@mp/shared";
import { z } from "zod";
import { findPlaces } from "./places.js";
import { SearchService } from "./search.js";

export interface AppDeps {
  ddb: DdbContext;
  cdnBaseUrl: string;
  logger?: boolean;
}

const csv = <T extends [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).max(values.length).optional());

const date = z.string().refine(isValidDate, "expected YYYY-MM-DD");

/** Rupee inputs on the wire (what users type); paise internally. */
const rupees = z.coerce.number().int().min(0).max(10_000_000);

export const searchQuerySchema = z
  .object({
    bbox: z.string().min(7).max(100),
    checkIn: date.optional(),
    checkOut: date.optional(),
    guests: z.coerce.number().int().min(1).max(50).optional(),
    priceMin: rupees.optional(),
    priceMax: rupees.optional(),
    type: csv(PROPERTY_TYPES as [string, ...string[]]),
    amenities: csv([...AMENITIES] as [string, ...string[]]),
    minBedrooms: z.coerce.number().int().min(0).max(20).optional(),
    minBeds: z.coerce.number().int().min(0).max(20).optional(),
    minBathrooms: z.coerce.number().min(0).max(20).optional(),
    instantBook: z.enum(["true", "false"]).optional(),
    flex: z.enum(["weekend", "week", "month"]).optional(),
    /** Up to 3 months (YYYY-MM) for flexible search. */
    months: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(1).max(3).optional()),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .superRefine((q, ctx) => {
    if (!!q.checkIn !== !!q.checkOut) {
      ctx.addIssue({ code: "custom", message: "checkIn and checkOut go together" });
      return;
    }
    if (q.checkIn && q.checkOut) {
      const n = nightsBetween(q.checkIn, q.checkOut);
      if (n < 1 || n > MAX_STAY_NIGHTS) ctx.addIssue({ code: "custom", message: `stay must be 1-${MAX_STAY_NIGHTS} nights` });
      if (q.checkIn < todayUtc()) ctx.addIssue({ code: "custom", message: "checkIn is in the past" });
    }
    if (q.flex && (q.checkIn || !q.months)) ctx.addIssue({ code: "custom", message: "flexible search takes months instead of dates" });
    if (q.months && !q.flex) ctx.addIssue({ code: "custom", message: "months need flex=weekend|week|month" });
    if (q.months?.some((m) => m < todayUtc().slice(0, 7))) ctx.addIssue({ code: "custom", message: "months must not be in the past" });
    if (q.priceMin != null && q.priceMax != null && q.priceMin > q.priceMax) {
      ctx.addIssue({ code: "custom", message: "priceMin > priceMax" });
    }
  });

export function buildApp(deps: AppDeps) {
  const { app, markDraining } = createServer({
    name: "search-svc",
    ready: () => ddbReady(deps.ddb),
    logger: deps.logger === false ? false : undefined,
  });
  const cdn = deps.cdnBaseUrl.replace(/\/$/, "");
  const svc = new SearchService(deps.ddb, (id, photo) => `${cdn}/listings/${id}/${photo}/w720.webp`);

  app.get("/v1/search", async (req, reply) => {
    const q = parse(searchQuerySchema, req.query);
    let bbox;
    try {
      bbox = parseBBox(q.bbox);
    } catch (e) {
      throw new HttpError(400, "INVALID_BBOX", (e as Error).message);
    }

    try {
      const res = await svc.search({
        bbox,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        guests: q.guests,
        priceMinPaise: q.priceMin != null ? q.priceMin * 100 : undefined,
        priceMaxPaise: q.priceMax != null ? q.priceMax * 100 : undefined,
        propertyTypes: q.type,
        amenities: q.amenities,
        minBedrooms: q.minBedrooms,
        minBeds: q.minBeds,
        minBathrooms: q.minBathrooms,
        instantBook: q.instantBook === "true",
        flex: q.flex && q.months ? { kind: q.flex, months: q.months } : undefined,
        limit: q.limit,
      });
      // Dated searches depend on live availability; undated ones can be cached briefly at the CDN.
      reply.header("cache-control", q.checkIn || q.flex ? "no-store" : "public, max-age=30");
      return { ...res, currency: "INR" };
    } catch (e) {
      if (e instanceof TooManyCellsError) throw new HttpError(422, "AREA_TOO_LARGE", e.message);
      throw e;
    }
  });

  /** Place-name lookup for the search box: returns a ready-to-use search area per place. */
  app.get("/v1/places", async (req, reply) => {
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(60) }), req.query);
    reply.header("cache-control", "public, max-age=86400");
    return { items: findPlaces(q), attribution: "Place data © GeoNames (CC BY 4.0)" };
  });

  return { app, markDraining };
}
