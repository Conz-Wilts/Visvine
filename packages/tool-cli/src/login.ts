/**
 * `visvine-tool login`: OAuth 2.1 with PKCE against the server's own
 * authorization server, the way any MCP client signs in — the CLI registers
 * itself as a native client, opens the consent page in the browser and
 * listens on a loopback port for the answer (RFC 8252). The person sees each
 * scope spelled out and approves them; the token that comes back is saved
 * (./credentials.ts) for every later command.
 */
import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/client'
import { readClient, saveCredentials } from './credentials'

/** What building a Tool asks for: reading, authoring, installing, and offering one for listing. */
export const LOGIN_SCOPES = 'context:read tools:author tools:install tools:list'

const WAIT_MS = 5 * 60_000

type ProviderValue<K extends keyof OAuthClientProvider> = Awaited<ReturnType<Extract<OAuthClientProvider[K], (...args: never[]) => unknown>>>

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // The link is printed as well; a machine with no browser uses that.
  }
}

/** A loopback listener for the one redirect this sign-in expects. */
async function listen(state: string): Promise<{ port: number; answer: Promise<{ code: string; iss?: string }>; close: () => void }> {
  let settle!: { resolve: (v: { code: string; iss?: string }) => void; reject: (e: Error) => void }
  const answer = new Promise<{ code: string; iss?: string }>((resolve, reject) => {
    settle = { resolve, reject }
  })
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const page = (title: string, line: string) =>
      `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px/1.5 system-ui,sans-serif;margin:64px auto;max-width:420px;color:#1b1b1b"><h1 style="font-size:18px">${title}</h1><p>${line}</p></body>`
    const error = url.searchParams.get('error')
    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Not signed in', 'You can close this tab and try again.'))
      settle.reject(new Error(url.searchParams.get('error_description') ?? error))
      return
    }
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Not signed in', 'That answer was not for this sign-in.'))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Signed in', 'You can close this tab and go back to your terminal.'))
    settle.resolve({ code, iss: url.searchParams.get('iss') ?? undefined })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const timer = setTimeout(() => settle.reject(new Error('No answer from the browser within 5 minutes.')), WAIT_MS)
  return {
    port,
    answer,
    close: () => {
      clearTimeout(timer)
      server.close()
    },
  }
}

export async function login(
  server: string,
  opts: { browser: boolean; print: (line: string) => void; onAuthorizeUrl?: (url: string) => void },
): Promise<{ scope: string | null; expiresAt: number | null }> {
  const state = randomBytes(24).toString('base64url')
  const loopback = await listen(state)
  const redirectUrl = `http://127.0.0.1:${loopback.port}/callback`
  let client = (readClient(server) ?? undefined) as ProviderValue<'clientInformation'> | undefined
  let tokens: ProviderValue<'tokens'> | undefined
  let verifier = ''
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirectUrl
    },
    get clientMetadata() {
      return {
        client_name: 'visvine-tool',
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: LOGIN_SCOPES,
      }
    },
    state: () => state,
    clientInformation: () => client,
    saveClientInformation: (info) => {
      client = info
    },
    tokens: () => tokens,
    saveTokens: (next) => {
      tokens = next
    },
    redirectToAuthorization: (url) => {
      opts.print(`Open this link to sign in:\n\n  ${url.href}\n`)
      opts.onAuthorizeUrl?.(url.href)
      if (opts.browser) openBrowser(url.href)
    },
    saveCodeVerifier: (value) => {
      verifier = value
    },
    codeVerifier: () => verifier,
  }
  const serverUrl = new URL('/api/mcp', server)
  try {
    let result = await auth(provider, { serverUrl, scope: LOGIN_SCOPES }).catch(async (err) => {
      // A client registered on an earlier sign-in the server no longer knows: register again.
      if (!client) throw err
      client = undefined
      return auth(provider, { serverUrl, scope: LOGIN_SCOPES })
    })
    if (result === 'REDIRECT') {
      const { code, iss } = await loopback.answer
      result = await auth(provider, { serverUrl, authorizationCode: code, iss, scope: LOGIN_SCOPES })
    }
    if (result !== 'AUTHORIZED' || !tokens) throw new Error('The server did not hand back a token.')
    const expiresAt = typeof tokens.expires_in === 'number' ? Math.floor(Date.now() / 1000) + tokens.expires_in : null
    saveCredentials(server, {
      accessToken: tokens.access_token,
      expiresAt,
      scope: tokens.scope ?? null,
      client: client ?? null,
      savedAt: new Date().toISOString(),
    })
    return { scope: tokens.scope ?? null, expiresAt }
  } finally {
    loopback.close()
  }
}
