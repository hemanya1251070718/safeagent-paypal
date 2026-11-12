// SafeAgent Unified In-Process Production Host for Google Cloud Run
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.CLOUD_RUN_UNIFIED = 'true';
process.env.HOST = '0.0.0.0';
process.env.PAYMENTS_SERVICE_URL = 'http://127.0.0.1:5000';
process.env.PAYMENTS_URL = 'http://127.0.0.1:5000';
process.env.GATEWAY_URL = 'http://127.0.0.1:3000';

const PORT = parseInt(process.env.PORT || '8080', 10);
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

console.log('================================================================');
console.log(' Initializing SafeAgent In-Process Cloud Run Services...');
console.log('================================================================');

// 1. Initialize Payments (P4)
const { createPaymentsApp, defaultLedger, defaultPayPalService } = await import('./payments/dist/server.js');
const { app: paymentsApp } = createPaymentsApp({
  ledger: defaultLedger,
  paypalService: defaultPayPalService
});
console.log('✓ Payments & Telemetry Service (P4) initialized.');

// 2. Initialize Gateway (P3)
const { app: gatewayApp } = await import('./gateway/dist/server.js');
console.log('✓ Policy Gateway (P3) initialized.');

// 3. Initialize Cognitive Agent (P2)
const { app: agentApp } = await import('./agent/dist/service.js');
console.log('✓ Cognitive Agent (P2) initialized.');

// Bind internal background ports for inter-service communication (Gateway -> Payments :5000, Agent -> Gateway :3000)
gatewayApp.listen(3000, '0.0.0.0', () => {
  console.log('🛡 Internal Gateway listening on http://0.0.0.0:3000');
});

agentApp.listen(4001, '0.0.0.0', () => {
  console.log('🤖 Internal Agent listening on http://0.0.0.0:4001');
});

paymentsApp.listen(5000, '0.0.0.0', () => {
  console.log('💳 Internal Payments listening on http://0.0.0.0:5000');
});

// Root Unified Server on PORT (8080) for Cloud Run Public Ingress
const rootApp = express();
rootApp.use(cors());

// Global Health Probes
rootApp.get(['/health', '/ping'], (req, res) => {
  res.json({
    status: 'ok',
    app: 'SafeAgent',
    platform: 'Google Cloud Run',
    mode: 'unified-in-process',
    timestamp: new Date().toISOString(),
    services: {
      gateway: 'active',
      agent: 'active',
      payments: 'active'
    }
  });
});

// Mount Gateway, Agent, and Payments directly on rootApp!
// 1. Gateway routes (/mandates, /intents, etc.)
rootApp.use(gatewayApp);

// 2. Agent routes (/agent/*)
rootApp.use(agentApp);

// 3. Payments routes (/ledger/*, /orders/*, /disputes/*)
rootApp.use(paymentsApp);

// 4. Serve Static React App from client/dist
rootApp.use(express.static(CLIENT_DIST));

// 5. SPA Fallback: unknown frontend routes return client/dist/index.html
rootApp.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

rootApp.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(` SafeAgent Cloud Run Unified Host listening on http://0.0.0.0:${PORT}`);
  console.log(` - Frontend Client: Serving UI from ${CLIENT_DIST}`);
  console.log(` - Gateway API:     /mandates, /intents`);
  console.log(` - Agent API:       /agent/*`);
  console.log(` - Payments API:    /ledger, /orders, /disputes`);
  console.log('================================================================');
});
