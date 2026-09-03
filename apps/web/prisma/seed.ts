/**
 * Local-dev seed — the base layer of the Blackbird Ventures space.
 *
 * Creates two anchor users for the /dev/login picker:
 *   - admin@local.dev    (Admin + Partner — the one who manages the space)
 *   - member@local.dev   (Founder)
 *
 * The full alias vocabulary is still seeded, so aliases with no holder
 * (Investor, Employee, LP) remain available to hand out from the console —
 * they are the permission model, not a property of who happens to be seeded.
 *
 * Plus the space itself and its aliases, spread across the permission model
 * so every shape of grant is represented:
 *
 *   Admin      system, is admin of the space — built in, cannot be changed
 *   Partner    edit on communities/, deals/ and data/ — the working set
 *   Founder    view on communities/
 *   Investor   view on communities/ and sectors/
 *   Employee   view on communities/ and people/
 *   LP         view on one note only — the tightest grant there is
 *   Everyone   view on sectors/ (the space-wide grant)
 *
 * `communities/` is where a portfolio company's note lives — an organisation IS
 * a space, so company notes share the directory with them (lib/notes/entities.ts).
 *
 * The grant paths line up with the context `add-blackbird-notes.mjs` builds, so
 * the layers on top of this one land on real folders. This seed is only the
 * base: `pnpm db:blackbird:full` runs it and then the directory, notes, extras
 * and connector layers.
 *
 * NOTE: this wipes the whole local DB before creating anything.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { ADMIN_ALIAS, ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from "../lib/types/context";
import { nameKey } from "../lib/identity/normalize";
import { rebuildGlobalRecords } from "../lib/global/record";
import { syncActionNotes } from "../lib/actions/sync";
import { createNote, ensureRootIndex, SHARED_OWNER_KEY } from "../lib/notes/store";

assertLocalTarget();

const SPACE_ID = "community:blackbird-ventures";
const SPACE_NAME = "Blackbird Ventures";

const connectionString =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? "")}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null);
if (!connectionString) throw new Error("seed: no DATABASE_URL resolved");
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function assertLocalTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed: refusing to run with NODE_ENV=production");
  }
  if (process.env.CLOUD_SQL_CONNECTION_NAME) {
    throw new Error(
      "seed: CLOUD_SQL_CONNECTION_NAME is set — env looks pointed at prod via Cloud SQL Auth Proxy",
    );
  }
  const url =
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL ||
    (process.env.DB_HOST ? `postgresql://x:x@${process.env.DB_HOST}/${process.env.DB_NAME ?? ""}` : null);
  if (!url) throw new Error("seed: no DATABASE_URL resolved");
  const host = new URL(url).hostname;
  const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "postgres", "visvine-postgres"]);
  if (!LOCAL.has(host)) {
    throw new Error(`seed: refusing — DATABASE_URL host "${host}" is not local`);
  }
}

interface Anchor {
  id: string;
  name: string;
  email: string;
  /** Aliases this anchor holds, by alias name. */
  aliases: string[];
  personNodeId: string;
}

const ANCHORS: Anchor[] = [
  { id: "user_dev_admin",  name: "Dev Admin",  email: "admin@local.dev",  aliases: [ADMIN_ALIAS_NAME, "Partner"], personNodeId: "person:dev_admin" },
  { id: "user_dev_member", name: "Dev Member", email: "member@local.dev", aliases: ["Founder"],                   personNodeId: "person:dev_member" },
];

/** Access levels, mirrored from lib/notes/shared/authz.ts (seed stays dep-free). */
const VIEW = 10;
const EDIT = 30;

/**
 * The node types this space uses. Written explicitly because the schema
 * default omits Resource, and the layers above seed events and resources.
 *
 * The second group is the note vocabulary: every `type:` the seeded notes write
 * into their frontmatter. A type a note claims but the console never created is
 * a type nothing can filter, colour or alias — so the console declares them all,
 * and a note's Type chip always names something real. Add a type here whenever
 * a new one is written into note frontmatter (scripts/add-blackbird-notes.mjs).
 */
