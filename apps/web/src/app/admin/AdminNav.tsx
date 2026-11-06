"use client";

import clsx from "clsx";
import { Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const TABS = [
  { href: "/admin", label: "Overview", exact: true, staff: true },
  { href: "/admin/metrics", label: "Metrics", staff: true },
  { href: "/admin/refunds", label: "Refunds" },
  { href: "/admin/hosts", label: "Hosts" },
  { href: "/admin/listings", label: "Listings" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <div className="sticky top-16 z-30 -mx-4 border-b border-line bg-bg/90 px-4 pt-5 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
          <ShieldCheck className="size-4" /> {isAdmin ? "Operations" : "Insights"}
        </div>
        {isAdmin && (
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) router.push(`/admin/find?q=${encodeURIComponent(q.trim())}`);
            }}
            className="relative w-full sm:w-80"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Booking, listing or user ID, or email" aria-label="Find a booking, listing or user" className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-4 text-sm outline-none focus:border-fg" />
          </form>
        )}
      </div>
      <nav aria-label="Admin" className="mt-3 flex gap-1 overflow-x-auto">
        {TABS.filter((t) => isAdmin || t.staff).map((t) => {
          const active = t.exact ? path === t.href : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={clsx("whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition", active ? "border-fg" : "border-transparent text-muted hover:text-fg")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
