"use client";

import L from "leaflet";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { parseBbox } from "@/lib/destinations";
import { formatINR } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

/** Largest area the API accepts (~64 geohash-5 cells). Bigger viewports ask the user to zoom in. */
const MAX_SPAN_DEG = 0.3;

function pin(label: string, active: boolean) {
  return L.divIcon({
    className: "price-pin",
    html: `<span style="display:inline-block;transform:translate(-50%,-50%);white-space:nowrap;padding:4px 10px;border-radius:999px;font:600 13px system-ui;box-shadow:0 2px 8px rgb(0 0 0/.25);background:${active ? "#1c1917" : "#fff"};color:${active ? "#fff" : "#1c1917"};border:1px solid rgb(0 0 0/.08)">${label}</span>`,
    iconSize: [0, 0],
  });
}

function short(paise: number) {
  const r = paise / 100;
  if (r >= 100_000) return `₹${(r / 100_000).toFixed(1).replace(/\.0$/, "")}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₹${Math.round(r)}`;
}

function Watcher({ onMove }: { onMove: (b: L.LatLngBounds) => void }) {
  const map = useMapEvents({ moveend: () => onMove(map.getBounds()) });
  return null;
}

function FitOnce({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function ResultsMap({ results, bbox, hovered, onSearchArea, listingQuery }: { results: SearchResult[]; bbox: string; hovered?: string; onSearchArea: (bbox: string) => void; listingQuery: string }) {
  const b = parseBbox(bbox) ?? [15.43, 73.66, 15.68, 73.91];
  const bounds = useMemo(() => L.latLngBounds([b[0], b[1]], [b[2], b[3]]), [b[0], b[1], b[2], b[3]]); // eslint-disable-line react-hooks/exhaustive-deps
  const [moved, setMoved] = useState<L.LatLngBounds | null>(null);

  const tooBig = moved && (moved.getNorth() - moved.getSouth() > MAX_SPAN_DEG || moved.getEast() - moved.getWest() > MAX_SPAN_DEG);

  return (
    <div className="relative size-full">
      <MapContainer bounds={bounds} scrollWheelZoom className="size-full" zoomControl={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitOnce bounds={bounds} />
        <Watcher onMove={setMoved} />
        {results.map((r) => (
          <Marker key={r.id} position={[r.lat, r.lng]} icon={pin(short(r.totalPaise ?? r.pricePaise), hovered === r.id)} zIndexOffset={hovered === r.id ? 1000 : 0}>
            <Popup closeButton={false}>
              <a href={`/listing/${r.id}${listingQuery ? `?${listingQuery}` : ""}`} className="block w-56 text-[#1c1917] no-underline">
                {r.coverPhotoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.coverPhotoUrl} alt="" className="h-32 w-full object-cover" />
                )}
                <div className="p-3">
                  <div className="truncate font-semibold">{r.title}</div>
                  <div className="text-sm">
                    <b>{formatINR(r.totalPaise ?? r.pricePaise)}</b> {r.totalPaise ? "total" : "night"}
                  </div>
                </div>
              </a>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {moved && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-[1000] flex justify-center">
          {tooBig ? (
            <span className="rounded-full bg-surface px-4 py-2 text-sm font-semibold shadow-card">Zoom in to search this area</span>
          ) : (
            <button
              onClick={() => onSearchArea([moved.getSouth(), moved.getWest(), moved.getNorth(), moved.getEast()].map((n) => n.toFixed(5)).join(","))}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-card"
            >
              <Search className="size-4" /> Search this area
            </button>
          )}
        </div>
      )}
    </div>
  );
}
