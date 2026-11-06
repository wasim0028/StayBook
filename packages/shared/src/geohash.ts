/**
 * Geohash helpers for the DynamoDB map-search index (GSI3).
 *
 * Listings are indexed by their precision-5 geohash cell (~4.9 km x 4.9 km).
 * A map viewport (bounding box) is converted into the exact set of cells that
 * cover it; search-svc then runs one Query per cell and filters precisely.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Precision used for the GSI3 partition key. Changing it requires a re-index. */
export const GEO_PRECISION = 5;

/** Upper bound on cells per search (64 cells at precision 5 is roughly 39 km x 39 km). */
export const MAX_SEARCH_CELLS = 64;

export interface BBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export class TooManyCellsError extends Error {
  constructor(public readonly cells: number, public readonly max: number) {
    super(`Search area covers ${cells} cells (max ${max}); zoom in`);
    this.name = "TooManyCellsError";
  }
}

export function encodeGeohash(lat: number, lng: number, precision: number = GEO_PRECISION): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new RangeError("lat/lng must be finite");
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new RangeError("lat/lng out of range");

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true; // geohash interleaves bits, starting with longitude

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch = ch << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32.charAt(ch);
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Cell height/width in degrees for a given precision. */
export function cellSize(precision: number): { height: number; width: number } {
  const totalBits = precision * 5;
  const lngBits = Math.ceil(totalBits / 2);
  const latBits = Math.floor(totalBits / 2);
  return { height: 180 / 2 ** latBits, width: 360 / 2 ** lngBits };
}

export function validateBBox(b: BBox): void {
  const vals = [b.swLat, b.swLng, b.neLat, b.neLng];
  if (!vals.every(Number.isFinite)) throw new RangeError("bbox values must be finite numbers");
  if (b.swLat < -90 || b.neLat > 90 || b.swLng < -180 || b.neLng > 180) throw new RangeError("bbox out of range");
  if (b.swLat > b.neLat) throw new RangeError("swLat must be <= neLat");
  // Boxes that cross the antimeridian are not supported; clients should split them.
  if (b.swLng > b.neLng) throw new RangeError("swLng must be <= neLng (antimeridian not supported)");
}

/** Parse "swLat,swLng,neLat,neLng". */
export function parseBBox(raw: string): BBox {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4) throw new RangeError("bbox must be swLat,swLng,neLat,neLng");
  const [swLat, swLng, neLat, neLng] = parts as [number, number, number, number];
  const box = { swLat, swLng, neLat, neLng };
  validateBBox(box);
  return box;
}

export function bboxContains(b: BBox, lat: number, lng: number): boolean {
  return lat >= b.swLat && lat <= b.neLat && lng >= b.swLng && lng <= b.neLng;
}

/**
 * All geohash cells (at `precision`) that intersect the bounding box.
 * Throws TooManyCellsError if the box needs more than `maxCells` cells.
 */
export function coverCells(
  box: BBox,
  precision: number = GEO_PRECISION,
  maxCells: number = MAX_SEARCH_CELLS,
): string[] {
  validateBBox(box);
  const { height, width } = cellSize(precision);
  const EPS = 1e-9;
  const clampLat = (v: number) => Math.min(Math.max(v, -90), 90 - EPS);
  const clampLng = (v: number) => Math.min(Math.max(v, -180), 180 - EPS);

  const r0 = Math.floor((clampLat(box.swLat) + 90) / height);
  const r1 = Math.floor((clampLat(box.neLat) + 90) / height);
  const c0 = Math.floor((clampLng(box.swLng) + 180) / width);
  const c1 = Math.floor((clampLng(box.neLng) + 180) / width);

  const total = (r1 - r0 + 1) * (c1 - c0 + 1);
  if (total > maxCells) throw new TooManyCellsError(total, maxCells);

  const cells: string[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const lat = (r + 0.5) * height - 90;
      const lng = (c + 0.5) * width - 180;
      cells.push(encodeGeohash(lat, lng, precision));
    }
  }
  return cells;
}
