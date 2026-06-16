#!/bin/bash
# update_data.sh — Daily auto-update workflow
# 1. Fetch latest data from rohmats/antam-gold-price
# 2. Convert CSV → JSON
# 3. Retrain ML prediction models
# 4. Commit & push to GitHub → Vercel auto-deploys

set -e

PROJECT_DIR="/home/ubuntu/projects/logam-dashboard"
LOG_FILE="/tmp/logam-update.log"
PYTHON="/home/ubuntu/.hermes/hermes-agent/venv/bin/python3"

echo "=== Auto-update started: $(date) ===" >> "$LOG_FILE"

cd "$PROJECT_DIR"

# 1. Fetch latest data
echo "[1/4] Fetching latest data..." >> "$LOG_FILE"
"$PYTHON" fetch_history.py >> "$LOG_FILE" 2>&1 || {
  echo "❌ fetch_history.py failed" >> "$LOG_FILE"
  exit 1
}

# 2. Convert CSV → JSON
echo "[2/4] Building data.json..." >> "$LOG_FILE"
"$PYTHON" build_data.py >> "$LOG_FILE" 2>&1 || {
  echo "❌ build_data.py failed" >> "$LOG_FILE"
  exit 1
}

# 3. Retrain ML prediction models
echo "[3/4] Training prediction models..." >> "$LOG_FILE"
"$PYTHON" train_model.py >> "$LOG_FILE" 2>&1 || {
  echo "❌ train_model.py failed" >> "$LOG_FILE"
  exit 1
}

# 4. Commit & push if there are changes
echo "[4/4] Checking for changes..." >> "$LOG_FILE"
git add data/data.json data/predictions.json
if git diff --staged --quiet; then
  echo "   No changes, skipping push" >> "$LOG_FILE"
else
  git commit -m "Auto-update: $(date +%Y-%m-%d)" >> "$LOG_FILE" 2>&1
  git push origin main >> "$LOG_FILE" 2>&1 || {
    echo "❌ git push failed" >> "$LOG_FILE"
    exit 1
  }
  echo "✅ Pushed to GitHub, Vercel will deploy in ~30s" >> "$LOG_FILE"
fi

echo "=== Auto-update completed: $(date) ===" >> "$LOG_FILE"
