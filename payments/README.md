# SafeAgent: Payments, Ledger & Telemetry Layer (P4)
**Owner:** Person 4 (Payments & Settlement Lead)  
**Role:** Money Movement, PayPal Developer Sandbox, and Tamper-Evident Ledger

---

## 1. What This Layer Does
This layer communicates with PayPal's payment rails, handles Orders v2 creation and captures, processes webhooks, maintains a SHA-256 hash-chained immutable audit ledger, and broadcasts real-time Server-Sent Events (SSE) to P1's AG Grid dashboard.

---

## 2. Directory Structure
```
/payments
├── src/
│   ├── paypalClient.ts       # PayPal OAuth2, Orders v2 creation and capture
│   ├── ledger.ts             # Append-only SHA-256 hash-chained Merkle ledger
│   └── server.ts             # Express REST & SSE service (Port 5000)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 3. How to Run
```bash
npm install
npm run dev
```
Endpoints exposed on `http://localhost:5000`:
* `GET /ledger/stream` - SSE stream powering P1's live AG Grid
* `GET /ledger/events` - Retrieve full ledger and integrity verification
* `POST /orders/create-and-capture` - Creates and settles PayPal order
* `POST /webhooks/paypal` - Ingests PayPal sandbox webhooks

