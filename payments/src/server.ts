import { createHash } from 'node:crypto';
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { computeMerkleRoot, ledger } from './ledger.js';
import { paypalService, SettlementResult } from './paypalClient.js';
import { CheckoutIntent, MerkleDisputePackage, SpendingMandate } from '../../shared/dist/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const SSE_HEARTBEAT_MS = 15_000;

app.use(cors());

// List of connected SSE clients (e.g. P1 AG Grid dashboard)
let sseClients: Response[] = [];

interface SettledIntentContext {
  intent: CheckoutIntent;
  settlement: SettlementResult;
  mandate?: SpendingMandate;
  mlDsaSignatureHex?: string;
  publicKeyHex?: string;
}

// Idempotency cache, dispute context store, and order->intent correlation map
const settledOrders = new Map<string, SettlementResult>();
const settledContexts = new Map<string, SettledIntentContext>();
const inFlightOrders = new Map<string, Promise<SettlementResult>>();
const orderToIntentMap = new Map<string, { intentId: string; mandateId?: string }>();
const mandatesById = new Map<string, SpendingMandate>();

function broadcastSSE(event: any) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(data);
    } catch {
      // Ignore broken client stream; close handler removes it
    }
  });
}

function validateCheckoutIntent(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const intent = body as Partial<CheckoutIntent>;

  if (typeof intent.intentId !== 'string' || intent.intentId.trim().length === 0) {
    errors.push('intentId must be a non-empty string');
  }
  if (typeof intent.total !== 'number' || !Number.isFinite(intent.total) || intent.total <= 0) {
    errors.push('total must be a finite number greater than 0');
  }
  if (!Array.isArray(intent.items) || intent.items.length === 0) {
    errors.push('items must be a non-empty array');
  } else {
    intent.items.forEach((item, idx) => {
      if (!item || typeof item !== 'object') {
        errors.push(`items[${idx}] must be an object`);
        return;
      }
      if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) {
        errors.push(`items[${idx}].price must be a non-negative finite number`);
      }
      if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        errors.push(`items[${idx}].quantity must be a finite number greater than 0`);
      }
    });
  }
  if (typeof intent.currency !== 'string' || intent.currency.trim().length === 0) {
    errors.push('currency must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

function extractHeaderMap(req: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      headers[key.toLowerCase()] = value[0];
    }
  }
  return headers;
}

const seededMandate: SpendingMandate = {
  mandateId: 'mandate_active_001',
  userId: 'user_demo_789',
  maxSpend: 15000.0,
  currency: 'INR',
  ttlHours: 24,
  createdAt: Date.now(),
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  merchantWhitelist: ['Amazon-India', 'Flipkart', 'Croma-Retail', 'Myntra', 'Shopify-India', 'Shopify-TechStore', 'Medusa-OfficePro'],
  tier1Limit: 2500.0,
  remainingBalance: 15000.0,
  nonce: 'seed_nonce_001'
};
mandatesById.set(seededMandate.mandateId, seededMandate);

// Seed initial ledger state
ledger.append('MANDATE_CREATED', {
  mandateId: seededMandate.mandateId,
  maxSpend: seededMandate.maxSpend,
  tier1Limit: seededMandate.tier1Limit,
  currency: seededMandate.currency,
  whitelist: seededMandate.merchantWhitelist
}, seededMandate.mandateId);

