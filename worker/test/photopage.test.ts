import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditPage, getCredit, osmEditUrl, type CreditRow } from '../src/photopage.ts';
import { stationPage } from '../src/pages.ts';
import { d1 } from './d1.ts';

function world() {
  const db = d1();
  db.sql.exec(`
    INSERT INTO users (id, osm_uid, osm_name, created_at, last_login_at) VALUES ('u', 1, 'u', '2000-01-01', '2000-01-01');
    INSERT INTO stations (id, status, lat, lon, osm_ref, name, updated_at) VALUES
      ('S1', 'active', 38.5, -9.1, 'node/42', 'Posto <b>', '2000-01-01'),
      ('S2', 'merged', 38.6, -9.2, NULL, NULL, '2000-01-01');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, status, dc, updated_at) VALUES
      ('S1', 'S1-1', 'PT*X*E*S1*1', 'PTXES11', 'active', 0, '2000-01-01');
    INSERT INTO photos (id, station_id, evse_compact, credit, status, panoramax_id, taken_at, created_at) VALUES
      ('main1', 'S1', NULL, 'Ana <script>', 'published', 'pano-1', '2026-03-04T10:00:00Z', '2026-03-05'),
      ('other', 'S1', NULL, 'Rui', 'published', 'pano-2', NULL, '2026-04-05'),
      ('sock', 'S1', 'PTXES11', 'Ana', 'published', 'pano-3', NULL, '2026-04-06'),
      ('pend', 'S1', NULL, 'Rui', 'pending', 'pano-4', NULL, '2026-04-07'),
      ('hid', 'S1', NULL, 'Rui', 'hidden', 'pano-5', NULL, '2026-04-07'),
      ('rem', 'S1', NULL, 'Rui', 'removed', 'pano-6', NULL, '2026-04-07'),
      ('prop', 'S2', NULL, 'Rui', 'published', 'pano-7', NULL, '2026-04-07');
    INSERT INTO selections (target, station_id, photo_id, chosen_by, chosen_at, published_at) VALUES
      ('S1', 'S1', 'main1', 'u', '2026-03-06', '2026-03-06'),
      ('PTXES11', 'S1', 'sock', 'u', '2026-03-06', '2026-03-06');
  `);
  return { DB: db as unknown as D1Database };
}

test('getCredit: only published photos of public stations', async () => {
  const env = world();
  assert.equal((await getCredit(env, 'main1'))?.is_main, 1);
  assert.equal((await getCredit(env, 'other'))?.is_main, 0);
  for (const id of ['pend', 'hid', 'rem', 'prop', 'nope', '../x', '']) assert.equal(await getCredit(env, id), null, id);
});

test('credit page: escaped, licence, links, main photo from pictures.*', async () => {
  const env = world();
  const row = (await getCredit(env, 'main1'))!;
  const page = creditPage('pt', row);
  assert.ok(page.includes('Ana &lt;script&gt;'));
  assert.ok(!page.includes('Ana <script>'));
  assert.ok(page.includes('Posto &lt;b&gt;'));
  assert.ok(page.includes('https://pictures.ocarroeletrico.com/S1.jpg'));
  assert.ok(page.includes('https://creativecommons.org/licenses/by-sa/4.0/deed.pt'));
  assert.ok(page.includes('datetime="2026-03-04"'));
  assert.ok(page.includes('href="/postos/S1"'));
  assert.ok(page.includes('panoramax.ocarroeletrico.com/viewer?focus=map&amp;map=19/38.5/-9.1&amp;pic=pano-1'));
  assert.ok(page.includes('hreflang="en" href="https://olhaoposto.ocarroeletrico.com/en/p/main1"'));
  assert.ok(page.includes('rel="canonical" href="https://olhaoposto.ocarroeletrico.com/p/main1"'));
  assert.ok(creditPage('en', row).includes('href="/en/stations/S1"'));
});

