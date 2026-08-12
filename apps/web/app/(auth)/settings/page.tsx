'use client';

import React, { Suspense } from 'react';
import { useTheme, COLOR_THEMES, ColorTheme } from '@/features/shared/contexts/ThemeContext';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import LoadingText from '@/components/ui/LoadingText';
import ConnectClaudePanel from '@/features/settings/components/ConnectClaudePanel';

/**
 * Personal settings. Same shell as the Community Console — a pane-top tab bar
 * with `?section=` in the URL — so the two settings-shaped pages navigate
 * identically instead of one docking a column into the Sidebar and the other
 * not. See ConsoleShell for the bar itself.
 */

// ─── Sections ─────────────────────────────────────────────────────────────────

// Only the tabs that do something. Account / Notifications / Privacy were
// coming-soon placeholders and are gone until there's something behind them.
const SECTIONS: ConsoleSection[] = [
  { id: 'appearance', label: 'Appearance', width: 'form' },
  { id: 'mcp', label: 'MCP', width: 'form' },
];

// ─── Color swatch ─────────────────────────────────────────────────────────────

function ThemeSwatch({ t, active, onSelect }: { t: ColorTheme; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      aria-label={`Select ${t.name} theme`}
      title={t.name}
      className="focus:outline-none"
    >
      <div
        className="w-8 h-8 rounded-full transition-all duration-200"
        style={{
          background: t.accent,
          boxShadow: active
            ? `0 0 0 2px var(--surface-1, white), 0 0 0 4px ${t.accent}`
            : '0 1px 3px rgba(0,0,0,0.20)',
          transform: active ? 'scale(1.15)' : 'scale(1)',
        }}
      />
    </button>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-8">
      {/* Theme colour — the only thing here that does anything. */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Theme Colour</h3>
        <p className="text-xs text-text-muted mb-4">
          {theme.name} — applies instantly and persists between sessions.
        </p>
        <div className="flex flex-wrap gap-3">
          {COLOR_THEMES.map(t => (
            <ThemeSwatch
              key={t.id}
              t={t}
              active={theme.id === t.id}
              onSelect={() => setTheme(t.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function renderSection(id: string) {
  switch (id) {
    case 'appearance':
      return <AppearanceSection />;
    case 'mcp':
      return <ConnectClaudePanel />;
    default:
      return null;
  }
}

export default function SettingsPage() {
  // ConsoleShell reads `?section=` via useSearchParams, so it needs a Suspense
  // boundary above it — same shape as the console at app/(auth)/admin/page.tsx.
  return (
    <Suspense
      fallback={
        <div className="w-full px-6 py-8">
          <LoadingText text="Loading…" />
        </div>
      }
    >
      <ConsoleShell sections={SECTIONS} renderSection={renderSection} ariaLabel="Settings sections" />
    </Suspense>
  );
}
