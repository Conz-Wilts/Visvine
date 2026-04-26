import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// GCS client singleton
// ---------------------------------------------------------------------------
let _storage: Storage | null = null;

export function getStorage(): Storage {
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

// ---------------------------------------------------------------------------
// Image variants generated on every profile/community image upload
// ---------------------------------------------------------------------------
export type AvatarSize = 'original' | 'avatar-lg' | 'avatar-md' | 'avatar-sm';

const AVATAR_VARIANTS: Array<{ name: AvatarSize; size: number; quality: number }> = [
  { name: 'original',   size: 1080, quality: 82 },
  { name: 'avatar-lg',  size: 400,  quality: 80 },
  { name: 'avatar-md',  size: 200,  quality: 78 },
  { name: 'avatar-sm',  size: 64,   quality: 75 },
];

// ---------------------------------------------------------------------------
// Upload a profile/community image — generates 4 WebP variants in parallel
// Returns the GCS object path for the original (caller stores this in DB)
// ---------------------------------------------------------------------------
export async function uploadProfileImage(
  prefix: string, // e.g. "media/nodeId" or "media/community-communityId"
  buffer: Buffer
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(MEDIA_BUCKET());

  // Sharp strips all metadata (EXIF/GPS) by default — just auto-rotate then process
  const base = sharp(buffer).rotate();

  await Promise.all(
    AVATAR_VARIANTS.map(async ({ name, size, quality }) => {
      const processed = await base
        .clone()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer();

      const objectPath = `${prefix}/${name}.webp`;
      const file = bucket.file(objectPath);
      await file.save(processed, {
        contentType: 'image/webp',
        resumable: false,
        metadata: { cacheControl: 'public, max-age=0, must-revalidate' },
      });
    })
  );

  return `${prefix}/original.webp`;
}

// ---------------------------------------------------------------------------
// Delete all avatar variants for a given prefix
// ---------------------------------------------------------------------------
export async function deleteProfileImage(prefix: string): Promise<void> {
  const storage = getStorage();
  const bucket = storage.bucket(MEDIA_BUCKET());

  await Promise.all(
    AVATAR_VARIANTS.map(({ name }) =>
      bucket.file(`${prefix}/${name}.webp`).delete({ ignoreNotFound: true })
    )
  );
}

// ---------------------------------------------------------------------------
// Upload a resource file (PDF, XLSX, CSV, DOCX, or image)
// Returns the GCS object path (caller stores this in DB)
// ---------------------------------------------------------------------------
export async function uploadResourceFile(
  objectPath: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const storage = getStorage();
  const bucket = storage.bucket(RESOURCES_BUCKET());
  const file = bucket.file(objectPath);
  await file.save(buffer, { contentType, resumable: false });
  return objectPath;
}

// ---------------------------------------------------------------------------
// Delete a resource file
// ---------------------------------------------------------------------------
export async function deleteResourceFile(objectPath: string): Promise<void> {
  const storage = getStorage();
  const bucket = storage.bucket(RESOURCES_BUCKET());
  await bucket.file(objectPath).delete({ ignoreNotFound: true });
}

// ---------------------------------------------------------------------------
// Generate a signed URL (15-minute expiry) for private GCS objects
// ---------------------------------------------------------------------------
export async function getSignedUrl(
  bucketName: string,
  objectPath: string,
  expiresInMs = 15 * 60 * 1000
): Promise<string> {
  const storage = getStorage();
  const [url] = await storage
    .bucket(bucketName)
    .file(objectPath)
    .getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMs,
    });
  return url;
}

// ---------------------------------------------------------------------------
// Build a URL for media images.
// Routes through /api/media proxy so the GCS bucket stays private.
// If a CDN base URL is configured, use that instead (CDN should sit in front
// of the /api/media proxy for edge caching).
// ---------------------------------------------------------------------------
export function getMediaUrl(objectPath: string): string {
  const cdnBase = process.env.GCS_CDN_BASE_URL;
  if (cdnBase) {
    return `${cdnBase.replace(/\/$/, '')}/${objectPath}`;
  }
  return `/api/media/${objectPath}`;
}

// Re-export normalizeImageUrl from the client-safe mediaUrl module
export { normalizeImageUrl } from './mediaUrl';
