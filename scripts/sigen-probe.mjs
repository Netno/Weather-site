#!/usr/bin/env node
/*
 * Läser nyckeltal ur en Sigenergy SigenStor över lokal Modbus TCP.
 *
 * Körs på något i samma nät som växelriktaren (NAS, desktop). Enbart läsning —
 * inga register skrivs. Bra första steg för att bekräfta att registerkartan
 * stämmer mot din firmware innan något styrskript byggs ovanpå.
 *
 *   node scripts/sigen-probe.mjs                 # läsbar sammanfattning
 *   node scripts/sigen-probe.mjs --json          # en rad JSON
 *
 * Miljövariabler:
 *   SIGEN_HOST  växelriktarens IP (default 192.168.0.189)
 *   SIGEN_PORT  Modbus-port (default 502)
 */

import { connect, readFields } from "./lib/sigen-modbus.mjs";

const HOST = process.env.SIGEN_HOST || "192.168.0.189";
const PORT = parseInt(process.env.SIGEN_PORT || "502", 10);
const AS_JSON = process.argv.includes("--json");

const FIELDS = ["systemTime", "emsMode", "gridPower", "onGrid", "soc", "plantPower", "pvPower",
  "batteryPower", "batteryRated", "pvTotal", "loadDaily", "loadTotal", "chargedTotal",
  "dischargedTotal", "pvDaily"];

const EMS_MODE = { 0: "max egenförbrukning", 1: "AI-läge", 2: "TOU", 7: "fjärrstyrd EMS" };

async function main() {
  const sock = await connect(HOST, PORT);
  let out;
  try {
    out = await readFields(sock, FIELDS);
  } finally {
    sock.end();
  }

  if (AS_JSON) { console.log(JSON.stringify({ t: new Date().toISOString(), ...out })); return; }

  const row = (name, val, unit = "") =>
    console.log(`  ${name.padEnd(24)} ${(val == null ? "–" : String(val)).padStart(12)}  ${unit}`);
  console.log(`\nSigenStor på ${HOST}:${PORT}\n`);
  console.log("Just nu");
  row("Solproduktion", out.pvPower, "kW");
  row("Batteri", out.batteryPower, "kW   (+ laddar / − urladdar)");
  row("Nät", out.gridPower, "kW   (+ köper / − säljer)");
  row("Anläggning totalt", out.plantPower, "kW");
  row("Laddningsnivå", out.soc, "%");
  console.log("\nI dag");
  row("Solproduktion", out.pvDaily, "kWh");
  row("Förbrukning", out.loadDaily, "kWh");
  console.log("\nSedan start");
  row("Solproduktion", out.pvTotal, "kWh");
  row("Förbrukning", out.loadTotal, "kWh");
  row("Laddat i batteriet", out.chargedTotal, "kWh");
  row("Urladdat", out.dischargedTotal, "kWh");
  row("Batterikapacitet", out.batteryRated, "kWh");
  console.log("\nSystem");
  row("Driftläge", EMS_MODE[out.emsMode] ?? out.emsMode);
  row("Nätanslutning", out.onGrid === 0 ? "on grid" : out.onGrid === 1 ? "off grid" : out.onGrid);
  if (out.systemTime) {
    row("Klocka i växelriktaren", new Date(out.systemTime * 1000).toISOString().slice(0, 19).replace("T", " "), "UTC");
  }
  console.log("\nStämmer siffrorna mot Sigen-appen? Då är registerkartan rätt.\n");
}

main().catch((e) => { console.error("\n" + e.message + "\n"); process.exit(1); });
