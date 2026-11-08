import mongoose from "mongoose";

/**
 * An online checkout we started (Monnify or Flutterwave):
 *   topup           a rider adding money to their wallet
 *   ride            a rider paying for a trip by card
 *   driver_payment  a driver paying the commission they owe
 */
const PaymentSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true }, // our reference (Flutterwave tx_ref / Monnify paymentReference)
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["topup", "ride", "driver_payment"], required: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride" },
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
    amount: { type: Number, required: true }, // naira
    status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
    provider: { type: String, default: "flutterwave" }, // "monnify" or "flutterwave": checked with the same one
    providerId: String, // the provider's transaction id / reference
    channel: String,
    paidAt: Date,
  },
  { timestamps: true },
);

export const Payment = mongoose.model("Payment", PaymentSchema);
