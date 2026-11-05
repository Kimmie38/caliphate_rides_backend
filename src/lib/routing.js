// Road routes from OSRM (our own Sokoto server in production; see the map server kit).
// Fares are priced from the road distance, so the same server should be used by the app.
import { config } from "../config.js";
import { haversineKm } from "./geo.js";

const CITY_KMH = 22;
const TIMEOUT_MS = 7000;
const cache = new Map(); // recent routes, so a quote and the booking that follows agree exactly
const CACHE_MS = 15 * 60 * 1000;
const ESTIMATE_CACHE_MS = 30 * 1000;

const key = (a, b) => `${a.latitude.toFixed(5)},${a.longitude.toFixed(5)};${b.latitude.toFixed(5)},${b.longitude.toFixed(5)}`;

/** { path: [{latitude, longitude}], distanceKm, durationMin, source } */
export async function getRoute(from, to) {
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.route;

  let route = await osrmRoute(config.routingUrl, from, to);
  // Our routing server only knows Sokoto. Elsewhere (testing in another city) ask the public server.
  if (!route && config.routingFallbackUrl && config.routingFallbackUrl !== config.routingUrl) {
    route = await osrmRoute(config.routingFallbackUrl, from, to);
  }
  route ??= estimateRoute(from, to);
  // Estimates are kept only briefly, so real routes are used as soon as the server answers again
  // (a free-plan routing server can take a minute to wake up).
  cache.set(k, { at: route.source === "osrm" ? Date.now() : Date.now() - CACHE_MS + ESTIMATE_CACHE_MS, route });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return route;
}

async function osrmRoute(base, from, to) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const url = `${base}/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json();
    const r = json?.code === "Ok" ? json.routes?.[0] : null;
    const line = r?.geometry?.coordinates;
    if (r && Array.isArray(line) && line.length >= 2) {
      return {
        path: line.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
        distanceKm: r.distance / 1000,
        durationMin: Math.max(1, Math.round(r.duration / 60)),
        source: "osrm",
      };
    }
  } catch {
    // unreachable or timed out
  } finally {
    clearTimeout(timer);
  }
  return null;
}

/** Close to typical road distance in a grid-like city, for when routing is unavailable. */
export function estimateRoute(from, to) {
  const corner = { latitude: from.latitude, longitude: to.longitude };
  const distanceKm = haversineKm(from, corner) + haversineKm(corner, to);
  return { path: [from, corner, to], distanceKm, durationMin: Math.max(2, Math.round((distanceKm / CITY_KMH) * 60)), source: "estimate" };
}

/**
 * Keeps the routing server awake while this server is running. Free hosting plans (Render free) put a
 * server to sleep after 15 minutes without requests, and waking takes about a minute; during that
 * time fares fall back to estimates. Calling this when the API starts means both wake together.
 */
export function keepRoutingAwake({ everyMs = 10 * 60_000 } = {}) {
  const ping = () =>
    fetch(`${config.routingUrl}/nearest/v1/driving/5.2310,13.0482`, { signal: AbortSignal.timeout(90_000) }).catch(() => {});
  ping();
  const t = setInterval(ping, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
