// =====================================================================
// 03_validation_test.js  -  prove that JSON schema validation works
// Run:  mongosh "$MONGODB_URI" --quiet --file scripts/03_validation_test.js
// Bad documents must be REJECTED (error 121); the good update must be ACCEPTED.
// Nothing invalid is ever saved, so this is safe to re-run.
// =====================================================================

const tgts = db.getSiblingDB("tgts_tracker");

function attempt(label, fn) {
  try {
    fn();
    print(`ACCEPTED  ${label}`);
  } catch (e) {
    // Pull out the schema rule that failed, to show WHY it was rejected
    const rules = (e.errInfo && e.errInfo.details && e.errInfo.details.schemaRulesNotSatisfied) || [];
    const why = JSON.stringify(rules).replace(/"/g, "").slice(0, 160);
    print(`REJECTED  ${label}\n          -> code ${e.code}: ${e.errmsg || e.message}\n          -> ${why}`);
  }
}

print("=== JSON schema validation tests ===\n");

attempt("dashboards: unknown field code 'PRICE'", () =>
  tgts.dashboards.insertOne({ _id: "TGTS-900001", fields: ["SHIP_STATUS", "PRICE"] }));

attempt("dashboards: duplicate field code 'ETA'", () =>
  tgts.dashboards.insertOne({ _id: "TGTS-900002", fields: ["ETA", "ETA"] }));

attempt("dashboards: empty fields array", () =>
  tgts.dashboards.insertOne({ _id: "TGTS-900003", fields: [] }));

attempt("customers: badly formatted accountNumber 'ACC-1'", () =>
  tgts.customers.insertOne({ _id: "ACC-1", name: "Bad Key Ltd", currency: "MYR" }));

attempt("ui_configs: unsupported preferredLanguage 'zh' (before Q9 extension)", () =>
  tgts.ui_configs.insertOne({ _id: "TGTS-900004", fontName: "Inter", fontSize: NumberInt(14),
                              colorScheme: "light", preferredLanguage: "zh" }));

attempt("dashboards: VALID update of TGTS-000001 (adds LAST_SCAN)", () =>
  tgts.dashboards.updateOne({ _id: "TGTS-000001" },
    { $set: { fields: ["SHIP_STATUS", "ETA", "CURRENT_LOCATION", "LAST_SCAN"] } }));

print("\nCurrent TGTS-000001 dashboard:");
printjson(tgts.dashboards.findOne({ _id: "TGTS-000001" }));
