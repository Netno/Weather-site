/*
 * Poolautomatik (Aseko ASIN AQUA) via Asekos moln.
 * ODOKUMENTERAT API — samma backend som Aseko-appen/webben. Backenden byggdes
 * om till GraphQL (auth.aseko.acs.aseko.cloud + graphql.acs.prod.aseko.cloud);
 * fältnamn kan ändras utan förvarning, så vi skriver defensivt precis som
 * api/acurite.js och svarar med diagnostik vid fel.
 *
 * Miljövariabler i Vercel:
 *   ASEKO_EMAIL, ASEKO_PASSWORD   (obligatoriska)
 *   ASEKO_UNIT_ID                 (valfritt — serienummer om du har flera pooler)
 *
 * Endpoints (härledda ur öppna biblioteket aioaseko som Home Assistant använder):
 *   POST {AUTH}/login  {email,password,cloud} -> { token }
 *   POST {GQL}         GraphQL "units"-fråga, Authorization: Bearer <token>
 */

const AUTH = "https://auth.aseko.acs.aseko.cloud/auth";
const GQL = "https://graphql.acs.prod.aseko.cloud/graphql";
const CLOUD = "01HXS50KTV7NRSVNHD617J4CKB"; // fast moln-id i aioaseko
const TOKEN_TTL = 50 * 60 * 1000;           // logga in på nytt först efter ~50 min

// Token cachas i modulscope mellan anrop (varm lambda) — som acurite.js
const session = { token: null, at: 0 };

const trim = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch { return null; } };
const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", ".").replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function login(email, password) {
  const r = await fetch(`${AUTH}/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password, cloud: CLOUD }),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Inloggning avvisad (HTTP ${r.status})`), { detail: body.slice(0, 300) });
  let j; try { j = JSON.parse(body); } catch { throw new Error("Inloggningssvar var inte JSON"); }
  const token = j.token ?? j.data?.token ?? j.accessToken ?? j.access_token ?? null;
  if (!token) throw Object.assign(new Error("Ingen token i inloggningssvaret"), { detail: Object.keys(j) });
  session.token = token; session.at = Date.now();
  return token;
}

// GraphQL-frågan följer aioasekos struktur: units { units { … statusValues … } }
const UNITS_QUERY = `query {
  units {
    units {
      serialNumber
      name
      online
      hasWarning
      position
      statusValues {
        primary { type center { __typename ... on StringValue { value } } }
        secondary { type center { __typename ... on StringValue { value } } }
      }
    }
  }
}`;

async function gql(query) {
  const r = await fetch(GQL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ query }),
  });
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(`GraphQL HTTP ${r.status}`), { detail: body.slice(0, 400) });
  let j; try { j = JSON.parse(body); } catch { throw new Error("GraphQL-svar var inte JSON"); }
  if (j.errors) throw Object.assign(new Error("GraphQL-fel"), { detail: trim(j.errors) });
  return j.data;
}

// Enheterna kan ligga som data.units.units eller data.units — ta det som är en lista
function pickUnits(data) {
  const u = data?.units?.units ?? data?.units ?? data?.data?.units?.units ?? [];
  return Array.isArray(u) ? u : [];
}
function centerVal(sv) {
  const c = sv?.center;
  if (c == null) return null;
  return typeof c === "object" ? (c.value ?? null) : c;
}

function mapUnit(u) {
  const all = [...(u?.statusValues?.primary ?? []), ...(u?.statusValues?.secondary ?? [])];
  const byType = {};
  for (const sv of all) if (sv?.type != null) byType[sv.type] = centerVal(sv);
  return {
    name: u?.name ?? null,
    serial: u?.serialNumber ?? null,
    online: u?.online ?? null,
    warning: u?.hasWarning ?? null,
    waterTemp: num(byType.WATER_TEMPERATURE),
    airTemp: num(byType.AIR_TEMPERATURE),
    ph: num(byType.PH),
    redox: num(byType.REDOX ?? byType.REDOX_PRO),
    clFree: num(byType.CL_FREE),
    salinity: num(byType.SALINITY),
    flow: byType.WATER_FLOW_TO_PROBES ?? byType.FILTER_FLOW ?? byType.POOL_FLOW ?? null,
    heating: byType.HEATING ?? null,
    electrolyzer: num(byType.ELECTROLYZER),
    // Diagnostik: vilka värde-typer just din anläggning skickar (inga hemligheter)
    types: all.map((sv) => sv?.type).filter(Boolean),
  };
}

export default async function handler(req, res) {
  const email = process.env.ASEKO_EMAIL;
  const password = process.env.ASEKO_PASSWORD;
  if (!email || !password) {
    return res.status(500).json({
      status: "variabler saknas",
      hint: "Lägg ASEKO_EMAIL och ASEKO_PASSWORD (ev. ASEKO_UNIT_ID) i Vercel och gör en redeploy.",
    });
  }
  try {
    if (!session.token || Date.now() - session.at > TOKEN_TTL) await login(email, password);
    const data = await gql(UNITS_QUERY);
    const units = pickUnits(data).map(mapUnit);
    if (!units.length) {
      return res.status(200).json({ status: "inga enheter", raw: trim(data) });
    }
    const wanted = process.env.ASEKO_UNIT_ID;
    const pool = (wanted && units.find((u) => u.serial === wanted)) || units[0];
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ status: "ok", pool, unitCount: units.length });
  } catch (err) {
    session.token = null; // tvinga ny inloggning nästa gång
    return res.status(502).json({ status: "fel", error: err.message, detail: err.detail ?? null });
  }
}
