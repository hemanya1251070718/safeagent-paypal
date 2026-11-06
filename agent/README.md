# SafeAgent: Agent Layer (P2)
**Owner:** Person 2 (AI Agent & Merchant Integration)  
**Role:** Untrusted Cognitive Planner & Merchant Tool Integration

---

## 1. What This Layer Does
The Agent is the **untrusted cognitive planner** for SafeAgent. It interprets user shopping requests, queries structured e-commerce feeds, selects products, and constructs checkout intent payloads.

### Architectural Rule: Zero Financial Authority
* The agent holds **no PayPal credentials**.
* The agent has **no payment tools**.
* The agent cannot execute or authorize purchases directly.
* The agent can only build carts and submit proposals to the Policy Gateway (`POST /intents`).

---

## 2. Directory Structure
```
/agent
├── src/
│   ├── catalog/
│   │   ├── products.ts          # Mock merchant product catalogs (Shopify, Medusa, Rogue)
│   │   └── storeService.ts      # Product filtering, semantic search, and retrieval
│   ├── tools/
│   │   ├── searchProducts.ts    # MCP Tool: search_products
│   │   ├── getProductDetails.ts # MCP Tool: get_product_details
│   │   ├── buildCart.ts         # MCP Tool: build_cart (subtotal, tax, currency)
│   │   └── submitIntent.ts      # MCP Tool: submit_intent (submits to Policy Gateway)
│   ├── core/
│   │   └── planner.ts           # Cognitive reasoning engine & autonomous adaptation
│   ├── scenarios/
│   │   ├── runTier1.ts          # Tier 1 Micro-Tx (<$30 auto-captured)
│   │   ├── runTier2.ts          # Tier 2 Discretionary ($30-$100 biometric required)
│   │   ├── runInjectionAttack.ts# Prompt injection attack demonstration
│   │   └── runBudgetRecovery.ts # Over-budget recovery demonstration
│   ├── service.ts               # HTTP REST service (Port 4001) for Frontend (P1)
│   └── cli.ts                   # Interactive terminal testing CLI
├── package.json
└── tsconfig.json
```

---

## 3. How to Run Locally

### Install Dependencies
```bash
npm install
```

### Run the Interactive Terminal CLI
```bash
npm run cli
```

### Run the Agent HTTP Service (Port 4001)
```bash
npm run dev
```

### Run Specific Hackathon Scenarios
```bash
npm run scenario:tier1       # Runs Scenario 1 (Zero-Touch Tier 1)
npm run scenario:tier2       # Runs Scenario 2 (Biometric Confirmation)
npm run scenario:injection   # Runs Scenario 3 (Adversarial Prompt Injection Block)
npm run scenario:budget      # Runs Scenario 4 (Autonomous Budget Adaptation)
```

---

## 4. API Endpoints Provided to Frontend (P1)
* `POST /agent/plan`  
  * Body: `{ "goal": "Find me a wireless mouse under $30", "mandateId": "mandate_123" }`  
  * Returns: Full reasoning trace, tool calls, and submitted intent status.
* `POST /agent/scenario/:scenarioId`  
  * Runs presets (`tier1`, `tier2`, `injection`, `budget`).
* `GET /agent/catalog`  
  * Returns full catalog with item prices, descriptions, and tags.

