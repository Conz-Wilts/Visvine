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
 * Everything is an action behind the `visvine` router — reading a space and
 * building a Tool for it included, because a Tool is planned well only by a
 * model that can see the space's types, records and files in the same session.
 * What an action costs is enforced by the scope on its definition, checked
 * before dispatch and again in `runAction`.
 *
 * `/api/mcp/creator` and `/api/mcp/tools` — where Tool authoring once had
 * endpoints of its own — answer with a permanent redirect here, and
 * `LEGACY_RESOURCE_PATHS` keeps their tokens and `resource` parameter
 * verifying. All are deletable once no client is configured that way.
 */
const LEGACY_RESOURCE_PATHS = ['/creator', '/tools'] as const

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
    'connectors, running agents and building Tools. Then call the named tool for the action you need ' +
    '(its schema carries every argument), or the router with `action` to read the manual and with ' +
    '`action` + `input` to run it.\n\n' +
    'Visvine is note-first — most things here are markdown notes at deterministic paths, not records ' +
    'behind a create_* API — so the absence of an action named for something is not evidence it cannot be ' +
    'done. The plan will tell you how it is actually done. Never report something as impossible without ' +
    'having read it.\n\n' +
    'Building a Tool (an app inside a space): research, plan, then build. `plan_tool` first, with the ' +
    "user's request verbatim — it reads the space's types, records, folders and files and says where each " +
    'thing should live; agree its plan with the person in one message; then create_tool { plan } → ' +
    'configure_tool → set_tool_icon → write_tool, and never hand over a preview you have not looked at: ' +
    'check_tool { render: true }, then preview_tool { screenshot: true } per section and per band action.'
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
 * The resource identifiers a connection made to an old authoring endpoint
 * still presents — as its token's `aud` and as its `resource` parameter.
 * Accepted as naming the one resource, so those clients keep working through
 * the redirect without being reconfigured.
 */
export function legacyResourceUrls(): string[] {
  return LEGACY_RESOURCE_PATHS.map((path) => `${mcpResourceUrl()}${path}`)
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
    legacyResourceUrls().some((url) => given === canonicalizeResource(url))
  )
}
