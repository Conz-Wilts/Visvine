# How does everyone else hand credentials to an agent they don't run?

<!-- labels: wayfinder:research -->
parent: ../map.md
ticket: ../tickets/001-credential-landscape.md
status: draft

_Research only. This document establishes what the field does and says. It does not
propose what Visvine should do; the closing section is descriptive._

---

## Vocabulary (read this first)

Terms used throughout, defined once.

- **Confused deputy.** A program that holds more authority than its caller, and can be
  tricked into using that authority on the caller's behalf. Classic 1988 example: a
  compiler that can write to a protected billing file, tricked by a user into naming
  that file as its output path. The compiler is the "deputy": it isn't malicious, it's
  *confused* about whose authority it is acting under. Every "our server holds the
  secret, someone else tells it what to do" design is a potential confused deputy.
- **Token exchange.** Trading one credential for a different, usually weaker, one at a
  trusted issuer. Standardised as RFC 8693.
- **Downscoping.** Producing a credential that can do strictly less than the one you
  started with — fewer permissions, fewer resources, shorter life. The output of a
  successful token exchange.
- **Token passthrough.** An intermediary accepting a token that was issued for someone
  else and forwarding it unchanged to a downstream API. Explicitly forbidden in MCP.
- **Sender-constrained / proof-of-possession token.** A token that only works if the
  presenter also holds a private key (RFC 9449 "DPoP"). Stealing the token alone is
  useless.
- **Impersonation vs delegation.** Impersonation: the resulting token looks exactly like
  the user, and the downstream service cannot tell anyone else was involved. Delegation:
  the token says "B is acting on behalf of A", and the downstream service can see both.
- **Upstream.** The third-party service the credential is *for* (Slack, HubSpot, a
  customer's REST API). "Requires upstream cooperation" means the mitigation is
  impossible unless that service has built support for it.

---

## 1. The confused-deputy problem in MCP

### Plain English

The MCP specification has a lot to say about credentials, and one thing it says is
directly on point: **a third-party credential held by an MCP server must never be handed
to the MCP client.** That is a normative `MUST NOT` in the current specification, stated
twice, in the section that describes exactly Visvine's situation (an MCP server that is
an OAuth client to some other service on the user's behalf).

But note precisely what the spec forbids and what it does not. It forbids the secret
*transiting the client* — appearing on the MCP wire, in the LLM's context window, in a
tool result. It does **not** have a named pattern for "the client authors code that runs
on our server with the secret in scope and can print whatever it likes." That case is
not addressed by the spec at all. The nearest published thinking on it is Anthropic's
own engineering guidance on sandboxing agents, which takes the harder line: if the
credential is in the sandbox, treat it as exfiltratable.

The spec's own "confused deputy" section is a *narrower* thing than the general term: it
describes a specific OAuth consent-cookie attack, not the general question of an
intermediary being steered by an untrusted caller.

### Detail

**a) The explicit prohibition on credentials reaching the client.**

MCP's elicitation specification (present in `2025-11-25` and carried into the current
`2026-07-28` revision) covers the pattern where "the MCP server needs credentials for
[a] third-party service". It states four "critical security requirements", of which the
first is:

> **The third-party credentials MUST NOT transit through the MCP client**: The client
> must never see third-party credentials to protect the security boundary

and later, unambiguously:

> Credentials obtained via URL mode elicitation are distinct from the MCP server
> credentials used by the MCP client. The MCP server **MUST NOT** transmit credentials
> obtained through URL mode elicitation to the MCP client.

The rationale given for the whole URL-mode mechanism is:

> This approach ensures that sensitive credentials never pass through the LLM context,
> MCP client or any intermediate MCP servers, reducing the risk of exposure through
> client-side logging or other attack vectors.

There is a matching prohibition on the collection side — servers **MUST NOT** ask for
secrets over the MCP wire at all:

> Servers **MUST NOT** use form mode elicitation to request sensitive information such
> as passwords, API keys, access tokens, or payment credentials

Sources (spec, normative):
- <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation>
- <https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation>

The shape the spec endorses is: user hands the secret to the *server* out of band (a
browser page on the server's own domain), the server stores it bound to that user's
identity, and **all subsequent use is server-side**. The client is told only "go to this
URL"; it is never given the value, and it never sees the outbound API call.

**b) "Confused deputy" as a named pattern in MCP — narrower than you'd expect.**

The MCP Security Best Practices document has a section literally titled *Confused Deputy
Problem*. It is about one concrete OAuth attack, not the general principle:

> Attackers can exploit MCP proxy servers that connect to third-party APIs, creating
> "confused deputy" vulnerabilities. This attack allows malicious clients to obtain
> authorization codes without proper user consent by exploiting the combination of
> static client IDs, dynamic client registration, and consent cookies.

The vulnerable conditions are enumerated (static upstream client ID + dynamic client
registration + upstream consent cookie + no per-client consent at the MCP server), and
the mitigation is per-client consent storage, consent UI requirements, strict
`redirect_uri` matching, and `state` handling.

This matters for reading the map correctly: **the spec's "confused deputy" section does
not cover "the caller writes code that runs against our stored secret."** It covers
authorization-code theft during connection setup. Anyone citing "MCP warns about the
confused deputy problem" as covering Visvine's `run_connector` case is overreaching.

Source: <https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices>
(also served at `/specification/2025-11-25/...` and
<https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices>)

**c) Token passthrough — forbidden, and the reasoning generalises.**

> "Token passthrough" is an anti-pattern where an MCP server accepts tokens from an MCP
> client without validating that the tokens were properly issued *to the MCP server* and
> passes them through to the downstream API.

> MCP servers **MUST NOT** accept any tokens that were not explicitly issued for the MCP
> server.

The stated risks are worth reading even though Visvine does not do passthrough, because
the *reasoning* transfers to any design where the boundary between "who authorised this"
and "whose authority is being spent" blurs: security-control circumvention, broken audit
trails ("the MCP Server will be unable to identify or distinguish between MCP Clients"),
trust-boundary breakage, and — pointedly — "a malicious actor in possession of a stolen
token can use the server as a proxy for data exfiltration."

The authorization spec restates it: "If the MCP server makes requests to upstream APIs,
it may act as an OAuth client to them. The access token used at the upstream API is a
separate token, issued by the upstream authorization server. The MCP server **MUST NOT**
pass through the token it received from the MCP client."

Source: <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>

**d) What the spec says about tools and trust generally.**

The specification's top-level Security and Trust & Safety section is soft — it is
`SHOULD`, and it is aimed at *hosts*, not servers:

> Tools represent arbitrary code execution and must be treated with appropriate caution.
> ... Hosts must obtain explicit user consent before invoking any tool

and then:

> While MCP itself cannot enforce these security principles at the protocol level,
> implementors **SHOULD** [build robust consent and authorization flows...]

That last sentence is the load-bearing admission: **MCP provides no protocol-level
mechanism by which a server can require that a human approved a specific tool call.**
The server has no way to verify that the host asked. Anything a server wants enforced,
it must enforce itself.

