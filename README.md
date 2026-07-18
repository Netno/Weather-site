# Vädersida för IBRMHULT2

Privat projekt: en publik vädersida för den personliga väderstationen **IBRMHULT2**
(Brämhult), med data från Weather Underground / The Weather Company PWS API.

**Status:** planering + mock. Mocken ligger i [`mock/index.html`](mock/index.html) —
en fristående HTML-fil utan beroenden som kan öppnas direkt i webbläsaren.

## Datakälla

PWS-API:et (bas-URL `https://api.weather.com/v2/pws`), alla anrop med
`stationId=IBRMHULT2&format=json&units=m&apiKey=$WU_API_KEY`:

| Endpoint | Ger | Används till |
|---|---|---|
| `observations/current` | Senaste observationen | Hero: temp, vind, tryck, regn, UV, sol |
| `observations/all/1day` | 5-minutersvärden sedan midnatt | Dagens temp-, regn- och vindgrafer |
| `history/hourly?date=YYYYMMDD` | Timvärden för ett dygn | Tryckkurvan (3 dygn = 3 anrop, cacheas hårt) |
| `dailysummary/7day` | Dygnssummeringar 7 dagar | Max/min + regn per dygn |

Noterbart:

- API:et ger **rådata, ingen vädersymbol/prognos** — vill vi ha prognos senare
  läggs t.ex. SMHI:s öppna API till (gratis, ingen nyckel).
- `units=m` ger vind i **km/h** → konverteras till m/s i ett adapterlager
  (finns redan i mocken). Tryck i hPa, regn i mm, temp i °C — används rakt av.
- Sol upp/ned finns inte i API:et — kan beräknas klient-side (t.ex. SunCalc)
  från stationens lat/long.

## Arkitektur (förslag)

```
Webbläsare ── statisk sida (HTML/JS) ──► liten proxy ──► api.weather.com
                                          (håller API-nyckeln + cache 60 s)
```

- **Frontend:** statisk sida, samma kod som mocken. Inget ramverk behövs för
  den här storleken; vanilla + SVG räcker och laddar snabbt.
- **Proxy:** en Cloudflare Worker (gratisnivån räcker gott) eller motsvarande
  edge-funktion. Den (1) gömmer API-nyckeln, (2) cachear svar ~60 s så att
  WU:s rate limit aldrig blir ett problem oavsett antal besökare, (3) låser
  vilka endpoints som går att anropa.
- **Hosting:** Cloudflare Pages / GitHub Pages / Vercel — valfritt, sidan är statisk.

### Om nyckeln

Nyckeln ska **inte** ligga i frontend-koden eller i repot — i klienten är den
läsbar för vem som helst. Den läggs som secret i proxyn (`WU_API_KEY`).
Eftersom nyckeln har skickats i klartext i chatten: överväg att rotera den på
wunderground.com (Member Settings → API Keys) när skarpa versionen är uppe.

## Mocken

`mock/index.html` är byggd så att steget till skarp version är litet:

- Mockdatat (`MOCK` i skriptet) har **exakt samma JSON-struktur** som API-svaren
  (`observations[0].metric.temp` osv.) — skarp version byter ut objektet mot
  `fetch()`-anrop mot proxyn, resten av koden är oförändrad.
- Adapter för km/h → m/s och gradtal → väderstreck (SV, VNV …) finns med.
- Ljust + mörkt läge (följer systemet), responsiv, tooltips på graferna.
- Färgpaletten är validerad för färgblindhet och kontrast i båda lägena.

Innehåll: hero med aktuell temp + åtta nyckelvärden, temperatur/nederbörd/vind
sedan midnatt, lufttryck tre dygn, samt max/min och regn för senaste sju dygnen.

## Nästa steg

1. Bekräfta look & feel utifrån mocken (justeringar görs enkelt där).
2. Sätta upp proxy med nyckeln som secret + 60 s cache.
3. Byta `MOCK` mot fetch + felhantering (station offline, API nere).
4. Deploy + eget domännamn om så önskas.
5. (Senare, valfritt) SMHI-prognos, sol upp/ned, längre historik.
