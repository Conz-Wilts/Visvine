/**
 * Migration script: upload local node/community/person images to GCS
 * Run with: pnpm --filter=web exec tsx ../../scripts/migrate-to-gcs.ts
 *
 * GCS structure:
 *   <media-bucket>/
 *     cards/{nodeId}/{variant}.webp
 *     communities/{communityId}/{variant}.webp
 *     persons/{personId}/{variant}.webp
 *
 * Prerequisites:
 *  - gcloud auth application-default login
 *  - Cloud SQL proxy running (pnpm db:proxy)
 *  - apps/web/.env populated with GCS_PROJECT_ID + bucket names
 */

import { Storage } from '@google-cloud/storage';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import sharp from 'sharp';
import { readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

// ---------------------------------------------------------------------------
// Load env from apps/web/.env
// ---------------------------------------------------------------------------
config({ path: path.join(__dirname, '../apps/web/.env') });

const MEDIA_BUCKET = process.env.GCS_MEDIA_BUCKET;
if (!MEDIA_BUCKET) {
  console.error('ERROR: GCS_MEDIA_BUCKET is not set in apps/web/.env');
  process.exit(1);
}
const NODE_IMAGES_DIR = path.join(__dirname, '../apps/web/public/uploads/node_images');
const RESOURCES_DIR   = path.join(__dirname, '../apps/web/public/uploads/resources');

const AVATAR_VARIANTS = [
  { name: 'original',  size: 1080, quality: 82 },
  { name: 'avatar-lg', size: 400,  quality: 80 },
  { name: 'avatar-md', size: 200,  quality: 78 },
  { name: 'avatar-sm', size: 64,   quality: 75 },
] as const;

// ---------------------------------------------------------------------------
// GCS client (uses ADC — no key file needed, project inferred from ADC)
// ---------------------------------------------------------------------------
const storage = new Storage();
const bucket  = storage.bucket(MEDIA_BUCKET);

// ---------------------------------------------------------------------------
// Prisma client
// ---------------------------------------------------------------------------
const connectionString =
  process.env.DATABASE_URL ??
  `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`;

const pool    = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as any);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function uploadVariants(prefix: string, buffer: Buffer): Promise<void> {
  const base = sharp(buffer).rotate(); // auto-rotate, strips EXIF by default

  await Promise.all(
    AVATAR_VARIANTS.map(async ({ name, size, quality }) => {
      const processed = await base
        .clone()
        .resize(size, size, { fit: 'cover', position: 'attention' })
        .webp({ quality, effort: 4 })
        .toBuffer();

      const file = bucket.file(`${prefix}/${name}.webp`);
      await file.save(processed, { contentType: 'image/webp' });
    })
  );
}

function publicUrl(prefix: string, variant = 'avatar-lg'): string {
  return `https://storage.googleapis.com/${MEDIA_BUCKET}/${prefix}/${variant}.webp`;
}

/** Find a local file for an id regardless of extension */
async function findLocalFile(id: string): Promise<string | null> {
  if (!existsSync(NODE_IMAGES_DIR)) return null;
  const files = await readdir(NODE_IMAGES_DIR);
  const match = files.find(f => f.startsWith(id + '.'));
  return match ? path.join(NODE_IMAGES_DIR, match) : null;
}

function isLocalUrl(url: string | null): boolean {
  return !!url && url.startsWith('/uploads/');
}

type MigrateResult = { migrated: number; skipped: number; failed: string[] };

