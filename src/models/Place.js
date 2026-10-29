import mongoose from "mongoose";
import { LatLngSchema } from "./shared.js";

export const PLACE_CATEGORIES = ["landmark", "market", "mosque", "school", "health", "gov", "transport", "shopping", "hotel", "airport"];

/**
 * Places on our map: the Sokoto landmarks we start with, plus any the admin adds (streets, shops,
 * estates the map doesn't know). They show up in the app's search and as labels on its map.
 */
const PlaceSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    subtitle: String,
    category: { type: String, default: "landmark" },
    location: { type: LatLngSchema, required: true },
    popular: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    source: { type: String, enum: ["seed", "admin"], default: "admin" },
    addedBy: String, // admin email
  },
  { timestamps: true },
);

export const Place = mongoose.model("Place", PlaceSchema);
