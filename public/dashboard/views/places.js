// Places on the map. Click anywhere on the map to drop a pin for a place the map doesn't know (a shop,
// an estate, a new mosque), name it, and save: it shows up in the app's search and as a label on its map.
// Click a pin to edit it, drag it to move it, hide it, or delete it.
import { CATEGORY, api, attempt, clear, dialog, h, icon, toast } from "../lib.js";

export async function render(main, _params, ctx) {
  const { places } = await api("/places");
  const area = ctx.settings.serviceArea ?? { west: 5.1, south: 12.85, east: 5.35, north: 13.15 };

  let selected = null; // { place?, marker, isNew }
  let filter = "";
  const markers = new Map(); // dbId -> maplibre Marker

  const mapEl = h("div", { id: "map", role: "application", "aria-label": "Map of Sokoto. Click to add a place." });
  const results = h("div", { class: "map-results hidden" });
  const searchInput = h("input", { class: "input", type: "search", placeholder: "Find a street or area on the map…", "aria-label": "Find on the map" });
  const panel = h("div", { class: "card", style: { display: "grid", gap: 12 } });
  const list = h("div", { class: "place-list", role: "list" });
  const listFilter = h("input", { class: "input", type: "search", placeholder: `Filter ${places.length} places`, "aria-label": "Filter places",
    oninput: (e) => { filter = e.target.value.trim().toLowerCase(); drawList(); } });

  clear(main,
    h("div", { class: "page-head" },
      h("div", {}, h("h1", {}, "Map places"), h("p", {}, "Click the map to add a place it doesn't have. Places you add appear in the app's search and on its map within a few minutes."))),
    h("div", { class: "places-layout" },
      h("div", { class: "map-box" }, mapEl,
        h("div", { class: "map-hint" }, h("div", { class: "map-search" }, searchInput, results), h("span", { class: "pill" }, "Click the map to drop a pin"))),
      h("div", { class: "side-panel" }, panel, h("div", { style: { display: "grid", gap: 8, minHeight: 0, gridTemplateRows: "auto 1fr" } }, listFilter, list))));

  if (!window.maplibregl) {
    clear(mapEl, h("div", { class: "empty" }, "The map couldn't load. Check your internet connection and reload the page."));
  }
  const map = window.maplibregl
    ? new window.maplibregl.Map({
      container: mapEl,
      style: ctx.settings.mapStyleUrl,
      bounds: [[area.west, area.south], [area.east, area.north]],
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
    })
    : null;
  map?.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  // ---------- pins ----------

  function pinEl(p, extra = "") {
    const color = CATEGORY[p?.category]?.color ?? "#00874F";
    const el = h("div", { class: `pin ${extra}${p && !p.active ? " hidden-place" : ""}`, style: { background: color }, title: p?.name ?? "New place", role: "button", "aria-label": p?.name ?? "New place" });
    return el;
  }

  function addMarker(p) {
    if (!map) return;
    const el = pinEl(p);
    const m = new window.maplibregl.Marker({ element: el, anchor: "bottom-left", draggable: false })
      .setLngLat([p.location.longitude, p.location.latitude]).addTo(map);
    el.addEventListener("click", (e) => { e.stopPropagation(); select(p); });
    markers.set(p.dbId, m);
  }

  function refreshMarker(p) {
    markers.get(p.dbId)?.remove();
    markers.delete(p.dbId);
    addMarker(p);
  }

  places.forEach(addMarker);

  map?.on("click", (e) => {
    if (selected?.isNew) {
      selected.marker.setLngLat(e.lngLat);
      drawPanel();
      return;
    }
    newPlace(e.lngLat);
  });

  function newPlace(lngLat) {
    deselect();
    const el = pinEl(null, "new");
    const marker = new window.maplibregl.Marker({ element: el, anchor: "bottom-left", draggable: true }).setLngLat(lngLat).addTo(map);
    marker.on("dragend", drawPanel);
    selected = { isNew: true, marker, draft: { name: "", subtitle: "", category: "landmark", popular: false, active: true } };
    drawPanel();
    panel.querySelector("input[name=name]")?.focus();
  }

  function select(p) {
    deselect();
    const m = markers.get(p.dbId);
    m?.setDraggable(true);
    m?.on("dragend", drawPanel);
    selected = { isNew: false, place: p, marker: m, draft: { name: p.name, subtitle: p.subtitle ?? "", category: p.category, popular: p.popular, active: p.active } };
    map?.easeTo({ center: [p.location.longitude, p.location.latitude], zoom: Math.max(map.getZoom(), 15.5), duration: 500 });
    drawPanel();
    drawList();
  }

  function deselect() {
    if (!selected) return;
    if (selected.isNew) selected.marker.remove();
    else if (selected.place) {
      // put an unsaved drag back where it was
      selected.marker?.setDraggable(false);
      selected.marker?.setLngLat([selected.place.location.longitude, selected.place.location.latitude]);
    }
    selected = null;
  }

  // ---------- the side panel ----------

  function drawPanel() {
    if (!selected) {
      clear(panel,
        h("h2", {}, "Add a place"),
        h("p", { class: "muted small" }, "Click the spot on the map. You can drag the pin to adjust it before saving."),
        h("div", { class: "row small muted" }, Object.entries(CATEGORY).map(([, c]) => h("span", { class: "row", style: { gap: 6 } }, h("span", { class: "swatch", style: { color: c.color } }), c.label))));
      return;
    }
    const d = selected.draft;
    const at = selected.marker?.getLngLat();
    const field = (name, label, el) => h("label", { class: "field" }, label, el);
    const name = h("input", { class: "input", name: "name", value: d.name, required: true, maxlength: 80, placeholder: "e.g. Gidan Dare Junction", oninput: (e) => { d.name = e.target.value; } });
    const subtitle = h("input", { class: "input", value: d.subtitle, maxlength: 80, placeholder: "e.g. Off Sultan Bello Road", oninput: (e) => { d.subtitle = e.target.value; } });
    const category = h("select", { class: "input", onchange: (e) => { d.category = e.target.value; } },
      ctx.settings.placeCategories.map((c) => h("option", { value: c, selected: c === d.category }, CATEGORY[c]?.label ?? c)));
    const saveBtn = h("button", { class: "btn", type: "submit" }, icon("check"), selected.isNew ? "Add to map" : "Save");
    const moved = !selected.isNew && at && (Math.abs(at.lat - selected.place.location.latitude) > 1e-6 || Math.abs(at.lng - selected.place.location.longitude) > 1e-6);

    clear(panel, h("form", { style: { display: "grid", gap: 12 }, onsubmit: async (e) => {
      e.preventDefault();
      if (!d.name.trim()) return name.focus();
      const pos = selected.marker.getLngLat();
      const body = { ...d, latitude: pos.lat, longitude: pos.lng };
      if (selected.isNew) {
        const r = await attempt(() => api("/places", { method: "POST", body }), saveBtn);
        if (!r) return;
        selected.marker.remove();
        selected = null;
        places.push(r.place);
        addMarker(r.place);
        toast(`${r.place.name} added to the map.`);
        select(r.place);
      } else {
        const r = await attempt(() => api(`/places/${selected.place.dbId}`, { method: "PUT", body }), saveBtn);
        if (!r) return;
        const i = places.findIndex((x) => x.dbId === r.place.dbId);
        places[i] = r.place;
        selected = null;
        refreshMarker(r.place);
        toast(`${r.place.name} saved.`);
        select(r.place);
      }
      drawList();
    } },
    h("div", { class: "spread" }, h("h2", {}, selected.isNew ? "New place" : "Edit place"),
      h("button", { type: "button", class: "btn quiet icon", "aria-label": "Close", onclick: () => { deselect(); drawPanel(); drawList(); } }, icon("close"))),
    field("name", "Name", name),
    field("subtitle", h("span", {}, "Description ", h("span", { class: "hint" }, "(optional, shown under the name)")), subtitle),
    field("category", "Type", category),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: d.popular, onchange: (e) => { d.popular = e.target.checked; } }), "Suggest it to riders (popular place)"),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: d.active, onchange: (e) => { d.active = e.target.checked; } }), "Show in the app"),
    at ? h("p", { class: "muted small num" }, `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}${moved ? " · moved, save to keep" : ""}`) : null,
    h("p", { class: "muted small" }, "Drag the pin to move it."),
    h("div", { class: "row" }, saveBtn,
      !selected.isNew ? h("button", { type: "button", class: "btn danger", onclick: async (e) => {
        const p = selected.place;
        const ok = await dialog({ title: `Delete ${p.name}?`, message: "It disappears from the app's search and map. To keep it but stop showing it, untick \"Show in the app\" instead.", confirm: "Delete", danger: true });
        if (!ok) return;
        if (!(await attempt(() => api(`/places/${p.dbId}`, { method: "DELETE" }), e.target))) return;
        markers.get(p.dbId)?.remove();
        markers.delete(p.dbId);
        places.splice(places.findIndex((x) => x.dbId === p.dbId), 1);
        selected = null;
        toast(`${p.name} deleted.`);
        drawPanel();
        drawList();
      } }, "Delete") : null),
    !selected.isNew && selected.place.addedBy ? h("p", { class: "muted small" }, `Added by ${selected.place.addedBy}`) : null));
  }

  function drawList() {
    const shown = places
      .filter((p) => !filter || `${p.name} ${p.subtitle ?? ""}`.toLowerCase().includes(filter))
      .sort((a, b) => a.name.localeCompare(b.name));
    clear(list, shown.length ? shown.map((p) => h("button", { type: "button", role: "listitem", class: selected?.place?.dbId === p.dbId ? "on" : "", onclick: () => select(p) },
      h("span", { class: "swatch", style: { color: CATEGORY[p.category]?.color ?? "#00874F" } }),
      h("span", { style: { flex: 1, minWidth: 0 } },
        h("b", { style: { display: "block" } }, p.name),
        h("span", { class: "muted small" }, [CATEGORY[p.category]?.label ?? p.category, p.subtitle, !p.active ? "hidden" : null, p.popular ? "popular" : null].filter(Boolean).join(" · "))))) :
      h("div", { class: "empty" }, filter ? "No places match." : "No places yet. Click the map to add one."));
  }

  // ---------- finding a spot on the map (OpenStreetMap search) ----------

  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 3) { results.classList.add("hidden"); return; }
    searchTimer = setTimeout(async () => {
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=${area.west},${area.south},${area.east},${area.north}&limit=6&lang=en`;
        const json = await (await fetch(url)).json();
        const found = (json.features ?? []).filter((f) => f.geometry?.type === "Point");
        clear(results, found.length ? found.map((f) => h("button", { type: "button", onclick: () => {
          results.classList.add("hidden");
          map?.flyTo({ center: f.geometry.coordinates, zoom: 16.5 });
        } }, h("b", {}, f.properties.name ?? q), h("div", { class: "muted small" }, [f.properties.street, f.properties.district, f.properties.city].filter(Boolean).join(", ")))) :
          h("div", { class: "empty small" }, "Not found. Move the map there and click the spot instead."));
        results.classList.remove("hidden");
      } catch {
        results.classList.add("hidden");
      }
    }, 350);
  });

  drawPanel();
  drawList();
  return () => map?.remove();
}
