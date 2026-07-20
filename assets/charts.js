/*
 * Delad diagram- och datakod för live-sidan (/) och historiksidan (/historik/).
 * Klassiskt skript utan moduler — ladda före sidans egen skriptblock.
 */
"use strict";

/* ===== Konstanter & format ================================================= */
const ELEV = 209.1; // stationens höjd enligt API:et — för havsnivåomräkning
const ms = kmh => kmh / 3.6;
const fmt = (n, d = 1) => n.toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hh = h => ("0" + h).slice(-2);
const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december"];
const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const DAY_NAMES = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
const YEAR_COLORS = ["#CE711A", "#2E7CC4", "#0F9182", "#9A6BD0", "#C2517A",
  "#7A8C3F", "#C4A030", "#5B7A99", "#B0653A"];

// Stationen rapporterar absolut tryck; räkna om till havsnivå
function seaLevel(p, tC) {
  if (p == null) return null;
  const t = tC ?? 10;
  return p * Math.pow(1 - (0.0065 * ELEV) / (t + 0.0065 * ELEV + 273.15), -5.257);
}
// Omvänt: havsnivåtryck → stationstryck (AcuRite ger redan havsnivå, WU ger
// stationstryck — konverteras hit så all vidare kod kan behandla dem lika)
function toStationPressure(slHpa, tC) {
  if (slHpa == null) return null;
  const t = tC ?? 10;
  return slHpa * Math.pow(1 - (0.0065 * ELEV) / (t + 0.0065 * ELEV + 273.15), 5.257);
}

/* ===== Datum =============================================================== */
const addDaysIso = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function listDates(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}
const dateLabel = iso => `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1].slice(0, 3)}`;
// Stationens dygn, inte besökarens — allt datumräknande sker i svensk tid
const todayIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

/* ===== Tema (mörkt som standard, val sparas i localStorage) ================
   Standardtemat sätts av en liten inline-skript i <head> före first paint;
   den här knappen låter besökaren växla och kommer ihåg valet. */
const THEME_ICONS = {
  // ikonen visar temat man byter TILL
  toLight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v1.6M12 19.4V21M4.4 4.4l1.1 1.1M18.5 18.5l1.1 1.1M3 12h1.6M19.4 12H21M4.4 19.6l1.1-1.1M18.5 5.5l1.1-1.1"/></svg>',
  toDark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8z"/></svg>',
};
const currentTheme = () => document.documentElement.dataset.theme || "dark";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (e) { /* privat läge — kör ändå */ }
}
function setupThemeToggle(onChange) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const paint = () => {
    const dark = currentTheme() === "dark";
    btn.innerHTML = dark ? THEME_ICONS.toLight : THEME_ICONS.toDark;
    btn.setAttribute("aria-label", dark ? "Byt till ljust tema" : "Byt till mörkt tema");
    btn.setAttribute("title", dark ? "Ljust tema" : "Mörkt tema");
  };
  paint();
  btn.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
    paint();
    // SVG-diagrammen bakar in färgerna vid ritning → rita om med nya temat
    dispatchEvent(new Event("resize"));
    if (onChange) onChange();
  });
}

/* ===== Datatvätt ===========================================================
   Sensorglitchar (lösa kablar, döende batterier) ger fysiskt omöjliga
   värden — rådatan innehåller t.ex. −117 °C, 378 km/h och 1 874 hPa.
   Gränserna ligger utanför allt rimligt för Västsverige; värden utanför
   blir null och behandlas som luckor, precis som saknad data. */
const BOUNDS = {
  // Givaren glappar till sitt felvärde −40 °C och spikar ibland till ~42 °C.
  // Brämhult har aldrig varit i närheten; håll gränserna innanför det fysiskt
  // rimliga så glitcharna rensas (svenskt köldrekord ~−53, värmerekord 38 °C —
  // men lokalt här ryms allt verkligt inom −35…40).
  temp: [-35, 40],        // °C
  dewpt: [-35, 32],
  hum: [1, 100],          // %
  windKph: [0, 180],      // km/h (50 m/s)
  pressureRaw: [850, 1100], // stationstryck hPa
  rainDay: [0, 150],      // mm/dygn
  rainHour: [0, 60],      // mm/tim
  lux: [0, 130000],
  uv: [0, 12],
  sec: [0, 87000],
};
const inBounds = (v, key) => {
  const b = BOUNDS[key];
  return typeof v === "number" && Number.isFinite(v) && v >= b[0] && v <= b[1] ? v : null;
};

/* Säsongsvisa temperaturgränser [min,max] °C per månad för Brämhult. Givaren
   glappar till −40 och spikar ibland högt (t.ex. 42 °C, eller 35 °C mitt i
   januari) — sådant är fysiskt omöjligt för säsongen och rensas här. Marginal
   på några grader över kända lokalrekord så äkta extremvärden får vara kvar. */
const TEMP_MONTH = [
  [-30, 13], [-30, 14], [-25, 20], [-15, 26], [-8, 30], [-2, 34],
  [0, 36], [0, 35], [-5, 31], [-12, 25], [-20, 17], [-28, 14],
];
function tempOk(v, month) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (!month || month < 1 || month > 12) return inBounds(v, "temp");
  const [lo, hi] = TEMP_MONTH[month - 1];
  return v >= lo && v <= hi ? v : null;
}

/* Sanera en dygnspost (history/daily eller dailysummary-format).
   date (ÅÅÅÅ-MM-DD) ger säsongsvis temperaturrensning när den finns. */
