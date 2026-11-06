export interface SpendingMandate {
  mandateId: string;
  userId: string;
  maxSpend: number;
  currency: string;
  ttlHours: number;
  createdAt: number;
  expiresAt: number;
  merchantWhitelist: string[];
  tier1Limit: number; // e.g. <= $30 auto-executes
  remainingBalance: number;
  nonce: string;
}

export interface SignedMandatePayload {
  mandate: SpendingMandate;
  publicKeyHex: string;
  signatureHex: string;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  sku?: string;
  description?: string;
}

export interface CheckoutIntent {
  intentId: string;
  mandateId: string;
  merchant: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  nonce: string;
  agentReasoning?: string;
  status: 'PROPOSED' | 'VALIDATED' | 'CONFIRMATION_REQUIRED' | 'REJECTED' | 'EXECUTED';
  rejectionReason?: string;
  paypalOrderId?: string;
  paypalCaptureId?: string;
}

export interface BiometricConfirmation {
  intentId: string;
  approved: boolean;
  timestamp: number;
  credentialId?: string;
  authMethod: 'WebAuthn_Passkey' | 'Simulated_Biometric';
  signatureHex?: string;
}

export type LedgerEventType = 
  | 'MANDATE_CREATED'
  | 'INTENT_PROPOSED'
  | 'POLICY_VALIDATION_PASSED'
  | 'POLICY_VALIDATION_FAILED'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_SUBMITTED'
  | 'PAYPAL_ORDER_CREATED'
  | 'PAYPAL_CAPTURE_COMPLETED'
  | 'WEBHOOK_VERIFIED'
  | 'SETTLED'
  | 'SECURITY_ALERT';

export interface LedgerEvent {
  eventId: string;
  index: number;
  timestamp: string;
  previousHash: string;
  hash: string;
  type: LedgerEventType;
  mandateId?: string;
  intentId?: string;
  data: Record<string, any>;
}

export interface MerkleDisputePackage {
  disputeId: string;
  intentId: string;
  mandateId: string;
  mandate: SpendingMandate;
  intent: CheckoutIntent;
  mlDsaSignatureHex: string;
  publicKeyHex: string;
  paypalOrderId: string;
  paypalCaptureId: string;
  ledgerProofChain: {
    index: number;
    hash: string;
    type: LedgerEventType;
    timestamp: string;
  }[];
  merkleRoot: string;
  generatedAt: string;
}

export interface PolicyValidationResult {
  valid: boolean;
  tier: 1 | 2 | 3; // 1 = zero-touch auto, 2 = biometric confirm required, 3 = rejected
  reasons: string[];
  sanitizationAlerts: string[];
}

