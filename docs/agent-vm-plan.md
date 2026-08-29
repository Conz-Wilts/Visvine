# The agent system, rebuilt on a computer

A plan for replacing the current agent runtime with one where an agent has a
real machine: browser, filesystem, terminal, persistent state, and a window a
human can watch it through. Written to be built from scratch. Where that means
retiring code we already shipped, it says so and says why.

The bar: **anything a person could do at a laptop, an agent in this space can
do, a human can watch it happen live, and a human can teach it a task once and
have it stay learned.**

---

## 1. Verdict on the rewrite

This is not an extension of `lib/agents`. It is a new runtime that reuses the
platform underneath it. Honest accounting:

### Kept, unchanged

| What | Why it survives |
|---|---|
| `lib/actions/*` — registry, `runAction`, scope gate, Zod contracts | The action surface is the correct abstraction. The VM becomes a *caller* of it, not a replacement. |
| `lib/mcp/*` — one endpoint, one tool, OAuth 2.1, scopes | Same. A VM-hosted agent authenticates as a principal like any other client. |
| `lib/notes/*` — the whole context model | Skills, briefs and agent identity are notes. This is the premise of the product and the plan leans harder on it, not less. |
| `lib/connectors/perimeter.ts` | Becomes the shared contract between two enforcers instead of one. See §5. |
| `lib/connectors/isolate.ts` + `hostFetch/hostSql/hostMcp/marshal` | The fast path stays. HTTP-shaped work does not go near a VM. |
| Auth, spaces, grants, `resolveContext` | Untouched. A VM never gets to decide who someone is. |

### Rewritten

| What | Replaced by |
|---|---|
| `lib/agents/runner.ts`, `dispatch.ts`, `route.ts`, `service.ts` | A new `lib/vm/` control plane + an in-VM agent process. The current in-request runner cannot host a long-lived machine. |
| `lib/agents/sandbox.ts` | Deleted. The sandbox is now the VM, and it is rented. |
| `lib/agents/tools.ts` | Replaced by code mode (§6). Tool schemas stop being the interface. |
| `lib/agents/schedule.ts`, `budget.ts`, `limits.ts` | Rebuilt against VM leases rather than per-run token counts. Concepts survive, shapes change. |
| `AgentState` / `AgentRun` / `AgentEvent` / `AgentHeartbeat` | Superseded by the schema in §13. `AgentEvent` is closest to surviving — it becomes the window's event stream. |

### Retired

- The per-run ephemeral execution model. An agent is now a **resident**, not a function call.
- Tool-schema-per-capability prompting. See §6.
- Anything that assumed the agent runs inside a Cloud Run request lifetime.

**Estimate:** the control plane, the in-VM runtime and the window are ~all new.
The platform they sit on — actions, notes, auth, connectors, spaces — is ~all
reused. Call it a rewrite of the agent layer and a zero-line change to the
substrate. That is the right ratio, and it is only available because the action
registry was built the way it was.

---

## 2. The shape

Eight planes. Each is independently buildable and independently testable.

```
┌─ Control plane ────────── lib/vm/*  (Next.js, Cloud Run)
│    lease, boot, reap, quota, policy — every decision is made here
│
├─ Edge ────────────────── apps/agent-edge   (Workers + Durable Objects)
│    owns the container, enforces the policy, relays the window
│
├─ Substrate ───────────── rented sandboxes (Cloudflare; Vercel second)
│    container-in-a-VM. We do not build this.
│
├─ In-VM runtime ───────── the agent process, inside the machine
│    loop, code mode, skills, tools, screen, recorder
│
├─ Egress plane ────────── deny-by-default network + our outbound handler
│    two enforcers, one contract; nothing else reaches the internet
│
├─ Storage ─────────────── R2: the space's /workspace, and per-agent backups
│    the disk is ephemeral, so this is where durability lives
│
├─ Surfaces ────────────── /agents in the web app
│    the window, the timeline, approvals, teaching, skills
│
└─ Identity ────────────── existing auth + a new agent principal type
     the VM never holds a long-lived human credential
```

---

## 3. The machine

### Substrate

Rent. Manus rents E2B; Nous's Hermes ships seven pluggable backends and owns
none of them. Nobody credible hand-rolls Firecracker for this.

One implementation to start, behind an interface, with the second kept
implementable:

```ts
// lib/vm/substrate/types.ts
interface Substrate {
  create(spec: VmSpec): Promise<VmHandle>
  resume(id: string): Promise<VmHandle>
  sleep(id: string): Promise<void>       // back up, stop the container, stop billing
  destroy(id: string): Promise<void>
  exec(id: string, cmd: Exec): Promise<ExecResult>
  stream(id: string, kind: 'screen' | 'term' | 'events'): AsyncIterable<Frame>
}
```

**The choice is Cloudflare Sandboxes, with Vercel Sandbox as the second
implementation.** The gate was the one hard requirement — can all egress be
pinned through policy we control — and Cloudflare answers it with a mechanism
nobody else offers: the policy runs as **our own Worker**, on the same machine
as the sandbox, holding our bindings and our secrets.

| | Cloudflare Sandboxes | Vercel Sandbox | E2B |
|---|---|---|---|
| Isolation | container in its own VM | Firecracker microVM | Firecracker |
| Billing | **active CPU**, provisioned memory/disk | **active CPU**, provisioned memory | wall-clock |
| Rate | $0.072/vCPU-h active, $0.009/GiB-h, $0.00025/GB-h disk | $0.128/vCPU-h active, $0.0212/GB-h | $0.0504/vCPU-h + $0.0162/GiB-h |
| Egress out | $0.025/GB, 1 TB included | $0.15/GB | — |
| Shapes | fixed types to 4 vCPU / 12 GiB (custom, ≥3 GiB per vCPU) | 1–8 vCPU, 2 GB per vCPU | flexible |
| Idle | `sleepAfter`, default 10 min | stop + snapshot | `onTimeout: 'pause'` |
| Disk on sleep | **ephemeral — fresh from the image** | snapshot, auto-resume | preserved |
| Persistence | R2 via FUSE mount, plus SDK backups (COW overlays in R2) | automatic snapshots | snapshots |
| Egress policy | **our Worker on the path**, allow/deny/intercept, changeable at runtime | platform rules + `forwardURL` to our proxy | proxy with transforms |
| Secret injection | in our Worker — `env` the sandbox never sees | header `transform` | not shipped |
| GUI | build it into the image | build it into the image | E2B Desktop |

Cost is the smaller half of the case — about 25% under Vercel at the same
workload, which on a single agent is two dollars. The structural half is §5.
Everywhere else, the forced-proxy story is *their* enforcement of *our* list:
we hand over a policy and trust it is applied. Here the enforcement point is a
Worker we write. Allow, deny, rewrite, log, raise an approval, inject a
credential — all of it is ordinary code with access to our bindings, evaluated
per request, changeable on a running sandbox with `setOutboundHandler` /
`setOutboundByHost`. The egress plane stops being a service we operate beside
the platform and becomes a function.

Three things we take on knowingly, each with its answer:

