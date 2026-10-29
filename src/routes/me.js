//   GET   /me           -> { user }
//   PATCH /me { name }  -> { user }
import { Router } from "express";
import { userDTO } from "../lib/serialize.js";
import { obj, text } from "../lib/validate.js";
import { requireUser } from "../middleware/auth.js";

export const meRouter = Router();
meRouter.use(requireUser);

meRouter.get("/", (req, res) => {
  res.json({ user: userDTO(req.user) });
});

meRouter.patch("/", async (req, res) => {
  const body = obj(req.body);
  if (body.name !== undefined) req.user.name = text(body.name, "Your name", { min: 2, max: 80 });
  await req.user.save();
  res.json({ user: userDTO(req.user) });
});