// Webhook listener (registered BEFORE express.json() so raw body bytes are preserved)
app.post('/webhooks/paypal', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBuffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

  const rawBody = rawBuffer.toString('utf8');
  let webhookEvent: Record<string, any>;
  try {
    webhookEvent = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON webhook payload' });
  }

  if (!webhookEvent || typeof webhookEvent !== 'object' || Array.isArray(webhookEvent)) {
    return res.status(400).json({ error: 'Webhook payload must be a JSON object' });
  }

  const eventType: string = webhookEvent.event_type || 'PAYMENT.CAPTURE.COMPLETED';
  const orderId: string | undefined =
    webhookEvent.resource?.supplementary_data?.related_ids?.order_id ||
    webhookEvent.orderId ||
    (eventType.startsWith('CHECKOUT.ORDER') ? webhookEvent.resource?.id : undefined);
  const captureId: string | undefined =
    webhookEvent.captureId ||
    (eventType.startsWith('PAYMENT.CAPTURE') ? webhookEvent.resource?.id : undefined);

  const mapped =
    (orderId ? orderToIntentMap.get(orderId) : undefined) ||
    (captureId ? orderToIntentMap.get(captureId) : undefined);

  const intentId: string | undefined =
    mapped?.intentId ||
    webhookEvent.intentId ||
    webhookEvent.resource?.custom_id ||
    webhookEvent.resource?.reference_id;
  const mandateId: string | undefined = mapped?.mandateId || webhookEvent.mandateId;

  const verification = await paypalService.verifyWebhookSignature({
    headers: extractHeaderMap(req),
    webhookEvent
  });

  if (!verification.verified) {
    const alertEvt = ledger.append('SECURITY_ALERT', {
      alertType: 'WEBHOOK_VERIFICATION_FAILED',
      verification: verification.status,
      reason: verification.reason || 'Webhook signature verification failed',
      eventType,
      transmissionId: req.header('paypal-transmission-id') || null
    }, mandateId, intentId);
    broadcastSSE(alertEvt);

    return res.status(401).json({
      received: false,
      verified: false,
      error: 'Webhook signature verification failed',
      reason: verification.reason
    });
  }

  const verifiedEvt = ledger.append('WEBHOOK_VERIFIED', {
    eventType,
    webhookEventId: webhookEvent.id || null,
    orderId: orderId || null,
    captureId: captureId || null,
    verification: verification.status,
    rawBodySha256: createHash('sha256').update(rawBuffer).digest('hex'),
    resource: webhookEvent.resource
  }, mandateId, intentId);
  broadcastSSE(verifiedEvt);

  const settledEvt = ledger.append('SETTLED', {
    eventType,
    orderId: orderId || null,
    captureId: captureId || null,
    intentId: intentId || null,
    verification: verification.status,
    settledAt: new Date().toISOString()
  }, mandateId, intentId);
  broadcastSSE(settledEvt);

  return res.status(200).json({
    received: true,
    verified: true,
    verification: verification.status,
    webhookEventId: verifiedEvt.eventId,
    settledEventId: settledEvt.eventId
  });
});

app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SafeAgent Payments & Ledger Service (P4)',
    ledgerEventsCount: ledger.getAll().length
  });
});

