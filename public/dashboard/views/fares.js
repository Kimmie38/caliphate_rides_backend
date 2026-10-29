// Fares and commission. Every number has − / + buttons and can be typed. The preview shows what riders
// pay and drivers get before anything is saved. Same formula as the server (src/lib/pricing.js).
import { api, attempt, clear, dateTime, h, icon, naira, toast } from "../lib.js";

const billableKm = (km) => Math.max(0.1, Math.round(km * 10) / 10);
function computeFare(km, t, roundTo) {
  const raw = (t.baseFare || 0) + billableKm(km) * t.perKm;
  const step = roundTo > 0 ? roundTo : 1;
  return Math.max(t.minimumFare || 0, Math.round(raw / step) * step);
}
const split = (fare, pct) => { const c = Math.round((fare * pct) / 100); return { commission: c, driver: fare - c }; };
const PREVIEW_KM = [1, 2, 3, 5, 10];

export async function render(main, _params, ctx) {
  let saved = await api("/config/pricing");
  let draft = structuredClone(strip(saved));
  const limits = ctx.settings.limits;

  function strip(p) {
    return { roundTo: p.roundTo, commissionPercent: p.commissionPercent, owedLimit: p.owedLimit, minWithdrawal: p.minWithdrawal,
      rideTypes: p.rideTypes.map(({ id, name, seats, enabled, baseFare, perKm, minimumFare }) => ({ id, name, seats, enabled, baseFare, perKm, minimumFare })) };
  }

  const changes = () => {
    const out = [];
    const s = strip(saved);
    for (const t of draft.rideTypes) {
      const o = s.rideTypes.find((x) => x.id === t.id);
      if (o.enabled !== t.enabled) out.push(`${t.name} ${t.enabled ? "on" : "off"}`);
      for (const [k, label] of [["baseFare", "base fare"], ["perKm", "per km"], ["minimumFare", "minimum"]]) {
        if (o[k] !== t[k]) out.push(`${t.name} ${label} ${naira(o[k])} → ${naira(t[k])}`);
      }
    }
    if (s.commissionPercent !== draft.commissionPercent) out.push(`Commission ${s.commissionPercent}% → ${draft.commissionPercent}%`);
    if (s.owedLimit !== draft.owedLimit) out.push(`Owed limit ${naira(s.owedLimit)} → ${naira(draft.owedLimit)}`);
    if (s.minWithdrawal !== draft.minWithdrawal) out.push(`Smallest withdrawal ${naira(s.minWithdrawal)} → ${naira(draft.minWithdrawal)}`);
    if (s.roundTo !== draft.roundTo) out.push(`Rounding ${naira(s.roundTo)} → ${naira(draft.roundTo)}`);
    return out;
  };

  /** A number with − and + buttons. get/set read and write the draft; onChange redraws previews. */
  function stepper({ label, hint, get, set, original, step, min, max, unit = "naira" }) {
    const fmt = (v) => (unit === "percent" ? `${v}%` : naira(v));
    const input = h("input", { inputmode: "numeric", "aria-label": label });
    const was = h("span", { class: "was" });
    const wrap = h("label", { class: "field" });
    const show = () => {
      input.value = unit === "percent" ? `${get()}%` : naira(get());
      const changed = get() !== original();
      wrap.classList.toggle("changed", changed);
      was.textContent = changed ? `was ${fmt(original())}` : hint ?? "";
    };
    const put = (v) => {
      const n = Math.min(max, Math.max(min, Math.round(v)));
      set(n);
      show();
      update();
    };
    input.addEventListener("focus", () => { input.value = String(get()); input.select(); });
    input.addEventListener("blur", () => { const n = Number(input.value.replace(/[^\d]/g, "")); put(Number.isFinite(n) ? n : get()); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "ArrowUp") { e.preventDefault(); put(get() + step); input.value = String(get()); }
      if (e.key === "ArrowDown") { e.preventDefault(); put(get() - step); input.value = String(get()); }
    });
    wrap.append(label,
      h("div", { class: "stepper" },
        h("button", { type: "button", "aria-label": `Reduce ${label} by ${fmt(step)}`, onclick: () => put(get() - step) }, "−"),
        input,
        h("button", { type: "button", "aria-label": `Add ${fmt(step)} to ${label}`, onclick: () => put(get() + step) }, "+")),
      was);
    show();
    redrawers.push(show);
    return wrap;
  }

  const redrawers = [];
  const previews = [];
  const body = h("div");
  const saveBar = h("div", { class: "savebar hidden", role: "region", "aria-label": "Unsaved changes" });

  function update() {
    for (const p of previews) p();
    const list = changes();
    saveBar.classList.toggle("hidden", !list.length);
    if (list.length) {
      const saveBtn = h("button", { class: "btn", onclick: () => save(saveBtn) }, icon("check"), "Save changes");
      clear(saveBar,
        h("div", {}, h("b", {}, `${list.length} unsaved change${list.length === 1 ? "" : "s"}`), h("div", { class: "small", style: { opacity: 0.8 } }, list.join(" · "))),
        h("div", { class: "row" },
          h("button", { class: "btn quiet", onclick: () => { draft = structuredClone(strip(saved)); draw(); } }, "Undo"),
          saveBtn));
    }
  }

  async function save(btn) {
    const list = changes();
    const r = await attempt(() => api("/config/pricing", { method: "PUT", body: draft }), btn);
    if (!r) return;
    saved = r;
    draft = structuredClone(strip(saved));
    toast(`Saved. New trips use these prices now (${list.length} change${list.length === 1 ? "" : "s"}).`);
    draw();
  }

  function rideTypeCard(t) {
    const orig = () => strip(saved).rideTypes.find((x) => x.id === t.id);
    const previewBody = h("tbody");
    const drawPreview = () => {
      clear(previewBody, PREVIEW_KM.map((km) => {
        const fare = computeFare(km, t, draft.roundTo);
        const was = computeFare(km, orig(), strip(saved).roundTo);
        const s = split(fare, draft.commissionPercent);
        return h("tr", {},
          h("td", {}, `${km} km`),
          h("td", { class: "right num" }, h("b", {}, naira(fare)), was !== fare ? h("div", { class: "was" }, `was ${naira(was)}`) : null),
          h("td", { class: "right num" }, naira(s.driver)),
          h("td", { class: "right num muted" }, naira(s.commission)));
      }));
      card.classList.toggle("off", !t.enabled);
    };
    previews.push(drawPreview);
    const toggle = h("input", { type: "checkbox", checked: t.enabled, onchange: (e) => { t.enabled = e.target.checked; update(); } });
    const card = h("section", { class: "card ride-type" },
      h("div", { class: "spread" },
        h("div", {}, h("h2", {}, t.name), h("p", { class: "muted small" }, `${t.seats} seats`)),
        h("label", { class: "check" }, toggle, "Riders can book")),
      h("div", { class: "fare-fields" },
        stepper({ label: "Base fare", hint: "Added to every trip", get: () => t.baseFare, set: (v) => { t.baseFare = v; }, original: () => orig().baseFare, step: 50, ...limits.baseFare }),
        stepper({ label: "Price per km", hint: "Times the road distance", get: () => t.perKm, set: (v) => { t.perKm = v; }, original: () => orig().perKm, step: 50, ...limits.perKm }),
        stepper({ label: "Minimum fare", hint: "No trip costs less", get: () => t.minimumFare, set: (v) => { t.minimumFare = v; }, original: () => orig().minimumFare, step: 50, ...limits.minimumFare })),
      h("table", { class: "preview" },
        h("thead", {}, h("tr", {}, h("th", {}, "Trip"), h("th", { class: "right" }, "Rider pays"), h("th", { class: "right" }, "Driver gets"), h("th", { class: "right" }, "Caliphate keeps"))),
        previewBody));
    drawPreview();
    return card;
  }

  function draw() {
    redrawers.length = 0;
    previews.length = 0;
    const s = () => strip(saved);
    const example = h("p", { class: "muted small" });
    previews.push(() => {
      const fare = computeFare(3, draft.rideTypes[0], draft.roundTo);
      const sp = split(fare, draft.commissionPercent);
      example.textContent = `On a ${naira(fare)} fare the driver gets ${naira(sp.driver)} and Caliphate Rides keeps ${naira(sp.commission)}.`;
    });
    const round = h("select", { class: "input", onchange: (e) => { draft.roundTo = Number(e.target.value); update(); } },
      limits.roundTo.map((v) => h("option", { value: String(v), selected: v === draft.roundTo }, v === 1 ? "Exact naira" : `Nearest ${naira(v)}`)));

    clear(body,
      h("p", { class: "muted", style: { marginBottom: 16 } },
        "Fare = base fare + (road distance × price per km), rounded, and never below the minimum. Changes apply to new trips as soon as you save; trips already booked keep their price."),
      h("div", { class: "grid two" }, draft.rideTypes.map(rideTypeCard)),
      h("div", { class: "grid two", style: { marginTop: 16 } },
        h("section", { class: "card", style: { display: "grid", gap: 14 } },
          h("h2", {}, "Commission"),
          h("p", { class: "muted small" }, "Caliphate Rides' share of every fare. Card and wallet fares are paid to Caliphate Rides, and the driver's share goes to their balance. For cash and transfer trips the driver keeps the money, and the commission is taken from their balance."),
          stepper({ label: "Commission", get: () => draft.commissionPercent, set: (v) => { draft.commissionPercent = v; }, original: () => s().commissionPercent, step: 1, unit: "percent", ...limits.commissionPercent }),
          example),
        h("section", { class: "card", style: { display: "grid", gap: 14 } },
          h("h2", {}, "Driver payments"),
          stepper({ label: "Most a driver can owe", hint: "Past this, they can't go online until they pay", get: () => draft.owedLimit, set: (v) => { draft.owedLimit = v; }, original: () => s().owedLimit, step: 500, ...limits.owedLimit }),
          stepper({ label: "Smallest withdrawal", hint: "Drivers can withdraw this much or more", get: () => draft.minWithdrawal, set: (v) => { draft.minWithdrawal = v; }, original: () => s().minWithdrawal, step: 500, ...limits.minWithdrawal }),
          h("label", { class: "field" }, "Round fares to", round, h("span", { class: "hint" }, "Easier change for cash trips")))),
      h("div", { class: "row", style: { marginTop: 16 } },
        h("button", { class: "btn quiet", onclick: () => {
          draft = structuredClone(strip({ ...saved, ...saved.defaults, rideTypes: saved.defaults.rideTypes }));
          draw();
          toast("Start values filled in. Save to use them.");
        } }, icon("refresh"), "Back to start values"),
        h("span", { class: "muted small" }, "₦500 per km, no base fare, ₦500 minimum, 15% commission")),
      h("div", { class: "section-title" }, h("h2", {}, "Change history")),
      (saved.history ?? []).length
        ? h("div", { class: "card timeline" }, saved.history.map((e) => h("div", {}, h("span", { class: "muted small" }, dateTime(e.at)), h("span", {}, h("b", {}, e.by), ": ", e.summary))))
        : h("p", { class: "muted" }, "No changes yet. Prices are at their start values."),
      saveBar,
    );
    update();
  }

  clear(main,
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Fares & commission"), h("p", {}, saved.updatedAt ? `Last changed ${dateTime(saved.updatedAt)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ""}` : "Start values: ₦500 per km, ₦500 minimum, 15% commission"))),
    body);
  draw();

  const warn = (e) => { if (changes().length) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", warn);
  return () => window.removeEventListener("beforeunload", warn);
}
