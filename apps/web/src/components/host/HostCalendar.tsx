"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import { buildMonth } from "@/lib/calendar";
import { call, errorMessage } from "@/lib/client-api";
import { addDaysISO, formatDate, formatINR, formatMonth, nightsBetween, plural, todayISO, toISODate } from "@/lib/format";
import type { CalendarNight, CalendarResponse } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STYLE: Record<NonNullable<CalendarNight["status"]>, string> = {
  FREE: "bg-surface hover:bg-surface-2",
  BLOCKED: "bg-surface-2 text-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,var(--line)_6px_7px)]",
  HELD: "bg-warn-soft text-warn",
  BOOKED: "bg-ok-soft text-ok",
};

/** Host availability and pricing. Select a run of nights, then block, reopen or price them. */
export function HostCalendar({ listingId, basePricePaise }: { listingId: string; basePricePaise: number }) {
  const today = todayISO();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [nights, setNights] = useState<Record<string, CalendarNight>>({});
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<{ a?: string; b?: string }>({});
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string }>();

  const weeks = useMemo(() => buildMonth(month.getFullYear(), month.getMonth()), [month]);
  const from = toISODate(month);
  const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 1));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<CalendarResponse>(`/v1/listings/${listingId}/calendar?from=${from}&to=${to}`);
      setNights(Object.fromEntries(r.nights.map((n) => [n.date, n])));
    } catch (x) {
      setMsg({ tone: "bad", text: errorMessage(x) });
    } finally {
      setLoading(false);
    }
  }, [listingId, from, to]);
  useEffect(() => { void load(); }, [load]);

  const start = sel.a && sel.b ? (sel.a < sel.b ? sel.a : sel.b) : sel.a;
  const end = sel.a && sel.b ? (sel.a < sel.b ? sel.b : sel.a) : sel.a; // inclusive last night
  const count = start && end ? nightsBetween(start, end) + 1 : 0;

  function click(d: string) {
    setMsg(undefined);
    if (!sel.a || sel.b) setSel({ a: d });
    else setSel({ a: sel.a, b: d });
  }

  async function apply(body: { status?: "BLOCKED" | "FREE"; pricePaise?: number | null }) {
    if (!start || !end) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await call<{ updated: string[]; conflicts: string[] }>(`/v1/listings/${listingId}/calendar`, { method: "PUT", body: { from: start, to: addDaysISO(end, 1), ...body } });
      setMsg(r.conflicts.length ? { tone: "warn", text: `Updated ${plural(r.updated.length, "night")}. ${plural(r.conflicts.length, "night")} already booked or held were left alone.` } : { tone: "ok", text: `Updated ${plural(r.updated.length, "night")}.` });
      setSel({});
      setPrice("");
      await load();
    } catch (x) {
      setMsg({ tone: "bad", text: errorMessage(x) });
    } finally {
      setBusy(false);
    }
  }

  const prevDisabled = month <= new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const rupees = Number(price);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <button type="button" aria-label="Previous month" disabled={prevDisabled} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-9 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-30"><ChevronLeft className="size-5" /></button>
          <h2 className="flex items-center gap-2 text-lg font-semibold">{formatMonth(month)} {loading && <Spinner className="size-4" />}</h2>
          <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-9 place-items-center rounded-full hover:bg-surface-2"><ChevronRight className="size-5" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
          {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
        </div>
        <div className="mt-1 grid gap-1">
          {weeks.map((w, i) => (
            <div key={i} className="grid grid-cols-7 gap-1">
              {w.map((c) => {
                if (!c.inMonth) return <div key={c.date} />;
                const n = nights[c.date];
                const status = n?.status ?? "FREE";
                const past = c.date < today;
                const inSel = !!start && !!end && c.date >= start && c.date <= end;
                const custom = n && n.pricePaise !== basePricePaise;
                return (
                  <button
                    key={c.date}
                    type="button"
                    disabled={past}
                    onClick={() => click(c.date)}
                    aria-pressed={inSel}
                    aria-label={`${formatDate(c.date)}: ${status.toLowerCase()}, ${formatINR(n?.pricePaise ?? basePricePaise)}`}
                    className={clsx("flex h-12 min-w-0 flex-col justify-between rounded-lg border p-1.5 text-left transition sm:aspect-square sm:h-auto sm:min-h-14 sm:p-2", past ? "border-transparent opacity-35" : "border-line", STYLE[status], inSel && "!border-fg ring-2 ring-fg")}
                  >
                    <span className={clsx("text-sm font-semibold", c.date === today && "underline underline-offset-4")}>{c.day}</span>
                    <span className={clsx("hidden truncate text-[11px] sm:block", custom ? "font-bold text-fg" : "text-muted")}>
                      {status === "BOOKED" ? "Booked" : status === "HELD" ? "On hold" : formatINR(n?.pricePaise ?? basePricePaise)}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><i className="size-3 rounded border border-line bg-surface" /> Open</span>
          <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-ok-soft" /> Booked</span>
          <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-warn-soft" /> Held for payment</span>
          <span className="flex items-center gap-1.5"><i className={clsx("size-3 rounded", STYLE.BLOCKED)} /> Blocked</span>
          <span className="flex items-center gap-1.5"><b className="text-fg">Bold</b> custom price</span>
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-24">
        {!start ? (
          <p className="text-[15px] text-muted">Click a night, then another, to select a range. Booked and held nights are never changed.</p>
        ) : (
          <>
            <div>
              <div className="text-sm text-muted">{plural(count, "night")} selected</div>
              <div className="font-semibold">{formatDate(start)}{end !== start && ` – ${formatDate(end!)}`}</div>
              {!sel.b && <p className="mt-1 text-xs text-muted">Click another night to extend the range.</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={() => apply({ status: "BLOCKED" })} loading={busy}>Block</Button>
              <Button variant="outline" size="sm" onClick={() => apply({ status: "FREE" })} disabled={busy}>Open</Button>
            </div>
            <div className="border-t border-line pt-4">
              <label htmlFor="np" className="text-sm font-medium">Nightly price for these dates</label>
              <div className="mt-1.5 flex gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
                  <Input id="np" inputMode="numeric" className="h-9 pl-7" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder={String(basePricePaise / 100)} />
                </div>
                <Button size="sm" onClick={() => apply({ pricePaise: rupees * 100 })} disabled={busy || rupees < 100}>Set</Button>
              </div>
              <button type="button" className="mt-2 text-sm font-medium underline disabled:opacity-40" disabled={busy} onClick={() => apply({ pricePaise: null })}>Reset to base price ({formatINR(basePricePaise)})</button>
            </div>
            <button type="button" className="text-sm text-muted hover:text-fg" onClick={() => setSel({})}>Clear selection</button>
          </>
        )}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </aside>
    </div>
  );
}