Source: <https://modelcontextprotocol.io/specification/2025-11-25/index>

**e) Scope minimization is in the spec, and it explicitly anticipates step-up.**

The Security Best Practices doc has a *Scope Minimization* section recommending a
"minimal initial scope set", "incremental elevation via targeted `WWW-Authenticate`
`scope=\"...\"` challenges when privileged operations are first attempted", and
"down-scoping tolerance". Listed as common mistakes: "Using wildcard or omnibus scopes",
"Bundling unrelated privileges to preempt future prompts", and "Treating claimed scopes
in token as sufficient without server-side authorization logic". Same source as (c).

**f) Anthropic's own guidance — the sharpest statement in the field.**

Anthropic's engineering post *How we contain Claude across products* is not MCP-specific
but is the most directly relevant published position on "model-authored code with a
secret in scope". Their stated design rule:

> If credentials never enter the sandbox, they can't be exfiltrated, regardless of
> whether the cause is a user, a model finding a 'creative' path, or an attacker.

For Claude Cowork specifically they report that "credentials stay in the host keychain
and never enter the guest machine." They also report a concrete failure of egress
filtering: a prompt-injection payload in a mounted workspace caused Claude to call
Anthropic's own Files API using the attacker's key, i.e. exfiltration *through an
allowlisted domain* — the perimeter was intact and the data still left. Their stated
philosophy is "Design for containment at the environment layer first, then steer
behavior at the model layer", and "the deterministic boundary is what gets hit when
everything probabilistic misses."

Source: <https://www.anthropic.com/engineering/how-we-contain-claude>

Anthropic's user-facing connector guidance is correspondingly blunt about trust
direction — it warns the *user* about the *server*, not the server about the client:

> Only connect Claude to servers built and hosted by organizations and applications you
> trust.

> Custom connectors allow you to connect Claude to arbitrary services that have not been
> verified by Anthropic.

> Malicious MCP servers may include hidden instructions that try to make Claude perform
> unintended actions. Claude has built-in protections that attempt to block these
> attacks, but it's important to pay attention to tool inputs & outputs and connect only
> to trusted servers.

Source: <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp>

Note the asymmetry: Anthropic tells users to be careful about servers. Nothing in
Anthropic's or MCP's published guidance tells a *server* it may trust a client. In the
Anthropic model an MCP client (Claude) is an entity that "has built-in protections that
attempt to block these attacks" — i.e. probabilistic, best-effort, explicitly not a
guarantee.

**g) The framing everyone uses for why this is dangerous: the "lethal trifecta".**

Simon Willison's June 2025 framing — widely adopted, but a blog post, not a standard —
is that catastrophe requires three things simultaneously: access to private data,
exposure to untrusted content, and the ability to communicate externally. His stated
conclusion is that "the only way to stay safe there is to avoid that lethal trifecta
combination entirely."

Source: <https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/>

OWASP's *Top 10 for Agentic Applications* (published Dec 2025 by the OWASP GenAI
Security Project) covers adjacent risks including excessive agency, insecure tool
execution and identity/privilege abuse. I could not extract the authoritative risk list
and IDs from the landing page (the content is in a gated PDF), so I am **not** asserting
specific ASI item numbers here.
Landing page: <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>

### Summary of question 1

| Claim | Status |
| --- | --- |
| MCP forbids a server sending third-party credentials to the client | **Spec, normative `MUST NOT`** |
| MCP forbids collecting secrets over the MCP wire (form-mode elicitation) | **Spec, normative `MUST NOT`** |
| MCP forbids token passthrough | **Spec, normative `MUST NOT`** |
| MCP has a named "confused deputy" pattern | **Yes — but only the OAuth consent-cookie attack, not general steering** |
| MCP has a named pattern for "client authors code that touches our stored secret" | **No. Not addressed.** |
| MCP can enforce human approval of a tool call | **No — spec admits it "cannot enforce these security principles at the protocol level"** |
| "Credentials in the sandbox = exfiltratable" | **Anthropic engineering guidance, stated as a design rule** |

---

## 2. Token exchange and scoped credentials

### Plain English

The field's answer to "don't hand over a long-lived key" is a family of techniques that
all do the same thing in different ways: make the credential that reaches the risky place
weaker than the one you hold. Weaker in permissions, weaker in reach, weaker in lifetime,
or weaker in usability-if-stolen.

The catch, and it is the whole catch for Visvine: **almost all of them require the
upstream service to have built support.** You cannot downscope someone else's API key
from the outside. If HubSpot doesn't issue short-lived scoped tokens, no amount of
cleverness on your server produces one. The only techniques that work without upstream
cooperation are the ones where you *keep* the credential and mediate access to it —
which is to say, they are not credential techniques at all, they are architecture
techniques.

### Detail

#### 2a. OAuth 2.0 Token Exchange — RFC 8693

