import mongoose from "mongoose";

/** Every movement of money in a rider's wallet. amount > 0 = money in. */
const WalletTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["topup", "ride", "refund"], required: true },
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    method: String,
    ride: { type: mongoose.Schema.Types.ObjectId, ref: "Ride" },
    reference: { type: String, unique: true, sparse: true }, // stops the same payment being counted twice
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const WalletTransaction = mongoose.model("WalletTransaction", WalletTransactionSchema);
