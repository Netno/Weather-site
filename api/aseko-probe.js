/*
 * TILLFÄLLIG probe. Steg 2: hämta OpenAPI-specen för att lista ALLA riktiga
 * endpoints i api.aseko.cloud/api/v1 (NestJS → JSON ligger oftast på /docs-json).
 * Då ser vi om Aseko exponerar historik och i så fall på vilken väg.
 *
 *   GET /api/aseko-probe
 */
const ROOT = "https://api.aseko.cloud";
const BASE = `${ROOT}/api/v1`;

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

  // Kandidater för OpenAPI/Swagger-specen (olika ramverk lägger den olika)
  const specUrls = [
    `${BASE}/docs-json`, `${BASE}/docs-yaml`, `${BASE}/docs/json`,
    `${BASE}/swagger-json`, `${BASE}/swagger.json`, `${BASE}/openapi.json`,
    `${ROOT}/api-json`, `${ROOT}/api/docs-json`, `${ROOT}/docs-json`,
    `${BASE}/openapi`, `${BASE}/spec`,
  ];

  let spec = null, specFrom = null, rawSnippet = null;
  for (const u of specUrls) {
    try {
      const r = await fetch(u, { headers: headers(apiKey) });
      if (!r.ok) continue;
      const txt = await r.text();
      try {
        const j = JSON.parse(txt);
        if (j && (j.paths || j.openapi || j.swagger)) { spec = j; specFrom = u; break; }
      } catch {
        if (!rawSnippet) rawSnippet = { url: u, body: txt.slice(0, 200) };
      }
    } catch {}
  }

  if (spec?.paths) {
    const paths = Object.keys(spec.paths).sort();
    const methods = {};
    for (const p of paths) methods[p] = Object.keys(spec.paths[p]).join(",");
    const interesting = paths.filter(p => /histor|measure|log|value|graph|stat|chart|data|trend|sample|series|reading/i.test(p));
    return res.status(200).json({ specFrom, title: spec.info?.title, count: paths.length, interesting, paths: methods });
  }

  // Ingen spec hittad – rapportera vad vi fick så vi kan gå vidare
  return res.status(200).json({ specFound: false, rawSnippet, triedSpecUrls: specUrls });
}
