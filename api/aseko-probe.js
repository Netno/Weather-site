/*
 * TILLFÄLLIG probe för att hitta Asekos historik-endpoint i det officiella
 * API:et (api.aseko.cloud/api/v1). Web-appen visar dygnshistorik, så någon
 * endpoint returnerar tidsserier – den här testar ett gäng kandidater och
 * rapporterar status + ett litet smakprov, så vi kan implementera hämtningen
 * på riktigt. Tas bort när rätt endpoint hittats.
 *
 *   GET /api/aseko-probe            (dagens datum)
 *   GET /api/aseko-probe?date=2026-07-21
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

async function firstSerial(apiKey) {
  const r = await fetch(`${BASE}/paired-units?page=1&limit=100`, { headers: headers(apiKey) });
  if (!r.ok) return null;
  const d = await r.json();
  return Array.isArray(d?.items) && d.items.length ? d.items[0].serialNumber : null;
}

export default async function handler(req, res) {
  const apiKey = process.env.ASEKO_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ASEKO_API_KEY saknas" });

  const date = String(req.query?.date || "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
    || new Date().toISOString().slice(0, 10);
  const s = process.env.ASEKO_UNIT_ID || (await firstSerial(apiKey));
  if (!s) return res.status(200).json({ error: "hittade ingen enhet" });

  const from = `${date}T00:00:00.000Z`;
  const to = `${date}T23:59:59.999Z`;
  const u = `/paired-units/${encodeURIComponent(s)}`;
  const candidates = [
    `${u}/history?date=${date}`,
    `${u}/history?day=${date}`,
    `${u}/history?from=${from}&to=${to}`,
    `${u}/history`,
    `${u}/measurements?date=${date}`,
    `${u}/measurements?from=${from}&to=${to}`,
    `${u}/values?date=${date}`,
    `${u}/values?from=${from}&to=${to}`,
    `${u}/data?date=${date}`,
    `${u}/graph?date=${date}`,
    `${u}/timeline?date=${date}`,
    `${u}/charts?date=${date}`,
    `/history?serialNumber=${s}&date=${date}`,
    `/measurements?serialNumber=${s}&from=${from}&to=${to}`,
  ];

  const out = [];
  for (const path of candidates) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers: headers(apiKey) });
      const body = await r.text();
      out.push({ path, status: r.status, ok: r.ok, sample: r.ok ? body.slice(0, 400) : body.slice(0, 120) });
    } catch (e) {
      out.push({ path, status: "ERR", ok: false, sample: String(e).slice(0, 120) });
    }
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ serial: s, date, results: out });
}
