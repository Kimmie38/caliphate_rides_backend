import { api, clear, h, naira } from "../lib.js";

export async function render(main) {
  const body = h("div");
  clear(main,
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Overview"), h("p", {}, "Today in Sokoto. Updates every 30 seconds."))),
    body);

  const draw = async () => {
    const s = await api("/stats");
    const tile = (label, value, note, href, hero) => h(href ? "a" : "div", { class: `stat${hero ? " hero" : ""}`, href },
      h("span", { class: "label" }, label), h("span", { class: "value num" }, value), note ? h("span", { class: "note" }, note) : null);
    clear(body,
      h("div", { class: "grid stats" },
        tile("Fares today", naira(s.faresToday), `${s.rides.completedToday} trips completed`, "#/money", true),
        tile("Commission today", naira(s.commissionToday), "Caliphate Rides' share", "#/money"),
        tile("Rides today", s.rides.today, `${s.rides.inProgress} in progress now`, "#/rides"),
        tile("Drivers online", s.drivers.online, `${s.drivers.approved} approved drivers`, "#/drivers"),
      ),
      h("div", { class: "section-title" }, h("h2", {}, "Needs attention")),
      h("div", { class: "grid stats" },
        tile("Waiting for review", s.drivers.waitingForReview, "Driver applications", "#/drivers"),
        tile("Changes requested", s.drivers.changesRequested, "Waiting on the driver", "#/drivers"),
        tile("Payouts on the way", s.payoutsWaiting, "Withdrawals not settled yet", "#/money"),
        tile("Riders", s.riders, "Signed up", "#/riders"),
      ),
      h("div", { class: "section-title" }, h("h2", {}, "Quick links")),
      h("div", { class: "row" },
        h("a", { class: "btn soft", href: "#/fares" }, "Change fares"),
        h("a", { class: "btn soft", href: "#/places" }, "Add a place to the map"),
        h("a", { class: "btn soft", href: "#/drivers" }, "Review drivers")),
    );
  };
  await draw();
  const t = setInterval(() => draw().catch(() => {}), 30_000);
  return () => clearInterval(t);
}
