// The credit page of a photo (/p/{photo_id}, /en/p/{photo_id}): the photo, who
// took it, when, under which licence, which station or socket it shows, and
// where it lives on Panoramax. The XMP of every new copy in pictures.* points
// here (src/publish.ts). Only published photos have one; a hidden, pending or
// removed photo is a 404, like any other page that does not exist.
//
// For the current main photo of a station or socket the page also helps a
// mapper add the photo to OpenStreetMap by hand: a link that opens the editor
// and the tag to copy. No bot and no automatic edit (Docs/plan.md, *OSM*).
import {
  BRAND, esc, layout, osmEditUrl, PANORAMAX_URL, photoPath, shownPicture, socketAnchor, stationPath, type Lang,
} from './pages.ts';
import { isPublic } from './types.ts';

export interface CreditRow {
  id: string;
  station_id: string;
  evse_compact: string | null;
  credit: string | null;
  taken_at: string | null;
  approved_at: string | null;
  created_at: string;
  panoramax_id: string | null;
  // The photo is the current main photo of its target (0/1 from SQLite).
  is_main: number;
  station_name: string | null;
  lat: number;
  lon: number;
  osm_ref: string | null;
  station_status: string;
}

export const PHOTO_ID = /^[A-Za-z0-9-]{1,64}$/;

export async function getCredit(env: { DB: D1Database }, id: string): Promise<CreditRow | null> {
  if (!PHOTO_ID.test(id)) return null;
  const row = await env.DB.prepare(
    // The target of a photo is its socket, or its station when it has none.
    `SELECT p.id, p.station_id, p.evse_compact, p.credit, p.taken_at, p.approved_at, p.created_at, p.panoramax_id,
            EXISTS (SELECT 1 FROM selections sel
                     WHERE sel.target = coalesce(p.evse_compact, p.station_id)
                       AND sel.photo_id = p.id AND sel.published_at IS NOT NULL) AS is_main,
            s.name AS station_name, s.lat, s.lon, s.osm_ref, s.status AS station_status
       FROM photos p JOIN stations s ON s.id = p.station_id
      WHERE p.id = ? AND p.status = 'published' AND p.origin = 'olhaoposto'`,
  ).bind(id).first<CreditRow>();
  return row && isPublic({ status: row.station_status }) ? row : null;
}

// osmEditUrl lives in pages.ts (the station page uses it too).
export { osmEditUrl };

const T = {
  pt: {
    title: (target: string) => `Foto de ${target}`,
    desc: (credit: string, target: string) => `Foto de ${target} por ${credit}, CC BY-SA 4.0.`,
    alt: (target: string) => `Foto de ${target}`,
    credit: 'Autor',
    date: 'Data',
    licence: 'Licença',
    licenceText: 'CC BY-SA 4.0',
    shows: 'Mostra',
    station: (id: string) => `o posto ${id}`,
    socket: (code: string, id: string) => `a tomada ${code} do posto ${id}`,
    panoramax: 'Ver no Panoramax',
    reuse: 'Para reutilizar, indica o autor e a licença:',
    report: 'Pedir remoção',
    osmTitle: 'Acrescentar ao OpenStreetMap',
    osmIntro: 'Esta é a foto principal. Quem mapeia pode juntar-lhe esta etiqueta ao elemento do OpenStreetMap, à mão. Não há bots nem edições automáticas.',
    osmElement: 'Abrir o elemento no editor iD',
    osmPlace: 'Abrir o sítio no editor iD',
    osmSocketNote: 'O NAP não diz qual é o elemento desta tomada: procura o ponto de carregamento no mapa.',
    osmTag: 'Etiqueta a acrescentar',
    copy: 'Copiar etiqueta',
    copied: 'Etiqueta copiada.',
    copyFailed: 'Não foi possível copiar. A etiqueta ficou selecionada: copia-a à mão.',
    stationPage: 'Página do posto',
    unknownDate: 'sem data',
  },
  en: {
    title: (target: string) => `Photo of ${target}`,
    desc: (credit: string, target: string) => `Photo of ${target} by ${credit}, CC BY-SA 4.0.`,
    alt: (target: string) => `Photo of ${target}`,
    credit: 'Author',
    date: 'Date',
    licence: 'Licence',
    licenceText: 'CC BY-SA 4.0',
    shows: 'Shows',
    station: (id: string) => `station ${id}`,
    socket: (code: string, id: string) => `socket ${code} of station ${id}`,
    panoramax: 'View on Panoramax',
    reuse: 'To reuse it, credit the author and the licence:',
    report: 'Ask for removal',
    osmTitle: 'Add to OpenStreetMap',
    osmIntro: 'This is the main photo. A mapper can add this tag to the OpenStreetMap element by hand. There are no bots and no automatic edits.',
    osmElement: 'Open the element in the iD editor',
    osmPlace: 'Open the place in the iD editor',
    osmSocketNote: 'The NAP does not say which element is this socket: look for the charge point on the map.',
    osmTag: 'Tag to add',
    copy: 'Copy tag',
    copied: 'Tag copied.',
    copyFailed: 'Could not copy. The tag is selected: copy it by hand.',
    stationPage: 'Station page',
    unknownDate: 'no date',
  },
} as const;

