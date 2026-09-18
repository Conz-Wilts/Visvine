/**
 * The recipes Visvine ships with: how to do the dozen things this platform gets
 * asked for, written for the model that has to do them.
 *
 * A RECIPE IS CONTENT, not a branch in a router. `pnpm db:actions:sync` renders
 * each one into a note in the Visvine space's shared Context (`recipes/<id>.md`), and the
 * note is what the gateway reads at run time. That is the same bargain
 * `lib/connectors/catalog.ts` makes: the catalogue in code is the shipped
 * default, the note is the live thing, and an admin improves the note without
 * waiting for a deploy.
 *
 * DELIBERATELY DETERMINISTIC, still. Matching is a weighted term overlap over
 * the keywords each recipe declares (lib/actions/shared/match.ts) — free,
 * instant, testable, and structurally incapable of naming an action that does
 * not exist, because the gateway resolves every name it returns against the
 * registry before offering it. Keywords rather than regular expressions
 * specifically so that a recipe survives the round trip through YAML
 * frontmatter and an admin can add one by writing a note.
 *
 * A recipe is ADVICE, not authorization. Every step it names still runs through
 * the same gates (folder grants, admin checks, the AI freeze), so a wrong
 * recipe costs a refusal, never an escape. `blockers` exists to predict those
 * refusals up front rather than discover them three calls in.
 */
import type { SpaceFeatureConfig } from '@/lib/types'
import { isFeatureEnabled } from '@/lib/featureAccess'
import { SANDBOX_LIMITS } from '@/lib/connectors/config'
import { kw, type KeywordRule } from '@/lib/actions/shared/match'
import { renderIntake, type IntakeKind } from '@/lib/actions/shared/intake'
import { AGENT_RUN_CAPABILITIES } from '@/lib/agents/shared/prompt'

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

export interface RecipeContext {
  space: PlanSpaceFacts | null
  scopes: readonly string[]
}

