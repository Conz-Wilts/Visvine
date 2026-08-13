// Display settings for a space's brain, stored in the control-plane
// sidecar ("settings.json" — see sidecar.ts). Currently just the context's
// display name, shown wherever the brain root needs a human label.

import { readJson, writeJson } from './sidecar'
import type { Brain } from './store'
import { CONTEXT_NAME_MAX_LENGTH, DEFAULT_CONTEXT_NAME } from './shared/contextSettings'

const SETTINGS_FILE = 'settings.json'

export interface BrainSettings {
  /** Display name for the brain root ("Entire context" row, share dialogs). */
  contextName: string
}

export async function readBrainSettings(brain: Brain): Promise<BrainSettings> {
  const raw = await readJson<Partial<BrainSettings>>(brain, SETTINGS_FILE, {})
  const name = typeof raw.contextName === 'string' ? raw.contextName.trim() : ''
  return { contextName: name || DEFAULT_CONTEXT_NAME }
}

/** Set the context display name; empty resets to the default. */
export async function writeContextName(brain: Brain, name: string): Promise<BrainSettings> {
  const trimmed = name.trim().slice(0, CONTEXT_NAME_MAX_LENGTH)
  const current = await readJson<Partial<BrainSettings>>(brain, SETTINGS_FILE, {})
  await writeJson(brain, SETTINGS_FILE, { ...current, contextName: trimmed })
  return { contextName: trimmed || DEFAULT_CONTEXT_NAME }
}
