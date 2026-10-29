import { SPEED_FACTOR, billableKm, computeFare, normalizePricing, rideTypeFares, splitFare } from "../lib/pricing.js";
import { getRoute } from "../lib/routing.js";
import { Config } from "../models/index.js";

let cached = null;
let cachedAt = 0;
const CACHE_MS = 15_000;

/** Current fares, commission and payout settings (full settings; use publicPricing for riders). */
export async function getPricing() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const doc = await Config.findById("pricing").lean();
  cached = normalizePricing(doc);
  cachedAt = Date.now();
  return cached;
}

export function clearPricingCache() {
  cached = null;
}

/** One quote per enabled ride type, priced from the road route. */
export async function quoteTrip(pickup, destination) {
  const [pricing, route] = await Promise.all([getPricing(), getRoute(pickup, destination)]);
  const km = billableKm(route.distanceKm);
  const quotes = pricing.rideTypes
    .filter((t) => t.enabled)
    .map((t) => {
      const fares = rideTypeFares(pricing, t.id);
      return {
        rideType: t.id,
        distanceKm: km,
        durationMin: Math.max(2, Math.round(route.durationMin * (SPEED_FACTOR[t.id] ?? 1))),
        baseFare: fares.baseFare,
        ratePerKm: fares.perKm,
        minimumFare: fares.minimumFare,
        fare: computeFare(km, fares, pricing.roundTo),
        route: route.path,
      };
    });
  return { quotes, route, pricing };
}

/** The commission for a ride at today's settings (stored on the ride when it's booked). */
export function rideSplit(fare, pricing) {
  return { commissionPercent: pricing.commissionPercent, ...splitFare(fare, pricing.commissionPercent) };
}
