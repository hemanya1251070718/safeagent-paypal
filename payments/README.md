# SafeAgent: Payments, Ledger & Telemetry Layer (P4)
**Owner:** Person 4 (Payments & Settlement Lead)  
**Role:** Money Movement, PayPal Developer Sandbox, and Tamper-Evident Ledger

---

## 1. What This Layer Does
This layer communicates with PayPal's payment rails (Orders v2 + Vault zero-touch capture with `STANDARD_CAPTURE` fallback), verifies webhook signatures, enforces idempotency, builds SHA-256 Merkle dispute packages, maintains an append-only hash-chained audit ledger, and broadcasts real-time Server-Sent Events (SSE) to P1's AG Grid dashboard.

When PayPal credentials are empty or placeholders, the service runs in **high-fidelity simulation mode** by default.

---

## 2. Directory Structure
```text
/payments
├── scripts/
│   └── demo-sequence.sh      # Posts Tier 1, Tier 2, duplicate, and webhook events
├── src/
│   ├── paypalClient.ts       # PayPal OAuth2, Orders v2, Vault path, currency guard, webhooks
│   ├── ledger.ts             # Append-only SHA-256 hash-chained ledger + Merkle root builder
│   └── server.ts             # Express REST & SSE service (Port 5000)
├── tests/
│   ├── ledger.test.ts        # Ledger tamper detection & Merkle root determinism
│   ├── paypalClient.test.ts  # Amount/GST reconciliation, Tier 1/2, live fallback, webhooks
│   └── server.test.ts        # Validation, idempotency, webhooks, Merkle package, SSE
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. Environment Variables
Copy `.env.example` to `.env` (never commit `.env` or real secrets):

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

## 4. Simulation Mode vs. Live PayPal Sandbox Setup

### Simulation Mode (Default)
Whenever `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET` is empty or left as the `.env.example` placeholder:
- No external PayPal API calls are made.
- Original currency (e.g., `INR`) is preserved.
- Tier 1 orders (`total <= TIER1_LIMIT`) return `settlementPath: "VAULT_ZERO_TOUCH"` with `vaultStatus: "SIMULATED"`.
- Tier 2 orders (`total > TIER1_LIMIT`) return `settlementPath: "STANDARD_CAPTURE"`.
- Simulated settlements are sandbox/demo mocks and **not** real PayPal transactions.

### Live PayPal Sandbox Setup
> **Verification Status:** Live PayPal Sandbox end-to-end transactions have **not yet been verified** against PayPal's remote servers. Automated tests use mocked PayPal HTTP responses, and local runs default to simulation mode unless valid sandbox credentials are supplied.

1. Log into the PayPal Developer Dashboard (`https://developer.paypal.com/`) -> **Apps & Credentials** -> **Sandbox** -> create/open a Merchant REST App.
2. Copy the **Client ID** and **Client Secret** into `/payments/.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`) with `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`.
3. *(Optional Tier 1 Zero-Touch)* Vault a buyer PayPal payment method via PayPal Vault v3 and set `PAYPAL_VAULT_ID`. If the live Vault path fails, the service logs a warning (without emitting `SECURITY_ALERT`) and falls back to `STANDARD_CAPTURE`.
4. *(Currency Guard)* PayPal REST Orders v2 does not support `INR` in live mode; the service automatically converts `INR` line items, 18% GST tax, and total to `USD` using `INR_TO_USD` (default `0.012`), reconciles to 2 decimal places, and records `originalCurrency` and `originalAmount` in the response.

### Webhook Registration and Verification
1. Expose `/webhooks/paypal` over HTTPS (e.g. Render or `ngrok http 5000`).
2. In your PayPal Sandbox App settings, add a Webhook pointing to `https://<your-domain>/webhooks/paypal` and subscribe to `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`.
3. Set `PAYPAL_WEBHOOK_ID` in `/payments/.env` to the generated Webhook ID.
4. Verification behavior:
   - **Live (`PAYPAL_WEBHOOK_ID` + credentials set):** Captures raw request bytes and verifies the 5 `PAYPAL-*` signature headers (`PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`) via `POST /v1/notifications/verify-webhook-signature`. Returns `401` and logs a `SECURITY_ALERT` event on failure.
   - **Simulation (`PAYPAL_WEBHOOK_ID` unset/placeholder):** Skips cryptographic signature verification (`verification: "SIMULATED_SKIPPED"` — **not** cryptographic verification) and accepts the payload with `200` for local demo convenience.
   - **Event handling scope:** This hackathon handler records `WEBHOOK_VERIFIED` and `SETTLED` for demo capture webhooks such as `PAYMENT.CAPTURE.COMPLETED`; not every PayPal webhook event type represents a settled payment, so production deployments should filter on verified settlement events (e.g. `PAYMENT.CAPTURE.COMPLETED`) before marking orders settled.

---

## 5. How to Run & Test
```bash
npm install
npm run build
npm run dev      # development (tsx)
npm start        # production (node dist/server.js)
npm test         # runs Vitest suite (mocked PayPal HTTP, no credentials needed)
bash scripts/demo-sequence.sh
```

---

## 6. API Routes (`http://localhost:5000`)

