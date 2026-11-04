# Reviews site — design

Date: 2026-11-04 · Owner: Sahaj · Status: draft for approval

## 1. Intent

A small, personal review site for everyday things: instant noodles, bottled
drinks, movies, chocolate, cheese, soap, gaming cafés, gym machines, and
whatever comes next. Sahaj writes reviews on his phone in Obsidian; pushing the
vault publishes them. The site is a quiet, photo-led catalogue of cut-out
objects. Scores sort each category into a tier list automatically.

Why: writing a review should take as long as writing a note. Everything after
"push" is automatic, and the data is structured so it can feed later features.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
- Publish from the phone: write a note from the template, attach a photo, push. Nothing else.
- Background removal runs automatically on every new photo.
- Homepage = category pills + a grid of cut-out images. Tapping an item opens a popup card (image left, review right).
- Picking a category shows that category as a tier list (S/A/B/C/D rows).
- Each review has its own URL (`/r/<slug>`) that opens straight onto the card.
- Categories are dynamic: typing a new category in a note creates it.
- Cloudflare Web Analytics on from day one, so "popular" can be added later.

**Non-goals (v1)**
- No "recent", "top picks" or "popular" sections on the homepage. The grid is newest-first; popular comes later.
- No search, comments, accounts, RSS, maps, cross-category comparison, or CMS UI.
- No multi-photo galleries (one main photo per review).
- No dark mode.

**Anti-goals (a failure even if it works)**
- Publishing requires a computer, or any step beyond writing the note and pushing.
- A broken or half-built site goes live. A bad review must stop the deploy; the previous version stays up.
- Product photos are redrawn or altered by a generative model. Cutouts must keep the original pixels.
- The page shifts sideways when filtering or opening a card (scrollbar jump).
- Private notes or the vault's raw photos become public.
- It starts to feel like a marketplace: badges, banners, CTAs, busy chrome.

## 3. Constraints

- Static site: **Astro**, hosted on **Cloudflare Pages**, at **reviews.sahajjain.com**. The `sahajjain.com` zone is already on Cloudflare.
- Writing happens on an Android phone with Obsidian + the Obsidian Git community plugin.
- The site repo is public, so GitHub Actions minutes are unlimited and free. The vault repo is private.
- Background removal runs on a standard GitHub-hosted Ubuntu runner (CPU only). A local spike measured ~13 s per photo for `birefnet-general-lite` on CPU. The model is 224 MB and is cached between runs.
- No AI CLI (codex/agy) in the pipeline: OAuth sessions in CI expire and break, the setup may conflict with subscription terms, and generative edits alter labels.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Vault push triggers one GitHub Actions workflow in the site repo. It checks out the vault, makes the cutouts, builds Astro, and deploys to Pages with Wrangler. | One pipeline, one log, all-or-nothing deploys. Cloudflare never needs vault access. Cost: no Cloudflare Git-integration preview deployments. |
| B | Actions makes the cutouts; Cloudflare Pages' Git integration builds the site. | Keeps Cloudflare's preview UI, but two systems race: a build can start before the cutouts land. Cloudflare would also need a token for the private vault. |
| C | Vault and site code in one repo. | Simplest to set up, but the phone would clone the whole codebase and private and public content would sit together. |

Sahaj picked **A**.

## 5. Architecture

```
phone (Obsidian + Obsidian Git)
   │ push
   ▼
github.com/SahajJain01/reviews-vault   (private)
   │ workflow "notify": repository_dispatch → reviews-site
   ▼
github.com/SahajJain01/reviews-site    (public)  workflow "publish"
   1. checkout site + checkout vault into ./vault (read-only token)
   2. validate notes (fail on errors)
   3. cutout step: new photos → transparent PNG + manifest entry
   4. astro build
   5. wrangler pages deploy → Cloudflare Pages project "reviews"
   6. commit new cutouts back to reviews-site ("[skip ci]"), only after the deploy succeeds
   ▼
reviews.sahajjain.com
```

