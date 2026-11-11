import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { computeMerkleRoot, ImmutableLedger, ledger as defaultLedger } from './ledger.js';
import { PayPalService, paypalService as defaultPayPalService, SettlementResult } from './paypalClient.js';
import { CheckoutIntent, MerkleDisputePackage, SpendingMandate } from '../../shared/dist/index.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

interface SettledIntentContext {
  intent: CheckoutIntent;
  settlement: SettlementResult;
  mandate?: SpendingMandate;
  mlDsaSignatureHex?: string;
  publicKeyHex?: string;
}

export interface PaymentsAppDeps {
  ledger?: ImmutableLedger;
  paypalService?: PayPalService;
  sseHeartbeatMs?: number;
}

function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
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
  const totalIsValid = typeof intent.total === 'number' && Number.isFinite(intent.total) && intent.total > 0;
  if (!totalIsValid) {
    errors.push('total must be a finite number greater than 0');
  }
  const subtotalIsValid =
    intent.subtotal === undefined ||
    (typeof intent.subtotal === 'number' && Number.isFinite(intent.subtotal) && intent.subtotal >= 0);
  if (!subtotalIsValid) {
    errors.push('subtotal must be a non-negative finite number');
  }
  const taxIsValid =
    intent.tax === undefined ||
    (typeof intent.tax === 'number' && Number.isFinite(intent.tax) && intent.tax >= 0);
  if (!taxIsValid) {
    errors.push('tax must be a non-negative finite number');
  }

  let itemsValid = false;
  let itemsSubtotalCents = 0;
  if (!Array.isArray(intent.items) || intent.items.length === 0) {
    errors.push('items must be a non-empty array');
  } else {
    itemsValid = true;
    intent.items.forEach((item, idx) => {
      if (!item || typeof item !== 'object') {
        errors.push(`items[${idx}] must be an object`);
        itemsValid = false;
        return;
      }
      const priceOk = typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0;
      if (!priceOk) {
        errors.push(`items[${idx}].price must be a non-negative finite number`);
        itemsValid = false;
      }
      const qtyOk = typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0;
      if (!qtyOk) {
        errors.push(`items[${idx}].quantity must be a finite number greater than 0`);
        itemsValid = false;
      }
      if (priceOk && qtyOk) {
        itemsSubtotalCents += toCents(item.price * item.quantity);
      }
    });
  }

  if (itemsValid && subtotalIsValid && intent.subtotal !== undefined) {
    if (toCents(intent.subtotal) !== itemsSubtotalCents) {
      errors.push('subtotal must equal the sum of item price * quantity');
    }
  }

  if (itemsValid && totalIsValid && subtotalIsValid && taxIsValid) {
    const subtotalCents = intent.subtotal !== undefined ? toCents(intent.subtotal) : itemsSubtotalCents;
    const taxCents = intent.tax !== undefined ? toCents(intent.tax) : 0;
    if (toCents(intent.total!) !== subtotalCents + taxCents) {
      errors.push('total must equal subtotal + tax');
    }
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

function getSettlementDedupKey(captureId?: string, orderId?: string, intentId?: string): string | null {
  const cleanCapture = typeof captureId === 'string' ? captureId.trim() : '';
  if (cleanCapture.length > 0) {
    return `capture:${cleanCapture}`;
  }
  const cleanOrder = typeof orderId === 'string' ? orderId.trim() : '';
  const cleanIntent = typeof intentId === 'string' ? intentId.trim() : '';
  if (cleanOrder.length > 0 && cleanIntent.length > 0) {
    return `order:${cleanOrder}:intent:${cleanIntent}`;
  }
  if (cleanOrder.length > 0) {
    return `order:${cleanOrder}`;
  }
  if (cleanIntent.length > 0) {
    return `intent:${cleanIntent}`;
  }
  return null;
}

export function createPaymentsApp(deps: PaymentsAppDeps = {}) {
  const app = express();
  const ledger = deps.ledger ?? defaultLedger;
  const paypalService = deps.paypalService ?? defaultPayPalService;
  const sseHeartbeatMs = deps.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;

  app.use(cors());

  // List of connected SSE clients (e.g. P1 AG Grid dashboard)
  let sseClients: Response[] = [];

  // Idempotency cache, dispute context store, webhook deduplication, and order->intent correlation map
  const settledOrders = new Map<string, SettlementResult>();
  const settledContexts = new Map<string, SettledIntentContext>();
  const inFlightOrders = new Map<string, Promise<SettlementResult>>();
  const orderToIntentMap = new Map<string, { intentId: string; mandateId?: string }>();
  const mandatesById = new Map<string, SpendingMandate>();
  const processedWebhookEvents = new Map<string, string>();
  const settledWebhookKeys = new Set<string>();

  function broadcastSSE(event: any) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    sseClients.forEach(res => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(data);
      } catch {
        // Ignore broken client stream; close handler removes it
      }
    });
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

  // Seed initial ledger state if empty
  if (ledger.getAll().length === 0) {
    ledger.append('MANDATE_CREATED', {
      mandateId: seededMandate.mandateId,
      maxSpend: seededMandate.maxSpend,
      tier1Limit: seededMandate.tier1Limit,
      currency: seededMandate.currency,
      whitelist: seededMandate.merchantWhitelist
    }, seededMandate.mandateId);
  }

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

    const eventType: string =
      typeof webhookEvent.event_type === 'string' && webhookEvent.event_type.trim().length > 0
        ? webhookEvent.event_type.trim()
        : 'UNKNOWN';
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
      webhookEvent.resource?.reference_id ||
      webhookEvent.resource?.invoice_id;
    const mandateId: string | undefined = mapped?.mandateId || webhookEvent.mandateId;

    const webhookId =
      typeof webhookEvent.id === 'string' && webhookEvent.id.trim().length > 0
        ? webhookEvent.id.trim()
        : undefined;

    try {
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

      const existingWebhookEventId = webhookId ? processedWebhookEvents.get(webhookId) : undefined;
      if (existingWebhookEventId) {
        return res.status(200).json({
          received: true,
          verified: true,
          duplicate: true,
          verification: verification.status,
          webhookEventId: existingWebhookEventId,
          settledEventId: null
        });
      }

      const verifiedEvt = ledger.append('WEBHOOK_VERIFIED', {
        eventType,
        webhookEventId: webhookId || null,
        orderId: orderId || null,
        captureId: captureId || null,
        verification: verification.status,
        rawBodySha256: createHash('sha256').update(rawBuffer).digest('hex'),
        resource: webhookEvent.resource
      }, mandateId, intentId);
      broadcastSSE(verifiedEvt);

      const isSettlementEvent = eventType === 'PAYMENT.CAPTURE.COMPLETED';
      const settlementKey = isSettlementEvent
        ? getSettlementDedupKey(captureId, orderId, intentId)
        : null;
      const isDuplicateSettlement = Boolean(
        isSettlementEvent && settlementKey && settledWebhookKeys.has(settlementKey)
      );

      const settledEvt =
        isSettlementEvent && settlementKey !== null && !isDuplicateSettlement
          ? ledger.append('SETTLED', {
              eventType,
              orderId: orderId || null,
              captureId: captureId || null,
              intentId: intentId || null,
              verification: verification.status,
              settledAt: new Date().toISOString()
            }, mandateId, intentId)
          : null;

      if (settledEvt) {
        if (settlementKey) {
          settledWebhookKeys.add(settlementKey);
        }
        broadcastSSE(settledEvt);
      }

      if (webhookId) {
        processedWebhookEvents.set(webhookId, verifiedEvt.eventId);
      }

      return res.status(200).json({
        received: true,
        verified: true,
        ...(isDuplicateSettlement ? { duplicate: true } : {}),
        verification: verification.status,
        webhookEventId: verifiedEvt.eventId,
        settledEventId: settledEvt ? settledEvt.eventId : null
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Webhook processing failed' });
    }
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
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, sseHeartbeatMs);
    heartbeat.unref?.();

    res.on('close', () => {
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
    const {
      mandate: attachedMandate,
      mlDsaSignatureHex: attachedSig,
      signatureHex: legacySig,
      publicKeyHex: attachedPubKey,
      ...cleanIntent
    } = rawBody;
    const intent: CheckoutIntent = cleanIntent;

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
        mandate: attachedMandate,
        mlDsaSignatureHex: attachedSig || legacySig,
        publicKeyHex: attachedPubKey
      });
      if (attachedMandate?.mandateId) {
        mandatesById.set(attachedMandate.mandateId, attachedMandate);
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

  return { app, ledger, paypalService };
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const { app } = createPaymentsApp({ ledger: defaultLedger, paypalService: defaultPayPalService });
  app.listen(PORT, () => {
    console.log(`\n💳 SafeAgent Payments & Telemetry Service (P4) listening on http://localhost:${PORT}`);
    console.log(`   Real-time SSE Stream ready at: http://localhost:${PORT}/ledger/stream\n`);
  });
}

