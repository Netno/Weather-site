/* Ordlista för historiksidan (/historik/).
 * Laddas efter assets/i18n.js och före sidans eget skript. Gemensamma ord
 * (månader, riktningar, Max/Min/Medel, "Hämtar …" …) ligger kvar i i18n.js och
 * återanvänds härifrån i stället för att dupliceras.
 */
"use strict";

I18N.register({
  sv: {
    /* ===== Sidhuvud, flikar och sidfot ===================================== */
    "hist.title": "Historik · Brämhult väderstation",
    "hist.navLive": "Live",
    "hist.navHistory": "Historik",
    "hist.metaSource": "Historik ur eget arkiv",
    "hist.footer": 'Historiken läses ur stationens eget arkiv (<span id="arkiv-span">hämtar …</span>).<br>'
      + 'Arkivet fylls på varje natt · <a href="/">till live-vyn</a>',

    "hist.tab.explore": "Utforska",
    "hist.tab.day": "Dag",
    "hist.tab.yearday": "Samma dag genom åren",
    "hist.tab.month": "Månadsjämförelse",
    "hist.tab.year": "Året",
    "hist.tab.windrose": "Vindros",
    "hist.tab.records": "Rekord",

    /* Backfillnotisen: en nyckel, singular/plural löses i funktionen */
    "hist.backfill": v =>
      `Arkivet byggs ifatt i bakgrunden: just nu ${v.from} → ${v.to}, `
      + `och det växer med ~150 dygn per natt (${v.days} dygn kvar ≈ ${v.nights} ${v.nights === 1 ? "natt" : "nätter"}). `
      + `Vyerna öppnar på senaste arkiverade dygnet och hittar fram till idag av sig själva.`,

    /* ===== Mätvärden, enheter och återkommande etiketter =================== */
    "hist.metric.temp": "Temperatur",
    "hist.metric.hum": "Luftfuktighet",
    "hist.metric.wind": "Vind",
    "hist.metric.rain": "Nederbörd",
    "hist.metric.pressure": "Lufttryck",
    "hist.metric.dewpt": "Daggpunkt",
    "hist.metric.uv": "UV-index",
    "hist.metric.lux": "Ljusintensitet",
    "hist.metric.ljustid": "Ljustid",
    "hist.metric.blixt": "Blixtar",
    "hist.metric.solighet": "Solighet",

    "hist.unit.strikes": "st",            // antal blixtar
    "hist.unit.dayCount": "st",           // antal dagar (åskdagar)
    "hist.unit.days": "dygn",             // längd i dygn
    "hist.unit.lightMinPerHour": "min ljus/tim",
    "hist.suffix.seaLevel": "(havsnivå)",

    "hist.label.year": "År",
    "hist.label.windAvg": "Medelvind",
    "hist.label.gusts": "Byar",
    "hist.label.maxGust": "Kraftigaste by",

    /* Datumsammansättningar — hålls som nycklar så ordföljden kan bytas */
    "hist.dayMonth": "{day} {month}",
    "hist.monthYear": "{month} {year}",
    "hist.dateFull": "{weekday} {day} {month} {year}",

    /* Tooltip-rubriker */
    "hist.tip.hour": "kl {h}",
    "hist.tip.hourRange": "kl {from}–{to}",
    "hist.tip.dayHour": "{date} kl {h}",
    "hist.tip.dayHourRange": "{date} kl {from}–{to}",
    "hist.tip.closest": "· närmast {km} km",

    /* ===== Vy: Utforska =================================================== */
    "hist.range.48h": "48 tim",
    "hist.range.week": "Vecka",
    "hist.range.month": "Månad",
    "hist.range.year": "År",
    "hist.range.all": "Allt",
    "hist.range.custom": "Eget …",

    "hist.utf.partTotal": "· totalt <b>{value}</b>",
    "hist.utf.partMin": "· min <b>{value}</b>",
    "hist.utf.partMax": "· max <b>{value}</b>",
    "hist.utf.partAvg": "· medel <b>{value}</b>",
    "hist.utf.subMax": "{period} · max <b>{value}</b>",
    "hist.utf.subPeak": "{period} · dygnsmax · topp <b>{value}</b>",
    "hist.utf.subMeanPerDay": "· medel <b>{value} h/dag</b>",
    "hist.utf.blixtSubHourly": "{period} · totalt <b>{total} st</b> (sensorns råräkning)",
    "hist.utf.blixtSubDaily": "{period} · totalt <b>{total} st</b> på <b>{days}</b> åskdagar (sensorns råräkning)",
    "hist.legend.dayMean": "Dygnsmedel",
    "hist.legend.maxMin": "Max–min",
    "hist.legend.dayWindAvg": "Dygnets medelvind",
    "hist.empty.period": "Ingen data i den här perioden",

    /* ===== Vy: Dag ======================================================== */
    "hist.dag.prevAria": "Föregående dag",
    "hist.dag.nextAria": "Nästa dag",
    "hist.dag.windSub": "Medelvind och byar per timme",
    "hist.dag.tempSub": "Min <b>{min}°</b> · max <b>{max}°</b>",
    "hist.dag.rainSub": "Totalt <b>{value} mm</b>",
    "hist.dag.pressureSub": "havsnivå, dygnsmitt",
    "hist.dag.humSub": "dygnsmedel",
    "hist.dag.windTip": "Medel <b>{avg}</b> · byar <b>{gust}</b> m/s",
    "hist.empty.notArchived": "Det här dygnet har inte arkiverats ännu — arkivet är framme vid {date}.",
    "hist.empty.dayOffline": "Ingen data för det här dygnet (stationen var offline).",

    /* ===== Vy: Samma dag genom åren ======================================= */
    "hist.arsdag.dateLabel": "Datum",
    "hist.arsdag.chartTitle": "Temperatur under dygnet, år för år",
    "hist.arsdag.sub": "Timvärden den <b>{date}</b> varje år som finns i arkivet",
    "hist.arsdag.stripTitle": "Max, min och nederbörd",
    "hist.arsdag.stripSub": "Samma datum, alla år i arkivet",
    "hist.arsdag.todayLabel": "{year} (idag)",
    "hist.arsdag.todayPending": "· {year} arkiveras i natt",
    "hist.empty.dateRange": "Ingen data för det här datumet ännu — arkivet täcker {from} till {to}.",

    /* ===== Vy: Månadsjämförelse =========================================== */
    "hist.manad.monthLabel": "Månad",
    "hist.manad.tempTitle": "Dygnets maxtemperatur",
    "hist.manad.tempSub": "<b>{month}</b> · {years}",
    "hist.manad.pickYears": "välj år ovan",
    "hist.manad.rainTitle": "Ackumulerad nederbörd",
    "hist.manad.rainSub": "Summerat från månadens första dag",
    "hist.manad.rainSubYear": "Summerat från årets första dag",
    "hist.manad.rainTip": "t.o.m. {day} {month}",
    "hist.manad.statsTitle": "Statistik",
    "hist.manad.statsSub": "Per valt år",
    "hist.manad.noYears": "Inga år med den månaden i arkivet ännu",
    "hist.manad.thAvgHigh": "Medelmax",
    "hist.manad.thAvgLow": "Medelmin",
    "hist.manad.thWarmest": "Varmast",
    "hist.manad.thColdest": "Kallast",
    "hist.manad.thRainDays": "Regndagar",
    "hist.manad.thDays": "Dagar med data",

    /* ===== Vy: Året (värmekarta) ========================================== */
    "hist.aret.optTemp": "Dygnsmedeltemp",
    "hist.aret.optTempMax": "Dygnsmax",
    "hist.aret.optTempMin": "Dygnsmin",
    "hist.hm.temp": "Dygnsmedeltemperatur",
    "hist.hm.tempMax": "Dygnets högsta temperatur",
    "hist.hm.tempMin": "Dygnets lägsta temperatur",
    "hist.hm.lux": "Ljusintensitet (dygnsmax)",
    "hist.aret.sub": "<b>{n}</b> dagar med data · min <b>{min}</b> · max <b>{max}</b>",
    "hist.aret.cellNoData": "{date}: ingen data",
    "hist.empty.year": "Ingen data för det här året ännu — arkivet fylls på varje natt.",
    "hist.empty.sensorYear": "Stationens ljus- och blixtsensor har data först från {date} — äldre värden finns inte hos vare sig myAcuRite eller Weather Underground.",

    /* ===== Vy: Vindros ==================================================== */
    "hist.vr.periodLabel": "Period",
    "hist.vr.wholeYear": "Hela året",
    "hist.vr.allYears": "Alla år",
    "hist.vr.subStatic": "Andel blåsiga timmar (≥ 5 km/h) per riktning · stationens sensor sedan mars 2025",
    "hist.vr.sub": "Andel blåsiga timmar (≥ 5 km/h) per riktning · <b>{days}</b> dagar · vanligast <b>{dir}</b> ({pct} %)",
    "hist.vr.dirTitle": "{dir}: {hours} timmar ({pct} %)",
    "hist.empty.wind": "Ingen vinddata för det här urvalet",

    /* ===== Vy: Rekord ===================================================== */
    "hist.rk.wuTitle": "Temperatur, nederbörd & vind",
    "hist.rk.acuTitle": "Ljus & blixtar",
    "hist.rk.yearTitle": "Varmast och kallast per år",
    "hist.rk.yearSub": "Årets högsta och lägsta uppmätta temperatur",
    "hist.rk.frostTitle": "Frost & växtsäsong",
    "hist.rk.frostSub": "Sista vårfrost, första höstfrost och frostfria dagar däremellan",
    "hist.rk.hottestDay": "Varmaste dygn",
    "hist.rk.coldestNight": "Kallaste natt",
    "hist.rk.wettestDay": "Blötaste dygn",
    "hist.rk.wettestMonth": "Blötaste månad",
    "hist.rk.longestDry": "Längsta torrperiod",
    "hist.rk.wuNote": "Ur WU-arkivet {from} – {to}.",
    "hist.rk.wuNoteBackfill": "Ur WU-arkivet {from} – {to} — backfillen pågår, rekorden uppdateras i takt med att arkivet växer.",
    "hist.rk.mostStrikes": "Mest blixtar en dag",
    "hist.rk.closestStrike": "Närmaste nedslag",
    "hist.rk.stormDays": "Åskdagar totalt",
    "hist.rk.since": "sedan {date}",
    "hist.rk.brightest": "Högsta ljusintensitet",
    "hist.rk.longestLight": "Längsta ljusdag",
    "hist.rk.sunniest": "Soligaste dagen",
    "hist.rk.acuNote": "Stationens egna sensorer via myAcuRite — historik sedan {date} (äldre rensas av AcuRite; vårt arkiv bevarar allt framåt).",
    "hist.rk.thLastSpringFrost": "Sista vårfrost",
    "hist.rk.thFirstAutumnFrost": "Första höstfrost",
    "hist.rk.thFrostFree": "Frostfria dagar",

    "hist.empty.archive": "Arkivet är inte tillgängligt ännu.",
  },

  en: {
    /* ===== Page header, tabs and footer ==================================== */
    "hist.title": "History · Brämhult weather station",
    "hist.navLive": "Live",
    "hist.navHistory": "History",
    "hist.metaSource": "History from our own archive",
    "hist.footer": 'The history is read from the station\'s own archive (<span id="arkiv-span">loading …</span>).<br>'
      + 'The archive is filled in every night · <a href="/">to the live view</a>',

    "hist.tab.explore": "Explore",
    "hist.tab.day": "Day",
    "hist.tab.yearday": "Same day through the years",
    "hist.tab.month": "Month comparison",
    "hist.tab.year": "The year",
    "hist.tab.windrose": "Wind rose",
    "hist.tab.records": "Records",

    "hist.backfill": v =>
      `The archive is catching up in the background: right now ${v.from} → ${v.to}, `
      + `growing by ~150 days a night (${v.days} days left ≈ ${v.nights} ${v.nights === 1 ? "night" : "nights"}). `
      + `The views open on the most recent archived day and reach today on their own.`,

    /* ===== Metrics, units and recurring labels ============================= */
    "hist.metric.temp": "Temperature",
    "hist.metric.hum": "Humidity",
    "hist.metric.wind": "Wind",
    "hist.metric.rain": "Precipitation",
    "hist.metric.pressure": "Air pressure",
    "hist.metric.dewpt": "Dew point",
    "hist.metric.uv": "UV index",
    "hist.metric.lux": "Light intensity",
    "hist.metric.ljustid": "Daylight hours",
    "hist.metric.blixt": "Lightning",
    "hist.metric.solighet": "Sunshine",

    "hist.unit.strikes": "strikes",
    "hist.unit.dayCount": "days",
    "hist.unit.days": "days",
    "hist.unit.lightMinPerHour": "min of light/hr",
    "hist.suffix.seaLevel": "(sea level)",

    "hist.label.year": "Year",
    "hist.label.windAvg": "Mean wind",
    "hist.label.gusts": "Gusts",
    "hist.label.maxGust": "Strongest gust",

    "hist.dayMonth": "{day} {month}",
    "hist.monthYear": "{month} {year}",
    "hist.dateFull": "{weekday} {day} {month} {year}",

    "hist.tip.hour": "{h}:00",
    "hist.tip.hourRange": "{from}:00–{to}:00",
    "hist.tip.dayHour": "{date}, {h}:00",
    "hist.tip.dayHourRange": "{date}, {from}:00–{to}:00",
    "hist.tip.closest": "· nearest {km} km",

    /* ===== View: Explore ================================================== */
    "hist.range.48h": "48 hrs",
    "hist.range.week": "Week",
    "hist.range.month": "Month",
    "hist.range.year": "Year",
    "hist.range.all": "All",
    "hist.range.custom": "Custom …",

    "hist.utf.partTotal": "· <b>{value}</b> in total",
    "hist.utf.partMin": "· min <b>{value}</b>",
    "hist.utf.partMax": "· max <b>{value}</b>",
    "hist.utf.partAvg": "· mean <b>{value}</b>",
    "hist.utf.subMax": "{period} · max <b>{value}</b>",
    "hist.utf.subPeak": "{period} · daily max · peak <b>{value}</b>",
    "hist.utf.subMeanPerDay": "· mean <b>{value} h/day</b>",
    "hist.utf.blixtSubHourly": "{period} · <b>{total} strikes</b> in total (raw sensor count)",
    "hist.utf.blixtSubDaily": "{period} · <b>{total} strikes</b> in total on <b>{days}</b> thunder days (raw sensor count)",
    "hist.legend.dayMean": "Daily mean",
    "hist.legend.maxMin": "Max–min",
    "hist.legend.dayWindAvg": "Daily mean wind",
    "hist.empty.period": "No data in this period",

    /* ===== View: Day ====================================================== */
    "hist.dag.prevAria": "Previous day",
    "hist.dag.nextAria": "Next day",
    "hist.dag.windSub": "Mean wind and gusts per hour",
    "hist.dag.tempSub": "Min <b>{min}°</b> · max <b>{max}°</b>",
    "hist.dag.rainSub": "<b>{value} mm</b> in total",
    "hist.dag.pressureSub": "sea level, daily midpoint",
    "hist.dag.humSub": "daily mean",
    "hist.dag.windTip": "Mean <b>{avg}</b> · gusts <b>{gust}</b> m/s",
    "hist.empty.notArchived": "This day has not been archived yet — the archive reaches {date}.",
    "hist.empty.dayOffline": "No data for this day (the station was offline).",

    /* ===== View: Same day through the years =============================== */
    "hist.arsdag.dateLabel": "Date",
    "hist.arsdag.chartTitle": "Temperature through the day, year by year",
    "hist.arsdag.sub": "Hourly values on <b>{date}</b> for every year in the archive",
    "hist.arsdag.stripTitle": "Max, min and precipitation",
    "hist.arsdag.stripSub": "The same date, every year in the archive",
    "hist.arsdag.todayLabel": "{year} (today)",
    "hist.arsdag.todayPending": "· {year} will be archived tonight",
    "hist.empty.dateRange": "No data for this date yet — the archive covers {from} to {to}.",

    /* ===== View: Month comparison ========================================= */
    "hist.manad.monthLabel": "Month",
    "hist.manad.tempTitle": "Daily maximum temperature",
    "hist.manad.tempSub": "<b>{month}</b> · {years}",
    "hist.manad.pickYears": "select years above",
    "hist.manad.rainTitle": "Cumulative precipitation",
    "hist.manad.rainSub": "Summed from the first day of the month",
    "hist.manad.rainSubYear": "Summed from the first day of the year",
    "hist.manad.rainTip": "up to {day} {month}",
    "hist.manad.statsTitle": "Statistics",
    "hist.manad.statsSub": "Per selected year",
    "hist.manad.noYears": "No years with that month in the archive yet",
    "hist.manad.thAvgHigh": "Mean max",
    "hist.manad.thAvgLow": "Mean min",
    "hist.manad.thWarmest": "Warmest",
    "hist.manad.thColdest": "Coldest",
    "hist.manad.thRainDays": "Rain days",
    "hist.manad.thDays": "Days with data",

    /* ===== View: The year (heatmap) ======================================= */
    "hist.aret.optTemp": "Daily mean temp",
    "hist.aret.optTempMin": "Daily minimum",
    "hist.aret.optTempMax": "Daily maximum",
    "hist.hm.temp": "Daily mean temperature",
    "hist.hm.tempMin": "Daily minimum temperature",
    "hist.hm.tempMax": "Daily maximum temperature",
    "hist.hm.lux": "Light intensity (daily max)",
    "hist.aret.sub": "<b>{n}</b> days with data · min <b>{min}</b> · max <b>{max}</b>",
    "hist.aret.cellNoData": "{date}: no data",
    "hist.empty.year": "No data for this year yet — the archive is filled in every night.",
    "hist.empty.sensorYear": "The station's light and lightning sensors only have data from {date} — older values exist neither at myAcuRite nor at Weather Underground.",

    /* ===== View: Wind rose ================================================ */
    "hist.vr.periodLabel": "Period",
    "hist.vr.wholeYear": "Whole year",
    "hist.vr.allYears": "All years",
    "hist.vr.subStatic": "Share of windy hours (≥ 5 km/h) per direction · the station's own sensor since March 2025",
    "hist.vr.sub": "Share of windy hours (≥ 5 km/h) per direction · <b>{days}</b> days · most common <b>{dir}</b> ({pct} %)",
    "hist.vr.dirTitle": "{dir}: {hours} hours ({pct} %)",
    "hist.empty.wind": "No wind data for this selection",

    /* ===== View: Records ================================================== */
    "hist.rk.wuTitle": "Temperature, precipitation & wind",
    "hist.rk.acuTitle": "Light & lightning",
    "hist.rk.yearTitle": "Warmest and coldest day by year",
    "hist.rk.yearSub": "The highest and lowest temperature measured each year",
    "hist.rk.frostTitle": "Frost & growing season",
    "hist.rk.frostSub": "Last spring frost, first autumn frost and the frost-free days in between",
    "hist.rk.hottestDay": "Hottest day",
    "hist.rk.coldestNight": "Coldest night",
    "hist.rk.wettestDay": "Wettest day",
    "hist.rk.wettestMonth": "Wettest month",
    "hist.rk.longestDry": "Longest dry spell",
    "hist.rk.wuNote": "From the WU archive {from} – {to}.",
    "hist.rk.wuNoteBackfill": "From the WU archive {from} – {to} — the backfill is still running, so the records update as the archive grows.",
    "hist.rk.mostStrikes": "Most lightning in a day",
    "hist.rk.closestStrike": "Closest strike",
    "hist.rk.stormDays": "Thunder days in total",
    "hist.rk.since": "since {date}",
    "hist.rk.brightest": "Highest light intensity",
    "hist.rk.longestLight": "Longest day of light",
    "hist.rk.sunniest": "Sunniest day",
    "hist.rk.acuNote": "The station's own sensors via myAcuRite — history since {date} (AcuRite prunes the older data; our archive keeps everything from here on).",
    "hist.rk.thLastSpringFrost": "Last spring frost",
    "hist.rk.thFirstAutumnFrost": "First autumn frost",
    "hist.rk.thFrostFree": "Frost-free days",

    "hist.empty.archive": "The archive is not available yet.",
  },
});
