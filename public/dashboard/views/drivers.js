// Drivers: applications to review, the official record, documents, bank account and balance.
import { RIDE_TYPE_LABEL, api, attempt, badge, clear, date, dateTime, dialog, h, icon, naira, signedNaira, table, tabs, toast } from "../lib.js";
import { refreshCounts } from "../app.js";

const FILTERS = [
  { value: "submitted", label: "Waiting for review" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "On hold" },
  { value: "owing", label: "Owe commission" },
  { value: "rejected", label: "Rejected" },
  { value: "draft", label: "Still filling in" },
  { value: "", label: "All" },
];

export async function render(main, params) {
  if (params[0]) return renderDriver(main, params[0]);
  let status = sessionStorage.getItem("cr.drivers.filter") ?? "submitted";
  let q = "";
  const results = h("div");
  const filterBar = h("div");
  const search = h("input", { class: "input search", type: "search", placeholder: "Name, record number or plate", "aria-label": "Search drivers" });
  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = search.value.trim(); load(); }, 250); });

  async function load() {
    try { sessionStorage.setItem("cr.drivers.filter", status); } catch { /* ignore */ }
    clear(filterBar, tabs(FILTERS, status, (v) => { status = v; load(); }));
    const qs = new URLSearchParams();
    if (status === "owing") qs.set("owing", "1");
    else if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    const { drivers } = await api(`/drivers?${qs}`);
    clear(results, table([
      { label: "Driver", cell: (d) => h("div", {}, h("b", {}, d.name || "No name yet"), h("div", { class: "muted small" }, d.recordId ?? "")) },
      { label: "Phone", cell: (d) => d.phone },
      { label: "Vehicle", cell: (d) => [RIDE_TYPE_LABEL[d.vehicleType] ?? "—", d.plate ? ` · ${d.plate}` : ""].join("") },
      { label: "Status", cell: (d) => h("div", { class: "row", style: { gap: 6 } }, badge(d.status), d.online ? h("span", { class: "badge green" }, h("span", { class: "dot" }), "Online") : null) },
      { label: "Trips", right: true, num: true, cell: (d) => d.trips },
      { label: "Balance", right: true, num: true, cell: (d) => h("span", { class: d.balance < 0 ? "neg" : d.balance > 0 ? "pos" : "" }, naira(d.balance)) },
      { label: "Sent", cell: (d) => (d.submittedAt ? date(d.submittedAt) : "—") },
    ], drivers, { onRow: (d) => { location.hash = `#/drivers/${d.id}`; }, empty: q ? "No drivers match that search." : "No drivers here." }));
  }

  clear(main,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Drivers"), h("p", {}, "Review applications, check documents and manage balances.")), search),
    filterBar, results);
  await load();
}

// ---------- one driver ----------

