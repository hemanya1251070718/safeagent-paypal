import React, { useState } from 'react';
import { Send, Bot, Sparkles, AlertTriangle, ShieldCheck, ArrowRight } from 'lucide-react';
import axios from 'axios';

interface AgentGoalChatProps {
  mandateId: string;
  onBiometricRequired: (intent: any) => void;
}

export const AgentGoalChat: React.FC<AgentGoalChatProps> = ({ mandateId, onBiometricRequired }) => {
  const [goal, setGoal] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [trace, setTrace] = useState<any[]>([]);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const executeGoal = async (customGoal?: string, scenarioId?: string) => {
    const targetGoal = customGoal || goal;
    if (!targetGoal.trim()) return;

    setIsLoading(true);
    setTrace([]);
    setFinalStatus(null);
    setErrorMessage(null);

    try {
      let response;
      if (scenarioId) {
        response = await axios.post(`http://localhost:4001/agent/scenario/${scenarioId}`, {
          mandateId
        });
      } else {
        response = await axios.post('http://localhost:4001/agent/plan', {
          goal: targetGoal,
          mandateId
        });
      }

      setTrace(response.data.trace || []);
      setFinalStatus(response.data.finalStatus || 'COMPLETE');

      if (response.data.gatewayDecision?.status === 'HELD_FOR_CONFIRMATION') {
        onBiometricRequired(response.data.intent || response.data.gatewayDecision.intent);
      }
    } catch (err: any) {
      console.error("Agent execution error:", err);
      const msg = err.response?.data?.error || err.message || 'Agent service connection failed on port 4001';
      setErrorMessage(`Execution error: ${msg}. Make sure SafeAgent services are started.`);
      setFinalStatus('ERROR');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col h-[560px]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-lg text-white">Cognitive Agent Interface (P2)</h2>
            <p className="text-xs text-slate-400">Untrusted cognitive planner exploring merchant APIs</p>
          </div>
        </div>
      </div>

      {/* Preset Scenario Quick-Triggers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <button
          onClick={() => executeGoal(undefined, 'tier1')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-blue-500/50 transition text-xs group"
        >
          <div className="flex items-center justify-between font-semibold text-blue-400 mb-0.5">
            <span>Scenario 1</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Tier 1 Micro-Tx</div>
          <div className="text-[9px] text-slate-500">Wireless mouse &lt; ₹2,500 (Auto)</div>
        </button>

        <button
          onClick={() => executeGoal(undefined, 'tier2')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-yellow-500/50 transition text-xs group"
        >
          <div className="flex items-center justify-between font-semibold text-yellow-400 mb-0.5">
            <span>Scenario 2</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Tier 2 Discretionary</div>
          <div className="text-[9px] text-slate-500">Keychron Keyboard (Biometric)</div>
        </button>

        <button
          onClick={() => executeGoal(undefined, 'injection')}
          disabled={isLoading}
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-red-500/50 transition text-xs group"
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
          className="text-left p-2.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-purple-500/50 transition text-xs group"
        >
          <div className="flex items-center justify-between font-semibold text-purple-400 mb-0.5">
            <span>Scenario 4</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-[11px] text-slate-300 font-medium truncate">Budget Recovery</div>
          <div className="text-[9px] text-slate-500">Rejection adaptation (INR)</div>
        </button>
      </div>

      {/* Error Alert Banner */}
      {errorMessage && (
        <div className="mb-3 p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-xs flex items-center space-x-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Reasoning Trace Log */}
      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 overflow-y-auto font-mono text-xs space-y-2 mb-4">
        {trace.length === 0 && !isLoading && !errorMessage && (
          <div className="h-full flex flex-col items-center justify-center text-slate-500">
            <Bot className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">Select a scenario preset or type a natural language shopping goal below.</p>
            <p className="text-[10px] text-slate-600 mt-1">E.g. "find me a brand new iphone 17 pro max" or "mechanical keyboard"</p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center space-x-2 text-cyan-400 p-2 animate-pulse">
            <Sparkles className="h-4 w-4" />
            <span>Agent parsing goal in INR, querying merchant catalogs, and composing intent...</span>
          </div>
        )}

        {trace.map((step, idx) => (
          <div key={idx} className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
            <div className="flex items-center justify-between mb-1 text-[10px]">
              <span className={`font-bold ${
                step.type === 'THOUGHT' ? 'text-blue-400' :
                step.type === 'TOOL_CALL' ? 'text-yellow-400' :
                step.type === 'TOOL_RESULT' ? 'text-emerald-400' :
                step.type === 'RECOVERY' ? 'text-purple-400' : 'text-cyan-400'
              }`}>
                [{step.type}]
              </span>
              <span className="text-slate-500">{new Date(step.timestamp).toLocaleTimeString()}</span>
            </div>
            <p className="text-slate-200 text-[11px] leading-relaxed">{step.content}</p>
          </div>
        ))}
      </div>

      {/* Input Box */}
      <div className="flex space-x-2">
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="E.g. 'find me a brand new iphone 17 pro max' or 'mouse under ₹2,000'..."
          disabled={isLoading}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          onKeyDown={(e) => e.key === 'Enter' && executeGoal()}
        />
        <button
          onClick={() => executeGoal()}
          disabled={isLoading || !goal.trim()}
          className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          <span>Dispatch</span>
        </button>
      </div>
    </div>
  );
};

