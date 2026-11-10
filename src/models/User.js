import mongoose from "mongoose";
import { RatingSchema } from "./shared.js";

/**
 * Everyone who uses the app: riders, and drivers (who also have a Driver record).
 * People sign in with WhatsApp (their phone number), an email code, or an SMS code.
 *  - phone: confirmed by WhatsApp or SMS, +234XXXXXXXXXX. Someone who signed in by email adds it
 *    before booking or driving (drivers and riders call each other at pickup).
 *  - signInEmail: confirmed with an emailed code; can be used to sign in.
 *  - email: contact address shown in the profile (may be the same).
 */
const UserSchema = new mongoose.Schema(
  {
    phone: { type: String }, // unique when set: see the index below
    signInEmail: { type: String, trim: true, lowercase: true, maxlength: 120 },
    name: { type: String, default: "", trim: true, maxlength: 80 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 120 },
    rating: { type: RatingSchema, default: () => ({}) }, // drivers rate riders
    language: { type: String, enum: ["en", "ha"], default: "en" }, // the app's language (English or Hausa)
    walletBalance: { type: Number, default: 0, min: 0 }, // naira
    blocked: { type: Boolean, default: false },
    lastSeenAt: Date,
  },
  { timestamps: true },
);
// Unique only when present, so accounts made by email can exist before they add a phone.
UserSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } }, name: "phone_unique_when_set" });
UserSchema.index({ signInEmail: 1 }, { unique: true, partialFilterExpression: { signInEmail: { $type: "string" } }, name: "signInEmail_unique_when_set" });

export const User = mongoose.model("User", UserSchema);
