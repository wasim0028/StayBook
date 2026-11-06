"use client";

import clsx from "clsx";
import { CalendarDays, MapPin, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Range } from "@/lib/calendar";
import { call } from "@/lib/client-api";
import { DESTINATIONS, destinationBbox } from "@/lib/destinations";
import { formatRange, plural } from "@/lib/format";
import { DateRangePicker } from "./DateRangePicker";
import { GuestsStepper } from "./GuestsPicker";
import { useDismiss } from "./useDismiss";

export type FlexKind = "weekend" | "week" | "month";

export interface SearchState {
  /** Shown in the box, e.g. "Anjuna, Goa". */
  place: string;
  bbox?: string;
  dest?: string;
  checkIn?: string;
  checkOut?: string;
  flex?: FlexKind;
  months?: string[];
  guests: number;
}

interface Place {
  name: string;
  state: string;
  bbox: string;
}

const FLEX_LABEL: Record<FlexKind, string> = { weekend: "A weekend", week: "A week", month: "A month" };

/** The next 6 months as YYYY-MM, in India time. */
function nextMonths(n = 6): { key: string; label: string }[] {
  const now = new Date(Date.now() + 330 * 60_000);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }) };
  });
}

export function whenLabel(s: Pick<SearchState, "checkIn" | "checkOut" | "flex" | "months">): string {
  if (s.flex && s.months?.length) {
    const m = s.months.map((k) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }));
    return `${FLEX_LABEL[s.flex]} in ${m.join(", ")}`;
  }
  return formatRange(s.checkIn, s.checkOut);
}

