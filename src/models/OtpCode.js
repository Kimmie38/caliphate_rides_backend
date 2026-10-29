import mongoose from "mongoose";

/** A pending sign-in code. MongoDB deletes it automatically once it expires. */
const OtpCodeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, expires: 0 }, // TTL index
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const OtpCode = mongoose.model("OtpCode", OtpCodeSchema);
