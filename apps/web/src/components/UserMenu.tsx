"use client";

import { LogOut, Settings, Store, UserCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "./useDismiss";

export function UserMenu({ name, email, isHost }: { name?: string; email?: string; isHost: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase();

  const item = "flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="grid size-10 place-items-center rounded-full bg-fg text-sm font-bold text-bg">
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 w-64 overflow-hidden rounded-2xl border border-line bg-surface py-2 shadow-card">
          <div className="border-b border-line px-4 pb-3 pt-1">
            <div className="truncate font-semibold">{name ?? "Your account"}</div>
            {email && <div className="truncate text-sm text-muted">{email}</div>}
          </div>
          <Link role="menuitem" href="/account" className={item} onClick={close}>
            <UserCircle className="size-4" /> Profile
          </Link>
          <Link role="menuitem" href={isHost ? "/host" : "/host/onboarding"} className={item} onClick={close}>
            <Store className="size-4" /> {isHost ? "Host dashboard" : "Become a host"}
          </Link>
          <Link role="menuitem" href="/trips" className={item} onClick={close}>
            <Settings className="size-4" /> Trips
          </Link>
          <a role="menuitem" href="/auth/logout" className={`${item} border-t border-line text-bad`}>
            <LogOut className="size-4" /> Log out
          </a>
        </div>
      )}
    </div>
  );
}
