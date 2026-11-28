import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenHash } from '../src/auth.ts';
import worker from '../src/index.ts';
import { chooseMain } from '../src/publish.ts';
import { decideTakedown, parseAsked, reconcile, submitTakedown, takedownPage, takedownsHtml, takedownsPage, type PanelItem, type Report, type TakedownEnv } from '../src/takedown.ts';
import { d1 } from './d1.ts';

const SITE = 'https://olhaoposto.ocarroeletrico.com';
const NOW = new Date('2026-11-25T12:00:00Z');
const PHOTO = '11111111-2222-3333-4444-555555555555';
const PIC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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


// A station with two sockets; the station and the first socket have a main
// photo. Panoramax is faked with its report rules: the trigger hides the
// picture for AUTO_HIDE issues, and deleting the upload set takes its reports.
async function world(opts: { purge?: boolean; photo?: boolean; key?: boolean } = {}) {
  const db = d1();
  db.sql.exec(`
    INSERT INTO stations (id, code, opc, operator, name, lat, lon, status, updated_at)
      VALUES ('EZC-AMD-00051', 'AMD-00051', 'EZC3', 'EZ', 'Posto', 38.5, -9.25, 'active', 'x');
    INSERT INTO evses (station_id, point_id, evse_id, evse_compact, dc, updated_at) VALUES
      ('EZC-AMD-00051', 'AMD-00051-1', 'PT*EZC*E*AMD*00051*1', 'PTEZCEAMD000511', 0, 'x'),
      ('EZC-AMD-00051', 'AMD-00051-2', 'PT*EZC*E*AMD*00051*2', 'PTEZCEAMD000512', 0, 'x');
    INSERT INTO users (id, osm_uid, osm_name, role, created_at, last_login_at) VALUES ('mod', 1, 'Mo', 'moderator', 'x', 'x');
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('${await tokenHash('t')}', 'mod', 'x', '2999-01-01');
  `);
  if (opts.photo !== false) {
    db.sql.exec(`
      INSERT INTO photos (id, station_id, evse_compact, panoramax_set, panoramax_id, credit, status, created_at)
        VALUES ('${PHOTO}', 'EZC-AMD-00051', 'PTEZCEAMD000511', 'set-1', '${PIC}', 'Ana', 'published', 'x');
      INSERT INTO selections (target, station_id, photo_id, chosen_at, published_at) VALUES
        ('PTEZCEAMD000511', 'EZC-AMD-00051', '${PHOTO}', 'x', 'x'),
        ('EZC-AMD-00051', 'EZC-AMD-00051', '${PHOTO}', 'x', 'x');
    `);
  }
  const r2 = new Set(['PTEZCEAMD000511.jpg', 'PTEZCEAMD000511.thumb.jpg', 'PTEZCEAMD000511.full.jpg',
    'EZC-AMD-00051.jpg', 'EZC-AMD-00051.thumb.jpg', 'EZC-AMD-00051.full.jpg']);
  const staging = new Map([[`${PHOTO}/main.jpg`, jpeg(1024, 768)], [`${PHOTO}/thumb.jpg`, jpeg(400, 300)]]);
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] = [];
  const reports = new Map<string, Report>();
  const pano = { visibility: 'anyone', down: false, purgeFails: false };
  let action = 'takedown';
  let n = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body, headers: { ...(init?.headers as Record<string, string> | undefined) } });
    if (url.includes('siteverify')) {
      return Response.json({ success: true, hostname: 'olhaoposto.ocarroeletrico.com', action });
    }
    if (url.includes('purge_cache')) return new Response('{}', { status: pano.purgeFails ? 500 : 200 });
    if (url.endsWith('/hd.jpg')) return new Response(jpeg(2048, 1536));
    if (!url.startsWith('https://pano.test/')) return new Response('{}');
    if (pano.down) return new Response('down', { status: 503 });
    const path = new URL(url).pathname;
    if (method === 'POST' && path === '/api/reports') {
      const b = JSON.parse(body!) as { issue: string; picture_id: string; reporter_comments?: string };
      const auto = ['blur_missing', 'inappropriate', 'privacy', 'copyright'].includes(b.issue);
      if (auto) pano.visibility = 'owner-only';
      const r: Report = { id: `00000000-0000-0000-0000-00000000000${++n}`, issue: b.issue, picture_id: b.picture_id,
        status: auto ? 'open_autofix' : 'open', ts_opened: '2026-11-25T11:00:00+00:00', reporter_comments: b.reporter_comments };
      reports.set(r.id, r);
      return Response.json(r);
    }
    if (method === 'GET' && path === '/api/users/me/reports') {
      return Response.json({ reports: [...reports.values()].filter((r) => ['open', 'open_autofix', 'waiting'].includes(r.status)) });
    }
    const rep = path.match(/^\/api\/reports\/(.+)$/);
    if (rep) {
      const r = reports.get(rep[1]);
      if (!r) return new Response('{}', { status: 404 });
      if (method === 'PATCH') Object.assign(r, JSON.parse(body!));
      return Response.json(r);
    }
    if (method === 'PATCH' && path === `/api/pictures/${PIC}`) {
      pano.visibility = (JSON.parse(body!) as { visibility: string }).visibility;
      return Response.json({});
    }
    if (method === 'DELETE' && path === '/api/upload_sets/set-1') {
      for (const [id, r] of reports) if (r.picture_id === PIC) reports.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response('{}');
  };
  const env = {
    DB: db,
    PANORAMAX_TOKEN: 'token',
    PANORAMAX_URL: 'https://pano.test',
    TURNSTILE_SITEKEY: 'site',
    TURNSTILE_SECRET: 'secret',
    ...(opts.key ? { PANORAMAX_REPORT_KEY: 'waf-key' } : {}),
    ...(opts.purge === false ? {} : { CF_ZONE_ID: 'zone', CF_CACHE_PURGE_TOKEN: 'purge' }),
    PICTURES: {
      async put(k: string) { r2.add(k); },
      async delete(keys: string[]) { for (const k of keys) r2.delete(k); },
    },
    STAGING: {
      async get(k: string) { const b = staging.get(k); return b ? { arrayBuffer: async () => b.buffer } : null; },
      async put() {},
      async delete(keys: string[]) { for (const k of keys) staging.delete(k); },
    },
  } as unknown as TakedownEnv;
  return { db, env, r2, staging, calls, fetcher, reports, pano, setAction: (a: string) => { action = a; } };
}
type World = Awaited<ReturnType<typeof world>>;

