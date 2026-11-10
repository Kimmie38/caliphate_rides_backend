// The cities Caliphate Rides works in. A pickup must be inside one of these boxes
// (west, south, east, north, in degrees), unless SERVICE_AREA says otherwise.
// The map server covers each whole state (regions.geojson in the map kit).
export const CITIES = [
  { id: "sokoto", name: "Sokoto", state: "Sokoto", center: { latitude: 13.0482, longitude: 5.231 }, box: { west: 5.10, south: 12.85, east: 5.35, north: 13.15 } },
  { id: "kano", name: "Kano", state: "Kano", center: { latitude: 12.0022, longitude: 8.592 }, box: { west: 8.35, south: 11.85, east: 8.75, north: 12.15 } },
  { id: "kaduna", name: "Kaduna", state: "Kaduna", center: { latitude: 10.5105, longitude: 7.4165 }, box: { west: 7.25, south: 10.35, east: 7.60, north: 10.70 } },
  { id: "abuja", name: "Abuja", state: "FCT (Abuja)", center: { latitude: 9.0765, longitude: 7.3986 }, box: { west: 7.00, south: 8.85, east: 7.65, north: 9.25 } },
  { id: "jos", name: "Jos", state: "Plateau", center: { latitude: 9.8965, longitude: 8.8583 }, box: { west: 8.70, south: 9.70, east: 9.05, north: 10.05 } },
];

/** "Sokoto, Kano, Kaduna, Abuja and Jos" */
export const cityList = (cities = CITIES) => {
  const names = cities.map((c) => c.name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
};

/** True when the point is inside one of the boxes (with an optional margin in degrees). */
export function inAreas(p, areas, margin = 0) {
  if (!areas) return true;
  return areas.some((a) => p.latitude >= a.south - margin && p.latitude <= a.north + margin && p.longitude >= a.west - margin && p.longitude <= a.east + margin);
}
