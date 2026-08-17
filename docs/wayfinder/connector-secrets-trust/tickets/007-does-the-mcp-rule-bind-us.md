# Does the MCP spec's third-party-credential rule bind us?

<!-- labels: wayfinder:grilling -->
parent: ../map.md
status: open
assignee:
blocked-by:

## Question

Surfaced by [the landscape research](001-credential-landscape.md). The MCP elicitation
spec (`2026-07-28`) states as a critical security requirement:

> **The third-party credentials MUST NOT transit through the MCP client**: The client
> must never see third-party credentials to protect the security boundary

Decide whether Visvine is bound by this, and say so in a way we'd be willing to publish.

The honest tension:

- **The letter.** The rule sits in the *elicitation* spec and is scoped to credentials a
  server obtains **via URL-mode elicitation**. Visvine's `ConnectorSecret` values are
  typed in by an admin in our own console, not elicited over MCP. On a literal reading,
  the rule does not reach us.
- **The spirit.** The stated rationale is "the client must never see third-party
  credentials to protect the security boundary". Under the current surface a client can
  read a credential out in one line
  ([the channel inventory](002-exfiltration-channel-inventory.md)). If the rule's purpose
  is that boundary, we are on the wrong side of it however the credential was acquired.
- **The gap.** The spec's confused-deputy section is narrower than the general term and
  does **not** contemplate a client authoring code that runs on the server with the
  secret in scope. So there is no rule that squarely addresses us, and no exemption
  either. We are in genuinely uncovered territory.

Decide: (a) the rule binds us in spirit and the trust model adopts "the client must never
see a third-party credential" as a constraint; (b) it does not apply and we state our own
constraint instead, on the record, with reasoning; or (c) it applies conditionally —
e.g. it binds any credential we ever obtain through an MCP-facing flow, while
admin-entered secrets follow a separate rule we author.

This is a **positioning** decision as much as a security one. Whatever we choose becomes
what we tell a space admin about their Stripe key, and what a security reviewer will
measure us against. It should be decidable without the other tickets, which is why it is
unblocked — but if it turns out to presuppose the trust tiers, block it on
[003](003-trust-tiers-and-principal.md) rather than forcing an answer.

Output: a stated position on the rule's applicability, plus the one-sentence constraint
we adopt as our own.