**What it is.** A standard token endpoint grant (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`)
where a client presents a `subject_token` and asks a Security Token Service for a
different token, optionally narrowing `scope`, `audience` and `resource`. Supports both
impersonation (result looks like the subject) and delegation (result carries an `act`
claim naming both parties, so the downstream can see "B acting for A").

**What it buys.** A credential minted for one specific downstream, one specific set of
permissions, one short lifetime, with an auditable record of who delegated to whom. The
RFC's own security framing: "The use of the `scope` claim (in addition to other typical
constraints such as a limited token lifetime) is suggested to mitigate potential for such
abuse, as it restricts the contexts in which the delegated rights can be exercised."

**What it costs.** You need an STS. You need the downstream to accept STS-issued tokens.
Every call site must handle exchange, caching and refresh.

**Upstream cooperation required:** **Yes, totally.** RFC 8693 is a protocol *between you
and the issuer*. If the upstream's authorization server has not implemented the
token-exchange grant, there is nothing to call.

Source: <https://www.rfc-editor.org/rfc/rfc8693.html>

#### 2b. Short-lived downscoped tokens (concrete implementations)

**Google Cloud "Credential Access Boundary" / downscoped tokens.** A token broker with
broad access POSTs an access token plus a boundary policy to
`https://sts.googleapis.com/v1/token` and receives a token that can do strictly less. The
documented usage pattern is exactly the one under discussion: "have a token broker with
elevated access generate these downscoped credentials from higher access source
credentials and pass the downscoped short-lived access tokens to a token consumer via
some secure authenticated channel". Note the documented limit: **only Cloud Storage
supports Credential Access Boundaries**, and only OAuth 2.0 access tokens. Even Google
has only shipped this for one product.
Source: <https://cloud.google.com/iam/docs/downscoping-short-lived-credentials>

**AWS STS session policies.** `AssumeRole` accepts an inline or managed session policy;
"the resulting session's permissions are the intersection of the role's identity-based
policy and the session policies", i.e. session policies can only restrict, never expand.
Inline policy documents are capped at 2,048 characters. This is the cleanest available
model of "issue a weaker credential per task" — and it exists only because AWS built it.
Source: <https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html>

**Upstream cooperation required:** **Yes.** These are features of Google and AWS.

#### 2c. Upstream-issued restricted keys

**Stripe restricted API keys (RAKs).** Keys prefixed `rk_live_`/`rk_test_` created in the
Stripe Dashboard, where each Stripe resource is set to Read / Write / None (default
None). Stripe's own framing: "If a bad actor obtains a restricted API key, they're
limited to that key's permissions." Operationally they are drop-in replacements for the
secret key.
Source: <https://docs.stripe.com/keys/restricted-api-keys>

**GitHub fine-grained personal access tokens.** Restricted to selected repositories, with
50+ granular permissions each set to no-access / read / read-write, and a mandatory
expiry (up to 366 days unless the org permits none).
Source: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>

**What it buys.** Blast-radius reduction with *zero* protocol work on your side — you
just store a weaker string. This is by far the cheapest mitigation available.

**What it costs.** It is a human, per-connector, out-of-band setup step. It cannot be
enforced or verified programmatically: you cannot generally tell, from holding a key,
whether it is restricted. And it is coarse — Stripe RAK granularity is per-resource, not
per-record or per-purpose.

**Upstream cooperation required:** **Yes — but pre-existing, not per-request.** You don't
negotiate with Stripe; you just use a feature they already shipped. The cooperation is
"does this vendor offer scoped keys at all", and for a long tail of small SaaS and
internal APIs the answer is no.

#### 2d. Sender-constrained tokens (per-request signing)

**DPoP — RFC 9449.** The client holds a keypair; every request carries a `DPoP` header
containing a signed JWT; the access token is bound to the public key at issuance. A
stolen token is useless without the private key. Its stated aim is "to prevent
unauthorized or illegitimate parties from using leaked or stolen access tokens".
Source: <https://datatracker.ietf.org/doc/html/rfc9449>

**Relevance and its limit.** DPoP defends against a token *exfiltrated from storage or
the network*. It does **not** defend against a party that legitimately holds the signing
key and is being steered — which is the Visvine threat. If agent-authored code had the
DPoP key in scope, it could sign whatever it liked. Sender-constraining moves the
question from "did the secret leak" to "who holds the key", it does not answer "what may
the key-holder be asked to do".

**Upstream cooperation required:** **Yes**, plus mTLS or key-management on your side.

#### 2e. Broker / proxy — the one that needs no upstream cooperation

The residual technique, and the only one that works against an uncooperative upstream, is
to **not issue anything outward at all**: keep the credential server-side and expose a
mediated interface. The credential is attached to the request at the last hop, inside
infrastructure the caller cannot read.

This is precisely what the MCP spec's URL-mode-elicitation pattern prescribes (§1a: "the
server stores credentials securely, bound to the user's identity; subsequent MCP requests
use these stored credentials for API access"), and it is what every comparable product in
§3 does.

Its security properties are entirely determined by **how expressive the mediated
interface is**. A proxy that exposes `send_slack_message(channel, text)` bounds what the
credential can do. A proxy that exposes "run this code with the credential in scope"
bounds nothing — the credential's full authority is available to the caller, minus
whatever the network perimeter blocks. That is the fork question 4 is about.

**Upstream cooperation required:** **None.** This is the point.

### Summary table for question 2

| Technique | Buys | Costs | Needs upstream cooperation? |
| --- | --- | --- | --- |
| RFC 8693 token exchange | Per-downstream, per-scope, short-lived tokens; delegation is auditable (`act` claim) | STS to run; every call site must exchange/cache/refresh | **Yes — total.** Upstream AS must implement the grant |
| Downscoped tokens (GCP CAB, AWS session policies) | Strict permission intersection, short life | Vendor-specific; GCP's is GCS-only | **Yes** |
| Upstream restricted keys (Stripe RAK, GitHub fine-grained PAT) | Blast-radius cut, ~zero engineering | Manual per-connector; unverifiable from your side; coarse | **Yes, but pre-shipped, not per-request** |
| DPoP / sender-constrained (RFC 9449) | Stolen token alone is useless | mTLS/key mgmt both ends | **Yes** — and doesn't address a steered legitimate holder |
| Broker / proxy, credential never leaves | Works against any upstream; you keep the mediation point | Security = expressiveness of the exposed interface, nothing more | **No** |

---

## 3. Comparable products

### Plain English

Eight platforms were examined. The result is unusually consistent, and it splits along one
line that turns out to be the same line the map is drawing:

**Every one of them proxies calls for the agent. None of them lets an agent write code
that touches the credential.** Some do hand out raw tokens — Pipedream, Arcade and Nango
all have documented endpoints that return a real Slack/Google access token — but always
to *the developer's own backend*, authenticated with the platform's own API key, never to
the LLM or the MCP client. Pipedream writes the rule out as a sentence in its API
reference: **"Never return user credentials to the client."**

The second consistent finding: where a platform *does* allow freeform work (rather than a
fixed menu of actions), it keeps the credential out of the caller's hands by *injecting*
it at the last hop. Merge lets you compose an arbitrary HTTP request but you write
`{{API_KEY}}` as a placeholder and Merge substitutes it server-side. Composio's proxy
tells you not to set the `Authorization` header yourself because Composio will overwrite
it. Pipedream's proxy "will look up the corresponding connected account… and
automatically insert the authorization credentials."

Where arbitrary *code* runs with a real token in scope — Pipedream components using
`this.$auth`, Composio extension tools, Arcade tools — the code is authored by a
developer ahead of time and registered, not written by the agent at call time.

That combination — freeform request shape, credential injected rather than exposed — is
the closest thing in the field to what `run_connector` is reaching for, and it is
notable that everyone who offers it stops short of exposing the value.

### Detail by platform

#### Zapier MCP — proxy only, platform-owned tools only

Tool calls run on Zapier's servers against the user's existing Zapier app connections.
The surface is either two meta-tools (`execute_zapier_read_action` /
`execute_zapier_write_action`) or, in manual mode, one dedicated tool per configured
action.
<https://docs.zapier.com/mcp/overview/how-tools-work>

Zapier states the constrained surface as a *security* property, not just an
implementation choice:

> Users cannot bring tools in from third-party sources. All tools are owned and
> controlled by Zapier, which prevents tool poisoning.

and on scoping:

> Users can only use app connections that they own or that are shared across the account

> Server access does not allow others to connect an AI client or run tools on another
> user's behalf.

<https://docs.zapier.com/mcp/manage/security>

The only secret the MCP client holds is a Zapier-issued handle, and Zapier treats it as
password-equivalent:

> Treat your connection credentials like a password. They can be used to run tools on
> this server and access your data.

<https://docs.zapier.com/mcp/get-started/authentication>

For embedded/multi-tenant use, Zapier issues a **per-user MCP server URL plus an embed
secret** — again, its own handle, never the downstream app token.
<https://docs.zapier.com/mcp/embed/connecting-your-agent>

*Not found:* Zapier nowhere states in the negative "we never send the app's OAuth token
to the MCP client." It is implied by the architecture but not written down.
*Not found:* any confused-deputy discussion in Zapier's docs.

#### Composio — proxy-preferred, masked credential read

Composio stores "connected accounts" and handles token refresh. There *is* a read path,
but it is **masked by default**:

> By default, sensitive fields in connected account responses are partially masked for
> security. This affects fields like `access_token`, `refresh_token`, `api_key`,
> `bearer_token`, `password`, and other secrets… the API returns the first 4 characters
> followed by `...`

<https://docs.composio.dev/docs/auth-configuration/connected-accounts>

The docs steer to the proxy instead: "If your use case requires calling a provider API
directly, use Proxy execute. Composio injects the connected account's credentials
server-side." The proxy page states plainly: **"Your code never handles raw
credentials"**, and warns "Don't set the `Authorization` header yourself through
`parameters`. Composio injects the correct one."
<https://docs.composio.dev/docs/extending-sessions/proxy-execute>

Composio *does* have custom tools, and this is the case worth reading carefully because
it superficially resembles `run_connector`. It is not the same: "Custom tools execute
in-process" — i.e. in the integrating developer's own process — and extension tools
"inherit auth via `extendsToolkit`… so `ctx.proxyExecute()` handles credentials
automatically." **The code holds a capability (an authenticated request function), not
the token.** The author is the developer, not the agent.
<https://docs.composio.dev/docs/extending-sessions/custom-tools-and-toolkits>

*Could not verify:* a `mask_secret_keys_in_connected_account` flag that returns raw
tokens. It appears in search snippets but is not in the current docs or their GitHub
source. Treat "you can flip a flag and get raw tokens from Composio" as **unconfirmed**.

#### Pipedream Connect — the clearest statement of the boundary

Pipedream is the most useful comparable because it does *both* and documents where the
line is.

Raw credentials **are** retrievable: `GET` retrieve-account accepts `include_credentials`,
gated on the connected account using *your own* OAuth client — and carries the verbatim
warning:

> **Never return user credentials to the client**

<https://pipedream.com/docs/connect/api-reference/retrieve-account>

The Connect API proxy is the no-credentials path: "Pipedream will look up the
corresponding connected account for the relevant user, and automatically insert the
authorization credentials in the appropriate header or URL param", sold on "not having to
deal with storing or retrieving sensitive credentials for your end users."
<https://pipedream.com/docs/connect/api-proxy>

In the **MCP** context Pipedream states the rule in the negative — the strongest such
statement found in this survey:

> all requests are made through Pipedream's servers, never directly exposing credentials
> to AI models

> Credentials are never exposed to AI models or your client-side code

<https://pipedream.com/docs/connect/mcp>

On arbitrary code: Pipedream components are Node.js modules where "`this.$auth` provides
access to OAuth tokens and API keys for Pipedream managed auth"
(<https://pipedream.com/docs/components/contributing/api>). Connect surfaces these as
actions/custom tools. So arbitrary code *does* see the raw credential — **but the code is
authored by the platform developer or the public registry, ahead of time.** No documented
path exists for an agent or end user to submit code that Pipedream runs with `$auth` in
scope.

#### Arcade.dev — dual mode, split exactly along the LLM boundary

Toward tools, stated in the negative, twice:

> OAuth token is injected into the context at runtime. LLMs and MCP clients cannot see or
> access your OAuth tokens.

> The client and the LLM will never see the token.

<https://docs.arcade.dev/en/build/create-tools/tool-basics/create-tool-auth>

Toward *your backend*, Arcade will hand over a real provider token:
`client.auth.start(...)` → `wait_for_completion(...)` → `auth_response.context.token`,
usable directly as a Google `Bearer`.
<https://docs.arcade.dev/en/build/tool-calling/call-third-party-apis>

This is the cleanest available illustration of the field's actual rule: **credential
issuance is fine toward a principal you trust and audit; it is not fine toward the LLM or
the MCP client.**

#### Nango — the counterexample that proves the rule

`GET /connections/{connectionId}` returns the OAuth2 `access_token`, `refresh_token` and
`expires_at`, auto-refreshing on each fetch, with `force_refresh` available. The proxy is
offered as the *alternative*, not the default.
<https://nango.dev/docs/reference/api/connections/get>

Nango is a backend-integration product: its caller is your server, assumed trusted.
Nothing in its documentation contemplates an untrusted third-party agent as the caller.
It is not a counter-model for Visvine; it is a different problem.

#### Merge.dev — freeform requests, zero credential exposure

The most interesting shape for this map. Passthrough lets the caller compose an arbitrary
HTTP request against the upstream — but credentials are referenced as **double-bracket
templates** (`{{API_KEY}}`, `{{PASSWORD}}`, `{{USERNAME}}`, `{{LINKED_ACCOUNT_ATTR.x}}`)
which Merge substitutes server-side. Sample responses show auth headers as `<redacted>`.
<https://docs.merge.dev/merge-unified/supplemental-data/passthrough-request/overview>

This is existence proof that "the caller needs an expressive interface" and "the caller
must never hold the secret" are **not** in conflict. You can have arbitrary request
shape with a placeholder-substitution credential model.

#### Paragon (ActionKit / MCP) — named actions, per-user signed JWT

Fixed operation names (`SLACK_SEND_MESSAGE`, `ASANA_GET_PROJECTS`,
`GOOGLE_DRIVE_SAVE_FILE`). Auth is a Paragon User Token: an RS256 JWT signed by *your*
server, presented as a bearer to the MCP endpoint.
<https://docs.useparagon.com/actionkit/api-reference> · <https://github.com/useparagon/paragon-mcp>

*Could not verify:* any explicit Paragon statement that third-party tokens are never
returned. There is no credential-read endpoint in the API reference, but there is also no
negative claim to quote.

#### Klavis AI — partially verifiable

Hosts per-integration MCP servers with OAuth and white-label OAuth; has an inbound
`set-instance_auth` endpoint for writing credentials in.
<https://www.klavis.ai/docs/auth/oauth> · <https://www.klavis.ai/docs/api-reference/mcp-server/set-instance_auth>

*Could not verify* on any primary page the widely-quoted claim that tokens "are never
exposed to the LLM or client application" — that sentence appears only in search
snippets. Do not rely on it.

### Comparison table

| Platform | Credential issued outward? | To whom | Operation surface | Explicit "LLM/client never sees the token" |
| --- | --- | --- | --- | --- |
| Zapier MCP | No | — (only a Zapier bearer / per-user URL) | Named actions, Zapier-owned only | No negative claim; instead "All tools are owned and controlled by Zapier, which prevents tool poisoning" |
| Composio | Masked (first 4 chars) by default | Your backend, via API key | Named toolkit tools + developer-authored in-process extension tools using `proxyExecute` | "Your code never handles raw credentials" |
| Pipedream Connect | **Yes** (`include_credentials`, own-OAuth-client only) | Your backend | Registry/developer Node components (`this.$auth` = real token) + API proxy | **Yes** — "Credentials are never exposed to AI models or your client-side code"; "Never return user credentials to the client" |
| Arcade.dev | **Yes** (`auth_response.context.token`) | Your backend, via Arcade API key | Named tools on Arcade workers | **Yes** — "LLMs and MCP clients cannot see or access your OAuth tokens" |
| Nango | **Yes, by design**, auto-refreshed | Your backend | Freeform (proxy or your own calls) | No — raw credentials are the product |
| Merge.dev | No | — | **Freeform HTTP with `{{VAR}}` server-side substitution** | Implicit — auth headers rendered `<redacted>` |
| Paragon | Not documented | — | Named `APP_ACTION` operations, RS256 per-user JWT | Not stated (unverified) |
| Klavis | Write-in only observed | — | Hosted per-app MCP servers / Strata router | Claimed in snippets, **not verified** |

### Two findings worth stating flatly

1. **Nobody in this set lets an agent-authored program touch the credential.** Every
   "arbitrary code with auth in scope" path found (Pipedream `this.$auth`, Composio
   extension tools, Arcade custom tools) is authored by a developer ahead of time and
   registered. The agent only ever selects among declared operations.
2. **Raw-credential issuance always points at the developer's backend, never at the
   agent.** Pipedream states the boundary as a sentence; Arcade splits its own product
   along exactly that line.

*Not found anywhere:* an explicit "confused deputy" discussion in any of these vendors'
own documentation. The nearest are Zapier's tool-poisoning line and Pipedream's
`external_user_id` coupling language.

---

## 4. Arbitrary code vs. named operations

### Plain English

There is a live, well-argued movement toward letting agents **write code** instead of
emitting one tool call at a time. Anthropic and Cloudflare both published on it in late
2025, and the arguments are good: models are far better at writing code than at chaining
tool calls, and intermediate results stay out of the model's context.

But the survey turns up something important, and it reframes the fork the ticket poses.
**The industry's split is not "code vs. named operations". It is "where does the
credential live".** The most prominent advocates of agent-written code — Cloudflare
above all — pair it with a sandbox that has *no credentials and no network*. The code is
arbitrary; the secrets are somewhere else, behind capability handles. Cloudflare says
this outright, and frames it as fixing a known failure mode:

> An additional benefit of bindings is that they hide API keys. … This means that the AI
> cannot possibly write code that leaks any keys, solving a common security problem seen
> in AI-authored code today.

So the fork is not really code-vs-menu. A design can have both agent-authored code *and*
a credential the code cannot read. Nobody found in this survey ships agent-authored code
with a plaintext credential in the execution environment.

### Detail

#### 4a. The case for code execution — Anthropic

*Code execution with MCP: building more efficient agents* (~Nov 2025).
<https://www.anthropic.com/engineering/code-execution-with-mcp>

The argument is efficiency: present MCP servers as a filesystem of code APIs and let the
agent write programs. The claimed privacy benefit is data-flow containment, not credential
containment:

> intermediate results stay in the execution environment by default. This way, the agent
> only sees what you explicitly log or return.

Sandboxing is framed as a **cost**, not a benefit:

> Running agent-generated code requires a secure execution environment with appropriate
> sandboxing, resource limits, and monitoring. These infrastructure requirements add
> operational overhead and security considerations that direct tool calls avoid.

**Notable negative finding:** the post says nothing about credentials or tokens in the
execution environment, and makes no claim that it is safe to put them there. It is
evidence for "agents should write code", not evidence for "code may hold the secret".

#### 4b. The case for code execution — Cloudflare, and how they handle credentials

*Code Mode: the better way to use MCP* (Sept 2025), <https://blog.cloudflare.com/code-mode/>;
follow-up <https://blog.cloudflare.com/code-mode-mcp/>; substrate
<https://blog.cloudflare.com/dynamic-workers/>; docs
<https://developers.cloudflare.com/agents/model-context-protocol/codemode/>.

The rationale, memorably:

> LLMs have seen a lot of code. They have not seen a lot of "tool calls."

The sandbox is a V8 isolate, and its properties are the point:

> In Code Mode, we prohibit the sandboxed worker from talking to the Internet. The global
> `fetch()` and `connect()` functions throw errors.

> Model-written code runs in an isolated Worker. Direct outbound network access is blocked
> by default.

> Generated code reaches external systems only through upstream MCP tools or a
> host-provided request callback.

The follow-up describes the environment as having "no file system, no environment
variables to leak through prompt injection". And on credentials, the single most
citable passage in the whole corpus:

> The binding itself provides an already-authorized client interface to the MCP server.
> All calls made on it go to the agent supervisor first, which holds the access tokens and
> adds them into requests sent on to MCP.

> An additional benefit of bindings is that they hide API keys. … This means that the AI
> cannot possibly write code that leaks any keys, solving a common security problem seen
> in AI-authored code today.

> Limiting access via bindings is much cleaner than doing it via, say, network-level
> filtering or HTTP proxies.

That last line is a direct, published preference for *capability handles over network
perimeters* — which is exactly the trade-off in Visvine's current design (a perimeter,
plus the secret in `env`).

The Cloudflare docs add two operational rules:

> Do not expose credentials through tool results or OpenAPI documents.

> Code execution does not replace authorization. Enforce permissions and any required
> approval inside upstream tool handlers or the host request callback before applying side
> effects.

#### 4c. Anthropic's product-side position corroborates

*Claude Code sandboxing*, <https://www.anthropic.com/engineering/claude-code-sandboxing>:

> Without network isolation, a compromised agent could exfiltrate sensitive files like SSH
> keys; without filesystem isolation, a compromised agent could easily escape the sandbox
> and gain network access.

The same post makes an argument against per-action approval as the primary control:
constant approval prompts cause "approval fatigue, where users might not pay close
attention to what they're approving, and in turn making development less safe." They
report sandboxing reduces permission prompts by 84%. (Relevant to the map's open
human-in-the-loop question, which sits downstream of this ticket.)

And, as quoted in §1f, the containment post's rule: **"If credentials never enter the
sandbox, they can't be exfiltrated."**
<https://www.anthropic.com/engineering/how-we-contain-claude>

#### 4d. Sandbox vendors — what they say about secrets in an LLM-code sandbox

**Vercel Sandbox** is the most explicit on the composition risk.
<https://vercel.com/blog/security-boundaries-in-agentic-architectures>:

> Prompt injection gives attackers influence over the agent, and code execution turns that
> influence into arbitrary actions on your infrastructure.

> Generated code inside the sandbox has no network path to the harness's secrets and no
> access to the host environment.

> Generated code can still steal the harness's credentials or, if a secret injection proxy
> is in place, misuse credentials through the proxy.

That last sentence is worth dwelling on: even the credential-injection pattern
(placeholder → proxy substitutes) does not stop the code *using* the credential
arbitrarily within the proxy's allowed destinations. It stops **reading** the value, not
**spending** the authority. Also: <https://vercel.com/kb/guide/running-ai-generated-code-sandbox>
— "Generated code is untrusted. It may delete files, leak sensitive data, or consume
excessive resources."

**Daytona** ships the placeholder-substitution model as a product.
<https://www.daytona.io/docs/en/secrets/>:

> Daytona sets that environment variable to the placeholder, not to the real value.

> When the sandbox makes an outbound HTTPS request, the proxy inspects it. If a request
> header carries a placeholder and the destination host matches the secret's allowlist,
> the proxy replaces the placeholder with the decrypted value before the request reaches
> its destination.

> For any other destination, the placeholder is forwarded unchanged. The real value is
> never sent to a host you did not approve.

> Because the substitution happens in the proxy, the plaintext value is never present
> inside the sandbox.

**Modal** publishes egress controls (`block_network=True`, `outbound_cidr_allowlist`,
`outbound_domain_allowlist`) and a workspace-scoped isolation guarantee — "the blast
radius of any malicious code will be limited to the Sandbox container itself".
<https://modal.com/docs/guide/sandbox-networking>. Modal injects secrets as env vars via
`modal.Secret`; *no* explicit warning was found saying "don't put credentials the model
shouldn't see in the sandbox env."

**E2B** documents that per-execution env scoping is not a confidentiality boundary:
"These environment variables are scoped to the command but are not private in the OS."
<https://docs.e2b.dev/sandbox/environment-variables>. No explicit "don't put secrets here"
guidance found.

*Not investigated:* Fly Machines.

#### 4e. The named-operations side, and what they say about why

- **Zapier**: constrained surface stated as security — "All tools are owned and controlled
  by Zapier, which prevents tool poisoning."
  <https://docs.zapier.com/mcp/manage/security>
- **Arcade**: "OAuth token is injected into the context at runtime. LLMs and MCP clients
  cannot see or access your OAuth tokens."
  <https://docs.arcade.dev/en/build/create-tools/tool-basics/create-tool-auth>
- **Paragon ActionKit**: fixed action names; per-user RS256 JWT.
  <https://docs.useparagon.com/actionkit/api-reference>. The claim that raw tokens are
  never exposed to the agent runtime appears in Paragon's *blog/marketing*, not in a
  security-architecture doc — treat as vendor claim.
- **OpenAI Apps SDK** security guidance, <https://developers.openai.com/apps-sdk/guides/security-privacy>:
  > Only request the scopes, storage access, and network permissions you need.
  > Avoid embedding secrets or tokens in component props.
  > Assume prompt injection and malicious inputs will reach your server.

#### 4f. The framing everyone converges on

Willison's lethal trifecta gives the cleanest statement of why "sandbox + secret + egress"
is a category, not an implementation detail. His three conditions verbatim: **"Access to
your private data"**, **"Exposure to untrusted content"**, and **"The ability to
externally communicate"** in a way that could exfiltrate data. The mechanism: "If a tool
can make an HTTP request—to an API, or to load an image, or even providing a link for a
user to click—that tool can be used to pass stolen information back to an attacker." Root
cause: "LLMs are unable to reliably distinguish the importance of instructions based on
where they came from."
<https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/>

**Every vendor above cuts exactly one leg:**

| Vendor | Leg cut | How |
| --- | --- | --- |
| Cloudflare Code Mode | private data **and** egress | bindings hold the tokens; `fetch()` throws |
| Daytona | private data | placeholder in sandbox, substituted in the egress proxy |
| Vercel Sandbox | private data (partly) | separate security contexts; secret-injection proxy outside the boundary |
| Modal | egress | `block_network`, domain/CIDR allowlists |
| Claude Code sandbox | egress | network isolation by default |
| Arcade / Zapier / Paragon | private data | credential never enters an agent-reachable environment |

#### 4g. Answering the ticket's question directly

**Is there prior art on the specific fork?** Yes, and the answer is lopsided:

- Agent-authored code with **capability handles** and no plaintext credential: Cloudflare
  Code Mode, Daytona, Merge's `{{VAR}}` templating, Composio's `proxyExecute`. Actively
  advocated, with stated reasoning.
- Developer-authored code with a **plaintext credential** in scope: Pipedream components
  (`this.$auth`), Composio extension tools, Arcade tools. Normal and accepted — because the
  author is a reviewed principal, not an agent.
- **Agent-authored code with a plaintext credential in scope: found in no surveyed
  product.** Every vendor that offers one half offers it without the other.

That absence is the finding. It is not that anyone argues against it — it is that nobody
appears to have shipped it, so there is no published defence of the position to weigh.

---

## 5. Redaction as a control

### Plain English

Nobody treats output redaction as a security boundary. This is not an inference from
critics — **it is disclaimed in the official documentation of every major CI platform that
ships masking**, in almost the same words, and for the same mechanical reason: masking
works by searching output for an exact copy of the secret, and any transformation the
emitting code chooses defeats it.

The bypasses are not exotic. Base64, URL-encoding, splitting the string, reversing it,
printing it one character at a time, wrapping it in JSON — all documented, all trivial.
GitHub's own docs tell you that if you transform a secret you must *re-register the
transformed value as a secret*, which is a tacit admission that the mechanism only covers
values it has been told about in advance.

The important structural point, and the one that lands hardest on the map's threat #2
(the human behind the agent): GitHub's model is that **anyone who can author workflow
code is a secret-holder**, full stop. They do not attempt to use masking to create a class
of person who can run code with a secret but not learn it. They state the opposite.

### Detail

#### 5a. GitHub Actions — official disclaimers

<https://docs.github.com/en/actions/reference/security/secure-use>

> Because there are multiple ways a secret value can be transformed, automatic redaction is
> not guaranteed.

> Structured data can cause secret redaction within logs to fail, because redaction largely
> relies on finding an exact match for the specific secret value.

> If a secret is transformed in some way (such as Base64 or URL-encoded), be sure to
> register the new value as a secret too.

> Redacting of secrets is performed by your workflow runners. This means a secret will only
> be redacted if it was used within a job and is accessible by the runner.

And the access-model statement, which is the analogue of the map's insider threat:

> Any user with write access to your repository have read access to all secrets configured
> in your repository.

Also, on the large-secret workaround
(<https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>):

> Be careful that your secrets do not get printed when your workflow runs. When using this
> workaround, GitHub does not redact secrets that are printed in logs.

**Documented bypass classes** (all defeat exact-match redaction): base64 (`base64 -w0` in
particular), double-encoding, URL-encoding, substring splitting, JSON/XML/YAML
encapsulation, reversal, character-by-character printing. Long-running runner issue on the
encoding gap: <https://github.com/actions/runner/issues/291>. Cross-step masking friction:
<https://github.com/orgs/community/discussions/25225>. Special-character behaviour:
<https://github.com/orgs/community/discussions/61323>.

Note that these are **not** filed as vulnerabilities — they are documented behaviour. That
is itself the answer to the ticket's question. One thing that *did* get an advisory is a
tool whose masking failed where it was expected to hold: the Vault GitHub Action's
multi-line secret masking, GHSA-4mgv-m5cm-f9h7,
<https://github.com/advisories/GHSA-4mgv-m5cm-f9h7>.

#### 5b. GitLab CI — the most explicit disclaimer

<https://docs.gitlab.com/ci/variables/>

> Masking a CI/CD variable is not a guaranteed way to prevent malicious users from
> accessing variable values. To ensure security of sensitive information, consider using
> external secrets and file type variables to prevent commands such as `env` or `printenv`
> from printing secret variables.

Masking only applies at all if the value is a single line, has no spaces, is 8+ characters,
and doesn't collide with a variable name. Further:

> If a process outputs the value in a slightly modified way, the value can't be masked. For
> example, if the shell adds `\` to escape special characters, the value isn't masked.

> When `CI_DEBUG_SERVICES` is enabled, the variable value might be revealed.

GitLab's recommended fix is to change *where the value lives* (external secret managers,
file-type variables), not to improve the filter.

#### 5c. CircleCI — "many ways… could be bypassed"

<https://circleci.com/docs/guides/security/env-vars/>

> There are many ways that secrets masking could be bypassed, either accidentally or
> maliciously.

Masking is described as "a preventative measure to catch unintentional display of secrets."
It does not apply to values under 4 characters, or to `true`/`True`/`false`/`False`; it
"will only prevent values from appearing in your job output" — not test results, not
artifacts. Bash `-x`/`-o xtrace` "may inadvertently log unmasked secrets", and values are
readable when debugging over SSH.

#### 5d. OWASP

Secrets Management Cheat Sheet,
<https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>:
secrets must "Never be logged (must implement either an encryption or masking approach in
place to avoid logging plaintext secrets)". On environment variables specifically:
"environment variables are generally accessible to all processes and may be included in
logs or system dumps. Using environment variables is therefore not recommended unless the
other methods are not possible."

Logging Cheat Sheet,
<https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>: sensitive
categories "should usually not be recorded directly in the logs, but instead should be
removed, masked, sanitized, hashed, or encrypted." Note the ordering — *removal* first,
masking as a fallback for data that must be retained in some form.

**Attribution care:** the neat phrase "masking is a detective control, not a preventive
one" is a summary of OWASP's structure, **not** a verbatim OWASP sentence. Do not quote it
as OWASP. The env-var caution above is verbatim and is the stronger line anyway.

#### 5e. The general principle

No source states it in exactly these words, so this is a synthesis, not a quote:

> Exact-match output redaction is defeated by any transformation the emitting code chooses,
> and the emitting code is the adversary's to choose whenever it is model-authored or
> model-influenced. Redaction is therefore hygiene against *accidental* disclosure and
> never a boundary against an adversary who controls the emitting process.

The closest authoritative approximations, in descending order of quotability:

1. GitHub — "Because there are multiple ways a secret value can be transformed, automatic
   redaction is not guaranteed", with the mechanical reason ("relies on finding an exact
   match").
2. GitLab — "Masking a CI/CD variable is not a guaranteed way to prevent malicious users
   from accessing variable values."
3. CircleCI — "There are many ways that secrets masking could be bypassed, either
   accidentally or maliciously."
4. Cloudflare, stating the correct fix positively — "the AI cannot possibly write code that
   leaks any keys" — achieved by never giving code the key, not by filtering what it prints.
5. Daytona, same fix, proxy flavour — "the plaintext value is never present inside the
   sandbox."

*Not investigated:* Travis CI, HashiCorp Vault, 1Password, AWS CloudWatch Logs data
protection policies.

---

## What this implies for Visvine

Descriptive only. This section names what the evidence bears on; it does not choose.

1. **The MCP spec has a directly applicable normative rule, and it is about the wire, not
   about code.** "The third-party credentials MUST NOT transit through the MCP client" and
   "The MCP server MUST NOT transmit credentials obtained through URL mode elicitation to
   the MCP client." Visvine does not transmit the secret to the client — it is decrypted
   server-side and injected into an isolate. Whether "the client authors the code that
   reads it" counts as transmission is **not settled by the spec**, because the spec does
   not contemplate the case. That gap is real and should be recorded as a gap, not papered
   over in either direction.

2. **There is no named pattern for Visvine's exact shape, and no surveyed product ships
   it.** Eight platforms were examined. Arbitrary code with a plaintext credential in scope
   exists — but always authored by a developer, never by the agent. Freeform *requests* by
   an untrusted caller exist — but always with the credential injected server-side (Merge
   templates, Composio proxy, Pipedream proxy, Cloudflare bindings, Daytona placeholders).
   The absence of prior art means there is no published defence of the position to weigh
   against, and no published attack literature specific to it either.

3. **The "code vs. named operations" fork may be the wrong axis.** The field's real axis is
   *where the credential lives*. Cloudflare demonstrates agent-authored code plus zero
   credential exposure via capability handles; Merge demonstrates arbitrary request shape
   plus zero credential exposure via placeholder substitution. If the map wants to preserve
   the expressiveness of `run_connector`, the evidence says that is not automatically in
   tension with keeping the plaintext out of the isolate. That is a design space, not a
   binary.

4. **Vercel's caveat is the one that survives even the best version of that fix.** A
   placeholder/proxy model stops the code *reading* the value; it does not stop the code
   *spending* the authority within whatever the perimeter allows: "Generated code can still
   … misuse credentials through the proxy." Whichever way the map goes, the perimeter
   (`hosts:`/`allow:`) remains the thing that bounds spend, and Anthropic's Cowork incident
   is direct evidence that an allowlisted domain can itself be an exfiltration channel.

5. **Redaction cannot be the boundary, and this is not a contested claim.** Visvine's
   `redactSecrets` is exact-string. Every CI platform that ships the same mechanism
   disclaims it in its own docs, for the same reason. Against the map's threat #1 (a
   prompt-injected agent writing `btoa(env.KEY)`) it offers nothing. Against threat #2 (a
   member with `connectors:use` deliberately reading the value) it offers nothing. It
   remains worth having as hygiene against accidental echo — GitLab, GitHub and CircleCI
   all keep theirs for exactly that reason — but it cannot carry weight in the trust model.

6. **GitHub's access model is the closest published analogue to threat #2.** GitHub does
   not attempt to create a principal who can run code with a secret but not learn it: "Any
   user with write access to your repository have read access to all secrets configured in
   your repository." If Visvine keeps agent-authored code with the secret in `env`, the
   honest equivalent statement is that `connectors:use` **is** read access to every secret
   in the space's perimeter. That is a statement the trust model can make deliberately; it
   is only a problem if it is made accidentally.

7. **Nothing in MCP lets a server require that a human approved a call.** The spec says so:
   "MCP itself cannot enforce these security principles at the protocol level." Elicitation
   is the only in-protocol channel back to the user, it is optional (clients declare the
   capability), and Anthropic's own sandboxing post argues per-action approval degrades
   through approval fatigue. Any consent requirement Visvine wants must be enforced by
   Visvine, out of band, and cannot assume a cooperating client. This bears on the map's
   "Human-in-the-loop consent" open item.

8. **Upstream-side mitigations are mostly unavailable to Visvine, as the map suspected.**
   RFC 8693 token exchange, GCP credential access boundaries and AWS session policies all
   require the upstream to have implemented them. The one cheap, real option is
   **upstream-issued restricted keys** (Stripe RAKs, GitHub fine-grained PATs) — no protocol
   work, meaningful blast-radius reduction — but it is a per-connector human step, it is
   unverifiable from Visvine's side, and the long tail of connector targets will not offer
   it. The only technique that works against an uncooperative upstream is architectural:
   keep the credential and mediate access to it, with the security determined entirely by
   how expressive the mediated interface is.

---

## Source index

**Specifications and RFCs**
- MCP Elicitation (2026-07-28): <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation>
- MCP Elicitation (2025-11-25): <https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation>
- MCP Authorization (2025-06-18): <https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization>
- MCP Security Best Practices: <https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices>
- MCP spec index / Trust & Safety: <https://modelcontextprotocol.io/specification/2025-11-25/index>
- RFC 8693, OAuth 2.0 Token Exchange: <https://www.rfc-editor.org/rfc/rfc8693.html>
- RFC 9449, DPoP: <https://datatracker.ietf.org/doc/html/rfc9449>

**Anthropic**
- How we contain Claude across products: <https://www.anthropic.com/engineering/how-we-contain-claude>
- Code execution with MCP: <https://www.anthropic.com/engineering/code-execution-with-mcp>
- Claude Code sandboxing: <https://www.anthropic.com/engineering/claude-code-sandboxing>
- Custom connectors (support): <https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp>

**Cloudflare**
- Code Mode: <https://blog.cloudflare.com/code-mode/>
- Code Mode MCP: <https://blog.cloudflare.com/code-mode-mcp/>
- Dynamic Workers: <https://blog.cloudflare.com/dynamic-workers/>
- Code Mode docs: <https://developers.cloudflare.com/agents/model-context-protocol/codemode/>

**Platforms**
- Zapier MCP: [how tools work](https://docs.zapier.com/mcp/overview/how-tools-work) · [security](https://docs.zapier.com/mcp/manage/security) · [auth](https://docs.zapier.com/mcp/get-started/authentication) · [embed](https://docs.zapier.com/mcp/embed/connecting-your-agent)
- Composio: [connected accounts](https://docs.composio.dev/docs/auth-configuration/connected-accounts) · [proxy execute](https://docs.composio.dev/docs/extending-sessions/proxy-execute) · [custom tools](https://docs.composio.dev/docs/extending-sessions/custom-tools-and-toolkits) · [sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp)
- Pipedream: [retrieve account](https://pipedream.com/docs/connect/api-reference/retrieve-account) · [API proxy](https://pipedream.com/docs/connect/api-proxy) · [Connect MCP](https://pipedream.com/docs/connect/mcp) · [components API](https://pipedream.com/docs/components/contributing/api) · [privacy & security](https://pipedream.com/docs/privacy-and-security)
- Arcade: [tool auth](https://docs.arcade.dev/en/build/create-tools/tool-basics/create-tool-auth) · [call third-party APIs](https://docs.arcade.dev/en/build/tool-calling/call-third-party-apis)
- Nango: [get connection](https://nango.dev/docs/reference/api/connections/get)
- Merge: [passthrough overview](https://docs.merge.dev/merge-unified/supplemental-data/passthrough-request/overview)
- Paragon: [ActionKit API reference](https://docs.useparagon.com/actionkit/api-reference) · [paragon-mcp](https://github.com/useparagon/paragon-mcp)
- Klavis: [OAuth](https://www.klavis.ai/docs/auth/oauth)
- OpenAI Apps SDK security: <https://developers.openai.com/apps-sdk/guides/security-privacy>

**Sandbox vendors**
- Vercel: [security boundaries](https://vercel.com/blog/security-boundaries-in-agentic-architectures) · [running AI-generated code](https://vercel.com/kb/guide/running-ai-generated-code-sandbox)
- Daytona secrets: <https://www.daytona.io/docs/en/secrets/>
- Modal sandbox networking: <https://modal.com/docs/guide/sandbox-networking>
- E2B env vars: <https://docs.e2b.dev/sandbox/environment-variables>

**Redaction / masking**
- GitHub secure use: <https://docs.github.com/en/actions/reference/security/secure-use>
- GitHub using secrets: <https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>
- GitLab CI/CD variables: <https://docs.gitlab.com/ci/variables/>
- CircleCI env vars: <https://circleci.com/docs/guides/security/env-vars/>
- OWASP Secrets Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
- OWASP Logging Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>
- GHSA-4mgv-m5cm-f9h7 (Vault Action multi-line masking): <https://github.com/advisories/GHSA-4mgv-m5cm-f9h7>

**Scoped credentials**
- Stripe restricted API keys: <https://docs.stripe.com/keys/restricted-api-keys>
- GitHub fine-grained PATs: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
- GCP Credential Access Boundaries: <https://cloud.google.com/iam/docs/downscoping-short-lived-credentials>
- AWS STS AssumeRole: <https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html>

**Framing**
- Simon Willison, the lethal trifecta: <https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/>
- OWASP Top 10 for Agentic Applications 2026: <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>

---

## Explicitly unverified

Listed so nothing here is mistaken for established fact.

- **OpenAI Code Interpreter has no network access.** Universally reported and true in
  practice, but not stated in the current API reference pages; the help-centre and
  Codex-sandbox pages returned HTTP 403. Cite as "widely documented, not in the current
  API reference."
- **Composio `mask_secret_keys_in_connected_account`** — a flag said to return raw tokens.
  Appears in search snippets; not present in current docs or their GitHub source.
- **Klavis "tokens never exposed to the LLM"** — appears only in search snippets, not on
  any primary Klavis page reached.
- **Paragon "never exposes a raw token to the agent's runtime"** — vendor blog/marketing,
  not a security-architecture doc.
- **Arcade docs pages** at `/en/home/auth/auth-tool-calling` — the "LLM never sees the
  token" phrasing was confirmed on
  `/en/build/create-tools/tool-basics/create-tool-auth` but not on the other two URLs
  search attributed it to.
- **Zapier "your MCP server URL is like a password"** — the current docs use "connection
  credentials"/"connection token" phrasing instead; the quoted sentence was not found live.
- **OWASP Agentic Top 10 item IDs** (ASI01 etc.) — the authoritative list is in a gated
  PDF; secondary sources report ASI01 as Agent Goal Hijack. Not asserted here.
- **CVE-2025-54794 / 54795 / 6514, EchoLeak, postmark-mcp** — seen only in aggregator
  summaries; primary advisories not pulled.
- **Not investigated:** Fly Machines, Travis CI, HashiCorp Vault, 1Password, AWS CloudWatch
  Logs data protection policies.