const form = (path: string, fields: Record<string, string>) =>
  new Request(SITE + path, {
    method: 'POST',
    headers: { origin: SITE, cookie: '__Host-oop_session=t', 'cf-connecting-ip': '192.0.2.1' },
    body: new URLSearchParams(fields),
  });
const ask = (asked: string, extra: Record<string, string> = {}) =>
  form('/report', { alvo: asked, motivo: 'face', 'cf-turnstile-response': 'tok', lang: 'pt', ...extra });
const decide = (w: World, id: string, action: string, lang = 'pt') =>
  decideTakedown(form('/admin/remocao', { denuncia: id, action, lang }), w.env, w.fetcher, NOW);
const status = (w: World) =>
  (w.db.sql.prepare('SELECT status FROM photos WHERE id = ?').get(PHOTO) as { status: string }).status;
// Live selections (or still to clear), and the ones marked lost.
const selections = (w: World) =>
  w.db.sql.prepare('SELECT target FROM selections WHERE lost_at IS NULL ORDER BY target').all().map((r) => r.target);
const lost = (w: World) =>
  w.db.sql.prepare('SELECT target FROM selections WHERE lost_at IS NOT NULL AND published_at IS NULL ORDER BY target').all().map((r) => r.target);
// A report filed straight on Panoramax, as the viewer's button does.
const viewerReport = (w: World, issue: string) =>
  w.fetcher('https://pano.test/api/reports', { method: 'POST', body: JSON.stringify({ issue, picture_id: PIC }) });

// --- What people type ---

