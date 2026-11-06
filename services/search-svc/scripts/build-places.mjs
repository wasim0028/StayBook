// Builds src/data/places-in.json from GeoNames (via the `cities.json` npm package, CC-BY-4.0).
// Run: npm run build:places --workspace services/search-svc
// Output rows: [displayName, state, lat, lng, foldedName, priority] (priority 1 = curated destination).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dir = require.resolve("cities.json").replace(/[^/\\]+$/, "");
const cities = JSON.parse(readFileSync(`${dir}cities.json`, "utf8"));
const admin1 = Object.fromEntries(JSON.parse(readFileSync(`${dir}admin1.json`, "utf8")).filter((a) => a.code.startsWith("IN.")).map((a) => [a.code.slice(3), a.name]));

const fold = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;

// Popular stay destinations: these win over same-named GeoNames rows (e.g. Manali, Udaipur) and add
// the names travellers actually type (Goa, Coorg, Pondicherry). Coordinates are the town centre.
const CURATED = [
  ["Goa", "Goa", 15.55, 73.78, ["north goa"]],
  ["South Goa", "Goa", 15.25, 73.98, []],
  ["Panaji", "Goa", 15.4957, 73.8262, ["panjim"]],
  ["Mumbai", "Maharashtra", 19.076, 72.8777, ["bombay"]],
  ["Bengaluru", "Karnataka", 12.9716, 77.5946, ["bangalore"]],
  ["Delhi", "Delhi", 28.6139, 77.209, ["new delhi"]],
  ["Jaipur", "Rajasthan", 26.9124, 75.7873, []],
  ["Udaipur", "Rajasthan", 24.5858, 73.7135, []],
  ["Jaisalmer", "Rajasthan", 26.9176, 70.9039, []],
  ["Mount Abu", "Rajasthan", 24.5926, 72.7156, []],
  ["Manali", "Himachal Pradesh", 32.2574, 77.1748, []],
  ["Kasol", "Himachal Pradesh", 32.0099, 77.3149, []],
  ["Dharamshala", "Himachal Pradesh", 32.219, 76.3234, ["dharamsala", "mcleod ganj", "mcleodganj"]],
  ["Bir", "Himachal Pradesh", 32.0441, 76.7238, ["bir billing"]],
  ["Shimla", "Himachal Pradesh", 31.1044, 77.1666, []],
  ["Rishikesh", "Uttarakhand", 30.0869, 78.2676, []],
  ["Nainital", "Uttarakhand", 29.3803, 79.4636, ["naini tal"]],
  ["Mussoorie", "Uttarakhand", 30.455, 78.0707, []],
  ["Auli", "Uttarakhand", 30.5288, 79.5669, []],
  ["Darjeeling", "West Bengal", 27.041, 88.2663, []],
  ["Gangtok", "Sikkim", 27.3257, 88.6122, []],
  ["Leh", "Ladakh", 34.1526, 77.5771, ["ladakh"]],
  ["Kochi", "Kerala", 9.9312, 76.2673, ["cochin", "fort kochi"]],
  ["Munnar", "Kerala", 10.0889, 77.0595, []],
  ["Alleppey", "Kerala", 9.4981, 76.3388, ["alappuzha"]],
  ["Varkala", "Kerala", 8.7379, 76.7163, []],
  ["Wayanad", "Kerala", 11.6854, 76.132, ["kalpetta"]],
  ["Coorg", "Karnataka", 12.4244, 75.7382, ["madikeri", "kodagu"]],
  ["Gokarna", "Karnataka", 14.5479, 74.3188, []],
  ["Hampi", "Karnataka", 15.335, 76.46, []],
  ["Ooty", "Tamil Nadu", 11.4102, 76.695, ["udhagamandalam"]],
  ["Kodaikanal", "Tamil Nadu", 10.2381, 77.4892, []],
  ["Pondicherry", "Puducherry", 11.9416, 79.8083, ["puducherry"]],
  ["Lonavala", "Maharashtra", 18.7546, 73.4062, ["lonavla", "khandala"]],
  ["Mahabaleshwar", "Maharashtra", 17.9237, 73.6586, []],
  ["Alibaug", "Maharashtra", 18.6414, 72.8722, ["alibag"]],
  ["Varanasi", "Uttar Pradesh", 25.3176, 82.9739, ["banaras", "kashi"]],
  ["Agra", "Uttar Pradesh", 27.1767, 78.0081, []],
  ["Amritsar", "Punjab", 31.634, 74.8723, []],
  ["Pushkar", "Rajasthan", 26.4897, 74.5511, []],
  ["Shillong", "Meghalaya", 25.5788, 91.8933, []],
  ["Hyderabad", "Telangana", 17.385, 78.4867, []],
  ["Chennai", "Tamil Nadu", 13.0827, 80.2707, ["madras"]],
  ["Kolkata", "West Bengal", 22.5726, 88.3639, ["calcutta"]],
  ["Pune", "Maharashtra", 18.5204, 73.8567, []],
];

const rows = [];
const curatedKeys = new Set();
for (const [name, state, lat, lng, aliases] of CURATED) {
  curatedKeys.add(`${fold(name)}|${state}`);
  for (const alt of [name, ...aliases]) rows.push([name, state, lat, lng, fold(alt), 1]);
}
for (const c of cities) {
  if (c.country !== "IN") continue;
  const state = admin1[c.admin1] ?? "";
  const name = c.name.normalize("NFKD").replace(/[̀-ͯ]/g, ""); // "Rishīkesh" -> "Rishikesh"
  if (curatedKeys.has(`${fold(name)}|${state}`)) continue;
  rows.push([name, state, r4(c.lat), r4(c.lng), fold(name), 0]);
}
writeFileSync(new URL("../src/data/places-in.json", import.meta.url), JSON.stringify(rows));
console.log(`wrote ${rows.length} places`);
