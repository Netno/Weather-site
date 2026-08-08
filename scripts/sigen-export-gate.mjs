#!/usr/bin/env node
/*
 * Exportspärr för SigenStor: håller tillbaka försäljning till nätet när energin
 * är värd mer i batteriet än vad den ger betalt just nu.
 *
 * Idén: en kWh du säljer nu ger `sell` kronor. Samma kWh kvar i batteriet
 * sparar dig `buy` kronor när du annars hade köpt den senare — men bara efter
 * förluster (verkningsgrad) och bara om du faktiskt kommer behöva den. Hur
 * troligt det är avgörs av laddningsnivån: med tomt batteri kommer du nästan
 * säkert köpa i kväll, med nästan fullt batteri blir överskottet sålt ändå.
 *
 *     behåll om    verkningsgrad × dyraste_köp_framåt × behovsfaktor(SOC)  >  sälj_nu
 *
 * Med 60 % SOC och 2 kr/kWh i ersättning blir behovsfaktorn låg och försäljning
 * lönsam; med 20 % SOC krävs ett betydligt högre pris för att det ska löna sig.
 *
 *   node scripts/sigen-export-gate.mjs                  # torrkörning (skriver inget)
 *   node scripts/sigen-export-gate.mjs --interval=300   # torrkörning var 5:e minut
 *   node scripts/sigen-export-gate.mjs --live           # styr på riktigt
 *
 * Spärren sätts med register 40042 ("PCS maximum export limitation"), som
 * enligt protokollet gäller globalt oavsett EMS-läge. Vi tar alltså aldrig över
 * EMS-styrningen — batteriet sköter sig självt, vi sätter bara ett tak utåt.
 *
 * VIKTIGT: taket ligger kvar tills någon tar bort det. Skriptet släpper det
 * därför vid varje fel, vid avslut och när priset inte går att hämta.
 */

import { connect, readFields, writeHolding, u32words, EXPORT_LIMIT_REG, EXPORT_LIMIT_OFF } from "./lib/sigen-modbus.mjs";

const arg = (name, def) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const num = (v, def) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };

const CFG = {
  host: process.env.SIGEN_HOST || "192.168.0.189",
  port: parseInt(process.env.SIGEN_PORT || "502", 10),
  area: process.env.SPOT_AREA || "SE3",

  // Ersättning när du säljer, kr/kWh utöver spotpriset.
  sellAdder: num(process.env.SELL_ADDER, 0),
  // Skattereduktion för mikroproduktion. Gäller upp till 30 000 kWh/år och
  // förutsätter att du köper minst lika mycket som du säljer — sätt 0 om du
  // ligger över taket eller inte är berättigad.
  sellTaxCredit: num(process.env.SELL_TAX_CREDIT, 0.60),

  // Kostnad när du köper, kr/kWh utöver spot och EXKLUSIVE moms.
  // KONTROLLERA mot din faktura — de här är exempelvärden, inte fakta.
  buyAdder: num(process.env.BUY_ADDER, 0.08),        // elhandlarens påslag + elcert
  buyEnergyTax: num(process.env.BUY_ENERGY_TAX, 0.439), // energiskatt
  buyTransfer: num(process.env.BUY_TRANSFER, 0.25),  // elöverföring
  vat: num(process.env.VAT, 0.25),

  efficiency: num(process.env.EFFICIENCY, 0.90),     // tur och retur genom batteriet
  socLow: num(process.env.SOC_LOW, 25),              // under detta: håll hårt
  socFull: num(process.env.SOC_FULL, 90),            // över detta: sälj fritt
  lookaheadH: num(process.env.LOOKAHEAD_H, 18),      // hur långt fram vi tittar

  live: process.argv.includes("--live"),
  interval: parseInt(arg("interval", "0"), 10),
};

const kr = (v) => (v == null ? "–" : v.toFixed(3) + " kr");
const log = (...a) => console.log(new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }), "·", ...a);

/* ===== Spotpris ============================================================
   elprisetjustnu.se levererar sedan hösten 2025 kvartsvärden (96 per dygn). */
async function spotPrices() {
  const now = new Date();
  const days = [now, new Date(now.getTime() + 864e5)];   // idag + imorgon (finns efter ~13)
  const out = [];
  for (const d of days) {
    const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(d);
    const url = `https://www.elprisetjustnu.se/api/v1/prices/${ymd.slice(0, 4)}/${ymd.slice(5, 7)}-${ymd.slice(8, 10)}_${CFG.area}.json`;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;                              // morgondagen finns inte ännu
      for (const p of await r.json()) {
        out.push({ from: new Date(p.time_start), to: new Date(p.time_end), spot: p.SEK_per_kWh });
      }
    } catch { /* nätfel hanteras av anroparen via tom lista */ }
  }
  return out.sort((a, b) => a.from - b.from);
}

