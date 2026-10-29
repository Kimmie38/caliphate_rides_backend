// Open to everyone, no sign-in:
//   GET /config/pricing  -> PricingConfig (fares per ride type)
//   GET /places          -> { places, updatedAt }  every place on our map, including ones the admin added
//   GET /places/popular  -> { places }             the popular ones first (older app versions)
//   GET /health          -> { ok, db }
import { Router } from "express";
import mongoose from "mongoose";
import { publicPricing } from "../lib/pricing.js";
import { placeDTO } from "../lib/serialize.js";
import { Place } from "../models/index.js";
import { getPricing } from "../services/pricing.js";

export const publicRouter = Router();

publicRouter.get("/config/pricing", async (_req, res) => {
  res.json(publicPricing(await getPricing()));
});

const appPlace = (p) => ({ ...placeDTO({ ...p, id: p.slug }), popular: !!p.popular });

publicRouter.get("/places", async (_req, res) => {
  const places = await Place.find({ active: true }).sort({ popular: -1, name: 1 }).limit(5000).lean();
  const updatedAt = places.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), new Date(0));
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ places: places.map(appPlace), updatedAt: updatedAt.toISOString() });
});

publicRouter.get("/places/popular", async (_req, res) => {
  const places = await Place.find({ active: true }).sort({ popular: -1, name: 1 }).lean();
  res.json({ places: places.map(appPlace) });
});

publicRouter.get("/health", (_req, res) => {
  const db = ["disconnected", "connected", "connecting", "disconnecting"][mongoose.connection.readyState] ?? "unknown";
  res.status(db === "connected" ? 200 : 503).json({ ok: db === "connected", db });
});
