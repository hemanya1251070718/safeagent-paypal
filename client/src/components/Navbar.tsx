import React from 'react';
import { ShoppingBag, Shield } from 'lucide-react';

interface NavbarProps {
  onOpenCatalog?: () => void;
  activeMandateId?: string;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenCatalog, activeMandateId }) => {
  return (
    <header className="border-b border-border bg-page/95 backdrop-blur-xs sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 rounded-md bg-accent text-white flex items-center justify-center shadow-xs border border-emerald-900/20">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-serif text-lg font-bold tracking-tight text-ink">SafeAgent</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono font-semibold border border-indigo-200">
                PQC v1.0
              </span>
            </div>
            <p className="text-[11px] text-ink-muted hidden sm:block">Financial middleware for autonomous agents</p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          {activeMandateId && (
            <div className="hidden md:flex items-center space-x-1.5 text-xs text-ink-muted">
              <span>Mandate:</span>
              <span className="font-mono text-ink font-semibold px-2 py-0.5 rounded bg-surface border border-border">
                {activeMandateId}
              </span>
            </div>
          )}

          <div className="hidden lg:flex items-center pl-2 border-l border-border">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#EBF5FB] text-[#00457C] border border-[#BDE0FE]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0079C1]"></span>
              PayPal Sandbox
            </span>
          </div>

          <div className="flex items-center space-x-1.5 text-xs text-emerald-800 font-medium px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Gateway online</span>
          </div>

          <button
            onClick={onOpenCatalog}
            className="btn-secondary text-xs py-1 px-2.5 hover:border-accent/40 hover:text-accent transition"
            title="Inspect Whitelisted Merchant Catalogs (:4001/agent/catalog)"
          >
            <ShoppingBag className="h-3.5 w-3.5 text-accent" />
            <span className="hidden sm:inline">Merchant catalog</span>
            <span className="sm:hidden">Catalog</span>
          </button>
        </div>
      </div>
    </header>
  );
};
