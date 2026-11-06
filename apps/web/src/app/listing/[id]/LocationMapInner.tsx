"use client";

import { Circle, MapContainer, TileLayer } from "react-leaflet";

/** Approximate area only: a 600 m circle, so the exact address isn't revealed before booking. */
export default function LocationMapInner({ lat, lng }: { lat: number; lng: number }) {
  return (
    <MapContainer center={[lat, lng]} zoom={14} scrollWheelZoom={false} className="size-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Circle center={[lat, lng]} radius={600} pathOptions={{ color: "#e5483a", fillColor: "#e5483a", fillOpacity: 0.2 }} />
    </MapContainer>
  );
}
