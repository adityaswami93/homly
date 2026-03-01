import { useState, useCallback } from "react";
import type { ToastMessage, ToastType } from "@/app/components/Toast";

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info", duration?: number) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (msg: string, duration?: number) => addToast(msg, "success", duration),
    error:   (msg: string, duration?: number) => addToast(msg, "error",   duration),
    warning: (msg: string, duration?: number) => addToast(msg, "warning", duration),
    info:    (msg: string, duration?: number) => addToast(msg, "info",    duration),
  };

  return { toasts, dismissToast, toast };
}
