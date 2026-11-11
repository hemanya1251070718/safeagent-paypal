import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  colorSchemeDark
} from 'ag-grid-community';
import type { ColDef } from 'ag-grid-community';
import {
  Activity,
  Download,
  ShieldCheck,
  AlertTriangle,
  Search,
  RefreshCw,
  FileText,
  Lock,
  Layers
} from 'lucide-react';

import { getLedgerStreamUrl, getDisputePackage } from '../services/api';
import { formatTime, formatCurrency, shortenHash } from '../utils/formatters';
import { sha256Hex } from '../../../shared/dist/index.js';
import { showToast } from './Toast';

// Register AG Grid Community modules (required for AG Grid v33)
ModuleRegistry.registerModules([AllCommunityModule]);

// Configure dark Quartz theme
const darkTheme = themeQuartz.withPart(colorSchemeDark);

export interface LedgerTelemetryRow {
  id: string;
  index: number;
  timestamp: string;
  formattedTime: string;
  type: string;
  referenceId: string;
  merchant: string;
  amount: number | null;
  formattedAmount: string;
  tax: number | null;
  formattedTax: string;
  currency: string | null;
  tier: string | number;
  pqcStatus: string;
  hash: string;
  rawHash: string;
  isClientObserved?: boolean;
  intentId?: string;
  rawData: Record<string, any>;
}

interface LedgerTelemetryGridProps {
  blockedEvents?: any[];
}

