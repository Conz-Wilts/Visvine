'use client';

import React, { Suspense } from 'react';
import { useTheme, COLOR_THEMES, ColorTheme } from '@/features/shared/contexts/ThemeContext';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import LoadingText from '@/components/ui/LoadingText';
import ConnectClaudePanel from '@/features/settings/components/ConnectClaudePanel';
import DeleteAccountPanel from '@/features/settings/components/DeleteAccountPanel';

/**
 * Personal settings. Same shell as the Space Console — a pane-top tab bar
 * with `?section=` in the URL — so the two settings-shaped pages navigate
 * identically instead of one docking a column into the Sidebar and the other
 * not. See ConsoleShell for the bar itself.
 */

// ─── Sections ─────────────────────────────────────────────────────────────────

// Only the tabs that do something. Privacy was a coming-soon placeholder and is
// gone until there's something behind it; Account is here because deleting your
// account is something.
const SECTIONS: ConsoleSection[] = [
  { id: 'appearance', label: 'Appearance', width: 'form' },
  { id: 'mcp', label: 'MCP', width: 'form' },
  { id: 'account', label: 'Account', width: 'form' },
];

// ─── Swatches ─────────────────────────────────────────────────────────────────

const swatchRing = (active: boolean, accent: string) =>
  active
    ? `0 0 0 2px var(--surface-1, white), 0 0 0 4px ${accent}`
    : 'inset 0 0 0 1px var(--border-subtle, #e5e7eb)';

/** One theme set: the accent dot sitting on the set's soft tint. */
function ThemeSwatch({ t, active, onSelect }: { t: ColorTheme; active: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} aria-label={`Select ${t.name} theme`} title={t.name} className="focus:outline-none">
      <div
        className="flex h-12 w-16 items-center justify-center rounded-lg transition-all duration-200"
        style={{
          background: t.accentLight,
          boxShadow: swatchRing(active, t.accent),
          transform: active ? 'scale(1.08)' : 'scale(1)',
        }}
      >
        <span className="h-5 w-5 rounded-full" style={{ background: t.accent }} />
      </div>
    </button>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Theme</h3>
        <p className="text-lg font-bold mb-4" style={{ color: theme.accent }}>
          {theme.name}
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
    case 'account':
      return (
        <div className="space-y-8">
          <DeleteAccountPanel />
        </div>
      );
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
