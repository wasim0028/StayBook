import data from "./data/places-in.json" with { type: "json" };

/** [displayName, state, lat, lng, foldedName, priority] — see scripts/build-places.mjs. */
type Row = [string, string, number, number, string, number];
const ROWS = data as unknown as Row[];

export interface Place {
  name: string;
  state: string;
  lat: number;
  lng: number;
  /** A search box around the place, small enough for one search request (≤ 64 geohash cells). */
  bbox: string;
}

/** ~0.24° square: about 25 x 25 km, comfortably inside the search area limit. */
const HALF_SPAN = 0.12;

export const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const bboxAround = (lat: number, lng: number) =>
  [lat - HALF_SPAN, lng - HALF_SPAN, lat + HALF_SPAN, lng + HALF_SPAN].map((n) => n.toFixed(4)).join(",");

/**
 * Prefix search over Indian places (GeoNames, CC-BY-4.0, plus curated destinations).
 * Ranking: curated destinations first, then exact name, then word-start matches, then shorter names.
 */
export function findPlaces(query: string, limit = 8): Place[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const scored: { row: Row; score: number }[] = [];
  for (const row of ROWS) {
    const name = row[4];
    let score: number;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(` ${q}`)) score = 2;
    else continue;
    scored.push({ row, score: score - row[5] * 3 + name.length / 100 });
  }
  scored.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const { row } of scored) {
    const key = `${row[0]}|${row[1]}`; // an alias and its place collapse to one result
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: row[0], state: row[1], lat: row[2], lng: row[3], bbox: bboxAround(row[2], row[3]) });
    if (out.length >= limit) break;
  }
  return out;
}