async function renderDriver(main, id) {
  const body = h("div");
  clear(main, h("a", { class: "back", href: "#/drivers" }, icon("back"), "All drivers"), body);

  const act = async (path, payload, btn, done) => {
    const r = await attempt(() => api(`/drivers/${id}${path}`, { method: "POST", body: payload }), btn);
    if (r) { toast(done); draw(r.driver); refreshCounts(); }
  };

  const REVIEW = [
    { action: "approve", label: "Approve to drive", from: ["submitted", "changes_requested", "rejected"], tone: "" },
    { action: "request_changes", label: "Ask for changes", from: ["submitted"], tone: "soft", note: "What should they fix? They'll see this in the app." },
    { action: "reject", label: "Reject", from: ["submitted", "changes_requested"], tone: "danger", note: "Why? They'll see this in the app." },
    { action: "suspend", label: "Put on hold", from: ["approved"], tone: "danger", note: "Why? They'll see this in the app and go offline." },
    { action: "reinstate", label: "Reinstate", from: ["suspended"], tone: "" },
  ];

  function draw(d) {
    const p = d.personal, v = d.vehicle, g = d.guarantor, m = d.money, b = m.bank;
    const kv = (pairs) => h("dl", { class: "kv" }, pairs.filter(Boolean).map(([k, val]) => [h("dt", {}, k), h("dd", {}, val || "—")]));

    const reviewButtons = REVIEW.filter((r) => r.from.includes(d.status)).map((r) => h("button", { class: `btn ${r.tone}`, onclick: async (e) => {
      const btn = e.currentTarget;
      const values = await dialog({
        title: `${r.label}: ${p.fullName || "this driver"}`,
        message: r.action === "approve" ? "Their documents that are waiting will be approved too. They can go online straight away." : undefined,
        fields: r.note ? [{ name: "note", label: r.note, type: "textarea", required: true }] : [],
        confirm: r.label, danger: r.tone === "danger",
      });
      if (values) act("/review", { action: r.action, note: values.note }, btn, `${p.fullName || "Driver"}: ${r.label.toLowerCase()} done.`);
    } }, r.label));

    const docs = Object.values(d.documents ?? {});
    clear(body,
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "row" }, h("h1", {}, p.fullName || "No name yet"), badge(d.status), d.online ? h("span", { class: "badge green" }, h("span", { class: "dot" }), "Online") : null),
          h("p", {}, `${d.recordId} · ${d.phone} · ${RIDE_TYPE_LABEL[d.vehicleType] ?? "No vehicle type"} · ${d.trips} trips · ★ ${Number(d.rating).toFixed(1)}`)),
        h("div", { class: "row" }, reviewButtons)),
      d.reviewNote ? h("div", { class: "notice", style: { marginBottom: 16 } }, `Note to driver: ${d.reviewNote}`) : null,
      d.status === "approved" && d.blockers?.length ? h("div", { class: "notice red", style: { marginBottom: 16 } },
        `Can't go online: ${d.blockers.map((x) => `${x.title} ${x.reason}`).join(", ")}.`) : null,

      h("div", { class: "grid two" },
        h("section", { class: "card", style: { display: "grid", gap: 12 } }, h("h2", {}, "Personal"),
          kv([["Full name", p.fullName], ["Date of birth", p.dateOfBirth], ["Gender", p.gender], ["NIN", p.nin], ["Address", p.address], ["LGA", p.lga], ["Email", p.email]])),
        h("section", { class: "card", style: { display: "grid", gap: 12 } }, h("h2", {}, "Vehicle"),
          kv([["Type", RIDE_TYPE_LABEL[d.vehicleType]], ["Make and model", [v.make, v.model].filter(Boolean).join(" ")], ["Year", v.year], ["Colour", v.colour], ["Plate", v.plate], ["Owner", v.ownsVehicle ? "The driver" : "Someone else"]])),
        h("section", { class: "card", style: { display: "grid", gap: 12 } }, h("h2", {}, "Guarantor"),
          kv([["Name", g.fullName], ["Phone", g.phone], ["Relationship", g.relationship], ["Address", g.address]])),
        bankCard(d, b, act)),

      h("div", { class: "section-title" }, h("h2", {}, "Documents")),
      docs.length ? h("div", { class: "docs" }, docs.map((doc) => docCard(doc, act))) : h("p", { class: "muted" }, "No documents uploaded yet."),

      moneySection(d, m, act),

      h("div", { class: "section-title" }, h("h2", {}, "Record history")),
      h("div", { class: "card timeline" }, (d.timeline ?? []).map((e) => h("div", {}, h("span", { class: "muted small" }, dateTime(e.at)), h("span", {}, e.event, e.by ? h("span", { class: "muted" }, ` · ${e.by}`) : null)))),
      d.declaration ? h("p", { class: "muted small", style: { marginTop: 10 } }, `Declaration signed as "${d.declaration.signedName}" on ${dateTime(d.declaration.signedAt)}.`) : null,
    );
  }

  draw((await api(`/drivers/${id}`)).driver);
}

function bankCard(d, b, act) {
  let status;
  if (b.verifiedName && (b.nameMatches || b.approvedBy)) status = h("div", { class: "notice green" }, `Checked with the bank: ${b.verifiedName}${b.approvedBy ? ` (accepted by ${b.approvedBy})` : ""}. Withdrawals are allowed.`);
  else if (b.verifiedName) status = h("div", { class: "notice" }, `The bank says this account belongs to ${b.verifiedName}, which doesn't match ${d.personal.fullName}. Withdrawals are blocked until you accept it.`);
  else status = h("div", { class: "notice" }, b.verifyError ?? "Not checked with the bank yet. It's checked when the driver saves it, or on their first withdrawal.");
  return h("section", { class: "card", style: { display: "grid", gap: 12 } },
    h("h2", {}, "Bank account (for payouts)"),
    h("dl", { class: "kv" }, h("dt", {}, "Bank"), h("dd", {}, b.bankName || "—"), h("dt", {}, "Account number"), h("dd", { class: "num" }, b.accountNumber || "—"), h("dt", {}, "Name given"), h("dd", {}, b.accountName || "—")),
    status,
    h("div", { class: "row" },
      h("button", { class: "btn soft small", onclick: (e) => act("/bank/verify", {}, e.currentTarget, "Checked with the bank.") }, icon("refresh"), "Check with the bank"),
      b.verifiedName && !b.nameMatches && !b.approvedBy ? h("button", { class: "btn small", onclick: async (e) => {
        const btn = e.currentTarget;
        const values = await dialog({ title: "Accept this account?", message: `Only if you've confirmed that ${b.verifiedName} is this driver's own account (e.g. a different spelling, or a middle name).`, fields: [{ name: "note", label: "How did you confirm it?", required: true }], confirm: "Accept account" });
        if (values) act("/bank/approve", values, btn, "Account accepted.");
      } }, "Accept this name") : null));
}

