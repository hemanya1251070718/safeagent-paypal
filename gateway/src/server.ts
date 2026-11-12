import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { policyEngine } from './security/policyEngine.js';
import { verifyMandateSignature } from './security/pqcVerifier.js';
import { forwardOrderToPayments } from './services/paymentService.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { SpendingMandate, CheckoutIntent } from '../../shared/dist/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Rate limiting & CORS middleware
app.use(rateLimiter);
app.use(cors({
  origin: FRONTEND_ORIGIN === '*' ? '*' : [FRONTEND_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());

// Initialize default mock mandate for local and multi-agent testing
const defaultMandate: SpendingMandate = {
  mandateId: "mandate_active_001",
  userId: "user_demo_789",
  maxSpend: 15000.00,
  currency: "INR",
  ttlHours: 24,
  createdAt: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  merchantWhitelist: [
    "Amazon-India",
    "Flipkart",
    "Croma-Retail",
    "Myntra",
    "Shopify-India",
    "Shopify-TechStore",
    "Medusa-OfficePro"
  ],
  tier1Limit: 2500.00,
  remainingBalance: 15000.00,
  nonce: "seed_nonce_001"
};
policyEngine.registerMandate(defaultMandate);

// -------------------------------------------------------------
// Health Check Endpoint
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SafeAgent Policy Gateway (P3)',
    activeMandates: policyEngine.getAllMandates().length,
    pendingIntents: policyEngine.getAllPendingIntents().length,
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// Mandate Management Endpoints (Layer 1 Client -> Layer 3 Gateway)
// -------------------------------------------------------------

// Register a new signed Spending Mandate
app.post('/mandates', (req, res) => {
  const { mandate, publicKeyHex, signatureHex } = req.body;
  if (!mandate || !mandate.mandateId) {
    return res.status(400).json({ error: "Valid mandate object with mandateId is required." });
  }

  // If cryptographic signature provided, verify with NIST FIPS 204 ML-DSA-65
  if (publicKeyHex && signatureHex) {
    const pqcResult = verifyMandateSignature(mandate, publicKeyHex, signatureHex);
    if (!pqcResult.valid) {
      return res.status(400).json({
        error: "INVALID_PQC_SIGNATURE",
        details: "Lattice signature failed verification against canonical mandate.",
        algorithm: pqcResult.algorithm
      });
    }
  }

  policyEngine.registerMandate(mandate);

  res.status(200).json({
    status: 'REGISTERED',
    mandateId: mandate.mandateId,
    maxSpend: mandate.maxSpend,
    remainingBalance: mandate.remainingBalance,
    tier1Limit: mandate.tier1Limit,
    currency: mandate.currency,
    signatureVerified: Boolean(publicKeyHex && signatureHex)
  });
});

// List all active mandates
app.get('/mandates', (req, res) => {
  res.json({
    count: policyEngine.getAllMandates().length,
    mandates: policyEngine.getAllMandates()
  });
});

// Fetch single mandate by ID
app.get('/mandates/:id', (req, res) => {
  const mandate = policyEngine.getMandate(req.params.id);
  if (!mandate) {
    return res.status(404).json({ error: `Mandate '${req.params.id}' not found.` });
  }
  res.json(mandate);
});

// -------------------------------------------------------------
// Intent Processing Endpoint (Layer 2 Agent -> Layer 3 Gateway)
// -------------------------------------------------------------
app.post('/intents', async (req, res) => {
  const intent = req.body as CheckoutIntent;
  if (!intent || !intent.mandateId) {
    return res.status(400).json({ error: "Invalid intent payload: mandateId is required." });
  }

  // Deterministic Policy Verification
  const policy = policyEngine.validateIntent(intent);

  // Case 3: Policy Rejection or Attack Quarantined (HTTP 422)
  if (!policy.valid) {
    return res.status(422).json({
      status: 'REJECTED_BY_GATEWAY',
      policyDecision: 'REJECTED',
      tier: policy.tier,
      reasons: policy.reasons,
      sanitizationAlerts: policy.sanitizationAlerts,
      intent
    });
  }

  // Case 1: Tier 1 Micro-Transaction (HTTP 200 OK)
  if (policy.tier === 1) {
    const mandate = policyEngine.getMandate(intent.mandateId);
    policyEngine.deductSpend(intent.mandateId, intent.total, intent.currency);

    // Forward to P4 Payments on Port 5000
    const payment = await forwardOrderToPayments(intent, mandate);

    return res.status(200).json({
      status: 'ACCEPTED_AND_CAPTURED',
      policyDecision: 'APPROVED',
      tier: 1,
      orderId: payment.orderId,
      captureId: payment.captureId,
      reasons: policy.reasons,
      intent: {
        ...intent,
        status: 'EXECUTED',
        paypalOrderId: payment.orderId,
        paypalCaptureId: payment.captureId
      }
    });
  }

  // Case 2: Tier 2 Discretionary / Threshold Exceeded (HTTP 202 Accepted)
  // Paused for user biometric confirmation
  policyEngine.savePendingIntent(intent);

  return res.status(202).json({
    status: 'HELD_FOR_CONFIRMATION',
    policyDecision: 'CONFIRMATION_REQUIRED',
    tier: 2,
    reasons: policy.reasons,
    intent
  });
});

// -------------------------------------------------------------
// Two-Phase Commit Biometric Confirmation (Layer 1 Client -> Layer 3 Gateway)
// -------------------------------------------------------------

// List pending intents awaiting biometric approval
app.get('/intents/pending', (req, res) => {
  res.json({
    count: policyEngine.getAllPendingIntents().length,
    pendingIntents: policyEngine.getAllPendingIntents()
  });
});

// Biometric confirmation endpoint
app.post('/intents/:id/confirm', async (req, res) => {
  const { id } = req.params;
  const { approved, authMethod, signatureHex } = req.body;

  const pendingIntent = policyEngine.getPendingIntent(id);

  if (approved) {
    let orderId = `PAYPAL-ORD-${Date.now()}`;
    let captureId = `PAYPAL-CAP-${Date.now()}`;

    if (pendingIntent) {
      const mandate = policyEngine.getMandate(pendingIntent.mandateId);
      policyEngine.deductSpend(pendingIntent.mandateId, pendingIntent.total, pendingIntent.currency);

      // Execute order capture with P4
      const payment = await forwardOrderToPayments(pendingIntent, mandate);
      orderId = payment.orderId;
      captureId = payment.captureId;

      policyEngine.removePendingIntent(id);
    }

    return res.status(200).json({
      status: 'CAPTURED_VIA_BIOMETRIC',
      intentId: id,
      authMethod: authMethod || 'WebAuthn_Passkey',
      orderId,
      captureId,
      intent: pendingIntent ? {
        ...pendingIntent,
        status: 'EXECUTED',
        paypalOrderId: orderId,
        paypalCaptureId: captureId
      } : undefined
    });
  } else {
    // User rejected discretionary purchase
    if (pendingIntent) {
      policyEngine.removePendingIntent(id);
    }

    return res.status(200).json({
      status: 'USER_REJECTED',
      intentId: id,
      reasons: ['User rejected discretionary spend at biometric prompt.']
    });
  }
});

// -------------------------------------------------------------
// Start Express Server
// -------------------------------------------------------------
export { app, defaultMandate };

const isTestEnv = process.env.NODE_ENV === 'test';
if (!isTestEnv && !process.env.CLOUD_RUN_UNIFIED) {
  const HOST = process.env.HOST || '0.0.0.0';
  app.listen(Number(PORT), HOST, () => {
    console.log(`\n🛡 SafeAgent Policy Gateway (P3) listening on http://${HOST}:${PORT}`);
    console.log(`   Deterministic Trust Boundary active with default seed mandate: ${defaultMandate.mandateId}`);
    console.log(`   P4 Payments Service URL: ${process.env.PAYMENTS_SERVICE_URL || 'http://localhost:5000'}\n`);
  });
}
