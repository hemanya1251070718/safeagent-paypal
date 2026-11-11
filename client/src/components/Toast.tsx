import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'error' | 'success' | 'warning' | 'info';
  title: string;
  message?: string;
  durationMs?: number;
}

type ToastListener = (toast: ToastItem) => void;
const listeners: ToastListener[] = [];

/**
 * Dispatches a toast notification globally across the application.
 */
export const showToast = (toast: Omit<ToastItem, 'id'>) => {
  const item: ToastItem = {
    ...toast,
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    durationMs: toast.durationMs ?? 4500
  };
  listeners.forEach((fn) => fn(item));
};

export const subscribeToast = (listener: ToastListener) => {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToast((newToast) => {
      setToasts((prev) => [...prev, newToast]);

      if (newToast.durationMs && newToast.durationMs > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
        }, newToast.durationMs);
      }
    });

    return unsubscribe;
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        let borderClass = 'border-slate-700 bg-slate-900/95';
        let icon = <Info className="h-5 w-5 text-blue-400 shrink-0" />;

        if (toast.type === 'error') {
          borderClass = 'border-rose-500/40 bg-rose-950/95 text-rose-100 shadow-rose-950/50';
          icon = <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />;
        } else if (toast.type === 'success') {
          borderClass = 'border-emerald-500/40 bg-emerald-950/95 text-emerald-100 shadow-emerald-950/50';
          icon = <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />;
        } else if (toast.type === 'warning') {
          borderClass = 'border-amber-500/40 bg-amber-950/95 text-amber-100 shadow-amber-950/50';
          icon = <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto border rounded-xl p-3.5 shadow-xl backdrop-blur-md flex items-start space-x-3 transition-all duration-200 animate-in slide-in-from-bottom-2 ${borderClass}`}
          >
            {icon}
            <div className="flex-1 min-w-0 pr-1">
              <h4 className="text-xs font-bold leading-tight tracking-tight text-white">{toast.title}</h4>
              {toast.message && (
                <p className="text-[11px] text-slate-300 mt-1 leading-normal break-words">
                  {toast.message}
                </p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-white p-0.5 rounded transition shrink-0"
              aria-label="Dismiss toast"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
