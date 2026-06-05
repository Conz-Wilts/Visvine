"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useSession, signOut } from "@/lib/auth-client";
import { useTheme } from "@/lib/contexts/ThemeContext";
import { useFullProfile } from "@/lib/contexts/FullProfileContext";
import { Moon, Sun } from "lucide-react";

export default function UserMenu() {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { isDark, toggleDark } = useTheme();
  const { openProfile } = useFullProfile();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (isPending) {
    return <div className="w-12 h-12 rounded-2xl bg-surface-3 animate-pulse shrink-0" />;
  }

  if (!session) return null;

  const { user } = session;
  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-12 h-12 rounded-2xl overflow-hidden border-2 border-brand-green hover:border-brand-green transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        aria-label="Account menu"
      >
        {user.image ? (
          <Image src={user.image} alt={user.name ?? "Profile"} width={48} height={48} className="w-full h-full object-cover" />
        ) : (
          <span className="w-full h-full flex items-center justify-center bg-brand-green text-white text-xs font-semibold">
            {initials}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl bg-surface-1 border border-border-subtle shadow-lg z-50 py-1 overflow-hidden">
          {/* User info */}
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
            <p className="text-xs text-text-muted truncate">{user.email}</p>
          </div>

          {/* Profile */}
          <button
            onClick={() => {
              setOpen(false);
              if (user.nodeId) openProfile(user.nodeId);
            }}
            className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Profile
          </button>

          {/* Settings */}
          <button
            onClick={() => { setOpen(false); router.push("/settings"); }}
            className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>

          {/* Dark mode toggle */}
          <button
            onClick={toggleDark}
            className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            {isDark
              ? <Sun className="w-4 h-4 text-text-muted" />
              : <Moon className="w-4 h-4 text-text-muted" />
            }
            {isDark ? 'Light mode' : 'Dark mode'}
          </button>

          <div className="border-t border-border-subtle my-1" />

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
