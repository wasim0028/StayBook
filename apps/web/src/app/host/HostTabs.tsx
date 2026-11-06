"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/host", label: "Today", exact: true },
  { href: "/host/reservations", label: "Reservations" },
  { href: "/host/listings", label: "Listings" },
  { href: "/host/onboarding", label: "Payouts" },
];

export function HostTabs() {
  const path = usePathname();
  return (
    <div className="border-b border-line bg-surface">
      <nav aria-label="Host" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href : path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={clsx("whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-semibold transition", active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
