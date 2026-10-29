// Turns database records into exactly the shapes the app expects (see the app's src/types.ts and
// src/driver/types.ts). Works with Mongoose documents or plain objects.
import { signedFileUrl } from "./files.js";

const iso = (d) => (d ? new Date(d).toISOString() : undefined);
const id = (v) => (v?._id ?? v)?.toString();
const plainMap = (m) => (m instanceof Map ? Object.fromEntries(m) : m ?? {});
const round1 = (n) => Math.round((n ?? 0) * 10) / 10;

export function userDTO(u) {
  return { id: id(u), phone: u.phone, name: u.name ?? "", rating: round1(u.rating?.avg ?? 5) };
}

export function placeDTO(p) {
  return {
    id: p.id ?? p.slug ?? id(p),
    name: p.name,
    ...(p.subtitle ? { subtitle: p.subtitle } : {}),
    category: p.category ?? "pin",
    location: { latitude: p.location.latitude, longitude: p.location.longitude },
  };
}

/** The driver as a rider sees them. Bank details only when the rider is paying by transfer. */
export function driverDTO(driver, driverUser, { withBank = false } = {}) {
  return {
    id: id(driver),
    name: driver.personal?.fullName || driverUser?.name || "Your driver",
    phone: driverUser?.phone ?? "",
    rating: round1(driver.rating?.avg ?? 5),
    trips: driver.tripsCount ?? 0,
    vehicle: {
      type: driver.vehicleType,
      make: [driver.vehicle?.make, driver.vehicle?.model].filter(Boolean).join(" "),
      color: driver.vehicle?.colour ?? "",
      plate: driver.vehicle?.plate ?? "",
    },
    ...(withBank && driver.bank?.accountNumber ? { bank: { bankName: driver.bank.bankName, accountNumber: driver.bank.accountNumber, accountName: driver.bank.accountName } } : {}),
  };
}

const latLngs = (route) => (route ?? []).map((p) => ({ latitude: p.latitude, longitude: p.longitude }));

/** A ride as the rider's app shows it. Pass the assigned driver (and their user) when there is one. */
export function rideDTO(ride, driver, driverUser) {
  return {
    id: id(ride),
    status: ride.status,
    pickup: placeDTO(ride.pickup),
    destination: placeDTO(ride.destination),
    rideType: ride.rideType,
    paymentMethod: ride.paymentMethod,
    paymentStatus: ride.paymentStatus,
    distanceKm: ride.distanceKm,
    baseFare: ride.baseFare ?? 0,
    ratePerKm: ride.ratePerKm,
    minimumFare: ride.minimumFare ?? 0,
    fare: ride.fare,
    route: latLngs(ride.route),
    ...(driver ? { driver: driverDTO(driver, driverUser, { withBank: ride.paymentMethod === "transfer" }) } : {}),
    createdAt: iso(ride.createdAt),
  };
}

/** A ride offered to a driver (the driver app's RideRequest). */
export function rideRequestDTO(ride, rider, expiresAt) {
  return {
    id: id(ride),
    rider: { name: rider?.name || "Rider", rating: round1(rider?.rating?.avg ?? 5), phone: rider?.phone ?? "" },
    pickup: placeDTO(ride.pickup),
    destination: placeDTO(ride.destination),
    rideType: ride.rideType,
    distanceKm: ride.distanceKm,
    durationMin: ride.durationMin ?? 0,
    baseFare: ride.baseFare ?? 0,
    ratePerKm: ride.ratePerKm,
    minimumFare: ride.minimumFare ?? 0,
    fare: ride.fare,
    commissionPercent: ride.commissionPercent ?? 0,
    commission: ride.commission ?? 0,
    driverEarning: ride.driverEarning ?? ride.fare,
    paymentMethod: ride.paymentMethod,
    route: latLngs(ride.route),
    expiresAt: new Date(expiresAt).getTime(),
  };
}

