# TGTS Tracker – MongoDB Implementation

**Course:** OAS5063 Data Management, Universiti Teknologi PETRONAS
**Student:** Ridwan Aimar (26002846)

Backend data layer for the TGTS shipment-tracking mobile app. Each customer account has a
**profile**, a **dashboard selection**, **alerts** and **UI preferences**. The workload is
read-heavy (~90% reads, up to 10,000 concurrent users), so every access path is a point
read on the account number.

| Component | Technology |
|---|---|
| Database | MongoDB Atlas (free M0 cluster, MongoDB 8.0, 3-node replica set, AWS Singapore) |
| Scripts | `mongosh` (JavaScript) |
| API | Python 3.12 + FastAPI + PyMongo |
| Sharding demo | Local sharded cluster in Docker (MongoDB 8.0: config server + 2 shards + mongos) |
| Dev environment | GitHub Codespaces (same environment from Windows and macOS) |

---

## 1. Repository layout

```
tgts-tracker/
├── .devcontainer/              Codespaces config (Python, Node, Docker, mongosh, pymongo)
├── config/
│   └── field_codes.json        Allowed dashboard field codes + labels (en, ms, zh) – single source of truth
├── scripts/                    mongosh scripts, run in this order
│   ├── 01_setup.js             database, 4 collections, $jsonSchema validators, TTL index
│   ├── 02_seed.js              10 sample accounts in all 4 collections (upsert by _id)
│   ├── 03_validation_test.js   proves invalid documents are rejected (error 121)
│   ├── 04_aggregation.js       dashboard labels + alert count; field usage report
│   ├── 05_ttl_demo.js          alert that expires after 60 s, before/after evidence
│   ├── 06_explain_point_reads.js  explain(): _id lookups use the _id index
│   └── 07_language_extension.js   Q9: preferredLanguage extended with "zh"
├── api/
│   ├── main.py                 FastAPI app (CRUD by id, /profile/{id}, /reports/dashboard-summary)
│   └── requirements.txt
├── samples/
│   ├── sample_calls.sh         curl examples for every endpoint
│   └── pipeline_dashboard_summary.json   aggregation pipeline (paste into Compass)
├── sharding/
│   ├── docker-compose.yml      local sharded cluster
│   ├── start_cluster.sh        starts containers and initialises replica sets
│   └── shard_setup.js          hashed vs range sharding demo + query routing
└── screenshots/                evidence of execution (S01–S09)
```

---

## 2. Data model

All four collections use the **account number as `_id`**, in the format `TGTS-` + 6 digits
(e.g. `TGTS-000001`). Zero-padding keeps keys fixed-length and **enumerable**, so string order
matches numeric order and range queries work.

| Collection | Fields | Validation highlights |
|---|---|---|
| `customers` | `_id`, `name`, `currency` | `_id` pattern `^TGTS-[0-9]{6}$`; `currency` = 3-letter ISO code |
| `dashboards` | `_id`, `fields[]` | each item must be one of the **10 defined field codes**; unique; 1–10 items |
| `alerts` | `_id`, `recipients[]`, `expiresAt?` | `expiresAt` optional `date`; TTL index deletes the alert when it is reached |
| `ui_configs` | `_id`, `fontName`, `fontSize`, `colorScheme`, `preferredLanguage` | `fontSize` 8–32; `colorScheme` light / dark / high-contrast; `preferredLanguage` = languages present in `field_codes.json` |

**Field codes:** `SHIP_STATUS`, `CURRENT_LOCATION`, `ETA`, `LAST_SCAN`, `ORIGIN`, `DESTINATION`,
`CARRIER`, `WEIGHT`, `PROOF_OF_DELIVERY`, `DELIVERY_EXCEPTIONS`

**Indexes**
- `alerts`: `ttl_expiresAt` → `{ expiresAt: 1 }, { expireAfterSeconds: 0 }`
- every collection: the built-in unique `_id` index (used for all point reads)

