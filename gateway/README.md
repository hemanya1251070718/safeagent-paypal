# SafeAgent: Policy Gateway & Security Layer (P3)
**Owner:** Person 3 (Policy Gateway & Security Lead)  
**Role:** Deterministic Trust Boundary & Cryptographic Verification

---

## 1. What This Layer Does
The Policy Gateway sits directly between the cognitive agent (P2) and payment rails (P4). It is the **deterministic trust boundary** where mathematical rules and cryptographic signatures are verified without any LLM in the loop.

---

## 2. Directory Structure
```
/gateway
├── src/
│   ├── security/
│   │   ├── pqcVerifier.ts    # NIST FIPS 204 (ML-DSA) lattice signature verification
│   │   ├── policyEngine.ts   # Deterministic budget, TTL, whitelist, and replay checks
│   │   └── sanitization.ts   # Adversarial prompt-injection inspection
│   └── server.ts             # Express REST service (Port 3000)
├── package.json
└── tsconfig.json
```

---

## 3. How to Run
```bash
npm install
npm run dev
```
Endpoints exposed on `http://localhost:3000`:
* `POST /mandates` - Register signed spending mandates
* `GET /mandates/:id` - Fetch mandate details & remaining balance
* `POST /intents` - Evaluate checkout intent against policies
* `POST /intents/:id/confirm` - Biometric two-phase commit confirmation

