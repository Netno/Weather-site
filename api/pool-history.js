/*
 * Läser dygnets pool-stickprov (klor, pH, vattentemp) som pool-log-workflowen
 * skrivit till pool-data-grenen, och serverar dem från samma origin så att
 * frontenden slipper CORS och GitHubs cache-egenheter.
 *
 *   GET /api/pool-history?date=YYYY-MM-DD  ->  { date, unit, tz, samples:[{t,cl,ph,wt,flow}] }
 */
const RAW = "https://raw.githubusercontent.com/Netno/Weather-site/pool-data/pool";

export default async function handler(req, res) {
  const m = String(req.query?.date || "").match(/^\d{4}-\d{2}-\d{2}$/);
  if (!m) return res.status(400).json({ error: "ogiltigt datum" });
  const date = m[0];
  try {
    const r = await fetch(`${RAW}/${date}.json`, { cache: "no-store" });
    if (r.status === 404) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ date, samples: [] });
    }
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const doc = await r.json();
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json(doc);
  } catch {
    res.setHeader("Cache-Control", "s-maxage=30");
    return res.status(200).json({ date, samples: [] });
  }
}
