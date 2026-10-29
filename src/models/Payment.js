import mongoose from "mongoose";

/**
 * A Flutterwave checkout we started:
 *   topup           a rider adding money to their wallet
 *   ride            a rider paying for a trip by card
 *   driver_payment  a driver paying the commission they owe
 */
const PaymentSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true }, // Flutterwave tx_ref
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["topup", "ride", "driver_payment"], required: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride" },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
    amount: { type: Number, required: true }, // naira
    status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
    provider: { type: String, default: "flutterwave" },
    providerId: String, // Flutterwave transaction id
    channel: String,
    paidAt: Date,
  },
  { timestamps: true },
);

export const Payment = mongoose.model("Payment", PaymentSchema);
