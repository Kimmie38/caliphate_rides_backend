import mongoose from "mongoose";

export const WITHDRAWAL_STATUSES = ["processing", "successful", "failed", "needs_check"];

/**
 * A driver's payout to their bank through Flutterwave.
 *   processing   sent to Flutterwave, waiting for the bank
 *   successful   the money arrived
 *   failed       it didn't; the amount was returned to the driver's balance
 *   needs_check  we couldn't tell whether Flutterwave received it (network error); an admin checks the
 *                Flutterwave dashboard and marks it successful or failed
 */
const WithdrawalSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    amount: { type: Number, required: true },
    fee: Number, // Flutterwave's transfer fee (paid by Caliphate Rides)
    status: { type: String, enum: WITHDRAWAL_STATUSES, default: "processing", index: true },
    reference: { type: String, required: true, unique: true },
    providerId: String, // Flutterwave transfer id
    bank: { bankName: String, bankCode: String, accountNumber: String, accountName: String },
    failureReason: String,
    completedAt: Date,
    checkedAt: Date,
    resolvedBy: String, // admin who settled a needs_check payout
  },
  { timestamps: true },
);

export const Withdrawal = mongoose.model("Withdrawal", WithdrawalSchema);
