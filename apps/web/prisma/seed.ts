/**
 * Local-dev seed — the base layer of the Blackbird Ventures community.
 *
 * Creates four anchor users for the /dev/login picker:
 *   - admin@local.dev    (Owner + Partner — the one who manages the community)
 *   - partner@local.dev  (Partner)
 *   - member@local.dev   (Founder)
 *   - lp@local.dev       (LP)
 *
 * Plus the community itself and its aliases, spread across the permission model
 * so every shape of grant is represented:
 *
 *   Owner      system, owns the community — built in, cannot be changed
 *   Partner    edit on communities/, deals/ and data/ — the working set
 *   Founder    view on communities/
 *   Investor   view on communities/ and sectors/
 *   Employee   view on communities/ and people/
 *   LP         view on one note only — the tightest grant there is
 *   Everyone   view on sectors/ (the community-wide grant)
 *
 * `communities/` is where a portfolio company's note lives — an organisation IS
 * a community, so company notes share the directory with them (lib/notes/entities.ts).
 *
 * The grant paths line up with the brain `add-blackbird-notes.mjs` builds, so
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
import { OWNER_ALIAS, OWNER_ALIAS_NAME } from "../lib/types/context";

assertLocalTarget();

const COMMUNITY_ID = "community:blackbird-ventures";
const COMMUNITY_NAME = "Blackbird Ventures";

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
  { id: "user_dev_admin",   name: "Dev Admin",   email: "admin@local.dev",   aliases: [OWNER_ALIAS_NAME, "Partner"], personNodeId: "person:dev_admin" },
  { id: "user_dev_partner", name: "Dev Partner", email: "partner@local.dev", aliases: ["Partner"],                   personNodeId: "person:dev_partner" },
  { id: "user_dev_member",  name: "Dev Member",  email: "member@local.dev",  aliases: ["Founder"],                   personNodeId: "person:dev_member" },
  { id: "user_dev_lp",      name: "Dev LP",      email: "lp@local.dev",      aliases: ["LP"],                        personNodeId: "person:dev_lp" },
];

/** Access levels, mirrored from lib/notes/shared/authz.ts (seed stays dep-free). */
const VIEW = 10;
const EDIT = 30;

/**
 * The node types this community uses. Written explicitly because the schema
 * default omits Resource, and the layers above seed events and resources.
 */
const NODE_TYPES = [
  { icon: "👤", name: "Person", color: "#2563eb", shape: "rectangle" },
  { icon: "🏘️", name: "Community", color: "#78d870", shape: "square" },
  { icon: "📅", name: "Event", color: "#ef4444", shape: "rectangle" },
  { icon: "📚", name: "Resource", color: "#0d9488", shape: "circle" },
];

interface SeedAlias {
  name: string;
  /** Chip colour in the directory — the same alias, seen from the graph. */
  color: string;
  /** The base node type this alias labels. Only Person aliases grant access. */
  nodeType: "Person" | "Community";
  owner: boolean;
  system: boolean;
  /** [resourcePath, level] — '' is the brain root. */
  grants: Array<[string, number]>;
}

/**
 * The community's aliases, stored in `Community.communityAliases` exactly as
 * the console writes them. The Person ones are the permission vocabulary; the
 * Community ones are directory labels with no access meaning.
 */
const ALIASES: SeedAlias[] = [
  {
    // Owners manage the community outright; no grant needed to see everything.
    name: OWNER_ALIAS_NAME,
    color: OWNER_ALIAS.color,
    nodeType: "Person",
    owner: true,
    system: true,
    grants: [],
  },
  {
    name: "Partner",
    color: "#7c3aed",
    nodeType: "Person",
    owner: false,
    system: false,
    grants: [["communities", EDIT], ["deals", EDIT], ["data", EDIT]],
  },
  {
    name: "Founder",
    color: "#16a34a",
    nodeType: "Person",
    owner: false,
    system: false,
    grants: [["communities", VIEW]],
  },
  {
    name: "Investor",
    color: "#0ea5e9",
    nodeType: "Person",
    owner: false,
    system: false,
    grants: [["communities", VIEW], ["sectors", VIEW]],
  },
  {
    name: "Employee",
    color: "#db2777",
    nodeType: "Person",
    owner: false,
    system: false,
    grants: [["communities", VIEW], ["people", VIEW]],
  },
  {
    name: "LP",
    color: "#d97706",
    nodeType: "Person",
    owner: false,
    system: false,
    grants: [["data/fund-roll-up.md", VIEW]],
  },
  { name: "Portfolio Company", color: "#0891b2", nodeType: "Community", owner: false, system: false, grants: [] },
  { name: "Fund", color: "#0f766e", nodeType: "Community", owner: false, system: false, grants: [] },
];

/** What every member reaches without holding anything — the "Everyone" card. */
const COMMUNITY_GRANTS: Array<[string, number]> = [["sectors", VIEW]];

