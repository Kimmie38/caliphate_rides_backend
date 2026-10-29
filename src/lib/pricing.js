// How fares and the driver's share are worked out. Same rule as the app (src/lib/pricing.ts), but this
// one is what's actually charged.
//
//   fare       = base fare + (billable km × price per km), rounded to the nearest ₦roundTo,
//                and never less than the minimum fare
//   commission = fare × commission %        (Caliphate Rides' share, rounded to the naira)
//   driver gets  fare − commission
//
// The admin sets every number in the dashboard. Each ride type (keke, car) has its own fares.
// Until then: ₦500 per km, no base fare, ₦500 minimum, 15% commission.

export const RIDE_TYPES = ["keke", "car"];

export const DEFAULT_RIDE_TYPES = [
  { id: "keke", name: "Keke", seats: 3, enabled: true, baseFare: 0, perKm: 500, minimumFare: 500 },
  { id: "car", name: "Car", seats: 4, enabled: true, baseFare: 0, perKm: 500, minimumFare: 500 },
];

export const DEFAULT_PRICING = {
  currency: "NGN",
  roundTo: 50,
  rideTypes: DEFAULT_RIDE_TYPES,
  commissionPercent: 15,
  /** Drivers who owe more than this in commission can't go online until they pay. */
  owedLimit: 5000,
  /** Smallest amount a driver can withdraw. */
  minWithdrawal: 1000,
};

/** Limits the admin dashboard allows, so a typo can't make a ₦5,000,000 fare. */
export const LIMITS = {
  baseFare: { min: 0, max: 20_000 },
  perKm: { min: 0, max: 20_000 },
  minimumFare: { min: 0, max: 50_000 },
  commissionPercent: { min: 0, max: 50 },
  owedLimit: { min: 0, max: 200_000 },
  minWithdrawal: { min: 100, max: 100_000 },
  roundTo: [1, 10, 50, 100],
};

/** Distances are billed to one decimal place (100 m), minimum 0.1 km. */
export function billableKm(distanceKm) {
  return Math.max(0.1, Math.round(distanceKm * 10) / 10);
}

export function rideTypeFares(pricing, rideType) {
  return pricing.rideTypes.find((r) => r.id === rideType) ?? DEFAULT_RIDE_TYPES.find((r) => r.id === rideType);
}

/** The fare for a trip, from the ride type's fares. */
export function computeFare(distanceKm, fares, roundTo = 50) {
  const raw = (fares.baseFare ?? 0) + billableKm(distanceKm) * fares.perKm;
  const step = roundTo > 0 ? roundTo : 1;
  const rounded = Math.round(raw / step) * step;
  return Math.max(fares.minimumFare ?? 0, rounded);
}

/** How a fare splits between the driver and Caliphate Rides. */
export function splitFare(fare, commissionPercent) {
  const commission = Math.round((fare * commissionPercent) / 100);
  return { commission, driverEarning: fare - commission };
}

/** Keke are a little slower than cars in town. */
export const SPEED_FACTOR = { keke: 1.15, car: 1 };

/**
 * Turns a stored settings document into the full pricing settings, filling anything missing with the
 * defaults. Understands the older shape (one ratePerKm for everything).
 */
export function normalizePricing(doc) {
  if (!doc) return structuredClone(DEFAULT_PRICING);
  const oldRate = Number.isFinite(doc.ratePerKm) ? doc.ratePerKm : undefined;
  const rideTypes = DEFAULT_RIDE_TYPES.map((def) => {
    const t = (doc.rideTypes ?? []).find((r) => r.id === def.id) ?? {};
    const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
    return {
      id: def.id,
      name: t.name || def.name,
      seats: num(t.seats, def.seats),
      enabled: typeof t.enabled === "boolean" ? t.enabled : def.enabled,
      baseFare: num(t.baseFare, def.baseFare),
      perKm: num(t.perKm, num(t.ratePerKm, num(oldRate, def.perKm))),
      minimumFare: num(t.minimumFare, def.minimumFare),
    };
  });
  const pick = (k) => (Number.isFinite(doc[k]) ? doc[k] : DEFAULT_PRICING[k]);
  return {
    currency: "NGN",
    roundTo: LIMITS.roundTo.includes(doc.roundTo) ? doc.roundTo : DEFAULT_PRICING.roundTo,
    rideTypes,
    commissionPercent: pick("commissionPercent"),
    owedLimit: pick("owedLimit"),
    minWithdrawal: pick("minWithdrawal"),
    ...(doc.updatedAt ? { updatedAt: new Date(doc.updatedAt).toISOString() } : {}),
    ...(doc.updatedBy ? { updatedBy: doc.updatedBy } : {}),
  };
}

/** What the rider's app needs (no commission or payout settings). */
export function publicPricing(p) {
  return { currency: p.currency, roundTo: p.roundTo, rideTypes: p.rideTypes, ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}) };
}
