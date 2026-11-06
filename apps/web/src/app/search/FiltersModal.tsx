"use client";

import clsx from "clsx";
import { Minus, Plus, Zap } from "lucide-react";
import { useState } from "react";
import { Button, Input, Modal } from "@/components/ui";
import { AMENITY_META } from "@/lib/amenities";

export interface Filters {
  priceMin?: string;
  priceMax?: string;
  minBedrooms?: string;
  minBeds?: string;
  minBathrooms?: string;
  amenities?: string;
  instant?: string;
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span>{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(value - 1)} className="grid size-8 place-items-center rounded-full border border-line hover:border-fg disabled:opacity-30"><Minus className="size-4" /></button>
        <span className="w-10 text-center tabular-nums">{value ? `${value}+` : "Any"}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= 8} onClick={() => onChange(value + 1)} className="grid size-8 place-items-center rounded-full border border-line hover:border-fg disabled:opacity-30"><Plus className="size-4" /></button>
      </div>
    </div>
  );
}

export const activeFilterCount = (f: Filters) =>
  [f.priceMin, f.priceMax, f.minBedrooms, f.minBeds, f.minBathrooms, f.instant].filter(Boolean).length + (f.amenities?.split(",").filter(Boolean).length ?? 0);

/** Airbnb-style filters sheet: price, rooms and beds, amenities, Instant Book. */
export function FiltersModal({ open, onClose, initial, onApply }: { open: boolean; onClose: () => void; initial: Filters; onApply: (f: Filters) => void }) {
  const [f, setF] = useState<Filters>(initial);
  const n = (k: keyof Filters) => Number(f[k] ?? 0);
  const set = (k: keyof Filters, v: string | number | undefined) => setF((x) => ({ ...x, [k]: v ? String(v) : undefined }));
  const amen = f.amenities?.split(",").filter(Boolean) ?? [];
  const toggleAmen = (a: string) => set("amenities", (amen.includes(a) ? amen.filter((x) => x !== a) : [...amen, a]).join(","));

  return (
    <Modal open={open} onClose={onClose} title="Filters">
      <div className="-mx-5 max-h-[65vh] overflow-y-auto px-5">
        <section className="border-b border-line pb-6">
          <h3 className="font-semibold">Price per night</h3>
          <p className="text-sm text-muted">Includes fees and GST when you&apos;ve picked dates.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm text-muted">Minimum<div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2">₹</span><Input inputMode="numeric" className="pl-7" value={f.priceMin ?? ""} onChange={(e) => set("priceMin", e.target.value.replace(/\D/g, ""))} placeholder="Any" /></div></label>
            <label className="text-sm text-muted">Maximum<div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2">₹</span><Input inputMode="numeric" className="pl-7" value={f.priceMax ?? ""} onChange={(e) => set("priceMax", e.target.value.replace(/\D/g, ""))} placeholder="Any" /></div></label>
          </div>
        </section>

        <section className="border-b border-line py-6">
          <h3 className="font-semibold">Rooms and beds</h3>
          <div className="divide-y divide-line">
            <Stepper label="Bedrooms" value={n("minBedrooms")} onChange={(v) => set("minBedrooms", v)} />
            <Stepper label="Beds" value={n("minBeds")} onChange={(v) => set("minBeds", v)} />
            <Stepper label="Bathrooms" value={n("minBathrooms")} onChange={(v) => set("minBathrooms", v)} />
          </div>
        </section>

        <section className="border-b border-line py-6">
          <h3 className="font-semibold">Booking options</h3>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="flex items-center gap-1.5 font-medium"><Zap className="size-4" /> Instant Book</span>
              <span className="block text-sm text-muted">Book without waiting for the host to approve.</span>
            </span>
            <input type="checkbox" className="size-5 accent-[var(--fg)]" checked={f.instant === "1"} onChange={(e) => set("instant", e.target.checked ? "1" : undefined)} />
          </label>
        </section>

        <section className="py-6">
          <h3 className="font-semibold">Amenities</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {Object.entries(AMENITY_META).map(([k, { label, icon: Icon }]) => (
              <button key={k} type="button" aria-pressed={amen.includes(k)} onClick={() => toggleAmen(k)} className={clsx("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm", amen.includes(k) ? "border-fg bg-surface-2" : "border-line hover:border-muted")}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="-mx-5 -mb-5 flex items-center justify-between border-t border-line px-5 py-4">
        <button type="button" className="font-semibold underline" onClick={() => setF({})}>Clear all</button>
        <Button onClick={() => onApply(f)}>Show stays</Button>
      </div>
    </Modal>
  );
}
