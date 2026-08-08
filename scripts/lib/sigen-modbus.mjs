/*
 * Minimal Modbus TCP-klient för Sigenergy SigenStor. Inga npm-beroenden —
 * protokollet ryms i en rå socket, vilket gör att skripten kan köras med vilken
 * Node ≥18 som helst (t.ex. i Container Station på en NAS) utan installation.
 *
 * Registren följer Sigenergys officiella Modbus Protocol EN_V2.9:
 *   • kapitel 5.1, input-register (funktionskod 0x04) — läsning av driftdata
 *   • kapitel 5.2, holding-register (funktionskod 0x10) — inställningar
 * Anläggningsdata nås via slavadress 247 ("plant address").
 */

import net from "node:net";

export const PLANT_UNIT = 247;

/* Protokollet kräver minst 1000 ms mellan anrop (kapitel 4.2 "Interaction
   timeout"); vi håller oss innanför det med lite marginal. */
const MIN_GAP_MS = 120;

export async function connect(host, port = 502, timeoutMs = 8000) {
  const sock = net.createConnection({ host, port });
  sock.setNoDelay(true);
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(
      `Fick ingen kontakt med ${host}:${port} — sitter maskinen i samma nät, och är Modbus TCP påslaget i Sigen-appen?`)), timeoutMs);
    sock.once("connect", () => { clearTimeout(timer); res(); });
    sock.once("error", (e) => { clearTimeout(timer); rej(e); });
  });
  sock.lastCall = 0;
  return sock;
}

function frame(sock, unit, pdu, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const txn = (frame.txn = (frame.txn ?? 0) + 1 & 0xffff);
    const head = Buffer.alloc(7);
    head.writeUInt16BE(txn, 0);
    head.writeUInt16BE(0, 2);                 // protokoll-id: 0 = Modbus
    head.writeUInt16BE(pdu.length + 1, 4);    // längd: unit + pdu
    head.writeUInt8(unit, 6);

    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 9) return;
      const len = buf.readUInt16BE(4);
      if (buf.length < 6 + len) return;
      cleanup();
      const fn = buf.readUInt8(7);
      if (fn & 0x80) return reject(new Error(`Modbus-undantag ${buf.readUInt8(8)}`));
      resolve(buf.subarray(8, 6 + len));
    };
    const onErr = (e) => { cleanup(); reject(e); };
    const timer = setTimeout(() => onErr(new Error("Timeout — inget svar från växelriktaren")), timeoutMs);
    function cleanup() { clearTimeout(timer); sock.off("data", onData); sock.off("error", onErr); }

    sock.on("data", onData);
    sock.once("error", onErr);
    sock.write(Buffer.concat([head, pdu]));
  });
}

async function paced(sock, fn) {
  const wait = MIN_GAP_MS - (Date.now() - sock.lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  try { return await fn(); } finally { sock.lastCall = Date.now(); }
}

/* Läs input-register (0x04). Returnerar en array med 16-bitars ord. */
export function readInput(sock, start, qty, unit = PLANT_UNIT) {
  return paced(sock, async () => {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x04, 0);
    pdu.writeUInt16BE(start, 1);
    pdu.writeUInt16BE(qty, 3);
    const body = await frame(sock, unit, pdu);
    const bytes = body.readUInt8(1);
    const words = [];
    for (let i = 0; i < bytes / 2; i++) words.push(body.readUInt16BE(2 + i * 2));
    return words;
  });
}

/* Skriv holding-register (0x10). words = array med 16-bitars ord. */
export function writeHolding(sock, start, words, unit = PLANT_UNIT) {
  return paced(sock, async () => {
    const pdu = Buffer.alloc(6 + words.length * 2);
    pdu.writeUInt8(0x10, 0);
    pdu.writeUInt16BE(start, 1);
    pdu.writeUInt16BE(words.length, 3);
    pdu.writeUInt8(words.length * 2, 5);
    words.forEach((w, i) => pdu.writeUInt16BE(w & 0xffff, 6 + i * 2));
    await frame(sock, unit, pdu);
  });
}

