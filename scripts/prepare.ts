// Validate the vault and list photos that still need a cutout.
// Usage: node scripts/prepare.ts [vaultDir]   (default: $VAULT_DIR or ../reviews-vault)
// Exit 1 on any invalid published note. Writes .cache/pending.json.
import fs from 'node:fs';
import path from 'node:path';
import { loadVault } from '../src/lib/reviews.ts';

const vaultDir = path.resolve(process.argv[2] ?? process.env.VAULT_DIR ?? '../reviews-vault');
const siteUrl = process.env.SITE_URL ?? 'https://bebi.fyi';
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
const lines: string[] = [];
const say = (s = '') => {
  console.log(s);
  lines.push(s);
};

const v = loadVault(vaultDir);

if (v.errors.length) {
  say(`## ❌ ${v.errors.length} review${v.errors.length > 1 ? 's' : ''} need fixing — nothing was deployed`);
  say();
  for (const e of v.errors) {
    say(`**${e.file}**`);
    for (const m of e.messages) say(`- ${m}`);
    say();
  }
} else {
  say(`## ✅ ${v.reviews.length} published reviews in ${v.categories.length} categories`);
}

// New-category warning (catches typos). Best effort: skip if the live site is unreachable.
try {
  const res = await fetch(new URL('/categories.json', siteUrl), { signal: AbortSignal.timeout(8000) });
  if (res.ok) {
    const live = new Set(((await res.json()) as { slug: string }[]).map((c) => c.slug));
    const fresh = v.categories.filter((c) => !live.has(c.slug));
    if (fresh.length) {
      say();
      say(`### ⚠️ New categor${fresh.length > 1 ? 'ies' : 'y'}: ${fresh.map((c) => `**${c.name}**`).join(', ')}`);
      say('If that is a typo, fix the `category` field and push again.');
    }
  }
} catch {
  /* first deploy or offline */
}

const cutoutsDir = path.resolve(process.env.CUTOUTS_DIR ?? 'cutouts');
const manifestPath = path.join(cutoutsDir, 'manifest.json');
const manifest: Record<string, unknown> = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : {};
const seen = new Set<string>();
const pending = v.reviews
  .filter((r) => !manifest[r.photoKey] && !seen.has(r.photoKey) && seen.add(r.photoKey))
  .map((r) => ({ key: r.photoKey, src: r.photoPath, cutout: r.cutout, file: r.file }));

fs.mkdirSync('.cache', { recursive: true });
fs.writeFileSync('.cache/pending.json', JSON.stringify(pending, null, 2));
say();
say(`${pending.length} new photo${pending.length === 1 ? '' : 's'} to process.`);

if (summaryFile) fs.appendFileSync(summaryFile, lines.join('\n') + '\n');
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending.length}\n`);
process.exit(v.errors.length ? 1 : 0);
