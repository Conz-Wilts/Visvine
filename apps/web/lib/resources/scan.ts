/**
 * The upload scanner seam. Every finished upload is asked about here before it
 * becomes a resource anyone else can download; a `blocked` verdict discards
 * it. With no scanner configured the verdict is `skipped`, recorded on the row
 * (`scan_state`) so a scanner added later can find what it never saw.
 *
 * A scanner is a function over the object's path, not its bytes: a ClamAV
 * worker reads the object itself, and a multi-gigabyte upload never passes
 * through this process to be judged.
 */

export type ScanVerdict = 'clean' | 'blocked' | 'skipped'

export interface ResourceScanner {
  scan(objectPath: string): Promise<'clean' | 'blocked'>
}

let scanner: ResourceScanner | null = null

/** Install the deployment's scanner (none by default). */
export function configureScanner(next: ResourceScanner | null): void {
  scanner = next
}

export async function scanUpload(objectPath: string): Promise<ScanVerdict> {
  if (!scanner) return 'skipped'
  return scanner.scan(objectPath)
}
