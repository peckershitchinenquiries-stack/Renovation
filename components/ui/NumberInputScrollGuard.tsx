"use client";

import { useEffect } from "react";

// Chrome/Edge change a focused <input type="number">'s value on mouse-wheel
// scroll. Blurring it on wheel stops that without touching every input.
export function NumberInputScrollGuard() {
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number") {
        el.blur();
      }
    };
    document.addEventListener("wheel", handleWheel, { passive: true });
    return () => document.removeEventListener("wheel", handleWheel);
  }, []);

  return null;
}
