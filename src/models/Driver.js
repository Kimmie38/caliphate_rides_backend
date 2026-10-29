import mongoose from "mongoose";
import { DOCUMENT_KINDS } from "../lib/driverRules.js";
import { GeoPointSchema, RatingSchema } from "./shared.js";

const VersionSchema = new mongoose.Schema(
  {
    files: { type: [String], default: [] }, // stored file names (served through signed links)
    number: String,
    expiry: String, // YYYY-MM-DD
    uploadedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewNote: String,
    reviewedBy: String,
    reviewedAt: Date,
  },
  { _id: false },
);

const DocumentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: DOCUMENT_KINDS, required: true },
    current: VersionSchema,
    history: { type: [VersionSchema], default: [] }, // older versions, newest first
  },
  { _id: false },
);

const TimelineSchema = new mongoose.Schema({ at: { type: Date, default: Date.now }, event: String, by: String }, { _id: false });

/**
 * A driver: their official onboarding record (personal details, vehicle, documents with every
 * version kept, guarantor, bank, declaration, review history) plus their live state while driving.
 */
const DriverSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    recordId: { type: String, unique: true, sparse: true }, // CR-DRV-2026-000123
    status: {
      type: String,
      enum: ["draft", "submitted", "changes_requested", "approved", "rejected", "suspended"],
      default: "draft",
      index: true,
    },
    vehicleType: { type: String, enum: ["keke", "car"] },
    personal: {
      fullName: { type: String, default: "" },
      dateOfBirth: { type: String, default: "" },
      gender: { type: String, enum: ["", "male", "female"], default: "" },
      address: { type: String, default: "" },
      lga: { type: String, default: "" },
      nin: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    vehicle: {
      make: { type: String, default: "" },
      model: { type: String, default: "" },
      year: { type: String, default: "" },
      colour: { type: String, default: "" },
      plate: { type: String, default: "" },
      ownsVehicle: { type: Boolean, default: true },
    },
    guarantor: {
      fullName: { type: String, default: "" },
      phone: { type: String, default: "" },
      relationship: { type: String, default: "" },
      address: { type: String, default: "" },
    },
    bank: {
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      accountName: { type: String, default: "" },
      // Checked with the bank through Flutterwave before any payout
      bankCode: String,
      verifiedName: String, // the name the bank has on the account
      verifiedAt: Date,
      nameMatches: Boolean, // the bank's name matches the driver's
      approvedBy: String, // an admin accepted a name that didn't match automatically
      verifyError: String,
    },
    documents: { type: Map, of: DocumentSchema, default: () => new Map() },
    declaration: { signedName: String, signedAt: Date },
    reviewNote: String,
    timeline: { type: [TimelineSchema], default: [] }, // newest first
    submittedAt: Date,
    approvedAt: Date,

    // Performance
    rating: { type: RatingSchema, default: () => ({}) },
    tripsCount: { type: Number, default: 0 },

    // Money. Positive = Caliphate Rides owes the driver (they can withdraw it).
    // Negative = the driver owes commission from cash and transfer trips.
    balance: { type: Number, default: 0 },

    // Live state
    online: { type: Boolean, default: false },
    location: { type: GeoPointSchema, default: undefined },
    heading: { type: Number, default: 0 },
    lastSeenAt: Date,
    currentRide: { type: mongoose.Schema.Types.ObjectId, ref: "Ride", default: null },
  },
  { timestamps: true },
);

// Finding nearby free drivers fast.
DriverSchema.index({ location: "2dsphere" });
DriverSchema.index({ online: 1, status: 1, vehicleType: 1, currentRide: 1 });
DriverSchema.index({ balance: 1 });

export const Driver = mongoose.model("Driver", DriverSchema);
