// The local storage driver: a directory on disk standing in for the buckets.
//
// Local dev shares zero data with production, and that includes bytes: an
// avatar uploaded on a laptop must not land beside real users' files. So
// outside production the buckets are folders under STORAGE_LOCAL_DIR
// (default `apps/web/.storage`, gitignored), one per logical bucket name, and
// an object is a file at its object path. Nothing here needs a credential.
//
// Two things a bucket gives for free are rebuilt here:
//   - a content type, kept in a `<path>.meta.json` sidecar (a filesystem has
//     no per-file MIME); the sidecar is invisible to listing;
//   - a signed URL, which is `/api/storage/local/<bucket>/<path>` carrying an
//     expiry and an HMAC over AUTH_SECRET — a bearer capability for one
//     object for fifteen minutes, the same contract a GCS signed URL keeps.
//
// The driver is refused in production (lib/gcs.ts): Cloud Run's disk is
// ephemeral and per instance, so a file written there is gone at the next
// deploy and invisible to the instance beside it.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const META_SUFFIX = '.meta.json';

function localStorageRoot(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_LOCAL_DIR || '.storage');
}

/** The file an object lives at — refusing a path that climbs out of its bucket. */
function objectFile(bucket: string, objectPath: string): string {
  const root = path.join(localStorageRoot(), bucket);
  const file = path.resolve(root, objectPath);
  if (file !== root && !file.startsWith(root + path.sep)) {
    throw new Error(`Object path escapes its bucket: ${objectPath}`);
  }
  return file;
}

export async function localSave(bucket: string, objectPath: string, bytes: Buffer, contentType: string): Promise<void> {
  const file = objectFile(bucket, objectPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(file + META_SUFFIX, JSON.stringify({ contentType }));
}

/** The bytes and content type, or null when there is no such object. */
export async function localRead(bucket: string, objectPath: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const file = objectFile(bucket, objectPath);
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let contentType = 'application/octet-stream';
  try {
    contentType = String(JSON.parse(await readFile(file + META_SUFFIX, 'utf8')).contentType || contentType);
  } catch {
    // No sidecar: an object written by hand. Served as bytes.
  }
  return { bytes, contentType };
}

export async function localDelete(bucket: string, objectPath: string): Promise<void> {
  const file = objectFile(bucket, objectPath);
  await rm(file, { force: true });
  await rm(file + META_SUFFIX, { force: true });
}

export async function localList(bucket: string, prefix?: string): Promise<Array<{ name: string; sizeBytes: number; createdMs: number }>> {
  const root = path.join(localStorageRoot(), bucket);
  const out: Array<{ name: string; sizeBytes: number; createdMs: number }> = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.name.endsWith(META_SUFFIX)) continue;
      const name = path.relative(root, full).split(path.sep).join('/');
      if (prefix && !name.startsWith(prefix)) continue;
      const s = await stat(full);
      out.push({ name, sizeBytes: s.size, createdMs: s.birthtimeMs || s.mtimeMs });
    }
  };
  await walk(root);
  return out;
}

// ── signed URLs ──────────────────────────────────────────────────────────

function signingSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required to sign local storage URLs');
  return secret;
}

function signature(bucket: string, objectPath: string, expires: number): string {
  return createHmac('sha256', signingSecret()).update(`${bucket}\n${objectPath}\n${expires}`).digest('hex');
}

/** A relative URL that reads one object until `expires` (epoch ms). */
export function localSignedUrl(bucket: string, objectPath: string, expires: number): string {
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  const sig = signature(bucket, objectPath, expires);
  return `/api/storage/local/${encodeURIComponent(bucket)}/${encoded}?exp=${expires}&sig=${sig}`;
}

/** Whether a URL's signature is the one this server minted, and still live. */
export function verifyLocalSignature(bucket: string, objectPath: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(signature(bucket, objectPath, expires));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
