"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, fetchJsonBody } from "@/lib/fetchJson";
import { useRouter } from "next/navigation";
import { BellIcon } from "@/features/shared/icons";
import { useClickOutside } from "@/features/shared/hooks/useClickOutside";
import { useSpace } from "@/features/shared/contexts/SpaceContext";
import type { NotificationDTO, NotificationScope } from "@/lib/notifications/types";
import { invitationIdOfHref, relativeTime } from "@/lib/notifications/types";
import type { RealtimeEvent } from "@/lib/messages/types";

const POLL_MS = 60_000;
const TAKE = 30;

/** What the invitee's Accept acts on — the id the notification can't carry. */
interface PendingInvite {
  id: string;
  spaceId: string;
  spaceName: string;
}

type CountsResponse = {
  notifications: NotificationDTO[];
  unread: number;
  unreadGlobal: number;
  unreadSpace: number;
};

/**
 * The Navbar's inbox: a bell with an unread badge and a dropdown of the latest
 * lines (lib/notifications). Fetches on mount, on window focus and every
 * minute, and patches in new lines from the per-user SSE stream — the same
 * `/api/messages/stream` the messages page uses, so an open tab hears about a
 * broken connection or a review the moment it happens.
 *
 * Two tabs, because a notification is either about a space or about the person:
 * **This space** is everything stamped with the space you are standing in,
 * **Global** is everything that isn't — an invitation to a space you have not
 * joined, a personal connection that broke. Without the split, the space you
 * are actually working in gets buried under the other five.
 */
