"use client";

import { useEffect, useState } from "react";

const LAUNCH_ISO = "2026-07-01T18:00:00+12:00";
const TARGET_MS = new Date(LAUNCH_ISO).getTime();

function diff() {
  const ms = Math.max(0, TARGET_MS - Date.now());
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return { days, hours, minutes, seconds };
}

export default function Countdown() {
  const [t, setT] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    setT(diff());
    const id = setInterval(() => setT(diff()), 1000);
    return () => clearInterval(id);
  }, []);

  const cells: { value: number; label: string }[] = [
    { value: t.days, label: "days" },
    { value: t.hours, label: "hrs" },
    { value: t.minutes, label: "min" },
    { value: t.seconds, label: "sec" },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs uppercase tracking-[0.18em] text-neutral-500">
        Launching early access in
      </p>
      <div className="flex items-end gap-3 sm:gap-5">
        {cells.map((c, i) => (
          <div key={c.label} className="flex items-end gap-3 sm:gap-5">
            <div className="flex flex-col items-center">
              <span
                suppressHydrationWarning
                className="text-2xl sm:text-3xl font-medium tabular-nums leading-none"
              >
                {String(c.value).padStart(2, "0")}
              </span>
              <span className="mt-1 text-[10px] sm:text-xs uppercase tracking-wider text-neutral-500">
                {c.label}
              </span>
            </div>
            {i < cells.length - 1 && (
              <span className="text-2xl sm:text-3xl font-medium text-neutral-300 leading-none pb-4">
                :
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
