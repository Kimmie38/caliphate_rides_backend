import mongoose from "mongoose";
import { LatLngSchema, PlaceSchema } from "./shared.js";

export const RIDE_STATUSES = ["searching", "accepted", "arrived", "in_progress", "completed", "cancelled", "no_drivers"];
export const PAYMENT_METHODS = ["wallet", "card", "cash", "transfer"];

const RideSchema = new mongoose.Schema(
  {
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", index: true },
    status: { type: String, enum: RIDE_STATUSES, default: "searching", index: true },

    pickup: { type: PlaceSchema, required: true },
    destination: { type: PlaceSchema, required: true },
    rideType: { type: String, enum: ["keke", "car"], required: true },

    // Price, fixed when the ride is requested
    distanceKm: { type: Number, required: true }, // billable km (0.1 km steps)
    durationMin: Number,
    baseFare: { type: Number, default: 0 },
    ratePerKm: { type: Number, required: true },
    minimumFare: { type: Number, default: 0 },
    fare: { type: Number, required: true }, // naira, what the rider pays

    // The split, fixed at booking so later price changes don't affect it
    commissionPercent: { type: Number, default: 0 },
    commission: { type: Number, default: 0 }, // Caliphate Rides' share
    driverEarning: Number, // fare − commission
    route: { type: [LatLngSchema], default: [] },

    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: ["pending", "paid"], default: "pending" },
    paidAt: Date,
    paidVia: String, // e.g. "wallet", "flutterwave", "driver confirmed cash"

    // Matching: the driver currently being asked, and drivers who said no or didn't answer
    offer: { driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" }, expiresAt: Date },
    declinedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    searchUntil: Date,

    acceptedAt: Date,
    arrivedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelledBy: { type: String, enum: ["rider", "driver", "system"] },
    cancelReason: String,

    riderRating: { stars: Number, comment: String }, // the rider's rating of the driver
    lastDriverPosition: { location: LatLngSchema, heading: Number, at: Number },
  },
  { timestamps: true },
);

RideSchema.index({ rider: 1, createdAt: -1 });
RideSchema.index({ driver: 1, completedAt: -1 });

export const Ride = mongoose.model("Ride", RideSchema);
