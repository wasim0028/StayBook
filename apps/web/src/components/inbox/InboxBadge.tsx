"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { InboxSummary } from "@/lib/types";

/** Navbar inbox link with an unread count, refreshed every 30s and when the tab regains focus. */
export function InboxBadge() {
  const [unread, setUnread] = useState(0);
  const path = usePathname();
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/bff/v1/inbox/summary", { credentials: "same-origin" });
        if (r.ok && !stop) setUnread(((await r.json()) as InboxSummary).unread);
      } catch {
        /* offline; keep the last count */
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      stop = true;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [path]);
  return (
    <Link href="/inbox" aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"} className="relative grid size-10 place-items-center rounded-full hover:bg-surface-2">
      <MessageSquare className="size-5" />
      {unread > 0 && <span className="absolute right-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-bold leading-5 text-brand-fg">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