export interface Recipe {
  id: string
  /** One line: when this recipe is the right one. Shown in the catalog. */
  when: string
  /** What the client most needs to understand before step 1. */
  summary: string
  /** Weighted term rules over the lowercased prompt. Highest total wins. */
  keywords: KeywordRule[]
  /**
   * Set on the recipes that BUILD something that then runs unattended. It puts
   * a short, budgeted intake in front of step 1 — the few questions whose
   * answers change the artefact — because the alternative is a model writing a
   * plausible agent nobody asked for at a time nobody chose.
   */
  intake?: IntakeKind
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

const AGENT_CONTRACT = `An agent is TWO things:

  the BRIEF        what it does. Any member writes it — create_agent.
  the ACTIVATION   whether and when it runs. Anyone who can edit the brief
                   turns it on — activate_agent. An admin can turn it off or
                   delete it.

Creating an agent does NOT start it. A brief is inert until someone turns it
on, and that is deliberate: an active agent runs unattended on the space's
model key with whatever reach its brief declares, so a person says go.

create_agent writes the brief for you; you never write that note by hand. An
agent is a folder, agents/<name>/, and the brief is its index.md:

---
type: agent
title: "Weekly digest"
description: "Summarises the week's context changes"
connectors: [stripe, hubspot]  # names from list_connectors — its whole external reach
tools: []
max_turns: 12
---
You are the weekly digest. Each run, read what changed in the last seven days
and write a digest to your own folder as a dated note (agents/weekly-digest/<date>.md):
an H1, a "What changed" section grouped by theme, and a "People" list linking
every person involved to their note.

Note what is NOT there: \`model:\`. An agent runs on the SPACE's model — the
first note under \`models/\` it has — because which model a space runs on is
one decision it makes once, beside the key that pays for it. Omit \`model:\`
unless this particular agent must run on a different one the space ALSO has,
and never invent a provider: a space with no model has no model, and
the right answer is to say so and create the agent anyway. It will run as soon
as somebody adds one, with no edit to the brief.

The body after the frontmatter IS the system prompt. Say what to read, what to
produce (and its shape), and where to write it.

What the agent can do — so the brief can ask for it: ${AGENT_RUN_CAPABILITIES}

Activation is activate_agent — a schedule (\`schedule: weekly\`, \`at: "09:00"\`,
\`weekday: monday\`, \`timezone: "Pacific/Auckland"\`), an interval
(\`every: "15m"\`), or a trigger (\`on_context: ["people/**"]\`). At least one of
them, and a clock needs a timezone.`

// ── The catalog ───────────────────────────────────────────────────────────

const RECIPES: Recipe[] = [
  {
    id: 'create_connector',
    when: 'Connect the space to an external API, database, SaaS product or MCP server — "add a connector", "integrate X", "let agents call Y".',
    summary:
      'There is no create_connector tool because a connector is not a record — it IS a note at ' +
      'connectors/<name>.md, and you write it with edit_context. The frontmatter declares the security ' +
      'perimeter; the body is the documentation every future agent reads. Space admins only.',
    keywords: [
      ...kw('creat|add|build|set up|setup|make|register|author|write|new', 'connector', 10),
      ...kw('connect|integrat|hook up|wire up|plug in', 'api|service|database|saas|crm|mcp server', 8),
      ...kw('connector', 'for|to', 4),
      ...kw('connector', '', 2),
      ...kw('stripe|hubspot|salesforce|notion|slack|airtable|postgres|snowflake|github', '', 1),
    ],
    intake: 'connector',
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
      'The intake above costs one message and saves a rewrite: which service and account, and what the secret is CALLED. Everything else can be proposed and corrected.',
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
    keywords: [
      ...kw('run|call|query|fetch|pull|sync|push|post', 'connector|api', 7),
      ...kw('connector', 'run|call|use', 6),
      ...kw('use|via|through', 'connector', 5),
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
      "A connector with no `hosts` is documentation-only. The space's models are not connectors — list_models shows them, and nothing runs them directly.",
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
      'Write the brief with create_agent, then turn it on with activate_agent. Creating is not starting: a new ' +
      'agent is inert until someone who can edit it activates it — and whoever wrote the brief can.',
    keywords: [
      ...kw('creat|add|build|set up|setup|make|write|new|author', 'agent', 10),
      // Weak on purpose. "the weekly-digest agent" is a REFERENCE to one, not a
      // request to build one, and this rule fires on both — so it may add to a
      // creation verb's score but must never outrank `run_agent` on its own.
      ...kw('agent', 'every|daily|weekly|hourly|schedule', 3),
      ...kw('automate|automation|scheduled job|scheduled task|scheduled run', '', 6),
      ...kw('every day|every morning|every monday|every week|every hour|daily|weekly|nightly|on a schedule|cron', '', 4),
    ],
    intake: 'agent',
    contract: AGENT_CONTRACT,
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_agents',
        why: 'See the roster and its conventions — model, declared connectors, schedule shape — and avoid duplicating one. A name already taken is refused.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'list_connectors',
        why: "The brief's `connectors` list is the agent's entire external reach, and every name must be a connector that exists. Leave `model` out of the brief: the agent runs on the space's model (list_models). If there are none, say so and create it anyway.",
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 3,
        tool: 'create_agent',
        why: "Writes the brief. `instructions` IS the agent's system prompt, so write a standing instruction — what to read, what to produce and its shape (headings, a table, links to the people involved), where to write it (its own folder agents/<name>/ by default) — not a description of the agent. The answer's `needs` and `plan` say what still stands between the brief and a working run: read them back as the next steps.",
        args: {
          space_id: spaceId(ctx),
          name: '<slug>',
          title: '<display name>',
          description: '<one line for the roster>',
          instructions: '<the brief, per `contract`>',
        },
      },
      {
        n: 4,
        tool: 'rehearse_agent',
        why: "Offer to try it before turning it on, and do it if they say yes. It runs nothing: it hands back the first round — preamble, brief, the model a real run would use, and whether each connector is reachable — and YOU carry that round out on your own model, writing nothing and showing the person the output in your reply. It is the only look anyone gets at what the agent produces before an unattended run produces it.",
        args: { space_id: spaceId(ctx), agent: '<slug>' },
        optional: true,
      },
      {
        n: 5,
        tool: 'activate_agent',
        why: "Turn it on and set when it runs. Anyone who can edit the brief may — with this action or the Turn on button on the agent's page. Confirm the schedule with the person first.",
        args: { space_id: spaceId(ctx), agent: '<slug>', schedule: 'weekly', at: '09:00', weekday: 'monday', timezone: '<IANA zone>' },
        optional: true,
      },
    ],
    mustKnow: (ctx) => [
      'CREATING IS NOT STARTING. A brief does nothing until it is activated — never tell the user their agent is running because you created it.',
      'The intake above is the difference between an agent someone keeps and one they switch off: the two answers that matter most are what it should produce and when it should run. Ask those, in one message, then build.',
      "The `instructions` you pass IS the agent's system prompt. Be concrete: what to read, what to produce, where to write it.",
      'create_agent CREATES only. An existing name is refused rather than overwritten — a live agent runs the brief a person approved. Briefs are edited on the note itself.',
      'A clock schedule needs a timezone. Ask which one rather than assuming; "daily at 07:00" is meaningless without it.',
      'OFFER THE REHEARSAL. A brief nobody has seen run is a guess, and the first real run happens unattended. rehearse_agent hands you the round to do yourself — on your model, on your access, writing nothing — so the person reads the output and fixes the brief before it is ever switched on. It also surfaces a missing model or an unconnected connector now rather than in a failed 3am run.',
      'A rehearsal is NOT a run: say so plainly. Nothing was recorded on the agent, nothing was billed to the space, and the notes it would have written do not exist until it runs for real.',
      "SAY WHAT IT NEEDS. create_agent and rehearse_agent return `needs` — no model in the space, a declared connector that is missing, off or not signed in to, a service the instructions name (Slack, Gmail…) that the brief never declared — each with why, the fix and who can do it, and `plan` with the fixes in order. When `ready` is false, hand the person that plan as the next steps and do not call the agent ready. A connector the space lacks is added by an admin from the Space Console's catalogue; one nobody signed in to is fixed at its `href`; a service the brief forgot is added to its `connectors:` on the agent's page.",
      "NEVER put a model in the brief unless the person asked for a specific one. If the space has no model, create_agent says so in `model_problem` — repeat that to them (\"there is no model in this space yet, so I have left it unset; add one under Models and this will run\") rather than naming a provider they never signed up for.",
      'Once it is active, run_agent triggers it now without waiting for the schedule.',
      // agents/ refuses generic AI writes (contextService.lockedDenial), and
      // create_agent is the ONE way past it — it writes at a human origin.
      // Without this a model refused at step 3 improvises a brief into some
      // unfrozen folder, where nothing reads it: findAgentBrief only looks
      // under agents/, so the "agent" it reports creating does not exist.
      'create_agent is the ONLY way to write a brief. agents/ refuses add_context and edit_context, and a brief written anywhere else is not an agent — never invent a folder to hold one. If create_agent is refused, say so and stop.',
      ...(ctx.space?.agents.length ? [`Already in this space: ${ctx.space.agents.join(', ')}.`] : []),
    ],
    blockers: (ctx) => scopeBlocker(ctx, 'agents:author', 'writing the brief'),
  },