// ---------------------------------------------------------------------------
// Migrate cards (Node table)
// ---------------------------------------------------------------------------
async function migrateCards(): Promise<MigrateResult> {
  const nodes = await prisma.node.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });

  console.log(`\nFound ${nodes.length} nodes (cards) with images`);

  let migrated = 0, skipped = 0;
  const failed: string[] = [];

  for (const node of nodes) {
    if (!isLocalUrl(node.imageUrl)) { skipped++; continue; }

    const localFile = await findLocalFile(node.id);
    if (!localFile) {
      console.warn(`  ⚠ No local file for card ${node.id} (was: ${node.imageUrl})`);
      failed.push(node.id);
      continue;
    }

    try {
      const buffer = await readFile(localFile);
      const prefix = `cards/${node.id}`;
      await uploadVariants(prefix, buffer);
      await prisma.node.update({ where: { id: node.id }, data: { imageUrl: publicUrl(prefix) } });
      console.log(`  ✓ card ${node.id}`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ card ${node.id}:`, err);
      failed.push(node.id);
    }
  }

  return { migrated, skipped, failed };
}

// ---------------------------------------------------------------------------
// Migrate communities
// ---------------------------------------------------------------------------
async function migrateCommunities(): Promise<MigrateResult> {
  const communities = await prisma.community.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });

  console.log(`\nFound ${communities.length} communities with images`);

  let migrated = 0, skipped = 0;
  const failed: string[] = [];

  for (const community of communities) {
    if (!isLocalUrl(community.imageUrl)) { skipped++; continue; }

    const localFile = await findLocalFile(community.id);
    if (!localFile) {
      console.warn(`  ⚠ No local file for community ${community.id}`);
      failed.push(community.id);
      continue;
    }

    try {
      const buffer = await readFile(localFile);
      const prefix = `communities/${community.id}`;
      await uploadVariants(prefix, buffer);
      await prisma.community.update({ where: { id: community.id }, data: { imageUrl: publicUrl(prefix) } });
      console.log(`  ✓ community ${community.id}`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ community ${community.id}:`, err);
      failed.push(community.id);
    }
  }

  return { migrated, skipped, failed };
}

// ---------------------------------------------------------------------------
// Migrate persons
// ---------------------------------------------------------------------------
async function migratePersons(): Promise<MigrateResult> {
  const persons = await prisma.person.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });

  console.log(`\nFound ${persons.length} persons with images`);

  let migrated = 0, skipped = 0;
  const failed: string[] = [];

  for (const person of persons) {
    if (!isLocalUrl(person.imageUrl)) { skipped++; continue; }

    const localFile = await findLocalFile(person.id);
    if (!localFile) {
      console.warn(`  ⚠ No local file for person ${person.id} (was: ${person.imageUrl})`);
      failed.push(person.id);
      continue;
    }

    try {
      const buffer = await readFile(localFile);
      const prefix = `persons/${person.id}`;
      await uploadVariants(prefix, buffer);
      await prisma.person.update({ where: { id: person.id }, data: { imageUrl: publicUrl(prefix) } });
      console.log(`  ✓ person ${person.id}`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ person ${person.id}:`, err);
      failed.push(person.id);
    }
  }

  return { migrated, skipped, failed };
}

// ---------------------------------------------------------------------------
// Delete local upload directories from codebase
// ---------------------------------------------------------------------------
async function deleteLocalFiles(): Promise<void> {
  for (const dir of [NODE_IMAGES_DIR, RESOURCES_DIR]) {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      console.log(`  ✓ deleted ${dir}`);
    }
  }
  const uploadsDir = path.join(__dirname, '../apps/web/public/uploads');
  if (existsSync(uploadsDir)) {
    try {
      await rm(uploadsDir, { recursive: true, force: true });
      console.log(`  ✓ deleted ${uploadsDir}`);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== GCS Migration ===');
  console.log(`Bucket: ${MEDIA_BUCKET}`);
  console.log('Structure: cards/{id}/ | communities/{id}/ | persons/{id}/');

  const cardResult      = await migrateCards();
  const communityResult = await migrateCommunities();
  const personResult    = await migratePersons();

  const totalFailed = [...cardResult.failed, ...communityResult.failed, ...personResult.failed];

  console.log('\n=== Summary ===');
  console.log(`Cards:       ${cardResult.migrated} migrated, ${cardResult.skipped} skipped, ${cardResult.failed.length} failed`);
  console.log(`Communities: ${communityResult.migrated} migrated, ${communityResult.skipped} skipped, ${communityResult.failed.length} failed`);
  console.log(`Persons:     ${personResult.migrated} migrated, ${personResult.skipped} skipped, ${personResult.failed.length} failed`);

  if (totalFailed.length > 0) {
    console.warn(`\nFailed IDs: ${totalFailed.join(', ')}`);
    console.warn('Local files NOT deleted — fix failures first and re-run.');
  } else {
    console.log('\nAll migrations successful. Deleting local files...');
    await deleteLocalFiles();
    console.log('✓ Local upload files removed from codebase');
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