export default function NotificationBell() {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [unreadGlobal, setUnreadGlobal] = useState(0);
  const [unreadSpace, setUnreadSpace] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { currentSpace, refreshSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;

  // Default to the space you are in; with no space there is only the global
  // half, so the tab that would always be empty is never the one you land on.
  const [scope, setScope] = useState<NotificationScope>("space");
  const activeScope: NotificationScope = spaceId ? scope : "global";

  useClickOutside(menuRef, () => setOpen(false));

  const refresh = useCallback(async () => {
    try {
      const query = new URLSearchParams({ take: String(TAKE), scope: activeScope });
      if (spaceId) query.set("spaceId", spaceId);
      const data = await fetchJson<CountsResponse>(`/api/notifications?${query}`, { cache: "no-store" });
      setItems(data.notifications);
      setUnread(data.unread);
      setUnreadGlobal(data.unreadGlobal);
      setUnreadSpace(data.unreadSpace);
      setLoaded(true);
    } catch {
      /* offline / signed out — the next tick retries */
    }
  }, [activeScope, spaceId]);

  // Mount + focus + interval + whichever tab is showing.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh]);

  const refreshInvites = useCallback(async () => {
    try {
      const d = await fetchJson<{ invitations: PendingInvite[] }>("/api/invitations", { cache: "no-store" });
      setInvites(d.invitations ?? []);
    } catch {
      /* the line still reads; only the buttons are missing */
    }
  }, []);

  // The invitations waiting on this person, so a `space_invite` line can be
  // answered where it is read. Only worth a round-trip while the menu is open.
  useEffect(() => {
    if (open) void refreshInvites();
  }, [open, refreshInvites]);

  // Realtime: patch a fresh line in without a round-trip. A line for the other
  // tab only moves that tab's count — dropping it into this list would show a
  // space's notification under Global.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/messages/stream");
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        if (payload.type !== "notification.new") return;
        const n = payload.notification;
        const belongsHere = activeScope === "global" ? n.spaceId === null : n.spaceId === spaceId;
        if (belongsHere) {
          setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, TAKE)));
        }
        setUnread((c) => c + 1);
        if (n.spaceId === null) setUnreadGlobal((c) => c + 1);
        else if (n.spaceId === spaceId) setUnreadSpace((c) => c + 1);
        if (n.kind === "space_invite") void refreshInvites();
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => source.close();
  }, [activeScope, spaceId, refreshInvites]);

  const applyCounts = useCallback((data: Pick<CountsResponse, "unread" | "unreadGlobal" | "unreadSpace">) => {
    setUnread(data.unread);
    setUnreadGlobal(data.unreadGlobal);
    setUnreadSpace(data.unreadSpace);
  }, []);

  const markRead = useCallback(
    async (target: { ids?: string[]; all?: boolean }) => {
      // Optimistic: the list reflects the click before the server confirms.
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((n) => (target.all || target.ids?.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
      );
      try {
        const data = await fetchJsonBody<CountsResponse>("/api/notifications/read", "POST", {
          ...target,
          // "Mark all read" clears the tab you are looking at, not the other one.
          ...(target.all ? { scope: activeScope, spaceId } : {}),
        });
        applyCounts(data);
      } catch {
        /* the next refresh reconciles */
      }
    },
    [activeScope, spaceId, applyCounts],
  );

  const onItemClick = (n: NotificationDTO) => {
    // An invitation's href is an id, not a page, and reading it is not
    // answering it: clicking the line leaves the Accept / Decline standing.
    if (n.kind === "space_invite") {
      if (!n.readAt) void markRead({ ids: [n.id] });
      return;
    }
    setOpen(false);
    if (!n.readAt) void markRead({ ids: [n.id] });
    if (n.href) {
      if (/^https?:\/\//i.test(n.href)) window.open(n.href, "_blank", "noopener");
      else router.push(n.href);
    }
  };

  // ask_human questions carry a reply box: the answer is queued for the agent
  // that asked (POST /api/notifications/:id/reply) and the line is marked read.
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const sendReply = async (n: NotificationDTO) => {
    const text = replyText.trim();
    if (!text || replyBusy) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const data = await fetchJsonBody<{ unread: number }>(`/api/notifications/${encodeURIComponent(n.id)}/reply`, "POST", { text });
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: x.readAt ?? now } : x)));
      setUnread(data.unread);
      setReplyFor(null);
      setReplyText("");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Could not send the reply");
    } finally {
      setReplyBusy(false);
    }
  };

  // An invitation is answered here rather than on a page of its own: it is a
  // yes/no, and the place it was read is the place to say so.
  const [inviteBusy, setInviteBusy] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const inviteById = useMemo(() => new Map(invites.map((i) => [i.id, i])), [invites]);

  const answerInvite = async (n: NotificationDTO, invite: PendingInvite, action: "accept" | "decline") => {
    if (inviteBusy) return;
    setInviteBusy(invite.id);
    setInviteError(null);
    try {
      await fetchJsonBody(`/api/invitations/${encodeURIComponent(invite.id)}`, "POST", { action });
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      if (!n.readAt) await markRead({ ids: [n.id] });
      // Accepting adds a space to the switcher; declining changes nothing there.
      if (action === "accept") await refreshSpace();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not answer the invitation");
    } finally {
      setInviteBusy(null);
    }
  };

  const badge = unread > 99 ? "99+" : String(unread);
  const tabCount = (which: NotificationScope) => (which === "global" ? unreadGlobal : unreadSpace);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Notifications"
        className={`relative w-12 h-12 rounded-xl flex items-center justify-center shell-icon-btn ${
          open ? "shell-icon-btn--active" : ""
        }`}
      >
        <BellIcon className="w-5 h-5" strokeWidth={1.8} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-green text-[10px] font-semibold leading-[18px] text-center text-white"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-surface-1 border border-border-subtle shadow-float z-50"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
            <p className="text-sm font-medium text-text-primary">Notifications</p>
            {tabCount(activeScope) > 0 && (
              <button
                type="button"
                onClick={() => void markRead({ all: true })}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* The split. Hidden with no space to stand in: one tab is not a choice. */}
          {spaceId && (
            <div role="tablist" className="flex gap-1 px-3 py-2 border-b border-border-subtle">
              {([
                ["space", currentSpace?.name ?? "This space"],
                ["global", "Global"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeScope === key}
                  onClick={() => setScope(key)}
                  className={`flex-1 min-w-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    activeScope === key
                      ? "bg-surface-3 text-text-primary"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <span className="truncate">{label}</span>
                  {tabCount(key) > 0 && (
                    <span className="ml-1.5 text-[10px] font-semibold text-brand-dark-green">
                      {tabCount(key) > 99 ? "99+" : tabCount(key)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted text-center">
              {loaded ? "You're all caught up." : "Loading…"}
            </p>
          ) : (
            <ul className="py-1">
              {items.map((n) => {
                const inviteId = n.kind === "space_invite" ? invitationIdOfHref(n.href) : null;
                const invite = inviteId ? inviteById.get(inviteId) : undefined;
                return (
                <li key={n.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onItemClick(n)}
                    className={`w-full text-left px-4 py-2.5 hover:bg-surface-2 transition-colors flex gap-3 ${
                      n.readAt ? "" : "bg-surface-2/50"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.readAt ? "bg-transparent" : "bg-brand-green"}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-text-primary leading-snug">{n.title}</span>
                      {n.body && (
                        <span className="block text-xs text-text-secondary mt-0.5 line-clamp-2 whitespace-pre-line">
                          {n.body}
                        </span>
                      )}
                      <span className="block text-[11px] text-text-muted mt-1">{relativeTime(n.createdAt)}</span>
                    </span>
                  </button>

                  {/* An invitation is only answerable while it is still open —
                      the row disappears from /api/invitations the moment it is
                      answered anywhere, so the buttons go with it. */}
                  {invite && (
                    <div className="px-4 pb-2.5 -mt-1">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void answerInvite(n, invite, "accept")}
                          disabled={inviteBusy === invite.id}
                          className="rounded-lg bg-brand-green px-2.5 py-1 text-xs font-medium text-black disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => void answerInvite(n, invite, "decline")}
                          disabled={inviteBusy === invite.id}
                          className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-3 disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                      {inviteError && <span className="text-[11px] text-red-600">{inviteError}</span>}
                    </div>
                  )}

                  {n.kind === "agent_question" && !n.readAt && (
                    <div className="px-4 pb-2.5 -mt-1">
                      {replyFor === n.id ? (
                        <form
                          className="flex flex-col gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void sendReply(n);
                          }}
                        >
                          <div className="flex gap-2">
                            <input
                              autoFocus
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              maxLength={2000}
                              placeholder="Your answer…"
                              aria-label="Reply to the agent"
                              className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface-1 px-2 py-1 text-xs text-text-primary"
                            />
                            <button
                              type="submit"
                              disabled={replyBusy || !replyText.trim()}
                              className="rounded-lg bg-brand-green px-2.5 py-1 text-xs font-medium text-black disabled:opacity-50"
                            >
                              Send
                            </button>
                          </div>
                          {replyError && <span className="text-[11px] text-red-600">{replyError}</span>}
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setReplyFor(n.id);
                            setReplyText("");
                            setReplyError(null);
                          }}
                          className="text-xs text-brand-dark-green hover:underline"
                        >
                          Reply
                        </button>
                      )}
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
