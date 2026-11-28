// Targets that lost their main photo (Docs/arquitetura.md, *Links estáticos*).
//
// When a main photo is hidden or removed, its three keys leave `pictures` at
// once and the static link answers 404 (src/takedown.ts). The next main photo
// is never picked on its own: the next approved photo may be blurred badly,
// of the wrong socket or simply worse. The selection row stays, with lost_at
// set, and this file lists those targets with the other published photos of
// the same target, for a moderator or admin to promote one by hand. Nothing
// chosen, the link stays 404 until someone chooses (or a new photo of that
// target is approved, which fills it like any target without a main photo).
//
// Promoting goes through chooseMain (src/publish.ts), the same path as
// PUT /api/v1/selections/{target}: a station takes only photos of the station
// in general, a socket only photos of that socket.
//
// The list shows on its own page and at the foot of the moderation queue and
// of the removal panel, the two places where a main photo leaves.

import { currentUser, page, sameOrigin } from './auth.ts';
import { BRAND, accountPath, esc, layout, socketPath, stationPath, type Lang } from './pages.ts';
import type { PhotoEnv } from './photos.ts';
import { chooseMain, type PublishEnv } from './publish.ts';
import { canModerate, queuePath, STAGING_PREFIX } from './moderation.ts';
import { STATION_ID } from './types.ts';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
const db = (env: PhotoEnv) => env.DB as unknown as { prepare(sql: string): Stmt };

export const lostPath = (lang: Lang) => (lang === 'pt' ? '/admin/sem-principal' : '/en/admin/no-main');
export const PROMOTE_ACTION = '/admin/principal';
// Where the promote form may send the moderator back to (never a free URL).
const BACK: Record<string, (lang: Lang) => string> = {
  // Arrows, not the functions themselves: moderation.ts imports this file,
  // so its exports are not there yet while this one is evaluated.
  lost: (lang) => lostPath(lang),
  queue: (lang) => queuePath(lang),
  takedowns: (lang) => (lang === 'pt' ? '/admin/remocoes' : '/en/admin/takedowns'),
};
const LOST_LIMIT = 50;
const PHOTOS_PER_TARGET = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const T = {
  pt: {
    title: 'Sem foto principal',
    intro: 'Postos e tomadas cuja foto principal foi ocultada ou removida. O link estático dá 404 até alguém escolher outra: a seguinte nunca passa a principal sozinha. Escolhe uma das outras fotos publicadas do mesmo alvo e carrega no botão; sem escolha, fica sem foto principal.',
    empty: 'Não há postos nem tomadas sem foto principal.',
    station: 'Posto',
    socket: 'Tomada',
    since: 'Sem principal desde',
    sentBy: 'Enviada por',
    none: 'Não há outras fotos publicadas deste alvo. Fica sem foto principal até chegar e ser aprovada uma nova.',
    pick: 'Escolhe a nova foto principal',
    promote: 'Tornar principal',
    more: (n: number) => `Mostrados os ${n} mais antigos.`,
    done: 'Foto principal escolhida. O link estático já mostra a nova foto.',
    errors: {
      bad: 'Pedido inválido: escolhe uma foto.',
      stale: 'Este alvo já tem foto principal.',
      photo: 'Essa foto já não está publicada ou não é deste alvo.',
      publish: 'A cópia para o link estático falhou. Nada mudou; tenta outra vez.',
    } as Record<string, string>,
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
  },
  en: {
    title: 'Without a main photo',
    intro: 'Stations and sockets whose main photo was hidden or removed. The static link answers 404 until someone chooses another: the next one never becomes main on its own. Pick one of the other published photos of the same target and press the button; with no choice, it stays without a main photo.',
    empty: 'No station or socket is without a main photo.',
    station: 'Station',
    socket: 'Socket',
    since: 'Without a main photo since',
    sentBy: 'Sent by',
    none: 'There is no other published photo of this target. It stays without a main photo until a new one arrives and is approved.',
    pick: 'Pick the new main photo',
    promote: 'Make main',
    more: (n: number) => `Showing the ${n} oldest.`,
    done: 'Main photo chosen. The static link shows the new photo already.',
    errors: {
      bad: 'Invalid request: pick a photo.',
      stale: 'This target has a main photo already.',
      photo: 'That photo is no longer published or is not of this target.',
      publish: 'Copying it to the static link failed. Nothing changed; try again.',
    } as Record<string, string>,
    forbidden: 'This page is only for moderators and admins.',
    back: 'Back to account',
  },
};

