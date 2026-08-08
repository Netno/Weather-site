#!/usr/bin/env node
/*
 * Läser nyckeltal ur en Sigenergy SigenStor över lokal Modbus TCP.
 *
 * Tänkt att köras på något som står på dygnet runt i samma nät som växelriktaren
 * (t.ex. QNAP:en). Inga npm-beroenden — Modbus TCP är så enkelt att det ryms i
 * en rå socket, vilket gör att skriptet kan köras med vilken Node ≥18 som helst
 * utan installationssteg.
 *
 *   node scripts/sigen-probe.mjs                 # läsbar sammanfattning
 *   node scripts/sigen-probe.mjs --json          # en rad JSON (för insamlaren)
 *
 * Miljövariabler:
 *   SIGEN_HOST  växelriktarens IP (default 192.168.0.189)
 *   SIGEN_PORT  Modbus-port (default 502)
 *   SIGEN_UNIT  slavadress (default 247 = "plant", enligt protokollet)
 *
 * Registren kommer ur Sigenergys officiella Modbus Protocol EN_V2.9, kapitel
 * 5.1 "Plant running information" — alla är input-register (funktionskod 0x04)
 * och nås via slavadress 247.
 */

import net from "node:net";

const HOST = process.env.SIGEN_HOST || "192.168.0.189";
const PORT = parseInt(process.env.SIGEN_PORT || "502", 10);
const UNIT = parseInt(process.env.SIGEN_UNIT || "247", 10);
const AS_JSON = process.argv.includes("--json");

/* ===== Minimal Modbus TCP-klient (bara läsning av input-register) ========== */
function readInputRegisters(sock, start, qty, txn) {
  return new Promise((resolve, reject) => {
    const req = Buffer.alloc(12);
    req.writeUInt16BE(txn, 0);      // transaktions-id
    req.writeUInt16BE(0, 2);        // protokoll-id (0 = Modbus)
    req.writeUInt16BE(6, 4);        // längd på resten
    req.writeUInt8(UNIT, 6);
    req.writeUInt8(0x04, 7);        // 0x04 = read input registers
    req.writeUInt16BE(start, 8);
    req.writeUInt16BE(qty, 10);

    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 9) return;                      // vänta på huvudet
      const len = buf.readUInt16BE(4);
      if (buf.length < 6 + len) return;                // vänta på resten
      cleanup();
      const fn = buf.readUInt8(7);
      if (fn & 0x80) return reject(new Error(`Modbus-fel ${buf.readUInt8(8)} vid register ${start}`));
      const bytes = buf.readUInt8(8);
      const words = [];
      for (let i = 0; i < bytes / 2; i++) words.push(buf.readUInt16BE(9 + i * 2));
      resolve(words);
    };
    const onErr = (e) => { cleanup(); reject(e); };
    const timer = setTimeout(() => onErr(new Error(`Timeout vid register ${start}`)), 8000);
    function cleanup() { clearTimeout(timer); sock.off("data", onData); sock.off("error", onErr); }

    sock.on("data", onData);
    sock.once("error", onErr);
    sock.write(req);
  });
}

/* ===== Avkodning ===========================================================
   Registren är 16 bitar big-endian; flerordsvärden ligger med högsta ordet
   först. "gain" är protokollets skalfaktor — värdet delas med den. */
const dec = {
  u16: (w, i) => w[i],
  s16: (w, i) => (w[i] > 0x7fff ? w[i] - 0x10000 : w[i]),
  u32: (w, i) => w[i] * 65536 + w[i + 1],
  s32: (w, i) => { const v = w[i] * 65536 + w[i + 1]; return v > 0x7fffffff ? v - 0x100000000 : v; },
  u64: (w, i) => Number((BigInt(w[i]) << 48n) | (BigInt(w[i + 1]) << 32n) | (BigInt(w[i + 2]) << 16n) | BigInt(w[i + 3])),
};

