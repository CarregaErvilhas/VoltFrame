import assert from 'node:assert/strict';
import { test } from 'node:test';

import { missingStationsWithPhotos } from '../src/aliases.ts';
import worker from '../src/index.ts';
import { lostTargets } from '../src/mains.ts';
import { awardApproval } from '../src/points.ts';
import { chooseMain, publishMain, type PublishEnv } from '../src/publish.ts';
import {
  checkExternalRemovals, diffExternalPhotos, externalSql, toExternalPhotos,
  type ExternalPhotoRow, type Feed,
} from '../scripts/lib/stations.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const ST = 'EZC-AMD-00051';
const OWN_UUID = '4734620a-4710-49fc-9fc0-489ac752db2f';
const PANO_UUID = 'b0a380da-9b5f-43c8-8037-72d109137120';

const pano = (uuid: string, extra: object = {}) => ({
  src: `photos/${uuid.slice(0, 8)}.jpg`, credit: 'Alexmol', license: 'CC-BY-SA-4.0',
  page: `https://api.panoramax.xyz/#focus=pic&pic=${uuid}`, taken: '2021-11-09', ...extra,
});
const feed = (photos: object[], id = ST): Feed => ({
  schema: 1, generatedAt: '2000-01-02T00:00:00+00:00',
  sites: [{ id, lat: 38.7, lon: -9.2, photos }],
} as Feed);

