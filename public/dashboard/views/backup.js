// Backup: download a full copy of everything (records, spreadsheets and driver photos) in one ZIP.
import { api, attempt, clear, date, h, icon, toast } from "../lib.js";

const LABELS = {
  users: "Riders", drivers: "Drivers", rides: "Rides", wallettransactions: "Wallet history", driverledgers: "Driver balance history",
  payments: "Online payments", withdrawals: "Driver payouts", places: "Map places", configs: "Fares & settings", admins: "Admins", counters: "Counters",
};
const LAST_KEY = "cr.admin.lastBackup";
const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`);

export async function render(main) {
  const s = await api("/backup");
  let last = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* private window */ }

  const download = (photos) => async (e) => {
    const r = await attempt(() => api("/backup/link", { method: "POST", body: { photos } }), e.currentTarget);
    if (!r) return;
    try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch { /* ignore */ }
    window.location.href = r.url; // the browser saves the ZIP straight to your Downloads
    toast("Your backup is downloading. Keep the file somewhere safe and private.");
  };

  const rows = Object.entries(s.collections).sort((a, b) => b[1] - a[1]).map(([name, n]) =>
    h("div", { class: "row", style: { justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" } },
      h("span", {}, LABELS[name] ?? name, h("span", { class: "muted small" }, `  ${name}`)), h("b", { class: "num" }, n.toLocaleString("en-NG"))));

  clear(main,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Backup"),
      h("p", {}, "Download a full copy of Caliphate Rides: every rider, driver, ride, payment, place and setting, plus driver document photos."))),
    h("div", { class: "grid stats" },
      h("div", { class: "stat hero" }, h("span", { class: "label" }, "Records"), h("span", { class: "value num" }, s.records.toLocaleString("en-NG")), h("span", { class: "note" }, `${Object.keys(s.collections).length} kinds of data`)),
      h("div", { class: "stat" }, h("span", { class: "label" }, "Driver photos"), h("span", { class: "value num" }, s.photos.toLocaleString("en-NG")), h("span", { class: "note" }, mb(s.photoBytes))),
      h("div", { class: "stat" }, h("span", { class: "label" }, "Last download on this computer"), h("span", { class: "value", style: { fontSize: "20px" } }, last ? date(last) : "Never"), h("span", { class: "note" }, "Download one every week"))),
    h("div", { class: "card", style: { marginTop: "16px", display: "grid", gap: "14px" } },
      h("div", { class: "row", style: { gap: "10px", flexWrap: "wrap" } },
        h("button", { class: "btn", onclick: download(true) }, icon("download"), `Download full backup (about ${mb(s.photoBytes + s.records * 250)})`),
        h("button", { class: "btn soft", onclick: download(false) }, icon("download"), "Records only (no photos)")),
      h("div", { class: "notice" }, "Keep the file private: it holds phone numbers, ID documents and bank details. Store a copy off this server (your computer, a USB drive or Google Drive), so a server problem can't take your only copy with it.")),
    h("div", { class: "section-title" }, h("h2", {}, "What's in it")),
    h("div", { class: "card" }, ...rows),
    h("div", { class: "section-title" }, h("h2", {}, "Using the file")),
    h("div", { class: "card", style: { display: "grid", gap: "10px", lineHeight: 1.5 } },
      h("p", {}, h("b", {}, "To look at the data: "), "open the ", h("code", {}, "spreadsheets"), " folder in the ZIP. Each file opens in Excel or Google Sheets."),
      h("p", {}, h("b", {}, "To move to a new server: "), "set up the backend there (DEPLOY-VPS.md), copy the ZIP across and run ", h("code", {}, "./scripts/vps-restore.sh backup.zip"), ". Everything comes back, photos included."),
      h("p", {}, h("b", {}, "To move to another database: "), "the ", h("code", {}, "data"), " folder has every record as JSON (one per line), and the spreadsheets load into MySQL or Postgres tables. The README inside explains each file.")));
}
