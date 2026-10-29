import { api, attempt, clear, dateTime, dialog, h, icon, table, toast } from "../lib.js";

export async function render(main, _params, ctx) {
  const results = h("div");

  async function load() {
    const { admins } = await api("/admins");
    clear(results, table([
      { label: "Name", cell: (a) => h("b", {}, a.name || "—") },
      { label: "Email", cell: (a) => a.email },
      { label: "Role", cell: (a) => h("span", { class: `badge ${a.role === "owner" ? "green" : ""}` }, a.role === "owner" ? "Owner" : "Admin") },
      { label: "Last sign-in", cell: (a) => dateTime(a.lastLoginAt) },
      { label: "", right: true, cell: (a) => a.id === ctx.admin.id || a.role === "owner" ? null : h("button", { class: `btn small ${a.active ? "danger" : "soft"}`, onclick: async (e) => {
        const r = await attempt(() => api(`/admins/${a.id}/active`, { method: "POST", body: { active: !a.active } }), e.currentTarget);
        if (r) { toast(r.admin.active ? "Access restored." : "Access removed."); load(); }
      } }, a.active ? "Remove access" : "Restore access") },
    ], admins));
  }

  const add = h("button", { class: "btn", onclick: async () => {
    const v = await dialog({ title: "Add an admin", message: "They can review drivers, change fares and places, and see payouts. Only you can add or remove admins.",
      fields: [{ name: "name", label: "Name" }, { name: "email", label: "Email", type: "email", required: true }, { name: "password", label: "Password (10+ characters)", type: "password", required: true, hint: "Share it with them privately." }],
      confirm: "Add admin" });
    if (!v) return;
    const r = await attempt(() => api("/admins", { method: "POST", body: v }), add);
    if (r) { toast(`${r.admin.email} can sign in now.`); load(); }
  } }, icon("plus"), "Add admin");

  clear(main, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Admins"), h("p", {}, "Who can use this dashboard.")), add), results);
  await load();
}
