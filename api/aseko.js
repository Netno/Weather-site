/*
 * Poolautomatik (Aseko ASIN AQUA) via Asekos OFFICIELLA publika API
 * (api.aseko.cloud/api/v1 med Bearer API-nyckel). Delad logik i api/_aseko.js.
 *
 * Miljövariabler i Vercel:
 *   ASEKO_API_KEY    (obligatorisk — skapa på account.aseko.cloud → Profil → API-nycklar)
 *   ASEKO_UNIT_ID    (valfritt — serienummer om du har flera pooler)
 */
import { getPool } from "./_aseko.js";

export default async function handler(req, res) {
  const apiKey = process.env.ASEKO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: "variabler saknas",
      hint: "Lägg ASEKO_API_KEY i Vercel (skapa nyckeln på account.aseko.cloud → Profil → API-nycklar) och gör en redeploy.",
    });
  }
  try {
    const { pool, unitCount, raw } = await getPool(apiKey, process.env.ASEKO_UNIT_ID);
    if (!pool) return res.status(200).json({ status: "inga enheter" });
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    const out = { status: "ok", pool, unitCount };
    if (req.query?.debug) out.raw = raw; // ?debug=1 → hela råsvaret (för att se vilka fält som finns)
    return res.status(200).json(out);
  } catch (err) {
    const status = err.code === "tos" ? 200 : 502;
    return res.status(status).json({ status: "fel", error: err.message, detail: err.detail ?? null });
  }
}
