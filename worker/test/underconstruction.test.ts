// Stations under construction on the Worker side: no main photo before the
// merge, the cron after it, the manual merge, the page and the API.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rekey, missingStationsWithPhotos } from '../src/aliases.ts';
import { tokenHash } from '../src/auth.ts';
import { publishMergedMains, syncSiteTags } from '../src/construction.ts';
import worker from '../src/index.ts';
import { MERGE_SQL, mergeBinds } from '../src/merge.ts';
import { publishMain, type PublishEnv } from '../src/publish.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-26T12:00:00Z');
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

function jpeg(width: number, height: number): Uint8Array {
  const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 0xff, ...p];
  return Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xdb, new Array(65).fill(1)),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9,
  ]);
}

async function world() {
  const db = d1();
  db.sql.exec(`
    INSERT INTO stations (id, code, name, lat, lon, source, status, osm_ref, codes, updated_at) VALUES
      ('OSM-w1', 'ALM-00114', 'ALM-00114/155', 38.67, -9.16, 'osm', 'active', 'way/1', 'ALM-00114 ALM-00155', 'x'),
      ('OSM-w2', NULL, 'Obra', 38.70, -9.20, 'osm', 'missing_from_osm', 'way/2', NULL, 'x'),
      ('MOT-ALM-00114', 'ALM-00114', 'Almada', 38.6701, -9.1601, 'nap', 'active', 'way/9', NULL, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
      ('mod', 1, 'Mo', 'moderator', 'x', 'x'), ('ana', 2, 'Ana', 'trusted', 'x', 'x');
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await tokenHash('t')}', 'mod', 'x', '2999-01-01');
    INSERT INTO photos (id, station_id, panoramax_set, panoramax_id, credit, uploader_id, approved_by, status, approved_at, created_at) VALUES
      ('${A}', 'OSM-w1', 's1', 'pic-a', 'Ana', 'ana', 'ana', 'published', '2026-01-01', '2026-01-01'),
      ('${B}', 'OSM-w1', 's2', 'pic-b', 'Ana', 'ana', 'ana', 'published', '2026-02-01', '2026-02-01');
  `);
  const r2 = new Set<string>();
  const staging = new Map<string, Uint8Array>();
  for (const id of [A, B]) {
    staging.set(`${id}/main.jpg`, jpeg(1024, 768));
    staging.set(`${id}/thumb.jpg`, jpeg(400, 300));
  }
  const calls: { url: string; body?: string }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/hd.jpg')) return new Response(jpeg(2048, 1536));
    return new Response('{}');
  };
  const env = {
    DB: db, PANORAMAX_TOKEN: 'token', PANORAMAX_URL: 'https://pano.test',
    PICTURES: { async put(k: string) { r2.add(k); }, async delete(keys: string[]) { for (const k of keys) r2.delete(k); } },
    STAGING: { async get(k: string) { const b = staging.get(k); return b ? { arrayBuffer: async () => b.buffer } : null; } },
  } as unknown as PublishEnv;
  const merge = (from: string, to: string) => {
    for (const q of MERGE_SQL) db.sql.prepare(q).run(...(mergeBinds(q, [from, to, null, 'x']) as never[]));
  };
  return { db, env, r2, calls, fetcher, merge };
}

test('a station under construction never gets a main photo or a static link', async () => {
  const w = await world();
  assert.deepEqual(await publishMain(w.env, A, 'ana', w.fetcher, NOW), []);
  assert.equal(w.r2.size, 0);
  assert.equal(w.db.sql.prepare('SELECT COUNT(*) AS n FROM selections').get()!.n, 0);
});

test('after a merge the cron publishes the first photo as the NAP station main, once', async () => {
  const w = await world();
  w.merge('OSM-w1', 'MOT-ALM-00114');
  assert.deepEqual(await publishMergedMains(w.env, w.fetcher, NOW), ['MOT-ALM-00114']);
  assert.deepEqual([...w.r2].sort(), ['MOT-ALM-00114.full.jpg', 'MOT-ALM-00114.jpg', 'MOT-ALM-00114.thumb.jpg']);
  const sel = w.db.sql.prepare('SELECT photo_id, published_at FROM selections WHERE target = ?').get('MOT-ALM-00114') as { photo_id: string; published_at: string };
  assert.equal(sel.photo_id, A);
  assert.ok(sel.published_at);
  // Nothing left to do on the next run; a lost main is a moderator's call.
  assert.deepEqual(await publishMergedMains(w.env, w.fetcher, NOW), []);
  w.db.sql.exec(`UPDATE selections SET published_at = NULL, lost_at = 'y'`);
  assert.deepEqual(await publishMergedMains(w.env, w.fetcher, NOW), []);
});

