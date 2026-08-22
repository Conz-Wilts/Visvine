/**
 * Local-dev seed — the base layer of the Blackbird Ventures space.
 *
 * Creates four anchor users for the /dev/login picker:
 *   - admin@local.dev    (Admin + Partner — the one who manages the space)
 *   - partner@local.dev  (Partner)
 *   - member@local.dev   (Founder)
 *   - lp@local.dev       (LP)
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
  { id: "user_dev_admin",   name: "Dev Admin",   email: "admin@local.dev",   aliases: [ADMIN_ALIAS_NAME, "Partner"], personNodeId: "person:dev_admin" },
  { id: "user_dev_partner", name: "Dev Partner", email: "partner@local.dev", aliases: ["Partner"],                   personNodeId: "person:dev_partner" },
  { id: "user_dev_member",  name: "Dev Member",  email: "member@local.dev",  aliases: ["Founder"],                   personNodeId: "person:dev_member" },
  { id: "user_dev_lp",      name: "Dev LP",      email: "lp@local.dev",      aliases: ["LP"],                        personNodeId: "person:dev_lp" },
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
  { icon: "📅", name: "Event", color: "#ef4444", shape: "rectangle" },
  { icon: "📚", name: "Resource", color: "#0d9488", shape: "circle" },
  { icon: "📝", name: "Note", color: "#8b5cf6", shape: "rectangle" },
  { icon: "🧭", name: "Sector", color: "#f97316", shape: "rectangle" },
  { icon: "📓", name: "Journal", color: "#ec4899", shape: "rectangle" },
  { icon: "🤝", name: "Meeting", color: "#14b8a6", shape: "rectangle" },
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
  nodeType: "Person" | "Space";
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
  { name: "Portfolio Company", color: "#0891b2", nodeType: "Space", admin: false, system: false, grants: [] },
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
    prisma.person.deleteMany({}),
    prisma.identityResolution.deleteMany({}),
    prisma.node.deleteMany({}),
    prisma.identity.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.space.deleteMany({}),
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
        emailVerified: true,
        isActive: true,
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
    await prisma.person.create({
      data: {
        id: a.personNodeId,
        userId: a.id,
        name: a.name,
      },
    });
  }
}

async function main() {
  const t0 = Date.now();
  await wipeData();
  await createSpace();
  await createAliases();
  await createAnchorUsers();
  await markAccessSeeded();
  // The Visvine space: one public record per person the seed made public.
  const global = await rebuildGlobalRecords();
  console.log(`Visvine: ${global.records} global record(s) from ${global.identities} identit(ies).`);
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
