'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui';
import PersonalConnectorsPanel from './PersonalConnectorsPanel';

/**
 * Your own connectors, as a dialog off the account menu.
 *
 * They are not a page: connecting one is a thing you do in a minute and then
 * forget, the way a space's model provider is managed from a dialog rather
 * than a screen of its own. So the account menu opens it over whatever you
 * were doing, and closing it puts you back there.
 *
 * The one thing that leaves the app is the sign-in itself, and a dialog cannot
 * survive a round trip to a provider. So the return path is THIS page plus
 * `?connectors=1`, which is what UserMenu re-opens the dialog on — you land
 * back where you started, with the list showing the account you just linked.
 */
export const CONNECTORS_PARAM = 'connectors';

export default function PersonalConnectorsDialog({ onClose }: { onClose: () => void }) {
  // Read once, at open: the path is where the provider sends the browser back.
  const [returnTo] = useState(() =>
    typeof window === 'undefined' ? `/settings?${CONNECTORS_PARAM}=1` : `${window.location.pathname}?${CONNECTORS_PARAM}=1`,
  );

  return (
    <Modal
      onClose={onClose}
      title="Your connectors"
      size="md"
      // The panel is a list whose length changes with the tab — one connected
      // server, then thirty available ones. A floor and a ceiling keep the
      // dialog one shape across that: it never collapses onto a single row, and
      // never grows past the viewport before the list starts scrolling.
      panelClassName="bg-surface-1 rounded-xl shadow-float flex flex-col max-h-[85vh] min-h-[min(32rem,85vh)]"
    >
      {/* The panel's rows bleed 12px either side to draw their hover fill, so
          the body it sits in owns the gutter. */}
      <div className="px-6 py-5">
        <PersonalConnectorsPanel returnTo={returnTo} />
      </div>
    </Modal>
  );
}
