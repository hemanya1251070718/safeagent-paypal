import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { policyEngine } from './security/policyEngine.js';
import { verifyMandateSignature } from './security/pqcVerifier.js';
import { SpendingMandate, CheckoutIntent } from '../../shared/dist/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize a default mock mandate for instant local testing
const defaultMandate: SpendingMandate = {
  mandateId: "mandate_active_001",
  userId: "user_demo_789",
  maxSpend: 100.00,
  currency: "USD",
  ttlHours: 24,
  createdAt: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  merchantWhitelist: ["Shopify-TechStore", "Medusa-OfficePro"],
  tier1Limit: 30.00,
  remainingBalance: 100.00,
  nonce: "seed_nonce_001"
};
policyEngine.registerMandate(defaultMandate);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SafeAgent Policy Gateway (P3)',
    activeMandates: 1
  });
});

// Register Mandate
app.post('/mandates', (req, res) => {
  const { mandate, publicKeyHex, signatureHex } = req.body;
  if (!mandate) {
    return res.status(400).json({ error: "Mandate payload required." });
  }

  // If signature provided, verify with ML-DSA
  if (publicKeyHex && signatureHex) {
    const pqcResult = verifyMandateSignature(mandate, publicKeyHex, signatureHex);
    if (!pqcResult.valid) {
      return res.status(400).json({
        error: "INVALID_PQC_SIGNATURE",
        details: "Lattice signature failed verification against canonical mandate."
      });
    }
  }

  policyEngine.registerMandate(mandate);
  res.json({
    status: 'REGISTERED',
    mandateId: mandate.mandateId,
    remainingBalance: mandate.remainingBalance,
    tier1Limit: mandate.tier1Limit
  });
});

app.get('/mandates/:id', (req, res) => {
  const mandate = policyEngine.getMandate(req.params.id);
  if (!mandate) {
    return res.status(404).json({ error: "Mandate not found." });
  }
  res.json(mandate);
});

// Process Intent
app.post('/intents', async (req, res) => {
  const intent = req.body as CheckoutIntent;
  if (!intent || !intent.mandateId) {
    return res.status(400).json({ error: "Invalid intent payload." });
  }

  const policy = policyEngine.validateIntent(intent);

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

  if (policy.tier === 1) {
    // Tier 1: Auto-Execute
    policyEngine.deductSpend(intent.mandateId, intent.total);
    return res.json({
      status: 'ACCEPTED_AND_CAPTURED',
      policyDecision: 'APPROVED',
      tier: 1,
      orderId: `PAYPAL-ORD-${Date.now()}`,
      captureId: `PAYPAL-CAP-${Date.now()}`,
      reasons: policy.reasons,
      intent
    });
  } else {
    // Tier 2: Biometric confirmation required
    return res.status(202).json({
      status: 'HELD_FOR_CONFIRMATION',
      policyDecision: 'CONFIRMATION_REQUIRED',
      tier: 2,
      reasons: policy.reasons,
      intent
    });
  }
});

// Two-Phase Commit Biometric Confirmation
app.post('/intents/:id/confirm', (req, res) => {
  const { id } = req.params;
  const { approved, authMethod } = req.body;

  if (approved) {
    return res.json({
      status: 'CAPTURED_VIA_BIOMETRIC',
      intentId: id,
      authMethod: authMethod || 'WebAuthn_Passkey',
      orderId: `PAYPAL-ORD-${Date.now()}`,
      captureId: `PAYPAL-CAP-${Date.now()}`
    });
  } else {
    return res.json({
      status: 'USER_REJECTED',
      intentId: id
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🛡 SafeAgent Policy Gateway (P3) listening on http://localhost:${PORT}`);
  console.log(`   Deterministic Trust Boundary active with default seed mandate: ${defaultMandate.mandateId}\n`);
});

