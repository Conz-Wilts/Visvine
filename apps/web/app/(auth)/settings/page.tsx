'use client';

import React, { Suspense } from 'react';
import { useTheme } from '@/features/shared/contexts/ThemeContext';
import { COLOR_THEMES, type ColorTheme } from '@/features/shared/lib/colorThemes';
import ConsoleShell, { type ConsoleSection } from '@/features/admin/components/console/ConsoleShell';
import LoadingText from '@/components/ui/LoadingText';
import { SettingsSection } from '@/components/ui';
import ConnectClaudePanel from '@/features/settings/components/ConnectClaudePanel';
import DeleteAccountPanel from '@/features/settings/components/DeleteAccountPanel';
import AccountsPanel from '@/features/connectors/components/AccountsPanel';

/**
 * Personal settings. Same shell as the Space Console — a pane-top tab bar
 * with `?section=` in the URL — so the two settings-shaped pages navigate
 * identically instead of one docking a column into the Sidebar and the other
 * not. See ConsoleShell for the bar itself.
 */

// ─── Sections ─────────────────────────────────────────────────────────────────

// Only the tabs that do something. General holds everything about you that is
// not about a space: theme, the MCP address, deleting your account.
// Accounts are the services you sign in to yourself and spend in every space
// (AccountsPanel). Nothing here is about a space: a space's connectors are in
// its Directory and console, its models in its console.
const SECTIONS: ConsoleSection[] = [
  { id: 'general', label: 'General', width: 'form' },
  { id: 'accounts', label: 'Accounts', width: 'form' },
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

function ThemeSection() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsSection title="Theme">
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
    </SettingsSection>
  );
}

function GeneralSection() {
  return (
    <div className="space-y-8">
      <ThemeSection />
      <ConnectClaudePanel />
      <DeleteAccountPanel />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function renderSection(id: string) {
  switch (id) {
    case 'general':
      return <GeneralSection />;
    case 'accounts':
      return <AccountsPanel />;
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
