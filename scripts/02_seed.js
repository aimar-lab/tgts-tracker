// =====================================================================
// 02_seed.js  -  TGTS Tracker: load sample accounts into all 4 collections
// Run:  mongosh "$MONGODB_URI" --quiet --file scripts/02_seed.js
// Uses replaceOne(..., {upsert:true}) so it is safe to re-run
// (this is also the "create/update by id" pattern used by the API).
// =====================================================================

const tgts = db.getSiblingDB("tgts_tracker");
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const acc = (n) => "TGTS-" + String(n).padStart(6, "0");   // enumerable key: TGTS-000001

// [name, currency, dashboard fields, alert recipients, alert expires in N days (null = never), font, size, scheme, lang]
const accounts = [
  ["Ridwan Aimar",              "MYR", ["SHIP_STATUS", "ETA", "CURRENT_LOCATION"],                      ["ridwan@example.com", "+60123456789"], 30,   "Inter",   14, "dark",          "en"],
  ["Nur Aisyah Logistics",      "MYR", ["SHIP_STATUS", "LAST_SCAN", "DESTINATION", "PROOF_OF_DELIVERY"], ["ops@nuraisyah.my"],                   null, "Roboto",  16, "light",         "ms"],
  ["Lim Trading Sdn Bhd",       "MYR", ["ETA", "CARRIER", "WEIGHT"],                                     ["lim@limtrading.my", "+60198765432"],  7,    "Arial",   12, "light",         "en"],
  ["Orion Tech Pte Ltd",        "SGD", ["SHIP_STATUS", "ETA", "DELIVERY_EXCEPTIONS"],                    ["alerts@oriontech.sg"],                14,   "Inter",   14, "dark",          "en"],
  ["Kumar Hardware",            "MYR", ["CURRENT_LOCATION", "LAST_SCAN"],                                ["kumar@hardware.my"],                  null, "Verdana", 18, "high-contrast", "en"],
  ["Siti Hassan",               "MYR", ["SHIP_STATUS", "ETA"],                                           ["siti.hassan@example.com"],            3,    "Roboto",  20, "light",         "ms"],
  ["Pacific Freight Inc",       "USD", ["ORIGIN", "DESTINATION", "CARRIER", "WEIGHT", "ETA"],            ["dispatch@pacificfreight.com", "+14155550123"], 60, "Arial", 14, "dark",  "en"],
  ["Jaya Mart Wholesale",       "MYR", ["SHIP_STATUS", "PROOF_OF_DELIVERY"],                             ["admin@jayamart.my"],                  null, "Inter",   15, "light",         "ms"],
  ["Nusantara Export PT",       "IDR", ["SHIP_STATUS", "CURRENT_LOCATION", "DELIVERY_EXCEPTIONS"],       ["cs@nusantara.co.id"],                 21,   "Roboto",  14, "light",         "en"],
  ["Bangkok Parts Co",          "THB", ["ETA", "LAST_SCAN", "ORIGIN"],                                   ["parts@bkkparts.co.th"],               null, "Arial",   13, "dark",          "en"],
];

let n = 0;
for (const [name, currency, fields, recipients, expDays, fontName, fontSize, colorScheme, preferredLanguage] of accounts) {
  const id = acc(++n);
  tgts.customers.replaceOne({ _id: id }, { _id: id, name, currency }, { upsert: true });
  tgts.dashboards.replaceOne({ _id: id }, { _id: id, fields }, { upsert: true });

  const alert = { _id: id, recipients };
  if (expDays !== null) alert.expiresAt = new Date(now + expDays * DAY);   // optional field
  tgts.alerts.replaceOne({ _id: id }, alert, { upsert: true });

  tgts.ui_configs.replaceOne({ _id: id },
    { _id: id, fontName, fontSize: NumberInt(fontSize), colorScheme, preferredLanguage }, { upsert: true });
}

print(`Seeded ${n} accounts (${acc(1)} .. ${acc(n)})\n`);
for (const c of ["customers", "dashboards", "alerts", "ui_configs"]) {
  print(`${c.padEnd(11)} : ${tgts.getCollection(c).countDocuments()} documents`);
}
print(`\nalerts with expiresAt   : ${tgts.alerts.countDocuments({ expiresAt: { $exists: true } })}`);
print(`alerts without expiresAt: ${tgts.alerts.countDocuments({ expiresAt: { $exists: false } })}  (never expire)`);
