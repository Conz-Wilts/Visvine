// Display settings for a space's context, stored in the control-plane
// sidecar ("settings.json" — see sidecar.ts). Currently just the context's
// display name, shown wherever the context root needs a human label.

import { readJson, writeJson } from './sidecar'
import type { Context } from './store'
import { CONTEXT_NAME_MAX_LENGTH, DEFAULT_CONTEXT_NAME } from './shared/contextSettings'

const SETTINGS_FILE = 'settings.json'

export interface ContextSettings {
  /** Display name for the context root ("Entire context" row, share dialogs). */
  contextName: string
}

export async function readContextSettings(context: Context): Promise<ContextSettings> {
  const raw = await readJson<Partial<ContextSettings>>(context, SETTINGS_FILE, {})
  const name = typeof raw.contextName === 'string' ? raw.contextName.trim() : ''
  return { contextName: name || DEFAULT_CONTEXT_NAME }
}

/** Set the context display name; empty resets to the default. */
export async function writeContextName(context: Context, name: string): Promise<ContextSettings> {
  const trimmed = name.trim().slice(0, CONTEXT_NAME_MAX_LENGTH)
  const current = await readJson<Partial<ContextSettings>>(context, SETTINGS_FILE, {})
  await writeJson(context, SETTINGS_FILE, { ...current, contextName: trimmed })
  return { contextName: trimmed || DEFAULT_CONTEXT_NAME }
}