test('toExternalPhotos: Panoramax and Commons become references, the rest is left out', () => {
  const rows = toExternalPhotos(feed([
    pano(PANO_UUID),
    { src: 'photos/c1.jpg', credit: 'Ana', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:Posto_EZ.jpg' },
    { page: 'https://www.mapillary.com/app/?pKey=1', credit: 'Mapillary' },                 // Mapillary
    pano('11111111-1111-1111-1111-111111111111', { src: undefined }),                      // no thumbnail
    pano('22222222-2222-2222-2222-222222222222', { license: undefined }),                  // no licence
    pano('33333333-3333-3333-3333-333333333333', { src: 'https://evil.test/x.jpg' }),      // thumbnail elsewhere
    pano('44444444-4444-4444-4444-444444444444', { page: 'http://api.panoramax.xyz/#pic=44444444-4444-4444-4444-444444444444' }),
    pano('77777777-7777-7777-7777-777777777777', { page: 'https://evilpanoramax.xyz/#pic=77777777-7777-7777-7777-777777777777' }),
    { src: 'photos/c2.jpg', credit: 'X', license: 'CC0', page: 'https://commons.wikimedia.org.evil.test/wiki/File:X.jpg' },
    { src: 'photos/c3.jpg', credit: 'X', license: 'CC0', page: 'https://evilwikimedia.org/wiki/File:X.jpg' },
    pano(PANO_UUID),                                                                        // repeated
  ]));
  assert.deepEqual(rows.map((r) => [r.origin, r.external_ref]), [
    ['osm_panoramax', PANO_UUID],
    ['commons', 'File:Posto EZ.jpg'],
  ]);
  assert.equal(rows[0].external_src, 'https://nap.ocarroeletrico.com/photos/b0a380da.jpg');
  assert.equal(rows[0].taken_at, '2021-11-09');
  assert.equal(rows[1].source_url, 'https://commons.wikimedia.org/wiki/File:Posto_EZ.jpg');
  assert.match(rows[0].id, /^ext_[0-9a-f]{24}$/);
});

test('toExternalPhotos: our own photos are skipped, by page, map link or Panoramax UUID', () => {
  const rows = toExternalPhotos(feed([
    pano('55555555-5555-5555-5555-555555555555', { page: `${SITE}/postos/${ST}`, map: `https://panoramax.ocarroeletrico.com/viewer?pic=${OWN_UUID}` }),
    pano(OWN_UUID),
    pano(PANO_UUID),
  ]), new Set([OWN_UUID]));
  assert.deepEqual(rows.map((r) => r.external_ref), [PANO_UUID]);
});

function seed() {
  const db = d1();
  db.sql.exec(`
    INSERT INTO stations (id, code, opc, operator, name, lat, lon, status, updated_at)
      VALUES ('${ST}', 'AMD-00051', 'EZC3', 'EZ', 'Posto', 38.7, -9.2, 'active', 'x');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, dc, updated_at)
      VALUES ('${ST}', 'p1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 0, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES ('ana', 2, 'Ana', 'contributor', 'x', 'x');
  `);
  return db;
}
const current = (db: ReturnType<typeof d1>) =>
  db.sql.prepare(`SELECT id, station_id, origin, external_ref, external_src, source_url, credit, license, taken_at
                    FROM photos WHERE origin <> 'olhaoposto'`).all() as unknown as ExternalPhotoRow[];
const run = (db: ReturnType<typeof d1>, f: Feed, own = new Set<string>()) => {
  const d = diffExternalPhotos(toExternalPhotos(f, own), current(db));
  for (const s of externalSql(d, f.generatedAt)) db.sql.exec(s);
  return d;
};

test('import: inserts, updates on change, is idempotent and removes what left the source', () => {
  const db = seed();
  let d = run(db, feed([pano(PANO_UUID), pano('66666666-6666-6666-6666-666666666666')]));
  assert.equal(d.upsert.length, 2);
  assert.equal(current(db).length, 2);
  const stored = db.sql.prepare(`SELECT status, evse_compact, uploader_id, panoramax_id FROM photos WHERE external_ref = ?`).get(PANO_UUID);
  assert.deepEqual({ ...stored }, { status: 'published', evse_compact: null, uploader_id: null, panoramax_id: null });

  d = run(db, feed([pano(PANO_UUID), pano('66666666-6666-6666-6666-666666666666')]));
  assert.deepEqual([d.upsert.length, d.removed.length], [0, 0]);

  d = run(db, feed([pano(PANO_UUID, { credit: 'Outro' })]));
  assert.deepEqual([d.upsert.length, d.removed.length], [1, 1]);
  assert.deepEqual(current(db).map((r) => r.credit), ['Outro']);
});

test('import: a removal never touches our own photos, and a mass removal is refused', () => {
  const db = seed();
  db.sql.exec(`INSERT INTO photos (id, station_id, uploader_id, panoramax_id, status, created_at)
               VALUES ('own', '${ST}', 'ana', '${OWN_UUID}', 'published', 'x')`);
  run(db, feed([pano(PANO_UUID)]));
  for (const s of externalSql({ upsert: [], removed: ['own'] }, 'x')) db.sql.exec(s);
  assert.equal((db.sql.prepare(`SELECT COUNT(*) AS n FROM photos WHERE id = 'own'`).get() as { n: number }).n, 1);
  assert.equal(checkExternalRemovals({ upsert: [], removed: ['a', 'b', 'c', 'd', 'e', 'f'] }, 10), 'refusing: 6 of 10 external photos would be removed. Check the feed; rerun with --allow-mass-missing if it is right.');
  assert.equal(checkExternalRemovals({ upsert: [], removed: ['a'] }, 10), null);
  assert.equal(checkExternalRemovals({ upsert: [], removed: ['a', 'b'] }, 3), null);
});

const get = (db: ReturnType<typeof d1>, path: string) =>
  worker.fetch(new Request(SITE + path), { DB: db } as never, {} as never);

test('station page and API show external photos, marked as external, with author, licence and link', async () => {
  const db = seed();
  run(db, feed([pano(PANO_UUID), { src: 'photos/c1.jpg', credit: '<b>Ana</b>', license: 'CC BY-SA 4.0', page: 'https://commons.wikimedia.org/wiki/File:A.jpg' }]));

  const api = await (await get(db, `/api/v1/stations/${ST}`)).json() as Record<string, any>;
  assert.equal(api.photo, null);
  assert.equal(api.externalPhotos.length, 2);
  assert.deepEqual(api.externalPhotos.find((p: any) => p.origin === 'osm_panoramax'), {
    id: api.externalPhotos.find((p: any) => p.origin === 'osm_panoramax').id, external: true, origin: 'osm_panoramax',
    thumb: 'https://nap.ocarroeletrico.com/photos/b0a380da.jpg', credit: 'Alexmol', license: 'CC-BY-SA-4.0',
    source: `https://api.panoramax.xyz/#focus=pic&pic=${PANO_UUID}`, takenAt: '2021-11-09',
  });

  for (const [path, mark, src] of [[`/postos/${ST}`, 'Externa', 'Ver na origem'], [`/en/stations/${ST}`, 'External', 'View at the source']]) {
    const res = await get(db, path);
    const page = await res.text();
    assert.match(page, new RegExp(`${mark} · Panoramax`));
    assert.match(page, new RegExp(`${mark} · Wikimedia Commons`));
    assert.ok(page.includes(src));
    assert.ok(page.includes('Alexmol') && page.includes('href="https://creativecommons.org/licenses/by-sa/4.0/deed'));
    assert.ok(page.includes('&lt;b&gt;Ana&lt;/b&gt;') && !page.includes('<b>Ana</b>'));
    assert.ok(page.includes(`href="https://api.panoramax.xyz/#focus=pic&amp;pic=${PANO_UUID}"`));
    // The page still has no main photo, and no external one is offered as a static link.
    assert.ok(!page.includes(`pictures.ocarroeletrico.com/${ST}.jpg"`));
    assert.match(res.headers.get('content-security-policy') ?? '', /img-src 'self' https:\/\/nap\.ocarroeletrico\.com https:\/\/pictures/);
  }
});

test('a station without external photos keeps the strict CSP', async () => {
  const db = seed();
  const res = await get(db, `/postos/${ST}`);
  assert.match(res.headers.get('content-security-policy') ?? '', /img-src 'self' https:\/\/pictures\.ocarroeletrico\.com;/);
  assert.ok(!(res.headers.get('content-security-policy') ?? '').includes('nap.'));
  assert.deepEqual(((await (await get(db, `/api/v1/stations/${ST}`)).json()) as any).externalPhotos, []);
});

test('external photos are never a main photo, never in the lost list, never earn points', async () => {
  const db = seed();
  run(db, feed([pano(PANO_UUID)]));
  const ext = current(db)[0].id;
  const env = {
    DB: db, PICTURES: { async put() {}, async delete() {} },
    STAGING: { async get() { return null; }, async delete() {} },
  } as unknown as PublishEnv;
  assert.deepEqual((await chooseMain(env, ST, ext, 'ana')).targets, []);
  assert.deepEqual(await publishMain(env, ext, 'ana'), []);
  assert.equal((db.sql.prepare('SELECT COUNT(*) AS n FROM selections').get() as { n: number }).n, 0);
  assert.deepEqual(await awardApproval(db as never, ext), []);

  // A station that lost its main photo does not offer the external one.
  db.sql.exec(`
    INSERT INTO photos (id, station_id, uploader_id, status, created_at) VALUES ('gone', '${ST}', 'ana', 'removed', 'x');
    INSERT INTO selections (target, station_id, photo_id, chosen_at, lost_at) VALUES ('${ST}', '${ST}', 'gone', 'x', '2026-11-25T10:00:00.000Z');`);
  const lost = await lostTargets(env);
  assert.deepEqual(lost.map((l) => [l.target, l.photos.length]), [[ST, 0]]);

  // Nor the "main photos" export, nor the credit page, nor the PUT.
  assert.deepEqual(((await (await get(db, '/api/v1/main-photos')).json()) as any).photos, []);
  assert.equal((await get(db, `/p/${ext}`)).status, 404);
  const put = await worker.fetch(new Request(`${SITE}/api/v1/selections/${ST}`, {
    method: 'PUT', headers: { authorization: 'Bearer oop_x', 'content-type': 'application/json' }, body: JSON.stringify({ photo: ext }),
  }), { DB: db } as never, {} as never);
  assert.ok([401, 403].includes(put.status));
});

test('a missing station with only external photos is not listed for an alias', async () => {
  const db = seed();
  run(db, feed([pano(PANO_UUID)]));
  db.sql.exec(`UPDATE stations SET status = 'missing_from_nap'`);
  assert.deepEqual(await missingStationsWithPhotos({ DB: db } as never), []);
});
