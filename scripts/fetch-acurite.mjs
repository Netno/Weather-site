#!/usr/bin/env node
/*
 * Arkiverar stationens myAcuRite-data (blixtar, lux, ljustid m.m. som
 * aldrig når Weather Underground). Datan ligger som publika dagsfiler med
 * timupplösning på dataapi.myacurite.com — ingen inloggning krävs, bara
 * enhetens data-URL (hålls som secret för att inte publicera MAC-adressen
 * i onödan).
 *
 * Dagsfilerna lagras råa, kanalindelade precis som källan levererar dem —
 * kanaltolkning (16/18 = blixtar, 14 = lux osv.) sker i frontend.
 *
 * Miljövariabler:
 *   ACURITE_DATA_URL  (krävs) t.ex. https://dataapi.myacurite.com/mar-sensor-readings/<enhet>/
 *   CALL_BUDGET       max hämtningar per körning (default 3000)
 *   FIRST_DATE        default 2018-12-05 (stationens första dag enligt meta)
 *   DATA_DIR          default data
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const URL_BASE = process.env.ACURITE_DATA_URL;
const BUDGET = parseInt(process.env.CALL_BUDGET || "3000", 10);
const FIRST_DATE = process.env.FIRST_DATE || "2018-12-05";
const DATA_DIR = process.env.DATA_DIR || "data";
const PACE_MS = parseInt(process.env.PACE_MS || "150", 10);

if (!URL_BASE) {
  console.log("ACURITE_DATA_URL saknas — hoppar över myAcuRite-arkivering.");
  process.exit(0);
}
const BASE = URL_BASE.endsWith("/") ? URL_BASE : URL_BASE + "/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayStockholm() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
}
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let calls = 0;
class BudgetExhausted extends Error {}

async function fetchDay(date) {
  if (calls >= BUDGET) throw new BudgetExhausted();
  for (let attempt = 1; attempt <= 4; attempt++) {
    calls++;
    let res;
    try {
      res = await fetch(`${BASE}1h-summaries/${date}.json`);
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(attempt * 3000);
      continue;
    }
    await sleep(PACE_MS);
    if (res.status === 404 || res.status === 403) return null; // dag utan fil
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        return null; // trasig fil — markera som lucka
      }
    }
    if (attempt === 4) throw new Error(`HTTP ${res.status} för ${date} efter 4 försök`);
    await sleep(attempt * 3000);
  }
}

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
  await writeFile(file, JSON.stringify(obj) + "\n");
}

const manifestPath = path.join(DATA_DIR, "acurite", "manifest.json");
const monthPath = (date) =>
  path.join(DATA_DIR, "acurite", "1h", date.slice(0, 4), `${date.slice(0, 7)}.json`);

const yesterday = addDays(todayStockholm(), -1);
let manifest = await loadJson(manifestPath, null);
if (!manifest) manifest = { firstDate: FIRST_DATE, lastFetched: null, updatedAt: null };

let date = manifest.lastFetched ? addDays(manifest.lastFetched, 1) : manifest.firstDate;
if (date > yesterday) {
  console.log(`myAcuRite-arkivet är redan uppdaterat t.o.m. ${manifest.lastFetched}.`);
  process.exit(0);
}
console.log(`myAcuRite: hämtar ${date} → ${yesterday} (budget ${BUDGET})`);

let cache = { key: null, obj: null };
async function flush() {
  if (cache.key) await saveJson(cache.key, cache.obj);
  manifest.updatedAt = new Date().toISOString();
  await saveJson(manifestPath, manifest);
}

let fetched = 0;
let gaps = 0;
try {
  while (date <= yesterday) {
    const file = monthPath(date);
    if (cache.key !== file) {
      if (cache.key) await saveJson(cache.key, cache.obj);
      cache = { key: file, obj: await loadJson(file, {}) };
    }
    const day = await fetchDay(date);
    cache.obj[date] = day; // null = kontrollerad dag utan fil
    if (!day) gaps++;
    manifest.lastFetched = date;
    fetched++;
    if (fetched % 100 === 0) {
      await flush();
      console.log(`  … ${date} klar (${fetched} dagar)`);
    }
    date = addDays(date, 1);
  }
  console.log(`Klart: myAcuRite-arkivet är komplett t.o.m. ${yesterday}.`);
} catch (err) {
  if (err instanceof BudgetExhausted) {
    console.log(`Budgeten slut — nästa körning fortsätter från ${addDays(manifest.lastFetched, 1)}.`);
  } else {
    await flush();
    throw err;
  }
} finally {
  await flush();
}
console.log(`Sammanfattning: ${fetched} dagar (${gaps} luckor), ${calls} hämtningar, markör: ${manifest.lastFetched}.`);
