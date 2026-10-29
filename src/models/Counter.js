import mongoose from "mongoose";

/** Sequential numbers, e.g. for official driver record IDs. */
const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.model("Counter", CounterSchema);

/** Next number in a sequence, atomically. */
export async function nextSeq(name) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return c.seq;
}
