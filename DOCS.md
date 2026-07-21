# Systemöversikt

En karta över alla delar i projektet. Detaljer om väderarkivet finns i
[`README.md`](README.md); den här filen binder ihop helheten (väder + pool +
app) eftersom det vuxit till flera samverkande bitar.

Publik sajt: **weather.rickmark.se** (Vercel, deployas från `main`).

## Komponenter i korthet

```
                         ┌───────────────────────────── Vercel (weather.rickmark.se) ─────────┐
Webbläsare / app-WebView │  statisk sajt (index.html, historik/, assets/)                     │
   & hemskärmswidget ────┤  api/*.js  (serverless-proxyer, döljer nycklar, edge-cachar)       │
                         └──┬──────────────┬───────────────┬───────────────┬──────────────────┘
                            │              │               │               │
                    api.weather.com   myAcuRite        SMHI öppna      api.aseko.cloud
                       (WU PWS)      (lux/blixt/batt)   (prognos)       (pool, API-nyckel)

Dataarkiv (git, byggs på av schemalagda jobb, sajten läser dem):
  • data/            väderhistorik (WU + AcuRite)      på  main-grenen
  • pool/<datum>.json  pool-sampel (klor/pH/temp)      på  pool-data-grenen
```

## Frontend

| Fil | Vad |
|---|---|
| `index.html` | Live-vyn: hero, mätvärden, grafer (Idag/48h/vecka/månad), prognos, blixtkarta, **poolkort** (mätare + utfällbara dygnskurvor med 1/7/30-dygn + zoom) |
| `historik/index.html` | Historikvyer: Utforska, Dag, Samma dag genom åren, Månadsjämförelse, Året, Vindros, Rekord |
| `assets/charts.js` | Delad graf-/datamodul: `multiLine`, `barsChart`, `bandChart`, zoom-overlay (`openZoom`/`openDetail`), datatvätt (`BOUNDS`, `cleanDailyObs`), sol-/datum­hjälpare. Cache-bustas via `?v=N` (matcha i `index.html`, `historik/index.html` och `sw.js`) |
| `sw.js` | Service worker (PWA): network-first för HTML/JS, cachar skalet |

## Serverless-endpoints (`api/`)

| Endpoint | Källa | Ger | Cache |
|---|---|---|---|
| `wu.js` | WU PWS | Live: `?e=current`, `?e=today` (5-min) | 60 s |
| `acurite.js` | myAcuRite | Live: lux, blixt, batteri, signal | 60 s |
| `smhi.js` | SMHI | Prognos (tim + dygn) + vädersymbol | – |
| `aseko.js` | Aseko | Poolens **nuvärde** (temp, pH, klor, flöde …) | 60 s |
| `pool-history.js` | pool-data-grenen | Pool­arkivet: `?date=` (dygn) eller `?days=N` / `?from=&to=` (intervall) | 120 s |
| `pool-sample.js` | Aseko → git | Loggar **en** mätpunkt till arkivet (anropas av cron-job.org) | – |
| `_aseko.js` | — | Delad Aseko-hjälpare (`getPool`); ej en route (`_`-prefix) |

## Miljövariabler (Vercel → Settings → Environment Variables)

| Variabel | Används av | Notering |
|---|---|---|
| `WU_API_KEY` | `wu.js` | WU PWS-nyckel (samma som Actions-secret) |
| `STATION_ID`, `WU_API_BASE` | `wu.js` | Valfria (default IBRMHULT2 / api.weather.com) |
| `MYACURITE_EMAIL`, `MYACURITE_PASSWORD`, `MYACURITE_BASE` | `acurite.js` | myAcuRite-konto för live-värden |
| `STATION_LAT`, `STATION_LON` | `smhi.js` | Stationens position för prognos |
| `ASEKO_API_KEY` | `aseko.js`, `pool-sample.js` | Aseko-API-nyckel (account.aseko.cloud → Profil → API-nycklar) |
| `ASEKO_UNIT_ID` | `aseko.js`, `pool-sample.js` | Valfritt serienummer (110181422) om flera pooler |
| `GITHUB_TOKEN` | `pool-sample.js` | Fine-grained PAT, repo Netno/Weather-site, **Contents: Read and write** |
| `POOL_SAMPLE_KEY` | `pool-sample.js` | Hemlig sträng som krävs som `?key=` (spärrar spam) |

