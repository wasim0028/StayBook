import { QueryCommand, type NativeAttributeValue } from "@aws-sdk/lib-dynamodb";
import {
  bboxContains,
  coverCells,
  eachNight,
  geoPriceRange,
  GSI,
  addDays,
  checkStayLength,
  isNightAvailable,
  MAX_STAY_NIGHTS,
  nightSk,
  pricingOf,
  quote,
  type BBox,
  type DdbContext,
  type SearchResult,
} from "@mp/shared";

export interface SearchParams {
  bbox: BBox;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  priceMinPaise?: number;
  priceMaxPaise?: number;
  propertyTypes?: string[];
  amenities?: string[];
  minBedrooms?: number;
  minBeds?: number;
  minBathrooms?: number;
  instantBook?: boolean;
  /** "Flexible": any window of this length inside these months (YYYY-MM), instead of exact dates. */
  flex?: { kind: FlexKind; months: string[] };
  limit: number;
}

export type FlexKind = "weekend" | "week" | "month";
const FLEX_NIGHTS: Record<FlexKind, number> = { weekend: 2, week: 7, month: 28 };

export interface SearchResponse {
  results: SearchResult[];
  /** True when more matches exist than were returned; the client should ask the user to zoom in. */
  truncated: boolean;
  cellsQueried: number;
}

/** Hard ceilings that keep one search request's DynamoDB cost bounded. */
export const LIMITS = {
  cellConcurrency: 8,
  /** Max index items read per cell (price-ascending, so these are the cheapest). */
  perCellItems: 200,
  /** Max listings sent through the date-availability check. */
  availabilityCandidates: 150,
  availabilityConcurrency: 16,
};