function cleanDailyObs(obs, date) {
  if (!obs?.metric) return obs;
  const m = obs.metric;
  const month = date && /^\d{4}-\d{2}/.test(date) ? parseInt(date.slice(5, 7), 10) : null;
  let hi = tempOk(m.tempHigh, month);
  let lo = tempOk(m.tempLow, month);
  if (hi != null && lo != null && hi < lo) { hi = null; lo = null; } // korrupt par
  return {
    ...obs,
    humidityAvg: inBounds(obs.humidityAvg, "hum"),
    uvHigh: inBounds(obs.uvHigh, "uv"),
    metric: {
      ...m,
      tempHigh: hi,
      tempLow: lo,
      tempAvg: tempOk(m.tempAvg, month),
      dewptAvg: inBounds(m.dewptAvg, "dewpt"),
      windspeedAvg: inBounds(m.windspeedAvg, "windKph"),
      // Ensamma orkanspikar med stiltje-medelvind är anemometerglitchar
      windgustHigh: (() => {
        const g = inBounds(m.windgustHigh, "windKph");
        const avg = inBounds(m.windspeedAvg, "windKph");
        return g != null && g > 100 && (avg ?? 0) < 15 ? null : g;
      })(),
      precipTotal: inBounds(m.precipTotal, "rainDay"),
      pressureMax: inBounds(m.pressureMax, "pressureRaw"),
      pressureMin: inBounds(m.pressureMin, "pressureRaw"),
    },
  };
}

/* ===== Hämtning ============================================================ */
// API-anrop: kasta vid fel (anroparen hanterar), ingen klientcache
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
// Arkivfiler: cacheas per URL, null vid miss (fil finns inte ännu)
const archiveCache = new Map();
function getArchive(url) {
  if (!archiveCache.has(url)) {
    archiveCache.set(url, fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
  }
  return archiveCache.get(url);
}
// Dygnsposter saneras vid inläsning så att alla vyer får tvättad data
const dailyYear = async y => {
  const raw = await getArchive(`/data/daily/${y}.json`) ?? {};
  const out = {};
  for (const [date, obs] of Object.entries(raw)) out[date] = obs ? cleanDailyObs(obs, date) : null;
  return out;
};
const hourlyMonth = async ym => await getArchive(`/data/hourly/${ym.slice(0, 4)}/${ym}.json`) ?? {};

/* Timserie för en arkivdag (history/hourly-buckets med High/Low/Avg-fält).
   precipTotal är kumulativ sedan midnatt → regn = differens mellan buckets. */
function daySeries(buckets) {
  if (!buckets?.length) return [];
  let prevCum = 0;
  return buckets.map(o => {
    const h = parseInt(o.obsTimeLocal.slice(11, 13), 10);
    const cum = Math.max(prevCum, inBounds(o.metric.precipTotal, "rainDay") ?? prevCum);
    const temp = inBounds(o.metric.tempAvg ?? o.metric.temp, "temp");
    const pMax = inBounds(o.metric.pressureMax, "pressureRaw");
    const pMin = inBounds(o.metric.pressureMin, "pressureRaw");
    const p = {
      h,
      temp,
      rain: inBounds(Math.max(0, cum - prevCum), "rainHour") ?? 0,
      wind: inBounds(o.metric.windspeedAvg, "windKph"),
      gust: (() => {
        const g = inBounds(o.metric.windgustHigh, "windKph");
        const avg = inBounds(o.metric.windspeedAvg, "windKph");
        return g != null && g > 100 && (avg ?? 0) < 15 ? null : g;
      })(),
      hum: inBounds(o.humidityAvg, "hum"),
      uv: inBounds(o.uvHigh, "uv"),
      dewpt: inBounds(o.metric.dewptAvg, "dewpt"),
      pressure: pMax != null && pMin != null ? seaLevel((pMax + pMin) / 2, temp) : null,
    };
    prevCum = cum;
    return p;
  }).filter(p => p.temp != null);
}

/* Timpunkter för flera dagar; x = dagindex * 24 + timme */
async function collectHourly(dates) {
  const months = [...new Set(dates.map(d => d.slice(0, 7)))];
  const data = Object.fromEntries(await Promise.all(months.map(async m => [m, await hourlyMonth(m)])));
  const pts = [];
  dates.forEach((date, di) => {
    for (const p of daySeries(data[date.slice(0, 7)][date])) pts.push({ ...p, x: di * 24 + p.h, date });
  });
  return pts;
}

/* Dygnsposter för flera dagar; x = dagindex, obs = arkivets daily-objekt */
async function collectDaily(dates) {
  const yearsSet = [...new Set(dates.map(d => d.slice(0, 4)))];
  const data = Object.fromEntries(await Promise.all(yearsSet.map(async y => [y, await dailyYear(y)])));
  return dates.map((date, di) => ({ x: di, date, obs: data[date.slice(0, 4)][date] ?? null }));
}

function rangeXLabels(dates, hourly) {
  const step = Math.max(1, Math.round(dates.length / 6));
  const out = [];
  for (let di = 0; di < dates.length; di += step) {
    out.push({ label: dateLabel(dates[di]), x: hourly ? di * 24 + 12 : di });
  }
  return out;
}

/* ===== myAcuRite-arkivet (data/acurite/) ==================================
   Kanalindelade dagsfiler med timupplösning + dygnsaggregat i daily.json.
   Kanal 13 = UV, 14 = lux, 15 = ljustid (kumulativ s), 16 = blixtar/timme. */
const LUX_COLOR = "#C4A030", UV_COLOR = "#9A6BD0", BLIXT_COLOR = "#D4A017";
const luxFmt = v => v >= 1000 ? Math.round(v / 1000) + "k" : String(Math.round(v));
const acuriteMonth = async ym => await getArchive(`/data/acurite/1h/${ym.slice(0, 4)}/${ym}.json`) ?? {};
const acuriteDaily = async () => await getArchive("/data/acurite/daily.json") ?? {};

/* Timpunkter för flera dagar ur AcuRite-arkivet (motsvarar collectHourly för
   WU); punkterna har temp/rain/wind/gust/pressure i samma form som WU-arkivet. */
async function collectAcuriteHourly(dates) {
  const months = [...new Set(dates.map(d => d.slice(0, 7)))];
  const data = Object.fromEntries(await Promise.all(months.map(async m => [m, await acuriteMonth(m)])));
  const pts = [];
  dates.forEach((date, di) => {
    const day = data[date.slice(0, 7)]?.[date];
    if (!day) return;
    for (const p of acuriteDayPts(day)) {
      if (p.temp != null) pts.push({ ...p, x: di * 24 + p.h, date });
    }
  });
  return pts;
}

/* Dygnsaggregat (daily.json) → WU-liknande daily-obj för periodvyerna */
function acuriteAggToObs(a) {
  if (!a || (a.tMax == null && a.tMin == null)) return null;
  const p = a.pAvg != null ? toStationPressure(a.pAvg, a.tAvg) : null;
  return {
    humidityAvg: null,
    metric: {
      tempHigh: inBounds(a.tMax, "temp"), tempLow: inBounds(a.tMin, "temp"), tempAvg: inBounds(a.tAvg, "temp"),
      precipTotal: inBounds(a.rainDay, "rainDay"),
      windspeedAvg: inBounds(a.windAvg, "windKph"), windgustHigh: inBounds(a.windMax, "windKph"),
      pressureMax: p, pressureMin: p,
    },
  };
}
async function collectAcuriteDaily(dates) {
  const agg = await acuriteDaily();
  return dates.map((date, di) => ({ x: di, date, obs: acuriteAggToObs(agg[date]) }));
}
const stockholmHourFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false });
function acuriteDayPts(day) {
  const byH = new Map();
  const put = (ch, key, unit) => {
    for (const p of day?.[ch] ?? []) {
      const v = p.raw_values?.[unit];
      if (v == null || !p.happened_at) continue;
      const h = parseInt(stockholmHourFmt.format(new Date(p.happened_at)), 10);
      if (!byH.has(h)) byH.set(h, { h });
      byH.get(h)[key] = v;
    }
  };
  put("14", "lux", "LUX");
  put("13", "uv", "");
  put("16", "strikes", "");
  put("15", "sec", "SEC");
  // Väderkanaler så att live-vyns period­grafer kan byggas ur AcuRite:
  put("1", "temp", "C");        // °C
  put("3", "wind", "KPH");      // km/h
  put("4", "winddir", "");      // grader
  put("9", "pSL", "HPA");       // havsnivåtryck
  put("11", "rainCum", "MM");   // dygnsackumulerat regn
  const pts = [...byH.values()]
    .map(p => ({
      ...p,
      lux: inBounds(p.lux, "lux"),
      uv: inBounds(p.uv, "uv"),
      sec: inBounds(p.sec, "sec"),
      strikes: typeof p.strikes === "number" && p.strikes >= 0 && p.strikes < 250 ? p.strikes : null,
      temp: inBounds(p.temp, "temp"),
      wind: inBounds(p.wind, "windKph"),
      gust: inBounds(p.wind, "windKph"), // ingen separat by i timfilen
      // AcuRite ger havsnivåtryck → till stationstryck så seaLevel() ger tillbaka rätt
      pressure: p.pSL != null ? toStationPressure(inBounds(p.pSL, "pressureRaw"), p.temp) : null,
    }))
    .sort((a, b) => a.h - b.h);
  // ljustid är kumulativ under dygnet → minuter ljus per timme = differens
  let prevSec = 0;
  for (const p of pts) {
    p.lightMin = p.sec != null ? Math.max(0, Math.min(60, (p.sec - prevSec) / 60)) : null;
    if (p.sec != null) prevSec = p.sec;
  }
  // regn (kumulativt) → mm per timme = differens
  let prevRain = 0;
  for (const p of pts) {
    const cum = Math.max(prevRain, p.rainCum ?? prevRain);
    p.rain = Math.max(0, cum - prevRain);
    if (p.rainCum != null) prevRain = cum;
  }
  return pts;
}

