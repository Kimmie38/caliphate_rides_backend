import mongoose from "mongoose";
import { RatingSchema } from "./shared.js";

/** Everyone who signs in with a phone number: riders, and drivers (who also have a Driver record). */
const UserSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true }, // +234XXXXXXXXXX
    name: { type: String, default: "", trim: true, maxlength: 80 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 120 },
    rating: { type: RatingSchema, default: () => ({}) }, // drivers rate riders
    walletBalance: { type: Number, default: 0, min: 0 }, // naira
    blocked: { type: Boolean, default: false },
    lastSeenAt: Date,
  },
  { timestamps: true },
);

export const User = mongoose.model("User", UserSchema);
