# SafeAgent: Payments, Ledger & Telemetry Layer (P4)
**Owner:** Person 4 (Payments & Settlement Lead)  
**Role:** Money Movement, PayPal Developer Sandbox, and Tamper-Evident Ledger

---

## 1. What This Layer Does
This layer communicates with PayPal's payment rails (Orders v2 + Vault zero-touch capture with `STANDARD_CAPTURE` fallback), verifies webhook signatures, enforces idempotency, builds SHA-256 Merkle dispute packages, maintains an append-only hash-chained audit ledger, and broadcasts real-time Server-Sent Events (SSE) to P1's AG Grid dashboard.

When PayPal credentials are empty or placeholders, the service runs in **high-fidelity simulation mode** by default.

---

## 2. Directory Structure
```
/payments
├── scripts/
│   └── demo-sequence.sh      # Posts Tier 1, Tier 2, duplicate, and webhook events
├── src/
│   ├── paypalClient.ts       # PayPal OAuth2, Orders v2, Vault path, currency guard, webhooks
│   ├── ledger.ts             # Append-only SHA-256 hash-chained ledger + Merkle root builder
│   └── server.ts             # Express REST & SSE service (Port 5000)
├── tests/
│   └── ledger.test.ts        # Vitest suite (ledger tamper detection & Merkle determinism)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. Environment Variables
Copy `.env.example` to `.env` and customize as needed:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `5000` | HTTP server port |
| `NODE_ENV` | `development` | Node environment |
| `PAYPAL_MODE` | `sandbox` | PayPal environment mode (`sandbox` or `live`) |
| `PAYPAL_CLIENT_ID` | `""` | PayPal REST app Client ID (empty/placeholder = simulation mode) |
| `PAYPAL_CLIENT_SECRET` | `""` | PayPal REST app Client Secret (empty/placeholder = simulation mode) |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` | PayPal API base URL |
| `PAYPAL_WEBHOOK_ID` | `""` | PayPal Webhook ID (empty/placeholder = `SIMULATED_SKIPPED`) |
| `PAYPAL_VAULT_ID` | `""` | PayPal Vault ID for Tier 1 `VAULT_ZERO_TOUCH` live settlement |
| `TIER1_LIMIT` | `2500` | Tier 1 auto-settlement limit (`PAYPAL_TIER1_LIMIT` also supported) |
| `INR_TO_USD` | `0.012` | Conversion rate for unsupported live currencies (e.g., `INR` -> `USD`) |

---

## 4. How to Run & Test
```bash
npm install
npm run build
npm run dev      # development (tsx)
npm start        # production (node dist/server.js)
npm test         # runs vitest tests
./scripts/demo-sequence.sh
```

---

## 5. API Routes (`http://localhost:5000`)
* `GET /health` - Service health and ledger event count
* `GET /ledger/stream` - CORS-safe SSE stream powering P1's live AG Grid (`: ping` heartbeat every 15s)
* `GET /ledger/events` - Retrieve full ledger and integrity status
* `GET /ledger/verify` - Verify hash-chain integrity (`{ valid, eventCount, headHash }`)
* `POST /orders/create-and-capture` - Validates intent, enforces idempotency, reconciles amounts, routes Tier 1 (`VAULT_ZERO_TOUCH`) vs Tier 2 (`STANDARD_CAPTURE`), and settles order
* `POST /webhooks/paypal` - Captures raw body, verifies PayPal webhook signature (or `SIMULATED_SKIPPED`), logs `WEBHOOK_VERIFIED` + `SETTLED` (or `401` + `SECURITY_ALERT` on failure)
* `GET /disputes/:intentId/package` - Exports `MerkleDisputePackage` for a settled intent (`404` if not settled)

### Example `curl` Commands
```bash
# Health check
curl -sS http://localhost:5000/health

# Create and capture Tier 1 order
curl -sS -X POST http://localhost:5000/orders/create-and-capture \
  -H "Content-Type: application/json" \
  -d '{"intentId":"intent_001","mandateId":"mandate_active_001","merchant":"Shopify-TechStore","items":[{"id":"i1","name":"USB-C Hub","price":999.98,"quantity":1}],"subtotal":999.98,"tax":0,"total":999.98,"currency":"INR","nonce":"n1","status":"VALIDATED"}'

# Verify ledger hash-chain
curl -sS http://localhost:5000/ledger/verify

# Export Merkle dispute package
curl -sS http://localhost:5000/disputes/intent_001/package

# Simulate PayPal webhook
curl -sS -X POST http://localhost:5000/webhooks/paypal \
  -H "Content-Type: application/json" \
  -d '{"id":"WH-001","event_type":"PAYMENT.CAPTURE.COMPLETED","intentId":"intent_001","resource":{"id":"CAP-001","status":"COMPLETED"}}'
```