export interface Candidate {
  id: string;
  credit: string | null;
  approved_at: string | null;
}
export interface LostTarget {
  target: string;
  station_id: string;
  station_name: string | null;
  lost_at: string;
  photos: Candidate[];
}

// The targets that lost their main photo, oldest loss first, each with the
// other published photos it could take (newest approval first).
export async function lostTargets(env: PhotoEnv): Promise<LostTarget[]> {
  const { results: rows } = await db(env).prepare(
    `SELECT sel.target, sel.station_id, s.name AS station_name, sel.lost_at
       FROM selections sel LEFT JOIN stations s ON s.id = sel.station_id
      WHERE sel.lost_at IS NOT NULL
      ORDER BY sel.lost_at, sel.target
      LIMIT ${LOST_LIMIT}`,
  ).all<Omit<LostTarget, 'photos'>>();
  if (!rows.length) return [];
  // The same rule as chooseMain: the station target takes photos of the
  // station in general, a socket target only photos of that socket.
  const { results: photos } = await db(env).prepare(
    `SELECT sel.target, p.id, p.credit, p.approved_at
       FROM selections sel
       JOIN photos p ON p.station_id = sel.station_id AND p.status = 'published' AND p.origin = 'olhaoposto'
        AND p.kind = 'photo' AND p.id <> sel.photo_id
        AND ((sel.target = sel.station_id AND p.evse_compact IS NULL) OR p.evse_compact = sel.target)
      WHERE sel.lost_at IS NOT NULL
      ORDER BY p.approved_at DESC, p.created_at DESC`,
  ).all<Candidate & { target: string }>();
  return rows.map((r) => ({
    ...r,
    photos: photos.filter((p) => p.target === r.target).slice(0, PHOTOS_PER_TARGET)
      .map(({ id, credit, approved_at }) => ({ id, credit, approved_at })),
  }));
}

function lostItem(lang: Lang, l: LostTarget, back: string): string {
  const t = T[lang];
  const socket = l.target !== l.station_id;
  const what = socket
    ? `<p><strong>${t.socket}:</strong> <a href="${socketPath(lang, l.target)}" target="_blank" rel="noopener">${esc(l.target)}</a> · <strong>${t.station}:</strong> <a href="${stationPath(lang, l.station_id)}" target="_blank" rel="noopener">${esc(l.station_name ?? l.station_id)}</a></p>`
    : `<p><strong>${t.station}:</strong> <a href="${stationPath(lang, l.station_id)}" target="_blank" rel="noopener">${esc(l.station_name ?? l.station_id)}</a> <span class="muted">${esc(l.station_id)}</span></p>`;
  const since = `<p><strong>${t.since}:</strong> ${esc(l.lost_at.slice(0, 16).replace('T', ' '))} UTC</p>`;
  if (!l.photos.length) return `<article class="lost-item">\n${what}\n${since}\n<p class="muted">${t.none}</p>\n</article>`;
  const choices = l.photos.map((p) => {
    const img = `${STAGING_PREFIX}${encodeURIComponent(p.id)}/`;
    return `<label class="lost-choice"><input type="radio" name="photo" value="${esc(p.id)}" required>` +
      `<img src="${img}thumb.jpg" alt="" loading="lazy">` +
      `<span>${t.sentBy} <span lang="">${esc(p.credit ?? '—')}</span>` +
      (p.approved_at ? ` · ${esc(p.approved_at.slice(0, 10))}` : '') +
      ` · <a href="${img}main.jpg" target="_blank" rel="noopener">1024 px</a></span></label>`;
  }).join('\n');
  return `<article class="lost-item">
${what}
${since}
<form method="post" action="${PROMOTE_ACTION}">
<input type="hidden" name="target" value="${esc(l.target)}">
<input type="hidden" name="lang" value="${lang}">
<input type="hidden" name="back" value="${esc(back)}">
<fieldset><legend>${t.pick}</legend>
<div class="lost-gallery">
${choices}
</div>
</fieldset>
<button type="submit" class="button">${t.promote}</button>
</form>
</article>`;
}

