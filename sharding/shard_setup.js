// =====================================================================
// shard_setup.js  -  sharding demo on the local cluster (run against mongos)
// Run:  mongosh --quiet --port 27100 --file sharding/shard_setup.js
//
// Part 1  Hashed sharding on _id (the proposed design) for all 4 collections,
//         1,000 accounts loaded, data spread evenly across 2 shards.
// Part 2  Range sharding on _id (customers_range) for comparison:
//         an enumerable-key range query hits ONE shard, while the same
//         query on the hashed collection must ask EVERY shard.
// Safe to re-run: it drops and rebuilds the demo database.
// =====================================================================

const DB = "tgts_tracker";
const N = 1000;
const acc = (n) => "TGTS-" + String(n).padStart(6, "0");

// ---------------------------------------------------------------- shards
const existing = db.adminCommand({ listShards: 1 }).shards.map(s => s._id);
for (const [name, host] of [["shard1RS", "shard1RS/shard1:27017"], ["shard2RS", "shard2RS/shard2:27017"]]) {
  if (!existing.includes(name)) { sh.addShard(host); print(`added shard ${name}`); }
}

const tgts = db.getSiblingDB(DB);
tgts.dropDatabase();
sh.enableSharding(DB);

// ---------------------------------------------------------------- Part 1: hashed
print("\n=== Part 1: hashed shard key { _id: 'hashed' } on all 4 collections ===");
for (const c of ["customers", "dashboards", "alerts", "ui_configs"]) {
  sh.shardCollection(`${DB}.${c}`, { _id: "hashed" });
}

const ids = Array.from({ length: N }, (_, i) => acc(i + 1));
tgts.customers.insertMany(ids.map(id => ({ _id: id, name: `Customer ${id}`, currency: "MYR" })));
tgts.dashboards.insertMany(ids.map(id => ({ _id: id, fields: ["SHIP_STATUS", "ETA"] })));
tgts.alerts.insertMany(ids.map(id => ({ _id: id, recipients: [`${id.toLowerCase()}@example.com`] })));
tgts.ui_configs.insertMany(ids.map(id => ({ _id: id, fontName: "Inter", fontSize: 14, colorScheme: "light", preferredLanguage: "en" })));
print(`inserted ${N} accounts into each collection (${acc(1)} .. ${acc(N)})`);

// documents per shard, read directly from each shard's metadata
function perShard(coll) {
  return tgts.getCollection(coll).aggregate([
    { $collStats: { count: {} } },
    { $project: { _id: 0, shard: 1, count: "$count" } },
    { $sort: { shard: 1 } }
  ]).toArray().map(r => `${r.shard}: ${r.count}`).join("   ");
}
for (const c of ["customers", "dashboards", "alerts", "ui_configs"]) {
  print(`${c.padEnd(11)} -> ${perShard(c)}`);
}

// ---------------------------------------------------------------- Part 2: range
print("\n=== Part 2: range shard key { _id: 1 } on customers_range (for comparison) ===");
sh.shardCollection(`${DB}.customers_range`, { _id: 1 });
tgts.customers_range.insertMany(ids.map(id => ({ _id: id, name: `Customer ${id}`, currency: "MYR" })));
sh.disableBalancing(`${DB}.customers_range`);              // keep our manual layout
sh.splitAt(`${DB}.customers_range`, { _id: acc(N / 2 + 1) }); // split into 000001-000500 | 000501-001000
const primary = db.getSiblingDB("config").databases.findOne({ _id: DB }).primary;
const other = primary === "shard1RS" ? "shard2RS" : "shard1RS";
sh.moveChunk(`${DB}.customers_range`, { _id: acc(N) }, other);
print(`chunk [${acc(1)} .. ${acc(N / 2)}] on ${primary}, chunk [${acc(N / 2 + 1)} .. ${acc(N)}] on ${other}`);
print(`customers_range -> ${perShard("customers_range")}`);

// ---------------------------------------------------------------- query routing
function routing(coll, filter) {
  const wp = tgts.getCollection(coll).find(filter).explain().queryPlanner.winningPlan;
  const shards = (wp.shards || []).map(s => s.shardName);
  return `${wp.stage.padEnd(13)} shards queried: ${shards.length} (${shards.join(", ")})`;
}
const range = { _id: { $gte: acc(1), $lte: acc(100) } };
print("\n=== Query routing (explain on mongos) ===");
print(`point read  {_id: '${acc(123)}'}   hashed : ${routing("customers", { _id: acc(123) })}`);
print(`point read  {_id: '${acc(123)}'}   range  : ${routing("customers_range", { _id: acc(123) })}`);
print(`range query ${acc(1)}..${acc(100)} hashed : ${routing("customers", range)}`);
print(`range query ${acc(1)}..${acc(100)} range  : ${routing("customers_range", range)}`);
print("\nRun sh.status() for the full sharding configuration.");