- **Triggers for `publish`:** `repository_dispatch` (type `vault-updated`), `push` to `main` on reviews-site (code changes), and `workflow_dispatch` (manual).
- **Concurrency:** one `publish` run at a time (`concurrency: publish`, `cancel-in-progress: false`), so two quick pushes can't race on cutout commits.
- **Secrets**
  - In reviews-vault: `SITE_DISPATCH_TOKEN`, a fine-grained PAT that can trigger dispatches on reviews-site.
  - In reviews-site: `VAULT_READ_TOKEN` (fine-grained, contents:read on reviews-vault), `CLOUDFLARE_API_TOKEN` (Pages:edit), `CLOUDFLARE_ACCOUNT_ID`, and `CF_ANALYTICS_TOKEN` (the Web Analytics beacon token; public, but kept in config).
- **Failure behaviour:** any validation, cutout or build error fails the run before deploy. The live site is untouched, and GitHub emails Sahaj about the failed run. The run's job summary lists each problem with the note's file path and the field that's wrong.

## 6. Vault layout and authoring

```
reviews-vault/
  reviews/                 one note per review, any filename
  attachments/             photos (Obsidian "default location for new attachments")
  templates/review.md      template for the Templates core plugin
  .obsidian/               committed settings (templates folder, attachment folder)
  .github/workflows/notify.yml
  README.md                phone setup steps
```

**Template (`templates/review.md`)**

```yaml
---
title:
category:
score:
photo:
verdict:
date: {{date:YYYY-MM-DD}}
brand:
price:
place:
cutout: true
draft: false
---

```

The review body is free markdown below the front matter.

**Phone setup (documented in the vault README; done once by Sahaj):**
1. Clone with the Obsidian Git plugin.
2. Turn on the Templates core plugin.
3. Set the attachment folder to `attachments/`.
4. Install the Image Converter plugin and set it to resize pasted images to a 2000 px long edge as JPEG at ~85%. This keeps the vault small.

**Only `reviews/` is published.** Everything else in the vault is ignored by the site.

## 7. Content model and rules

| Field | Required to publish | Rule |
|---|---|---|
| `title` | yes | Non-empty string. |
| `category` | yes | Free text. See *Categories*. |
| `score` | yes | Number from 1 to 10 in 0.5 steps. Empty means draft. Any other value is an error. |
| `photo` | yes | Obsidian link (`"[[shin.jpg]]"`), a plain filename, or a path relative to the vault. Resolved like Obsidian does: exact path first, then a unique filename match anywhere in the vault. If not found, or ambiguous, it's an error. |
| `verdict` | yes | One line. Shown as the pull quote. |
| `date` | yes | `YYYY-MM-DD`. The date he tried it. |
| `brand`, `price`, `place` | no | Free text, shown as small fact chips. `price` is free text in v1 (e.g. `28k₫`). |
| `cutout` | no | Default `true`. `false` = show the photo as-is in a rounded frame (movies posters, gaming cafés). |
| `draft` | no | `true` = not published. |

- **Published** = in `reviews/`, `draft` is not true, and `score` is filled in. Notes that aren't published are never validated beyond that check, so half-written notes never break a deploy.
- **Slug** = the note's filename, slugified (lowercase ASCII, Vietnamese diacritics stripped, spaces → `-`). Two published notes with the same slug is an error. Renaming a note changes its URL; that is accepted in v1.
- **Categories:** the key is `category`, trimmed, with internal spaces collapsed, compared case-insensitively. `Instant Noodles` and `instant  noodles` are one category.
  - **Display name:** the most-used spelling, with ties broken by the newest review.
  - **Category slug:** the slugified key.
  - **New categories:** when a run creates a category that wasn't in the last deployed build, the job summary says so (catches typos). The build reads the previous category list from `categories.json`, which every deploy publishes.
- **Tiers** (constant in one config file, easy to retune):

  | Tier | Score |
  |---|---|
  | S | ≥ 9 |
  | A | ≥ 8 |
  | B | ≥ 6.5 |
  | C | ≥ 5 |
  | D | < 5 |

- **Sorting**
  - **"All" grid:** `date` descending, then `title`.
  - **Within a tier:** `score` descending, then `date` descending.
  - **Pills:** "All" first, then categories by review count descending, then by name.

## 8. Cutout step

