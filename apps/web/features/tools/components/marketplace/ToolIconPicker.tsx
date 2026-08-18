'use client';

/**
 * The icon control on an authored Tool's row: what it looks like in the rail,
 * and the way to replace it with your own.
 *
 * The only file an author gives Visvine directly. Everything else about a Tool
 * is written by a coding agent over MCP, because everything else is code — but
 * an icon starts life as a `.svg` on someone's disk, and routing a picture
 * through a chat transcript to get it into a sidebar would be a silly way to
 * spend anyone's afternoon.
 *
 * The upload is deliberately thin: read the file, post its text, show what came
 * back. No client-side validation beyond "is it plausibly an SVG", because the
 * real check is the sanitizer (lib/tools/iconSvg.ts) running at build time, and
 * two validators that disagree is worse than one that is occasionally slow to
 * answer. A rejection arrives as a build error, in the same place as a broken
 * `ui.tsx`.
 */

import { useRef, useState } from 'react';
import { ImagePlusIcon, LoaderCircleIcon, Trash2Icon } from '@/features/shared/icons';
import ToolIcon from '@/features/tools/components/toolIcons';
import type { AuthoredToolSummary } from '@/lib/tools/api';
import { clearToolIcon, setToolIcon } from '@/features/tools/lib/client';

/** Roughly "did they pick an SVG", so an obvious mistake fails without a round trip. */
const LOOKS_LIKE_SVG = /^\s*(<\?xml|<!|<svg)/i;

export default function ToolIconPicker({
  spaceId,
  tool,
  onChanged,
  onToast,
}: {
  spaceId: string;
  tool: AuthoredToolSummary;
  onChanged: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const custom = tool.build?.iconSvg ?? null;
  const railIcon = tool.build?.config?.surfaces.rail?.icon ?? null;

  /** Every path through here ends with a re-fetch: the build changed either way. */
  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not update the icon.');
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  async function upload(file: File) {
    const svg = await file.text();
    if (!LOOKS_LIKE_SVG.test(svg)) {
      onToast('error', 'That file is not an SVG. Icons are vector shapes, not images.');
      return;
    }
    const { build } = await setToolIcon(spaceId, tool.name, svg);
    // The sanitizer's verdict comes back as a diagnostic against icon.svg. Say
    // it here rather than making the author go and find it in the error list.
    const rejection = build.errors.find((e) => e.file === 'icon.svg');
    if (rejection) onToast('error', rejection.message);
    else if (build.iconSvg) onToast('success', `${tool.title || tool.name} has a new icon.`);
  }

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface-2 text-text-secondary"
        title={custom ? 'This tool ships its own icon' : `Built-in icon: ${railIcon ?? 'grid'}`}
      >
        {busy ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin" />
        ) : (
          <ToolIcon name={railIcon} svg={custom} />
        )}
      </span>

      <input
        ref={input}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear the input first, so picking the same file twice still fires.
          e.target.value = '';
          if (file) void run(() => upload(file));
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        title={custom ? 'Replace this tool’s icon' : 'Upload your own icon (24×24 SVG)'}
        className="flex items-center gap-1 rounded-lg border border-border-default px-2 py-1.5 text-xs font-medium text-text-secondary hover:border-brand-green hover:text-text-primary disabled:opacity-50"
      >
        <ImagePlusIcon className="h-3.5 w-3.5" aria-hidden />
        Icon
      </button>

      {custom && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await clearToolIcon(spaceId, tool.name);
              onToast('info', 'Icon removed — back to the built-in shape.');
            })
          }
          title="Remove this tool’s icon"
          className="rounded-lg border border-border-default p-1.5 text-text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
