import React, { useState } from 'react';
import {
  Fingerprint,
  AlertCircle,
  X,
  Check,
  ShieldAlert,
  Store,
  Receipt,
  Lock,
  ArrowRight
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
      // TODO [P3-ALIGNMENT]: Remove direct payments call once Gateway implements server-side
      // capture in POST /intents/:id/confirm (see docs/P1_BACKEND_REQUESTS.md)
      let captured = false;
      if (ALLOW_DIRECT_CAPTURE) {
        try {
          await captureOrderDirect(intent);
          captured = true;
          setCaptureSucceeded(true);
        } catch (payErr: any) {
          console.warn('[BiometricModal] Direct capture warning:', payErr.message);
          // If direct capture fails or was already captured, proceed since Gateway approved
        }
      }

      setModalState('AUTHORIZED');

      const isLiveCapture = ALLOW_DIRECT_CAPTURE && captured;
      const approvedTitle = isLiveCapture
        ? 'Authorized & Captured!'
        : 'Approved (gateway simulated, no capture)';

      const toastMessage = isLiveCapture
        ? `Payment authorized and captured for ${formatCurrency(total, currency)} at ${intent.merchant || 'Merchant'}.`
        : `Intent approved via Gateway simulation for ${formatCurrency(total, currency)} (no live PayPal capture).`;

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
      // Gracefully close on rejection failure
      onRejected?.(intent.intentId);
      onClose();
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative animate-in zoom-in-95 duration-150">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isVerifying}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition disabled:opacity-40"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-inner">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-white flex items-center gap-2">
              <span>Tier 2 Spend Authorization</span>
              <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                2-Phase Commit
              </span>
            </h3>
            <p className="text-xs text-amber-400/90 font-medium">
              Discretionary spend threshold exceeded • Biometric consent required
            </p>
          </div>
        </div>

        {/* Policy Pause Reason Banner */}
        <div className="mb-4 bg-amber-950/40 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200/90 leading-relaxed">
          <div className="flex items-start gap-2">
            <Lock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-amber-300 block mb-0.5 font-semibold">Policy Gatekeeper Paused Execution:</strong>
              {intent.gatewayReasons && intent.gatewayReasons.length > 0 ? (
                <span>{intent.gatewayReasons.join(' ')}</span>
              ) : (
                <span>
                  Cart total {formatCurrency(total, currency)} exceeds your Tier 1 auto-approval threshold ({formatCurrency(intent.tier1Limit, currency)}). User cryptographic biometric consent is required before funds can be captured.
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-xs flex items-center space-x-2 animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Merchant & Intent Details Header */}
        <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Store className="h-3.5 w-3.5 text-cyan-400" />
              <span>Target Merchant:</span>
              <strong className="text-white font-medium">{intent.merchant || 'Shopify-India'}</strong>
            </div>
            <div className="text-[11px] font-mono text-slate-500 truncate max-w-[150px]">
              {intent.intentId}
            </div>
          </div>

          {/* Itemized Cart Table */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex justify-between px-1">
              <span>Itemized Cart ({items.length} items)</span>
              <span>Price & GST</span>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {items.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between bg-slate-900/80 border border-slate-800/60 rounded-lg p-2 text-xs"
                >
                  <div className="flex-1 pr-2">
                    <p className="font-medium text-slate-200 text-xs">{item.name}</p>
                    <p className="text-[10px] text-slate-500">
                      Qty: {item.quantity} × {formatCurrency(item.price, currency)}
                    </p>
                  </div>
                  <span className="font-mono text-slate-300 font-medium">
                    {formatCurrency(item.price * item.quantity, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Subtotal, Tax & Total Authorization Breakdown */}
          <div className="border-t border-slate-800/80 pt-2.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Cart Subtotal:</span>
              <span className="font-mono text-slate-300">{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tax (18% GST):</span>
              <span className="font-mono text-slate-300">{formatCurrency(tax, currency)}</span>
            </div>
            <div className="flex justify-between text-slate-200 font-bold border-t border-slate-800/80 pt-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-cyan-400" />
                <span>Total Authorized Amount:</span>
              </span>
              <span className="text-cyan-400 font-mono text-base">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons & Feedback */}
        <div className="flex space-x-3">
          <button
            onClick={handleReject}
            disabled={isVerifying || modalState === 'AUTHORIZED'}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-medium text-xs transition disabled:opacity-50"
          >
            {modalState === 'REJECTED' ? (
              <span className="text-red-400 flex items-center justify-center gap-1">
                <X className="h-4 w-4" /> Intent Rejected
              </span>
            ) : (
              'Reject Intent'
            )}
          </button>

          <button
            onClick={handleApprove}
            disabled={isVerifying || modalState === 'AUTHORIZED' || modalState === 'REJECTED'}
            className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-cyan-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white font-semibold text-xs flex items-center justify-center space-x-2 transition shadow-lg shadow-blue-500/25 disabled:opacity-50"
          >
            {modalState === 'AUTHORIZED' ? (
              <>
                <Check className="h-4 w-4 text-emerald-300" />
                <span className="text-white font-bold">
                  {ALLOW_DIRECT_CAPTURE && captureSucceeded
                    ? 'Authorized & Captured!'
                    : 'Approved (gateway simulated, no capture)'}
                </span>
              </>
            ) : modalState === 'VERIFYING' ? (
              <>
                <Fingerprint className="h-4 w-4 text-cyan-200 animate-ping" />
                <span>Authenticating Passkey...</span>
              </>
            ) : (
              <>
                <Fingerprint className="h-4 w-4 text-cyan-300" />
                <span>1-Tap Biometric Authorize</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
