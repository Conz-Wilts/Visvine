# Machines

An agent can be given a **machine**: a container with a filesystem, Node,
Python, `uv`, git, ripgrep and a headful Chromium, reached through the
`vm_exec` and `vm_browse` actions behind the `vm:run` scope. A human can watch
it live, take the keyboard, and teach the agent a task by doing it once.
`docs/agents.md` is the agent guide; this page is the machine underneath one —
what it is, where its boundary is, and what an operator has to hold.

The rule the whole design serves: **the space is the security boundary, the
agent is the authorization boundary, and a machine crosses neither.** One
machine per (space, agent). Two agents in one space are two machines that hand
off through the space's `/workspace` and the context store — never through a
shared browser, because a shared browser is every logged-in session one agent's
author established, handed to another agent without anyone granting it.

## The shape

```
Control plane   apps/web/lib/vm/*         Cloud Run. Leases, quota, policy, the
                                          window's tickets. Every decision is here.
Edge            apps/agent-edge           Cloudflare Worker + one Durable Object
                                          per agent. Owns the container, enforces
                                          the policy it is handed, relays the window.
Policy          packages/vm-policy        Pure. Compiled by the control plane,
                                          evaluated by the edge — one module so the
                                          two halves can never disagree.
Substrate       Cloudflare Containers     A container in its own VM. Rented.
Storage         R2 (visvine-agent-workspaces)   /workspace archives, per space.
```

**The edge decides nothing.** It boots what it is told to boot and enforces
the policy it is given; who an agent is, what it may reach and whether a run
may start are answered in Postgres by the same code that answers them for the
web app. That split is what keeps a version skew between two deployment targets
from ever becoming a security question — an old edge can be wrong about *how
fast* something happens, never about *whether it is allowed*.

The two halves share one secret, `EDGE_SERVICE_TOKEN`. It authenticates the
**channel** (`lib/vm/edgeAuth.ts`) and nothing else: a caller holding it can
report egress records and be handed policy; it can never be an agent, a person
or a grant.

### Configuration

| Where | Variable | What it is |
| --- | --- | --- |
| Cloud Run | `AGENT_EDGE_URL` | The Worker's URL |
| Cloud Run | `EDGE_SERVICE_TOKEN` | Shared secret, ≥ 32 chars |
| Cloud Run | `VISVINE_ENV` | The environment name; defaults to `prod` in production, else `dev` |
| Edge | `EDGE_SERVICE_TOKEN` | The same value — `wrangler secret put EDGE_SERVICE_TOKEN` |
| Edge | `CONTROL_PLANE_URL` | Where egress records and events are posted |

With any of the Cloud Run pair unset there are no machines: `edgeConfigured()`
is false, `vm_exec` answers 503, and nothing else on the platform degrades,
because nothing else depends on a machine.

**The edge ships from GitHub Actions** (`.github/workflows/edge.yml`): a push
to `main` touching `apps/agent-edge/**` or `packages/vm-policy/**` runs
`wrangler deploy` — Worker upload, container image build on the runner, push
to Cloudflare's registry — under `CLOUDFLARE_API_TOKEN` (a repository secret;
an "Edit Cloudflare Workers" token with Containers and Workers Scripts edit)
and `CLOUDFLARE_ACCOUNT_ID` (a repository variable). `pnpm edge:deploy` is the
same command from a laptop logged in with `wrangler login`, for a hotfix;
`pnpm edge:tail` follows the Worker's logs. A machine already awake keeps the
old image until it sleeps or is stopped, so a deploy lands on each machine's
next boot.

### Identity

A machine is named in exactly one place, `@visvine/vm-policy#machineName`:
`vm-<environment>-<spaceId>-<agentName>`. The control plane addresses it by
that name and the edge resolves a Durable Object from it. The environment is
part of the name because production and a developer's laptop share one Worker
and one bucket — without it, a local test of a space id that also exists in
production would stop that production machine and overwrite its workspace. The
control plane decides the environment and sends it; the edge never guesses.

