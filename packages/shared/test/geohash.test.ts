import { describe, expect, it } from "vitest";
import {
  bboxContains,
  cellSize,
  coverCells,
  encodeGeohash,
  parseBBox,
  TooManyCellsError,
} from "../src/geohash.js";
import { eachNight, isValidDate, nightsBetween } from "../src/dates.js";
import { geoPriceRange, pricePad } from "../src/keys.js";

describe("encodeGeohash", () => {
  it("matches published reference hashes", () => {
    // Reference values from the original geohash.org algorithm
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
    expect(encodeGeohash(42.6, -5.6, 5)).toBe("ezs42");
  });

  it("is a prefix-consistent hierarchy", () => {
    const h9 = encodeGeohash(15.4909, 73.8278, 9); // Panaji, Goa
    expect(encodeGeohash(15.4909, 73.8278, 5)).toBe(h9.slice(0, 5));
  });

  it("rejects bad input", () => {
    expect(() => encodeGeohash(91, 0)).toThrow(RangeError);
    expect(() => encodeGeohash(Number.NaN, 0)).toThrow(RangeError);
  });
});

describe("coverCells", () => {
  it("covers a small box with the cell containing its centre", () => {
    const box = parseBBox("15.49,73.82,15.50,73.83");
    const cells = coverCells(box);
    expect(cells).toContain(encodeGeohash(15.495, 73.825, 5));
  });

  it("returns every cell that any point inside the box falls into", () => {
    const box = parseBBox("12.90,77.50,13.05,77.70"); // Bengaluru core
    const cells = new Set(coverCells(box));
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const lat = box.swLat + ((box.neLat - box.swLat) * i) / 20;
        const lng = box.swLng + ((box.neLng - box.swLng) * j) / 20;
        expect(cells.has(encodeGeohash(lat, lng, 5))).toBe(true);
      }
    }
  });

  it("has no duplicates", () => {
    const cells = coverCells(parseBBox("19.0,72.8,19.1,72.95"));
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("refuses very large viewports", () => {
    expect(() => coverCells(parseBBox("8,68,37,97"))).toThrow(TooManyCellsError);
  });

  it("precision-5 cell is roughly 4.9 km square", () => {
    const { height, width } = cellSize(5);
    expect(height).toBeCloseTo(0.0439, 3);
    expect(width).toBeCloseTo(0.0439, 3);
  });
});

describe("parseBBox", () => {
  it("validates shape and order", () => {
    expect(() => parseBBox("1,2,3")).toThrow();
    expect(() => parseBBox("10,10,5,20")).toThrow();
    expect(() => parseBBox("1,170,2,-170")).toThrow(/antimeridian/);
    expect(bboxContains(parseBBox("0,0,1,1"), 0.5, 0.5)).toBe(true);
  });
});

describe("dates", () => {
  it("enumerates nights in [from, to)", () => {
    expect(eachNight("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(nightsBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
  });

  it("rejects impossible dates", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-2-3")).toBe(false);
    expect(() => eachNight("2026-01-05", "2026-01-05")).toThrow();
  });
});

describe("price sort keys", () => {
  it("pads to sort lexically like numbers", () => {
    expect(pricePad(500_00) < pricePad(4500_00)).toBe(true);
    const { lo, hi } = geoPriceRange(1000_00, 5000_00);
    const sk = `PRICE#${pricePad(5000_00)}#01JABCDEF`;
    expect(sk >= lo && sk <= hi).toBe(true);
  });
});
