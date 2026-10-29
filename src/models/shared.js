import mongoose from "mongoose";

/** GeoJSON point for MongoDB's 2dsphere index: { type: "Point", coordinates: [lng, lat] }. */
export const GeoPointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: { type: [Number], required: true, default: undefined },
  },
  { _id: false },
);

/** A plain map position as the app sends and shows it. */
export const LatLngSchema = new mongoose.Schema({ latitude: Number, longitude: Number }, { _id: false });

/** A place as the app shows it (pickup or destination). */
export const PlaceSchema = new mongoose.Schema(
  {
    id: String,
    name: { type: String, required: true },
    subtitle: String,
    category: { type: String, default: "pin" },
    location: { type: LatLngSchema, required: true },
  },
  { _id: false },
);

export const RatingSchema = new mongoose.Schema({ avg: { type: Number, default: 5 }, count: { type: Number, default: 0 } }, { _id: false });
