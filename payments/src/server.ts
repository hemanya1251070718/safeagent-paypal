import express, { Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ledger } from './ledger.js';
import { paypalService } from './paypalClient.js';
import { CheckoutIntent } from '../../shared/dist/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// List of connected SSE clients (e.g. P1 AG Grid dashboard)
let sseClients: Response[] = [];

function broadcastSSE(event: any) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(res => res.write(data));
}

// Seed initial ledger state
ledger.append('MANDATE_CREATED', {
  mandateId: 'mandate_active_001',
  maxSpend: 15000.0,
  tier1Limit: 2500.0,
  currency: 'INR',
  whitelist: ['Amazon-India', 'Flipkart', 'Croma-Retail', 'Myntra', 'Shopify-India', 'Shopify-TechStore', 'Medusa-OfficePro']
}, 'mandate_active_001');

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'SafeAgent Payments & Ledger Service (P4)',
    ledgerEventsCount: ledger.getAll().length
  });
});

// SSE Stream for Real-Time AG Grid Telemetry
app.get('/ledger/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current history on initial connect
  for (const evt of ledger.getAll()) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  sseClients.push(res);

  req.on('close', () => {
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

// Create and capture order
app.post('/orders/create-and-capture', async (req, res) => {
  const intent = req.body as CheckoutIntent;
  if (!intent) {
    return res.status(400).json({ error: "Intent required." });
  }

  try {
    const orderCreatedEvt = ledger.append('PAYPAL_ORDER_CREATED', {
      intentId: intent.intentId,
      merchant: intent.merchant,
      total: intent.total
    }, intent.mandateId, intent.intentId);
    broadcastSSE(orderCreatedEvt);

    const settlement = await paypalService.createAndCaptureOrder(intent);

    const capturedEvt = ledger.append('PAYPAL_CAPTURE_COMPLETED', {
      intentId: intent.intentId,
      orderId: settlement.orderId,
      captureId: settlement.captureId,
      status: settlement.status,
      amount: settlement.amount,
      mode: settlement.mode
    }, intent.mandateId, intent.intentId);
    broadcastSSE(capturedEvt);

    res.json(settlement);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Webhook listener
app.post('/webhooks/paypal', (req, res) => {
  const webhookEvent = req.body;
  const evt = ledger.append('WEBHOOK_VERIFIED', {
    eventType: webhookEvent.event_type || 'PAYMENT.CAPTURE.COMPLETED',
    resource: webhookEvent.resource
  });
  broadcastSSE(evt);
  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`\n💳 SafeAgent Payments & Telemetry Service (P4) listening on http://localhost:${PORT}`);
  console.log(`   Real-time SSE Stream ready at: http://localhost:${PORT}/ledger/stream\n`);
});

