"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { buildMonth, pickDate, type Availability, type Range } from "@/lib/calendar";
import { formatDateLong, formatMonth, todayISO } from "@/lib/format";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

interface Props {
  value: Range;
  onChange: (r: Range) => void;
  availability?: Availability;
  /** Called when the visible months change, so the caller can load availability for them. */
  onMonthsChange?: (firstOfMonth: Date, monthsShown: number) => void;
  minDate?: string;
  className?: string;
}

function Month({ year, month, value, hover, setHover, onPick, availability, minDate }: { year: number; month: number; value: Range; hover?: string; setHover: (d?: string) => void; onPick: (d: string) => void; availability?: Availability; minDate: string }) {
  const weeks = useMemo(() => buildMonth(year, month), [year, month]);
  const end = value.to ?? (value.from && hover && hover > value.from ? hover : undefined);
  return (
    <div className="w-full min-w-[17rem]">
      <div className="mb-2 text-center text-[15px] font-semibold">{formatMonth(new Date(year, month, 1))}</div>
      <div className="grid grid-cols-7 text-center text-xs font-medium text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>
      <div role="grid" aria-label={formatMonth(new Date(year, month, 1))}>
        {weeks.map((week, wi) => (
          <div role="row" key={wi} className="grid grid-cols-7">
            {week.map((c) => {
              if (!c.inMonth) return <div key={c.date} role="gridcell" />;
              const past = c.date < minDate;
              const a = availability?.[c.date];
              // A taken night can't start a stay; it can still be a check-out day, which pickDate allows.
              const blockedStart = a && !a.available;
              const isStart = c.date === value.from;
              const isEnd = c.date === value.to;
              const inRange = !!(value.from && end && c.date > value.from && c.date < end);
              const disabled = past || (!value.from || value.to ? blockedStart : false);
              return (
                <div key={c.date} role="gridcell" className={clsx("relative h-11", (inRange || (isStart && end) || isEnd) && "bg-brand-soft", isStart && end && "rounded-l-full", isEnd && "rounded-r-full", isStart && !end && "rounded-full")}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${formatDateLong(c.date)}${a && !a.available ? ", unavailable" : ""}`}
                    aria-pressed={isStart || isEnd}
                    onClick={() => onPick(c.date)}
                    onMouseEnter={() => setHover(c.date)}
                    onMouseLeave={() => setHover(undefined)}
                    className={clsx(
                      "mx-auto grid size-11 place-items-center rounded-full text-sm transition-colors",
                      (isStart || isEnd) && "bg-fg font-semibold text-bg",
                      !(isStart || isEnd) && !disabled && "hover:ring-1 hover:ring-fg",
                      disabled && "cursor-not-allowed text-muted/40",
                      blockedStart && !past && "line-through",
                    )}
                  >
                    {c.day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DateRangePicker({ value, onChange, availability, onMonthsChange, minDate, className }: Props) {
  const min = minDate ?? todayISO();
  const [anchor, setAnchor] = useState(() => {
    const d = value.from ? new Date(value.from + "T00:00:00") : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [hover, setHover] = useState<string>();

  const move = (delta: number) => {
    const next = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
    setAnchor(next);
    onMonthsChange?.(next, 2);
  };
  const thisMonth = new Date();
  const atStart = anchor.getFullYear() === thisMonth.getFullYear() && anchor.getMonth() === thisMonth.getMonth();
  const second = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);

  return (
    <div className={clsx("relative", className)}>
      <button type="button" onClick={() => move(-1)} disabled={atStart} aria-label="Previous month" className="absolute left-0 top-0 z-10 grid size-8 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-30">
        <ChevronLeft className="size-5" />
      </button>
      <button type="button" onClick={() => move(1)} aria-label="Next month" className="absolute right-0 top-0 z-10 grid size-8 place-items-center rounded-full hover:bg-surface-2">
        <ChevronRight className="size-5" />
      </button>
      <div className="flex gap-8">
        <Month year={anchor.getFullYear()} month={anchor.getMonth()} value={value} hover={hover} setHover={setHover} onPick={(d) => onChange(pickDate(value, d, availability))} availability={availability} minDate={min} />
        <div className="hidden md:block">
          <Month year={second.getFullYear()} month={second.getMonth()} value={value} hover={hover} setHover={setHover} onPick={(d) => onChange(pickDate(value, d, availability))} availability={availability} minDate={min} />
        </div>
      </div>
    </div>
  );
}
