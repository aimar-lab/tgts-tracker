// =====================================================================
// 04_aggregation.js  -  dashboard labels + alert counts (aggregation pipeline)
// Run:  mongosh "$MONGODB_URI" --quiet --file scripts/04_aggregation.js
//
// Pipeline A (per account): turns each account's dashboard field CODES into
//   human-readable LABELS in the user's preferredLanguage, and counts the
//   alert recipients (alertCount) for that account.
// Pipeline B (all accounts): how many dashboards use each field (label + count).
//
// The script also saves Pipeline A as JSON so it can be pasted into
// Compass -> customers -> Aggregations (text mode) for a screenshot.
// =====================================================================

const fs = require("fs");
const tgts = db.getSiblingDB("tgts_tracker");
const LABELS = JSON.parse(fs.readFileSync("config/field_codes.json", "utf8"));

// code -> label in language `langExpr`, falling back to English, then to the code itself
const labelFor = (codeExpr, langExpr) => ({
  $let: {
    vars: { l: { $getField: { field: codeExpr, input: { $literal: LABELS } } } },
    in: { $ifNull: [ { $getField: { field: langExpr, input: "$$l" } },
                     { $getField: { field: "en", input: "$$l" } },
                     codeExpr ] }
  }
});

// ---------------------------------------------------------------- Pipeline A
const pipelineA = [
  // join the other three collections on the shared _id (accountNumber)
  { $lookup: { from: "dashboards", localField: "_id", foreignField: "_id", as: "_dash" } },
  { $lookup: { from: "alerts",     localField: "_id", foreignField: "_id", as: "_alerts" } },
  { $lookup: { from: "ui_configs", localField: "_id", foreignField: "_id", as: "_ui" } },
  { $set: {
      _fields: { $ifNull: [ { $first: "$_dash.fields" }, [] ] },
      _lang:   { $ifNull: [ { $first: "$_ui.preferredLanguage" }, "en" ] },
      _alert:  { $first: "$_alerts" }
  } },
  { $project: {
      _id: 0,
      accountNumber: "$_id",
      customer: "$name",
      language: "$_lang",
      dashboardLabels: { $map: { input: "$_fields", as: "c", in: labelFor("$$c", "$_lang") } },
      fieldCount: { $size: "$_fields" },
      alertCount: { $size: { $ifNull: [ "$_alert.recipients", [] ] } },
      alertExpiresAt: "$_alert.expiresAt"
  } },
  { $sort: { accountNumber: 1 } }
];

// ---------------------------------------------------------------- Pipeline B
const pipelineB = [
  { $unwind: "$fields" },
  { $group: { _id: "$fields", dashboards: { $sum: 1 } } },
  { $project: { _id: 0, code: "$_id", dashboards: 1,
                label_en: labelFor("$_id", "en"), label_ms: labelFor("$_id", "ms") } },
  { $sort: { dashboards: -1, code: 1 } }
];

// ---------------------------------------------------------------- run + print
print("=== Pipeline A: dashboard labels and alert count per account ===\n");
const rowsA = tgts.customers.aggregate(pipelineA).toArray();
for (const r of rowsA) {
  const exp = r.alertExpiresAt ? r.alertExpiresAt.toISOString().slice(0, 10) : "never";
  print(`${r.accountNumber}  ${String(r.customer).padEnd(28)} [${r.language}]  alerts: ${r.alertCount} (expires ${exp})`);
  print(`             labels (${r.fieldCount}): ${r.dashboardLabels.join(" | ")}`);
}
print(`\n${rowsA.length} accounts, ${rowsA.reduce((s, r) => s + r.alertCount, 0)} alert recipients in total`);

print("\n=== Pipeline B: field usage across all dashboards (label + count) ===\n");
for (const r of tgts.dashboards.aggregate(pipelineB).toArray()) {
  print(`${String(r.dashboards).padStart(3)}  ${r.code.padEnd(20)} ${r.label_en.padEnd(22)} ${r.label_ms}`);
}

fs.mkdirSync("samples", { recursive: true });
fs.writeFileSync("samples/pipeline_dashboard_summary.json", JSON.stringify(pipelineA, null, 2));
print("\nSaved Pipeline A to samples/pipeline_dashboard_summary.json (paste into Compass Aggregations > Text)");
