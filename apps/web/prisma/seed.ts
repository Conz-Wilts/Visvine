/**
 * Local-dev seed.
 *
 * Creates exactly two anchor users for the /dev/login picker:
 *   - admin@local.dev  (admin)
 *   - member@local.dev (member)
 *
 * Plus a single "local-dev" Community to scope them. NZ ecosystem content
 * (events, resources, organizations) is loaded separately via
 * `pnpm db:nz` (apps/web/scripts/add-nz-ecosystem.mjs).
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

assertLocalTarget();

const COMMUNITY_ID = "community:local-dev";
const COMMUNITY_NAME = "Local Dev Community";

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
  anchorRole: "admin" | "member";
  personNodeId: string;
}

const ANCHORS: Anchor[] = [
  { id: "user_dev_admin",  name: "Dev Admin",  email: "admin@local.dev",  anchorRole: "admin",  personNodeId: "person:dev_admin" },
  { id: "user_dev_member", name: "Dev Member", email: "member@local.dev", anchorRole: "member", personNodeId: "person:dev_member" },
];

async function wipeData() {
  console.log("Wiping existing data…");
  // Delete in dependency order. Anything with onDelete: Cascade is wiped
  // by the parent deletes; the rest are explicit.
  await prisma.$transaction([
    prisma.link.deleteMany({}),
    prisma.attendee.deleteMany({}),
    prisma.privateColumnValue.deleteMany({}),
    prisma.privateColumn.deleteMany({}),
    prisma.communityColumnValue.deleteMany({}),
    prisma.communityColumn.deleteMany({}),
    prisma.communityColumnRequest.deleteMany({}),
    prisma.userCommunity.deleteMany({}),
    prisma.person.deleteMany({}),
    prisma.node.deleteMany({}),
    prisma.user.deleteMany({}),
    prisma.community.deleteMany({}),
  ]);
}

async function createCommunity() {
  console.log("Creating local-dev community…");
  await prisma.community.create({
    data: {
      id: COMMUNITY_ID,
      name: COMMUNITY_NAME,
      description: "Local development scaffolding community. NZ ecosystem content lives in community:nz-ecosystem (pnpm db:nz).",
      country: "NZ",
    },
  });
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
        role: a.anchorRole,
      },
    });
    await prisma.node.create({
      data: {
        id: a.personNodeId,
        type: "person",
        name: a.name,
        communityId: COMMUNITY_ID,
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
}

async function main() {
  const t0 = Date.now();
  await wipeData();
  await createCommunity();
  await createAnchorUsers();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Seed complete in ${elapsed}s.`);
  console.log("Anchor users (sign in via /dev/login):");
  for (const a of ANCHORS) console.log(`  ${a.email.padEnd(24)}  →  ${a.name} (${a.anchorRole})`);
  console.log("\nNext: run `pnpm db:nz` to populate the NZ startup ecosystem community.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
