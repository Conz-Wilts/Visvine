import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { localDelete, localList, localRead, localSave, localSignedUrl } from '@/lib/storage/localStore';

// Object storage, behind one set of functions and two drivers.
//
// `gcs` is the production driver: the two buckets the deployment names, read
// with Application Default Credentials or the service account in env. `local`
// is a directory on disk (lib/storage/localStore.ts) — the default outside
// production, so a dev checkout never holds a credential for, or writes a
// byte into, the production buckets. STORAGE_DRIVER picks explicitly; `local`
// is refused in production because Cloud Run's disk is neither shared nor
// kept. The bucket names stay the logical names either way (GCS_MEDIA_BUCKET,
// GCS_RESOURCES_BUCKET): under `local` they are folder names, and every
// caller's "is storage configured" check keeps reading them.

export type StorageDriver = 'gcs' | 'local';

export function storageDriver(): StorageDriver {
  const set = process.env.STORAGE_DRIVER;
  const production = process.env.NODE_ENV === 'production';
  if (set === 'local') {
    if (production) throw new Error('STORAGE_DRIVER=local is not allowed in production');
    return 'local';
  }
  if (set === 'gcs') return 'gcs';
  if (set) throw new Error(`Unknown STORAGE_DRIVER: ${set}`);
  return production ? 'gcs' : 'local';
}

// GCS client singleton
let _storage: Storage | null = null;

function getStorage(): Storage {
  if (_storage) return _storage;

  const projectId = process.env.GCS_PROJECT_ID;
  const clientEmail = process.env.GCS_CLIENT_EMAIL;
  const privateKey = process.env.GCS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey) {
    // Production: explicit service account credentials
    _storage = new Storage({ projectId, credentials: { client_email: clientEmail, private_key: privateKey } });
  } else {
    // Local dev: Application Default Credentials (gcloud auth application-default login)
    _storage = new Storage({ projectId });
  }

  return _storage;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const MEDIA_BUCKET = () => requireEnv('GCS_MEDIA_BUCKET');
export const RESOURCES_BUCKET = () => requireEnv('GCS_RESOURCES_BUCKET');

// Image variants generated on every profile/space image upload
type AvatarSize = 'original' | 'avatar-lg' | 'avatar-md' | 'avatar-sm';

const AVATAR_VARIANTS: Array<{ name: AvatarSize; size: number; quality: number }> = [
  { name: 'original',   size: 1080, quality: 82 },
  { name: 'avatar-lg',  size: 400,  quality: 80 },
  { name: 'avatar-md',  size: 200,  quality: 78 },
  { name: 'avatar-sm',  size: 64,   quality: 75 },
];

// Upload a profile/space image — generates 4 WebP variants in parallel
// Returns the GCS object path for the original (caller stores this in DB)
export async function uploadProfileImage(
  prefix: string, // e.g. "media/nodeId" or "media/space-spaceId"
  buffer: Buffer
): Promise<string> {
  // Sharp strips all metadata (EXIF/GPS) by default — just auto-rotate then process
  const base = sharp(buffer).rotate();

  await Promise.all(
    AVATAR_VARIANTS.map(async ({ name, size, quality }) => {
      const processed = await base
        .clone()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer();
      await saveObject(MEDIA_BUCKET(), `${prefix}/${name}.webp`, processed, 'image/webp', 'public, max-age=86400');
    })
  );

  return `${prefix}/original.webp`;
}

export async function deleteProfileImage(prefix: string): Promise<void> {
  await Promise.all(AVATAR_VARIANTS.map(({ name }) => deleteObject(MEDIA_BUCKET(), `${prefix}/${name}.webp`)));
}

/** A media variant's bytes for the /api/media proxy, or null when there is none. */
export async function readMediaObject(objectPath: string): Promise<Buffer | null> {
  return downloadObject(MEDIA_BUCKET(), objectPath);
}

// ── the two drivers, behind the primitives every function above builds on ──

async function saveObject(bucketName: string, objectPath: string, bytes: Buffer, contentType: string, cacheControl?: string): Promise<void> {
  if (storageDriver() === 'local') return localSave(bucketName, objectPath, bytes, contentType);
  await getStorage().bucket(bucketName).file(objectPath).save(bytes, {
    contentType,
    resumable: false,
    ...(cacheControl ? { metadata: { cacheControl } } : {}),
  });
}

