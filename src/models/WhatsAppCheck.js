import mongoose from "mongoose";

/**
 * A pending "confirm with WhatsApp": the app shows a code, the person sends it to our WhatsApp number,
 * and the webhook marks it confirmed with the number it came from. Receiving messages is free on
 * WhatsApp's official API, so this costs nothing. MongoDB deletes it once it expires.
 */
const WhatsAppCheckSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // e.g. "K4M9Q2XT", shown to the person
    secretHash: { type: String, required: true }, // only the app that started it can finish it
    purpose: { type: String, enum: ["signin", "link"], required: true }, // sign in, or add a phone to an account
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // for "link"
    status: { type: String, enum: ["pending", "confirmed", "used"], default: "pending" },
    phone: String, // the WhatsApp number it came from, once confirmed
    confirmedAt: Date,
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const WhatsAppCheck = mongoose.model("WhatsAppCheck", WhatsAppCheckSchema);
