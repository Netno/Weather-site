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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // 1) Hämta nuvärdet direkt från Aseko (ingen self-fetch). Asekos moln hackar
  // till då och då — ett omtag räddar mätpunkten i stället för att tappa den.
  let pool, asekoErr = null;
  for (let attempt = 1; attempt <= 2 && !pool; attempt++) {
    if (attempt > 1) await sleep(700);
    try {
      const r = await getPool(apiKey, process.env.ASEKO_UNIT_ID);
      if (!r.pool) return res.status(200).json({ status: "hoppar över", reason: "ingen enhet" });
      pool = r.pool;
    } catch (e) {
      asekoErr = (e.detail || e.message || String(e)).slice(0, 160);
    }
  }
  if (!pool) return res.status(502).json({ status: "fel", error: "kunde inte läsa Aseko", detail: asekoErr });

  // 2) Lokal tid (Stockholm)
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const gp = (t) => parts.find((x) => x.type === t).value;
  const date = `${gp("year")}-${gp("month")}-${gp("day")}`;
  const hm = `${gp("hour")}:${gp("minute")}`;
  const path = `pool/${date}.json`;

  // 3–5) Läs dagens fil, lägg till mätpunkten, skriv tillbaka.
  // Contents-API:et svarar 409 om filens sha hunnit ändras mellan läsning och
  // skrivning, och nattjobbet pushar till samma repo. Läs därför om sha:n och
  // försök igen i stället för att tappa mätpunkten. Permanenta fel (401/403 —
  // utgången eller felrättad token) bryter direkt; att försöka om dem är bara
  // slöseri och gör felmeddelandet otydligare.
  const sample = {
    t: hm,
    cl: pool.clFree ?? null,
    ph: pool.ph ?? null,
    wt: pool.waterTemp ?? null,
    flow: pool.flow == null ? null : (truthy(pool.flow) ? 1 : 0),
  };
  const retriable = (s) => s === 409 || s === 429 || s >= 500;
  let last = "inget försök hann göras";

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await sleep(400 * (attempt - 1));

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
        last = `GitHub GET ${r.status}: ${(await r.text()).slice(0, 160)}`;
        if (!retriable(r.status)) return res.status(502).json({ status: "fel", error: last });
        continue;
      }
    } catch (e) {
      last = `GitHub GET kastade: ${String(e).slice(0, 120)}`;
      continue;
    }
    if (!Array.isArray(doc.samples)) doc.samples = [];

    // Dedup samma minut — även efter ett omtag, ifall skrivningen faktiskt gick
    // igenom trots att svaret uteblev
    if (doc.samples.length && doc.samples[doc.samples.length - 1].t === hm) {
      return res.status(200).json({ status: "ok", dedup: true, date, t: hm, count: doc.samples.length, attempt });
    }

    const body = {
      message: `pool: sampel ${date} ${hm}`,
      content: Buffer.from(JSON.stringify({ ...doc, samples: [...doc.samples, sample] })).toString("base64"),
      branch: BRANCH,
      committer: { name: "pool-sampler[bot]", email: "actions@github.com" },
    };
    if (sha) body.sha = sha;
    try {
      const r = await fetch(`${GH}/${path}`, { method: "PUT", headers: { ...ghHeaders(token), "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return res.status(200).json({ status: "ok", date, t: hm, count: doc.samples.length + 1, attempt });
      last = `GitHub PUT ${r.status}: ${(await r.text()).slice(0, 200)}`;
      if (!retriable(r.status)) return res.status(502).json({ status: "fel", error: last });
    } catch (e) {
      last = `GitHub PUT kastade: ${String(e).slice(0, 120)}`;
    }
  }

  return res.status(502).json({ status: "fel", error: "gav upp efter 3 försök", detail: last });
}