  {
    id: 'run_agent',
    when: 'Trigger an existing agent now, or check when one last ran and how it went.',
    summary: 'The roster is member-visible; running is for anyone who can edit the brief, switched on or not.',
    keywords: [
      ...kw('run|trigger|fire|kick off|execute', 'agent', 9),
      ...kw('list|show|which|what', 'agent', 6),
      ...kw('agent', 'last run|last ran|status|failing|failed|schedule', 6),
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
      'An inactive agent still runs this way: switching one on approves it to run UNATTENDED on a clock, which a person asking for one run now is not. Never tell somebody to turn an agent on before you will run it for them.',
      'A space with NO MODEL has no engine to run it: run_agent answers `ran: false` with a `stand_in` — the preamble, the brief and the rules — and you carry that round out yourself, writing the notes it asks for through add_context / edit_context / append_context. Do it; do not report the refusal.',
      "Only someone who can edit the agent's brief — its author, a space admin, or a member with edit access to its folder — may trigger a run.",
    ],
    blockers: (ctx) => scopeBlocker(ctx, 'agents:run', 'triggering an agent'),
  },

  {
    id: 'build_tool',
    when: 'Build an app, dashboard, form or interactive surface for a space to use.',
    summary:
      'A Tool is three notes under tools/<name>/ — index.md (config + docs), ui.tsx and data.js (its source). ' +
      'tools/ is frozen for generic AI writes, so you must use the dedicated authoring loop, which writes ' +
      'under a human origin.',
    keywords: [
      ...kw('creat|build|make|add|write|new', 'tool|app|dashboard|widget|form|mini app|mini-app', 9),
      ...kw('tool', 'marketplace|publish|install', 6),
      ...kw('ui.tsx|data.js|tool-kit', '', 5),
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
      "Authoring needs the 'tools:author' scope. If create_tool refuses you, the connection was never granted it — reconnect asking for it rather than looking for another door; there is one server and every action is on it.",
      "That scope deliberately does not ride context:write: writing executable code into a space is not the same act as summarising notes.",
      'In ui.tsx only `react`, `react-dom` and `@visvine/tool-kit` are importable — every other import is refused at compile time.',
      'Do NOT try to write tools/**/*.md with edit_context; it is refused with "Tools are frozen for AI".',
    ],
    blockers: (ctx) => [...scopeBlocker(ctx, 'tools:author', 'authoring a tool'), ...featureBlocker(ctx, 'directory', 'tools')],
  },