/* Fält vi läser, grupperade i sammanhängande block (ett Modbus-anrop per block) */
const BLOCKS = [
  { start: 30000, qty: 15, fields: [
    { key: "systemTime",   at: 30000, type: "u32", gain: 1,    unit: "s"  },
    { key: "emsMode",      at: 30003, type: "u16", gain: 1,    unit: ""   },
    { key: "gridPower",    at: 30005, type: "s32", gain: 1000, unit: "kW" },
    { key: "onGrid",       at: 30009, type: "u16", gain: 1,    unit: ""   },
    { key: "soc",          at: 30014, type: "u16", gain: 10,   unit: "%"  },
  ]},
  { start: 30031, qty: 8, fields: [
    { key: "plantPower",   at: 30031, type: "s32", gain: 1000, unit: "kW" },
    { key: "pvPower",      at: 30035, type: "s32", gain: 1000, unit: "kW" },
    { key: "batteryPower", at: 30037, type: "s32", gain: 1000, unit: "kW" },
  ]},
  { start: 30083, qty: 15, fields: [
    { key: "batteryRated", at: 30083, type: "u32", gain: 100,  unit: "kWh" },
    { key: "pvTotal",      at: 30088, type: "u64", gain: 100,  unit: "kWh" },
    { key: "loadDaily",    at: 30092, type: "u32", gain: 100,  unit: "kWh" },
    { key: "loadTotal",    at: 30094, type: "u64", gain: 100,  unit: "kWh" },
  ]},
  { start: 30200, qty: 8, fields: [
    { key: "chargedTotal",    at: 30200, type: "u64", gain: 100, unit: "kWh" },
    { key: "dischargedTotal", at: 30204, type: "u64", gain: 100, unit: "kWh" },
  ]},
  { start: 30272, qty: 2, fields: [
    { key: "pvDaily",      at: 30272, type: "u32", gain: 100,  unit: "kWh" },
  ]},
];

const EMS_MODE = { 0: "max egenförbrukning", 1: "AI-läge", 2: "TOU" };

async function main() {
  const sock = net.createConnection({ host: HOST, port: PORT });
  sock.setNoDelay(true);
  await new Promise((res, rej) => {
    sock.once("connect", res);
    sock.once("error", rej);
    setTimeout(() => rej(new Error(`Fick ingen kontakt med ${HOST}:${PORT} — står NAS:en i samma nät, och är Modbus TCP påslaget i Sigen-appen?`)), 8000);
  });

  const out = {};
  let txn = 1;
  for (const b of BLOCKS) {
    let words;
    try {
      words = await readInputRegisters(sock, b.start, b.qty, txn++);
    } catch (e) {
      // Ett block som inte stöds ska inte fälla hela läsningen
      for (const f of b.fields) out[f.key] = null;
      if (!AS_JSON) console.error(`  (block ${b.start} gick inte att läsa: ${e.message})`);
      continue;
    }
    for (const f of b.fields) {
      const v = dec[f.type](words, f.at - b.start);
      out[f.key] = f.gain === 1 ? v : +(v / f.gain).toFixed(3);
    }
  }
  sock.end();

  if (AS_JSON) { console.log(JSON.stringify({ t: new Date().toISOString(), ...out })); return; }

  const row = (name, val, unit) => console.log(`  ${name.padEnd(24)} ${val == null ? "–" : String(val).padStart(12)} ${unit}`);
  console.log(`\nSigenStor på ${HOST}:${PORT} (slavadress ${UNIT})\n`);
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
  row("Driftläge", EMS_MODE[out.emsMode] ?? out.emsMode, "");
  row("Nätanslutning", out.onGrid === 0 ? "on grid" : out.onGrid === 1 ? "off grid" : out.onGrid, "");
  if (out.systemTime) row("Klocka i växelriktaren", new Date(out.systemTime * 1000).toISOString().slice(0, 19).replace("T", " "), "UTC");
  console.log();
}

main().catch((e) => { console.error("\n" + e.message + "\n"); process.exit(1); });
