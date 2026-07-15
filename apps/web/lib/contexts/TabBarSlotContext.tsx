"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/*
 * Bridges the ProfileTabBar and whatever the active tab renders, so a tab's own
 * bar (today: the note editor's format toolbar on the Context tab) can live
 * INSIDE the tab bar's sticky box rather than as a second bar stacked below it.
 * The tab bar exposes a portal host inside a collapsible region under the tab
 * row (`setHost`); the tab's content renders into it via createPortal.
 *
 * Why a portal rather than passing the toolbar down as a prop: the region has to
 * open the instant the tab changes, but the toolbar's owner (NoteEditor) mounts
 * much later — behind a dynamic import and a note fetch. The tab bar animates
 * off tab state alone and the controls arrive whenever they're ready. It also
 * keeps the format buttons live-bound to the Tiptap instance, which storing JSX
 * in context state would not (see HeaderContext for that other shape).
 */
interface TabBarSlotValue {
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
}

const TabBarSlotContext = createContext<TabBarSlotValue>({
  host: null,
  setHost: () => {},
});

export function TabBarSlotProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <TabBarSlotContext.Provider value={{ host, setHost }}>
      {children}
    </TabBarSlotContext.Provider>
  );
}

export function useTabBarSlot() {
  return useContext(TabBarSlotContext);
}