test('parseAsked: codes, our links, pictures.* and Panoramax', () => {
  assert.deepEqual(parseAsked(' EZC-AMD-00051 '), { target: 'EZC-AMD-00051' });
  assert.deepEqual(parseAsked('PT*EZC*E*AMD*00051*1'), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked('https://pictures.ocarroeletrico.com/PTEZCEAMD000511.thumb.jpg'), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked(`${SITE}/postos/EZC-AMD-00051`), { target: 'EZC-AMD-00051' });
  assert.deepEqual(parseAsked(`${SITE}/postos/EZC-AMD-00051#t-PTEZCEAMD000511`), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked(`${SITE}/tomadas/PT*EZC*E*AMD*00051*1`), { target: 'PTEZCEAMD000511' });
  assert.deepEqual(parseAsked(`https://panoramax.ocarroeletrico.com/viewer?focus=map&pic=${PIC.toUpperCase()}`), { picture: PIC });
  assert.deepEqual(parseAsked(`https://panoramax.ocarroeletrico.com/api/pictures/${PIC}/sd.jpg`), { picture: PIC });
  assert.deepEqual(parseAsked('https://example.com/x'), {});
  assert.deepEqual(parseAsked('<script>'), {});
});

// --- Photos in the API ---

test('station API: photo on the station and on each socket, null where none', async () => {
  const w = await world();
  const res = await worker.fetch(new Request(`${SITE}/api/v1/stations/EZC-AMD-00051`), w.env as never, {} as never);
  const body = await res.json() as Record<string, any>;
  assert.equal(body.photo.credit, 'Ana');
  assert.equal(body.photo.license, 'CC-BY-SA-4.0');
  assert.equal(body.photo.attribution, "© Ana, CC BY-SA 4.0, via olh'o'posto");
  assert.deepEqual(body.photo.sizes.thumb, { url: 'https://pictures.ocarroeletrico.com/EZC-AMD-00051.thumb.jpg', maxPx: 400 });
  assert.equal(body.photo.sizes.full.maxPx, 2048);
  assert.equal(body.photo.page, `${SITE}/postos/EZC-AMD-00051`);
  assert.equal(body.photo.panoramax, `https://panoramax.ocarroeletrico.com/viewer?focus=map&map=19/38.5/-9.25&pic=${PIC}`);
  assert.equal(body.photo.report, `${SITE}/report?alvo=EZC-AMD-00051`);
  assert.equal(body.points[0].photo.page, `${SITE}/postos/EZC-AMD-00051#t-PTEZCEAMD000511`);
  assert.equal(body.points[1].photo, null);
});

test('EVSE API: socket and station photos; a socket without one is still found', async () => {
  const w = await world();
  const get = async (code: string) =>
    (await worker.fetch(new Request(`${SITE}/api/v1/evses/${code}`), w.env as never, {} as never)).json() as Promise<Record<string, any>>;
  const one = await get('PTEZCEAMD000511');
  assert.equal(one.photo.sizes.main.url, 'https://pictures.ocarroeletrico.com/PTEZCEAMD000511.jpg');
  assert.equal(one.station.photo.target, 'EZC-AMD-00051');
  const two = await get('PTEZCEAMD000512');
  assert.equal(two.compact, 'PTEZCEAMD000512');
  assert.equal(two.photo, null);
  assert.equal(two.station.photo.target, 'EZC-AMD-00051');
});

// --- The public form ---