Nycklar ligger **aldrig** i koden eller repot — bara i Vercel (och motsvarande
Actions-secrets för arkivjobben).

## Schemalagda jobb

| Jobb | Var | Takt | Gör |
|---|---|---|---|
| Väderarkiv | GitHub Action `fetch-weather-data.yml` | Nattligt ~02:30 | Hämtar gårdagens WU + AcuRite → committar `data/` på `main` |
| Bygg APK | GitHub Action `build-android.yml` | Vid push i `android/**` | Bygger APK, släpper på release-taggen `android` |
| Pool-sampling | **cron-job.org** → `GET /api/pool-sample?key=…` | Var 5:e min, dygnet runt | Loggar en mätpunkt → committar `pool/<datum>.json` på `pool-data` |
| Pool-sampling (reserv) | GitHub Action `pool-log.yml` | Endast manuell (`workflow_dispatch`) | Samma sak via runner; schemat avstängt (opålitligt) |

Sekreterat i respektive tjänst: GitHub Actions-secrets `WU_API_KEY`,
`ACURITE_DATA_URL`. cron-job.org bär bara URL:en med `POOL_SAMPLE_KEY`.

## Datalager

- **Väder:** `data/` på `main` (se README). Committas nattligt → triggar en
  Vercel-deploy (en gång/dygn, ok).
- **Pool:** `pool/<YYYY-MM-DD>.json` på grenen **`pool-data`** (git-scraping).
  Egen gren så att de täta sampel-commitsen (~288/dygn) **inte** triggar
  Vercel-deployer (`vercel.json` stänger av deploy för grenen). En rad:
  `{ "t":"HH:MM", "cl":…, "ph":…, "wt":…, "flow":0|1 }`, lokal tid Europe/Stockholm.

## Pool (Aseko ASIN AQUA) – så hänger det ihop

1. **Nuläge:** `aseko.js` läser Asekos officiella REST-API (`api.aseko.cloud/api/v1`,
   Bearer-nyckel). Poolkortet visar temp + pH/klor-mätare + flöde.
2. **Historik:** Asekos API har **ingen** historik-endpoint (bara `auth/check`,
   `paired-units`, `paired-units/{serial}`). Deras web-app hämtar historik via
   ett internt API som blockerar server-IP:n — går alltså **inte** att backfilla.
   Därför bygger vi ett **eget arkiv framåt**: cron-job.org anropar `pool-sample.js`
   var 5:e minut → skriver till `pool-data`. `pool-history.js` läser tillbaka det.
3. **Grafer:** poolkortets utfäll ritar klor/pH/vattentemp för 1/7/30 dygn eller
   valt intervall, med zoom (samma detaljvy som övriga grafer). 7/30-dygnsvyerna
   fylls på i takt med samplingen (ingen backfill möjlig).

**Sätta upp samplingen (engångs):** skapa GitHub-PAT (Contents: Read and write)
→ `GITHUB_TOKEN` + valfri `POOL_SAMPLE_KEY` i Vercel → redeploy → cron-job.org
GET `https://weather.rickmark.se/api/pool-sample?key=<POOL_SAMPLE_KEY>` var 5:e min.

## Android-app (`android/`)

WebView-omslag av sajten + **hemskärmswidget**:

- Widgeten (`WidgetUpdateWorker.kt`, `res/layout/widget.xml`) hämtar `/api/*`
  var 15:e minut (WorkManager) och visar hero + mätvärden + **poolrad** + prognos.
  Klick djuplänkar in i appen (`#graf=`, `#dag=`, `#pool`).
- Scen-PNG:erna renderas från `scenes.html` med Playwright.
- CI (`build-android.yml`) bygger APK vid varje `android/**`-push och lägger den
  på release-taggen `android`. **Widget-layout följer appen** → installera om
  APK:n för att få layoutändringar.

## Vanliga åtgärder

- **Ändra `charts.js`:** bumpa `?v=N` i `index.html`, `historik/index.html` och
  `sw.js` (samt `sw.js` `VERSION`) så cachen synkar.
- **Rotera Aseko-/WU-nyckel:** byt i Vercel (+ Actions-secret för WU) och redeploy.
- **Gles pooldata:** kontrollera cron-job.org-jobbet; `pool-log.yml` kan köras
  manuellt som reserv.
- **Verifiera pool-skrivning:** öppna `/api/pool-sample?key=…` → `{"status":"ok",…}`.