/* ===== Sol & geometri ====================================================== */
const STATION_LAT = 57.7216;
const DIRS16 = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];

/* Astronomisk dagslängd (timmar) för stationens latitud — solnedgångsekvationen */
function daylightHours(iso) {
  const latR = STATION_LAT * Math.PI / 180;
  const d = new Date(iso + "T12:00:00Z");
  const n = Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400e3);
  const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + n) / 365);
  const cosH = -Math.tan(latR) * Math.tan(decl);
  const H = Math.acos(Math.min(1, Math.max(-1, cosH)));
  return 24 * H / Math.PI;
}

/* Hexfärgsinterpolation för värmekartans skalor */
function lerpColor(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/* ===== SVG-hjälpare ======================================================== */
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};
const H = 220, PAD = { t: 14, r: 12, b: 26, l: 40 };
const yScale = (lo, hi) => v => PAD.t + (hi - v) / (hi - lo) * (H - PAD.t - PAD.b);

function axes(svg, W, yTicks, yFmt, xLabels) {
  for (const { v, y } of yTicks) {
    svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y, y2: y, stroke: css("--grid"), "stroke-width": 1 }));
    const t = el("text", { x: PAD.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: css("--ink-3") });
    t.textContent = yFmt(v);
    svg.append(t);
  }
  for (const { label, x } of xLabels) {
    const t = el("text", { x, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: css("--ink-3") });
    t.textContent = label;
    svg.append(t);
  }
}

