"use client";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

const icon = L.divIcon({
  className: "price-pin",
  html: `<svg width="34" height="44" viewBox="0 0 34 44" style="transform:translate(-50%,-100%)"><path d="M17 0C7.6 0 0 7.5 0 16.8 0 29.4 17 44 17 44s17-14.6 17-27.2C34 7.5 26.4 0 17 0z" fill="#e5483a"/><circle cx="17" cy="16.5" r="6" fill="#fff"/></svg>`,
  iconSize: [0, 0],
});

function Clicks({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Recenter({ lat, lng, token }: { lat: number; lng: number; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (token) map.setView([lat, lng], 13);
    // only when the caller asks (e.g. picked a city), not on every pin move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return null;
}

export default function LocationPickerInner({ lat, lng, onChange, recenter }: { lat: number; lng: number; onChange: (lat: number, lng: number) => void; recenter: number }) {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return (
    <MapContainer center={[lat, lng]} zoom={13} scrollWheelZoom className="size-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker
        position={[lat, lng]}
        icon={icon}
        draggable
        eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); onChange(round(p.lat), round(p.lng)); } }}
      />
      <Clicks onPick={(a, b) => onChange(round(a), round(b))} />
      <Recenter lat={lat} lng={lng} token={recenter} />
    </MapContainer>
  );
}
