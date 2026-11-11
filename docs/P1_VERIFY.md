# SafeAgent P1 Phase 0 Verification Report

**Auditor:** Person 1 (P1, Frontend & Mandate Client Lead)  
**Date:** November 12, 2026  
**Status:** Verification Complete (Phase 0)  

---

## Verification Summary Table

| Item | Description | Result | Primary File Paths |
| :---: | :--- | :---: | :--- |
| **a** | `/shared/dist` exists and builds | **PASS** | `shared/src/index.ts`, `shared/dist/index.js` |
| **b** | `client/vite.config.ts` allows parent imports (`server.fs.allow`) without 403 | **FAIL** | `client/vite.config.ts` |
| **c** | Evidence of successful PayPal sandbox capture natively in INR | **FAIL** *(No Evidence)* | `payments/src/paypalClient.ts`, `payments/tests/paypalClient.test.ts` |
| **d** | Gateway `POST /intents/:id/confirm` calls payments server-side vs. mock IDs | **FAIL** | `gateway/src/server.ts`, `client/src/components/BiometricModal.tsx` |
| **e** | Ledger events emitted when Gateway rejects an intent | **FAIL** | `gateway/src/security/policyEngine.ts`, `payments/src/server.ts` |
| **f** | `PAYPAL_CAPTURE_COMPLETED` event data includes `subtotal` and `tax` | **FAIL** | `payments/src/server.ts` |
| **g** | `GET /disputes/:intentId/package` works for a settled intent | **PASS** | `payments/src/server.ts`, `payments/tests/server.test.ts` |
| **h** | `POST /agent/plan` uses `mandateId` and 202 response carries full cart | **PASS** | `agent/src/service.ts`, `agent/src/core/planner.ts` |
| **i** | All four demo scenarios (`tier1`, `tier2`, `injection`, `budget`) code paths work | **PASS** | `agent/src/service.ts`, `agent/src/core/planner.ts`, `gateway/src/security/policyEngine.ts` |

---

## Detailed Findings

### Item a: Shared Package Build Status
* **Status:** **PASS** (Resolved during Phase 0)
* **Finding:** `/shared/dist` was initially missing. Running `npm install && npm run build` inside `/shared` resolved all dependencies and successfully compiled `shared/dist/index.js`, `shared/dist/crypto.js`, and `shared/dist/types.js`. Verified output files exist.

### Item b: Vite Dev Configuration & Parent Imports
* **Status:** **FAIL**
* **Finding:** `client/vite.config.ts` currently only configures `server: { port: 5173 }` and lacks `server: { fs: { allow: ['..'] } }`. While production bundling (`npm run build`) succeeded statically, Vite's dev server can block relative runtime imports traversing out of `/client` (`../../../shared/dist/index.js`) with an HTTP 403 error. Must be added in Phase 1.

### Item c: PayPal Sandbox Native INR Support
* **Status:** **FAIL / NO EVIDENCE**
* **Finding:** No evidence exists in the codebase, tests, or documentation of PayPal sandbox capturing native INR. On the contrary, `payments/src/paypalClient.ts` defines `PAYPAL_SUPPORTED_CURRENCIES` (24 currencies) which explicitly excludes INR. The service contains an active Currency Guard (`lines 286-298`) that forces currency conversion from INR to USD via `INR_TO_USD=0.012` before transmitting orders to PayPal's live sandbox APIs. Native INR amounts only exist in the offline simulated mode (`SIMULATED_SANDBOX`).

### Item d: Tier 2 Confirmation Money Movement
* **Status:** **FAIL**
* **Finding:** In `gateway/src/server.ts` (lines 121–139), `POST /intents/:id/confirm` returns mock order and capture IDs without contacting the payments service. Consequently, `client/src/components/BiometricModal.tsx` (line 27) makes a direct secondary HTTP call to `POST http://localhost:5000/orders/create-and-capture`. This violates the Policy Gateway trust boundary.

### Item e: Ledger Events on Intent Rejection
* **Status:** **FAIL**
* **Finding:** When Gateway's policy engine rejects an intent (e.g. prompt injection attack or over-budget cart), no ledger event is emitted. The Gateway service does not write to the ledger, and Payments only appends events during order capture or incoming webhooks. Neither `POLICY_VALIDATION_FAILED` nor `SECURITY_ALERT` is logged on Gateway rejections.

### Item f: Subtotal and Tax in `PAYPAL_CAPTURE_COMPLETED`
* **Status:** **FAIL**
* **Finding:** In `payments/src/server.ts` (lines 546–561), the `PAYPAL_CAPTURE_COMPLETED` event payload includes `intentId`, `orderId`, `captureId`, `status`, `amount`, `currency`, `mode`, `tier`, and `settlementPath`. It does **not** include `subtotal` or `tax`.

### Item g: Merkle Dispute Package Endpoint
* **Status:** **PASS**
* **Finding:** `GET /disputes/:intentId/package` is fully implemented in `payments/src/server.ts` (lines 399–455) and covered by tests in `payments/tests/server.test.ts` (line 209). For settled intents, it builds and returns a complete `MerkleDisputePackage` containing the SHA-256 Merkle root and proof chain.

### Item h: Agent Mandate Binding & 202 Cart Delivery
* **Status:** **PASS**
* **Finding:** `POST /agent/plan` binds the client's `mandateId` into `planner.planAndExecute` and passes it to `submit_intent`. When the Gateway responds with 202 `HELD_FOR_CONFIRMATION`, the complete itemized cart is preserved and returned in **both** `data.intent` and `data.gatewayDecision.intent`.

### Item i: Scenario Code Paths
* **Status:** **PASS**
* **Finding:** All four scenarios in `agent/src/service.ts` execute deterministic, verified logic:
  1. `tier1`: Mouse (₹2,240.82 with 18% GST <= ₹2,500) -> auto-approved as Tier 1.
  2. `tier2`: Keyboard (₹7,668.82 with 18% GST > ₹2,500) -> paused for confirmation (Tier 2).
  3. `injection`: Malicious USB listing -> Gateway firebreak triggers 422 rejection.
  4. `budget`: LG 4K monitor exceeds ₹15,000 balance -> Gateway rejects, agent autonomous recovery finds Zebronics monitor (₹8,848.82) and resubmits for Tier 2 confirmation.
