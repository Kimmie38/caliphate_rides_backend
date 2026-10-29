const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line distance in km between { latitude, longitude } points. */
export function haversineKm(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** MongoDB GeoJSON point from { latitude, longitude }. */
export const toGeoPoint = (p) => ({ type: "Point", coordinates: [p.longitude, p.latitude] });
/** { latitude, longitude } from a MongoDB GeoJSON point. */
export const fromGeoPoint = (g) => (g?.coordinates ? { latitude: g.coordinates[1], longitude: g.coordinates[0] } : null);
