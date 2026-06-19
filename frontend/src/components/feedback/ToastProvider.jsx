import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

const ToastContext = createContext(null);

const typeMap = {
  success: {
    icon: CheckCircle2,
    className: "border-green-200 bg-green-50 text-green-900",
  },
  error: {
    icon: AlertCircle,
    className: "border-red-200 bg-red-50 text-red-900",
  },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (message, options = {}) => {
      if (!message) return;
      const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const type = options.type === "error" ? "error" : "success";
      const duration = Number(options.duration || 2600);
      setToasts((prev) => [...prev, { id, message: String(message), type }]);
      window.setTimeout(() => dismissToast(id), duration);
    },
    [dismissToast]
  );

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => {
          const ui = typeMap[toast.type] || typeMap.success;
          const Icon = ui.icon;
          return (
            <div
              key={toast.id}
              className={[
                "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-sm",
                ui.className,
              ].join(" ")}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 text-sm font-medium">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="rounded p-0.5 opacity-70 hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider.");
  return ctx;
}
