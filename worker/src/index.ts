// olh'o'posto Worker (olhaoposto.ocarroeletrico.com): the station pages, the
// read-only API and sign-in with OpenStreetMap (auth.ts). Fonts, CSS and icons in public/ are Workers static assets,
// served before this code runs. Static photo links are served by the R2
// bucket on pictures.ocarroeletrico.com, never by this Worker (Docs/arquitetura.md).
import { ROLE_ACTION, setRole, usersHtml } from './admin.ts';
import { decisionsHtml } from './decisions.ts';
import { OWN_THUMB_PREFIX, ownThumbnail, uploadsHtml } from './uploads.ts';
import { DECIDE_ACTION, STAGING_PREFIX, decide, queueHtml, stagingImage } from './moderation.ts';
import { afterMerges } from './construction.ts';
import { ALIAS_ACTION, aliasPath, aliasesHtml, getStationAlias, rekey } from './aliases.ts';
import { ACCOUNT_ACTION, accountAction, accountHtml } from './account.ts';
import { callback, login, logout } from './auth.ts';
import { apiCaller, canChooseMain } from './tokens.ts';
import { submitPhoto, uploadHtml, type PhotoEnv } from './photos.ts';
import { chooseMain, drainPurgeQueue } from './publish.ts';
import { syncCredits } from './credit.ts';
import { RETRY_AFTER, allowed, clientIp, type RateEnv } from './ratelimit.ts';
import { filterStations, findEvse, getStation, listMainPhotos, listStations, nearStations, recentPhotoStations, searchStations, type Env } from './data.ts';
import { deletePhoto, exportPhotos, getPhoto, optionalCaller } from './photoapi.ts';
import { openApiSpec } from './openapi.ts';
import { noPhotoData, noPhotoPage } from './nophoto.ts';
import { ranking } from './points.ts';
import {
  PICTURES, SITE, evseChoicePage, homePage, messages, notFoundPage, rankingPage, rankingPath, searchPage, socketAnchor, stationPage, stationPath, type Lang,
} from './pages.ts';
import { privacyPage } from './privacy.ts';
import { termsPage } from './terms.ts';
import { groupPage } from './grupo.ts';
import { evseBody, mainPhotoBody, searchBody, stationBody } from './bodies.ts';
import { creditPage, getCredit } from './photopage.ts';
import { PROMOTE_ACTION, lostHtml, promoteMain } from './mains.ts';
import { currentUser } from './auth.ts';
import { canModerate } from './moderation.ts';
import { STATION_ADMIN_ACTION, STATION_ADMIN_ROUTE, stationAdminAction, stationAdminHtml } from './stationadmin.ts';
import { TAKEDOWN_DECIDE, decideTakedown, reconcile, submitTakedown, takedownHtml, takedownsHtml, type TakedownEnv } from './takedown.ts';
import { sitemapXml } from './sitemap.ts';
import { isMcpPath } from './mcp.ts';
import type { OAuthEnv } from './oauth.ts';

// The MCP server and its OAuth provider load only when used: the provider
// imports cloudflare:workers, which the tests (under Node) cannot load.
const oauth = () => import('./oauth.ts');
const agentGrants = async (env: OAuthEnv) => (env.OAUTH_KV ? (await oauth()).agentGrants(env) : undefined);
import {
  API_MAX_RESULTS, compactCode, ftsQuery, hasFilters, MAX_QUERY, NEAR_MAX_M, parseFilters, parseNear, STATION_ID,
} from './types.ts';

// The API is for apps and agents, not for search results.
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'x-robots-tag': 'noindex',
};

// The pages load nothing from third parties: fonts, CSS and script are ours,
// and images can only come from the static photo links.
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; " +
    "img-src 'self' https://pictures.ocarroeletrico.com; manifest-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
  // For agents: what the site, the API and the MCP server offer.
  link: '</llms.txt>; rel="describedby"; type="text/markdown"',
};

