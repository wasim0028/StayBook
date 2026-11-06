"use client";

import clsx from "clsx";
import { AlertCircle, ArrowLeft, ArrowUp, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge, Spinner } from "@/components/ui";
import { STATUS_UI } from "@/lib/booking-ui";
import { call, ClientApiError, errorMessage } from "@/lib/client-api";
import { formatRange } from "@/lib/format";
import { clock, dayHeading } from "@/lib/messaging";
import type { ChatMessage, Page, ThreadDetail } from "@/lib/types";

const POLL_MS = 4000;
const MAX = 2000;

export function Conversation({ threadId, onBack, onActivity }: { threadId: string; onBack: () => void; onActivity: () => void }) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]); // oldest first
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const newest = useRef<string | null>(null);

  const markRead = useCallback(() => {
    void call(`/v1/threads/${threadId}/read`, { method: "POST" }).then(onActivity, () => undefined);
  }, [threadId, onActivity]);

  // Initial load: thread details + newest page.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const [d, page] = await Promise.all([call<ThreadDetail>(`/v1/threads/${threadId}`), call<Page<ChatMessage>>(`/v1/threads/${threadId}/messages?limit=30`)]);
        if (stop) return;
        setDetail(d);
        const ordered = [...page.items].reverse();
        setMsgs(ordered);
        setOlderCursor(page.nextCursor ?? null);
        newest.current = ordered.at(-1)?.cursor ?? null;
        markRead();
      } catch (e) {
        if (!stop) setError(e instanceof ClientApiError && e.status === 404 ? "This conversation doesn't exist or isn't yours." : errorMessage(e));
      }
    })();
    return () => {
      stop = true;
    };
  }, [threadId, markRead]);

  // Poll for newer messages while the tab is visible.
  useEffect(() => {
    if (!detail) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const q = newest.current ? `?after=${encodeURIComponent(newest.current)}` : "?limit=30";
        const r = await call<Page<ChatMessage>>(`/v1/threads/${threadId}/messages${q}`);
        const fresh = newest.current ? r.items : [...r.items].reverse();
        if (!fresh.length) return;
        newest.current = fresh.at(-1)!.cursor;
        setMsgs((cur) => {
          const seen = new Set(cur.map((m) => m.messageId));
          return [...cur, ...fresh.filter((m) => !seen.has(m.messageId))];
        });
        if (fresh.some((m) => !m.mine)) markRead();
      } catch {
        /* transient */
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [detail, threadId, markRead]);

  // Keep the view pinned to the latest message unless the user scrolled up to read history.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function loadOlder() {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    try {
      const r = await call<Page<ChatMessage>>(`/v1/threads/${threadId}/messages?limit=30&cursor=${encodeURIComponent(olderCursor)}`);
      stickToBottom.current = false;
      setMsgs((cur) => [...[...r.items].reverse(), ...cur]);
      setOlderCursor(r.nextCursor ?? null);
      requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - before));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(body: string, clientId = crypto.randomUUID()) {
    const optimistic: ChatMessage = { messageId: clientId, senderId: "me", senderName: "You", mine: true, body, masked: false, createdAt: new Date().toISOString(), cursor: "", pending: true };
    stickToBottom.current = true;
    setMsgs((cur) => [...cur.filter((m) => m.messageId !== clientId), optimistic]);
    try {
      const m = await call<ChatMessage>(`/v1/threads/${threadId}/messages`, { method: "POST", body: { body, clientId } });
      setMsgs((cur) => cur.map((x) => (x.messageId === clientId ? m : x)));
      if (!newest.current || m.cursor > newest.current) newest.current = m.cursor;
      onActivity();
    } catch {
      setMsgs((cur) => cur.map((x) => (x.messageId === clientId ? { ...x, pending: false, failed: true } : x)));
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    void send(body);
  }

  if (error) return <div className="grid flex-1 place-items-center p-8 text-muted">{error}</div>;
  if (!detail) return <div className="grid flex-1 place-items-center"><Spinner /></div>;

  const booking = detail.bookings[0];
  const tripHref = booking ? (detail.role === "host" ? `/host/reservations/${booking.bookingId}` : `/trips/${booking.bookingId}`) : null;

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <button onClick={onBack} aria-label="Back to messages" className="grid size-9 place-items-center rounded-full hover:bg-surface-2 md:hidden"><ArrowLeft className="size-5" /></button>
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-fg font-bold text-bg">{(detail.otherName ?? "?").charAt(0).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{detail.otherName ?? "Conversation"}</div>
          <Link href={`/listing/${detail.listingId}`} className="block truncate text-sm text-muted hover:underline">{detail.listingTitle}</Link>
        </div>
        {booking && tripHref && (
          <Link href={tripHref} className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm hover:border-fg sm:flex">
            {formatRange(booking.checkIn, booking.checkOut)} <Badge tone={STATUS_UI[booking.status].tone}>{STATUS_UI[booking.status].label}</Badge>
          </Link>
        )}
      </header>

      <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {olderCursor && (
          <div className="mb-4 text-center">
            <button onClick={loadOlder} className="rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:border-fg">{loadingOlder ? <Loader2 className="inline size-4 animate-spin" /> : "Earlier messages"}</button>
          </div>
        )}
        {!detail.contactSharing && (
          <div className="mx-auto mb-5 flex max-w-md items-start gap-2.5 rounded-2xl bg-surface-2 p-3.5 text-sm text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <p>For your protection, phone numbers, emails and links are hidden until a booking is confirmed. Always pay through StayBook.</p>
          </div>
        )}
        {msgs.length === 0 && <p className="mt-10 text-center text-muted">Say hello to {detail.otherName ?? "them"}. Ask about the place, the area or your dates.</p>}
        <ol className="space-y-1.5">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped = prev && !newDay && prev.mine === m.mine && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000;
            return (
              <Fragment key={m.messageId}>
                {newDay && <li className="py-3 text-center text-xs font-semibold text-muted">{dayHeading(m.createdAt)}</li>}
                <li className={clsx("flex", m.mine ? "justify-end" : "justify-start", !grouped && "pt-2")}>
                  <div className={clsx("max-w-[78%]")}>
                    <div className={clsx("whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed", m.mine ? "rounded-br-md bg-fg text-bg" : "rounded-bl-md bg-surface-2", m.pending && "opacity-60")}>{m.body}</div>
                    <div className={clsx("mt-1 flex items-center gap-1.5 px-1 text-xs text-muted", m.mine && "justify-end")}>
                      {m.failed ? (
                        <button onClick={() => send(m.body, m.messageId)} className="flex items-center gap-1 font-semibold text-bad"><AlertCircle className="size-3.5" /> Not sent. Tap to retry</button>
                      ) : m.pending ? (
                        "Sending…"
                      ) : (
                        <>
                          {clock(m.createdAt)}
                          {m.masked && <span title="Contact details are hidden until a booking is confirmed">· contact details hidden</span>}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>

      {detail.role === "admin" ? (
        <p className="border-t border-line px-6 py-4 text-sm text-muted">Read-only: staff can view conversations for support and disputes.</p>
      ) : (
        <form onSubmit={submit} className="border-t border-line px-4 py-3 sm:px-6">
          <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface px-4 py-2 focus-within:border-fg">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Write a message"
              aria-label="Message"
              className="max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 outline-none focus-visible:outline-none [field-sizing:content]"
            />
            <button type="submit" disabled={!draft.trim()} aria-label="Send" className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand text-brand-fg disabled:opacity-30">
              <ArrowUp className="size-4" />
            </button>
          </div>
          {draft.length > MAX - 200 && <p className="mt-1 text-right text-xs text-muted">{MAX - draft.length} characters left</p>}
        </form>
      )}
    </div>
  );
}
