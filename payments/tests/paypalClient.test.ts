import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutIntent } from '../../shared/dist/index.js';
import { PayPalService, reconcileOrderAmounts } from '../src/paypalClient.js';

function makeIntent(overrides: Partial<CheckoutIntent> = {}): CheckoutIntent {
  return {
    intentId: 'intent_unit_001',
    mandateId: 'mandate_active_001',
    merchant: 'Shopify-TechStore',
    items: [
      { id: 'p1', name: 'Wireless Mouse', price: 1000, quantity: 1 }
    ],
    subtotal: 1000,
    tax: 180,
    total: 1180,
    currency: 'INR',
    nonce: 'nonce_unit_001',
    status: 'VALIDATED',
    ...overrides
  };
}

describe('PayPalService & amount reconciliation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('reconciles items and 18% GST to exact 2-decimal totals in INR and USD conversion', () => {
    const intent = makeIntent({
      items: [
        { id: 'p1', name: 'Ergonomic Mouse', price: 1499.5, quantity: 1 },
        { id: 'p2', name: 'USB-C Cable', price: 249.75, quantity: 2 }
      ],
      subtotal: 1999.0,
      tax: 359.82, // 18% GST of 1999.00
      total: 2358.82,
      currency: 'INR'
    });

    const inr = reconcileOrderAmounts(intent, 'INR', 1);
    expect(inr.itemTotal).toBe('1999.00');
    expect(inr.taxTotal).toBe('359.82');
    expect(inr.total).toBe('2358.82');
    expect(inr.totalNumber).toBe(2358.82);

    const usd = reconcileOrderAmounts(intent, 'USD', 0.012);
    const summedItemsCents = usd.items.reduce(
      (sum, item) => sum + Math.round(Number(item.unit_amount.value) * 100) * Number(item.quantity),
      0
    );
    expect(summedItemsCents).toBe(Math.round(Number(usd.itemTotal) * 100));
    expect(Math.round(Number(usd.itemTotal) * 100) + Math.round(Number(usd.taxTotal) * 100)).toBe(
      Math.round(Number(usd.total) * 100)
    );
  });

  it('creates Tier 1 simulated Vault settlement and Tier 2 simulated Standard Capture without HTTP calls', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    const axiosSpy = vi.spyOn(axios, 'post');
    const service = new PayPalService();

    const tier1 = await service.createAndCaptureOrder(makeIntent({ total: 1180 }));
    expect(tier1.mode).toBe('SIMULATED_SANDBOX');
    expect(tier1.tier).toBe(1);
    expect(tier1.settlementPath).toBe('VAULT_ZERO_TOUCH');
    expect(tier1.vaultStatus).toBe('SIMULATED');
    expect(tier1.currency).toBe('INR');
    expect(tier1.status).toBe('COMPLETED');

    const tier2 = await service.createAndCaptureOrder(
      makeIntent({
        intentId: 'intent_unit_t2',
        items: [{ id: 'p3', name: 'Keyboard', price: 3000, quantity: 1 }],
        subtotal: 3000,
        tax: 540,
        total: 3540
      })
    );
    expect(tier2.mode).toBe('SIMULATED_SANDBOX');
    expect(tier2.tier).toBe(2);
    expect(tier2.settlementPath).toBe('STANDARD_CAPTURE');
    expect(tier2.vaultStatus).toBeUndefined();
    expect(axiosSpy).not.toHaveBeenCalled();
  });

  it('falls back from live Tier 1 vault path to STANDARD_CAPTURE with a warning when vault capture fails', async () => {
    process.env.PAYPAL_CLIENT_ID = 'test_client_id';
    process.env.PAYPAL_CLIENT_SECRET = 'test_client_secret';
    process.env.PAYPAL_VAULT_ID = 'vault_token_123';
    process.env.INR_TO_USD = '0.012';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const axiosPost = vi.spyOn(axios, 'post').mockImplementation(async (url: string, payload: any, config: any) => {
      if (url.endsWith('/v1/oauth2/token')) {
        return { data: { access_token: 'mock_tok', expires_in: 3600 } } as any;
      }
      if (url.endsWith('/v2/checkout/orders')) {
        if (payload?.payment_source?.paypal?.vault_id) {
          return { data: { id: 'ORD-VAULT-1', status: 'APPROVED' } } as any;
        }
        expect(config?.headers?.['PayPal-Request-Id']).toBe('req_intent_unit_001_std');
        return { data: { id: 'ORD-STD-1', status: 'CREATED' } } as any;
      }
      if (url.endsWith('/v2/checkout/orders/ORD-VAULT-1/capture')) {
        const err: any = new Error('Request failed with status code 422');
        err.isAxiosError = true;
        err.response = {
          status: 422,
          data: {
            name: 'UNPROCESSABLE_ENTITY',
            message: 'Vault token expired',
            debug_id: 'dbg_vault_fail',
            details: [{ issue: 'PAYMENT_SOURCE_DECLINED' }]
          }
        };
        throw err;
      }
      if (url.endsWith('/v2/checkout/orders/ORD-STD-1/capture')) {
        expect(config?.headers?.['PayPal-Request-Id']).toBe('cap_intent_unit_001_std');
        return {
          data: {
            id: 'ORD-STD-1',
            status: 'COMPLETED',
            purchase_units: [{ payments: { captures: [{ id: 'CAP-STD-1' }] } }]
          }
        } as any;
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const service = new PayPalService();
    const result = await service.createAndCaptureOrder(makeIntent());

    expect(result.mode).toBe('LIVE_PAYPAL_SANDBOX');
    expect(result.tier).toBe(1);
    expect(result.settlementPath).toBe('STANDARD_CAPTURE');
    expect(result.vaultStatus).toBeUndefined();
    expect(result.orderId).toBe('ORD-STD-1');
    expect(result.captureId).toBe('CAP-STD-1');
    expect(result.currency).toBe('USD');
    expect(result.originalCurrency).toBe('INR');
    expect(result.originalAmount).toBe(1180);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(axiosPost).toHaveBeenCalled();
  });

  it('verifies webhook signatures against PayPal API when configured and handles FAILURE / SUCCESS', async () => {
    process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST-ID';
    process.env.PAYPAL_CLIENT_ID = 'test_client_id';
    process.env.PAYPAL_CLIENT_SECRET = 'test_client_secret';

    const service = new PayPalService();
    const headers = {
      'paypal-transmission-id': 'tx-1',
      'paypal-transmission-time': '2026-11-11T10:00:00Z',
      'paypal-transmission-sig': 'sig-abc',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
      'paypal-auth-algo': 'SHA256withRSA'
    };

    const axiosPost = vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) {
        return { data: { access_token: 'mock_tok', expires_in: 3600 } } as any;
      }
      if (url.endsWith('/v1/notifications/verify-webhook-signature')) {
        return { data: { verification_status: 'FAILURE' } } as any;
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const failed = await service.verifyWebhookSignature({ headers, webhookEvent: { id: 'EVT-1' } });
    expect(failed.verified).toBe(false);
    expect(failed.status).toBe('FAILURE');

    axiosPost.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) {
        return { data: { access_token: 'mock_tok', expires_in: 3600 } } as any;
      }
      return { data: { verification_status: 'SUCCESS' } } as any;
    });

    const passed = await service.verifyWebhookSignature({ headers, webhookEvent: { id: 'EVT-2' } });
    expect(passed.verified).toBe(true);
    expect(passed.status).toBe('SUCCESS');
  });

  it('generates distinct, paired order and capture IDs across separate simulated settlements', async () => {
    delete process.env.PAYPAL_CLIENT_ID;
    delete process.env.PAYPAL_CLIENT_SECRET;

    const service = new PayPalService();

    const first = await service.createAndCaptureOrder(
      makeIntent({
        intentId: 'intent_sim_unique_1',
        merchant: 'Shopify-TechStore',
        items: [{ id: 'p1', name: 'Mouse', price: 1000, quantity: 1 }],
        subtotal: 1000,
        tax: 180,
        total: 1180
      })
    );

    const second = await service.createAndCaptureOrder(
      makeIntent({
        intentId: 'intent_sim_unique_2',
        merchant: 'Croma-Retail',
        items: [{ id: 'p2', name: 'Keyboard', price: 3000, quantity: 1 }],
        subtotal: 3000,
        tax: 540,
        total: 3540
      })
    );

    expect(first.orderId).not.toBe(second.orderId);
    expect(first.captureId).not.toBe(second.captureId);

    const firstOrderSuffix = first.orderId.replace('SANDBOX-ORD-', '');
    const firstCaptureSuffix = first.captureId.replace('SANDBOX-CAP-', '');
    expect(firstOrderSuffix).toBe(firstCaptureSuffix);
    expect(first.merchant).toBe('Shopify-TechStore');
    expect(first.amount).toBe(1180);

    const secondOrderSuffix = second.orderId.replace('SANDBOX-ORD-', '');
    const secondCaptureSuffix = second.captureId.replace('SANDBOX-CAP-', '');
    expect(secondOrderSuffix).toBe(secondCaptureSuffix);
    expect(second.merchant).toBe('Croma-Retail');
    expect(second.amount).toBe(3540);
    expect(firstOrderSuffix).not.toBe(secondOrderSuffix);
  });
});
