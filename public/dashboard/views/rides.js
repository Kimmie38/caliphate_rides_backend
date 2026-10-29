import { PAYMENT_LABEL, RIDE_TYPE_LABEL, api, badge, clear, dateTime, h, naira, table, tabs } from "../lib.js";

const FILTERS = [
  { value: "", label: "All" }, { value: "searching", label: "Finding driver" }, { value: "in_progress", label: "On trip" },
  { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "no_drivers", label: "No drivers" },
];

export async function render(main) {
  let status = "";
  const results = h("div");
  const filterBar = h("div");

  async function load() {
    clear(filterBar, tabs(FILTERS, status, (v) => { status = v; load(); }));
    const { rides } = await api(`/rides${status ? `?status=${status}` : ""}`);
    clear(results, table([
      { label: "When", cell: (r) => dateTime(r.createdAt) },
      { label: "Trip", cell: (r) => h("div", {}, h("b", {}, `${r.pickup} → ${r.destination}`), h("div", { class: "muted small" }, `${RIDE_TYPE_LABEL[r.rideType]} · ${r.distanceKm.toFixed(1)} km`)) },
      { label: "Rider", cell: (r) => h("div", {}, r.rider.name || "Rider", h("div", { class: "muted small" }, r.rider.phone)) },
      { label: "Driver", cell: (r) => (r.driver ? h("a", { href: `#/drivers/${r.driver.id}` }, r.driver.name, h("div", { class: "muted small" }, r.driver.plate)) : "—") },
      { label: "Fare", right: true, num: true, cell: (r) => h("div", {}, h("b", {}, naira(r.fare)), r.commission ? h("div", { class: "muted small" }, `${naira(r.commission)} commission`) : null) },
      { label: "Payment", cell: (r) => h("div", { class: "row", style: { gap: 6 } }, PAYMENT_LABEL[r.paymentMethod], r.status === "completed" ? badge(r.paymentStatus) : null) },
      { label: "Status", cell: (r) => badge(r.status) },
    ], rides, { empty: "No rides here yet." }));
  }

  clear(main, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Rides"), h("p", {}, "The latest 200 trips."))), filterBar, results);
  await load();
  const t = setInterval(() => load().catch(() => {}), 20_000);
  return () => clearInterval(t);
}