The lease row is `agent_vms` (`AgentVm`), unique on `(space, agent)`: state,
instance type, the compiled policy's digest, the workspace prefix, and
`expiresAt`. Nothing in the web process holds a container handle across
requests; every call re-derives the machine from the row and the name.

## The machine

One `linux/amd64` image for every agent in every space
(`apps/agent-edge/container/Dockerfile`): `node:22-slim`, Python 3 + `uv`,
git, ripgrep, Chromium through Playwright, Xvfb, ffmpeg, xdotool. Image storage
is 50 GB for the whole account and every gigabyte is paid again as cold-wake
seconds, so there is one image and it stays lean — a per-space image is not
something the platform can afford. Nothing in it is pre-authenticated.

`standard-3` (2 vCPU, 8 GiB, 16 GB disk) is the default shape and
`standard-4` the ceiling the platform offers. Anything needing more is a job
for the isolate or a queue, not a bigger machine. `max_instances: 20` in
`wrangler.jsonc` is how many may be awake at once across the platform, not how
many may exist.

**Nothing runs as root.** The entrypoint starts as root only long enough to
install the interception CA and start the display, then drops to the `agent`
user; every command the control plane sends is wrapped in `setpriv` to the same
user and runs in `/workspace`. The runtime's `exec` declares a `user` option and
refuses it, which is why the command drops privileges itself.

### Lifecycle

- **Lease.** `lib/vm/lease.ts#leaseMachine` checks the space's quota, compiles
  the policy, upserts the row, and calls the edge's `/lease`. Idempotent: the
  tick and a request that both want the machine find one container, not two.
  Every lease recompiles the policy from the space's connectors, so a connector
  an admin just turned off stops being reachable on the next lease.
- **Sleep.** The platform's own inactivity timer stops the container after ten
  idle minutes (`IDLE_MINUTES`). The Durable Object arms an alarm a minute
  before that and archives `/workspace` to R2; every command re-arms it.
- **Wake.** A wake is a fresh boot with a fresh disk: restore the archive,
  reinstall the CA, restart the display. A `boot` event says whether the
  workspace was restored. `vm_exec` reports `woke: true` so a caller sees why
  the first command was slow.
- **Reap.** A lease untouched for fourteen days is deleted by the tick
  (`reapExpiredLeases`), and the machine told to stop in case it is somehow up.
  The space's workspace prefix is not touched; it outlives every agent.
- **Unavailable.** If the edge refuses or does not answer, the row is marked
  `unavailable` and the error surfaces as a 503 — an outage of machines and
  nothing else.

### Persistence

**The disk does not survive a sleep.** `/workspace` is archived to
`<workspaceKey>/agents/<agent>.tar.gz` under the SPACE's prefix
(`spaces/<env>/<spaceId>/workspace`) before the machine sleeps and unpacked on
the next boot; everything else — `/tmp`, `/home`, an installed package — is
scratch. The rule an agent has to hold is "keep it in `/workspace`". A skill
that `apt-get install`s something reinstalls it every wake, which is a reason
to fold what it needs into the image.

The archive is a tar in R2 rather than the runtime's directory snapshot because
the snapshot is refused on this account, and because an archive survives the
machine being destroyed and rebuilt, which a snapshot bound to a container does
not. An empty workspace still archives, so "the agent deleted everything"
survives a sleep too.

## Egress — the boundary

Every serious sandbox lands on the same answer: deny-by-default network plus an
inspecting proxy the sandbox cannot reach around. Here the proxy is **our own
Worker**, on the same machine as the container, holding our bindings. Two
enforcers, and the split is deliberate:

- **The container network** decides whether a connection exists at all.
  `enableInternet: false` on every boot — not a filtered route; none. Only what
  the interception calls open is routable.
- **The outbound handler** (`apps/agent-edge/src/outbound.ts`, reached through
  the `EgressProxy` entrypoint) decides what an allowed request may do:
  evaluates the policy, injects credentials, records the verdict.

