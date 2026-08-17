# Does a secret's plaintext ever leave our server?

<!-- labels: wayfinder:grilling -->
parent: ../map.md
status: open
assignee:
blocked-by: 001, 003

## Question

The premise question, deliberately left open when the destination was named because the
human didn't yet have the grounding to answer it. Now decide it.

Is "hand the agent something it can use directly against the upstream" ever on the table
for Visvine connectors — a short-lived downscoped token, an upstream-issued restricted
key, a token exchange — or is **everything proxies through our isolate, always**?

Constraints to hold while deciding:

- Most upstreams a Visvine space connects to will not cooperate with token exchange or
  downscoping. A model that only works for Stripe and Google is not a model.
- Proxy-only is not automatically the safe answer: proxying means *we* hold and use every
  credential on every call, which concentrates risk in `SECRETS_KEY` and makes us the
  audit point for everything a space's agents do.
- The two threats in the map both live *inside* a proxied run. Issuing outward does not
  obviously make either worse; that intuition needs testing rather than assuming.

Depends on [the landscape research](001-credential-landscape.md) for what the mechanisms
actually are and cost, and on [the trust tiers](003-trust-tiers-and-principal.md) for
whether the answer may differ per tier (e.g. never outward to an unattended third-party
agent, permissible to a member's own client).

**Bring to the human:** lead with what each option means in practice for a space admin
storing a Stripe key — who ends up holding what — before any protocol names appear.

Output: a yes/no/conditional decision with the conditions named, plus the reasoning.