test('the cron swaps the site tag on Panoramax and clears the marker', async () => {
  const w = await world();
  w.merge('OSM-w1', 'MOT-ALM-00114');
  assert.equal(await syncSiteTags(w.env, w.fetcher), 2);
  const patch = w.calls.find((c) => c.url === 'https://pano.test/api/pictures/pic-a');
  assert.deepEqual(JSON.parse(patch!.body!).semantics, [
    { action: 'delete', key: 'OlhaOPosto|site', value: 'OSM-w1' },
    { action: 'delete', key: 'OlhaOPosto|site', value: 'MOT-ALM-00114' },
    { action: 'add', key: 'OlhaOPosto|site', value: 'MOT-ALM-00114' },
  ]);
  assert.equal(w.db.sql.prepare('SELECT COUNT(*) AS n FROM photos WHERE site_tag_old IS NOT NULL').get()!.n, 0);
  assert.equal(await syncSiteTags(w.env, w.fetcher), 0);
});

test('the page of a merged station redirects; the API says lifecycle and lists the photos', async () => {
  const w = await world();
  const ctx = { waitUntil() {} } as never;
  const api = await worker.fetch(new Request(`${SITE}/api/v1/stations/OSM-w1`), w.env as never, ctx);
  const body = await api.json() as { lifecycle: string; codes: string[]; photo: unknown; photos: { id: string }[]; points: unknown[] };
  assert.equal(body.lifecycle, 'construction');
  assert.deepEqual(body.codes, ['ALM-00114', 'ALM-00155']);
  assert.equal(body.photo, null);
  assert.deepEqual(body.photos.map((p) => p.id), [A, B]);
  const html = await worker.fetch(new Request(`${SITE}/postos/OSM-w1`), w.env as never, ctx);
  assert.match(html.headers.get('content-security-policy') ?? '', /img-src 'self' https:\/\/panoramax\.ocarroeletrico\.com/);
  const search = await (await worker.fetch(new Request(`${SITE}/api/v1/stations?q=ALM-00155`), w.env as never, ctx)).json() as { results: { id: string; lifecycle?: string }[] };
  assert.deepEqual(search.results.map((r) => [r.id, r.lifecycle]), [['OSM-w1', 'construction']]);
  w.merge('OSM-w1', 'MOT-ALM-00114');
  const moved = await worker.fetch(new Request(`${SITE}/postos/OSM-w1`), w.env as never, ctx);
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), '/postos/MOT-ALM-00114');
  // Not a station to photograph for a static link, and not in the sitemap.
  const missing = await (await worker.fetch(new Request(`${SITE}/api/v1/stations?has_photo=false`), w.env as never, ctx)).json() as { results: { id: string }[] };
  assert.deepEqual(missing.results.map((r) => r.id), ['MOT-ALM-00114']);
});

test('the moderator page suggests the NAP station; merging by hand moves the photos', async () => {
  const w = await world();
  const rows = await missingStationsWithPhotos(w.env as never);
  assert.deepEqual(rows.map((r) => [r.id, r.suggest]), [['OSM-w1', 'MOT-ALM-00114']]);
  // Wrong NAP coordinates, kilometres away: the code still finds it.
  w.db.sql.exec(`UPDATE stations SET lat = 39.5, lon = -8.0 WHERE id = 'MOT-ALM-00114'`);
  assert.deepEqual((await missingStationsWithPhotos(w.env as never)).map((r) => [r.id, r.suggest]), [['OSM-w1', 'MOT-ALM-00114']]);
  const r = await rekey(new Request(`${SITE}/admin/rekey`, {
    method: 'POST', headers: { origin: SITE, cookie: '__Host-oop_session=t' },
    body: new URLSearchParams({ old: 'OSM-w1', new: 'MOT-ALM-00114', lang: 'pt' }),
  }), w.env as never, NOW);
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location') ?? '', /ok=merged/);
  assert.deepEqual(w.db.sql.prepare('SELECT DISTINCT station_id FROM photos').all().map((x) => x.station_id), ['MOT-ALM-00114']);
  assert.equal((w.db.sql.prepare('SELECT status FROM stations WHERE id = ?').get('OSM-w1') as { status: string }).status, 'merged');
  assert.equal((w.db.sql.prepare('SELECT created_by FROM station_aliases WHERE old_id = ?').get('OSM-w1') as { created_by: string }).created_by, 'mod');
});

test('a NAP station page shows its other published photos, never its main twice', async () => {
  const w = await world();
  w.merge('OSM-w1', 'MOT-ALM-00114');
  await publishMergedMains(w.env, w.fetcher, NOW);
  const ctx = { waitUntil() {} } as never;
  const page = await (await worker.fetch(new Request(`${SITE}/postos/MOT-ALM-00114`), w.env as never, ctx)).text();
  assert.ok(page.includes('src="https://pictures.ocarroeletrico.com/MOT-ALM-00114.jpg?v='));
  assert.ok(page.includes('Outras fotos'));
  assert.ok(page.includes(`href="/p/${B}"`));
  assert.ok(page.includes('/api/pictures/pic-b/thumb.jpg'));
  assert.ok(!page.includes('/api/pictures/pic-a/thumb.jpg'));
  // Only the main left: no gallery.
  w.db.sql.exec(`UPDATE photos SET status = 'hidden' WHERE id = '${B}'`);
  const alone = await (await worker.fetch(new Request(`${SITE}/postos/MOT-ALM-00114`), w.env as never, ctx)).text();
  assert.ok(!alone.includes('Outras fotos'));
});
