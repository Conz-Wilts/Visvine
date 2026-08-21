// Fails the build if anything electron-builder ships (`files` in
// electron-builder.yml) is missing. resources/ and assets/ are referenced by
// path from dist/main.js, so nothing is copied.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const required of ["dist/main.js", "dist/preload.js", "resources/offline.html", "assets/icon.png"]) {
  if (!fs.existsSync(path.join(root, required))) {
    console.error(`[desktop] missing build input: ${required}`);
    process.exit(1);
  }
}
