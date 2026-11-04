// Loads and validates review notes from an Obsidian vault.
// Pure Node (no Astro imports) so the prepare script, the tests and the pages share it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { marked } from 'marked';

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

/** Minimum score for each tier, highest first. Retune here. */
export const TIERS: ReadonlyArray<readonly [Tier, number]> = [
  ['S', 9],
  ['A', 8],
  ['B', 6.5],
  ['C', 5],
  ['D', 0],
];

export const REVIEWS_DIR = 'reviews';
export const CUTOUT_MODEL = 'bgl'; // birefnet-general-lite

export interface Review {
  slug: string;
  file: string; // vault-relative posix path
  title: string;
  category: string; // display name of its category
  categorySlug: string;
  score: number;
  tier: Tier;
  photoPath: string; // absolute
  photoKey: string; // content hash + mode, names the cutout file
  cutout: boolean;
  verdict: string;
  date: string; // YYYY-MM-DD
  brand?: string;
  price?: string;
  place?: string;
  bodyHtml: string;
}

export interface Category {
  slug: string;
  name: string;
  count: number;
}

export interface VaultError {
  file: string;
  messages: string[];
}

export interface Vault {
  reviews: Review[];
  categories: Category[];
  errors: VaultError[];
}

export function tierOf(score: number): Tier {
  for (const [t, min] of TIERS) if (score >= min) return t;
  return 'D';
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

export function categoryKey(s: string): string {
  return tidy(s).toLowerCase();
}

export function normaliseDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // YAML dates are parsed as UTC midnight; read UTC parts to avoid a timezone shift.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  return null;
}

/** Accepts "[[x.jpg]]", "[[x.jpg|alt]]", [["x.jpg"]] (unquoted wikilink in YAML), "x.jpg", "a/x.jpg". */
export function parsePhotoValue(v: unknown): string | null {
  while (Array.isArray(v)) v = v[0];
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
  if (m) s = m[1].trim();
  return s || null;
}

const optString = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
};

const isBlank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.github']);

function walk(dir: string, root: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return out;
}

function splitFrontMatter(src: string): { fm: string; body: string } | null {
  const m = src.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return null;
  return { fm: m[1], body: src.slice(m[0].length) };
}

export function photoKeyFor(absPath: string, cutout: boolean): string {
  const h = crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  return `${h}-${cutout ? CUTOUT_MODEL : 'raw'}`;
}

interface Draft {
  file: string;
  stem: string;
  data: Record<string, unknown>;
  body: string;
}

