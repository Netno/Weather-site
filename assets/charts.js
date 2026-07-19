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

/* ===== Datatvätt ===========================================================
   Sensorglitchar (lösa kablar, döende batterier) ger fysiskt omöjliga
   värden — rådatan innehåller t.ex. −117 °C, 378 km/h och 1 874 hPa.
   Gränserna ligger utanför allt rimligt för Västsverige; värden utanför
   blir null och behandlas som luckor, precis som saknad data. */
const BOUNDS = {
  temp: [-40, 45],        // °C
  dewpt: [-40, 35],
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

/* Sanera en dygnspost (history/daily eller dailysummary-format) */
function cleanDailyObs(obs) {
  if (!obs?.metric) return obs;
  const m = obs.metric;
  let hi = inBounds(m.tempHigh, "temp");
  let lo = inBounds(m.tempLow, "temp");
  if (hi != null && lo != null && hi < lo) { hi = null; lo = null; } // korrupt par
  return {
    ...obs,
    humidityAvg: inBounds(obs.humidityAvg, "hum"),
    uvHigh: inBounds(obs.uvHigh, "uv"),
    metric: {
      ...m,
      tempHigh: hi,
      tempLow: lo,
      tempAvg: inBounds(m.tempAvg, "temp"),
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
  for (const [date, obs] of Object.entries(raw)) out[date] = obs ? cleanDailyObs(obs) : null;
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
  const pts = [...byH.values()]
    .map(p => ({
      ...p,
      lux: inBounds(p.lux, "lux"),
      uv: inBounds(p.uv, "uv"),
      sec: inBounds(p.sec, "sec"),
      strikes: typeof p.strikes === "number" && p.strikes >= 0 && p.strikes < 250 ? p.strikes : null,
    }))
    .sort((a, b) => a.h - b.h);
  // ljustid är kumulativ under dygnet → minuter ljus per timme = differens
  let prevSec = 0;
  for (const p of pts) {
    p.lightMin = p.sec != null ? Math.max(0, Math.min(60, (p.sec - prevSec) / 60)) : null;
    if (p.sec != null) prevSec = p.sec;
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

function showTip(tip, wrap, x, y, html) {
  tip.innerHTML = html;
  tip.classList.add("on");
  const w = tip.offsetWidth;
  tip.style.left = Math.min(Math.max(x - w / 2, 4), wrap.clientWidth - w - 4) + "px";
  tip.style.top = (y - tip.offsetHeight - 12) + "px";
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
    const step = hi - lo > 24 ? 8 : hi - lo > 12 ? 4 : 2;
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
