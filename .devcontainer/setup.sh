#!/usr/bin/env bash
set -e
echo ">> Installing mongosh..."
npm install -g mongosh
echo ">> Installing Python packages..."
pip install --upgrade pip
pip install "pymongo[srv]" fastapi "uvicorn[standard]" python-dotenv
echo ">> Done. Test with: mongosh \"\$MONGODB_URI\" --eval 'db.runCommand({ping:1})'"