const NODE_TYPES = [
  { icon: "👤", name: "Person", color: "#2563eb", shape: "rectangle" },
  { icon: "🏘️", name: "Space", color: "#78d870", shape: "square" },
  // A portfolio company is a RECORD, not a tenant: it has a directory card and a
  // context note (communities/<slug>/index.md, the org namespace — see
  // lib/notes/entities.ts) but no space of its own. `company` folds onto
  // `space` in TYPE_SYNONYMS, so the
  // entity machinery keeps working; declaring the type here is what makes the
  // space's own spelling win in findNodeTypeConfig and paints it its own colour.
  { icon: "🏢", name: "Company", color: "#0891b2", shape: "square" },
  { icon: "📅", name: "Event", color: "#ef4444", shape: "rectangle" },
  { icon: "📚", name: "Resource", color: "#0d9488", shape: "circle" },
  { icon: "📝", name: "Note", color: "#8b5cf6", shape: "rectangle" },
  { icon: "🧭", name: "Sector", color: "#f97316", shape: "rectangle" },
  { icon: "📓", name: "Journal", color: "#ec4899", shape: "rectangle" },
  { icon: "🤝", name: "Meeting", color: "#14b8a6", shape: "rectangle" },
  // Structural/document built-ins the demo layers create nodes for (channels,
  // sections, connectors, agents). Because this list is explicit, omitting one
  // hides it from the console's Types page even though DEFAULT_NODE_TYPES knows
  // it — so every kind a seed script writes is declared. Colours match
  // lib/types/context.ts DEFAULT_NODE_TYPES. `Tool` stays out on purpose: it is
  // a RESERVED machine type (lib/types/nodeTypeRegistry.ts) the console must
  // never offer to a note picker.
  { icon: "🧩", name: "Section", color: "#0ea5e9", shape: "square" },
  { icon: "💬", name: "Channel", color: "#e0685f", shape: "rectangle" },
  { icon: "🔌", name: "Connector", color: "#6366f1", shape: "rectangle" },
  { icon: "🤖", name: "Agent", color: "#0d9488", shape: "rectangle" },
  // Note vocabulary the placeholder layers write (`type: Deal` frontmatter on
  // pipeline notes) — scoped to notes, the way the draft-context surface would
  // have created it.
  { icon: "💼", name: "Deal", color: "#b45309", shape: "rectangle", scope: "note" },
];

/**
 * A seeded alias's stable id. Derived from the name so re-seeding is
 * reproducible — everywhere else ids are random, but a seed that produced a
 * different id each run would make holder and grant rows unfixable by hand.
 * The built-in Admin keeps its reserved id.
 */
function seedAliasId(name: string): string {
  return name === ADMIN_ALIAS_NAME ? ADMIN_ALIAS_ID : `al_seed_${name.toLowerCase().replace(/\W+/g, "-")}`;
}

interface SeedAlias {
  name: string;
  /** Chip colour in the directory — the same alias, seen from the graph. */
  color: string;
  /** The base node type this alias labels. Only Person aliases grant access. */
  nodeType: "Person" | "Space" | "Company";
  admin: boolean;
  system: boolean;
  /** [resourcePath, level] — '' is the context root. */
  grants: Array<[string, number]>;
}

/**
 * The space's aliases, stored in `Space.aliases` exactly as
 * the console writes them. The Person ones are the permission vocabulary; the
 * Space ones are directory labels with no access meaning.
 */
