const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Money is integer paise everywhere; format only at the edge. */
export function formatINR(paise: number): string {
  return inr.format(Math.round(paise / 100));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

const utcMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

export function nightsBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

const dm = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const dmy = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const long = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const month = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

export const formatDate = (iso: string) => dmy.format(parseISO(iso));
export const formatDateLong = (iso: string) => long.format(parseISO(iso));
export const formatMonth = (d: Date) => month.format(d);

export function formatRange(from?: string, to?: string): string {
  if (!from || !to) return "Add dates";
  return `${dm.format(parseISO(from))} – ${dm.format(parseISO(to))}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const todayISO = () => toISODate(new Date());

export function formatRating(avg?: number): string {
  return typeof avg === "number" ? avg.toFixed(2).replace(/0$/, "") : "New";
}

/** "2 hours ago", "3 months ago" */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const units: [number, string][] = [
    [31_536_000, "year"],
    [2_592_000, "month"],
    [604_800, "week"],
    [86_400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, name] of units) {
    if (s >= secs) return plural(Math.floor(s / secs), name) + " ago";
  }
  return "just now";
}