async function wipeData() {
  console.log("Wiping existing data…");
  // Delete in dependency order. Anything with onDelete: Cascade is wiped by the
  // parent deletes; the rest are explicit — including the tables that carry a
  // communityId with no FK behind it, which would otherwise orphan. Of those,
  // communityColumn matters most: it is unique on (communityId, columnKey), so
  // a leftover row collides when a community with the same id is recreated.
  await prisma.$transaction([
    prisma.link.deleteMany({}),
    prisma.attendee.deleteMany({}),
    prisma.privateColumnValue.deleteMany({}),
    prisma.privateColumn.deleteMany({}),
    prisma.communityColumnValue.deleteMany({}),
    prisma.communityColumn.deleteMany({}),
    prisma.communityColumnRequest.deleteMany({}),
    prisma.valueShareRequest.deleteMany({}),
    prisma.postCommentReaction.deleteMany({}),
    prisma.postComment.deleteMany({}),
    prisma.postReaction.deleteMany({}),
    prisma.postImage.deleteMany({}),
    prisma.post.deleteMany({}),
    prisma.resourceComment.deleteMany({}),
    prisma.resourceChange.deleteMany({}),
    prisma.resource.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.userCommunity.deleteMany({}),
    prisma.person.deleteMany({}),
    prisma.node.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.community.deleteMany({}),
  ]);
}

async function createCommunity() {
  console.log(`Creating ${COMMUNITY_NAME}…`);
  await prisma.community.create({
    data: {
      id: COMMUNITY_ID,
      name: COMMUNITY_NAME,
      description:
        "Blackbird Ventures is a leading Australian & New Zealand venture capital firm. " +
        "This community maps its portfolio companies and the founders behind them.",
      location: "Sydney, Australia",
      tags: ["VC", "Portfolio", "Australia", "New Zealand"],
      country: "AU",
      emoji: "🐦",
      nodeTypes: NODE_TYPES,
    },
  });
}

/**
 * Record that this community's access is already established. Without it the
 * first brain touch grandfathers every member a root grant (lib/notes/access.ts
 * #ensureAccessSeeded), which would swamp the alias grants above with blanket
 * edit-everywhere and make the seeded permissions meaningless.
 */
async function markAccessSeeded() {
  await prisma.communityBrainFile.upsert({
    where: {
      brain_file_identity: { communityId: COMMUNITY_ID, ownerKey: "shared", name: "access-state.json" },
    },
    create: {
      communityId: COMMUNITY_ID,
      ownerKey: "shared",
      name: "access-state.json",
      content: JSON.stringify({ seededAt: Date.now(), seededFrom: "aliases" }, null, 2),
    },
    update: {},
  });
}

/** Write the aliases onto the community, then grant what each one reaches. */
async function createAliases() {
  console.log("Creating aliases…");
  await prisma.community.update({
    where: { id: COMMUNITY_ID },
    data: {
      communityAliases: ALIASES.map((a) => ({
        name: a.name,
        color: a.color,
        nodeType: a.nodeType,
        ...(a.owner ? { owner: true } : {}),
        ...(a.system ? { system: true } : {}),
      })),
    },
  });
  const grants = [
    ...ALIASES.flatMap((a) =>
      a.grants.map(([resourcePath, level]) => ({
        communityId: COMMUNITY_ID,
        subjectType: "alias",
        subjectId: a.name, // alias grants are keyed by NAME
        resourcePath,
        level,
        grantedBy: ANCHORS[0].id,
      })),
    ),
    ...COMMUNITY_GRANTS.map(([resourcePath, level]) => ({
      communityId: COMMUNITY_ID,
      subjectType: "community",
      subjectId: "",
      resourcePath,
      level,
      grantedBy: ANCHORS[0].id,
    })),
  ];
  if (grants.length) await prisma.brainGrant.createMany({ data: grants });
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
    await prisma.userCommunity.create({
      data: {
        userId: a.id,
        communityId: COMMUNITY_ID,
      },
    });
    for (const aliasName of a.aliases) {
      if (!ALIASES.some((x) => x.name === aliasName && x.nodeType === "Person")) {
        throw new Error(`seed: anchor ${a.email} wants unknown Person alias "${aliasName}"`);
      }
      await prisma.userAlias.create({
        data: { communityId: COMMUNITY_ID, userId: a.id, aliasName, addedBy: ANCHORS[0].id },
      });
    }
    await prisma.node.create({
      data: {
        id: a.personNodeId,
        type: "person",
        name: a.name,
        communityId: COMMUNITY_ID,
        alias: a.aliases.find((n) => n !== OWNER_ALIAS_NAME) ?? null,
        metadata: { seeded: true, anchor: true },
      },
    });
    await prisma.person.create({
      data: {
        id: a.personNodeId,
        userId: a.id,
        name: a.name,
        hasOnboarded: true,
      },
    });
  }
  await prisma.community.update({
    where: { id: COMMUNITY_ID },
    data: { memberCount: ANCHORS.length },
  });
}

async function main() {
  const t0 = Date.now();
  await wipeData();
  await createCommunity();
  await createAliases();
  await createAnchorUsers();
  await markAccessSeeded();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Seed complete in ${elapsed}s.`);
  console.log("Anchor users (sign in via /dev/login):");
  for (const a of ANCHORS) {
    console.log(`  ${a.email.padEnd(24)}  →  ${a.name} (${a.aliases.join(", ")})`);
  }
  console.log("\nPerson aliases (Console → Aliases):");
  for (const a of ALIASES.filter((x) => x.nodeType === "Person")) {
    const reach = a.system
      ? "owns the community"
      : a.grants.map(([p, l]) => `${p || "everything"} ${l === EDIT ? "edit" : "view"}`).join(", ") || "nothing yet";
    console.log(`  ${a.name.padEnd(14)}  →  ${reach}`);
  }
  console.log("\nNext: `pnpm db:blackbird:full` for the portfolio, brain and extras.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
