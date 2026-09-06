/**
 * sync-app: mirrors the built Bluebook simulator (bluebook-mockup/dist/) and
 * the harvested figure PNGs into cramduck-mockup/ so the Cramduck mockup
 * can be served as the one app (see scripts/serve.ts):
 *
 *   bluebook-mockup/dist/index.html    -> cramduck-mockup/bluebook-practice-test.html
 *   bluebook-mockup/dist/renderers.js  -> cramduck-mockup/renderers.js
 *   bluebook-mockup/dist/assets/*      -> cramduck-mockup/assets/
 *   research/sat/assets/ssqb-*.png     -> cramduck-mockup/assets/
 *
 *   tsx scripts/sync-app.ts        (normally via: npm run build:app)
 *
 * Stale hashed bundles in cramduck-mockup/assets/ — files not present in
 * bluebook-mockup/dist/assets/ and not matching /^ssqb-.+\.png$/ — are
 * deleted (names printed). A destination file that already matches the
 * source on size AND mtime is skipped; otherwise it is (re)copied and the
 * destination mtime is set to the source mtime so later runs see it as
 * identical. Mtimes are compared at whole-second granularity: fs.utimesSync
 * cannot round-trip sub-millisecond precision, so whole seconds (exact for
 * every filesystem involved) are the reliable identity granularity. Prints
 * one summary line per step. Exit 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/validate.js';

const DIST_DIR = path.join(REPO_ROOT, 'bluebook-mockup', 'dist');
const DEST_DIR = path.join(REPO_ROOT, 'cramduck-mockup');
const DEST_ASSETS_DIR = path.join(DEST_DIR, 'assets');
const SSQB_SRC_DIR = path.join(REPO_ROOT, 'research', 'sat', 'assets');

/** Harvested figure PNGs are kept even though they are not in dist/assets. */
const SSQB_RE = /^ssqb-.+\.png$/;

/** mtime identity granularity (see header comment). */
function mtimeSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Copy src to dest unless dest already matches on size AND mtime (whole
 * seconds). Returns true when copied, false when skipped.
 */
function copyIfChanged(src: string, dest: string): boolean {
  const srcStat = fs.statSync(src);
  if (fs.existsSync(dest)) {
    const destStat = fs.statSync(dest);
    if (destStat.size === srcStat.size && mtimeSeconds(destStat.mtimeMs) === mtimeSeconds(srcStat.mtimeMs)) {
      return false;
    }
  }
  fs.copyFileSync(src, dest);
  // Preserve source mtime (whole seconds) so the next run can skip identical files.
  fs.utimesSync(dest, Math.floor(srcStat.atimeMs / 1000), mtimeSeconds(srcStat.mtimeMs));
  return true;
}

/** Regular-file names directly inside dir (sorted), or [] if dir is missing. */
function fileNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n)).isFile())
    .sort();
}

function main(): void {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error('sync-app: bluebook-mockup/dist/index.html not found — run `npm --prefix bluebook-mockup run build` first');
    process.exit(1);
  }
  fs.mkdirSync(DEST_ASSETS_DIR, { recursive: true });

  // Step 1: built simulator page -> bluebook-practice-test.html
  const htmlCopied = copyIfChanged(path.join(DIST_DIR, 'index.html'), path.join(DEST_DIR, 'bluebook-practice-test.html'));
  console.log(`sync-app: dist/index.html -> cramduck-mockup/bluebook-practice-test.html (${htmlCopied ? 'copied' : 'unchanged'})`);

  // Step 2: renderer bundle
  const renderersCopied = copyIfChanged(path.join(DIST_DIR, 'renderers.js'), path.join(DEST_DIR, 'renderers.js'));
  console.log(`sync-app: dist/renderers.js -> cramduck-mockup/renderers.js (${renderersCopied ? 'copied' : 'unchanged'})`);

  // Step 3: mirror dist/assets/
  const distAssetNames = fileNames(path.join(DIST_DIR, 'assets'));
  let assetsCopied = 0;
  let assetsSkipped = 0;
  for (const name of distAssetNames) {
    if (copyIfChanged(path.join(DIST_DIR, 'assets', name), path.join(DEST_ASSETS_DIR, name))) assetsCopied++;
    else assetsSkipped++;
  }
  console.log(`sync-app: dist/assets/ -> cramduck-mockup/assets/ (${distAssetNames.length} file(s) scanned, copied ${assetsCopied}, skipped ${assetsSkipped})`);

  // Step 4: delete stale hashed bundles (not in dist/assets, not ssqb PNGs)
  const fresh = new Set(distAssetNames);
  const deleted: string[] = [];
  for (const name of fileNames(DEST_ASSETS_DIR)) {
    if (fresh.has(name) || SSQB_RE.test(name)) continue;
    fs.unlinkSync(path.join(DEST_ASSETS_DIR, name));
    deleted.push(name);
  }
  for (const name of deleted) console.log(`deleted stale: cramduck-mockup/assets/${name}`);
  console.log(`sync-app: stale bundle cleanup (deleted ${deleted.length})`);

  // Step 5: mirror harvested ssqb figure PNGs
  const ssqbSrcRel = path.relative(REPO_ROOT, SSQB_SRC_DIR);
  if (!fs.existsSync(SSQB_SRC_DIR)) {
    console.log(`sync-app: source dir ${ssqbSrcRel}/ does not exist — no ssqb PNGs to sync`);
    console.log('copied 0, skipped 0');
    return;
  }
  // top-level ssqb-*.png plus the curated figures subdir (png/jpg/svg)
  const FIGURE_EXT = /\.(png|jpe?g|svg)$/;
  const ssqbNames: string[] = [
    ...fs
      .readdirSync(SSQB_SRC_DIR)
      .filter((n) => n.startsWith('ssqb-') && n.endsWith('.png')),
    ...['figures', 'choiceimg'].flatMap((sub) =>
      fs.existsSync(path.join(SSQB_SRC_DIR, sub))
        ? fs
            .readdirSync(path.join(SSQB_SRC_DIR, sub))
            .filter((n) => n.startsWith('ssqb-') && FIGURE_EXT.test(n))
            .map((n) => path.join(sub, n))
        : [],
    ),
  ].sort();
  let ssqbCopied = 0;
  let ssqbSkipped = 0;
  for (const name of ssqbNames) {
    const dest = path.join(DEST_ASSETS_DIR, name);
    if (name.includes(path.sep)) fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (copyIfChanged(path.join(SSQB_SRC_DIR, name), dest)) ssqbCopied++;
    else ssqbSkipped++;
  }
  console.log(`sync-app: ${ssqbSrcRel}/ ssqb-*.png -> cramduck-mockup/assets/ (${ssqbNames.length} source PNG(s) scanned, copied ${ssqbCopied}, skipped ${ssqbSkipped})`);
}

main();
