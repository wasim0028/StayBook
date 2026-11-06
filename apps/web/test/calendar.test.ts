import { describe, expect, it } from "vitest";
import { buildMonth, pickDate, rangeAvailable, stayTotal, type Availability } from "../src/lib/calendar";
import { addDaysISO, formatINR, formatRange, nightsBetween, timeAgo } from "../src/lib/format";
import { needsRefresh, safeNext, sessionFromTokens } from "../src/lib/session";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("calendar", () => {
  it("builds Monday-first weeks that cover the month", () => {
    const weeks = buildMonth(2026, 11); // December 2026 starts on a Tuesday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]!.date).toBe("2026-11-30");
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(weeks[0]![1]!.date).toBe("2026-12-01");
    const days = weeks.flat().filter((d) => d.inMonth);
    expect(days).toHaveLength(31);
    expect(weeks.at(-1)!.at(-1)!.date >= "2026-12-31").toBe(true);
  });

  it("handles a month that starts on Monday without a leading row of padding", () => {
    const weeks = buildMonth(2026, 5); // June 2026 starts on a Monday
    expect(weeks[0]![0]!.date).toBe("2026-06-01");
    expect(weeks[0]![0]!.inMonth).toBe(true);
  });

  const avail: Availability = {
    "2026-12-10": { available: true, pricePaise: 400000 },
    "2026-12-11": { available: true, pricePaise: 500000 },
    "2026-12-12": { available: false },
    "2026-12-13": { available: true, pricePaise: 400000 },
  };

  it("checks every night of the stay, not the check-out day", () => {
    expect(rangeAvailable("2026-12-10", "2026-12-12", avail)).toBe(true); // nights 10, 11
    expect(rangeAvailable("2026-12-10", "2026-12-13", avail)).toBe(false); // night 12 is taken
    expect(rangeAvailable("2026-12-12", "2026-12-13", avail)).toBe(false);
    expect(rangeAvailable("2026-12-13", "2026-12-15", avail)).toBe(true); // unknown nights count as free
    expect(rangeAvailable("2026-12-10", "2026-12-12", undefined)).toBe(true);
  });

  it("picks ranges: start, complete, restart, and refuse to cross a taken night", () => {
    let r = pickDate({}, "2026-12-10", avail);
    expect(r).toEqual({ from: "2026-12-10" });
    r = pickDate(r, "2026-12-12", avail);
    expect(r).toEqual({ from: "2026-12-10", to: "2026-12-12" });
    expect(pickDate(r, "2026-12-20", avail)).toEqual({ from: "2026-12-20" }); // new range after a complete one
    expect(pickDate({ from: "2026-12-10" }, "2026-12-09", avail)).toEqual({ from: "2026-12-09" });
    expect(pickDate({ from: "2026-12-10" }, "2026-12-10", avail)).toEqual({ from: "2026-12-10" });
    expect(pickDate({ from: "2026-12-10" }, "2026-12-14", avail)).toEqual({ from: "2026-12-14" });
  });

  it("totals per-night prices with the base price as the fallback", () => {
    expect(stayTotal("2026-12-10", "2026-12-12", avail, 999)).toBe(900000);
    expect(stayTotal("2026-12-13", "2026-12-15", avail, 300000)).toBe(400000 + 300000);
  });
});

describe("format", () => {
  it("formats rupees with Indian grouping", () => {
    expect(formatINR(1234500)).toBe("₹12,345");
    expect(formatINR(1_00_00_000)).toBe("₹1,00,000");
  });
  it("counts nights across month and year boundaries", () => {
    expect(nightsBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(addDaysISO("2026-02-27", 2)).toBe("2026-03-01");
    expect(formatRange("2026-12-10", "2026-12-12")).toMatch(/10 Dec.*12 Dec/);
    expect(formatRange()).toBe("Add dates");
  });
  it("describes elapsed time", () => {
    const now = Date.parse("2026-06-10T12:00:00Z");
    expect(timeAgo("2026-06-10T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-06-10T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-05-01T12:00:00Z", now)).toBe("1 month ago");
  });
});

describe("session helpers", () => {
  const now = 1_800_000_000;
  it("reads groups and email from tokens and treats expired access tokens as signed out", () => {
    const s = sessionFromTokens(jwt({ sub: "u1", exp: now + 600, "cognito:groups": ["guest", "host"] }), jwt({ email: "a@b.in", name: "Asha" }), now);
    expect(s).toMatchObject({ sub: "u1", email: "a@b.in", name: "Asha", isHost: true, isAdmin: false });
    expect(sessionFromTokens(jwt({ sub: "u1", exp: now - 1 }), undefined, now)).toBeNull();
    expect(sessionFromTokens("garbage", undefined, now)).toBeNull();
    expect(sessionFromTokens(undefined, undefined, now)).toBeNull();
  });
  it("asks for a refresh shortly before expiry", () => {
    expect(needsRefresh(jwt({ exp: now + 600 }), now)).toBe(false);
    expect(needsRefresh(jwt({ exp: now + 60 }), now)).toBe(true);
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(needsRefresh("junk", now)).toBe(true);
  });
  it("only allows same-site relative post-login paths", () => {
    expect(safeNext("/trips?x=1")).toBe("/trips?x=1");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "evil", "", null, undefined]) expect(safeNext(bad as string)).toBe("/");
  });
});
