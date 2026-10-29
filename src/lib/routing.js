// Road routes from OSRM (our own Sokoto server in production; see the map server kit).
// Fares are priced from the road distance, so the same server should be used by the app.
import { config } from "../config.js";
import { haversineKm } from "./geo.js";

const CITY_KMH = 22;
const TIMEOUT_MS = 7000;
const cache = new Map(); // recent routes, so a quote and the booking that follows agree exactly
const CACHE_MS = 15 * 60 * 1000;

const key = (a, b) => `${a.latitude.toFixed(5)},${a.longitude.toFixed(5)};${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;

/** { path: [{latitude, longitude}], distanceKm, durationMin, source } */
export async function getRoute(from, to) {
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.route;

  let route = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${config.routingUrl}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json();
    const r = json?.code === "Ok" ? json.routes?.[0] : null;
    const line = r?.geometry?.coordinates;
    if (r && Array.isArray(line) && line.length >= 2) {
      route = {
        path: line.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
        distanceKm: r.distance / 1000,
        durationMin: Math.max(1, Math.round(r.duration / 60)),
        source: "osrm",
      };
    }
  } catch {
    // routing server unreachable: fall back to the estimate below
  } finally {
    clearTimeout(timer);
  }
  route ??= estimateRoute(from, to);
  cache.set(k, { at: Date.now(), route });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return route;
}

/** Close to typical road distance in a grid-like city, for when routing is unavailable. */
export function estimateRoute(from, to) {
  const corner = { latitude: from.latitude, longitude: to.longitude };
  const distanceKm = haversineKm(from, corner) + haversineKm(corner, to);
  return { path: [from, corner, to], distanceKm, durationMin: Math.max(2, Math.round((distanceKm / CITY_KMH) * 60)), source: "estimate" };
}