test('takedown: report filed anonymously, our copies hidden at once, with purges', async () => {
  const w = await world({ key: true });
  const res = await submitTakedown(ask(`${SITE}/postos/EZC-AMD-00051`, { motivo: 'plate', detalhes: 'a matrícula' }), w.env, w.fetcher);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/report?ok=1');
  const post = w.calls.find((c) => c.url === 'https://pano.test/api/reports')!;
  assert.equal(post.headers.authorization, undefined);             // anonymous: we stay the owner, not the reporter
  assert.equal(post.headers['x-olhaoposto-report'], 'waf-key');
  assert.deepEqual(JSON.parse(post.body!), {
    issue: 'blur_missing', picture_id: PIC, reporter_comments: `[plate] ${SITE}/postos/EZC-AMD-00051\na matrícula`,
  });
  assert.equal(status(w), 'hidden');
  assert.equal(w.pano.visibility, 'owner-only');
  const patch = w.calls.find((c) => c.method === 'PATCH')!;
  assert.deepEqual([patch.url, patch.body], [`https://pano.test/api/pictures/${PIC}`, '{"visibility":"owner-only"}']);
  assert.equal(w.r2.size, 0);
  assert.deepEqual(selections(w), []);
  assert.deepEqual(lost(w), ['EZC-AMD-00051', 'PTEZCEAMD000511']);   // lost, not "never had one"
  const purge = JSON.parse(w.calls.find((c) => c.url.includes('purge_cache'))!.body!).files as string[];
  assert.equal(purge.length, 9);
  assert.ok(purge.includes('https://pictures.ocarroeletrico.com/EZC-AMD-00051.full.jpg'));
  assert.ok(purge.includes(`https://panoramax.ocarroeletrico.com/api/pictures/${PIC}/sd.jpg`));
  // The API stops showing it.
  const api = await (await worker.fetch(new Request(`${SITE}/api/v1/stations/EZC-AMD-00051`), w.env as never, {} as never)).json() as Record<string, any>;
  assert.equal(api.photo, null);
  assert.equal(api.points[0].photo, null);
});

test('takedown: every reason maps to an issue Panoramax hides at once', async () => {
  for (const motivo of ['face', 'plate', 'property', 'copyright', 'other']) {
    const w = await world();
    await submitTakedown(ask('EZC-AMD-00051', { motivo }), w.env, w.fetcher);
    assert.equal([...w.reports.values()][0].status, 'open_autofix', motivo);
  }
});

test('takedown: the form stays closed without the purge secrets', async () => {
  const w = await world({ purge: false });
  const page = await (await worker.fetch(new Request(`${SITE}/report`), w.env as never, {} as never)).text();
  assert.ok(page.includes('info@ocarroeletrico.com') && !page.includes('cf-turnstile'));
  const res = await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher);
  assert.equal(res.headers.get('location'), '/report?erro=bad');
  assert.equal(status(w), 'published');
});


test('takedown: a failed purge keeps the selections, and reconcile finishes the job', async () => {
  const w = await world();
  w.pano.purgeFails = true;
  await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher);
  assert.equal(status(w), 'hidden');
  assert.equal(w.r2.size, 0);
  assert.deepEqual(selections(w), ['EZC-AMD-00051', 'PTEZCEAMD000511']);   // still to clear
  assert.deepEqual(lost(w), []);
  w.pano.purgeFails = false;
  await reconcile(w.env, w.fetcher);
  assert.deepEqual(selections(w), []);
  assert.deepEqual(lost(w), ['EZC-AMD-00051', 'PTEZCEAMD000511']);
  // A lost row is not "still to clear": the next run purges nothing more.
  const purges = w.calls.filter((c) => c.url.includes('purge_cache')).length;
  await reconcile(w.env, w.fetcher);
  assert.equal(w.calls.filter((c) => c.url.includes('purge_cache')).length, purges);
});

test('takedown: a second request for a hidden photo files nothing new', async () => {
  const w = await world();
  await submitTakedown(ask('PTEZCEAMD000511'), w.env, w.fetcher);
  const res = await submitTakedown(ask('ptezceamd000511'), w.env, w.fetcher);
  assert.equal(res.headers.get('location'), '/report?ok=2');
  // The station link (the API's and the figcaption's) finds it too, though
  // hiding cleared the station's selection.
  const byStation = await submitTakedown(ask(`${SITE}/postos/EZC-AMD-00051`), w.env, w.fetcher);
  assert.equal(byStation.headers.get('location'), '/report?ok=2');
  const viaPano = await submitTakedown(ask(`https://panoramax.ocarroeletrico.com/viewer?pic=${PIC}`), w.env, w.fetcher);
  assert.equal(viaPano.headers.get('location'), '/report?ok=2');
  assert.equal(w.reports.size, 1);
});

