// The API described in OpenAPI 3.1, served at /api/v1/openapi.json. The paths
// are relative to the server URL (…/api/v1). test/openapi.test.ts reads
// src/index.ts and fails when a /api/v1 route is missing here, so the two
// cannot drift apart. Docs/api.md is the prose version.
import { LICENSE, LICENSE_URL } from './photolinks.ts';
import { API_MAX_RESULTS } from './types.ts';
import { SITE } from './pages.ts';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: object) => ({ oneOf: [schema, { type: 'null' }] });
const str = { type: 'string' } as const;
const nstr = { type: ['string', 'null'] } as const;
const num = { type: 'number' } as const;

const json = (schema: object, description: string) => ({ description, content: { 'application/json': { schema } } });
const err = (description: string) => json(ref('Error'), description);
const idParam = (name: string, description: string, example: string) =>
  ({ name, in: 'path', required: true, description, schema: str, example });

const AUTH = [{ bearer: [] }, { session: [] }];
const FORBIDDEN_TOKEN = {
  401: err('`sign_in_required`: no or unknown, expired or revoked token, or no session.'),
  403: err('`missing_scope` (the token lacks the scope), `cross_site` (a session cookie outside the site) or `forbidden` (the role).'),
};

export function openApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: "olh'o'posto API",
      version: '1.0.0',
      summary: 'Community photos of EV charging stations and sockets in Portugal.',
      description:
        'Reads are open (CORS `*`, no key). Writes need a personal access token (`Authorization: Bearer oop_…`, created on the account page) or, from the site\'s own pages, the session cookie. ' +
        'A token acts as its account, with that account\'s role and limits. Photos are CC BY-SA 4.0: credit the author (each photo carries a ready `attribution`). Prose docs: https://github.com/CarregaErvilhas/OlhaOPosto/blob/main/Docs/api.md',
      license: { name: 'CC BY-SA 4.0 (photos)', url: LICENSE_URL },
    },
    servers: [{ url: `${SITE}/api/v1` }],
    tags: [
      { name: 'Stations', description: 'Stations and sockets (NAP Portugal / MOBI.E codes).' },
      { name: 'Photos', description: 'Published photos and their removal.' },
      { name: 'Write', description: 'Needs a token or a session.' },
      { name: 'Community' },
    ],
    paths: {
      '/stations': {
        get: {
          tags: ['Stations'],
          operationId: 'searchStations',
          summary: 'Search stations',
          description:
            'By text (`q`), by place (`lat`, `lon`, `radius`), or by the filters alone (`opc`, `municipality`, `has_photo`, paged with `after`). ' +
            '`q` and coordinates cannot be combined. The filters also narrow a text or place search. `has_photo` is about the station\'s own static link.',
          parameters: [
            { name: 'q', in: 'query', schema: str, description: 'Words: every one must match, as a prefix, accents ignored.' },
            { name: 'lat', in: 'query', schema: { type: 'number', minimum: -90, maximum: 90 } },
            { name: 'lon', in: 'query', schema: { type: 'number', minimum: -180, maximum: 180 } },
            { name: 'radius', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 5000, default: 500 }, description: 'Metres.' },
            { name: 'opc', in: 'query', schema: str, description: 'Operator id (as in `operator.id`), e.g. `EZC3`.' },
            { name: 'municipality', in: 'query', schema: str, description: 'Exact municipality name (concelho), case-insensitive.' },
            { name: 'has_photo', in: 'query', schema: { type: 'boolean' }, description: '`true`: only stations with a main photo; `false`: only those without.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: API_MAX_RESULTS, default: 20 } },
            { name: 'after', in: 'query', schema: str, description: 'Filters-only listing: the `next` of the previous page.' },
          ],
          responses: {
            200: json(ref('SearchResponse'), 'Public stations.'),
            400: err('`q_or_coordinates`, `bad_coordinates`, `bad_filter` or `q_required`.'),
            429: err('`rate_limited`: wait a minute.'),
          },
        },
      },
      '/stations/{id}': {
        get: {
          tags: ['Stations'],
          operationId: 'getStation',
          summary: 'A station and its sockets',
          parameters: [idParam('id', 'Station id, e.g. `EZC-AMD-00051`.', 'EZC-AMD-00051')],
          responses: {
            200: json(ref('Station'), 'The station, with the main photo of itself and of each socket.'),
            301: { description: 'The station was renamed: follow `Location`.' },
            404: err('`not_found`.'),
          },
        },
      },
      '/evses/{evse}': {
        get: {
          tags: ['Stations'],
          operationId: 'getEvse',
          summary: 'A socket by its EVSE code',
          parameters: [idParam('evse', 'EVSE code, with or without the `*`.', 'PTEDPELSB9005001')],
          responses: {
            200: json(ref('Evse'), 'The socket and its station.'),
            300: json({ type: 'object', properties: { error: { const: 'ambiguous' }, candidates: { type: 'array', items: ref('Evse') } } }, 'The NAP repeats the code at several stations.'),
            404: err('`not_found`.'),
          },
        },
      },
      '/me': {
        get: {
          tags: ['Photos'],
          operationId: 'getMe',
          summary: 'Who is signed in on this site',
          description: 'For the site\'s own pages: `role` of the session cookie (or null) and whether it moderates. Never cached; a token is not read here.',
          responses: { 200: json({ type: 'object', properties: { role: nstr, moderator: { type: 'boolean' } } }, 'The session\'s role.') },
        },
      },
      '/main-photos': {
        get: {
          tags: ['Photos'],
          operationId: 'listMainPhotos',
          summary: 'Every published main photo',
          description: 'For sites that copy the thumbnails with the credit (the NAP dashboard reads it daily). For the whole gallery use `/photos.json`.',
          responses: { 200: json(ref('MainPhotos'), 'Main photos.') },
        },
      },
      '/photos.json': {
        get: {
          tags: ['Photos'],
          operationId: 'exportPhotos',
          summary: 'Daily export of every published photo',
          description:
            'The whole gallery, not only the main photos, for reusers. Cached for a day: fetch it once a day and drop the photos that are no longer listed. ' +
            'The position is the station\'s; the photo\'s own GPS is never published.',
          responses: { 200: json({ type: 'object', properties: { license: str, licenseUrl: str, count: { type: 'integer' }, photos: { type: 'array', items: ref('Photo') } } }, 'All published photos.') },
        },
      },
      '/photos/{id}': {
        get: {
          tags: ['Photos'],
          operationId: 'getPhoto',
          summary: 'One photo',
          description:
            'A published photo is open to everyone. Its author (and moderators) can also read their other photos with a token or session: those add `status` and, when refused, `refusal`, and have no image links. Anyone else gets 404 for them.',
          security: [{}, ...AUTH],
          parameters: [idParam('id', 'Photo id (the `id` returned by `POST /photos`).', '3f2b8d3e-0f0a-4c55-9c44-0a1c1b8d9e10')],
          responses: { 200: json(ref('Photo'), 'The photo.'), 404: err('`not_found`.') },
        },
        delete: {
          tags: ['Write'],
          operationId: 'deletePhoto',
          summary: 'Remove a photo',
          description:
            'The author removes their own photo (waiting, published or hidden); moderators and admins any. The static copies leave the storage, the cache is purged, a main photo that goes leaves the station or socket in «Sem foto principal» until a moderator picks another, and the photo\'s points stop counting. Scope `photos:write`. ' +
            'A moderator removing someone else\'s photo may send a JSON body with a `reason` (a fixed code) and a `note`; the author then sees both on their uploads page.',
          security: AUTH,
          parameters: [idParam('id', 'Photo id.', '3f2b8d3e-0f0a-4c55-9c44-0a1c1b8d9e10')],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string', enum: ['wrong_station', 'privacy', 'quality', 'duplicate', 'advertising', 'other'] }, note: { type: 'string', maxLength: 200 } } } } } },
          responses: {
            200: json({ type: 'object', properties: { removed: { const: true } } }, 'Removed. Repeating the call answers 404.'),
            400: err('`bad_reason` or `bad_body`.'),
            404: err('`not_found`: no such photo, or not yours and not public.'),
            502: err('`panoramax`: Panoramax did not answer. Nothing more was done; repeat the call.'),
            ...FORBIDDEN_TOKEN,
          },
        },
      },
      '/photos': {
        post: {
          tags: ['Write'],
          operationId: 'uploadPhoto',
          summary: 'Upload a photo',
          description:
            'Three clean JPEGs of the same picture, already blurred and with no metadata at all (EXIF is refused), plus `meta`. Scope `photos:write`; 50 a day for contributors. ' +
            '`pending` until a moderator approves it; `published` at once for `trusted` accounts when the photo was taken within 300 m of an active station. The GPS in `meta` is for moderators only.',
          security: AUTH,
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['full', 'main', 'thumb', 'meta'],
                  properties: {
                    full: { type: 'string', format: 'binary', description: 'JPEG, longest side up to 2048 px.' },
                    main: { type: 'string', format: 'binary', description: 'JPEG, longest side up to 1024 px.' },
                    thumb: { type: 'string', format: 'binary', description: 'JPEG, longest side up to 400 px.' },
                    meta: { type: 'string', description: 'JSON: `{"station", "target", "kind", "taken_at", "exif_lat", "exif_lon", "license": true, "no_people": true}`. `target` is the station id or a compact EVSE code. `kind` is `photo` (default) or `plate`, a charger\'s rating plate, with `target` = the station id.' },
                    turnstile: { type: 'string', description: 'Only from the site, with a session.' },
                  },
                },
              },
            },
          },
          responses: {
            201: json({ type: 'object', properties: { id: str, status: { enum: ['pending', 'published'] } } }, 'Received.'),
            400: err('`bad_photo`, `bad_target` or `consent_required`.'),
            409: err('`duplicate`.'),
            429: err('`daily_limit` or `too_fast`.'),
            503: err('`unavailable`: the database refuses writes for now; nothing was stored.'),
            ...FORBIDDEN_TOKEN,
          },
        },
      },
      '/selections/{target}': {
        put: {
          tags: ['Write'],
          operationId: 'setMainPhoto',
          summary: 'Choose the main photo of a station or socket',
          description: 'Scope `selections:write`; accounts `moderator` or `admin`. The photo must be published and be of that target.',
          security: AUTH,
          parameters: [idParam('target', 'Station id or compact EVSE code.', 'EZC-AMD-00051')],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', description: 'Photo id.' } } } } } },
          responses: {
            200: json({
              type: 'object',
              properties: {
                targets: { type: 'array', items: str },
                cachePending: { type: 'boolean', description: 'True when the edge cache could not be purged: the static links keep the old photo until a retry (every 6 hours) succeeds.' },
              },
            }, 'The targets published (empty if the photo does not fit that target).'),
            400: err('`bad_body` or `bad_photo`.'),
            502: err('`publish_failed`.'),
            ...FORBIDDEN_TOKEN,
          },
        },
      },
      '/ranking': {
        get: {
          tags: ['Community'],
          operationId: 'getRanking',
          summary: 'Top contributors',
          parameters: [{ name: 'period', in: 'query', schema: { type: 'string', enum: ['month', 'all'], default: 'month' } }],
          responses: {
            200: json({
              type: 'object',
              properties: {
                period: str,
                month: { type: 'string', description: 'UTC `YYYY-MM`, only for `month`.' },
                contributors: { type: 'array', items: { type: 'object', properties: { rank: { type: 'integer' }, name: str, points: { type: 'integer' }, photos: { type: 'integer' }, medal: { enum: ['bronze', 'silver', 'gold', null] } } } },
              },
            }, 'Top 50.'),
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Community'],
          operationId: 'getOpenApi',
          summary: 'This description',
          responses: { 200: { description: 'OpenAPI 3.1 document.', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'A personal access token, `oop_…`.' },
        session: { type: 'apiKey', in: 'cookie', name: 'session', description: 'The site\'s own session; only for calls from the site\'s pages.' },
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' }, detail: str } },
        Operator: { type: 'object', properties: { id: nstr, name: nstr } },
        SearchRow: {
          type: 'object',
          properties: { id: str, name: nstr, operator: ref('Operator'), address: nstr, municipality: nstr, region: nstr, lat: num, lon: num, status: { enum: ['active', 'missing_from_nap', 'missing_from_osm'] }, lifecycle: { const: 'construction', description: 'Only on stations under construction (from OSM, not in the NAP yet): they do not charge.' }, distance_m: { type: 'integer', description: 'Only in a place search.' } },
        },
        SearchResponse: {
          type: 'object',
          properties: { q: str, lat: num, lon: num, radius: { type: 'integer' }, results: { type: 'array', items: ref('SearchRow') }, next: { ...nstr, description: 'Filters-only listing: pass as `after` for the next page; null on the last.' } },
        },
        Sizes: {
          type: 'object',
          properties: Object.fromEntries(['thumb', 'main', 'full'].map((k) => [k, { type: 'object', properties: { url: { type: 'string', format: 'uri' }, maxPx: { type: ['integer', 'null'], description: 'The longest side, not the width.' } } }])),
        },
        PhotoLink: {
          type: 'object',
          description: 'The main photo of a station or socket.',
          properties: {
            target: str, credit: str, license: { const: LICENSE }, licenseUrl: str,
            attribution: { type: 'string', description: 'Text ready to paste next to the photo.' },
            sizes: ref('Sizes'), page: str, panoramax: nstr, report: str,
          },
        },
        Point: {
          type: 'object',
          properties: { id: str, evse: nstr, compact: nstr, connector: nstr, kw: { type: ['number', 'null'] }, dc: { type: 'boolean' }, status: str, photo: nullable(ref('PhotoLink')) },
        },
        Station: {
          type: 'object',
          properties: {
            id: str, code: nstr, name: nstr, operator: ref('Operator'), address: nstr, municipality: nstr, region: nstr,
            lat: num, lon: num, status: str, osm: nstr, photo: nullable(ref('PhotoLink')),
            points: { type: 'array', items: ref('Point') }, updatedAt: str,
            lifecycle: { const: 'construction', description: 'Only on stations under construction (id OSM-w… or OSM-n…, from OpenStreetMap, not in the NAP yet). They do not charge, have no sockets and no static link; they merge into their NAP station later and the old id answers 301.' },
            codes: { type: 'array', items: str, description: 'Under construction only: the MOBI.E codes in the OSM tags.' },
            photos: { type: 'array', description: 'The other published photos, the ones that are not a main photo (for a station under construction, all of them). No static link: the thumbnail is on Panoramax, the page is the photo\'s credit page.', items: { type: 'object', properties: { id: str, kind: { enum: ['photo', 'plate'] }, socket: nstr, credit: nstr, license: str, attribution: str, page: str, thumb: str } } },
          },
        },
        Evse: {
          type: 'object',
          properties: {
            evse: str, compact: str,
            station: { type: 'object', properties: { id: str, name: nstr, operator: ref('Operator'), photo: nullable(ref('PhotoLink')) } },
            point: { type: 'object' }, photo: nullable(ref('PhotoLink')), updatedAt: str,
          },
        },
        MainPhotos: {
          type: 'object',
          properties: {
            license: str,
            photos: { type: 'array', items: { type: 'object', properties: { target: str, station: { type: 'object', properties: { id: str, code: nstr } }, credit: nstr, thumb: str, main: str, full: str, page: str, panoramax: nstr, publishedAt: str } } },
          },
        },
        Photo: {
          type: 'object',
          description: 'A photo. The position is the station\'s, never the photo\'s GPS. `sizes` are the stable static links for a main photo and Panoramax\'s own images (maxPx unknown) for the others.',
          properties: {
            id: str, origin: { type: 'string', description: '`olhaoposto` for photos sent here; `osm_panoramax` or `commons` for a reference to a photo that lives there (no copy here: `sizes.thumb` only, no credit page, no removal request).' },
            kind: { enum: ['photo', 'plate'], description: '`plate`: a charger\'s rating plate (model, serial, rated V/A/kW). Gallery only: never a main photo, no static link.' },
            target: { type: 'string', description: 'Station id, or the compact EVSE code of the socket.' },
            socket: nstr,
            station: { type: 'object', properties: { id: str, code: nstr, name: nstr, operator: ref('Operator'), municipality: nstr, lat: num, lon: num } },
            credit: str, license: str, licenseUrl: nstr, attribution: str,
            takenAt: nstr, publishedAt: nstr, isMain: { type: 'boolean' },
            sizes: nullable(ref('Sizes')), page: str, sourceUrl: { ...nstr, description: 'External photos only: where the photo lives, and where its author, licence and any removal are handled.' }, creditPage: nstr, panoramaxId: nstr, panoramax: nstr, report: nstr,
            status: { type: 'string', description: 'Only for the author and moderators.', enum: ['pending', 'published', 'hidden', 'removed'] },
            refusal: { type: 'object', properties: { reason: str, note: nstr } },
          },
        },
      },
    },
  };
}
