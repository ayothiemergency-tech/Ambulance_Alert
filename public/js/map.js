// Leaflet map wrapper.
//
// WHY THE OLD MAP SHOWED ONLY ONE CORNER: it was created while its container was hidden
// (display:none), so Leaflet measured 0x0 and drew a single tile. This version is created
// while the console is already laid out (the intro simply sits on top of it) AND it
// re-measures itself whenever its box changes size, so that cannot happen again.

const DEFAULT_CENTER = [10.805, 78.686]; // Tiruchirappalli, until the first GPS fix arrives

export function createMap(el, { onFollowChange } = {}) {
  const L = window.L;
  if (!L) {
    el.innerHTML = '<div class="map-fallback"><div><b>Map unavailable</b><br/>The map library could not be loaded. Check the internet connection and reload.</div></div>';
    return null;
  }

  const map = L.map(el, { zoomControl: true, worldCopyJump: false }).setView(DEFAULT_CENTER, 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const hospLayer = L.layerGroup().addTo(map);
  const trail = L.polyline([], { color: "#e5192e", weight: 4, opacity: 0.9 }).addTo(map);
  const route = L.polyline([], { color: "#2d7be5", weight: 3, dashArray: "8 10", opacity: 0.95 }).addTo(map);

  let vehMarker = null;
  let arrowEl = null;
  let follow = true;
  let centered = false;
  let hospKey = "";
  let fitKey = "";
  let lastPhase = "";

  function setFollow(v, recenter = false) {
    follow = v;
    if (onFollowChange) onFollowChange(v);
    if (v && recenter && vehMarker) map.setView(vehMarker.getLatLng(), Math.max(map.getZoom(), 15));
  }
  map.on("dragstart", () => { if (follow) setFollow(false); });

  // Keep the map correctly sized no matter what the layout does.
  const invalidate = () => map.invalidateSize();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(invalidate).observe(el);
  window.addEventListener("resize", invalidate);
  [50, 300, 900, 2000].forEach((t) => setTimeout(invalidate, t));

  const vehicleIcon = () =>
    L.divIcon({
      className: "",
      html: '<div class="veh-marker"><span class="pulse"></span><span class="disc"><span class="veh-arrow"></span></span></div>',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

  function hospitalMarker(h, text, cls) {
    const icon = L.divIcon({ className: "", html: `<div class="h-pin ${cls}">${text}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
    const m = L.marker([h.lat, h.lon], { icon, keyboard: false });
    const tip = document.createElement("span");
    tip.textContent = h.name; // textContent: names from OpenStreetMap can never inject markup
    m.bindTooltip(tip, { direction: "top", offset: [0, -14] });
    return m;
  }

  // vehicle: {lat,lon,heading} | null    trailPts: [[lat,lon],...]
  // hospitals: [{lat,lon,name}]          selected: index    target: {lat,lon,name} | null
  // phase: 'standby' | 'select' | 'enroute' | 'arrived'
  function update({ vehicle, trailPts, hospitals, selected, target, phase }) {
    // --- vehicle marker
    if (vehicle) {
      const ll = [vehicle.lat, vehicle.lon];
      if (!vehMarker) {
        vehMarker = L.marker(ll, { icon: vehicleIcon(), zIndexOffset: 1000, keyboard: false }).addTo(map);
        arrowEl = vehMarker.getElement().querySelector(".veh-arrow");
      } else {
        vehMarker.setLatLng(ll);
      }
      if (arrowEl) arrowEl.style.transform = `rotate(${vehicle.heading || 0}deg)`;
    } else if (vehMarker) {
      vehMarker.remove();
      vehMarker = null;
      arrowEl = null;
    }

    // --- hospital pins (rebuilt only when something visible actually changed)
    const dest = phase === "enroute" || phase === "arrived" ? target : null;
    const pins = dest ? [dest] : phase === "select" ? hospitals : [];
    const key = pins.map((h) => `${h.lat},${h.lon}`).join("|") + `#${selected}#${phase}`;
    if (key !== hospKey) {
      hospKey = key;
      hospLayer.clearLayers();
      pins.forEach((h, i) => hospitalMarker(h, dest ? "H" : String(i + 1), dest ? "dest" : i === selected ? "sel" : "").addTo(hospLayer));
    }

    // --- trail + route line
    trail.setLatLngs(trailPts || []);
    const to = dest || (phase === "select" ? hospitals[selected] : null);
    route.setLatLngs(vehicle && to ? [[vehicle.lat, vehicle.lon], [to.lat, to.lon]] : []);

    // --- camera
    if (phase !== lastPhase) {
      lastPhase = phase;
      if (phase === "select") fitKey = "";
      if (phase === "enroute") {
        setFollow(true);
        if (vehicle) map.setView([vehicle.lat, vehicle.lon], 16);
      }
      if (phase === "standby") setFollow(true);
    }
    if (phase === "select" && hospitals.length && vehicle) {
      const k = hospitals.map((h) => `${h.lat},${h.lon}`).join("|");
      if (k !== fitKey) {
        fitKey = k;
        centered = true;
        setFollow(false);
        map.fitBounds(L.latLngBounds([[vehicle.lat, vehicle.lon], ...hospitals.map((h) => [h.lat, h.lon])]), { padding: [48, 48], maxZoom: 15 });
      }
    } else if (vehicle && follow) {
      const ll = [vehicle.lat, vehicle.lon];
      if (!centered) {
        centered = true;
        map.setView(ll, 16);
      } else if (!map.getBounds().pad(-0.25).contains(ll)) {
        map.panTo(ll, { animate: true });
      }
    }
  }

  return { update, setFollow, invalidate, isFollowing: () => follow };
}