```
container, enableInternet: false
  ├── HTTP   → interceptAllOutboundHttp  → EgressProxy   (catch-all; policy is
  │                                                       HTTPS-only, so refused)
  └── HTTPS  → interceptOutboundHttps    → EgressProxy   (registered PER HOST,
        │                                                 for each literal allow entry)
        ├── policy read from the machine's Durable Object
        ├── evaluate()  — @visvine/vm-policy, pure
        ├── inject headers from Worker bindings the container cannot read
        ├── record → POST /api/internal/vm/egress
        └── fetch() upstream
```

### The policy

`VmPolicy` is `{ allow, deny, approval, inject }` over **hostname patterns
only**. The grammar refuses what it cannot enforce: no IP literals, no CIDR, no
ports, no paths, no URLs; a wildcard replaces a whole label (`*.example.com`
matches any depth and never the apex); an allow entry must name a domain.
`evaluate()` decides in a fixed order — unreadable policy, non-HTTPS, address
literal, deny list, **empty allow list**, no allow match, approval match, allow
with injections — and `PLATFORM_DENY` (`localhost`, `*.internal`, the metadata
endpoints, …) precedes every allow rule and is not overridable.

**An empty allow list denies.** The substrate's own default is the inverse and
it is the single most dangerous default in the stack: a bug that drops the allow
list must produce a dead agent, never an open one.

The control plane compiles the policy (`lib/vm/policy.ts#compileForSpace`) from
**the hosts the space's enabled connector notes already declare** — `hosts:` is
admin-written, literal and already the answer to "what may this space talk to"
for the isolate, so a machine gets the same answer from the same place rather
than a second list that drifts. A run may pass `taskAllow` to narrow; an entry
the space does not cover is dropped with a warn, never granted. A connector
host the grammar cannot enforce — an IP, `localhost` — is dropped from the
machine's reach (the isolate still reaches it); a connector note that does not
parse grants nothing. The sha256 of the canonical policy rides the lease row as
`policyHash`. `GET /api/communities/<id>/vm/policy` shows an admin the compiled
list, the digest, and what was rejected or unreadable.

A running machine can be narrowed (`/policy` on the edge → `setPolicy`), which
re-registers the HTTPS routes so the network follows the handler.

### What the boundary does not do

Each is a real hole with a rule that closes it; they are written down because
the failure mode is believing the allowlist is total.

- **Only HTTP and HTTPS reach a handler.** Raw TCP and UDP are never
  intercepted — which is why `enableInternet: false` is on every boot: in that
  mode nothing else is routable, so uninspectable traffic has nowhere to go.
- **HTTPS is registered per host, so a wildcard grants nothing over HTTPS.**
  There is no host to register. A space's connectors should name the hosts they
  actually use; a plain-HTTP request to anything is caught and refused, which
  is how an address literal shows up as a denial rather than as silence.
- **TLS is terminated, so the machine must trust the interception CA.** It is
  mounted at run time, not baked into the image; the entrypoint waits for it and
  installs it on every boot, into the system store AND Chromium's own NSS store
  (Chromium does not read the system one). Verification stays on — the
  alternative, `--ignore-certificate-errors`, would turn it off for every site.
- **`approval` is refused, not held.** A host in the approval set is recorded
  with verdict `approval` and answered 403 "no approval is on record". There is
  no approval queue; the safe direction is a refusal that says so plainly.
- **The handler is code, so it can be wrong.** It gets the treatment the
  isolate's escape battery gets: `tests/vm-policy.test.ts` and
  `tests/vm-redteam.test.ts` (pure), and `pnpm --filter @visvine/web vm:redteam`
  against a real machine — unlisted host, lookalike, allowed host by address,
  cloud metadata, plain HTTP, raw TCP on a non-web port, and that the injected
  secret appears nowhere inside the machine. Nightly rather than per-PR; skips
  loudly when no edge is configured. Every HTTP probe uses `curl -f`, because
  `curl` exits 0 on a 403 and a red-team suite that cannot fail correctly is
  worse than none.
- **Browsing widely means a broad list.** For a research task that is the
  point; the containment is on what the agent may *do* — actions still go
  through `runAction`, grants and scopes — not on what it may read.

### Secrets

Plaintext never enters the machine.

