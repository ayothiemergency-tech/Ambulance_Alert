// Everything that touches the page's appearance lives here. app.js hands it a plain
// "model" object and it draws it; nothing in here talks to Firebase.

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const cardinal = (deg) => CARD[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, "0");

export function fmtDist(m) {
  if (m == null || !Number.isFinite(m)) return "--";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
const fmtDistShort = (m) => (m == null || !Number.isFinite(m) ? "--" : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);

export function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "--";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m < 60) return `${m}:${pad(s, 2)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ------------------------------------------------------------------ one-time setup
export function buildDials() {
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const ct = $("compassTicks");
  for (let i = 0; i < 36; i++) {
    const major = i % 3 === 0;
    ct.appendChild(mk("line", { x1: 100, y1: 7, x2: 100, y2: major ? 20 : 14, class: "tick" + (major ? " major" : ""), transform: `rotate(${i * 10} 100 100)` }));
  }
  const gt = $("gaugeTicks");
  for (let v = 0; v <= 60; v += 10) {
    const a = ((-90 + (v / 60) * 180) * Math.PI) / 180;
    const p = (r) => [100 + r * Math.sin(a), 112 - r * Math.cos(a)];
    const [x1, y1] = p(63), [x2, y2] = p(72);
    gt.appendChild(mk("line", { x1, y1, x2, y2, class: "tick" + (v % 20 === 0 ? " major" : "") }));
    if (v % 20 === 0) {
      const [tx, ty] = p(51);
      const t = mk("text", { x: tx, y: ty + 4, class: "g-label" });
      t.textContent = v;
      gt.appendChild(t);
    }
  }
}

// ------------------------------------------------------------------ small helpers
let needleAngle = 0;
const shortest = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180; // no spinning the long way round
let lastModel = null;
let marqueeAt = 0;

function setSys(id, status, detail) {
  const el = $(id);
  el.dataset.s = status;
  $(id + "-d").textContent = detail;
}

function marquee(text, width = 16) {
  if (text.length <= width) return text.padEnd(width);
  const loop = text + "   ";
  const off = Math.floor(Date.now() / 380) % loop.length;
  return (loop + loop).slice(off, off + width);
}

export function lcdLines(m) {
  // every line is forced to exactly 16 characters, like the real 16x2 display
  return rawLcdLines(m).map((s) => String(s).padEnd(16).slice(0, 16));
}

function rawLcdLines(m) {
  if (!m) return ["", ""];
  if (!m.online) return ["VEHICLE OFFLINE ", "  -- NO LINK --  "];
  const pad16 = (s) => String(s).padEnd(16).slice(0, 16);
  if (m.phase === "standby") return ["AMBULANCE READY ", pad16(`GPS ${m.gpsOk ? "LOCK" : "----"} SAT:${pad(m.sats || 0, 2)}`)];
  if (m.phase === "select") {
    if (!m.hospitals.length) return ["EMERGENCY ON    ", "Loading hosp...  "];
    const h = m.hospitals[m.selIdx] || m.hospitals[0];
    return [marquee(h.lcd || h.name), pad16(`${m.selIdx + 1}/${m.hospitals.length}  ${fmtDistShort(h.distance)}`)];
  }
  if (m.phase === "enroute") {
    const t = m.target;
    const hd = m.heading != null ? `H${pad(m.heading, 3)} ${cardinal(m.heading)}` : "H---";
    return [marquee((t && (t.lcd || t.name)) || ""), pad16(`${fmtDistShort(m.dist)} ${hd}`)];
  }
  return ["ARRIVED!        ", marquee((m.target && (m.target.lcd || m.target.name)) || "")];
}

export function tickLcd() {
  if (!lastModel) return;
  const [a, b] = lcdLines(lastModel);
  $("lcd1").textContent = a;
  $("lcd2").textContent = b;
  $("lcd").classList.toggle("off", !lastModel.online);
}

// ------------------------------------------------------------------ main render
let hospSig = "";

export function render(m) {
  lastModel = m;

  // top bar
  $("linkPill").dataset.on = String(m.online);
  $("linkText").textContent = m.online ? "VEHICLE ONLINE" : m.everSeen ? "LINK LOST" : "VEHICLE OFFLINE";
  document.body.classList.toggle("alert", m.online && m.emergency);
  $("ageText").textContent = !m.online ? "NO SIGNAL" : m.ageSec < 3 ? "LIVE" : `${Math.round(m.ageSec)} s AGO`;
  $("ageText").style.color = m.online ? "var(--green)" : "var(--dim)";

  // ---- mission control
  const mission = $("mission");
  mission.dataset.state = m.phase;
  $("missionTag").textContent = { standby: "STANDBY", select: "SELECT HOSPITAL", enroute: "EN ROUTE", arrived: "ARRIVED" }[m.phase];

  if (m.phase === "standby") {
    const ready = m.online && m.gpsOk;
    $("btnStart").disabled = !ready;
    $("guardCover").disabled = !ready;
    $("guard").classList.toggle("locked", !ready);
    if (!ready) $("guard").classList.remove("open");
    $("standbyMsg").textContent = !m.online
      ? "Waiting for the vehicle to come online."
      : !m.gpsOk
        ? "Vehicle online. Waiting for a GPS lock\u2026"
        : "Vehicle online with a GPS lock. Ready to dispatch.";
    $("startReason").textContent = ready
      ? "Lift the safety cover, then press to start. The vehicle keys can start it too (key 1)."
      : "The emergency switch unlocks once the vehicle is online with a GPS lock.";
  } else {
    $("guard").classList.remove("open");
  }

  if (m.phase === "select") {
    const loading = m.hospitals.length === 0;
    $("hospLoading").hidden = !loading;
    $("hospList").hidden = loading;
    $("hospPrev").disabled = loading;
    $("hospNext").disabled = loading;
    $("hospConfirm").disabled = loading || !m.online;
    $("hospSource").textContent = m.hospSource === "fallback"
      ? "Live lookup was unavailable, so a built-in hospital list is shown. Vehicle keys: 2 next, 3 previous, 1 confirm."
      : "Nearest hospitals from OpenStreetMap. Vehicle keys: 2 next, 3 previous, 1 confirm. The console and the vehicle stay in step.";

    const sig = m.hospitals.map((h) => h.name).join("|") + "#" + m.selIdx;
    const list = $("hospList");
    if (sig !== hospSig) {
      hospSig = sig;
      list.innerHTML = m.hospitals
        .map((h, i) => `<li><button class="hosp${i === m.selIdx ? " sel" : ""}" type="button" data-i="${i}">
            <span class="no">${i + 1}</span>
            <span><b>${esc(h.name)}</b><small>${h.emergency ? '<span class="er">&#10010;</span> Emergency dept &middot; ' : ""}${esc(h.city || "Hospital")}</small></span>
            <span class="dist" data-d="${i}">${fmtDist(h.distance)}</span></button></li>`)
        .join("");
    } else {
      m.hospitals.forEach((h, i) => {
        const d = list.querySelector(`[data-d="${i}"]`);
        if (d) d.textContent = fmtDist(h.distance);
      });
    }
  } else {
    hospSig = "";
  }

  if (m.phase === "enroute" || m.phase === "arrived") {
    const t = m.target;
    $("routeDest").textContent = t ? t.name : "\u2014";
    $("routeDist").textContent = fmtDist(m.dist);
    $("routeEta").textContent = m.speed > 1 ? fmtEta(m.dist / (m.speed / 3.6)) : "--";
    $("routeSpeed").textContent = m.speed != null ? `${m.speed.toFixed(0)} km/h` : "--";
    $("routeMotor").textContent = m.motorOn ? "FULL" : "OFF";
    const p = Math.max(0, Math.min(1, m.progress || 0));
    $("roadAmb").style.left = `calc((100% - 100px) * ${p})`;
    $("roadFill").style.width = `calc((100% - 100px) * ${p} + 62px)`;
    $("arrivedName").textContent = t ? `Reached ${t.name}.` : "Destination reached.";
  }

  // ---- LCD mirror + keys
  tickLcd();
  [1, 2, 3].forEach((n) => $("key" + n).classList.toggle("on", !!(m.keys && m.keys["b" + n])));

  // ---- instruments
  const hasHdg = m.online && m.heading != null && Number.isFinite(m.heading);
  if (hasHdg) {
    needleAngle = shortest(needleAngle, m.heading);
    $("needle").style.transform = `rotate(${needleAngle}deg)`;
    $("hdgRead").textContent = `${pad(m.heading, 3)}\u00b0`;
    $("hdgCard").textContent = cardinal(m.heading);
  } else {
    $("hdgRead").textContent = "---\u00b0";
    $("hdgCard").textContent = "HEADING";
  }
  const spd = m.online && m.speed != null ? m.speed : 0;
  $("spdRead").textContent = m.online && m.speed != null ? spd.toFixed(0) : "--";
  $("gNeedle").style.transform = `rotate(${-90 + Math.min(1, spd / 60) * 180}deg)`;
  $("gaugeArc").style.strokeDashoffset = String(252 * (1 - Math.min(1, spd / 60)));

  $("roGps").textContent = !m.online ? "NO LINK" : m.gpsOk ? "LOCKED" : "SEARCHING";
  $("roGps").className = !m.online ? "" : m.gpsOk ? "v-ok" : "v-warn";
  const sats = m.online ? m.sats || 0 : 0;
  [...$("satBars").children].forEach((b, i) => b.classList.toggle("on", sats >= (i + 1) * 2 - 1));
  $("roSats").textContent = m.online && m.sats != null ? m.sats : "\u2014";
  const pos = m.online && m.gpsOk ? `${m.lat.toFixed(5)}, ${m.lon.toFixed(5)}` : "\u2014";
  $("roPos").textContent = pos;
  $("mapCoords").textContent = pos;
  $("noSignal").classList.toggle("hide", m.online && m.gpsOk);

  // ---- subsystems (reported by the vehicle; GPS and drive are also derived from telemetry)
  const d = m.diag || {};
  const rep = (x) => (x && x.status ? [x.status, String(x.detail || x.status).slice(0, 28)] : null);
  const gps = rep(d.gps) || (m.online ? (m.gpsOk ? ["ok", `LOCK \u00b7 ${m.sats || 0} SAT`] : ["warn", "SEARCHING"]) : ["none", "NO REPORT"]);
  const lora = rep(d.lora) || ["none", "NO REPORT"];
  const drive = rep(d.drive) || (m.online ? (m.motorOn ? ["ok", "RUNNING \u00b7 FULL"] : ["ok", "READY \u00b7 STOPPED"]) : ["none", "NO REPORT"]);
  const disp = rep(d.display) || ["none", "NO REPORT"];
  const gate = (s) => (m.online ? s : ["none", "NO REPORT"]);
  setSys("sys-gps", ...gate(gps));
  setSys("sys-lora", ...gate(lora));
  setSys("sys-drive", ...gate(drive));
  setSys("sys-display", ...gate(disp));

  // ---- road clearance
  const dir = m.direction;
  const list = dir && dir.vehicles ? Object.entries(dir.vehicles) : [];
  $("proxThreshold").textContent = dir && dir.alertThreshold ? `RANGE ${Math.round(dir.alertThreshold)} m` : "\u2014";
  $("proxList").innerHTML = list.length
    ? list.map(([id, v]) => `<div class="prox${v.alert ? " alert" : ""}">
        <span><b>${esc(v.label || id)}</b><small>${esc(id)}</small></span>
        <span class="m"><b>${fmtDist(v.distance)}</b>${v.headingError}&deg; off path</span>
        <span class="tag">${v.alert ? "ALERT" : "CLEAR"}</span></div>`).join("")
    : '<p class="empty">No other vehicles are being tracked. Vehicles ahead in the ambulance\u2019s lane appear here with an alert as it approaches.</p>';
}

// ------------------------------------------------------------------ log, clock, banners
export function log(text, kind = "") {
  const ol = $("log");
  ol.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
  const span = document.createElement("span");
  if (kind) span.className = kind;
  span.textContent = text;
  li.append(time, span);
  ol.prepend(li);
  while (ol.children.length > 60) ol.lastChild.remove();
}

export function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function setFollowButton(on) {
  $("followBtn").setAttribute("aria-pressed", String(on));
}

export function showBanner(html) {
  const b = $("configBanner");
  b.innerHTML = html;
  b.hidden = false;
}
