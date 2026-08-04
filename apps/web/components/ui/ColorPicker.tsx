'use client';

// Saturation/lightness square + hue slider + hex field. Used wherever a colour
// is picked for something the directory draws: node types and their aliases on
// Console → Types, and Person aliases on Console → Aliases.
//
// `onChange` fires live as the user drags, so callers that persist should do it
// on `onClose` (the Done button) rather than on every frame.

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

  const gradientRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Sync hex input whenever sliders change
  useEffect(() => {
    const next = hslToHex(hue, sat, lit);
    setHexInput(next);
    onChange(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hue, sat, lit]);

  const pickFromGradient = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const el = gradientRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    // x = saturation 0→100, y = lightness 100→0 (top=bright, bottom=dark)
    setSat(Math.round(x * 100));
    setLit(Math.round((1 - y) * 100));
  }, []);

  return (
    <div
      className="bg-surface-1 border border-border-subtle rounded-xl p-3 shadow-xl flex flex-col gap-3 w-52"
      onClick={e => e.stopPropagation()}
    >
      {/* Saturation / lightness gradient box */}
      <div
        ref={gradientRef}
        className="w-full h-32 rounded-lg cursor-crosshair relative select-none"
        style={{
          background: `
            linear-gradient(to bottom, transparent, black),
            linear-gradient(to right, white, hsl(${hue}, 100%, 50%))
          `,
        }}
        onMouseDown={e => { dragging.current = true; pickFromGradient(e); }}
        onMouseMove={e => { if (dragging.current) pickFromGradient(e); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {/* Crosshair */}
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${sat}%`,
            top: `${100 - lit}%`,
            background: hslToHex(hue, sat, lit),
          }}
        />
      </div>

      {/* Hue rainbow slider */}
      <div className="flex items-center gap-2">
        <div
          className="h-3 rounded-full flex-1"
          style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        >
          <input
            type="range"
            min={0} max={360}
            value={hue}
            onChange={e => setHue(Number(e.target.value))}
            className="w-full h-3 opacity-0 cursor-pointer"
            style={{ marginTop: '-0.75rem' }}
            aria-label="Hue"
          />
        </div>
        {/* Current colour preview */}
        <div className="w-6 h-6 rounded-md border border-border-default shrink-0" style={{ background: hslToHex(hue, sat, lit) }} />
      </div>

      {/* Hex input */}
      <div className="flex items-center gap-2 border-t border-border-subtle pt-2">
        <span className="text-xs text-text-muted font-mono">HEX</span>
        <input
          className="flex-1 px-2 py-1 rounded-md border border-border-default bg-surface-2 text-xs font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-green/40"
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
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-muted hover:text-text-primary px-1.5 py-1 rounded hover:bg-surface-3 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
