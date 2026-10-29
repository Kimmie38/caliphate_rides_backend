import mongoose from "mongoose";

const RideTypeSchema = new mongoose.Schema(
  {
    id: { type: String, enum: ["keke", "car"], required: true },
    name: { type: String, required: true },
    seats: { type: Number, required: true },
    enabled: { type: Boolean, default: true },
    baseFare: { type: Number, min: 0 },
    perKm: { type: Number, min: 0 },
    minimumFare: { type: Number, min: 0 },
    ratePerKm: Number, // older settings; read once, then replaced by perKm
  },
  { _id: false },
);

/**
 * App settings the admin can change. One document per group; "pricing" holds fares, the commission
 * and payout settings (see lib/pricing.js).
 */
const ConfigSchema = new mongoose.Schema(
  {
    _id: { type: String },
    currency: { type: String, default: "NGN" },
    roundTo: Number,
    rideTypes: { type: [RideTypeSchema], default: undefined },
    commissionPercent: Number,
    owedLimit: Number,
    minWithdrawal: Number,
    ratePerKm: Number, // older settings
    updatedBy: String,
    history: {
      type: [{ at: Date, by: String, summary: String, _id: false }],
      default: undefined,
    },
  },
  { timestamps: true },
);

export const Config = mongoose.model("Config", ConfigSchema);
