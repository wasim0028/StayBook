const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });

export function shortWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return time.format(d);
  if ((now.getTime() - d.getTime()) / 86_400_000 < 6) return d.toLocaleDateString("en-IN", { weekday: "short" });
  return day.format(d);
}
export const clock = (iso: string) => time.format(new Date(iso));
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return d.toDateString() === y.toDateString() ? "Yesterday" : full.format(d);
}
