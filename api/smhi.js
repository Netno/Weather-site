/*
 * Prognosproxy: hämtar SMHI:s öppna punktprognos (pmp3g) för stationens
 * koordinater och förbearbetar den till ett litet, färdigtuggat svar.
 * SMHI kräver ingen nyckel; Vercels edge-cache håller svaret så att SMHI
 * aldrig belastas av antal besökare (prognosen uppdateras några ggr/dygn).
 *
 *   GET /api/smhi  → { approvedTime, hourly: [...48h], daily: [...~10 dygn] }
 *
 * Koordinater styrs av STATION_LAT/STATION_LON (fallback: Brämhult).
 * Väderkod (Wsymb2 1–27) tolkas i frontend till ikon + text.
 */

const LAT = process.env.STATION_LAT || "57.7216";
const LON = process.env.STATION_LON || "13.01";

// SMHI tillåter max 6 decimaler i koordinaterna
const round6 = (s) => (+s).toFixed(6).replace(/\.?0+$/, "");

function stockholmDate(iso) {
  // 'YYYY-MM-DD' för en UTC-tidsstämpel i svensk lokaltid
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(iso));
}
function stockholmHour(iso) {
  return +new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false,
  }).format(new Date(iso));
}

// Plocka ett parametervärde ur SMHI:s parameterlista (namn → första värdet)
const pick = (params, name) => {
  const p = params.find((x) => x.name === name);
  return p && Array.isArray(p.values) ? p.values[0] : null;
};

export default async function handler(req, res) {
  const url =
    "https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2" +
    `/geotype/point/lon/${round6(LON)}/lat/${round6(LAT)}/data.json`;

  let upstream;
  try {
    upstream = await fetch(url, { headers: { "User-Agent": "bramhult-vader/1.0" } });
  } catch {
    return res.status(502).json({ error: "Kunde inte nå SMHI" });
  }
  if (!upstream.ok) {
    return res.status(502).json({ error: `SMHI svarade HTTP ${upstream.status}` });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return res.status(502).json({ error: "Ogiltigt svar från SMHI" });
  }

  const series = Array.isArray(data.timeSeries) ? data.timeSeries : [];
  if (!series.length) {
    return res.status(502).json({ error: "Tom prognos från SMHI" });
  }

  // Timserie med alla fält vi vill visa. Nederbörd (pmean) är mm/h → för
  // dygnssumman multipliceras med antal timmar till nästa prognospunkt
  // (SMHI glesar ut till 3/6 h längre fram).
  const rows = series.map((s, i) => {
    const p = s.parameters || [];
    const nextT = series[i + 1] ? new Date(series[i + 1].validTime) : null;
    const gapH = nextT ? Math.max(1, Math.round((nextT - new Date(s.validTime)) / 3.6e6)) : 1;
    return {
      time: s.validTime,
      t: pick(p, "t"),
      ws: pick(p, "ws"),
      wd: pick(p, "wd"),
      gust: pick(p, "gust"),
      r: pick(p, "r"),
      msl: pick(p, "msl"),
      cloud: pick(p, "tcc_mean"), // oktas 0–8
      precip: pick(p, "pmean"),   // mm/h
      symb: pick(p, "Wsymb2"),    // 1–27
      _gapH: gapH,
    };
  });

  // Timserie för de närmaste ~4 dygnen (SMHI är timvis första dygnet, sedan
  // 3-timmars — tätt nog för en snygg timprognos). Släpp interna fält.
  const horizon = new Date(new Date(rows[0].time).getTime() + 4 * 864e5);
  const hourly = rows.filter((r) => new Date(r.time) < horizon).map(({ _gapH, ...r }) => r);

  // Dygnsaggregat i svensk lokaltid
  const byDay = new Map();
  for (const r of rows) {
    const day = stockholmDate(r.time);
    let d = byDay.get(day);
    if (!d) { d = { date: day, tMin: null, tMax: null, precip: 0, wsMax: null, gustMax: null, noon: null, noonGap: 99 }; byDay.set(day, d); }
    if (typeof r.t === "number") {
      d.tMin = d.tMin == null ? r.t : Math.min(d.tMin, r.t);
      d.tMax = d.tMax == null ? r.t : Math.max(d.tMax, r.t);
    }
    if (typeof r.precip === "number") d.precip += r.precip * r._gapH;
    if (typeof r.ws === "number") d.wsMax = Math.max(d.wsMax ?? 0, r.ws);
    if (typeof r.gust === "number") d.gustMax = Math.max(d.gustMax ?? 0, r.gust);
    // Väderikon = symbolen närmast kl 12 lokal tid
    const dist = Math.abs(stockholmHour(r.time) - 13);
    if (r.symb != null && dist < d.noonGap) { d.noon = r.symb; d.noonGap = dist; }
  }
  const daily = [...byDay.values()].map(({ noonGap, ...d }) => ({
    ...d, precip: +d.precip.toFixed(1),
  }));

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  return res.status(200).json({ approvedTime: data.approvedTime, hourly, daily });
}
