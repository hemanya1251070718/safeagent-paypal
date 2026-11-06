import React, { useState } from 'react';
import { Fingerprint, AlertCircle, X, Check, ShieldAlert } from 'lucide-react';
import axios from 'axios';

interface BiometricModalProps {
  intent: any;
  onClose: () => void;
  onConfirmed: () => void;
}

export const BiometricModal: React.FC<BiometricModalProps> = ({ intent, onClose, onConfirmed }) => {
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  const handleApprove = async () => {
    setIsVerifying(true);
    try {
      // Simulate WebAuthn / Passkey biometric tap delay
      await new Promise(r => setTimeout(r, 900));

      await axios.post(`http://localhost:3000/intents/${intent.intentId}/confirm`, {
        approved: true,
        authMethod: 'WebAuthn_Passkey'
      });

      // Also trigger capture on payments
      await axios.post('http://localhost:5000/orders/create-and-capture', intent);

      setSuccess(true);
      setTimeout(() => {
        onConfirmed();
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReject = async () => {
    try {
      await axios.post(`http://localhost:3000/intents/${intent.intentId}/confirm`, {
        approved: false
      });
      onClose();
    } catch (err: any) {
      console.error(err);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-white">Tier 2 Spend Confirmation</h3>
            <p className="text-xs text-yellow-400/90 font-medium">Discretionary Spend Threshold Exceeded</p>
          </div>
        </div>

        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 mb-4 space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Merchant:</span>
            <span className="text-white font-medium">{intent?.merchant || 'Shopify-TechStore'}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Items:</span>
            <span className="text-white font-medium">
              {intent?.items?.map((i: any) => `${i.name} (x${i.quantity})`).join(', ') || 'Item'}
            </span>
          </div>
          <div className="flex justify-between text-slate-400 border-t border-slate-800/80 pt-2 font-semibold">
            <span className="text-slate-300">Total Authorized Amount:</span>
            <span className="text-blue-400 font-mono text-sm">${intent?.total?.toFixed(2) || '0.00'} USD</span>
          </div>
        </div>

        <div className="text-xs text-slate-400 mb-6 bg-slate-800/40 p-3 rounded-lg border border-slate-700/40">
          This cart total exceeds your <strong>$30.00 Tier 1 zero-touch limit</strong>. The Policy Gateway has paused execution and requires your cryptographic passkey/biometric consent.
        </div>

        <div className="flex space-x-3">
          <button
            onClick={handleReject}
            disabled={isVerifying || success}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-medium text-xs transition"
          >
            Reject Intent
          </button>

          <button
            onClick={handleApprove}
            disabled={isVerifying || success}
            className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-xs flex items-center justify-center space-x-2 transition shadow-lg shadow-blue-500/20 disabled:opacity-50"
          >
            {success ? (
              <>
                <Check className="h-4 w-4 text-emerald-300" />
                <span>Authorized!</span>
              </>
            ) : (
              <>
                <Fingerprint className={`h-4 w-4 ${isVerifying ? 'animate-pulse text-cyan-300' : ''}`} />
                <span>{isVerifying ? 'Verifying Passkey...' : '1-Tap Authorize'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

