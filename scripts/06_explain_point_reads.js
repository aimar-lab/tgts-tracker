// =====================================================================
// 06_explain_point_reads.js  -  prove point reads use the _id index
// Run:  mongosh "$MONGODB_URI" --quiet --file scripts/06_explain_point_reads.js
//
// For each collection: explain() a lookup by _id (the app's main read path).
// Expected: an IDHACK / EXPRESS_IDHACK plan, 1 key examined, 1 document examined.
// For comparison: a lookup on a NON-indexed field (customers.name) does a COLLSCAN
// and has to examine every document.
// =====================================================================

const tgts = db.getSiblingDB("tgts_tracker");
const ID = "TGTS-000001";

// collect all stage names in a plan tree (handles classic and SBE explain formats)
function stages(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.stage) out.push(node.stage);
  for (const k of ["inputStage", "queryPlan", "winningPlan"]) stages(node[k], out);
  for (const s of node.inputStages || []) stages(s, out);
  return out;
}

function report(label, coll, filter) {
  const ex = tgts.getCollection(coll).find(filter).explain("executionStats");
  const plan = stages(ex.queryPlanner.winningPlan).join(" <- ");
  const s = ex.executionStats;
  print(`${label.padEnd(34)} plan: ${plan.padEnd(22)} keysExamined: ${s.totalKeysExamined}  docsExamined: ${s.totalDocsExamined}  returned: ${s.nReturned}  time: ${s.executionTimeMillis} ms`);
}

print(`=== Point reads by _id ("${ID}") ===`);
for (const c of ["customers", "dashboards", "alerts", "ui_configs"]) {
  report(`${c}.find({_id})`, c, { _id: ID });
}

print(`\n=== For comparison: query on a non-indexed field ===`);
report(`customers.find({name})`, "customers", { name: "Ridwan Aimar" });
print(`\n(customers has ${tgts.customers.countDocuments()} documents; the COLLSCAN examined all of them)`);
