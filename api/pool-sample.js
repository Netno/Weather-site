/*
 * Loggar EN mätpunkt av pooldatan till arkivet (pool-data-grenen). Tänkt att
 * anropas av en pålitlig extern schemaläggare (cron-job.org) var 5:e–10:e minut,
 * så upplösningen blir jämn dygnet runt – oberoende av telefon, widget och sajt.
 *
 *   GET /api/pool-sample?key=<POOL_SAMPLE_KEY>
 *
 * Miljövariabler i Vercel:
 *   ASEKO_API_KEY      (redan satt – används för att läsa nuvärdet direkt)
 *   GITHUB_TOKEN       fine-grained PAT för repo Netno/Weather-site, Contents: Read and write
 *   POOL_SAMPLE_KEY    valfri hemlig sträng – krävs som ?key= om den är satt (spärrar spam)
 *
 * Skriver till pool/<YYYY-MM-DD>.json via GitHubs Contents-API. Dubbletter samma
 * minut hoppas över. /api/pool-history läser samma arkiv.
 */
import { getPool } from "./_aseko.js";

const OWNER = "Netno", REPO = "Weather-site", BRANCH = "pool-data";
const GH = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;

const truthy = (v) => /^(true|on|1|yes|ja|flow|running)$/i.test(String(v));

function ghHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "bramhult-pool-sampler",
  };
}

export default async function handler(req, res) {
  const token = process.env.GITHUB_TOKEN;
  const apiKey = process.env.ASEKO_API_KEY;
  const key = process.env.POOL_SAMPLE_KEY;
  if (!token) return res.status(500).json({ status: "fel", error: "GITHUB_TOKEN saknas i Vercel" });
  if (!apiKey) return res.status(500).json({ status: "fel", error: "ASEKO_API_KEY saknas i Vercel" });
  if (key && req.query?.key !== key) return res.status(401).json({ status: "fel", error: "fel eller saknad key" });

  // 1) Hämta nuvärdet direkt från Aseko (ingen self-fetch)
  let pool;
  try {
    const r = await getPool(apiKey, process.env.ASEKO_UNIT_ID);
    if (!r.pool) return res.status(200).json({ status: "hoppar över", reason: "ingen enhet" });
    pool = r.pool;
  } catch (e) {
    return res.status(502).json({ status: "fel", error: "kunde inte läsa Aseko", detail: (e.detail || e.message || String(e)).slice(0, 160) });
  }

  // 2) Lokal tid (Stockholm)
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const gp = (t) => parts.find((x) => x.type === t).value;
  const date = `${gp("year")}-${gp("month")}-${gp("day")}`;
  const hm = `${gp("hour")}:${gp("minute")}`;
  const path = `pool/${date}.json`;

  // 3) Läs dagens fil (om den finns)
  let doc = { date, unit: pool.serial ?? null, tz: "Europe/Stockholm", samples: [] };
  let sha = null;
  try {
    const r = await fetch(`${GH}/${path}?ref=${BRANCH}`, { headers: ghHeaders(token) });
    if (r.ok) {
      const j = await r.json();
      sha = j.sha;
      const prev = JSON.parse(Buffer.from(j.content, "base64").toString("utf8"));
      if (prev && Array.isArray(prev.samples)) doc = prev;
    } else if (r.status !== 404) {
      return res.status(502).json({ status: "fel", error: `GitHub GET ${r.status}`, detail: (await r.text()).slice(0, 160) });
    }
  } catch (e) {
    return res.status(502).json({ status: "fel", error: "GitHub GET kastade", detail: String(e).slice(0, 120) });
  }
  if (!Array.isArray(doc.samples)) doc.samples = [];

  // 4) Dedup samma minut
  if (doc.samples.length && doc.samples[doc.samples.length - 1].t === hm) {
    return res.status(200).json({ status: "ok", dedup: true, date, t: hm, count: doc.samples.length });
  }

  doc.samples.push({
    t: hm,
    cl: pool.clFree ?? null,
    ph: pool.ph ?? null,
    wt: pool.waterTemp ?? null,
    flow: pool.flow == null ? null : (truthy(pool.flow) ? 1 : 0),
  });

  // 5) Skriv tillbaka
  const body = {
    message: `pool: sampel ${date} ${hm}`,
    content: Buffer.from(JSON.stringify(doc)).toString("base64"),
    branch: BRANCH,
    committer: { name: "pool-sampler[bot]", email: "actions@github.com" },
  };
  if (sha) body.sha = sha;
  try {
    const r = await fetch(`${GH}/${path}`, { method: "PUT", headers: { ...ghHeaders(token), "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return res.status(502).json({ status: "fel", error: `GitHub PUT ${r.status}`, detail: (await r.text()).slice(0, 200) });
  } catch (e) {
    return res.status(502).json({ status: "fel", error: "GitHub PUT kastade", detail: String(e).slice(0, 120) });
  }

  return res.status(200).json({ status: "ok", date, t: hm, count: doc.samples.length });
}
