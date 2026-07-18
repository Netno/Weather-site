#!/usr/bin/env node
/*
 * Hämtar historik för väderstationen från Weather Underground PWS API och
 * lagrar den i det lokala arkivet under data/. Samma skript används för både
 * backfill och den nattliga inkrementella hämtningen: det hämtar alla dagar
 * från arkivets markör (manifest.lastFetched) fram till gårdagen, svensk tid.
 *
 * WU:s gratisnyckel tillåter 1500 anrop/dygn och 30/min. Varje arkiverad dag
 * kostar 2 anrop (history/daily + history/hourly), så skriptet tar en paus
 * mellan anropen och stannar snyggt när CALL_BUDGET är slut — nästa körning
 * fortsätter där den slutade. En flerårig backfill blir klar på några nätter.
 *
 * Miljövariabler:
 *   WU_API_KEY   (krävs) API-nyckel — läggs som secret, aldrig i repot
 *   STATION_ID   stations-ID (default IBRMHULT2)
 *   CALL_BUDGET  max API-anrop per körning (default 1200, lämnar marginal)
 *   FIRST_DATE   YYYY-MM-DD; sätt för att hoppa över autodetektering av
 *                stationens första dag med data
 *   API_BASE     bas-URL (default https://api.weather.com/v2/pws)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = process.env.API_BASE || "https://api.weather.com/v2/pws";
const KEY = process.env.WU_API_KEY;
const STATION = process.env.STATION_ID || "IBRMHULT2";
const BUDGET = parseInt(process.env.CALL_BUDGET || "1200", 10);
const PACE_MS = parseInt(process.env.PACE_MS || "2200", 10); // < 30 anrop/min
const DATA_DIR = process.env.DATA_DIR || "data";

if (!KEY) {
  console.error("WU_API_KEY saknas — sätt den som miljövariabel/secret.");
  process.exit(1);
}

/* ===== Datumhjälpare (alla datum som "YYYY-MM-DD"-strängar) ================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayStockholm() {
  // sv-SE-formatet är redan YYYY-MM-DD
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}

function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const compact = (date) => date.replaceAll("-", "");

/* ===== API-anrop med paus, budget och backoff ============================== */

let calls = 0;

class BudgetExhausted extends Error {}

