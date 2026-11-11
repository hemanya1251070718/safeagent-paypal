import React, { useState } from 'react';
import type { SpendingMandate } from '../../shared/dist/index.js';
import { Navbar } from './components/Navbar';
import { MandateManager } from './components/MandateManager';
import { AgentGoalChat } from './components/AgentGoalChat';
import { LedgerTelemetryGrid } from './components/LedgerTelemetryGrid';
import { BiometricModal } from './components/BiometricModal';
import { CatalogDrawer } from './components/CatalogDrawer';
import { ToastContainer } from './components/Toast';
import { ShieldCheck, Cpu, Zap, Lock } from 'lucide-react';

export const App: React.FC = () => {
  const [activeMandateId, setActiveMandateId] = useState<string>(() => {
    try {
      return localStorage.getItem('safeagent_active_mandate_id') || 'mandate_active_001';
    } catch {
      return 'mandate_active_001';
    }
  });
  const [activeMandate, setActiveMandate] = useState<SpendingMandate | null>(null);
  const [pendingIntent, setPendingIntent] = useState<any | null>(null);
  const [blockedEvents, setBlockedEvents] = useState<any[]>([]);
  const [isCatalogOpen, setIsCatalogOpen] = useState<boolean>(false);
  const [selectedGoal, setSelectedGoal] = useState<string>('');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const handleMandateUpdated = (id: string, mandate?: SpendingMandate) => {
    setActiveMandateId(id);
    try {
      localStorage.setItem('safeagent_active_mandate_id', id);
    } catch (e) {
      console.warn('Could not save active mandate ID to localStorage:', e);
    }
    if (mandate) {
      setActiveMandate(mandate);
    }
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar onOpenCatalog={() => setIsCatalogOpen(true)} />

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
            <MandateManager
              activeMandateId={activeMandateId}
              refreshTrigger={refreshTrigger}
              onMandateUpdated={handleMandateUpdated}
            />
          </div>

          <div className="lg:col-span-7">
            <AgentGoalChat
              mandateId={activeMandateId}
              externalGoal={selectedGoal}
              onBiometricRequired={(intent) => setPendingIntent(intent)}
              onIntentBlocked={(blocked) => setBlockedEvents((prev) => [blocked, ...prev])}
              onOrderCaptured={() => setRefreshTrigger((prev) => prev + 1)}
            />
          </div>
        </div>

        {/* Real-time Financial Telemetry AG Grid */}
        <LedgerTelemetryGrid blockedEvents={blockedEvents} />
      </main>

      {/* Whitelisted Merchant Catalog Drawer */}
      <CatalogDrawer
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectProduct={(prompt) => {
          setSelectedGoal(prompt);
          setIsCatalogOpen(false);
        }}
      />

      {/* Tier 2 Biometric Confirmation Modal */}
      {pendingIntent && (
        <BiometricModal
          intent={pendingIntent}
          onClose={() => setPendingIntent(null)}
          onConfirmed={() => {
            setPendingIntent(null);
            setRefreshTrigger((prev) => prev + 1);
          }}
          onRejected={() => setPendingIntent(null)}
        />
      )}

      {/* Global Network Error & Notification Toast Container */}
      <ToastContainer />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        SafeAgent Platform • Built for the PayPal AI Hackathon • NIST FIPS 204 Post-Quantum Mandates • AG Grid Telemetry
      </footer>
    </div>
  );
};

export default App;

