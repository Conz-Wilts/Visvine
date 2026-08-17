# What is "an agent we don't run", and whose authority does a run carry?

<!-- labels: wayfinder:grilling -->
parent: ../map.md
status: open
assignee:
blocked-by:

## Question

The foundational vocabulary ticket. Everything else on this map is unphrasable until
these two things are named.

**1. The tiers.** "An agent we don't run" is currently one undifferentiated blob. Are
there meaningful tiers, and if so what are they and what distinguishes them? Candidates
to test, not to accept:

- our own web UI calling connectors server-side;
- `lib/connectors/agent.ts`, our own server-side connector-building loop;
- a member's Claude Desktop / IDE speaking MCP as themselves;
- a third-party SaaS product holding an OAuth grant on the space's behalf;
- an unattended/scheduled agent with no human present at the moment of the call.

For each: is the distinction *enforceable* (can the server tell them apart with
something better than a self-asserted string), or is it a story we tell ourselves? A
tier we cannot verify is not a tier.

**2. The principal.** When `run_connector` executes, whose authority does the run act
with? Options to weigh: the human member's full authority; a *lesser* derived authority
(the human's, minus anything the sandbox shouldn't grant); the connector's own authority
independent of who invoked it; or a (human, client) pair. Today it is effectively the
human's authority gated by the `connectors:use` scope — decide whether that is what we
mean or merely what we built.

**Bring to the human:** plain-language framing first — an analogy for what a "principal"
is and why the answer changes what's possible — then a recommendation, then the fork.
Do not present the options bare.

**Watch for:** the tempting answer "the agent is untrusted, therefore treat every run as
hostile" collapses the tiers and may make the product useless; the equally tempting "the
member vouched for their own client" ignores threat 1 (prompt injection), where the
member is honest and the client is hijacked. The model has to hold both.

Output: the named tiers with their enforceability, and a one-paragraph statement of the
principal a connector run acts as.