const ALIASES: SeedAlias[] = [
  {
    // Owners manage the space outright; no grant needed to see everything.
    name: ADMIN_ALIAS_NAME,
    color: ADMIN_ALIAS.color,
    nodeType: "Person",
    admin: true,
    system: true,
    grants: [],
  },
  {
    name: "Partner",
    color: "#7c3aed",
    nodeType: "Person",
    admin: false,
    system: false,
    grants: [["communities", EDIT], ["deals", EDIT], ["data", EDIT]],
  },
  {
    name: "Founder",
    color: "#16a34a",
    nodeType: "Person",
    admin: false,
    system: false,
    grants: [["communities", VIEW]],
  },
  {
    name: "Investor",
    color: "#0ea5e9",
    nodeType: "Person",
    admin: false,
    system: false,
    grants: [["communities", VIEW], ["sectors", VIEW]],
  },
  {
    name: "Employee",
    color: "#db2777",
    nodeType: "Person",
    admin: false,
    system: false,
    grants: [["communities", VIEW], ["people", VIEW]],
  },
  {
    name: "LP",
    color: "#d97706",
    nodeType: "Person",
    admin: false,
    system: false,
    grants: [["data/fund-roll-up.md", VIEW]],
  },
  { name: "Portfolio Company", color: "#0891b2", nodeType: "Company", admin: false, system: false, grants: [] },
  { name: "Fund", color: "#0f766e", nodeType: "Space", admin: false, system: false, grants: [] },
];

/** What every member reaches without holding anything — the "Everyone" card. */
const SPACE_GRANTS: Array<[string, number]> = [["sectors", VIEW]];

async function wipeData() {
  console.log("Wiping existing data…");
  // Delete in dependency order. Anything with onDelete: Cascade is wiped by the
  // parent deletes; the rest are explicit — including the tables that carry a
  // spaceId with no FK behind it, which would otherwise orphan.
  await prisma.$transaction([
    prisma.link.deleteMany({}),
    prisma.eventAttendee.deleteMany({}),
    prisma.resourceComment.deleteMany({}),
    prisma.resourceChange.deleteMany({}),
    prisma.resource.deleteMany({}),
    prisma.resourceFolder.deleteMany({}),
    prisma.spaceMember.deleteMany({}),
    prisma.identityResolution.deleteMany({}),
    prisma.node.deleteMany({}),
    prisma.identity.deleteMany({}),
    prisma.user.deleteMany({}),
    // Sub-spaces before their parents: the parent relation is Restrict, so one
    // statement over both would refuse the parent while its child still stands.
    prisma.space.deleteMany({ where: { parentId: { not: null } } }),
    prisma.space.deleteMany({}),
    // The marketplace registry is deliberately NOT space-foreign-keyed — a
    // published version must outlive the space that authored it, because other
    // spaces may have it installed. That is right in production and wrong for a
    // local wipe: with every space gone there is no install left to protect, and
    // skipping this left one orphaned row per Tool per reseed, accumulating
    // forever. Last, so the Restrict FK from app_tool_installs is already
    // satisfied by the cascade from the space delete above.
    prisma.appToolVersion.deleteMany({}),
  ]);
}

async function createSpace() {
  console.log(`Creating ${SPACE_NAME}…`);
  await prisma.space.create({
    data: {
      id: SPACE_ID,
      name: SPACE_NAME,
      description:
        "Blackbird Ventures is a leading Australian & New Zealand venture capital firm. " +
        "This space maps its portfolio companies and the founders behind them.",
      location: "Sydney, Australia",
      tags: ["VC", "Portfolio", "Australia", "New Zealand"],
      country: "AU",
      nodeTypes: NODE_TYPES,
      // Demo content is meant to show up in Discover; the column default is private.
      visibility: "public",
    },
  });
}

/**
 * Record that this space's access is already established. Without it the
 * first context touch grandfathers every member a root grant (lib/notes/access.ts
 * #ensureAccessSeeded), which would swamp the alias grants above with blanket
 * edit-everywhere and make the seeded permissions meaningless.
 */
async function markAccessSeeded() {
  await prisma.contextState.upsert({
    where: {
      context_state_identity: { spaceId: SPACE_ID, ownerKey: "shared", name: "access-state.json" },
    },
    create: {
      spaceId: SPACE_ID,
      ownerKey: "shared",
      name: "access-state.json",
      content: JSON.stringify({ seededAt: Date.now(), seededFrom: "aliases" }, null, 2),
    },
    update: {},
  });
}