/* ===== Avkodning: 16-bitars ord, högsta ordet först ======================== */
export const dec = {
  u16: (w, i) => w[i],
  s16: (w, i) => (w[i] > 0x7fff ? w[i] - 0x10000 : w[i]),
  u32: (w, i) => w[i] * 65536 + w[i + 1],
  s32: (w, i) => { const v = w[i] * 65536 + w[i + 1]; return v > 0x7fffffff ? v - 0x100000000 : v; },
  u64: (w, i) => Number((BigInt(w[i]) << 48n) | (BigInt(w[i + 1]) << 32n) | (BigInt(w[i + 2]) << 16n) | BigInt(w[i + 3])),
};
export const u32words = (v) => [(v >>> 16) & 0xffff, v & 0xffff];

/* Register vi använder (kapitel 5.1 om inget annat sägs) */
export const REG = {
  systemTime:    { at: 30000, type: "u32", gain: 1,    unit: "s"   },
  emsMode:       { at: 30003, type: "u16", gain: 1,    unit: ""    },
  gridPower:     { at: 30005, type: "s32", gain: 1000, unit: "kW"  },  // + köper / − säljer
  onGrid:        { at: 30009, type: "u16", gain: 1,    unit: ""    },
  soc:           { at: 30014, type: "u16", gain: 10,   unit: "%"   },
  plantPower:    { at: 30031, type: "s32", gain: 1000, unit: "kW"  },
  pvPower:       { at: 30035, type: "s32", gain: 1000, unit: "kW"  },
  batteryPower:  { at: 30037, type: "s32", gain: 1000, unit: "kW"  },  // + laddar / − urladdar
  batteryRated:  { at: 30083, type: "u32", gain: 100,  unit: "kWh" },
  pvTotal:       { at: 30088, type: "u64", gain: 100,  unit: "kWh" },
  loadDaily:     { at: 30092, type: "u32", gain: 100,  unit: "kWh" },
  loadTotal:     { at: 30094, type: "u64", gain: 100,  unit: "kWh" },
  chargedTotal:  { at: 30200, type: "u64", gain: 100,  unit: "kWh" },
  dischargedTotal: { at: 30204, type: "u64", gain: 100, unit: "kWh" },
  pvDaily:       { at: 30272, type: "u32", gain: 100,  unit: "kWh" },
};

/* Exporttaket (kapitel 5.2, holding-register). Enligt protokollet gäller det
   globalt oavsett EMS-läge — vi behöver alltså aldrig ta över EMS-styrningen. */
export const EXPORT_LIMIT_REG = 40042;
export const EXPORT_LIMIT_OFF = 0xffffffff;   // "register is not valid" = inget tak

/* Läs en grupp fält i så få anrop som möjligt */
export async function readFields(sock, keys) {
  const regs = keys.map(k => ({ key: k, ...REG[k] }));
  const size = { u16: 1, s16: 1, u32: 2, s32: 2, u64: 4 };
  const sorted = [...regs].sort((a, b) => a.at - b.at);
  const blocks = [];
  for (const r of sorted) {
    const end = r.at + size[r.type];
    const last = blocks[blocks.length - 1];
    // slå ihop register som ligger nära varandra till ett anrop
    if (last && r.at - (last.start + last.qty) <= 8 && end - last.start <= 120) {
      last.qty = end - last.start;
      last.fields.push(r);
    } else {
      blocks.push({ start: r.at, qty: end - r.at, fields: [r] });
    }
  }
  const out = {};
  for (const b of blocks) {
    const words = await readInput(sock, b.start, b.qty);
    for (const f of b.fields) {
      const raw = dec[f.type](words, f.at - b.start);
      out[f.key] = f.gain === 1 ? raw : +(raw / f.gain).toFixed(3);
    }
  }
  return out;
}
