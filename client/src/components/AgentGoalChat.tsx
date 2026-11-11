import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  ArrowRight,
  Trash2,
  Terminal,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Code2,
  ChevronDown,
  ChevronUp,
  Brain,
  HelpCircle
} from 'lucide-react';
import { dispatchPlan, triggerScenario } from '../services/api';
import { extractIntentCart, formatTime } from '../utils/formatters';

interface AgentGoalChatProps {
  mandateId: string;
  onBiometricRequired: (intent: any) => void;
  onIntentBlocked?: (blocked: any) => void;
  externalGoal?: string;
}

export const AgentGoalChat: React.FC<AgentGoalChatProps> = ({
  mandateId,
  onBiometricRequired,
  onIntentBlocked,
  externalGoal
}) => {
  const [goal, setGoal] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [trace, setTrace] = useState<any[]>([]);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedPayloads, setExpandedPayloads] = useState<Record<number, boolean>>({});
  const [blockedNotice, setBlockedNotice] = useState<{
    hostilePayload?: string;
    reason?: string;
    merchant?: string;
  } | null>(null);

  const traceContainerRef = useRef<HTMLDivElement>(null);
  const traceBottomRef = useRef<HTMLDivElement>(null);

  // Sync external goal selection (e.g. from Merchant Catalog)
  useEffect(() => {
    if (externalGoal) {
      setGoal(externalGoal);
    }
  }, [externalGoal]);

  // Auto-scroll as reasoning steps arrive
  useEffect(() => {
    if (traceBottomRef.current) {
      traceBottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [trace, isLoading, blockedNotice]);

  const togglePayload = (stepIdx: number) => {
    setExpandedPayloads((prev) => ({
      ...prev,
      [stepIdx]: !prev[stepIdx]
    }));
  };

  const handleClearTrace = () => {
    setTrace([]);
    setFinalStatus(null);
    setErrorMessage(null);
    setBlockedNotice(null);
    setExpandedPayloads({});
  };

  const executeGoal = async (customGoal?: string, scenarioId?: string) => {
    const targetGoal = customGoal || goal;
    if (!targetGoal.trim()) return;

    setIsLoading(true);
    setTrace([]);
    setFinalStatus(null);
    setErrorMessage(null);
    setBlockedNotice(null);
    setExpandedPayloads({});

    try {
      let response;
      if (scenarioId) {
        response = await triggerScenario(scenarioId, mandateId);
      } else {
        response = await dispatchPlan(targetGoal, mandateId);
      }

      setTrace(response.trace || []);
      setFinalStatus(response.finalStatus || 'COMPLETE');

      // Check if Scenario 3 / hostile injection was triggered
      const isHostile =
        scenarioId === 'injection' ||
        response.finalStatus === 'REJECTED_BY_GATEWAY' ||
        response.gatewayDecision?.policyDecision === 'BLOCKED' ||
        response.gatewayDecision?.sanitizationAlerts?.length > 0;

      if (isHostile) {
        // Find hostile item payload from response intent, gatewayDecision, or trace
        const tracePayloadItem = response.trace
          ?.map((t: any) => t.payload?.item || t.payload?.items?.[0])
          ?.find((i: any) => i && (i.description || i.name));

        const hostileItem =
          response.intent?.items?.find((i: any) =>
            i.description?.includes('SYSTEM_OVERRIDE') ||
            i.name?.includes('PROMO') ||
            i.name?.includes('ROGUE') ||
            i.description?.includes('OVERRIDE')
          ) ||
          response.gatewayDecision?.intent?.items?.[0] ||
          tracePayloadItem;

        const payloadText = hostileItem?.description || hostileItem?.name || null;
        const reasonText =
          response.gatewayDecision?.reasons?.join('; ') ||
          response.gatewayDecision?.reason ||
          null;
        const merchantText =
          response.intent?.merchant ||
          response.gatewayDecision?.intent?.merchant ||
          null;

        setBlockedNotice({
          hostilePayload: payloadText || 'Blocked by gateway (payload details unavailable)',
          reason: reasonText || 'Blocked by gateway (payload details unavailable)',
          merchant: merchantText || '—'
        });
      }

      if (response.gatewayDecision?.status === 'HELD_FOR_CONFIRMATION') {
        const intentCart = extractIntentCart(response);
        if (intentCart) {
          onBiometricRequired({
            ...intentCart,
            gatewayReasons: response.gatewayDecision?.reasons || response.gatewayDecision?.gatewayResponse?.reasons,
            tier: response.gatewayDecision?.tier || 2,
            tier1Limit: response.gatewayDecision?.tier1Limit
          });
        }
      } else if (
        response.finalStatus === 'REJECTED_BY_GATEWAY' ||
        response.gatewayDecision?.policyDecision === 'REJECTED' ||
        response.gatewayDecision?.policyDecision === 'BLOCKED'
      ) {
        onIntentBlocked?.({
          intent: response.intent || response.gatewayDecision?.intent,
          gatewayDecision: response.gatewayDecision,
          finalStatus: response.finalStatus,
          timestamp: Date.now()
        });
      }
    } catch (err: any) {
      console.error('Agent execution error:', err);
      const msg = err.response?.data?.error || err.message || 'Agent service connection failed';
      setErrorMessage(`Execution error: ${msg}. Make sure SafeAgent services are started.`);
      setFinalStatus('ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col h-[580px]">
      {/* Header with Title and Clear Button */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-white flex items-center gap-2">
              <span>Cognitive Agent Planner</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                P2 Untrusted
              </span>
            </h2>
            <p className="text-xs text-slate-400">Autonomous reasoning, catalog discovery & MCP cart synthesis</p>
          </div>
        </div>

        {trace.length > 0 && (
          <button
            onClick={handleClearTrace}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs border border-slate-700/60 transition"
            title="Clear reasoning trace"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Preset Scenario Quick-Triggers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <button
          onClick={() => executeGoal(undefined, 'tier1')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500/50 transition text-xs group disabled:opacity-50"
        >
          <div className="flex items-center justify-between font-semibold text-blue-400 mb-0.5">
            <span>Scenario 1</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Tier 1 Micro-Tx</div>
          <div className="text-[9px] text-slate-500">Wireless mouse (Tier 1 Auto)</div>
        </button>

        <button
          onClick={() => executeGoal(undefined, 'tier2')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-yellow-500/50 transition text-xs group disabled:opacity-50"
        >
          <div className="flex items-center justify-between font-semibold text-yellow-400 mb-0.5">
            <span>Scenario 2</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Tier 2 Discretionary</div>
          <div className="text-[9px] text-slate-500">Keychron Keyboard (Passkey)</div>
        </button>

        <button
          onClick={() => executeGoal(undefined, 'injection')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-red-500/50 transition text-xs group disabled:opacity-50"
        >
          <div className="flex items-center justify-between font-semibold text-red-400 mb-0.5">
            <span>Scenario 3</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Hostile Injection</div>
          <div className="text-[9px] text-slate-500">Rogue USB exploit (Blocked)</div>
        </button>

        <button
          onClick={() => executeGoal(undefined, 'budget')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-purple-500/50 transition text-xs group disabled:opacity-50"
        >
          <div className="flex items-center justify-between font-semibold text-purple-400 mb-0.5">
            <span>Scenario 4</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Budget Recovery</div>
          <div className="text-[9px] text-slate-500">Budget limit recovery</div>
        </button>
      </div>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="mb-3 p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-xs flex items-center space-x-2 animate-in fade-in">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Hostile Injection Callout Card (Scenario 3 Highlight) */}
      {blockedNotice && (
        <div className="mb-3 p-3.5 rounded-xl bg-red-950/80 border border-red-500/70 text-red-200 text-xs space-y-2 animate-in fade-in shadow-lg shadow-red-950/50">
          <div className="flex items-center justify-between">
            <span className="font-bold flex items-center gap-1.5 text-red-400 text-xs">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              <span>Adversarial Prompt Injection Blocked</span>
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
              Gateway Firewall Slashed
            </span>
          </div>

          <div className="bg-black/70 p-2.5 rounded-lg font-mono text-[11px] text-red-300 border border-red-900/60 leading-relaxed">
            <span className="text-red-400 font-bold block mb-0.5">Intercepted Rogue Listing:</span>
            <code className="text-red-200">{blockedNotice.hostilePayload}</code>
          </div>

          <div className="text-[11px] text-red-300/90 leading-normal">
            <span className="font-semibold text-red-400">Policy Reason: </span>
            <span>{blockedNotice.reason}</span>
            {blockedNotice.merchant !== '—' && (
              <span className="block mt-1 text-slate-400">
                Target Merchant: <strong className="text-slate-200">{blockedNotice.merchant}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Reasoning Trace Log Container */}
      <div
        ref={traceContainerRef}
        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 overflow-y-auto font-mono text-xs space-y-2 mb-3"
      >
        {trace.length === 0 && !isLoading && !errorMessage && !blockedNotice && (
          <div className="h-full flex flex-col items-center justify-center text-slate-500">
            <Bot className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">Select a scenario preset or type a natural language shopping goal below.</p>
            <p className="text-[10px] text-slate-600 mt-1">
              E.g. "find me an ergonomic wireless mouse" or "Keychron mechanical keyboard"
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center space-x-2 text-cyan-400 p-2.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 animate-pulse">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="text-xs font-sans">
              Cognitive Agent parsing goal, exploring merchant APIs, and composing intent...
            </span>
          </div>
        )}

        {/* Color-Coded Trace Cards */}
        {trace.map((step, idx) => {
          const isThought = step.type === 'THOUGHT';
          const isToolCall = step.type === 'TOOL_CALL';
          const isToolResult = step.type === 'TOOL_RESULT';
          const isRecovery = step.type === 'RECOVERY';
          const isGateway = step.type === 'GATEWAY_RESPONSE';

          let cardBorder = 'border-slate-800/80 bg-slate-900/40';
          let badgeColor = 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
          let IconComponent = Brain;

          if (isThought) {
            cardBorder = 'border-blue-500/25 bg-blue-950/20';
            badgeColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20';
            IconComponent = Brain;
          } else if (isToolCall) {
            cardBorder = 'border-amber-500/25 bg-amber-950/20';
            badgeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            IconComponent = Terminal;
          } else if (isToolResult) {
            cardBorder = 'border-emerald-500/25 bg-emerald-950/20';
            badgeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            IconComponent = CheckCircle2;
          } else if (isRecovery) {
            cardBorder = 'border-purple-500/40 bg-purple-950/30';
            badgeColor = 'text-purple-300 bg-purple-500/15 border-purple-500/30';
            IconComponent = RefreshCw;
          } else if (isGateway) {
            cardBorder = 'border-cyan-500/30 bg-cyan-950/25';
            badgeColor = 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30';
            IconComponent = ShieldCheck;
          }

          const hasPayload = step.payload && Object.keys(step.payload).length > 0;
          const isExpanded = !!expandedPayloads[idx];

          return (
            <div key={idx} className={`p-2.5 rounded-xl border ${cardBorder} transition-all`}>
              <div className="flex items-center justify-between mb-1.5 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-md border font-bold flex items-center gap-1 ${badgeColor}`}>
                    <IconComponent className="h-3 w-3 shrink-0" />
                    <span>[{step.type}]</span>
                  </span>
                  <span className="text-slate-500 font-mono">Step #{step.step || idx + 1}</span>
                </div>
                <span className="text-slate-500">{formatTime(step.timestamp)}</span>
              </div>

              <p className="text-slate-200 text-xs font-mono leading-relaxed whitespace-pre-wrap">
                {step.content}
              </p>

              {/* Collapsible JSON Payload View */}
              {hasPayload && (
                <div className="mt-2 pt-2 border-t border-slate-800/60">
                  <button
                    type="button"
                    onClick={() => togglePayload(idx)}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-300 transition"
                  >
                    <Code2 className="h-3 w-3 text-cyan-400" />
                    <span>{isExpanded ? 'Hide Payload' : 'View Payload JSON'}</span>
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>

                  {isExpanded && (
                    <div className="mt-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-cyan-300 overflow-x-auto max-h-40 leading-relaxed select-all">
                      <pre>{JSON.stringify(step.payload, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div ref={traceBottomRef} />
      </div>

      {/* Goal Input & Dispatch Bar */}
      <div className="flex space-x-2">
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="E.g. 'find me an ergonomic wireless mouse'..."
          disabled={isLoading}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
          onKeyDown={(e) => e.key === 'Enter' && executeGoal()}
        />
        <button
          onClick={() => executeGoal()}
          disabled={isLoading || !goal.trim()}
          className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition shadow-md shadow-cyan-500/10 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          <span>Dispatch</span>
        </button>
      </div>
    </div>
  );
};
