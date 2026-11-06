import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { MandateManager } from './components/MandateManager';
import { AgentGoalChat } from './components/AgentGoalChat';
import { LedgerTelemetryGrid } from './components/LedgerTelemetryGrid';
import { BiometricModal } from './components/BiometricModal';
import { ShieldCheck, Cpu, Zap, Lock } from 'lucide-react';

export const App: React.FC = () => {
  const [activeMandateId, setActiveMandateId] = useState<string>("mandate_active_001");
  const [pendingIntent, setPendingIntent] = useState<any | null>(null);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top Architecture Banner */}
        <div className="bg-gradient-to-r from-blue-900/40 via-slate-900 to-cyan-900/30 border border-blue-500/20 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>SafeAgent Core Operating Console</span>
              <span className="text-xs font-mono font-normal bg-blue-500/20 text-cyan-300 px-2.5 py-0.5 rounded-full border border-cyan-500/30">
                PayPal AI Hackathon
              </span>
            </h1>
            <p className="text-xs text-slate-300 mt-1">
              Untrusted Cognitive Agent (P2) decoupled from Deterministic Policy Gateway (P3) on PayPal Rails (P4).
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950/60 px-3 py-2 rounded-xl border border-slate-800">
            <Lock className="h-4 w-4 text-cyan-400" />
            <span>Active Mandate: <strong className="text-white">{activeMandateId}</strong></span>
          </div>
        </div>

        {/* Main Grid: Mandate Manager & Agent Goal Chat */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <MandateManager onMandateUpdated={(id) => setActiveMandateId(id)} />
          </div>

          <div className="lg:col-span-7">
            <AgentGoalChat
              mandateId={activeMandateId}
              onBiometricRequired={(intent) => setPendingIntent(intent)}
            />
          </div>
        </div>

        {/* Real-time Financial Telemetry AG Grid */}
        <LedgerTelemetryGrid />
      </main>

      {/* Tier 2 Biometric Confirmation Modal */}
      {pendingIntent && (
        <BiometricModal
          intent={pendingIntent}
          onClose={() => setPendingIntent(null)}
          onConfirmed={() => setPendingIntent(null)}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        SafeAgent Platform • Built for the PayPal AI Hackathon • NIST FIPS 204 Post-Quantum Mandates • AG Grid Telemetry
      </footer>
    </div>
  );
};

export default App;

