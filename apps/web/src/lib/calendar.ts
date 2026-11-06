import { addDaysISO, nightsBetween, toISODate } from "./format";

export interface DayCell {
  date: string; // YYYY-MM-DD
  day: number;
  inMonth: boolean;
}

/** Weeks (Monday first) covering a month; days outside the month are flagged so the grid stays rectangular. */
export function buildMonth(year: number, month0: number): DayCell[][] {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month0, 1 - lead);
  const weeks: DayCell[][] = [];
  const cur = new Date(start);
  do {
    const week: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: toISODate(cur), day: cur.getDate(), inMonth: cur.getMonth() === month0 });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  } while (cur.getMonth() === month0 || cur.getDay() !== 1);
  return weeks;
}

export type Availability = Record<string, { available: boolean; pricePaise?: number }>;

/** Every night of the stay [from, to) must be free. Unknown nights count as free (the server re-checks). */
export function rangeAvailable(from: string, to: string, avail: Availability | undefined): boolean {
  if (!avail) return true;
  const n = nightsBetween(from, to);
  for (let i = 0; i < n; i++) {
    const a = avail[addDaysISO(from, i)];
    if (a && !a.available) return false;
  }
  return true;
}

export interface Range {
  from?: string;
  to?: string;
}

/**
 * Click handling for a range picker.
 *  - first click, or a click after a complete range: start a new range
 *  - click on/before the start: restart from there
 *  - click after the start: complete the range, unless it would cross an unavailable night
 *    (then the clicked day becomes the new start)
 */
export function pickDate(cur: Range, date: string, avail?: Availability): Range {
  if (!cur.from || cur.to) return { from: date };
  if (date <= cur.from) return { from: date };
  if (!rangeAvailable(cur.from, date, avail)) return { from: date };
  return { from: cur.from, to: date };
}

/** Total for a stay from per-night prices; falls back to `basePricePaise` for nights with no calendar entry. */
export function stayTotal(from: string, to: string, avail: Availability | undefined, basePricePaise: number): number {
  const n = nightsBetween(from, to);
  let total = 0;
  for (let i = 0; i < n; i++) total += avail?.[addDaysISO(from, i)]?.pricePaise ?? basePricePaise;
  return total;
}
