/**
 * Image cache for canvas rendering
 * Pre-loads and caches images for efficient canvas drawing
 */

// Cache for loaded images
const imageCache = new Map<string, HTMLImageElement>();
const loadingImages = new Map<string, Promise<HTMLImageElement>>();
const failedImages = new Set<string>();

// Notified whenever any image finishes loading. The canvas renderer registers a
// (RAF-deduped) redraw here so images requested on demand during a draw appear
// as soon as they arrive — without it, an image only shows on the next
// interaction-triggered repaint.
const loadListeners = new Set<() => void>();

/** Subscribe to "an image just loaded" events. Returns an unsubscribe fn. */
export function onImageLoad(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => loadListeners.delete(listener);
}

/**
 * Load an image and cache it
 * Returns immediately if already cached, otherwise starts loading
 */
export function loadImage(url: string): HTMLImageElement | null {
  // Return cached image if available
  if (imageCache.has(url)) {
    return imageCache.get(url)!;
  }

  // Don't retry failed images
  if (failedImages.has(url)) {
    return null;
  }

  // Start loading if not already loading
  if (!loadingImages.has(url)) {
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Enable CORS for external images

      img.onload = () => {
        imageCache.set(url, img);
        loadingImages.delete(url);
        loadListeners.forEach(l => l());
        resolve(img);
      };

      img.onerror = () => {
        failedImages.add(url);
        loadingImages.delete(url);
        reject(new Error(`Failed to load image: ${url}`));
      };

      img.src = url;
    });

    loadingImages.set(url, promise);
  }

  return null;
}

/**
 * Preload multiple images
 * Returns a promise that resolves when all images are loaded
 */
export async function preloadImages(urls: string[]): Promise<void> {
  const validUrls = urls.filter(url => url && !imageCache.has(url) && !failedImages.has(url));

  await Promise.allSettled(
    validUrls.map(url => {
      // loadImage dedupes against in-flight loads and registers the real load
      // promise in loadingImages (the old inline copy registered an
      // already-resolved promise, so concurrent callers "finished" instantly).
      loadImage(url);
      return loadingImages.get(url);
    })
  );
}
