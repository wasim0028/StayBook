"use client";

import clsx from "clsx";
import { Check, Minus, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Alert, Button, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { AMENITY_META, POLICY_COPY, PROPERTY_LABEL } from "@/lib/amenities";
import { call, ClientApiError, errorMessage, fieldErrors } from "@/lib/client-api";
import { DESTINATIONS } from "@/lib/destinations";
import type { CancellationPolicy, Listing, PropertyType } from "@/lib/types";

const LocationPicker = dynamic(() => import("./LocationPickerInner"), { ssr: false, loading: () => <Skeleton className="size-full rounded-none" /> });

type Values = {
  title: string;
  description: string;
  propertyType: PropertyType;
  city: string;
  lat: number;
  lng: number;
  priceRupees: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  amenities: string[];
  cancellationPolicy: CancellationPolicy;
  cleaningRupees: string;
  weeklyPct: string;
  monthlyPct: string;
  minNights: number;
  maxNights: number;
  guestsIncluded: number;
  extraGuestRupees: string;
  instantBook: boolean;
};

function Counter({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} className="grid size-9 place-items-center rounded-full border border-line hover:border-fg disabled:opacity-30">
          <Minus className="size-4" />
        </button>
        <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} className="grid size-9 place-items-center rounded-full border border-line hover:border-fg disabled:opacity-30">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Money({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">₹</span>
      <Input id={id} inputMode="numeric" className="pl-8" placeholder="0" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
    </div>
  );
}

function Pct({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Input id={id} inputMode="numeric" className="pr-9" placeholder="0" maxLength={2} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">%</span>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Create (no `listing`) or edit (PATCH with optimistic version) a listing. */
export function ListingForm({ listing, onSaved }: { listing?: Listing; onSaved: (l: Listing) => void }) {
  const goa = DESTINATIONS[0]!;
  const [v, setV] = useState<Values>(() => ({
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    propertyType: listing?.propertyType ?? "apartment",
    city: listing?.city ?? "",
    lat: listing?.lat ?? goa.lat,
    lng: listing?.lng ?? goa.lng,
    priceRupees: listing ? String(Math.round(listing.basePricePaise / 100)) : "",
    maxGuests: listing?.maxGuests ?? 2,
    bedrooms: listing?.bedrooms ?? 1,
    beds: listing?.beds ?? 1,
    bathrooms: listing?.bathrooms ?? 1,
    amenities: listing?.amenities ?? ["wifi"],
    cancellationPolicy: listing?.cancellationPolicy ?? "MODERATE",
    cleaningRupees: listing?.cleaningFeePaise ? String(listing.cleaningFeePaise / 100) : "",
    weeklyPct: listing?.weeklyDiscountPct ? String(listing.weeklyDiscountPct) : "",
    monthlyPct: listing?.monthlyDiscountPct ? String(listing.monthlyDiscountPct) : "",
    minNights: listing?.minNights ?? 1,
    maxNights: listing?.maxNights ?? 90,
    guestsIncluded: listing?.guestsIncluded ?? listing?.maxGuests ?? 2,
    extraGuestRupees: listing?.extraGuestFeePaise ? String(listing.extraGuestFeePaise / 100) : "",
    instantBook: listing?.instantBook ?? true,
  }));
  const [recenter, setRecenter] = useState(0);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const up = <K extends keyof Values>(k: K, val: Values[K]) => { setV((x) => ({ ...x, [k]: val })); setSaved(false); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (v.title.trim().length < 5) local.title = "At least 5 characters";
    if (v.description.trim().length < 20) local.description = "At least 20 characters";
    if (v.city.trim().length < 2) local.city = "Required";
    const rupees = Number(v.priceRupees);
    if (!Number.isInteger(rupees) || rupees < 100) local.basePricePaise = "Whole rupees, ₹100 or more";
    const weekly = Number(v.weeklyPct || 0);
    const monthly = Number(v.monthlyPct || 0);
    if (weekly > 90) local.weeklyDiscountPct = "At most 90%";
    if (monthly > 90) local.monthlyDiscountPct = "At most 90%";
    if (monthly > 0 && monthly < weekly) local.monthlyDiscountPct = "Should be at least the weekly discount";
    if (v.minNights > v.maxNights) local.minNights = "Can't be more than the maximum";
    if (v.guestsIncluded > v.maxGuests) local.guestsIncluded = "Can't be more than the guest limit";
    setErrs(local);
    if (Object.keys(local).length) return setErr("Please fix the highlighted fields.");

    const body = {
      title: v.title.trim(),
      description: v.description.trim(),
      propertyType: v.propertyType,
      city: v.city.trim(),
      lat: v.lat,
      lng: v.lng,
      basePricePaise: rupees * 100,
      maxGuests: v.maxGuests,
      bedrooms: v.bedrooms,
      beds: v.beds,
      bathrooms: v.bathrooms,
      amenities: v.amenities,
      cancellationPolicy: v.cancellationPolicy,
      cleaningFeePaise: Number(v.cleaningRupees || 0) * 100,
      weeklyDiscountPct: weekly,
      monthlyDiscountPct: monthly,
      minNights: v.minNights,
      maxNights: v.maxNights,
      guestsIncluded: Math.min(v.guestsIncluded, v.maxGuests),
      extraGuestFeePaise: Number(v.extraGuestRupees || 0) * 100,
      instantBook: v.instantBook,
    };
    setBusy(true);
    setErr(undefined);
    try {
      const l = listing
        ? await call<Listing>(`/v1/listings/${listing.id}`, { method: "PATCH", body: { ...body, version: listing.version } })
        : await call<Listing>("/v1/listings", { method: "POST", body });
      setSaved(true);
      onSaved(l);
    } catch (x) {
      setErrs(fieldErrors(x));
      setErr(x instanceof ClientApiError && x.code === "VERSION_CONFLICT" ? "This listing was changed in another tab. Reload the page to get the latest version." : errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Panel title="The basics">
        <div className="space-y-4">
          <Field label="Title" htmlFor="title" hint={`${v.title.length}/100 · Short and specific works best, e.g. “Sea-view studio near Anjuna beach”.`} error={errs.title}>
            <Input id="title" maxLength={100} value={v.title} onChange={(e) => up("title", e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="description" error={errs.description}>
            <Textarea id="description" className="min-h-40" maxLength={5000} value={v.description} onChange={(e) => up("description", e.target.value)} placeholder="What makes your place special? Mention the neighbourhood, the view, how guests get in…" />
          </Field>
          <Field label="Property type" htmlFor="propertyType">
            <Select id="propertyType" value={v.propertyType} onChange={(e) => up("propertyType", e.target.value as PropertyType)}>
              {Object.entries(PROPERTY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        </div>
      </Panel>

      <Panel title="Location" sub="Guests only see the approximate area until they book. Click the map or drag the pin to your exact spot.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City or town" htmlFor="city" error={errs.city}>
            <Input id="city" maxLength={80} value={v.city} onChange={(e) => up("city", e.target.value)} />
          </Field>
          <Field label="Jump the map to" htmlFor="jump">
            <Select id="jump" defaultValue="" onChange={(e) => { const d = DESTINATIONS.find((x) => x.slug === e.target.value); if (d) { setV((x) => ({ ...x, lat: d.lat, lng: d.lng, city: x.city || d.name })); setRecenter((n) => n + 1); } }}>
              <option value="" disabled>Choose a region…</option>
              {DESTINATIONS.map((d) => <option key={d.slug} value={d.slug}>{d.name}, {d.state}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-4 h-80 overflow-hidden rounded-xl border border-line">
          <LocationPicker lat={v.lat} lng={v.lng} recenter={recenter} onChange={(lat, lng) => setV((x) => ({ ...x, lat, lng }))} />
        </div>
        <p className="mt-2 text-xs text-muted tabular-nums">Pin: {v.lat.toFixed(5)}, {v.lng.toFixed(5)}</p>
      </Panel>

      <Panel title="Rooms and guests">
        <div className="divide-y divide-line">
          <Counter label="Guests" value={v.maxGuests} min={1} max={50} onChange={(n) => up("maxGuests", n)} />
          <Counter label="Bedrooms" value={v.bedrooms} min={0} max={50} onChange={(n) => up("bedrooms", n)} />
          <Counter label="Beds" value={v.beds} min={1} max={100} onChange={(n) => up("beds", n)} />
          <Counter label="Bathrooms" value={v.bathrooms} min={0} max={50} step={0.5} onChange={(n) => up("bathrooms", n)} />
        </div>
      </Panel>

      <Panel title="Amenities">
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(AMENITY_META).map(([k, { label, icon: Icon }]) => {
            const on = v.amenities.includes(k);
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => up("amenities", on ? v.amenities.filter((a) => a !== k) : [...v.amenities, k])} className={clsx("flex items-center gap-3 rounded-xl border p-3.5 text-left transition", on ? "border-fg bg-surface-2" : "border-line hover:border-muted")}>
                <Icon className="size-5" /> <span className="flex-1 text-sm font-medium">{label}</span>
                {on && <Check className="size-4" />}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="How guests book" sub="Instant Book listings get more bookings: guests can confirm without waiting.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { on: true, title: "Instant Book", body: "Guests who meet your rules book straight away." },
            { on: false, title: "Approve every request", body: "Guests send a request; you have 24 hours to accept or decline." },
          ].map((o) => (
            <button key={o.title} type="button" aria-pressed={v.instantBook === o.on} onClick={() => up("instantBook", o.on)} className={clsx("rounded-xl border p-4 text-left transition", v.instantBook === o.on ? "border-fg bg-surface-2 ring-1 ring-fg" : "border-line hover:border-muted")}>
              <div className="font-semibold">{o.title}</div>
              <p className="mt-1 text-sm text-muted">{o.body}</p>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Pricing, stay rules and cancellation">
        <Field label="Nightly price" htmlFor="price" hint="You can set different prices for specific dates in the calendar. A 12% platform fee is deducted from your payout." error={errs.basePricePaise}>
          <div className="relative max-w-xs">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">₹</span>
            <Input id="price" inputMode="numeric" className="pl-8" value={v.priceRupees} onChange={(e) => up("priceRupees", e.target.value.replace(/\D/g, ""))} />
          </div>
        </Field>
        {Number(v.priceRupees) >= 100 && (
          <p className="mt-2 text-sm text-muted">You earn about <span className="font-semibold text-fg">₹{Math.floor(Number(v.priceRupees) * 0.88).toLocaleString("en-IN")}</span> per night. Guests also pay GST on top (5% up to ₹7,500 a night, 18% above).</p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Cleaning fee (per stay)" htmlFor="clean" hint="Charged once, refunded if a stay is cancelled before check-in.">
            <Money id="clean" value={v.cleaningRupees} onChange={(x) => up("cleaningRupees", x)} />
          </Field>
          <Field label="Extra guest fee (per guest, per night)" htmlFor="extra" hint={`Applies above ${v.guestsIncluded} guest${v.guestsIncluded === 1 ? "" : "s"}.`}>
            <Money id="extra" value={v.extraGuestRupees} onChange={(x) => up("extraGuestRupees", x)} />
          </Field>
          <Field label="Weekly discount" htmlFor="wk" hint="For stays of 7 nights or more." error={errs.weeklyDiscountPct}>
            <Pct id="wk" value={v.weeklyPct} onChange={(x) => up("weeklyPct", x)} />
          </Field>
          <Field label="Monthly discount" htmlFor="mo" hint="For stays of 28 nights or more." error={errs.monthlyDiscountPct}>
            <Pct id="mo" value={v.monthlyPct} onChange={(x) => up("monthlyPct", x)} />
          </Field>
        </div>
        <div className="mt-4 divide-y divide-line rounded-xl border border-line px-4">
          <Counter label="Guests included in price" value={v.guestsIncluded} min={1} max={v.maxGuests} onChange={(n) => up("guestsIncluded", n)} />
          <Counter label="Minimum nights" value={v.minNights} min={1} max={365} onChange={(n) => up("minNights", n)} />
          <Counter label="Maximum nights" value={v.maxNights} min={1} max={365} onChange={(n) => up("maxNights", n)} />
        </div>
        {(errs.minNights || errs.guestsIncluded) && <p className="mt-2 text-sm text-bad">{errs.minNights ?? errs.guestsIncluded}</p>}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {(Object.keys(POLICY_COPY) as CancellationPolicy[]).map((k) => {
            const p = POLICY_COPY[k]!;
            const on = v.cancellationPolicy === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => up("cancellationPolicy", k)} className={clsx("rounded-xl border p-4 text-left transition", on ? "border-fg bg-surface-2 ring-1 ring-fg" : "border-line hover:border-muted")}>
                <div className="font-semibold">{p.name}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{p.summary}</p>
              </button>
            );
          })}
        </div>
      </Panel>

      {err && <Alert tone="bad">{err}</Alert>}
      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-line bg-bg/90 px-1 py-4 backdrop-blur">
        <Button type="submit" size="lg" loading={busy}>{listing ? "Save changes" : "Create draft"}</Button>
        {saved && listing && <span className="text-sm font-medium text-ok">Saved</span>}
      </div>
    </form>
  );
}
