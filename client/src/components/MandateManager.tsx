import React, { useState, useMemo, useEffect } from 'react';
import {
  KeyRound,
  Shield,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Code2
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
  }, [propActiveMandateId, activeMandateId]);

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
    if (whitelistedMerchants.length <= 1) {
      showToast({ type: 'warning', title: 'At least one merchant must be whitelisted' });
      return;
    }
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
    <div className="fintech-card p-5 sm:p-6 space-y-5">
      {/* Document-Style Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-start justify-between">
          <div>
            <span className="eyebrow text-accent font-semibold tracking-wider">Client Delegation</span>
            <h2 className="heading-section mt-0.5">Spending Mandate</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Cryptographically signed limits enforced deterministically by the gateway.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Active in gateway</span>
          </span>
        </div>

        {/* Polished Balance & Expiry Status Card */}
        <div className="mt-3.5 grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-gradient-to-r from-emerald-50/80 to-emerald-50/30 border border-emerald-200/80 shadow-2xs">
          <div>
            <span className="text-emerald-900/70 block text-[11px] font-medium">Remaining balance</span>
            <span className="font-mono font-bold text-emerald-950 text-base leading-tight block mt-0.5">
              {formatCurrency(remainingBalance, MANDATE_CURRENCY)}
            </span>
          </div>
          <div>
            <span className="text-emerald-900/70 block text-[11px] font-medium flex items-center gap-1">
              <Clock className="h-3 w-3 text-emerald-700/70" />
              <span>Expires in</span>
            </span>
            <span className="font-mono font-semibold text-emerald-900 text-sm leading-tight block mt-1">
              {timeRemainingStr}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Tier Constraints & Numeric Inputs with Quick Presets */}
      <div className="space-y-4">
        {/* Max Spend Ceiling Input (Tier 3 Hard Stop) */}
        <div className="p-3.5 rounded-lg bg-page/50 border border-border">
          <div className="flex justify-between items-baseline mb-1.5">
            <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent"></span>
              <span>Max spend ceiling (Hard stop)</span>
            </label>
            <span className="font-mono font-bold text-accent text-xs px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 shadow-2xs">
              {formatCurrency(maxSpend, MANDATE_CURRENCY)}
            </span>
          </div>
          <div className="relative flex items-center mb-2">
            <span className="absolute left-3 text-ink-muted font-mono text-xs font-semibold">{MANDATE_CURRENCY}</span>
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
              className="input-text w-full pl-12 pr-3 py-1.5 font-mono text-xs"
            />
          </div>
          {/* Quick preset buttons */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-[10px] text-ink-muted mr-1">Presets:</span>
            {[15000, 30000, 50000, 100000, 200000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setMaxSpend(preset)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                  maxSpend === preset
                    ? 'bg-emerald-800 text-white border-emerald-800 font-semibold shadow-sm'
                    : 'bg-surface border-border text-ink-muted hover:text-ink hover:bg-stone-50'
                }`}
              >
                {(preset / 1000).toFixed(0)}k
              </button>
            ))}
          </div>
          <span className="text-[10px] text-ink-muted block leading-tight">
            Tier 3 Hard Stop threshold: Any intent exceeding this ceiling is deterministically rejected.
          </span>
        </div>

        {/* Tier 1 Auto-Approve Limit Input */}
        <div className="p-3.5 rounded-lg bg-page/50 border border-border">
          <div className="flex justify-between items-baseline mb-1.5">
            <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span>Tier 1 auto-approval threshold</span>
            </label>
            <span className="font-mono font-bold text-accent text-xs px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 shadow-2xs">
              {formatCurrency(tier1Limit, MANDATE_CURRENCY)}
            </span>
          </div>
          <div className="relative flex items-center mb-2">
            <span className="absolute left-3 text-ink-muted font-mono text-xs font-semibold">{MANDATE_CURRENCY}</span>
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
              className="input-text w-full pl-12 pr-3 py-1.5 font-mono text-xs"
            />
          </div>
          {/* Quick preset buttons */}
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-[10px] text-ink-muted mr-1">Presets:</span>
            {[1000, 2500, 5000, 6500, 10000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTier1Limit(preset)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                  tier1Limit === preset
                    ? 'bg-emerald-800 text-white border-emerald-800 font-semibold shadow-sm'
                    : 'bg-surface border-border text-ink-muted hover:text-ink hover:bg-stone-50'
                }`}
              >
                {preset >= 1000 ? `${(preset / 1000).toFixed(preset % 1000 === 0 ? 0 : 1)}k` : preset}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-ink-muted block leading-tight">
            Zero-touch micro-transactions at or under this amount auto-settle without human prompt.
          </span>
        </div>

        {/* Tier 2 Discretionary Range Banner */}
        <div className="px-3.5 py-2.5 rounded-lg bg-amber-50/80 border border-amber-200/90 flex items-center justify-between text-xs shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500"></span>
            <span className="text-amber-900 font-semibold">Tier 2 Discretionary:</span>
            <span className="font-mono text-ink">
              &gt; {formatCurrency(tier1Limit, MANDATE_CURRENCY)} up to {formatCurrency(maxSpend, MANDATE_CURRENCY)}
            </span>
          </div>
          <span className="badge-warning font-mono text-[10px]">
            1-Tap Biometric Required
          </span>
        </div>
      </div>

      {/* TTL Segmented Control */}
      <div>
        <label className="text-xs font-medium text-ink block mb-1.5">
          Mandate validity window (TTL)
        </label>
        <div className="grid grid-cols-4 gap-1 p-1 bg-stone-100/80 border border-border rounded-md text-xs font-medium">
          {[
            { label: '1 hour', hours: 1 },
            { label: '6 hours', hours: 6 },
            { label: '24 hours', hours: 24 },
            { label: '7 days', hours: 168 }
          ].map((preset) => (
            <button
              key={preset.hours}
              type="button"
              onClick={() => setTtlHours(preset.hours)}
              className={`py-1.5 rounded text-center transition ${
                ttlHours === preset.hours
                  ? 'bg-accent text-white font-semibold shadow-xs'
                  : 'text-ink-muted hover:text-ink hover:bg-surface/70'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Merchant Whitelist */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-ink">
            Approved merchant whitelist ({whitelistedMerchants.length})
          </label>
          <span className="text-[11px] text-ink-muted font-mono">Currency: {MANDATE_CURRENCY}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {whitelistedMerchants.map((merchant) => (
            <span
              key={merchant}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-sky-50/80 border border-sky-200 text-sky-950 font-mono font-medium shadow-2xs"
            >
              <span>{merchant}</span>
              <button
                type="button"
                onClick={(e) => handleRemoveMerchant(merchant, e)}
                className="text-sky-600 hover:text-danger ml-0.5 transition"
                title={`Remove ${merchant}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {/* Add custom merchant */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newMerchantInput}
            onChange={(e) => setNewMerchantInput(e.target.value)}
            placeholder="Add merchant (e.g. Reliance-Retail)..."
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddMerchant())}
            className="input-text flex-1 text-xs"
          />
          <button
            type="button"
            onClick={handleAddMerchant}
            className="btn-secondary text-xs px-3 hover:bg-sky-50 hover:border-sky-300 text-sky-900 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Collapsible Canonical JSON Preview Box */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowJsonPreview(!showJsonPreview)}
          className="flex items-center justify-between w-full text-xs text-ink-muted hover:text-ink transition"
        >
          <div className="flex items-center gap-1.5">
            <Code2 className="h-3.5 w-3.5 text-accent" />
            <span>Canonical JSON preview ({canonicalJsonPreview.length} bytes)</span>
          </div>
          {showJsonPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showJsonPreview && (
          <div className="mt-2 code-box max-h-36 overflow-x-auto text-[11px] leading-relaxed select-all bg-[#FAF8F5] border-border/80">
            <pre>{canonicalJsonPreview}</pre>
          </div>
        )}
      </div>

      {/* Action Footer: Issue & Sign Mandate */}
      <div className="border-t border-border pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-[11px] text-ink-muted flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5 text-accent" />
          <span>Algorithm: <strong className="font-mono text-ink font-semibold">NIST FIPS 204 (ML-DSA-65)</strong></span>
        </div>

        <button
          onClick={handleGenerateAndSign}
          disabled={isSigning}
          className="btn-primary w-full sm:w-auto shadow-xs text-xs py-2 px-4 hover:bg-accent-hover hover:-translate-y-0.5 active:scale-[0.97] transition-all"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>{isSigning ? 'Signing lattice...' : 'Issue & sign mandate'}</span>
        </button>
      </div>

      {/* Signature Proof Display */}
      {signatureHex && (
        <div className="p-2.5 rounded-md bg-emerald-50/60 border border-emerald-200/80 text-[11px] font-mono text-emerald-950 shadow-2xs">
          <span className="text-success font-semibold flex items-center gap-1 mb-0.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Signed & registered with gateway
          </span>
          <p className="truncate text-emerald-900/80">Sig: {signatureHex.slice(0, 56)}...</p>
        </div>
      )}
    </div>
  );
};
