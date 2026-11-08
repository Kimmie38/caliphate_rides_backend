//   GET  /wallet                    -> { balance, transactions }
//   POST /wallet/topup { amount }   -> { checkoutUrl }   (Monnify / Flutterwave checkout)
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { paymentsReady } from "../lib/paymentProvider.js";
import { walletTxDTO } from "../lib/serialize.js";
import { int } from "../lib/validate.js";
import { requireUser } from "../middleware/auth.js";
import { Payment, User, WalletTransaction } from "../models/index.js";
import { settlePayment, startCheckout } from "../services/payments.js";

export const walletRouter = Router();
walletRouter.use(requireUser);

walletRouter.get("/", async (req, res) => {
  // A top-up that was paid but whose webhook hasn't arrived yet (or was missed): ask the provider now.
  const waiting = await Payment.find({ user: req.user._id, kind: "topup", status: "pending", createdAt: { $gte: new Date(Date.now() - 2 * 3600_000) } }).limit(3);
  if (waiting.length && paymentsReady()) {
    await Promise.all(waiting.map((p) => settlePayment(p.reference).catch(() => null)));
    req.user = await User.findById(req.user._id);
  }
  const tx = await WalletTransaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ balance: req.user.walletBalance, transactions: tx.map(walletTxDTO) });
});

walletRouter.post("/topup", async (req, res) => {
  const amount = int(req.body?.amount, "Amount", { min: 100, max: 500_000 });
  const reference = `CR-TOP-${req.user._id}-${randomBytes(4).toString("hex")}`;
  const { checkoutUrl } = await startCheckout({
    payment: { reference, user: req.user._id, kind: "topup", amount },
    customer: { user: req.user, name: req.user.name },
    description: "Wallet top-up",
    meta: { kind: "topup", userId: req.user._id.toString() },
  });
  res.json({ checkoutUrl });
});
