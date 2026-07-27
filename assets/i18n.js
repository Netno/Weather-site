/*
 * Språkstöd för sajten: svenska är standard, engelska går att välja i huvudet.
 * Klassiskt skript utan moduler — ladda före charts.js och sidans eget skript.
 *
 * Sidorna använder:
 *   tr("nyckel", { namn: värde })  → översatt text ({namn} byts ut)
 *   I18N.list("months")            → översatta listor (månader, riktningar …)
 *   I18N.locale                    → "sv-SE" / "en-GB" för tal- och datumformat
 *
 * Statisk markup översätts via attribut:
 *   data-i18n="nyckel"                     → textContent
 *   data-i18n-html="nyckel"                → innerHTML (text med länkar/taggar)
 *   data-i18n-attr="placeholder:nyckel"    → attribut (flera separeras med ;)
 *
 * Byter man språk körs event "langchange" på document — sidorna ritar då om
 * sitt dynamiska innehåll (statisk markup sköter motorn själv).
 */
"use strict";

const I18N = (function () {
  const KEY = "lang";
  const SUPPORTED = ["sv", "en"];
  const dict = { sv: {}, en: {} };

  let lang = "sv";
  try {
    const stored = localStorage.getItem(KEY);
    if (SUPPORTED.includes(stored)) lang = stored;
  } catch (e) { /* privat läge — kör på standardspråket */ }

  function translate(key, vars) {
    let s = dict[lang][key];
    if (s == null) s = dict.sv[key];          // saknad översättning → svenska
    if (s == null) return key;                // saknad nyckel syns tydligt
    if (typeof s === "function") return s(vars || {}, lang);
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  // Saknas nyckeln helt (ordlistan hann inte laddas) lämnas markupen orörd —
  // texten som redan står i HTML:en är svenska och bättre än en naken nyckel
  const known = key => dict[lang][key] != null || dict.sv[key] != null;

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(el => {
      if (known(el.dataset.i18n)) el.textContent = translate(el.dataset.i18n);
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(el => {
      if (known(el.dataset.i18nHtml)) el.innerHTML = translate(el.dataset.i18nHtml);
    });
    scope.querySelectorAll("[data-i18n-attr]").forEach(el => {
      for (const pair of el.dataset.i18nAttr.split(";")) {
        const i = pair.indexOf(":");
        if (i < 0) continue;
        const key = pair.slice(i + 1).trim();
        if (known(key)) el.setAttribute(pair.slice(0, i).trim(), translate(key));
      }
    });
  }

  function refreshSwitcher() {
    const btn = document.getElementById("lang-toggle");
    if (!btn) return;
    const next = lang === "sv" ? "en" : "sv";
    btn.textContent = next.toUpperCase();
    btn.setAttribute("aria-label", translate("common.switchLang"));
    btn.setAttribute("title", translate("common.switchLang"));
  }

  function setLang(next) {
    if (!SUPPORTED.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* strunt samma */ }
    document.documentElement.lang = lang;
    apply();
    refreshSwitcher();
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
  }

  const api = {
    get lang() { return lang; },
    get locale() { return lang === "en" ? "en-GB" : "sv-SE"; },
    t: translate,
    list(key) { const v = dict[lang][key] ?? dict.sv[key]; return Array.isArray(v) ? v : []; },
    register(more) {
      for (const l of SUPPORTED) if (more[l]) Object.assign(dict[l], more[l]);
      if (document.readyState !== "loading") { apply(); refreshSwitcher(); }
    },
    setLang,
    apply,
  };

  // Knappen i sidhuvudet kopplas upp så fort DOM:en finns
  function boot() {
    document.documentElement.lang = lang;
    const btn = document.getElementById("lang-toggle");
    if (btn) btn.addEventListener("click", () => setLang(lang === "sv" ? "en" : "sv"));
    apply();
    refreshSwitcher();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Knappen ärver utseendet från temaknappen men behöver plats för två bokstäver
  const style = document.createElement("style");
  style.textContent = `.lang-toggle { width: auto; min-width: 30px; padding: 0 9px;
    font-size: 11px; font-weight: 700; letter-spacing: .04em; }`;
  document.head.appendChild(style);

  return api;
})();
const tr = I18N.t;   // kortform; heter inte t för att koden använder t lokalt

/* ===== Gemensamma ord: namn, riktningar och delad diagramtext ============== */
I18N.register({
  sv: {
    "common.switchLang": "Byt språk till engelska",
    "common.months": ["januari", "februari", "mars", "april", "maj", "juni",
      "juli", "augusti", "september", "oktober", "november", "december"],
    "common.weekdays": ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"],
    "common.dayNames": ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"],
    "common.dirs16": ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO",
      "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"],
    "common.loading": "Hämtar …",
    "common.today": "idag",
    "common.yesterday": "igår",
    "common.max": "Max",
    "common.min": "Min",
    "common.avg": "Medel",
    "common.station": "Brämhult väderstation",
    "common.stationMeta": "209 m ö.h.",
    "chart.empty": "Ingen data för det här valet ännu",
    "chart.zoomAria": "Förstora diagram",
    "chart.hintImage": "Zooma med + / − eller nyp · dra för att panorera · dubbeltryck återställer",
    "chart.hintDetail": "Nyp/+ − för att zooma i tid · dra för att panorera · tryck för exakt tid",
    "chart.closeAria": "Stäng",
    "chart.clockAt": "kl {time}",
    "chart.resetAria": "Återställ",
    "chart.zoomInAria": "Zooma in",
    "chart.zoomOutAria": "Zooma ut",
    "chart.themeToLight": "Byt till ljust tema",
    "chart.themeToDark": "Byt till mörkt tema",
    "chart.themeLight": "Ljust tema",
    "chart.themeDark": "Mörkt tema",
  },
  en: {
    "common.switchLang": "Switch language to Swedish",
    "common.months": ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"],
    "common.weekdays": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    "common.dayNames": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    "common.dirs16": ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
      "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"],
    "common.loading": "Loading …",
    "common.today": "today",
    "common.yesterday": "yesterday",
    "common.max": "Max",
    "common.min": "Min",
    "common.avg": "Mean",
    "common.station": "Brämhult weather station",
    "common.stationMeta": "209 m above sea level",
    "chart.empty": "No data for this selection yet",
    "chart.zoomAria": "Enlarge chart",
    "chart.hintImage": "Zoom with + / − or pinch · drag to pan · double-tap resets",
    "chart.hintDetail": "Pinch/+ − to zoom in time · drag to pan · tap for exact time",
    "chart.closeAria": "Close",
    "chart.clockAt": "{time}",
    "chart.resetAria": "Reset",
    "chart.zoomInAria": "Zoom in",
    "chart.zoomOutAria": "Zoom out",
    "chart.themeToLight": "Switch to light theme",
    "chart.themeToDark": "Switch to dark theme",
    "chart.themeLight": "Light theme",
    "chart.themeDark": "Dark theme",
  },
});