export function loadVault(vaultDir: string): Vault {
  const root = path.resolve(vaultDir);
  const errors: VaultError[] = [];
  const fail = (file: string, msg: string) => {
    let e = errors.find((x) => x.file === file);
    if (!e) errors.push((e = { file, messages: [] }));
    e.messages.push(msg);
  };

  if (!fs.existsSync(path.join(root, REVIEWS_DIR))) {
    return { reviews: [], categories: [], errors: [] };
  }
  const all = walk(root, root);
  const byBase = new Map<string, string[]>();
  for (const f of all) {
    const b = path.posix.basename(f).toLowerCase();
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }

  // 1. Find published notes.
  const drafts: Draft[] = [];
  for (const file of all) {
    if (!file.startsWith(REVIEWS_DIR + '/') || !file.toLowerCase().endsWith('.md')) continue;
    const split = splitFrontMatter(fs.readFileSync(path.join(root, file), 'utf8'));
    if (!split) continue; // no front matter = not a review yet
    let data: Record<string, unknown>;
    try {
      data = (parseYaml(split.fm) ?? {}) as Record<string, unknown>;
    } catch (err) {
      fail(file, `front matter is not valid YAML: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    if (typeof data !== 'object' || Array.isArray(data)) continue;
    if (data.draft === true || isBlank(data.score)) continue;
    drafts.push({ file, stem: path.posix.basename(file).replace(/\.md$/i, ''), data, body: split.body });
  }

  // 2. Slugs and collisions.
  const bySlug = new Map<string, Draft[]>();
  for (const d of drafts) {
    const s = slugify(d.stem);
    bySlug.set(s, [...(bySlug.get(s) ?? []), d]);
  }
  for (const [s, ds] of bySlug) {
    if (!s) ds.forEach((d) => fail(d.file, 'filename has no letters or digits to build a URL from'));
    else if (ds.length > 1)
      for (const d of ds)
        fail(d.file, `URL /r/${s}/ collides with ${ds.filter((x) => x !== d).map((x) => x.file).join(', ')}; rename one note`);
  }
  const slugByStem = new Map<string, string>();
  for (const d of drafts) slugByStem.set(d.stem.toLowerCase(), slugify(d.stem));

  // 3. Validate fields.
  const reviews: Review[] = [];
  const catRaw: { key: string; spelling: string; date: string }[] = [];
  for (const d of drafts) {
    const { data, file } = d;
    const before = errors.find((e) => e.file === file)?.messages.length ?? 0;

    const title = optString(data.title);
    if (!title) fail(file, '`title` is empty');
    const category = optString(data.category);
    if (!category) fail(file, '`category` is empty');

    const score = typeof data.score === 'number' ? data.score : Number(String(data.score).trim());
    if (!Number.isFinite(score) || score < 1 || score > 10 || !Number.isInteger(score * 2))
      fail(file, `\`score\` must be 1–10 in steps of 0.5 (got ${JSON.stringify(data.score)})`);

    const date = normaliseDate(data.date);
    if (!date) fail(file, `\`date\` must be YYYY-MM-DD (got ${JSON.stringify(data.date)})`);

    const verdict = optString(data.verdict);
    if (!verdict) fail(file, '`verdict` is empty');

    const cutout = data.cutout !== false;

    let photoPath: string | undefined;
    const pv = parsePhotoValue(data.photo);
    if (!pv) fail(file, '`photo` is empty');
    else {
      const direct = pv.replace(/^\/+/, '');
      if (all.includes(direct)) photoPath = direct;
      else {
        const matches = byBase.get(path.posix.basename(direct).toLowerCase()) ?? [];
        if (matches.length === 1) photoPath = matches[0];
        else if (matches.length === 0) fail(file, `\`photo\` "${pv}" not found in the vault`);
        else fail(file, `\`photo\` "${pv}" is ambiguous: ${matches.join(', ')}`);
      }
      if (photoPath && !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(photoPath))
        fail(file, `\`photo\` "${pv}" is not an image`);
    }

    // Body: no embeds; wikilinks resolved later (needs all slugs).
    if (/!\[\[[^\]]*\]\]/.test(d.body) || /!\[[^\]]*\]\([^)]*\)/.test(d.body))
      fail(file, 'the review text embeds an image or file; v1 allows one photo per review (use the `photo` field)');

    const after = errors.find((e) => e.file === file)?.messages.length ?? 0;
    if (after > before || !title || !category || !date || !verdict || !photoPath) continue;

    catRaw.push({ key: categoryKey(category), spelling: tidy(category), date });
    reviews.push({
      slug: slugify(d.stem),
      file,
      title,
      category: tidy(category),
      categorySlug: slugify(categoryKey(category)),
      score,
      tier: tierOf(score),
      photoPath: path.join(root, photoPath),
      photoKey: photoKeyFor(path.join(root, photoPath), cutout),
      cutout,
      verdict,
      date,
      brand: optString(data.brand),
      price: optString(data.price),
      place: optString(data.place),
      bodyHtml: '',
    });
  }

  // 4. Categories: display name = most used spelling, ties -> newest review.
  const groups = new Map<string, typeof catRaw>();
  for (const c of catRaw) groups.set(c.key, [...(groups.get(c.key) ?? []), c]);
  const categories: Category[] = [];
  for (const [key, items] of groups) {
    const counts = new Map<string, { n: number; newest: string }>();
    for (const it of items) {
      const cur = counts.get(it.spelling) ?? { n: 0, newest: '' };
      counts.set(it.spelling, { n: cur.n + 1, newest: it.date > cur.newest ? it.date : cur.newest });
    }
    const name = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].newest.localeCompare(a[1].newest))[0][0];
    categories.push({ slug: slugify(key), name, count: items.length });
  }
  categories.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]));
  for (const r of reviews) r.category = nameBySlug.get(r.categorySlug)!;

  // 5. Bodies, with wikilinks to published reviews turned into links.
  const published = new Set(reviews.map((r) => r.slug));
  for (const r of reviews) {
    const d = drafts.find((x) => x.file === r.file)!;
    const md = d.body.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
      const stem = path.posix.basename(target.trim()).replace(/\.md$/i, '');
      const label = (alias ?? stem).trim();
      const slug = slugByStem.get(stem.toLowerCase());
      return slug && published.has(slug) ? `[${label}](/r/${slug}/)` : label;
    });
    r.bodyHtml = (marked.parse(md, { async: false }) as string).trim();
  }

  reviews.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  errors.sort((a, b) => a.file.localeCompare(b.file));
  return { reviews, categories, errors };
}

/** Reviews of one category grouped by tier (all tiers present, possibly empty). */
export function tierRows(reviews: Review[]): { tier: Tier; min: number; max: number | null; items: Review[] }[] {
  const sorted = [...reviews].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return TIERS.map(([tier, min], i) => ({
    tier,
    min,
    max: i === 0 ? null : TIERS[i - 1][1],
    items: sorted.filter((r) => r.tier === tier),
  }));
}
