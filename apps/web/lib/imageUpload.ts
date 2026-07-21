export type ImageEntityType = 'card' | 'person' | 'community' | 'event';

/**
 * Upload an image for any entity type.
 * Returns the public URL for the large avatar (stored as imageUrl in DB).
 */
export async function uploadImage(
  entityType: ImageEntityType,
  entityId: string,
  file: File
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('entityType', entityType);
  formData.append('entityId', entityId);

  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to upload image');
  }

  const { url } = await res.json();
  return url;
}

/**
 * Upload a cropped image blob.
 */
async function uploadCroppedImage(
  entityType: ImageEntityType,
  entityId: string,
  blob: Blob,
  originalFileName?: string
): Promise<string> {
  const fileName = originalFileName || `${entityId}.webp`;
  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
  return uploadImage(entityType, entityId, file);
}

/**
 * Delete all image variants for an entity.
 */
export async function deleteImage(entityType: ImageEntityType, entityId: string): Promise<void> {
  const params = new URLSearchParams({ entityType, entityId });
  const res = await fetch(`/api/upload?${params}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete image');
  }
}

// ---------------------------------------------------------------------------
// Legacy shims — callers that haven't been updated yet pass nodeId for cards
// ---------------------------------------------------------------------------
export async function uploadCroppedNodeImage(
  nodeId: string,
  blob: Blob,
  originalFileName?: string
): Promise<string> {
  return uploadCroppedImage('card', nodeId, blob, originalFileName);
}

/**
 * Validate that a file is an acceptable image.
 * Returns an error message or null if valid.
 */
export function validateImageFile(file: File): string | null {
  const MAX_SIZE = 10 * 1024 * 1024;

  const ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/bmp',
    'image/svg+xml',
    'image/heic',
    'image/heif',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/x-ms-bmp',
    'image/x-portable-pixmap',
    'image/x-portable-graymap',
    'image/x-portable-bitmap',
    'image/x-portable-anymap',
  ];

  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Please upload a valid image file (JPEG, PNG, GIF, WebP, TIFF, BMP, HEIC, SVG, etc.)';
  }

  if (file.size > MAX_SIZE) {
    return 'Image must be less than 10MB';
  }

  return null;
}
