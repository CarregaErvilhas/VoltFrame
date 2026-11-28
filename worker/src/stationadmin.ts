// The photos of one station, for moderators and admins: every published
// photo of the station and of each socket, grouped by target, with the main
// one marked. From here a moderator makes another photo the main one
// (chooseMain, the same path as PUT /api/v1/selections/{target}) or removes a
// photo with a reason (deletePhoto, the same path as DELETE /api/v1/photos/{id}).
//
// Replacing a main photo with a better one is two steps on purpose: promote
// the better one first, then remove the old one if it should go. Removing the
// main photo first leaves the target in «Sem foto principal» (src/mains.ts),
// and a removal also takes the photo off Panoramax and its points away.
//
// The page is no-store and checks the session; the public station page is
// cached for everyone, so it only carries a hidden link that site.js shows
// to moderators (GET /api/v1/me).

import { currentUser, page, sameOrigin, type AuthEnv } from './auth.ts';
import { canModerate, STAGING_PREFIX } from './moderation.ts';
import { BRAND, PANORAMAX_URL, accountPath, esc, layout, photoPath, stationAdminPath, stationPath, type Lang } from './pages.ts';
import { deletePhoto } from './photoapi.ts';
import { chooseMain } from './publish.ts';
import { reasonOptions } from './reasons.ts';
import type { TakedownEnv } from './takedown.ts';
import { STATION_ID } from './types.ts';

type Fetch = typeof fetch;

