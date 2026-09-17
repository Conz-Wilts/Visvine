# Rooms in a house — the sub-space model, from the ground up

The model, worked out from first principles, and now what is built.
`docs/sub-spaces.md` is the code map — which column, function, route and
surface carries each dial — and the reasons behind the mechanics. This file
is the shape of the answer and why it has that shape.

## The problem in one paragraph

A **space** holds people, context, tools, connectors, agents and events. Some
spaces belong inside another: a VC fund runs an accelerator; a company has
departments; a community has a members' council; an accelerator hosts its
startups. Every one of those pairs wants different answers to the same three
questions — *who can see the inner space exists, who may walk in, and what
crosses the wall between them* — and a fourth about who holds the keys. The
mistake to avoid is a single "sub-space" that answers all of them one way.
The design below gives each inner space four dials, each owned by the side
that owns the thing, and shows that every structure people actually build is
a setting of those dials.

## Vocabulary

- A **house** is a space that holds others. A **room** is a space inside a
  house. Nesting is one level: a room never holds rooms. (Every rule below
  is stated for one house and one room; a third level would need each rule
  restated for a chain, and nobody has asked for it.)
- **The world** means anyone signed in who is not in the house or the room.
- **The house's members** means active members of the house. Membership is
  never shared between a house and its rooms: entering a room does not enter
  the house, and vice versa. That independence is the whole point — it is
  what lets outsiders join Blackbird's accelerator without joining Blackbird.

## The four dials

### Dial 1 — Listing: who can see the room exists

| value | who sees the door (name, blurb, member count) | where it is listed |
|---|---|---|
| `secret` | members and invite-link holders only | nowhere — not on the house's directory, not on Discover |
| `house` | the house's members | the house's directory |
| `world` | everyone | Discover **and** the house's directory |

Listing is the room's own setting, in the room's console. "Make this room
invisible at the top level" is `secret`. A room that is `world` is
discoverable by people who cannot see the house at all; the house's name is
only shown beside it to people who can see the house.

A top-level house has the same dial with two values: `secret` (private,
invite only) and `world` (on Discover). It has no `house` above it.

### Dial 2 — Door: who may enter without an invite

Two doors, one per audience, each set to one of:

| value | what happens when someone who can see the room presses Join |
|---|---|
| `invite` | nothing to press — entry is by invite link or an admin adding them |
| `ask` | a request lands; an admin of the **room** approves or declines |
| `open` | they are in |

- **House door** — for the house's members. Meaningful when listing is
  `house` or `world`.
- **World door** — for everyone else. Meaningful only when listing is
  `world`.

One rule: **the world's door is never wider than the house's.** A room that
lets strangers walk in cannot make its own house's members ask.

A `secret` room has no doors; both are `invite`.

### Dial 3 — Flows: what crosses the wall

Each flow is one switch. **The side that owns the thing owns the switch.**

**Upward — owned by the room.** Requires listing `house` or `world`; a
`secret` room flows nothing up, because a folder or an event carrying its
name would reveal it.

