'use client';

import type { BindableSpace, BindingValues } from '@visvine/tool-protocol/bindings';
import type { ToolManifestFacts } from '@visvine/tool-protocol/manifest';
import { reachSentences } from '@/lib/tools/shared/reachWords';
import { SlotSelect } from './BindingFields';

/**
 * What a Tool can do, in words, with each binding slot's picker standing in
 * the sentence it decides: "Reads and edits notes in [Deal notes ▾]". With no
 * space to bind in, a slot reads as its label.
 */
export default function ReachSentences({
  manifest,
  bindings,
  space,
  onBindings,
  disabled,
}: {
  manifest: ToolManifestFacts;
  bindings: BindingValues;
  /** What the installing space has, or null while it loads — or when there is none to bind in. */
  space: BindableSpace | null;
  onBindings?: (next: BindingValues) => void;
  disabled?: boolean;
}) {
  const sentences = reachSentences(manifest);
  if (sentences.length === 0) return <p className="text-sm text-fg">Reaches nothing</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm text-fg">
      {sentences.map((sentence, at) => (
        <li key={at} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {sentence.map((part, i) => {
            if (typeof part === 'string') return <span key={i}>{part}</span>;
            const slot = manifest.bindings[part.slot];
            if (!slot) return <span key={i} className="font-mono">${part.slot}</span>;
            if (!onBindings) return <span key={i} className="font-medium">{slot.label}</span>;
            return (
              <SlotSelect
                key={i}
                name={part.slot}
                slot={slot}
                value={bindings[part.slot]}
                space={space}
                disabled={disabled}
                className="w-48"
                onChange={(value) => {
                  const next = { ...bindings };
                  if (value) next[part.slot] = value;
                  else delete next[part.slot];
                  onBindings(next);
                }}
              />
            );
          })}
        </li>
      ))}
    </ul>
  );
}
