// Unit tests for the pure logic (no database needed). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { billableKm, computeFare, splitFare, normalizePricing, publicPricing, DEFAULT_PRICING } from "../src/lib/pricing.js";
import { namesMatch } from "../src/lib/names.js";
import { normalizeNgPhone } from "../src/lib/phone.js";
import { signToken, verifyToken } from "../src/lib/jwt.js";
import { codeMatches, hashCode, newCode } from "../src/lib/otp.js";
import { hashPassword, checkPassword } from "../src/lib/password.js";
import { safeFileName, signedFileUrl, validFileSignature } from "../src/lib/files.js";
import { haversineKm } from "../src/lib/geo.js";
import { int, point, text } from "../src/lib/validate.js";
import { applicationDTO, placeDTO, tripSummaryDTO } from "../src/lib/serialize.js";
import {
  documentsFor, drivingBlockers, isIsoDate, missingSections, normalizePlate, validateDocumentDetails, documentRequirement,
} from "../src/lib/driverRules.js";

config.jwtSecret ||= "test-secret-test-secret-test-secret";

const isoInDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("fares: base + per km, rounded, never under the minimum", () => {
  const start = { baseFare: 0, perKm: 500, minimumFare: 500 };
  assert.equal(billableKm(3.04), 3);
  assert.equal(billableKm(0.01), 0.1);
  assert.equal(computeFare(3.04, start), 1500);
  assert.equal(computeFare(7.25, start), 3650); // 7.3 km
  assert.equal(computeFare(0.4, start), 500); // minimum
  const custom = { baseFare: 300, perKm: 450, minimumFare: 800 };
  assert.equal(computeFare(3, custom), 1650); // 300 + 1350
  assert.equal(computeFare(1, custom), 800); // 750 → minimum 800
  assert.equal(computeFare(2.3, { baseFare: 200, perKm: 333, minimumFare: 0 }, 50), 950); // 965.9 → 950
  assert.equal(computeFare(2.3, { baseFare: 200, perKm: 333, minimumFare: 0 }, 1), 966);
});

test("commission: the driver gets fare minus Caliphate's share", () => {
  assert.deepEqual(splitFare(3000, 15), { commission: 450, driverEarning: 2550 });
  assert.deepEqual(splitFare(1350, 15), { commission: 203, driverEarning: 1147 });
  assert.deepEqual(splitFare(1000, 0), { commission: 0, driverEarning: 1000 });
});

test("pricing settings: defaults, older settings, and what riders see", () => {
  const d = normalizePricing(null);
  assert.equal(d.rideTypes[0].perKm, 500);
  assert.equal(d.rideTypes[0].minimumFare, 500);
  assert.equal(d.commissionPercent, 15);
  const old = normalizePricing({ ratePerKm: 450, rideTypes: [{ id: "car", name: "Car", seats: 4, enabled: true, ratePerKm: 600 }] });
  assert.equal(old.rideTypes.find((t) => t.id === "keke").perKm, 450);
  assert.equal(old.rideTypes.find((t) => t.id === "car").perKm, 600);
  const pub = publicPricing(d);
  assert.equal(pub.commissionPercent, undefined);
  assert.equal(pub.owedLimit, undefined);
  assert.equal(DEFAULT_PRICING.minWithdrawal, 1000);
});

test("bank account names", () => {
  assert.ok(namesMatch("ABUBAKAR MUSA SANI", "Musa Abubakar"));
  assert.ok(namesMatch("MUSA, ABUBAKAR", "Abubakar Musa"));
  assert.ok(!namesMatch("ALIYU BELLO", "Abubakar Musa"));
  assert.ok(!namesMatch("ABUBAKAR BELLO", "Abubakar Musa"));
  assert.ok(namesMatch("Fatima Usman Bello", "fatima  usman"));
  assert.ok(!namesMatch("", "Abubakar Musa"));
});

test("phone numbers: same rule as the app", () => {
  assert.equal(normalizeNgPhone("0803 123 4567"), "+2348031234567");
  assert.equal(normalizeNgPhone("+234 803 123 4567"), "+2348031234567");
  assert.equal(normalizeNgPhone("8031234567"), "+2348031234567");
  assert.equal(normalizeNgPhone("0603 123 4567"), null);
  assert.equal(normalizeNgPhone("12345"), null);
  assert.equal(normalizeNgPhone(undefined), null);
});

