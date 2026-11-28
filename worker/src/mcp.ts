// The MCP server (/mcp, Docs/arquitetura.md, *Servidor MCP*): the same data
// and the same rules as the REST API, as tools for AI assistants.
//
// Every tool calls the functions the REST routes call (src/data.ts,
// src/bodies.ts, src/photos.ts, src/publish.ts), so the
// checks, the licence, the moderation and the limits are the same for people,
// scripts and agents. Reading needs no sign-in. Writing needs an account:
// an OAuth grant made on the consent page (src/oauth.ts) or an `oop_` token,
// with the scope of the matching REST route, and always the account's
// current role.
//
// No Workers-only imports here, so the tests run the tools under Node
// (test/mcp.test.ts); src/oauth.ts puts them behind the Streamable HTTP
// transport and the OAuth provider.
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { SessionUser, Waiter } from './auth.ts';
import { evseBody, mainPhotoBody, searchBody, stationBody } from './bodies.ts';
import {
  filterStations, findEvse, getStation, listMainPhotos, nearStations, searchStations, socketsWithoutPhoto, type Env,
} from './data.ts';
import { SITE, stationPath, uploadPath } from './pages.ts';
import { LICENSE, LICENSE_URL, SIZE_PX } from './photolinks.ts';
import { MAX_BODY, submitPhoto } from './photos.ts';
import { PHOTO_ID, deletePhoto, getPhoto } from './photoapi.ts';
import type { TakedownEnv } from './takedown.ts';
import { REASONS } from './reasons.ts';
import { ranking, type PointsDb } from './points.ts';
import { chooseMain, type PublishEnv } from './publish.ts';
import { canChooseMain, type Scope } from './tokens.ts';
import { type StationFilters, compactCode, ftsQuery, MAX_QUERY, NEAR_MAX_M, STATION_ID } from './types.ts';

export const MCP_NAME = 'OlhaOPosto';
export const MCP_VERSION = '1.0.0';

