#!/usr/bin/env bash
# Start the local sharded cluster and initialise the replica sets.
# Run from the repo root:   bash sharding/start_cluster.sh
set -e
cd "$(dirname "$0")"

echo ">> Starting containers (first run downloads the mongo:8.0 image, ~1 min)..."
docker compose up -d

wait_for() {   # wait until a mongod/mongos on host port $1 answers ping
  for i in $(seq 1 60); do
    mongosh --quiet --port "$1" --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "Timed out waiting for port $1"; exit 1
}

init_rs() {    # $1 host port, $2 replica set name, $3 container name, $4 extra option
  wait_for "$1"
  mongosh --quiet --port "$1" --eval "
    try { rs.status(); print('$2 already initialised'); }
    catch (e) { rs.initiate({_id: '$2', $4 members: [{_id: 0, host: '$3:27017'}]}); print('$2 initiated'); }"
  for i in $(seq 1 60); do
    [ "$(mongosh --quiet --port "$1" --eval 'db.hello().isWritablePrimary')" = "true" ] && break
    sleep 2
  done
}

echo ">> Initialising replica sets..."
init_rs 27101 cfgRS    cfg1   "configsvr: true,"
init_rs 27102 shard1RS shard1 ""
init_rs 27103 shard2RS shard2 ""

echo ">> Waiting for mongos router..."
wait_for 27100
echo ">> Cluster is up. Router: mongodb://localhost:27100"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
