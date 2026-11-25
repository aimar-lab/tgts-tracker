// =====================================================================
// 01_setup.js  -  TGTS Tracker: database, collections, validation, indexes
// Run:  mongosh "$MONGODB_URI" --file scripts/01_setup.js
// Safe to re-run: existing collections are updated, not dropped.
// =====================================================================

const fs = require("fs");
const DB_NAME = "tgts_tracker";
const tgts = db.getSiblingDB(DB_NAME);

// Single source of truth for dashboard field codes (also used by the API)
const FIELD_CODES = Object.keys(JSON.parse(fs.readFileSync("config/field_codes.json", "utf8")));

// accountNumber is the _id everywhere: "TGTS-" + 6 digits, e.g. TGTS-000001
const ACCOUNT_ID = { bsonType: "string", pattern: "^TGTS-[0-9]{6}$",
                     description: "accountNumber, format TGTS-000001" };

// ---------------- JSON schema validators ----------------
const validators = {
  customers: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "name", "currency"],
      properties: {
        _id: ACCOUNT_ID,
        name: { bsonType: "string", minLength: 1, maxLength: 100 },
        currency: { bsonType: "string", pattern: "^[A-Z]{3}$",
                    description: "ISO 4217 code, e.g. MYR, USD, SGD" }
      }
    }
  },

  // Brief requirement: fields[] may only contain defined field codes
  dashboards: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "fields"],
      properties: {
        _id: ACCOUNT_ID,
        fields: {
          bsonType: "array",
          minItems: 1,
          maxItems: FIELD_CODES.length,
          uniqueItems: true,
          items: { bsonType: "string", enum: FIELD_CODES },
          description: "Only defined field codes are allowed: " + FIELD_CODES.join(", ")
        }
      }
    }
  },

  alerts: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "recipients"],
      properties: {
        _id: ACCOUNT_ID,
        recipients: {
          bsonType: "array",
          items: { bsonType: "string", minLength: 3 },
          description: "email addresses or phone numbers to notify"
        },
        expiresAt: { bsonType: "date",
                     description: "optional; when set, the TTL index deletes the alert after this time" }
      }
    }
  },

  ui_configs: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "fontName", "fontSize", "colorScheme", "preferredLanguage"],
      properties: {
        _id: ACCOUNT_ID,
        fontName: { bsonType: "string", minLength: 1 },
        fontSize: { bsonType: ["int", "long", "double"], minimum: 8, maximum: 32 },
        colorScheme: { enum: ["light", "dark", "high-contrast"] },
        preferredLanguage: { enum: ["en", "ms"],
                             description: "ISO 639-1 code; extended in the Q9 demo" }
      }
    }
  }
};

// ---------------- create or update collections ----------------
const existing = tgts.getCollectionNames();
for (const [name, validator] of Object.entries(validators)) {
  const opts = { validator, validationLevel: "strict", validationAction: "error" };
  if (existing.includes(name)) {
    tgts.runCommand({ collMod: name, ...opts });
    print(`updated   ${name} (validator refreshed)`);
  } else {
    tgts.createCollection(name, opts);
    print(`created   ${name}`);
  }
}

// ---------------- indexes ----------------
// 1) TTL index (mandatory). expireAfterSeconds: 0 => delete when expiresAt is reached.
//    Alerts without expiresAt are never removed.
tgts.alerts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expiresAt" });
print("index     alerts.ttl_expiresAt (TTL, expireAfterSeconds: 0)");

// 2) Point-read indexes on _id: MongoDB creates a unique _id index on every
//    collection automatically, and it cannot be dropped or re-created.
//    We only verify that it exists.
print("\n--- Index check ---");
for (const name of Object.keys(validators)) {
  const idx = tgts.getCollection(name).getIndexes()
    .map(i => `${i.name} ${JSON.stringify(i.key)}` + (i.expireAfterSeconds !== undefined ? ` TTL=${i.expireAfterSeconds}s` : ""));
  print(`${name.padEnd(11)} -> ${idx.join(" | ")}`);
}

print(`\nDone. Database '${DB_NAME}' is ready with ${Object.keys(validators).length} collections.`);
print("Allowed dashboard field codes: " + FIELD_CODES.join(", "));
