import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, geoGsiKeys, listingKey, nightKey, todayUtc } from "@mp/shared";
import { startTestDb } from "@mp/test-utils";
import { buildApp } from "../src/app.js";

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: ReturnType<typeof buildApp>["app"];

// Goa viewport roughly covering Calangute to Panaji
const GOA = "15.45,73.74,15.56,73.85";
const checkIn = addDays(todayUtc(), 14);
const checkOut = addDays(checkIn, 3);

interface Seed {
  id: string;
  lat: number;
  lng: number;
  price: number;
  status?: string;
  maxGuests?: number;
  propertyType?: string;
  amenities?: string[];
  extra?: Record<string, unknown>;
}

async function seed(s: Seed) {
  const status = s.status ?? "PUBLISHED";
  await db.doc.send(
    new PutCommand({
      TableName: db.table,
      Item: {
        ...listingKey(s.id),
        ...(status === "PUBLISHED" ? geoGsiKeys(s.lat, s.lng, s.price, s.id) : {}),
        id: s.id,
        title: `Listing ${s.id}`,
        propertyType: s.propertyType ?? "apartment",
        city: "Goa",
        lat: s.lat,
        lng: s.lng,
        basePricePaise: s.price,
        maxGuests: s.maxGuests ?? 4,
        bedrooms: 2,
        amenities: s.amenities ?? ["wifi"],
        coverPhotoId: "cover-1",
        status,
        ...s.extra,
      },
    }),
  );
}

async function setNight(id: string, date: string, item: Record<string, unknown>) {
  await db.doc.send(new PutCommand({ TableName: db.table, Item: { ...nightKey(id, date), ...item } }));
}