  {
    id: 'create_space',
    when: 'Start a new space or a sub-space inside one — "create a space", "set up a workspace for X", "make a sub-space".',
    summary:
      'A space is a tenant: its own members, admins, context and tools. create_space provisions one and makes you ' +
      'its admin; with `parent_id` it is a sub-space of a space you administer. This is not add_context with ' +
      'type "space", which only records an organisation as a card in the directory.',
    keywords: [
      ...kw('creat|start|make|set up|spin up', 'a space|new space|sub-space|subspace|sub space|workspace|space called|space named', 10),
      ...kw('create_space', '', 10),
      ...kw('sub-space|subspace|sub space', '', 4),
    ],
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_spaces',
        why: 'For a sub-space: the parent\'s id, and `you_manage_it` — only an admin of the parent may create one inside it. A space that already has a parent cannot hold one.',
        args: {},
        optional: true,
      },
      {
        n: 2,
        tool: 'create_space',
        why: 'Provisions the space and makes you its admin. Returns `space_id` for every later call.',
        args: { name: '<name>', visibility: 'private', description: '<one sentence>' },
      },
      {
        n: 3,
        tool: 'create_space',
        why: 'A sub-space: the same call with the parent\'s id — the new top-level space_id from step 2, or one from step 1.',
        args: { name: '<name>', visibility: 'private', parent_id: ctx.space?.id ?? '<space_id of the parent>' },
        optional: true,
      },
    ],
    mustKnow: () => [
      'Spaces nest ONE level: a sub-space cannot hold sub-spaces, and personal spaces and the Visvine space cannot hold one. Sibling names must be unique.',
      "Visibility defaults to private. A public space's name must be unique among public spaces; a public sub-space's context is readable, view-only, from its parent under subspaces/<id>/.",
      "The creator administers a sub-space, not the parent's admins. Membership never crosses the boundary.",
      'A new space starts with every toggleable tool off. There is no action that deletes a space, so confirm the name before creating.',
    ],
    blockers: (ctx) => [
      ...scopeBlocker(ctx, 'context:write', 'creating a space'),
      ...(ctx.space && !ctx.space.you_are_admin
        ? [`You are not an admin of ${ctx.space.name}, so a sub-space inside it will be refused — a top-level space is still yours to create.`]
        : []),
    ],
  },

  {
    id: 'create_entity',
    when: 'Record a person, an organisation/company, or a link/document in the directory.',
    summary:
      'These three types — and only these three — are created with add_context, which makes the typed node ' +
      'AND its canonical context note in one step. The type decides the fields and where the note lives.',
    keywords: [
      ...kw('add|creat|record|register|new', 'person|people|contact|company|organisation|organization|founder|investor', 9),
      ...kw('add_context', '', 8),
      ...kw('add|save|bookmark|record', 'link|resource|document|article|url', 7),
      ...kw('directory|entity|entities', '', 3),
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
        why: 'Creates the node and its note together. person → people/<slug>/index.md, space (a record) → spaces/<slug>/index.md, resource → resources/<slug>/index.md.',
        args: { space_id: spaceId(ctx), type: 'person', name: '<Display name>', fields: { email: '<…>' }, body: '<markdown>' },
      },
    ],
    mustKnow: () => [
      'Use the exact field keys — email, companyName, linkedinUrl, url — they are what match an entity to its identity across spaces. An unrecognised key is silently dropped.',
      'A "space" type is a company/collective/investor recorded as a CARD in the directory. It never provisions a new space — starting a space or a sub-space is create_space (the `create_space` intent).',
      'Links between entities are never authored directly: a markdown link to an entity\'s note inside a SHARED note body is what creates the edge. Always use the leading-slash form — every tool hands back a ready-made `mention` string; paste it verbatim.',
      'Events are not created here — they are records with dates, RSVPs and a page of their own: use create_event (see the `run_event` intent). Channels and sections come from the space\'s admin surfaces.',
    ],
    blockers: (ctx) => scopeBlocker(ctx, 'context:write', 'creating an entity'),
  },

  {
    id: 'run_event',
    when: 'Put on an event — "create an event", "set up the launch night", "make an event from the plan in the drive", "write the marketing for it".',
    summary:
      'An event is a record with a date, a page, an RSVP form and a context note at events/<slug>.md. What makes ' +
      'this worth planning is that the material usually already exists: the poster, the run sheet and the brief ' +
      "are files in the space's Drive. Read them, then create the event FROM them — the picture becomes the " +
      'cover, the plan becomes the copy. It is created as a draft; publishing is a separate, deliberate step.',
    keywords: [
      ...kw('creat|set up|setup|plan|organis|organiz|run|host|schedul|make', 'event|meetup|launch|workshop|dinner|drinks|summit|conference|webinar', 10),
      ...kw('create_event', '', 10),
      ...kw('marketing|promo|invite|announcement', 'copy|material|blurb|post|email', 5),
      ...kw('rsvp|attendee|guest list|cover image|poster|flyer', '', 4),
      ...kw('event', '', 2),
    ],
    steps: (ctx) => [
      {
        n: 1,
        tool: 'list_drive',
        why:
          "The space's files, INCLUDING images — which carry no text and so never appear in list_files or " +
          'search_context. Note the `resource_id` of the picture and the `readable` path of the plan.',
        args: { space_id: spaceId(ctx) },
      },
      {
        n: 2,
        tool: 'read_file',
        why: "Read the run sheet or brief before writing anything — it is where the date, venue and the event's actual pitch come from.",
        args: { space_id: spaceId(ctx), path: '<the `readable` path from step 1>' },
        optional: true,
      },
      {
        n: 3,
        tool: 'create_event',
        why:
          'THE STEP THAT CREATES THE EVENT: the record, the page, the RSVP form and events/<slug>.md, in one call. ' +
          'Pass the picture as `cover_resource_id` and it becomes the poster. Created as a draft.',
        args: {
          space_id: spaceId(ctx),
          title: '<Title>',
          start_at: '<ISO 8601 instant>',
          location: { label: '<venue>' },
          description: '<the summary, drawn from the plan you read>',
          cover_resource_id: '<resource_id of a Drive image>',
        },
      },
      {
        n: 4,
        tool: 'edit_context',
        why:
          'Write the marketing copy where it belongs — a sub-note of the event, not a chat reply. Mentions in it ' +
          'link the event to the people and organisations involved.',
        args: {
          space_id: spaceId(ctx),
          path: 'events/<slug>/marketing.md',
          content: '<the copy — social posts, invite email, blurb>',
          visibility: 'inherit',
        },
      },
      {
        n: 5,
        tool: 'update_event',
        why: "Publish it once a human has read it back: status:'published'. Until then only its hosts and space admins can see it.",
        args: { space_id: spaceId(ctx), event_id: '<from step 3>', status: 'published' },
        optional: true,
      },
    ],
    mustKnow: () => [
      'A Drive image is used by `resource_id`, never by URL — create_event/update_event copy the bytes inside the space into the event\'s own image variants.',
      'Only an image can be a cover. A PDF poster has to be exported to PNG/JPEG and uploaded before it can be one.',
      'The event is a DRAFT until you publish it, and a draft is visible only to its hosts and space admins. Publishing at visibility:"public" puts it on the open web at /e/<slug> — never do that without being asked to.',
      'You become a host of anything you create, which is what lets you edit it afterwards with update_event.',
      'The marketing copy is a sub-note of the event folder (events/<slug>/marketing.md). Writing it there is what makes it part of the space\'s context instead of a one-off answer.',
    ],
    blockers: (ctx) => [
      ...featureBlocker(ctx, 'directory', 'reading the Drive'),
      ...scopeBlocker(ctx, 'context:write', 'creating the event'),
    ],
  },

  {
    id: 'find_context',
    when: 'Answer a question from what the space already knows — find, look up, summarise, "what do we know about X".',
    summary: 'Search is the entry point; read the hits you actually need. Everything reads through the visibility lens, so absence can mean "not visible to you".',
    keywords: [
      ...kw('what do we know|any notes on|context on|background on', '', 8),
      ...kw('find|search|look up|show me|tell me about|summar|list', '', 5),
      ...kw('what|who|when|where|why|how', 'do|does|did|is|are|was|were|much|many', 4),
    ],
    steps: (ctx) => [
      { n: 1, tool: 'list_spaces', why: 'Every other tool needs a space_id.', args: {}, optional: ctx.space !== null },
      { n: 2, tool: 'search_context', why: 'Ranked hits across the space, with each hit\'s lifecycle status reported so you know when what you found is stale or superseded.', args: { space_id: spaceId(ctx), query: '<terms>' } },
      { n: 3, tool: 'read_context', why: 'Full note, its entity, its sub-notes, and what it links to.', args: { space_id: spaceId(ctx), path: '<path from the hit>' } },
    ],
    mustKnow: () => [
      'Retired notes still rank, below current ones. Every hit reports its `status` — do not present a `stale` or `superseded` note as current, and follow `superseded_by` when it is set.',
    ],
    blockers: () => [],
  },

  {
    id: 'write_note',
    when: 'Record, update or append to a note in the space.',
    summary:
      'edit_context replaces a whole note; append_context adds to one. Read before you edit or you will clobber it. ' +
      "Every write lands in the named space's shared context; a new note is private to you and the admins until shared.",
    keywords: [
      ...kw('update|edit|revise|amend|append|add to', 'note|page|doc|context', 8),
      ...kw('edit_context|append_context', '', 8),
      ...kw('write|save|record|note|document|capture|log|jot', 'note|down|this|meeting|summary', 7),
    ],
    steps: (ctx) => [
      { n: 1, tool: 'read_context', why: 'edit_context is a FULL-CONTENT write. Read first or you overwrite what is there.', args: { space_id: spaceId(ctx), path: '<path>' }, optional: true },
      { n: 2, tool: 'edit_context', why: 'Write it. Pass visibility:"inherit" if it should be visible to whoever can see its folder.', args: { space_id: spaceId(ctx), path: '<folder>/<slug>.md', content: '<markdown incl. frontmatter>' } },
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
    keywords: [
      ...kw('share|unshare|permission|access|visib|private|restrict|who can see|grant', '', 8),
      ...kw('cannot see|can not see|not showing|missing|invisible', '', 4),
    ],
    steps: (ctx) => [
      { n: 1, tool: 'list_context', why: "Each folder's audience line, your own access level in it, and which folders are frozen for AI.", args: { space_id: spaceId(ctx) } },
      { n: 2, tool: 'edit_context', why: 'The `visibility` argument on a write is how a note\'s own visibility is set.', args: { space_id: spaceId(ctx), path: '<path>', content: '<unchanged content>', visibility: 'inherit' }, optional: true },
    ],
    mustKnow: () => [
      'connectors/ and models/ are admin-only to write, and so is any note declaring `type: connector` or `type: model` wherever it sits. agents/ and tools/ are frozen against AI writes entirely.',
      "subspaces/ is reserved and refused for everyone: it is a public sub-space's context, read into this one.",
    ],
    blockers: () => [],
  },

  {
    id: 'organise_context',
    when: 'Tidy up — find broken links, stale notes, duplicates, missing indexes.',
    summary: 'clean_context analyses read-only by default and can then apply its own fixes. Locked folders and out-of-scope notes are left alone.',
    keywords: [
      ...kw('clean|tidy|organis|organiz|audit|housekeep|dedupe|deduplicate|de-duplicate', '', 8),
      ...kw('broken link|stale note|duplicate|missing index', '', 7),
    ],
    steps: (ctx) => [
      { n: 1, tool: 'clean_context', why: 'Run the analysis first and read what it proposes.', args: { space_id: spaceId(ctx) } },
      { n: 2, tool: 'clean_context', why: 'Apply the fixes you agree with.', args: { space_id: spaceId(ctx), action: 'apply' }, optional: true },
    ],
    mustKnow: () => ['Frozen folders (agents/, tools/, and anything locked with "Freeze for AI") are never auto-fixed.'],
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
  keywords: [],
  steps: (ctx) => [
    { n: 1, tool: 'list_spaces', why: 'Every other tool needs a space_id.', args: {} },
    { n: 2, tool: 'list_context', why: "The space's folders, its entities, and the `types` catalog with per-type creation guidance.", args: { space_id: spaceId(ctx) } },
    { n: 3, tool: 'search_context', why: 'If the ask is a question rather than an action, this answers it.', args: { space_id: spaceId(ctx), query: '<terms>' }, optional: true },
  ],
  mustKnow: () => [
    'Visvine is note-first: connectors, agents and Tools are NOTES at fixed paths, not records behind a create_* API. If you are looking for a create_ tool and cannot find one, that is usually why — re-plan with a more specific prompt.',
  ],
}

// ── The catalogue ────────────────────────────────────────────────────────

/** Every shipped recipe, in catalogue order. */
export function allRecipes(): readonly Recipe[] {
  return RECIPES
}

/** The fallback recipe, offered when nothing matched confidently. */
export function orientRecipe(): Recipe {
  return ORIENT
}

export function recipeById(id: string): Recipe | null {
  if (id === ORIENT.id) return ORIENT
  return RECIPES.find((r) => r.id === id) ?? null
}

/**
 * A recipe rendered as the body of its note in that Context.
 *
 * Written against a GENERIC context — no space, every scope — on purpose. What
 * belongs in a note is what is true of the recipe itself; what is true of the
 * caller (their role, the space's features, the scopes their token carries) is
 * computed live by the gateway and shown beside it. Baking either into the note
 * would make the note wrong for everyone else who reads it.
 */
export function renderRecipeBody(recipe: Recipe): string {
  const ctx: RecipeContext = { space: null, scopes: ALL_SCOPES }
  const out: string[] = []
  out.push(recipe.summary, '')
  out.push('## When this is the right plan', '', recipe.when, '')
  if (recipe.intake) out.push('## Ask first', '', renderIntake(recipe.intake), '')
  out.push('## Steps', '')
  for (const step of recipe.steps(ctx)) {
    out.push(`${step.n}. **${step.tool}**${step.optional ? ' _(optional)_' : ''} — ${step.why}`)
    if (Object.keys(step.args).length > 0) {
      out.push('', '   ```json', ...JSON.stringify(step.args, null, 2).split('\n').map((l) => `   ${l}`), '   ```')
    }
    out.push('')
  }
  const must = recipe.mustKnow(ctx)
  if (must.length) {
    out.push('## What decides whether this works', '')
    for (const line of must) out.push(`- ${line}`)
    out.push('')
  }
  const blockers = recipe.blockers?.(ctx) ?? []
  if (blockers.length) {
    out.push('## Refusals to expect', '')
    for (const line of blockers) out.push(`- ${line}`)
    out.push('')
  }
  if (recipe.contract) {
    out.push('## The contract', '', '```', recipe.contract, '```', '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The scopes a generic rendering assumes: all of them, so a shipped note never
 *  hard-codes a refusal that only applies to one caller's token. */
const ALL_SCOPES: readonly string[] = [
  'context:read',
  'context:write',
  'connectors:use',
  'agents:run',
  'tools:author',
  'tools:install',
  'secrets:write',
]

/** Read the feature flags the recipes reason about off a space's config. */
export function planFeatures(config: SpaceFeatureConfig | null | undefined): Record<string, boolean> {
  return Object.fromEntries(
    ['directory', 'connectors', 'channels'].map((key) => [
      key,
      isFeatureEnabled(config, key),
    ]),
  )
}
