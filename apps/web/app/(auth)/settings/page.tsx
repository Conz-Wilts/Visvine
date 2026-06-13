'use client';

import React, { useState } from 'react';
import { useTheme, COLOR_THEMES, ColorTheme } from '@/lib/contexts/ThemeContext';
import Toggle from '@/components/ui/Toggle';
import {
  User,
  Bell,
  Palette,
  Shield,
  Globe,
  Eye,
  Moon,
  Sun,
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
  const { theme, setTheme, isDark, toggleDark } = useTheme();

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
          {/* Dark mode toggle */}
          <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-2 border border-border-subtle">
            <div className="w-7 h-7 rounded-md flex items-center justify-center bg-surface-1 border border-border-default text-text-muted">
              {isDark ? <Sun size={15} /> : <Moon size={15} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary">Dark mode</p>
              <p className="text-xs text-text-muted">{isDark ? 'Currently on' : 'Currently off'}</p>
            </div>
            <Toggle checked={isDark} onChange={toggleDark} aria-label="Dark mode" />
          </div>

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
  const { theme, isDark } = useTheme();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: isDark ? theme.accentLightDark : theme.accentLight, color: theme.accentDark }}
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
  const { theme, isDark } = useTheme();

  return (
    <div className="flex min-h-full px-6">
      {/* ── Sidebar nav ── */}
      <nav className="w-56 flex-shrink-0 border-r border-border-subtle pt-8 pb-6 px-3 hidden sm:flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted px-3 mb-2">
          Settings
        </p>
        {NAV_ITEMS.map(item => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 w-full group"
              style={{
                background: isActive ? (isDark ? theme.accentLightDark : theme.accentLight) : 'transparent',
                color: isActive ? theme.accentDark : undefined,
              }}
            >
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                style={{
                  background: isActive ? theme.accent : undefined,
                  color: isActive ? 'white' : undefined,
                }}
                // inactive styles via className so dark: works
                data-inactive={!isActive}
              >
                <span className={isActive ? '' : 'text-text-muted'}>
                  {item.icon}
                </span>
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-semibold truncate ${isActive ? '' : 'text-text-secondary'}`}>{item.label}</p>
                <p className={`text-[10px] truncate opacity-70 ${isActive ? '' : 'text-text-muted'}`}>{item.description}</p>
              </div>
            </button>
          );
        })}
      </nav>

      {/* ── Content ── */}
      <div className="flex-1 min-w-0 pt-8 pb-10 px-6 sm:px-8 max-w-2xl">
        {/* Mobile tab bar */}
        <div className="flex sm:hidden gap-1 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
          {NAV_ITEMS.map(item => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition-all"
                style={{
                  background: isActive ? (isDark ? theme.accentLightDark : theme.accentLight) : undefined,
                  color: isActive ? theme.accentDark : undefined,
                }}
              >
                <span className={isActive ? '' : 'text-text-muted'}>{item.icon}</span>
                <span className={isActive ? '' : 'text-text-secondary'}>{item.label}</span>
              </button>
            );
          })}
        </div>

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
  );
}
