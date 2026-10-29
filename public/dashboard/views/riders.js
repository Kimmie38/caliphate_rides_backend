import { api, attempt, clear, date, dialog, h, naira, table, toast } from "../lib.js";

export async function render(main) {
  let q = "";
  const results = h("div");
  const search = h("input", { class: "input search", type: "search", placeholder: "Name or phone number", "aria-label": "Search riders" });
  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(); }, 250); });

  async function load() {
    const { riders } = await api(`/riders${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    clear(results, table([
      { label: "Rider", cell: (u) => h("b", {}, u.name || "No name yet") },
      { label: "Phone", cell: (u) => u.phone },
      { label: "Wallet", right: true, num: true, cell: (u) => naira(u.walletBalance) },
      { label: "Joined", cell: (u) => date(u.joinedAt) },
      { label: "", right: true, cell: (u) => h("div", { class: "row", style: { justifyContent: "flex-end" } },
        u.blocked ? h("span", { class: "badge red" }, "Blocked") : null,
        h("button", { class: `btn small ${u.blocked ? "soft" : "danger"}`, onclick: async (e) => {
          const btn = e.currentTarget;
          if (!u.blocked && !(await dialog({ title: `Block ${u.name || u.phone}?`, message: "They're signed out and can't book rides until you unblock them.", confirm: "Block", danger: true }))) return;
          const r = await attempt(() => api(`/riders/${u.id}/block`, { method: "POST", body: { blocked: !u.blocked } }), btn);
          if (r) { toast(r.blocked ? "Rider blocked." : "Rider unblocked."); load(); }
        } }, u.blocked ? "Unblock" : "Block")) },
    ], riders, { empty: q ? "No riders match that search." : "No riders yet." }));
  }

  clear(main, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Riders"), h("p", {}, "People who book rides.")), search), results);
  await load();
}
