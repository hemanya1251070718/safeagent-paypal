import React, { useState, useMemo, useEffect } from 'react';
import {
  KeyRound,
  Shield,
  CheckCircle2,
  Lock,
  Clock,
  Coins,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Code2,
  Sparkles
} from 'lucide-react';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import type { SpendingMandate } from '../../../shared/dist/index.js';
import { bytesToHex, canonicalJsonStringify } from '../../../shared/dist/index.js';
import { registerMandate, getMandate } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { showToast } from './Toast';

// Mandate currency setting written into the mandate object (must match backend policy contract)
const MANDATE_CURRENCY = 'INR';

interface MandateManagerProps {
  onMandateUpdated: (mandateId: string, mandate?: SpendingMandate) => void;
  activeMandateId?: string;
  refreshTrigger?: number;
}

export const MandateManager: React.FC<MandateManagerProps> = ({
  onMandateUpdated,
  activeMandateId: propActiveMandateId,
  refreshTrigger
}) => {
  const [maxSpend, setMaxSpend] = useState<number>(15000.0);
  const [tier1Limit, setTier1Limit] = useState<number>(2500.0);
  const [ttlHours, setTtlHours] = useState<number>(24);
  const [whitelistedMerchants, setWhitelistedMerchants] = useState<string[]>([
    'Amazon-India',
    'Flipkart',
    'Croma-Retail',
    'Myntra',
    'Shopify-India'
  ]);
  const [newMerchantInput, setNewMerchantInput] = useState<string>('');
  const [activeMandateId, setActiveMandateId] = useState<string>(
    propActiveMandateId || 'mandate_active_001'
  );
  const [activeExpiresAt, setActiveExpiresAt] = useState<number>(
    Date.now() + 24 * 3600 * 1000
  );
  const [remainingBalance, setRemainingBalance] = useState<number>(15000.0);
  const [timeRemainingStr, setTimeRemainingStr] = useState<string>('24h 00m 00s');

  const [status, setStatus] = useState<string>('DEFAULT_SEED_ACTIVE');
  const [publicKeyHex, setPublicKeyHex] = useState<string>('');
  const [signatureHex, setSignatureHex] = useState<string>('');
  const [isSigning, setIsSigning] = useState<boolean>(false);
  const [showJsonPreview, setShowJsonPreview] = useState<boolean>(false);

  // Sync prop changes
  useEffect(() => {
    if (propActiveMandateId && propActiveMandateId !== activeMandateId) {
      setActiveMandateId(propActiveMandateId);
    }
  }, [propActiveMandateId]);

  // Synchronize live mandate state (remaining balance, limits, TTL) from Gateway
  useEffect(() => {
    let isSubscribed = true;
    const syncMandate = async () => {
      const targetId = propActiveMandateId || activeMandateId;
      if (!targetId) return;
      try {
        const liveMandate = await getMandate(targetId);
        if (isSubscribed && liveMandate) {
          setRemainingBalance(liveMandate.remainingBalance);
          setMaxSpend(liveMandate.maxSpend);
          setTier1Limit(liveMandate.tier1Limit);
          setActiveExpiresAt(liveMandate.expiresAt);
          if (liveMandate.merchantWhitelist && liveMandate.merchantWhitelist.length > 0) {
            setWhitelistedMerchants(liveMandate.merchantWhitelist);
          }
        }
      } catch (err) {
        console.warn(`Could not sync live balance for mandate ${targetId}:`, err);
      }
    };

    syncMandate();
    return () => {
      isSubscribed = false;
    };
  }, [propActiveMandateId, activeMandateId, refreshTrigger]);

  // Live countdown timer for active mandate expiration
  useEffect(() => {
    const updateCountdown = () => {
      const diff = activeExpiresAt - Date.now();
      if (diff <= 0) {
        setTimeRemainingStr('EXPIRED');
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeRemainingStr(
          `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
        );
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [activeExpiresAt]);

  const toggleMerchant = (name: string) => {
    if (whitelistedMerchants.includes(name)) {
      setWhitelistedMerchants(whitelistedMerchants.filter((m) => m !== name));
    } else {
      setWhitelistedMerchants([...whitelistedMerchants, name]);
    }
  };

  const handleAddMerchant = () => {
    const trimmed = newMerchantInput.trim();
    if (!trimmed) return;
    if (!whitelistedMerchants.includes(trimmed)) {
      setWhitelistedMerchants([...whitelistedMerchants, trimmed]);
    }
    setNewMerchantInput('');
  };

  const handleRemoveMerchant = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setWhitelistedMerchants(whitelistedMerchants.filter((m) => m !== name));
  };

  // Preview mandate composition for canonical JSON visualization
  const previewMandate = useMemo(
    () => ({
      mandateId: activeMandateId,
      userId: 'user_web_client',
      maxSpend,
      currency: MANDATE_CURRENCY,
      ttlHours,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlHours * 3600 * 1000,
      merchantWhitelist: whitelistedMerchants,
      tier1Limit,
      remainingBalance,
      nonce: 'preview_nonce'
    }),
    [activeMandateId, maxSpend, ttlHours, whitelistedMerchants, tier1Limit, remainingBalance]
  );

  const canonicalJsonPreview = useMemo(() => {
    return canonicalJsonStringify(previewMandate);
  }, [previewMandate]);

  // Cryptographic In-Browser ML-DSA-65 Signing Routine (DO NOT MODIFY)
  const handleGenerateAndSign = async () => {
    if (!maxSpend || maxSpend <= 0) {
      showToast({
        type: 'error',
        title: 'Invalid Spend Ceiling',
        message: 'Please enter a valid Max Spend Ceiling greater than zero.'
      });
      return;
    }

    if (tier1Limit < 0) {
      showToast({
        type: 'error',
        title: 'Invalid Tier 1 Threshold',
        message: 'Tier 1 threshold must be non-negative.'
      });
      return;
    }

    if (tier1Limit > maxSpend) {
      showToast({
        type: 'error',
        title: 'Threshold Exceeds Ceiling',
        message: `Tier 1 auto-approve threshold (${formatCurrency(tier1Limit, MANDATE_CURRENCY)}) cannot exceed Max Spend ceiling (${formatCurrency(maxSpend, MANDATE_CURRENCY)}).`
      });
      return;
    }

    setIsSigning(true);
    setStatus('GENERATING_PQC_KEYPAIR');

    try {
      // 1. Generate NIST FIPS 204 ML-DSA-65 Keypair in the browser
      const seed = new Uint8Array(32);
      crypto.getRandomValues(seed);
      const keypair = ml_dsa65.keygen(seed);
      const pubHex = bytesToHex(keypair.publicKey);
      setPublicKeyHex(pubHex);

      const generatedId = `mandate_${Date.now()}`;
      const expires = Date.now() + ttlHours * 3600 * 1000;

      // 2. Compose Mandate Object
      const mandate: SpendingMandate = {
        mandateId: generatedId,
        userId: 'user_web_client',
        maxSpend,
        currency: MANDATE_CURRENCY,
        ttlHours,
        createdAt: Date.now(),
        expiresAt: expires,
        merchantWhitelist: whitelistedMerchants,
        tier1Limit,
        remainingBalance: maxSpend,
        nonce: Math.random().toString(36).substring(2, 15)
      };

      // 3. Canonicalize & Sign (messageBytes, secretKey)
      const canonicalJson = canonicalJsonStringify(mandate);
      const messageBytes = new TextEncoder().encode(canonicalJson);
      const sigBytes = ml_dsa65.sign(messageBytes, keypair.secretKey);
      const sigHex = bytesToHex(sigBytes);
      setSignatureHex(sigHex);

      setStatus('POSTING_TO_GATEWAY');

      // 4. Send to Gateway
      await registerMandate(mandate, pubHex, sigHex);

      setStatus('MANDATE_REGISTERED_SUCCESS');
      setActiveMandateId(mandate.mandateId);
      setActiveExpiresAt(mandate.expiresAt);
      setRemainingBalance(mandate.remainingBalance);
      try {
        localStorage.setItem('safeagent_active_mandate_id', mandate.mandateId);
      } catch (storageErr) {
        console.warn('Could not persist active mandate to localStorage:', storageErr);
      }

      showToast({
        type: 'success',
        title: 'Mandate Registered (ML-DSA-65)',
        message: `Mandate ${mandate.mandateId} verified with Gateway. Spend ceiling: ${formatCurrency(maxSpend, MANDATE_CURRENCY)}.`
      });

      // Propagate active mandate to App state
      onMandateUpdated(mandate.mandateId, mandate);
    } catch (err: any) {
      console.error('PQC Signing or Gateway error:', err);
      setStatus('SIGNING_OR_GATEWAY_ERROR');
      showToast({
        type: 'error',
        title: 'Mandate Registration Failed',
        message: err.message || 'Gateway rejected or failed to process the signed mandate.'
      });
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
      <div>
        {/* Header with Active Gateway Badge */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">Delegated Spending Mandate</h2>
              <p className="text-xs text-slate-400">Post-Quantum Cryptographic Spend Constraints</p>
            </div>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Registered in Gateway
          </span>
        </div>

        {/* Live Active Mandate Telemetry Pill (Remaining Balance & Expiry Countdown) */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800/80 mb-5 text-xs">
          <div>
            <div className="flex items-center gap-1.5 text-slate-400 mb-0.5">
              <Coins className="h-3.5 w-3.5 text-cyan-400" />
              <span>Remaining Balance:</span>
            </div>
            <p className="font-mono text-sm font-bold text-white">
              {formatCurrency(remainingBalance, MANDATE_CURRENCY)}
            </p>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-slate-400 mb-0.5">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              <span>Expiry TTL:</span>
            </div>
            <p className="font-mono text-sm font-bold text-amber-300">
              {timeRemainingStr}
            </p>
          </div>
        </div>

        {/* Mandate Operating Currency Badge */}
        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800/80 mb-5">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Operating Currency:</span>
            <span className="font-mono font-bold text-white bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {MANDATE_CURRENCY}
            </span>
          </div>
          <span className="text-[11px] text-slate-400">Policy Guarded</span>
        </div>

        {/* Manual Tier Constraints Input (Replaces Range Sliders) */}
        <div className="space-y-4 mb-5">
          {/* Max Spend Ceiling Input (Tier 3 Hard Stop) */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                <span>Max Spend Ceiling (Hard Stop):</span>
              </label>
              <span className="text-blue-400 font-mono text-xs font-bold">
                {formatCurrency(maxSpend, MANDATE_CURRENCY)}
              </span>
            </div>
            <div className="relative flex items-center mb-2">
              <span className="absolute left-3 text-slate-400 font-mono text-xs font-semibold">₹</span>
              <input
                type="number"
                min="500"
                max="1000000"
                step="500"
                value={maxSpend === 0 ? '' : maxSpend}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setMaxSpend(isNaN(val) ? 0 : val);
                }}
                placeholder="Enter max spend limit (e.g. 50000)"
                className="w-full pl-7 pr-3 py-2 bg-slate-900/90 border border-slate-700/80 rounded-lg font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>
            {/* Quick preset buttons */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="text-[10px] text-slate-400 mr-1">Presets:</span>
              {[15000, 30000, 50000, 100000, 200000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMaxSpend(preset)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                    maxSpend === preset
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  ₹{(preset / 1000).toFixed(0)}k
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-500 block leading-tight">
              Tier 3 Hard Stop ceiling: Any intent exceeding this amount is deterministically rejected.
            </span>
          </div>

          {/* Tier 1 Auto-Approve Limit Input */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                <span>Tier 1 Auto-Approve Threshold:</span>
              </label>
              <span className="text-emerald-400 font-mono text-xs font-bold">
                {formatCurrency(tier1Limit, MANDATE_CURRENCY)}
              </span>
            </div>
            <div className="relative flex items-center mb-2">
              <span className="absolute left-3 text-slate-400 font-mono text-xs font-semibold">₹</span>
              <input
                type="number"
                min="0"
                max={maxSpend > 0 ? maxSpend : 50000}
                step="250"
                value={tier1Limit === 0 ? '' : tier1Limit}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setTier1Limit(isNaN(val) ? 0 : val);
                }}
                placeholder="Enter micro-spend threshold (e.g. 2500)"
                className="w-full pl-7 pr-3 py-2 bg-slate-900/90 border border-slate-700/80 rounded-lg font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
              />
            </div>
            {/* Quick preset buttons */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="text-[10px] text-slate-400 mr-1">Presets:</span>
              {[1000, 2500, 5000, 6500, 10000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTier1Limit(preset)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                    tier1Limit === preset
                      ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  ₹{preset >= 1000 ? `${(preset / 1000).toFixed(preset % 1000 === 0 ? 0 : 1)}k` : preset}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-500 block leading-tight">
              Zero-touch micro-transactions at or under this amount auto-settle without human prompts.
            </span>
          </div>

          {/* Tier 2 Discretionary Range Banner */}
          <div className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              <span className="text-amber-300 font-semibold">Tier 2 Discretionary:</span>
              <span className="font-mono text-slate-300">
                &gt; {formatCurrency(tier1Limit, MANDATE_CURRENCY)} up to {formatCurrency(maxSpend, MANDATE_CURRENCY)}
              </span>
            </div>
            <span className="text-[10px] text-amber-400/90 font-medium font-mono bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
              1-Tap Biometric Required
            </span>
          </div>
        </div>

        {/* TTL Selector: 1h, 6h, 24h, 7d */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Expiration TTL (Time-To-Live Window)
          </label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: '1 Hour', hours: 1 },
              { label: '6 Hours', hours: 6 },
              { label: '24 Hours', hours: 24 },
              { label: '7 Days', hours: 168 }
            ].map((preset) => (
              <button
                key={preset.hours}
                type="button"
                onClick={() => setTtlHours(preset.hours)}
                className={`py-1.5 px-2 rounded-xl text-xs font-mono font-medium transition text-center border ${
                  ttlHours === preset.hours
                    ? 'bg-blue-600/25 border-blue-500 text-blue-300 shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editable Merchant Whitelist */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-300 mb-2">
            Merchant Whitelist ({whitelistedMerchants.length} Approved Stores)
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {whitelistedMerchants.map((merchant) => {
              const isRogue = merchant.includes('Malicious') || merchant.includes('Dark');
              return (
                <span
                  key={merchant}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border font-medium ${
                    isRogue
                      ? 'bg-red-500/20 border-red-500/40 text-red-300'
                      : 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  }`}
                >
                  <span>{merchant}</span>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveMerchant(merchant, e)}
                    className="hover:text-white text-slate-400 ml-0.5"
                    title={`Remove ${merchant}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>

          {/* Add custom merchant */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newMerchantInput}
              onChange={(e) => setNewMerchantInput(e.target.value)}
              placeholder="Add merchant store (e.g. Reliance-Digital)..."
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddMerchant())}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
            />
            <button
              type="button"
              onClick={handleAddMerchant}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl px-3 py-1.5 text-xs flex items-center gap-1 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Collapsible Canonical JSON Preview Box */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowJsonPreview(!showJsonPreview)}
            className="flex items-center justify-between w-full p-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs transition"
          >
            <div className="flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5 text-cyan-400" />
              <span>Canonical JSON Preview ({canonicalJsonPreview.length} bytes)</span>
            </div>
            {showJsonPreview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showJsonPreview && (
            <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[10px] font-mono text-cyan-300 overflow-x-auto max-h-36 leading-relaxed select-all">
              <pre>{canonicalJsonPreview}</pre>
            </div>
          )}
        </div>
      </div>

      {/* Footer Signing Action & Algorithm Badge */}
      <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400 flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-cyan-400" />
          <span>Algorithm: <strong className="text-cyan-400 font-mono">NIST FIPS 204 (ML-DSA-65)</strong></span>
        </div>
        <button
          onClick={handleGenerateAndSign}
          disabled={isSigning}
          className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-medium text-xs px-4 py-2 rounded-xl transition shadow-lg shadow-blue-500/20 disabled:opacity-50"
        >
          <KeyRound className="h-4 w-4" />
          <span>{isSigning ? 'Signing Lattice...' : 'Issue & Sign Mandate'}</span>
        </button>
      </div>

      {/* Signature Proof Display */}
      {signatureHex && (
        <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-[10px] text-slate-400 overflow-x-auto animate-in fade-in">
          <p className="text-emerald-400 mb-1 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Mandate Signed & Verified with Gateway:
          </p>
          <p className="truncate text-slate-400">Sig: {signatureHex.slice(0, 64)}...</p>
        </div>
      )}
    </div>
  );
};