- **The disk is ephemeral.** A sleeping container wakes with a fresh disk from
  its image. So durable state is explicit rather than assumed: `/workspace` is
  archived to R2 before the machine sleeps and unpacked again when it next
  starts, under the SPACE's prefix. Nothing lives only on the local disk, and
  the rule an agent has to hold is simply "keep it in `/workspace`".

  The runtime's own directory snapshots would be cheaper and are refused on this
  account — *"the container does not meet the required snapshot prerequisites"* —
  so the archive is what actually works. It is also the more durable of the two:
  an archive in R2 survives the machine being destroyed and rebuilt, which a
  snapshot bound to a container does not.
- **Shapes are fixed and cap at 4 vCPU / 12 GiB.** `standard-3` (2 vCPU, 8 GiB,
  16 GB disk) is the agent default and `standard-4` is the ceiling. That is
  enough for Chromium and a model loop, and it is a hard ceiling: anything
  needing more is a job for the isolate or a queue, not a bigger machine.
- **The GUI is ours to build.** Browser Rendering is the managed alternative and
  it is the wrong shape here — it dispatches from the parent Worker, outside the
  sandbox and outside the egress policy, and there is no desktop for a human to
  take control of. So the image carries Chromium under Xvfb with a frame server,
  the same as the Vercel path would have. Its traffic is ordinary HTTPS on 443,
  so it goes through the outbound handler like everything else.

**Where the code runs.** This adds a second deployment target: a small
Cloudflare Worker + Durable Object app (`apps/agent-edge`) that owns
sandboxes, hosts the outbound handlers and relays the window (§9). The Cloud Run
control plane stays the brain — it holds the rows, resolves principals and
decides policy — and calls the edge over an authenticated internal boundary. The
split is worth naming precisely: **the edge never decides anything.** It boots
what it is told to boot and enforces the policy it is handed; every question of
who may do what is answered in Postgres by the same code that answers it for the
web app.

**Quotas to design against, not discover:** 1,500 concurrent vCPU, 6 TiB
concurrent memory, 30 TB concurrent disk and **50 GB total image storage** per
account — that last one is the tight one, and it is why there is one agent image
rather than one per space. Durable Object subrequests cap at 1,000 per request,
which an agent loop would spend quickly over HTTP transport; use the SDK's RPC
transport, which multiplexes over one connection. Containers take no inbound TCP
— everything arrives through a Worker — which is fine, because §9's transport is
a WebSocket through exactly that Worker.

### Image

One `linux/amd64` OCI image, versioned, built in CI and booted by digest — never
by `latest`, so a run is reproducible and a skill can say what it was taught
against:

- Node 22 (Debian) base, an `agent` user, `/workspace` restored from R2 at boot
- Chromium + Playwright, Xvfb, and a frame server on a port the Worker fronts (§9)
- Node 22, Python 3.12, `uv`, `pnpm`, ripgrep, ffmpeg, poppler, imagemagick
- The **agent runtime** itself (§6), installed as a system service
- No cloud CLIs with ambient credentials. Nothing pre-authenticated.

Two constraints shape it. **Image storage is 50 GB for the whole account** and
an image may not exceed its instance type's disk (16 GB on `standard-3`), so
there is one agent image and it stays lean — a per-space or per-agent image is
not a thing this platform can afford. And **the local disk is a cache, not
storage**: everything the image writes is gone at the next sleep, so the runtime
treats `/workspace` (R2) and its backup as the only durable places and never
`/tmp`, `/home` or an installed package. A skill that `apt-get install`s
something is a skill that reinstalls it every wake, which is a reason to fold
what it needs into the image instead.

Image digest is recorded on every run. A skill records the digest it was taught
against, so we can tell when a skill breaks because the world moved.

### Lifecycle — the part Cloud Run makes hard

Our runtime scales to zero and is N processes. A VM is exactly the long-lived
state we've banned from memory. So the lifecycle lives in **rows**:

- `agent_vm` holds the lease: substrate name, state, `expires_at`, `asleepAt`.
- A Cloud Scheduler job hits `/api/internal/vm/tick` (OIDC-pinned, same pattern
  as the agent tick and nightly sweep) every 60s. It reaps expired leases,
  wakes the ones with queued work, and enforces the space's quota.
- Nothing in the web process holds a VM handle across requests. Every request
  re-derives it from the row.

The substrate's own model lines up with that. A sandbox is addressed by a name —
`vm-<spaceId>-<agentSlug>`, derived and never stored as truth, because the row is
truth — and each name resolves to a Durable Object that owns that agent's
container. `sleepAfter` is the platform's own idle timer and defaults to the ten
minutes we wanted, so the tick is not what stops an idle machine; the platform
is. The tick's job is the part the platform has no opinion about: reaping dead
leases, resuming for queued work, and enforcing the space's quota.

**Idle policy:** sleep after 10 minutes idle, and **the disk is gone at that
moment**. That is the design's central discipline rather than a footnote — the
`onActivityExpired` hook takes the backup before the container stops, and the
runtime has already written anything that matters to `/workspace`. Destroy the
lease after 14 days idle: the backup is deleted, the R2 workspace is not, because
the workspace belongs to the space and outlives every agent that touched it.

**A wake is a fresh boot, so it costs seconds and it must be idempotent.** The
runtime restores its checkpoint from `/workspace/.agent/`, remounts R2, restarts
the frame server and re-reads the run queue. Nothing may assume it is the same
process that queued the work — which is the same assumption Cloud Run already
forbids, applied one layer down. A run that spans a sleep is one run in the
timeline with a `session_rotated` event in it, and the window shows the wake
rather than hiding it.

### The persistence model — one machine per what?

This is the single most consequential decision in the plan, and it is where
Grok Bot made a choice we should not copy.

Grok Bot gives **one persistent computer per account**, shared by all of a
user's bots. Their own docs: *"The screens are separate work surfaces, not
separate security boundaries"* and *"Do not use separate Bots as a security
boundary."* All bots share one browser, one cookie jar, one set of CLI
credentials. That buys frictionless handoff and costs you any ability to
contain a compromised agent.

We are multi-tenant. That trade is not available to us.

**Our rule: one VM per (space, agent, environment). The space is the security
boundary, the agent is the authorization boundary, and a machine crosses
neither.**

Why the agent and not the space, when a machine per space would be cheaper:
**an agent acts as its author**, so two agents in one space can have different
reach. Sharing a machine would share the browser profile and every logged-in
session on it, which hands agent B the sessions agent A's author established —
a grant nobody made. The boundary a machine is drawn on has to be the boundary
authorization is drawn on, and here that is the agent.

Why not per USER, which is what a chat-shaped product would do: the agent does
not act as the person who triggered it, so a per-user machine would put one
human's sessions behind whatever agent they woke. That is Grok Bot's shared
cookie jar with extra steps.

Why the environment is in the identity: production and a developer's laptop
share one edge and one bucket, and a machine is addressed by name. Without it, a
local test of a space id that also exists in production stops that production
machine and overwrites its workspace. The control plane decides the environment
and sends it; the edge never guesses.

The cost of per-agent is real and bounded: a machine is leased lazily — an agent
that never runs a command never has one — and sleeps after ten idle minutes, so
the bill is awake time rather than agent count. A space with five agents that
each work an hour a day is about $15 a month, not five machines' worth of
idling.

