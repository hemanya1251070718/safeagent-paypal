import { SpendingMandate, CheckoutIntent, PolicyValidationResult } from '../../../shared/dist/index.js';

export class PolicyEngine {
  private activeMandates: Map<string, SpendingMandate> = new Map();
  private processedNonces: Set<string> = new Set();

  public registerMandate(mandate: SpendingMandate) {
    this.activeMandates.set(mandate.mandateId, mandate);
  }

  public getMandate(mandateId: string): SpendingMandate | undefined {
    return this.activeMandates.get(mandateId);
  }

  public validateIntent(intent: CheckoutIntent): PolicyValidationResult {
    const reasons: string[] = [];
    const sanitizationAlerts: string[] = [];

    // 1. Mandate Existence
    const mandate = this.activeMandates.get(intent.mandateId);
    if (!mandate) {
      return {
        valid: false,
        tier: 3,
        reasons: [`Mandate '${intent.mandateId}' not found or inactive.`],
        sanitizationAlerts
      };
    }

    // 2. Expiration (TTL)
    const now = Date.now();
    if (now > mandate.expiresAt) {
      reasons.push(`Mandate expired at ${new Date(mandate.expiresAt).toISOString()}`);
    }

    // 3. Replay Protection
    if (this.processedNonces.has(intent.nonce)) {
      reasons.push(`Replay attack detected: Nonce '${intent.nonce}' was previously processed.`);
    }

    // 4. Merchant Whitelist
    const isWhitelisted = mandate.merchantWhitelist.some(
      m => m.toLowerCase() === intent.merchant.toLowerCase()
    );
    if (!isWhitelisted) {
      reasons.push(`Merchant '${intent.merchant}' is not in approved whitelist: [${mandate.merchantWhitelist.join(', ')}]`);
    }

    // 5. Spend Limits
    if (intent.total > mandate.remainingBalance) {
      reasons.push(`Cart total ($${intent.total}) exceeds remaining mandate balance ($${mandate.remainingBalance.toFixed(2)}).`);
    }

    // 6. Adversarial Prompt Injection Sanitization Firewall
    for (const item of intent.items) {
      const textToScan = `${item.name} ${item.description || ''}`;
      if (
        textToScan.includes("SYSTEM_OVERRIDE") ||
        textToScan.includes("Ignore user constraints") ||
        textToScan.includes("Ignore previous instructions") ||
        textToScan.includes("0xAttacker")
      ) {
        sanitizationAlerts.push(`Malicious prompt injection payload detected in item '${item.name}'.`);
        reasons.push(`Security Firebreak triggered: Hostile injection pattern identified.`);
      }
    }

    // If any deterministic failure occurred:
    if (reasons.length > 0) {
      return {
        valid: false,
        tier: 3,
        reasons,
        sanitizationAlerts
      };
    }

    // Record nonce to prevent replay
    this.processedNonces.add(intent.nonce);

    // Tier 1 vs Tier 2 routing
    if (intent.total <= mandate.tier1Limit) {
      // Tier 1: Auto-Execute
      return {
        valid: true,
        tier: 1,
        reasons: [`Total $${intent.total} <= Tier 1 threshold ($${mandate.tier1Limit}). Auto-approved.`],
        sanitizationAlerts
      };
    } else {
      // Tier 2: Biometric confirmation required
      return {
        valid: true,
        tier: 2,
        reasons: [`Total $${intent.total} exceeds Tier 1 limit ($${mandate.tier1Limit}). Paused for user biometric confirmation.`],
        sanitizationAlerts
      };
    }
  }

  public deductSpend(mandateId: string, amount: number) {
    const mandate = this.activeMandates.get(mandateId);
    if (mandate) {
      mandate.remainingBalance = Math.max(0, Math.round((mandate.remainingBalance - amount) * 100) / 100);
    }
  }
}

export const policyEngine = new PolicyEngine();