/** One line in the rider's Activity list. */
export function tripSummaryDTO(ride, driverName) {
  return {
    id: id(ride),
    pickupName: ride.pickup.name,
    destinationName: ride.destination.name,
    rideType: ride.rideType,
    distanceKm: ride.distanceKm,
    fare: ride.fare,
    paymentMethod: ride.paymentMethod,
    driverName: driverName || "Driver",
    completedAt: iso(ride.completedAt ?? ride.updatedAt),
  };
}

/** One line in the driver's Earnings list. */
export function earningsDTO(ride) {
  return {
    id: id(ride),
    destinationName: ride.destination.name,
    rideType: ride.rideType,
    distanceKm: ride.distanceKm,
    fare: ride.fare,
    commission: ride.commission ?? 0,
    driverEarning: ride.driverEarning ?? ride.fare,
    paymentMethod: ride.paymentMethod,
    paymentStatus: ride.paymentStatus,
    completedAt: iso(ride.completedAt),
  };
}

export function walletTxDTO(t) {
  return { id: id(t), kind: t.kind, label: t.label, amount: t.amount, at: iso(t.createdAt), ...(t.method ? { method: t.method } : {}) };
}

function versionDTO(v) {
  return {
    files: (v.files ?? []).map((f) => signedFileUrl(f)),
    ...(v.number ? { number: v.number } : {}),
    ...(v.expiry ? { expiry: v.expiry } : {}),
    uploadedAt: iso(v.uploadedAt),
    status: v.status,
    ...(v.reviewNote ? { reviewNote: v.reviewNote } : {}),
  };
}

/** The driver's official record, as the driver app's DriverApplication. Document photos are signed links. */
export function applicationDTO(d) {
  const documents = {};
  for (const [kind, doc] of Object.entries(plainMap(d.documents))) {
    if (!doc) continue;
    documents[kind] = { kind, ...(doc.current ? { current: versionDTO(doc.current) } : {}), history: (doc.history ?? []).map(versionDTO) };
  }
  return {
    recordId: d.recordId ?? "",
    status: d.status,
    ...(d.vehicleType ? { vehicleType: d.vehicleType } : {}),
    personal: { fullName: "", dateOfBirth: "", gender: "", address: "", lga: "", nin: "", email: "", ...pick(d.personal) },
    vehicle: { make: "", model: "", year: "", colour: "", plate: "", ownsVehicle: true, ...pick(d.vehicle) },
    guarantor: { fullName: "", phone: "", relationship: "", address: "", ...pick(d.guarantor) },
    bank: bankDTO(d.bank),
    documents,
    ...(d.declaration?.signedName ? { declaration: { signedName: d.declaration.signedName, signedAt: iso(d.declaration.signedAt) } } : {}),
    ...(d.reviewNote ? { reviewNote: d.reviewNote } : {}),
    timeline: (d.timeline ?? []).map((t) => ({ at: iso(t.at), event: t.event, ...(t.by ? { by: t.by } : {}) })),
    createdAt: iso(d.createdAt),
    ...(d.submittedAt ? { submittedAt: iso(d.submittedAt) } : {}),
    ...(d.approvedAt ? { approvedAt: iso(d.approvedAt) } : {}),
  };
}

/** The driver's bank details, with the bank's check of the account (no internal codes). */
function bankDTO(b) {
  const v = pick(b);
  return {
    bankName: v.bankName ?? "", accountNumber: v.accountNumber ?? "", accountName: v.accountName ?? "",
    ...(v.verifiedName ? { verifiedName: v.verifiedName, verified: !!(v.nameMatches || v.approvedBy) } : {}),
    ...(v.verifyError ? { verifyError: v.verifyError } : {}),
  };
}

/** Plain copy of a nested object (drops Mongoose internals). */
function pick(o) {
  if (!o) return {};
  const src = typeof o.toObject === "function" ? o.toObject() : o;
  const out = {};
  for (const [k, v] of Object.entries(src)) if (k !== "_id" && v !== undefined) out[k] = v;
  return out;
}