// Who we are, with the mascot: without icons, clients guess from the domain
// and show the apex's (ocarroeletrico.com) icon.
export const SERVER_INFO = {
  name: MCP_NAME,
  title: "olh'o'posto",
  version: MCP_VERSION,
  description: 'Community photos of EV charging stations and sockets in Portugal.',
  websiteUrl: SITE,
  icons: [
    { src: `${SITE}/favicon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
    { src: `${SITE}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
    { src: `${SITE}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
  ],
};
export const MCP_PATH = '/mcp';
// What src/oauth.ts answers: the endpoint, the OAuth endpoints and their metadata.
export const isMcpPath = (p: string) =>
  p === MCP_PATH || p.startsWith('/oauth/') || p.startsWith('/.well-known/oauth-');

// The tools that change something. An anonymous call to one of these gets
// the OAuth challenge (HTTP 401) instead of a tool error, so the client
// signs in and repeats it (src/oauth.ts).
export const WRITE_TOOLS: Record<string, Scope> = {
  submit_photo: 'photos:write',
  set_primary_photo: 'selections:write',
  delete_photo: 'photos:write',
};

// Who is calling: null when nobody signed in.
export interface McpCaller {
  user: SessionUser;
  scopes: Scope[];
}

export type McpEnv = Env & PublishEnv & TakedownEnv;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface McpDeps {
  fetcher?: Fetch;
  now?: () => Date;
  ctx?: Waiter;
}

const INSTRUCTIONS = `olh'o'posto is a community photo service for EV charging stations and sockets in Portugal.
Stations are identified by their official NAP id (e.g. EZC-AMD-00051) and sockets by their EVSE code (e.g. PT*EZC*E*AMD*00051*1 or PTEZCEAMD000511).
Every photo is CC BY-SA 4.0: whenever you show or link one, show its "attribution" text next to it.
Static photo links (pictures.ocarroeletrico.com/<id>.jpg) never change; the photo behind them may.
Stations with lifecycle "construction" (ids like OSM-w123) are being built according to OpenStreetMap and are not in the NAP yet: never present them as places to charge. They take photos, but have no sockets and no static links until they merge into their NAP station (the old id then redirects).
Reading needs no sign-in. Sending photos and choosing main photos need an account (OpenStreetMap sign-in), and follow the terms at ${SITE}/condicoes.`;

const LICENCE = { license: LICENSE, licenseUrl: LICENSE_URL };
const MAX_RESULTS = 50;

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const ok = (data: Record<string, unknown>): Result => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});
const fail = (error: string, detail?: string, extra: Record<string, unknown> = {}): Result => {
  const data = { error, ...(detail ? { detail } : {}), ...extra };
  return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: true };
};

// A REST handler's JSON answer as a tool result: the same codes as the API.
async function fromResponse(res: Response): Promise<Result> {
  let body: Record<string, unknown> = {};
  try { body = await res.json() as Record<string, unknown>; } catch { /* empty */ }
  if (res.ok) return ok({ ...body, status_code: res.status });
  const error = typeof body.error === 'string' ? body.error : `http_${res.status}`;
  const { error: _drop, ...rest } = body;
  return fail(error, ERROR_DETAIL[error], rest);
}

// What the REST error codes mean, for an assistant that has not read Docs/api.md.
const ERROR_DETAIL: Record<string, string> = {
  uploads_closed: 'Uploads are not open yet.',
  too_fast: 'Too many uploads in the last minute; wait a minute.',
  daily_limit: 'The daily limit for this account is reached; try again tomorrow (UTC).',
  bad_photo: 'Each size must be a JPEG with no metadata at all (no EXIF, XMP or ICC), longest side within its limit (2048, 1024, 400 px), the same picture in all three.',
  bad_target: 'Unknown station or socket, or the socket is not of that station.',
  consent_required: 'Both license and no_people must be true.',
  duplicate: 'This photo was already sent.',
  upload_failed: 'The upload failed on our side; try again later.',
  unavailable: 'The database cannot store photos right now (nothing was sent); try again later, at the latest after 00:00 UTC.',
  station_nearby: 'There is already a station less than 60 m away: check the list; if yours is another one, repeat with force: true.',
  name_and_operator: 'name and operator need at least two characters each.',
  bad_position: 'The position must be in Portugal (mainland, Madeira or the Azores).',
  bad_code: 'code: letters, digits and * _ . - only.',
};

function signedIn(caller: McpCaller | null, scope: Scope): Result | McpCaller {
  if (!caller) return fail('sign_in_required', `Connect to ${SITE}${MCP_PATH} with OAuth (OpenStreetMap sign-in) or send Authorization: Bearer oop_… (a token made on the account page).`);
  if (!caller.scopes.includes(scope)) return fail('missing_scope', `This needs the ${scope} scope; authorise the agent again or use a token with it.`);
  return caller;
}

const operatorArg = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional()
  .describe('NAP operator id (opc), e.g. EZC3; get_station and search results show it as operator.id.');
const municipalityArg = z.string().max(80).optional().describe('Municipality (concelho), e.g. "Sintra".');
const limitArg = z.number().int().min(1).max(MAX_RESULTS).optional().describe(`At most this many results (default 20, max ${MAX_RESULTS}).`);
const offsetArg = z.number().int().min(0).max(10_000).optional().describe('Skip this many results, to page through.');
const afterArg = z.string().max(160).optional().describe('The "next" value of the previous page, to get the following one.');
const photoInput = (px: number, bytes: string) => z.string().min(8)
  .describe(`The ${px} px version (longest side at most ${px}, at most ${bytes}): base64 JPEG (a data: URL works too), or an https URL to fetch it from. Faces and number plates already blurred, no metadata.`);

const toFilter = (a: { operator?: string; municipality?: string; has_photo?: boolean }): StationFilters =>
  ({ opc: a.operator, municipality: a.municipality?.trim() || undefined, hasPhoto: a.has_photo });

// Image bytes from base64 or an https URL, capped before they are all read.
export async function imageBytes(input: string, fetcher: Fetch, max: number): Promise<Uint8Array | string> {
  const s = input.trim();
  if (/^https:\/\//i.test(s)) {
    let url: URL;
    try { url = new URL(s); } catch { return 'bad_url'; }
    let res: Response;
    try {
      res = await fetcher(url.href, { headers: { 'user-agent': 'OlhaOPosto', accept: 'image/jpeg' }, redirect: 'follow' });
    } catch {
      return 'fetch_failed';
    }
    if (!res.ok || !res.body) return 'fetch_failed';
    if (Number(res.headers.get('content-length') ?? 0) > max) return 'too_large';
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return 'too_large';
      }
      parts.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
  if (/^[a-z]+:/i.test(s) && !/^data:image\/jpeg;base64,/i.test(s)) return 'bad_url';
  const b64 = s.replace(/^data:image\/jpeg;base64,/i, '').replace(/\s+/g, '');
  if (b64.length > Math.ceil(max / 3) * 4) return 'too_large';
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) return 'bad_base64';
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return 'bad_base64';
  }
}

// The largest file the upload takes for each size (src/photos.ts checks again).
const SIZE_BYTES = { full: 6_000_000, main: 2_000_000, thumb: 500_000 } as const;

// A fresh server for each request: the handler is stateless (src/oauth.ts).
export function mcpServer(env: McpEnv, caller: McpCaller | null, deps: McpDeps = {}): McpServer {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? (() => new Date());
  const ctx: Waiter = deps.ctx ?? { waitUntil: () => {} };
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool('search_stations', {
    title: 'Search charging stations',
    description: 'Find public EV charging stations in Portugal: by words (name, address, town, operator, station id), '
      + `or around a point (lat, lon and a radius up to ${NEAR_MAX_M} m), or only by filters (operator, municipality, has_photo). `
      + 'Use has_photo: false to find stations that still need a photo. Returns ids to use with get_station.',
    inputSchema: z.object({
      q: z.string().max(MAX_QUERY).optional().describe('Words to search for (each at least two letters or digits).'),
      lat: z.number().min(-90).max(90).optional().describe('Latitude in decimal degrees (with lon).'),
      lon: z.number().min(-180).max(180).optional().describe('Longitude in decimal degrees (with lat).'),
      radius_m: z.number().int().min(1).max(NEAR_MAX_M).optional().describe('Radius in metres around lat/lon (default 500).'),
      operator: operatorArg,
      municipality: municipalityArg,
      has_photo: z.boolean().optional().describe('true: only stations with a main photo; false: only stations without one.'),
      limit: limitArg,
      after: afterArg.describe('Only when searching by filters alone: the "next" value of the previous page.'),
    }),
    annotations: read,
  }, async (a) => {
    const limit = a.limit ?? 20;
    const filter = toFilter(a);
    const hasPlace = a.lat !== undefined || a.lon !== undefined;
    if (hasPlace && a.q) return fail('q_or_coordinates', 'Use either q or lat/lon, not both.');
    if (hasPlace) {
      if (a.lat === undefined || a.lon === undefined) return fail('bad_coordinates', 'Give both lat and lon.');
      const near = { lat: a.lat, lon: a.lon, radius: a.radius_m ?? 500 };
      const rows = await nearStations(env, near, limit, filter);
      return ok({ ...near, results: rows.map((r) => ({ ...searchBody(r), distance_m: r.distance_m })) });
    }
    if (a.q) {
      if (!ftsQuery(a.q)) return fail('q_required', 'q needs a word of at least two letters or digits.');
      // A station id or socket code goes straight to its station, as on the site.
      const direct = await directHit(env, a.q.trim());
      if (direct) return ok({ q: a.q, results: [direct] });
      const rows = await searchStations(env, a.q, limit, filter);
      return ok({ q: a.q, results: rows.map(searchBody) });
    }
    if (!filter.opc && !filter.municipality && filter.hasPhoto === undefined) {
      return fail('filter_required', 'Give q, or lat and lon, or at least one of operator, municipality, has_photo.');
    }
    const page = await filterStations(env, filter, limit, a.after ?? '');
    return ok({ results: page.rows.map(searchBody), next: page.next });
  });

  server.registerTool('get_station', {
    title: 'Station details',
    description: 'One station with its sockets and the main photo of each (static links in three sizes, credit, '
      + 'licence and the attribution to show with it), plus its other published photos in photos (thumbnail and '
      + 'credit page, no static link). Takes a station id (EZC-AMD-00051) or a socket EVSE code '
      + '(PT*EZC*E*AMD*00051*1). A photo is null when there is none yet: the result then has upload_page.',
    inputSchema: z.object({ id: z.string().min(1).max(80).describe('Station id or socket EVSE code.') }),
    annotations: read,
  }, async ({ id }) => {
    const found = await stationOrSocket(env, id.trim());
    if ('error' in found) return fail(found.error, found.detail, found.extra);
    const body = stationBody(found.station);
    return ok({
      ...body,
      ...(found.socket ? { socket: found.socket } : {}),
      ...LICENCE,
      page: SITE + stationPath('pt', body.id),
      upload_page: `${SITE}${uploadPath('pt')}?posto=${encodeURIComponent(body.id)}`,
    });
  });

  server.registerTool('get_photo_link', {
    title: 'Static photo link',
    description: 'The static link of the main photo of a station or socket, in one size, with the attribution text '
      + 'ready to paste next to it (CC BY-SA 4.0 requires it). The link never changes when the photo is replaced, '
      + 'so it is safe to store. Returns has_photo: false when there is no photo yet.',
    inputSchema: z.object({
      id: z.string().min(1).max(80).describe('Station id or socket EVSE code.'),
      size: z.enum(['thumb', 'main', 'full']).optional()
        .describe(`thumb (${SIZE_PX.thumb} px), main (${SIZE_PX.main} px, default) or full (${SIZE_PX.full} px): the longest side.`),
    }),
    annotations: read,
  }, async ({ id, size }) => {
    const found = await stationOrSocket(env, id.trim());
    if ('error' in found) return fail(found.error, found.detail, found.extra);
    const body = stationBody(found.station);
    const target = found.socket ? found.socket.compact : body.id;
    const photo = found.socket
      ? body.points.find((p) => p.compact === found.socket!.compact)?.photo ?? null
      : body.photo;
    if (!photo) {
      return ok({
        target, station: body.id, has_photo: false,
        upload_page: `${SITE}${uploadPath('pt')}?posto=${encodeURIComponent(body.id)}`,
      });
    }
    const s = photo.sizes[size ?? 'main'];
    return ok({
      target, station: body.id, has_photo: true, url: s.url, maxPx: s.maxPx,
      credit: photo.credit, attribution: photo.attribution, ...LICENCE, page: photo.page, report: photo.report,
    });
  });

  server.registerTool('list_missing_photos', {
    title: 'Stations or sockets without a photo',
    description: 'Active stations, or sockets with an EVSE code, that have no photo yet, for photo campaigns. '
      + 'Filter by municipality and/or operator; page with the "next" value.',
    inputSchema: z.object({
      kind: z.enum(['station', 'socket']).optional().describe('station (default) or socket.'),
      municipality: municipalityArg,
      operator: operatorArg,
      limit: limitArg,
      after: afterArg,
    }),
    annotations: read,
  }, async (a) => {
    const filter = toFilter(a);
    const limit = a.limit ?? 20;
    if (a.kind === 'socket') {
      const page = await socketsWithoutPhoto(env, filter, limit, a.after ?? '');
      return ok({
        kind: 'socket',
        next: page.next,
        results: page.rows.map((r) => ({
          station: r.station_id, name: r.name, municipality: r.municipality, operator: r.operator,
          evse: r.evse_id, compact: r.evse_compact, connector: r.connector, kw: r.max_kw,
          upload_page: `${SITE}${uploadPath('pt')}?posto=${encodeURIComponent(r.station_id)}`,
        })),
      });
    }
    const page = await filterStations(env, { ...filter, hasPhoto: false }, limit, a.after ?? '');
    return ok({
      kind: 'station',
      next: page.next,
      results: page.rows.map((r) => ({ ...searchBody(r), upload_page: `${SITE}${uploadPath('pt')}?posto=${encodeURIComponent(r.id)}` })),
    });
  });

  server.registerTool('list_main_photos', {
    title: 'All main photos',
    description: 'Every published main photo (station or socket) with its static links and credit, for sites that '
      + 'copy the thumbnails. All CC BY-SA 4.0: show the credit with each one.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).optional().describe('Default 100, max 500.'), offset: offsetArg }),
    annotations: read,
  }, async ({ limit, offset }) => {
    const rows = await listMainPhotos(env);
    const start = offset ?? 0;
    const page = rows.slice(start, start + (limit ?? 100));
    return ok({ ...LICENCE, total: rows.length, photos: page.map(mainPhotoBody) });
  });

  server.registerTool('get_ranking', {
    title: 'Contributor ranking',
    description: 'Top contributors by points (only published photos count): this month (UTC) or all time.',
    inputSchema: z.object({ period: z.enum(['month', 'all']).optional().describe('month (default) or all.') }),
    annotations: read,
  }, async ({ period }) => {
    const p = period ?? 'month';
    const at = now();
    const rows = await ranking(env.DB as unknown as PointsDb, p, at);
    return ok({
      period: p,
      ...(p === 'month' ? { month: at.toISOString().slice(0, 7) } : {}),
      contributors: rows.map((r, i) => ({ rank: i + 1, name: r.name, points: r.points, photos: r.photos, medal: r.medal })),
    });
  });

  server.registerTool('submit_photo', {
    title: 'Send a photo',
    description: 'Send a photo of a station or one of its sockets, as the signed-in account (needs photos:write). '
      + 'The photo must already be clean: faces and number plates blurred, every metadata block removed (EXIF, XMP, ICC), '
      + 'and given in three sizes of the same picture. It is published under CC BY-SA 4.0 with the account\'s display name '
      + 'as the credit, after moderation (trusted accounts publish directly when taken within 300 m). '
      + 'The GPS position is only for moderation and never published.',
    inputSchema: z.object({
      station: z.string().regex(STATION_ID).describe('Station id (EZC-AMD-00051).'),
      target: z.string().max(80).optional().describe('The socket\'s EVSE code when the photo is of one socket; omit for the station as a whole.'),
      kind: z.enum(['photo', 'plate']).optional().describe('plate: a charger\'s rating plate (model, serial, rated V/A/kW), on the station as a whole (no target). It goes to the station\'s rating plates gallery: never a main photo, no static link. Default photo.'),
      full: photoInput(SIZE_PX.full, '6 MB'),
      main: photoInput(SIZE_PX.main, '2 MB'),
      thumb: photoInput(SIZE_PX.thumb, '500 kB'),
      taken_at: z.string().max(40).optional().describe('When it was taken: YYYY-MM-DDTHH:MM:SS with Z or an offset.'),
      lat: z.number().min(-90).max(90).optional().describe('Where it was taken (from the original EXIF), with lon.'),
      lon: z.number().min(-180).max(180).optional(),
      license: z.literal(true).describe('The account holder agrees to publish it under CC BY-SA 4.0 and took it (or may license it).'),
      no_people: z.literal(true).describe('No identifiable people or readable number plates are left in the picture.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    const who = signedIn(caller, 'photos:write');
    if ('content' in who) return who;
    let target = a.station;
    if (a.target) {
      const code = compactCode(a.target);
      if (!code) return fail('bad_target', ERROR_DETAIL.bad_target);
      target = code;
    }
    const form = new FormData();
    let total = 0;
    for (const size of ['full', 'main', 'thumb'] as const) {
      const bytes = await imageBytes(a[size], fetcher, SIZE_BYTES[size]);
      if (typeof bytes === 'string') return fail(bytes === 'too_large' ? 'too_large' : 'bad_photo', `${size}: ${bytes}`);
      total += bytes.length;
      form.append(size, new Blob([bytes], { type: 'image/jpeg' }), `${size}.jpg`);
    }
    if (total > MAX_BODY) return fail('too_large', 'The three sizes together are too large.');
    form.append('meta', JSON.stringify({
      station: a.station, target, kind: a.kind ?? 'photo', taken_at: a.taken_at ?? null,
      exif_lat: a.lat ?? null, exif_lon: a.lon ?? null, license: a.license, no_people: a.no_people,
    }));
    const req = new Request(`${SITE}/api/v1/photos`, { method: 'POST', body: form });
    return fromResponse(await submitPhoto(req, env, ctx, fetcher, now(), { user: who.user, viaToken: true }));
  });

  server.registerTool('set_primary_photo', {
    title: 'Choose the main photo',
    description: 'Make a published photo the main photo of its station or socket: its static links then serve it '
      + '(needs selections:write, and a moderator or admin account). The photo id is the one in the credit page /p/{id}.',
    inputSchema: z.object({
      target: z.string().min(1).max(80).describe('Station id, or the socket\'s EVSE code.'),
      photo: z.string().min(1).max(64).describe('Id of a published photo of that same station or socket.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ target, photo }) => {
    const who = signedIn(caller, 'selections:write');
    if ('content' in who) return who;
    if (!canChooseMain(who.user.role)) return fail('forbidden', 'Only moderator and admin accounts choose main photos.');
    const t = STATION_ID.test(target) && !target.includes('*') ? target : compactCode(target);
    if (!t) return fail('bad_target', ERROR_DETAIL.bad_target);
    try {
      const { targets, cachePending } = await chooseMain(env, t, photo, who.user.id, fetcher, now());
      if (!targets.length) return fail('bad_photo', 'The photo is not published, or is not of that station or socket.');
      return ok(cachePending
        ? { targets, cachePending, note: 'The cache purge failed: the static links keep serving the old photo until a retry succeeds (every 6 hours).' }
        : { targets, cachePending });
    } catch {
      return fail('publish_failed', 'Copying the photo to the static links failed; try again later.');
    }
  });

  server.registerTool('get_photo', {
    title: 'One photo',
    description: 'A photo by id (from the credit page /p/{id} or a station result): author, licence, date, station or socket, '
      + 'and links. Published photos are public; the author and moderators also see their pending or refused ones.',
    inputSchema: z.object({ id: z.string().regex(PHOTO_ID).describe('Photo id.') }),
    annotations: read,
  }, async ({ id }) => {
    const r = await getPhoto(env, id, caller?.user ?? null);
    if ('notFound' in r) return fail('not_found', 'No photo with this id that you can see.');
    return ok({ ...r.photo });
  });

  server.registerTool('delete_photo', {
    title: 'Remove a photo',
    description: 'Remove a photo, as DELETE /api/v1/photos/{id} (needs photos:write): your own photo, or, for moderators, '
      + `anyone's with a reason (${REASONS.join(', ')}). `
      + 'It leaves the static links and Panoramax. To ask for the removal of someone else\'s photo, use the form at /report.',
    inputSchema: z.object({
      id: z.string().regex(PHOTO_ID).describe('Photo id.'),
      reason: z.enum(REASONS).optional().describe('Moderators only: why it is removed (default other).'),
      note: z.string().max(500).optional().describe('Moderators only: a note the author sees.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id, reason, note }) => {
    const who = signedIn(caller, 'photos:write');
    if ('content' in who) return who;
    const r = await deletePhoto(env, who.user, id, { reason, note }, fetcher, now());
    return 'ok' in r ? ok({ removed: true }) : fail(r.error);
  });

  return server;
}

type Found =
  | { station: NonNullable<Awaited<ReturnType<typeof getStation>>>; socket?: { evse: string; compact: string } }
  | { error: string; detail?: string; extra?: Record<string, unknown> };

// A station id first (most are also valid compact codes), then a socket code.
async function stationOrSocket(env: McpEnv, id: string): Promise<Found> {
  for (const s of new Set([id, id.toUpperCase()])) {
    if (STATION_ID.test(s)) {
      const station = await getStation(env, s);
      if (station) return { station };
    }
  }
  const evses = compactCode(id) ? await findEvse(env, id) : [];
  if (evses.length > 1) {
    return { error: 'ambiguous', detail: 'This socket code is in more than one station; ask with the station id.', extra: { candidates: evses.map(evseBody) } };
  }
  if (evses.length === 1) {
    const station = await getStation(env, evses[0].station_id);
    if (station) return { station, socket: { evse: evses[0].evse_id, compact: evses[0].evse_compact } };
  }
  return { error: 'not_found', detail: 'No public station or socket with this id.' };
}

async function directHit(env: McpEnv, q: string) {
  // Ids and codes have digits and no spaces; plain words skip the lookups.
  if (!/\d/.test(q) || /\s/.test(q)) return null;
  const found = await stationOrSocket(env, q);
  if ('error' in found) return null;
  const s = found.station.station;
  return searchBody({
    id: s.id, name: s.name, opc: s.opc, operator: s.operator, address: s.address,
    municipality: s.municipality, region: s.region, lat: s.lat, lon: s.lon, status: s.status, source: s.source,
  });
}
