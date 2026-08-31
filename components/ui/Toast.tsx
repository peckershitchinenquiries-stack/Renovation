"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { Icon, type IconName } from "./Icon";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx.toast;
}

const KIND: Record<ToastKind, { icon: IconName; dot: string }> = {
  success: { icon: "check", dot: "bg-emerald-400" },
  error: { icon: "alert", dot: "bg-red-400" },
  info: { icon: "info", dot: "bg-blue-400" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/*
        Toasts sit above the bottom tab bar on mobile — a message that covers
        the navigation is a message that blocks the way out. One dark surface
        for all three kinds, with the colour carried by the icon: three
        full-width coloured slabs is a lot of shouting for "Saved".
      */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col
          items-center gap-2 px-4 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+0.75rem)]
          sm:inset-x-auto sm:right-4 sm:items-end sm:pb-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-3
              rounded-2xl bg-gray-900/95 px-4 py-3 text-sm font-medium text-white
              shadow-pop backdrop-blur-xl"
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${KIND[t.kind].dot} text-gray-900`}
            >
              <Icon name={KIND[t.kind].icon} size={14} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
