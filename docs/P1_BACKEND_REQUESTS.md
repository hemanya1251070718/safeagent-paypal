# SafeAgent P1 Backend Requests & Trust-Boundary Alignment

**From:** Person 1 (P1, Frontend & Mandate Client Lead)  
**To:** Person 3 (P3, Policy Gateway Lead) & Person 4 (P4, Payments & Telemetry Lead)  
**Date:** November 12, 2026  
**Context:** P1 Frontend Audit & AG Grid Telemetry Integration (Phase 2)  

---

## 1. Request for Person 4 (P4: Payments Lead)

### Issue: Subtotal and Tax Missing from `PAYPAL_CAPTURE_COMPLETED`
* **Current Behavior:** In `payments/src/server.ts` (lines 546–561), the `PAYPAL_CAPTURE_COMPLETED` SSE event payload data currently contains:
  ```json
  {
    "intentId": "...",
    "orderId": "...",
    "captureId": "...",
    "status": "COMPLETED",
    "amount": 2240.82,
    "currency": "INR",
    "tier": 1,
    "settlementPath": "VAULT_ZERO_TOUCH"
  }
  ```
  It does **not** include `subtotal` or `tax`.
* **Frontend Impact:** The AG Grid dashboard has dedicated columns for `Amount` and `Tax (GST 18%)` to showcase auditability for the **AG Grid Sponsor Prize ($5,000)**. Because `tax` is missing from the capture event, the frontend must display an em dash (`—`) for tax on capture events.
* **Requested Change:** When logging `PAYPAL_CAPTURE_COMPLETED` and `PAYPAL_ORDER_CREATED`, please include `subtotal` and `tax` from the `intent` inside `data`:
  ```typescript
  ledger.append('PAYPAL_CAPTURE_COMPLETED', {
    intentId: intent.intentId,
    orderId: settlement.orderId,
    captureId: settlement.captureId,
    status: settlement.status,
    amount: settlement.amount,
    subtotal: intent.subtotal, // <-- PLEASE ADD
    tax: intent.tax,           // <-- PLEASE ADD
    merchant: intent.merchant, // <-- PLEASE ADD
    currency: settlement.currency,
    tier: settlement.tier,
    settlementPath: settlement.settlementPath
  }, intent.mandateId, intent.intentId);
  ```

---

## 2. Request for Person 3 & Person 4 (P3: Gateway & P4: Payments)

### Issue: No Ledger Events Emitted on Intent Rejection / Policy Block
* **Current Behavior:** When the Policy Gateway rejects an intent (e.g. Scenario 3 prompt injection attack on `ROGUE-USB-001` or Scenario 4 budget cap violation), the Gateway returns HTTP 422 `REJECTED_BY_GATEWAY`. However, neither Gateway (P3) nor Payments (P4) appends an event to the ledger.
* **Frontend Impact:** Rejection and security events do not appear on the AG Grid live stream. To demonstrate defense capabilities in the live pitch video, the frontend currently injects a client-observed fallback row (`BLOCKED (client-observed)`).
* **Requested Change:** The Gateway (or Payments) should log a `POLICY_VALIDATION_FAILED` or `SECURITY_ALERT` event to the ledger so all policy rejections and injection blocks stream over SSE in real time.

---

## 3. Request for Person 3 (P3: Gateway Lead)

### Issue: Tier 2 Biometric Confirmation Trust Boundary Bypass
* **Current Behavior:** In `gateway/src/server.ts` (lines 121–139), `POST /intents/:id/confirm` currently returns mock order/capture IDs without calling the Payments service. Because of this, `client/src/components/BiometricModal.tsx` has to make a direct secondary HTTP call to `POST http://localhost:5000/orders/create-and-capture`.
* **Frontend Impact:** Having the frontend client call Payments directly breaks the fundamental architectural principle that only the deterministic Gateway touches financial rails.
* **Requested Change:** Please have the Policy Gateway invoke Payments `POST /orders/create-and-capture` server-to-server when `POST /intents/:id/confirm` receives user approval. Once in place, the frontend will remove its direct fallback capture call.

---

## 4. Request for Person 3 & Person 4 (P3: Gateway & P4: Payments)

### Issue: PayPal Sandbox INR-to-USD Currency Conversion Discrepancy
* **Current Behavior:** PayPal does not support INR for live sandbox settlement. In `payments/src/paypalClient.ts`, a Currency Guard converts INR amounts to USD at a fixed rate of `0.012` for live sandbox calls while the frontend UI displays INR. As a result, the displayed amounts (in INR) and the captured amounts (in USD) differ.
* **Frontend Impact:** Displayed and captured amounts diverge between the client mandate/intent view and the actual PayPal rails receipt, creating confusion during live demos and telemetry auditing.
* **Requested Change:**
  1. The team agrees on ONE unified demo currency across all 4 layers (e.g. USD across Mandates, Gateway, Agent, and PayPal rails, or unified currency handling).
  2. The Payments ledger event stream and capture response explicitly include the captured currency and amount (`capturedCurrency`, `capturedAmount`) so the dashboard displays the captured currency and amount faithfully.
