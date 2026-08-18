/**
 * The two documents an authoring agent needs before it can write a Tool: the
 * type surface of `@visvine/tool-kit` and the prose guide to the file layout,
 * the frontmatter and the limits.
 *
 * They are strings rather than files under `docs/` because their consumer is
 * the MCP tool `get_tool_sdk` — an agent working in someone else's editor, with
 * no checkout of this repo, that must be able to ask for the SDK and get it in
 * one call. The `.d.ts` is hand-maintained: it is the contract as *documented*,
 * and it is only right if it matches `features/tools/kit/index.ts`, so the two
 * are changed together.
 *
 * Backticks in the guide are escaped (`\``) because the whole document is one
 * template literal. The limits are interpolated from `BRIDGE_LIMITS` so the
 * numbers an author reads are the numbers the server enforces.
 */
import { BRIDGE_LIMITS } from './protocol'

/**
 * Ambient declarations for the bare specifier a Tool imports. An authoring
 * agent drops this next to `ui.tsx` (or feeds it to its own type checker) and
 * gets completion for the whole kit without resolving anything.
 */
export const TOOL_KIT_DTS = `// Type definitions for @visvine/tool-kit
// The module a Visvine Tool imports. Resolved at runtime by the frame's import
// map; there is nothing to install.

declare module '@visvine/tool-kit' {
  import type { ButtonHTMLAttributes, InputHTMLAttributes, JSX, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

  // ── data shapes ──

  /** What the Tool is being shown about, or null on its own page. */
  export type ToolSubject =
    | { kind: 'note'; path: string; type: string | null; title: string | null }
    | { kind: 'node'; nodeId: string; type: string; notePath: string | null }

  export interface ToolViewer {
    id: string
    name: string
    /** Admin of this space. Never assume it; the server checks anyway. */
    isAdmin: boolean
  }

  export type ToolInstallInfo =
    | { slug: string; title: string; key: string }
    | { preview: true; name: string }

  /** Non-null when the space is missing something this Tool declared. */
  export interface ToolDegraded {
    missing: { connectors: string[]; types: string[]; agents: string[] }
  }

  export interface ContextEntry {
    path: string
    title: string | null
    type: string | null
    /** ISO 8601. */
    updatedAt: string
  }

  export interface ContextNote {
    path: string
    content: string
    frontmatter: Record<string, unknown>
  }

  export interface ContextHit {
    path: string
    title: string | null
    snippet: string
    score: number
  }

  export type BridgeErrorCode =
    | 'perimeter'
    | 'forbidden'
    | 'not_found'
    | 'rate_limited'
    | 'too_large'
    | 'timeout'
    | 'invalid'
    | 'degraded'
    | 'internal'

  export interface BridgeError {
    code: BridgeErrorCode
    message: string
  }

  /** What every method below rejects with. Branch on \`code\`. */
  export class BridgeCallError extends Error {
    readonly code: BridgeErrorCode
  }

  // ── the bridge ──

  export interface VisvineApi {
    context: {
      list(glob?: string): Promise<ContextEntry[]>
      read(path: string): Promise<ContextNote>
      search(query: string, k?: number): Promise<ContextHit[]>
      write(path: string, content: string): Promise<{ path: string }>
      append(path: string, text: string): Promise<{ path: string }>
    }
    connectors: {
      call<T = unknown>(name: string, code: string): Promise<T>
    }
    agents: {
      run(name: string): Promise<{ runId: string }>
    }
    data: {
      /** Call a handler exported from this Tool's data.js. */
      call<T = unknown>(fn: string, args?: unknown): Promise<T>
    }
    state: {
      /** Per-install key/value store. There is no localStorage in the sandbox. */
      get<T = unknown>(key: string): Promise<T | null>
      set(key: string, value: unknown): Promise<null>
    }
    subject: ToolSubject | null
    viewer: ToolViewer
    install: ToolInstallInfo
    degraded: ToolDegraded | null
    /** In-app paths only; Visvine refuses anything else. */
    navigate(path: string): void
  }

  /** Mounted for you by the runtime. You never render this yourself. */
  export function VisvineProvider(props: { children: ReactNode }): JSX.Element

  export function useVisvine(): VisvineApi
  export function useSubject(): ToolSubject | null
  /** The theme as raw CSS custom properties; prefer styling with var(--vv-*). */
  export function useTheme(): Record<string, string>

  export interface QueryResult<T> {
    data: T | null
    error: Error | null
    loading: boolean
    reload: () => void
  }

  /** Runs fn when deps change, drops superseded results, hands back a reload. */
  export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryResult<T>

  // ── components ──
  // Styled from Visvine's theme tokens. Use these before writing your own CSS,
  // so an installed Tool looks like the app it is running inside.

  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant
    size?: 'sm' | 'md'
    children: ReactNode
  }
  export function Button(props: ButtonProps): JSX.Element

  export interface CardProps {
    title?: ReactNode
    actions?: ReactNode
    flush?: boolean
    className?: string
    children: ReactNode
  }
  export function Card(props: CardProps): JSX.Element

  export interface StackProps {
    direction?: 'row' | 'column'
    gap?: 'sm' | 'md' | 'lg'
    wrap?: boolean
    className?: string
    children: ReactNode
  }
  export function Stack(props: StackProps): JSX.Element

  export interface PageHeaderProps {
    title: ReactNode
    description?: ReactNode
    actions?: ReactNode
  }
  export function PageHeader(props: PageHeaderProps): JSX.Element

  export interface FieldProps {
    label: ReactNode
    htmlFor?: string
    hint?: ReactNode
    error?: ReactNode
    children: ReactNode
  }
  export function Field(props: FieldProps): JSX.Element

  export type InputProps = InputHTMLAttributes<HTMLInputElement>
  export function Input(props: InputProps): JSX.Element

  export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>
  export function Textarea(props: TextareaProps): JSX.Element

  export interface SelectOption {
    value: string
    label: string
  }
  export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    options?: SelectOption[]
    children?: ReactNode
  }
  export function Select(props: SelectProps): JSX.Element

  export type ChipTone = 'neutral' | 'accent' | 'danger' | 'warn' | 'info'
  export interface ChipProps {
    tone?: ChipTone
    className?: string
    children: ReactNode
  }
  export function Chip(props: ChipProps): JSX.Element

  export interface TabItem {
    id: string
    label: ReactNode
  }
  export interface TabsProps {
    tabs: TabItem[]
    active: string
    onChange: (id: string) => void
    className?: string
  }
  export function Tabs(props: TabsProps): JSX.Element

  export interface TableColumn<T> {
    key: string
    header: ReactNode
    render: (row: T) => ReactNode
    align?: 'left' | 'right'
    width?: string
  }
  export interface TableProps<T> {
    columns: Array<TableColumn<T>>
    rows: T[]
    rowKey: (row: T, index: number) => string
    onRowClick?: (row: T) => void
    empty?: ReactNode
  }
  export function Table<T>(props: TableProps<T>): JSX.Element

  export interface EmptyStateProps {
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
  }
  export function EmptyState(props: EmptyStateProps): JSX.Element

  export interface SpinnerProps {
    size?: 'sm' | 'lg'
    label?: string
  }
  export function Spinner(props: SpinnerProps): JSX.Element

  export type BannerTone = 'info' | 'success' | 'warn' | 'danger'
  export interface BannerProps {
    tone?: BannerTone
    title?: ReactNode
    action?: ReactNode
    children?: ReactNode
  }
  export function Banner(props: BannerProps): JSX.Element
}
`

