//   GET  /wallet                    -> { balance, transactions }
//   POST /wallet/topup { amount }   -> { checkoutUrl }   (Flutterwave checkout)
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { createCheckout, paymentEmail } from "../lib/flutterwave.js";
import { walletTxDTO } from "../lib/serialize.js";
import { int } from "../lib/validate.js";
import { requireUser } from "../middleware/auth.js";
import { Payment, WalletTransaction } from "../models/index.js";

export const walletRouter = Router();
walletRouter.use(requireUser);

walletRouter.get("/", async (req, res) => {
  const tx = await WalletTransaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ balance: req.user.walletBalance, transactions: tx.map(walletTxDTO) });
});

walletRouter.post("/topup", async (req, res) => {
  const amount = int(req.body?.amount, "Amount", { min: 100, max: 500_000 });
  const reference = `CR-TOP-${req.user._id}-${randomBytes(4).toString("hex")}`;
  await Payment.create({ reference, user: req.user._id, kind: "topup", amount });
  const { checkoutUrl } = await createCheckout({
    reference,
    amountNaira: amount,
    customer: { email: paymentEmail(req.user), name: req.user.name, phone: req.user.phone },
    description: "Wallet top-up",
    meta: { kind: "topup", userId: req.user._id.toString() },
  });
  res.json({ checkoutUrl });
});