type Card = Record<string, NativeAttributeValue>;

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export class SearchService {
  constructor(
    private readonly ctx: DdbContext,
    private readonly photoUrl: (listingId: string, photoId: string) => string,
  ) {}

  /** One cell, price-ascending, filtered server-side on the cheap attributes. */
  private async queryCell(cell: string, p: SearchParams): Promise<{ items: Card[]; more: boolean }> {
    const { lo, hi } = geoPriceRange(p.priceMinPaise, p.priceMaxPaise);
    const filters: string[] = ["#st = :published"];
    const names: Record<string, string> = { "#st": "status" };
    const values: Record<string, NativeAttributeValue> = { ":pk": `GEO#${cell}`, ":lo": lo, ":hi": hi, ":published": "PUBLISHED" };

    if (p.guests) {
      filters.push("maxGuests >= :guests");
      values[":guests"] = p.guests;
    }
    if (p.propertyTypes?.length) {
      const keys = p.propertyTypes.map((t, i) => {
        values[`:pt${i}`] = t;
        return `:pt${i}`;
      });
      filters.push(`propertyType IN (${keys.join(", ")})`);
    }
    for (const [field, v] of [["bedrooms", p.minBedrooms], ["beds", p.minBeds], ["bathrooms", p.minBathrooms]] as const) {
      if (v == null) continue;
      filters.push(`${field} >= :min_${field}`);
      values[`:min_${field}`] = v;
    }
    if (p.instantBook) filters.push("(attribute_not_exists(instantBook) OR instantBook = :t)"), (values[":t"] = true);
    p.amenities?.forEach((a, i) => {
      values[`:am${i}`] = a;
      filters.push(`contains(amenities, :am${i})`);
    });

    const items: Card[] = [];
    let start: Record<string, NativeAttributeValue> | undefined;
    do {
      const r = await this.ctx.doc.send(
        new QueryCommand({
          TableName: this.ctx.table,
          IndexName: GSI.geo,
          KeyConditionExpression: "GSI3PK = :pk AND GSI3SK BETWEEN :lo AND :hi",
          FilterExpression: filters.join(" AND "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ExclusiveStartKey: start,
          Limit: LIMITS.perCellItems,
        }),
      );
      for (const it of r.Items ?? []) {
        if (bboxContains(p.bbox, Number(it.lat), Number(it.lng))) items.push(it);
      }
      start = r.LastEvaluatedKey;
    } while (start && items.length < LIMITS.perCellItems);

    return { items: items.slice(0, LIMITS.perCellItems), more: !!start || items.length > LIMITS.perCellItems };
  }

  /** Stored night items for [from, to] inclusive (sparse: a missing date is FREE at the base price). */
  private async nightItems(id: string, from: string, to: string): Promise<Map<string, Card>> {
    const stored = new Map<string, Card>();
    let start: Record<string, NativeAttributeValue> | undefined;
    do {
      const r = await this.ctx.doc.send(
        new QueryCommand({
          TableName: this.ctx.table,
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":pk": `LISTING#${id}`, ":a": nightSk(from), ":b": nightSk(to) },
          ProjectionExpression: "SK, #s, pricePaise, holdExpiresAt",
          ExpressionAttributeNames: { "#s": "status" },
          ExclusiveStartKey: start,
        }),
      );
      for (const it of r.Items ?? []) stored.set(String(it.SK).slice(6), it);
      start = r.LastEvaluatedKey;
    } while (start);
    return stored;
  }

  /** Nightly prices if every night is free, else null. */
  private static nightPrices(card: Card, nights: string[], stored: Map<string, Card>, now: number): number[] | null {
    const out: number[] = [];
    for (const d of nights) {
      const n = stored.get(d);
      if (n && !isNightAvailable({ status: n.status, holdExpiresAt: n.holdExpiresAt }, now)) return null;
      out.push(Number(n?.pricePaise ?? card.basePricePaise));
    }
    return out;
  }

  /** The guest's full price (fees, discounts, GST) for these nights, or null if unavailable or against the stay rules. */
  private async priceStay(card: Card, nights: string[], guests: number, now: number): Promise<{ total: number; nights: number } | null> {
    const rules = pricingOf(card as Parameters<typeof pricingOf>[0]);
    try {
      checkStayLength(rules, nights.length);
    } catch {
      return null;
    }
    const stored = await this.nightItems(String(card.id), nights[0]!, nights[nights.length - 1]!);
    const prices = SearchService.nightPrices(card, nights, stored, now);
    return prices ? { total: quote(rules, prices, guests).totalPaise, nights: nights.length } : null;
  }

  /** First available window of the flexible length inside the months (weekends start on a Friday). */
  private async firstWindow(card: Card, flex: { kind: FlexKind; months: string[] }, guests: number, now: number, today: string) {
    const len = FLEX_NIGHTS[flex.kind];
    const rules = pricingOf(card as Parameters<typeof pricingOf>[0]);
    if (len < rules.minNights || len > rules.maxNights) return null;
    const months = [...flex.months].sort();
    const first = `${months[0]}-01` < today ? today : `${months[0]}-01`;
    const [ly, lm] = months[months.length - 1]!.split("-").map(Number) as [number, number];
    const lastStart = new Date(Date.UTC(ly, lm, 0)).toISOString().slice(0, 10); // last day of the last month
    if (first > lastStart) return null;
    const stored = await this.nightItems(String(card.id), first, addDays(lastStart, len - 1));
    for (let start = first; start <= lastStart; start = addDays(start, 1)) {
      if (!months.includes(start.slice(0, 7))) continue;
      if (flex.kind === "weekend" && new Date(`${start}T00:00:00Z`).getUTCDay() !== 5) continue;
      const nights = Array.from({ length: len }, (_, i) => addDays(start, i));
      const prices = SearchService.nightPrices(card, nights, stored, now);
      if (prices) return { checkIn: start, checkOut: addDays(start, len), total: quote(rules, prices, guests).totalPaise, nights: len };
    }
    return null;
  }

  private toResult(c: Card, stay?: { total: number; nights: number; checkIn?: string; checkOut?: string }): SearchResult {
    return {
      id: String(c.id),
      title: String(c.title),
      propertyType: c.propertyType,
      city: String(c.city),
      lat: Number(c.lat),
      lng: Number(c.lng),
      pricePaise: Number(c.basePricePaise),
      maxGuests: Number(c.maxGuests),
      bedrooms: Number(c.bedrooms),
      coverPhotoUrl: c.coverPhotoId ? this.photoUrl(String(c.id), String(c.coverPhotoId)) : null,
      ...(c.ratingCount ? { ratingAvg: Number(c.ratingAvg), ratingCount: Number(c.ratingCount) } : {}),
      ...(stay ? { totalPaise: stay.total, nights: stay.nights } : {}),
      ...(stay?.checkIn ? { checkIn: stay.checkIn, checkOut: stay.checkOut } : {}),
      ...(c.minNights && Number(c.minNights) > 1 ? { minNights: Number(c.minNights) } : {}),
      instantBook: c.instantBook !== false,
      ...(c.hostSuperhost ? { superhost: true } : {}),
    };
  }

  async search(p: SearchParams): Promise<SearchResponse> {
    const cells = coverCells(p.bbox);
    const perCell = await mapLimit(cells, LIMITS.cellConcurrency, (c) => this.queryCell(c, p));

    let truncated = perCell.some((c) => c.more);
    const candidates = perCell
      .flatMap((c) => c.items)
      .sort((a, b) => Number(a.basePricePaise) - Number(b.basePricePaise) || String(a.id).localeCompare(String(b.id)));

    const now = Math.floor(Date.now() / 1000);
    const guests = p.guests ?? 1;

    if (p.flex) {
      // Flexible dates: the first window that fits each listing, cheapest listings first.
      const today = new Date(now * 1000 + 330 * 60_000).toISOString().slice(0, 10);
      const pool = candidates.slice(0, LIMITS.availabilityCandidates);
      if (candidates.length > pool.length) truncated = true;
      const results: SearchResult[] = [];
      for (let i = 0; i < pool.length && results.length < p.limit; i += LIMITS.availabilityConcurrency) {
        const batch = pool.slice(i, i + LIMITS.availabilityConcurrency);
        const found = await mapLimit(batch, LIMITS.availabilityConcurrency, (c) => this.firstWindow(c, p.flex!, guests, now, today));
        batch.forEach((c, j) => found[j] && results.push(this.toResult(c, found[j]!)));
      }
      return { results: results.slice(0, p.limit), truncated, cellsQueried: cells.length };
    }

    if (!p.checkIn || !p.checkOut) {
      if (candidates.length > p.limit) truncated = true;
      return { results: candidates.slice(0, p.limit).map((c) => this.toResult(c)), truncated, cellsQueried: cells.length };
    }

    // Date search: check availability price-ascending, stop as soon as `limit` results are found.
    const nights = eachNight(p.checkIn, p.checkOut, MAX_STAY_NIGHTS);
    const pool = candidates.slice(0, LIMITS.availabilityCandidates);
    if (candidates.length > pool.length) truncated = true;

    const results: SearchResult[] = [];
    for (let i = 0; i < pool.length && results.length < p.limit; i += LIMITS.availabilityConcurrency) {
      const batch = pool.slice(i, i + LIMITS.availabilityConcurrency);
      const stays = await mapLimit(batch, LIMITS.availabilityConcurrency, (c) => this.priceStay(c, nights, guests, now));
      batch.forEach((c, j) => {
        const stay = stays[j];
        if (!stay) return;
        // Price filters apply to the nightly average of the full price when dates are given.
        const avg = stay.total / nights.length;
        if (p.priceMinPaise != null && avg < p.priceMinPaise) return;
        if (p.priceMaxPaise != null && avg > p.priceMaxPaise) return;
        results.push(this.toResult(c, stay));
      });
      if (results.length >= p.limit && i + LIMITS.availabilityConcurrency < pool.length) truncated = true;
    }
    return { results: results.slice(0, p.limit), truncated, cellsQueried: cells.length };
  }
}