// SSE Stream for Real-Time AG Grid Telemetry (CORS-safe + 15s heartbeat)
app.get('/ledger/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send current history on initial connect
  for (const evt of ledger.getAll()) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  sseClients.push(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Retrieve full ledger
app.get('/ledger/events', (req, res) => {
  res.json({
    count: ledger.getAll().length,
    events: ledger.getAll(),
    integrityValid: ledger.verifyIntegrity()
  });
});

// Verify hash-chain integrity
app.get('/ledger/verify', (req, res) => {
  res.json(ledger.getVerificationStatus());
});

// Export Merkle dispute package for a settled intent
app.get('/disputes/:intentId/package', (req, res) => {
  const { intentId } = req.params;
  const context = settledContexts.get(intentId);

  if (!context) {
    return res.status(404).json({
      error: `No settled record found for intentId: ${intentId}`
    });
  }

  const intentEvents = ledger.getByIntent(intentId);
  const ledgerProofChain = intentEvents.map(evt => ({
    index: evt.index,
    hash: evt.hash,
    type: evt.type,
    timestamp: evt.timestamp
  }));

  const merkleRoot = computeMerkleRoot(ledgerProofChain.map(entry => entry.hash));
  const mandateId = context.intent.mandateId || 'PLACEHOLDER_UNAVAILABLE_MANDATE_ID';

  const fallbackMandate: SpendingMandate = mandatesById.get(mandateId) || {
    mandateId,
    userId: 'PLACEHOLDER_UNAVAILABLE_USER_ID',
    maxSpend: 0,
    currency: context.intent.currency,
    ttlHours: 0,
    createdAt: 0,
    expiresAt: 0,
    merchantWhitelist: context.intent.merchant ? [context.intent.merchant] : ['PLACEHOLDER_UNAVAILABLE_MERCHANT'],
    tier1Limit: 2500,
    remainingBalance: 0,
    nonce: 'PLACEHOLDER_UNAVAILABLE_NONCE'
  };

  const disputePackage: MerkleDisputePackage = {
    disputeId: `DSP-${intentId}-${Date.now()}`,
    intentId,
    mandateId,
    mandate: context.mandate || fallbackMandate,
    intent: {
      ...context.intent,
      status: 'EXECUTED',
      paypalOrderId: context.settlement.orderId,
      paypalCaptureId: context.settlement.captureId
    },
    mlDsaSignatureHex: context.mlDsaSignatureHex || 'PLACEHOLDER_UNAVAILABLE_ML_DSA_SIGNATURE_HEX',
    publicKeyHex: context.publicKeyHex || 'PLACEHOLDER_UNAVAILABLE_PUBLIC_KEY_HEX',
    paypalOrderId: context.settlement.orderId,
    paypalCaptureId: context.settlement.captureId,
    ledgerProofChain,
    merkleRoot,
    generatedAt: new Date().toISOString()
  };

  return res.json(disputePackage);
});

function recordIdempotentReplay(intent: CheckoutIntent, cached: SettlementResult) {
  const replayEvt = ledger.append('PAYPAL_CAPTURE_COMPLETED', {
    detail: 'IDEMPOTENT_REPLAY',
    idempotentReplay: true,
    intentId: intent.intentId,
    orderId: cached.orderId,
    captureId: cached.captureId,
    status: cached.status,
    amount: cached.amount,
    currency: cached.currency,
    mode: cached.mode,
    tier: cached.tier,
    settlementPath: cached.settlementPath,
    ...(cached.vaultStatus ? { vaultStatus: cached.vaultStatus } : {})
  }, intent.mandateId, intent.intentId);
  broadcastSSE(replayEvt);
}

// Create and capture order
app.post('/orders/create-and-capture', async (req, res) => {
  const validation = validateCheckoutIntent(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid CheckoutIntent payload',
      details: validation.errors
    });
  }

  const rawBody = req.body as CheckoutIntent & {
    mandate?: SpendingMandate;
    mlDsaSignatureHex?: string;
    signatureHex?: string;
    publicKeyHex?: string;
  };
  const intent: CheckoutIntent = rawBody;

  // Idempotency check: return cached result and record IDEMPOTENT_REPLAY without double-capturing
  const cachedSettlement = settledOrders.get(intent.intentId);
  if (cachedSettlement) {
    recordIdempotentReplay(intent, cachedSettlement);
    return res.json(cachedSettlement);
  }

  const existingInFlight = inFlightOrders.get(intent.intentId);
  if (existingInFlight) {
    try {
      const settlement = await existingInFlight;
      recordIdempotentReplay(intent, settlement);
      return res.json(settlement);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  const routing = paypalService.determineSettlementRouting(intent);

  const settlementPromise = (async () => {
    const orderCreatedEvt = ledger.append('PAYPAL_ORDER_CREATED', {
      intentId: intent.intentId,
      merchant: intent.merchant,
      total: intent.total,
      currency: intent.currency,
      tier: routing.tier,
      settlementPath: routing.settlementPath
    }, intent.mandateId, intent.intentId);
    broadcastSSE(orderCreatedEvt);

    const settlement = await paypalService.createAndCaptureOrder(intent);
    settledOrders.set(intent.intentId, settlement);
    settledContexts.set(intent.intentId, {
      intent: { ...intent },
      settlement,
      mandate: rawBody.mandate,
      mlDsaSignatureHex: rawBody.mlDsaSignatureHex || rawBody.signatureHex,
      publicKeyHex: rawBody.publicKeyHex
    });
    if (rawBody.mandate?.mandateId) {
      mandatesById.set(rawBody.mandate.mandateId, rawBody.mandate);
    }
    orderToIntentMap.set(settlement.orderId, { intentId: intent.intentId, mandateId: intent.mandateId });
    orderToIntentMap.set(settlement.captureId, { intentId: intent.intentId, mandateId: intent.mandateId });

    const capturedEvt = ledger.append('PAYPAL_CAPTURE_COMPLETED', {
      intentId: intent.intentId,
      orderId: settlement.orderId,
      captureId: settlement.captureId,
      status: settlement.status,
      amount: settlement.amount,
      currency: settlement.currency,
      mode: settlement.mode,
      tier: settlement.tier,
      settlementPath: settlement.settlementPath,
      ...(settlement.vaultStatus ? { vaultStatus: settlement.vaultStatus } : {}),
      ...(settlement.originalCurrency
        ? { originalCurrency: settlement.originalCurrency, originalAmount: settlement.originalAmount }
        : {})
    }, intent.mandateId, intent.intentId);
    broadcastSSE(capturedEvt);

    return settlement;
  })();

  inFlightOrders.set(intent.intentId, settlementPromise);

  try {
    const settlement = await settlementPromise;
    return res.json(settlement);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  } finally {
    inFlightOrders.delete(intent.intentId);
  }
});

app.listen(PORT, () => {
  console.log(`\n💳 SafeAgent Payments & Telemetry Service (P4) listening on http://localhost:${PORT}`);
  console.log(`   Real-time SSE Stream ready at: http://localhost:${PORT}/ledger/stream\n`);
});

