// Small helpers shared by every page: building elements safely, calling the API, money and dates,
// toasts and dialogs. No framework: everything here is plain browser JavaScript.

// ---------- elements ----------

/**
 * h("div", { class: "card", onclick: fn }, "text", child, [more]) — text is always inserted as text,
 * never as HTML, so names typed by riders and drivers can't inject anything.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else if (k === "html") throw new Error("h(): no raw HTML");
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  tag: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  id: "M4 5h16v14H4zM8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M7 16c.8-1.5 2-2 3-2s2.2.5 3 2M15 9h3M15 13h3",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  people: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M16 3.1a4 4 0 0 1 0 7.8M22 21c0-3.1-2-5.7-5-6.6",
  money: "M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01",
  shield: "M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6z",
  menu: "M4 7h16M4 12h16M4 17h16",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  back: "M15 18 9 12l6-6",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  check: "M5 12.5 10 17 19 7",
  close: "M6 6l12 12M18 6 6 18",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
};

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", ICONS[name] ?? "");
  svg.append(p);
  return svg;
}

// ---------- the API ----------

const TOKEN_KEY = "cr.admin.token";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private window */ } },
};
let token = store.get(TOKEN_KEY);
let onSignedOut = () => {};

export const auth = {
  get token() { return token; },
  set(t) { token = t; store.set(TOKEN_KEY, t); },
  clear() { token = null; store.set(TOKEN_KEY, null); },
  onSignedOut(fn) { onSignedOut = fn; },
};

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

/** JSON request to the API (same server that serves this page). */
export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/admin${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet connection.", 0, "network");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/auth/login") {
    auth.clear();
    onSignedOut();
    throw new ApiError("Your session ended. Sign in again.", 401, "unauthorized");
  }
  if (!res.ok) throw new ApiError(data?.message ?? `Request failed (${res.status})`, res.status, data?.code);
  return data;
}

// ---------- formatting ----------

export const naira = (n) => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n ?? 0)).toLocaleString("en-NG")}`;
export const signedNaira = (n) => `${n > 0 ? "+" : ""}${naira(n)}`;
export const date = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const ago = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return date(iso);
};

const STATUS = {
  draft: ["Draft", ""], submitted: ["Waiting for review", "amber"], changes_requested: ["Changes requested", "violet"],
  approved: ["Approved", "green"], rejected: ["Rejected", "red"], suspended: ["On hold", "red"],
  searching: ["Finding driver", "amber"], accepted: ["Driver on the way", "blue"], arrived: ["Driver arrived", "blue"],
  in_progress: ["On trip", "blue"], completed: ["Completed", "green"], cancelled: ["Cancelled", ""], no_drivers: ["No drivers", "red"],
  processing: ["On its way", "amber"], successful: ["Paid out", "green"], failed: ["Failed", "red"], needs_check: ["Needs checking", "red"],
  pending: ["Pending", "amber"], paid: ["Paid", "green"],
};
export const badge = (status) => {
  const [text, tone] = STATUS[status] ?? [status, ""];
  return h("span", { class: `badge ${tone}` }, text);
};

export const PAYMENT_LABEL = { cash: "Cash", transfer: "Transfer", wallet: "Wallet", card: "Card" };
export const RIDE_TYPE_LABEL = { keke: "Keke", car: "Car" };

export const CATEGORY = {
  landmark: { label: "Landmark", color: "#006B3F" }, market: { label: "Market", color: "#A35F00" }, mosque: { label: "Mosque", color: "#0D7468" },
  school: { label: "School", color: "#2354AD" }, health: { label: "Health", color: "#BF352B" }, gov: { label: "Government", color: "#5A3EBF" },
  transport: { label: "Transport", color: "#3B4E65" }, shopping: { label: "Shopping", color: "#AD2869" }, hotel: { label: "Hotel", color: "#6A45C7" },
  airport: { label: "Airport", color: "#1D63B0" },
};

// ---------- feedback ----------

export function toast(message, { error = false } = {}) {
  const el = h("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : "status" }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), error ? 6000 : 3500);
}

/** Runs an action, showing its error as a toast. Returns the result, or undefined if it failed. */
export async function attempt(fn, button) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message ?? "Something went wrong.", { error: true });
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

/**
 * A dialog. fields: [{ name, label, type: "text"|"textarea"|"number"|"email"|"password"|"select", options, required, hint, value }].
 * Resolves with the values, or null if cancelled.
 */
export function dialog({ title, message, fields = [], confirm = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const inputs = {};
    const close = (value) => { backdrop.remove(); document.removeEventListener("keydown", onKey); resolve(value); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    const form = h("form", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title,
      onsubmit: (e) => {
        e.preventDefault();
        const values = {};
        for (const f of fields) {
          const v = inputs[f.name].value.trim();
          if (f.required && !v) { inputs[f.name].focus(); return; }
          values[f.name] = v;
        }
        close(values);
      } },
      h("h2", {}, title),
      message ? h("p", { class: "muted" }, message) : null,
      fields.map((f) => {
        const input = f.type === "textarea"
          ? h("textarea", { class: "input", name: f.name, required: f.required, placeholder: f.placeholder })
          : f.type === "select"
          ? h("select", { class: "input", name: f.name }, f.options.map((o) => h("option", { value: o.value }, o.label)))
          : h("input", { class: "input", name: f.name, type: f.type ?? "text", required: f.required, placeholder: f.placeholder, autocomplete: "off" });
        if (f.value !== undefined) input.value = f.value;
        inputs[f.name] = input;
        return h("label", { class: "field" }, f.label, input, f.hint ? h("span", { class: "hint" }, f.hint) : null);
      }),
      h("div", { class: "row", style: { justifyContent: "flex-end" } },
        h("button", { type: "button", class: "btn quiet", onclick: () => close(null) }, "Cancel"),
        h("button", { type: "submit", class: `btn${danger ? " danger" : ""}` }, confirm)),
    );
    const backdrop = h("div", { class: "backdrop", onclick: (e) => { if (e.target === backdrop) close(null); } }, form);
    document.body.append(backdrop);
    document.addEventListener("keydown", onKey);
    (Object.values(inputs)[0] ?? form.querySelector("button[type=submit]")).focus();
  });
}

export const spinner = () => h("div", { class: "spinner", role: "status", "aria-label": "Loading" });

export function table(columns, rows, { onRow, empty = "Nothing here yet." } = {}) {
  if (!rows.length) return h("div", { class: "table-wrap" }, h("div", { class: "empty" }, empty));
  return h("div", { class: "table-wrap" },
    h("table", {},
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.right ? "right" : "" }, c.label)))),
      h("tbody", {}, rows.map((r) => h("tr", { class: onRow ? "click" : "", onclick: onRow ? () => onRow(r) : undefined, tabindex: onRow ? 0 : undefined,
        onkeydown: onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined },
      columns.map((c) => h("td", { class: `${c.right ? "right" : ""} ${c.num ? "num" : ""}` }, c.cell(r))))))));
}

/** Tab-style filter buttons. */
export function tabs(options, value, onChange) {
  return h("div", { class: "tabs", role: "group" }, options.map((o) => h("button", { type: "button", "aria-pressed": String(o.value === value), onclick: () => onChange(o.value) }, o.label)));
}