test('credit page: OSM tag only for the current main photo', async () => {
  const env = world();
  const main = creditPage('pt', (await getCredit(env, 'main1'))!);
  assert.ok(main.includes('panoramax=pano-1'));
  assert.ok(main.includes('https://www.openstreetmap.org/edit?editor=id&amp;node=42'));
  const other = creditPage('pt', (await getCredit(env, 'other'))!);
  assert.ok(!other.includes('panoramax=pano'));
  assert.ok(!other.includes('editor=id'));
  // Not main: shown from Panoramax, not from pictures.*.
  assert.ok(other.includes('https://panoramax.ocarroeletrico.com/api/pictures/pano-2/sd.jpg'));
  assert.ok(!other.includes('pictures.ocarroeletrico.com/S1'));
  // Link previews use the same photo, with the attribution.
  assert.ok(main.includes('<meta property="og:image" content="https://pictures.ocarroeletrico.com/S1.jpg?v=main1">'));
  assert.ok(other.includes('<meta property="og:image" content="https://panoramax.ocarroeletrico.com/api/pictures/pano-2/sd.jpg">'));
  assert.match(other, /<meta property="og:image:alt" content="[^"]+ · © [^"]+, CC BY-SA 4\.0, via olh&#39;o&#39;posto">/);
  assert.ok(other.includes('<meta name="twitter:card" content="summary_large_image">'));
});

test('credit page: a socket photo opens the editor on the position', async () => {
  const env = world();
  const row = (await getCredit(env, 'sock'))!;
  const page = creditPage('en', row);
  assert.ok(page.includes('panoramax=pano-3'));
  assert.ok(page.includes('editor=id#map=19/38.5/-9.1'));
  assert.ok(page.includes('https://pictures.ocarroeletrico.com/PTXES11.jpg'));
  assert.ok(page.includes('href="/en/stations/S1#t-PTXES11"'));
});

test('osmEditUrl: element, way, relation, or position', () => {
  const at = { evse_compact: null, lat: 1, lon: 2 };
  assert.equal(osmEditUrl({ ...at, osm_ref: 'way/7' }).url, 'https://www.openstreetmap.org/edit?editor=id&way=7');
  assert.equal(osmEditUrl({ ...at, osm_ref: 'relation/9' }).element, true);
  assert.equal(osmEditUrl({ ...at, osm_ref: 'bad/1' }).element, false);
  assert.equal(osmEditUrl({ ...at, osm_ref: null }).url, 'https://www.openstreetmap.org/edit?editor=id#map=19/1/2');
});

test('station page links the main photos to their credit pages', () => {
  const st = { id: 'S1', code: null, opc: null, operator: null, name: null, address: null, municipality: null, region: null, lat: 1, lon: 2, status: 'active', osm_ref: null, updated_at: '', source: 'nap', codes: null };
  const pt = { point_id: 'S1-1', evse_id: 'PT*X*E*S1*1', evse_compact: 'PTXES11', connector: 'T2', max_kw: 7, dc: 0, status: 'active' };
  const page = stationPage('pt', st, [pt], {
    S1: { credit: 'Ana', photo_id: 'main1' },
    PTXES11: { credit: 'Ana', photo_id: 'sock' },
  });
  assert.ok(page.includes('<a href="/p/main1">'));
  assert.ok(page.includes('<a href="/p/sock">'));
});

test('credit row shape is what the page needs', () => {
  const r: CreditRow = {
    id: 'x', station_id: 'S1', evse_compact: null, credit: null, taken_at: null, approved_at: null, created_at: '2026-01-02T00:00:00Z',
    panoramax_id: null, is_main: 0, station_name: null, lat: 1, lon: 2, osm_ref: null, station_status: 'active',
  };
  const page = creditPage('pt', r);
  assert.ok(page.includes("olh'o'posto"));
  assert.ok(page.includes('datetime="2026-01-02"'));
});
