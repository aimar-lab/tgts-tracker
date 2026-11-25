// =====================================================================
// 07_language_extension.js  -  Q9: extending preferredLanguage with "zh"
// Run AFTER adding "zh" labels to config/field_codes.json and re-running
// scripts/01_setup.js (which refreshes the validator):
//   mongosh "$MONGODB_URI" --quiet --file scripts/07_language_extension.js
//
// Shows that a new language is added WITHOUT any data migration:
//   - the validator now accepts "zh"
//   - one account switches to "zh" and immediately gets Chinese labels
//   - all existing en/ms documents are untouched and still work
// =====================================================================

const fs = require("fs");
const tgts = db.getSiblingDB("tgts_tracker");
const LABELS = JSON.parse(fs.readFileSync("config/field_codes.json", "utf8"));
const ACCOUNT = "TGTS-000004";   // Orion Tech Pte Ltd (Singapore)

// 1. what the database validator allows now
const schema = tgts.getCollectionInfos({ name: "ui_configs" })[0].options.validator.$jsonSchema;
print(`1) ui_configs validator - preferredLanguage allowed values: ${JSON.stringify(schema.properties.preferredLanguage.enum)}`);

// 2. switch one account to Chinese (this was REJECTED before the extension)
const before = tgts.ui_configs.findOne({ _id: ACCOUNT }).preferredLanguage;
const res = tgts.ui_configs.updateOne({ _id: ACCOUNT }, { $set: { preferredLanguage: "zh" } });
print(`2) ${ACCOUNT}: preferredLanguage "${before}" -> "zh"  (matched ${res.matchedCount}, modified ${res.modifiedCount}) ACCEPTED`);

// 3. labels per language, side by side (same lookup + $getField logic as Pipeline A)
const labelFor = (codeExpr, langExpr) => ({
  $let: { vars: { l: { $getField: { field: codeExpr, input: { $literal: LABELS } } } },
          in: { $ifNull: [ { $getField: { field: langExpr, input: "$$l" } },
                           { $getField: { field: "en", input: "$$l" } }, codeExpr ] } }
});
const rows = tgts.customers.aggregate([
  { $match: { _id: { $in: ["TGTS-000001", "TGTS-000002", ACCOUNT] } } },
  { $lookup: { from: "dashboards", localField: "_id", foreignField: "_id", as: "_d" } },
  { $lookup: { from: "ui_configs", localField: "_id", foreignField: "_id", as: "_u" } },
  { $set: { _f: { $first: "$_d.fields" }, _lang: { $first: "$_u.preferredLanguage" } } },
  { $project: { _id: 1, name: 1, lang: "$_lang",
                labels: { $map: { input: "$_f", as: "c", in: labelFor("$$c", "$_lang") } } } },
  { $sort: { _id: 1 } }
]).toArray();
print("\n3) Dashboard labels in each user's preferredLanguage:");
for (const r of rows) print(`   ${r._id} [${r.lang}] ${r.name.padEnd(22)} ${r.labels.join(" | ")}`);

// 4. no migration needed: existing documents keep their values
print("\n4) ui_configs by preferredLanguage (no existing documents were changed):");
tgts.ui_configs.aggregate([{ $group: { _id: "$preferredLanguage", accounts: { $sum: 1 } } }, { $sort: { _id: 1 } }])
  .forEach(g => print(`   ${g._id}: ${g.accounts}`));
