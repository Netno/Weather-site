/*
 * Hämtar stationens egna sensordata (blixtar, ljusintensitet m.m.) från
 * myAcuRites inofficiella backend — samma API som deras app och webb
 * använder. Odokumenterat och kan ändras av AcuRite utan förvarning;
 * koden är därför skriven defensivt och svarar med diagnostik så att
 * fel går att felsöka direkt i webbläsaren.
 *
 * Kräver miljövariablerna MYACURITE_EMAIL och MYACURITE_PASSWORD i
 * Vercel-projektet (lägg till + gör en redeploy).
 */

const BASE = process.env.MYACURITE_BASE || "https://marapi.myacurite.com";

// Token cacheas i modulscope så länge funktionsinstansen är varm —
// vi vill inte logga in på nytt för varje anrop
const session = { token: null, accountId: null, at: 0 };
const TOKEN_TTL = 6 * 3600e3;

const stockholmToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());

const trim = (obj, max = 6000) => {
  const s = JSON.stringify(obj);
  return s.length > max ? s.slice(0, max) + " …[avkortat]" : s;
};

async function login(email, password) {
  const r = await fetch(`${BASE}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remember: true, email, password }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw Object.assign(new Error(`Inloggningen avvisades (HTTP ${r.status})`), { detail: body });
  }
  // Fältnamnen har varierat över tid — prova kända varianter
  const token = body?.token_id ?? body?.tokenId ?? body?.token;
  const accountId =
    body?.user?.account_users?.[0]?.account_id ??
    body?.account_users?.[0]?.account_id ??
    body?.accounts?.[0]?.id ??
    body?.account_id;
  if (!token) {
    throw Object.assign(new Error("Inloggningen gick igenom men inget token hittades i svaret"), { detail: body });
  }
  session.token = token;
  session.accountId = accountId ?? null;
  session.at = Date.now();
}

async function apiGet(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "x-one-vue-token": session.token, Accept: "application/json" },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    throw Object.assign(new Error(`${path} → HTTP ${r.status}`), { detail: body });
  }
  return body;
}

/* Plocka ut utomhusstationens (Atlas) värden. Endpointen är publik, så
   inomhussensorer serveras aldrig härifrån — bara utomhusdata. */
const sensorList = d => [
  ...(d.sensors ?? []),
  ...(d.wired_sensors ?? []),
].map(s => ({
  name: s.sensor_name ?? s.chart_title ?? null,
  value: s.last_reading_value ?? null,
  unit: s.chart_unit ?? s.unit ?? null,
}));

const findAtlas = hub => (hub?.devices ?? []).find(d =>
  (d.wired_sensors ?? []).some(s => /lightning/i.test(s.sensor_name ?? "")) ||
  /atlas/i.test(d.name ?? ""));

/* Dagens timserie för ljus/UV ur enhetens publika dagsfil — samma källa
   som arkivet i data/acurite/. Tider konverteras UTC → svensk timme. */
const hourFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hour12: false });
function parseDaySeries(day) {
  const byH = new Map();
  const put = (ch, key, unit) => {
    for (const p of day?.[ch] ?? []) {
      const v = p.raw_values?.[unit];
      if (v == null || !p.happened_at) continue;
      const h = parseInt(hourFmt.format(new Date(p.happened_at)), 10);
      if (!byH.has(h)) byH.set(h, { h });
      byH.get(h)[key] = v;
    }
  };
  put("14", "lux", "LUX");
  put("13", "uv", "");
  put("15", "sec", "SEC");
  put("1", "temp", "C");
  put("3", "wind", "KPH");
  put("4", "winddir", "");
  put("9", "pressureSL", "HPA");
  put("11", "rainCum", "MM"); // dygnsackumulerat regn → diff till per timme
  return [...byH.values()].sort((a, b) => a.h - b.h);
}

// Batteristatus kan ligga på olika ställen beroende på API-version:
// direkt på enheten, som en egen sensor, eller per sensor (låg vinner).
function pickBattery(d) {
  if (!d) return null;
  for (const k of ["battery_level", "batteryLevel", "battery"]) {
    if (d[k] != null && d[k] !== "") return d[k];
  }
  const all = [...(d.sensors ?? []), ...(d.wired_sensors ?? [])];
  const named = all.find(s => /batter/i.test(s.sensor_name ?? s.chart_title ?? ""));
  if (named && (named.last_reading_value ?? named.battery_level) != null) return named.last_reading_value ?? named.battery_level;
  const lv = all.map(s => s.battery_level ?? s.battery).filter(v => v != null && v !== "");
  if (lv.length) return lv.find(v => /low|lågt|dålig|dead|weak/i.test(String(v))) ?? lv[0];
  return null;
}
// Diagnostik (endast fältnamn/batterivärden, inga mätvärden) → hitta rätt fält
function battDiag(d) {
  const all = [...(d?.sensors ?? []), ...(d?.wired_sensors ?? [])];
  return {
    device: { battery_level: d?.battery_level ?? null, battery: d?.battery ?? null, batteryLevel: d?.batteryLevel ?? null },
    sensors: all.map(s => ({ name: s.sensor_name ?? s.chart_title ?? null, battery_level: s.battery_level ?? null, battery: s.battery ?? null }))
      .filter(s => s.battery_level != null || s.battery != null || /batter/i.test(s.name ?? "")),
    deviceKeys: Object.keys(d ?? {}),
  };
}

function extractAtlas(hub) {
  const atlas = findAtlas(hub);
  if (!atlas) return null;
  const list = sensorList(atlas);
  const num = name => {
    const v = Number(list.find(s => s.name === name)?.value);
    return Number.isFinite(v) ? v : null;
  };
  const dailyStrikes = Number(atlas.daily_cumulative_strikes);
  return {
    battery: pickBattery(atlas),
    batteryRaw: battDiag(atlas),
    signal: atlas.signal_strength ?? atlas.signalStrength ?? atlas.signal ?? null,
    lastCheckIn: atlas.last_check_in_at ?? null,
    lux: num("Light Intensity"),
    measuredLightS: num("Measured Light"),
    uv: num("UV Index"),
    lightning: {
      dailyStrikes: Number.isFinite(dailyStrikes) ? dailyStrikes : null,
      count: num("Lightning Strike Count"),
      closestKm: num("Lightning Closest Strike Distance"),
      lastKm: num("Lightning Last Strike Distance"),
    },
    // Aktuella utomhusförhållanden — låter live-sidan visa stationen även
    // när WU-proxyn ligger nere (AcuRite är källan WU själv matas från).
    // Vind i km/h, tryck i hPa (havsnivå), temp/daggpunkt i °C, regn i mm.
    current: {
      temp: num("Temperature"),
      humidity: num("Humidity"),
      dewpt: num("Dew Point"),
      feelsLike: num("Feels Like"),
      windAvg: num("Wind Speed Average"),
      windNow: num("Wind Speed"),
      windDir: num("Wind Direction"),
      pressureSL: num("Pressure"),
      rainToday: num("Rainfall"),
    },
  };
}

/* Probe-läge (?probe=1): kartlägg historik/chart-endpoints. Returnerar
   strukturinfo (fältnamn, id:n) och statuskod per kandidat-URL — aldrig
   mätvärden från inomhussensorer. Används en gång för att hitta rätt väg,
   sedan byggs den riktiga historikhämtningen mot det som svarar. */
async function probe(res) {
  const detail = await apiGet(`/accounts/${session.accountId}/dashboard/hubs`).then(async list => {
    const hubs = list?.account_hubs ?? list?.hubs ?? (Array.isArray(list) ? list : []);
    return { hubId: hubs[0]?.id, detail: await apiGet(`/accounts/${session.accountId}/dashboard/hubs/${hubs[0]?.id ?? ""}`) };
  });
  const { hubId } = detail;
  const devices = detail.detail?.devices ?? [];
  const atlas = devices.find(d => /atlas/i.test(d.name ?? "")) ?? devices[0];
  const deviceId = atlas?.id ?? atlas?.device_id ?? null;
  const sensors = [...(atlas?.sensors ?? []), ...(atlas?.wired_sensors ?? [])];
  const lightning = sensors.find(s => /strike count/i.test(s.sensor_name ?? ""));
  const sensorId = lightning?.id ?? lightning?.sensor_id ?? null;

  // Runda 3: datan ligger som dagsfiler på dataapi.myacurite.com
  // (…/1h-summaries/ÅÅÅÅ-MM-DD.json). Kartlägg: kanalkatalog, hur långt
  // bak filerna finns kvar, om token krävs, och om fler upplösningar finns.
  const metaUrl = atlas?.meta_file;
  if (!metaUrl) {
    return res.status(200).json({ status: "probe", error: "ingen meta_file på Atlas-enheten" });
  }
  const prefix = metaUrl.replace(/meta\.json$/, "");
  const get = async (url, withToken = true) => {
    try {
      const r = await fetch(url, withToken ? { headers: { "x-one-vue-token": session.token } } : {});
      return { status: r.status, text: await r.text() };
    } catch (err) {
      return { status: "nätverksfel", text: String(err.message).slice(0, 200) };
    }
  };

  const today = stockholmToday();
  const todayFile = await get(`${prefix}1h-summaries/${today}.json`);
  let todayChannels = null;
  try {
    const j = JSON.parse(todayFile.text);
    todayChannels = Object.fromEntries(Object.entries(j).map(([ch, arr]) => [ch, {
      punkter: Array.isArray(arr) ? arr.length : "?",
      enheter: Object.keys(arr?.[0]?.raw_values ?? {}),
      exempel: arr?.[arr.length - 1]?.raw_values ?? null,
    }]));
  } catch { todayChannels = { parsefel: todayFile.text.slice(0, 200) }; }

  const noToken = await get(`${prefix}1h-summaries/${today}.json`, false);

  const oldDates = ["2026-06-15", "2026-01-15", "2025-07-15", "2023-07-15", "2021-07-15", "2019-07-15", "2018-12-10"];
  const history = [];
  for (const d of oldDates) history.push({ date: d, status: (await get(`${prefix}1h-summaries/${d}.json`)).status });

  const variants = ["1d-summaries", "5m-summaries", "summaries", "readings", "5min-readings", "1m-summaries"];
  const resolutions = [];
  for (const v of variants) resolutions.push({ variant: v, status: (await get(`${prefix}${v}/${today}.json`)).status });

  const meta = await get(metaUrl);
  let metaChannels = null;
  try {
    const mj = JSON.parse(meta.text);
    metaChannels = Object.fromEntries(Object.entries(mj.channel_data ?? {}).map(([ch, v]) => [ch, {
      max: v.all_time_high?.raw_values ?? null, maxNär: v.all_time_high?.happened_at ?? null,
      min: v.all_time_low?.raw_values ?? null, minNär: v.all_time_low?.happened_at ?? null,
    }]));
  } catch {}

  return res.status(200).json({
    status: "probe3",
    prefix,
    publiktUtanToken: noToken.status,
    todayChannels,
    history,
    resolutions,
    metaChannels,
  });
}

export default async function handler(req, res) {
  const email = process.env.MYACURITE_EMAIL;
  const password = process.env.MYACURITE_PASSWORD;
  if (!email || !password) {
    return res.status(500).json({
      status: "variabler saknas",
      hint: "Lägg MYACURITE_EMAIL och MYACURITE_PASSWORD i Vercel och gör en redeploy.",
    });
  }

  try {
    if (!session.token || Date.now() - session.at > TOKEN_TTL) {
      await login(email, password);
    }

    if (req.query?.probe === "1" && session.accountId) {
      return await probe(res);
    }

    if (!session.accountId) {
      return res.status(200).json({
        status: "inloggad, men inget konto-id hittades — strukturen behöver inspekteras",
        loginOk: true,
      });
    }

    let hubList = await apiGet(`/accounts/${session.accountId}/dashboard/hubs`);
    const hubs = hubList?.account_hubs ?? hubList?.hubs ?? (Array.isArray(hubList) ? hubList : null);
    if (!hubs?.length) {
      return res.status(200).json({
        status: "inloggad, men hubblistan hade oväntad struktur",
        loginOk: true,
        raw: trim(hubList),
      });
    }

    // Hämta första hubbens sensordata och filtrera till utomhusstationen
    const detail = await apiGet(`/accounts/${session.accountId}/dashboard/hubs/${hubs[0].id ?? ""}`);
    const atlas = extractAtlas(detail);
    if (!atlas) {
      // Strukturen känns inte igen — visa enhetsnamn (aldrig värden) för felsökning
      return res.status(200).json({
        status: "ingen utomhusstation hittades i svaret",
        deviceNames: (detail?.devices ?? []).map(d => d.name ?? "?"),
      });
    }

    // Dagens ljus/UV-timserie ur den publika dagsfilen (URL:en hålls serversida)
    let todaySeries = [];
    try {
      const prefix = findAtlas(detail)?.meta_file?.replace(/meta\.json$/, "");
      if (prefix) {
        const r = await fetch(`${prefix}1h-summaries/${stockholmToday()}.json`);
        if (r.ok) todaySeries = parseDaySeries(await r.json());
      }
    } catch { /* timserien är ett tillägg — resten av svaret gäller ändå */ }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ status: "ok", atlas, todaySeries });
  } catch (err) {
    session.token = null; // tvinga ny inloggning vid nästa försök
    return res.status(502).json({
      status: "fel",
      error: err.message,
      detail: err.detail !== undefined ? trim(err.detail) : null,
    });
  }
}