test("tokens: sign, verify, reject tampering and expiry", () => {
  const t = signToken({ sub: "abc", role: "user" }, "s1");
  assert.equal(verifyToken(t, "s1").sub, "abc");
  assert.equal(verifyToken(t, "s2"), null);
  const [h, , s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "x", role: "admin", exp: 9e9 })).toString("base64url");
  assert.equal(verifyToken(`${h}.${forged}.${s}`, "s1"), null);
  assert.equal(verifyToken(signToken({ sub: "a" }, "s1", { days: -1 }), "s1"), null);
  assert.equal(verifyToken("nonsense", "s1"), null);
});

test("sign-in codes: six digits, checked against the hash only", () => {
  const code = newCode();
  assert.match(code, /^\d{6}$/);
  const h = hashCode("+2348031234567", code, "sec");
  assert.ok(codeMatches(h, "+2348031234567", code, "sec"));
  assert.ok(!codeMatches(h, "+2348031234568", code, "sec"));
  assert.ok(!codeMatches(h, "+2348031234567", "12345", "sec"));
  assert.ok(!codeMatches(h, "+2348031234567", code, "other"));
});

test("admin passwords: scrypt hash round trip", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.ok(await checkPassword("correct horse battery", stored));
  assert.ok(!(await checkPassword("wrong password", stored)));
  assert.ok(!(await checkPassword("x", "garbage")));
});

test("document links: signed, expire, and only our own file names", () => {
  const name = "0123456789abcdef0123456789abcdef.jpg";
  const url = new URL(signedFileUrl(name));
  assert.ok(validFileSignature(name, url.searchParams.get("exp"), url.searchParams.get("sig")));
  assert.ok(!validFileSignature("ffffffffffffffffffffffffffffffff.jpg", url.searchParams.get("exp"), url.searchParams.get("sig")));
  assert.ok(!validFileSignature(name, Number(url.searchParams.get("exp")) + 1, url.searchParams.get("sig")));
  const old = new URL(signedFileUrl(name, -10));
  assert.ok(!validFileSignature(name, old.searchParams.get("exp"), old.searchParams.get("sig")));
  assert.ok(safeFileName(name));
  assert.ok(!safeFileName("../.env"));
  assert.ok(!safeFileName("0123456789abcdef0123456789abcdef.js"));
});

test("input checks", () => {
  assert.equal(text("  hi there ", "Name"), "hi there");
  assert.throws(() => text("", "Name", { min: 2 }), /required/);
  assert.equal(int("12", "N"), 12);
  assert.throws(() => int(1.5, "N"), /whole number/);
  assert.deepEqual(point({ latitude: "13.06", longitude: 5.24 }, "Pickup"), { name: "Pinned location", latitude: 13.06, longitude: 5.24 });
  assert.throws(() => point({ latitude: 200, longitude: 5 }, "Pickup"), /invalid location/);
  assert.ok(Math.abs(haversineKm({ latitude: 13.06157, longitude: 5.22601 }, { latitude: 12.91771, longitude: 5.2084 }) - 16.1) < 0.3);
});

test("driver rules: dates, plates, documents", () => {
  assert.ok(isIsoDate("2024-02-29"));
  assert.ok(!isIsoDate("2023-02-29"));
  assert.equal(normalizePlate("skt-123ab"), "SKT 123 AB");
  assert.deepEqual(documentsFor("keke", true).map((d) => d.kind).includes("operating_permit"), true);
  assert.deepEqual(documentsFor("keke", true).map((d) => d.kind).includes("roadworthiness"), false);
  assert.deepEqual(documentsFor("car", true).map((d) => d.kind).includes("roadworthiness"), true);
  const licence = documentRequirement("licence");
  assert.deepEqual(Object.keys(validateDocumentDetails(licence, { number: "", expiry: isoInDays(-1) })).sort(), ["expiry", "number"]);
  assert.deepEqual(validateDocumentDetails(licence, { number: "KAN123", expiry: isoInDays(200) }), {});
});

