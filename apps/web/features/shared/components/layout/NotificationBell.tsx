"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon } from "@/features/shared/icons";
import { useClickOutside } from "@/features/shared/hooks/useClickOutside";
import type { NotificationDTO } from "@/lib/notifications/types";
import { relativeTime } from "@/lib/notifications/types";
import type { RealtimeEvent } from "@/lib/messages/types";

const POLL_MS = 60_000;
const TAKE = 30;

/**
 * The Navbar's inbox: a bell with an unread badge and a dropdown of the latest
 * lines (lib/notifications). Fetches on mount, on window focus and every
 * minute, and patches in new lines from the per-user SSE stream — the same
 * `/api/messages/stream` the messages page uses, so an open tab hears about a
 * broken connection or a review the moment it happens.
 */
export default function NotificationBell() {
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useClickOutside(menuRef, () => setOpen(false));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?take=${TAKE}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: NotificationDTO[]; unread: number };
      setItems(data.notifications);
      setUnread(data.unread);
      setLoaded(true);
    } catch {
      /* offline / signed out — the next tick retries */
    }
  }, []);

  // Mount + focus + interval.
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

  // Realtime: patch a fresh line in without a round-trip.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/messages/stream");
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        if (payload.type !== "notification.new") return;
        const n = payload.notification;
        setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, TAKE)));
        setUnread((c) => c + 1);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => source.close();
  }, []);

  const markRead = useCallback(async (target: { ids?: string[]; all?: boolean }) => {
    // Optimistic: the list reflects the click before the server confirms.
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (target.all || target.ids?.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
    );
    setUnread((c) => (target.all ? 0 : Math.max(0, c - (target.ids?.length ?? 0))));
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (res.ok) {
        const data = (await res.json()) as { unread: number };
        setUnread(data.unread);
      }
    } catch {
      /* the next refresh reconciles */
    }
  }, []);

  const onItemClick = (n: NotificationDTO) => {
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
      const res = await fetch(`/api/notifications/${encodeURIComponent(n.id)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setReplyError(data.error ?? "Could not send the reply");
        return;
      }
      const data = (await res.json()) as { unread: number };
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: x.readAt ?? now } : x)));
      setUnread(data.unread);
      setReplyFor(null);
      setReplyText("");
    } catch {
      setReplyError("Could not send the reply");
    } finally {
      setReplyBusy(false);
    }
  };

  const badge = unread > 99 ? "99+" : String(unread);

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
            className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-green text-[10px] font-semibold leading-[18px] text-center text-black"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto rounded-xl bg-surface-1 border border-border-subtle shadow-lg z-50"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
            <p className="text-sm font-medium text-text-primary">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markRead({ all: true })}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted text-center">
              {loaded ? "You're all caught up." : "Loading…"}
            </p>
          ) : (
            <ul className="py-1">
              {items.map((n) => (
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
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
