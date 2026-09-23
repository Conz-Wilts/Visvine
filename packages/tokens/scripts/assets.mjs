// Brand assets: packages/tokens/assets is the one source, and each app keeps a
// byte-for-byte copy where its toolchain needs the file — Next serves public/
// and app/, Xcode bundles from the project folder, Gradle from res/. The copies
// are committed so each app still builds on its own; this keeps them honest.
import fs from 'node:fs';
import path from 'node:path';

const WEB_FONTS = 'apps/web/public/fonts';
const IOS = 'apps/mobile/ios/Visvine';

/** source (in assets/) → every copy (from the repo root). */
function copies(pkg) {
  const map = [];
  for (const f of fs.readdirSync(path.join(pkg, 'assets/fonts/web'))) {
    map.push([`fonts/web/${f}`, [`${WEB_FONTS}/${f}`]]);
  }
  for (const f of fs.readdirSync(path.join(pkg, 'assets/fonts/ios'))) {
    map.push([`fonts/ios/${f}`, [`${IOS}/Fonts/${f}`]]);
  }
  map.push(
    // The edge-to-edge master. Desktop's icon-mac.png is derived from its copy
    // by apps/desktop/scripts/build-mac-icon.mjs.
    ['logo/brand-icon.png', ['apps/web/app/icon.png', 'apps/web/public/images/brand-icon.png', 'apps/desktop/assets/icon.png']],
    // Opaque, full-bleed: the platform draws its own mask.
    ['logo/ios-app-icon.png', [`${IOS}/Assets.xcassets/AppIcon.appiconset/icon-1024.png`]],
    ['logo/apple-icon.png', ['apps/web/app/apple-icon.png']],
    ['logo/ios-logo.png', [`${IOS}/Assets.xcassets/Logo.imageset/logo.png`]],
    ['logo/android-launcher-foreground.xml', ['apps/mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml']],
  );
  return map;
}

/** Copy every asset where it is missing or different. Returns the stale paths (check mode writes nothing). */
export function syncAssets({ repo, pkg, check }) {
  const stale = [];
  for (const [source, targets] of copies(pkg)) {
    const bytes = fs.readFileSync(path.join(pkg, 'assets', source));
    for (const target of targets) {
      const at = path.join(repo, target);
      if (fs.existsSync(at) && fs.readFileSync(at).equals(bytes)) continue;
      if (check) stale.push(target);
      else {
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, bytes);
        console.log(`  copied ${source} → ${target}`);
      }
    }
  }
  return stale;
}
