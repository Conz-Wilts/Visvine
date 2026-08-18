/**
 * URL configuration for the MCP servers and their self-hosted OAuth 2.1 layer.
 *
 * In local dev these all resolve to http://localhost:3000. In production set
 * NEXT_PUBLIC_APP_URL (the public origin); MCP_RESOURCE_URL is only needed when
 * the MCP endpoints are reached at some other origin than the app's own.
 */
import type { Implementation } from '@modelcontextprotocol/server'

/** Public origin == OAuth 2.0 Authorization Server issuer (RFC 8414). */
export function oauthIssuer(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * The MCP servers this deployment runs. Two, deliberately, because they are for
 * different jobs and are connected by different people at different moments:
 *
 *   context  the Visvine context — read/search/write notes and entities, call
 *            connectors, run agents, discover and install (activate) Tools.
 *   creator  the Tool authoring loop only — scaffold, write, compile, preview
 *            and publish a Tool. What a coding agent (Claude Code, Cursor) is
 *            pointed at when someone is BUILDING a Tool, kept apart so a
 *            "help me with my notes" connection never carries the surface that
 *            writes executable code into a space.
 *
 * Each is its own OAuth protected resource (RFC 8707): its own resource URL,
 * its own metadata document, and tokens whose `aud` names exactly one of them.
 * The authorization server (app/api/oauth/*) is shared.
 */
export const MCP_SERVER_KINDS = ['context', 'creator'] as const
export type McpServerKind = (typeof MCP_SERVER_KINDS)[number]

/**
 * The identity clients show for each server: name, title, site, and logo.
 *
 * The logo is the same PNG the web app uses as its favicon, served from
 * `public/` rather than from Next's file-based `app/icon.png` so the URL stays
 * literal and unhashed — an MCP client fetches it cross-origin, unauthenticated,
 * long after the build that produced it.
 *
 * `icons` reached the SDK's `Implementation` before `mcp-handler` widened its
 * own `serverInfo` option type, which still says `{ name, version }`. Returning
 * a typed value (rather than an object literal at the call site) is what lets
 * the extra fields through TypeScript's excess-property check; at runtime
 * `createMcpHandler` passes the whole object to `new McpServer(...)` untouched.
 */
export function mcpServerInfo(kind: McpServerKind = 'context'): Implementation {
  const origin = oauthIssuer()
  return {
    name: kind === 'creator' ? 'visvine-creator' : 'visvine',
    title: kind === 'creator' ? 'Visvine Creator' : 'Visvine',
    version: '1.0.0',
    websiteUrl: origin,
    icons: [
      {
        src: `${origin}/images/brand-icon.png`,
        mimeType: 'image/png',
        sizes: ['2000x2000'],
      },
    ],
  }
}

/**
 * The RFC 8707 resource identifier for one MCP server. The access token `aud`
 * must equal this, and that server's protected-resource metadata advertises it.
 * The creator server always hangs off the context server's URL, so a single
 * MCP_RESOURCE_URL override moves both.
 */
export function mcpResourceUrl(kind: McpServerKind = 'context'): string {
  const base = (process.env.MCP_RESOURCE_URL || `${oauthIssuer()}/api/mcp`).replace(/\/$/, '')
  return kind === 'creator' ? `${base}/creator` : base
}

/**
 * Reduce a client-supplied `resource` value to the canonical form the MCP spec
 * defines for a resource identifier, or null if it can never be one.
 *
 * The spec's canonical form is lowercase scheme and host with no fragment, but
 * requires servers to *accept* uppercase for robustness, and treats the trailing
 * slash as insignificant — so both are normalised away here rather than
 * rejected. A fragment is rejected outright: RFC 8707 forbids it.
 */
export function canonicalizeResource(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null // relative, or missing a scheme
  }
  if (url.hash) return null
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // `URL` already lowercases scheme and host for us.
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return `${url.protocol}//${url.host}${path}${url.search}`
}

/**
 * Which of our servers does this `resource` value name, if any? Every
 * authorization and token request must carry one (RFC 8707), and a token
 * minted here is only ever valid for the single MCP resource it was requested
 * for — so the answer is what the token's `aud` becomes.
 */
export function resourceKindOf(raw: string | null | undefined): McpServerKind | null {
  const given = canonicalizeResource(raw)
  if (given === null) return null
  for (const kind of MCP_SERVER_KINDS) {
    if (given === canonicalizeResource(mcpResourceUrl(kind))) return kind
  }
  return null
}

/** Does this `resource` parameter name one of *our* servers? */
export function isCanonicalResource(raw: string | null | undefined): boolean {
  return resourceKindOf(raw) !== null
}
