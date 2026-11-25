"""
TGTS Tracker API (FastAPI + PyMongo)

Run from the repo root:
    uvicorn api.main:app --reload --port 8000
Then open the forwarded port 8000 and go to /docs for the interactive Swagger UI.

Endpoints
    PUT    /{collection}/{account_id}   create or replace a document (upsert by _id)
    GET    /{collection}/{account_id}   point read by _id
    DELETE /{collection}/{account_id}   delete by _id
    GET    /profile/{account_id}        merged profile (customer + dashboard + alerts + UI config)
"""
import json
import os
from datetime import datetime
from pathlib import Path as FsPath
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Path, Response
from pydantic import BaseModel, Field
from pymongo import MongoClient
from pymongo.errors import WriteError

# ------------------------------------------------------------------ setup
MONGODB_URI = os.environ.get("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not set (add it as a Codespaces secret or export it)")

client = MongoClient(MONGODB_URI, tz_aware=True, appname="tgts-tracker-api")
db = client["tgts_tracker"]

ROOT = FsPath(__file__).resolve().parent.parent
FIELD_LABELS = json.loads((ROOT / "config" / "field_codes.json").read_text(encoding="utf-8"))
FieldCode = Literal[tuple(FIELD_LABELS.keys())]          # same codes as the DB validator

ACCOUNT_PATTERN = r"^TGTS-[0-9]{6}$"
AccountId = Path(..., pattern=ACCOUNT_PATTERN, examples=["TGTS-000001"],
                 description="accountNumber, used as _id in every collection")

app = FastAPI(
    title="TGTS Tracker API",
    version="1.0.0",
    description="Customer profile, dashboard, alerts and UI preferences for the TGTS "
                "shipment-tracking app. Backed by MongoDB Atlas (database `tgts_tracker`).",
)


# ------------------------------------------------------------------ request models
class Customer(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, examples=["Ridwan Aimar"])
    currency: str = Field(..., pattern=r"^[A-Z]{3}$", examples=["MYR"])


class Dashboard(BaseModel):
    fields: list[FieldCode] = Field(..., min_length=1, examples=[["SHIP_STATUS", "ETA", "CURRENT_LOCATION"]])


class Alert(BaseModel):
    recipients: list[str] = Field(..., examples=[["ridwan@example.com", "+60123456789"]])
    expiresAt: Optional[datetime] = Field(None, description="Optional. The TTL index deletes the alert after this time.",
                                          examples=["2026-12-31T00:00:00Z"])


class UiConfig(BaseModel):
    fontName: str = Field(..., min_length=1, examples=["Inter"])
    fontSize: int = Field(..., ge=8, le=32, examples=[14])
    colorScheme: Literal["light", "dark", "high-contrast"] = "light"
    preferredLanguage: str = Field("en", examples=["en"],
                                   description="Allowed values are enforced by the database validator")


# ------------------------------------------------------------------ helpers
def upsert(collection: str, account_id: str, body: BaseModel, response: Response) -> dict:
    doc = {"_id": account_id, **body.model_dump(exclude_none=True)}
    try:
        result = db[collection].replace_one({"_id": account_id}, doc, upsert=True)
    except WriteError as e:
        if e.code == 121:   # Document failed validation (JSON schema)
            raise HTTPException(422, {"error": "Document failed database validation",
                                      "details": (e.details or {}).get("errInfo")})
        raise
    created = result.upserted_id is not None
    response.status_code = 201 if created else 200
    return {"status": "created" if created else "updated", "collection": collection, "document": doc}


def read_one(collection: str, account_id: str) -> dict:
    doc = db[collection].find_one({"_id": account_id})
    if doc is None:
        raise HTTPException(404, f"{account_id} not found in {collection}")
    return doc


def delete_one(collection: str, account_id: str) -> dict:
    result = db[collection].delete_one({"_id": account_id})
    if result.deleted_count == 0:
        raise HTTPException(404, f"{account_id} not found in {collection}")
    return {"status": "deleted", "collection": collection, "_id": account_id}


