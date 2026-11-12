import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  AlertTriangle,
  RotateCcw,
  ShieldAlert,
  Code2,
  ChevronDown,
  ChevronUp,
  Bot,
  AlertCircle
} from 'lucide-react';
import { dispatchPlan, triggerScenario } from '../services/api';
import { formatTime } from '../utils/formatters';

interface AgentGoalChatProps {
  mandateId: string;
  externalGoal?: string;
  onBiometricRequired?: (intent: any) => void;
  onIntentBlocked?: (blockedEvent: any) => void;
  onOrderCaptured?: () => void;
}

export const AgentGoalChat: React.FC<AgentGoalChatProps> = ({
  mandateId,
  externalGoal,
  onBiometricRequired,
  onIntentBlocked,
  onOrderCaptured
}) => {
  const [goal, setGoal] = useState<string>('');
  const [trace, setTrace] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [expandedPayloads, setExpandedPayloads] = useState<Record<number, boolean>>({});
  const [blockedNotice, setBlockedNotice] = useState<{
    reason: string;
    hostilePayload: string;
    merchant: string;
    isAttack?: boolean;
  } | null>(null);
  const [unmatchedNotice, setUnmatchedNotice] = useState<{
    goal: string;
    reason?: string;
  } | null>(null);

  const traceContainerRef = useRef<HTMLDivElement>(null);
  const traceBottomRef = useRef<HTMLDivElement>(null);

  // Sync externalGoal from Catalog drawer if clicked
  useEffect(() => {
    if (externalGoal) {
      setGoal(externalGoal);
    }
  }, [externalGoal]);

  // Auto-scroll trace container on new items
  useEffect(() => {
    if (traceBottomRef.current) {
      traceBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [trace, isLoading, blockedNotice, unmatchedNotice]);

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
    setUnmatchedNotice(null);
    setExpandedPayloads({});
  };

  const executeGoal = async (customGoal?: string, scenarioId?: string) => {
    let targetGoal = customGoal || goal;
    if (scenarioId && !targetGoal.trim()) {
      if (scenarioId === 'tier1') targetGoal = "Find me an ergonomic wireless mouse";
      else if (scenarioId === 'tier2') targetGoal = "Buy me a Keychron mechanical keyboard";
      else if (scenarioId === 'injection') targetGoal = "Buy the cheapest USB flash drive available";
      else if (scenarioId === 'budget') targetGoal = "I want to buy an LG 4K monitor";
      setGoal(targetGoal);
    }
    if (!targetGoal.trim() && !scenarioId) return;

    setIsLoading(true);
    setTrace([]);
    setFinalStatus(null);
    setErrorMessage(null);
    setBlockedNotice(null);
    setUnmatchedNotice(null);
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

      // Check if Scenario 3 / hostile injection or spend ceiling block was triggered
      const isSanitizationAlert = (response.gatewayDecision?.sanitizationAlerts?.length || 0) > 0;
      const isExplicitInjection =
        scenarioId === 'injection' ||
        response.gatewayDecision?.policyDecision === 'BLOCKED' ||
        (response.gatewayDecision?.reasons || []).some((r: string) =>
          r.toLowerCase().includes('injection') ||
          r.toLowerCase().includes('override') ||
          r.toLowerCase().includes('rogue')
        );
      const isAttack = isSanitizationAlert || isExplicitInjection;
      const isPolicyBlocked =
        isAttack ||
        response.finalStatus === 'REJECTED_BY_GATEWAY' ||
        response.gatewayDecision?.policyDecision === 'REJECTED';

      if (isPolicyBlocked) {
        // Find item payload from response intent, gatewayDecision, or trace
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
          response.intent?.items?.[0] ||
          response.gatewayDecision?.intent?.items?.[0] ||
          tracePayloadItem;

        const payloadText = hostileItem?.description || (hostileItem ? `${hostileItem.name || hostileItem.id}${hostileItem.quantity ? ` (Qty: ${hostileItem.quantity})` : ''}` : null);
        const reasonText =
          response.gatewayDecision?.reasons?.join('; ') ||
          response.gatewayDecision?.reason ||
          response.gatewayDecision?.sanitizationAlerts?.[0] ||
          response.reason ||
          'Policy spend limit or constraint violated.';
        const merchantText = hostileItem?.merchant || response.intent?.merchant || '—';

        setBlockedNotice({
          reason: reasonText,
          hostilePayload: payloadText || 'Blocked by gateway (payload details unavailable)',
          merchant: merchantText,
          isAttack
        });
      }

      // Check for Biometric escalation
      if (
        response.finalStatus === 'PENDING_CONFIRMATION' ||
        response.gatewayDecision?.policyDecision === 'ESCALATE_BIOMETRIC' ||
        response.intent?.status === 'PENDING_CONFIRMATION'
      ) {
        const intentToConfirm = response.intent || response.gatewayDecision?.intent;
        if (intentToConfirm && onBiometricRequired) {
          onBiometricRequired(intentToConfirm);
        }
      }

      // Record blocked event to parent for ledger telemetry if rejected
      if (
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
      } else if (
        response.finalStatus === 'UNMATCHED_INTENT' ||
        response.finalStatus === 'NO_PRODUCTS_FOUND'
      ) {
        setUnmatchedNotice({
          goal: targetGoal,
          reason: response.error || 'Requested item is not available in approved merchant inventories.'
        });
      } else if (
        response.finalStatus === 'ACCEPTED_AND_CAPTURED' ||
        response.gatewayDecision?.status === 'ACCEPTED_AND_CAPTURED' ||
        response.gatewayDecision?.policyDecision === 'APPROVED'
      ) {
        onOrderCaptured?.();
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
    <div className="fintech-card p-5 sm:p-6 flex flex-col h-[580px] justify-between">
      <div>
        {/* Header with Title and Clear Button */}
        <div className="flex items-start justify-between border-b border-border pb-3 mb-3">
          <div>
            <span className="eyebrow text-sky-800 font-semibold tracking-wider">Planner</span>
            <h2 className="heading-section mt-0.5">Cognitive Agent</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Natural language planner with catalog exploration (holds zero credentials).
            </p>
          </div>

          {trace.length > 0 && (
            <button
              onClick={handleClearTrace}
              className="btn-secondary text-xs py-1 px-2.5 hover:bg-stone-100"
              title="Clear reasoning trace"
            >
              <RotateCcw className="h-3 w-3 text-ink-muted" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Polished Semantic Scenario Trigger Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <button
            onClick={() => executeGoal(undefined, 'tier1')}
            disabled={isLoading}
            className="bg-emerald-50/70 hover:bg-emerald-100/70 border border-emerald-200/90 text-emerald-950 rounded-lg p-2.5 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] text-left flex flex-col justify-between shadow-2xs group cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-emerald-900 text-xs">1. Tier 1 auto</span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </div>
            <span className="text-[10px] text-emerald-800/80 mt-1 leading-tight">Small mouse (&lt; limit)</span>
          </button>

          <button
            onClick={() => executeGoal(undefined, 'tier2')}
            disabled={isLoading}
            className="bg-sky-50/70 hover:bg-sky-100/70 border border-sky-200/90 text-sky-950 rounded-lg p-2.5 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] text-left flex flex-col justify-between shadow-2xs group cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-sky-900 text-xs">2. Tier 2 confirm</span>
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
            </div>
            <span className="text-[10px] text-sky-800/80 mt-1 leading-tight">Keyboard (passkey)</span>
          </button>

          <button
            onClick={() => executeGoal(undefined, 'injection')}
            disabled={isLoading}
            className="bg-rose-50/70 hover:bg-rose-100/70 border border-rose-200 text-rose-950 rounded-lg p-2.5 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] text-left flex flex-col justify-between shadow-2xs group cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-danger text-xs">3. Injection</span>
              <span className="h-1.5 w-1.5 rounded-full bg-danger"></span>
            </div>
            <span className="text-[10px] text-rose-800/80 mt-1 leading-tight">Hostile USB exploit</span>
          </button>

          <button
            onClick={() => executeGoal(undefined, 'budget')}
            disabled={isLoading}
            className="bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200/90 text-amber-950 rounded-lg p-2.5 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] text-left flex flex-col justify-between shadow-2xs group cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-amber-900 text-xs">4. Over budget</span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
            </div>
            <span className="text-[10px] text-amber-800/80 mt-1 leading-tight">Limit adaptation</span>
          </button>
        </div>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="mb-3 p-2.5 rounded-md bg-danger-light border border-[#F0C6BF] text-danger text-xs flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Policy / Injection Blocked Callout Card */}
        {blockedNotice && (
          <div className="mb-3 p-3.5 rounded-lg bg-rose-50/80 border-l-4 border-danger border border-rose-200 text-xs space-y-2 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5 text-danger">
                <ShieldAlert className="h-4 w-4" />
                <span>{blockedNotice.isAttack ? "Adversarial Prompt Injection Blocked" : "Mandate Spend Ceiling Exceeded"}</span>
              </span>
              <span className="badge-danger font-mono text-[10px]">
                {blockedNotice.isAttack ? "Policy Firebreak" : "Deterministic Hard Stop"}
              </span>
            </div>

            <div className="code-box bg-white p-2 text-[11px] leading-relaxed border-rose-200">
              <span className="text-danger font-semibold block mb-0.5">
                {blockedNotice.isAttack ? "Intercepted listing payload:" : "Blocked intent cart:"}
              </span>
              <code>{blockedNotice.hostilePayload}</code>
            </div>

            <div className="text-[11px] text-ink-muted leading-normal">
              <strong className="text-danger font-semibold">Gateway reason: </strong>
              <span>{blockedNotice.reason}</span>
              {blockedNotice.merchant !== '—' && (
                <span className="block mt-0.5 text-ink-muted">
                  Merchant: <strong className="text-ink">{blockedNotice.merchant}</strong>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Unmatched Intent / Relevance Floor Callout Card */}
        {unmatchedNotice && (
          <div className="mb-3 p-3.5 rounded-lg bg-amber-50/80 border-l-4 border-amber-500 border border-amber-200 text-xs space-y-1.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="font-bold flex items-center gap-1.5 text-amber-900 text-xs">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span>Shopping Intent Unmatched (Zero Funds Captured)</span>
              </span>
              <span className="badge-warning font-mono text-[10px]">
                Relevance Guardrail
              </span>
            </div>

            <div className="text-[11px] text-amber-950 leading-relaxed">
              No verified items matching <strong className="text-ink">"{unmatchedNotice.goal}"</strong> were found in approved merchant stores. SafeAgent halted cart execution to protect your wallet from unintended purchases.
            </div>
          </div>
        )}
      </div>

      {/* Reasoning Trace Log: Timeline with subtle tints */}
      <div
        ref={traceContainerRef}
        className="flex-1 bg-[#FAF9F5] border border-border rounded-md p-3 overflow-y-auto text-xs space-y-2 mb-3 min-h-0"
      >
        {trace.length === 0 && !isLoading && !errorMessage && !blockedNotice && !unmatchedNotice && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
            <div className="p-3 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 mb-1 shadow-2xs">
              <Bot className="h-6 w-6 stroke-[1.75]" />
            </div>
            <p className="text-xs font-semibold text-ink">Autonomous Planner Ready</p>
            <p className="text-[11px] text-ink-muted max-w-xs">
              Select a scenario preset above or type a natural shopping instruction below.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center space-x-2 text-emerald-900 p-2.5 rounded-md bg-emerald-50 border border-emerald-200 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-emerald-600 animate-ping"></span>
            <span className="text-xs font-medium">Planning goal, exploring merchant catalogs, and composing intent...</span>
          </div>
        )}

        {/* Timeline Trace Items */}
        {trace.map((step, idx) => {
          const isThought = step.type === 'THOUGHT';
          const isToolCall = step.type === 'TOOL_CALL';
          const isToolResult = step.type === 'TOOL_RESULT';
          const isRecovery = step.type === 'RECOVERY';
          const isGateway = step.type === 'GATEWAY_RESPONSE';

          let borderTint = 'border-l-3 border-l-border bg-surface';
          let badgeStyle = 'badge-neutral';
          let labelText = step.type;

          if (isThought) {
            borderTint = 'border-l-3 border-l-sky-500 bg-sky-50/40 border-sky-100';
            badgeStyle = 'badge-info';
            labelText = 'Thought';
          } else if (isToolCall) {
            borderTint = 'border-l-3 border-l-amber-500 bg-amber-50/30 border-amber-100';
            badgeStyle = 'badge-warning';
            labelText = 'Tool Call';
          } else if (isToolResult) {
            borderTint = 'border-l-3 border-l-emerald-500 bg-emerald-50/40 border-emerald-100';
            badgeStyle = 'badge-success';
            labelText = 'Tool Result';
          } else if (isRecovery) {
            borderTint = 'border-l-3 border-l-indigo-500 bg-indigo-50/40 border-indigo-100';
            badgeStyle = 'badge-info';
            labelText = 'Recovery';
          } else if (isGateway) {
            borderTint = 'border-l-3 border-l-accent bg-emerald-50/60 border-emerald-200';
            badgeStyle = 'badge-success';
            labelText = 'Gateway';
          }

          const hasPayload = step.payload && Object.keys(step.payload).length > 0;
          const isExpanded = !!expandedPayloads[idx];

          return (
            <div key={idx} className={`p-2.5 rounded border ${borderTint} text-xs shadow-2xs animate-in fade-in-50 slide-in-from-bottom-2 duration-300`}>
              <div className="flex items-center justify-between mb-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className={badgeStyle}>{labelText}</span>
                  <span className="text-ink-muted font-mono text-[10px]">Step {step.step || idx + 1}</span>
                </div>
                <span className="text-ink-muted text-[10px]">{formatTime(step.timestamp)}</span>
              </div>

              <p className="text-ink font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {step.content}
              </p>

              {/* Collapsible JSON Payload View */}
              {hasPayload && (
                <div className="mt-1.5 pt-1.5 border-t border-border/70">
                  <button
                    type="button"
                    onClick={() => togglePayload(idx)}
                    className="flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink transition"
                  >
                    <Code2 className="h-3 w-3 text-accent" />
                    <span>{isExpanded ? 'Hide payload' : 'View payload JSON'}</span>
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>

                  {isExpanded && (
                    <div className="mt-1 code-box max-h-36 overflow-x-auto text-[10px] select-all bg-white border-border/80">
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
      <div className="flex gap-2">
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="E.g. 'Find me an ergonomic wireless mouse'..."
          disabled={isLoading}
          className="input-text flex-1 text-xs"
          onKeyDown={(e) => e.key === 'Enter' && executeGoal()}
        />
        <button
          onClick={() => executeGoal()}
          disabled={isLoading || !goal.trim()}
          className="btn-primary text-xs py-2 px-4 shadow-xs hover:-translate-y-0.5 active:scale-[0.96] transition-all"
        >
          <Send className="h-3.5 w-3.5" />
          <span>Dispatch</span>
        </button>
      </div>
    </div>
  );
};
