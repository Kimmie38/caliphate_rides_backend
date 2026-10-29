// The admin dashboard: sign-in, the sidebar, and a small hash router (#/fares, #/drivers/123 …).
import { api, attempt, auth, clear, h, icon, spinner, toast } from "./lib.js";

const PAGES = [
  { path: "", label: "Overview", icon: "home", load: () => import("./views/overview.js") },
  { path: "fares", label: "Fares & commission", icon: "tag", load: () => import("./views/fares.js") },
  { path: "places", label: "Map places", icon: "pin", load: () => import("./views/places.js") },
  { path: "drivers", label: "Drivers", icon: "id", load: () => import("./views/drivers.js"), count: "review" },
  { path: "money", label: "Money & payouts", icon: "money", load: () => import("./views/money.js"), count: "payouts" },
  { path: "rides", label: "Rides", icon: "route", load: () => import("./views/rides.js") },
  { path: "riders", label: "Riders", icon: "people", load: () => import("./views/riders.js") },
  { path: "admins", label: "Admins", icon: "shield", load: () => import("./views/admins.js"), owner: true },
];

const root = document.getElementById("root");
const ctx = { admin: null, settings: null };
let cleanup = null;
let countsTimer = null;

auth.onSignedOut(() => showLogin());

async function boot() {
  if (!auth.token) return showLogin();
  try {
    const [{ admin }, settings] = await Promise.all([api("/me"), api("/settings")]);
    ctx.admin = admin;
    ctx.settings = settings;
    showShell();
  } catch {
    showLogin();
  }
}

// ---------- sign in ----------

function showLogin() {
  clearInterval(countsTimer);
  if (cleanup) { cleanup(); cleanup = null; }
  const email = h("input", { class: "input", type: "email", autocomplete: "username", required: true, placeholder: "you@caliphaterides.ng" });
  const password = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true });
  const error = h("div", { class: "notice red hidden", role: "alert" });
  const submit = h("button", { class: "btn", type: "submit" }, "Sign in");
  clear(root, h("div", { class: "login" },
    h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault();
      error.classList.add("hidden");
      submit.disabled = true;
      try {
        const r = await api("/auth/login", { method: "POST", body: { email: email.value, password: password.value } });
        auth.set(r.token);
        await boot();
      } catch (err) {
        clear(error, err.message);
        error.classList.remove("hidden");
      } finally {
        submit.disabled = false;
      }
    } },
    h("img", { src: "logo.png", alt: "" }),
    h("div", { style: { textAlign: "center" } }, h("h1", {}, "Caliphate Rides"), h("p", { class: "muted" }, "Admin dashboard")),
    error,
    h("label", { class: "field" }, "Email", email),
    h("label", { class: "field" }, "Password", password),
    submit,
    h("p", { class: "muted small", style: { textAlign: "center" } }, "The first admin is created with npm run seed."))));
  email.focus();
}

// ---------- the shell ----------

let side;
let main;
const counts = {};

function showShell() {
  const isOwner = ctx.admin.role === "owner";
  side = h("aside", { class: "side", "aria-label": "Main menu" },
    h("div", { class: "brand" }, h("img", { src: "logo.png", alt: "" }), h("div", {}, h("b", {}, "Caliphate Rides"), h("span", {}, "Admin"))),
    h("nav", { class: "nav" }, PAGES.filter((p) => !p.owner || isOwner).map((p) =>
      h("a", { href: `#/${p.path}`, "data-path": p.path, onclick: () => side.classList.remove("open") }, icon(p.icon), p.label, p.count ? h("span", { class: "count hidden", "data-count": p.count }) : null))),
    h("div", { class: "me" },
      h("b", {}, ctx.admin.name || ctx.admin.email),
      h("span", { class: "muted" }, ctx.admin.email),
      h("button", { class: "btn quiet small", onclick: () => { auth.clear(); showLogin(); } }, icon("logout"), "Sign out")),
  );
  main = h("main", { class: "main", id: "main", tabindex: "-1" });
  const topbar = h("div", { class: "topbar" },
    h("button", { class: "btn quiet icon", "aria-label": "Menu", onclick: () => side.classList.toggle("open") }, icon("menu")),
    h("b", {}, "Caliphate Rides"));
  clear(root, h("div", { class: "shell" }, side, h("div", {}, topbar, main)));
  if (!ctx.settings.paymentsReady) {
    main.before(h("div", { class: "notice", style: { margin: "16px 32px 0" } },
      "Flutterwave isn't connected yet (FLW_SECRET_KEY), so card payments, top-ups, bank checks and driver withdrawals are off. Cash and transfer rides work."));
  }
  refreshCounts();
  countsTimer = setInterval(refreshCounts, 60_000);
  route();
}

export async function refreshCounts() {
  try {
    const s = await api("/stats");
    counts.review = s.drivers.waitingForReview;
    counts.payouts = s.payoutsWaiting;
    for (const el of side?.querySelectorAll("[data-count]") ?? []) {
      const n = counts[el.dataset.count] ?? 0;
      el.textContent = String(n);
      el.classList.toggle("hidden", !n);
    }
  } catch { /* shown on the next try */ }
}

async function route() {
  if (!main) return;
  const [path, ...params] = location.hash.replace(/^#\/?/, "").split("/");
  const page = PAGES.find((p) => p.path === path) ?? PAGES[0];
  for (const a of side.querySelectorAll("a[data-path]")) {
    if (a.dataset.path === page.path) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (cleanup) { cleanup(); cleanup = null; }
  clear(main, spinner());
  const view = await attempt(() => page.load());
  if (!view) return;
  try {
    cleanup = (await view.render(main, params.map(decodeURIComponent), ctx)) ?? null;
  } catch (err) {
    clear(main, h("div", { class: "notice red" }, err.message ?? "This page couldn't load."));
  }
  document.title = `${page.label} · Caliphate Rides Admin`;
  main.focus({ preventScroll: true });
}

window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (e) => { if (e.reason?.message) toast(e.reason.message, { error: true }); });
boot();
