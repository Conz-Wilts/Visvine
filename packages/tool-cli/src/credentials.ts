/**
 * Where the CLI keeps what it signed in with: one file under the user's
 * config folder (`$VISVINE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/visvine`, else
 * `~/.config/visvine`), readable by its owner alone, keyed by server origin.
 * An access token lasts 30 days and is never refreshed — the server has no
 * refresh grant — so an expired one means signing in again.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ServerCredentials {
  accessToken: string
  /** Epoch seconds, when the server said. */
  expiresAt: number | null
  scope: string | null
  /** The OAuth client this CLI registered as, reused on the next sign-in. */
  client: unknown
  savedAt: string
}

interface CredentialsFile {
  /** The server a command talks to when none is named. */
  defaultServer?: string
  servers: Record<string, ServerCredentials>
}

export function configDir(): string {
  if (process.env.VISVINE_CONFIG_DIR) return process.env.VISVINE_CONFIG_DIR
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'visvine')
}

function credentialsPath(): string {
  return join(configDir(), 'credentials.json')
}

function readFile(): CredentialsFile {
  const path = credentialsPath()
  if (!existsSync(path)) return { servers: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CredentialsFile
    return { defaultServer: parsed.defaultServer, servers: parsed.servers ?? {} }
  } catch {
    return { servers: {} }
  }
}

function writeFile(file: CredentialsFile): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const path = credentialsPath()
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function originOf(server: string): string {
  return new URL(server).origin
}

export function readCredentials(server: string): ServerCredentials | null {
  const found = readFile().servers[originOf(server)]
  if (!found) return null
  if (found.expiresAt && found.expiresAt * 1000 < Date.now()) return null
  return found
}

/** The OAuth client registered with a server, whatever became of its token. */
export function readClient(server: string): unknown {
  return readFile().servers[originOf(server)]?.client ?? null
}

export function saveCredentials(server: string, creds: ServerCredentials): void {
  const file = readFile()
  file.servers[originOf(server)] = creds
  file.defaultServer = originOf(server)
  writeFile(file)
}

export function forgetCredentials(server: string): boolean {
  const file = readFile()
  const origin = originOf(server)
  if (!file.servers[origin]) return false
  delete file.servers[origin]
  if (file.defaultServer === origin) delete file.defaultServer
  writeFile(file)
  return true
}

/** The server last signed in to, if any. */
export function defaultServer(): string | null {
  return readFile().defaultServer ?? null
}
