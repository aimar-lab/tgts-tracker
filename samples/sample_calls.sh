#!/usr/bin/env bash
# =====================================================================
# Sample API calls for the TGTS Tracker API
# Start the API first:   uvicorn api.main:app --reload --port 8000
# Then run:              bash samples/sample_calls.sh
# =====================================================================
BASE="${BASE:-http://localhost:8000}"
ID="TGTS-000011"
show() { echo; echo "### $1"; }

show "1. CREATE customer $ID (expect 201 created)"
curl -s -X PUT "$BASE/customers/$ID" -H "Content-Type: application/json" \
     -d '{"name": "Planetarium Gift Shop", "currency": "MYR"}' | python3 -m json.tool

show "2. CREATE dashboard"
curl -s -X PUT "$BASE/dashboards/$ID" -H "Content-Type: application/json" \
     -d '{"fields": ["SHIP_STATUS", "ETA", "PROOF_OF_DELIVERY"]}' | python3 -m json.tool

show "3. CREATE alerts (with expiresAt)"
curl -s -X PUT "$BASE/alerts/$ID" -H "Content-Type: application/json" \
     -d '{"recipients": ["shop@example.my", "+60111222333"], "expiresAt": "2026-12-31T23:59:59Z"}' | python3 -m json.tool

show "4. CREATE ui_config"
curl -s -X PUT "$BASE/ui_configs/$ID" -H "Content-Type: application/json" \
     -d '{"fontName": "Roboto", "fontSize": 16, "colorScheme": "light", "preferredLanguage": "ms"}' | python3 -m json.tool

show "5. UPDATE customer (same PUT again -> expect 200 updated)"
curl -s -X PUT "$BASE/customers/$ID" -H "Content-Type: application/json" \
     -d '{"name": "Planetarium Negara Gift Shop", "currency": "MYR"}' | python3 -m json.tool

show "6. READ merged profile"
curl -s "$BASE/profile/$ID" | python3 -m json.tool

show "7. INVALID dashboard field code -> expect 422"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X PUT "$BASE/dashboards/$ID" -H "Content-Type: application/json" \
     -d '{"fields": ["SHIP_STATUS", "PRICE"]}'

show "8. INVALID account number -> expect 422"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$BASE/profile/ACC-1"

show "9. UNKNOWN account -> expect 404"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$BASE/profile/TGTS-999999"
