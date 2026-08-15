// Sanity check for the build outputs electron-builder ships (`files` in
// electron-builder.yml). resources/ and assets/ are referenced by path from
// dist/main.js, so nothing is copied today; this is the one hook the build has
// for growing that step later (e.g. generating platform icons).
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