const ICON_COPY = '<svg class="idle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>';
const ICON_CHECK = '<svg class="done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const dateOf = (r: CreditRow) => (r.taken_at ?? r.approved_at ?? r.created_at ?? '').slice(0, 10);

// The sizes in pictures.* exist only for the main photo of a target. Any other
// published photo is shown from Panoramax, which serves it publicly once approved.
export const creditImage = (r: CreditRow) =>
  r.is_main
    ? shownPicture(r.evse_compact ?? r.station_id, '', r.id)
    : r.panoramax_id ? `${PANORAMAX_URL}/api/pictures/${encodeURIComponent(r.panoramax_id)}/sd.jpg` : null;

export function creditPage(lang: Lang, r: CreditRow): string {
  const t = T[lang];
  const target = r.evse_compact ?? r.station_id;
  const credit = r.credit ?? BRAND;
  const date = dateOf(r);
  const image = creditImage(r);
  const here = photoPath(lang, r.id);
  const stationHref = stationPath(lang, r.station_id) + (r.evse_compact ? socketAnchor(r.evse_compact) : '');
  const shows = r.evse_compact ? t.socket(r.evse_compact, r.station_id) : t.station(r.station_id);
  const deed = `https://creativecommons.org/licenses/by-sa/4.0/deed.${lang}`;
  const attribution = `© ${credit}, CC BY-SA 4.0, via ${BRAND}`;
  const pano = r.panoramax_id
    ? `${PANORAMAX_URL}/viewer?focus=map&map=19/${r.lat}/${r.lon}&pic=${encodeURIComponent(r.panoramax_id)}`
    : null;
  let osm = '';
  if (r.is_main && r.panoramax_id) {
    const edit = osmEditUrl(r);
    osm = `<section class="card" id="osm">
      <h2>${t.osmTitle}</h2>
      <p>${t.osmIntro}</p>
      <div class="label">${t.osmTag}</div>
      <div class="copy-row">
        <code id="osm-tag">panoramax=${esc(r.panoramax_id)}</code>
        <button type="button" class="copy" data-target="osm-tag" aria-label="${esc(t.copy)}">${ICON_COPY}${ICON_CHECK}</button>
      </div>
      <p id="copy-status" class="sr-only" role="status" data-copied="${esc(t.copied)}" data-failed="${esc(t.copyFailed)}"></p>
      <p><a target="_blank" rel="noopener" href="${esc(edit.url)}">${edit.element ? t.osmElement : t.osmPlace}</a></p>
      ${r.evse_compact ? `<p class="hint">${t.osmSocketNote}</p>` : ''}
    </section>`;
  }
  const body = `<div class="credit">
  <h1>${esc(t.title(target))}</h1>
  <p class="subtitle">${esc(shows)}${r.station_name ? ` · <span lang="pt-PT">${esc(r.station_name)}</span>` : ''}</p>
  <div class="columns">
    <section class="photos">
      ${image
        ? `<figure class="main-photo"><img src="${esc(image)}" alt="${esc(t.alt(target))}"></figure>`
        : ''}
    </section>
    <div class="side">
      <section class="card">
        <dl class="facts">
          <dt>${t.credit}</dt><dd><span lang="">${esc(credit)}</span></dd>
          <dt>${t.date}</dt><dd>${date ? `<time datetime="${esc(date)}">${esc(date)}</time>` : t.unknownDate}</dd>
          <dt>${t.licence}</dt><dd><a href="${deed}" rel="license">${t.licenceText}</a></dd>
          <dt>${t.shows}</dt><dd><a href="${esc(stationHref)}">${esc(shows)}</a></dd>
        </dl>
        <p>${t.reuse}</p>
        <p><code>${esc(attribution)}</code></p>
        <ul class="plain-list">
          <li><a href="${esc(stationHref)}">${t.stationPage}</a></li>
          ${pano ? `<li><a target="_blank" rel="noopener" href="${esc(pano)}">${t.panoramax}</a></li>` : ''}
          <li><a href="${lang === 'pt' ? '/report' : '/en/report'}?alvo=${encodeURIComponent(target)}" rel="nofollow">${t.report}</a></li>
        </ul>
      </section>
      ${osm}
    </div>
  </div>
</div>`;
  return layout({
    lang,
    title: `${t.title(target)} · ${BRAND}`,
    description: t.desc(credit, target),
    path: here,
    alternates: { pt: photoPath('pt', r.id), en: photoPath('en', r.id) },
    body,
    script: Boolean(osm),
    image: image ? { url: image, alt: `${t.alt(target)} · ${attribution}` } : undefined,
  });
}
