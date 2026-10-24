import { firebaseConfig, DEVICE_ID } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase, ref, onValue, set, update, get } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { searchNearbyHospitals, fallbackList } from "./hospitals.js";
import { decide as decideVehicle, alertThreshold as alertThresholdFor } from "./direction.js";
import { createMap } from "./map.js";
import * as view from "./view.js";

const $ = (id) => document.getElementById(id);
const base = `ambulance/${DEVICE_ID}`;
const OFFLINE_MS = 7000; // no telemetry for this long = vehicle offline
const ARRIVE_M = 40;     // within this distance of the hospital = arrived

const R = 6371000, RAD = Math.PI / 180;
const haversine = (la1, lo1, la2, lo2) => {
  const dp = (la2 - la1) * RAD, dl = (lo2 - lo1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ---------------------------------------------------------------- shared state
const S = {
  offset: 0,            // server clock minus this browser's clock (from Firebase)
  tel: null, telLocal: 0, everSeen: false,
  diag: {}, ctl: {}, hosp: null, nearby: {}, dir: null,
  pendingSel: null,     // instant feedback for taps while the database catches up
  arrivedLatch: 0, startDist: null,
  trail: [], trailFor: 0,
  searchFor: 0,
  model: null, prev: {},
};

let db = null;
let mapCtl = null;

// ---------------------------------------------------------------- intro
const intro = $("intro");
function enterConsole() {
  if (intro.classList.contains("leaving")) return;
  intro.classList.add("leaving");
  document.body.classList.remove("is-intro");
  try { sessionStorage.setItem("introSeen", "1"); } catch {}
  setTimeout(() => { intro.style.display = "none"; mapCtl?.invalidate(); }, 800);
}
$("enterBtn").addEventListener("click", enterConsole);
document.addEventListener("keydown", (e) => {
  if (!intro.classList.contains("leaving") && ["Enter", " ", "Escape"].includes(e.key)) { e.preventDefault(); enterConsole(); }
});
let seen = false;
try { seen = sessionStorage.getItem("introSeen") === "1"; } catch {}
if (seen) { intro.style.display = "none"; document.body.classList.remove("is-intro"); }
else setTimeout(enterConsole, 12000); // never leave a visitor stuck on the intro

// ---------------------------------------------------------------- UI setup
view.buildDials();
mapCtl = createMap($("map"), { onFollowChange: view.setFollowButton });
$("followBtn").addEventListener("click", () => mapCtl?.setFollow(!mapCtl.isFollowing(), true));
setInterval(view.tickClock, 1000); view.tickClock();
setInterval(view.tickLcd, 380);

// ---------------------------------------------------------------- derived model
function derive() {
  const now = Date.now();
  const t = S.tel || {};
  const ageMs = typeof t.lastSeen === "number" ? now + S.offset - t.lastSeen : S.telLocal ? now - S.telLocal : Infinity;
  const online = ageMs < OFFLINE_MS;
  const hasPos = typeof t.lat === "number" && typeof t.lon === "number";
  const gpsOk = online && !!t.gpsOk && hasPos;

  const ctl = S.ctl || {};
  const emergency = !!ctl.emergency;
  const confirmed = ctl.confirmedHospital || null;

  // hospital list only counts if it belongs to THIS emergency
  const rec = S.hosp && ctl.listId && S.hosp.listId === ctl.listId ? S.hosp : null;
  const hospitals = (rec && Array.isArray(rec.list) ? rec.list : []).map((h) => ({
    ...h,
    distance: gpsOk ? Math.round(haversine(t.lat, t.lon, h.lat, h.lon) * 10) / 10 : h.distance,
  }));
  const n = hospitals.length;
  let selIdx = Math.max(0, Math.min(n ? n - 1 : 0, ctl.selectedIndex || 0));
  // A tap on this page shows instantly; the override ends as soon as the database confirms it
  // (or after 2.5 s), so a button pressed on the vehicle is never ignored for long.
  if (S.pendingSel && ((ctl.selectedIndex || 0) === S.pendingSel.index || Date.now() > S.pendingSel.until)) S.pendingSel = null;
  if (S.pendingSel && n) selIdx = Math.min(n - 1, S.pendingSel.index);

  const target = confirmed ? { name: confirmed.hospName, lcd: confirmed.hospLcd, lat: confirmed.hospLat, lon: confirmed.hospLon } : null;
  const dist = target && gpsOk ? haversine(t.lat, t.lon, target.lat, target.lon) : null;
  if (emergency && target && dist != null && dist <= ARRIVE_M) S.arrivedLatch = ctl.listId || 1;

  let phase = "standby";
  if (ctl.arrived && !emergency) phase = "arrived";
  else if (emergency && confirmed) phase = S.arrivedLatch === (ctl.listId || 1) ? "arrived" : "enroute";
  else if (emergency) phase = "select";

  const arrivedTarget = ctl.arrived && !emergency ? { name: ctl.arrived.hospName } : target;

  if (phase === "enroute" && S.startDist == null && dist != null) S.startDist = Math.max(dist, 1);
  if (phase === "standby" || phase === "select") S.startDist = null;
  const progress = phase === "arrived" ? 1 : S.startDist && dist != null ? 1 - dist / S.startDist : 0;

  return {
    online, everSeen: S.everSeen, ageSec: Math.max(0, ageMs / 1000),
    gpsOk, lat: t.lat, lon: t.lon, heading: typeof t.heading === "number" ? t.heading : null,
    speed: typeof t.speed === "number" ? t.speed : null, sats: typeof t.sats === "number" ? t.sats : null,
    motorOn: !!t.motorOn,
    emergency, phase, hospitals, hospSource: rec ? rec.source : null, selIdx,
    target: phase === "arrived" ? arrivedTarget : target, dist, progress,
    diag: S.diag, keys: S.diag && S.diag.buttons, direction: S.dir,
  };
}

function refresh() {
  const m = derive();
  S.model = m;

  // trail for the map (reset with every new emergency)
  const lid = (S.ctl && S.ctl.listId) || 0;
  if (lid !== S.trailFor) { S.trailFor = lid; S.trail = []; }
  if (m.gpsOk) {
    const last = S.trail[S.trail.length - 1];
    if (!last || haversine(last[0], last[1], m.lat, m.lon) > 1.5) {
      S.trail.push([m.lat, m.lon]);
      if (S.trail.length > 500) S.trail.shift();
    }
  }

  view.render(m);
  mapCtl?.update({
    vehicle: m.gpsOk ? { lat: m.lat, lon: m.lon, heading: m.heading } : null,
    trailPts: m.emergency ? S.trail : [],
    hospitals: m.hospitals, selected: m.selIdx, target: m.target && m.target.lat != null ? m.target : null, phase: m.phase,
  });

  // mission log: only moments that change
  const p = S.prev;
  if (p.online !== undefined && p.online !== m.online) view.log(m.online ? "Vehicle link established" : "Vehicle link lost", m.online ? "ok" : "bad");
  if (p.online && m.online && p.gpsOk !== undefined && p.gpsOk !== m.gpsOk) view.log(m.gpsOk ? "GPS lock acquired" : "GPS lock lost", m.gpsOk ? "ok" : "warn");
  if (p.phase !== undefined && p.phase !== m.phase) {
    if (m.phase === "select") view.log("Emergency started. Locating hospitals", "warn");
    if (m.phase === "enroute") view.log(`Dispatched to ${m.target ? m.target.name : "hospital"}. Motors at full speed`, "warn");
    if (m.phase === "arrived") view.log(`Arrived at ${m.target ? m.target.name : "hospital"}`, "ok");
    if (m.phase === "standby" && p.phase !== undefined) view.log("Mission ended. Standing by", "ok");
  }
  if (p.nHosp === 0 && m.hospitals.length > 0) view.log(`${m.hospitals.length} nearby hospitals loaded`, "ok");
  S.prev = { online: m.online, gpsOk: m.gpsOk, phase: m.phase, nHosp: m.hospitals.length };

  maybeRunHospitalSearch();
}
setInterval(refresh, 1000);

// ---------------------------------------------------------------- Firebase
const missing = Object.values(firebaseConfig).some((v) => /PASTE/.test(String(v)));
if (missing) {
  view.showBanner("<b>Firebase is not connected yet.</b> Open <code>public/js/firebase-config.js</code>, paste in your Firebase web-app config (including <code>databaseURL</code>), commit, and redeploy.");
  refresh();
} else {
  try {
    db = getDatabase(initializeApp(firebaseConfig));
  } catch (e) {
    view.showBanner(`<b>Could not start Firebase.</b> Check <code>firebase-config.js</code>, especially <code>databaseURL</code>. (${view.esc(e.message)})`);
  }
}

if (db) {
  const listen = (path, fn) => onValue(ref(db, path), (snap) => { fn(snap.val()); refresh(); }, (err) => {
    view.log(`Database refused ${path.replace(base + "/", "")}: ${err.code || err.message}`, "bad");
  });

  listen(".info/serverTimeOffset", (v) => { S.offset = typeof v === "number" ? v : 0; });
  listen(`${base}/telemetry`, (t) => { S.tel = t; if (t) { S.telLocal = Date.now(); S.everSeen = true; } recomputeDirection(); });
  listen(`${base}/diagnostics`, (d) => { S.diag = d || {}; });
  listen(`${base}/control`, (c) => { S.ctl = c || {}; });
  listen(`${base}/hospitals`, (h) => { S.hosp = h; });
  listen(`${base}/nearbyVehicles`, (v) => { S.nearby = v || {}; recomputeDirection(); });
  listen(`${base}/direction`, (d) => {
    const old = S.dir && S.dir.vehicles ? S.dir.vehicles : {};
    S.dir = d;
    if (d && d.vehicles) for (const [id, v] of Object.entries(d.vehicles)) {
      if (old[id] && old[id].alert !== v.alert) view.log(`${v.alert ? "Proximity ALERT" : "Proximity clear"}: ${v.label || id} (${Math.round(v.distance)} m)`, v.alert ? "bad" : "ok");
    }
  });
}

// ---------------------------------------------------------------- hospital search (runs in this browser)
async function maybeRunHospitalSearch() {
  const m = S.model, ctl = S.ctl || {}, t = S.tel || {};
  if (!db || !m || !m.online || !m.emergency || !ctl.listId || ctl.confirmedHospital) return;
  if (S.hosp && S.hosp.listId === ctl.listId) return;        // already have this emergency's list
  if (S.searchFor === ctl.listId) return;                    // this tab is already on it
  if (!m.gpsOk) return;                                      // need a position first

  const listId = ctl.listId, lat = t.lat, lon = t.lon;
  S.searchFor = listId;
  // another open tab may already be doing this
  const existing = await get(ref(db, `${base}/hospitals`)).catch(() => null);
  if (existing && existing.val() && existing.val().listId === listId) return;

  let list, source;
  try {
    list = await searchNearbyHospitals(lat, lon, 4);
    if (!list.length) throw new Error("none found");
    source = "osm";
  } catch (err) {
    view.log("Live hospital lookup unavailable. Using the built-in list", "warn");
    list = fallbackList(lat, lon, 4);
    source = "fallback";
  }
  // don't publish a result for an emergency that was cancelled meanwhile
  const now = await get(ref(db, `${base}/control`)).catch(() => null);
  const c = now && now.val();
  if (!c || !c.emergency || c.listId !== listId) return;
  await set(ref(db, `${base}/hospitals`), { listId, source, list, at: Date.now() }).catch(() => {});
}

// ---------------------------------------------------------------- direction detection (MATLAB script, ported)
let lastDirWrite = 0;
async function recomputeDirection() {
  const t = S.tel;
  if (!db || !t || !t.gpsOk || typeof t.lat !== "number" || typeof t.lon !== "number") return;
  const entries = Object.entries(S.nearby || {}).filter(([, v]) => v && typeof v.lat === "number" && typeof v.lon === "number");
  if (!entries.length) return;
  if (Date.now() - lastDirWrite < 900) return; // at most about once a second
  lastDirWrite = Date.now();
  const amb = { lat: t.lat, lon: t.lon, heading: t.heading || 0, speed: t.speed || 0 };
  const vehicles = {};
  for (const [id, v] of entries) vehicles[id] = { label: v.label || id, ...decideVehicle(amb, { lat: v.lat, lon: v.lon, heading: v.heading || 0 }) };
  await set(ref(db, `${base}/direction`), { alertThreshold: Math.round(alertThresholdFor(amb.speed) * 10) / 10, updatedAt: Date.now(), vehicles }).catch(() => {});
}

// ---------------------------------------------------------------- actions
async function write(fn, failMsg) {
  if (!db) return view.log("Not connected to the database", "bad");
  try { await fn(); } catch (e) { view.log(`${failMsg}: ${e.code || e.message}`, "bad"); }
}

const guard = $("guard");
let guardTimer = 0;
$("guardCover").addEventListener("click", () => {
  guard.classList.add("open");
  clearTimeout(guardTimer);
  guardTimer = setTimeout(() => guard.classList.remove("open"), 8000); // the cover closes itself
});

$("btnStart").addEventListener("click", () => {
  const m = S.model;
  if (!m || !m.online || !m.gpsOk) return;
  guard.classList.remove("open");
  S.arrivedLatch = 0; S.startDist = null; S.trail = [];
  const listId = (Date.now() % 2000000000) + 1; // fits in 31 bits so the ESP32 can read it easily
  write(() => set(ref(db, `${base}/control`), { emergency: true, confirmedHospital: null, selectedIndex: 0, listId }), "Could not start the emergency");
});

function chooseIndex(i) {
  const n = S.model ? S.model.hospitals.length : 0;
  if (!n) return;
  const idx = ((i % n) + n) % n;
  S.pendingSel = { index: idx, until: Date.now() + 2500 };
  refresh();
  write(() => update(ref(db, `${base}/control`), { selectedIndex: idx }), "Could not change the selection");
}
$("hospList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]");
  if (b) chooseIndex(Number(b.dataset.i));
});
$("hospPrev").addEventListener("click", () => chooseIndex((S.model ? S.model.selIdx : 0) - 1));
$("hospNext").addEventListener("click", () => chooseIndex((S.model ? S.model.selIdx : 0) + 1));

$("hospConfirm").addEventListener("click", () => {
  const m = S.model;
  const h = m && m.hospitals[m.selIdx];
  if (!h) return;
  write(
    () => update(ref(db, `${base}/control`), {
      selectedIndex: m.selIdx,
      confirmedHospital: { hospIndex: m.selIdx, hospName: h.name, hospLat: h.lat, hospLon: h.lon, hospLcd: h.lcd || h.name },
    }),
    "Could not dispatch",
  );
});

const stopMission = () => {
  S.arrivedLatch = 0; S.startDist = null;
  return write(() => set(ref(db, `${base}/control`), { emergency: false, confirmedHospital: null, selectedIndex: 0, listId: 0 }), "Could not end the mission");
};
$("btnCancel").addEventListener("click", stopMission);
$("btnAbort").addEventListener("click", stopMission);
$("btnReset").addEventListener("click", stopMission);

refresh();
