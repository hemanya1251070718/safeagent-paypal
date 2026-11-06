import React, { useState } from 'react';
import { KeyRound, Shield, CheckCircle2, Lock } from 'lucide-react';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, canonicalJsonStringify } from '../../../shared/dist/index.js';
import axios from 'axios';

interface MandateManagerProps {
  onMandateUpdated: (mandateId: string) => void;
}

export const MandateManager: React.FC<MandateManagerProps> = ({ onMandateUpdated }) => {
  const [maxSpend, setMaxSpend] = useState<number>(100.0);
  const [tier1Limit, setTier1Limit] = useState<number>(30.0);
  const [ttlHours, setTtlHours] = useState<number>(24);
  const [whitelistedMerchants, setWhitelistedMerchants] = useState<string[]>([
    "Shopify-TechStore",
    "Medusa-OfficePro"
  ]);
  const [status, setStatus] = useState<string>('DEFAULT_SEED_ACTIVE');
  const [publicKeyHex, setPublicKeyHex] = useState<string>('');
  const [signatureHex, setSignatureHex] = useState<string>('');
  const [isSigning, setIsSigning] = useState<boolean>(false);

  const toggleMerchant = (name: string) => {
    if (whitelistedMerchants.includes(name)) {
      setWhitelistedMerchants(whitelistedMerchants.filter(m => m !== name));
    } else {
      setWhitelistedMerchants([...whitelistedMerchants, name]);
    }
  };

  const handleGenerateAndSign = async () => {
    setIsSigning(true);
    setStatus('GENERATING_PQC_KEYPAIR');

    try {
      // 1. Generate NIST FIPS 204 ML-DSA-65 Keypair in the browser
      const seed = new Uint8Array(32);
      crypto.getRandomValues(seed);
      const keypair = ml_dsa65.keygen(seed);
      const pubHex = bytesToHex(keypair.publicKey);
      setPublicKeyHex(pubHex);

      // 2. Compose Mandate Object
      const mandate = {
        mandateId: `mandate_${Date.now()}`,
        userId: "user_web_client",
        maxSpend,
        currency: "USD",
        ttlHours,
        createdAt: Date.now(),
        expiresAt: Date.now() + ttlHours * 3600 * 1000,
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
      await axios.post('http://localhost:3000/mandates', {
        mandate,
        publicKeyHex: pubHex,
        signatureHex: sigHex
      });

      setStatus('MANDATE_REGISTERED_SUCCESS');
      onMandateUpdated(mandate.mandateId);
    } catch (err: any) {
      console.error(err);
      setStatus('SIGNING_OR_GATEWAY_ERROR');
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-white">Delegated Spending Mandate</h2>
            <p className="text-xs text-slate-400">Cryptographically bounds AI agent spending limits</p>
          </div>
        </div>
        <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" /> Active in Gateway
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Max Spend Cap: <span className="text-blue-400 font-mono text-sm">${maxSpend.toFixed(2)} USD</span>
          </label>
          <input
            type="range"
            min="20"
            max="300"
            step="5"
            value={maxSpend}
            onChange={(e) => setMaxSpend(parseFloat(e.target.value))}
            className="w-full accent-blue-500 cursor-pointer"
          />
          <span className="text-[10px] text-slate-500">Hard stop ceiling. Any intent above this is strictly blocked.</span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Tier 1 Auto-Approve Limit: <span className="text-emerald-400 font-mono text-sm">${tier1Limit.toFixed(2)} USD</span>
          </label>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={tier1Limit}
            onChange={(e) => setTier1Limit(parseFloat(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer"
          />
          <span className="text-[10px] text-slate-500">Zero-touch micro-transactions under this execute server-to-server.</span>
        </div>
      </div>

      <div className="mb-5">
        <label className="block text-xs font-semibold text-slate-300 mb-2">Merchant Whitelist (Allowed Stores)</label>
        <div className="flex flex-wrap gap-2">
          {["Shopify-TechStore", "Medusa-OfficePro", "DarkMarket-Malicious"].map((merchant) => {
            const isApproved = whitelistedMerchants.includes(merchant);
            const isRogue = merchant.includes("Malicious");
            return (
              <button
                key={merchant}
                type="button"
                onClick={() => toggleMerchant(merchant)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                  isApproved
                    ? isRogue
                      ? "bg-red-500/20 border-red-500/40 text-red-300"
                      : "bg-blue-600/20 border-blue-500/40 text-blue-300"
                    : "bg-slate-800/40 border-slate-700 text-slate-500 hover:text-slate-300"
                }`}
              >
                {isApproved ? "✓ " : "+ "} {merchant}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          Algorithm: <strong className="text-cyan-400 font-mono">NIST FIPS 204 (ML-DSA-65)</strong>
        </div>
        <button
          onClick={handleGenerateAndSign}
          disabled={isSigning}
          className="flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-medium text-xs px-4 py-2 rounded-xl transition shadow-lg shadow-blue-500/20 disabled:opacity-50"
        >
          <KeyRound className="h-4 w-4" />
          <span>{isSigning ? "Signing..." : "Issue & Sign Mandate"}</span>
        </button>
      </div>

      {signatureHex && (
        <div className="mt-4 p-3 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-[10px] text-slate-400 overflow-x-auto">
          <p className="text-emerald-400 mb-1">✓ Mandate Cryptographically Signed & Verified in Gateway:</p>
          <p className="truncate">Sig: {signatureHex.slice(0, 64)}...</p>
        </div>
      )}
    </div>
  );
};

