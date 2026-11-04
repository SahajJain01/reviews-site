import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { slugify, categoryKey, tierOf, loadVault, normaliseDate, parsePhotoValue } from '../src/lib/reviews.ts';

const fx = (n: string) => path.join(import.meta.dirname, 'fixtures', n);

describe('tiers', () => {
  it('maps boundaries', () => {
    expect(tierOf(4.5)).toBe('D');
    expect(tierOf(5)).toBe('C');
    expect(tierOf(6)).toBe('C');
    expect(tierOf(6.5)).toBe('B');
    expect(tierOf(8)).toBe('A');
    expect(tierOf(9)).toBe('S');
    expect(tierOf(10)).toBe('S');
  });
});

describe('slugify / categories', () => {
  it('slugifies with diacritics', () => {
    expect(slugify('Comté, 18 months')).toBe('comte-18-months');
    expect(slugify('Không Độ  Trà')).toBe('khong-do-tra');
    expect(slugify('70% Dark!')).toBe('70-dark');
  });
  it('category keys merge case and spacing', () => {
    expect(categoryKey('  Instant   Noodles ')).toBe(categoryKey('instant noodles'));
  });
});

describe('field parsing', () => {
  it('photo value parsed from unquoted wikilink', () => {
    expect(parsePhotoValue([['x.jpg']])).toBe('x.jpg');
    expect(parsePhotoValue('[[x.jpg]]')).toBe('x.jpg');
    expect(parsePhotoValue('[[x.jpg|alt]]')).toBe('x.jpg');
    expect(parsePhotoValue('attachments/x.jpg')).toBe('attachments/x.jpg');
    expect(parsePhotoValue(null)).toBe(null);
  });
  it('date object normalises without timezone shift', () => {
    expect(normaliseDate(new Date(Date.UTC(2026, 10, 2)))).toBe('2026-11-02');
    expect(normaliseDate('2026-11-02')).toBe('2026-11-02');
    expect(normaliseDate('yesterday')).toBe(null);
  });
});

describe('loadVault (good fixture)', () => {
  const v = loadVault(fx('good'));
  const by = (slug: string) => v.reviews.find((r) => r.slug === slug)!;

  it('has no errors', () => expect(v.errors).toEqual([]));

  it('publishes only complete, non-draft notes in reviews/', () => {
    expect(v.reviews.map((r) => r.slug).sort()).toEqual(
      ['classic-cup-noodle', 'comte', 'marou-70', 'spicy-shrimp-ramyun', 'sub-poster'].sort(),
    );
  });

  it('note without front matter is unpublished', () => {
    expect(v.reviews.find((r) => r.slug === 'no-frontmatter')).toBeUndefined();
  });

  it('merges categories and picks display name by usage then recency', () => {
    const noodles = v.categories.find((c) => c.slug === 'instant-noodles')!;
    expect(noodles.count).toBe(2);
    expect(noodles.name).toBe('Instant Noodles'); // tie 1–1 -> newest review (2026-11-02) wins
    expect(by('classic-cup-noodle').categorySlug).toBe('instant-noodles');
  });

  it('orders categories by count desc then name', () => {
    expect(v.categories.map((c) => c.slug)).toEqual(['instant-noodles', 'cheese', 'chocolate', 'movies']);
  });

  it('sorts reviews newest first', () => {
    expect(v.reviews.map((r) => r.slug)).toEqual([
      'spicy-shrimp-ramyun', 'marou-70', 'sub-poster', 'comte', 'classic-cup-noodle',
    ]);
  });

  it('resolves photos by wikilink, nested list, plain name and path', () => {
    expect(by('spicy-shrimp-ramyun').photoPath).toMatch(/attachments\/shrimp-ramyun\.jpg$/);
    expect(by('classic-cup-noodle').photoPath).toMatch(/cupnoodle\.jpg$/);
    expect(by('marou-70').photoPath).toMatch(/marou\.jpg$/);
    expect(by('comte').photoPath).toMatch(/comte\.jpg$/);
    expect(by('sub-poster').cutout).toBe(false);
  });

  it('computes tier and keeps optional fields', () => {
    const r = by('spicy-shrimp-ramyun');
    expect(r.tier).toBe('A');
    expect(r.brand).toBe('Nongshim');
    expect(r.price).toBe('28k₫');
    expect(r.place).toBeUndefined();
    expect(by('comte').tier).toBe('D');
  });

  it('turns wikilinks to published reviews into links and hides the rest', () => {
    const html = by('spicy-shrimp-ramyun').bodyHtml;
    expect(html).toContain('<a href="/r/classic-cup-noodle/">Classic Cup Noodle</a>');
    expect(html).toContain('<a href="/r/classic-cup-noodle/">the cup one</a>');
    expect(html).toContain('Buldak Carbonara');
    expect(html).not.toContain('/r/buldak-carbonara');
    expect(html).toContain('diary');
    expect(html).not.toContain('private');
  });
});

describe('loadVault (bad fixtures)', () => {
  it('embeds are errors naming the file', () => {
    const v = loadVault(fx('bad-embed'));
    expect(v.errors.length).toBe(1);
    expect(v.errors[0].file).toBe('reviews/Soap.md');
    expect(v.errors[0].messages.join(' ')).toMatch(/embed/i);
  });

  it('slug collision reports both files', () => {
    const v = loadVault(fx('bad-collision'));
    const msg = v.errors.map((e) => e.file + ' ' + e.messages.join(' ')).join('\n');
    expect(msg).toContain('Oat Soap.md');
    expect(msg).toContain('oat-soap.md');
  });

  it('reports each bad field', () => {
    const v = loadVault(fx('bad-fields'));
    const bad = v.errors.find((e) => e.file === 'reviews/Bad.md')!;
    const m = bad.messages.join('\n');
    expect(m).toMatch(/title/);
    expect(m).toMatch(/score/);
    expect(m).toMatch(/photo/);
    expect(m).toMatch(/verdict/);
    expect(m).toMatch(/date/);
    const amb = v.errors.find((e) => e.file === 'reviews/Ambiguous.md')!;
    expect(amb.messages.join('\n')).toMatch(/score/);
    expect(amb.messages.join('\n')).toMatch(/ambiguous/i);
  });
});