export function SearchBar({ initial, compact = false }: { initial?: Partial<SearchState>; compact?: boolean }) {
  const router = useRouter();
  const fallback = DESTINATIONS[0]!;
  const [place, setPlace] = useState(initial?.place ?? `${fallback.name}, ${fallback.state}`);
  const [bbox, setBbox] = useState<string | undefined>(initial?.bbox ?? (initial?.dest ? undefined : destinationBbox(fallback)));
  const [dest, setDest] = useState<string | undefined>(initial?.dest);
  const [range, setRange] = useState<Range>({ from: initial?.checkIn, to: initial?.checkOut });
  const [mode, setMode] = useState<"dates" | "flex">(initial?.flex ? "flex" : "dates");
  const [flex, setFlex] = useState<FlexKind>(initial?.flex ?? "weekend");
  const [months, setMonths] = useState<string[]>(initial?.months ?? [nextMonths(1)[0]!.key]);
  const [guests, setGuests] = useState(initial?.guests ?? 2);
  const [open, setOpen] = useState<"where" | "dates" | "guests" | null>(null);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLFormElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useDismiss(root, open !== null, close);

  // Suggestions: popular destinations for an empty box, place-name lookup as the user types.
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    if (open !== "where") return;
    const q = place.trim();
    if (!typed || q.length < 2) {
      setSuggestions(DESTINATIONS.slice(0, 8).map((d) => ({ name: d.name, state: d.state, bbox: destinationBbox(d) })));
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      call<{ items: Place[] }>(`/v1/places?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => {
          setSuggestions(r.items);
          setActive(0);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [place, open, typed]);

  function choose(p: Place) {
    setPlace(`${p.name}, ${p.state}`);
    setBbox(p.bbox);
    setDest(undefined);
    setTyped(false);
    setOpen("dates");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (open === "where" && typed && suggestions[active]) return choose(suggestions[active]!);
    const q = new URLSearchParams({ guests: String(guests) });
    if (dest && !bbox) q.set("dest", dest);
    else if (bbox) q.set("bbox", bbox);
    q.set("place", place);
    if (mode === "flex" && months.length) {
      q.set("flex", flex);
      q.set("months", months.join(","));
    } else if (range.from && range.to) {
      q.set("checkIn", range.from);
      q.set("checkOut", range.to);
    }
    router.push(`/search?${q}`);
    setOpen(null);
  }

  const cell = "flex flex-1 items-center gap-3 px-4 text-left";
  const monthOpts = nextMonths(6);
  return (
    <form
      ref={root}
      onSubmit={submit}
      role="search"
      className={clsx("relative mx-auto flex w-full flex-col rounded-3xl border border-line bg-surface shadow-card md:flex-row md:items-stretch md:rounded-full", compact ? "max-w-3xl md:h-14" : "max-w-4xl md:h-[4.5rem]")}
    >
      <label className={clsx(cell, "min-h-14 rounded-t-3xl md:rounded-l-full md:rounded-tr-none hover:bg-surface-2")}>
        <MapPin className="size-5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">Where</span>
          <input
            value={place}
            onFocus={(e) => {
              setOpen("where");
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setPlace(e.target.value);
              setTyped(true);
              setOpen("where");
            }}
            onKeyDown={(e) => {
              if (open !== "where") return;
              if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, suggestions.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            }}
            placeholder="Search destinations"
            role="combobox"
            aria-expanded={open === "where"}
            aria-controls="place-list"
            aria-autocomplete="list"
            aria-label="Where"
            className="w-full truncate bg-transparent text-[15px] text-fg outline-none placeholder:text-muted focus-visible:outline-none"
          />
        </span>
      </label>
      <span className="mx-3 h-px bg-line md:mx-0 md:my-3 md:h-auto md:w-px" aria-hidden />

      <button type="button" onClick={() => setOpen(open === "dates" ? null : "dates")} aria-expanded={open === "dates"} className={clsx(cell, "min-h-14 hover:bg-surface-2")}>
        <CalendarDays className="size-5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0">
          <span className="block text-xs font-semibold">When</span>
          <span className={clsx("block truncate text-[15px]", range.from || mode === "flex" ? "text-fg" : "text-muted")}>
            {mode === "flex" ? whenLabel({ flex, months }) : range.from && !range.to ? "Pick check-out" : formatRange(range.from, range.to)}
          </span>
        </span>
      </button>
      <span className="mx-3 h-px bg-line md:mx-0 md:my-3 md:h-auto md:w-px" aria-hidden />

      <button type="button" onClick={() => setOpen(open === "guests" ? null : "guests")} aria-expanded={open === "guests"} className={clsx(cell, "min-h-14 hover:bg-surface-2")}>
        <Users className="size-5 shrink-0 text-brand" aria-hidden />
        <span>
          <span className="block text-xs font-semibold">Who</span>
          <span className="block text-[15px] text-fg">{plural(guests, "guest")}</span>
        </span>
      </button>

      <div className="p-2">
        <button type="submit" className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-6 font-semibold text-brand-fg transition-colors hover:bg-brand-hover md:h-full md:rounded-full">
          <Search className="size-5" aria-hidden />
          <span className={compact ? "md:sr-only" : ""}>Search</span>
        </button>
      </div>

      {open === "where" && suggestions.length > 0 && (
        <ul id="place-list" role="listbox" className="absolute left-0 top-full z-30 mt-3 w-full overflow-hidden rounded-3xl border border-line bg-surface py-3 shadow-card md:w-96">
          {!typed && <li className="px-5 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Popular destinations</li>}
          {suggestions.map((s, i) => (
            <li key={`${s.name}|${s.state}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(s)} className={clsx("flex w-full items-center gap-3 px-5 py-2.5 text-left", i === active && "bg-surface-2")}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2"><MapPin className="size-5" /></span>
                <span>
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-sm text-muted">{s.state}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="px-5 pt-2 text-[11px] text-muted">Place data © GeoNames</li>
        </ul>
      )}

      {open === "dates" && (
        <div className="absolute left-0 right-0 top-full z-30 mt-3 rounded-3xl border border-line bg-surface p-6 shadow-card md:left-1/2 md:right-auto md:w-max md:-translate-x-1/2">
          <div className="mx-auto mb-5 flex w-max rounded-full bg-surface-2 p-1" role="tablist">
            {(["dates", "flex"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={clsx("rounded-full px-5 py-1.5 text-sm font-semibold", mode === m ? "bg-surface shadow-sm" : "text-muted")}>
                {m === "dates" ? "Dates" : "Flexible"}
              </button>
            ))}
          </div>
          {mode === "dates" ? (
            <>
              <DateRangePicker value={range} onChange={(r) => { setRange(r); if (r.from && r.to) setOpen(null); }} />
              {range.from && (
                <button type="button" onClick={() => setRange({})} className="mt-3 text-sm font-medium underline">
                  Clear dates
                </button>
              )}
            </>
          ) : (
            <div className="w-[min(86vw,32rem)]">
              <p className="text-center font-semibold">How long would you like to stay?</p>
              <div className="mt-3 flex justify-center gap-2">
                {(Object.keys(FLEX_LABEL) as FlexKind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={flex === k} onClick={() => setFlex(k)} className={clsx("rounded-full border px-4 py-2 text-sm font-semibold", flex === k ? "border-fg bg-fg text-bg" : "border-line hover:border-fg")}>
                    {k === "weekend" ? "Weekend" : k === "week" ? "Week" : "Month"}
                  </button>
                ))}
              </div>
              <p className="mt-6 text-center font-semibold">When? <span className="font-normal text-muted">(up to 3 months)</span></p>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {monthOpts.map((m) => {
                  const on = months.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setMonths((cur) => (on ? (cur.length > 1 ? cur.filter((x) => x !== m.key) : cur) : cur.length >= 3 ? cur : [...cur, m.key].sort()))}
                      className={clsx("flex h-20 flex-col items-center justify-center rounded-2xl border text-sm font-semibold", on ? "border-fg bg-surface-2 ring-1 ring-fg" : "border-line hover:border-fg")}
                    >
                      <CalendarDays className="mb-1 size-5" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-center text-sm text-muted">We&apos;ll find {flex === "weekend" ? "a free Friday–Sunday" : flex === "week" ? "7 free nights" : "28 free nights"} at each place.</p>
            </div>
          )}
        </div>
      )}
      {open === "guests" && (
        <div className="absolute right-0 top-full z-30 mt-3 w-full rounded-3xl border border-line bg-surface p-6 shadow-card md:w-80">
          <GuestsStepper value={guests} onChange={setGuests} />
        </div>
      )}
    </form>
  );
}