/* Y-axelsteg som ger ~5 hjälplinjer oavsett storleksordning (1/2/5·10ⁿ).
   Den fasta trappan 2/4/8 fungerade bara för små spann (temp, vind) och
   sprängde lux/ljustid (0–60 000) till tusentals överlappande etiketter. */
function niceStep(span, target = 5) {
  const raw = (span || 1) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
}

function showTip(tip, wrap, x, y, html) {
  tip.innerHTML = html;
  tip.classList.add("on");
  const w = tip.offsetWidth;
  tip.style.left = Math.min(Math.max(x - w / 2, 4), wrap.clientWidth - w - 4) + "px";
  tip.style.top = (y - tip.offsetHeight - 12) + "px";
}

/* ===== Nyp-zooma ett diagram i helskärm ===================================
   Klonar det redan ritade SVG:t (vektor → skarpt vid all zoom) och visar det
   i en helskärmsvy med nyp-zoom + panorering. Delas av live- och historik-
   sidan; skapar sin egen overlay + CSS första gången setupChartZoom() körs. */
const zoomState = { x: 0, y: 0, k: 1 };
let zoomMode = "image";                 // "image" = förstora klon · "detail" = interaktiv datazoom
const zPointers = new Map();
let zPinchPrev = null, zLastTapT = 0, zLastTapX = 0, zLastTapY = 0, zoomReady = false;
const zStage = () => document.getElementById("zoom-stage");

function refreshZoomButtons() {
  document.querySelectorAll(".chart-card").forEach(card => {
    const hasSvg = !!card.querySelector(".chart-wrap svg");
    let btn = card.querySelector(".zoom-btn");
    if (hasSvg && !btn) {
      btn = document.createElement("button");
      btn.type = "button"; btn.className = "zoom-btn"; btn.setAttribute("aria-label", "Förstora diagram");
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M14 10l7-7M10 14l-7 7"/></svg>';
      btn.addEventListener("click", () => {
        const wrap = card.querySelector(".chart-wrap");
        const title = card.querySelector("h2")?.textContent || "Diagram";
        const cfgFn = wrap && window.chartDetail && window.chartDetail[wrap.id];
        if (cfgFn) {                                   // interaktiv detaljvy (riktig datazoom)
          Promise.resolve(cfgFn(title)).then(cfg => { if (cfg && cfg.series?.some(s => s.pts.length)) openDetail(cfg); else { const svg = card.querySelector(".chart-wrap svg"); if (svg) openZoom(svg, title); } });
          return;
        }
        const svg = card.querySelector(".chart-wrap svg");
        if (svg) openZoom(svg, title);                 // reserv: förstora bilden
      });
      card.appendChild(btn);
    } else if (!hasSvg && btn) {
      btn.remove();
    }
  });
}

