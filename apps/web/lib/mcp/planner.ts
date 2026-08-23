/**
 * `plan_visvine_query` — the router that turns "what the user asked for" into
 * "which Visvine tools to call, in what order, with what arguments".
 *
 * WHY THIS EXISTS. Visvine's surface is note-first: a connector IS a note at
 * connectors/<name>.md, an agent IS a note at agents/<name>.md, a Tool IS three
 * notes under tools/<name>/. Nothing about `list_connectors` or `list_agents`
 * says that, so a client asked to "create a connector" reads a surface of
 * list_/run_ verbs, finds no `create_connector`, and correctly concludes there
 * is no door — when in fact the door is `edit_context` at the right path. The
 * knowledge was written down (lib/mcp/typeCatalog.ts GUIDANCE), but only behind
 * `list_context`, which is not the tool anyone calls when asked to build
 * something. This tool is the missing index: one call, from the prompt, to the
 * recipe.
 *
 * DELIBERATELY DETERMINISTIC. No model call. Intent is scored with weighted
 * patterns over a hand-written catalog, so planning is free, instant, testable,
 * and structurally incapable of inventing a tool that does not exist. When the
 * match is weak the whole catalog comes back and the caller picks — a planner
 * that guesses confidently is worse than one that admits it doesn't know.
 *
 * The plan is ADVICE, not authorization. Every step it names still runs through
 * the same gates it always did (folder grants, admin checks, the AI freeze), so
 * a wrong plan costs a refusal, never an escape. `blockers` exists to predict
 * those refusals up front rather than discover them three calls in.
 */
import type { SpaceFeatureConfig } from '@/lib/types'
import { isFeatureEnabled } from '@/lib/featureAccess'
import { SANDBOX_LIMITS } from '@/lib/connectors/config'

/** One call the client should make, in order. */
interface PlanStep {
  n: number
  tool: string
  why: string
  /** Argument sketch — literal where known, `<angle brackets>` where the caller must fill it in. */
  args: Record<string, unknown>
  /** Skippable without breaking the plan (a check, a probe, a nicety). */
  optional?: boolean
}

/** What the planner knows about the space the plan targets. Absent when no space_id was given. */
export interface PlanSpaceFacts {
  id: string
  name: string
  you_are_admin: boolean
  /** Feature key → on/off, for the features the recipes care about. */
  features: Record<string, boolean>
  /** Names of connectors already in the space — so a plan never proposes a duplicate. */
  connectors: string[]
  /** Names of agents already in the space. */
  agents: string[]
}

interface RecipeContext {
  space: PlanSpaceFacts | null
  scopes: readonly string[]
}

interface Recipe {
  id: string
  /** One line: when this recipe is the right one. Shown in the catalog. */
  when: string
  /** What the client most needs to understand before step 1. */
  summary: string
  /** Weighted patterns over the lowercased prompt. Highest total wins. */
  patterns: Array<{ re: RegExp; score: number }>
  steps: (ctx: RecipeContext) => PlanStep[]
  /** The literal contract — frontmatter shape, field names — where one applies. */
  contract?: string
  /** Non-obvious facts that decide whether the plan succeeds. */
  mustKnow: (ctx: RecipeContext) => string[]
  /** Predicted refusals, so the client raises them before doing the work. */
  blockers?: (ctx: RecipeContext) => string[]
}

const SPACE = '<space_id — call list_spaces if you do not have it>'

function spaceId(ctx: RecipeContext): string {
  return ctx.space?.id ?? SPACE
}

/**
 * The scope a step needs, checked against the token actually presented. A
 * client that discovers this at plan time can step up its authorization once
 * instead of failing at step 4.
 */
function scopeBlocker(ctx: RecipeContext, scope: string, what: string): string[] {
  if (ctx.scopes.includes(scope)) return []
  return [`Your token does not carry the '${scope}' scope, so ${what} will be refused — reconnect asking for it.`]
}

function featureBlocker(ctx: RecipeContext, key: string, label: string): string[] {
  if (!ctx.space) return []
  if (ctx.space.features[key] !== false) return []
  return [`The '${key}' feature is switched off in ${ctx.space.name}, so ${label} is unavailable until an admin turns it on.`]
}

