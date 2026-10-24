// Real hospital lookup (OpenStreetMap Overpass), run in the browser so no paid
// Cloud Function / Blaze plan is needed. Overpass sends CORS headers precisely
// so JavaScript running on another website's page can call it directly.

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const RADII_M = [8000, 25000, 60000];

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dp = (lat2 - lat1) * r, dl = (lon2 - lon1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildQuery(lat, lon, radius) {
  const around = `(around:${radius},${lat},${lon})`;
  return (
    "[out:json][timeout:12];(" +
    `node["amenity"="hospital"]${around};` +
    `way["amenity"="hospital"]${around};` +
    `relation["amenity"="hospital"]${around};` +
    ");out tags center;"
  );
}

async function overpass(query, deadline) {
  let lastErr = new Error("Overpass unavailable");
  for (const endpoint of ENDPOINTS) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(8000, left));
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.elements || [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function asciiName(name) {
  const s = name.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/[",\\]/g, " ").replace(/\s+/g, " ").trim();
  return (s.length >= 3 ? s : "Hospital").slice(0, 40);
}

function lcdName(name, city) {
  const a = asciiName(name);
  if (a !== "Hospital" || !city) return a;
  const c = asciiName(city);
  return c === "Hospital" ? a : `${c} Hospital`.slice(0, 40);
}

function normalise(elements, lat, lon) {
  const byName = new Map();
  for (const el of elements) {
    const t = el.tags || {};
    const hLat = el.lat ?? el.center?.lat;
    const hLon = el.lon ?? el.center?.lon;
    const name = String(t["name:en"] || t.name || "").trim();
    if (hLat == null || hLon == null || !name) continue;
    if (/veterin|animal|pet clinic/i.test(name)) continue;

    const item = {
      name,
      lcd: lcdName(name, t["addr:city"]),
      city: t["addr:city"] || t["addr:suburb"] || t["addr:district"] || "Nearby",
      lat: hLat,
      lon: hLon,
      emergency: t.emergency === "yes",
      distance: Math.round(haversine(lat, lon, hLat, hLon) * 10) / 10,
    };
    const key = name.toLowerCase();
    const old = byName.get(key);
    if (!old || item.distance < old.distance) byName.set(key, item); // same hospital mapped twice (node + way)
  }
  return [...byName.values()].sort((a, b) => a.distance - b.distance);
}

// The built-in fallback list, used only if OpenStreetMap is unreachable.
const FALLBACK = [
  { name: "Apollo Hospital Trichy", city: "Trichy", lat: 10.827, lon: 78.686 },
  { name: "Kauvery Hospital Trichy", city: "Trichy", lat: 10.8012, lon: 78.6855 },
  { name: "KMC Hospital", city: "Trichy", lat: 10.7654, lon: 78.7412 },
  { name: "Thanjavur Medical College", city: "Thanjavur", lat: 10.7867, lon: 79.1376 },
  { name: "SRM Medical College", city: "Trichy", lat: 10.756, lon: 78.813 },
  { name: "Vivekananda Hospital", city: "Trichy", lat: 10.83, lon: 78.698 },
  { name: "Government Hospital Kumbakonam", city: "Kumbakonam", lat: 10.9615, lon: 79.3881 },
];

export function fallbackList(lat, lon, count) {
  return FALLBACK
    .map((h) => ({ ...h, lcd: lcdName(h.name, h.city), distance: Math.round(haversine(lat, lon, h.lat, h.lon) * 10) / 10 }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export async function searchNearbyHospitals(lat, lon, count = 4) {
  const deadline = Date.now() + 25000;
  let best = [];
  let lastErr = null;
  for (const radius of RADII_M) {
    if (Date.now() > deadline) break;
    try {
      const els = await overpass(buildQuery(lat, lon, radius), deadline);
      best = normalise(els, lat, lon);
      if (best.length >= count) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!best.length && lastErr) throw lastErr;
  return best.slice(0, count);
}
