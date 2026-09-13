/**
 * Local-dev seed — the base layer of the Visvine HQ space.
 *
 * The space's identity, node types, aliases and sub-spaces all live in
 * scripts/seed/space.ts, which every other layer reads too: the demo space is
 * named ONCE. This file owns the wipe, the space row, the grants and the two
 * anchor users for the /dev/login picker:
 *
 *   - admin@local.dev    (Admin + Team — the one who manages the space)
 *   - member@local.dev   (Champion — a customer-side operator)
 *
 * The full alias vocabulary is still seeded, so aliases with no holder
 * (Advisor, Board, and the organisation labels) remain available to hand out
 * from the console — they are the permission model, not a property of who
 * happens to be seeded. What each one reaches is documented on ALIASES in
 * scripts/seed/space.ts, and the grant paths line up with the folders
 * scripts/add-visvine-hq-notes.ts builds, so the layers on top of this one land
 * on real notes.
 *
 * This seed is only the base: `pnpm db:hq:full` runs it and then the directory,
 * notes, extras, connector and placeholder layers.
 *
 * NOTE: this wipes the whole local DB before creating anything.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { ADMIN_ALIAS_ID, ADMIN_ALIAS_NAME } from "../lib/types/context";
import { nameKey } from "../lib/identity/normalize";
import { rebuildGlobalRecords } from "../lib/global/record";
import { syncActionNotes } from "../lib/actions/sync";
import { createNote, ensureRootIndex, SHARED_OWNER_KEY } from "../lib/notes/store";
import {
  ALIASES,
  ANCHORS,
  EDIT,
  NODE_TYPES,
  SPACE_COUNTRY,
  SPACE_DESCRIPTION,
  SPACE_GRANTS,
  SPACE_ID,
  SPACE_LOCATION,
  SPACE_NAME,
  SPACE_TAGS,
  SPACE_TIMEZONE,
  SUBSPACES,
  seedAliasId,
  VIEW,
} from "../scripts/seed/space";

assertLocalTarget();

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
      description: SPACE_DESCRIPTION,
      location: SPACE_LOCATION,
      tags: [...SPACE_TAGS],
      country: SPACE_COUNTRY,
      timezone: SPACE_TIMEZONE,
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
        subtitle: a.profile.subtitle,
        bio: a.profile.bio,
        location: a.profile.location,
        website: a.profile.website,
        phone: a.profile.phone,
        pronouns: a.profile.pronouns,
        createdAt: new Date(Date.now() - a.profile.joinedDaysAgo * 86_400_000),
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
        subtitle: a.profile.subtitle,
        location: a.profile.location,
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
    for (const userId of sub.members) {
      await prisma.spaceMember.create({ data: { userId, spaceId: sub.id } });
    }
    // The creator holds the sub-space's own Admin alias — separate admins,
    // whatever they are to the parent.
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
  // The platform's global space: one public record per person the seed made
  // public. Note this is a DIFFERENT space from the one above — id `visvine`,
  // owned by the platform, with its own access rules (lib/spaces/globalSpace.ts).
  const global = await rebuildGlobalRecords();
  console.log(`Global record: ${global.records} record(s) from ${global.identities} identit(ies).`);
  // One note per action and per recipe, in that same global space: what the MCP
  // gateway reads to tell an agent what Visvine can do, and what an admin edits
  // to improve it.
  const synced = await syncActionNotes();
  console.log(`Global context: ${synced.actions} action note(s), ${synced.recipes} recipe note(s).`);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Seed complete in ${elapsed}s.`);
  console.log("Anchor users (sign in via /dev/login):");
  for (const a of ANCHORS) {
    console.log(`  ${a.email.padEnd(24)}  →  ${a.name} (${a.aliases.join(", ")})`);
  }
  console.log("\nPerson aliases (Console → Types):");
  for (const a of ALIASES.filter((x) => x.nodeType === "Person")) {
    const reach = a.system
      ? "is admin of the space"
      : a.grants.map(([p, l]) => `${p || "everything"} ${l === EDIT ? "edit" : "view"}`).join(", ") || "nothing yet";
    console.log(`  ${a.name.padEnd(14)}  →  ${reach}`);
  }
  console.log("\nNext: `pnpm db:hq:full` for the directory, notes, extras and machinery.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