- Two agents in the same space are two VMs. They hand off through the
  **workspace volume** and the **context store**, not through a shared machine.
- A shared, space-scoped `/workspace` volume mounts into every agent VM in that
  space — that is where handoff artifacts live, and it inherits the space's
  existing grants.
- Browser profiles and connected-app sessions are **per agent**, and are
  encrypted at rest under the existing key ring (`lib/crypto/secrets.ts` — and
  yes, any new ciphertext column goes into `scripts/rotate-secrets-key.ts` or
  the next rotation strands it).
- A personal agent gets a VM scoped to the personal context, which already
  bypasses the grant model.

We lose Grok Bot's "log in once, every bot inherits it." We gain the ability to
say what a given agent can reach. For a platform holding other people's
relationship data that is not close.

---

## 4. Identity: what the agent *is*

An agent is a note plus a principal.

- `agents/<name>/index.md` — the identity document. Name, purpose, tone,
  standing instructions, which connectors it may use, which channels it answers
  on, its schedule. Editable by admins, versioned like any note. This is the
  brief, and it survives from the current system conceptually.
- A **principal** resolved on every action call through `lib/actions/resolve.ts`
  — unchanged. The agent acts as itself, with its own grants, never as the
  human who triggered it. An agent's reach is the intersection of its grants
  and the scopes on its token.
- `agents/<name>/skills/` — what it has been taught (§7).
- `agents/<name>/memory.md` + the memory store (§8).

The VM holds a **short-lived** token (≤15 min, refreshed by the control plane
over the edge). It never holds a 30-day JWT. If a VM is compromised, the
blast radius is fifteen minutes of that agent's grants, not a month of a human's.

---

## 5. Egress: the actual security boundary

Once there is a real network stack in the machine, `hostFetch.ts` stops meaning
anything. Every serious system landed on the same answer independently:
Anthropic's managed sandbox runs gVisor with three-layer egress control and a
JWT-authenticated proxy doing TLS inspection. We do the same.

**Build the egress plane before the first VM boots.** Not after.

Two enforcers, and the split is deliberate. The **container network** decides
whether a connection happens at all — it is below the sandbox, it cannot be
disabled from inside, and with `enableInternet = false` it fails closed. The
**outbound handler** decides what a request is allowed to do, because that
judgement needs the space, the agent, the run and the approval queue. The second
one is our own Worker, which is the whole reason this substrate was chosen.

```
container, enableInternet = false      ← nothing but 80/443 and DNS exists
  ├── port ≠ 80/443                    → no route, ever
  ├── HTTP  → interceptAllOutboundHttp → our Worker  (catch-all)
  └── HTTPS → interceptOutboundHttps   → our Worker  (per allowed host)
        ├── sandbox name → agent_vm row → (space, agent, run)
        ├── deny list, then allow list  (lib/vm/policy.ts, pure)
        ├── SSRF + private-range checks (lib/connectors/perimeter.ts)
        ├── inject credentials from env — never visible to the sandbox
        ├── approval-required? → pause the run, raise it (§12), hold the request
        ├── log to agent_egress_log
        └── fetch() upstream
```

The handler runs in the Workers runtime, on the same machine, outside the
sandbox's world. It needs no token to prove who it is talking about, because
it *is* the egress path for exactly one agent's container — identity is
structural rather than asserted, which is a stronger property than the signed
header the previous design leaned on.

Policy is compiled by us from four layers, most specific wins, and applied
per request rather than baked in at boot:

1. **Platform denylist** — private ranges, metadata endpoints, our own internal
   API. Evaluated first and never overridable, because deny always precedes
   allow.
2. **Space policy** — `hosts:` from the space's connector notes, plus an
   explicit VM allowlist in space settings.
3. **Task policy** — a run may narrow further, never widen. `setAllowedHosts`
   and `setOutboundByHost` change a *running* sandbox, so a run that fetches its
   inputs wide and then processes them narrow is one machine and two policies.
4. **Approval-required set** — payment processors, bulk-send endpoints, and
   anything an admin flags. The handler holds the request while the approval is
   raised, and the agent sees a slow call rather than a failure.

### What the boundary does not do

Each of these is a real hole, and each has a rule that closes it. They are
written down because the failure mode is believing the allowlist is total.

- **Only ports 80 and 443 reach an outbound handler.** Raw TCP and UDP are never
  intercepted. The rule that closes it is `enableInternet = false` on every
  sandbox, always — in that mode nothing but 80, 443 and DNS is routable at all,
  so uninspectable traffic has nowhere to go. A sandbox booted without it is a
  sandbox with an unpoliced network, so the boot path asserts it and the tick
  refuses a lease whose policy hash says otherwise.
- **An empty allow list means "allow everything", not "allow nothing."** This is
  the inverse of the safe direction and the single most dangerous default in the
  stack: a bug that drops the allow list produces an open agent, not a dead one.
  So the compiler never emits an empty allow list — it emits an explicit deny —
  and the handler treats an empty list as deny with a `logger.error`, because at
  that point something upstream is broken.
- **DNS is Cloudflare's resolver in restricted mode**, which closes the
  DNS-tunnelling exfiltration path that a customer-chosen resolver would open.
  It also means a private-network hostname cannot be resolved at all — a
  property worth keeping rather than working around.
- **The managed browser bypasses all of this.** Browser Rendering dispatches
  from the parent Worker, not from the sandbox, so its traffic never reaches an
  outbound handler. That is precisely why the agent's browser is Chromium inside
  the image: its requests are ordinary HTTPS from the sandbox and are policed
  like everything else. Nothing in the agent path may call Browser Rendering.
- **The handler is code, so it can be wrong.** The proxy fleet it replaces could
  only be misconfigured; a Worker can also be miswritten. It gets the treatment
  §17 gives the policy compiler: pure functions, exhaustive refusal tests, and a
  red-team suite that runs against a real sandbox.
- **HTTPS is intercepted per HOST, not as a catch-all.** Only the hosts the
  policy names are routable at all; everything else has no route and fails
  closed before it can even be refused. The corollary is that a **wildcard grants
  nothing over HTTPS** — there is no host to register — so a space's connectors
  should name the hosts they actually use. Plain HTTP is a catch-all and is
  refused by the handler, which is how a request to an address literal shows up
  as a denial rather than as silence.
- **TLS is terminated, so the machine must trust the interception CA.** It is
  mounted at run time and cannot be baked into the image, so the entrypoint
  installs it on every boot — and waits for it, because the mount and the
  entrypoint race. A machine that misses it reads every allowed host as a
  certificate failure.

Two honest notes that survive the substrate change:

- Anthropic documents that in limited-networking mode the effective scope still
  includes platform infrastructure hosts beyond the configured allowlist. Ours
  does too — the sandbox must reach the edge, the control plane and the
  substrate's own infrastructure. Document those hosts explicitly rather than
  pretending the allowlist is total.
- General web browsing means a broad allowlist. For a research task that is the
  point. The mitigation is not a narrower list, it's §12: the agent can read the
  web widely and cannot *act* on what it read without a gate.

