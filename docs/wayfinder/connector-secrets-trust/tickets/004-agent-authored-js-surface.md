# Is agent-authored JavaScript an acceptable surface for secret-touching code?

<!-- labels: wayfinder:grilling -->
parent: ../map.md
status: open
assignee:
blocked-by: 002, 003

## Question

The sharpest fork on the map. `run_connector` today lets a client we don't operate write
arbitrary JavaScript that executes with plaintext secrets bound into `env`. Decide
whether that is a surface we are willing to stand behind, given a prompt-injectable agent
and a motivated member.

The fork, roughly:

- **Keep arbitrary code**, and accept that the secret is reachable by any code the agent
  writes — meaning the security boundary can only ever be the *perimeter* (what the
  credential can be used against), never confidentiality of the credential itself.
- **Named operations only**: the connector note declares operations an admin authored;
  the agent chooses one and supplies arguments. Secret-touching code becomes
  admin-written, so the agent never holds the pen next to the plaintext.
- **Something in between** — arbitrary code but no plaintext in scope (e.g. an opaque
  handle the isolate can spend but not read), or arbitrary code for non-secret
  connectors and named operations for secret ones.

Weigh honestly: the connector's whole appeal is that an agent can write JavaScript
against a documented API without us pre-modelling every call, and named operations
sacrifice exactly that. The point of this ticket is to decide whether the appeal is worth
what it costs, not to assume either way.

Depends on [the exfiltration inventory](002-exfiltration-channel-inventory.md) — if the
return channel is defeatable at will, "the secret is confidential from the agent" is not
a claim we can make under the current surface, and the fork tilts. Depends on
[the trust tiers](003-trust-tiers-and-principal.md) for whether the answer can differ by
tier rather than being one global rule.

**The fork is less binary than it looks — established by
[the landscape research](001-credential-landscape.md):**

- The real industry axis is **not** code-vs-named-operations, it is **where the credential
  lives**. Cloudflare Code Mode runs agent-authored code with *zero* credential exposure
  by handing it bindings in an isolate where `fetch()` throws; Merge accepts an arbitrary
  request shape and substitutes `{{API_KEY}}` server-side. Both keep the expressiveness
  that makes connectors worth having while the agent never holds the plaintext.
- So option three above ("arbitrary code but no plaintext in scope") is not a hedge — it
  is what the two most relevant precedents actually built, and it should probably be the
  leading candidate rather than the compromise.
- Anthropic's containment line is the cleanest statement of why: "If credentials never
  enter the sandbox, they can't be exfiltrated, regardless of whether the cause is a user,
  a model finding a 'creative' path, or an attacker." Note it dissolves this map's two
  threats at once, which no intent-based control can do.
- Counterweight to keep honest: a capability handle stops code *reading* the credential,
  not *spending* the authority. Whatever we choose, the agent still acts as the connector
  upstream — so this ticket cannot fully answer "what can a hijacked agent do to our
  Stripe account", only "can it walk away with the key".

Output: a decision on the surface, with the reasoning that made it, and an explicit
statement of what we are consequently *unable* to promise a space about their credentials.
