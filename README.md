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
| `observations/current` | Senaste observationen | Hero: temp, vind, tryck, regn, UV, sol (live via proxy) |
| `observations/all/1day` | 5-minutersvärden sedan midnatt | Dagens temp-, regn- och vindgrafer (live via proxy) |
| `history/daily?date=YYYYMMDD` | Dygnssummering för ett dygn | Arkivet: `data/daily/` |
| `history/hourly?date=YYYYMMDD` | Timvärden för ett dygn | Arkivet: `data/hourly/` (även tryckkurvan) |

Noterbart:

- API:et ger **rådata, ingen vädersymbol/prognos** — vill vi ha prognos senare
  läggs t.ex. SMHI:s öppna API till (gratis, ingen nyckel).
- `units=m` ger vind i **km/h** → konverteras till m/s i ett adapterlager
  (finns redan i mocken). Tryck i hPa, regn i mm, temp i °C — används rakt av.
- Sol upp/ned finns inte i API:et — kan beräknas klient-side (t.ex. SunCalc)
  från stationens lat/long.

## Arkitektur

Sidan går **inte** mot WU:s API för historik. All historik hämtas ut en gång
(backfill) och lagras som ett eget arkiv i repot; därefter hämtas gårdagens
dygn inkrementellt varje natt. Sidan läser bara arkivet — WU används enbart
för att fylla på det, plus (via proxy) för aktuella värden i live-vyn.

```
                       ┌── (live) liten proxy ──► api.weather.com
Webbläsare ── statisk sida                          (nyckel + cache 60 s)
                       └── (historik) eget arkiv i data/ ◄── nattligt cron-jobb
                                                             (GitHub Action) ◄── api.weather.com
```

- **Frontend:** statisk sida, samma kod som mocken. Inget ramverk behövs för
  den här storleken; vanilla + SVG räcker och laddar snabbt.
- **Arkivet:** statiska JSON-filer i `data/` (se nedan). Alla historikvyer
  blir omedelbara, kostar noll API-anrop oavsett antal besökare och funkar
  även när WU:s API ligger nere.
- **Proxy (endast live-vyn):** en Cloudflare Worker (gratisnivån räcker gott)
  eller motsvarande edge-funktion. Den (1) gömmer API-nyckeln, (2) cachear
  svar ~60 s, (3) låser vilka endpoints som går att anropa.
- **Hosting:** Cloudflare Pages / GitHub Pages / Vercel — valfritt, sidan är statisk.

## Dataarkivet

`scripts/fetch-history.mjs` fyller arkivet och körs av GitHub Action-workflowen
`fetch-weather-data.yml` varje natt kl 02:30/03:30 svensk tid (efter midnatt):

- **Backfill:** första körningen autodetekterar stationens första dag med data
  (eller ta `FIRST_DATE` om den är känd) och hämtar sedan framåt. Varje dygn
  kostar 2 anrop (`history/daily` + `history/hourly`); skriptet håller sig
  under WU:s gräns (1500 anrop/dygn, 30/min) via `CALL_BUDGET` (default 1200
  ≈ 600 dagar/körning) och paus mellan anropen. Är budgeten slut sparas en
  markör i `data/manifest.json` och nästa körning fortsätter automatiskt —
  en flerårig backfill blir klar på några nätter, eller trigga workflowen
  manuellt (workflow_dispatch) en gång per dygn.
- **Inkrementellt:** när arkivet är ikapp hämtar nattkörningen bara gårdagens
  dygn (2 anrop). Missade nätter tas igen automatiskt eftersom skriptet alltid
  hämtar från markören fram till gårdagen.

Filstruktur (observationerna sparas exakt i API:ets JSON-format, samma
struktur som mocken — enhetskonvertering sker i frontend):

```
data/manifest.json              markör + metadata (firstDate, lastFetched)
data/daily/YYYY.json            dygnssummeringar: { "YYYY-MM-DD": obs | null }
data/hourly/YYYY/YYYY-MM.json   timvärden per månad: { "YYYY-MM-DD": [obs …] }
```

`null` i dygnsfilen betyder kontrollerad dag utan data (stationen offline) —
skilt från "inte hämtad än". Dygnsfilerna är små (några tiotal kB/år);
timfilerna är några MB/år, vilket är helt ok i ett repo.

**Setup:** lägg API-nyckeln som repo-secret `WU_API_KEY`
(Settings → Secrets and variables → Actions) och trigga workflowen manuellt
för att starta backfillen.

## Historikvyer (planerade)

Arkivet möjliggör vyer som WU:s eget gränssnitt saknar, utan API-kostnad:

1. **Bläddra dag/period** — välj godtycklig dag eller period och se graferna
   (timvärden finns för full temperaturkurva per dag).
2. **Denna dag genom åren** — t.ex. 18 juli i år och samma datum tidigare år,
   överlagrade eller staplade.
3. **Månadsjämförelse** — t.ex. juli i år mot fyra valda tidigare år:
   överlagrade max/min-kurvor och nederbörd per år.

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

1. Lägga `WU_API_KEY` som Actions-secret och trigga workflowen → backfill av
   arkivet startar (klar på några nätter beroende på stationens ålder).
2. Bekräfta look & feel utifrån mocken (justeringar görs enkelt där).
3. Bygga historikvyerna ovan mot arkivet i `data/`.
4. Sätta upp proxy med nyckeln som secret + 60 s cache för live-vyn.
5. Byta `MOCK` mot fetch + felhantering (station offline, API nere).
6. Deploy + eget domännamn om så önskas.
7. (Senare, valfritt) SMHI-prognos, sol upp/ned.