beforeAll(async () => {
  db = await startTestDb();
  app = buildApp({ ddb: db, cdnBaseUrl: "https://cdn.test/", logger: false }).app;
  await app.ready();

  await seed({ id: "cheap-flat", lat: 15.5, lng: 73.8, price: 2_000_00 });
  await seed({ id: "mid-house", lat: 15.52, lng: 73.77, price: 5_000_00, propertyType: "house", amenities: ["wifi", "pool"] });
  await seed({ id: "pricey-villa", lat: 15.47, lng: 73.81, price: 15_000_00, propertyType: "villa", maxGuests: 10, amenities: ["wifi", "pool", "ac"] });
  await seed({ id: "booked-flat", lat: 15.51, lng: 73.79, price: 3_000_00 });
  await seed({ id: "expired-hold", lat: 15.49, lng: 73.78, price: 3_500_00 });
  await seed({ id: "override-flat", lat: 15.53, lng: 73.8, price: 4_000_00 });
  await seed({ id: "draft-flat", lat: 15.5, lng: 73.79, price: 1_000_00, status: "DRAFT" });
  await seed({ id: "mumbai-flat", lat: 19.07, lng: 72.87, price: 2_500_00 });
  await seed({ id: "family-home", lat: 15.25, lng: 73.95, price: 6_000_00, propertyType: "house", extra: { bedrooms: 4, beds: 5, bathrooms: 3, cleaningFeePaise: 1_500_00, minNights: 3 } });
  await seed({ id: "south-flat", lat: 15.26, lng: 73.94, price: 2_400_00 });
  await seed({ id: "week-only", lat: 15.27, lng: 73.93, price: 2_200_00, extra: { minNights: 7, weeklyDiscountPct: 20 } });

  await setNight("booked-flat", addDays(checkIn, 1), { status: "BOOKED" });
  await setNight("expired-hold", checkIn, { status: "HELD", holdExpiresAt: 1 });
  await setNight("override-flat", addDays(checkIn, 2), { status: "FREE", pricePaise: 10_000_00 });
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

const search = (qs: string) => app.inject({ url: `/v1/search?bbox=${GOA}&${qs}` });
const ids = (r: { json: () => { results: { id: string }[] } }) => r.json().results.map((x) => x.id);

describe("GET /v1/search", () => {
  it("returns published listings in the viewport, cheapest first", async () => {
    const r = await search("");
    expect(r.statusCode).toBe(200);
    expect(ids(r)).toEqual(["cheap-flat", "booked-flat", "expired-hold", "override-flat", "mid-house", "pricey-villa"]);
    expect(r.json().results[0].coverPhotoUrl).toBe("https://cdn.test/listings/cheap-flat/cover-1/w720.webp");
    expect(r.headers["cache-control"]).toContain("max-age=30");
  });

  it("excludes drafts and listings outside the box", async () => {
    const found = ids(await search(""));
    expect(found).not.toContain("draft-flat");
    expect(found).not.toContain("mumbai-flat");
  });

  it("filters by price range (rupees), guests, type and amenities", async () => {
    expect(ids(await search("priceMin=3000&priceMax=5000"))).toEqual(["booked-flat", "expired-hold", "override-flat", "mid-house"]);
    expect(ids(await search("guests=8"))).toEqual(["pricey-villa"]);
    expect(ids(await search("type=house,villa"))).toEqual(["mid-house", "pricey-villa"]);
    expect(ids(await search("amenities=pool,ac"))).toEqual(["pricey-villa"]);
  });

  it("with dates: drops unavailable listings, treats expired holds as free, and prices overrides", async () => {
    const r = await search(`checkIn=${checkIn}&checkOut=${checkOut}`);
    expect(r.statusCode).toBe(200);
    const found = ids(r);
    expect(found).not.toContain("booked-flat");
    expect(found).toContain("expired-hold");
    const override = r.json().results.find((x: { id: string }) => x.id === "override-flat");
    // 18,000 for 3 nights (6,000/night) + 5% GST: search shows what the guest will actually pay
    expect(override.totalPaise).toBe(18_000_00 + 900_00);
    expect(override.nights).toBe(3);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("respects limit and flags truncation", async () => {
    const r = await search("limit=2");
    expect(r.json().results).toHaveLength(2);
    expect(r.json().truncated).toBe(true);
  });

  it("validates input", async () => {
    expect((await app.inject({ url: "/v1/search" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/v1/search?bbox=1,2,3" })).statusCode).toBe(400);
    expect((await search(`checkIn=${checkIn}`)).statusCode).toBe(400);
    expect((await search("checkIn=2020-01-01&checkOut=2020-01-03")).statusCode).toBe(400);
    expect((await search("type=castle")).statusCode).toBe(400);
  });

  it("refuses country-sized viewports", async () => {
    const r = await app.inject({ url: "/v1/search?bbox=8,68,37,97" });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("AREA_TOO_LARGE");
  });
});

describe("Airbnb-style search", () => {
  // South Goa box, away from the listings the tests above enumerate.
  const search = (qs: string) => app.inject({ url: `/v1/search?bbox=15.20,73.88,15.32,74.00&${qs}` });
  it("filters by bedrooms, beds and bathrooms", async () => {
    expect(ids(await search("minBedrooms=3"))).toEqual(["family-home"]);
    expect(ids(await search("minBeds=5&minBathrooms=2.5"))).toEqual(["family-home"]);
  });

  it("totals include fees and GST, and skip places whose minimum stay is longer than the trip", async () => {
    const r = (await search(`checkIn=${checkIn}&checkOut=${checkOut}`)).json().results as { id: string; totalPaise: number; minNights?: number }[];
    const fam = r.find((x) => x.id === "family-home")!;
    // 3 x 6,000 + 1,500 cleaning = 19,500 (6,500/night -> 5%) + 975 GST
    expect(fam.totalPaise).toBe(20_475_00);
    expect(fam.minNights).toBe(3);
    expect(r.map((x) => x.id)).not.toContain("week-only");
  });

  it("finds the first free weekend in the chosen month", async () => {
    const month = addDays(todayUtc(), 40).slice(0, 7);
    const r = (await search(`flex=weekend&months=${month}`)).json().results as { id: string; checkIn: string; checkOut: string; nights: number }[];
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) {
      expect(new Date(`${x.checkIn}T00:00:00Z`).getUTCDay()).toBe(5); // Friday
      expect(x.nights).toBe(2);
      expect(x.checkIn.slice(0, 7)).toBe(month);
    }
    const ids2 = r.map((x) => x.id);
    expect(ids2).toContain("south-flat");
    expect(ids2).not.toContain("family-home"); // 3-night minimum
    expect(ids2).not.toContain("week-only");
  });

  it("finds week-long windows, applying the weekly discount", async () => {
    const month = addDays(todayUtc(), 40).slice(0, 7);
    const r = (await search(`flex=week&months=${month}`)).json().results as { id: string; totalPaise: number }[];
    const w = r.find((x) => x.id === "week-only")!;
    // 7 x 2,200 = 15,400 - 20% = 12,320 + 5% GST = 12,936
    expect(w.totalPaise).toBe(12_936_00);
  });

  it("validates flexible search input", async () => {
    expect((await search("flex=week")).statusCode).toBe(400);
    expect((await search(`flex=week&months=2020-01`)).statusCode).toBe(400);
    expect((await search(`flex=fortnight&months=${addDays(todayUtc(), 40).slice(0, 7)}`)).statusCode).toBe(400);
  });
});

describe("place search", () => {
  const places = async (q: string) => (await app.inject({ url: `/v1/places?q=${encodeURIComponent(q)}` })).json().items as { name: string; state: string; bbox: string }[];

  it("finds destinations by name, alias and without accents", async () => {
    expect((await places("goa"))[0]).toMatchObject({ name: "Goa", state: "Goa" });
    expect((await places("pondicherry"))[0]!.name).toBe("Pondicherry");
    expect((await places("rishik"))[0]).toMatchObject({ name: "Rishikesh", state: "Uttarakhand" });
    expect((await places("anjuna"))[0]).toMatchObject({ name: "Anjuna", state: "Goa" });
  });

  it("prefers the well-known place when names clash", async () => {
    expect((await places("manali"))[0]).toMatchObject({ state: "Himachal Pradesh" });
    expect((await places("udaipur"))[0]).toMatchObject({ state: "Rajasthan" });
  });

  it("returns a search area that search accepts", async () => {
    const [goa] = await places("calangute");
    const r = await app.inject({ url: `/v1/search?bbox=${goa!.bbox}` });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/places?q=a" })).statusCode).toBe(400);
  });
});


describe("booking options in search", () => {
  it("filters to Instant Book and flags Superhosts", async () => {
    await seed({ id: "request-only", lat: 15.29, lng: 73.91, price: 2_600_00, extra: { instantBook: false, hostSuperhost: true } });
    const all = (await app.inject({ url: "/v1/search?bbox=15.20,73.88,15.32,74.00" })).json().results as { id: string; instantBook: boolean; superhost?: boolean }[];
    expect(all.find((x) => x.id === "request-only")).toMatchObject({ instantBook: false, superhost: true });
    expect(all.find((x) => x.id === "south-flat")).toMatchObject({ instantBook: true });
    const instant = (await app.inject({ url: "/v1/search?bbox=15.20,73.88,15.32,74.00&instantBook=true" })).json().results as { id: string }[];
    expect(instant.map((x) => x.id)).not.toContain("request-only");
    expect(instant.map((x) => x.id)).toContain("south-flat");
  });
});