function applyZoom() {
  document.getElementById("zoom-pan").style.transform =
    `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.k})`;
}
function clampZoom() {
  const st = zStage(); const w = st.clientWidth, h = st.clientHeight;
  if (zoomState.k <= 1.001) { zoomState.k = 1; zoomState.x = 0; zoomState.y = 0; return; }
  zoomState.x = Math.min(0, Math.max(w - w * zoomState.k, zoomState.x));
  zoomState.y = Math.min(0, Math.max(h - h * zoomState.k, zoomState.y));
}
function zoomAround(lx, ly, newK) {
  newK = Math.min(8, Math.max(1, newK));
  const r = newK / zoomState.k;
  zoomState.x = lx - (lx - zoomState.x) * r;
  zoomState.y = ly - (ly - zoomState.y) * r;
  zoomState.k = newK;
  clampZoom(); applyZoom();
}
function openZoom(svg, title) {
  setupChartZoom();
  zoomMode = "image";
  const pan = document.getElementById("zoom-pan");
  document.getElementById("zoom-title").textContent = title;
  pan.dataset.mode = "image";
  const clone = svg.cloneNode(true);
  clone.removeAttribute("width"); clone.removeAttribute("height");
  pan.innerHTML = ""; pan.append(clone);
  document.getElementById("zoom-hint").textContent = "Zooma med + / − eller nyp · dra för att panorera · dubbeltryck återställer";
  zoomState.x = 0; zoomState.y = 0; zoomState.k = 1;
  applyZoom();
  document.getElementById("zoom-overlay").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeZoom() {
  document.getElementById("zoom-overlay").hidden = true;
  document.getElementById("zoom-pan").innerHTML = "";
  zPointers.clear(); zPinchPrev = null;
  document.body.style.overflow = "";
}

/* ===== Interaktiv detaljvy: riktig datazoom med exakt tid & värde ==========
   Ritar om ur datan (inte en förstorad bild): x/y-zoom, tidsaxel som blir
   finare ju mer man zoomar, och ett hårkors som visar exakt klockslag+värde.
   cfg = { title, series:[{color,dash?,label?,pts:[{x(tim),v}]}], xMin, xMax,
           yFmt(v), unit?, yLo?, padL? } */
const dWin = { x0: 0, x1: 24 };
let dCfg = null, dCursor = null;

function fmtClock(hoursFloat) {
  let h = Math.floor(hoursFloat + 1e-9);
  let m = Math.round((hoursFloat - h) * 60);
  if (m >= 60) { m -= 60; h += 1; }
  return ("0" + ((h % 24 + 24) % 24)).slice(-2) + ":" + ("0" + m).slice(-2);
}
function niceTimeStepHours(spanH) {
  for (const s of [1 / 12, 1 / 6, 1 / 4, 1 / 2, 1, 2, 3, 6, 12]) if (s >= spanH / 6) return s;
  return 24;
}
function dGeom() {
  const st = zStage();
  return { W: st.clientWidth, Hd: st.clientHeight, padT: 16, padB: 34, padR: 16, padL: dCfg.padL ?? 50 };
}
function openDetail(cfg) {
  setupChartZoom();
  zoomMode = "detail";
  dCfg = cfg; dCursor = null;
  dWin.x0 = cfg.xMin; dWin.x1 = cfg.xMax;
  document.getElementById("zoom-title").textContent = cfg.title;
  document.getElementById("zoom-hint").textContent = "Nyp/+ − för att zooma i tid · dra för att panorera · tryck för exakt tid";
  document.getElementById("zoom-pan").style.transform = "none";
  document.getElementById("zoom-overlay").hidden = false;
  document.body.style.overflow = "hidden";
  renderDetail();
}
function renderDetail() {
  if (!dCfg) return;
  const pan = document.getElementById("zoom-pan");
  const { W, Hd, padT, padB, padR, padL } = dGeom();
  const x0 = dWin.x0, x1 = dWin.x1, span = x1 - x0;
  pan.dataset.mode = "detail"; pan.style.transform = "none"; pan.innerHTML = "";
  const svg = el("svg", { viewBox: `0 0 ${W} ${Hd}`, width: W, height: Hd });
  const tip = document.createElement("div"); tip.className = "tooltip";
  pan.append(svg, tip);
  const sx = x => padL + (x - x0) / span * (W - padL - padR);

  // y-omfång ur synliga punkter → zoom avslöjar detaljer även i höjd
  const vis = [];
  for (const s of dCfg.series) for (const p of s.pts) if (p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6) vis.push(p.v);
  if (!vis.length) for (const s of dCfg.series) for (const p of s.pts) vis.push(p.v);
  if (!vis.length) return;
  let lo = Math.min(...vis), hi = Math.max(...vis);
  if (dCfg.yLo != null) lo = Math.min(lo, dCfg.yLo);
  if (lo === hi) { lo -= 1; hi += 1; }
  const m = (hi - lo) * 0.12; lo -= m; hi += m;
  const sy = v => padT + (hi - v) / (hi - lo) * (Hd - padT - padB);

  const yStep = niceStep(hi - lo);
  for (let v = Math.ceil(lo / yStep) * yStep; v <= hi + 1e-9; v += yStep) {
    const y = sy(v);
    svg.append(el("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: css("--grid"), "stroke-width": 1 }));
    const t = el("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 12, fill: css("--ink-3") });
    t.textContent = dCfg.yFmt(v); svg.append(t);
  }
  const tStep = niceTimeStepHours(span);
  for (let x = Math.ceil(x0 / tStep) * tStep; x <= x1 + 1e-6; x += tStep) {
    const xp = sx(x);
    svg.append(el("line", { x1: xp, x2: xp, y1: padT, y2: Hd - padB, stroke: css("--grid"), "stroke-width": 1, opacity: 0.5 }));
    const t = el("text", { x: xp, y: Hd - 12, "text-anchor": "middle", "font-size": 12, fill: css("--ink-3") });
    t.textContent = fmtClock(x); svg.append(t);
  }
  for (const s of dCfg.series) {
    const seg = s.pts.filter(p => p.x >= x0 - span * 0.06 && p.x <= x1 + span * 0.06);
    if (seg.length >= 2) {
      const d = seg.map((p, i) => (i ? "L" : "M") + sx(p.x) + " " + sy(p.v)).join(" ");
      const attrs = { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round" };
      if (s.dash) { attrs["stroke-dasharray"] = "5 4"; attrs["stroke-width"] = 1.5; attrs.opacity = 0.75; }
      svg.append(el("path", attrs));
    }
    if (span <= 4 && seg.length <= 200) for (const p of seg) svg.append(el("circle", { cx: sx(p.x), cy: sy(p.v), r: 2.4, fill: s.color }));
  }
  if (dCursor != null) {
    const cx = Math.max(x0, Math.min(x1, dCursor));
    const finest = dCfg.series.reduce((a, b) => b.pts.length > a.pts.length ? b : a, dCfg.series[0]);
    const near = finest.pts.reduce((b, q) => Math.abs(q.x - cx) < Math.abs(b.x - cx) ? q : b, finest.pts[0]);
    const xp = sx(near.x);
    svg.append(el("line", { x1: xp, x2: xp, y1: padT, y2: Hd - padB, stroke: css("--axis"), "stroke-width": 1, "stroke-dasharray": "3 3" }));
    const rows = dCfg.series.filter(s => s.pts.length).map(s => {
      const p = s.pts.reduce((b, q) => Math.abs(q.x - near.x) < Math.abs(b.x - near.x) ? q : b, s.pts[0]);
      svg.append(el("circle", { cx: sx(p.x), cy: sy(p.v), r: 4, fill: s.color, stroke: css("--card"), "stroke-width": 2 }));
      return { s, p };
    });
    const html = `<span class="t-time">kl ${fmtClock(near.x)}</span><br>` + rows.map(({ s, p }) =>
      `${s.label ? `<span style="color:${s.color}">●</span> ${s.label} ` : ""}<b>${dCfg.yFmt(p.v)}${dCfg.unit ? " " + dCfg.unit : ""}</b>`).join("<br>");
    showTip(tip, pan, xp, sy(rows[0].p.v), html);
  }
}
function detailZoomAt(clientX, factor) {
  const st = zStage(); const rect = st.getBoundingClientRect();
  const { W, padR, padL } = dGeom();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left - padL) / (W - padL - padR)));
  const fx = dWin.x0 + frac * (dWin.x1 - dWin.x0);
  const full = dCfg.xMax - dCfg.xMin;
  const span = Math.max(0.25, Math.min(full, (dWin.x1 - dWin.x0) / factor));
  let x0 = fx - frac * span, x1 = x0 + span;
  if (x0 < dCfg.xMin) { x0 = dCfg.xMin; x1 = x0 + span; }
  if (x1 > dCfg.xMax) { x1 = dCfg.xMax; x0 = x1 - span; }
  dWin.x0 = Math.max(dCfg.xMin, x0); dWin.x1 = Math.min(dCfg.xMax, x1);
  renderDetail();
}
function detailPan(dxPixels) {
  const { W, padR, padL } = dGeom();
  const span = dWin.x1 - dWin.x0;
  let dh = -dxPixels / (W - padL - padR) * span;
  if (dWin.x0 + dh < dCfg.xMin) dh = dCfg.xMin - dWin.x0;
  if (dWin.x1 + dh > dCfg.xMax) dh = dCfg.xMax - dWin.x1;
  dWin.x0 += dh; dWin.x1 += dh;
}
function detailCursorAt(clientX) {
  const st = zStage(); const rect = st.getBoundingClientRect();
  const { W, padR, padL } = dGeom();
  const frac = Math.max(0, Math.min(1, (clientX - rect.left - padL) / (W - padL - padR)));
  dCursor = dWin.x0 + frac * (dWin.x1 - dWin.x0);
}
function setupChartZoom() {
  if (zoomReady) return;
  zoomReady = true;
  const style = document.createElement("style");
  style.textContent = `
    .chart-card { position: relative; }
    .zoom-btn { position: absolute; top: 16px; right: 16px; z-index: 2; width: 30px; height: 30px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center; color: var(--ink-2); cursor: pointer;
      background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; opacity: .7; }
    .zoom-btn:hover { opacity: 1; background: var(--grid); color: var(--ink); }
    .zoom-overlay { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column;
      background: var(--bg); overscroll-behavior: contain; }
    .zoom-overlay[hidden] { display: none; }
    .zoom-bar { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--card-border); }
    .zoom-title { font-size: 15px; font-weight: 650; color: var(--ink); flex: 1; }
    .zoom-close { width: 34px; height: 34px; padding: 0; font-size: 17px; line-height: 1; cursor: pointer;
      color: var(--ink-2); background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; }
    .zoom-close:hover { background: var(--grid); color: var(--ink); }
    .zoom-ctrl { min-width: 38px; height: 34px; padding: 0 10px; font-size: 18px; font-weight: 600; line-height: 1; cursor: pointer;
      color: var(--ink); background: var(--card); border: 1px solid var(--card-border); border-radius: 8px; }
    .zoom-ctrl.reset { font-size: 13px; font-weight: 600; }
    .zoom-ctrl:active { background: var(--grid); }
    .zoom-stage { flex: 1; overflow: hidden; position: relative; touch-action: none; }
    .zoom-pan { position: absolute; inset: 0; transform-origin: 0 0; will-change: transform; }
    .zoom-pan svg { position: absolute; top: 50%; left: 0; transform: translateY(-50%); width: 100%; height: auto; display: block; }
    .zoom-pan[data-mode="detail"] svg { top: 0; transform: none; height: 100%; }
    .zoom-hint { text-align: center; font-size: 12px; color: var(--ink-3); padding: 8px 12px 12px; }`;
  document.head.append(style);

  const overlay = document.createElement("div");
  overlay.id = "zoom-overlay"; overlay.className = "zoom-overlay"; overlay.hidden = true;
  overlay.innerHTML = `
    <div class="zoom-bar"><span class="zoom-title" id="zoom-title"></span>
      <button type="button" class="zoom-ctrl reset" id="zoom-reset" aria-label="Återställ">100%</button>
      <button type="button" class="zoom-ctrl" id="zoom-out" aria-label="Zooma ut">−</button>
      <button type="button" class="zoom-ctrl" id="zoom-in" aria-label="Zooma in">+</button>
      <button type="button" class="zoom-close" id="zoom-close" aria-label="Stäng">✕</button></div>
    <div class="zoom-stage" id="zoom-stage"><div class="zoom-pan" id="zoom-pan"></div></div>
    <div class="zoom-hint" id="zoom-hint">Zooma med + / − eller nyp · dra för att panorera · dubbeltryck återställer</div>`;
  document.body.append(overlay);

  const st = zStage();
  const center = () => { const r = st.getBoundingClientRect(); return r.left + r.width / 2; };
  const zoomBy = f => { const r = st.getBoundingClientRect(); zoomAround(r.width / 2, r.height / 2, zoomState.k * f); };
  document.getElementById("zoom-in").addEventListener("click", () => { if (zoomMode === "detail") detailZoomAt(center(), 1.6); else zoomBy(1.5); });
  document.getElementById("zoom-out").addEventListener("click", () => { if (zoomMode === "detail") detailZoomAt(center(), 1 / 1.6); else zoomBy(1 / 1.5); });
  document.getElementById("zoom-reset").addEventListener("click", () => {
    if (zoomMode === "detail") { dWin.x0 = dCfg.xMin; dWin.x1 = dCfg.xMax; dCursor = null; renderDetail(); }
    else { zoomState.k = 1; clampZoom(); applyZoom(); }
  });
  document.getElementById("zoom-close").addEventListener("click", closeZoom);
  addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeZoom(); });
  st.addEventListener("pointerdown", e => {
    st.setPointerCapture(e.pointerId);
    zPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0 });
    zPinchPrev = null;
  });
  st.addEventListener("pointermove", e => {
    const prev = zPointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY, moved: prev.moved + Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) };
    zPointers.set(e.pointerId, cur);
    const rect = st.getBoundingClientRect();
    if (zoomMode === "detail") {
      if (zPointers.size === 1) { detailPan(cur.x - prev.x); detailCursorAt(cur.x); renderDetail(); }
      else {
        const pts = [...zPointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        if (zPinchPrev) detailZoomAt(midX, dist / zPinchPrev.dist);
        zPinchPrev = { dist };
      }
      return;
    }
    if (zPointers.size === 1) {
      zoomState.x += cur.x - prev.x; zoomState.y += cur.y - prev.y;
      clampZoom(); applyZoom();
    } else {
      const pts = [...zPointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const lx = (pts[0].x + pts[1].x) / 2 - rect.left;
      const ly = (pts[0].y + pts[1].y) / 2 - rect.top;
      if (zPinchPrev) {
        zoomAround(lx, ly, zoomState.k * dist / zPinchPrev.dist);
        zoomState.x += lx - zPinchPrev.lx; zoomState.y += ly - zPinchPrev.ly;
        clampZoom(); applyZoom();
      }
      zPinchPrev = { dist, lx, ly };
    }
  });
  const endPointer = e => {
    const p = zPointers.get(e.pointerId);
    zPointers.delete(e.pointerId); zPinchPrev = null;
    if (!(p && p.moved < 12 && zPointers.size === 0)) return;
    if (zoomMode === "detail") { detailCursorAt(e.clientX); renderDetail(); return; }  // tryck → läs exakt tid
    const now = performance.now(), rect = st.getBoundingClientRect();
    if (now - zLastTapT < 300 && Math.abs(e.clientX - zLastTapX) < 30 && Math.abs(e.clientY - zLastTapY) < 30) {
      zoomAround(e.clientX - rect.left, e.clientY - rect.top, zoomState.k > 1.5 ? 1 : 3);
      zLastTapT = 0;
    } else { zLastTapT = now; zLastTapX = e.clientX; zLastTapY = e.clientY; }
  };
  st.addEventListener("pointerup", endPointer);
  st.addEventListener("pointercancel", endPointer);
  st.addEventListener("wheel", e => {
    e.preventDefault();
    if (zoomMode === "detail") { detailZoomAt(e.clientX, e.deltaY < 0 ? 1.2 : 1 / 1.2); return; }
    const rect = st.getBoundingClientRect();
    zoomAround(e.clientX - rect.left, e.clientY - rect.top, zoomState.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  addEventListener("resize", () => { if (!overlay.hidden && zoomMode === "detail") renderDetail(); });
}

/* Montera ett diagram i ett wrap-element. draw som returnerar false → tomtext.
   Dolda element (bredd 0) hoppas över — anroparen renderar om vid visning. */
function mountChart(wrapId, draw) {
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML = "";
  if (!wrap.clientWidth) return;
  const W = wrap.clientWidth;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
  const tip = document.createElement("div");
  tip.className = "tooltip";
  wrap.append(svg, tip);
  if (draw(svg, tip, W) === false) {
    wrap.innerHTML = '<div class="chart-empty">Ingen data för det här valet ännu</div>';
  }
  if (typeof refreshZoomButtons === "function") refreshZoomButtons();
}

/* ===== Renderare =========================================================== */

/* Flerseriediagram med krysshårstooltip.
   series: [{label, color, dash?, pts: [{x, v, t?}]}] */
function multiLine(wrapId, series, opts) {
  mountChart(wrapId, (svg, tip, W) => {
    const all = series.flatMap(s => s.pts.map(p => p.v));
    if (!all.length) return false;
    const lo = opts.yLo ?? Math.floor(Math.min(...all)) - 1;
    const hi = opts.yHi ?? Math.ceil(Math.max(...all)) + 1;
    const sy = yScale(lo, hi);
    const sx = x => PAD.l + x / opts.xMax * (W - PAD.l - PAD.r);
    const ticks = [];
    const step = niceStep(hi - lo);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push({ v, y: sy(v) });
    axes(svg, W, ticks, opts.yFmt ?? (v => v), opts.xLabels.map(l => ({ label: l.label, x: sx(l.x) })));

    // Bryt linjen vid stora hål (glitchar/döda batterier) i stället för
    // att rita en falsk rät linje över luckan
    const gapX = opts.gapX ?? Infinity;
    const segments = pts => {
      const segs = [];
      let cur = [];
      for (const p of pts) {
        if (cur.length && p.x - cur[cur.length - 1].x > gapX) { segs.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) segs.push(cur);
      return segs;
    };
    const pathOf = pts => pts.map((p, i) => (i ? "L" : "M") + sx(p.x) + " " + sy(p.v)).join(" ");

    if (opts.area && series.length === 1 && series[0].pts.length > 1) {
      const base = sy(lo);
      for (const seg of segments(series[0].pts)) {
        if (seg.length < 2) continue;
        svg.append(el("path", {
          d: `${pathOf(seg)} L ${sx(seg[seg.length - 1].x)} ${base} L ${sx(seg[0].x)} ${base} Z`,
          fill: series[0].color, "fill-opacity": 0.1,
        }));
      }
    }
    for (const s of series) {
      if (!s.pts.length) continue;
      const d = segments(s.pts).map(pathOf).join(" ");
      const attrs = { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", opacity: 0.9 };
      if (s.dash) { attrs["stroke-dasharray"] = "5 4"; attrs["stroke-width"] = 1.5; attrs.opacity = 0.7; }
      svg.append(el("path", attrs));
    }
    if (opts.endDot && series[0]?.pts.length) {
      const last = series[0].pts[series[0].pts.length - 1];
      svg.append(el("circle", { cx: sx(last.x), cy: sy(last.v), r: 4, fill: series[0].color, stroke: css("--card"), "stroke-width": 2 }));
    }

    const cross = el("line", { y1: PAD.t, y2: H - PAD.b, stroke: css("--axis"), "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
    svg.append(cross);
    svg.addEventListener("pointermove", e => {
      const r = svg.getBoundingClientRect();
      const xGuess = ((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * opts.xMax;
      const rows = [];
      let anchorX = null;
      for (const s of series) {
        if (!s.pts.length) continue;
        const p = s.pts.reduce((b, q) => Math.abs(q.x - xGuess) < Math.abs(b.x - xGuess) ? q : b, s.pts[0]);
        if (Math.abs(p.x - xGuess) > opts.snap) continue;
        rows.push(`<span style="color:${s.color}">●</span> ${s.label} <b>${fmt(p.v)}</b>`);
        anchorX = sx(p.x);
      }
      if (!rows.length || anchorX == null) { cross.setAttribute("visibility", "hidden"); tip.classList.remove("on"); return; }
      cross.setAttribute("x1", anchorX); cross.setAttribute("x2", anchorX); cross.setAttribute("visibility", "visible");
      showTip(tip, svg.parentElement, anchorX, PAD.t + 40,
        `<span class="t-time">${opts.tipTitle(xGuess)}</span><br>${rows.join("<br>")}`);
    });
    svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.classList.remove("on"); });
  });
}

/* Staplar (nederbörd). bars: [{x, v, t}], slots = antal staplar som får plats */
function barsChart(wrapId, bars, slots, opts) {
  mountChart(wrapId, (svg, tip, W) => {
    if (!bars.length) return false;
    const hi = Math.max(opts.minY ?? 2, Math.ceil(Math.max(...bars.map(b => b.v)) * 1.15));
    const sy = yScale(0, hi);
    const slot = (W - PAD.l - PAD.r) / slots;
    const bw = Math.max(slot - 2, 1.2);
    const ticks = [];
    const step = hi > 40 ? 20 : hi > 16 ? 8 : hi > 8 ? 4 : hi > 4 ? 2 : hi > 2 ? 1 : 0.5;
    for (let v = 0; v <= hi; v += step) ticks.push({ v, y: sy(v) });
    axes(svg, W, ticks, v => fmt(v, step < 1 ? 1 : 0), opts.xLabels.map(l => ({ label: l.label, x: PAD.l + (l.x + 0.5) * slot })));
    for (const b of bars) {
      const x = PAD.l + b.x * slot + (slot - bw) / 2;
      const y = sy(b.v), base = sy(0);
      const zero = b.v < 0.05;
      const bar = el("rect", { x, y: zero ? base - 1.5 : y, width: bw, height: zero ? 1.5 : base - y,
        rx: Math.min(2, bw / 2), fill: zero ? css("--grid") : (opts.color ?? css("--rain")) });
      bar.addEventListener("pointerenter", () => showTip(tip, svg.parentElement, x + bw / 2, zero ? base - 1.5 : y,
        `<span class="t-time">${b.t}</span><br><b>${fmt(b.v, opts.dec ?? 1)} ${opts.unit ?? "mm"}</b>`));
      bar.addEventListener("pointerleave", () => tip.classList.remove("on"));
      svg.append(bar);
    }
  });
}

/* Max–min-band med medellinje (temperatur i dygnsupplösning).
   pts: [{x, lo, hi, avg, t}] */
function bandChart(wrapId, pts, color, opts) {
  mountChart(wrapId, (svg, tip, W) => {
    if (pts.length < 2) return false;
    const lo = Math.floor(Math.min(...pts.map(p => p.lo))) - 1;
    const hi = Math.ceil(Math.max(...pts.map(p => p.hi))) + 1;
    const sy = yScale(lo, hi);
    const sx = x => PAD.l + x / opts.xMax * (W - PAD.l - PAD.r);
    const ticks = [];
    const step = hi - lo > 24 ? 8 : hi - lo > 12 ? 4 : 2;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push({ v, y: sy(v) });
    axes(svg, W, ticks, v => v + "°", opts.xLabels.map(l => ({ label: l.label, x: sx(l.x) })));

    const top = pts.map((p, i) => (i ? "L" : "M") + sx(p.x) + " " + sy(p.hi)).join(" ");
    const bottom = [...pts].reverse().map(p => "L" + sx(p.x) + " " + sy(p.lo)).join(" ");
    svg.append(el("path", { d: top + " " + bottom + " Z", fill: color, "fill-opacity": 0.16 }));
    const avgLine = pts.map((p, i) => (i ? "L" : "M") + sx(p.x) + " " + sy(p.avg)).join(" ");
    svg.append(el("path", { d: avgLine, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));

    const cross = el("line", { y1: PAD.t, y2: H - PAD.b, stroke: css("--axis"), "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
    svg.append(cross);
    svg.addEventListener("pointermove", e => {
      const r = svg.getBoundingClientRect();
      const xGuess = ((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * opts.xMax;
      const p = pts.reduce((b, q) => Math.abs(q.x - xGuess) < Math.abs(b.x - xGuess) ? q : b, pts[0]);
      const x = sx(p.x);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      showTip(tip, svg.parentElement, x, sy(p.hi),
        `<span class="t-time">${p.t}</span><br>Max <b>${fmt(p.hi)}°</b> · medel <b>${fmt(p.avg)}°</b> · min <b>${fmt(p.lo)}°</b>`);
    });
    svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.classList.remove("on"); });
  });
}
