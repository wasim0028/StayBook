import { formatINR } from "./format";
import { isMoney, type MetricField } from "./admin-types";

const dayShort = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const dayLabel = (iso: string) => dayShort.format(new Date(`${iso}T00:00:00Z`));
export const dayTick = (iso: string) => String(Number(iso.slice(8, 10)));

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
export function compactINR(paise: number): string {
  const r = paise / 100;
  return r >= 1000 ? `₹${compact.format(r)}` : `₹${Math.round(r)}`;
}
export const count = (n: number) => compact.format(n);
export const fmtMetric = (f: MetricField, v: number) => (isMoney(f) ? formatINR(v) : v.toLocaleString("en-IN"));
export const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

const dt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
export const dateTime = (iso: string) => dt.format(new Date(iso));

/** "3h", "2d" since an ISO time. */
export function age(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
