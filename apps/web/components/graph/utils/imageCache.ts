/**
 * Image cache for canvas rendering
 * Pre-loads and caches images for efficient canvas drawing
 */

// Cache for loaded images
const imageCache = new Map<string, HTMLImageElement>();
const loadingImages = new Map<string, Promise<HTMLImageElement>>();
const failedImages = new Set<string>();

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
 * Get a cached image synchronously (returns null if not cached)
 */
export function getCachedImage(url: string): HTMLImageElement | null {
  return imageCache.get(url) || null;
}

/**
 * Check if an image is currently loading
 */
export function isImageLoading(url: string): boolean {
  return loadingImages.has(url);
}

/**
 * Preload multiple images
 * Returns a promise that resolves when all images are loaded
 */
export async function preloadImages(urls: string[]): Promise<void> {
  const validUrls = urls.filter(url => url && !imageCache.has(url) && !failedImages.has(url));

  await Promise.allSettled(
    validUrls.map(url => {
      if (loadingImages.has(url)) {
        return loadingImages.get(url);
      }

      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
          imageCache.set(url, img);
          loadingImages.delete(url);
          resolve(img);
        };

        img.onerror = () => {
          failedImages.add(url);
          loadingImages.delete(url);
          reject(new Error(`Failed to load image: ${url}`));
        };

        loadingImages.set(url, Promise.resolve(img));
        img.src = url;
      });
    })
  );
}

/**
 * Clear the entire image cache
 */
export function clearImageCache(): void {
  imageCache.clear();
  loadingImages.clear();
  failedImages.clear();
}

/**
 * Remove a specific image from cache (useful when image is updated)
 */
export function invalidateImage(url: string): void {
  imageCache.delete(url);
  failedImages.delete(url);
}
