# Who may attach a secret to a connector, and who may run one?

<!-- labels: wayfinder:grilling -->
parent: ../map.md
status: open
assignee:
blocked-by: 003

## Question

This is the ticket that answers threat 2 — the member who deliberately uses the sandbox
to reach a credential their role shouldn't grant them.

Today: an admin stores `ConnectorSecret` rows per space; the plaintext is never returned
by the admin API; and any caller holding the `connectors:use` scope can run any connector
in that space. So the authority to *use* a credential is space-wide and uniform, and the
grain of the permission model is the whole connector set.

Decide the authority model:

1. **Attaching.** Should storing a secret and referencing it from a connector note be
   admin-only as it is now, or does anything finer make sense? Note that whoever writes
   `connectors/<name>.md` chooses which secret names its `env` binds — check whether
   note-write authority and secret-attach authority are the same thing today, and whether
   they should be.
2. **Running.** Is `connectors:use` the right grain, or should authority be per-connector
   — and if per-connector, does it hang off the space's existing **alias** permission
   model (`SpaceAlias` + `UserSpaceAlias`, already the vocabulary for Channels and
   context grants) or off something new? Prefer reusing the alias model unless there's a
   reason it can't carry this.
3. **The gap between them.** A member who may *run* a connector can, under the current
   surface, do anything the credential can do. Is "may run" therefore equivalent to "has
   the credential", and if so should the UI say so out loud to the admin who grants it?

Depends on [the trust tiers](003-trust-tiers-and-principal.md): the principal a run acts
as determines whether this is a question about humans, clients, or both.

**Facts established by [the channel inventory](002-exfiltration-channel-inventory.md),
which sharpen this ticket considerably:**

- `connectors:use` is granted by the **end user alone** at the OAuth consent screen
  (`app/api/oauth/authorize/route.ts:117,194`) — no admin approves a client's acquisition
  of it. So today a member can hand connector-running authority to any MCP client they
  choose, unilaterally.
- **No per-connector or per-secret restriction exists.** A run receives every secret its
  note's `env:` names, and any member with the scope can run any connector they can see.
- Only *writing* connector notes is admin-gated (`contextService.ts:236-246`), so
  note-write authority and secret-attach authority are already the same thing — question
  1 below is therefore about whether that coupling is right, not whether it exists.
- Question 3 is no longer hypothetical: "may run" **is** "has the credential" under the
  current surface, in one line of JavaScript.

Output: the authority model for attaching and for running, stated as rules an
implementer could later enforce without further interpretation.
