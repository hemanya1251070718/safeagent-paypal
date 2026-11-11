import axios from 'axios';
import dotenv from 'dotenv';
import { CheckoutIntent } from '../../shared/dist/index.js';

dotenv.config();

const PAYPAL_SUPPORTED_CURRENCIES = new Set([
  'AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS',
  'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'SGD',
  'SEK', 'CHF', 'THB', 'USD'
]);

export interface ReconciledLineItem {
  name: string;
  unit_amount: {
    currency_code: string;
    value: string;
  };
  quantity: string;
}

export interface ReconciledOrderAmounts {
  currency: string;
  itemTotal: string;
  taxTotal: string;
  total: string;
  totalNumber: number;
  items: ReconciledLineItem[];
}

function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Reconciles line items, item_total, tax_total, and total to exact 2-decimal values
 * computed from rounded parts so PayPal Orders v2 never fails with 422 AMOUNT_MISMATCH.
 */
export function reconcileOrderAmounts(
  intent: CheckoutIntent,
  currency: string,
  conversionRate = 1
): ReconciledOrderAmounts {
  const reconciledItems: ReconciledLineItem[] = (intent.items || []).map(item => {
    const unitCents = toCents((item.price || 0) * conversionRate);
    return {
      name: (item.name || 'Item').slice(0, 127),
      unit_amount: {
        currency_code: currency,
        value: formatCents(unitCents)
      },
      quantity: String(item.quantity)
    };
  });

  let itemTotalCents = 0;
  if (reconciledItems.length > 0) {
    for (let i = 0; i < intent.items.length; i++) {
      const unitCents = toCents((intent.items[i].price || 0) * conversionRate);
      itemTotalCents += unitCents * intent.items[i].quantity;
    }
  } else {
    itemTotalCents = toCents((intent.subtotal ?? intent.total ?? 0) * conversionRate);
  }

  const taxTotalCents = toCents((intent.tax ?? 0) * conversionRate);
  const totalCents = itemTotalCents + taxTotalCents;

  return {
    currency,
    itemTotal: formatCents(itemTotalCents),
    taxTotal: formatCents(taxTotalCents),
    total: formatCents(totalCents),
    totalNumber: Number(formatCents(totalCents)),
    items: reconciledItems
  };
}

function formatPayPalError(context: string, err: unknown): Error {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = (err.response?.data || {}) as Record<string, any>;
    const name = data.name || data.error || 'PAYPAL_API_ERROR';
    const message = data.message || data.error_description || err.message;
    const debugId = data.debug_id || 'N/A';
    const details = data.details ? JSON.stringify(data.details) : '[]';

    const formatted = new Error(
      `PayPal ${context} failed (HTTP ${status ?? 'NETWORK'}): name=${name}, message=${message}, debug_id=${debugId}, details=${details}`
    );
    return formatted;
  }

  return err instanceof Error ? err : new Error(`PayPal ${context} failed: ${String(err)}`);
}

export type SettlementPath = 'VAULT_ZERO_TOUCH' | 'STANDARD_CAPTURE';

export interface SettlementResult {
  mode: 'SIMULATED_SANDBOX' | 'LIVE_PAYPAL_SANDBOX';
  tier: 1 | 2;
  settlementPath: SettlementPath;
  vaultStatus?: 'VAULTED_LIVE' | 'SIMULATED';
  orderId: string;
  captureId: string;
  status: string;
  amount: number;
  currency: string;
  merchant?: string;
  originalCurrency?: string;
  originalAmount?: number;
  conversionRate?: number;
  raw?: any;
}

export interface WebhookVerificationInput {
  headers: Record<string, string | undefined>;
  webhookEvent: Record<string, any>;
}

export interface WebhookVerificationResult {
  verified: boolean;
  status: 'SUCCESS' | 'FAILURE' | 'SIMULATED_SKIPPED';
  reason?: string;
}

export class PayPalService {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private tokenClientId: string = '';

  private get clientId(): string {
    return process.env.PAYPAL_CLIENT_ID || '';
  }

  private get clientSecret(): string {
    return process.env.PAYPAL_CLIENT_SECRET || '';
  }

  private get baseUrl(): string {
    return process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
  }

  private isConfigured(): boolean {
    return !!(
      this.clientId &&
      this.clientSecret &&
      this.clientId !== 'your_sandbox_client_id_here' &&
      this.clientSecret !== 'your_sandbox_secret_here'
    );
  }

  private getTier1Limit(): number {
    const raw = process.env.TIER1_LIMIT || process.env.PAYPAL_TIER1_LIMIT || '2500';
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2500;
  }

  private getVaultId(): string | null {
    const vaultId = (process.env.PAYPAL_VAULT_ID || '').trim();
    if (!vaultId || vaultId === 'your_vault_id_here') {
      return null;
    }
    return vaultId;
  }

