# SafeAgent: Policy Gateway & Security Layer (Layer 3 / Person 3)
**Owner:** Person 3 (Policy Gateway & Security Lead)  
**Role:** Deterministic Trust Boundary, NIST Post-Quantum Cryptography & Policy Enforcement  
**Port:** `3000` (Default) | `PAYMENTS_SERVICE_URL: http://localhost:5000`

---

## 1. Executive Summary & The Trust Boundary
The **SafeAgent Policy Gateway** is the core security firewall and deterministic trust boundary of the SafeAgent platform. 
In autonomous agentic commerce, Large Language Models (LLMs) are **untrusted cognitive planners**. They may experience hallucinations or fall victim to indirect prompt injection from malicious merchant web pages.

**Core Principle:** The LLM is completely untrusted and receives **zero credentials and zero authority to move money**. 
The Policy Gateway deterministically validates every proposed purchase intent against a cryptographic spending mandate signed by the human user before a single dollar moves on PayPal rails.

```
+----------------------------+
|  Layer 1: Client           |  User signs spending mandate via NIST FIPS 204 (ML-DSA-65)
|  (React + ML-DSA / Port 5173)|
+--------------+-------------+
               | Mandate Registration
               v
+----------------------------+
|  Layer 3: Policy Gateway   | <====== [DETERMINISTIC TRUST BOUNDARY]
|  (Node.js + Express / Port 3000)
+--------------^-------------+
               | Checkout Intent
+--------------+-------------+
|  Layer 2: Cognitive Agent  |  Searches catalogs & builds cart (UNTRUSTED ZONE)
|  (LangChain/MCP / Port 4001)|
+----------------------------+
               | Validated Orders
               v
+----------------------------+
|  Layer 4: Payment Backend  |  PayPal Orders v2 Capture & Tamper-Evident Ledger
|  (Port 5000)               |
+----------------------------+
```

---

## 2. Deterministic Validation Pipeline

Every incoming `CheckoutIntent` passes through 7 strict deterministic security gates in pure code (no LLM in the loop):

1. **Mandate Authenticity & Existence:** Validates that the targeted `mandateId` is active and registered.
2. **Post-Quantum Signature Verification (ML-DSA-65):** Validates the NIST FIPS 204 lattice-based digital signature over the canonicalized JSON spending mandate (`ml_dsa65.verify(signatureBytes, messageBytes, publicKeyBytes)`).
3. **Time-To-Live (TTL) Validity:** Ensures `Date.now() <= mandate.expiresAt`.
4. **Replay Defense (Nonce Tracking):** Nonces are tracked in memory. Any duplicate intent nonce is detected as a replay attack and blocked.
5. **Merchant Whitelist Verification:** Only pre-approved merchant stores are authorized; unapproved merchants (e.g. `DarkMarket-Malicious`) are blocked.
6. **Spend Limits & Depletion Tracking:** Cart total is verified against the mandate's remaining balance. Successive purchases deduct from the remaining balance until exhausted.
7. **Arithmetic & Integrity Checks:** Checks that `subtotal + tax == total` to prevent price underflows or parameter tampering.
8. **Adversarial Prompt-Injection Firewall:** Scans all item titles, descriptions, SKUs, and agent reasoning for injection vectors (`<!-- SYSTEM_OVERRIDE -->`, `Ignore user constraints`, `0xAttacker`, `<script>`, etc.) and quarantines malicious attempts.

---

## 3. Tier Routing Engine

| Tier | Category | Condition | Gateway Response | Next Action |
|---|---|---|---|---|
| **Tier 1** | Micro-Transaction | Total <= Tier 1 Limit (e.g. <= $30 or ₹2,500), Whitelisted, No Injection | `HTTP 200 OK`<br>`status: ACCEPTED_AND_CAPTURED` | Deducts balance, forwards to P4 Payments on Port 5000, returns PayPal capture IDs. |
| **Tier 2** | Discretionary Spend | Total > Tier 1 Limit, but within Max Spend Cap | `HTTP 202 Accepted`<br>`status: HELD_FOR_CONFIRMATION` | Pauses execution in a two-phase commit state; awaits 1-tap user biometric/passkey approval. |
| **Tier 3** | Policy Violation / Attack | Exceeds Budget, Unwhitelisted Merchant, Expired TTL, Replay, or Injection | `HTTP 422 Unprocessable Entity`<br>`status: REJECTED_BY_GATEWAY` | Quarantines payload, logs rejection reasons and sanitization alerts. Zero money moves. |