/**
 * The prose half — what an agent reads once before writing anything. Written
 * for a model, not a browser: short sections, whole examples, and the refusals
 * spelled out so the first compile is the working one.
 */
export const TOOL_AUTHOR_GUIDE = `# Building a Visvine Tool

A Tool is a small React app that runs inside a Visvine space. It renders in the
main content area, reads and writes the space's own context notes, and can call
the space's connectors and agents — but only the ones it declares up front.

Three files, all of them notes in the space, so they have history, permissions
and review like anything else:

\`\`\`
tools/<name>/index.md    frontmatter = config, body = docs for humans
tools/<name>/ui.tsx      the React component (compiled on write)
tools/<name>/data.js     optional server-side handlers (sandboxed isolate)
\`\`\`

## index.md

\`\`\`yaml
---
type: tool
title: Deal Pipeline
description: Kanban over deal notes
surfaces:
  rail: { label: Deals, icon: kanban }     # optional: sidebar item + full page
  types: [{ type: deal, mode: page }]      # optional: own the page for a type
perimeter:
  read:  ["deals/**", "people/*/index.md"]
  write: ["deals/**"]
  types: [deal]
  connectors: [hubspot]
  agents: ["deal-*"]
---

What this Tool is for, in a paragraph or two.
\`\`\`

**The perimeter is the whole security story.** Anything not listed is refused at
the bridge with a \`perimeter\` error, and an admin reads this block before
installing. Declare the narrowest globs that work — a Tool asking for \`**\` will
not be approved.

The perimeter narrows; it never widens. A Tool can only ever see what the person
using it could already see. Two members with different grants running the same
Tool see different data, and that is correct.

**\`tools/\`, \`agents/\` and \`connectors/\` are sealed against Tool writes**, whatever
you declare — they hold configuration that runs. One exception: a Tool may CREATE
\`agents/<name>.md\` (an agent brief) when its own \`perimeter.agents\` names that
agent, e.g. \`agents: ["deal-*"]\` for \`agents/deal-nightly.md\`. A bare \`*\` names
nobody. It may never rewrite a brief that already exists, never append to one, and
never write \`agents/live/**\` — ACTIVATION is a space admin's act, so a brief your
Tool wrote does nothing until a person turns it on.

## ui.tsx

\`\`\`tsx
import { useVisvine, useQuery, PageHeader, Card, Stack, Table, Spinner, Banner, Button } from '@visvine/tool-kit'

export default function Tool() {
  const visvine = useVisvine()
  const { data, error, loading, reload } = useQuery(() => visvine.context.list('deals/**'), [])

  if (loading) return <Spinner size="lg" />
  if (error) return <Banner tone="danger" title="Could not load deals">{error.message}</Banner>

  return (
    <Stack gap="lg">
      <PageHeader
        title="Deals"
        description={\`\${data?.length ?? 0} open\`}
        actions={<Button onClick={reload}>Refresh</Button>}
      />
      <Card flush>
        <Table
          columns={[
            { key: 'title', header: 'Deal', render: (r) => r.title ?? r.path },
            { key: 'updated', header: 'Updated', render: (r) => r.updatedAt.slice(0, 10) },
          ]}
          rows={data ?? []}
          rowKey={(r) => r.path}
          onRowClick={(r) => visvine.navigate(\`/directory/note/\${r.path}\`)}
          empty="No deals yet."
        />
      </Card>
    </Stack>
  )
}
\`\`\`

Rules:

- \`export default\` a component named \`Tool\`. It takes no props — everything
  arrives through \`useVisvine()\`.
- Import only \`react\` and \`@visvine/tool-kit\`. There is no package install
  step and no npm at runtime; any other import fails to compile.
- Do not render your own page chrome. The app supplies the navbar, the sidebar
  and the page frame. Your Tool is the content.
- The frame is sized to your content automatically. Do not use
  \`position: fixed\` or \`100vh\` — they measure the iframe, not the window, and
  a Tool cannot escape it anyway.
- \`visvine.subject\` is set when your Tool owns a type page: it is the note or
  node whose page is being rendered. It is null on your Tool's own page.

## data.js

Optional. Use it when the work should not happen in the browser — a connector
call with a large response, a computation over many notes, anything you would
rather the viewer's laptop did not do.

\`\`\`js
handlers.summary = async (args, visvine) => {
  const notes = await visvine.context.list('deals/**')
  const open = notes.filter((n) => n.type === 'deal')
  return { count: open.length, latest: open[0]?.path ?? null }
}
\`\`\`

Call it from the UI with \`visvine.data.call('summary', { ... })\`.

Handlers run in a sandboxed isolate with the same \`visvine\` object the UI has
and the same perimeter. There is no filesystem, no socket and no \`process\`; a
handler that has not returned within ${Math.round(BRIDGE_LIMITS.dataCallTimeoutMs / 1000)} seconds is killed.

## Limits

| What | Cap |
| --- | --- |
| Rows from one \`context.list\` / \`context.search\` | ${BRIDGE_LIMITS.maxRows} |
| Bytes from one \`context.read\` | ${BRIDGE_LIMITS.maxReadBytes.toLocaleString('en-US')} |
| Bytes in one \`context.write\` / \`context.append\` | ${BRIDGE_LIMITS.maxWriteBytes.toLocaleString('en-US')} |
| Bytes of params in one call | ${BRIDGE_LIMITS.maxParamsBytes.toLocaleString('en-US')} |
| Calls per minute, per viewer | ${BRIDGE_LIMITS.callsPerMinute} |
| One \`data.call\` | ${Math.round(BRIDGE_LIMITS.dataCallTimeoutMs / 1000)}s |

Paginate rather than asking for everything: a list that would exceed the row cap
comes back truncated, not as an error.

## Failure

Every bridge method rejects with a \`BridgeCallError\` carrying a \`code\`:

| Code | Means |
| --- | --- |
| \`perimeter\` | Your Tool never declared this reach. Fix the frontmatter. |
| \`forbidden\` | The viewer cannot see it. Not yours to fix — handle it. |
| \`not_found\` | No such note, connector or agent. |
| \`degraded\` | This space lacks something you declared; see \`visvine.degraded\`. |
| \`rate_limited\` | Too many calls. Back off. |
| \`too_large\` | Over one of the caps above. |
| \`timeout\` | A \`data.call\` ran too long. |
| \`invalid\` | Bad params. |
| \`internal\` | Visvine's fault. |

Show the failure in your own pane — a \`Banner\` with the message — rather than
rendering nothing. If \`visvine.degraded\` is set, say so once at the top: reads
against the missing pieces come back empty, so a Tool that stays silent looks
broken instead of incomplete.

## Do / don't

**Do**

- Keep the perimeter as narrow as the Tool actually needs.
- Use the kit's components. They carry the space's theme, so an installed Tool
  looks like Visvine and not like a twelfth website.
- Store per-install preferences in \`visvine.state\`.
- Read \`visvine.viewer.isAdmin\` to hide admin-only affordances — but never to
  protect data. The server decides that.

**Don't**

- Don't reach for \`localStorage\`, \`document.cookie\`, \`fetch\` or \`window.parent\`.
  The frame is sandboxed on a cookie-less origin with no network of its own;
  all four either fail or do nothing. \`visvine.state\` replaces the first two.
- Don't import a UI library or a CSS framework. Nothing resolves at runtime and
  the bundle has a size cap.
- Don't poll. Query on mount and after a write, and give the reader a refresh.
- Don't put a secret in \`ui.tsx\` or \`data.js\`. Both are readable by anyone who
  can read the note, and a published Tool ships its source into the registry.
`