  private getConversionRate(fromCurrency: string): number {
    const specificKey = `${fromCurrency}_TO_USD`;
    const rawRate = process.env[specificKey] || process.env.INR_TO_USD || '0.012';
    const parsed = Number(rawRate);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.012;
  }

  public determineSettlementRouting(
    intent: CheckoutIntent,
    tier1LimitOverride?: number
  ): { tier: 1 | 2; settlementPath: SettlementPath; vaultId: string | null; simulatedVault: boolean } {
    const limit =
      typeof tier1LimitOverride === 'number' && Number.isFinite(tier1LimitOverride) && tier1LimitOverride > 0
        ? tier1LimitOverride
        : this.getTier1Limit();

    const isTier1 = intent.total <= limit;
    const tier: 1 | 2 = isTier1 ? 1 : 2;
    const vaultId = this.getVaultId();

    if (!this.isConfigured()) {
      if (isTier1) {
        return {
          tier: 1,
          settlementPath: 'VAULT_ZERO_TOUCH',
          vaultId: vaultId || 'SIMULATED',
          simulatedVault: true
        };
      }
      return {
        tier: 2,
        settlementPath: 'STANDARD_CAPTURE',
        vaultId: null,
        simulatedVault: false
      };
    }

    if (isTier1 && vaultId) {
      return {
        tier: 1,
        settlementPath: 'VAULT_ZERO_TOUCH',
        vaultId,
        simulatedVault: false
      };
    }

    return {
      tier,
      settlementPath: 'STANDARD_CAPTURE',
      vaultId: null,
      simulatedVault: false
    };
  }

