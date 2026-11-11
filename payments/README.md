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

### Live PayPal Sandbox Setup & Switching Modes
> **Verification Status:** Live PayPal Sandbox end-to-end transactions have **not yet been verified** against PayPal's remote servers. Automated tests use mocked PayPal HTTP responses, and local runs default to simulation mode unless valid sandbox credentials are supplied.

#### Required Sandbox Environment Variables
Set these in `/payments/.env` (copied from `.env.example`; never commit `.env` or real credentials):
- `PAYPAL_MODE=sandbox`
- `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`
- `PAYPAL_CLIENT_ID=<your_sandbox_rest_app_client_id>`
- `PAYPAL_CLIENT_SECRET=<your_sandbox_rest_app_client_secret>`
- `PAYPAL_WEBHOOK_ID=<your_sandbox_webhook_id>` (required for cryptographic webhook verification via PayPal's API)
- Optional: `PAYPAL_VAULT_ID=<vaulted_payment_token>` (Tier 1 live vault capture), `TIER1_LIMIT=2500`, `INR_TO_USD=0.012`

#### Obtaining & Configuring Credentials
1. Log into the PayPal Developer Dashboard (`https://developer.paypal.com/`) -> **Apps & Credentials** -> **Sandbox** -> create/open a Merchant REST App.
2. Copy the **Client ID** and **Client Secret** into `/payments/.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`) with `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`.
3. *(Optional Tier 1 Zero-Touch)* Vault a buyer PayPal payment method via PayPal Vault v3 and set `PAYPAL_VAULT_ID`. If the live Vault path fails, the service logs a warning (without emitting `SECURITY_ALERT`) and falls back to `STANDARD_CAPTURE`.
4. *(Currency Guard)* PayPal REST Orders v2 does not support `INR` in live mode; the service automatically converts `INR` line items, tax, and total to `USD` using `INR_TO_USD` (default `0.012`), reconciles to 2 decimal places, and records `originalCurrency`, `originalAmount`, and `conversionRate` in the live response.

