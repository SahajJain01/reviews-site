import type { APIRoute } from 'astro';
import { data } from '../lib/site.ts';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(data().categories.map(({ slug, name, count }) => ({ slug, name, count }))), {
    headers: { 'content-type': 'application/json' },
  });
