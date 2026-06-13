'use client';

/**
 * Scope tabs for the Events page (Discover / Community / My events).
 * Matches MessagesTabSelector styling — grey border, muted inactive text, animated green pill.
 */

import { useEffect, useRef, useState } from 'react';
import { Compass, Users, CalendarCheck } from 'lucide-react';

export type EventScope = 'discover' | 'community' | 'mine';

const SCOPES: { id: EventScope; label: string; icon: React.ElementType }[] = [
  { id: 'discover', label: 'Discover Events', icon: Compass },
  { id: 'community', label: 'Community Events', icon: Users },
  { id: 'mine', label: 'My Events', icon: CalendarCheck },
];

function measureBtn(btn: HTMLButtonElement, container: HTMLDivElement) {
  const b = btn.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { left: b.left - c.left, width: b.width };
}

export default function EventsScopeSelector({ scope, onScopeChange }: {
  scope: EventScope;
  onScopeChange: (scope: EventScope) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number } | null>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const activeIndex = SCOPES.findIndex(s => s.id === scope);
    const btn = buttonRefs.current[activeIndex];
    if (!container || !btn) return;
    setPillStyle(measureBtn(btn, container));
    requestAnimationFrame(() => { animatedRef.current = true; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!animatedRef.current) return;
    const container = containerRef.current;
    const activeIndex = SCOPES.findIndex(s => s.id === scope);
    const btn = buttonRefs.current[activeIndex];
    if (!container || !btn) return;
    setPillStyle(measureBtn(btn, container));
  }, [scope]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 rounded-2xl border border-border-default bg-surface-1 p-1 h-12 shadow-float"
    >
      {pillStyle && (
        <span
          className="absolute top-1 bottom-1 rounded-xl bg-brand-green shadow-sm"
          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: 'left 220ms cubic-bezier(0.4,0,0.2,1), width 220ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      )}

      {SCOPES.map(({ id, label, icon: Icon }, i) => (
        <button
          key={id}
          ref={el => { buttonRefs.current[i] = el; }}
          type="button"
          onClick={() => onScopeChange(id)}
          className={`relative z-10 flex h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-colors duration-200 ${
            scope === id ? 'text-white' : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label={`${label} tab`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