#### Configuring `PAYPAL_WEBHOOK_ID` & Webhook Verification
1. Expose `/webhooks/paypal` over HTTPS (e.g. Render or `ngrok http 5000`).
2. In your PayPal Sandbox App settings, add a Webhook pointing to `https://<your-domain>/webhooks/paypal` and subscribe to `PAYMENT.CAPTURE.COMPLETED` (and optionally `CHECKOUT.ORDER.APPROVED` / `PAYMENT.CAPTURE.DENIED`).
3. Set `PAYPAL_WEBHOOK_ID` in `/payments/.env` to the generated Webhook ID and restart the service.
4. Verification behavior:
   - **Live (`PAYPAL_WEBHOOK_ID` + credentials set):** Captures raw request bytes and verifies the 5 `PAYPAL-*` signature headers (`PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, `PAYPAL-AUTH-ALGO`) via `POST /v1/notifications/verify-webhook-signature`. Returns `401` and logs a `SECURITY_ALERT` event (`WEBHOOK_VERIFICATION_FAILED`) on failure.
   - **Simulation (`PAYPAL_WEBHOOK_ID` unset/placeholder):** Skips cryptographic signature verification (`verification: "SIMULATED_SKIPPED"` — **not** cryptographic verification) and accepts the payload with `200` for local demo convenience.
   - **Event & Deduplication Scope:** All verified webhooks log a `WEBHOOK_VERIFIED` ledger event (with `rawBodySha256`), whereas only `PAYMENT.CAPTURE.COMPLETED` additionally appends a `SETTLED` ledger event and returns a non-null `settledEventId`. Non-settlement events (e.g., `PAYMENT.CAPTURE.DENIED`, `CHECKOUT.ORDER.APPROVED`, or missing/blank `event_type` which defaults to `UNKNOWN`) return `settledEventId: null` without emitting `SETTLED`. App-instance-scoped deduplication tracks processed `webhookEvent.id` values and settled capture keys (or fallback order/intent keys when `captureId` is unavailable) after verification succeeds so duplicate `PAYMENT.CAPTURE.COMPLETED` deliveries return `200` with `"duplicate": true` and `"settledEventId": null` without duplicating `SETTLED`, while malformed JSON or non-object payloads return `400` and failed verifications/settlements do not block retries.

#### Testing a Live Sandbox Payment & Webhook Verification
*(Note: Execute these only after supplying real sandbox credentials; not yet verified end-to-end against live PayPal servers.)*
1. **Payment smoke test:** Start the server (`npm run build && npm start`) and post a valid Tier 2 intent (which avoids needing a Vault token) to `POST /orders/create-and-capture`:
   - Confirm `"mode": "LIVE_PAYPAL_SANDBOX"`, a USD-converted `amount` with `"currency": "USD"`, `"originalCurrency": "INR"`, and HTTP `200` (`GET /ledger/verify` should remain `valid: true`).
2. **Webhook negative & positive verification tests:**
   - Send a synthetic `POST /webhooks/paypal` without valid `PAYPAL-*` signature headers and confirm HTTP `401` plus a `SECURITY_ALERT` entry in `GET /ledger/events`.
   - Trigger a signed webhook from the PayPal Developer **Webhook Simulator** (pointing at your HTTPS tunnel URL) for `PAYMENT.CAPTURE.COMPLETED` and confirm HTTP `200` with `"verification": "SUCCESS"` and a `WEBHOOK_VERIFIED` + `SETTLED` pair in `/ledger/events`.

#### Switching Safely Back to Simulation Mode
1. Clear or restore placeholder values in `/payments/.env` for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID` (and optionally `PAYPAL_VAULT_ID`).
2. Restart the Payments server (`npm start` or `npm run dev`) so cached tokens/settings reset.
3. Verify `GET /health` is responsive and a test request returns `"mode": "SIMULATED_SANDBOX"` and `"verification": "SIMULATED_SKIPPED"` for webhooks.

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

## 6. P4 / P3 Gateway Integration Contract

> **Integration Alignment Required:** Before end-to-end integration, P3 must confirm the Gateway's exact outbound payload mapping (including `items`, 2-decimal `subtotal`/`tax`/`total` reconciliation, and optional `mandate` / `mlDsaSignatureHex` / `publicKeyHex` forwarding) as well as any inter-service authentication/authorization expectations between P3 and P4. Currently P4 accepts local HTTP calls without shared-secret or JWT authentication middleware.

- **Base URL & Default Port:** `http://localhost:5000` (overridden by `PORT`)
- **Primary Settlement Endpoint:** `POST /orders/create-and-capture` (`Content-Type: application/json`)
  - **Required fields (`CheckoutIntent`):**
    - `intentId`: non-empty `string` (idempotency key)
    - `total`: finite `number > 0` (must equal `subtotal + tax` to 2 decimal places)
    - `currency`: non-empty `string` (e.g. `"INR"` or `"USD"`)
    - `items`: non-empty array of `{ id: string, name: string, price: number >= 0, quantity: number > 0 }`
  - **Optional / Recommended fields:**
    - `subtotal`: non-negative finite `number` (if supplied, must equal `sum(price * quantity)` in cents; defaults to item sum if omitted)
    - `tax`: non-negative finite `number` (defaults to `0` if omitted)
    - `mandateId`, `merchant`, `nonce`, `status` (stored in ledger events & dispute context)
    - `mandate` (`SpendingMandate`), `mlDsaSignatureHex` (or `signatureHex`), `publicKeyHex` (forwarded into `GET /disputes/:intentId/package`; placeholders are used when omitted)
  - **Responses:**
    - `200 OK` (`SettlementResult`):
      - **Simulation mode (`mode: "SIMULATED_SANDBOX"`):** `{ mode, tier, settlementPath, vaultStatus?, orderId, captureId, status, amount, currency, merchant }` — includes `merchant` and sets `vaultStatus: "SIMULATED"` on Tier 1 (`VAULT_ZERO_TOUCH`); omits `vaultStatus` on Tier 2 (`STANDARD_CAPTURE`).
      - **Live PayPal Sandbox mode (`mode: "LIVE_PAYPAL_SANDBOX"`):** `{ mode, tier, settlementPath, vaultStatus?, orderId, captureId, status, amount, currency, originalCurrency?, originalAmount?, conversionRate?, raw }` — **omits `merchant`**, sets `vaultStatus: "VAULTED_LIVE"` only when Tier 1 live Vault capture succeeds (omitted for `STANDARD_CAPTURE` Tier 1 fallback or Tier 2), includes `originalCurrency`, `originalAmount`, and `conversionRate` when an unsupported currency (e.g., `INR`) was converted to `USD`, and includes `raw` (PayPal's API response payload).
    - `400 Bad Request`: `{ error: "Invalid CheckoutIntent payload", details: string[] }`
    - `500 Internal Server Error`: `{ error: string }` (failed attempts are **not** cached, so retries with the same `intentId` execute cleanly)
- **Idempotency & Concurrency:** Concurrent or repeated `POST /orders/create-and-capture` calls sharing `intentId` share any active in-flight settlement or return the cached `SettlementResult` without calling PayPal twice, appending a `PAYPAL_CAPTURE_COMPLETED` event with `"detail": "IDEMPOTENT_REPLAY"` and `"idempotentReplay": true`.
- **Tier 1 vs Tier 2 Behavior:**
  - `intent.total <= TIER1_LIMIT` (default `2500`): Tier `1` -> attempts `VAULT_ZERO_TOUCH` (`vaultStatus: "SIMULATED"` in simulation; live mode uses `PAYPAL_VAULT_ID` and sets `vaultStatus: "VAULTED_LIVE"` on success, or falls back to `STANDARD_CAPTURE` without `vaultStatus` and logs a warning on vault failure).
  - `intent.total > TIER1_LIMIT`: Tier `2` -> uses `STANDARD_CAPTURE`.
- **Ledger Events (`GET /ledger/events` & SSE `GET /ledger/stream`):**
  - `MANDATE_CREATED`, `PAYPAL_ORDER_CREATED`, `PAYPAL_CAPTURE_COMPLETED` (with `detail: "IDEMPOTENT_REPLAY"` on replays), `WEBHOOK_VERIFIED`, `SETTLED` (on verified non-duplicate `PAYMENT.CAPTURE.COMPLETED`), and `SECURITY_ALERT` (`WEBHOOK_VERIFICATION_FAILED`).
- **Webhook Endpoint (`POST /webhooks/paypal`):**
  - Uses raw-body inspection (`express.raw({ type: '*/*' })`); returns `400` (`{ error: "Invalid JSON webhook payload" }` or `{ error: "Webhook payload must be a JSON object" }`) for malformed JSON or non-object payloads (such as arrays or primitives), `401` on failed verification when `PAYPAL_WEBHOOK_ID` is set, and `200` (`"verification": "SIMULATED_SKIPPED"` when `PAYPAL_WEBHOOK_ID` is unset/placeholder, or `"SUCCESS"` when verified). Duplicate `webhookEvent.id` deliveries or repeated `PAYMENT.CAPTURE.COMPLETED` captures return `200` with `"duplicate": true` and `"settledEventId": null`.

---

## 7. API Routes (`http://localhost:5000`)

| Method & Path | Purpose |
| :--- | :--- |
| `GET /health` | Service health and ledger event count |
| `GET /ledger/stream` | CORS-safe SSE telemetry stream (`: ping` heartbeat every 15s) |
| `GET /ledger/events` | Retrieve all ledger events and chain integrity boolean |
| `GET /ledger/verify` | Verify SHA-256 hash chain (`{ valid, eventCount, headHash }`) |
| `POST /orders/create-and-capture` | Validate intent, enforce idempotency, reconcile amounts/GST, settle Tier 1/Tier 2 order |
| `POST /webhooks/paypal` | Raw-body PayPal webhook listener (`400` on invalid/non-object JSON, `401` on failed signature); verifies signature when `PAYPAL_WEBHOOK_ID` is set (skipped in simulation mode), deduplicates repeats, and logs webhook/settlement events |
| `GET /disputes/:intentId/package` | Export `MerkleDisputePackage` for a settled intent (`404` if unsettled) |

*(Note: The root `postman_collection.json` currently includes `/ledger/events` and `/webhooks/paypal`; use the requests below to test all P4 endpoints in Postman or `curl`.)*

---

## 8. Example Requests & Responses & Cryptographic Limitations

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
Example response (`200` simulation mode; `SIMULATED_SKIPPED`; `duplicate: true` and `settledEventId: null` on replays or non-settlement events; `400` on invalid/non-object JSON; `401` when signature verification fails):
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

### Dispute Package & ML-DSA Limitation (`GET /disputes/:intentId/package`)
- **What is implemented today:** P4 maintains a tamper-evident append-only **SHA-256 hash chain** (`ImmutableLedger`, verifiable via `GET /ledger/verify`) and generates a **SHA-256 `MerkleDisputePackage`** (`ledgerProofChain` plus `merkleRoot` computed deterministically with odd-count last-leaf duplication) for any settled `intentId`. If the caller supplies `mandate`, `mlDsaSignatureHex` (or `signatureHex`), and `publicKeyHex` on `POST /orders/create-and-capture`, those values are stored and included in the exported package; otherwise `PLACEHOLDER_UNAVAILABLE_*` strings are emitted.
- **What is missing for real ML-DSA signing and verification:** P4 does **not** currently integrate a post-quantum ML-DSA cryptography library, generate or manage ML-DSA signing keys, cryptographically sign exported dispute packages, or verify incoming mandate/intent ML-DSA signatures against a registered public key. Production readiness requires integrating real ML-DSA signing/verification primitives and agreeing on a canonical payload serialization format across P2, P3, and P4.

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
