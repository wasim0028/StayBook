"use client";

import clsx from "clsx";
import { List, Map as MapIcon, SearchX, SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ListingCard } from "@/components/ListingCard";
import { Alert, EmptyState, Skeleton } from "@/components/ui";
import { PROPERTY_LABEL } from "@/lib/amenities";
import { activeFilterCount, FiltersModal, type Filters } from "./FiltersModal";
import { plural } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

const ResultsMap = dynamic(() => import("@/components/ResultsMap"), { ssr: false, loading: () => <Skeleton className="size-full rounded-none" /> });


export function SearchResults(props: {
  results: SearchResult[];
  truncated: boolean;
  error?: string;
  bbox: string;
  place: string;
  savedIds: string[];
  signedIn: boolean;
  listingQuery: string;
  filters: Filters & { type?: string };
  flexible: boolean;
  guests: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState<"list" | "map">("list");
  const [hovered, setHovered] = useState<string>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const nFilters = activeFilterCount(props.filters);

  function applyFilters(f: Filters) {
    const q = new URLSearchParams(params.toString());
    for (const k of ["priceMin", "priceMax", "minBedrooms", "minBeds", "minBathrooms", "amenities", "instant"] as const) {
      if (f[k]) q.set(k, f[k]!);
      else q.delete(k);
    }
    setFiltersOpen(false);
    router.push(`${pathname}?${q}`);
  }
  const saved = new Set(props.savedIds);

  function setParam(k: string, v: string | undefined) {
    const q = new URLSearchParams(params.toString());
    if (v) q.set(k, v);
    else q.delete(k);
    router.push(`${pathname}?${q}`);
  }

  function searchArea(bbox: string) {
    const q = new URLSearchParams(params.toString());
    q.set("bbox", bbox);
    q.delete("dest");
    router.push(`${pathname}?${q}`);
  }

  const types = props.filters.type?.split(",").filter(Boolean) ?? [];
  const toggleType = (t: string) => {
    const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
    setParam("type", next.join(",") || undefined);
  };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_42%]">
      <div className={clsx("px-4 pb-24 pt-5 sm:px-6", view === "map" && "hidden lg:block")}>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(PROPERTY_LABEL).map(([k, label]) => (
            <button
              key={k}
              onClick={() => toggleType(k)}
              aria-pressed={types.includes(k)}
              className={clsx("rounded-full border px-3.5 py-1.5 text-sm font-medium transition", types.includes(k) ? "border-fg bg-fg text-bg" : "border-line bg-surface hover:border-fg")}
            >
              {label}
            </button>
          ))}
          <button onClick={() => setFiltersOpen(true)} className={clsx("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold", nFilters ? "border-fg" : "border-line bg-surface hover:border-fg")}>
            <SlidersHorizontal className="size-4" /> Filters
            {nFilters > 0 && <span className="grid size-5 place-items-center rounded-full bg-fg text-[11px] text-bg">{nFilters}</span>}
          </button>
          <FiltersModal key={String(filtersOpen)} open={filtersOpen} onClose={() => setFiltersOpen(false)} initial={props.filters} onApply={applyFilters} />
        </div>

        <h1 className="mt-6 text-xl font-bold" aria-live="polite">
          {props.error ? "Search" : `${plural(props.results.length, "stay")}${props.truncated ? "+" : ""} in ${props.place}`}
          {props.flexible && !props.error && <span className="mt-1 block text-sm font-normal text-muted">Showing the first free dates at each place</span>}
        </h1>

        <div className="mt-4 space-y-3">
          {props.error === "zoom" && <Alert tone="info">That area is too large to search. Zoom in on the map and choose “Search this area”.</Alert>}
          {props.error === "invalid" && <Alert tone="warn">That search doesn&apos;t work. Check-in must be today or later, a stay can be up to 90 nights, and flexible months can&apos;t be in the past.</Alert>}
          {props.error === "down" && <Alert tone="bad">Search is unavailable right now. Please try again in a moment.</Alert>}
        </div>

        {!props.error && props.results.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={<SearchX className="size-6" />} title="No stays match" body="Try different dates, remove a filter, or move the map." />
          </div>
        ) : (
          <div className="mt-5 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
            {props.results.map((r) => (
              <div key={r.id} onMouseEnter={() => setHovered(r.id)} onMouseLeave={() => setHovered(undefined)}>
                <ListingCard l={r} saved={saved.has(r.id)} signedIn={props.signedIn} query={r.checkIn ? new URLSearchParams({ checkIn: r.checkIn, checkOut: r.checkOut!, guests: String(props.guests) }).toString() : props.listingQuery} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={clsx("sticky top-16 h-[calc(100dvh-4rem)]", view === "list" && "hidden lg:block")}>
        <ResultsMap results={props.results} bbox={props.bbox} hovered={hovered} onSearchArea={searchArea} listingQuery={props.listingQuery} />
      </div>

      <button
        onClick={() => setView(view === "list" ? "map" : "list")}
        className="fixed bottom-6 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-5 py-3 text-sm font-semibold text-bg shadow-card lg:hidden"
      >
        {view === "list" ? (
          <>
            Map <MapIcon className="size-4" />
          </>
        ) : (
          <>
            List <List className="size-4" />
          </>
        )}
      </button>
    </div>
  );
}
