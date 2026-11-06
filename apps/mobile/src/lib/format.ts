const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Money is integer paise everywhere; format only at the edge. */
export function formatINR(paise: number): string {
  return inr.format(Math.round(paise / 100));
}

/** Compact label for map pins, e.g. ₹8.5k */
export function shortINR(paise: number): string {
  const r = paise / 100;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(1).replace(/\.0$/, "")}L`;
  if (r >= 1_000) return `₹${(r / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₹${Math.round(r)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar date in the device's local time zone, as YYYY-MM-DD. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return toISODate(new Date(y, m - 1, d + days));
}

function utcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function nightsBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

const short = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export function formatRange(from?: string, to?: string): string {
  if (!from || !to) return "Any dates";
  const f = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return short.format(new Date(y, m - 1, d));
  };
  return `${f(from)} – ${f(to)}`;
}

export const todayISO = () => toISODate(new Date());

const long = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return long.format(new Date(y, m - 1, d));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [[31_536_000, "year"], [2_592_000, "month"], [604_800, "week"], [86_400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [secs, name] of units) if (s >= secs) return `${plural(Math.floor(s / secs), name)} ago`;
  return "just now";
}
