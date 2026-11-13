import mongoose from "mongoose";
import { RatingSchema } from "./shared.js";

/**
 * Everyone who uses the app: riders, and drivers (who also have a Driver record).
 * People sign in with their phone number and a 6-digit code.
 *  - phone: +234XXXXXXXXXX. phoneCheckedBy says how it was confirmed.
 *  - email: optional contact address shown in the profile.
 *  - signInEmail: from an earlier version that allowed signing in by email; no longer used.
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
    /**
     * How the phone number was last confirmed. "sms", "support" (staff called the number) and "whatsapp" (earlier version)
     * prove the person has the SIM; "app" only proves they typed it on a phone with the app.
     */
    phoneCheckedBy: { type: String, enum: ["", "sms", "whatsapp", "support", "app", "demo"], default: "" },
    // Phones this account has been used on (random IDs the app makes; newest last, at most 5).
    devices: { type: [{ _id: false, id: String, lastSeenAt: Date }], default: [] },
    lastSeenAt: Date,
    // Set when the person deletes their account in the app: contact details are removed, trips kept.
    deletedAt: Date,
  },
  { timestamps: true },
);
// Unique only when present, so accounts made by email can exist before they add a phone.
UserSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } }, name: "phone_unique_when_set" });
UserSchema.index({ signInEmail: 1 }, { unique: true, partialFilterExpression: { signInEmail: { $type: "string" } }, name: "signInEmail_unique_when_set" });

export const User = mongoose.model("User", UserSchema);
