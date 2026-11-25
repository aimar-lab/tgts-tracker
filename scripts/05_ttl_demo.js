// =====================================================================
// 05_ttl_demo.js  -  TTL demo: an alert that deletes itself
// Run:  mongosh "$MONGODB_URI" --quiet --file scripts/05_ttl_demo.js
//
// 1. Inserts alert TGTS-000900 with expiresAt = now + 60 seconds
// 2. Shows it BEFORE expiry (next to TGTS-000010, an alert with no expiresAt)
// 3. Polls every 15 s until MongoDB's TTL monitor deletes it
//    (the TTL monitor runs about once every 60 s, so deletion happens
//     some time AFTER expiresAt, not at the exact second)
// 4. Shows the state AFTER expiry
// =====================================================================

const tgts = db.getSiblingDB("tgts_tracker");
const DEMO_ID = "TGTS-000900";
const CONTROL_ID = "TGTS-000010";      // seeded alert without expiresAt (never expires)
const TTL_SECONDS = 60;
const t = () => new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

const showAlerts = (label) => {
  print(`\n--- ${label} (${t()}) ---`);
  for (const id of [DEMO_ID, CONTROL_ID]) {
    const d = tgts.alerts.findOne({ _id: id });
    print(d ? `${id}: FOUND   recipients=${JSON.stringify(d.recipients)}  expiresAt=${d.expiresAt ? d.expiresAt.toISOString() : "(none - never expires)"}`
            : `${id}: NOT FOUND (deleted)`);
  }
  print(`alerts collection count: ${tgts.alerts.countDocuments()}`);
};

// TTL index check
const ttl = tgts.alerts.getIndexes().find(i => i.expireAfterSeconds !== undefined);
print(`TTL index: ${ttl.name} on ${JSON.stringify(ttl.key)}, expireAfterSeconds=${ttl.expireAfterSeconds}`);

// 1. create the short-lived alert
const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
tgts.alerts.replaceOne({ _id: DEMO_ID },
  { _id: DEMO_ID, recipients: ["ttl-demo@example.com"], expiresAt }, { upsert: true });
print(`Inserted ${DEMO_ID} with expiresAt = ${expiresAt.toISOString()} (in ${TTL_SECONDS} s)`);

// 2. BEFORE
showAlerts("BEFORE expiry");

// 3. wait for the TTL monitor
print(`\nWaiting for the TTL monitor (checks every 15 s, gives up after 5 min)...`);
const start = Date.now();
while (Date.now() - start < 5 * 60 * 1000) {
  sleep(15 * 1000);
  const doc = tgts.alerts.findOne({ _id: DEMO_ID });
  const secsPast = Math.round((Date.now() - expiresAt.getTime()) / 1000);
  if (!doc) {
    print(`  ${t()}  ${DEMO_ID} has been DELETED by the TTL monitor (${secsPast} s after expiresAt)`);
    break;
  }
  print(`  ${t()}  still present  (${secsPast >= 0 ? secsPast + " s past" : -secsPast + " s before"} expiresAt)`);
}

// 4. AFTER
showAlerts("AFTER expiry");