test('takedown: an unknown code is told so, and Panoramax is not called', async () => {
  const w = await world();
  const res = await submitTakedown(ask('XYZ-NOPE-1'), w.env, w.fetcher);
  assert.equal(res.headers.get('location'), '/report?erro=notfound');
  assert.equal(status(w), 'published');
  assert.deepEqual(w.calls.map((c) => c.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify']);
});

test('takedown: Panoramax down, nothing hidden and the person is asked to retry', async () => {
  const w = await world();
  w.pano.down = true;
  const res = await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher);
  assert.equal(res.headers.get('location'), '/report?erro=panoramax');
  assert.equal(status(w), 'published');
  assert.equal(w.r2.size, 6);
});

test('takedown: a Turnstile token made for the upload form is refused', async () => {
  const w = await world();
  w.setAction('upload');
  const res = await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher);
  assert.equal(res.headers.get('location'), '/report?erro=turnstile');
  assert.equal(status(w), 'published');
  assert.equal(w.reports.size, 0);
});

test('takedown: cross-site posts and missing reasons are refused', async () => {
  const w = await world();
  const cross = new Request(`${SITE}/report`, { method: 'POST', headers: { origin: 'https://evil.test' }, body: new URLSearchParams({ alvo: 'x' }) });
  assert.equal((await submitTakedown(cross, w.env, w.fetcher)).status, 403);
  const res = await submitTakedown(ask('EZC-AMD-00051', { motivo: 'boredom' }), w.env, w.fetcher);
  assert.equal(res.headers.get('location'), '/report?erro=bad');
});

test('takedown page: closed without Turnstile, escaped prefill, no contact field', () => {
  assert.ok(takedownPage('pt', { open: false }).includes('info@ocarroeletrico.com'));
  const open = takedownPage('en', { open: true, sitekey: 'k', asked: '"><script>' });
  assert.ok(open.includes('data-action="takedown"'));
  assert.ok(!open.includes('"><script>'));
  assert.ok(!open.includes('type="email"'));
  assert.ok(takedownPage('pt', { open: true, sitekey: 'k', ok: '2' }).includes('já está oculta'));
});

// --- Reports filed on Panoramax directly ---

test('reconcile: a viewer report that hid the picture clears our copies; others wait', async () => {
  const w = await world();
  await viewerReport(w, 'mislocated');
  await reconcile(w.env, w.fetcher);
  assert.equal(status(w), 'published');
  assert.equal(w.r2.size, 6);
  await viewerReport(w, 'privacy');
  await reconcile(w.env, w.fetcher);
  assert.equal(status(w), 'hidden');
  assert.equal(w.r2.size, 0);
  assert.deepEqual(selections(w), []);
});

test('reconcile: Panoramax unreadable is not taken as "no reports"', async () => {
  const w = await world();
  await viewerReport(w, 'privacy');
  w.pano.down = true;
  await reconcile(w.env, w.fetcher);
  assert.equal(status(w), 'published');   // nothing invented; the next run catches it
});

// --- Moderator decisions ---

test('remove: copies cleared, upload set deleted (its reports with it), staging emptied', async () => {
  const w = await world();
  await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher);
  const [id] = w.reports.keys();
  w.calls.length = 0;
  const res = await decide(w, id, 'remove');
  assert.equal(res.headers.get('location'), '/admin/remocoes?ok=remove');
  assert.ok(w.calls.some((c) => c.method === 'DELETE' && c.url === 'https://pano.test/api/upload_sets/set-1'));
  assert.equal(status(w), 'removed');
  assert.equal(w.staging.size, 0);
  assert.equal(w.reports.size, 0);
  // A second click on the same report is stale.
  assert.equal((await decide(w, id, 'keep')).headers.get('location'), '/admin/remocoes?erro=stale');
});

