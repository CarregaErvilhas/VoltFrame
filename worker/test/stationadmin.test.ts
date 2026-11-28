// The moderators' page of a station's photos (src/stationadmin.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import worker from '../src/index.ts';
import { stationAdminAction } from '../src/stationadmin.ts';
import { drainPurgeQueue } from '../src/publish.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-27T12:00:00Z');
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const S = '00000000-0000-0000-0000-00000000000c';
const P = '00000000-0000-0000-0000-00000000000d';

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
    INSERT INTO stations (id, code, name, lat, lon, source, status, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051', 'Amadora', 38.78, -9.22, 'nap', 'active', 'x');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, connector, max_kw, status, dc, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051-1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 'CCS', 50, 'active', 1, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES
      ('mod', 1, 'Mo', 'moderator', 'x', 'x'), ('tru', 2, 'Tu', 'trusted', 'x', 'x'), ('ana', 3, 'Ana', 'contributor', 'x', 'x');
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES
      ('${await tokenHash('m')}', 'mod', 'x', '2999-01-01'), ('${await tokenHash('t')}', 'tru', 'x', '2999-01-01');
    INSERT INTO photos (id, station_id, evse_compact, panoramax_set, panoramax_id, credit, uploader_id, approved_by, status, approved_at, created_at) VALUES
      ('${A}', 'EZC-AMD-00051', NULL, 's1', 'pic-a', 'Ana', 'ana', 'mod', 'published', '2026-01-01', '2026-01-01'),
      ('${B}', 'EZC-AMD-00051', NULL, 's2', 'pic-b', 'Ana', 'ana', 'mod', 'published', '2026-02-01', '2026-02-01'),
      ('${S}', 'EZC-AMD-00051', 'PTEZCEAMD000511', 's3', 'pic-s', 'Ana', 'ana', 'mod', 'published', '2026-03-01', '2026-03-01');
    INSERT INTO photos (id, station_id, kind, panoramax_set, panoramax_id, credit, uploader_id, approved_by, status, approved_at, created_at) VALUES
      ('${P}', 'EZC-AMD-00051', 'plate', 's4', 'pic-p', 'Ana', 'ana', 'mod', 'published', '2026-04-01', '2026-04-01');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES
      ('EZC-AMD-00051', 'EZC-AMD-00051', '${A}', 'x', 'x');
  `);
  const r2 = new Map<string, number>();
  const staging = new Map<string, Uint8Array>();
  for (const id of [A, B, S, P]) {
    staging.set(`${id}/main.jpg`, jpeg(1024, 768));
    staging.set(`${id}/thumb.jpg`, jpeg(400, 300));
  }
  const fetcher = async (url: string) => (String(url).endsWith('/hd.jpg') ? new Response(jpeg(2048, 1536)) : new Response('{}'));
  const env = {
    DB: db, PANORAMAX_TOKEN: 'token', PANORAMAX_URL: 'https://pano.test',
    CF_ZONE_ID: 'zone', CF_CACHE_PURGE_TOKEN: 'purge' as string | undefined,
    PICTURES: { async put(k: string) { r2.set(k, (r2.get(k) ?? 0) + 1); }, async delete(keys: string[]) { for (const k of keys) r2.delete(k); } },
    STAGING: { async get(k: string) { const b = staging.get(k); return b ? { arrayBuffer: async () => b.buffer } : null; }, async delete() {} },
  };
  return { db, env, r2, fetcher };
}

const cookie = (t: string) => `__Host-oop_session=${t}`;
const post = (fields: Record<string, string>, session = 'm') => new Request(`${SITE}/admin/posto-foto`, {
  method: 'POST',
  headers: { origin: SITE, cookie: cookie(session), 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

test('the page groups the photos by target, marks the main one, and is for moderators only', async () => {
  const w = await world();
  const ctx = { waitUntil() {} } as never;
  const get = (s: string) => worker.fetch(new Request(`${SITE}/admin/posto/EZC-AMD-00051`, { headers: { cookie: cookie(s) } }), w.env as never, ctx);
  const res = await get('m');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.ok(html.includes('id="t-EZC-AMD-00051"') && html.includes('id="t-PTEZCEAMD000511"'));
  // A is the main: no promote button on it; B has one.
  const block = (id: string) => html.slice(html.indexOf(`value="${id}"`) - 600, html.indexOf(`value="${id}"`) + 600);
  assert.ok(html.indexOf('Principal') < html.indexOf(`value="${B}"`));
  assert.ok(block(B).includes('Tornar principal'));
  assert.ok(html.includes('Remover a principal'));
  assert.equal((await get('t')).status, 403);
});

test('promote makes another photo the main one; remove takes a photo out with its reason', async () => {
  const w = await world();
  const r = await stationAdminAction(post({ action: 'promote', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: B, lang: 'pt' }), w.env as never, w.fetcher as never, NOW);
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location')!, /\?r=promoted#t-EZC-AMD-00051$/);
  assert.equal(w.db.sql.prepare('SELECT photo_id FROM selections WHERE target = ?').get('EZC-AMD-00051')!.photo_id, B);
  // A socket photo never becomes the station's main photo.
  const bad = await stationAdminAction(post({ action: 'promote', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: S, lang: 'pt' }), w.env as never, w.fetcher as never, NOW);
  assert.match(bad.headers.get('location')!, /\?r=photo/);
  // Removing needs a reason.
  const none = await stationAdminAction(post({ action: 'remove', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: A, lang: 'pt' }), w.env as never, w.fetcher as never, NOW);
  assert.match(none.headers.get('location')!, /\?r=reason/);
  const gone = await stationAdminAction(post({ action: 'remove', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: A, reason: 'duplicate', lang: 'pt' }), w.env as never, w.fetcher as never, NOW);
  assert.match(gone.headers.get('location')!, /\?r=removed/);
  const row = w.db.sql.prepare('SELECT status, refusal_reason FROM photos WHERE id = ?').get(A) as { status: string; refusal_reason: string };
  assert.notEqual(row.status, 'published');
  assert.equal(row.refusal_reason, 'duplicate');
});

test('a trusted account can neither promote nor remove from this page', async () => {
  const w = await world();
  const r = await stationAdminAction(post({ action: 'promote', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: B, lang: 'pt' }, 't'), w.env as never, w.fetcher as never, NOW);
  assert.equal(r.status, 403);
});

test('/api/v1/me says whether to show the moderators link, never cached', async () => {
  const w = await world();
  const ctx = { waitUntil() {} } as never;
  const me = async (h: Record<string, string>) => {
    const res = await worker.fetch(new Request(`${SITE}/api/v1/me`, { headers: h }), w.env as never, ctx);
    assert.match(res.headers.get('cache-control')!, /no-store/);
    return res.json() as Promise<{ moderator: boolean; role: string | null }>;
  };
  assert.deepEqual(await me({ cookie: cookie('m') }), { role: 'moderator', moderator: true });
  assert.deepEqual(await me({ cookie: cookie('t') }), { role: 'trusted', moderator: false });
  assert.deepEqual(await me({}), { role: null, moderator: false });
});

test('a rating plate is in its own section, can be removed and never made main', async () => {
  const w = await world();
  const ctx = { waitUntil() {} } as never;
  const html = await (await worker.fetch(new Request(`${SITE}/admin/posto/EZC-AMD-00051`, { headers: { cookie: cookie('m') } }), w.env as never, ctx)).text();
  const plates = html.slice(html.indexOf('id="chapas"'));
  assert.ok(plates.includes(`value="${P}"`));
  assert.ok(!plates.includes('Tornar principal'));
  // Not under the station's own photos.
  assert.ok(html.indexOf(`value="${P}"`) > html.indexOf('id="chapas"'));
  const r = await stationAdminAction(post({ action: 'promote', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: P, lang: 'pt' }), w.env as never, w.fetcher as never, NOW);
  assert.match(r.headers.get('location')!, /\?r=photo/);
  assert.equal(w.db.sql.prepare('SELECT photo_id FROM selections WHERE target = ?').get('EZC-AMD-00051')!.photo_id, A);
});

test('the station page shows rating plates in their own gallery, not as photos', async () => {
  const w = await world();
  const ctx = { waitUntil() {} } as never;
  const html = await (await worker.fetch(new Request(`${SITE}/postos/EZC-AMD-00051`), w.env as never, ctx)).text();
  assert.ok(html.includes('id="plates-h">Chapas'));
  const plates = html.slice(html.indexOf('id="plates-h"'));
  assert.ok(plates.includes('/api/pictures/pic-p/thumb.jpg'));
  const more = html.slice(html.indexOf('id="more-h"'), html.indexOf('id="plates-h"'));
  assert.ok(more.includes('/api/pictures/pic-b/thumb.jpg') && !more.includes('pic-p'));
  const api = await (await worker.fetch(new Request(`${SITE}/api/v1/stations/EZC-AMD-00051`), w.env as never, ctx)).json() as { photos: { id: string; kind: string; socket: string | null }[] };
  assert.deepEqual(api.photos.map((p) => [p.id, p.kind, p.socket]), [[B, 'photo', null], [S, 'photo', 'PTEZCEAMD000511'], [P, 'plate', null]]);
});

test('move: a photo goes to a socket or the plates, its Panoramax tags follow, the main stays put', async () => {
  const w = await world();
  const patches: { url: string; body: unknown }[] = [];
  let fail = false;
  const fetcher = async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: fail ? 500 : 200 });
    }
    return new Response('{}');
  };
  const move = (photo: string, to: string) => stationAdminAction(post({ action: 'move', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo, to, lang: 'pt' }), w.env as never, fetcher as never, NOW);
  const row = (id: string) => w.db.sql.prepare('SELECT evse_compact, kind FROM photos WHERE id = ?').get(id) as { evse_compact: string | null; kind: string };

  assert.match((await move(B, 'PTEZCEAMD000511')).headers.get('location')!, /r=moved/);
  assert.deepEqual({ ...row(B) }, { evse_compact: 'PTEZCEAMD000511', kind: 'photo' });
  assert.equal(patches[0].url, 'https://pano.test/api/pictures/pic-b');
  assert.deepEqual(patches[0].body, { semantics: [{ action: 'add', key: 'osm|ref:EU:EVSE', value: 'PT*EZC*E*AMD*00051*1' }] });

  await move(B, 'plate');
  assert.deepEqual({ ...row(B) }, { evse_compact: null, kind: 'plate' });
  assert.deepEqual(patches[1].body, { semantics: [
    { action: 'delete', key: 'osm|ref:EU:EVSE', value: 'PT*EZC*E*AMD*00051*1' },
    { action: 'add', key: 'OlhaOPosto|kind', value: 'plate' },
  ] });

  // Panoramax fails: nothing changes in D1.
  fail = true;
  assert.match((await move(B, 'EZC-AMD-00051')).headers.get('location')!, /r=move\b/);
  assert.equal(row(B).kind, 'plate');
  fail = false;

  // The main photo does not move.
  assert.match((await move(A, 'plate')).headers.get('location')!, /r=ismain/);
  assert.equal(row(A).kind, 'photo');
  // Unknown socket.
  assert.match((await move(S, 'PTNOPE1')).headers.get('location')!, /r=bad/);
});

test('a purge that fails is queued, told to the moderator, and retried by the cron until Cloudflare accepts', async () => {
  const w = await world();
  const purges: { files: string[] }[] = [];
  let cloudflare: 'down' | 'up' = 'down';
  const fetcher = async (url: string, init?: RequestInit) => {
    if (String(url).includes('/purge_cache')) {
      purges.push(JSON.parse(String(init!.body)));
      return cloudflare === 'up'
        ? new Response('{"success":true}')
        : new Response('{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}', { status: 403 });
    }
    return w.fetcher(url);
  };
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.join(' ')); };
  try {
    const r = await stationAdminAction(post({ action: 'promote', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: B, lang: 'pt' }), w.env as never, fetcher as never, NOW);
    assert.match(r.headers.get('location')!, /\?r=cache#t-EZC-AMD-00051$/);
    // The swap itself went through: D1 and R2 have the new photo.
    assert.equal(w.db.sql.prepare('SELECT photo_id FROM selections WHERE target = ?').get('EZC-AMD-00051')!.photo_id, B);
    const queued = () => (w.db.sql.prepare('SELECT url, attempts, last_error FROM purge_queue ORDER BY url').all() as { url: string; attempts: number; last_error: string | null }[]);
    assert.deepEqual(queued().map((q) => q.url), [
      'https://pictures.ocarroeletrico.com/EZC-AMD-00051.full.jpg',
      'https://pictures.ocarroeletrico.com/EZC-AMD-00051.jpg',
      'https://pictures.ocarroeletrico.com/EZC-AMD-00051.thumb.jpg',
    ]);
    // Cloudflare's reason reaches the logs, never the token.
    assert.ok(errors.some((e) => String(e).includes('HTTP 403: 10000 Authentication error')));
    assert.ok(!errors.some((e) => String(e).includes('purge') && String(e).includes("'purge'")));

    // The cron: still down, the URLs stay with the error.
    assert.equal(await drainPurgeQueue(w.env as never, fetcher as never), 0);
    assert.equal(queued().length, 3);
    assert.ok(queued().every((q) => q.attempts === 1 && q.last_error!.includes('Authentication error')));
    // Up again: one request with the three URLs, and the queue empties.
    cloudflare = 'up';
    assert.equal(await drainPurgeQueue(w.env as never, fetcher as never), 3);
    assert.equal(queued().length, 0);
    assert.equal(purges.at(-1)!.files.length, 3);
    assert.equal(await drainPurgeQueue(w.env as never, fetcher as never), 0);

    // Without the purge secrets: queued as well, with the reason in the logs.
    w.env.CF_CACHE_PURGE_TOKEN = undefined;
    const r2 = await stationAdminAction(post({ action: 'promote', station: 'EZC-AMD-00051', target: 'EZC-AMD-00051', photo: A, lang: 'pt' }), w.env as never, fetcher as never, NOW);
    assert.match(r2.headers.get('location')!, /\?r=cache/);
    assert.equal(queued().length, 3);
    assert.ok(errors.some((e) => String(e).includes('not configured')));
  } finally {
    console.error = log;
  }
});

test('the purge queue migration queues every live static link once', () => {
  const db = d1();
  // Only the selections matter here.
  db.sql.exec('PRAGMA foreign_keys = OFF');
  db.sql.exec(`
    INSERT INTO selections (target, station_id, photo_id, chosen_by, chosen_at, published_at, lost_at) VALUES
      ('EZC-AMD-00051', 'EZC-AMD-00051', 'a', 'u', '2026-01-01', '2026-01-01', NULL),
      ('PTEZCEAMD000511', 'EZC-AMD-00051', 'b', 'u', '2026-01-01', '2026-01-01', NULL),
      ('EZC-AMD-00052', 'EZC-AMD-00052', 'c', 'u', '2026-01-01', NULL, '2026-01-02'),
      ('EZC-AMD-00053', 'EZC-AMD-00053', 'd', 'u', '2026-01-01', NULL, NULL);
  `);
  const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0020_purge_queue.sql'), 'utf8');
  db.sql.exec(sql.slice(sql.indexOf('INSERT OR IGNORE')));
  const urls = (db.sql.prepare('SELECT url FROM purge_queue ORDER BY url').all() as { url: string }[]).map((r) => r.url);
  assert.deepEqual(urls, [
    'https://pictures.ocarroeletrico.com/EZC-AMD-00051.full.jpg',
    'https://pictures.ocarroeletrico.com/EZC-AMD-00051.jpg',
    'https://pictures.ocarroeletrico.com/EZC-AMD-00051.thumb.jpg',
    'https://pictures.ocarroeletrico.com/PTEZCEAMD000511.full.jpg',
    'https://pictures.ocarroeletrico.com/PTEZCEAMD000511.jpg',
    'https://pictures.ocarroeletrico.com/PTEZCEAMD000511.thumb.jpg',
  ]);
});