/** Write the aliases onto the space, then grant what each one reaches. */
async function createAliases() {
  console.log("Creating aliases…");
  await prisma.space.update({
    where: { id: SPACE_ID },
    data: {
      aliases: ALIASES.map((a) => ({
        id: seedAliasId(a.name),
        name: a.name,
        color: a.color,
        nodeType: a.nodeType,
        ...(a.admin ? { admin: true } : {}),
        ...(a.system ? { system: true } : {}),
      })),
    },
  });
  const grants = [
    ...ALIASES.flatMap((a) =>
      a.grants.map(([resourcePath, level]) => ({
        spaceId: SPACE_ID,
        subjectType: "alias",
        subjectId: seedAliasId(a.name), // alias grants are keyed by the alias ID
        resourcePath,
        level,
        grantedBy: ANCHORS[0].id,
      })),
    ),
    ...SPACE_GRANTS.map(([resourcePath, level]) => ({
      spaceId: SPACE_ID,
      subjectType: "space",
      subjectId: "",
      resourcePath,
      level,
      grantedBy: ANCHORS[0].id,
    })),
  ];
  if (grants.length) await prisma.contextGrant.createMany({ data: grants });
}

async function createAnchorUsers() {
  console.log("Creating anchor users…");
  for (const a of ANCHORS) {
    await prisma.user.create({
      data: {
        id: a.id,
        email: a.email,
        name: a.name,
        isActive: true,
        // Their own node: the anchor card created for them in the space below.
        nodeId: a.personNodeId,
      },
    });
    await prisma.spaceMember.create({
      data: {
        userId: a.id,
        spaceId: SPACE_ID,
      },
    });
    for (const aliasName of a.aliases) {
      if (!ALIASES.some((x) => x.name === aliasName && x.nodeType === "Person")) {
        throw new Error(`seed: anchor ${a.email} wants unknown Person alias "${aliasName}"`);
      }
      await prisma.userAlias.create({
        data: {
          spaceId: SPACE_ID,
          userId: a.id,
          aliasId: seedAliasId(aliasName),
          addedBy: ANCHORS[0].id,
        },
      });
    }
    // The member connection. A person node carries a profile only when it is
    // linked to a registered User through an Identity — that link, not the
    // Person row, is what the Profile tab reads (lib/identity/connection.ts).
    // Seeding the node without it left every anchor looking at "Not connected
    // to a member yet" on their own profile.
    const identity = await prisma.identity.create({
      data: {
        kind: "person",
        canonicalName: a.name,
        nameKey: nameKey(a.name),
        email: a.email,
        verified: true,
        userId: a.id,
      },
    });
    await prisma.node.create({
      data: {
        id: a.personNodeId,
        type: "person",
        name: a.name,
        spaceId: SPACE_ID,
        alias: a.aliases.find((n) => n !== ADMIN_ALIAS_NAME) ?? null,
        metadata: { seeded: true, anchor: true },
        identityId: identity.id,
      },
    });
    await prisma.identityResolution.create({
      data: {
        nodeId: a.personNodeId,
        identityId: identity.id,
        decision: "confirmed",
        confidence: 1,
        reason: "seeded anchor",
      },
    });
  }
}

/**
 * Two sub-spaces of Blackbird (docs/sub-spaces.md), one of each kind, so the
 * flow-up rule is on screen from the first seed: Founders Network is PUBLIC —
 * its context appears in Blackbird's tree under spaces/, read-only — and
 * Investment Committee is PRIVATE, its own tenant with nothing showing above.
 * Dev Admin administers both (they created them); Dev Member is in the public
 * one only, so signing in as them shows exactly what a parent's member sees.
 */