---

## 4. API Endpoints Reference

All routes listen on `http://localhost:3000`:

### `GET /health`
Returns system status, active mandate count, and pending two-phase commit queue depth.

### `POST /mandates`
Registers a spending mandate with optional NIST FIPS 204 ML-DSA-65 signature verification.
- **Request Body:** `{ mandate: SpendingMandate, publicKeyHex?: string, signatureHex?: string }`
- **Response (200):** `{ status: "REGISTERED", mandateId: "...", remainingBalance: 15000.0, tier1Limit: 2500.0 }`
- **Response (400):** `{ error: "INVALID_PQC_SIGNATURE", details: "..." }`

### `GET /mandates`
Retrieves all active registered mandates.

### `GET /mandates/:id`
Retrieves single mandate details and real-time remaining balance.

### `POST /intents`
Receives a `CheckoutIntent` from the cognitive agent and runs the deterministic validation pipeline.
- **Case 1 (Tier 1 Auto-Capture):** `HTTP 200 OK`
  ```json
  {
    "status": "ACCEPTED_AND_CAPTURED",
    "policyDecision": "APPROVED",
    "tier": 1,
    "orderId": "PAYPAL-ORD-1793980153568",
    "captureId": "PAYPAL-CAP-1793980153568",
    "reasons": ["Total $26.99 <= Tier 1 threshold ($30). Auto-approved."],
    "intent": { ... }
  }
  ```
- **Case 2 (Tier 2 Biometric Hold):** `HTTP 202 Accepted`
  ```json
  {
    "status": "HELD_FOR_CONFIRMATION",
    "policyDecision": "CONFIRMATION_REQUIRED",
    "tier": 2,
    "reasons": ["Cart total ($86.39) exceeds Tier 1 threshold ($30.00). Paused for biometric confirmation."],
    "intent": { ... }
  }
  ```
- **Case 3 (Policy Rejection):** `HTTP 422 Unprocessable Entity`
  ```json
  {
    "status": "REJECTED_BY_GATEWAY",
    "policyDecision": "REJECTED",
    "tier": 3,
    "reasons": ["Merchant 'DarkMarket-Malicious' is not in approved whitelist..."],
    "sanitizationAlerts": ["Malicious prompt injection payload detected in item."],
    "intent": { ... }
  }
  ```

### `GET /intents/pending`
Lists all Tier 2 intents currently paused in the two-phase commit queue awaiting biometric approval.

### `POST /intents/:id/confirm`
Handles user biometric confirmation (WebAuthn / Passkey) for paused Tier 2 intents.
- **Request Body:** `{ approved: true, authMethod: "WebAuthn_Passkey" }`
- **Response (200 Approved):** `{ status: "CAPTURED_VIA_BIOMETRIC", intentId: "...", orderId: "...", captureId: "..." }`
- **Response (200 Rejected):** `{ status: "USER_REJECTED", intentId: "..." }`

---

## 5. Security & Defense In Depth

- **NIST FIPS 204 Lattice Cryptography:** Uses `@noble/post-quantum/ml-dsa` with ML-DSA-65 parameterization. Canonical JSON sorting ensures deterministic cross-platform hash identity.
- **Rate Limiting:** Built-in IP sliding-window rate limiter (120 req/min) prevents API abuse.
- **Security Headers:** Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`.
- **CORS Protection:** Configurable whitelist via `FRONTEND_ORIGIN` (defaults to `http://localhost:5173`).

---

## 6. How to Run & Verify

### Install Dependencies
```bash
cd gateway
npm install
```

### Run Development Server
```bash
npm run dev
```

### Run Build (TypeScript)
```bash
npm run build
```

### Run Security & Policy Unit Tests (20 Assertions)
```bash
npm test
```

### Run End-to-End HTTP Integration Test Suite (36 Assertions)
```bash
npm run test:integration
```