  public async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      return 'simulated_sandbox_token';
    }

    if (this.cachedToken && this.tokenClientId === this.clientId && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    try {
      const response = await axios.post(`${this.baseUrl}/v1/oauth2/token`, 'grant_type=client_credentials', {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.cachedToken = response.data.access_token;
      this.tokenClientId = this.clientId;
      this.tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
      return this.cachedToken!;
    } catch (err) {
      throw formatPayPalError('OAuth token request', err);
    }
  }

  public async createAndCaptureOrder(
    intent: CheckoutIntent,
    options?: { tier1Limit?: number }
  ): Promise<SettlementResult> {
    const rawCurrency = (intent.currency || 'USD').toUpperCase();
    const routing = this.determineSettlementRouting(intent, options?.tier1Limit);

    if (!this.isConfigured()) {
      // High-fidelity sandbox simulation (keeps original currency)
      const reconciled = reconcileOrderAmounts(intent, rawCurrency, 1);
      const orderId = `SANDBOX-ORD-${Date.now()}`;
      const captureId = `SANDBOX-CAP-${Date.now()}`;
      return {
        mode: 'SIMULATED_SANDBOX',
        tier: routing.tier,
        settlementPath: routing.settlementPath,
        ...(routing.simulatedVault ? { vaultStatus: 'SIMULATED' as const } : {}),
        orderId,
        captureId,
        status: 'COMPLETED',
        amount: reconciled.totalNumber,
        currency: rawCurrency,
        merchant: intent.merchant
      };
    }

    // Currency guard in live mode
    let targetCurrency = rawCurrency;
    let conversionRate = 1;
    let currencyConverted = false;

    if (!PAYPAL_SUPPORTED_CURRENCIES.has(rawCurrency)) {
      targetCurrency = 'USD';
      conversionRate = this.getConversionRate(rawCurrency);
      currencyConverted = true;
    }

    const reconciled = reconcileOrderAmounts(intent, targetCurrency, conversionRate);

    if (currencyConverted) {
      console.log(
        `[PayPal] Currency ${rawCurrency} is not supported in live mode. Converted ${intent.total} ${rawCurrency} -> ${reconciled.total} USD (rate=${conversionRate})`
      );
    }

    const token = await this.getAccessToken();

    let settlementPath: SettlementPath = routing.settlementPath;
    let liveResult: { orderId: string; captureId: string; status: string; raw: any };

    if (routing.settlementPath === 'VAULT_ZERO_TOUCH' && routing.vaultId) {
      try {
        liveResult = await this.executeLiveOrderAndCapture(
          intent,
          token,
          reconciled,
          routing.vaultId,
          ''
        );
      } catch (vaultErr: any) {
        console.warn(
          `[PayPal] Tier 1 vault path failed for intent ${intent.intentId}; falling back to STANDARD_CAPTURE: ${vaultErr?.message || vaultErr}`
        );
        settlementPath = 'STANDARD_CAPTURE';
        liveResult = await this.executeLiveOrderAndCapture(
          intent,
          token,
          reconciled,
          null,
          '_std'
        );
      }
    } else {
      liveResult = await this.executeLiveOrderAndCapture(
        intent,
        token,
        reconciled,
        null,
        ''
      );
    }

    return {
      mode: 'LIVE_PAYPAL_SANDBOX',
      tier: routing.tier,
      settlementPath,
      ...(settlementPath === 'VAULT_ZERO_TOUCH' ? { vaultStatus: 'VAULTED_LIVE' as const } : {}),
      orderId: liveResult.orderId,
      captureId: liveResult.captureId,
      status: liveResult.status,
      amount: reconciled.totalNumber,
      currency: reconciled.currency,
      ...(currencyConverted
        ? {
            originalCurrency: rawCurrency,
            originalAmount: intent.total,
            conversionRate
          }
        : {}),
      raw: liveResult.raw
    };
  }

  private async executeLiveOrderAndCapture(
    intent: CheckoutIntent,
    token: string,
    reconciled: ReconciledOrderAmounts,
    vaultId: string | null,
    requestIdSuffix: string
  ): Promise<{ orderId: string; captureId: string; status: string; raw: any }> {
    // 1. Create Order via POST /v2/checkout/orders
    const orderPayload: Record<string, any> = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: intent.intentId,
          description: `SafeAgent Order for ${intent.merchant}`.slice(0, 127),
          amount: {
            currency_code: reconciled.currency,
            value: reconciled.total,
            breakdown: {
              item_total: {
                currency_code: reconciled.currency,
                value: reconciled.itemTotal
              },
              tax_total: {
                currency_code: reconciled.currency,
                value: reconciled.taxTotal
              }
            }
          },
          items: reconciled.items
        }
      ]
    };

    if (vaultId) {
      orderPayload.payment_source = {
        paypal: {
          vault_id: vaultId
        }
      };
    }

    let orderRes;
    try {
      orderRes = await axios.post(`${this.baseUrl}/v2/checkout/orders`, orderPayload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `req_${intent.intentId}${requestIdSuffix}`
        }
      });
    } catch (err) {
      throw formatPayPalError('create order', err);
    }

    const orderId: string = orderRes.data.id;
    let settlementData = orderRes.data;
    let captureId: string | undefined =
      settlementData.purchase_units?.[0]?.payments?.captures?.[0]?.id;

    // 2. Capture Order server-to-server via POST /v2/checkout/orders/{id}/capture
    if (!(settlementData.status === 'COMPLETED' && captureId)) {
      try {
        const captureRes = await axios.post(
          `${this.baseUrl}/v2/checkout/orders/${orderId}/capture`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'PayPal-Request-Id': `cap_${intent.intentId}${requestIdSuffix}`
            }
          }
        );
        settlementData = captureRes.data;
        captureId =
          settlementData.purchase_units?.[0]?.payments?.captures?.[0]?.id || `CAP-${orderId}`;
      } catch (err) {
        throw formatPayPalError(`capture order ${orderId}`, err);
      }
    }

    return {
      orderId,
      captureId: captureId || `CAP-${orderId}`,
      status: settlementData.status,
      raw: settlementData
    };
  }

  public async verifyWebhookSignature(input: WebhookVerificationInput): Promise<WebhookVerificationResult> {
    const webhookId = (process.env.PAYPAL_WEBHOOK_ID || '').trim();
    const hasWebhookId = !!(webhookId && webhookId !== 'your_webhook_id_here');

    if (!hasWebhookId) {
      return {
        verified: true,
        status: 'SIMULATED_SKIPPED'
      };
    }

    const normalizedHeaders: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(input.headers)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    const transmissionId = normalizedHeaders['paypal-transmission-id'];
    const transmissionTime = normalizedHeaders['paypal-transmission-time'];
    const transmissionSig = normalizedHeaders['paypal-transmission-sig'];
    const certUrl = normalizedHeaders['paypal-cert-url'];
    const authAlgo = normalizedHeaders['paypal-auth-algo'];

    if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
      return {
        verified: false,
        status: 'FAILURE',
        reason: 'Missing required PayPal webhook signature headers'
      };
    }

    if (!this.isConfigured()) {
      return {
        verified: false,
        status: 'FAILURE',
        reason: 'PAYPAL_WEBHOOK_ID is configured without live PayPal credentials; signature cannot be verified'
      };
    }

    try {
      const token = await this.getAccessToken();
      const verifyPayload = {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: input.webhookEvent
      };

      const verifyRes = await axios.post(
        `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
        verifyPayload,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const verificationStatus = verifyRes.data?.verification_status;
      if (verificationStatus === 'SUCCESS') {
        return {
          verified: true,
          status: 'SUCCESS'
        };
      }

      return {
        verified: false,
        status: 'FAILURE',
        reason: `PayPal webhook verification returned status: ${verificationStatus || 'FAILURE'}`
      };
    } catch (err) {
      const formatted = formatPayPalError('verify webhook signature', err);
      return {
        verified: false,
        status: 'FAILURE',
        reason: formatted.message
      };
    }
  }
}

export const paypalService = new PayPalService();

