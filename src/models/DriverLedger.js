import mongoose from "mongoose";

export const LEDGER_KINDS = ["fare", "commission", "withdrawal", "withdrawal_returned", "payment", "adjustment"];

/**
 * Every movement in a driver's balance. amount > 0 = money for the driver.
 *   fare                 rider paid in the app (card or wallet): the full fare goes to the driver
 *   commission           Caliphate Rides' share of a finished trip (every payment method)
 *   withdrawal           paid out to the driver's bank
 *   withdrawal_returned  a payout failed, so the money came back
 *   payment              the driver paid what they owed (Flutterwave)
 *   adjustment           an admin correction, with a reason
 */
const DriverLedgerSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
    kind: { type: String, enum: LEDGER_KINDS, required: true },
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    balanceAfter: Number,
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride" },
    withdrawal: { type: mongoose.Schema.Types.ObjectId, ref: "Withdrawal" },
    by: String, // admin email, for adjustments
    reference: { type: String, required: true, unique: true }, // stops anything being counted twice
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

DriverLedgerSchema.index({ driver: 1, createdAt: -1 });

export const DriverLedger = mongoose.model("DriverLedger", DriverLedgerSchema);