// ── The contracts, written once ───────────────────────────────────────────
// These are the note shapes the domain layer parses (lib/connectors/config.ts
// parseConnectorPerimeter, lib/agents/config.ts parseAgentBrief). They are
// reproduced here rather than generated because a plan is read by a model, and
// a worked example teaches more than a schema dump.

const CONNECTOR_CONTRACT = `A connector is ONE markdown note at connectors/<name>.md. The frontmatter is the
security perimeter; the body is the only documentation any agent will ever get.

---
type: connector
title: "Stripe"
description: "Stripe billing account"
hosts:
  - api.stripe.com          # the ENTIRE network perimeter. Not listed = unreachable.
env:
  STRIPE_KEY: "{{secret:STRIPE_KEY}}"   # a REFERENCE. Never a real credential.
timeout_ms: ${SANDBOX_LIMITS.timeoutMs.default}
actions:                     # optional but preferred — named, reviewable entry points
  list_customers:
    description: "Recent customers"
    params: { limit: { type: "integer" } }
    code: "const r = await fetch(\`https://api.stripe.com/v1/customers?limit=\${args.limit}\`, { headers: { Authorization: \`Bearer \${env.STRIPE_KEY}\` } }); return JSON.parse(r.body).data"
---

Stripe billing. List customers:

    const res = await fetch('https://api.stripe.com/v1/customers', {
      headers: { Authorization: \`Bearer \${env.STRIPE_KEY}\` },
    })
    return JSON.parse(res.body).data

Amounts are in cents. Customers, charges and invoices are readable.

Runtime the body must be written against: code is the body of an async function
(\`return\` the answer, top-level await works). \`fetch(url, init)\` resolves to
{status, ok, headers, body, truncated, hops} — body is a STRING, so JSON.parse it
yourself; there is no .json(). Also available: \`sql(dsn, query)\` (one read-only
Postgres/MySQL statement), \`mcp(url).listTools()/.callTool(name, args)\`,
\`sleep(ms)\`, \`env\`, \`console.log\`, \`visvine.crypto.*\` (hmac/hash/base64/sigv4),
and \`visvine.state.get/set\` for memory between runs. No filesystem, no process,
no require/import, and no network beyond \`hosts\`.

Optional keys: \`allow:\` (a list of "METHOD /path" rules, trailing * for prefix,
enforced on every request), \`alias:\`, \`identity:\`, \`auth:\`, \`webhook:\`.`

const AGENT_CONTRACT = `An agent is TWO notes:

  agents/<name>.md        the brief — what it does. Written by a member.
  agents/live/<name>.md   activation — whether and when it runs. ADMIN ONLY.

The brief:

---
type: agent
title: "Weekly digest"
description: "Summarises the week's context changes"
model: gemini/gemma-4-31b-it   # must name a \`kind: model\` connector the space has
connectors: [stripe, hubspot]  # names from list_connectors — its whole external reach
tools: []
max_turns: 12
---
You are the weekly digest. Each run, read what changed in the last seven days,
write a summary to digests/<date>.md, and mention the people involved.

The body after the frontmatter IS the system prompt. Say what to read, what to
produce, and where to write it.

Activation (admin, in agents/live/<name>.md):

---
type: agent-activation
active: true
schedule: weekly
at: "09:00"
on: monday
---`

// ── The catalog ───────────────────────────────────────────────────────────

