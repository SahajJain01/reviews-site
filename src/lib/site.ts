// Build-time data for the pages: the validated vault + images per review.
import fs from 'node:fs';
import path from 'node:path';
import type { ImageMetadata } from 'astro';
import { loadVault, type Review, type Category } from './reviews.ts';

export const SITE = {
  name: 'bebi',
  sub: 'reviews',
  tagline: (n: number) => `${n} thing${n === 1 ? '' : 's'}, honestly scored`,
};

export interface Shot {
  image: ImageMetadata;
  tint: string;
  cutout: boolean;
}

const vaultDir = path.resolve(process.env.VAULT_DIR ?? '../reviews-vault');
const cutoutsDir = path.resolve(process.env.CUTOUTS_DIR ?? './cutouts');

const images = import.meta.glob<ImageMetadata>('@cutouts/*.{png,jpg}', { eager: true, import: 'default' });

function build() {
  const v = loadVault(vaultDir);
  if (v.errors.length) {
    const msg = v.errors.map((e) => `${e.file}\n  - ${e.messages.join('\n  - ')}`).join('\n');
    throw new Error(`Vault has invalid reviews:\n${msg}`);
  }
  const manifestPath = path.join(cutoutsDir, 'manifest.json');
  const manifest: Record<string, { file: string; tint: string }> = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {};
  const byFile = new Map(Object.entries(images).map(([k, img]) => [path.basename(k), img]));
  const shots = new Map<string, Shot>();
  for (const r of v.reviews) {
    const m = manifest[r.photoKey];
    const image = m && byFile.get(m.file);
    if (!m || !image) throw new Error(`${r.file}: no processed image for its photo (run the cutout step)`);
    shots.set(r.slug, { image, tint: m.tint, cutout: r.cutout });
  }
  return { ...v, shots };
}

let cache: ReturnType<typeof build> | undefined;
export function data(): { reviews: Review[]; categories: Category[]; shots: Map<string, Shot> } {
  return (cache ??= build());
}

export function formatDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[m - 1]} ${y}`;
}

export const scoreText = (s: number) => s.toFixed(1);