| flow | what the house's members get | default |
|---|---|---|
| `context` | the room's shared context as one folder in the house's tree, under the room's name, inside the house's `Sub-spaces` folder (placeable elsewhere) | on when listed |
| `events` | the room's public events on the house's calendar, badged with the room | on when listed |
| `people` | the room's directory (people and organisations) in the house's directory, badged; one row per person (same identity folds, house's record wins, rooms listed) | off |

Through the wall you are who you are in the room. A house member who is
**also in the room** reads and edits its folder as they would inside it —
the folder is a shortcut, not a second set of rights. Anyone else reads
through the **room's own everyone-grant**: whatever the room shows all of
its members, capped to view. A house admin who is not in the room reads no
more through the wall than a house member does; one who governs it
(governance, below) stands in it and edits as its admin.

**Downward — owned by the house, per item, with a recipient list.** Nothing
flows down unless the house says so, and it says so per thing:

| item | what a named room gets | how it runs |
|---|---|---|
| a connector | it can run it; its agents can name it in `connectors:` | with the **house's** secrets, in the house's perimeter, on the house's quota; the room cannot see or set secrets |
| an agent (`use`) | the room's agents can start it with `run_agent`; its members can read the brief | in the **house**, as the brief's author, with the house's reach |
| an agent (`run-in`) | a copy runs in the room, over the **room's** context | as the house brief's author, who must therefore hold standing in the room (see governance) |
| a Tool | it is installed in the room | inside the room, under the room member's own grants |
| a model key | the room's agents run on the house's key | the house pays |

`share: all` shares with every current and future room; `share: [a, b]`
shares with named rooms only. Per-room selection is not optional: a house
whose rooms have different audiences (an internal deal team and a public
accelerator) will share its CRM with one and not the other. Sharing a
connector that holds a **space-level** OAuth account into a room whose
world door is open lends the house's account to strangers — the console
should say so before it lets you.

### Dial 4 — Governance: who holds the keys

- The room's own admins always administer it.
- `house admins govern this room` — on or off. **Default on** when a house
  admin creates the room (they hold its admin alias anyway); the room can
  switch it off later to become autonomous, and once off, only the room's
  own admins can switch it back on. A house cannot reclaim a room that has
  chosen autonomy — that is what makes hosting other people's spaces
  honest.

Governance is what makes `run-in` agents possible: a house author whose
house governs the room has standing there; one whose house does not, does
not, and the copy is refused rather than run with borrowed rights.

## Presets: the structures people build are dial settings

A room is created from a preset; every preset is just the four dials filled
in, and every dial stays editable afterwards.

| preset | listing | house door | world door | up: context / events / people | down (by the house) | governed by house |
|---|---|---|---|---|---|---|
| **Department** — Engineering inside a company | `house` | `open` | — | on / on / on | `share: all` | on |
| **Programme** — an accelerator run by a fund | `world` | `open` | `ask` | on / on / off | chosen items only | on |
| **Committee** — a deal committee inside a fund | `secret` | `invite` | — | off / off / off | chosen items only | on |
| **Council** — a members' council inside a public community | `house` | `ask` | — | on / on / off | chosen items only | on |
| **Tenant** — a startup's own space hosted by an accelerator | `house` or `secret` | `invite` | — | off / on / off | a "perks" connector, if any | **off** |
| **Topic room** — a room in an open network | `world` | `open` | `open` | on / on / on | `share: all` | on |

## The six structures, worked through

For each, what each audience sees and can do. **S** = a stranger, **H** = a
member of the house, **R** = a member of the room, **HA** = an admin of the
house.

### 1. Private house, public room — Blackbird and its accelerator

Blackbird (`secret` house) runs an accelerator (`world` room, world door
`ask`, house door `open`).

- **S** finds "Accelerator" on Discover with no house named beside it, asks
  to join, is approved by a room admin, and never sees Blackbird.
- **H** (a Blackbird partner) sees the room in Blackbird's switcher and
  walks in.
- **HA** reads the accelerator's context and events in Blackbird's tree and
  calendar; Blackbird shares its `cohort-onboarding` agent and a `calendly`
  connector into the room and its `crm` connector into the deal team only.
- **R** (a founder in the cohort) sees `parent/` holding the two shared
  items, can run the connector without ever seeing a key, and cannot see
  the deal team or the fund.

### 2. Private house, secret room — Blackbird and its deal committee

`secret` room, no doors, nothing flows up.

- **S** and **H** cannot see it exists. It is not in Blackbird's tree,
  switcher or calendar.
- **R** enters by invite only. Blackbird shares `crm` into it. HA governs it.

### 3. Public house, private room — a community and its members' council

`world` house; council is a `house` room with house door `ask`.

- **S** sees the community on Discover and can join it; sees no council.
- **H** sees the council's door in the switcher and the context tree, asks,
  and waits for a council admin.
- Council context and events flow up: **H** reads the council's minutes
  folder read-only until let in, and edits it from the community's tree
  once a member.

### 4. A company and its departments

`house` rooms, house door `open`, everything up, `share: all` down, governed
by the house.

- Any employee walks into any department. The founder administers all of
  them. The company's connectors and agents are usable in every department
  with one set of secrets. Each department's context appears in the company
  tree as its own folder. The company's weekly-digest agent, shared
  `run-in`, runs once per department over that department's notes.

### 5. An accelerator and its startups — the umbrella

Each startup is a `house`-listed room with an `invite` door, **context up
off**, events up on, governance **off**.

- Founders of other startups see that a room exists and cannot enter.
- The accelerator's staff cannot read a startup's notes and are not its
  admins. They see the startup's public demo-day event on the programme
  calendar.
- The accelerator shares a `perks` connector with all rooms; nothing else.
- A startup can leave autonomy off, or turn it on; the accelerator cannot
  turn it back off.

### 6. An open network and its topic rooms

`world` house, `world` rooms, every door `open`, everything up and down.

- Anyone joins anything. The rooms' context, events and people all show at
  the top. Tools installed at the top are installed in every room.

## Invalid or degenerate settings, and what the console does

- `world` door wider than `house` door → refused; the console clamps the
  world door to the house door.
- Any upward flow on a `secret` room → not offered; the switches are shown
  disabled with the reason.
- `run-in` agent shared into a room the house does not govern → refused at
  share time, naming the room.
- A `secret` room that later goes `house` or `world` → its upward flows
  come on at their defaults, and the console says so before the change.
- A room turned `secret` from `world` → it leaves Discover and the house's
  switcher on the next read; existing members keep membership; pending asks are kept
  (the room's admins still answer them).
- Governance switched off → house admins lose admin standing in the room on
  the next request; anyone who *also* holds the room's own admin alias keeps
  it. The switch cannot be undone from the house.

## Implemented

Everything above is built (2026-09-15): the four dials as columns on
`spaces` (`listing`, `house_door`, `world_door`, `flow_context`,
`flow_events`, `flow_people`, `parent_admins`) plus the house's
`subspace_config`; presets in the New sub-space dialog; per-item, per-room
`share:` on connector, agent and Tool notes; `share_as: run-in` agents;
model keys flowing down by the house's choice; a member of a room editing
its context from the house's tree. `docs/sub-spaces.md` names every piece.