### Secrets

Plaintext never enters the VM.

- Agent needs an API call to a connected service → it calls the **connector
  action** through our API, which runs on the isolate, host-side. The VM sees
  the response, never the key. This is why the isolate stays.
- Agent needs to be *logged in* to a website in the browser → session cookies,
  written by a human during a takeover (§12), stored encrypted, injected into a
  per-agent browser profile at boot. Never a password typed by the model.
- Agent needs to call a service the isolate has no reason to wrap — a package
  registry, a git remote, an API a skill discovered — → **credential injection in
  the handler**. The header is set in the Worker, on requests matching a path/method
  matcher we set, and the key lives in the Worker's `env` — a binding the sandbox
  has no access to. The VM cannot read it, and neither can anything the VM
  downloaded. Rotating it in `env` takes effect on the next request, with nothing
  to redeploy inside the machine.
- Anything the model does receive is redacted on the way out through the
  existing `marshal.ts#redactDeep` walk, applied to the transcript and to
  window frames.

The rule underneath all three: **a secret is a property of the policy, never of
the machine.** A VM that is backed up, woken, forked or seized carries no
plaintext, because there was never any in it to carry.

---

## 6. The loop: code mode

Do not hand the model a hundred tool schemas. Hermes carries 70+ tools across
28 toolsets and that is already past the point where schema-picking degrades.
The converged 2026 answer — Cloudflare, Anthropic and others arriving at it
independently — is that the model **writes code** against a typed API instead of
emitting tool calls. Reported 98–99% token reduction and better accuracy,
because models have seen vastly more real code than synthetic tool calls.

We are unusually well positioned: `GET /api/actions/<name>` already regenerates
its contract from the Zod schema on every sync. That contract is a type
definition waiting to happen.

**In the VM:**

```
/opt/visvine/api/          generated TypeScript, one module per action
  context.ts               search_context, edit_context, list_files…
  drive.ts                 list_drive, …
  events.ts
  connectors.ts            run_connector — still the isolate, host-side
  index.d.ts
/opt/visvine/skills/       mounted from agents/<name>/skills/
/workspace/                the space volume
```

The agent writes and runs TypeScript. `import { search_context } from
'@visvine/api'` becomes an authenticated call to `/api/actions/search_context`
over the edge, with the agent's short-lived token, through `runAction` — same
registry, same scope gate, same Zod validation as every other door. **No new
authorization path exists anywhere in this plan.**

Discovery is filesystem-shaped, not preloaded: the agent lists `/opt/visvine/api`,
reads the one module it needs, writes code. Same as it discovers skills.

Native capabilities alongside the API — browser (Playwright), shell, files,
HTTP through the proxy — are just the machine, available the way they'd be to a
person.

### The turn

```
observe → plan → write code → execute → observe result → repeat
```

One action per iteration against the current context, the Manus shape. Every
step emits an event to the stream (§9) whether or not anyone is watching.

Model: the space's model connector (`kind: model`, existing
`lib/agents/providers.ts` resolution). Unchanged — and `loadConnector` still
refuses to run model connectors as HTTP connectors, for the reason it always
did.

---

## 7. Teaching it a task

The feature you asked for, and the one that compounds. Hermes made the learning
loop first-class: complete a task, write a reusable skill file, attach it to a
cron job or a conversation. Skills live on the filesystem, so the agent can
*read* them to understand and *write* them to improve.

We already believe notes direct agents. A skill is a note.

`agents/<name>/skills/<slug>/`
```
index.md      what it does, when to use it, keywords, preconditions
steps.md      the procedure in prose
run.ts        optional — the executable version, if it generalised to code
fixtures/     selectors, screenshots, sample inputs
```

### Four ways to teach

**1. Demonstrate.** Human opens the window, takes control (§12), does the task
by hand. The recorder captures the trace — URLs, clicks, selectors, typed values
(redacted), files touched, terminal commands. On finish, the agent watches the
replay and *writes the skill*, in its own words, with its own generalisations.
Human reviews the draft as a diff. This is the headline interaction: **do it
once with the agent watching.**

**2. Correct.** Agent runs, gets it wrong, human intervenes mid-run. The
intervention is captured as a delta against the existing skill and proposed as
a revision. Skills improve by being wrong in front of someone.

**3. Describe.** Human writes `steps.md` in prose. It is a note. It works
immediately, badly, and improves via (2).

**4. Self-capture.** Agent completes a novel multi-step task successfully and
proposes a skill unprompted. Lands pending.

### Governance — reuse what exists

Skills are versioned, and publishing one is **exactly the shape as Tools**:
a member's publish lands `pending` and notifies admins; an admin's publish
lands approved because they are the approver; a re-publish supersedes the
author's earlier pending submission rather than being refused. `/agents` grows
an approvals tab, the same as `/tools?tab=approvals`.

A skill declares the connectors and hosts it needs. Approving a skill is
approving that reach. **A skill is advice, never authorization** — every step
still runs through `runAction`, so a wrong or malicious skill costs a refusal,
never an escape. That property is inherited from recipes and must not be
weakened here.

### Selection

Same mechanism as recipes: weighted term overlap over each skill's `keywords:`
(`lib/actions/shared/match.ts`), pure and deterministic. Keywords rather than
patterns, so a skill survives the YAML round trip and nothing ever compiles a
pattern supplied by content. Matched skills are read into context at turn
start; the agent may `read` any other.

---

## 8. Memory

Three tiers, and two of them already exist.

