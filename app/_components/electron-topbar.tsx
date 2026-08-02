"use client";

import { useState, useEffect } from "react";

export function ElectronTopBar() {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    setIsElectron(navigator.userAgent.includes("Electron"));
  }, []);

  if (!isElectron) return null;

  return (
    <div
      className="h-9 w-full shrink-0 border-b border-border bg-card"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    />
  );
}