export const STATION_ADMIN_ACTION = '/admin/posto-foto';
export { stationAdminPath };
export const STATION_ADMIN_ROUTE: Record<Lang, RegExp> = {
  pt: /^\/admin\/posto\/([^/]+)$/,
  en: /^\/en\/admin\/station\/([^/]+)$/,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_LIMIT = 200;

const T = {
  pt: {
    title: (id: string) => `Fotos do posto ${id}`,
    intro: 'Todas as fotos publicadas deste posto e das tomadas. Para trocar a principal por uma melhor, torna a melhor principal primeiro; depois, se a antiga deve sair, remove-a com o motivo. Remover a principal deixa o posto ou a tomada sem foto principal (o link estático dá 404) até escolheres outra.',
    station: 'Posto em geral',
    socket: (n: number) => `Tomada ${n}`,
    plates: 'Chapas',
    moveTo: 'Mudar para',
    movePick: 'Escolhe onde',
    move: 'Mudar',
    moveMain: 'É a principal: para a mudar de sítio, torna outra principal primeiro.',
    platesHint: 'As placas de características dos carregadores. Nunca são a foto principal: só se removem.',
    none: 'Sem fotos publicadas.',
    main: 'Principal',
    lost: 'Sem foto principal: escolhe uma.',
    sentBy: 'Enviada por',
    credit: 'Página da foto',
    promote: 'Tornar principal',
    noMainHere: 'Posto em construção: ainda não tem foto principal.',
    reason: 'Motivo',
    reasonPick: 'Escolhe o motivo',
    note: 'Nota (opcional)',
    remove: 'Remover',
    removeMain: 'Remover a principal',
    back: 'Voltar à página do posto',
    forbiddenTitle: 'Sem acesso',
    forbidden: 'Só moderadores e administradores podem moderar as fotos de um posto.',
    account: 'Voltar à conta',
    notFound: 'Este posto não existe.',
    results: {
      promoted: 'Feito: é a nova foto principal.',
      cache: 'É a nova foto principal, mas a cache da Cloudflare não foi limpa: os links estáticos ainda mostram a antiga. Tentamos outra vez de 6 em 6 horas; os logs do Worker dizem porquê.',
      removed: 'Foto removida.',
      bad: 'Pedido inválido.',
      photo: 'Esta foto não está publicada, ou não é deste alvo.',
      publish: 'Não foi possível copiar a foto para os links estáticos. Tenta outra vez.',
      reason: 'Escolhe um motivo para remover.',
      remove: 'Não foi possível remover a foto no Panoramax. Tenta outra vez.',
      moved: 'Foto mudada; as etiquetas no Panoramax também.',
      move: 'Não foi possível mudar as etiquetas no Panoramax: nada mudou. Tenta outra vez.',
      ismain: 'É a principal: torna outra principal primeiro.',
    } as Record<string, string>,
  },
  en: {
    title: (id: string) => `Photos of station ${id}`,
    intro: 'Every published photo of this station and its sockets. To replace the main photo with a better one, make the better one main first; then, if the old one should go, remove it with the reason. Removing the main photo leaves the station or socket without one (the static link answers 404) until you choose another.',
    station: 'Station in general',
    socket: (n: number) => `Socket ${n}`,
    plates: 'Rating plates',
    moveTo: 'Move to',
    movePick: 'Choose where',
    move: 'Move',
    moveMain: 'It is the main photo: to move it, make another one main first.',
    platesHint: 'The chargers’ rating plates. Never the main photo: they can only be removed.',
    none: 'No published photos.',
    main: 'Main',
    lost: 'No main photo: choose one.',
    sentBy: 'Sent by',
    credit: 'Photo page',
    promote: 'Make main',
    noMainHere: 'Under construction: no main photo yet.',
    reason: 'Reason',
    reasonPick: 'Choose the reason',
    note: 'Note (optional)',
    remove: 'Remove',
    removeMain: 'Remove the main photo',
    back: 'Back to the station page',
    forbiddenTitle: 'No access',
    forbidden: 'Only moderators and admins moderate the photos of a station.',
    account: 'Back to the account',
    notFound: 'This station does not exist.',
    results: {
      promoted: 'Done: it is the new main photo.',
      cache: 'It is the new main photo, but the Cloudflare cache was not cleared: the static links still show the old one. We try again every 6 hours; the Worker logs say why.',
      removed: 'Photo removed.',
      bad: 'Invalid request.',
      photo: 'This photo is not published, or not of this target.',
      publish: 'Copying the photo to the static links failed. Try again.',
      reason: 'Choose a reason to remove it.',
      remove: 'Removing the photo on Panoramax failed. Try again.',
      moved: 'Photo moved; its tags on Panoramax too.',
      move: 'Changing the tags on Panoramax failed: nothing changed. Try again.',
      ismain: 'It is the main photo: make another one main first.',
    } as Record<string, string>,
  },
};

interface AdminPhoto {
  id: string;
  evse_compact: string | null;
  kind?: string | null;
  credit: string | null;
  approved_at: string | null;
  taken_at: string | null;
}
interface AdminPoint { evse_compact: string | null; evse_id: string | null; connector: string | null; max_kw: number | null }
interface AdminStation { id: string; name: string | null; source: string | null }
interface Selection { target: string; photo_id: string; published_at: string | null; lost_at: string | null }

export interface StationPhotos {
  station: AdminStation;
  points: AdminPoint[];
  photos: AdminPhoto[];
  selections: Selection[];
}

export async function stationPhotos(env: { DB: unknown }, id: string): Promise<StationPhotos | null> {
  const D = env.DB as D1Database;
  const [st, pts, ph, sel] = await D.batch([
    D.prepare(`SELECT id, name, source FROM stations WHERE id = ?`).bind(id),
    D.prepare(`SELECT evse_compact, evse_id, connector, max_kw FROM evses WHERE station_id = ? ORDER BY point_id`).bind(id),
    D.prepare(
      `SELECT id, evse_compact, kind, credit, approved_at, taken_at FROM photos
        WHERE station_id = ? AND origin = 'olhaoposto' AND status = 'published'
        ORDER BY approved_at, id LIMIT ${PHOTO_LIMIT}`,
    ).bind(id),
    D.prepare(`SELECT target, photo_id, published_at, lost_at FROM selections WHERE station_id = ?`).bind(id),
  ]);
  const station = (st.results as AdminStation[])[0];
  if (!station) return null;
  return {
    station,
    points: pts.results as AdminPoint[],
    photos: ph.results as AdminPhoto[],
    selections: sel.results as Selection[],
  };
}

// Where a photo can be moved: the station in general, each socket with an
// EVSE code, or the rating plates. `plate` is the station's plates gallery.
type Dest = { value: string; label: string };
const PLATE_DEST = 'plate';
function destinations(lang: Lang, s: AdminStation, points: AdminPoint[]): Dest[] {
  const t = T[lang];
  return [
    { value: s.id, label: t.station },
    ...points.map((p, i) => ({ p, n: i + 1 })).filter((x) => x.p.evse_compact)
      .map((x) => ({ value: x.p.evse_compact as string, label: `${t.socket(x.n)} · ${[x.p.connector, x.p.max_kw ? `${x.p.max_kw} kW` : null].filter(Boolean).join(' ')}` })),
    { value: PLATE_DEST, label: t.plates },
  ];
}

function photoItem(lang: Lang, s: AdminStation, target: string, p: AdminPhoto, isMain: boolean, dests: Dest[] = []): string {
  const t = T[lang];
  const here = p.kind === 'plate' ? PLATE_DEST : (p.evse_compact ?? s.id);
  const img = `${STAGING_PREFIX}${encodeURIComponent(p.id)}/`;
  const hidden = `<input type="hidden" name="station" value="${esc(s.id)}">
<input type="hidden" name="target" value="${esc(target)}">
<input type="hidden" name="photo" value="${esc(p.id)}">
<input type="hidden" name="lang" value="${lang}">`;
  // A rating plate is never a main photo: it can only be removed.
  const promote = isMain || s.source !== 'nap' || p.kind === 'plate' ? '' : `<form method="post" action="${STATION_ADMIN_ACTION}">
${hidden}
<input type="hidden" name="action" value="promote">
<button type="submit" class="button">${t.promote}</button></form>`;
  // Moving the main photo would leave its target without one: promote
  // another first. The tags on Panoramax follow (osm|ref:EU:EVSE, OlhaOPosto|kind).
  const others = dests.filter((d) => d.value !== here);
  const move = isMain || !others.length ? (isMain ? `<p class="hint">${t.moveMain}</p>` : '') : `<form method="post" action="${STATION_ADMIN_ACTION}" class="move-photo">
${hidden}
<input type="hidden" name="action" value="move">
<label for="to-${esc(p.id)}">${t.moveTo}</label>
<select id="to-${esc(p.id)}" name="to" required><option value="" selected disabled>${t.movePick}</option>${others.map((d) => `<option value="${esc(d.value)}">${esc(d.label)}</option>`).join('')}</select>
<button type="submit" class="button secondary">${t.move}</button></form>`;
  const remove = `<form method="post" action="${STATION_ADMIN_ACTION}" class="remove-photo">
${hidden}
<input type="hidden" name="action" value="remove">
<label for="reason-${esc(p.id)}">${t.reason}</label>
<select id="reason-${esc(p.id)}" name="reason" required>${reasonOptions(lang, t.reasonPick)}</select>
<label for="note-${esc(p.id)}">${t.note}</label>
<input id="note-${esc(p.id)}" name="note" maxlength="200" autocomplete="off">
<button type="submit" class="button secondary">${isMain ? t.removeMain : t.remove}</button></form>`;
  const date = (p.taken_at ?? p.approved_at ?? '').slice(0, 10);
  return `<li class="admin-photo${isMain ? ' is-main' : ''}">
<a href="${img}main.jpg" target="_blank" rel="noopener"><img src="${img}thumb.jpg" alt="" loading="lazy"></a>
<p>${isMain ? `<span class="chip ok">${t.main}</span> ` : ''}${t.sentBy} <span lang="">${esc(p.credit ?? '—')}</span>${date ? ` · ${esc(date)}` : ''} · <a href="${photoPath(lang, p.id)}">${t.credit}</a></p>
${promote}
${move}
${remove}
</li>`;
}

export function stationAdminPage(lang: Lang, d: StationPhotos, result?: string): string {
  const t = T[lang];
  const s = d.station;
  const mains = new Map(d.selections.filter((x) => x.published_at && !x.lost_at).map((x) => [x.target, x.photo_id]));
  const lost = new Set(d.selections.filter((x) => x.lost_at).map((x) => x.target));
  const groups: { target: string; title: string; meta: string; plates?: boolean }[] = [
    { target: s.id, title: t.station, meta: '' },
    ...d.points.map((p, i) => ({ p, n: i + 1 })).filter((x) => x.p.evse_compact).map((x) => ({
      target: x.p.evse_compact as string,
      title: t.socket(x.n),
      meta: [x.p.connector, x.p.max_kw ? `${x.p.max_kw} kW` : null, x.p.evse_id].filter(Boolean).join(' · '),
    })),
    { target: s.id, title: t.plates, meta: '', plates: true },
  ];
  const dests = destinations(lang, s, d.points);
  const sections = groups.map((g) => {
    const photos = d.photos.filter((p) => (p.kind === 'plate') === Boolean(g.plates) && (p.evse_compact ?? s.id) === g.target);
    const main = mains.get(g.target);
    // The main photo first, then the others in the order they were approved.
    photos.sort((a, b) => Number(b.id === main) - Number(a.id === main));
    const notes = g.plates ? `<p class="hint">${t.platesHint}</p>` : [
      s.source !== 'nap' && g.target === s.id ? `<p class="hint">${t.noMainHere}</p>` : '',
      lost.has(g.target) ? `<p class="notice">${t.lost}</p>` : '',
    ].join('');
    return `<section class="card admin-target" id="${g.plates ? 'chapas' : `t-${esc(g.target)}`}">
<h2>${esc(g.title)}</h2>${g.meta ? `\n<p class="meta mono">${esc(g.meta)}</p>` : ''}
${notes}${photos.length
      ? `<ul class="admin-photos" role="list">\n${photos.map((p) => photoItem(lang, s, g.target, p, p.id === main, dests)).join('\n')}\n</ul>`
      : `<p class="muted">${t.none}</p>`}
</section>`;
  });
  const msg = result && t.results[result]
    ? `<p class="${result === 'promoted' || result === 'removed' || result === 'moved' ? 'ok' : 'notice'}" role="status">${t.results[result]}</p>`
    : '';
  return layout({
    lang,
    title: `${t.title(s.id)} · ${BRAND}`,
    description: t.title(s.id),
    noindex: true,
    switchTo: { pt: stationAdminPath('pt', s.id), en: stationAdminPath('en', s.id) },
    body: [
      `<h1>${esc(t.title(s.id))}</h1>`,
      s.name ? `<p class="subtitle" lang="">${esc(s.name)}</p>` : '',
      msg,
      `<p>${t.intro}</p>`,
      ...sections,
      `<p><a href="${stationPath(lang, s.id)}">${t.back}</a></p>`,
    ].filter(Boolean).join('\n'),
  });
}

function messagePage(lang: Lang, title: string, text: string): string {
  return layout({
    lang,
    title: `${title} · ${BRAND}`,
    description: title,
    noindex: true,
    body: `<div class="page-msg">\n<h1>${esc(title)}</h1>\n<p>${esc(text)}</p>\n<p><a href="${accountPath(lang)}">${T[lang].account}</a></p>\n</div>`,
  });
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
const noStore = (body: string, status: number) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store' } });

// GET /admin/posto/{id}, /en/admin/station/{id}
export async function stationAdminHtml(
  lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>, rawId: string,
): Promise<Response> {
  let id: string;
  try { id = decodeURIComponent(rawId); } catch { id = ''; }
  const path = stationAdminPath(lang, id);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(path)}`);
  const t = T[lang];
  if (!canModerate(user.role)) return page(lang, messagePage(lang, t.forbiddenTitle, t.forbidden), 403, headers);
  const d = STATION_ID.test(id) ? await stationPhotos(env, id) : null;
  if (!d) return page(lang, messagePage(lang, t.notFound, t.notFound), 404, headers);
  const result = new URL(request.url).searchParams.get('r') ?? undefined;
  return page(lang, stationAdminPage(lang, d, result), 200, headers);
}

// POST /admin/posto-foto: promote or remove one photo of a station.
export async function stationAdminAction(
  request: Request, env: TakedownEnv & AuthEnv, fetcher: Fetch = fetch, now = new Date(),
): Promise<Response> {
  if (!sameOrigin(request)) return noStore('forbidden', 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return noStore('bad request', 400); }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const station = form.get('station');
  if (typeof station !== 'string' || !STATION_ID.test(station)) return noStore('bad request', 400);
  const path = stationAdminPath(lang, station);
  const target = form.get('target');
  const back = (r: string) => redirect(`${path}?r=${r}${typeof target === 'string' && STATION_ID.test(target) ? `#t-${encodeURIComponent(target)}` : ''}`, 303);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(path)}`, 303);
  if (!canModerate(user.role)) return noStore('forbidden', 403);
  const photo = form.get('photo');
  const action = form.get('action');
  if (typeof photo !== 'string' || !UUID.test(photo) || typeof target !== 'string' || !STATION_ID.test(target)) return back('bad');
  const id = photo.toLowerCase();
  // The photo must be of this station: the form never moves a photo elsewhere.
  const own = await (env.DB as unknown as D1Database).prepare(`SELECT 1 AS x FROM photos WHERE id = ? AND station_id = ?`).bind(id, station).first<{ x: number }>();
  if (!own) return back('photo');
  if (action === 'promote') {
    try {
      const done = await chooseMain(env, target, id, user.id, fetcher, now);
      return back(!done.targets.length ? 'photo' : done.cachePending ? 'cache' : 'promoted');
    } catch {
      return back('publish');
    }
  }
  if (action === 'move') {
    const r = await movePhoto(env, station, id, form.get('to'), fetcher);
    return back(r);
  }
  if (action === 'remove') {
    const reason = form.get('reason');
    if (typeof reason !== 'string' || !reason) return back('reason');
    const r = await deletePhoto(env, user, id, { reason, note: form.get('note') ?? undefined }, fetcher, now);
    if ('ok' in r) return back('removed');
    return back(r.error === 'bad_reason' ? 'reason' : r.error === 'panoramax' ? 'remove' : 'photo');
  }
  return back('bad');
}

