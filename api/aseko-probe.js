/*
 * TILLFÄLLIG probe. Steg 3: specen finns som YAML på /api/v1/docs-yaml.
 * Vi hämtar den och plockar ut alla endpoint-vägar (rader "  /...:" under paths:)
 * samt metoderna, så vi ser om historik exponeras.
 *
 *   GET /api/aseko-probe
 */
const BASE = "https://api.aseko.cloud/api/v1";

function headers(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
    "x-client-name": "bramhult-weather",
    "x-client-version": "1.0.0",
    accept: "application/json",
  };
}

export default async function handler(req, res) {
  const apiKey = process.env.ASEKO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ASEKO_API_KEY saknas" });

  let yaml;
  try {
    const r = await fetch(`${BASE}/docs-yaml`, { headers: headers(apiKey) });
    yaml = await r.text();
    if (!r.ok) return res.status(200).json({ error: `docs-yaml HTTP ${r.status}`, snippet: yaml.slice(0, 200) });
  } catch (e) {
    return res.status(200).json({ error: String(e) });
  }

  // Plocka ut path-block: rad "  /xxx:" följt av metodrader "    get:" osv.
  const lines = yaml.split("\n");
  const endpoints = [];
  let cur = null;
  let inPaths = false;
  for (const ln of lines) {
    if (/^paths:\s*$/.test(ln)) { inPaths = true; continue; }
    if (!inPaths) continue;
    if (/^\S/.test(ln)) break; // ny toppnivå-nyckel → paths slut
    const pm = ln.match(/^  (\/\S+):\s*$/);
    if (pm) { cur = { path: pm[1], methods: [] }; endpoints.push(cur); continue; }
    const mm = ln.match(/^    (get|post|put|patch|delete):\s*$/);
    if (mm && cur) cur.methods.push(mm[1].toUpperCase());
  }

  const list = endpoints.map(e => `${e.methods.join(",")} ${e.path}`);
  const interesting = list.filter(s => /histor|measure|log|value|graph|stat|chart|data|trend|sample|series|reading|export/i.test(s));
  return res.status(200).json({ count: list.length, interesting, endpoints: list });
}