1. **Working** — the run transcript, compressed with lineage tracking so a
   compressed session keeps a parent pointer (Hermes's shape; worth copying).
2. **Durable facts** — `context_memories`, the derived-memory tier we already
   built. The nightly sweep extracts self-contained claims from notes; the agent
   writes its own observations into the same store, attributed to the agent and
   the run. Retrieval is `fusedSearch`, unchanged.
3. **Procedural** — skills. §7.

The distinction that matters: **facts go to memory, procedures go to skills.**
Conflating them is why agents that "remember everything" still can't repeat a
task.

Plus the machine itself: `/workspace` files, browser sessions, installed
packages. Grok Bot's line is the right guidance to give users — durable project
files in `/workspace`, and treat temp dirs, hand-installed packages and
uncommitted state as replaceable.

---

## 9. The window

You asked to see what the agent is doing. This is the spec.

**Route:** `/agents/<name>/live` — and embedded as a pane wherever an agent run
is referenced, using the existing pane shell.

### Four synchronized views

```
┌────────────────────────────────┬──────────────────┐
│                                │  TIMELINE        │
│         SCREEN                 │  ▸ read note     │
│   live desktop / browser       │  ▸ wrote code    │
│   ~10fps, WebRTC or JPEG       │  ▸ ran it  ✓     │
│                                │  ▸ opened gmail  │
│                                │  ⏸ approval      │
├────────────────────────────────┤     needed       │
│  TERMINAL          │  CODE     │                  │
│  live stdout       │  what it  │  [Take control]  │
│                    │  just     │  [Pause] [Stop]  │
│                    │  wrote    │                  │
└────────────────────┴───────────┴──────────────────┘
```

- **Screen** — the VM's display. WebRTC where the substrate offers it, JPEG
  frames over WebSocket as the floor. ~10fps while watched, **0fps when nobody
  is looking** — this is a cost line, not a nicety. Full res on demand.
- **Terminal** — streamed stdout/stderr, scrollback in the run record.
- **Code** — the TypeScript the model just wrote, syntax-highlighted, with its
  result. This is the most legible view of intent and often the only one worth
  watching.
- **Timeline** — the semantic event stream. Every step: what it decided, what it
  called, what came back, how long, what it cost. Filterable, permalinkable,
  and **the durable record** — the screen is ephemeral, the timeline is stored.

### Transport

The broker is **the agent's own Durable Object** in `apps/agent-edge` — the
same object that owns its container. Cloud Run scaling to zero is wrong for
long-lived sockets, and a DO is the opposite: one addressable, single-threaded
object per agent, awake exactly while someone is connected, holding the
browser↔container relay and the container↔control-plane channel. It is also
where the outbound handler already runs, so the socket, the policy and the
lease live in one place instead of three.

Frames never travel browser-to-container directly — a container takes no inbound
TCP, so there is nothing to expose even by accident. The image runs a frame
server on a local port; the DO fronts it, fans out to whoever is watching, and
authorizes each viewer on connect: session cookie, then the agent's space, and
the socket drops on grant revocation. Viewers hold a socket to us, never to the
machine.

The same channel carries the reverse direction during a takeover (§12): input
events in, frames out, with the control plane recording that a human held the
keyboard for that span. And it is the channel the control plane refreshes the
agent's short-lived token over, which is why there is one connection and not
three.

One thing this buys that the previous design could not: **frames cost almost
nothing when nobody watches**, because the DO hibernates and the frame server
is told to stop. Egress at $0.025/GB with a terabyte included makes watching
cheap enough that we can afford to leave the timeline always-on and stop
rationing the thing people actually want to look at.

### Replay

Every run is replayable from the timeline, with screen frames sampled at 1fps
and retained per the space's retention setting. This is what makes an agent
auditable, and it is what powers teaching-by-correction — you scrub to where it
went wrong and fix from there.

### Cost honesty

Streaming is not free. Frames only while watched; timeline always. A run that
nobody watched is still fully reviewable after the fact from code + terminal +
timeline, just without video.

---

## 10. Always-on: channels and schedules

Grok Bot's actual pitch is that work continues after you close the laptop. That
requires three things, none of which is the VM.

**Schedules.** Cron per agent, in `agents/<name>/index.md`. Fired by Cloud
Scheduler → `/api/internal/agents/tick` → control plane resumes the VM and
queues the run. Existing pattern, existing OIDC auth.

**Channels.** Hermes runs one long-lived gateway across 25+ platform adapters
with unified session routing, allowlists and DM pairing. We don't need 25.
Start with three and make the adapter interface real:

- **In-app** — the agent pane. Ships first.
- **Email** — inbound address per agent, `<agent>@<space>.visvine.com`.
- **Slack** — the "watcher" pattern, an agent that reads a channel and acts.

Adapter interface: `{ receive → normalized message, send, authorize }`. One
session router, one authorization model, one agent loop behind all of them —
Hermes's three-entry-points-one-loop discipline is the thing to copy, not the
adapter count.

**Triggers.** Webhooks (we have `webhookInbound.ts`), context events (a note
changed, an entity was created), connector events. Same queue as everything else.

---

## 11. Teams

Grok Bot: an executive assistant that hands to an AI engineer the moment a
request turns technical, without the user switching windows. Right idea.

- **Handoff is an action.** `delegate({ agent, task, workspace_path })` — in the
  registry, scoped, logged, appears on both timelines.
- Handoff moves **artifacts and context**, not credentials or sessions. Agent B
  gets the files and the brief. It does not get A's browser.
- Depth capped at 2 to start. An agent may delegate; the delegate may not.
- Routing is keyword match over each agent's `keywords:` in its identity note,
  same deterministic mechanism as recipes and skills. One mechanism, three uses.

---

## 12. Approval, takeover, and the thing nobody has solved

OpenAI's public position after shipping Atlas and the ChatGPT agent: prompt
injection is *"unlikely to ever be fully solved."* They ship logged-out mode,
confirmation before sensitive steps, Watch Mode requiring an active tab, an
adversarially trained model, and monitoring. That is the state of the art —
mitigation, not proof. Build accordingly, and never tell a user otherwise.

### Approval gates

A run pauses and raises an approval for:

- Any egress hitting the approval-required policy set
- Spending money, sending to >N external recipients, deleting anything
- First-ever use of a connector by this agent
- A skill executing outside its declared reach
- Anything an admin flags

Approval lands in the window, in-app notification, and the agent's channel.
Times out to denied. Every approval is recorded with who, when, and what the
agent had read up to that point.

### Takeover

The button that makes the whole thing usable. Click **Take control** and the
window becomes an interactive session — real mouse and keyboard into the VM.

- Log in to a site, clear an MFA prompt, solve a CAPTCHA, verify a payment.
  Grok Bot requires the human for exactly these, and so do we.
- Credentials typed during takeover go through a **secure input** that never
  enters the transcript, never reaches the model, and is stored as a session
  cookie under the key ring. Grok Bot's own guidance is to never paste secrets
  into chat; we enforce it structurally instead of advising it.
- The agent is paused and *watching*. On release it reads the trace and
  continues — which is also mechanism (1) of §7. Takeover and teaching are the
  same code path.

### Injection posture

- **Content read from the web is data, never instruction.** Fenced and labelled
  in the transcript, the way we already treat untrusted artifact and comment
  content.
- Reading widely is fine; *acting* on what was read crosses the approval gate.
  This is the load-bearing containment, not the allowlist.
- The egress log is the detection surface. Anomalous destinations, exfil-shaped
  payload sizes, and repeated denials all raise. `logger.error()` for genuine
  faults, `warn` for the policy working as designed — a policy denial is the
  system working, and routing it to error reporting buries real failures.
- Red-team suite in CI: injected pages, hostile PDFs, poisoned notes, a
  malicious skill. Same discipline as `tests/connector-isolate.test.ts`'s escape
  battery, which is the model for how seriously to take this.

---

## 13. Schema

Tables named after the tool that owns them, per convention.

```prisma
model AgentVm {              // agent_vms
  id            String
  spaceId       String
  agentSlug     String
  substrate     String       // 'cloudflare' | 'vercel' | …
  substrateName String       // the sandbox name — how a row addresses a machine
  instanceType  String       // 'standard-3' — the shape, not a request
  imageDigest   String       // booted by digest, never by tag
  state         String       // provisioning|running|asleep|reaping|unavailable|dead
  policyHash    String       // the compiled policy this session is being held to
  workspaceKey  String       // R2 prefix for the SPACE's shared volume
  backupKey     String?      // last backup taken at sleep; null before the first
  workspaceId   String       // space-scoped volume
  browserProfile Bytes?      // encrypted, key ring
  lastActiveAt  DateTime
  expiresAt     DateTime
  @@unique([spaceId, agentSlug])
}

model AgentRun {             // agent_runs — rebuilt
  id, vmId, spaceId, agentSlug
  trigger       String       // chat|schedule|webhook|delegate|channel
  triggeredById String?
  status        String       // queued|running|awaiting_approval|done|failed|cancelled
  skillsUsed    String[]
  costTokens    Int
  costVmSeconds Int
  parentRunId   String?      // delegation + compression lineage
}

model AgentEvent {           // agent_events — the timeline
  id, runId, seq
  kind          String       // think|code|exec|browse|call_action|approval|takeover|error
  payload       Json         // redacted
  at            DateTime
  @@index([runId, seq])
}

model AgentFrame {           // agent_frames — 1fps replay
  runId, at, storageKey, width, height
}

model AgentApproval {        // agent_approvals
  id, runId, kind, detail Json
  state         String       // pending|approved|denied|expired
  decidedBy, decidedAt, expiresAt
}

model AgentSkill {           // agent_skills
  id, spaceId, agentSlug, slug, version
  notePath      String       // source of truth is the note
  status        String       // draft|pending|approved|retired
  marketplaceStatus String?  // null until explicitly submitted — Tools' rule
  declaredHosts String[]
  declaredActions String[]
  taughtByUserId, taughtInRunId
  imageDigest   String       // what it was taught against
}

model AgentEgressLog {       // agent_egress_log
  vmId, runId, method, host, path, verdict, bytes, at
}
```

Note the `AgentSkill` two-verdict shape: `status` is the source space's admin,
`marketplaceStatus` is Visvine's and is **null until an admin explicitly
submits**. Never widen a query over skill versions without deciding which
verdict it asks about. Same trap as `AppToolVersion`.

Every encrypted column above goes into `scripts/rotate-secrets-key.ts` in the
same PR that adds it.

---

## 14. Surface

New actions in the registry, each with its own scope:

| Action | Scope |
|---|---|
| `start_agent_run`, `send_to_agent` | `agents:run` |
| `take_control`, `release_control` | `agents:control` |
| `teach_skill`, `revise_skill` | `agents:teach` |
| `approve_skill`, `submit_skill` | admin only |
| `delegate` | `agents:run`, depth-capped |
| `vm_exec`, `vm_browse` | `vm:run` |

`vm:run` is never folded into `connectors:use`, for the same reason
`tools:author` is not `context:write`: what separates reading someone's notes
from running arbitrary code in their space has to be a scope a client must ask
for and a human must see spelled out in `SCOPE_DESCRIPTIONS`.

---

## 15. Phases

Each ships standalone. Nothing here is wasted if you stop early.

**Phase 0 — Code mode.** *No VM.* Generate the typed API from the action
registry, teach the current agent to write code against it instead of picking
tool schemas. Biggest capability-per-effort win available, and it is the
interface the VM will use. Exit: an agent completes a multi-action task by
writing one program.

**Phase 1 — Egress plane.** `apps/agent-edge` with the outbound handler, the
pure policy compiler behind it (space + task → allow/deny/inject), and
`agent_egress_log`. `enableInternet = false` from the first boot. Prove it
against a throwaway sandbox running hostile code before any real workload. Exit:
the red-team suite cannot reach a non-allowlisted host, cannot read an injected
credential, and cannot get a packet out on a port the handler never sees.

**Phase 2 — VM control plane + one substrate.** *Built.* Lease, boot, sleep,
wake, reap, and the R2 workspace archive. `vm_exec` behind `vm:run`. No window
yet, no browser yet. Verified live: a command runs as the `agent` user in
`/workspace`, an allowed host answers 200 through the handler, a host the policy
does not name times out with no route, an address literal is refused, and a file
written before a stop is there after the wake.

Two things the runtime does not do, found by building it: `exec` declares a
`user` option and refuses it (so a command drops privileges itself, with
`setpriv`), and directory snapshots are unavailable on this account (so the
workspace is a tar archive in R2).

**Phase 3 — The window.** *Built, minus the screen.* The Durable Object relays
its machine's event stream to whoever is watching, and the same stream is
written to `agent_vm_events` whether or not anyone was — which is what makes a
run nobody watched reviewable afterwards. A browser is admitted with a ticket
the control plane mints for one machine and sixty seconds; it never holds the
service token, which opens every machine on the platform. The screen itself
waits for Phase 4, because there is no display until there is a browser.

Verified live: a socket opens, `exec` / `output` / `exit` arrive as they
happen, a valid ticket for a *different* machine does not open this one, and
the stored timeline answers the same question after the socket closes.

**Phase 4 — Browser + takeover.** *Built.* Chromium runs headful on the
machine's own display (Xvfb), its profile lives in `/workspace/.browser` so it
is archived with everything else, frames stream to whoever is watching, and a
human can take the keyboard — clicks and keys are replayed onto the display with
xdotool, and are refused unless a takeover is open.

Verified live: a page loads over HTTPS through the egress boundary with
certificate verification ON, frames arrive while watched, an input sent before
the takeover does nothing, one sent after it types into the browser, and the
profile — cookie database included — is still there after a sleep and a wake.

Three things worth writing down, all found by building it:

- **`container.start({ env })` replaces the image's environment**, and
  `container.exec` inherits nothing from the running process. A variable that is
  not passed to both does not exist. Playwright's browser path is the one that
  bites: without it Chromium is installed and unreachable, and the error tells
  you to install it again.
- **Chromium does not read the system trust store.** It carries its own (NSS),
  so the interception CA has to be added there too or every page is a
  certificate error. The tempting fix — `--ignore-certificate-errors` — would
  turn verification off for every site the agent visits; the entrypoint adds one
  issuer to the browser's own store instead.
- **A container rollout is asynchronous and lags the deploy.** `wrangler deploy`
  reports the new image while `containers info` still names the old one, and a
  machine that is already up keeps running the old one until it is stopped. Poll
  the configuration digest, then stop the machine, or you will debug an image
  that is not running.

**Phase 5 — Teaching.** *Built.* A takeover is recorded — what was clicked,
which named keys were pressed, what was on screen, which files changed — and the
agent's own model writes the skill from that trace, in its own words. A skill is
two notes under `agents/<name>/skills/<slug>/`, lands pending, and only an
approved one is ever put in front of a run. Selection is the recipes mechanism:
a keyword overlap, deterministic and free, so which skills a run had is
answerable afterwards without replaying it.

**The recorder never carries what was typed**, and one finding here is worth
more than the rest of the phase: a browser writes what you type into its WINDOW
TITLE, and the recorder reads titles to say what a step was about. Typing a
password into an address bar therefore wrote it into the trace — a silent leak
into a note anyone in the space can read. The typed text is now held in memory
for the life of the takeover for one purpose, scrubbing itself back out of every
title recorded (prefixes included, since a title is often sampled mid-word), and
is discarded when control is given back. `apps/agent-edge/src/redact.ts` is that
function, alone and tested, because this is the seam where a leak would be
silent.

**Phase 6 — Always-on.** *Built, minus Slack.* Schedules and note/webhook
triggers already existed; what this phase adds is **channels** and
**delegation**.

Every channel normalises to one shape and ends in the same place — an ordinary
event in the agent's mailbox, read by the same run that answers a schedule.
There is no second runtime for "chat" agents, which is the discipline worth
keeping: a bug in an adapter is a delivery bug and never an access bug. In-app
and email are built; Slack needs an app and credentials and is the next adapter
rather than a different design.

Three rules the shape enforces:

- **A channel identifies a sender; it never authorizes one.** An email address
  is a claim, matched against the space's members. A sender we cannot place is
  refused rather than run as "somebody" — an agent that answers strangers is an
  agent anybody can spend the space's model key on.
- **The address names the space**, `<agent>@<space>.<domain>`, because a person
  can belong to several and "which space is this about" must never be a guess.
  An address that does not parse is refused, never routed to a default; two
  spaces whose ids end alike are ambiguity, and ambiguity is refused too.
- **A message reaches the run as fenced, labelled data** — somebody's words, not
  the operator's brief — the same posture the platform takes with web pages and
  artifact comments.

**Delegation is an action**, not a private arrangement between agents: registry,
scope, both timelines, depth-capped at two hands. What moves is the task and the
workspace path; what does not move is credentials, sessions or the caller's
access. Agent B runs as itself, on its own machine, with its own grants — which
is the entire difference between handing off here and sharing one computer.

**Phase 7 — Hardening.** *Built, minus the marketplace* (which decision 5
deliberately defers: skills stay space-local at launch).

**The red team, in the only form that can be asserted.** It never asserts that a
model ignored an instruction — that is unfalsifiable, and the state of the art
says it will sometimes fail. It asserts what the platform actually claims:
whatever the model is persuaded to attempt, the boundary refuses it, the
credential is not there to take, and the attempt is on the record. Nine pure
cases in `tests/vm-redteam.test.ts`, and nine live ones against a real machine
in `pnpm --filter @visvine/web vm:redteam` — nightly rather than per-PR, because
it costs machine-minutes and talks to the internet, and skipping loudly when
there is no edge configured.

All nine live cases hold: an unlisted host, a lookalike, the allowed host by
address, cloud metadata, plain HTTP, raw TCP on a non-web port, and reaching
what an unlisted name resolves to are all blocked; the allowed host works with
its credential attached at the edge; and `REDTEAM_SECRET` appears nowhere inside
the machine, environment or PID 1 included.

**One finding from writing it, worth more than the suite:** `curl` exits 0 on a
403, so a request the handler REFUSED read as a success and the first run
reported three failures that were not failures — and would just as happily have
reported passes that were not passes. Every HTTP probe now runs `curl -f`. A
red-team suite that cannot fail correctly is worse than none, because it is
believed.

**Quotas.** A space gets 120 machine-hours a month by default
(`vmMonthlyHours` in its feature config; `null` is uncapped and an admin has to
write it, because the absence of a setting must never mean "no limit"). The tick
meters the awake ones a minute at a time — the platform's timer is what bills,
so it is what counts — refuses a lease past the cap, and stops machines already
running. `GET /api/communities/<id>/vm/usage` is the same numbers in hours and
dollars before a refusal delivers them.

**Anomalies and retention.** The tick sweeps the last hour of egress for three
shapes — a run of refusals, a copy leaving through an allowed host, one machine
touching everything — and warns. None of them is proof; a compromised agent and
a bad skill look identical from here, and the point is to put a human in front
of the log. Every signal is a `warn`, because `logger.error` pages someone and a
pile of working denials would bury the thing that actually broke. The egress log
prunes at 90 days; the timeline is the durable record and is not touched.

Phases 0 and 1 are the ones with the worst effort-to-excitement ratio and the
best effort-to-outcome ratio. Do them in order and do not skip 1.

---

## 16. Cost, and the shape of the bill

An agent that lives on a machine has a bill with four lines, and three of them
are ours to control. Rates are list, as of writing; the shape is what matters,
not the third decimal.

| Line | Rate | What moves it |
|---|---|---|
| Active CPU | $0.072/vCPU-hour | only time actually computing — model waits and page loads are free |
| Provisioned memory | $0.009/GiB-hour | **wall-clock while the container is awake** — this is the idle cost |
| Provisioned disk | $0.00025/GB-hour | the instance shape, not what you store |
| Data transfer out | $0.025/GB, 1 TB included | frames while watched, uploads |

A `standard-3` agent costs about **$0.08/hour awake-but-idle** and **$0.22/hour
flat out**. Awake all month: roughly $56 even doing nothing. Asleep after ten
idle minutes and woken an hour a day: **under $3**. That ratio is the entire
argument for the sleep policy — it is not housekeeping, it is 95% of the bill —
and here the platform enforces it for us through `sleepAfter` rather than
depending on our tick to remember.

The included allowances (25 GiB-hours of memory, 375 vCPU-minutes, 200 GB-hours
of disk, 1 TB of egress) cover roughly the first few agent-hours of a month and
then stop mattering. The terabyte does not: at 0.45 GB per watched hour it is
about 2,200 hours of somebody watching before the frame stream costs anything
at all, which is why §9 can leave the window generous rather than rationed.

So, the levers, in the order they matter:

1. **Sleep aggressively.** Ten idle minutes, enforced by `sleepAfter`, and the
   tick only has to catch what the platform's timer cannot see.
2. **Right-size.** `standard-3` is the default and `standard-4` the ceiling; a
   bigger shape is not available at any price, which makes this lever a design
   constraint rather than a budget decision.
3. **Keep the image lean.** Fifty gigabytes is the account's whole image budget,
   and every gigabyte is also cold-wake seconds paid on every resume.
4. **Frames only while watched.** Cheap here, but the DO stays awake while a
   socket is open, so an abandoned tab is a small permanent cost.
5. **Back up what changed.** A backup at every sleep, of a workspace that lives
   in R2 anyway, is storage paid twice.

### Is this the cheapest substrate?

Close to it. Priced against a daily-worker agent — 60 awake hours a month, 15%
of that computing — the field lands at roughly $4.00 Northflank, **$5.91 here**,
$7.73 Vercel, $9.94 E2B or Daytona, $14.33 Modal, $18.90 Fly Sprites. Northflank
is cheaper and is not in the running: it is a PaaS, so the isolation and egress
plane would be ours to build and operate, which is the one thing this plan
refuses to hand-roll.

The money was never the argument, though — the spread across the whole field is
about four dollars an agent. What was decisive is that the egress boundary is a
Worker we write (§5), and the fact that it also happens to be the second
cheapest option and six times cheaper on egress is a coincidence we will take.

### The line that is not on our bill

**A space brings its own model key** — the registry stores `MODEL_KEY_<PROVIDER>`
per space and Visvine never bills anyone for tokens. That is why the numbers
above are single-digit dollars rather than the hundreds every comparable product
quotes. Bundling the model instead would put $30–150 per agent per month on our
side of the ledger at ordinary run volumes, two to ten times the entire VM cost,
and would make the bill something a customer's prompt controls. If managed
models are ever offered, they are a separate meter with a hard cap, never folded
into a tier price.

Two things follow for the product. Per-space **VM quotas and a per-run cap** are
Phase 7 but the columns exist in Phase 2 (`costVmSeconds` on `AgentRun`), because
retrofitting cost accounting after people are using something is how you end up
guessing. And cost is a surface: the space console shows VM-hours the way it
shows anything else, and an agent that burned an hour on a task says so on its
own timeline.

---

## 17. Verification

Each plane gets the treatment `tests/connector-isolate.test.ts` gets, because
each is the same class of problem: untrusted code, a boundary, and a claim.

- **Policy compiler** — pure, `lib/vm/policy.ts`, unit-tested the way
  `perimeter.ts` is. Space notes + task narrowing + platform denylist in, a
  decision per request out. The tests that matter are the refusals: a task that
  tries to widen, an empty allow list (which must compile to deny, never to
  allow-all), a host that resolves private, a credential rule with no matcher.
- **Outbound handler** — the Worker is where the compiler's answer becomes
  enforcement, so it is tested twice: unit tests over the handler function with
  a fabricated request, and a red-team image whose only job is to get out.
  Literal-IP connect, custom resolver, DNS tunnelling, raw TCP on a non-web
  port, a `Host` header that disagrees with the URL, reading an injected header
  back out of its own request, SSRF at a metadata endpoint. Runs in CI against a
  real sandbox, nightly rather than per-PR, and gates the release the way the
  escape battery does.
- **Control plane** — leases, ticks and reaping are rows and pure functions, so
  they test without a substrate. The edge gets one integration test per method
  behind the `Substrate` interface, skipped loudly when no account is
  configured, in the shape `tests/agents-tick.test.ts` already uses. The sleep
  path gets its own: write to the workspace, force a sleep, wake, and assert
  what survived — because on this substrate that is a real question and not a
  formality.
- **Code mode** — the generated API is generated, so the test is that it
  round-trips: every action in the registry produces a module, every module's
  types match the Zod schema it came from, and a drift between them fails the
  build. That is the same property `<!-- action:contract -->` already gives the
  notes.
- **The window** — an event stream is a data structure; assert that a run
  reconstructs from its events alone, because that is what replay is.
- **Injection** — poisoned notes, hostile pages, a malicious skill, a PDF that
  tells the agent to do something. The assertion is never "it ignored the
  instruction" — that is unfalsifiable and the state of the art says it will
  sometimes fail. The assertion is that **anything it did in response hit the
  approval gate**, which is the property we actually claim.

`pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test` and
`pnpm --filter @visvine/web knip` still gate every commit here. Nothing about a
VM makes that negotiable.

---

## 18. Accepted trade-offs

State them now so nobody rediscovers them as bugs.

- **Prompt injection is not solved.** Contained by the approval gate and the
  egress log, not eliminated. Say so in the product.
- **A broad browsing allowlist is broad.** The containment is on action, not on
  read.
- **Every wake is a cold boot.** Seconds, and a fresh disk. Show it in the window
  rather than hiding it, and treat local state as gone because it is.
- **VM-hours cost money.** Per-space quota, per-run cap, idle sleep, frames only
  while watched. Cost is a product surface, not an invoice surprise.
- **We lose Grok Bot's shared-login convenience** by refusing their shared
  machine. Deliberate. Multi-tenant changes the maths.
- **A rented substrate is a hard dependency**, and it is now a *second vendor*
  in the critical path of a GCP-hosted product — with code deployed to it, not
  just calls made against it. Mitigated by the `Substrate` interface and by
  keeping Vercel Sandbox implementable. When the substrate is down, agents are
  down: the tick marks leases `unavailable`, queued runs stay queued, and the
  window says so. Nothing else on the platform degrades, because nothing else
  depends on a VM.
- **Two deployment targets, two release paths.** `apps/agent-edge` ships on
  Wrangler while everything else ships on Cloud Run, and the boundary between
  them is a version skew waiting to happen. The rule that keeps it honest: the
  edge holds no policy of its own and no schema of its own — it is handed
  decisions and it enforces them — so an old edge can be wrong about *how fast*
  something happens, never about *whether it is allowed*.
- **The account API token can boot machines and deploy code.** Held in Secret
  Manager, scoped as narrowly as the vendor allows, rotated on the runbook's
  schedule. It is the one secret whose compromise is not bounded by the
  fifteen-minute agent token.
- **The boundary is now our code, which cuts both ways.** A proxy fleet can only
  be misconfigured; a Worker can be miswritten. We took that trade because a
  handler with our bindings can enforce things a vendor's rule list cannot — an
  approval hold, a per-run narrowing, a credential the sandbox never sees — and
  because §17's red-team suite runs against the real thing rather than a mock.
- **The isolate stays.** Connectors do not move to the VM: worse latency, worse
  cost, worse security, no gain. Two runtimes is the correct number, and
  `perimeter.ts` is the one contract they share.

---

## 19. Decisions

The five that were open before Phase 2, and what they are.

**1. Substrate — Cloudflare Sandboxes, Vercel Sandbox second.** Decided on the
hard requirement: egress we control. Everywhere else that means handing a vendor
a list and trusting them to apply it; here the enforcement point is our own
Worker on the egress path, holding our bindings, changeable per request and per
run. Active-CPU billing, the cheapest egress in the field and a `sleepAfter`
that matches our idle policy come with it. The price is an ephemeral disk, a
4 vCPU ceiling, a second deployment target and a GUI we build. §3 carries the
comparison and §5 the mechanism.

**2. VM granularity — one per (space, agent).** Confirmed, and the cost is
accepted. Per-space-shared is cheaper and is what Grok Bot does; we hold other
people's relationship data across tenants, and "which agent could reach this"
has to have an answer. Agents hand off through the space `/workspace` volume and
the context store, never through a shared browser.

**3. Retention — screen frames 30 days, timeline forever.** Per-space override
downward, and a space may set 0 to keep no frames at all. Frames are the
expensive, sensitive half and the redundant one: code + terminal + timeline
reconstruct a run without them. The timeline is the audit record and is never
truncated on a schedule; it goes when the space goes.

**4. Takeover — admins, plus a member holding an explicit grant on that agent.**
Not every member, because takeover is a session inside a machine that holds the
agent's authority and its browser profile. Not admins-only, because the person
who knows how to do the task is usually not the person who administers the
space, and §7's whole premise is that they demonstrate it. The grant is on the
agent, it is auditable, and every takeover is recorded with who held the
keyboard and for how long.

**5. Skill sharing — space-local at launch.** The `marketplaceStatus` column
ships in Phase 5 and stays null. A skill carries selectors, procedures and
assumptions about one space's data, and it declares reach; sharing one is
sharing a claim about what that reach means somewhere else. Tools earned their
marketplace after the approval loop had run for a while, and skills get the same
order.

### Still open

- **Placement.** The substrate places containers on its own network, near where
  the request came from, which is a different data-residency story than a region
  we pick — and a space whose notes live in one jurisdiction and whose agent runs
  in another is a question for whoever writes that story, not for this plan.
  Record the placement the platform reports on every run so the question is
  answerable when it is asked.
- **What a personal agent costs whom.** A personal-context agent is a VM billed
  to the platform with no space to bill it to. Phase 7, with quotas.
