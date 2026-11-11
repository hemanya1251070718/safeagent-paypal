#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${PAYMENTS_URL:-http://localhost:5000}"
RUN_TAG="$(date +%s)"
TIER1_INTENT_ID="intent_demo_t1_${RUN_TAG}"
TIER2_INTENT_ID="intent_demo_t2_${RUN_TAG}"

echo "=== SafeAgent Payments Demo Sequence (${BASE_URL}) ==="

echo ""
echo "1. Posting Tier 1 intent (${TIER1_INTENT_ID}, total=999.98 <= 2500)..."
curl -sS -X POST "${BASE_URL}/orders/create-and-capture" \
  -H "Content-Type: application/json" \
  -d "{
    \"intentId\": \"${TIER1_INTENT_ID}\",
    \"mandateId\": \"mandate_active_001\",
    \"merchant\": \"Shopify-TechStore\",
    \"items\": [
      { \"id\": \"item_hub\", \"name\": \"USB-C Hub\", \"price\": 999.98, \"quantity\": 1 }
    ],
    \"subtotal\": 999.98,
    \"tax\": 0,
    \"total\": 999.98,
    \"currency\": \"INR\",
    \"nonce\": \"nonce_t1_${RUN_TAG}\",
    \"status\": \"VALIDATED\"
  }"
echo ""

echo ""
echo "2. Posting Tier 2 intent (${TIER2_INTENT_ID}, total=3500 > 2500)..."
curl -sS -X POST "${BASE_URL}/orders/create-and-capture" \
  -H "Content-Type: application/json" \
  -d "{
    \"intentId\": \"${TIER2_INTENT_ID}\",
    \"mandateId\": \"mandate_active_001\",
    \"merchant\": \"Croma-Retail\",
    \"items\": [
      { \"id\": \"item_kbd\", \"name\": \"Mechanical Keyboard\", \"price\": 3000, \"quantity\": 1 }
    ],
    \"subtotal\": 3000,
    \"tax\": 500,
    \"total\": 3500,
    \"currency\": \"INR\",
    \"nonce\": \"nonce_t2_${RUN_TAG}\",
    \"status\": \"VALIDATED\"
  }"
echo ""

echo ""
echo "3. Posting duplicate Tier 1 intent (${TIER1_INTENT_ID} - expect IDEMPOTENT_REPLAY)..."
curl -sS -X POST "${BASE_URL}/orders/create-and-capture" \
  -H "Content-Type: application/json" \
  -d "{
    \"intentId\": \"${TIER1_INTENT_ID}\",
    \"mandateId\": \"mandate_active_001\",
    \"merchant\": \"Shopify-TechStore\",
    \"items\": [
      { \"id\": \"item_hub\", \"name\": \"USB-C Hub\", \"price\": 999.98, \"quantity\": 1 }
    ],
    \"subtotal\": 999.98,
    \"tax\": 0,
    \"total\": 999.98,
    \"currency\": \"INR\",
    \"nonce\": \"nonce_t1_${RUN_TAG}\",
    \"status\": \"VALIDATED\"
  }"
echo ""

echo ""
echo "4. Posting simulated PayPal webhook for ${TIER1_INTENT_ID}..."
curl -sS -X POST "${BASE_URL}/webhooks/paypal" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"WH-DEMO-${RUN_TAG}\",
    \"event_type\": \"PAYMENT.CAPTURE.COMPLETED\",
    \"intentId\": \"${TIER1_INTENT_ID}\",
    \"mandateId\": \"mandate_active_001\",
    \"resource\": {
      \"id\": \"CAP-DEMO-${RUN_TAG}\",
      \"status\": \"COMPLETED\"
    }
  }"
echo ""

echo ""
echo "5. Checking ledger integrity via GET /ledger/verify..."
curl -sS "${BASE_URL}/ledger/verify"
echo ""
