/*
 * Poolautomatik (Aseko ASIN AQUA) via Asekos OFFICIELLA publika API.
 *
 * Det gamla app-API:et (auth.aseko.acs.aseko.cloud) svarar numera 403
 * "Access denied. If you are integrator, use official integrator API" för
 * anrop från datacenter-IP:n (t.ex. Vercel). Vi använder därför det
 * sanktionerade REST-API:et på api.aseko.cloud/api/v1 med en API-nyckel.
 *
 * Så här får du en nyckel (engångsjobb):
 *   1. Logga in på https://account.aseko.cloud
 *   2. Godkänn användarvillkoren (annars svarar API:et 403 TOS_NOT_ACCEPTED)
 *   3. Profil → Inställningar → API-nycklar → skapa en nyckel (read-only)
 *      Direktlänk: https://account.aseko.cloud/profile/settings/api-keys
 *
 * Miljövariabler i Vercel:
 *   ASEKO_API_KEY    (obligatorisk — nyckeln ovan)
 *   ASEKO_UNIT_ID    (valfritt — serienummer, t.ex. 110181422, om du har flera pooler)
 *
 * Endpoints (härledda ur öppna HA-integrationen JanSimek/aseko-ha):
 *   GET /auth/check                     -> { valid: true }
 *   GET /paired-units?page=&limit=      -> { items:[{serialNumber,…}], totalItems }
 *   GET /paired-units/{serialNumber}    -> { name, online, statusValues{…}, statusMessages[…] }
 * Alla anrop bär headers:
 *   Authorization: Bearer <ASEKO_API_KEY>, X-Client-Name, X-Client-Version, Accept
 */

const BASE = "https://api.aseko.cloud/api/v1";
const CLIENT_NAME = "bramhult-weather";
const CLIENT_VERSION = "1.0.0";
const ACCOUNT_PORTAL = "https://account.aseko.cloud";

const trim = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch { return null; } };
const num = (v) => {
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

async function api(path, apiKey) {
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

// statusValues är en platt dict med camelCase-nycklar och skalära strängvärden,
// t.ex. { waterTemperature:"28.3", ph:"7.40", clFree:"0.82", waterFlowToProbes:"YES" }.
function mapUnit(u) {
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
    redox: num(sv.redox),
    clFree: num(sv.clFree),
    salinity: num(sv.salinity),
    electrolyzer: num(sv.electrolyzer),
    flow: sv.waterFlowToProbes ?? null,          // "YES"/"NO" → tolkas i frontend
    heating: sv.heatingRunning ?? null,
    messages: msgs.map((m) => m?.type).filter(Boolean),
    // Diagnostik: vilka status-nycklar just din anläggning skickar (inga hemligheter)
    keys: Object.keys(sv),
  };
}

async function firstSerial(apiKey) {
  const d = await api(`/paired-units?page=1&limit=100`, apiKey);
  const items = Array.isArray(d?.items) ? d.items : [];
  return items.length ? { serial: items[0].serialNumber, count: items.length } : { serial: null, count: 0 };
}

export default async function handler(req, res) {
  const apiKey = process.env.ASEKO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: "variabler saknas",
      hint: "Lägg ASEKO_API_KEY i Vercel (skapa nyckeln på account.aseko.cloud → Profil → API-nycklar) och gör en redeploy.",
    });
  }
  try {
    let serial = process.env.ASEKO_UNIT_ID || null;
    let count = serial ? 1 : 0;
    if (!serial) {
      const f = await firstSerial(apiKey);
      serial = f.serial; count = f.count;
    }
    if (!serial) return res.status(200).json({ status: "inga enheter" });

    const unit = await api(`/paired-units/${encodeURIComponent(serial)}`, apiKey);
    const pool = mapUnit(unit);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ status: "ok", pool, unitCount: count });
  } catch (err) {
    const status = err.code === "tos" ? 200 : 502;
    return res.status(status).json({ status: "fel", error: err.message, detail: err.detail ?? null });
  }
}