// Move a photo to another target of the same station: the station in
// general, a socket, or the rating plates. Panoramax first (the EVSE and kind
// tags), then D1, so a failure there changes nothing. Never the main photo.
export async function movePhoto(
  env: TakedownEnv & AuthEnv, station: string, id: string, to: unknown, fetcher: Fetch = fetch,
): Promise<'moved' | 'bad' | 'photo' | 'ismain' | 'move'> {
  if (typeof to !== 'string' || !to) return 'bad';
  const D = env.DB as unknown as D1Database;
  const p = await D.prepare(
    `SELECT id, evse_compact, kind, panoramax_id FROM photos WHERE id = ? AND station_id = ? AND origin = 'olhaoposto' AND status IN ('pending', 'published', 'hidden')`,
  ).bind(id, station).first<{ id: string; evse_compact: string | null; kind: string; panoramax_id: string | null }>();
  if (!p) return 'photo';
  const main = await D.prepare(`SELECT 1 AS x FROM selections WHERE photo_id = ? AND lost_at IS NULL`).bind(id).first();
  if (main) return 'ismain';
  const kind = to === PLATE_DEST ? 'plate' : 'photo';
  let evse: string | null = null;
  let evseId: string | null = null;
  if (kind === 'photo' && to !== station) {
    const row = await D.prepare(`SELECT evse_compact, evse_id FROM evses WHERE station_id = ? AND evse_compact = ?`).bind(station, to)
      .first<{ evse_compact: string; evse_id: string | null }>();
    if (!row) return 'bad';
    evse = row.evse_compact;
    evseId = row.evse_id;
  }
  if (evse === p.evse_compact && kind === p.kind) return 'moved';
  const oldEvseId = p.evse_compact
    ? (await D.prepare(`SELECT evse_id FROM evses WHERE station_id = ? AND evse_compact = ?`).bind(station, p.evse_compact).first<{ evse_id: string | null }>())?.evse_id ?? null
    : null;
  if (p.panoramax_id) {
    if (!env.PANORAMAX_TOKEN) return 'move';
    const semantics = [
      ...(oldEvseId && oldEvseId !== evseId ? [{ action: 'delete', key: 'osm|ref:EU:EVSE', value: oldEvseId }] : []),
      ...(evseId && evseId !== oldEvseId ? [{ action: 'add', key: 'osm|ref:EU:EVSE', value: evseId }] : []),
      ...(p.kind === 'plate' && kind !== 'plate' ? [{ action: 'delete', key: 'OlhaOPosto|kind', value: 'plate' }] : []),
      ...(kind === 'plate' && p.kind !== 'plate' ? [{ action: 'add', key: 'OlhaOPosto|kind', value: 'plate' }] : []),
    ];
    const r = await fetcher(`${env.PANORAMAX_URL ?? PANORAMAX_URL}/api/pictures/${encodeURIComponent(p.panoramax_id)}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${env.PANORAMAX_TOKEN}`, 'user-agent': 'OlhaOPosto', 'content-type': 'application/json' },
      body: JSON.stringify({ semantics }),
    }).catch(() => null);
    if (!r || !r.ok) return 'move';
  }
  await D.prepare(`UPDATE photos SET evse_compact = ?, kind = ? WHERE id = ?`).bind(evse, kind, id).run();
  return 'moved';
}
