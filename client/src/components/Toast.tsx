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
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        let borderClass = 'border-l-4 border-l-slate-info';
        let icon = <Info className="h-4 w-4 text-slate-info shrink-0 mt-0.5" />;

        if (toast.type === 'error') {
          borderClass = 'border-l-4 border-l-danger';
          icon = <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />;
        } else if (toast.type === 'success') {
          borderClass = 'border-l-4 border-l-success';
          icon = <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />;
        } else if (toast.type === 'warning') {
          borderClass = 'border-l-4 border-l-saffron';
          icon = <AlertTriangle className="h-4 w-4 text-saffron shrink-0 mt-0.5" />;
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto bg-surface text-ink border border-border rounded-md p-3 shadow-floating flex items-start space-x-3 transition-all duration-200 animate-in slide-in-from-bottom-2 ${borderClass}`}
          >
            {icon}
            <div className="flex-1 min-w-0 pr-1">
              <h4 className="text-xs font-medium leading-tight text-ink">{toast.title}</h4>
              {toast.message && (
                <p className="text-[11px] text-ink-muted mt-1 leading-normal break-words">
                  {toast.message}
                </p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-ink-muted hover:text-ink p-0.5 rounded transition shrink-0"
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
