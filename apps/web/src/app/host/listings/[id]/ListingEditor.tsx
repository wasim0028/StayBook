"use client";

import clsx from "clsx";
import { ArrowLeft, Check, Circle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { HostCalendar } from "@/components/host/HostCalendar";
import { ListingForm } from "@/components/host/ListingForm";
import { PhotoManager } from "@/components/host/PhotoManager";
import { Alert, Badge, Button } from "@/components/ui";
import { call, ClientApiError, errorMessage } from "@/lib/client-api";
import type { Listing } from "@/lib/types";

const MIN_PHOTOS = 3;
type Tab = "details" | "photos" | "calendar";

export function ListingEditor({ initial, payoutActive, initialTab }: { initial: Listing; payoutActive: boolean; initialTab: Tab }) {
  const [l, setL] = useState(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const checks = [
    { ok: true, label: "Details filled in" },
    { ok: l.photos.length >= MIN_PHOTOS, label: `At least ${MIN_PHOTOS} photos (${l.photos.length} added)`, fix: () => setTab("photos") },
    { ok: payoutActive, label: "Payout account verified", href: "/host/onboarding" },
  ];
  const ready = checks.every((c) => c.ok);

  function switchTab(t: Tab) {
    setTab(t);
    window.history.replaceState(null, "", `?tab=${t}`);
  }

  async function setPublished(publish: boolean) {
    setBusy(true);
    setErr(undefined);
    try {
      setL(await call<Listing>(`/v1/listings/${l.id}/${publish ? "publish" : "unpublish"}`, { method: "POST" }));
    } catch (x) {
      setErr(x instanceof ClientApiError && x.code === "PAYOUT_ACCOUNT_REQUIRED" ? "Your payout account isn't verified yet. You can publish as soon as Razorpay activates it." : errorMessage(x));
    } finally {
      setBusy(false);
    }
  }

  const tabs: { k: Tab; label: string }[] = [
    { k: "details", label: "Details" },
    { k: "photos", label: `Photos (${l.photos.length})` },
    { k: "calendar", label: "Calendar & pricing" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/host/listings" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg"><ArrowLeft className="size-4" /> Listings</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{l.title}</h1>
            <Badge tone={l.status === "PUBLISHED" ? "ok" : l.status === "SUSPENDED" ? "bad" : "neutral"}>{l.status === "PUBLISHED" ? "Listed" : l.status === "SUSPENDED" ? "Suspended" : "Draft"}</Badge>
          </div>
          <Link href={`/listing/${l.id}`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline">Preview <ExternalLink className="size-3.5" /></Link>
        </div>
        {l.status === "PUBLISHED" ? (
          <Button variant="outline" onClick={() => setPublished(false)} loading={busy}>Unlist</Button>
        ) : l.status === "DRAFT" ? (
          <Button onClick={() => setPublished(true)} loading={busy} disabled={!ready}>Publish</Button>
        ) : null}
      </div>

      {l.status === "SUSPENDED" && <div className="mt-4"><Alert tone="bad">Our team suspended this listing. Contact support to reinstate it.</Alert></div>}
      {err && <div className="mt-4"><Alert tone="bad">{err}</Alert></div>}

      {l.status === "DRAFT" && (
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold">{ready ? "Ready to publish" : "Before you can publish"}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                {c.ok ? <Check className="size-4 text-ok" /> : <Circle className="size-4 text-muted" />}
                {!c.ok && c.fix ? <button type="button" className="underline" onClick={c.fix}>{c.label}</button> : !c.ok && c.href ? <Link className="underline" href={c.href}>{c.label}</Link> : <span className={c.ok ? "" : "text-muted"}>{c.label}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div role="tablist" className="mt-8 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => switchTab(t.k)} className={clsx("-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition", tab === t.k ? "border-fg" : "border-transparent text-muted hover:text-fg")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "details" && <div className="max-w-3xl"><ListingForm listing={l} onSaved={setL} /></div>}
        {tab === "photos" && <PhotoManager listing={l} onChange={setL} minToPublish={MIN_PHOTOS} />}
        {tab === "calendar" && <HostCalendar listingId={l.id} basePricePaise={l.basePricePaise} />}
      </div>
    </div>
  );
}
