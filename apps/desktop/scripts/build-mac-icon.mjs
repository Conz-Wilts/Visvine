// macOS sizes every app icon to the same grid: the artwork is a squircle on
// 824 of a 1024pt canvas, with the rest transparent, and the Dock scales the
// whole canvas. A mark drawn edge to edge therefore reads a size larger than
// every icon beside it. assets/icon.png is that edge-to-edge master (Windows
// and Linux want it that way); this writes the mac build's padded copy.
//
//   node scripts/build-mac-icon.mjs [--check]
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "..", "assets");
const SOURCE = path.join(assets, "icon.png");
const TARGET = path.join(assets, "icon-mac.png");
const CANVAS = 1024;
const ART = 824; // Apple's grid: 100pt of clear air on every side

// sharp lives in the web app's node_modules — the desktop app needs it for
// this one script and nothing else.
const require = createRequire(path.join(here, "..", "..", "web", "package.json"));
const sharp = require("sharp");

const art = await sharp(SOURCE).resize(ART, ART, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const padded = await sharp({
  create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: art, top: (CANVAS - ART) / 2, left: (CANVAS - ART) / 2 }])
  .png()
  .toBuffer();

if (process.argv.includes("--check")) {
  const current = await readFile(TARGET).catch(() => null);
  if (current && current.equals(padded)) {
    console.log("mac icon: up to date.");
    process.exit(0);
  }
  console.error("mac icon: assets/icon-mac.png is stale — run `node scripts/build-mac-icon.mjs`.");
  process.exit(1);
}

await writeFile(TARGET, padded);
console.log(`mac icon: wrote ${path.relative(process.cwd(), TARGET)} (${ART}/${CANVAS} artwork).`);
