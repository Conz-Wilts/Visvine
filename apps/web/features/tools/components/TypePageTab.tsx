'use client';

/**
 * One installed Tool, shown as the surface for a context type — a `deal` note's
 * whole page, or an extra tab beside a person's profile.
 *
 * A thin adapter on purpose: the isolation, the theme, the height and every
 * refusal are `ToolFrame`'s (see its sandbox notes), and what a Tool is allowed
 * to read about the thing it is being shown for is the bridge's. All this adds
 * is the `subject` — which note or node the viewer is looking at — so the same
 * installed Tool can draw a different board for every deal without the page
 * telling it anything the server hasn't checked.
 */

import ToolFrame from './ToolFrame';
import type { ToolSubject } from '@/lib/tools/protocol';
import type { TypePageOwner } from '@/lib/tools/typePages';

export default function TypePageTab({
  owner,
  subject,
  mode,
}: {
  owner: TypePageOwner;
  /** The note or node this surface is about. */
  subject: ToolSubject;
  /** `page` fills the pane (the Tool IS the page); `tab` grows to its content. */
  mode: 'page' | 'tab';
}) {
  return (
    <ToolFrame
      target={{ kind: 'install', installId: owner.id }}
      subject={subject}
      title={owner.title}
      mode={mode}
    />
  );
}
