/**
 * URL configuration for the MCP server and its self-hosted OAuth 2.1 layer.
 *
 * In local dev these all resolve to http://localhost:3000. In production set
 * NEXT_PUBLIC_APP_URL (the public origin); MCP_RESOURCE_URL is only needed when
 * the MCP endpoint is reached at some other origin than the app's own.
 */
import type { Implementation } from '@modelcontextprotocol/server'

/** Public origin == OAuth 2.0 Authorization Server issuer (RFC 8414). */
export function oauthIssuer(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * The identity clients show for this server: name, title, site, and logo.
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
export function mcpServerInfo(): Implementation {
  const origin = oauthIssuer()
  return {
    name: 'visvine',
    title: 'Visvine',
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
 * The RFC 8707 resource identifier for the MCP server. The access token `aud`
 * must equal this, and the protected-resource metadata advertises it.
 */
export function mcpResourceUrl(): string {
  return (process.env.MCP_RESOURCE_URL || `${oauthIssuer()}/api/mcp`).replace(/\/$/, '')
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
 * Does this `resource` parameter name *us*? Every authorization and token
 * request must carry one (RFC 8707), and a token minted here is only ever valid
 * for the single MCP resource this deployment serves.
 */
export function isCanonicalResource(raw: string | null | undefined): boolean {
  const given = canonicalizeResource(raw)
  return given !== null && given === canonicalizeResource(mcpResourceUrl())
}
