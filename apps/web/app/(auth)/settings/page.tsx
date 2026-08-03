'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme, COLOR_THEMES, ColorTheme } from '@/lib/contexts/ThemeContext';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { DOCK_MIN_WIDTH } from '@/features/shared/components/layout/Sidebar';
import {
  User,
  Bell,
  Palette,
  Shield,
  Globe,
  Eye,
  Smartphone,
} from 'lucide-react';

// ─── Section types ────────────────────────────────────────────────────────────

type SettingsSection = 'appearance' | 'account' | 'notifications' | 'privacy';

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: <Palette size={18} />,
    description: 'Theme, colors, and display',
  },
  {
    id: 'account',
    label: 'Account',
    icon: <User size={18} />,
    description: 'Profile and credentials',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: <Bell size={18} />,
    description: 'Alerts and digests',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: <Shield size={18} />,
    description: 'Visibility and data',
  },
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

export default function SettingsPage() {
  const [active, setActive] = useState<SettingsSection>('appearance');
  const { theme } = useTheme();
  const { host } = useContextPanel();

  // Track the Sidebar's dock breakpoint so both sides flip together.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DOCK_MIN_WIDTH}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const dockNav = wide && Boolean(host);

  // The section list, rendered into the Sidebar's docked panel — same host the
  // /channels list and the notes tree share.
  const dockedNav = dockNav && host
    ? createPortal(
        <div
          className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface-1 px-3 py-4"
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          <nav aria-label="Settings sections">
            <div className="mb-1.5 px-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
              Settings
            </div>
            <ul className="space-y-1">
              {NAV_ITEMS.map(item => {
                const isActive = active === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setActive(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 w-full group"
                      style={{
                        background: isActive ? theme.accentLight : 'transparent',
                        color: isActive ? theme.accentDark : undefined,
                      }}
                    >
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                        style={{
                          background: isActive ? theme.accent : undefined,
                          color: isActive ? 'white' : undefined,
                        }}
                      >
                        <span className={isActive ? '' : 'text-text-muted'}>
                          {item.icon}
                        </span>
                      </span>
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${isActive ? '' : 'text-text-secondary'}`}>{item.label}</p>
                        <p className={`text-[10px] truncate opacity-70 ${isActive ? '' : 'text-text-muted'}`}>{item.description}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>,
        host,
      )
    : null;

  return (
    <>
      {dockedNav}
      {/* When the section list is docked into the Sidebar, pad left so the content
          clears the docked card (260px panel + 12px gutter — keep in sync with
          SETTINGS_PANEL_W in Sidebar.tsx). */}
      <div
        className={`w-full ${dockNav ? 'pl-[272px]' : ''}`}
        style={{ transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
      >
      <div className="min-w-0 pt-4 pb-10 px-6 sm:px-8 max-w-2xl">
        {/* Narrow fallback: horizontally scrollable pill row above the content */}
        {!dockNav && (
          <div className="flex gap-1 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
            {NAV_ITEMS.map(item => {
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActive(item.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition-all"
                  style={{
                    background: isActive ? theme.accentLight : undefined,
                    color: isActive ? theme.accentDark : undefined,
                  }}
                >
                  <span className={isActive ? '' : 'text-text-muted'}>{item.icon}</span>
                  <span className={isActive ? '' : 'text-text-secondary'}>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Section heading */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-text-primary">
            {NAV_ITEMS.find(n => n.id === active)?.label}
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            {NAV_ITEMS.find(n => n.id === active)?.description}
          </p>
        </div>

        {/* Content */}
        {active === 'appearance' && <AppearanceSection />}
        {active === 'account' && (
          <PlaceholderSection label="Account" icon={<User size={22} />} />
        )}
        {active === 'notifications' && (
          <PlaceholderSection label="Notification" icon={<Bell size={22} />} />
        )}
        {active === 'privacy' && (
          <PlaceholderSection label="Privacy" icon={<Eye size={22} />} />
        )}
      </div>
      </div>
    </>
  );
}