// The upload page also asks our API for stations (connect-src; also the
// HEIC decoder and face model files, fetched from /vendor/ and /models/),
// shows the prepared photo from a blob: URL, loads Turnstile (its script and
// its iframe), compiles WebAssembly (libheif for HEIC, MediaPipe for faces:
// 'wasm-unsafe-eval' allows compiling wasm, not eval of JavaScript) and,
// only when the person opens the map, shows OpenStreetMap tiles. Only that
// page gets these.
const UPLOAD_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("img-src 'self'", "img-src 'self' blob: https://tile.openstreetmap.org")
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self'; frame-src https://challenges.cloudflare.com;")
    .replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com"),
};

// The removal form loads Turnstile, like the upload page, and nothing else.
const TURNSTILE_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self'; frame-src https://challenges.cloudflare.com;")
    .replace("script-src 'self'", "script-src 'self' https://challenges.cloudflare.com"),
};

// The credit page may show a published photo that is not the main one, which
// only Panoramax serves (the sizes in pictures.* are the main photos').
const PANORAMAX_IMAGES = 'https://panoramax.ocarroeletrico.com';
const CREDIT_HEADERS = {
  ...HTML_HEADERS,
  'content-security-policy': HTML_HEADERS['content-security-policy']
    .replace("img-src 'self'", `img-src 'self' ${PANORAMAX_IMAGES}`),
};

// The station page shows thumbnails of external photos, which the NAP
// dashboard publishes on its own domain (same owner). Only a page that has
// some gets the host.
const EXTERNAL_THUMBS = 'https://nap.ocarroeletrico.com';

// 429 from the request limits (src/ratelimit.ts): JSON for the API, a short
// bilingual line for pages (the page may be the OSM callback, with no language).
function tooMany(pathname: string): Response {
  const headers = { 'cache-control': 'no-store', 'retry-after': RETRY_AFTER };
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response('Demasiados pedidos: tenta outra vez daqui a um minuto.\nToo many requests: try again in a minute.\n', {
    status: 429, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
  });
}

function json(body: unknown, status = 200, cache = 'public, max-age=300'): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': cache } });
}

function html(lang: Lang, body: string, status = 200, cache = 'public, max-age=300'): Response {
  return new Response(body, {
    status,
    headers: { ...HTML_HEADERS, 'content-language': lang === 'pt' ? 'pt-PT' : 'en', 'cache-control': cache },
  });
}

const pageNotFound = (lang: Lang, what: string) => html(lang, notFoundPage(lang, what), 404, 'public, max-age=60');
const notFound = () => json({ error: 'not_found' }, 404, 'public, max-age=60');

function param(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

async function stationJson(env: Env, id: string): Promise<Response> {
  const alias = await getStationAlias(env, id);
  if (alias) return new Response(null, { status: 301, headers: { location: `/api/v1/stations/${encodeURIComponent(alias)}`, 'cache-control': 'no-store' } });
  const found = await getStation(env, id);
  return found ? json(stationBody(found)) : notFound();
}


// GET /api/v1/photos/{id}. A published photo is public; its author and the
// moderators also read the others, so nothing cached for them is shared.
async function photoJson(request: Request, env: Env, id: string): Promise<Response> {
  const user = request.headers.has('authorization') || request.headers.has('cookie') ? await optionalCaller(request, env) : null;
  const r = await getPhoto(env, id, user);
  if ('notFound' in r) return notFound();
  return json(r.photo, 200, r.private ? 'private, no-store' : 'public, max-age=300');
}

// DELETE /api/v1/photos/{id}: the author, or a moderator (src/photoapi.ts).
async function deletePhotoJson(request: Request, env: Env & TakedownEnv, id: string): Promise<Response> {
  const caller = await apiCaller(request, env, 'photos:write');
  if ('error' in caller) return json({ error: caller.error }, caller.status, 'no-store');
  let body: { reason?: unknown; note?: unknown } = {};
  const text = await request.text().catch(() => '');
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { return json({ error: 'bad_body' }, 400, 'no-store'); }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_body' }, 400, 'no-store');
  }
  const r = await deletePhoto(env, caller.user, id, body);
  return 'ok' in r ? json({ removed: true }, 200, 'no-store') : json({ error: r.error }, r.status, 'no-store');
}

