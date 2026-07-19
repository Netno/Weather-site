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

function extractAtlas(hub) {
  const devices = hub?.devices ?? [];
  const atlas = devices.find(d =>
    (d.wired_sensors ?? []).some(s => /lightning/i.test(s.sensor_name ?? "")) ||
    /atlas/i.test(d.name ?? "")
  );
  if (!atlas) return null;
  const list = sensorList(atlas);
  const num = name => {
    const v = Number(list.find(s => s.name === name)?.value);
    return Number.isFinite(v) ? v : null;
  };
  return {
    battery: atlas.battery_level ?? null,
    lastCheckIn: atlas.last_check_in_at ?? null,
    lux: num("Light Intensity"),
    measuredLightS: num("Measured Light"),
    uv: num("UV Index"),
    lightning: {
      count: num("Lightning Strike Count"),
      closestKm: num("Lightning Closest Strike Distance"),
      lastKm: num("Lightning Last Strike Distance"),
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

  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  const from = new Date(today + "T12:00:00Z"); from.setUTCDate(from.getUTCDate() - 6);
  const fromIso = from.toISOString().slice(0, 10);
  const a = session.accountId;
  const candidates = [
    `/accounts/${a}/dashboard/hubs/${hubId}/chart?device_id=${deviceId}&sensor_id=${sensorId}&date_from=${fromIso}&date_to=${today}`,
    `/accounts/${a}/hubs/${hubId}/chart?device_id=${deviceId}&sensor_id=${sensorId}&date_from=${fromIso}&date_to=${today}`,
    `/accounts/${a}/devices/${deviceId}/sensors/${sensorId}/chart?date_from=${fromIso}&date_to=${today}`,
    `/devices/${deviceId}/sensors/${sensorId}/chart?date_from=${fromIso}&date_to=${today}`,
    `/accounts/${a}/dashboard/hubs/${hubId}/history?date_from=${fromIso}&date_to=${today}`,
    `/accounts/${a}/exports?device_id=${deviceId}`,
  ];
  const attempts = [];
  for (const path of candidates) {
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { "x-one-vue-token": session.token, Accept: "application/json" } });
      const text = await r.text();
      attempts.push({ path, status: r.status, sample: text.slice(0, 400) });
    } catch (err) {
      attempts.push({ path, status: "nätverksfel", sample: String(err.message).slice(0, 200) });
    }
  }

  return res.status(200).json({
    status: "probe",
    hubId,
    hubKeys: Object.keys(detail.detail ?? {}),
    devices: devices.map(d => ({
      name: d.name ?? null,
      keys: Object.keys(d),
      id: d.id ?? d.device_id ?? null,
      sensorFieldNames: (d.sensors?.[0]) ? Object.keys(d.sensors[0]) : [],
      sensorIds: [...(d.sensors ?? []), ...(d.wired_sensors ?? [])].map(s => ({
        id: s.id ?? s.sensor_id ?? null, name: s.sensor_name ?? null,
      })),
    })),
    attempts,
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

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ status: "ok", atlas });
  } catch (err) {
    session.token = null; // tvinga ny inloggning vid nästa försök
    return res.status(502).json({
      status: "fel",
      error: err.message,
      detail: err.detail !== undefined ? trim(err.detail) : null,
    });
  }
}
