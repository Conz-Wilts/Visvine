# How does everyone else hand credentials to an agent they don't run?

<!-- labels: wayfinder:research -->
parent: ../map.md
status: closed
assignee: wayfinder-session-2026-08-17
blocked-by:

## Question

Before we can decide whether a Visvine connector secret may ever leave our server, we
need the plain-language landscape of how this problem is already solved. The human
driving this map is not steeped in the agent/MCP credential world, so the output must
teach, not just cite.

Answer, with sources:

1. **The confused-deputy problem in MCP.** What does the MCP specification and
   Anthropic's guidance actually say about a server that holds credentials on behalf of
   a user and exposes them to a client it doesn't operate? Is there a named pattern or
   an explicit warning?
2. **Token exchange and scoped credentials.** What does the field do instead of handing
   over a long-lived key — OAuth token exchange (RFC 8693), short-lived downscoped
   tokens, per-request signing, upstream-issued restricted keys (Stripe restricted API
   keys are one concrete example)? For each: what it buys, what it costs, and whether it
   requires cooperation from the *upstream* service (this matters — most of ours won't
   cooperate).
3. **Comparable products.** How do Zapier MCP, Composio, Pipedream Connect, and any
   equivalent handle "the user's Slack token, used by an agent we don't run"? Do they
   proxy every call, or do they ever issue outward? Do any let the agent author
   arbitrary code against the credential, as `run_connector` does?
4. **Arbitrary code vs. named operations.** Is there prior art on the specific fork of
   letting an agent write code with a credential in scope versus exposing only
   pre-declared operations? Who chose which, and what did they say about why?
5. **Redaction as a control.** Does anyone treat output-scrubbing of secret values as a
   security boundary, or is it universally hygiene? Any documented bypasses.

Deliverable: `../research/credential-landscape.md` — organised by the five questions,
each with a short plain-English summary first and the detail under it, plus a closing
"what this implies for Visvine" section that stays descriptive and does not pre-empt the
decision tickets.

## Resolution (2026-08-17)

Full landscape at [../research/credential-landscape.md](../research/credential-landscape.md).

**The headline: nobody surveyed does what we do.** Agent-authored code with a plaintext
credential in scope was found in **no** surveyed product. That absence is itself the
finding — there is no published defence of the position to weigh against, and no attack
literature specific to it.

**1. There is a normative MCP rule, and it is more pointed than expected.** The
elicitation spec (`2026-07-28`, "URL Mode Elicitation for OAuth Flows") lists as its
first critical security requirement:

> **The third-party credentials MUST NOT transit through the MCP client**: The client
> must never see third-party credentials to protect the security boundary

and separately: "The MCP server **MUST NOT** transmit credentials obtained through URL
mode elicitation to the MCP client." Servers are also forbidden from collecting secrets
over the wire at all — form-mode elicitation **MUST NOT** request "passwords, API keys,
access tokens, or payment credentials". *(Verified verbatim against
<https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation> by the
charting session — note it lives in the **elicitation** spec, not authorization or
security-considerations, where it is easy to look for it and not find it.)*

Two caveats on how far it reaches: it is scoped to credentials obtained *via URL-mode
elicitation*, and Visvine's are admin-entered instead — so whether it binds us literally
is [its own ticket](007-does-the-mcp-rule-bind-us.md). And the spec's **confused deputy**
section is much narrower than the general term: it covers only the static-client-ID +
consent-cookie + dynamic-registration OAuth attack. **The case where the client authors
code that runs on our server with the secret in scope is simply not contemplated by the
spec.**

**2. Scoped credentials mostly require upstream cooperation we won't have.** RFC 8693
token exchange, GCP Credential Access Boundaries (GCS-only) and AWS session policies all
need the upstream to play along. The only cheap real option is upstream-issued restricted
keys (Stripe restricted API keys, GitHub fine-grained PATs) — unverifiable from our side
and a manual per-connector step. **The only technique needing no upstream cooperation is
architectural: keep the credential, mediate access.**

**3. Every comparable platform proxies.** Across Zapier MCP, Composio, Pipedream Connect,
Arcade, Nango, Merge, Paragon and Klavis the pattern is unanimous — none lets
agent-authored code touch the credential. Pipedream states the rule as a sentence:
"Never return user credentials to the client"; "Credentials are never exposed to AI models
or your client-side code." Raw tokens *are* issued outward by Pipedream, Arcade and Nango
— but always to the *developer's backend* authenticated with the platform's own key,
never to the LLM or the MCP client. Arcade splits its own product along exactly that line.

**4. Expressiveness and containment are not actually in tension** — this is the finding
that reframes [the surface fork](004-agent-authored-js-surface.md). The real industry
axis is not code-vs-named-operations but **where the credential lives**. Cloudflare Code
Mode ships agent-authored code with *zero* credential exposure using bindings, in an
isolate where `fetch()` throws: "the AI cannot possibly write code that leaks any keys…
solving a common security problem seen in AI-authored code today." Merge allows arbitrary
request shape with `{{API_KEY}}` templates substituted server-side. So "keep arbitrary
JavaScript" and "the agent never holds the plaintext" can both be true.

**5. Redaction is universally hygiene, never a boundary** — and vendors disclaim it in
their own docs: GitHub ("automatic redaction is **not guaranteed**", it "relies on finding
an exact match"), GitLab ("masking… is **not a guaranteed way** to prevent malicious users
from accessing variable values"), CircleCI ("**many ways** that secrets masking could be
bypassed"). Bypasses (base64, splitting, JSON-wrapping, reversal) are documented
behaviour, not CVEs. The closest analogue to our insider threat is GitHub's posture:
anyone who can author workflow code simply **has** read access to every secret, and they
say so rather than pretending otherwise.

**6. Anthropic's own containment line is the sharpest published statement:** "If
credentials never enter the sandbox, they can't be exfiltrated, regardless of whether the
cause is a user, a model finding a 'creative' path, or an attacker." Their Cowork incident
also shows egress *allowlists* being used as the exfiltration channel — directly relevant,
since our perimeter is an egress allowlist.

**One claim not re-verified:** the research also quotes the spec as admitting it "cannot
enforce these security principles at the protocol level". That is consistent with the
spec's overview page but was not independently confirmed in this session; treat it as
uncorroborated until someone checks it. It matters only as colour — the substantive point
(a server has no protocol means to require that a human approved a tool call, so anything
Visvine wants enforced Visvine must enforce) is independently obvious from the protocol.