# ------------------------------------------------------------------ CRUD routes
@app.put("/customers/{account_id}", tags=["customers"], status_code=200)
def put_customer(body: Customer, response: Response, account_id: str = AccountId):
    return upsert("customers", account_id, body, response)

@app.get("/customers/{account_id}", tags=["customers"])
def get_customer(account_id: str = AccountId):
    return read_one("customers", account_id)

@app.delete("/customers/{account_id}", tags=["customers"])
def del_customer(account_id: str = AccountId):
    return delete_one("customers", account_id)


@app.put("/dashboards/{account_id}", tags=["dashboards"], status_code=200)
def put_dashboard(body: Dashboard, response: Response, account_id: str = AccountId):
    return upsert("dashboards", account_id, body, response)

@app.get("/dashboards/{account_id}", tags=["dashboards"])
def get_dashboard(account_id: str = AccountId):
    return read_one("dashboards", account_id)

@app.delete("/dashboards/{account_id}", tags=["dashboards"])
def del_dashboard(account_id: str = AccountId):
    return delete_one("dashboards", account_id)


@app.put("/alerts/{account_id}", tags=["alerts"], status_code=200)
def put_alert(body: Alert, response: Response, account_id: str = AccountId):
    return upsert("alerts", account_id, body, response)

@app.get("/alerts/{account_id}", tags=["alerts"])
def get_alert(account_id: str = AccountId):
    return read_one("alerts", account_id)

@app.delete("/alerts/{account_id}", tags=["alerts"])
def del_alert(account_id: str = AccountId):
    return delete_one("alerts", account_id)


@app.put("/ui_configs/{account_id}", tags=["ui_configs"], status_code=200)
def put_ui_config(body: UiConfig, response: Response, account_id: str = AccountId):
    return upsert("ui_configs", account_id, body, response)

@app.get("/ui_configs/{account_id}", tags=["ui_configs"])
def get_ui_config(account_id: str = AccountId):
    return read_one("ui_configs", account_id)

@app.delete("/ui_configs/{account_id}", tags=["ui_configs"])
def del_ui_config(account_id: str = AccountId):
    return delete_one("ui_configs", account_id)


# ------------------------------------------------------------------ merged profile
@app.get("/profile/{account_id}", tags=["profile"])
def get_profile(account_id: str = AccountId):
    """
    Merged profile in ONE database round trip: start from the customer document
    and $lookup the dashboard, alerts and UI config that share the same _id.
    Every lookup is an equality match on _id, so each one uses the _id index.
    """
    pipeline = [
        {"$match": {"_id": account_id}},
        {"$lookup": {"from": "dashboards", "localField": "_id", "foreignField": "_id", "as": "_dash"}},
        {"$lookup": {"from": "alerts",     "localField": "_id", "foreignField": "_id", "as": "_alerts"}},
        {"$lookup": {"from": "ui_configs", "localField": "_id", "foreignField": "_id", "as": "_ui"}},
        {"$project": {
            "_id": 0,
            "accountNumber": "$_id",
            "customer": {"name": "$name", "currency": "$currency"},
            "dashboard": {"$ifNull": [{"$first": "$_dash.fields"}, []]},
            "alerts": {
                "recipients": {"$ifNull": [{"$first": "$_alerts.recipients"}, []]},
                "expiresAt": {"$first": "$_alerts.expiresAt"},
            },
            "ui": {"$ifNull": [{"$first": "$_ui"}, None]},
        }},
        {"$project": {"ui._id": 0}},
    ]
    docs = list(db.customers.aggregate(pipeline))
    if not docs:
        raise HTTPException(404, f"{account_id} not found")
    profile = docs[0]

    # Add human-readable labels for the dashboard fields in the user's language
    lang = (profile.get("ui") or {}).get("preferredLanguage", "en")
    profile["dashboardLabels"] = [FIELD_LABELS.get(code, {}).get(lang) or FIELD_LABELS.get(code, {}).get("en", code)
                                  for code in profile["dashboard"]]
    return profile


@app.get("/", include_in_schema=False)
def root():
    return {"service": "TGTS Tracker API", "docs": "/docs"}
