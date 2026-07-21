/*
 * Delad Aseko-hjälpare (Vercel ignorerar filer som börjar med _ som routes).
 * Används av api/aseko.js och api/pool-sample.js så samplingen slipper
 * self-fetch:a /api/aseko (en vanlig 502-källa på serverless).
 *
 * Officiella publika API:et: api.aseko.cloud/api/v1 med Bearer API-nyckel.
 */
const BASE = "https://api.aseko.cloud/api/v1";
const CLIENT_NAME = "bramhult-weather";
const CLIENT_VERSION = "1.0.0";
const ACCOUNT_PORTAL = "https://account.aseko.cloud";

export const trim = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch { return null; } };
export const num = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "---") return null;
  const n = Number(s.replace(",", ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function headers(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
    "x-client-name": CLIENT_NAME,
    "x-client-version": CLIENT_VERSION,
    accept: "application/json",
  };
}

export async function api(path, apiKey) {
  const r = await fetch(`${BASE}${path}`, { headers: headers(apiKey) });
  const body = await r.text();
  if (r.status === 401 || r.status === 403) {
    let et = null;
    try { et = JSON.parse(body)?.errorType ?? null; } catch {}
    if (et === "TOS_NOT_ACCEPTED") {
      throw Object.assign(new Error("Villkoren är inte godkända"), {
        code: "tos",
        detail: `Godkänn användarvillkoren på ${ACCOUNT_PORTAL} och försök igen.`,
      });
    }
    throw Object.assign(new Error(`Ogiltig eller saknad API-nyckel (HTTP ${r.status})`), {
      code: "auth",
      detail: body.slice(0, 200),
    });
  }
  if (!r.ok) throw Object.assign(new Error(`API HTTP ${r.status}`), { detail: body.slice(0, 300) });
  try { return JSON.parse(body); } catch { throw new Error("API-svar var inte JSON"); }
}

// statusValues är en platt dict med camelCase-nycklar och skalära strängvärden.
export function mapUnit(u) {
  const sv = u?.statusValues ?? {};
  const msgs = Array.isArray(u?.statusMessages) ? u.statusMessages : [];
  const brand = u?.brandName ? [u.brandName.primary, u.brandName.secondary].filter(Boolean).join(" ").trim() : null;
  return {
    name: u?.name ?? null,
    serial: u?.serialNumber ?? null,
    online: u?.online ?? null,
    brand: brand || null,
    warning: msgs.some((m) => m?.severity === "ERROR" || m?.severity === "WARNING"),
    waterTemp: num(sv.waterTemperature),
    airTemp: num(sv.airTemperature),
    ph: num(sv.ph),
    phTarget: num(sv.phRequired),
    redox: num(sv.redox),
    redoxTarget: num(sv.redoxRequired),
    clFree: num(sv.clFree),
    clTarget: num(sv.clFreeRequired),
    salinity: num(sv.salinity),
    electrolyzer: num(sv.electrolyzer),
    flow: sv.waterFlowToProbes ?? sv.poolFlow ?? null,
    filtration: sv.filtrationRunning ?? null,
    heating: sv.heatingRunning ?? null,
    messages: msgs.map((m) => m?.type).filter(Boolean),
    keys: Object.keys(sv),
  };
}

async function firstSerial(apiKey) {
  const d = await api(`/paired-units?page=1&limit=100`, apiKey);
  const items = Array.isArray(d?.items) ? d.items : [];
  return items.length ? { serial: items[0].serialNumber, count: items.length } : { serial: null, count: 0 };
}

// Hämtar (och mappar) en enhet. unitId = valfritt serienummer, annars första.
export async function getPool(apiKey, unitId) {
  let serial = unitId || null;
  let count = serial ? 1 : 0;
  if (!serial) { const f = await firstSerial(apiKey); serial = f.serial; count = f.count; }
  if (!serial) return { pool: null, unitCount: 0 };
  const unit = await api(`/paired-units/${encodeURIComponent(serial)}`, apiKey);
  return { pool: mapUnit(unit), unitCount: count, raw: unit };
}
