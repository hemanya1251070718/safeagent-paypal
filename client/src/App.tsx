import React, { useState } from 'react';
import type { SpendingMandate } from '../../shared/dist/index.js';
import { Navbar } from './components/Navbar';
import { MandateManager } from './components/MandateManager';
import { AgentGoalChat } from './components/AgentGoalChat';
import { LedgerTelemetryGrid } from './components/LedgerTelemetryGrid';
import { BiometricModal } from './components/BiometricModal';
import { CatalogDrawer } from './components/CatalogDrawer';
import { ToastContainer } from './components/Toast';
import { CustomCursor } from './components/CustomCursor';

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
    <div className="min-h-screen bg-page text-ink flex flex-col font-sans">
      <CustomCursor />
      <Navbar onOpenCatalog={() => setIsCatalogOpen(true)} activeMandateId={activeMandateId} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-border gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="heading-page">Operating Console</h1>
              <span className="h-2 w-2 rounded-full bg-accent inline-block"></span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Deterministic policy-guarded financial middleware decoupling AI agents from PayPal payment rails.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono bg-surface px-3 py-1.5 rounded-lg border border-emerald-200/80 shadow-2xs">
            <span className="text-ink-muted">Mandate:</span>
            <span className="font-semibold text-accent">{activeMandateId}</span>
          </div>
        </div>

        {/* Top Section: Mandate Manager & Agent Goal Chat */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
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

        {/* Centerpiece: Real-Time Financial Telemetry AG Grid */}
        <div className="pt-2">
          <LedgerTelemetryGrid blockedEvents={blockedEvents} />
        </div>
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

      {/* Biometric Passkey / Confirmation Modal */}
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

      {/* Global Notifications Container */}
      <ToastContainer />
    </div>
  );
};

export default App;