const RECIPES: Recipe[] = [
  {
    id: 'create_connector',
    when: 'Connect the space to an external API, database, SaaS product or MCP server — "add a connector", "integrate X", "let agents call Y".',
    summary:
      'There is no create_connector tool because a connector is not a record — it IS a note at ' +
      'connectors/<name>.md, and you write it with edit_context. The frontmatter declares the security ' +
      'perimeter; the body is the documentation every future agent reads. Space admins only.',
    patterns: [
      { re: /\b(creat|add|build|set ?up|make|register|author|write|new)\w*\b[^.]{0,40}\bconnector/, score: 10 },
      { re: /\bconnector\b[^.]{0,30}\b(for|to)\b/, score: 4 },
      // "hook up our CRM api" never says the word "connector" and is still
      // unambiguously one — weighted to clear the high-confidence bar on its own.
      { re: /\b(connect|integrat|hook ?up|wire ?up|plug ?in)\w*\b[^.]{0,40}\b(api|service|database|saas|crm|mcp server)\b/, score: 8 },
      { re: /\b(connector|connector)\b/, score: 2 },
      { re: /\b(stripe|hubspot|salesforce|notion|slack|airtable|postgres|snowflake|github)\b/, score: 1 },
    ],
    contract: CONNECTOR_CONTRACT,
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_connectors',
        why: 'See what exists before adding to it — extend or fix a neighbour rather than duplicating one, and read a working note for the space\'s house style.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'edit_context',
        why: 'THE STEP THAT CREATES THE CONNECTOR. A full-content write of the note; see `contract` for the exact shape.',
        args: {
          space_id: spaceId(ctx),
          scope: 'shared',
          path: 'connectors/<name>.md',
          content: '<the note — frontmatter perimeter + documented example code>',
          visibility: 'inherit',
        },
      },
      {
        n: 3,
        tool: 'list_connectors',
        why: 'Confirms the frontmatter actually parsed. The new entry carries `invalid` (why the perimeter was rejected), `warnings`, and `secrets` — the secret NAMES an admin still has to store. If it is missing or invalid, fix the note and write again.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 4,
        tool: 'set_connector_secret',
        why:
          'Store each `{{secret:NAME}}` the note references, IF the user gave you the value — this is the step that ' +
          'makes step 5 possible. Space admins only. The name must be one the note already references. Values are ' +
          'write-only: once stored, nothing can read them back. If the user has not given you a credential, do not ' +
          'ask for one in the open — tell them to set it on the connector page and stop here.',
        args: { space_id: spaceId(ctx), connector: '<name>', name: '<SECRET_NAME>', value: '<the credential>' },
        optional: true,
      },
      {
        n: 5,
        tool: 'run_connector',
        why: 'Probe it with the cheapest read-only call in your own docs, to prove the perimeter and auth are right. Skip while any referenced secret is unstored — it can only fail.',
        args: { space_id: spaceId(ctx), connector: '<name>', code: '<one small read-only call>' },
        optional: true,
      },
    ],
    mustKnow: (ctx) => [
      'Pass `visibility: "inherit"` on the write. A new shared note is PRIVATE by default, and list_connectors reads through the visibility lens — a private connector note is invisible to every member but you and the admins.',
      'NEVER write a credential value into the note. Reference it as `{{secret:NAME}}` in `env:` — the note is readable context, so a value written there is a value leaked to everyone who can read the space.',
      'The VALUE goes in the secret store, via set_connector_secret (admins only) when the user has handed you one, or by an admin on the connector\'s page otherwise. Storing it is write-only and irreversible to read: say so before you store, and never echo the value back afterwards.',
      '`hosts:` is the entire network perimeter — bare hostnames, written literally. Include every host the code touches (the API host AND any separate auth host), or the call is refused at run time.',
      'Prefer declaring the common calls as `actions:`. A caller then runs them by name with `args` instead of writing JavaScript, which is both safer and cheaper.',
      'The body is the ONLY documentation future agents get. Working example code using the real env var names beats prose.',
      ...(ctx.space?.connectors.length
        ? [`Already in this space: ${ctx.space.connectors.join(', ')}.`]
        : ['This space has no connectors yet — you are creating the first one.']),
    ],
    blockers: (ctx) => [
      ...(ctx.space && !ctx.space.you_are_admin
        ? ['Only space admins can create or edit connectors — your write to connectors/ will be refused. Draft the note and hand it to an admin.']
        : []),
      ...featureBlocker(ctx, 'connectors', 'connectors'),
      ...scopeBlocker(ctx, 'context:write', 'writing the connector note'),
      // Named separately from the write scope because the consequence differs:
      // without this the note still gets built, it just cannot be finished or
      // tested here — which is worth saying BEFORE the user hands over a key.
      ...scopeBlocker(ctx, 'secrets:write', 'storing the credential (an admin must set it on the connector page instead)'),
      ...scopeBlocker(ctx, 'connectors:use', 'testing it once the secret is stored'),
    ],
  },

  {
    id: 'use_connector',
    when: 'Get data out of, or push data into, a system the space is already connected to.',
    summary:
      'Read the connector\'s docs first — its note body is written for exactly this, and tells you the ' +
      'endpoints, the env var names and the gotchas. Then run a declared action if one fits, or write ' +
      'JavaScript against the documented API.',
    patterns: [
      { re: /\b(run|call|query|fetch|pull|get|sync|push|post)\b[^.]{0,30}\b(connector|api|from stripe|from hubspot)\b/, score: 7 },
      { re: /\bconnector\b[^.]{0,20}\b(run|call|use)\b/, score: 6 },
      { re: /\b(use|via|through)\b[^.]{0,20}\bconnector\b/, score: 5 },
    ],
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_connectors',
        why: 'Each entry carries its docs, its hosts, its env var names and its declared `actions` (name, description, params). This is the API reference — read it before writing any code.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'run_connector',
        why: 'Run a declared action by name with `args`, OR pass `code` — exactly one of the two. Prefer the action when one fits.',
        args: { space_id: spaceId(ctx), connector: '<name>', action: '<declared action>', args: {} },
      },
    ],
    mustKnow: () => [
      '`fetch` returns `body` as a STRING — call JSON.parse yourself; there is no .json().',
      'Use secrets by name (`env.API_KEY`), never ask the user for a credential value. Values are redacted from everything that returns.',
      "A connector with no `hosts` is documentation-only. One with `kind: model` is the space's LLM provider — listed for context, never runnable.",
      'Output is capped at 256KB and each space has a per-minute run budget (429 when exceeded).',
    ],
    blockers: (ctx) => [
      ...scopeBlocker(ctx, 'connectors:use', 'running a connector'),
      ...featureBlocker(ctx, 'connectors', 'connectors'),
      ...(ctx.space && ctx.space.connectors.length === 0
        ? ['This space has zero connectors registered — there is nothing to run. See the `create_connector` intent.']
        : []),
    ],
  },

  {
    id: 'create_agent',
    when: 'Set up something that runs on a schedule or on a trigger — "make an agent", "automate X", "every Monday do Y".',
    summary:
      'An agent is two notes (brief + activation), and agents/ is STRUCTURALLY FROZEN against AI writes — ' +
      'edit_context there is refused whatever your permissions, deliberately: an AI that could rewrite a ' +
      'brief could rewrite itself, and a member edit to a live brief silently deactivates it. So you draft, ' +
      'a human authors, an admin activates. Do not promise the user you will create it.',
    patterns: [
      { re: /\b(creat|add|build|set ?up|make|write|new|author)\w*\b[^.]{0,40}\bagent/, score: 10 },
      { re: /\bagent\b[^.]{0,30}\b(that|which|to)\b[^.]{0,40}\b(every|daily|weekly|hourly|schedule)/, score: 8 },
      { re: /\b(automate|automation|scheduled? (job|task|run))\b/, score: 6 },
      { re: /\b(every (day|morning|monday|week|hour)|daily|weekly|nightly|on a schedule|cron)\b/, score: 4 },
    ],
    contract: AGENT_CONTRACT,
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_agents',
        why: 'See the roster and its conventions — model, declared connectors, schedule shape — and avoid duplicating one.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'list_connectors',
        why: "The brief's `connectors:` list is the agent's entire external reach, and every name must be a connector that exists. `model:` must name a `kind: model` connector the space has.",
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 3,
        tool: 'edit_context',
        why: 'OPTIONAL, and NOT at agents/. Park the drafted brief somewhere ordinary so the work is durable and reviewable — then tell the human the exact path to copy it to. Skip this and just show the brief in your reply if the user would rather paste it themselves.',
        args: {
          space_id: spaceId(ctx),
          scope: 'shared',
          path: 'drafts/agents/<name>.md',
          content: '<the brief, per `contract`>',
        },
        optional: true,
      },
      {
        n: 4,
        tool: '(hand off to a human)',
        why: 'Tell the user, plainly: paste the brief into agents/<name>.md themselves in the Visvine app, then a space admin activates it in agents/live/<name>.md. Activation is the review point and is admin-only by design.',
        args: {},
      },
    ],
    mustKnow: (ctx) => [
      'agents/ refuses every MCP write with "Agent briefs are frozen for AI — a human must make this change." This is not a permissions problem you can escalate around; it is structural.',
      'The brief body after the frontmatter IS the agent\'s system prompt. Be concrete: what to read, what to produce, where to write it.',
      'Once it exists and is active, you CAN trigger it with run_agent — authoring is the only part that is closed to you.',
      ...(ctx.space?.agents.length ? [`Already in this space: ${ctx.space.agents.join(', ')}.`] : []),
    ],
    blockers: (ctx) => [
      'agents/ is frozen for AI origins — you cannot create the agent yourself, only draft it.',
      ...featureBlocker(ctx, 'agents', 'agents'),
    ],
  },

  {
    id: 'run_agent',
    when: 'Trigger an existing agent now, or check when one last ran and how it went.',
    summary: 'The roster is member-visible; running is author-or-admin, and only for an ACTIVE agent.',
    patterns: [
      { re: /\b(run|trigger|fire|kick ?off|execute)\b[^.]{0,25}\bagent\b/, score: 9 },
      { re: /\b(list|show|which|what)\b[^.]{0,20}\bagents?\b/, score: 6 },
      { re: /\bagent\b[^.]{0,25}\b(last (run|ran)|status|failing|failed|schedule)\b/, score: 6 },
    ],
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_agents',
        why: 'Name, model, connectors, whether it is active, its schedule, next run and last run outcome.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'run_agent',
        why: 'Triggers a run now. Shares the scheduler\'s claim path so it cannot double-fire, and does not advance the schedule.',
        args: { space_id: spaceId(ctx), agent: '<name>' },
      },
    ],
    mustKnow: () => [
      'An inactive agent is refused — activation is the review point, and only an admin can flip it.',
      "Only the agent's author or a space admin may trigger a run.",
    ],
    blockers: (ctx) => [...scopeBlocker(ctx, 'agents:run', 'triggering an agent'), ...featureBlocker(ctx, 'agents', 'agents')],
  },

  {
    id: 'build_tool',
    when: 'Build an app, dashboard, form or interactive surface for a space to use.',
    summary:
      'A Tool is three notes under tools/<name>/ — index.md (config + docs), ui.tsx and data.js (its source). ' +
      'tools/ is frozen for generic AI writes, so you must use the dedicated authoring loop, which writes ' +
      'under a human origin. That loop lives on the CREATOR server (/api/mcp/creator).',
    patterns: [
      { re: /\b(creat|build|make|add|write|new)\w*\b[^.]{0,30}\b(tool|app|dashboard|widget|form|mini[- ]?app)\b/, score: 9 },
      { re: /\btool\b[^.]{0,20}\b(marketplace|publish|install)\b/, score: 6 },
      { re: /\b(ui\.tsx|data\.js|tool-kit)\b/, score: 5 },
    ],
    steps: (ctx) => [
      { n: 1, tool: 'list_tools', why: 'Extend an existing tool rather than duplicating it; also shows which ones currently compile.', args: { space_id: spaceId(ctx) } },
      { n: 2, tool: 'get_tool_sdk', why: 'The authoring contract — what is importable, how handlers work, what the frontmatter declares.', args: { space_id: spaceId(ctx) } },
      { n: 3, tool: 'create_tool', why: 'Scaffolds the entity, the config note and two source files that already compile and render.', args: { space_id: spaceId(ctx), name: '<name>', title: '<Display name>', description: '<one sentence>' } },
      { n: 4, tool: 'write_tool', why: 'Write one file and get the fresh build back in the same answer — that is the loop: write, read diagnostics, write again.', args: { space_id: spaceId(ctx), name: '<name>', file: 'ui.tsx', content: '<source>' } },
      { n: 5, tool: 'preview_tool', why: 'A link to see it running before anyone else does.', args: { space_id: spaceId(ctx), name: '<name>' }, optional: true },
      { n: 6, tool: 'publish_tool', why: 'Submits it to the marketplace for review. Admin-gated underneath.', args: { space_id: spaceId(ctx), name: '<name>' }, optional: true },
    ],
    mustKnow: () => [
      'create_tool / read_tool / write_tool / check_tool / preview_tool / publish_tool are only registered on the CREATOR server. If you cannot see them, you are connected to /api/mcp — reconnect to /api/mcp/creator.',
      "Authoring needs the 'tools:author' scope; it deliberately does not ride context:write, because writing executable code into a space is not the same act as summarising notes.",
      'In ui.tsx only `react`, `react-dom` and `@visvine/tool-kit` are importable — every other import is refused at compile time.',
      'Do NOT try to write tools/**/*.md with edit_context; it is refused with "Tools are frozen for AI".',
    ],
    blockers: (ctx) => [...scopeBlocker(ctx, 'tools:author', 'authoring a tool'), ...featureBlocker(ctx, 'tools', 'tools')],
  },

  {
    id: 'create_entity',
    when: 'Record a person, an organisation/company, or a link/document in the directory.',
    summary:
      'These three types — and only these three — are created with add_context, which makes the typed node ' +
      'AND its canonical context note in one step. The type decides the fields and where the note lives.',
    patterns: [
      { re: /\b(add|creat|record|register|new)\w*\b[^.]{0,25}\b(person|people|contact|company|organisation|organization|founder|investor)\b/, score: 9 },
      { re: /\b(add|save|bookmark|record)\b[^.]{0,25}\b(link|resource|document|article|url)\b/, score: 7 },
      { re: /\badd_context\b/, score: 8 },
      { re: /\b(directory|entity|entities)\b/, score: 3 },
    ],
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_context',
        why: "Its `types` catalog is authoritative: which types this space has enabled, their EXACT field keys, their alias vocabulary, and live usage. Pick the best existing type — you cannot create new ones.",
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'search_context',
        why: 'Check it does not already exist. add_context returns a 409 naming the duplicate, but finding it first is cheaper.',
        args: { space_id: spaceId(ctx), query: '<name>' },
        optional: true,
      },
      {
        n: 3,
        tool: 'add_context',
        why: 'Creates the node and its note together. person → people/<slug>.md, space → communities/<slug>.md, resource → resources/<slug>.md.',
        args: { space_id: spaceId(ctx), type: 'person', name: '<Display name>', fields: { email: '<…>' }, body: '<markdown>' },
      },
    ],
    mustKnow: () => [
      'Use the exact field keys — email, companyName, linkedinUrl, url — they are what match an entity to its identity across spaces. An unrecognised key is silently dropped.',
      'A "space" type is a company/collective/investor recorded as a CARD in the directory. It never provisions a new workspace.',
      'Links between entities are never authored directly: a markdown link to an entity\'s note inside a SHARED note body is what creates the edge. Always use the leading-slash form — every tool hands back a ready-made `mention` string; paste it verbatim.',
      'Events, channels and sections are not creatable here — events come from the events surface, channels/sections from the space\'s admin surfaces.',
    ],
    blockers: (ctx) => scopeBlocker(ctx, 'context:write', 'creating an entity'),
  },

  {
    id: 'find_context',
    when: 'Answer a question from what the space already knows — find, look up, summarise, "what do we know about X".',
    summary: 'Search is the entry point; read the hits you actually need. Everything reads through the visibility lens, so absence can mean "not visible to you".',
    patterns: [
      { re: /\b(what|who|when|where|why|how) (do|does|did|is|are|was|were|much|many)\b/, score: 4 },
      { re: /\b(find|search|look ?up|show me|tell me about|summar\w+|list)\b/, score: 5 },
      { re: /\b(what do we know|any notes on|context on|background on)\b/, score: 8 },
    ],
    steps: (ctx) => [
      { n: 1, tool: 'list_spaces', why: 'Every other tool needs a space_id.', args: {}, optional: ctx.space !== null },
      { n: 2, tool: 'search_context', why: 'Ranked hits across the space, with each hit\'s lifecycle status reported so you know when what you found is stale or superseded.', args: { space_id: spaceId(ctx), query: '<terms>' } },
      { n: 3, tool: 'read_context', why: 'Full note, its entity, its sub-notes, and what it links to.', args: { space_id: spaceId(ctx), path: '<path from the hit>' } },
    ],
    mustKnow: () => [
      'Retired notes still rank, below current ones. Every hit reports its `status` — do not present a `stale` or `superseded` note as current, and follow `superseded_by` when it is set.',
      "Reads default to the space's shared context; pass scope:'personal' for your own private space.",
    ],
    blockers: () => [],
  },

  {
    id: 'write_note',
    when: 'Record, update or append to a note in the space (or in your personal space).',
    summary:
      'edit_context replaces a whole note; append_context adds to one. Read before you edit or you will clobber it. ' +
      'Writes go to your PERSONAL space unless you pass scope:"shared".',
    patterns: [
      { re: /\b(write|save|record|note|document|capture|log|jot)\b[^.]{0,30}\b(note|down|this|it|meeting|summary)\b/, score: 7 },
      { re: /\b(update|edit|revise|amend|append|add to)\b[^.]{0,25}\b(note|page|doc|context)\b/, score: 8 },
      { re: /\bedit_context\b|\bappend_context\b/, score: 8 },
    ],
    steps: (ctx) => [
      { n: 1, tool: 'read_context', why: 'edit_context is a FULL-CONTENT write. Read first or you overwrite what is there.', args: { space_id: spaceId(ctx), path: '<path>' }, optional: true },
      { n: 2, tool: 'edit_context', why: 'Write it. Pass scope:"shared" for the space\'s context, and visibility:"inherit" if it should be visible to whoever can see its folder.', args: { space_id: spaceId(ctx), path: '<folder>/<slug>.md', content: '<markdown incl. frontmatter>', scope: 'shared' } },
    ],
    mustKnow: () => [
      'A new SHARED note is private by default — only admins and you can read it. Pass visibility:"inherit" to make it follow its folder.',
      'Every folder IS its index.md, maintained for you. Enrich an existing index (prose above the child markers) rather than replacing it, and never hand-write the child list.',
      'A note that is no longer true is worse than a missing one: set `status:` (stale/superseded/…) and `supersedes: /old/path.md` rather than deleting or silently rewriting.',
      'Mentions with a LEADING SLASH are what create links. `people/x.md` inside `deals/acme.md` resolves to `deals/people/x.md` and silently links to nothing.',
    ],
    blockers: (ctx) => scopeBlocker(ctx, 'context:write', 'writing a note'),
  },

  {
    id: 'manage_access',
    when: 'Change who can see or edit something, or work out why something is invisible.',
    summary: "Visibility is per folder, with per-note restriction. list_context reports each folder's audience and your own level in it.",
    patterns: [
      { re: /\b(share|unshare|permission|access|visib\w+|private|restrict|who can see|grant)\b/, score: 8 },
      { re: /\b(cannot see|can't see|not showing|missing|invisible)\b/, score: 4 },
    ],
    steps: (ctx) => [
      { n: 1, tool: 'list_context', why: "Each folder's audience line, your own access level in it, and which folders are frozen for AI.", args: { space_id: spaceId(ctx) } },
      { n: 2, tool: 'edit_context', why: 'The `visibility` argument on a write is how a note\'s own visibility is set.', args: { space_id: spaceId(ctx), path: '<path>', content: '<unchanged content>', visibility: 'inherit' }, optional: true },
    ],
    mustKnow: () => [
      'connectors/ is admin-only to write. agents/, tools/ and settings/ are frozen against AI writes entirely.',
      'A folder grant on settings/ does not make you an admin — settings are an admin act regardless.',
    ],
    blockers: () => [],
  },

  {
    id: 'organise_context',
    when: 'Tidy up — find broken links, stale notes, duplicates, missing indexes.',
    summary: 'clean_context analyses read-only by default and can then apply its own fixes. Locked folders and out-of-scope notes are left alone.',
    patterns: [
      { re: /\b(clean|tidy|organis|organiz|audit|housekeep|dedupe|de-?duplicate)\w*\b/, score: 8 },
      { re: /\b(broken links|stale notes|duplicates|missing index)\b/, score: 7 },
    ],
    steps: (ctx) => [
      { n: 1, tool: 'clean_context', why: 'Run the analysis first and read what it proposes.', args: { space_id: spaceId(ctx) } },
      { n: 2, tool: 'clean_context', why: 'Apply the fixes you agree with.', args: { space_id: spaceId(ctx), action: 'apply' }, optional: true },
    ],
    mustKnow: () => ['Frozen folders (agents/, tools/, settings/, and anything locked with "Freeze for AI") are never auto-fixed.'],
    blockers: (ctx) => scopeBlocker(ctx, 'context:write', 'applying clean fixes'),
  },
]

/** The fallback when nothing scores: get oriented rather than guess. */
const ORIENT: Recipe = {
  id: 'orient',
  when: 'Nothing matched confidently — establish where you are and what this space holds.',
  summary:
    'No recipe matched the prompt well. Orient first: list_spaces for the space_id, then list_context, whose ' +
    '`types` catalog is the authoritative account of what this space has enabled, what each type is for, and ' +
    'how each is created. Then re-read the `other_intents` list below and pick.',
  patterns: [],
  steps: (ctx) => [
    { n: 1, tool: 'list_spaces', why: 'Every other tool needs a space_id.', args: {} },
    { n: 2, tool: 'list_context', why: "The space's folders, its entities, and the `types` catalog with per-type creation guidance.", args: { space_id: spaceId(ctx) } },
    { n: 3, tool: 'search_context', why: 'If the ask is a question rather than an action, this answers it.', args: { space_id: spaceId(ctx), query: '<terms>' }, optional: true },
  ],
  mustKnow: () => [
    'Visvine is note-first: connectors, agents and Tools are NOTES at fixed paths, not records behind a create_* API. If you are looking for a create_ tool and cannot find one, that is usually why — re-plan with a more specific prompt.',
  ],
}

// ── Matching ──────────────────────────────────────────────────────────────

export interface RecipeMatch {
  recipe: Recipe
  score: number
}

/** Score every recipe against the prompt, best first. Exported for tests. */
export function scoreRecipes(prompt: string): RecipeMatch[] {
  const text = prompt.toLowerCase()
  return RECIPES.map((recipe) => ({
    recipe,
    score: recipe.patterns.reduce((sum, p) => (p.re.test(text) ? sum + p.score : sum), 0),
  }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id))
}

/**
 * How much to trust the top match. The thresholds are calibrated against the
 * pattern weights: a single "creat* … connector" hit is 10 and is decisive; a
 * bare mention of the word "connector" is 2 and is not.
 */
function confidenceOf(matches: RecipeMatch[]): 'high' | 'medium' | 'low' {
  const top = matches[0]?.score ?? 0
  const next = matches[1]?.score ?? 0
  if (top >= 8 && top > next) return 'high'
  if (top >= 5) return 'medium'
  return 'low'
}

export interface PlanInput {
  prompt: string
  space: PlanSpaceFacts | null
  scopes: readonly string[]
}

/**
 * The plan itself. Shaped for a model to act on top-to-bottom: what this is,
 * what will stop you, the ordered calls, the literal contract, then the escape
 * hatch if the intent was read wrong.
 */
export function buildPlan(input: PlanInput): Record<string, unknown> {
  const matches = scoreRecipes(input.prompt)
  const confidence = confidenceOf(matches)
  const chosen = confidence === 'low' || matches.length === 0 ? ORIENT : matches[0].recipe
  const ctx: RecipeContext = { space: input.space, scopes: input.scopes }
  const blockers = chosen.blockers?.(ctx) ?? []

  return {
    planned_for: input.prompt.length > 300 ? `${input.prompt.slice(0, 300)}…` : input.prompt,
    intent: chosen.id,
    confidence,
    summary: chosen.summary,
    ...(blockers.length ? { blockers } : {}),
    steps: chosen.steps(ctx),
    ...(chosen.contract ? { contract: chosen.contract } : {}),
    must_know: chosen.mustKnow(ctx),
    ...(input.space
      ? {
          space: {
            id: input.space.id,
            name: input.space.name,
            you_are_admin: input.space.you_are_admin,
            features: input.space.features,
            connectors: input.space.connectors,
            agents: input.space.agents,
          },
        }
      : {
          space: null,
          space_note: 'No space_id was passed, so this plan is generic. Call list_spaces and plan again with one for a plan that knows your role, the space\'s features, and what it already has.',
        }),
    other_intents: RECIPES.filter((r) => r.id !== chosen.id).map((r) => ({ intent: r.id, when: r.when })),
    if_this_is_wrong:
      'These steps are advice, not authorization — every one still runs through the same permission gates. ' +
      'If the intent above is not what was asked, pick from `other_intents` and call plan_visvine_query again ' +
      'with a more specific prompt.',
  }
}

/** Read the feature flags the recipes reason about off a space's config. */
export function planFeatures(config: SpaceFeatureConfig | null | undefined): Record<string, boolean> {
  return Object.fromEntries(
    ['directory', 'notes', 'connectors', 'agents', 'tools', 'events', 'resources', 'channels'].map((key) => [
      key,
      isFeatureEnabled(config, key),
    ]),
  )
}
