import clsx from "clsx";
import Link from "next/link";

export function StatTile({ label, value, sub, href, attention }: { label: string; value: string; sub?: string; href?: string; attention?: boolean }) {
  const body = (
    <>
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </>
  );
  const cls = clsx("block rounded-2xl border bg-surface p-5", attention ? "border-warn/50 bg-warn-soft/40" : "border-line", href && "transition hover:shadow-card");
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
