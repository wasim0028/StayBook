import type { Metadata } from "next";
import { SearchBar } from "@/components/SearchBar";
import { api, ApiError, getSession } from "@/lib/api";
import { destinationBbox, DESTINATIONS, findDestination, parseBbox } from "@/lib/destinations";
import { savedIds } from "@/lib/saved";
import type { SearchResponse } from "@/lib/types";
import { SearchResults } from "./SearchResults";

type SP = {
  dest?: string;
  bbox?: string;
  place?: string;
  checkIn?: string;
  checkOut?: string;
  flex?: string;
  months?: string;
  guests?: string;
  type?: string;
  priceMin?: string;
  priceMax?: string;
  minBedrooms?: string;
  minBeds?: string;
  minBathrooms?: string;
  amenities?: string;
  instant?: string;
};

/** Search parameters passed straight through to search-svc (it validates them). */
const PASS = ["type", "priceMin", "priceMax", "minBedrooms", "minBeds", "minBathrooms", "amenities"] as const;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const name = sp.place?.split(",")[0] ?? findDestination(sp.dest)?.name;
  return { title: name ? `Stays in ${name}` : "Search stays" };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const customBbox = parseBbox(sp.bbox) ? sp.bbox! : undefined;
  const dest = findDestination(sp.dest) ?? (customBbox ? undefined : DESTINATIONS[0]!);
  const bbox = customBbox ?? destinationBbox(dest ?? DESTINATIONS[0]!);
  const guests = Math.max(1, Math.min(50, Number(sp.guests) || 1));

  const q = new URLSearchParams({ bbox, limit: "50" });
  if (sp.checkIn && sp.checkOut) {
    q.set("checkIn", sp.checkIn);
    q.set("checkOut", sp.checkOut);
  }
  const flex = sp.flex === "weekend" || sp.flex === "week" || sp.flex === "month" ? sp.flex : undefined;
  const months = flex ? sp.months?.split(",").filter((m) => /^\d{4}-\d{2}$/.test(m)).slice(0, 3) : undefined;
  if (flex && months?.length && !sp.checkIn) {
    q.set("flex", flex);
    q.set("months", months.join(","));
  }
  if (sp.guests) q.set("guests", String(guests));
  for (const k of PASS) if (sp[k]) q.set(k, sp[k]!);
  if (sp.instant === "1") q.set("instantBook", "true");

  let data: SearchResponse = { results: [], truncated: false, cellsQueried: 0, currency: "INR" };
  let error: string | undefined;
  try {
    data = await api<SearchResponse>(`/v1/search?${q}`, sp.checkIn || flex ? {} : { revalidate: 30 });
  } catch (e) {
    error = e instanceof ApiError && e.code === "AREA_TOO_LARGE" ? "zoom" : e instanceof ApiError && e.status === 400 ? "invalid" : "down";
  }
  const session = await getSession();
  const saved = await savedIds(!!session);

  const listingQuery = new URLSearchParams();
  if (sp.checkIn && sp.checkOut) {
    listingQuery.set("checkIn", sp.checkIn);
    listingQuery.set("checkOut", sp.checkOut);
  }
  if (sp.guests) listingQuery.set("guests", String(guests));

  return (
    <div>
      <div className="border-b border-line bg-bg px-4 py-4 sm:px-6">
        <SearchBar
          compact
          initial={{
            place: sp.place ?? (dest ? `${dest.name}, ${dest.state}` : "Map area"),
            bbox: customBbox,
            dest: customBbox ? undefined : dest?.slug,
            checkIn: sp.checkIn,
            checkOut: sp.checkOut,
            flex,
            months,
            guests,
          }}
        />
      </div>
      <SearchResults
        key={q.toString()}
        results={data.results}
        truncated={data.truncated}
        error={error}
        bbox={bbox}
        place={sp.place?.split(",")[0] ?? dest?.name ?? "this area"}
        savedIds={[...saved]}
        signedIn={!!session}
        listingQuery={listingQuery.toString()}
        filters={{ type: sp.type, priceMin: sp.priceMin, priceMax: sp.priceMax, minBedrooms: sp.minBedrooms, minBeds: sp.minBeds, minBathrooms: sp.minBathrooms, amenities: sp.amenities, instant: sp.instant }}
        flexible={!!(flex && months?.length && !sp.checkIn)}
        guests={guests}
      />
    </div>
  );
}
