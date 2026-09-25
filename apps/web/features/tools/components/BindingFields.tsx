'use client';

import { Input, Select, Toggle } from '@visvine/ui';
import { bindingChoices, normalizeFolder, type BindableSpace, type BindingValues } from '@visvine/tool-protocol/bindings';
import type { BindingSlot, SettingSpec } from '@visvine/tool-protocol/manifest';

/**
 * The options a slot's picker offers: what this space has of its kind, plus
 * the value it holds now and — for a folder — the Tool's suggestion, since a
 * Tool's first write may be what makes the folder.
 */
function slotOptions(slot: BindingSlot, space: BindableSpace | null, current: string | undefined): string[] {
  const choices = space ? bindingChoices(slot, space) : [];
  const extra = [current, slot.kind === 'folder' ? slot.suggest : undefined]
    .filter((v): v is string => !!v?.trim())
    .map((v) => (slot.kind === 'folder' ? normalizeFolder(v) : v));
  return [...new Set([...extra, ...choices])];
}

function settingInput(
  spec: SettingSpec,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
) {
  if (spec.type === 'boolean') {
    return <Toggle checked={value === true} onChange={onChange} disabled={disabled} aria-label={spec.label} />;
  }
  if (spec.enum) {
    return (
      <Select className="w-48" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {!spec.required && <option value="">—</option>}
        {spec.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }
  if (spec.type === 'number') {
    return (
      <Input
        className="w-48"
        type="number"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        disabled={disabled}
      />
    );
  }
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : '';
  return (
    <Input
      className="w-48"
      value={text}
      onChange={(e) =>
        onChange(
          spec.type === 'string[]'
            ? e.target.value.split(',').map((part) => part.trim()).filter(Boolean)
            : e.target.value,
        )
      }
      disabled={disabled}
    />
  );
}

/** One slot's picker: what this space has of its kind, or none for an optional slot. */
export function SlotSelect({
  name,
  slot,
  value,
  space,
  onChange,
  disabled,
  className = 'w-48',
}: {
  name: string;
  slot: BindingSlot;
  value: string | undefined;
  space: BindableSpace | null;
  onChange: (next: string | undefined) => void;
  disabled?: boolean;
  className?: string;
}) {
  const options = slotOptions(slot, space, value);
  return (
    <Select
      className={className}
      aria-label={slot.label || name}
      value={value ?? ''}
      disabled={disabled || !space}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {(slot.optional || !value) && <option value="">—</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {slot.kind === 'folder' ? `${option}/` : option}
        </option>
      ))}
    </Select>
  );
}

/**
 * A Tool's binding slots as pickers and its settings as fields — on the
 * install sheet and on an installed Tool. Rows name; the pickers say the rest.
 */
export default function BindingFields({
  slots,
  settingSpecs,
  bindings,
  settings,
  space,
  onBindings,
  onSettings,
  disabled,
  headings = false,
}: {
  slots: Record<string, BindingSlot>;
  settingSpecs: Record<string, SettingSpec>;
  bindings: BindingValues;
  settings: Record<string, unknown>;
  /** What this space has, or null while it loads. */
  space: BindableSpace | null;
  onBindings: (next: BindingValues) => void;
  onSettings: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  /** Name the two groups — where they sit among other sections of a page. */
  headings?: boolean;
}) {
  const slotRows = Object.entries(slots);
  const settingRows = Object.entries(settingSpecs);
  if (slotRows.length === 0 && settingRows.length === 0) return null;
  const heading = (text: string) =>
    headings ? <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{text}</p> : null;
  return (
    <div className="flex flex-col gap-3">
      {slotRows.length > 0 && heading('Bindings')}
      {slotRows.map(([name, slot]) => {
        return (
          <label key={`slot:${name}`} className="flex items-center justify-between gap-4">
            <span className="text-fg">{slot.label}</span>
            <SlotSelect
              name={name}
              slot={slot}
              value={bindings[name]}
              space={space}
              disabled={disabled}
              onChange={(value) => {
                const next = { ...bindings };
                if (value) next[name] = value;
                else delete next[name];
                onBindings(next);
              }}
            />
          </label>
        );
      })}
      {settingRows.length > 0 && heading('Settings')}
      {settingRows.map(([key, spec]) => (
        <label key={`setting:${key}`} className="flex items-center justify-between gap-4">
          <span className="text-fg">{spec.label}</span>
          {settingInput(
            spec,
            settings[key] ?? spec.default,
            (value) => {
              const next = { ...settings };
              if (value === undefined || value === '') delete next[key];
              else next[key] = value;
              onSettings(next);
            },
            disabled,
          )}
        </label>
      ))}
    </div>
  );
}