function docCard(doc, act) {
  const c = doc.current;
  if (!c) return null;
  const title = doc.kind.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
  return h("div", { class: "doc" },
    h("div", { class: "spread" }, h("b", {}, title), badge(c.status === "pending" ? "pending" : c.status === "approved" ? "approved" : "rejected")),
    h("div", { class: "thumbs" }, (c.files ?? []).map((url, i) => h("a", { href: url, target: "_blank", rel: "noopener", "aria-label": `Open photo ${i + 1}` }, h("img", { src: url, alt: `${title} photo ${i + 1}`, loading: "lazy" })))),
    c.number ? h("div", { class: "small" }, h("span", { class: "muted" }, "Number: "), c.number) : null,
    c.expiry ? h("div", { class: "small" }, h("span", { class: "muted" }, "Expires: "), c.expiry) : null,
    h("div", { class: "muted small" }, `Uploaded ${dateTime(c.uploadedAt)}${doc.history?.length ? ` · ${doc.history.length} older version${doc.history.length === 1 ? "" : "s"}` : ""}`),
    c.reviewNote ? h("div", { class: "small" }, h("span", { class: "muted" }, "Note: "), c.reviewNote) : null,
    h("div", { class: "row" },
      c.status !== "approved" ? h("button", { class: "btn small", onclick: (e) => act(`/documents/${doc.kind}/review`, { action: "approve" }, e.currentTarget, `${title} approved.`) }, "Approve") : null,
      c.status !== "rejected" ? h("button", { class: "btn danger small", onclick: async (e) => {
        const btn = e.currentTarget;
        const values = await dialog({ title: `Reject ${title}?`, fields: [{ name: "note", label: "What's wrong with it? The driver sees this.", type: "textarea", required: true }], confirm: "Reject", danger: true });
        if (values) act(`/documents/${doc.kind}/review`, { action: "reject", note: values.note }, btn, `${title} rejected.`);
      } }, "Reject") : null));
}

function moneySection(d, m, act) {
  return [
    h("div", { class: "section-title" }, h("h2", {}, "Balance"),
      h("div", { class: "row" },
        h("button", { class: "btn quiet small", onclick: async (e) => {
          const btn = e.currentTarget;
          const values = await dialog({
            title: "Correct the balance",
            message: "Use a positive amount to give the driver money (e.g. a refund) and a negative amount to take it (e.g. commission collected in person). The driver sees the reason.",
            fields: [{ name: "amount", label: "Amount (₦)", type: "number", required: true, placeholder: "e.g. 500 or -500" }, { name: "reason", label: "Reason", required: true }],
            confirm: "Apply",
          });
          if (values) act("/adjust", { amount: Number(values.amount), reason: values.reason }, btn, "Balance corrected.");
        } }, "Correct balance"),
        h("button", { class: "btn quiet small", title: "Adds up every entry below and sets the balance to the total", onclick: (e) => act("/recompute", {}, e.currentTarget, "Balance recalculated.") }, icon("refresh"), "Recalculate"))),
    h("div", { class: "grid stats" },
      h("div", { class: `stat${m.balance > 0 ? " hero" : ""}` },
        h("span", { class: "label" }, m.balance < 0 ? "Owes Caliphate Rides" : "Caliphate Rides owes the driver"),
        h("span", { class: `value num ${m.balance < 0 ? "neg" : ""}` }, naira(Math.abs(m.balance))),
        h("span", { class: "note" }, m.blocked ? "Over the limit: can't go online" : m.balance < 0 ? "Commission from cash and transfer trips" : "Can be withdrawn"))),
    m.withdrawals.length ? [h("h3", { style: { margin: "18px 0 10px" } }, "Withdrawals"), table([
      { label: "When", cell: (w) => dateTime(w.createdAt) },
      { label: "Amount", right: true, num: true, cell: (w) => naira(w.amount) },
      { label: "To", cell: (w) => `${w.bank?.bankName ?? ""} ${w.bank?.accountNumber ?? ""}` },
      { label: "Status", cell: (w) => h("div", {}, badge(w.status), w.failureReason ? h("div", { class: "muted small" }, w.failureReason) : null) },
    ], m.withdrawals)] : null,
    h("h3", { style: { margin: "18px 0 10px" } }, "Balance activity"),
    table([
      { label: "When", cell: (e) => dateTime(e.at) },
      { label: "What", cell: (e) => h("div", {}, e.label, e.by ? h("div", { class: "muted small" }, `by ${e.by}`) : null) },
      { label: "Amount", right: true, num: true, cell: (e) => h("span", { class: e.amount < 0 ? "neg" : "pos" }, signedNaira(e.amount)) },
      { label: "Balance after", right: true, num: true, cell: (e) => (e.balanceAfter === undefined ? "—" : naira(e.balanceAfter)) },
    ], m.ledger, { empty: "No money movements yet. They start with the driver's first trip." }),
  ];
}