- A connected service is called through the **connector action**, which runs
  on the isolate host-side; the machine sees the response, never the key.
- A credential for a host a policy names is **injected at the edge**: an
  `inject` rule is `{ host, header, secret }` where `secret` names a Worker
  binding, never a value. The header is set on requests bound for that host
  only, and a rule for a host the policy does not allow fails compilation. A
  promised binding the edge does not hold is a 503 refusal, never an
  unauthenticated request an agent reads as "the service is down". Rotating it
  in the binding takes effect on the next request.
- A website the agent must be *logged into* is signed into one of two ways,
  and the session lives in the browser profile under `/workspace/.browser`
  either way, archived with everything else: by a human during a takeover, or
  by **the vault** — a `website-login` connector (`lib/connectors/catalog.ts`)
  whose note names the sign-in page (`login.url`, on one of its `hosts:`, so
  the site is on the machine's policy by the same rule as every other
  connector host) and holds the account in its env, the password a
  `{{secret:…}}` like any other. `sign_in` (`lib/vm/signin.ts`, offered to an
  agent whose brief declares the connector, on a space that has a machine)
  decrypts it on the control plane and hands it to ONE command as that
  command's environment (`ExecRequest.env`): a Playwright script attached to
  the machine's own browser over CDP fills the form and submits. The value is
  never on the command line (the timeline records that), never on disk (the
  workspace is archived), never in the model's context, the trace or a note;
  the edge scrubs it out of whatever the command prints, prefixes included,
  the way a takeover's typing is scrubbed from titles. It is in one process's
  environment for the seconds the form takes, and an agent's tool calls are
  sequential, so nothing of the agent's runs beside it.

A secret is a property of the policy, never of the machine: a machine that is
archived, woken or rebuilt carries no plaintext because there was never any in
it — the sign-in's credential included, which is gone with the process that
typed it.

## The window

