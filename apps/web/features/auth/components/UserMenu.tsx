"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useSession, signOut } from "@/features/auth/lib/auth-client";
import { useFullProfile } from "@/features/shared/contexts/FullProfileContext";
import PersonSilhouette from "@/components/ui/PersonSilhouette";

/**
 * The account button, floated in the shell's top-right corner (AuthLayoutClient)
 * — the one piece of chrome that is not the rail. Its menu hangs down and to the
 * left of the avatar, portalled to <body> so nothing a page pins at its own top
 * edge can paint over it.
 */
export default function UserMenu() {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const router = useRouter();
  const { openProfile } = useFullProfile();

  useEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  if (isPending) {
    return <div className="h-11 w-11 rounded-full bg-surface-3 animate-pulse" />;
  }

  if (!session) return null;

  const { user } = session;

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-11 w-11 overflow-hidden rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
      >
        {user.image ? (
          <Image src={user.image} alt={user.name ?? "Profile"} width={44} height={44} className="h-full w-full object-cover" />
        ) : (
          <PersonSilhouette />
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="fixed w-56 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 py-1 shadow-float z-[60]"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <div className="px-4 py-3 border-b border-border-subtle">
            <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
            <p className="text-xs text-text-muted truncate">{user.email}</p>
          </div>

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

          <div className="border-t border-border-subtle my-1" />

          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