- **Script:** a Python script in reviews-site (`pipeline/cutout.py`) run with `uv`, using `rembg` with the `birefnet-general-lite` model. The model directory `~/.u2net`/`~/.rembg` is cached with `actions/cache`.
- **Input:** each published review's photo where `cutout` ≠ false.
- **Cache key:** SHA-256 of the source photo bytes + the model name. If `cutouts/<key>.png` already exists, skip it.
- **Output:** `cutouts/<key>.png` (RGBA, trimmed to the alpha bounding box with a small margin, long edge capped at 1600 px). One entry per key goes in `cutouts/manifest.json`:
  - `width`, `height`
  - `tint`: the average colour of the opaque pixels, lightened toward white. It becomes the soft background of the popup's image panel.
- **Photos with `cutout: false`:** these are copied, not cut out. They go to `cutouts/<key>.jpg`, resized to a 1600 px long edge, with a `tint` taken from the whole image, so the site has one place to read images from.
- **Committing:** new files are committed back to reviews-site `main` by the workflow, **only after a successful deploy** (rebase onto `main` before pushing; the concurrency lock prevents runs racing). A failed run publishes nothing, and its cutouts are simply regenerated on the next run. They are committed with `[skip ci]` in the commit message so it doesn't trigger itself. Cutouts are public anyway, because they appear on the site. The private vault photos never leave the runner.
- **Cleanup:** cutouts for photos no longer referenced are left in place in v1. Pruning comes later.
- **Bad cutouts:** if a cutout comes out bad, the fix is to set `cutout: false` or reshoot. There's no manual mask editing in v1.

## 9. Site

**Build:** Astro, static output. A content collection with a `glob` loader over `vault/reviews/**/*.md` and a zod schema that applies section 7. Before Astro's schema check, a small pre-step reads the cutout manifest and gives each review an image path and tint. Images go through Astro's `<Image>`/`getImage` to produce WebP at grid size (~400 px and ~800 px for 2×) and card size (~1200 px).

**Routes**
- `/`: "All" grid, newest first.
- `/c/<category-slug>`: that category as tier rows.
- `/r/<review-slug>`: the same page as that review's `/c/<category>` (tier rows) with the card already open. It also works with JavaScript off, as a plain page. Closing the card when it was opened in-page goes back in history to where it came from. When `/r/` was the landing page (a shared link, or a refresh), closing replaces the URL with `/c/<category>`. Refreshing after opening a card from `/` therefore lands on the category view, which is accepted.
- `categories.json`: the category list, used by the next run's "new category" warning.

**Pills** are real links to `/c/...`. Astro view transitions make switching feel instant without a full-page flash. The active pill is filled near-black.

**Popup card**
- Clicking an item opens a `<dialog>` with that review's content and pushes `/r/<slug>` to history. Close (✕, Esc, backdrop click, browser Back) returns to the URL it came from. Review content for the current page is embedded at build time, so opening a card makes no network request.
- **Desktop:** two columns. Left: image on the review's tint, centred, no shadow. Right:
  - category (small caps label)
  - title
  - large score `x.x / 10` + tier chip (S chip uses the accent)
  - verdict as a quote
  - body
  - fact chips: brand, price, place, date
- **Mobile (< 760 px):** a single column, image on top.

**No layout shift**
- `html { scrollbar-gutter: stable }`.
- Opening the dialog locks page scroll and compensates for the scrollbar width, so nothing moves.
- Verified in the mockup: the first pill stayed at x = 44.5 px across load, filter, open and close.

