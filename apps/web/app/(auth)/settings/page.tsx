'use client';

import React, { Suspense } from 'react';
import { useTheme, COLOR_THEMES, ColorTheme } from '@/features/shared/contexts/ThemeContext';
import { User, Bell, Globe, Eye, Smartphone } from 'lucide-react';
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

const SECTIONS: ConsoleSection[] = [
  { id: 'appearance', label: 'Appearance', width: 'form' },
  { id: 'connections', label: 'Connections', width: 'form' },
  { id: 'account', label: 'Account', width: 'form' },
  { id: 'notifications', label: 'Notifications', width: 'form' },
  { id: 'privacy', label: 'Privacy', width: 'form' },
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
      {/* Theme colour */}
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

      {/* Divider */}
      <div className="border-t border-border-subtle" />

      {/* Display options */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Display</h3>
        <div className="space-y-2">
          {/* Language (static) */}
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-2 border border-border-subtle">
            <div className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-1 border border-border-default text-text-muted">
              <Globe size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary">Language</p>
              <p className="text-xs text-text-muted">English (US)</p>
            </div>
          </div>

          {/* Compact view (static) */}
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-2 border border-border-subtle">
            <div className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-1 border border-border-default text-text-muted">
              <Smartphone size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary">Compact view</p>
              <p className="text-xs text-text-muted">Reduce spacing on small screens</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderSection({ label, icon }: { label: string; icon: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: theme.accentLight, color: theme.accentDark }}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-text-secondary">{label} settings</p>
      <p className="text-xs text-text-muted mt-1">This section is coming soon.</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function renderSection(id: string) {
  switch (id) {
    case 'appearance':
      return <AppearanceSection />;
    case 'connections':
      return <ConnectClaudePanel />;
    case 'account':
      return <PlaceholderSection label="Account" icon={<User size={22} />} />;
    case 'notifications':
      return <PlaceholderSection label="Notification" icon={<Bell size={22} />} />;
    case 'privacy':
      return <PlaceholderSection label="Privacy" icon={<Eye size={22} />} />;
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
