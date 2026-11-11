import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutIntent, MerkleDisputePackage } from '../../shared/dist/index.js';
import { computeMerkleRoot, ImmutableLedger } from '../src/ledger.js';
import { PayPalService } from '../src/paypalClient.js';
import { createPaymentsApp } from '../src/server.js';

interface TestServerHandle {
  baseUrl: string;
  ledger: ImmutableLedger;
  paypalService: PayPalService;
  close: () => Promise<void>;
}

async function startIsolatedServer(): Promise<TestServerHandle> {
  const testLedger = new ImmutableLedger();
  const testPayPal = new PayPalService();
  const { app } = createPaymentsApp({
    ledger: testLedger,
    paypalService: testPayPal,
    sseHeartbeatMs: 60_000
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    ledger: testLedger,
    paypalService: testPayPal,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

function makeIntent(overrides: Partial<CheckoutIntent> = {}): CheckoutIntent {
  return {
    intentId: 'intent_http_001',
    mandateId: 'mandate_active_001',
    merchant: 'Shopify-TechStore',
    items: [
      { id: 'item_1', name: 'Ergonomic Wireless Mouse', price: 1499, quantity: 1 }
    ],
    subtotal: 1499,
    tax: 269.82,
    total: 1768.82,
    currency: 'INR',
    nonce: 'nonce_http_001',
    status: 'VALIDATED',
    ...overrides
  };
}

describe('Payments HTTP server integration (isolated per test)', () => {
  const originalEnv = { ...process.env };
  let activeServer: TestServerHandle | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    if (activeServer) {
      await activeServer.close();
      activeServer = null;
    }
  });

  it('rejects invalid request bodies with HTTP 400', async () => {
    activeServer = await startIsolatedServer();

    const res = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: '',
        total: -10,
        items: [],
        currency: '',
        tax: -5
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe('Invalid CheckoutIntent payload');
    expect(body.details.length).toBeGreaterThanOrEqual(4);

    // Mismatched subtotal and mismatched total
    const mismatchRes = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        makeIntent({
          intentId: 'intent_bad_math',
          items: [{ id: 'i1', name: 'Cable', price: 100, quantity: 2 }],
          subtotal: 150,
          tax: 10,
          total: 250
        })
      )
    });
    expect(mismatchRes.status).toBe(400);
    const mismatchBody = (await mismatchRes.json()) as any;
    expect(mismatchBody.error).toBe('Invalid CheckoutIntent payload');
    expect(mismatchBody.details).toContain('subtotal must equal the sum of item price * quantity');
    expect(mismatchBody.details).toContain('total must equal subtotal + tax');
  });

  it('settles Tier 1 simulated Vault order and handles duplicate and concurrent replays without double-capturing', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    activeServer = await startIsolatedServer();
    const captureSpy = vi.spyOn(activeServer.paypalService, 'createAndCaptureOrder');
    const intent = makeIntent();

    // Concurrent requests for the same intentId
    const [r1, r2] = await Promise.all([
      fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intent)
      }),
      fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intent)
      })
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const s1 = (await r1.json()) as any;
    const s2 = (await r2.json()) as any;

    expect(s1.tier).toBe(1);
    expect(s1.settlementPath).toBe('VAULT_ZERO_TOUCH');
    expect(s1.vaultStatus).toBe('SIMULATED');
    expect(s2.orderId).toBe(s1.orderId);
    expect(s2.captureId).toBe(s1.captureId);

    // Subsequent duplicate request
    const r3 = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent)
    });
    const s3 = (await r3.json()) as any;
    expect(s3.orderId).toBe(s1.orderId);
    expect(captureSpy).toHaveBeenCalledTimes(1);

    const events = activeServer.ledger.getByIntent(intent.intentId);
    expect(events.map(e => e.type)).toEqual([
      'PAYPAL_ORDER_CREATED',
      'PAYPAL_CAPTURE_COMPLETED',
      'PAYPAL_CAPTURE_COMPLETED',
      'PAYPAL_CAPTURE_COMPLETED'
    ]);
    expect(events[2].data.detail).toBe('IDEMPOTENT_REPLAY');
    expect(events[3].data.detail).toBe('IDEMPOTENT_REPLAY');
  });

  it('rejects unverified webhooks with 401 and SECURITY_ALERT when PAYPAL_WEBHOOK_ID is set, and accepts simulation webhooks when unset', async () => {
    activeServer = await startIsolatedServer();

    // 1. Simulation mode (no PAYPAL_WEBHOOK_ID) -> 200 SIMULATED_SKIPPED
    delete process.env.PAYPAL_WEBHOOK_ID;
    const simRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-SIM-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        intentId: 'intent_sim_wh',
        resource: { id: 'CAP-SIM-1', status: 'COMPLETED' }
      })
    });
    expect(simRes.status).toBe(200);
    const simBody = (await simRes.json()) as any;
    expect(simBody.verification).toBe('SIMULATED_SKIPPED');

    // 2. Webhook ID set, missing/bad signature -> 401 + SECURITY_ALERT
    process.env.PAYPAL_WEBHOOK_ID = 'WH-LIVE-TEST';
    const failRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYPAL-TRANSMISSION-ID': 'tx-bad',
        'PAYPAL-TRANSMISSION-SIG': 'bad-sig'
      },
      body: JSON.stringify({
        id: 'WH-BAD-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'CAP-BAD-1' }
      })
    });
    expect(failRes.status).toBe(401);

    const alerts = activeServer.ledger.getAll().filter(e => e.type === 'SECURITY_ALERT');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data.alertType).toBe('WEBHOOK_VERIFICATION_FAILED');
  });

  it('generates Merkle dispute package for settled intent, returns 404 for unknown intent, and verifies ledger chain', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    activeServer = await startIsolatedServer();
    const intent = makeIntent({ intentId: 'intent_dispute_001' });

    const missingRes = await fetch(`${activeServer.baseUrl}/disputes/unknown_intent/package`);
    expect(missingRes.status).toBe(404);

    const settleRes = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent)
    });
    const settlement = (await settleRes.json()) as any;

    const pkgRes = await fetch(`${activeServer.baseUrl}/disputes/${intent.intentId}/package`);
    expect(pkgRes.status).toBe(200);
    const pkg = (await pkgRes.json()) as MerkleDisputePackage;

    expect(pkg.intentId).toBe(intent.intentId);
    expect(pkg.paypalOrderId).toBe(settlement.orderId);
    expect(pkg.paypalCaptureId).toBe(settlement.captureId);
    expect(pkg.ledgerProofChain).toHaveLength(2);
    expect(pkg.merkleRoot).toBe(computeMerkleRoot(pkg.ledgerProofChain.map(e => e.hash)));
    expect(pkg.mlDsaSignatureHex).toContain('PLACEHOLDER_UNAVAILABLE');
    expect(pkg.publicKeyHex).toContain('PLACEHOLDER_UNAVAILABLE');

    const verifyRes = await fetch(`${activeServer.baseUrl}/ledger/verify`);
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as any;
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.eventCount).toBe(3); // seed MANDATE_CREATED + ORDER_CREATED + CAPTURE_COMPLETED
    expect(verifyBody.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('streams initial and live ledger events over SSE with CORS headers', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    activeServer = await startIsolatedServer();
    const controller = new AbortController();

    try {
      const sseRes = await fetch(`${activeServer.baseUrl}/ledger/stream`, {
        signal: controller.signal
      });
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
      expect(sseRes.headers.get('access-control-allow-origin')).toBe('*');

      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();

      // Read initial seeded MANDATE_CREATED event
      const firstChunk = await reader.read();
      const initialText = decoder.decode(firstChunk.value);
      expect(initialText).toContain('MANDATE_CREATED');

      // Trigger a live settlement and confirm SSE broadcasts it
      await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeIntent({ intentId: 'intent_sse_live' }))
      });

      let collected = '';
      for (let i = 0; i < 4; i++) {
        const next = await reader.read();
        collected += decoder.decode(next.value);
        if (collected.includes('PAYPAL_CAPTURE_COMPLETED')) break;
      }

      expect(collected).toContain('PAYPAL_ORDER_CREATED');
      expect(collected).toContain('PAYPAL_CAPTURE_COMPLETED');
      expect(collected).toContain('intent_sse_live');
    } finally {
      controller.abort();
    }
  });
});