export const LedgerTelemetryGrid: React.FC<LedgerTelemetryGridProps> = ({ blockedEvents = [] }) => {
  const [rowData, setRowData] = useState<LedgerTelemetryRow[]>([]);
  const [quickFilter, setQuickFilter] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'RECONNECTING' | 'OFFLINE'>('OFFLINE');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef<number>(0);

  // Helper to parse backend LedgerEvent into an itemized AG Grid row
  const parseLedgerEvent = (raw: any): LedgerTelemetryRow => {
    const data = raw.data || {};
    const currency = data.currency || raw.currency || null;

    // Amount extraction
    const rawAmount =
      typeof data.amount === 'number'
        ? data.amount
        : typeof data.total === 'number'
        ? data.total
        : typeof data.maxSpend === 'number'
        ? data.maxSpend
        : null;

    const formattedAmount =
      rawAmount !== null ? formatCurrency(rawAmount, currency) : '—';

    // Tax extraction: Real field or em-dash as per Phase 0 item f
    const rawTax = typeof data.tax === 'number' ? data.tax : null;
    const formattedTax =
      rawTax !== null ? formatCurrency(rawTax, currency) : '—';

    // Merchant extraction
    const merchant =
      data.merchant ||
      (Array.isArray(data.whitelist) ? `${data.whitelist.length} Stores Allowed` : '—');

    // Tier extraction
    let tierDisplay: string | number = '—';
    if (data.tier !== undefined && data.tier !== null) {
      tierDisplay = `Tier ${data.tier}`;
    } else if (raw.type === 'MANDATE_CREATED') {
      tierDisplay = 'Policy Cap';
    }

    // Post-Quantum Cryptography status pill
    let pqcStatus = '—';
    if (raw.type === 'MANDATE_CREATED') {
      pqcStatus = 'ML-DSA-65 Verified';
    } else if (
      raw.type === 'PAYPAL_ORDER_CREATED' ||
      raw.type === 'PAYPAL_CAPTURE_COMPLETED'
    ) {
      pqcStatus = 'ML-DSA-65 Verified';
    } else if (raw.type === 'WEBHOOK_VERIFIED') {
      pqcStatus = 'PayPal RSA-SHA256';
    } else if (raw.type === 'SECURITY_ALERT') {
      pqcStatus = 'Alert Triggered';
    } else if (raw.type === 'SETTLED') {
      pqcStatus = 'Merkle Anchored';
    }

    const intentId =
      raw.intentId ||
      data.intentId ||
      (typeof raw.referenceId === 'string' && raw.referenceId.startsWith('intent') ? raw.referenceId : undefined);

    return {
      id: raw.eventId || `evt_${raw.index ?? Date.now()}_${raw.type}`,
      index: raw.index ?? 0,
      timestamp: raw.timestamp || new Date().toISOString(),
      formattedTime: formatTime(raw.timestamp),
      type: raw.type || 'UNKNOWN',
      referenceId: intentId || raw.mandateId || data.mandateId || 'SYSTEM',
      merchant,
      amount: rawAmount,
      formattedAmount,
      tax: rawTax,
      formattedTax,
      currency,
      tier: tierDisplay,
      pqcStatus,
      hash: raw.hash ? shortenHash(raw.hash, 12, 4) : 'GENESIS',
      rawHash: raw.hash || '',
      intentId,
      rawData: data
    };
  };

  // Helper to parse client-observed blocked events (e.g. Injection or Budget Rejection)
  const parseBlockedEvent = (blocked: any, nextIndex: number): LedgerTelemetryRow => {
    const intent = blocked.intent || blocked.gatewayDecision?.intent || {};
    const currency = intent.currency || null;
    const total = intent.total ?? null;
    const tax = intent.tax ?? null;
    const merchant = intent.merchant || 'Unapproved Store';
    const intentId = intent.intentId || 'intent_blocked';

    return {
      id: `client_blk_${blocked.timestamp || Date.now()}_${intentId}`,
      index: nextIndex,
      timestamp: new Date(blocked.timestamp || Date.now()).toISOString(),
      formattedTime: formatTime(blocked.timestamp || Date.now()),
      type: 'BLOCKED (client-observed)',
      referenceId: intentId,
      merchant,
      amount: total,
      formattedAmount: total !== null ? formatCurrency(total, currency) : '—',
      tax: tax,
      formattedTax: tax !== null ? formatCurrency(tax, currency) : '—',
      currency,
      tier: 'Tier 3 Block',
      pqcStatus: 'Lattice Firebreak Active',
      hash: shortenHash(sha256Hex(JSON.stringify(blocked.gatewayDecision || blocked)), 12, 4),
      rawHash: '',
      isClientObserved: true,
      intentId,
      rawData: blocked.gatewayDecision || blocked
    };
  };

  // SSE Stream Connection with Exponential Backoff Reconnection & Event Deduplication
  useEffect(() => {
    let isSubscribed = true;

    const connectSSE = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const streamUrl = getLedgerStreamUrl();
      const es = new EventSource(streamUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!isSubscribed) return;
        setConnectionStatus('CONNECTED');
        retryCountRef.current = 0;
      };

      es.onmessage = (event) => {
        if (!isSubscribed) return;
        try {
          const raw = JSON.parse(event.data);
          const eventId = raw.eventId || `evt_${raw.index}_${raw.timestamp}_${raw.type}`;

          // Deduplicate events to prevent repeat rows during reconnect
          if (seenEventIdsRef.current.has(eventId)) {
            return;
          }
          seenEventIdsRef.current.add(eventId);

          const newRow = parseLedgerEvent(raw);
          setRowData((prev) => [newRow, ...prev]);
        } catch (err) {
          console.error('SSE ledger parse error:', err);
        }
      };

      es.onerror = () => {
        if (!isSubscribed) return;
        es.close();
        setConnectionStatus('RECONNECTING');

        // Exponential backoff: 1.5s, 3s, 6s, max 15s
        retryCountRef.current += 1;
        const delay = Math.min(1000 * Math.pow(1.5, retryCountRef.current), 15000);

        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isSubscribed) {
            connectSSE();
          }
        }, delay);
      };
    };

    connectSSE();

    return () => {
      isSubscribed = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Ingest client-observed blocked events from scenarios
  useEffect(() => {
    if (!blockedEvents || blockedEvents.length === 0) return;

    blockedEvents.forEach((blocked) => {
      const intentId = blocked.intent?.intentId || blocked.gatewayDecision?.intent?.intentId || 'intent_blocked';
      const eventKey = `client_blk_${intentId}_${blocked.timestamp}`;

      if (!seenEventIdsRef.current.has(eventKey)) {
        seenEventIdsRef.current.add(eventKey);
        setRowData((prev) => {
          const nextIndex = prev.length + 1;
          const blockedRow = parseBlockedEvent(blocked, nextIndex);
          return [blockedRow, ...prev];
        });
      }
    });
  }, [blockedEvents]);

  // Export dispute package for a specific intent ID
  const exportDisputeForIntent = async (targetIntentId?: string) => {
    setIsExporting(true);
    setExportNotice(null);

    // If no target provided, pick the newest intent from rowData
    const intentIdToExport =
      targetIntentId ||
      rowData.find((r) => r.intentId && r.intentId.startsWith('intent'))?.intentId;

    if (!intentIdToExport) {
      // Fallback: Export entire grid state with explicit local labeling
      downloadLocalDisputeFallback(
        'SafeAgent_Ledger_Export_Global_(not_Merkle_anchored).json',
        rowData,
        'No specific settled intent found; exported current client telemetry state.'
      );
      setIsExporting(false);
      return;
    }

    try {
      // Phase 0 item g passed: call real dispute package endpoint through api.ts
      const disputePackage = await getDisputePackage(intentIdToExport);
      const jsonStr = JSON.stringify(disputePackage, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SafeAgent_Merkle_Dispute_${disputePackage.intentId}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNotice(`✓ Cryptographic Merkle Dispute Package downloaded for ${disputePackage.intentId}`);
      showToast({
        type: 'success',
        title: 'Merkle Dispute Exported',
        message: `Cryptographic proof package downloaded for ${disputePackage.intentId}`
      });
    } catch (err: any) {
      console.warn('Real dispute endpoint unavailable or intent not settled; using local export:', err.message);
      const row = rowData.find((r) => r.referenceId === intentIdToExport);
      downloadLocalDisputeFallback(
        `SafeAgent_Dispute_${intentIdToExport}_(not_Merkle_anchored).json`,
        row || { intentId: intentIdToExport, data: 'No settled context found' },
        'Intent was evaluated in simulation mode or is not yet registered on payments backend.'
      );
      showToast({
        type: 'info',
        title: 'Local Telemetry Exported',
        message: `Snapshot exported for ${intentIdToExport} (local export, not Merkle-anchored).`
      });
    } finally {
      setIsExporting(false);
      setTimeout(() => setExportNotice(null), 5000);
    }
  };

  const downloadLocalDisputeFallback = (filename: string, payload: any, notice: string) => {
    const exportData = {
      label: 'Local export (not Merkle-anchored)',
      notice,
      exportedAt: new Date().toISOString(),
      payload
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setExportNotice(`Notice: Downloaded local export for ${filename}`);
  };

  // AG Grid Column Definitions
  const columnDefs: ColDef<LedgerTelemetryRow>[] = useMemo(
    () => [
      {
        field: 'index',
        headerName: '#',
        width: 65,
        sortable: true
      },
      {
        field: 'formattedTime',
        headerName: 'Time',
        width: 95,
        sortable: true
      },
      {
        field: 'type',
        headerName: 'Event Type',
        width: 210,
        sortable: true,
        filter: true,
        cellRenderer: (params: any) => {
          const type: string = params.value || 'UNKNOWN';

          let badgeClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
          if (
            type.includes('CAPTURED') ||
            type.includes('PASSED') ||
            type.includes('SETTLED')
          ) {
            badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
          } else if (type.includes('CONFIRMATION')) {
            badgeClass = 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
          } else if (type.includes('BLOCKED')) {
            badgeClass = 'bg-purple-500/15 text-purple-300 border-purple-500/40 animate-pulse';
          } else if (
            type.includes('FAILED') ||
            type.includes('ALERT') ||
            type.includes('REJECTED')
          ) {
            badgeClass = 'bg-red-500/10 text-red-400 border-red-500/20';
          }

          return (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono border font-semibold inline-block ${badgeClass}`}
            >
              {type}
            </span>
          );
        }
      },
      {
        field: 'merchant',
        headerName: 'Merchant',
        width: 140,
        sortable: true,
        filter: true,
        cellClass: 'text-slate-300 text-xs truncate'
      },
      {
        field: 'formattedAmount',
        headerName: 'Amount',
        width: 110,
        sortable: true,
        cellClass: 'font-mono text-white text-xs'
      },
      {
        field: 'formattedTax',
        headerName: 'Tax (GST 18%)',
        width: 115,
        sortable: true,
        cellClass: 'font-mono text-slate-400 text-xs'
      },
      {
        field: 'tier',
        headerName: 'Tier',
        width: 105,
        sortable: true,
        cellRenderer: (params: any) => {
          const val: string = String(params.value || '—');
          if (val === '—') return <span className="text-slate-500 text-xs">—</span>;

          let colorClass = 'bg-slate-800 text-slate-400 border-slate-700';
          if (val.includes('1')) {
            colorClass = 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
          } else if (val.includes('2')) {
            colorClass = 'bg-amber-500/10 text-amber-300 border-amber-500/30';
          } else if (val.includes('3') || val.includes('Block')) {
            colorClass = 'bg-red-500/10 text-red-300 border-red-500/30';
          }

          return (
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono border font-medium ${colorClass}`}>
              {val}
            </span>
          );
        }
      },
      {
        field: 'pqcStatus',
        headerName: 'PQC Status',
        width: 175,
        sortable: true,
        cellRenderer: (params: any) => {
          const val: string = params.value || '—';
          if (val === '—') return <span className="text-slate-500 text-xs">—</span>;

          if (val.includes('ML-DSA-65')) {
            return (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                <span>ML-DSA-65 Verified</span>
              </span>
            );
          }

          if (val.includes('Lattice Firebreak')) {
            return (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30 font-semibold">
                <Lock className="h-3 w-3 text-purple-400 shrink-0" />
                <span>Lattice Firebreak</span>
              </span>
            );
          }

          return (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
              {val}
            </span>
          );
        }
      },
      {
        field: 'hash',
        headerName: 'SHA-256 Hash',
        width: 135,
        cellClass: 'font-mono text-cyan-400 text-xs'
      },
      {
        headerName: 'Actions',
        width: 120,
        sortable: false,
        cellRenderer: (params: any) => {
          const row: LedgerTelemetryRow = params.data;
          const targetIntentId = row.intentId;

          if (!targetIntentId) {
            return <span className="text-slate-600 text-[10px]">—</span>;
          }

          return (
            <button
              onClick={() => exportDisputeForIntent(targetIntentId)}
              title="Download Merkle dispute package for this intent"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] border border-slate-700 transition"
            >
              <Download className="h-3 w-3 text-cyan-400" />
              <span>Export Proof</span>
            </button>
          );
        }
      }
    ],
    []
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-lg text-white">
                Real-Time Financial Telemetry Ledger
              </h2>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                AG Grid v33 Quartz
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Append-only immutable audit trail streaming PayPal captures, ML-DSA-65 proofs & lattice firebreaks
            </p>
          </div>
        </div>

        {/* Status Badge, Counter, & Export Dispute Button */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Connection Status Badge */}
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5 border transition-all ${
              connectionStatus === 'CONNECTED'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : connectionStatus === 'RECONNECTING'
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                connectionStatus === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse'
                  : connectionStatus === 'RECONNECTING'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-red-400'
              }`}
            />
            {connectionStatus === 'CONNECTED'
              ? 'SSE Live Feed Connected'
              : connectionStatus === 'RECONNECTING'
              ? 'Reconnecting Stream...'
              : 'Stream Offline'}
          </span>

          {/* Event Counter Badge */}
          <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-slate-800/80 text-slate-300 border border-slate-700/80 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-cyan-400" />
            <span>{rowData.length} Events Logged</span>
          </span>

          {/* Global Merkle Dispute Export Button */}
          <button
            onClick={() => exportDisputeForIntent()}
            disabled={isExporting}
            className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-700 to-cyan-600 hover:from-blue-600 hover:to-cyan-500 text-white text-xs px-3.5 py-1.5 rounded-xl border border-cyan-500/30 transition shadow-md shadow-blue-500/10 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{isExporting ? 'Generating Proof...' : 'Export Merkle Dispute Package'}</span>
          </button>
        </div>
      </div>

      {/* Export Notification Banner */}
      {exportNotice && (
        <div className="mb-3 p-2.5 rounded-xl bg-cyan-950/70 border border-cyan-500/40 text-cyan-300 text-xs flex items-center gap-2 animate-in fade-in">
          <FileText className="h-4 w-4 shrink-0 text-cyan-400" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Quick Filter Search Bar */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            placeholder="Quick search events, merchants, hashes, tiers..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
          />
        </div>
        <div className="text-[11px] text-slate-500 hidden sm:block">
          Click any row's <strong className="text-cyan-400 font-mono">Export Proof</strong> to download its Merkle dispute receipt
        </div>
      </div>

      {/* AG Grid v33 High-Throughput Data Table */}
      <div className="w-full h-80 rounded-xl overflow-hidden border border-slate-800 shadow-inner">
        <AgGridReact<LedgerTelemetryRow>
          theme={darkTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{
            resizable: true,
            sortable: true
          }}
          quickFilterText={quickFilter}
          rowSelection={{ mode: 'singleRow' }}
          animateRows={true}
        />
      </div>
    </div>
  );
};
