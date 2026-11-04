import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import path from 'node:path';

const cutouts = path.resolve(process.env.CUTOUTS_DIR ?? './cutouts');

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://bebi.fyi',
  trailingSlash: 'always',
  integrations: [sitemap()],
  vite: {
    resolve: { alias: { '@cutouts': cutouts } },
    server: { fs: { allow: ['.', cutouts] } },
  },
});