async function apiGet(pathAndQuery) {
  if (calls >= BUDGET) throw new BudgetExhausted();
  const url = `${API_BASE}${pathAndQuery}&apiKey=${KEY}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    calls++;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      // Nätverksfel — backa av och försök igen
      if (attempt === 5) throw err;
      await sleep(attempt * 5000);
      continue;
    }
    await sleep(PACE_MS);
    if (res.status === 204 || res.status === 404) return null; // ingen data den dagen
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`API-nyckeln avvisades (HTTP ${res.status}).`);
    }
    if (attempt === 5) throw new Error(`HTTP ${res.status} från ${API_BASE} efter 5 försök.`);
    await sleep(attempt * 5000); // 429/5xx — vänta och försök igen
  }
}

const dailyQuery = (date) =>
  `/history/daily?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&date=${compact(date)}`;
const hourlyQuery = (date) =>
  `/history/hourly?stationId=${STATION}&format=json&units=m&numericPrecision=decimal&date=${compact(date)}`;

async function hasData(date) {
  const r = await apiGet(dailyQuery(date));
  return (r?.observations?.length ?? 0) > 0;
}

/* ===== Autodetektering av stationens första dag ============================
 * 1. Årsskann bakåt: fyra provdatum per år tills ett år helt utan data.
 * 2. Månadsskann framåt från januari året före första träffåret (stationen
 *    kan ha startat sent på ett år vars provdatum alla var tomma).
 * 3. Dagsskann bakåt från första träffen; ger upp efter 14 tomma dagar i rad
 *    så att enstaka luckor inte stoppar sökningen.
 * Kostar normalt 30–60 anrop och körs bara en gång (resultatet hamnar i
 * manifestet). Sätt FIRST_DATE för att hoppa över helt.
 */
async function findFirstDate(yesterday) {
  console.log("Letar efter stationens första dag med data …");
  const curYear = parseInt(yesterday.slice(0, 4), 10);
  let firstYearWithData = null;
  for (let y = curYear; y >= 2000; y--) {
    const samples = [`${y}-01-02`, `${y}-04-01`, `${y}-07-01`, `${y}-10-01`].filter(
      (d) => d <= yesterday
    );
    let any = false;
    for (const s of samples) {
      if (await hasData(s)) { any = true; break; }
    }
    if (any) firstYearWithData = y;
    else if (firstYearWithData) break;
  }
  if (!firstYearWithData) {
    throw new Error(`Hittade ingen historik alls för ${STATION} — kontrollera stations-ID.`);
  }

  let firstHit = null;
  let month = `${firstYearWithData - 1}-01`;
  while (!firstHit && month <= yesterday.slice(0, 7)) {
    for (const day of [`${month}-01`, `${month}-15`]) {
      if (day <= yesterday && (await hasData(day))) { firstHit = day; break; }
    }
    const [y, m] = month.split("-").map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  if (!firstHit) firstHit = yesterday;

  let earliest = firstHit;
  let misses = 0;
  for (let d = addDays(firstHit, -1); misses < 14; d = addDays(d, -1)) {
    if (await hasData(d)) { earliest = d; misses = 0; }
    else misses++;
  }
  console.log(`Första dag med data: ${earliest} (${calls} anrop användes för sökningen)`);
  return earliest;
}

/* ===== Arkivfiler ==========================================================
 * data/manifest.json          — markör + metadata, styr nästa körning
 * data/daily/YYYY.json        — { "YYYY-MM-DD": <daily obs> | null (= lucka) }
 * data/hourly/YYYY/YYYY-MM.json — { "YYYY-MM-DD": [<hourly obs> …] }
 * Observationerna sparas exakt som API:et levererar dem (samma struktur som
 * mocken använder) — enheter konverteras i frontend, inte här.
 */

async function loadJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function saveJson(file, obj) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, 1) + "\n");
}

const manifestPath = path.join(DATA_DIR, "manifest.json");
const dailyPath = (date) => path.join(DATA_DIR, "daily", `${date.slice(0, 4)}.json`);
const hourlyPath = (date) =>
  path.join(DATA_DIR, "hourly", date.slice(0, 4), `${date.slice(0, 7)}.json`);

/* ===== Huvudflöde ========================================================== */

const yesterday = addDays(todayStockholm(), -1);

let manifest = await loadJson(manifestPath, null);
if (!manifest) {
  const firstDate = process.env.FIRST_DATE || (await findFirstDate(yesterday));
  manifest = { stationId: STATION, firstDate, lastFetched: null, updatedAt: null };
}

let date = manifest.lastFetched ? addDays(manifest.lastFetched, 1) : manifest.firstDate;
if (date > yesterday) {
  console.log(`Arkivet är redan uppdaterat t.o.m. ${manifest.lastFetched} — inget att hämta.`);
  process.exit(0);
}
console.log(`Hämtar ${date} → ${yesterday} (budget: ${BUDGET - calls} anrop kvar)`);

// Cache för öppna arkivfiler så vi inte läser/skriver för varje dag
let dailyCache = { key: null, obj: null };
let hourlyCache = { key: null, obj: null };

async function withFile(cache, file, fn) {
  if (cache.key !== file) {
    if (cache.key) await saveJson(cache.key, cache.obj);
    cache.key = file;
    cache.obj = await loadJson(file, {});
  }
  fn(cache.obj);
}

async function flush() {
  if (dailyCache.key) await saveJson(dailyCache.key, dailyCache.obj);
  if (hourlyCache.key) await saveJson(hourlyCache.key, hourlyCache.obj);
  manifest.updatedAt = new Date().toISOString();
  await saveJson(manifestPath, manifest);
}

let fetched = 0;
let gaps = 0;
try {
  while (date <= yesterday) {
    if (calls + 2 > BUDGET) throw new BudgetExhausted();
    const daily = await apiGet(dailyQuery(date));
    const hourly = await apiGet(hourlyQuery(date));
    const dailyObs = daily?.observations?.[0] ?? null;
    const hourlyObs = hourly?.observations ?? [];

    await withFile(dailyCache, dailyPath(date), (obj) => { obj[date] = dailyObs; });
    if (hourlyObs.length) {
      await withFile(hourlyCache, hourlyPath(date), (obj) => { obj[date] = hourlyObs; });
    }
    if (!dailyObs) gaps++;
    manifest.lastFetched = date;
    fetched++;
    if (fetched % 50 === 0) {
      await flush();
      console.log(`  … ${date} klar (${fetched} dagar, ${calls} anrop)`);
    }
    date = addDays(date, 1);
  }
  console.log(`Klart: arkivet är komplett t.o.m. ${yesterday}.`);
} catch (err) {
  if (err instanceof BudgetExhausted) {
    console.log(`Anropsbudgeten är slut — nästa körning fortsätter från ${addDays(manifest.lastFetched, 1)}.`);
  } else {
    await flush(); // spara det som hann hämtas innan felet
    throw err;
  }
} finally {
  await flush();
}

console.log(
  `Sammanfattning: ${fetched} dagar hämtade (${gaps} utan data), ${calls} API-anrop, ` +
  `markör: ${manifest.lastFetched ?? "ingen"}.`
);