An agent reaches its machine from inside a run with `run_command` and
`open_page` — offered to every agent of a space that HAS a machine
(`lib/agents/tools.ts`), because the boundary is the policy below and not a key
in a brief — and a person reaches it with the `vm_exec` / `vm_browse` actions. Both go through
`runOnMachine` / `browseOnMachine`, and a run's commands carry its `runId` to
the edge, which stamps it on every event it emits — so the machine's half of
the story can be read back per run and nested under the step that asked
(`lib/agents/shared/trace.ts#attachMachine`, shown on the agent's Agent tab).

`apps/agent-edge/src/events.ts` is one stream with two audiences. Whoever is
watching gets it live over a socket; the control plane gets it in batches
(`POST /api/internal/vm/events`) and keeps it in `agent_vm_events`
(`AgentVmEvent`) whether or not anyone was attached — the screen is ephemeral,
the record is not, and a run nobody watched must still be reviewable.
`GET /api/communities/<id>/vm/timeline` reads it, newest first.

Event kinds: `boot`, `wake`, `exec`, `output`, `exit`, `sleep`, `error`,
`egress_denied`, `takeover`, `release`. `seq` is assigned on the edge so order
survives a late batch; output is clipped to 4,000 characters per event and the
stream capped at 2,000 events per boot, after which the timeline records that
it stopped recording.

**The agent reads the browser through CDP.** `browse.mjs` starts Chromium
itself — the binary, not Playwright's launcher, which talks over a pipe and
drops the port flag — with DevTools on `127.0.0.1:9222`, waits for the port to
answer, and only then navigates over CDP; so a `run_command` script attaches
to the SAME browser (`chromium.connectOverCDP`, importing Playwright by its
global path, `/usr/local/lib/node_modules/playwright/index.mjs`, since
`/workspace` resolves no packages) rather than launching a second one — the
profile is locked by the running process, and a fresh browser would carry none
of the sessions that make the first one useful. A second `open_page` steers
that browser the same way. A lease on a machine that is already running
re-registers its HTTPS routes, because they are per host and a host allowed
since boot would otherwise have no route at all. The port is loopback and never
routed: `PLATFORM_DENY` refuses `localhost` before any allow rule, so the
egress boundary is untouched by it, and nothing outside the container can reach
it. `open_page`'s tool description carries the three-line script.

**Frames go to whoever is watching and nowhere else.** Chromium runs headful
on the machine's own Xvfb display; a screen service inside the container
(`screen.mjs`, loopback only) grabs JPEGs, and the Durable Object pumps them to
attached sockets at ~1.6 fps while `watching > 0` and stops the moment nobody
is. No frame is stored — a picture of every second of every run would be both
the largest cost in the system and the most sensitive thing in it.

### Tickets

The browser is never given `EDGE_SERVICE_TOKEN` — that is a key to every
machine on the platform, and a key that reaches a browser is a key in devtools.
`GET /api/communities/<id>/vm/watch` authorizes the person (session, space,
admin), mints an HMAC ticket bound to one `machineRef` for sixty seconds
(`lib/vm/watch.ts`), and returns the socket URL. The Worker verifies signature,
machine and expiry (`apps/agent-edge/src/ticket.ts` mirrors the signing; the
round-trip test in `tests/vm-watch.test.ts` says when they drift) and forwards
the upgrade to the machine's Durable Object. The edge never learns who the
viewer is — it has no way to check and no business deciding.

### Takeover

A watcher may say two things: `takeover`, and `input`. Input events are
replayed onto the display with xdotool **only while a takeover is open**; an
agent drives the browser through its own commands, and a socket that could
type without a takeover would be a way around that. Who may watch at all is
decided before the ticket is minted; the machine only records that a human took
the keyboard and for how long.

**The recorder never carries what was typed.** A demonstration is recorded as
clicks and named keys against the title of whatever was on screen, plus the
fact that typing happened and how many characters, plus which workspace files
changed (paths only). A browser writes what you type into its window title, so
the text typed during a takeover is held in memory for the life of the takeover
for one purpose — scrubbing itself, prefixes included, out of every recorded
title (`redact.ts`, alone and tested) — and dropped at `release`. Typing a
password into an address bar therefore does not write it into a note anyone in
the space can read.

## Teaching

Take control, do the task once, give control back: the `release` event carries
the trace. `POST /api/communities/<id>/vm/teach` (`lib/agents/teach.ts`) hands
that trace to the agent's own model, which writes the skill in its own words —
intent, not coordinates, because a replay of coordinates breaks the first time a
button moves — as two notes under `agents/<name>/skills/<slug>/{index.md,steps.md}`.

A skill's `status` is `draft | pending | approved | retired`
(`lib/agents/shared/skills.ts`). A member's publish lands `pending`, an admin's
lands `approved` (`statusOnPublish`); `PATCH …/agents/<name>/skills` is the
gate, and the same route shows an approver the reach a skill claims against
what the space's policy actually grants (`unmetReach`). **Only approved skills
are selected into a run** — a keyword overlap over `keywords:`, the mechanism
recipes use, deterministic and free, so which skills a run had is answerable
afterwards without replaying it. The agent can still read any skill with the
ordinary note tools, because reading a note is not running one.

A skill is advice, never authorization. Every step it suggests still goes
through `runAction`, the space's grants and the machine's egress policy, so a
wrong or malicious skill costs a refusal, never an escape. Skills are
space-local: a skill carries selectors and assumptions about one space's data,
and sharing one is sharing a claim about what its reach means somewhere else.

## Approval and injection posture

Prompt injection is not solved, and the product never says otherwise. The
containment is structural rather than persuasive:

- **The machine can only act through the boundary.** Whatever a model is
  talked into attempting, the policy refuses what it refuses, the credential is
  not there to take, and the attempt is on the record. That is the property the
  red-team suite asserts — never "it ignored the instruction", which is
  unfalsifiable.
- **The egress log is the detection surface.** `agent_egress_log`
  (`AgentEgressLog`) holds every request a machine made and the verdict. A
  denial is the system working, so it is written at `warn`; `logger.error` is
  reserved for a fault, because in production it pages someone and a pile of
  working denials would bury the thing that actually broke.
- **Machines are an admin capability.** `vm_exec`, `vm_browse`, watching and
  teaching all require space admin, on top of the `vm:run` scope: a machine is
  the space's money and the space's reach, and neither is a member's to spend.
  `vm:run` is never folded into `connectors:use`, for the same reason
  `tools:author` is not `context:write`.

## Cost and quota

An awake machine is roughly **$0.10 an hour** (`standard-3`, idle) on
active-CPU billing plus provisioned memory and disk; asleep it costs nothing.
The sleep policy is therefore not housekeeping but almost the whole bill: awake
all month is tens of dollars doing nothing, woken an hour a day is single
digits. The levers, in order: **stop the machine when the run ends**, sleep
after ten idle minutes for everything that did not (enforced by the platform's
timer, not ours), keep the shape at `standard-3`, keep the image lean, and send
frames only while watched.

**The run stops the machine; the timer is the floor.** The platform's ten idle
minutes is a guess made by something that cannot know the work is over — an
agent that used its machine for forty seconds pays ten minutes for the silence
afterwards, which for a scheduled agent is most of its month. So the run says
so: `release` calls `lease.ts#releaseMachineAfterRun` on every terminal path.
Two exceptions, both deliberate. It does not stop a machine somebody is
**watching or has taken the keyboard of** — a person looking at a screen expects
it to still be there when the agent stops, and the idle timer is the right
policy for them. And it does not stop one when the release **re-armed the agent**
on pending mail: stopping a machine we are about to wake buys a cold start and
saves nothing. Failure is not a failure of the run — a machine that will not
stop is left to the timer, which is where it would have been anyway.

The model is not on this bill — a space brings its own key
(`MODEL_KEY_<PROVIDER>`), and Visvine never bills for tokens.

**The meter counts what the edge says is awake.** The platform's timer stops a
container and tells nobody, so a row left saying `running` says it forever —
which would bill a space a minute a minute for a machine doing nothing, and stop
it for a cap it never reached. Every tick reconciles first
(`lease.ts#reconcileSleptMachines`): it asks the edge's `/status` for each row in
`running` and writes `asleep` where the container is down. The ask reads the
Durable Object, not the container, so reconciling never wakes anything, and an
edge that cannot answer leaves the row alone — an outage must not zero a space's
usage.

**Quota. A space is uncapped, and that is the product decision**
(`DEFAULT_MONTHLY_HOURS = null` in `lib/vm/shared/limits.ts`). Machine time is a
small fraction of what a space pays, so a member who needs a machine at 3am gets
one and nobody meets a ceiling they were never told about. A space that needs a
limit is given one explicitly as `vmMonthlyHours` in its feature config, and
that cap still refuses a lease (`vm_exec` answers 429 with the reason) and stops
machines already running.

Removing the refusal does not remove the accounting, and it must not. The tick
still meters every awake machine a minute at a time into `agent_vm_usage`
(`AgentVmUsage`, one row per space per month) — the platform's timer is what
bills, so it is what counts — and `GET /api/communities/<id>/vm/usage` is those
numbers in hours and dollars. What a runaway trips now is **`SPEND_ALERT_HOURS`**:
past it the meter writes `vm.spend.alert` once, on the tick that crosses it,
because an alert repeated every minute is an alert nobody reads. It warns and
never refuses — the cost of stopping real work at 3am is higher than the cost of
the hours, and either way a person is told.

## The tick

Machines have no long-lived process of their own on Cloud Run; every minute the
agent tick (`/api/internal/agents/tick`, Cloud Scheduler + OIDC) also:

- reaps expired leases;
- meters awake machines and stops the machines of any space past its cap;
- sweeps the last hour of `agent_egress_log` per machine for three shapes —
  ≥ 20 refusals, ≥ 50 MB to one host, ≥ 40 distinct hosts — and warns
  (`lib/vm/shared/limits.ts#detectAnomalies`). None is proof: a compromised
  agent and a badly written skill look identical from here, and the point is to
  put a human in front of the log;
- prunes egress records older than 90 days. The timeline is the durable record
  and is not touched.

## Schema

| Table | Model | What it holds |
| --- | --- | --- |
| `agent_vms` | `AgentVm` | The lease: one row per (space, agent) — substrate name, instance type, state, policy digest, workspace prefix, `expiresAt` |
| `agent_vm_usage` | `AgentVmUsage` | Awake seconds and command count per space per UTC month |
| `agent_vm_events` | `AgentVmEvent` | The timeline, in batches from the edge; `seq` from the machine |
| `agent_egress_log` | `AgentEgressLog` | One row per request the machine made, with verdict, reason, status, bytes |

The edge owns no rows. Every row is written by the control plane through
`/api/internal/vm/{events,egress}`, which refuse on an unknown space rather than
creating anything — a record for a space that does not exist is a bug or a
forgery, and either way it is not evidence.

## Accepted trade-offs

- **Prompt injection is contained, not eliminated** — by the boundary and the
  log, and the product says so.
- **Every wake is a cold boot.** Seconds, and a fresh disk. The window shows it
  rather than hiding it, and local state is treated as gone because it is.
- **A wildcard grants nothing over HTTPS.** The safe direction; name the hosts.
- **`approval` refuses rather than holds.** A hold needs a queue and a human in
  the loop; until there is one, a refusal that says why is the honest answer.
- **A rented substrate is a second vendor in the critical path**, with code
  deployed to it. When it is down, machines are down: the row says
  `unavailable`, the action says 503, and nothing else on the platform
  degrades.
- **Two deployment targets, two release paths.** Kept honest by the edge holding
  no policy and no schema of its own. A container rollout is asynchronous and
  lags the deploy — `wrangler deploy` reports the new image while a running
  machine keeps the old one until it is stopped.
- **The boundary is our code, which cuts both ways.** A proxy fleet can only be
  misconfigured; a Worker can be miswritten. Taken because a handler with our
  bindings can do what a vendor's rule list cannot — inject a credential the
  machine never sees, narrow a running machine — and because the red-team suite
  runs against the real thing.
- **The isolate stays.** Connectors do not move to the machine: worse latency,
  worse cost, worse security, no gain. Two runtimes, and `perimeter.ts`'s
  `hosts:` is the one contract they share.
- **`container.start({ env })` replaces the image's environment** and `exec`
  inherits nothing, so `machineEnv()` is the one list both are given. A
  variable missing there does not exist for anything the machine runs.

## Decisions

1. **Cloudflare Containers**, because the egress boundary is a Worker we write
   rather than a list we hand a vendor: enforcement per request, changeable on
   a running machine, with our bindings in hand. The price is an ephemeral
   disk, a 4 vCPU ceiling, a second deployment target and a display we build.
2. **One machine per (space, agent).** Per-space would be cheaper and would
   share a browser profile — and so every logged-in session — between agents
   with different authors and different reach. A machine is leased lazily and
   sleeps in ten minutes, so the bill is awake time, not agent count.
3. **Frames are never stored.** Code, terminal and timeline reconstruct a run;
   frames are the expensive, sensitive, redundant half.
4. **Machines are admin-only.** Running, browsing, watching and teaching all
   require space admin while the runtime is young.
5. **Skills are space-local.** Tools earned their marketplace after the
   approval loop had run for a while; skills get the same order.

## Code map

`apps/web/lib/vm/{lease,policy,edge,edgeAuth,quota,anomaly,watch}.ts`,
`lib/vm/shared/limits.ts` (pure), `lib/actions/defs/vm.ts`,
`lib/agents/{skills,teach}.ts` + `lib/agents/shared/skills.ts`;
`apps/agent-edge/src/{index,machine,egress,outbound,events,ticket,redact}.ts`,
`apps/agent-edge/container/{Dockerfile,entrypoint.sh,screen.mjs,browse.mjs}`;
`packages/vm-policy`. Routes: `/api/communities/<id>/vm/{policy,usage,watch,
timeline,teach}`, `/api/internal/vm/{events,egress}`. Tests:
`tests/vm-{policy,limits,watch,redteam}.test.ts`,
`tests/agents-{skills,teach}.test.ts`; live: `pnpm --filter @visvine/web vm:redteam`.
