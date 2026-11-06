"use client";

import { useEffect, type RefObject } from "react";

/** Calls `onDismiss` on Escape or a pointer press outside `ref`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, active, onDismiss]);
}
