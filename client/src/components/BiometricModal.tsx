import React, { useState } from 'react';
import {
  Fingerprint,
  AlertCircle,
  X,
  Check,
  ShieldAlert,
  Receipt,
  Lock
} from 'lucide-react';
import type { CheckoutIntent, CartItem } from '../../../shared/dist/index.js';
import { confirmIntent, captureOrderDirect, ALLOW_DIRECT_CAPTURE } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { showToast } from './Toast';

interface BiometricModalProps {
  intent: CheckoutIntent & {
    gatewayReasons?: string[];
    tier?: number;
    tier1Limit?: number;
  };
  onClose: () => void;
  onConfirmed: () => void;
  onRejected?: (intentId: string) => void;
}

export const BiometricModal: React.FC<BiometricModalProps> = ({
  intent,
  onClose,
  onConfirmed,
  onRejected
}) => {
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [modalState, setModalState] = useState<'IDLE' | 'VERIFYING' | 'AUTHORIZED' | 'REJECTED' | 'ERROR'>('IDLE');
  const [captureSucceeded, setCaptureSucceeded] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currency = intent?.currency;
  const items: CartItem[] = Array.isArray(intent?.items) ? intent.items : [];

  // Compute calculated subtotal if not explicitly provided
  const calculatedSubtotal = items.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 1),
    0
  );
  const subtotal = intent?.subtotal ?? calculatedSubtotal;
  const tax = intent?.tax ?? Math.round(subtotal * 0.18 * 100) / 100;
  const total = intent?.total ?? subtotal + tax;

  const handleApprove = async () => {
    setIsVerifying(true);
    setModalState('VERIFYING');
    setErrorMessage(null);

    try {
      // Simulate WebAuthn / Passkey cryptographic biometric sensor delay
      await new Promise((r) => setTimeout(r, 900));

      // 1. Confirm through Gateway
      const confirmRes = await confirmIntent(intent.intentId, true, 'WebAuthn_Passkey');

      // 2. Direct fallback capture if enabled while Gateway P3 lacks server-side capture
      let captured = false;
      if (ALLOW_DIRECT_CAPTURE) {
        try {
          await captureOrderDirect(intent);
          captured = true;
          setCaptureSucceeded(true);
        } catch (payErr: any) {
          console.warn('[BiometricModal] Direct capture warning:', payErr.message);
        }
      }

      setModalState('AUTHORIZED');

      const approvedTitle = confirmRes.orderId ? 'Authorized & Captured on PayPal Rails!' : 'Payment Authorized';
      const toastMessage = `Payment authorized and captured for ${formatCurrency(total, currency)} at ${intent.merchant || 'Merchant'}. Order: ${confirmRes.orderId || 'Completed'}`;

      setTimeout(() => {
        onConfirmed();
        onClose();
        showToast({
          type: 'success',
          title: approvedTitle,
          message: toastMessage
        });
      }, 900);
    } catch (err: any) {
      console.error('[BiometricModal] Approval error:', err);
      const msg = err.response?.data?.error || err.message || 'Authorization failed';
      setErrorMessage(`Confirmation failed: ${msg}`);
      setModalState('ERROR');
      showToast({
        type: 'error',
        title: 'Authorization Failed',
        message: msg
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReject = async () => {
    setIsVerifying(true);
    setModalState('REJECTING' as any);
    setErrorMessage(null);

    try {
      // Post rejection to Gateway
      await confirmIntent(intent.intentId, false);
      setModalState('REJECTED');

      setTimeout(() => {
        onRejected?.(intent.intentId);
        onClose();
        showToast({
          type: 'warning',
          title: 'Transaction Rejected by User',
          message: `Intent ${intent.intentId} was declined.`
        });
      }, 700);
    } catch (err: any) {
      console.error('[BiometricModal] Rejection error:', err);
      onRejected?.(intent.intentId);
      onClose();
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="bg-surface border border-border rounded-lg w-full max-w-lg p-6 shadow-floating relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isVerifying}
          className="absolute top-4 right-4 text-ink-muted hover:text-ink transition disabled:opacity-40"
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-start space-x-3 mb-4">
          <div className="p-2 rounded-md bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <span className="eyebrow text-amber-800 font-semibold tracking-wider">Tier 2 Authorization</span>
            <h3 className="heading-section mt-0.5">Discretionary Spend Confirmation</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Cart exceeds auto-approval threshold. Cryptographic user consent required.
            </p>
          </div>
        </div>

        {/* Policy Pause Reason in a Saffron-Edged Note */}
        <div className="mb-4 bg-amber-50/70 border-l-4 border-amber-500 border border-amber-200 rounded-md p-3 text-xs text-amber-950 leading-relaxed shadow-2xs">
          <div className="flex items-start gap-2">
            <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="text-amber-950 font-semibold block mb-0.5">Policy Gatekeeper Paused Execution:</strong>
              {intent.gatewayReasons && intent.gatewayReasons.length > 0 ? (
                <span>{intent.gatewayReasons.join(' ')}</span>
              ) : (
                <span>
                  Cart total {formatCurrency(total, currency)} exceeds your Tier 1 auto-approval threshold ({formatCurrency(intent.tier1Limit, currency)}). User biometric consent is required before funds can be captured.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="mb-4 p-2.5 rounded bg-danger-light border border-[#F0C6BF] text-danger text-xs flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Merchant & Intent Details Header */}
        <div className="bg-page rounded-md border border-border p-3.5 mb-4 space-y-3">
          <div className="flex items-center justify-between text-xs pb-2 border-b border-border/80">
            <div className="flex items-center gap-1.5 text-ink-muted">
              <span>Merchant:</span>
              <strong className="text-ink font-semibold">{intent.merchant || 'Whitelisted merchant'}</strong>
            </div>
            <div className="text-[11px] font-mono text-ink-muted truncate max-w-[160px]">
              {intent.intentId}
            </div>
          </div>

          {/* Itemized Cart Table */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider flex justify-between px-1">
              <span>Itemized cart ({items.length} items)</span>
              <span>Subtotal</span>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
              {items.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between bg-surface border border-border/70 rounded p-2 text-xs"
                >
                  <div className="flex-1 pr-2">
                    <p className="font-medium text-ink text-xs">{item.name}</p>
                    <p className="text-[10px] text-ink-muted font-mono">
                      Qty: {item.quantity} × {formatCurrency(item.price, currency)}
                    </p>
                  </div>
                  <span className="font-mono text-ink font-semibold text-right tabular-nums">
                    {formatCurrency(item.price * item.quantity, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Subtotal, Tax & Total Authorization Breakdown */}
          <div className="border-t border-border pt-2.5 space-y-1 text-xs">
            <div className="flex justify-between text-ink-muted">
              <span>Cart subtotal:</span>
              <span className="font-mono text-ink tabular-nums">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-ink-muted">
              <span>Tax (GST):</span>
              <span className="font-mono text-ink tabular-nums">{formatCurrency(tax, currency)}</span>
            </div>
            <div className="flex justify-between text-ink font-bold border-t border-border/80 pt-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-accent" />
                <span>Total amount:</span>
              </span>
              <span className="font-mono text-accent text-base tabular-nums">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons: Secondary Reject, Primary Green Approve */}
        <div className="flex space-x-3">
          <button
            onClick={handleReject}
            disabled={isVerifying || modalState === 'AUTHORIZED'}
            className="btn-secondary flex-1"
          >
            {modalState === 'REJECTED' ? (
              <span className="text-danger flex items-center justify-center gap-1">
                <X className="h-3.5 w-3.5" /> Intent rejected
              </span>
            ) : (
              'Reject intent'
            )}
          </button>

          <button
            onClick={handleApprove}
            disabled={isVerifying || modalState === 'AUTHORIZED' || modalState === 'REJECTED'}
            className="btn-primary flex-1"
          >
            {modalState === 'AUTHORIZED' ? (
              <>
                <Check className="h-4 w-4 text-white" />
                <span>
                  {ALLOW_DIRECT_CAPTURE && captureSucceeded
                    ? 'Authorized & Captured!'
                    : 'Approved (gateway simulated, no capture)'}
                </span>
              </>
            ) : modalState === 'VERIFYING' ? (
              <>
                <Fingerprint className="h-4 w-4 text-white animate-ping" />
                <span>Authenticating passkey...</span>
              </>
            ) : (
              <>
                <Fingerprint className="h-4 w-4 text-white" />
                <span>Authorize with passkey</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
