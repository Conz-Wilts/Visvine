"use client";

import { stripSpacePrefix } from "@/lib/spaces/shared/spaceUrl";
import { useEffect, useRef, useState } from "react";
import { useSpaceRouter } from "@/features/shared/hooks/useSpaceRouter";
import Image from "next/image";
import { signOut } from "@/features/auth/lib/auth-client";
import { useAuth } from "@/features/auth/contexts/AuthContext";
import PersonSilhouette from "@/components/ui/PersonSilhouette";
import { selfProfileHref } from "@/features/profile/lib/selfView";
import { CONNECTORS_PARAM, settingsHrefFor } from "@/features/settings/components/SettingsConnectors";
import { ITEM_GAP, ROW_H, Row } from "@/features/shared/components/layout/railRow";

/**
 * The account band — the rail's last rows (Sidebar). You sit at the foot of the
 * same column the space sits at the head of.
 *
 * There is no dropdown. Point at the avatar and the band GROWS UPWARD: what
 * hangs off your account — Sign out, Settings — unfolds as ordinary
 * rail rows, on the rail's own glyph column, with their names arriving on the
 * same fade the tools' names do. So opening the account is the rail widening and
 * the band rising, one gesture, rather than a panel appearing over whatever page
 * you were reading.
 *
 * Your own row is not one of those actions: your name IS the link to your
 * profile, the way a person's name is everywhere else in the app, so pressing it
 * goes to `/directory/<node>`.
 *
 * The height is what animates, and it is computed rather than `auto` so it can
 * be transitioned. Keyboard focus opens it too, so the actions are reachable
 * without a pointer.
 *
 * Connectors and Models are sections of Settings. The band is shell chrome on
 * every page, so it is what sends a `?connectors=` link — an older sign-in
 * return, say — on to the Settings section it names.
 */
export default function UserMenu({ expanded, reduced }: { expanded: boolean; reduced: boolean }) {
  const { session, isLoading: isPending } = useAuth();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const bandRef = useRef<HTMLDivElement>(null);
  const router = useSpaceRouter();

  // `?connectors=` anywhere but Settings goes on to Settings, keeping whatever
  // else the URL carried (a sign-in's outcome). Read off `location` rather than
  // useSearchParams — the account band is shell chrome on every page, and a
  // hook that forces a Suspense boundary there would be paid by all of them.
  useEffect(() => {
    if (typeof window === "undefined" || stripSpacePrefix(window.location.pathname) === "/settings") return;
    const params = new URLSearchParams(window.location.search);
    const href = settingsHrefFor(params.get(CONNECTORS_PARAM));
    if (!href) return;
    params.delete(CONNECTORS_PARAM);
    const rest = params.toString();
    router.replace(rest ? `${href}&${rest}` : href);
  }, [router]);

  // A pinned band closes on the next click outside it, the way the rail's own
  // popups do. Hover-opened bands need nothing: the pointer leaving closes them.
  useEffect(() => {
    if (!pinned) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (bandRef.current?.contains(e.target as Node)) return;
      setPinned(false);
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [pinned]);

  // The rail shutting takes the band with it: a column of nameless glyphs
  // stacked above the avatar is not a menu anyone can read.
  useEffect(() => {
    if (!expanded) {
      setOpen(false);
      setPinned(false);
    }
  }, [expanded]);

  if (isPending) {
    return <div className="h-10 w-10 rounded-[8px] bg-surface-3 animate-pulse" style={{ marginLeft: (ROW_H - 40) / 2 }} />;
  }

  if (!session) return null;

  const { user } = session;
  // Your name is the link to your own page, so there is no Profile row in the
  // band. A session with no person node yet has nowhere to go: the row falls
  // back to opening the band, the way it did when Profile was a row.
  const profileHref = user.nodeId ? selfProfileHref(user.nodeId) : null;

  async function handleSignOut() {
    setOpen(false);
    setPinned(false);
    await signOut();
    router.push("/");
    router.refresh();
  }

  const actions: { key: string; label: string; onClick: () => void; danger?: boolean; icon: React.ReactNode }[] = [
    {
      // The one row in the band that undoes something, so it goes red under
      // the pointer — at rest it is a row like the others.
      key: "signout",
      label: "Sign out",
      onClick: () => { void handleSignOut(); },
      danger: true,
      icon: (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      ),
    },
    {
      key: "settings",
      label: "Settings",
      onClick: () => router.push("/settings"),
      icon: (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  // The stack's open height: the rows, the gaps between them, and one more gap
  // holding the last of them off the avatar. Same rhythm as every other band,
  // so the rows land where rail rows land rather than in a menu's own spacing.
  const stackH = actions.length * ROW_H + actions.length * ITEM_GAP;
  const dur = reduced ? "0s" : "260ms";

  return (
    <div
      ref={bandRef}
      className="flex flex-col"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (pinned) return;
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
      }}
    >
      {/* The rows, revealed by the band's own height. Clipped rather than
          unmounted so they are there to travel: the stack rises out from behind
          the avatar as the height opens, and the labels fade on the rail's
          timing. */}
      <div
        className="overflow-hidden"
        style={{
          height: open ? stackH : 0,
          opacity: open ? 1 : 0,
          transition: reduced ? "none" : `height ${dur} cubic-bezier(0.25, 0.1, 0.25, 1), opacity ${dur} ease`,
        }}
        aria-hidden={!open}
      >
        <div className="flex flex-col" style={{ gap: ITEM_GAP, paddingBottom: ITEM_GAP }}>
          {actions.map(({ key, label, icon, onClick, danger }) => (
            <div key={key}>
              <Row
                expanded={expanded}
                reduced={reduced}
                label={label}
                icon={icon}
                danger={danger}
                onClick={() => {
                  setPinned(false);
                  setOpen(false);
                  onClick();
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* You. The same row shape as everything above it, with your picture where
          a glyph goes and your name where a tool's name goes — and, like every
          other name in the app, it is a link to the person's page. Pointing at
          the row is what opens the band above it; nothing is drawn to say so. */}
      <div>
        <Row
          expanded={expanded}
          reduced={reduced}
          label={user.name ?? "Account"}
          square
          active={open}
          href={profileHref ?? undefined}
          onClick={profileHref ? undefined : () => { setPinned((v) => !v); setOpen(true); }}
          icon={
            <span className="h-10 w-10 overflow-hidden rounded-[8px] border-2 border-brand-green">
              {user.image ? (
                <Image src={user.image} alt="" width={40} height={40} className="h-full w-full object-cover" />
              ) : (
                <PersonSilhouette />
              )}
            </span>
          }
        />
      </div>
    </div>
  );
}
