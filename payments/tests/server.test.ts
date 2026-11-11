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

async function startIsolatedServer(sseHeartbeatMs = 60_000): Promise<TestServerHandle> {
  const testLedger = new ImmutableLedger();
  const testPayPal = new PayPalService();
  const { app } = createPaymentsApp({
    ledger: testLedger,
    paypalService: testPayPal,
    sseHeartbeatMs
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

  it('does not cache failed settlement attempts so subsequent retry with same intentId succeeds', async () => {
    activeServer = await startIsolatedServer();
    const intent = makeIntent({ intentId: 'intent_retry_after_fail' });

    const spy = vi
      .spyOn(activeServer.paypalService, 'createAndCaptureOrder')
      .mockRejectedValueOnce(new Error('PayPal API 503 temporary outage'));

    const firstRes = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent)
    });
    expect(firstRes.status).toBe(500);
    const firstBody = (await firstRes.json()) as any;
    expect(firstBody.error).toContain('503');

    spy.mockRestore();

    const retryRes = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent)
    });
    expect(retryRes.status).toBe(200);
    const retryBody = (await retryRes.json()) as any;
    expect(retryBody.status).toBe('COMPLETED');
    expect(retryBody.orderId).toBeTruthy();
    expect(retryBody.captureId).toBeTruthy();
    expect(
      activeServer.ledger.getByIntent(intent.intentId).map(e => e.type)
    ).toEqual(['PAYPAL_ORDER_CREATED', 'PAYPAL_ORDER_CREATED', 'PAYPAL_CAPTURE_COMPLETED']);
  });

  it('only emits SETTLED for PAYMENT.CAPTURE.COMPLETED webhooks and rejects non-settlement/invalid payloads accurately', async () => {
    activeServer = await startIsolatedServer();

    const invalidJsonRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json'
    });
    expect(invalidJsonRes.status).toBe(400);

    // Non-settlement event in simulation mode records WEBHOOK_VERIFIED without SETTLED
    delete process.env.PAYPAL_WEBHOOK_ID;
    const deniedRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-DENIED-1',
        event_type: 'PAYMENT.CAPTURE.DENIED',
        intentId: 'intent_denied_wh',
        resource: { id: 'CAP-DENIED-1', status: 'DENIED' }
      })
    });
    expect(deniedRes.status).toBe(200);
    const deniedBody = (await deniedRes.json()) as any;
    expect(deniedBody.verified).toBe(true);
    expect(deniedBody.settledEventId).toBeNull();
    const deniedEvents = activeServer.ledger.getByIntent('intent_denied_wh');
    expect(deniedEvents.map(e => e.type)).toEqual(['WEBHOOK_VERIFIED']);

    // Live verification SUCCESS emits WEBHOOK_VERIFIED + SETTLED for PAYMENT.CAPTURE.COMPLETED
    process.env.PAYPAL_WEBHOOK_ID = 'WH-LIVE-TEST';
    vi.spyOn(activeServer.paypalService, 'verifyWebhookSignature').mockResolvedValueOnce({
      verified: true,
      status: 'SUCCESS'
    });
    const completedRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-LIVE-OK-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        intentId: 'intent_live_wh',
        resource: { id: 'CAP-LIVE-OK-1', status: 'COMPLETED' }
      })
    });
    expect(completedRes.status).toBe(200);
    const completedBody = (await completedRes.json()) as any;
    expect(completedBody.verification).toBe('SUCCESS');
    expect(typeof completedBody.settledEventId).toBe('string');
    expect(activeServer.ledger.getByIntent('intent_live_wh').map(e => e.type)).toEqual([
      'WEBHOOK_VERIFIED',
      'SETTLED'
    ]);
  });

  it('handles missing, blank, unknown, duplicate, and retry-after-failure webhooks accurately with isolated app state', async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    activeServer = await startIsolatedServer();

    // 1. Missing event_type -> UNKNOWN, does not settle
    const missingTypeRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'WH-MISSING-TYPE', intentId: 'intent_missing_type' })
    });
    expect(missingTypeRes.status).toBe(200);
    expect(((await missingTypeRes.json()) as any).settledEventId).toBeNull();
    const missingEvents = activeServer.ledger.getByIntent('intent_missing_type');
    expect(missingEvents.map(e => e.type)).toEqual(['WEBHOOK_VERIFIED']);
    expect(missingEvents[0].data.eventType).toBe('UNKNOWN');

    // 2. Blank event_type -> UNKNOWN, does not settle
    const blankTypeRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'WH-BLANK-TYPE', event_type: '   ', intentId: 'intent_blank_type' })
    });
    expect(blankTypeRes.status).toBe(200);
    expect(((await blankTypeRes.json()) as any).settledEventId).toBeNull();
    const blankEvents = activeServer.ledger.getByIntent('intent_blank_type');
    expect(blankEvents.map(e => e.type)).toEqual(['WEBHOOK_VERIFIED']);
    expect(blankEvents[0].data.eventType).toBe('UNKNOWN');

    // 3. Unknown & unrelated event types -> recorded as WEBHOOK_VERIFIED, do not settle
    const unknownTypeRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-UNKNOWN-TYPE',
        event_type: 'CUSTOMER.DISPUTE.CREATED',
        intentId: 'intent_unknown_type',
        resource: { id: 'DSP-1' }
      })
    });
    expect(unknownTypeRes.status).toBe(200);
    expect(((await unknownTypeRes.json()) as any).settledEventId).toBeNull();
    expect(activeServer.ledger.getByIntent('intent_unknown_type').map(e => e.type)).toEqual([
      'WEBHOOK_VERIFIED'
    ]);

    // 4. First PAYMENT.CAPTURE.COMPLETED settles; repeated identical webhook does not duplicate SETTLED
    const capPayload = {
      id: 'WH-DUP-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      intentId: 'intent_dup_cap',
      resource: { id: 'CAP-DUP-1', status: 'COMPLETED' }
    };
    const firstCapRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capPayload)
    });
    const firstCapBody = (await firstCapRes.json()) as any;
    expect(firstCapRes.status).toBe(200);
    expect(typeof firstCapBody.settledEventId).toBe('string');

    const identicalReplayRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(capPayload)
    });
    const identicalReplayBody = (await identicalReplayRes.json()) as any;
    expect(identicalReplayRes.status).toBe(200);
    expect(identicalReplayBody.duplicate).toBe(true);
    expect(identicalReplayBody.settledEventId).toBeNull();
    expect(identicalReplayBody.webhookEventId).toBe(firstCapBody.webhookEventId);

    // 5. Same captureId with a DIFFERENT webhook event ID still does not duplicate SETTLED
    const diffEventSameCapRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-DUP-2',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        intentId: 'intent_dup_cap',
        resource: { id: 'CAP-DUP-1', status: 'COMPLETED' }
      })
    });
    const diffEventSameCapBody = (await diffEventSameCapRes.json()) as any;
    expect(diffEventSameCapRes.status).toBe(200);
    expect(diffEventSameCapBody.duplicate).toBe(true);
    expect(diffEventSameCapBody.settledEventId).toBeNull();
    expect(activeServer.ledger.getByIntent('intent_dup_cap').map(e => e.type)).toEqual([
      'WEBHOOK_VERIFIED',
      'SETTLED',
      'WEBHOOK_VERIFIED'
    ]);

    // 6. Fallback dedup when captureId is missing (uses order/intent fallback key)
    const fallbackFirstRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-FALLBACK-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        orderId: 'ORD-FALLBACK-1',
        intentId: 'intent_fallback_wh'
      })
    });
    expect(((await fallbackFirstRes.json()) as any).settledEventId).toBeTruthy();

    const fallbackDupRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-FALLBACK-2',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        orderId: 'ORD-FALLBACK-1',
        intentId: 'intent_fallback_wh'
      })
    });
    const fallbackDupBody = (await fallbackDupRes.json()) as any;
    expect(fallbackDupBody.duplicate).toBe(true);
    expect(fallbackDupBody.settledEventId).toBeNull();
    expect(
      activeServer.ledger.getByIntent('intent_fallback_wh').filter(e => e.type === 'SETTLED')
    ).toHaveLength(1);

    // 7. Failed signature verification does NOT poison dedup state for subsequent verified webhook
    process.env.PAYPAL_WEBHOOK_ID = 'WH-SECRET-CHECK';
    const forgedPayload = {
      id: 'WH-RETRY-SIG',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      intentId: 'intent_sig_retry',
      resource: { id: 'CAP-SIG-RETRY', status: 'COMPLETED' }
    };
    const forgedRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'PAYPAL-TRANSMISSION-SIG': 'bad' },
      body: JSON.stringify(forgedPayload)
    });
    expect(forgedRes.status).toBe(401);

    vi.spyOn(activeServer.paypalService, 'verifyWebhookSignature').mockResolvedValueOnce({
      verified: true,
      status: 'SUCCESS'
    });
    const verifiedAfterFailRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(forgedPayload)
    });
    const verifiedAfterFailBody = (await verifiedAfterFailRes.json()) as any;
    expect(verifiedAfterFailRes.status).toBe(200);
    expect(verifiedAfterFailBody.settledEventId).toBeTruthy();
    expect(activeServer.ledger.getByIntent('intent_sig_retry').map(e => e.type)).toEqual([
      'SECURITY_ALERT',
      'WEBHOOK_VERIFIED',
      'SETTLED'
    ]);

    // 8. Failed settlement ledger append does NOT block legitimate retry of the same webhook
    delete process.env.PAYPAL_WEBHOOK_ID;
    const origAppend = activeServer.ledger.append.bind(activeServer.ledger);
    vi.spyOn(activeServer.ledger, 'append').mockImplementation((type, ...rest) => {
      if (type === 'SETTLED') {
        throw new Error('Simulated ledger append failure');
      }
      return origAppend(type, ...rest);
    });
    const transientErrPayload = {
      id: 'WH-TRANSIENT-ERR',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      intentId: 'intent_transient_err',
      resource: { id: 'CAP-TRANSIENT-ERR', status: 'COMPLETED' }
    };
    const failedLedgerRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transientErrPayload)
    });
    expect(failedLedgerRes.status).toBe(500);
    vi.mocked(activeServer.ledger.append).mockRestore();

    const retryAfterErrRes = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transientErrPayload)
    });
    const retryAfterErrBody = (await retryAfterErrRes.json()) as any;
    expect(retryAfterErrRes.status).toBe(200);
    expect(retryAfterErrBody.duplicate).toBeUndefined();
    expect(retryAfterErrBody.settledEventId).toBeTruthy();
    expect(activeServer.ledger.getByIntent('intent_transient_err').map(e => e.type)).toEqual([
      'WEBHOOK_VERIFIED',
      'WEBHOOK_VERIFIED',
      'SETTLED'
    ]);

    // 9. Independent createPaymentsApp() instances do not share deduplication state
    delete process.env.PAYPAL_WEBHOOK_ID;
    const secondServer = await startIsolatedServer();
    try {
      const independentRes = await fetch(`${secondServer.baseUrl}/webhooks/paypal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(capPayload)
      });
      const independentBody = (await independentRes.json()) as any;
      expect(independentRes.status).toBe(200);
      expect(independentBody.duplicate).toBeUndefined();
      expect(independentBody.settledEventId).toBeTruthy();
      expect(secondServer.ledger.getByIntent('intent_dup_cap').map(e => e.type)).toEqual([
        'WEBHOOK_VERIFIED',
        'SETTLED'
      ]);
      expect(activeServer.ledger.getByIntent('intent_dup_cap').filter(e => e.type === 'SETTLED')).toHaveLength(1);
    } finally {
      await secondServer.close();
    }
  });

  it('records WEBHOOK_VERIFIED without appending SETTLED when capture, order, intent, and webhook IDs are all missing', async () => {
    delete process.env.PAYPAL_WEBHOOK_ID;
    activeServer = await startIsolatedServer();

    const uncorrelatablePayload = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { status: 'COMPLETED' }
    };

    const res1 = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uncorrelatablePayload)
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as any;
    expect(body1.verified).toBe(true);
    expect(body1.settledEventId).toBeNull();
    expect(typeof body1.webhookEventId).toBe('string');

    const res2 = await fetch(`${activeServer.baseUrl}/webhooks/paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uncorrelatablePayload)
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as any;
    expect(body2.verified).toBe(true);
    expect(body2.settledEventId).toBeNull();
    expect(typeof body2.webhookEventId).toBe('string');

    const allEvents = activeServer.ledger.getAll();
    expect(allEvents.filter(e => e.type === 'WEBHOOK_VERIFIED')).toHaveLength(2);
    expect(allEvents.filter(e => e.type === 'SETTLED')).toHaveLength(0);
    expect(allEvents.filter(e => e.intentId === undefined && e.type === 'SETTLED')).toHaveLength(0);
  });

  it('reconciles 2-decimal float items when subtotal is omitted and preserves supplied mandate/ML-DSA fields in dispute package', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    activeServer = await startIsolatedServer();
    const settleRes = await fetch(`${activeServer.baseUrl}/orders/create-and-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: 'intent_float_ctx',
        mandateId: 'mandate_custom_99',
        merchant: 'Shopify-TechStore',
        items: [
          { id: 'f1', name: 'Sticker A', price: 0.1, quantity: 2 },
          { id: 'f2', name: 'Sticker B', price: 0.1, quantity: 1 }
        ],
        tax: 0,
        total: 0.3,
        currency: 'USD',
        nonce: 'nonce_float_ctx',
        status: 'VALIDATED',
        mandate: {
          mandateId: 'mandate_custom_99',
          userId: 'user_custom_99',
          maxSpend: 500,
          currency: 'USD',
          ttlHours: 12,
          createdAt: 1000,
          expiresAt: 2000,
          merchantWhitelist: ['Shopify-TechStore'],
          tier1Limit: 50,
          remainingBalance: 500,
          nonce: 'm_nonce_99'
        },
        mlDsaSignatureHex: 'deadbeef01',
        publicKeyHex: 'cafebabe02'
      })
    });
    expect(settleRes.status).toBe(200);

    const pkgRes = await fetch(`${activeServer.baseUrl}/disputes/intent_float_ctx/package`);
    expect(pkgRes.status).toBe(200);
    const pkg = (await pkgRes.json()) as MerkleDisputePackage;
    expect(pkg.mandate.mandateId).toBe('mandate_custom_99');
    expect(pkg.mlDsaSignatureHex).toBe('deadbeef01');
    expect(pkg.publicKeyHex).toBe('cafebabe02');
    expect(pkg.merkleRoot).toBe(computeMerkleRoot(pkg.ledgerProofChain.map(e => e.hash)));
  });

  it('emits periodic SSE heartbeat comments, clears interval, removes closed client, and skips writes on subsequent broadcasts', async () => {
    const testLedger = new ImmutableLedger();
    const testPayPal = new PayPalService();
    const { app } = createPaymentsApp({
      ledger: testLedger,
      paypalService: testPayPal,
      sseHeartbeatMs: 25
    });

    const streamResponses: http.ServerResponse[] = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/ledger/stream') {
        streamResponses.push(res);
      }
      app(req, res);
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    try {
      const sseRes1 = await fetch(`${baseUrl}/ledger/stream`, { signal: controller1.signal });
      expect(sseRes1.status).toBe(200);
      expect(streamResponses).toHaveLength(1);
      const serverRes1 = streamResponses[0];
      const res1WriteSpy = vi.spyOn(serverRes1, 'write');

      // Capture the exact heartbeat interval handle created with sseHeartbeatMs=25
      const heartbeatCallIdx = setIntervalSpy.mock.calls.findIndex(call => call[1] === 25);
      expect(heartbeatCallIdx).toBeGreaterThanOrEqual(0);
      const heartbeatHandle = setIntervalSpy.mock.results[heartbeatCallIdx].value;

      const reader1 = sseRes1.body!.getReader();
      const decoder = new TextDecoder();
      let seen = '';
      for (let i = 0; i < 6; i++) {
        const chunk = await reader1.read();
        if (chunk.done) break;
        seen += decoder.decode(chunk.value);
        if (seen.includes(': ping')) break;
      }
      expect(seen).toContain(': ping');

      // Disconnect client 1 and await server-side 'close' deterministically
      const closedPromise = new Promise<void>(resolve => {
        serverRes1.once('close', () => resolve());
      });
      controller1.abort();
      await closedPromise;

      // Verify heartbeat interval for client 1 was cleared
      expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatHandle);

      // Instrument serverRes1 write & writableEnded getter after disconnect:
      // if serverRes1 remained in sseClients, broadcastSSE would evaluate res.writableEnded
      res1WriteSpy.mockClear();
      let writableEndedReadsAfterClose = 0;
      let proto: any = Object.getPrototypeOf(serverRes1);
      let desc: PropertyDescriptor | undefined;
      while (proto && !desc) {
        desc = Object.getOwnPropertyDescriptor(proto, 'writableEnded');
        proto = Object.getPrototypeOf(proto);
      }
      if (desc?.get) {
        const origGet = desc.get;
        Object.defineProperty(serverRes1, 'writableEnded', {
          configurable: true,
          get() {
            writableEndedReadsAfterClose += 1;
            return origGet.call(this);
          }
        });
      }

      // Connect a second active SSE client so we deterministically observe the next broadcast completing
      const sseRes2 = await fetch(`${baseUrl}/ledger/stream`, { signal: controller2.signal });
      const reader2 = sseRes2.body!.getReader();
      await reader2.read(); // consume initial backlog

      const postDisconnectRes = await fetch(`${baseUrl}/orders/create-and-capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeIntent({ intentId: 'intent_after_sse_close' }))
      });
      expect(postDisconnectRes.status).toBe(200);

      let client2Collected = '';
      for (let i = 0; i < 4; i++) {
        const next = await reader2.read();
        if (next.done) break;
        client2Collected += decoder.decode(next.value);
        if (client2Collected.includes('intent_after_sse_close')) break;
      }
      expect(client2Collected).toContain('intent_after_sse_close');

      // Disconnected response was removed from sseClients and never written to
      expect(writableEndedReadsAfterClose).toBe(0);
      expect(res1WriteSpy).not.toHaveBeenCalled();
    } finally {
      controller1.abort();
      controller2.abort();
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    }
  });
});
