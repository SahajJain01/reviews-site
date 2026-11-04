# bebi.fyi Reviews Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native execution chosen: Sahaj asked to "build it now and deploy"). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obsidian notes pushed to a private vault repo are validated, cut out, built with Astro and deployed to bebi.fyi automatically.

**Architecture:**
- **Content:** one pure TypeScript module (`src/lib/reviews.ts`) loads and validates the vault. Two things consume it:
  - a prepare script that lists the photos needing cutouts
  - the Astro pages
- **Cutouts:** a uv Python script (`pipeline/cutout.py`) writes them to `cutouts/` with a `manifest.json`.
- **Publishing:** a reusable GitHub workflow runs everything and deploys with Wrangler.

**Tech Stack:**
- Astro 7, TypeScript run natively by Node 26, `yaml`, `marked`, Vitest
- Python 3.12 + rembg (`birefnet-general-lite`) + Pillow via uv
- GitHub Actions, Cloudflare Pages + Wrangler 4

**Spec:** `docs/superpowers/specs/2026-11-04-reviews-site-design.md`

## Global Constraints

- **Domain:** `bebi.fyi` (root). **Pages project:** `bebi`.
- **Score:** 1–10 in 0.5 steps. Empty means draft.
- **Tiers:** S ≥ 9, A ≥ 8, B ≥ 6.5, C ≥ 5, D < 5.
- **Font:** Jackwrite Regular 400 / Bold 700, with fallback `'Courier Prime', ui-monospace, monospace`. No negative letter-spacing.
- **Colours:** background `#faf9f7`, text `#222`, secondary `#6a6a6a`, tertiary `#9a9a9a`, lines `#ebe8e3`, accent `#ff385c` (S tier only).
- **Grid:** cutouts float with no tile, no shadow. Min column 200 px, 2 columns under 760 px.
- **Layout shift:** `html { scrollbar-gutter: stable }`. Opening the dialog must not shift the layout.
- **Publish rules:** published = under `reviews/`, `draft` not true, `score` filled. Any invalid published note fails the build.

## Review Focus

1. **Obsidian writes an unquoted `[[x.jpg]]` property value as a nested YAML list.** `resolvePhoto` must accept `[["x.jpg"]]`. Test: `photo value parsed from unquoted wikilink`.
2. **YAML turns `date: 2026-11-02` into a JS `Date`.** It must normalise to `"2026-11-02"`, not shift a day in UTC+7. Test: `date object normalises without timezone shift`.
3. **A note in `reviews/` with no front matter at all** is treated as a draft, not a crash. Test: `note without front matter is unpublished`.
4. **Two notes whose filenames slugify to the same thing** are an error naming both files. Test: `slug collision reports both files`.
5. **A category typed with odd spacing or case** merges with the existing one. Test: `category keys merge case and spacing`.

---

### Task 1: Content library + tests

**Files:** create `src/lib/reviews.ts`, `tests/reviews.test.ts`, `tests/fixtures/good/**`, `tests/fixtures/bad-*/**`, `package.json`, `tsconfig.json`, `vitest.config.ts`

**Produces:**
- `slugify(s: string): string`
- `categoryKey(s: string): string`
- `tierOf(score: number): 'S'|'A'|'B'|'C'|'D'`
- `TIERS`
- `transformBody(md, resolver): { md: string; errors: string[] }`
- `loadVault(vaultDir: string): { reviews: Review[]; categories: Category[]; errors: VaultError[] }`
- `Review { slug, file, title, category, categorySlug, score, tier, photoPath, photoKey?, cutout, verdict, date, brand?, price?, place?, bodyHtml }`
- `Category { slug, name, count }`

- [ ] Write the tests: boundaries (4.5→D, 5→C, 6.5→B, 8→A, 9→S, 10→S), Review Focus items 1–5, wikilink → `/r/` link, private wikilink → plain text, embed → error, missing photo → error, ambiguous photo → error, sorting.
- [ ] Run `npx vitest run`. Expect FAIL.
- [ ] Implement `src/lib/reviews.ts`.
- [ ] Run `npx vitest run`. Expect PASS.
- [ ] Commit.

### Task 2: Prepare + cutout pipeline

**Files:** create `scripts/prepare.ts`, `pipeline/cutout.py`, `cutouts/manifest.json`

**Interface:**
- `node scripts/prepare.ts <vaultDir>` exits 1 on vault errors and writes the summary to `$GITHUB_STEP_SUMMARY`.
- It writes `.cache/pending.json`: `[{ key, src, cutout }]`.
- **`key`** = `sha256(photo bytes).slice(0,16) + '-' + (cutout ? 'bgl' : 'raw')`.

**Cutout script:** `uv run pipeline/cutout.py .cache/pending.json cutouts/` writes `cutouts/<key>.png|jpg` and updates the manifest: `{ [key]: { file, width, height, tint } }`.

- [ ] Run against the fixture vault locally. Expect a cutout PNG and a manifest entry. A second run skips everything.
- [ ] Commit.

### Task 3: Astro site

**Files:**
- `astro.config.mjs`, `src/styles/global.css`, `src/fonts/*`, `src/layouts/Base.astro`
- `src/components/{Pills,Item,Grid,TierList,Card}.astro`
- `src/pages/index.astro`, `src/pages/c/[cat].astro`, `src/pages/r/[slug].astro`, `src/pages/categories.json.ts`, `src/pages/404.astro`
- `src/scripts/dialog.ts`

**Rules:**
- **The vault dir comes from env `VAULT_DIR`**, defaulting to `../reviews-vault`.
- **Images:** `import.meta.glob('/cutouts/*.{png,jpg}')` + `getImage` produce WebP at 400/800 (grid) and 1200 (card).
- **Empty vault:** the page shows "Nothing reviewed yet."

- [ ] Build against the fixture vault (`VAULT_DIR=tests/fixtures/good npm run build`).
- [ ] Check the build output: `dist/index.html`, one `dist/c/*/index.html` per category, one `dist/r/*/index.html` per review, and `dist/categories.json`.
- [ ] Check visually with headless Chrome: grid, tier view, card on desktop, card on mobile. Confirm the pill position doesn't change between those states.
- [ ] Commit.

### Task 4: Workflows, repos, secrets, Cloudflare

- [ ] Write `.github/workflows/publish.yml`, triggered by `workflow_call`, `push` (main) and `workflow_dispatch`. Steps: checkout → prepare → cutouts (if pending) → build → deploy → commit cutouts.
- [ ] Create the GitHub repos (`reviews-site` public, `reviews-vault` private), the deploy keys and the secrets.
- [ ] Set up Cloudflare: create a Pages-only CI token; create Pages project `bebi`; attach custom domain `bebi.fyi` (+ apex CNAME); set up Web Analytics.
- [ ] Verify: a push to the vault runs the workflow, it succeeds, and `https://bebi.fyi` serves the review.

### Task 5: Vault on this PC

- [ ] Create `~/repos/reviews-vault` with:
  - `reviews/`, `attachments/`, `templates/review.md`
  - `.obsidian` config (templates, attachments, Obsidian Git, Image Converter)
  - `README.md` with phone setup
  - `.github/workflows/publish.yml` (caller)
- [ ] Register it in `~/.config/obsidian/obsidian.json`, open it in Obsidian and verify with a screenshot.
- [ ] Verify the round trip: a note edited in Obsidian on the PC is committed and pushed by Obsidian Git and shows up on bebi.fyi.
