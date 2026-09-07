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
 * ONE MCP server, at `/api/mcp`, and one OAuth protected resource (RFC 8707):
 * one resource URL, one metadata document, and tokens whose `aud` names it.
 *
 * Everything the platform can do is an action behind a single `visvine` tool,
 * and which action a request needs is answered by the action notes rather than
 * by which endpoint a client happened to connect to. Separating the surfaces
 * would only make a client guess at a boundary the catalogue already explains,
 * and what an action costs is still enforced where it always was: the scope on
 * its definition, checked before dispatch and again in `runAction`.
 *
 * `/api/mcp/creator` answers with a permanent redirect for connections made
 * before the surfaces were one, and `LEGACY_RESOURCE_PATH` keeps their tokens
 * and their `resource` parameter verifying. Both are deletable once no client
 * is configured that way.
 */
const LEGACY_RESOURCE_PATH = '/creator'

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
 * The `instructions` a client receives at initialize — the one piece of text
 * every model reads before it has called anything.
 *
 * It says as little as possible on purpose. This surface is one router and a
 * named tool per action, and each tool's own description teaches how to use
 * it; everything else a
 * client needs — the catalogue, the recipes, the contracts — is fetched from
 * the action notes on the first call, where it can change without a deploy.
 * This string is cached by clients for the life of a connection, so anything
 * that belongs to the product rather than the protocol does not belong here.
 */
export function mcpInstructions(): string {
  return (
    'This server exposes the `visvine` router and one tool per action, `visvine_<action>`. Call the ' +
    "router first with no `action` and `request` set to the user's message verbatim: it returns the plan " +
    'for that ask plus the catalogue of every action that exists — reading and writing context, calling ' +
    'connectors, running agents, and building Tools. Then call the named tool for the action you need ' +
    '(its schema carries every argument), or the router with `action` to read the manual and with ' +
    '`action` + `input` to run it.\n\n' +
    'Visvine is note-first — most things here are markdown notes at deterministic paths, not records ' +
    'behind a create_* API — so the absence of an action named for something is not evidence it cannot be ' +
    'done. The plan will tell you how it is actually done. Never report something as impossible without ' +
    'having read it.'
  )
}

/**
 * The RFC 8707 resource identifier for the MCP server. The access token `aud`
 * must equal this, and the protected-resource metadata advertises it.
 * MCP_RESOURCE_URL moves it when the endpoint is reached at another origin.
 */
export function mcpResourceUrl(): string {
  return (process.env.MCP_RESOURCE_URL || `${oauthIssuer()}/api/mcp`).replace(/\/$/, '')
}

/**
 * The resource identifier a connection made before the surfaces were one still
 * presents — as its token's `aud` and as its `resource` parameter. Accepted as
 * naming the same single resource, so those clients keep working without being
 * reconfigured. There is no confusion to guard against: there is one resource.
 */
export function legacyResourceUrl(): string {
  return `${mcpResourceUrl()}${LEGACY_RESOURCE_PATH}`
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
 * Does this `resource` parameter name our server? Every authorization and token
 * request must carry one (RFC 8707), and a token minted here is only ever valid
 * for the MCP resource it was requested for — so this is what the token's `aud`
 * becomes. The legacy identifier is accepted and normalised away.
 */
export function isCanonicalResource(raw: string | null | undefined): boolean {
  const given = canonicalizeResource(raw)
  if (given === null) return false
  return (
    given === canonicalizeResource(mcpResourceUrl()) ||
    given === canonicalizeResource(legacyResourceUrl())
  )
}
