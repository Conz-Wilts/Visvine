'use client';

import React, { Suspense } from 'react';
import { useTheme, COLOR_THEMES, ColorTheme, type BackdropMode } from '@/features/shared/contexts/ThemeContext';
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

// Only the tabs that do something. Notifications / Privacy were coming-soon
// placeholders and are gone until there's something behind them; Account is back
// because deleting your account is something.
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

/** One theme set: the accent dot sitting on its own gradient. */
function ThemeSwatch({ t, active, onSelect }: { t: ColorTheme; active: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} aria-label={`Select ${t.name} theme`} title={t.name} className="focus:outline-none">
      <div
        className="flex h-12 w-16 items-center justify-center rounded-lg transition-all duration-200"
        style={{
          background: t.backdrop,
          boxShadow: swatchRing(active, t.accent),
          transform: active ? 'scale(1.08)' : 'scale(1)',
        }}
      >
        <span className="h-5 w-5 rounded-full" style={{ background: t.accent }} />
      </div>
    </button>
  );
}

function ModeSwatch({ label, background, accent, active, onSelect }: {
  label: string; background: string; accent: string; active: boolean; onSelect: () => void;
}) {
  return (
    <button onClick={onSelect} aria-label={`${label} background`} title={label} className="focus:outline-none">
      <div
        className="h-12 w-16 rounded-lg transition-all duration-200"
        style={{
          background,
          boxShadow: swatchRing(active, accent),
          transform: active ? 'scale(1.08)' : 'scale(1)',
        }}
      />
    </button>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme, backdropMode, setBackdropMode } = useTheme();

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

      {/* Background — the set's gradient, or plain white. */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Background</h3>
        <p className="text-lg font-bold mb-4 text-text-secondary">
          {backdropMode === 'gradient' ? 'Gradient' : 'White'}
        </p>
        <div className="flex flex-wrap gap-3">
          {(['gradient', 'plain'] as BackdropMode[]).map(mode => (
            <ModeSwatch
              key={mode}
              label={mode === 'gradient' ? 'Gradient' : 'White'}
              background={mode === 'gradient' ? theme.backdrop : '#ffffff'}
              accent={theme.accent}
              active={backdropMode === mode}
              onSelect={() => setBackdropMode(mode)}
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
