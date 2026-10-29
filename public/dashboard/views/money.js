// Money: what came in, Caliphate Rides' commission, what drivers owe, and payouts to drivers' banks.
import { api, attempt, badge, clear, dateTime, dialog, h, icon, naira, table, tabs, toast } from "../lib.js";
import { refreshCounts } from "../app.js";

const PERIODS = [{ value: "today", label: "Today" }, { value: "week", label: "Last 7 days" }, { value: "month", label: "Last 30 days" }];
const STATUSES = [
  { value: "", label: "All payouts" }, { value: "needs_check", label: "Needs checking" }, { value: "processing", label: "On its way" },
  { value: "successful", label: "Paid out" }, { value: "failed", label: "Failed" },
];

export async function render(main) {
  let period = "today";
  let status = "";
  const summary = h("div");
  const payouts = h("div");

  async function drawSummary() {
    const f = await api("/finance");
    const p = f.periods[period];
    const tile = (label, value, note, hero, href) => h(href ? "a" : "div", { class: `stat${hero ? " hero" : ""}`, href },
      h("span", { class: "label" }, label), h("span", { class: "value num" }, value), note ? h("span", { class: "note" }, note) : null);
    clear(summary,
      tabs(PERIODS, period, (v) => { period = v; drawSummary(); }),
      h("div", { class: "grid stats" },
        tile("Commission earned", naira(p.commission), `${f.settings.commissionPercent}% of ${naira(p.fares)} in fares · ${p.trips} trips`, true),
        tile("Paid in the app", naira(p.inApp), "Card and wallet fares, collected by Caliphate Rides"),
        tile("Paid to drivers directly", naira(p.direct), "Cash and transfer fares"),
        tile("Paid out to drivers", naira(p.paidOut), p.payoutFees ? `${naira(p.payoutFees)} in transfer fees` : "Withdrawals to their banks"),
        tile("Paid by drivers", naira(p.paidByDrivers), "Commission drivers paid through Flutterwave")),
      h("div", { class: "section-title" }, h("h2", {}, "Right now")),
      h("div", { class: "grid stats" },
        tile("Drivers owe", naira(f.driversOwe.total), `${f.driversOwe.drivers} driver${f.driversOwe.drivers === 1 ? "" : "s"} · limit ${naira(f.settings.owedLimit)} each`, false, "#/drivers"),
        tile("Owed to drivers", naira(f.owedToDrivers.total), `${f.owedToDrivers.drivers} driver balance${f.owedToDrivers.drivers === 1 ? "" : "s"} they can withdraw`),
        tile("Payouts on the way", naira(f.payoutsOnTheWay.total), `${f.payoutsOnTheWay.count} withdrawal${f.payoutsOnTheWay.count === 1 ? "" : "s"}`)),
      f.needsCheck ? h("div", { class: "notice red", style: { marginTop: 16 } },
        `${f.needsCheck} payout${f.needsCheck === 1 ? " needs" : "s need"} checking: Flutterwave didn't answer when we sent ${f.needsCheck === 1 ? "it" : "them"}. Look up the reference in your Flutterwave dashboard (Transfers), then mark it below.`) : null,
      h("p", { class: "muted small", style: { marginTop: 12 } },
        `Keep at least ${naira(f.owedToDrivers.total)} in your Flutterwave balance so every driver can withdraw. Payouts come out of that balance.`));
  }

  async function drawPayouts() {
    const { withdrawals } = await api(`/withdrawals${status ? `?status=${status}` : ""}`);
    clear(payouts,
      tabs(STATUSES, status, (v) => { status = v; drawPayouts(); }),
      table([
        { label: "When", cell: (w) => dateTime(w.createdAt) },
        { label: "Driver", cell: (w) => h("a", { href: `#/drivers/${w.driverId}` }, w.driverName ?? "Driver") },
        { label: "Amount", right: true, num: true, cell: (w) => naira(w.amount) },
        { label: "To", cell: (w) => h("div", {}, `${w.bank?.bankName ?? ""} ${w.bank?.accountNumber ?? ""}`, h("div", { class: "muted small" }, w.bank?.accountName ?? "")) },
        { label: "Status", cell: (w) => h("div", {}, badge(w.status), w.failureReason && w.status !== "successful" ? h("div", { class: "muted small" }, w.failureReason) : null, w.resolvedBy ? h("div", { class: "muted small" }, `by ${w.resolvedBy}`) : null) },
        { label: "Reference", cell: (w) => h("span", { class: "small num" }, w.reference) },
        { label: "", cell: (w) => ["processing", "needs_check"].includes(w.status) ? h("div", { class: "row" },
          w.providerId ? h("button", { class: "btn soft small", onclick: async (e) => {
            const r = await attempt(() => api(`/withdrawals/${w.id}/check`, { method: "POST" }), e.currentTarget);
            if (r) { toast(`Status: ${r.withdrawal.status}.`); drawPayouts(); drawSummary(); refreshCounts(); }
          } }, icon("refresh"), "Check") : null,
          w.status === "needs_check" ? h("button", { class: "btn small", onclick: async (e) => {
            const btn = e.currentTarget;
            const values = await dialog({ title: "Mark this payout", message: `Find ${w.reference} in Flutterwave → Transfers. If it was paid, mark it paid. If it isn't there or failed, mark it failed: ${naira(w.amount)} goes back to the driver's balance.`,
              fields: [
                { name: "outcome", label: "What Flutterwave shows", type: "select", options: [{ value: "successful", label: "Paid: the money arrived" }, { value: "failed", label: "Failed or not there: return the money" }] },
                { name: "note", label: "Note", required: true, placeholder: "e.g. Checked Flutterwave, transfer successful" }], confirm: "Save" });
            if (!values) return;
            const r = await attempt(() => api(`/withdrawals/${w.id}/resolve`, { method: "POST", body: { outcome: values.outcome, note: values.note } }), btn);
            if (r) { toast("Payout updated."); drawPayouts(); drawSummary(); refreshCounts(); }
          } }, "Mark…") : null) : null },
      ], withdrawals, { empty: "No payouts here." }));
  }

  clear(main,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Money & payouts"),
      h("p", {}, "Every finished trip takes the commission off the driver's balance. Card and wallet fares add the full fare to it. Drivers withdraw what's left to their bank."))),
    summary,
    h("div", { class: "section-title" }, h("h2", {}, "Driver withdrawals")),
    payouts);
  await Promise.all([drawSummary(), drawPayouts()]);
}