// The list with its message, for this page and the foot of the other two.
// `back` names the page the form returns to (a key of BACK).
export function lostSection(
  lang: Lang, items: LostTarget[], p: { back: string; heading?: boolean; ok?: string; error?: string },
): string {
  const t = T[lang];
  const ok = p.ok === 'ok' ? `<p class="notice" role="status">${t.done}</p>` : '';
  const err = p.error && t.errors[p.error] ? `<p class="notice" role="alert">${esc(t.errors[p.error])}</p>` : '';
  // On the other panels an empty list with nothing to say takes no room.
  if (p.heading && !items.length && !ok && !err) return '';
  const parts: string[] = [];
  if (p.heading) parts.push(`<h2 id="sem-principal">${t.title}</h2>`, `<p>${t.intro}</p>`);
  if (ok) parts.push(ok);
  if (err) parts.push(err);
  if (!items.length) parts.push(`<p>${t.empty}</p>`);
  else {
    parts.push(items.map((i) => lostItem(lang, i, p.back)).join('\n'));
    if (items.length >= LOST_LIMIT) parts.push(`<p class="muted">${t.more(LOST_LIMIT)}</p>`);
  }
  return parts.join('\n');
}

// The section for the queue and the removal panel, from the request's query.
export async function lostSectionFor(lang: Lang, env: PhotoEnv, request: Request, back: string): Promise<string> {
  const items = await lostTargets(env).catch(() => []);
  const q = new URL(request.url).searchParams.get('principal') ?? undefined;
  return lostSection(lang, items, { back, heading: true, ...(q === 'ok' ? { ok: q } : { error: q }) });
}

export function lostPage(lang: Lang, items: LostTarget[], p: { ok?: string; error?: string }): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    switchTo: { pt: lostPath('pt'), en: lostPath('en') },
    body: [
      `<h1>${t.title}</h1>`,
      `<p>${t.intro}</p>`,
      lostSection(lang, items, { back: 'lost', ...p }),
      `<p><a href="${accountPath(lang)}">${t.back}</a></p>`,
    ].join('\n'),
  });
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
const noStore = (body: string, status: number) =>
  new Response(body, { status, headers: { 'cache-control': 'no-store' } });

function forbiddenPage(lang: Lang): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    body: `<div class="page-msg">\n<h1>${t.title}</h1>\n<p>${t.forbidden}</p>\n<p><a href="${accountPath(lang)}">${t.back}</a></p>\n</div>`,
  });
}

export async function lostHtml(lang: Lang, request: Request, env: PhotoEnv, headers: Record<string, string>): Promise<Response> {
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(lostPath(lang))}`);
  if (!canModerate(user.role)) return page(lang, forbiddenPage(lang), 403, headers);
  const items = await lostTargets(env);
  const q = new URL(request.url).searchParams.get('principal') ?? undefined;
  return page(lang, lostPage(lang, items, q === 'ok' ? { ok: q } : { error: q }), 200, headers);
}

// POST /admin/principal: promote one published photo to main of a target
// that lost its own. Moderators and admins only.
export async function promoteMain(request: Request, env: PublishEnv, fetcher: Fetch = fetch, now = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return noStore('forbidden', 403);
  let form: FormData;
  try { form = await request.formData(); } catch { return noStore('bad request', 400); }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const backKey = form.get('back');
  const backPath = (BACK[typeof backKey === 'string' && Object.hasOwn(BACK, backKey) ? backKey : 'lost'])(lang);
  const back = (q: string) => redirect(`${backPath}?principal=${q}#sem-principal`, 303);
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return redirect(`/auth/osm/login?next=${encodeURIComponent(backPath)}`, 303);
  if (!canModerate(user.role)) return noStore('forbidden', 403);
  const target = form.get('target');
  const photo = form.get('photo');
  if (typeof target !== 'string' || !STATION_ID.test(target) || typeof photo !== 'string' || !UUID.test(photo)) return back('bad');
  // Only a target that lost its main photo: a second moderator on the same
  // target, or one that was filled meanwhile, is told so instead of replacing it.
  const lost = await db(env).prepare(`SELECT 1 AS x FROM selections WHERE target = ? AND lost_at IS NOT NULL`)
    .bind(target).first<{ x: number }>();
  if (!lost) return back('stale');
  try {
    const done = await chooseMain(env, target, photo.toLowerCase(), user.id, fetcher, now);
    return back(done.targets.length ? 'ok' : 'photo');
  } catch {
    return back('publish');
  }
}
