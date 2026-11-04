// Smoke check of the built site: expected pages exist and every local <img>/srcset resolves.
// Usage: node scripts/check-dist.ts [distDir]
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const problems: string[] = [];
const must = (rel: string) => fs.existsSync(path.join(dist, rel)) || problems.push(`missing ${rel}`);

must('index.html');
must('categories.json');
must('404.html');
const cats = JSON.parse(fs.readFileSync(path.join(dist, 'categories.json'), 'utf8')) as { slug: string; count: number }[];
for (const c of cats) must(`c/${c.slug}/index.html`);
const total = cats.reduce((n, c) => n + c.count, 0);
const rDir = path.join(dist, 'r');
const rPages = fs.existsSync(rDir) ? fs.readdirSync(rDir) : [];
if (rPages.length !== total) problems.push(`expected ${total} /r/ pages, found ${rPages.length}`);

const htmlFiles: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmlFiles.push(p);
  }
};
walk(dist);
let imgs = 0;
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const urls = [
    ...[...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/srcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])),
  ];
  for (const u of urls) {
    if (/^https?:/.test(u)) continue;
    imgs++;
    if (!fs.existsSync(path.join(dist, decodeURI(u.split('?')[0])))) problems.push(`${path.relative(dist, f)}: broken image ${u}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`dist OK: ${htmlFiles.length} pages, ${cats.length} categories, ${rPages.length} reviews, ${imgs} image refs`);