| Method & Path | Purpose |
| :--- | :--- |
| `GET /health` | Service health and ledger event count |
| `GET /ledger/stream` | CORS-safe SSE telemetry stream (`: ping` heartbeat every 15s) |
| `GET /ledger/events` | Retrieve all ledger events and chain integrity boolean |
| `GET /ledger/verify` | Verify SHA-256 hash chain (`{ valid, eventCount, headHash }`) |
| `POST /orders/create-and-capture` | Validate intent, enforce idempotency, reconcile amounts/GST, settle Tier 1/Tier 2 order |
| `POST /webhooks/paypal` | Raw-body PayPal webhook listener; verifies signature when `PAYPAL_WEBHOOK_ID` is set (skipped in simulation mode) and logs webhook/settlement events |
| `GET /disputes/:intentId/package` | Export `MerkleDisputePackage` for a settled intent (`404` if unsettled) |

*(Note: The root `postman_collection.json` currently includes `/ledger/events` and `/webhooks/paypal`; use the requests below to test all P4 endpoints in Postman or `curl`.)*

---

## 7. Example Requests & Responses

### Health Check
```bash
curl -sS http://localhost:5000/health
```
```json
{
  "status": "healthy",
  "service": "SafeAgent Payments & Ledger Service (P4)",
  "ledgerEventsCount": 1
}
```

### Order Creation and Capture (`POST /orders/create-and-capture`)
```bash
curl -sS -X POST http://localhost:5000/orders/create-and-capture \
  -H "Content-Type: application/json" \
  -d '{
    "intentId": "intent_001",
    "mandateId": "mandate_active_001",
    "merchant": "Shopify-TechStore",
    "items": [{ "id": "i1", "name": "USB-C Hub", "price": 1000, "quantity": 1 }],
    "subtotal": 1000,
    "tax": 180,
    "total": 1180,
    "currency": "INR",
    "nonce": "n1",
    "status": "VALIDATED"
  }'
```
Example response (simulation mode, Tier 1):
```json
{
  "mode": "SIMULATED_SANDBOX",
  "tier": 1,
  "settlementPath": "VAULT_ZERO_TOUCH",
  "vaultStatus": "SIMULATED",
  "orderId": "SANDBOX-ORD-1794403700991-1",
  "captureId": "SANDBOX-CAP-1794403700991-1",
  "status": "COMPLETED",
  "amount": 1180,
  "currency": "INR",
  "merchant": "Shopify-TechStore"
}
```
Replaying the same `intentId` returns the cached settlement without double-capturing and appends a `PAYPAL_CAPTURE_COMPLETED` event with `"detail": "IDEMPOTENT_REPLAY"`. Invalid payloads return `400`.

### Webhook Ingestion (`POST /webhooks/paypal`)
```bash
curl -sS -X POST http://localhost:5000/webhooks/paypal \
  -H "Content-Type: application/json" \
  -d '{
    "id": "WH-001",
    "event_type": "PAYMENT.CAPTURE.COMPLETED",
    "intentId": "intent_001",
    "resource": { "id": "CAP-001", "status": "COMPLETED" }
  }'
```
Example response (simulation mode):
```json
{
  "received": true,
  "verified": true,
  "verification": "SIMULATED_SKIPPED",
  "webhookEventId": "evt_1794403701024_6",
  "settledEventId": "evt_1794403701024_7"
}
```

### Ledger Verification & Events (`GET /ledger/verify`, `GET /ledger/events`, `GET /ledger/stream`)
```bash
curl -sS http://localhost:5000/ledger/verify
```
```json
{
  "valid": true,
  "eventCount": 8,
  "headHash": "132cb277524397d9829806ecd6744deef4a125bd4c6afb5b048a50404126cdde"
}
```

### Dispute Package (`GET /disputes/:intentId/package`)
The exported `MerkleDisputePackage` provides **SHA-256 hash-chain and Merkle evidence** (`ledgerProofChain` and a SHA-256 `merkleRoot` computed over the intent's ledger event hashes). **ML-DSA signing is not implemented yet in this service**: unless `mlDsaSignatureHex` and `publicKeyHex` are forwarded by the caller during settlement, those fields are populated with clearly labelled placeholders (`PLACEHOLDER_UNAVAILABLE_ML_DSA_SIGNATURE_HEX` and `PLACEHOLDER_UNAVAILABLE_PUBLIC_KEY_HEX`).

```bash
curl -sS http://localhost:5000/disputes/intent_001/package
```
Example response (`200` for settled intents, `404` otherwise):
```json
{
  "disputeId": "DSP-intent_001-1794403717009",
  "intentId": "intent_001",
  "mandateId": "mandate_active_001",
  "mlDsaSignatureHex": "PLACEHOLDER_UNAVAILABLE_ML_DSA_SIGNATURE_HEX",
  "publicKeyHex": "PLACEHOLDER_UNAVAILABLE_PUBLIC_KEY_HEX",
  "paypalOrderId": "SANDBOX-ORD-1794403700991-1",
  "paypalCaptureId": "SANDBOX-CAP-1794403700991-1",
  "ledgerProofChain": [
    { "index": 1, "hash": "...", "type": "PAYPAL_ORDER_CREATED", "timestamp": "..." },
    { "index": 2, "hash": "...", "type": "PAYPAL_CAPTURE_COMPLETED", "timestamp": "..." }
  ],
  "merkleRoot": "ddaf06b991a268ee8c67272ad6209f83fb470444c53de808ecacf8c3884f3fd9",
  "generatedAt": "2026-11-11T13:28:37.009Z"
}
```
