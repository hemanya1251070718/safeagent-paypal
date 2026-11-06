# SafeAgent: Frontend & Mandate Client Layer (P1)
**Owner:** Person 1 (Frontend & Mandate Client Lead)  
**Role:** User Delegation Interface, Post-Quantum Signatures, and AG Grid Live Telemetry

---

## 1. What This Layer Does
* **Mandate Creator:** Sliders for budget, TTL, merchant whitelist toggles.
* **Browser Post-Quantum Cryptography:** Generates ML-DSA-65 (NIST FIPS 204) lattice keypairs in the browser using `@noble/post-quantum`, canonicalizes JSON, and submits signed spending mandates.
* **Agent Shopping Goal Input:** Sends user shopping prompts to P2's Cognitive Agent (`http://localhost:4001/agent/plan`).
* **Tier 2/3 Biometric Confirmation Modal:** Interactive two-phase commit modal with 1-tap passkey/biometric authorization.
* **AG Grid Enterprise Telemetry:** Live SSE streaming table connected to `http://localhost:5000/ledger/stream` displaying block hashes, capture receipts, and 1-click Merkle dispute package export.

---

## 2. How to Run Locally
```bash
npm install
npm run dev
```
The React frontend will launch on `http://localhost:5173`.

