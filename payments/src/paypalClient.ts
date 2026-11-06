import axios from 'axios';
import dotenv from 'dotenv';
import { CheckoutIntent } from '../../shared/dist/index.js';

dotenv.config();

export class PayPalService {
  private clientId = process.env.PAYPAL_CLIENT_ID || '';
  private clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
  private baseUrl = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  private isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.clientId !== 'your_sandbox_client_id_here');
  }

  public async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      return 'simulated_sandbox_token';
    }

    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await axios.post(`${this.baseUrl}/v1/oauth2/token`, 'grant_type=client_credentials', {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    this.cachedToken = response.data.access_token;
    this.tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
    return this.cachedToken!;
  }

  public async createAndCaptureOrder(intent: CheckoutIntent) {
    if (!this.isConfigured()) {
      // High-fidelity sandbox simulation
      const orderId = `SANDBOX-ORD-${Date.now()}`;
      const captureId = `SANDBOX-CAP-${Date.now()}`;
      return {
        mode: 'SIMULATED_SANDBOX',
        orderId,
        captureId,
        status: 'COMPLETED',
        amount: intent.total,
        currency: intent.currency,
        merchant: intent.merchant
      };
    }

    const token = await this.getAccessToken();

    // 1. Create Order via POST /v2/checkout/orders
    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: intent.intentId,
          description: `SafeAgent Order for ${intent.merchant}`,
          amount: {
            currency_code: intent.currency,
            value: intent.total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: intent.currency,
                value: intent.subtotal.toFixed(2)
              },
              tax_total: {
                currency_code: intent.currency,
                value: intent.tax.toFixed(2)
              }
            }
          },
          items: intent.items.map(item => ({
            name: item.name,
            unit_amount: {
              currency_code: intent.currency,
              value: item.price.toFixed(2)
            },
            quantity: item.quantity.toString()
          }))
        }
      ]
    };

    const orderRes = await axios.post(`${this.baseUrl}/v2/checkout/orders`, orderPayload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `req_${intent.intentId}`
      }
    });

    const orderId = orderRes.data.id;

    // 2. Capture Order via POST /v2/checkout/orders/{id}/capture
    const captureRes = await axios.post(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const captureId = captureRes.data.purchase_units?.[0]?.payments?.captures?.[0]?.id || `CAP-${orderId}`;

    return {
      mode: 'LIVE_PAYPAL_SANDBOX',
      orderId,
      captureId,
      status: captureRes.data.status,
      amount: intent.total,
      currency: intent.currency,
      raw: captureRes.data
    };
  }
}

export const paypalService = new PayPalService();

