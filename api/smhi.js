/*
 * Prognosproxy: hämtar SMHI:s öppna punktprognos och förbearbetar den till
 * ett litet, färdigtuggat svar. Ingen nyckel krävs; Vercels edge-cache håller
 * svaret så att SMHI aldrig belastas av antal besökare.
 *
 *   GET /api/smhi  → { referenceTime, hourly: [...~4 dygn], daily: [...~10 dygn] }
 *
 * SMHI stängde den gamla pmp3g-modellen 2026-03-31 och ersatte den med snow1g.
 * Nya svaret har namngivna fält i ett data-objekt (air_temperature m.fl.) i
 * stället för pmp3g:s parameterlista, och tidsnyckeln heter "time".
 * Väderkoden (symbol_code 1–27) tolkas i frontend till ikon + text.
 * Koordinater styrs av STATION_LAT/STATION_LON (fallback: Brämhult).
 */

const LAT = process.env.STATION_LAT || "57.7216";
const LON = process.env.STATION_LON || "13.01";

// SMHI tillåter max 6 decimaler i koordinaterna
const round6 = (s) => (+s).toFixed(6).replace(/\.?0+$/, "");

const stockholmDate = (iso) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(iso));
const stockholmHour = (iso) =>
  +new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false })
    .format(new Date(iso)).replace(/\D/g, "");

const num = (v) => (typeof v === "number" ? v : null);

export default async function handler(req, res) {
  const url =
    "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1" +
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

  // Varje punkt: nederbörden (precipitation_amount_mean) är redan ackumulerad
  // mängd för intervallet fram till "time" — dygnssumman blir därför en ren
  // summa (SMHI glesar ut från 1 h till 3/6 h längre fram).
  const rows = series.map((s) => {
    const d = s.data || {};
    return {
      time: s.time,
      t: num(d.air_temperature),
      ws: num(d.wind_speed),
      wd: num(d.wind_from_direction),
      gust: num(d.wind_speed_of_gust),
      r: num(d.relative_humidity),
      msl: num(d.air_pressure_at_mean_sea_level),
      cloud: num(d.cloud_area_fraction),           // oktas 0–8
      precip: num(d.precipitation_amount_mean),     // mm för intervallet
      pmin: num(d.precipitation_amount_min),
      pmax: num(d.precipitation_amount_max),
      pprob: num(d.probability_of_precipitation),   // %
      symb: num(d.symbol_code),                     // 1–27
    };
  });

  // Timserie för de närmaste ~4 dygnen
  const horizon = new Date(new Date(rows[0].time).getTime() + 4 * 864e5);
  const hourly = rows.filter((r) => new Date(r.time) < horizon);

  // Dygnsaggregat (svensk lokaltid)
  const byDay = new Map();
  for (const r of rows) {
    const day = stockholmDate(r.time);
    let d = byDay.get(day);
    if (!d) { d = { date: day, tMin: null, tMax: null, precip: 0, wsMax: null, gustMax: null, noon: null, noonGap: 99 }; byDay.set(day, d); }
    if (r.t != null) {
      d.tMin = d.tMin == null ? r.t : Math.min(d.tMin, r.t);
      d.tMax = d.tMax == null ? r.t : Math.max(d.tMax, r.t);
    }
    if (r.precip != null) d.precip += r.precip;
    if (r.ws != null) d.wsMax = Math.max(d.wsMax ?? 0, r.ws);
    if (r.gust != null) d.gustMax = Math.max(d.gustMax ?? 0, r.gust);
    const dist = Math.abs(stockholmHour(r.time) - 13);
    if (r.symb != null && dist < d.noonGap) { d.noon = r.symb; d.noonGap = dist; }
  }
  const daily = [...byDay.values()].map(({ noonGap, ...d }) => ({ ...d, precip: +d.precip.toFixed(1) }));

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  return res.status(200).json({ referenceTime: data.referenceTime, hourly, daily });
}
