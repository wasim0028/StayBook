"use client";

import clsx from "clsx";
import { ImageOff, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, LinkButton, Skeleton } from "@/components/ui";
import { call } from "@/lib/client-api";
import { shortWhen } from "@/lib/messaging";
import type { InboxSummary, InboxThread, Page } from "@/lib/types";
import { Conversation } from "./Conversation";

type Filter = "all" | "unread" | "guest" | "host";

export function Inbox({ initialThread, isHost }: { initialThread: string | null; isHost: boolean }) {
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialThread);
  const [filter, setFilter] = useState<Filter>("all");
  const version = useRef<number>(-1);

  const load = useCallback(async () => {
    const r = await call<Page<InboxThread>>("/v1/threads?limit=50");
    setThreads(r.items);
  }, []);

  // Refetch the list only when the inbox version changes (new message or read anywhere).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const s = await call<InboxSummary>("/v1/inbox/summary");
        if (!stop && s.version !== version.current) {
          version.current = s.version;
          await load();
        }
      } catch {
        /* transient */
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [load]);

  function choose(id: string | null) {
    setSelected(id);
    window.history.replaceState(null, "", id ? `/inbox?t=${encodeURIComponent(id)}` : "/inbox");
  }

  const shown = (threads ?? []).filter((t) => (filter === "unread" ? t.unread > 0 : filter === "guest" ? t.role === "guest" : filter === "host" ? t.role === "host" : true));
  const filters: [Filter, string][] = isHost ? [["all", "All"], ["unread", "Unread"], ["host", "Hosting"], ["guest", "Travelling"]] : [["all", "All"], ["unread", "Unread"]];

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-7xl">
      <aside className={clsx("flex w-full flex-col border-line md:w-96 md:shrink-0 md:border-r", selected && "hidden md:flex")}>
        <div className="px-4 pb-3 pt-6 sm:px-6">
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <div className="mt-4 flex gap-2" role="tablist">
            {filters.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={clsx("rounded-full border px-3.5 py-1.5 text-sm font-semibold", filter === k ? "border-fg bg-fg text-bg" : "border-line hover:border-fg")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads === null ? (
            <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
          ) : shown.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<MessageSquare className="size-6" />} title={filter === "all" ? "No messages yet" : "Nothing here"} body={filter === "all" ? "When you contact a host or a guest writes to you, the conversation appears here." : undefined} action={filter === "all" ? <LinkButton href="/">Find a place to stay</LinkButton> : undefined} />
            </div>
          ) : (
            <ul>
              {shown.map((t) => (
                <li key={t.threadId}>
                  <button onClick={() => choose(t.threadId)} aria-current={selected === t.threadId} className={clsx("flex w-full gap-3 px-4 py-3.5 text-left transition sm:px-6", selected === t.threadId ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                    <div className="relative size-14 shrink-0">
                      <div className="size-14 overflow-hidden rounded-xl bg-surface-2">
                        {t.coverPhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.coverPhotoUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="grid size-full place-items-center text-muted"><ImageOff className="size-5" /></div>
                        )}
                      </div>
                      <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full border-2 border-bg bg-fg text-xs font-bold text-bg">{t.otherName.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={clsx("truncate", t.unread ? "font-bold" : "font-semibold")}>{t.otherName}</span>
                        {t.lastMessageAt && <span className="shrink-0 text-xs text-muted">{shortWhen(t.lastMessageAt)}</span>}
                      </div>
                      <p className={clsx("truncate text-sm", t.unread ? "font-semibold text-fg" : "text-muted")}>
                        {t.lastFromMe && "You: "}
                        {t.lastPreview}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted">
                        {isHost && <span className="rounded bg-surface-2 px-1.5 py-0.5 font-semibold">{t.role === "host" ? "Hosting" : "Travelling"}</span>}
                        <span className="truncate">{t.listingTitle}</span>
                      </p>
                    </div>
                    {t.unread > 0 && <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-brand-fg" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={clsx("min-w-0 flex-1", !selected && "hidden md:flex")}>
        {selected ? (
          <Conversation key={selected} threadId={selected} onBack={() => choose(null)} onActivity={load} />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-muted">
            <div>
              <MessageSquare className="mx-auto size-10" />
              <p className="mt-3">Pick a conversation</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
