'use client';

// Saturation/lightness square + hue slider + hex field. Used wherever a colour
// is picked for something the directory draws: node types and their aliases on
// Console → Types, and Person aliases on Console → Aliases.
//
// `onChange` fires live as the user drags, so callers that persist should do it
// on `onClose` (a press outside, Escape or Enter) rather than on every frame.

import { useCallback, useEffect, useRef, useState } from 'react';

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export default function ColorPicker({ color, onChange, onClose }: {
  color: string;
  onChange: (c: string) => void;
  onClose: () => void;
}) {
  const safeHex = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6b7280';
  const [h, s, l] = hexToHsl(safeHex);

  const [hue, setHue] = useState(h);
  const [sat, setSat] = useState(s);
  const [lit, setLit] = useState(l);
  const [hexInput, setHexInput] = useState(safeHex);

  const rootRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const current = hslToHex(hue, sat, lit);

  // Sync hex input whenever sliders change
  useEffect(() => {
    setHexInput(current);
    onChange(current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // A press anywhere outside, or Escape, closes — which is the save for callers
  // that persist on close.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current || rootRef.current.contains(e.target as Node)) return;
      closeRef.current();
      // The press that closed it must not reopen it through its own swatch.
      if ((e.target as Element).closest?.('[data-color-trigger]')) {
        const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') closeRef.current(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Drags follow the pointer past the control's edge until release.
  const drag = useCallback((el: HTMLElement | null, pick: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    if (!el) return;
    e.preventDefault();
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      pick(
        Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
      );
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex w-56 flex-col gap-3 rounded-xl border border-border-subtle bg-surface-1 p-3 shadow-float"
      onClick={e => e.stopPropagation()}
    >
      <div
        ref={gradientRef}
        className="relative h-36 w-full cursor-crosshair touch-none select-none rounded-lg"
        style={{
          background: `
            linear-gradient(to bottom, transparent, black),
            linear-gradient(to right, white, hsl(${hue}, 100%, 50%))
          `,
        }}
        onPointerDown={e => drag(gradientRef.current, (x, y) => {
          setSat(Math.round(x * 100));
          setLit(Math.round((1 - y) * 100));
        })(e)}
      >
        <div
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${sat}%`, top: `${100 - lit}%`, background: current }}
        />
      </div>

      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={hue}
        className="relative h-3 w-full cursor-pointer touch-none select-none rounded-full"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        onPointerDown={e => drag(hueRef.current, x => setHue(Math.round(x * 360)))(e)}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') setHue(v => Math.max(0, v - 5));
          if (e.key === 'ArrowRight') setHue(v => Math.min(360, v + 5));
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${(hue / 360) * 100}%`, background: `hsl(${hue}, 100%, 50%)` }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="h-7 w-7 shrink-0 rounded-md border border-border-default" style={{ background: current }} />
        <input
          className="min-w-0 flex-1 rounded-md border border-border-default bg-surface-2 px-2 py-1.5 font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-green/40"
          value={hexInput}
          onChange={e => {
            setHexInput(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
              const [nh, ns, nl] = hexToHsl(e.target.value);
              setHue(nh); setSat(ns); setLit(nl);
            }
          }}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex colour"
        />
      </div>
    </div>
  );
}
