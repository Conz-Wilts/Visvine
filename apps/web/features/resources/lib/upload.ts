'use client';

/**
 * Upload one file as a resource, resumably (lib/resources/upload.ts is the
 * server half). Open a session, send 8 MiB chunks with `Content-Range`, and
 * after any failure ask the session how far it got and carry on from there —
 * a dropped connection on a 2 GB video costs one chunk, not the file. Then
 * `complete` makes it a resource. On GCS the chunks go straight to the bucket.
 *
 * Progress is reported per byte the network accepted; a video also sends the
 * server a poster frame, since this browser has already decoded it.
 */

export interface UploadedResource {
  id: string;
  name: string;
  fileType: string;
  kind: string;
  fileSize: number | null;
  nodeId: string | null;
  conversationId: string | null;
}

export interface UploadOptions {
  spaceId: string;
  /** Dropping into a channel: shared there when the message is sent. */
  conversationId?: string | null;
  folderId?: string | null;
  nodeId?: string | null;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

const RETRIES = 6;

class UploadError extends Error {}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new UploadError(body.error || `Upload failed (${res.status})`);
  return body as T;
}

/** One PUT to the session. Resolves to the offset now held, or null when the file is complete. */
function put(
  url: string,
  range: string,
  body: Blob | null,
  onSent: (sent: number) => void,
  signal?: AbortSignal,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Range', range);
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) return resolve(null);
      if (xhr.status === 308) {
        const held = /bytes=0-(\d+)/.exec(xhr.getResponseHeader('Range') ?? '');
        return resolve(held ? Number(held[1]) + 1 : 0);
      }
      if (xhr.status >= 400 && xhr.status < 500 && xhr.status !== 408 && xhr.status !== 429) {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = (JSON.parse(xhr.responseText) as { error?: string }).error || message;
        } catch {
          /* not JSON */
        }
        return reject(new UploadError(message));
      }
      reject(new Error(`Upload interrupted (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload interrupted'));
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.send(body);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadResourceFile(file: File, options: UploadOptions): Promise<UploadedResource> {
  const started = await jsonOrThrow<{ id: string; uploadUrl: string; chunkSize: number }>(
    await fetch('/api/resources/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId: options.spaceId,
        name: file.name,
        size: file.size,
        mimeType: file.type || undefined,
        folderId: options.folderId ?? null,
        nodeId: options.nodeId ?? null,
        conversationId: options.conversationId ?? null,
      }),
      signal: options.signal,
    }),
  );

  const total = file.size;
  let offset = 0;
  let failures = 0;
  while (true) {
    options.signal?.throwIfAborted();
    const end = Math.min(offset + started.chunkSize, total) - 1;
    try {
      const next = await put(
        started.uploadUrl,
        `bytes ${offset}-${end}/${total}`,
        file.slice(offset, end + 1),
        (sent) => options.onProgress?.(Math.min(offset + sent, total), total),
        options.signal,
      );
      if (next === null) break;
      offset = next;
      failures = 0;
    } catch (err) {
      if (err instanceof UploadError || (err as Error).name === 'AbortError' || ++failures > RETRIES) throw err;
      await wait(Math.min(500 * 2 ** failures, 15_000));
      // Where did it get to? The session answers from what it actually holds.
      const held = await put(started.uploadUrl, `bytes */${total}`, null, () => {}, options.signal).catch(() => offset);
      if (held === null) break;
      offset = held;
    }
    options.onProgress?.(offset, total);
  }
  options.onProgress?.(total, total);

  const done = await jsonOrThrow<UploadedResource>(
    await fetch(`/api/resources/uploads/${encodeURIComponent(started.id)}/complete`, {
      method: 'POST',
      signal: options.signal,
    }),
  );
  if (done.kind === 'video') void sendPoster(done.id, file);
  return done;
}

/** A frame a second in, as a JPEG, for the video's thumbnail. Best-effort. */
async function sendPoster(resourceId: string, file: File): Promise<void> {
  const src = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = src;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('undecodable'));
    });
    video.currentTime = Math.min(1, (video.duration || 2) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob) await fetch(`/api/resources/${encodeURIComponent(resourceId)}/poster`, { method: 'POST', body: blob });
  } catch {
    // A codec this browser cannot draw: the video keeps its icon.
  } finally {
    URL.revokeObjectURL(src);
  }
}
