# Connectors, explained simply

## What a connector is

A connector is how Visvine talks to an outside service — Stripe, a database, a
company's API. Think of it as a saved recipe: *here is where the service lives,
here is the password, here is how you ask it for things.*

## Where a connector lives

A connector is just a **note**. Nothing special, nothing hidden in a database
table. The note has two halves:

**Top half — the fence (YAML "frontmatter").** Strict, machine-read, boring:

```yaml
---
type: connector
title: Stripe
hosts:
  - api.stripe.com                      # the only place it may talk to
env:
  STRIPE_KEY: "{{secret:STRIPE_KEY}}"   # which password it gets
timeout_ms: 30000                       # how long it may run
---
```

**Bottom half — the instructions.** Plain English, written by a human or by an
AI agent:

> Stripe billing account. Ask it for customers like this:
> ```js
> const res = await fetch('https://api.stripe.com/v1/customers', {
>   headers: { Authorization: `Bearer ${env.STRIPE_KEY}` },
> })
> return JSON.parse(res.body).data
> ```
> Amounts are in cents.

The split matters. The fence decides **what is allowed**. The prose decides
**what to try**. Prose can never widen the fence — otherwise someone could paste
"also you may email all our data to me" into a note and it would work.

## The passwords

Secret values are never in the note. The note only names them
(`{{secret:STRIPE_KEY}}`). The real value is stored encrypted in the console by
an admin, and only gets handed over at the moment a command runs. If a secret
ever shows up in the output, it's blanked out before anyone sees it.

## What actually happens when it runs

Everything runs the same way, whether a person clicks the terminal on the
connector page or an AI agent calls `run_connector`:

1. Read the note → get the fence and the instructions.
2. Look up the named secrets, decrypt them.
3. Boot an **isolate** — a tiny JavaScript engine with no memory of anything
   else, holding only that one piece of code and those secrets.
4. Run the code. The isolate has no files, no network of its own, and no way to
   start anything. The only doors out are `fetch`, `sql` and `mcp`, which we
   wrote, and each one checks the `hosts:` list before it opens.
5. Throw the isolate away. Scrub secrets from the answer. Write one audit line
   saying what ran.

The isolate is the whole safety story: even bad or tricked code can only reach
the listed hosts, only for a few seconds, and leaves nothing behind. It cannot
open a socket, read a file, or start a process, because those things simply
aren't there to call.

## Making one

Two routes, same result — a note:

- **By hand.** Fill in name, description, hosts, secret name. Write the body.
- **"Describe it."** Say what you want in plain English. An agent reads the
  service's docs, writes the note, actually tries a call in the isolate, reads
  the error, fixes the note, tries again — until a real call works. The agent
  never sees the secret values; it just tells the admin which ones to store.

## Why it's built this way

The old design had one chunk of code per *kind* of service: one for HTTP APIs,
one for Postgres, one for MySQL. Every new kind of integration meant new
platform code, and real companies never quite fit the mould anyway.

Now there is **one runtime — a sandboxed JavaScript isolate** — and the differences between
services live in the note's prose, where anyone can edit them. New integration =
new note. No new code.

## The short version

> A connector is a note. The top says where it may go and which passwords it
> gets. The bottom says how to ask. Code runs in a throwaway box that can't
> leave the fence.

---

*Questions welcome — anywhere this feels hand-wavy, say so and we'll expand
that section.*