test('keep: reports closed first, picture public, photo published, empty links refilled', async () => {
  const w = await world();
  await submitTakedown(ask('EZC-AMD-00051'), w.env, w.fetcher);
  await viewerReport(w, 'copyright');
  const [id] = w.reports.keys();
  const res = await decide(w, id, 'keep', 'en');
  assert.equal(res.headers.get('location'), '/en/admin/takedowns?ok=keep');
  assert.deepEqual([...w.reports.values()].map((r) => r.status), ['closed_ignored', 'closed_ignored']);
  assert.equal(w.pano.visibility, 'anyone');
  assert.equal(status(w), 'published');
  assert.equal(w.r2.size, 6);
  assert.deepEqual(selections(w), ['EZC-AMD-00051', 'PTEZCEAMD000511']);
  assert.deepEqual(lost(w), []);
  // The next cron run leaves it alone.
  await reconcile(w.env, w.fetcher);
  assert.equal(status(w), 'published');
});

test('the admin panel is for moderators only', async () => {
  const w = await world();
  w.db.sql.exec(`UPDATE users SET role = 'trusted'`);
  const res = await worker.fetch(new Request(`${SITE}/admin/remocoes`, { headers: { cookie: '__Host-oop_session=t' } }), w.env as never, {} as never);
  assert.equal(res.status, 403);
  const post = await decide(w, '00000000-0000-0000-0000-000000000001', 'keep');
  assert.equal(post.status, 403);
});

// --- chooseMain on a socket (a compact EVSE code also passes STATION_ID) ---

test('chooseMain publishes a socket photo on the socket target', async () => {
  const w = await world();
  w.db.sql.exec(`DELETE FROM selections`);
  w.r2.clear();
  const { targets } = await chooseMain(w.env, 'PTEZCEAMD000511', PHOTO, 'mod', w.fetcher, NOW);
  assert.deepEqual(targets, ['PTEZCEAMD000511']);
  assert.ok(w.r2.has('PTEZCEAMD000511.full.jpg'));
  // A socket photo is not a station photo.
  assert.deepEqual((await chooseMain(w.env, 'EZC-AMD-00051', PHOTO, 'mod', w.fetcher, NOW)).targets, []);
});

test('admin panel: report text escaped, buttons only for our photos, overdue shown', () => {
  const evil = `<script>alert("x")</script>'`;
  const report = (extra: Partial<Report>): Report => ({
    id: 'r1', issue: 'privacy', status: 'open_autofix', picture_id: PIC, ts_opened: '2026-11-21T12:00:00+00:00',
    reporter_comments: evil, ...extra,
  });
  const photo = { id: PHOTO, station_id: 'EZC-AMD-00051', station_name: evil, evse_compact: 'PTEZCEAMD000511', status: 'hidden', uncleared: 0 };
  const items: PanelItem[] = [
    { report: report({}), photo },
    { report: report({ id: 'r2', picture_id: null, sequence_id: PIC, ts_opened: '2026-11-25T11:00:00+00:00' }), photo: null },
    { report: report({ id: 'r3', issue: 'mislocated', ts_opened: '2026-11-25T11:00:00+00:00' }), photo: null },
    { report: report({ id: 'r4', ts_opened: '2026-11-25T11:00:00+00:00' }), photo: { ...photo, uncleared: 2 } },
  ];
  const html = takedownsPage('pt', items, {}, NOW);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;'));
  const article = (n: number) => html.split('<article').slice(1)[n];
  assert.ok(article(0).includes('value="remove"') && article(0).includes('value="keep"'));
  assert.ok(article(0).includes('Atrasada 24 h') && article(0).includes('Privacidade'));
  assert.ok(article(1).includes('sequência') && !article(1).includes('value="remove"'));
  assert.ok(article(2).includes('Não corresponde') && article(2).includes('Faltam 71 h'));
  assert.ok(article(3).includes('ainda não foram limpos'));
  assert.ok(takedownsPage('en', null, {}, NOW).includes('Could not read the reports'));
});

test('admin panel page: lists the open reports and reconciles first', async () => {
  const w = await world();
  await viewerReport(w, 'privacy');
  const res = await takedownsHtml('pt', new Request(`${SITE}/admin/remocoes`, { headers: { cookie: '__Host-oop_session=t' } }), w.env, {}, w.fetcher, NOW);
  assert.equal(res.status, 200);
  assert.equal(status(w), 'hidden');
  const html = await res.text();
  assert.ok(html.includes('value="remove"') && html.includes('Privacidade'));
});