**Visual system** (from approved mockup v3 = style "A · Floating, no drop shadow")
- **Font:** DM Sans (Google Fonts, self-hosted via Astro's font handling or `@fontsource`). Weights 500/600/700. Slight negative tracking on headings.
- **Colours**
  - Background `#faf9f7`
  - Text `#222`
  - Secondary text `#6a6a6a`
  - Tertiary text `#9a9a9a`
  - Lines `#ebe8e3`
  - Accent `#ff385c`, used only for the S tier
- **Grid:** auto-fill columns, min 200 px (2 columns on mobile). Gaps 36 px vertical × 28 px horizontal. Each item:
  - square frame with the cutout floating, transparent, no shadow, no tile
  - title + score on one line, category below
  - hover: image lifts ~6 px and scales 1.03
- **Non-cutout images** (`cutout: false`) sit in the same square frame as a rounded rectangle (16 px radius), filled with `object-fit: cover`.
- **Header:** `sahaj / reviews` wordmark left, "N things, honestly scored" right. Pills are sticky under the header and scroll sideways on mobile.
- **Card:** 32 px radius, a single soft shadow on the card only, blurred backdrop.
- **Reference mockup:** `docs/design/mockup-v3.html` (copied into the repo with its sample images).

**Meta:** each `/r/` page has a title, description (the verdict) and `og:image` (the cutout). Sitemap via `@astrojs/sitemap`.

**Analytics:** the Cloudflare Web Analytics beacon on every page. Popular reviews come later (see section 11).

## 10. Testing

- **Unit tests (Vitest):**
  - category normalisation and display-name choice
  - slugify (including Vietnamese)
  - tier mapping at the boundaries (4.5, 5, 6.5, 8, 9, 10)
  - score validation
  - photo-link resolution (wikilink, plain name, path, missing, ambiguous)
  - published/draft rules
  - sorting
- **Fixture vault** in `tests/fixtures/vault/`: about 8 reviews across categories, plus deliberately broken notes in a separate fixture. The build must succeed on the good fixture. It must fail on each broken note with a message that names the file.
- **Cutout script test:** runs on one small fixture image and checks there's an RGBA output, a manifest entry, and a skip on re-run. CI runs it, so it uses the real model.
- **Smoke check after the build:**
  - `dist/` has `/`, one `/c/` page per category and one `/r/` page per review
  - every `<img>` resolves
  - `categories.json` exists
- **Manual check before calling v1 done:** the real phone flow end to end. Write a note, attach a photo, push, then see it live on reviews.sahajjain.com within a few minutes.

## 11. Later (designed for, not built)

The review data (category, score, date, brand, price, place, tint) is enough for:

- **Popular:** read page views per `/r/` path at build time from Cloudflare's GraphQL Analytics API (Web Analytics data). Add a "popular" ordering or pill once traffic exists.
- **Value scores:** this needs price normalised to a number first.
- **Gaming cafés on a map:** needs a coordinates field.
- **Brand pages:** "every Nongshim I've tried".
- **Score history over time.**
- **Colour-sorted grid:** using `tint`.
- **Random pick.**
- **Comparisons within a category.**
- **AI-written alt text:** a non-blocking, optional pipeline step.

## 12. Decisions made by the agent (Sahaj to check)

1. Fail the whole deploy on any invalid published note, rather than skipping it and publishing the rest. Reason: skipped reviews would vanish silently, whereas a failed run emails him.
2. Cutouts committed to the public site repo, keyed by a content hash. Not Actions cache, which is evicted after 7 days without use, and not R2, which is one more service.
3. Pills are real pages (`/c/...`), not client-side filtering. The pages can be shared, work without JS, and are simpler to build statically.
4. Grid order is newest first. Pills are ordered by review count.
5. `price` stays free text in v1.
6. Renaming a note changes its URL. No redirects in v1.
7. Movie posters and gaming-café photos use `cutout: false`, set per note (no per-category defaults).
8. `/r/` renders behind the card as the category's tier view. Closing a card you landed on directly goes to `/c/<category>`.
9. Cutouts are committed only after a successful deploy. The public Actions log and job summary may show note filenames and field errors for *published* notes. That's accepted, because those notes are going public anyway, and drafts are never validated or named.
10. Model: `birefnet-general-lite`, about 13 s per photo on CPU in the spike. The heavier `birefnet-general` is an option if edges look rough.

## 13. Left to the builder

- Astro version and integrations. Exact component structure.
- Exact responsive breakpoints beyond "2 columns under 760 px".
- How to share the tier logic between the build and the tests.
- Workflow file details, caching keys and the job-summary format.
- Whether the validation pre-step is a TypeScript script or lives inside the Astro content config.
- Cloudflare Pages project creation and DNS. There's an existing skill `cloudflare-dns` for `sahajjain.com`.
