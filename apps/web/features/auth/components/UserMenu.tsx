"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOutIcon, PlugIcon, SettingsIcon, SparklesIcon, UserIcon } from "@/features/shared/icons";
import Image from "next/image";
import { useSession, signOut } from "@/features/auth/lib/auth-client";
import PersonSilhouette from "@/components/ui/PersonSilhouette";
import Popover, { PopoverDivider, PopoverItem } from "@/components/ui/Popover";
import ConnectorsDialog, { CONNECTORS_PARAM, connectorsSegment, type ConnectorsTab } from "@/features/settings/components/ConnectorsDialog";
import { useSidebar } from "@/features/shared/contexts/SidebarContext";
import { ROW_H, Row } from "@/features/shared/components/layout/railRow";

/**
 * You, at the foot of the rail — the same column the space sits at the head
 * of — and the menu that hangs off you. The row is your picture and your name
 * in the rail's own row shape; PRESSING it opens one menu beside the rail, the
 * way the space's row does at the head: who is signed in, then Profile,
 * Connectors, Models, Settings, and Sign out. Pressing again, Escape, or a
 * press anywhere else closes it. Nothing opens on hover.
 *
 * Connectors are a row rather than a settings section because they are about
 * the space you are in, from where you stand in it: the dialog opens over the
 * page you were on and closing it leaves you there. The band is shell chrome
 * on every page, so `?connectors=` re-opens it ANYWHERE — which is what the
 * OAuth round trip returns to — on the tab (connected, disconnected, all or
 * models) the sign-in started from.
 */
export default function UserMenu({ expanded, reduced }: { expanded: boolean; reduced: boolean }) {
  const { data: session, isPending } = useSession();
  const { setMenuOpen } = useSidebar();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [connectorsOpen, setConnectorsOpen] = useState<ConnectorsTab | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const open = anchor !== null;

  // `?connectors=` opens the dialog: the sign-in round trip comes back to the
  // page it started on, and this is what re-opens what the person was in.
  // Read off `location` rather than useSearchParams — the account band is shell
  // chrome on every page, and a hook that forces a Suspense boundary there
  // would be paid by all of them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const segment = connectorsSegment(new URLSearchParams(window.location.search).get(CONNECTORS_PARAM));
    if (segment) setConnectorsOpen(segment);
  }, []);

  // The rail is held open under the menu (SidebarContext) and let go with it.
  useEffect(() => {
    setMenuOpen(open);
    return () => setMenuOpen(false);
  }, [open, setMenuOpen]);

  // Going somewhere closes the menu.
  useEffect(() => setAnchor(null), [pathname]);

  const close = () => setAnchor(null);
  const toggle = () => setAnchor((a) => (a ? null : rowRef.current));

  const closeConnectors = () => {
    setConnectorsOpen(null);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(CONNECTORS_PARAM)) return;
    params.delete(CONNECTORS_PARAM);
    const q = params.toString();
    router.replace(q ? `${window.location.pathname}?${q}` : window.location.pathname, { scroll: false });
  };

  if (isPending) {
    return <div className="h-11 w-11 rounded-[10px] bg-surface-3 animate-pulse" style={{ marginLeft: (ROW_H - 44) / 2 }} />;
  }

  if (!session) return null;

  const { user } = session;
  // A session with no person node yet has no page of its own, so Profile is
  // simply not a row.
  const profileHref = user.nodeId ? `/directory/${encodeURIComponent(user.nodeId)}` : null;

  async function handleSignOut() {
    close();
    await signOut();
    router.push("/");
    router.refresh();
  }

  const picture = (cls: string) => (
    <span className={`overflow-hidden rounded-[10px] ${cls}`}>
      {user.image ? (
        <Image src={user.image} alt="" width={44} height={44} className="h-full w-full object-cover" />
      ) : (
        <PersonSilhouette />
      )}
    </span>
  );

  return (
    <div className="flex flex-col">
      {/* You. The same row shape as everything above it, with your picture where
          a glyph goes and your name where a tool's name goes. Pressing it opens
          the menu beside the rail. */}
      <div ref={rowRef}>
        <Row
          expanded={expanded}
          reduced={reduced}
          label={user.name ?? "Account"}
          active={open}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          icon={picture("h-11 w-11 border-2 border-brand-green")}
        />
      </div>

      <Popover anchor={anchor} onClose={close} placement="right-end" width={264} ariaLabel="Account menu" className="p-1.5">
        <div className="flex items-center gap-3 px-2.5 pb-2 pt-2">
          {picture("h-10 w-10 shrink-0")}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-text-primary">{user.name ?? "Account"}</div>
            <div className="truncate text-[12px] text-text-muted">{user.email}</div>
          </div>
        </div>
        {profileHref && <PopoverItem label="Profile" icon={<UserIcon />} href={profileHref} onClick={close} />}
        <PopoverItem label="Connectors" icon={<PlugIcon />} onClick={() => { close(); setConnectorsOpen("connected"); }} />
        {/* What the space's agents run on hangs off Connectors — a model IS a
            connector note — but it is one decision a space makes once, so it is
            its own row rather than a section inside the list of services. */}
        <PopoverItem label="Models" icon={<SparklesIcon />} onClick={() => { close(); setConnectorsOpen("models"); }} />
        <PopoverItem label="Settings" icon={<SettingsIcon />} onClick={() => { close(); router.push("/settings"); }} />
        <PopoverDivider />
        <PopoverItem label="Sign out" icon={<LogOutIcon />} onClick={() => { void handleSignOut(); }} />
      </Popover>

      {connectorsOpen && <ConnectorsDialog initial={connectorsOpen} onClose={closeConnectors} />}
    </div>
  );
}
