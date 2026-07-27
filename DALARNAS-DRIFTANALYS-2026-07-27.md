# Driftanalys: Dalarnas nyhetsbrevssläpp & liveauktion

*Sammanfattning av analysarbete 24–27 juli 2026. Datakällor: Azure Monitor-larm (Slack `#operations-skeleton`), Log Analytics `bby-eu1-law-prod` (AzureMetrics + AppDependencies), admin-UI. Kompletterande minnesanteckningar från tidigare sessioner (Drive).*

---

## 1. Nyhetsbrevssläppet torsdag 23 juli — klart bättre än 28 maj

**23 juli (kväll):** Inga OOM, inga app-poddrestarter, inga SQL-exceptions, tyst i supporten.
- SQL-poolen peakade **77 % max / 46 % snitt** (17:30–18:30 CEST) — under larmgränsen (80 %) hela kvällen.
- Dalarnas dedikerade KEDA-skalning (`keda-hpa-cpu-scaledobject-dalarnas`) tog smällen men låg **maxad på max-repliker 18:09–00:04** (~6 h) → taket är för lågt satt.
- En Sev2 SmartDetector-varning om latensförsämring under kvällen (detekteringsfönster delvis 22 juli, osäker relevans).

**28 maj (jämförelse, via larmbilden — metrikdata äldre än 27 juni är utanför retention):**
- Delade `skeletonapi-deployment` gick >95 % containerminne (00:39), **OOMKilled 01:38**, poddrestart 01:44, nytt minneslarm 03:09.
- Sev1 exceptions + Visma HTTP-fel på eftermiddagen (delvis orelaterat, Visma-beroenden).

**Slutsats:** Den dedikerade per-tenant-skalningen som införts sedan maj gjorde släppet stabilt. Kvarstående brist: HPA-taket (5 repliker).

## 2. Liveauktionen måndag 27 juli (förbudgivning → livestart 11:00)

- Trafik: 425 → 502 öppna sessioner inför start, 237 inloggade.
- SQL-poolen: Sev0-larm 10:30 (83,75 %, 3-min spik). **Max 100 % exakt kl. 11:00** (kvartssnitt 70 %) — därefter snabbt fallande (11:45: 43 % snitt), precis enligt Mikaels trafikmodell (trycket viker efter livestart). Beslutet att inte skala (varken pool eller HPA) mitt i var korrekt; workers/IO låg hela tiden nära noll → ren query-CPU, inget november-scenario.
- HPA maxad från 08:34; nodpool `npld4lsv5` flappade runt 85 % minne sedan kvällen innan.

## 3. Huvudfynd: Mälardalen-pollern (största enskilda vinsten)

- Tjänsten **`notifyinventoryitemstatechanges`** (en podd) frågar Mälardalens databas **varannan sekund, dygnet runt, sedan 10 juli 22:00:52**.
- Volym: **~42 800 SQL-anrop och ~6,5 timmar SQL-tid per dygn** (~510 ms snitt/anrop, p95 655 ms). Ingen annan tenant i närheten (näst störst: Olsens 0,04 h/dygn).
- Poolens snitt-CPU steg 14,3 % → 18,7 % när pollern startade.
- Mälardalens "Månadsauktion 20:e augusti" öppnade för förbudgivning **5 juli** — pollern startade 5 dagar senare, så triggern är något annat (första bud med visst villkor? deploy? fastnat jobb?). Utan åtgärd fortsätter det till minst 20 augusti.
- **Nästa steg:** (a) granska tjänstens logik för auktioner med slutdatum långt fram (gissning: bevakningsloop utan backoff), (b) snabbtest: starta om podden — upphör pollandet eller återupptas det direkt? (skiljer "fastnat" från "by design").

## 4. Långsamma endpoints under auktionsförmiddagen (Dalarnas)

| Endpoint | Anrop (6 h) | SQL-tid | Kommentar |
|---|---|---|---|
| `CatalogItems/Get` | 1 516 | 881 s | Känd query-shape-problematik — **rör ej** (se §5) |
| `Auction/GetCategories` | 967 | 604 s | Cache-kandidat |
| `Auction/GetAuctionCalendar` | 205 | 579 s | **2,8 s/anrop** — cache-kandidat |
| `Bids/GetAll` | 799 | 412 s | Realtid — ska inte cachas |

**GetAuctionCalendar i detalj:** exakt 1 SQL-fråga per anrop (inte N+1). Kostnaden skalar med tenantens datamängd: Dalarnas snitt 1 713 ms (p95 3 471, max 17 909) mot ~370 ms för Upplands/Bergviks/Laholms. Sannolikt scan över hela auktionshistoriken. **Rekommenderad åtgärd är cache (≥60 s TTL, ev. invalidering vid auktionssparning i admin) — inte SQL-omskrivning.**

## 5. Rättelse: katalogfixen är INTE en enkel win

Junihistoriken (24–25 juni): #3048 (aktiva-auktioner-subquery) gav ~0× i prod; #3054 (TVF) orsakade prod-incident (~530 000 reads, sidladdning 200→680 ms, ~279 st 500-fel när migreringen droppade vyn före utrullningen); båda reverterade via #3058. Problemet är **olöst**. Lärdomar: lokalt snabb ≠ prod-snabb; verifiera prod-exekveringsplanen (Query Store) FÖRE rollout; låt aldrig schemamigrering springa före koden.

## 6. Åtgärdslista inför nästa nyhetsbrevssläpp (~13 augusti)

1. **Mälardalen-pollern** — identifiera & åtgärda (störst effekt, pågående slöseri).
2. **Höj `maxReplicaCount`** på `cpu-scaledobject-dalarnas` (5 → förslagsvis 8) + **cron-trigger i KEDA** för förskalning ~30 min före kända utskick. Verifiera scaledobject-namnet först.
3. **Sänk överdrivna CPU-requests** (värst: `notifyusers` 700m bokat / 4m använt) — annars finns inte schemaläggningsutrymme för fler repliker; klustrets CPU-requests är bindande faktor (71–86 % bokat, 6–22 % använt) och varje ny nod är full PAYG (reservationer 1:1).
4. **Cache på `GetAuctionCalendar` + `GetCategories`** — efter Query Store-verifiering av vad de exekverar.
5. SQL-larm: Sev0-regeln (>80 %/1 min) finns och fungerar — bekräftad 27 juli. Ingen ytterligare åtgärd nödvändig.

## 7. Åtkomst-setup etablerad i denna session (återanvändbar)

- Miljön "Default" (Claude Code web) har `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`AZURE_TENANT_ID` som miljövariabler; nätverkspolicyn tillåter `login.microsoftonline.com` + `api.loganalytics.io`.
- Skript `azquery.py` (scratchpad) + permission-regel i `.claude/settings.local.json` (gitignorerad) ger KQL-frågor mot `bby-eu1-law-prod` via client credentials. Fungerar verifierat.
- **Saknas fortfarande:** `management.azure.com` i nätverkspolicyn (behövs för Azure Monitor Metrics-API:t, t.ex. Front Door-egress — AFD-frågan från nyhetsbrevsanalysen är därmed obesvarad). Ändringen slår igenom i nya sessioner.
- Query Store (statement-nivå) kräver manuell körning via portal/Beekeeper — SQL-porten (1433) nås inte genom proxyn. Färdig QS-fråga finns i konversationen.
- Notering: klient-secreten ligger läsbar i miljövariablerna (dialogen varnar själv för detta) — överväg rotation/flytt vid tillfälle.