const SUBSPACES = [
  {
    id: "blackbird-founders-network",
    name: "Founders Network",
    description: "Blackbird's founder community: office hours, playbooks and the people running them.",
    visibility: "public",
    members: [ANCHORS[0], ANCHORS[1]],
    notes: [
      {
        path: "playbooks/office-hours.md",
        content:
          "---\ntype: Note\ntitle: Office hours\ntags: [founders, playbook]\n---\n\n# Office hours\n\nEvery Thursday. Book through the [founders index](/index.md); a partner takes the first slot.\n",
      },
      {
        path: "playbooks/first-hire.md",
        content:
          "---\ntype: Note\ntitle: The first hire\ntags: [founders, playbook, hiring]\n---\n\n# The first hire\n\nHire for the thing you are worst at. See [office hours](office-hours.md) to talk it through.\n",
      },
    ],
  },
  {
    id: "blackbird-investment-committee",
    name: "Investment Committee",
    description: "Deal memos and IC decisions. Private to the committee.",
    visibility: "private",
    members: [ANCHORS[0]],
    notes: [
      {
        path: "memos/2026-q3.md",
        content:
          "---\ntype: Note\ntitle: Q3 2026 memo\ntags: [ic, memo]\n---\n\n# Q3 2026 memo\n\nThree deals reviewed, one approved. Not for the wider firm.\n",
      },
    ],
  },
] as const;

async function createSubspaces() {
  console.log("Creating sub-spaces…");
  const actor = { id: ANCHORS[0].id, name: ANCHORS[0].name, email: ANCHORS[0].email };
  for (const sub of SUBSPACES) {
    await prisma.space.create({
      data: {
        id: sub.id,
        name: sub.name,
        description: sub.description,
        visibility: sub.visibility,
        parentId: SPACE_ID,
        // Every optional tool off, as a fresh sub-space starts (lib/featureAccess).
        featureConfig: { enabled: { channels: false } },
      },
    });
    for (const m of sub.members) {
      await prisma.spaceMember.create({ data: { userId: m.id, spaceId: sub.id } });
    }
    // The creator holds the sub-space's own Admin alias — separate admins,
    // whatever they are to Blackbird.
    await prisma.userAlias.create({
      data: { spaceId: sub.id, userId: ANCHORS[0].id, aliasId: ADMIN_ALIAS_ID, addedBy: ANCHORS[0].id },
    });
    await prisma.contextState.create({
      data: {
        spaceId: sub.id,
        ownerKey: "shared",
        name: "access-state.json",
        content: JSON.stringify({ seededAt: Date.now(), seededFrom: "aliases" }, null, 2),
      },
    });
    // What a public sub-space shows its parent is what it shows everyone in
    // it: the root view grant provisionSpace writes for one (lib/spaces/provision.ts).
    if (sub.visibility === "public") {
      await prisma.contextGrant.create({
        data: { spaceId: sub.id, subjectType: "space", subjectId: "", resourcePath: "", level: VIEW, grantedBy: ANCHORS[0].id },
      });
    }
    const context = { spaceId: sub.id, ownerKey: SHARED_OWNER_KEY };
    await ensureRootIndex(context, sub.name, actor);
    for (const note of sub.notes) {
      await createNote(context, note.path, note.content, actor);
    }
  }
}

async function main() {
  const t0 = Date.now();
  await wipeData();
  await createSpace();
  await createAliases();
  await createAnchorUsers();
  await markAccessSeeded();
  await createSubspaces();
  // The Visvine space: one public record per person the seed made public.
  const global = await rebuildGlobalRecords();
  console.log(`Visvine: ${global.records} global record(s) from ${global.identities} identit(ies).`);
  // One note per action and per recipe, in that same space: what the MCP
  // gateway reads to tell an agent what Visvine can do, and what an admin edits
  // to improve it.
  const synced = await syncActionNotes();
  console.log(`Visvine Context: ${synced.actions} action note(s), ${synced.recipes} recipe note(s).`);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Seed complete in ${elapsed}s.`);
  console.log("Anchor users (sign in via /dev/login):");
  for (const a of ANCHORS) {
    console.log(`  ${a.email.padEnd(24)}  →  ${a.name} (${a.aliases.join(", ")})`);
  }
  console.log("\nPerson aliases (Console → Aliases):");
  for (const a of ALIASES.filter((x) => x.nodeType === "Person")) {
    const reach = a.system
      ? "is admin of the space"
      : a.grants.map(([p, l]) => `${p || "everything"} ${l === EDIT ? "edit" : "view"}`).join(", ") || "nothing yet";
    console.log(`  ${a.name.padEnd(14)}  →  ${reach}`);
  }
  console.log("\nNext: `pnpm db:blackbird:full` for the portfolio, context and extras.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