// The whole gallery, once a day: the Cache API holds it, and a removal purges
// it (src/takedown.ts). Like the sitemap, Workers responses are not kept by
// the CDN on their own.
async function photosExportJson(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = new Request(new URL('/api/v1/photos.json', request.url));
  const hit = typeof caches === 'undefined' ? undefined : await caches.default.match(key);
  if (hit) return hit;
  const res = json(await exportPhotos(env), 200, 'public, max-age=86400');
  if (typeof caches !== 'undefined') ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

async function evseJson(env: Env, raw: string): Promise<Response> {
  const results = await findEvse(env, raw);
  if (results.length === 0) return notFound();
  // The NAP does not promise one code per socket. When it repeats, say so and
  // list the candidates instead of picking one at random.
  if (results.length > 1) return json({ error: 'ambiguous', candidates: results.map(evseBody) }, 300);
  return json(evseBody(results[0]));
}

// Every published main photo, for sites that copy the thumbnails with their
// credit (the NAP dashboard reads this once a day). A few hundred rows at most
// for a long while; the five minutes of browser cache match the other JSON.
async function mainPhotosJson(env: Env): Promise<Response> {
  const rows = await listMainPhotos(env);
  return json({
    license: 'CC-BY-SA-4.0',
    photos: rows.map(mainPhotoBody),
  });
}

async function homeHtml(lang: Lang, env: Env): Promise<Response> {
  const recent = await recentPhotoStations(env);
  const res = html(lang, homePage(lang, recent));
  // The Panoramax host only when there are thumbnails to show.
  if (recent.length) res.headers.set('content-security-policy', CREDIT_HEADERS['content-security-policy']);
  return res;
}

function stationHtml(lang: Lang) {
  return async (env: Env, id: string): Promise<Response> => {
    const alias = await getStationAlias(env, id);
    if (alias) return new Response(null, { status: 301, headers: { location: stationPath(lang, alias), 'cache-control': 'no-store' } });
    const found = await getStation(env, id);
    if (!found) return pageNotFound(lang, messages(lang).noStation(id));
    // Each image host only on a page that shows it: the external thumbnails,
    // and Panoramax for the gallery of a station under construction.
    const hosts = [found.externals.length ? EXTERNAL_THUMBS : '', found.own.length ? PANORAMAX_IMAGES : ''].filter(Boolean);
    // connect-src 'self': site.js asks /api/v1/me whether to show «Moderar fotos».
    const csp = HTML_HEADERS['content-security-policy'].replace("default-src 'none';", "default-src 'none'; connect-src 'self';");
    const headers = {
      ...HTML_HEADERS,
      'content-security-policy': hosts.length ? csp.replace("img-src 'self'", `img-src 'self' ${hosts.join(' ')}`) : csp,
    };
    return new Response(stationPage(lang, found.station, found.points, found.mains, found.externals, found.own), {
      status: 200,
      headers: {
        ...headers,
        'content-language': lang === 'pt' ? 'pt-PT' : 'en',
        'cache-control': 'public, max-age=300',
      },
    });
  };
}

function creditHtml(lang: Lang) {
  return async (env: Env, id: string): Promise<Response> => {
    const row = await getCredit(env, id);
    if (!row) return pageNotFound(lang, messages(lang).noPublishedPhoto(id));
    return new Response(creditPage(lang, row), {
      status: 200,
      headers: { ...CREDIT_HEADERS, 'content-language': lang === 'pt' ? 'pt-PT' : 'en', 'cache-control': 'public, max-age=300' },
    });
  };
}

function evseHtml(lang: Lang) {
  return async (env: Env, raw: string): Promise<Response> => {
    const results = await findEvse(env, raw);
    if (results.length === 0) return pageNotFound(lang, messages(lang).noSocket(raw));
    if (results.length > 1) return html(lang, evseChoicePage(lang, compactCode(raw) ?? raw, results), 300);
    const m = results[0];
    // 302, not 301: a code can move to another station in a later import.
    return new Response(null, {
      status: 302,
      headers: {
        location: stationPath(lang, m.station_id) + socketAnchor(m.evse_compact),
        'cache-control': 'public, max-age=300',
      },
    });
  };
}

async function rankingJson(env: Env, url: URL): Promise<Response> {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'month';
  const now = new Date();
  const rows = await ranking(env.DB, period, now);
  return json({
    period,
    month: period === 'month' ? now.toISOString().slice(0, 7) : undefined,
    contributors: rows.map((r, i) => ({ rank: i + 1, name: r.name, points: r.points, photos: r.photos, medal: r.medal })),
  });
}

// About 9k stations, read once a day per data centre: Workers responses are
// not kept by the CDN on their own, so the Cache API holds this one.
async function sitemap(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = new Request(new URL('/sitemap.xml', request.url));
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const res = new Response(sitemapXml(await listStations(env)), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

const PAGE_RESULTS = 20;
const queryOf = (url: URL) => (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY);


function limitOf(url: URL): number {
  const asked = Number(url.searchParams.get('limit') ?? PAGE_RESULTS);
  return Number.isInteger(asked) ? Math.min(Math.max(asked, 1), API_MAX_RESULTS) : PAGE_RESULTS;
}

// Three ways in: words (?q=), a place (?lat=&lon=&radius=), or the filters
// alone (?has_photo=false&opc=…). Words and place never combine; the filters
// narrow any of them.
async function searchJson(env: Env, url: URL): Promise<Response> {
  const filters = parseFilters(url.searchParams);
  if (filters === 'bad') {
    return json({
      error: 'bad_filter',
      detail: 'opc is an operator id, municipality a name, has_photo true or false',
    }, 400, 'no-store');
  }
  const near = parseNear(url.searchParams);
  if (near !== null) {
    if (url.searchParams.has('q')) {
      return json({ error: 'q_or_coordinates', detail: 'use either q or lat/lon, not both' }, 400, 'no-store');
    }
    if (near === 'bad') {
      return json({
        error: 'bad_coordinates',
        detail: `lat and lon in decimal degrees; radius in whole metres, 1 to ${NEAR_MAX_M}`,
      }, 400, 'no-store');
    }
    const results = await nearStations(env, near, limitOf(url), filters);
    return json({ ...near, results: results.map((r) => ({ ...searchBody(r), distance_m: r.distance_m })) });
  }
  const q = queryOf(url);
  if (!ftsQuery(q)) {
    if (!q && hasFilters(filters)) {
      const page = await filterStations(env, filters, limitOf(url), (url.searchParams.get('after') ?? '').slice(0, 64));
      return json({ results: page.rows.map(searchBody), next: page.next });
    }
    return json({
      error: 'q_required',
      detail: 'q needs a word of at least two letters or digits, or search by place with lat and lon, or give opc, municipality or has_photo',
    }, 400, 'no-store');
  }
  return json({ q, results: (await searchStations(env, q, limitOf(url), filters)).map(searchBody) });
}

// A typed station or socket code goes straight to its page; anything else is
// a word search. Both lookups are on primary keys or indexes.
async function searchHtml(lang: Lang, env: Env, url: URL): Promise<Response> {
  const q = queryOf(url);
  // Most codes are upper case (EZC-AMD-00051), Tesla's are lower case hex: try both.
  for (const id of new Set([q, q.toUpperCase()])) {
    if (STATION_ID.test(id) && (await getStation(env, id))) {
      return new Response(null, { status: 302, headers: { location: stationPath(lang, id), 'cache-control': 'no-store' } });
    }
  }
  if (compactCode(q)) {
    const evses = await findEvse(env, q);
    if (evses.length === 1) {
      const m = evses[0];
      return new Response(null, {
        status: 302,
        headers: { location: stationPath(lang, m.station_id) + socketAnchor(m.evse_compact), 'cache-control': 'no-store' },
      });
    }
  }
  const results = ftsQuery(q) ? await searchStations(env, q, PAGE_RESULTS) : null;
  return html(lang, searchPage(lang, q, results, PAGE_RESULTS), 200, 'no-store');
}

type Handler = (env: Env, value: string) => Promise<Response>;
const ROUTES: [RegExp, Handler, () => Response][] = [
  [/^\/api\/v1\/stations\/([^/]+)$/, stationJson, notFound],
  [/^\/api\/v1\/evses\/([^/]+)$/, evseJson, notFound],
  [/^\/postos\/([^/]+)$/, stationHtml('pt'), () => pageNotFound('pt', messages('pt').badStation)],
  [/^\/tomadas\/([^/]+)$/, evseHtml('pt'), () => pageNotFound('pt', messages('pt').badSocket)],
  [/^\/p\/([^/]+)$/, creditHtml('pt'), () => pageNotFound('pt', messages('pt').noPublishedPhoto('?'))],
  [/^\/en\/p\/([^/]+)$/, creditHtml('en'), () => pageNotFound('en', messages('en').noPublishedPhoto('?'))],
  [/^\/en\/stations\/([^/]+)$/, stationHtml('en'), () => pageNotFound('en', messages('en').badStation)],
  [/^\/en\/sockets\/([^/]+)$/, evseHtml('en'), () => pageNotFound('en', messages('en').badSocket)],
];

async function setSelection(request: Request, env: Env & PhotoEnv, ctx: ExecutionContext, target: string): Promise<Response> {
  const caller = await apiCaller(request, env, 'selections:write');
  if ('error' in caller) return json({ error: caller.error }, caller.status, 'no-store');
  const { user } = caller;
  if (!canChooseMain(user.role)) return json({ error: 'forbidden' }, 403, 'no-store');
  let body: { photo?: string } = {};
  try { body = await request.json(); } catch { return json({ error: 'bad_body' }, 400, 'no-store'); }
  if (!body.photo) return json({ error: 'bad_photo' }, 400, 'no-store');
  try {
    const { targets, cachePending } = await chooseMain(env, target, body.photo, user.id, fetch, new Date());
    return json({ targets, cachePending }, 200, 'no-store');
  } catch {
    return json({ error: 'publish_failed' }, 502, 'no-store');
  }
}

export default {
  async fetch(request: Request, env: Env & TakedownEnv & RateEnv & OAuthEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    // The MCP server and its OAuth (src/oauth.ts), with the request limits of
    // the search (/mcp) and of the sign-in (the OAuth endpoints).
    if (isMcpPath(pathname)) {
      if (request.method !== 'OPTIONS') {
        const limit = pathname === '/mcp' ? env.SEARCH_LIMIT : pathname.startsWith('/oauth/') ? env.LOGIN_LIMIT : undefined;
        if (limit && !(await allowed(limit, clientIp(request)))) return tooMany('/api/');
      }
      return (await oauth()).mcpFetch(request, env, ctx);
    }
    // The POSTs: everything else on this site only reads.
    if (request.method === 'POST' && pathname === '/auth/logout') return logout(request, env);
    if (request.method === 'POST' && pathname === ACCOUNT_ACTION) return accountAction(request, env, HTML_HEADERS, ctx, undefined, undefined, await agentGrants(env));
    if (request.method === 'POST' && pathname === ROLE_ACTION) return setRole(request, env);
    if (request.method === 'POST' && pathname === DECIDE_ACTION) return decide(request, env);
    if (request.method === 'POST' && (pathname === ALIAS_ACTION || pathname === '/admin/alias' || pathname === '/admin/rekeys' || pathname === '/admin/aliases')) return rekey(request, env);
    if (request.method === 'POST' && pathname === '/api/v1/photos') return submitPhoto(request, env, ctx);
    if (request.method === 'POST' && pathname === '/report') return submitTakedown(request, env);
    if (request.method === 'POST' && pathname === TAKEDOWN_DECIDE) return decideTakedown(request, env);
    if (request.method === 'POST' && pathname === PROMOTE_ACTION) return promoteMain(request, env);
    if (request.method === 'POST' && pathname === STATION_ADMIN_ACTION) return stationAdminAction(request, env);
    if (request.method === 'PUT') {
      const m = pathname.match(/^\/api\/v1\/selections\/([^/]+)$/);
      if (m) {
        const value = param(m[1]);
        if (value === null) return notFound();
        return setSelection(request, env, ctx, value);
      }
    }
    if (request.method === 'DELETE') {
      const m = pathname.match(/^\/api\/v1\/photos\/([^/]+)$/);
      if (m) {
        const value = param(m[1]);
        if (value === null) return notFound();
        return deletePhotoJson(request, env, value);
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405, 'no-store');
    }
    // Before ROUTES: "sem-foto" would read as a station id.
    if (pathname === '/postos/sem-foto' || pathname === '/en/stations/without-photo') {
      if (!(await allowed(env.SEARCH_LIMIT, clientIp(request)))) return tooMany(pathname);
      const lang: Lang = pathname === '/postos/sem-foto' ? 'pt' : 'en';
      return html(lang, noPhotoPage(lang, await noPhotoData(env, lang, url)));
    }
    const photoRoute = pathname.match(/^\/api\/v1\/photos\/([^/]+)$/);
    if (photoRoute) {
      const value = param(photoRoute[1]);
      return value === null ? notFound() : photoJson(request, env, value);
    }
    for (const [re, handler, bad] of ROUTES) {
      const m = pathname.match(re);
      if (!m) continue;
      const value = param(m[1]);
      return value === null ? bad() : handler(env, value);
    }
    if (pathname === '/api/v1/main-photos') return mainPhotosJson(env);
    // Who is signed in here, for a cached page that shows moderators more
    // (the station page's «Moderar fotos»). Session cookie only, never cached.
    if (pathname === '/api/v1/me') {
      const user = await currentUser(request, env).catch(() => null);
      return json({ role: user?.role ?? null, moderator: user ? canModerate(user.role) : false }, 200, 'private, no-store');
    }
    if (pathname === '/api/v1/photos.json') return photosExportJson(request, env, ctx);
    if (pathname === '/api/v1/openapi.json') return json(openApiSpec(), 200, 'public, max-age=3600');
    if (pathname === '/api/v1/ranking') return rankingJson(env, url);
    if (pathname === '/api/v1/stations' || pathname === '/pesquisa' || pathname === '/en/search') {
      if (!(await allowed(env.SEARCH_LIMIT, clientIp(request)))) return tooMany(pathname);
      if (pathname === '/api/v1/stations') return searchJson(env, url);
      return searchHtml(pathname === '/pesquisa' ? 'pt' : 'en', env, url);
    }
    if (pathname === '/') return homeHtml('pt', env);
    if (pathname === '/en/') return homeHtml('en', env);
    if (pathname === '/en') return new Response(null, { status: 301, headers: { location: '/en/' } });
    if (pathname === '/privacidade') return html('pt', privacyPage('pt'));
    if (pathname === '/en/privacy') return html('en', privacyPage('en'));
    if (pathname === '/condicoes') return html('pt', termsPage('pt'));
    if (pathname === '/en/terms') return html('en', termsPage('en'));
    if (pathname === '/grupo') return html('pt', groupPage('pt'));
    if (pathname === '/en/group') return html('en', groupPage('en'));
    if (pathname === '/conta') return accountHtml('pt', request, env, HTML_HEADERS, undefined, await agentGrants(env));
    if (pathname === '/en/account') return accountHtml('en', request, env, HTML_HEADERS, undefined, await agentGrants(env));
    if (pathname === '/conta/envios') return uploadsHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/account/uploads') return uploadsHtml('en', request, env, HTML_HEADERS);
    if (pathname.startsWith(OWN_THUMB_PREFIX)) return ownThumbnail(request, env, pathname.slice(OWN_THUMB_PREFIX.length));
    if (pathname === '/admin/decisoes') return decisionsHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/decisions') return decisionsHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/admin/fila') return queueHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/queue') return queueHtml('en', request, env, HTML_HEADERS);
    if (pathname.startsWith(STAGING_PREFIX)) return stagingImage(request, env, pathname.slice(STAGING_PREFIX.length));
    if (pathname === '/admin/utilizadores') return usersHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/users') return usersHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/admin/postos-fora-do-nap' || pathname === '/admin/aliases' || pathname === '/admin/rekeys' || pathname === '/admin/rekey') return aliasesHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/stations-missing' || pathname === '/en/admin/aliases' || pathname === '/en/admin/rekeys' || pathname === '/en/admin/rekey') return aliasesHtml('en', request, env, HTML_HEADERS);
    // The removal form loads Turnstile, like the upload page.
    if (pathname === '/report') return takedownHtml('pt', request, env, TURNSTILE_HEADERS);
    if (pathname === '/en/report') return takedownHtml('en', request, env, TURNSTILE_HEADERS);
    if (pathname === '/admin/remocoes') return takedownsHtml('pt', request, env, HTML_HEADERS);
    if (pathname === '/en/admin/takedowns') return takedownsHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/admin/sem-principal') return lostHtml('pt', request, env, HTML_HEADERS);
    for (const lang of ['pt', 'en'] as const) {
      const m = pathname.match(STATION_ADMIN_ROUTE[lang]);
      if (m) return stationAdminHtml(lang, request, env, HTML_HEADERS, m[1]);
    }
    if (pathname === '/en/admin/no-main') return lostHtml('en', request, env, HTML_HEADERS);
    if (pathname === '/enviar') return uploadHtml('pt', request, env, UPLOAD_HEADERS);
    if (pathname === '/en/upload') return uploadHtml('en', request, env, UPLOAD_HEADERS);
    if (pathname === '/auth/osm/login' || pathname === '/auth/osm/callback') {
      if (!(await allowed(env.LOGIN_LIMIT, clientIp(request)))) return tooMany(pathname);
      if (pathname === '/auth/osm/login') return login(request, env, HTML_HEADERS);
      return callback(request, env, ctx, HTML_HEADERS);
    }
    if (pathname === '/ranking' || pathname === '/en/ranking') {
      const lang = pathname.startsWith('/en/') ? 'en' : 'pt';
      const periodRaw = url.searchParams.get('period') ?? 'all';
      const period = periodRaw === 'month' ? 'month' : 'all';
      const rows = await ranking(env.DB, period);
      return html(lang, rankingPage(lang, period, rows));
    }
    if (pathname === '/sitemap.xml') return sitemap(request, env, ctx);
    if (pathname.startsWith('/api/')) return notFound();
    const lang: Lang = pathname.startsWith('/en/') ? 'en' : 'pt';
    return pageNotFound(lang, messages(lang).noPage);
  },
  // Every 6 hours (wrangler.json): retries the hides that half-failed, and
  // follows any auto-hide report that did not come from our form
  // (src/takedown.ts); then a batch of what is left of credit changes
  // (src/credit.ts); then what merges of stations under construction left
  // (src/construction.ts); last, expired OAuth grants out of KV (src/oauth.ts).
  // One after the other: they share the subrequest limit.
  async scheduled(_event: ScheduledController, env: Env & TakedownEnv & OAuthEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env, fetch).catch(() => {}).then(() => syncCredits(env, fetch)).catch(() => {})
      .then(() => afterMerges(env, fetch)).catch(() => {})
      .then(() => drainPurgeQueue(env, fetch)).catch(() => {})
      .then(async () => { if (env.OAUTH_KV) await (await oauth()).purgeOAuth(env); }).catch(() => {}));
  },
} satisfies ExportedHandler<Env & TakedownEnv & OAuthEnv>;
