"use client";

import { Minus, Plus } from "lucide-react";
import { plural } from "@/lib/format";

export function GuestsStepper({ value, onChange, max = 16 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <div className="font-medium">Guests</div>
        <div className="text-sm text-muted">{plural(value, "guest")}</div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Fewer guests" disabled={value <= 1} onClick={() => onChange(value - 1)} className="grid size-9 place-items-center rounded-full border border-line hover:border-fg disabled:opacity-30 disabled:hover:border-line">
          <Minus className="size-4" />
        </button>
        <span className="w-5 text-center font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button type="button" aria-label="More guests" disabled={value >= max} onClick={() => onChange(value + 1)} className="grid size-9 place-items-center rounded-full border border-line hover:border-fg disabled:opacity-30 disabled:hover:border-line">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