async function downloadObject(bucketName: string, objectPath: string): Promise<Buffer | null> {
  if (storageDriver() === 'local') return (await localRead(bucketName, objectPath))?.bytes ?? null;
  try {
    const [contents] = await getStorage().bucket(bucketName).file(objectPath).download();
    return contents;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

// Upload a resource file (PDF, XLSX, CSV, DOCX, or image)
// Returns the GCS object path (caller stores this in DB)
export async function uploadResourceFile(
  objectPath: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await saveObject(RESOURCES_BUCKET(), objectPath, buffer, contentType);
  return objectPath;
}

/**
 * Read a Drive object back into memory.
 *
 * The one way bytes already in the resources bucket become bytes this process
 * can re-process — reusing a stored image as an entity's picture, say. The path
 * comes from a `Resource` row the caller has already authorized, never from a
 * client: this function signs nothing and checks nothing, so whoever calls it
 * owns the tenant check.
 */
export async function downloadResourceFile(objectPath: string): Promise<Buffer> {
  const contents = await downloadObject(RESOURCES_BUCKET(), objectPath);
  if (!contents) throw new Error(`No such object in storage: ${objectPath}`);
  return contents;
}

// Bulk object lifecycle.
//
// Every eager delete in the app removes ONE object because it removes one row
// (docs/data-architecture.md §1: bytes have exactly one owner). Bulk deletes —
// dropping a space, closing an account — remove thousands of rows at once and
// cannot reasonably do that one file at a time, so they work by PREFIX instead.
// That is only safe because every object path this app mints starts with the
// tenant it belongs to; see lib/storage/objectPaths.ts, which is the single
// place those prefixes are constructed and the reason a prefix delete can never
// reach across a tenant boundary.

/** One object as the lifecycle and audit paths need to see it. */
export interface StoredObject {
  name: string;
  sizeBytes: number;
  /** Epoch ms the object was created, or 0 when the backend did not report it. */
  createdMs: number;
}

/**
 * Every object under `prefix` (omit it for the whole bucket), paged by the
 * client library. `createdMs` is what lets the orphan audit refuse to judge an
 * object that may still be mid-upload — an upload writes bytes before it writes
 * the row, so recency is the difference between collecting garbage and
 * collecting somebody's file.
 */
export async function listObjects(bucketName: string, prefix?: string): Promise<StoredObject[]> {
  if (storageDriver() === 'local') return localList(bucketName, prefix);
  const [files] = await getStorage().bucket(bucketName).getFiles(prefix ? { prefix } : {});
  return files.map((f) => ({
    name: f.name,
    sizeBytes: Number(f.metadata?.size ?? 0),
    createdMs: f.metadata?.timeCreated ? Date.parse(String(f.metadata.timeCreated)) : 0,
  }));
}

/** Delete one object, ignoring a miss. */
export async function deleteObject(bucketName: string, objectPath: string): Promise<void> {
  if (storageDriver() === 'local') return localDelete(bucketName, objectPath);
  await getStorage().bucket(bucketName).file(objectPath).delete({ ignoreNotFound: true });
}

/**
 * Delete every object under `prefix`. Returns how many were removed.
 *
 * Refuses an empty prefix: `deleteFiles({ prefix: '' })` empties the bucket, and
 * the callers here build prefixes from ids that a bug could leave blank. A
 * guard that costs nothing is worth more than the argument that it cannot happen.
 */
export async function deleteObjectsByPrefix(bucketName: string, prefix: string): Promise<number> {
  if (!prefix || !prefix.trim()) {
    throw new Error('deleteObjectsByPrefix requires a non-empty prefix');
  }
  const names = (await listObjects(bucketName, prefix)).map((o) => o.name);
  if (names.length === 0) return 0;
  // Bounded concurrency: a space can hold thousands of objects and an unbounded
  // Promise.all would open a socket per file.
  const CONCURRENCY = 16;
  for (let i = 0; i < names.length; i += CONCURRENCY) {
    await Promise.all(names.slice(i, i + CONCURRENCY).map((name) => deleteObject(bucketName, name)));
  }
  return names.length;
}

export async function deleteResourceFile(objectPath: string): Promise<void> {
  await deleteObject(RESOURCES_BUCKET(), objectPath);
}

// Generate a signed URL (15-minute expiry) for private GCS objects.
//
// In-memory TTL cache: signing is a crypto operation per object and the
// resources list re-signs every row on every GET. A cached URL is reused while
// it still has >5 min of life left, so a 15-min URL is served from cache for
// ~10 min. Bounded FIFO eviction keeps the map from growing unbounded.
// Per-process only (each serverless instance has its own map) — that's fine,
// it's purely an optimization and misses just re-sign.
const SIGNED_URL_CACHE_MAX_ENTRIES = 500;
const SIGNED_URL_MIN_REMAINING_MS = 5 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function getSignedUrl(
  bucketName: string,
  objectPath: string,
  expiresInMs = 15 * 60 * 1000
): Promise<string> {
  const key = `${bucketName}/${objectPath}`;
  const now = Date.now();

  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt - now > SIGNED_URL_MIN_REMAINING_MS) {
    return cached.url;
  }
  if (cached) signedUrlCache.delete(key);

  if (storageDriver() === 'local') {
    const url = localSignedUrl(bucketName, objectPath, now + expiresInMs);
    signedUrlCache.set(key, { url, expiresAt: now + expiresInMs });
    return url;
  }

  const storage = getStorage();
  const [url] = await storage
    .bucket(bucketName)
    .file(objectPath)
    .getSignedUrl({
      action: 'read',
      expires: now + expiresInMs,
    });

  signedUrlCache.set(key, { url, expiresAt: now + expiresInMs });
  if (signedUrlCache.size > SIGNED_URL_CACHE_MAX_ENTRIES) {
    // Map preserves insertion order — evict the oldest entry.
    const oldest = signedUrlCache.keys().next().value;
    if (oldest !== undefined) signedUrlCache.delete(oldest);
  }
  return url;
}

// Build a URL for media images.
// Routes through /api/media proxy so the GCS bucket stays private (or the CDN,
// if GCS_CDN_BASE_URL is set). The actual rule lives in the client-safe
// mediaUrl module so server and client stay in lockstep — this is a thin
// server-side alias kept for the existing `@/lib/gcs` import sites.
export { getMediaProxyUrl as getMediaUrl } from './mediaUrl';
