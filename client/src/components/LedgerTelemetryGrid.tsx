import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz
} from 'ag-grid-community';
import type { ColDef } from 'ag-grid-community';
import {
  Download,
  ShieldCheck,
  Search,
  Lock,
  Layers,
  FileText
} from 'lucide-react';

import { getLedgerStreamUrl, getDisputePackage } from '../services/api';
import { formatTime, formatCurrency, shortenHash } from '../utils/formatters';
import { sha256Hex } from '../../../shared/dist/index.js';
import { showToast } from './Toast';

// Register AG Grid Community modules (required for AG Grid v33)
ModuleRegistry.registerModules([AllCommunityModule]);

// Configure custom light fintech Quartz theme matching the palette
const lightFintechTheme = themeQuartz.withParams({
  backgroundColor: '#FFFFFF',
  foregroundColor: '#1C2430',
  headerBackgroundColor: '#F6F4EE',
  headerTextColor: '#6B7280',
  headerFontSize: 11,
  headerFontWeight: 600,
  borderColor: '#E4E0D6',
  rowBorder: { style: 'solid', width: 1, color: '#E4E0D6' },
  rowHoverColor: '#FAF8F3',
  selectedRowBackgroundColor: '#EAF5EE',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 12,
  rowHeight: 38,
  headerHeight: 36
});

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

    // Tax extraction: Real field or em-dash
    const rawTax = typeof data.tax === 'number' ? data.tax : null;
    const formattedTax =
      rawTax !== null ? formatCurrency(rawTax, currency) : '—';

    // Merchant extraction
    const merchant =
      data.merchant ||
      (Array.isArray(data.whitelist) ? `${data.whitelist.length} stores` : '—');

    // Tier extraction
    let tierDisplay: string | number = '—';
    if (data.tier !== undefined && data.tier !== null) {
      tierDisplay = `Tier ${data.tier}`;
    } else if (raw.type === 'MANDATE_CREATED') {
      tierDisplay = 'Mandate';
    }

    // Post-Quantum Cryptography status
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
      hash: raw.hash ? shortenHash(raw.hash, 10, 4) : 'GENESIS',
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
    const merchant = intent.merchant || 'Unapproved store';
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
      pqcStatus: 'Lattice Firebreak',
      hash: shortenHash(sha256Hex(JSON.stringify(blocked.gatewayDecision || blocked)), 10, 4),
      rawHash: '',
      isClientObserved: true,
      intentId,
      rawData: blocked.gatewayDecision || blocked
    };
  };

  // Establish resilient SSE connection to Payments ledger stream
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
      downloadLocalDisputeFallback(
        'SafeAgent_Ledger_Export_Global_(not_Merkle_anchored).json',
        rowData,
        'No specific settled intent found; exported current client telemetry state.'
      );
      setIsExporting(false);
      return;
    }

    try {
      const disputePackage = await getDisputePackage(intentIdToExport);
      const jsonStr = JSON.stringify(disputePackage, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SafeAgent_Merkle_Dispute_${disputePackage.intentId}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNotice(`Downloaded Merkle dispute package for ${disputePackage.intentId}`);
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
    setExportNotice(`Downloaded local export: ${filename}`);
  };

  // AG Grid Column Definitions with refined, calm styling
  const columnDefs: ColDef<LedgerTelemetryRow>[] = useMemo(
    () => [
      {
        field: 'index',
        headerName: '#',
        width: 55,
        sortable: true,
        cellClass: 'text-ink-muted text-xs'
      },
      {
        field: 'formattedTime',
        headerName: 'Time',
        width: 90,
        sortable: true,
        cellClass: 'text-ink-muted text-xs font-mono'
      },
      {
        field: 'type',
        headerName: 'Event type',
        width: 200,
        sortable: true,
        filter: true,
        cellRenderer: (params: any) => {
          const type: string = params.value || 'UNKNOWN';

          let badgeClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200';
          if (
            type.includes('CAPTURED') ||
            type.includes('PASSED') ||
            type.includes('SETTLED')
          ) {
            badgeClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
          } else if (type.includes('CONFIRMATION')) {
            badgeClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200';
          } else if (
            type.includes('BLOCKED') ||
            type.includes('FAILED') ||
            type.includes('ALERT') ||
            type.includes('REJECTED')
          ) {
            badgeClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200';
          }

          return (
            <span className={badgeClass}>
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
        cellClass: 'text-ink text-xs font-medium truncate'
      },
      {
        field: 'formattedAmount',
        headerName: 'Amount',
        width: 110,
        sortable: true,
        cellClass: 'font-mono text-ink font-semibold text-xs'
      },
      {
        field: 'formattedTax',
        headerName: 'Tax',
        width: 95,
        sortable: true,
        cellClass: 'font-mono text-ink-muted text-xs'
      },
      {
        field: 'tier',
        headerName: 'Tier',
        width: 100,
        sortable: true,
        cellRenderer: (params: any) => {
          const val: string = String(params.value || '—');
          if (val === '—') return <span className="text-ink-subtle text-xs">—</span>;

          let badgeStyle = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-700 border border-stone-200';
          if (val.includes('1')) {
            badgeStyle = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-800 border border-sky-200';
          } else if (val.includes('2')) {
            badgeStyle = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200';
          } else if (val.includes('3') || val.includes('Block')) {
            badgeStyle = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200';
          }

          return (
            <span className={badgeStyle}>
              {val}
            </span>
          );
        }
      },
      {
        field: 'pqcStatus',
        headerName: 'PQC status',
        width: 165,
        sortable: true,
        cellRenderer: (params: any) => {
          const val: string = params.value || '—';
          if (val === '—') return <span className="text-ink-subtle text-xs">—</span>;

          if (val.includes('ML-DSA-65')) {
            return (
              <span className="badge-success">
                <ShieldCheck className="h-3 w-3 text-accent" />
                <span>ML-DSA-65</span>
              </span>
            );
          }

          if (val.includes('Lattice Firebreak')) {
            return (
              <span className="badge-danger">
                <Lock className="h-3 w-3 text-danger" />
                <span>Firebreak</span>
              </span>
            );
          }

          return (
            <span className="badge-neutral">
              {val}
            </span>
          );
        }
      },
      {
        field: 'hash',
        headerName: 'SHA-256 hash',
        width: 125,
        cellClass: 'font-mono text-ink-muted text-xs'
      },
      {
        headerName: 'Actions',
        width: 110,
        sortable: false,
        cellRenderer: (params: any) => {
          const row: LedgerTelemetryRow = params.data;
          const targetIntentId = row.intentId;

          if (!targetIntentId) {
            return <span className="text-ink-subtle text-[11px]">—</span>;
          }

          return (
            <button
              onClick={() => exportDisputeForIntent(targetIntentId)}
              title="Download Merkle dispute proof for this intent"
              className="btn-secondary text-[10px] py-0.5 px-2 font-mono"
            >
              <Download className="h-2.5 w-2.5 text-ink-muted" />
              <span>Proof</span>
            </button>
          );
        }
      }
    ],
    []
  );

  return (
    <div className="fintech-card p-5 sm:p-6 space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <span className="eyebrow">Audit & Settlement</span>
          <h2 className="heading-section mt-0.5">Financial Telemetry Ledger</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Append-only hash-chained ledger streaming live PayPal captures and cryptographic proofs.
          </p>
        </div>

        {/* Toolbar Right: Status, Counter & Export */}
        <div className="flex items-center gap-2.5">
          {/* Connection Status Badge */}
          <div
            className={`flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full border ${
              connectionStatus === 'CONNECTED'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : connectionStatus === 'RECONNECTING'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-stone-100 text-stone-600 border-stone-200'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connectionStatus === 'CONNECTED'
                  ? 'bg-emerald-500 animate-pulse'
                  : connectionStatus === 'RECONNECTING'
                  ? 'bg-amber-500 animate-ping'
                  : 'bg-stone-400'
              }`}
            />
            <span className="font-semibold text-[11px]">
              {connectionStatus === 'CONNECTED'
                ? 'SSE Live'
                : connectionStatus === 'RECONNECTING'
                ? 'Reconnecting'
                : 'Offline'}
            </span>
          </div>

          {/* Event Counter Badge */}
          <span className="text-xs font-mono text-emerald-950 bg-emerald-50/70 px-2.5 py-0.5 rounded-full border border-emerald-200/80 font-medium">
            {rowData.length} events
          </span>

          {/* Global Dispute Export Button */}
          <button
            onClick={() => exportDisputeForIntent()}
            disabled={isExporting}
            className="btn-secondary text-xs hover:border-amber-300 hover:bg-amber-50/60 text-amber-950 font-medium"
          >
            <Download className="h-3.5 w-3.5 text-amber-700" />
            <span>Export dispute package</span>
          </button>
        </div>
      </div>

      {/* Export Notification Banner */}
      {exportNotice && (
        <div className="p-2.5 rounded bg-page border border-border text-ink text-xs flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-accent shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Quick Filter Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-3.5 w-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            placeholder="Search events, merchants, hashes..."
            className="input-text w-full pl-8 text-xs"
          />
        </div>
        <span className="text-[11px] text-ink-muted hidden sm:inline">
          Click <strong className="font-mono text-ink">Proof</strong> to download Merkle dispute receipt
        </span>
      </div>

      {/* AG Grid v33 High-Throughput Data Table */}
      <div className="w-full rounded border border-border overflow-hidden" style={{ height: '380px', width: '100%', minHeight: '380px' }}>
        <AgGridReact<LedgerTelemetryRow>
          theme={lightFintechTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{
            resizable: true,
            sortable: true
          }}
          quickFilterText={quickFilter}
          rowSelection={{ mode: 'singleRow' }}
          animateRows={true}
          getRowClass={(params) =>
            params.data?.isClientObserved ? 'bg-[#FDF3F1]' : ''
          }
        />
      </div>
    </div>
  );
};
