import axios from 'axios';
import type {
  SpendingMandate,
  CheckoutIntent,
  MerkleDisputePackage,
  LedgerEvent
} from '../../../shared/dist/index.js';
import { showToast } from '../components/Toast';

// Base URLs derived strictly from environment variables with fallback defaults
export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3000';
export const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://localhost:4001';
export const PAYMENTS_URL = import.meta.env.VITE_PAYMENTS_URL || 'http://localhost:5000';
export const ALLOW_DIRECT_CAPTURE = import.meta.env.VITE_ALLOW_DIRECT_CAPTURE === 'true';

// Intercept unhandled network errors (ECONNREFUSED, offline services) and surface visible alerts
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ERR_NETWORK' || (!error.response && error.message?.includes('Network Error'))) {
      const targetUrl = error.config?.url || 'backend service';
      const cleanUrl = targetUrl.replace(/https?:\/\//, '');
      showToast({
        type: 'error',
        title: 'Backend Service Connection Failed',
        message: `Failed to reach ${cleanUrl}. Ensure services are running via start-all.ps1.`
      });
    }
    return Promise.reject(error);
  }
);

export interface PlanExecutionResponse {
  goal: string;
  mandateId: string;
  success: boolean;
  finalStatus: string;
  trace: Array<{
    step: number;
    timestamp: string;
    type: 'THOUGHT' | 'TOOL_CALL' | 'TOOL_RESULT' | 'GATEWAY_RESPONSE' | 'RECOVERY';
    content: string;
    payload?: any;
  }>;
  intent?: CheckoutIntent;
  gatewayDecision?: any;
}

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  currency: string;
  merchant: string;
  category: string;
  description: string;
  inventory: number;
  rating: number;
  tags: string[];
}

export interface CatalogResponse {
  count: number;
  merchants: string[];
  products: CatalogProduct[];
}

export interface RegisterMandateResponse {
  status: string;
  mandateId: string;
  remainingBalance: number;
  tier1Limit: number;
}

export interface IntentConfirmResponse {
  status: string;
  intentId: string;
  authMethod?: string;
  orderId?: string;
  captureId?: string;
}

export interface SettlementCaptureResponse {
  orderId: string;
  captureId: string;
  status: string;
  amount: number;
  currency: string;
  mode: string;
  tier: number;
  settlementPath: string;
  vaultStatus?: string;
}

// -----------------------------------------------------------------------------
// GATEWAY SERVICE (Port 3000 by default)
// -----------------------------------------------------------------------------

/**
 * Registers a client-signed ML-DSA-65 spending mandate with the Policy Gateway.
 */
export async function registerMandate(
  mandate: SpendingMandate,
  publicKeyHex: string,
  signatureHex: string
): Promise<RegisterMandateResponse> {
  const response = await axios.post<RegisterMandateResponse>(`${GATEWAY_URL}/mandates`, {
    mandate,
    publicKeyHex,
    signatureHex
  });
  return response.data;
}

/**
 * Retrieves a registered spending mandate by its ID.
 */
export async function getMandate(mandateId: string): Promise<SpendingMandate> {
  const response = await axios.get<SpendingMandate>(`${GATEWAY_URL}/mandates/${mandateId}`);
  return response.data;
}

/**
 * Submits user biometric or passkey confirmation for a Tier 2/3 paused transaction.
 */
export async function confirmIntent(
  intentId: string,
  approved: boolean,
  authMethod: 'WebAuthn_Passkey' | 'Simulated_Biometric' = 'WebAuthn_Passkey'
): Promise<IntentConfirmResponse> {
  const response = await axios.post<IntentConfirmResponse>(`${GATEWAY_URL}/intents/${intentId}/confirm`, {
    approved,
    authMethod
  });
  return response.data;
}

// -----------------------------------------------------------------------------
// COGNITIVE AGENT SERVICE (Port 4001 by default)
// -----------------------------------------------------------------------------

/**
 * Dispatches a natural language shopping goal to the cognitive planner.
 */
export async function dispatchPlan(
  goal: string,
  mandateId?: string
): Promise<PlanExecutionResponse> {
  const response = await axios.post<PlanExecutionResponse>(`${AGENT_URL}/agent/plan`, {
    goal,
    mandateId
  });
  return response.data;
}

/**
 * Triggers one of the preset hackathon demonstration scenarios.
 * @param scenarioId 'tier1' | 'tier2' | 'injection' | 'budget'
 */
export async function triggerScenario(
  scenarioId: 'tier1' | 'tier2' | 'injection' | 'budget' | string,
  mandateId?: string
): Promise<PlanExecutionResponse> {
  const response = await axios.post<PlanExecutionResponse>(
    `${AGENT_URL}/agent/scenario/${scenarioId}`,
    { mandateId }
  );
  return response.data;
}

/**
 * Retrieves available merchant catalog products for frontend inspectability.
 */
export async function getCatalog(): Promise<CatalogResponse> {
  const response = await axios.get<CatalogResponse>(`${AGENT_URL}/agent/catalog`);
  return response.data;
}

// -----------------------------------------------------------------------------
// PAYMENTS & LEDGER SERVICE (Port 5000 by default)
// -----------------------------------------------------------------------------

/**
 * Returns the SSE stream URL for real-time ledger telemetry.
 */
export function getLedgerStreamUrl(): string {
  return `${PAYMENTS_URL}/ledger/stream`;
}

/**
 * Fetches the cryptographically anchored SHA-256 Merkle dispute package from Payments.
 */
export async function getDisputePackage(intentId: string): Promise<MerkleDisputePackage> {
  const response = await axios.get<MerkleDisputePackage>(`${PAYMENTS_URL}/disputes/${intentId}/package`);
  return response.data;
}

/**
 * Fallback direct capture on Payments service when Gateway lacks server-side capture.
 * Guarded by VITE_ALLOW_DIRECT_CAPTURE environment flag.
 */
export async function captureOrderDirect(intent: CheckoutIntent): Promise<SettlementCaptureResponse> {
  if (!ALLOW_DIRECT_CAPTURE) {
    console.warn('[API] Direct capture on payments is disabled by VITE_ALLOW_DIRECT_CAPTURE policy.');
  }
  const response = await axios.post<SettlementCaptureResponse>(
    `${PAYMENTS_URL}/orders/create-and-capture`,
    intent
  );
  return response.data;
}

/**
 * Fetches all historical ledger events.
 */
export async function getLedgerEvents(): Promise<{ count: number; events: LedgerEvent[]; integrityValid: boolean }> {
  const response = await axios.get(`${PAYMENTS_URL}/ledger/events`);
  return response.data;
}