export const buyPrice = (spot) => (spot + CFG.buyAdder + CFG.buyEnergyTax + CFG.buyTransfer) * (1 + CFG.vat);
export const sellPrice = (spot) => spot + CFG.sellAdder + CFG.sellTaxCredit;

/* Hur mycket vi vill spara energin, 0–1. Tomt batteri → 1 (du kommer behöva
   den), nästan fullt → 0 (överskottet säljs ändå). */
export function needFactor(soc) {
  if (soc >= CFG.socFull) return 0;
  if (soc <= CFG.socLow) return 1;
  return (CFG.socFull - soc) / (CFG.socFull - CFG.socLow);
}

export function decide(soc, prices, now = new Date()) {
  const cur = prices.find(p => p.from <= now && now < p.to);
  if (!cur) return { ok: false, reason: "hittade inget spotpris för just nu" };
  const ahead = prices.filter(p => p.from > now && p.from <= new Date(now.getTime() + CFG.lookaheadH * 36e5));
  if (!ahead.length) return { ok: false, reason: "har inga priser framåt att jämföra med" };

  const sell = sellPrice(cur.spot);
  const peak = ahead.reduce((b, p) => (p.spot > b.spot ? p : b), ahead[0]);
  const buyPeak = buyPrice(peak.spot);
  const need = needFactor(soc);
  const keepValue = CFG.efficiency * buyPeak * need;
  return {
    ok: true, allow: sell >= keepValue,
    sell, buyPeak, need, keepValue, spot: cur.spot,
    peakAt: peak.from.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }),
  };
}

/* ===== Styrning ============================================================ */
let sock = null, limitSet = false;

async function setExportLimit(block) {
  const value = block ? 0 : EXPORT_LIMIT_OFF;
  if (!CFG.live) { limitSet = block; return; }
  await writeHolding(sock, EXPORT_LIMIT_REG, u32words(value));
  limitSet = block;
}

async function releaseAndExit(code, why) {
  try {
    if (limitSet && sock && CFG.live) {
      await writeHolding(sock, EXPORT_LIMIT_REG, u32words(EXPORT_LIMIT_OFF));
      log("släppte exporttaket (" + why + ")");
    }
  } catch (e) { console.error("KUNDE INTE SLÄPPA TAKET:", e.message); }
  try { sock?.end(); } catch { /* redan stängd */ }
  process.exit(code);
}

async function tick() {
  const s = await readFields(sock, ["soc", "pvPower", "batteryPower", "gridPower", "pvDaily", "loadDaily"]);
  const prices = await spotPrices();
  if (!prices.length) {
    log("inga priser tillgängliga → släpper spärren för säkerhets skull");
    await setExportLimit(false);
    return;
  }
  const d = decide(s.soc, prices);
  if (!d.ok) {
    log(`${d.reason} → släpper spärren`);
    await setExportLimit(false);
    return;
  }

  const block = !d.allow;
  const verb = CFG.live ? (block ? "spärrar export" : "tillåter export") : (block ? "HADE spärrat export" : "hade tillåtit export");
  log(
    `SOC ${s.soc} % · sol ${s.pvPower} kW · batteri ${s.batteryPower} kW · nät ${s.gridPower} kW\n` +
    `    sälj nu ${kr(d.sell)}/kWh (spot ${kr(d.spot)})  ·  dyraste köp till ${d.peakAt}: ${kr(d.buyPeak)}/kWh\n` +
    `    behovsfaktor ${(d.need * 100).toFixed(0)} % → energin i batteriet värd ${kr(d.keepValue)}/kWh\n` +
    `    → ${verb}`
  );
  if (block !== limitSet) await setExportLimit(block);
}

async function main() {
  if (!CFG.live) console.log("\n*** TORRKÖRNING — inget skrivs till växelriktaren. Lägg till --live för skarpt läge. ***\n");
  sock = await connect(CFG.host, CFG.port);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => releaseAndExit(0, "avslutar"));

  await tick();
  if (!CFG.interval) return releaseAndExit(0, "engångskörning");
  setInterval(() => tick().catch(e => {
    console.error("fel i cykeln:", e.message);
    setExportLimit(false).catch(() => {});     // fail-safe: hellre sälja än att stå spärrad
  }), CFG.interval * 1000);
}

// Kör bara när filen startas direkt — annars kan besluts­logiken importeras och testas
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error("\n" + e.message + "\n"); releaseAndExit(1, "fel vid start"); });
}
