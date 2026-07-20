/*
 * Loggar ett stickprov av pooldatan (klor, pH, vattentemp, flöde) till
 * pool-data-grenen. Körs av .github/workflows/pool-log.yml var 30:e minut.
 *
 * Läser nuvärdet från miljövariabeln DATA (JSON från /api/aseko) och lägger
 * till en rad i <root>/pool/<YYYY-MM-DD>.json i lokal tid (Europe/Stockholm),
 * så att sajten kan rita dygnets kurva – man ser kloret sjunka när pooltaket
 * tas av och solen bryter ned det.
 *
 *   node scripts/pool-log.mjs <root>     (root = utcheckad pool-data-gren)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || ".";

let d;
try { d = JSON.parse(process.env.DATA || "{}"); } catch { d = {}; }
if (!d || d.status !== "ok" || !d.pool) {
  console.log("Ingen pooldata i svaret – hoppar över.");
  process.exit(0);
}
const p = d.pool;

// Lokal tid i Sverige (körningen sker i UTC)
const parts = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).formatToParts(new Date());
const gp = (t) => parts.find((x) => x.type === t).value;
const date = `${gp("year")}-${gp("month")}-${gp("day")}`;
const hm = `${gp("hour")}:${gp("minute")}`;

const dir = join(root, "pool");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${date}.json`);

let doc = { date, unit: p.serial ?? null, tz: "Europe/Stockholm", samples: [] };
if (existsSync(file)) { try { doc = JSON.parse(readFileSync(file, "utf8")); } catch {} }
if (!Array.isArray(doc.samples)) doc.samples = [];

// Skydd mot dubbletter om två körningar landar samma minut
if (doc.samples.length && doc.samples[doc.samples.length - 1].t === hm) {
  console.log("Samma minut redan loggad – hoppar över.");
  process.exit(0);
}

const truthy = (v) => /^(true|on|1|yes|ja|flow|running)$/i.test(String(v));
doc.samples.push({
  t: hm,
  cl: p.clFree ?? null,
  ph: p.ph ?? null,
  wt: p.waterTemp ?? null,
  flow: p.flow == null ? null : (truthy(p.flow) ? 1 : 0),
});

writeFileSync(file, JSON.stringify(doc));
console.log(`Loggade ${date} ${hm}: klor=${p.clFree} pH=${p.ph} temp=${p.waterTemp}`);
