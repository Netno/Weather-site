/*
 * Läser pool-arkivet (klor, pH, vattentemp) som pool-log-workflowen skriver
 * till pool-data-grenen, och serverar det från samma origin.
 *
 *   GET /api/pool-history?date=YYYY-MM-DD     -> { date, samples:[{t,cl,ph,wt,flow}] }
 *   GET /api/pool-history?days=7              -> { from, to, samples:[{d,t,cl,ph,wt,flow}] }
 *   GET /api/pool-history?from=A&to=B         -> { from, to, samples:[{d,...}] }
 *
 * OBS: Asekos officiella API (api.aseko.cloud/api/v1) har ingen historik-endpoint
 * (bara auth/check + paired-units[/{serial}]), så arkivet byggs på framåt från
 * vår egen sampling – det går inte att backfilla Asekos 30-dagarshistorik.
 */
const RAW = "https://raw.githubusercontent.com/Netno/Weather-site/pool-data/pool";
const DAYMS = 86_400_000;

async function dayFile(date) {
  try {
    const r = await fetch(`${RAW}/${date}.json`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Räkna upp datum (lokala Stockholm-datum) från–till, inklusive båda ändar.
function enumerate(fromISO, toISO) {
  const out = [];
  let d = new Date(`${fromISO}T12:00:00Z`);
  const end = new Date(`${toISO}T12:00:00Z`);
  while (d <= end && out.length < 95) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + DAYMS); }
  return out;
}

function stockholmToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}

export default async function handler(req, res) {
  const q = req.query || {};

  // Enkeldag (bakåtkompatibelt)
  if (isDate(q.date) && !q.days && !q.from) {
    const doc = (await dayFile(q.date)) || { date: q.date, samples: [] };
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json(doc);
  }

  // Intervall: days=N eller from&to
  let fromISO, toISO;
  if (isDate(q.from) && isDate(q.to)) {
    fromISO = q.from; toISO = q.to;
  } else {
    const n = Math.max(1, Math.min(31, parseInt(q.days, 10) || 1));
    toISO = stockholmToday();
    fromISO = new Date(new Date(`${toISO}T12:00:00Z`).getTime() - (n - 1) * DAYMS).toISOString().slice(0, 10);
  }
  if (fromISO > toISO) [fromISO, toISO] = [toISO, fromISO];

  const dates = enumerate(fromISO, toISO);
  const docs = await Promise.all(dates.map(dayFile));
  const samples = [];
  docs.forEach((doc, i) => {
    if (!doc || !Array.isArray(doc.samples)) return;
    for (const s of doc.samples) samples.push({ d: dates[i], t: s.t, cl: s.cl, ph: s.ph, wt: s.wt, flow: s.flow });
  });

  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
  return res.status(200).json({ from: fromISO, to: toISO, samples });
}
