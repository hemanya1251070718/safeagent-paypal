import React from 'react';
import { ShieldCheck, Cpu, CreditCard, ShoppingBag } from 'lucide-react';

interface NavbarProps {
  onOpenCatalog?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenCatalog }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-700 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-xl tracking-tight text-white">SafeAgent</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">v1.0-PQC</span>
            </div>
            <p className="text-xs text-slate-400">Deterministic Financial Middleware for Autonomous AI Agents</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenCatalog}
            className="flex items-center space-x-1.5 text-xs bg-slate-800 hover:bg-slate-700/80 text-cyan-300 hover:text-cyan-200 px-3 py-1.5 rounded-lg border border-slate-700 hover:border-cyan-500/40 transition cursor-pointer font-medium"
            title="Inspect Whitelisted Merchant Catalogs (:4001/agent/catalog)"
          >
            <ShoppingBag className="h-4 w-4 text-cyan-400" />
            <span className="hidden sm:inline">Merchant Catalog</span>
            <span className="sm:hidden">Catalog</span>
          </button>

          <div className="hidden md:flex items-center space-x-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60 text-slate-300">
            <Cpu className="h-4 w-4 text-emerald-400" />
            <span>Agent (P2): <strong className="text-emerald-400">Ready</strong></span>
          </div>

          <div className="hidden md:flex items-center space-x-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60 text-slate-300">
            <CreditCard className="h-4 w-4 text-blue-400" />
            <span>PayPal Rails: <strong className="text-blue-400">Sandbox</strong></span>
          </div>

          <div className="flex items-center space-x-2 text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 font-medium">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Gateway Online</span>
          </div>
        </div>
      </div>
    </header>
  );
};

