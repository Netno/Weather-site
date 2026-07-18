/*
 * Proxy för live-vyn: gömmer WU-nyckeln och låter Vercels edge-cache hålla
 * svaret i 60 s så att stationens rate limit aldrig påverkas av antal
 * besökare. Endast de två live-endpointsen är tillåtna — all historik läses
 * ur det statiska arkivet i data/, aldrig härifrån.
 *
 *   GET /api/wu?e=current   → observations/current   (senaste observationen)
 *   GET /api/wu?e=today     → observations/all/1day  (5-minutersvärden sedan midnatt)
 *
 * Kräver miljövariabeln WU_API_KEY i Vercel-projektet.
 */

const ENDPOINTS = {
  current: "observations/current",
  today: "observations/all/1day",
};

export default async function handler(req, res) {
  const key = process.env.WU_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "WU_API_KEY är inte satt i Vercel-projektet" });
  }

  const endpoint = ENDPOINTS[req.query.e];
  if (!endpoint) {
    return res.status(400).json({ error: "Ogiltig endpoint — använd ?e=current eller ?e=today" });
  }

  const base = process.env.WU_API_BASE || "https://api.weather.com/v2/pws";
  const station = process.env.STATION_ID || "IBRMHULT2";
  const url =
    `${base}/${endpoint}?stationId=${station}&format=json&units=m` +
    `&numericPrecision=decimal&apiKey=${key}`;

  let upstream;
  try {
    upstream = await fetch(url);
  } catch {
    return res.status(502).json({ error: "Kunde inte nå api.weather.com" });
  }

  if (upstream.status === 204) {
    // Stationen har inte rapporterat — tomt men giltigt svar
    res.setHeader("Cache-Control", "s-maxage=60");
    return res.status(200).json({ observations: [] });
  }
  if (!upstream.ok) {
    return res.status(502).json({ error: `WU svarade HTTP ${upstream.status}` });
  }

  const body = await upstream.json();
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json(body);
}