Example merged profile (`GET /profile/TGTS-000002`):
```json
{
  "accountNumber": "TGTS-000002",
  "customer": { "name": "Nur Aisyah Logistics", "currency": "MYR" },
  "dashboard": ["SHIP_STATUS", "LAST_SCAN", "DESTINATION", "PROOF_OF_DELIVERY"],
  "alerts": { "recipients": ["ops@nuraisyah.my"] },
  "ui": { "fontName": "Roboto", "fontSize": 16, "colorScheme": "light", "preferredLanguage": "ms" },
  "dashboardLabels": ["Status Penghantaran", "Imbasan Terakhir", "Destinasi", "Bukti Penghantaran"]
}
```

---

## 3. Setup

### 3.1 MongoDB Atlas
1. Create a free **M0** cluster (any region), a database user, and allow network access
   (`0.0.0.0/0` for a demo; restrict it in production).
2. Copy the connection string: `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/`

### 3.2 Option A – GitHub Codespaces (recommended)
1. GitHub → **Settings → Codespaces → Secrets → New secret**
   `MONGODB_URI` = your Atlas connection string, with access to this repository.
2. **Code → Codespaces → Create codespace on main.** The dev container installs mongosh,
   pymongo, FastAPI and Docker automatically.
3. Check the connection:
   ```bash
   mongosh "$MONGODB_URI" --quiet --eval 'db.runCommand({ping:1})'
   ```

### 3.3 Option B – local machine (Windows / macOS / Linux)
Install Python 3.10+, [mongosh](https://www.mongodb.com/try/download/shell) and (for the
sharding demo) Docker Desktop, then:
```bash
pip install -r api/requirements.txt
export MONGODB_URI="mongodb+srv://..."          # PowerShell: $env:MONGODB_URI="mongodb+srv://..."
```

> The connection string is **never** stored in this repository.

---

## 4. Running the scripts

Run from the repository root (the scripts read `config/field_codes.json`):

```bash
mongosh "$MONGODB_URI" --quiet --file scripts/01_setup.js              # create / refresh schema + indexes
mongosh "$MONGODB_URI" --quiet --file scripts/02_seed.js               # load 10 sample accounts
mongosh "$MONGODB_URI" --quiet --file scripts/03_validation_test.js    # 5 rejected, 1 accepted
mongosh "$MONGODB_URI" --quiet --file scripts/04_aggregation.js        # labels + alert counts
mongosh "$MONGODB_URI" --quiet --file scripts/05_ttl_demo.js           # ~1.5–3 min
mongosh "$MONGODB_URI" --quiet --file scripts/06_explain_point_reads.js
mongosh "$MONGODB_URI" --quiet --file scripts/07_language_extension.js # Q9 demo
```

All scripts are safe to re-run (`01` refreshes validators, `02` uses upserts).

**TTL timing:** MongoDB's TTL monitor runs about every 60 seconds, so an expired alert is
removed up to ~60 s *after* `expiresAt`, not at the exact second. In testing, deletion
happened 15 s and 60 s after expiry.

---

## 5. API

### Start
```bash
uvicorn api.main:app --reload --port 8000
```
Interactive documentation (Swagger UI): `http://localhost:8000/docs`
(in Codespaces: **Ports** tab → port 8000 → open in browser → add `/docs`).

### Endpoints

| Method | Path | Description |
|---|---|---|
| `PUT` | `/customers/{id}` | create (201) or replace (200) a customer |
| `PUT` | `/dashboards/{id}` | create / replace a dashboard (field codes validated) |
| `PUT` | `/alerts/{id}` | create / replace alerts (`expiresAt` optional) |
| `PUT` | `/ui_configs/{id}` | create / replace UI preferences |
| `GET` | `/{collection}/{id}` | point read by `_id` |
| `DELETE` | `/{collection}/{id}` | delete by `_id` |
| `GET` | `/profile/{id}` | **merged profile** – one `$lookup` aggregation, labels in the user's language |
| `GET` | `/reports/dashboard-summary[?account_id=]` | **aggregation** – dashboard labels + alert count per account |

