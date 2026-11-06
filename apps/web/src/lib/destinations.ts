export interface Destination {
  slug: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  tagline: string;
  /** Tailwind gradient classes for the tile (no photos shipped with the app). */
  gradient: string;
}

/**
 * Search is bounded to ~64 geohash cells (about 0.25 degrees square), so each destination is one such window.
 * Free-text place search needs a geocoder; add one (e.g. Amazon Location Service) when you want it.
 */
export const DESTINATIONS: Destination[] = [
  { slug: "goa", name: "Goa", state: "Goa", lat: 15.55, lng: 73.78, tagline: "Beaches and susegad", gradient: "from-amber-300 via-orange-400 to-rose-500" },
  { slug: "mumbai", name: "Mumbai", state: "Maharashtra", lat: 19.07, lng: 72.87, tagline: "City by the sea", gradient: "from-sky-400 via-indigo-500 to-violet-600" },
  { slug: "bengaluru", name: "Bengaluru", state: "Karnataka", lat: 12.97, lng: 77.59, tagline: "Garden city getaways", gradient: "from-emerald-300 via-teal-500 to-cyan-600" },
  { slug: "delhi", name: "Delhi", state: "Delhi", lat: 28.61, lng: 77.21, tagline: "History at every turn", gradient: "from-orange-300 via-red-400 to-pink-600" },
  { slug: "jaipur", name: "Jaipur", state: "Rajasthan", lat: 26.91, lng: 75.79, tagline: "Palaces and havelis", gradient: "from-pink-300 via-rose-400 to-orange-500" },
  { slug: "udaipur", name: "Udaipur", state: "Rajasthan", lat: 24.58, lng: 73.69, tagline: "City of lakes", gradient: "from-cyan-300 via-sky-500 to-blue-700" },
  { slug: "manali", name: "Manali", state: "Himachal Pradesh", lat: 32.24, lng: 77.19, tagline: "Snow and pine", gradient: "from-slate-300 via-sky-400 to-blue-600" },
  { slug: "rishikesh", name: "Rishikesh", state: "Uttarakhand", lat: 30.09, lng: 78.27, tagline: "Yoga by the Ganga", gradient: "from-lime-300 via-green-500 to-emerald-700" },
  { slug: "kochi", name: "Kochi", state: "Kerala", lat: 9.97, lng: 76.28, tagline: "Backwaters nearby", gradient: "from-teal-300 via-emerald-500 to-green-700" },
  { slug: "ooty", name: "Ooty", state: "Tamil Nadu", lat: 11.41, lng: 76.7, tagline: "Tea-estate mornings", gradient: "from-green-300 via-lime-500 to-emerald-600" },
  { slug: "pondicherry", name: "Pondicherry", state: "Puducherry", lat: 11.93, lng: 79.83, tagline: "French quarter calm", gradient: "from-yellow-200 via-amber-400 to-orange-500" },
  { slug: "darjeeling", name: "Darjeeling", state: "West Bengal", lat: 27.04, lng: 88.26, tagline: "Toy trains and Kanchenjunga", gradient: "from-violet-300 via-purple-500 to-indigo-700" },
];

const HALF_SPAN = 0.125;

export const bboxOf = (lat: number, lng: number, half = HALF_SPAN) =>
  [lat - half, lng - half, lat + half, lng + half].map((n) => Number(n.toFixed(5))).join(",");

export const findDestination = (slug: string | undefined) => DESTINATIONS.find((d) => d.slug === slug);

export const destinationBbox = (d: Destination) => bboxOf(d.lat, d.lng);

/** "swLat,swLng,neLat,neLng" -> numbers, or null if malformed. */
export function parseBbox(s: string | undefined): [number, number, number, number] | null {
  if (!s) return null;
  const p = s.split(",").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [swLat, swLng, neLat, neLng] = p as [number, number, number, number];
  if (swLat >= neLat || swLng >= neLng || Math.abs(swLat) > 90 || Math.abs(neLat) > 90 || Math.abs(swLng) > 180 || Math.abs(neLng) > 180) return null;
  return [swLat, swLng, neLat, neLng];
}
