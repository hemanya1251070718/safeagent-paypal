import React, { useEffect, useState, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef } from 'ag-grid-community';
import { Activity, Download, CheckCircle, ShieldCheck } from 'lucide-react';

interface LedgerEventRow {
  index: number;
  timestamp: string;
  type: string;
  intentId: string;
  hash: string;
  summary: string;
}

export const LedgerTelemetryGrid: React.FC = () => {
  const [rowData, setRowData] = useState<LedgerEventRow[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:5000/ledger/stream');

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        const newRow: LedgerEventRow = {
          index: raw.index ?? 0,
          timestamp: new Date(raw.timestamp || Date.now()).toLocaleTimeString(),
          type: raw.type,
          intentId: raw.intentId || raw.mandateId || 'SYSTEM',
          hash: raw.hash ? raw.hash.substring(0, 16) + '...' : 'GENESIS',
          summary: JSON.stringify(raw.data || {})
        };

        setRowData(prev => [newRow, ...prev]);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const columnDefs: ColDef<LedgerEventRow>[] = useMemo(() => [
    { field: 'index', headerName: '#', width: 70, sortable: true },
    { field: 'timestamp', headerName: 'Time', width: 110 },
    {
      field: 'type',
      headerName: 'Ledger Event Type',
      width: 220,
      cellRenderer: (params: any) => {
        const type = params.value;
        let colorClass = "bg-blue-500/10 text-blue-400 border-blue-500/20";
        if (type.includes('CAPTURED') || type.includes('PASSED') || type.includes('SETTLED')) {
          colorClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
        } else if (type.includes('CONFIRMATION')) {
          colorClass = "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
        } else if (type.includes('FAILED') || type.includes('ALERT') || type.includes('REJECTED')) {
          colorClass = "bg-red-500/10 text-red-400 border-red-500/20";
        }
        return (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono border font-semibold ${colorClass}`}>
            {type}
          </span>
        );
      }
    },
    { field: 'intentId', headerName: 'Reference ID', width: 160 },
    { field: 'hash', headerName: 'SHA-256 Hash Block', width: 180, cellClass: 'font-mono text-cyan-400 text-xs' },
    { field: 'summary', headerName: 'Itemized Telemetry & Proofs', flex: 1, cellClass: 'text-slate-400 text-xs font-mono truncate' }
  ], []);

  const handleExportDispute = () => {
    const jsonStr = JSON.stringify(rowData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SafeAgent_Merkle_Dispute_Package_${Date.now()}.json`;
    a.click();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-lg text-white">Real-Time Financial Telemetry Ledger</h2>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">Powered by AG Grid</span>
            </div>
            <p className="text-xs text-slate-400">Append-only Merkle ledger streaming PayPal captures and PQC verification proofs</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5 border ${
            isConnected
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
          }`}>
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`}></span>
            {isConnected ? 'SSE Live Feed (5000)' : 'Connecting to Stream...'}
          </span>

          <button
            onClick={handleExportDispute}
            className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-xl border border-slate-700 transition"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Merkle Dispute Package</span>
          </button>
        </div>
      </div>

      <div className="ag-theme-alpine-dark w-full h-72 rounded-xl overflow-hidden border border-slate-800">
        <AgGridReact
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true }}
          rowSelection="single"
          animateRows={true}
        />
      </div>
    </div>
  );
};

