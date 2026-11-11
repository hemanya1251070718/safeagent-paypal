import type { CheckoutIntent } from '../../../shared/dist/index.js';

/**
 * Formats a monetary amount using the exact currency from the data via Intl.NumberFormat.
 * Never hardcodes currency symbols. If currency is missing, returns "—".
 */
export function formatCurrency(amount: number | undefined | null, currency?: string | null): string {
  if (!currency || typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '—';
  }
  const cleanCurrency = currency.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cleanCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Graceful fallback for non-standard currency codes
    return `${cleanCurrency} ${amount.toFixed(2)}`;
  }
}

/**
 * Formats an ISO string or timestamp to localized time string (HH:MM:SS)
 */
export function formatTime(timestamp: number | string | Date | undefined | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleTimeString();
}

/**
 * Formats an ISO string or timestamp to full localized date & time
 */
export function formatDateTime(timestamp: number | string | Date | undefined | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return String(timestamp);
  return date.toLocaleString();
}

/**
 * Shortens a cryptographic SHA-256 hash or public key for clean UI display
 */
export function shortenHash(hash: string | undefined | null, prefixLen: number = 8, suffixLen: number = 6): string {
  if (!hash) return '';
  if (hash.length <= prefixLen + suffixLen) return hash;
  return `${hash.slice(0, prefixLen)}...${hash.slice(-suffixLen)}`;
}

/**
 * Extracts the itemized cart from an agent execution response by inspecting
 * both data.intent and data.gatewayDecision.intent (and nested gatewayResponse).
 */
export function extractIntentCart(response: any): CheckoutIntent | null {
  if (!response || typeof response !== 'object') return null;

  // 1. Check primary response.intent
  if (response.intent && typeof response.intent === 'object' && Array.isArray(response.intent.items)) {
    return response.intent as CheckoutIntent;
  }

  // 2. Check response.gatewayDecision.intent
  if (
    response.gatewayDecision?.intent &&
    typeof response.gatewayDecision.intent === 'object' &&
    Array.isArray(response.gatewayDecision.intent.items)
  ) {
    return response.gatewayDecision.intent as CheckoutIntent;
  }

  // 3. Check response.gatewayDecision.gatewayResponse.intent
  if (
    response.gatewayDecision?.gatewayResponse?.intent &&
    typeof response.gatewayDecision.gatewayResponse.intent === 'object' &&
    Array.isArray(response.gatewayDecision.gatewayResponse.intent.items)
  ) {
    return response.gatewayDecision.gatewayResponse.intent as CheckoutIntent;
  }

  return null;
}
