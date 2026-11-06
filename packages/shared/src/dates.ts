/** Date helpers. All dates are calendar dates ("YYYY-MM-DD"), interpreted as UTC to avoid DST drift. */

export const MAX_STAY_NIGHTS = 90;
export const MAX_CALENDAR_SPAN_NIGHTS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function toMs(s: string): number {
  if (!isValidDate(s)) throw new RangeError(`invalid date: ${s}`);
  return Date.parse(`${s}T00:00:00Z`);
}

export function addDays(s: string, days: number): string {
  return new Date(toMs(s) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Number of nights in [from, to). Negative if `to` is before `from`. */
export function nightsBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

/** Every night in [from, to), i.e. check-in night through the night before check-out. */
export function eachNight(from: string, to: string, maxNights: number = MAX_CALENDAR_SPAN_NIGHTS): string[] {
  const n = nightsBetween(from, to);
  if (n <= 0) throw new RangeError("`to` must be after `from`");
  if (n > maxNights) throw new RangeError(`range exceeds ${maxNights} nights`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

/** Epoch seconds at which a night item may be garbage-collected (end of that day + retention). */
export function nightTtl(date: string, retentionDays = 30): number {
  return Math.floor(toMs(date) / 1000) + (1 + retentionDays) * 86_400;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