function fullApplication(vehicleType = "keke") {
  const v = (expiry) => ({ files: ["a.jpg"], status: "approved", uploadedAt: new Date(), ...(expiry ? { expiry } : {}) });
  const documents = {};
  for (const d of documentsFor(vehicleType, true)) if (d.required(vehicleType, true)) documents[d.kind] = { kind: d.kind, current: v(d.needsExpiry ? isoInDays(300) : undefined), history: [] };
  return {
    status: "approved",
    vehicleType,
    personal: { fullName: "Abubakar Musa", dateOfBirth: "1990-05-01", gender: "male", address: "12 Gidan Igwai Road", lga: "Sokoto North", nin: "12345678901", email: "" },
    vehicle: { make: "Bajaj", model: "RE", year: "2019", colour: "Green", plate: "SKT 123 AB", ownsVehicle: true },
    guarantor: { fullName: "Aliyu Musa", phone: "08061234567", relationship: "Brother or sister", address: "4 Kofar Rini, Sokoto" },
    bank: { bankName: "Jaiz Bank", accountNumber: "0123456789", accountName: "Abubakar Musa" },
    documents,
    timeline: [],
  };
}

test("driver rules: what's missing before submitting", () => {
  const app = fullApplication();
  assert.deepEqual(missingSections(app, "+2348031234567"), []);
  assert.deepEqual(missingSections(app, "+2348061234567"), ["Guarantor"]); // guarantor used the driver's own phone
  const noLicence = { ...app, documents: { ...app.documents, licence: undefined } };
  assert.deepEqual(missingSections(noLicence), ["Driver's licence"]);
  assert.deepEqual(missingSections({}).slice(0, 3), ["Vehicle type", "Personal details", "Vehicle details"]);
});

test("driver rules: expired or unapproved documents stop driving", () => {
  const app = fullApplication("car");
  assert.deepEqual(drivingBlockers(app), []);
  app.documents.insurance.current.expiry = isoInDays(-2);
  assert.deepEqual(drivingBlockers(app).map((b) => [b.kind, b.reason]), [["insurance", "expired"]]);
  // A renewal waiting for review doesn't block while the old one is still valid.
  app.documents.insurance = { kind: "insurance", current: { files: ["n.jpg"], status: "pending", expiry: isoInDays(365) }, history: [{ files: ["o.jpg"], status: "approved", expiry: isoInDays(5) }] };
  assert.deepEqual(drivingBlockers(app), []);
  app.documents.licence.current.status = "pending";
  assert.deepEqual(drivingBlockers(app).map((b) => [b.kind, b.reason]), [["licence", "not approved yet"]]);
});

test("serializers: shapes the app expects", () => {
  assert.deepEqual(placeDTO({ slug: "zabira-mall", name: "Zabira Mall", subtitle: "Shopping", category: "shopping", location: { latitude: 13.02, longitude: 5.22 } }), {
    id: "zabira-mall", name: "Zabira Mall", subtitle: "Shopping", category: "shopping", location: { latitude: 13.02, longitude: 5.22 },
  });
  const app = fullApplication();
  app.recordId = "CR-DRV-2026-000001";
  app.documents = new Map(Object.entries(app.documents));
  app.timeline = [{ at: new Date("2026-10-01T10:00:00Z"), event: "Application started" }];
  const dto = applicationDTO(app);
  assert.equal(dto.recordId, "CR-DRV-2026-000001");
  assert.equal(dto.status, "approved");
  assert.match(dto.documents.licence.current.files[0], /\/files\/a\.jpg\?exp=\d+&sig=/);
  assert.deepEqual(dto.timeline, [{ at: "2026-10-01T10:00:00.000Z", event: "Application started" }]);
  const trip = tripSummaryDTO({ _id: "r1", pickup: { name: "A" }, destination: { name: "B" }, rideType: "keke", fare: 1500, distanceKm: 3, paymentMethod: "cash", completedAt: new Date("2026-10-02T09:00:00Z"), createdAt: new Date() }, "Musa");
  assert.equal(trip.fare, 1500);
});