Invalid input returns **422** (checked by Pydantic first, then by the database validator);
unknown accounts return **404**.

### Sample calls
```bash
bash samples/sample_calls.sh            # full walkthrough (create, update, read, errors)
```
```bash
# create / update
curl -X PUT http://localhost:8000/customers/TGTS-000011 \
     -H "Content-Type: application/json" -d '{"name": "Planetarium Gift Shop", "currency": "MYR"}'
curl -X PUT http://localhost:8000/dashboards/TGTS-000011 \
     -H "Content-Type: application/json" -d '{"fields": ["SHIP_STATUS", "ETA", "PROOF_OF_DELIVERY"]}'
curl -X PUT http://localhost:8000/alerts/TGTS-000011 \
     -H "Content-Type: application/json" -d '{"recipients": ["shop@example.my"], "expiresAt": "2026-12-31T23:59:59Z"}'
curl -X PUT http://localhost:8000/ui_configs/TGTS-000011 \
     -H "Content-Type: application/json" -d '{"fontName": "Roboto", "fontSize": 16, "colorScheme": "light", "preferredLanguage": "ms"}'

# read
curl http://localhost:8000/profile/TGTS-000011
curl "http://localhost:8000/reports/dashboard-summary?account_id=TGTS-000011"

# rejected (422): unknown field code
curl -X PUT http://localhost:8000/dashboards/TGTS-000011 \
     -H "Content-Type: application/json" -d '{"fields": ["PRICE"]}'
```

---

## 6. Aggregation

`scripts/04_aggregation.js` (and `GET /reports/dashboard-summary`):

`$lookup` (dashboards, alerts, ui_configs on `_id`) → `$set` → `$project` with `$map` +
`$getField` (field code → label in `preferredLanguage`, falling back to English) and `$size`
(alert count) → `$sort`.

A second pipeline (`$unwind` → `$group` → `$sort`) counts how many dashboards use each field.

---

## 7. Sharding demo (bonus)

Proposed shard key: **`{ _id: "hashed" }`** on all four collections. Every request is a point
read or write on the account number, so hashing spreads load evenly while each lookup still
goes to exactly one shard.

```bash
bash sharding/start_cluster.sh                                       # config server + 2 shards + mongos
mongosh --quiet --port 27100 --file sharding/shard_setup.js          # hashed vs range demo
mongosh --quiet --port 27100 --eval 'sh.status()'                    # sharding configuration
docker compose -f sharding/docker-compose.yml down                   # stop
```

Results (1,000 accounts):

| | Hashed `{_id: "hashed"}` | Range `{_id: 1}` |
|---|---|---|
| Distribution | 521 / 479 across 2 shards | 500 / 500 (after manual split at `TGTS-000501`) |
| Point read by `_id` | 1 shard (`SINGLE_SHARD`) | 1 shard (`SINGLE_SHARD`) |
| Range `TGTS-000001..000100` | 2 shards (`SHARD_MERGE`) | 1 shard (`SINGLE_SHARD`) |

The Atlas free tier does not support sharding (it needs M30 or above), so the demo runs locally
in Docker.

---

## 8. Evidence

All screenshots are in [`screenshots/`](screenshots/):

| # | Evidence |
|---|---|
| S01 | Atlas cluster |
| S02 | Codespace + Compass connected |
| S03 | Setup output, `dashboards` JSON schema, `alerts` TTL index |
| S04 | Seed output, validation rejections, each collection populated |
| S05 | Merged profile (Swagger), sample calls |
| S06 | Aggregation output (shell, API, Compass) |
| S07 | `explain()` point reads, TTL before/after (Compass + shell) |
| S08 | Sharded cluster, hashed vs range routing, `sh.status()` |
| S09 | `preferredLanguage` extended with `zh` (Q9) |
