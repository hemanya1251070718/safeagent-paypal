#!/bin/bash
echo "=========================================================="
echo "  🚀 Launching SafeAgent Full Stack Console (4 Services)  "
echo "=========================================================="

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Start Policy Gateway (P3) on Port 3000
echo "[1/4] Starting Policy Gateway (Port 3000)..."
(cd "$BASE_DIR/gateway" && npm run dev) &

# 2. Start Payments & Telemetry (P4) on Port 5000
echo "[2/4] Starting Payments & Telemetry Service (Port 5000)..."
(cd "$BASE_DIR/payments" && npm run dev) &

# 3. Start Cognitive Agent (P2) on Port 4001
echo "[3/4] Starting Cognitive Agent (Port 4001)..."
(cd "$BASE_DIR/agent" && npm run dev) &

# 4. Start React Frontend (P1) on Port 5173
echo "[4/4] Starting React & AG Grid Frontend (Port 5173)..."
(cd "$BASE_DIR/client" && npm run dev) &

echo -e "\n✔ All 4 services started!"
echo "Open SafeAgent Operating Console at: http://localhost:5173"
wait

