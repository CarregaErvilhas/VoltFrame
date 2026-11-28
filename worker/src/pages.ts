// Server-rendered HTML pages, in European Portuguese and in English. Pure
// functions of the rows (no Env), so they can be tested under Node. Every
// string from the database is third-party text (NAP names, addresses,
// operators): it only reaches the markup through esc(). That text is
// Portuguese whatever the page language, and English pages mark it as such
// (lang="pt-PT") so screen readers read it with the right voice.
import { MAX_QUERY, underConstruction, type EvseMatch, type ExternalPhoto, type MainPhotos, type OwnPhoto, type PointRow, type RecentStation, type SearchRow, type StationRow } from './types.ts';
import { MEDALS, POINTS, SAME_TARGET_DAYS, type Medal, type RankingRow } from './points.ts';

// The brand as written. The apostrophes keep it out of every technical name
// (olhaoposto, or OlhaOPosto where case shows, so it is not read as Olhão),
// and screen readers get the spelled-out name.
export const BRAND = "olh'o'posto";
export const BRAND_SPOKEN = 'Olha o posto';
export const SITE = 'https://olhaoposto.ocarroeletrico.com';
export const PICTURES = 'https://pictures.ocarroeletrico.com';

// A static link as our own pages show it: with the main photo's id in the
// query. The link itself never changes, so a browser that saw the old photo
// would keep it for a day (max-age); a new query makes it fetch the new one.
// The Cache Rule leaves the query out of the edge's key, so this costs no R2
// read. Links meant to be copied stay without it.
export const shownPicture = (target: string, suffix: '' | '.thumb' | '.full', photoId?: string | null) =>
  `${PICTURES}/${encodeURIComponent(target)}${suffix}.jpg${photoId ? `?v=${encodeURIComponent(photoId.slice(0, 8))}` : ''}`;
export const PANORAMAX_URL = 'https://panoramax.ocarroeletrico.com';
export const NAP_DASHBOARD = 'https://nap.ocarroeletrico.com';

export type Lang = 'pt' | 'en';
export const LANGS: readonly Lang[] = ['pt', 'en'];
const HTML_LANG: Record<Lang, string> = { pt: 'pt-PT', en: 'en' };
const OG_LOCALE: Record<Lang, string> = { pt: 'pt_PT', en: 'en_GB' };
const NUMBER_LOCALE: Record<Lang, string> = { pt: 'pt-PT', en: 'en-GB' };

// The pt-PT URLs came first and never change; English lives under /en/.
export const homePath = (lang: Lang) => (lang === 'pt' ? '/' : '/en/');
export const stationPath = (lang: Lang, id: string) =>
  `${lang === 'pt' ? '/postos/' : '/en/stations/'}${encodeURIComponent(id)}`;
export const socketPath = (lang: Lang, evse: string) =>
  `${lang === 'pt' ? '/tomadas/' : '/en/sockets/'}${encodeURIComponent(evse)}`;
// The moderators' page with every photo of a station (src/stationadmin.ts).
export const stationAdminPath = (lang: Lang, id: string) =>
  `${lang === 'pt' ? '/admin/posto/' : '/en/admin/station/'}${encodeURIComponent(id)}`;
export const photoPath = (lang: Lang, id: string) => `${lang === 'pt' ? '/p/' : '/en/p/'}${encodeURIComponent(id)}`;
export const searchPath = (lang: Lang) => (lang === 'pt' ? '/pesquisa' : '/en/search');
export const privacyPath = (lang: Lang) => (lang === 'pt' ? '/privacidade' : '/en/privacy');
export const termsPath = (lang: Lang) => (lang === 'pt' ? '/condicoes' : '/en/terms');
export const groupPath = (lang: Lang) => (lang === 'pt' ? '/grupo' : '/en/group');
export const accountPath = (lang: Lang) => (lang === 'pt' ? '/conta' : '/en/account');
export const uploadPath = (lang: Lang) => (lang === 'pt' ? '/enviar' : '/en/upload');
export const withoutPhotoPath = (lang: Lang) => (lang === 'pt' ? '/postos/sem-foto' : '/en/stations/without-photo');
export const rankingPath = (lang: Lang) => (lang === 'pt' ? '/ranking' : '/en/ranking');
export const socketAnchor =(compact: string) => `#t-${encodeURIComponent(compact)}`;

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "Instalar app" (public/install.js): the steps for one kind of browser. `after`
// is a closing note; on the in-app block it introduces the link to copy.
interface InstallSteps { before: string[]; steps: string[]; after: string | null }

const T = {
  pt: {
    other: 'English',
    theme: 'Tema',
    themeAuto: 'Automático',
    themeLight: 'Claro',
    themeDark: 'Escuro',
    footerData: 'Fotos CC BY-SA 4.0 · Dados dos postos: NAP Portugal (MOBI.E) e © contribuidores do OpenStreetMap (ODbL)',
    footerCode: 'Código (MIT)',
    footerPrivacy: 'Privacidade',
    footerTerms: 'Condições',
    footerGroup: 'O grupo',
    installOpen: 'Instalar app',
    installBarTitle: 'olh\'o\'posto como app',
    installBarText: 'No ecrã principal, sem lojas nem downloads.',
    installBarAdd: 'Instalar',
    installLater: 'Agora não',
    installTitle: 'Instalar o olh\'o\'posto',
    installLede: 'Não há nada para descarregar: fica um ícone no ecrã principal e o site abre em ecrã inteiro, como as outras apps. Dá jeito para fotografar um posto quando estás lá.',
    installCopy: 'Copiar link',
    installCopied: 'Copiado',
    installClose: 'Fechar',
    installSteps: {
      'ios-safari': { before: [], steps: ['Toca em Partilhar <svg class="install-glyph" aria-hidden="true"><use href="#i-share"/></svg> na barra do Safari. Se não o vires, toca primeiro em ⋯.', 'Escolhe «Adicionar ao ecrã principal» (se não aparecer, desliza a lista para cima).', 'Toca em «Adicionar».'], after: 'Abriste o link dentro de outra app (WhatsApp, Gmail…)? Toca no ícone do Safari, em baixo, para abrir lá, e repete.' },
      'ios-other': { before: [], steps: ['Toca em Partilhar <svg class="install-glyph" aria-hidden="true"><use href="#i-share"/></svg>: está na barra de endereço ou no menu do browser (⋯ ou ☰).', 'Escolhe «Adicionar ao ecrã principal» e depois «Adicionar».'], after: 'Não encontras a opção? Abre esta página no Safari e repete.' },
      'in-app': { before: ['Estás no browser de outra app (Facebook, Instagram, Messenger…), que não instala sites.'], steps: ['Toca em ⋯ ou ⋮, em cima, e escolhe abrir no browser (Safari ou Chrome).', 'Lá, toca outra vez em «Instalar app», no fim da página.'], after: 'Ou copia o link e cola-o no browser:' },
      'android-firefox': { before: [], steps: ['Toca no menu ⋮ do Firefox.', 'Escolhe «Instalar» ou «Adicionar ao ecrã principal».', 'Confirma.'], after: null },
      'samsung': { before: [], steps: ['Se a barra de endereço mostrar o ícone de instalar, toca nele.', 'Senão, abre o menu ≡ (em baixo) e adiciona a página ao ecrã principal.'], after: null },
      'android': { before: [], steps: ['Toca no menu do browser (⋮, em cima à direita).', 'Escolhe «Instalar app» ou «Adicionar ao ecrã principal».', 'Confirma.'], after: 'Abriste o link dentro de outra app e o menu só deixa abrir no browser? Abre-o lá e repete.' },
      'desktop': { before: [], steps: ['Chrome e Edge: clica no ícone de instalar, à direita na barra de endereço.', 'Safari no Mac: menu Ficheiro → «Adicionar à Dock».', 'Firefox: se a tua versão não tiver a opção, usa um dos outros.'], after: 'No telemóvel é igual: abre o site lá e toca em «Instalar app».' },
    } as Record<string, InstallSteps>,
    ogImageAlt: `Pic, a mascote do ${BRAND}`,
    inNap: 'No NAP',
    outNap: 'Fora do NAP',
    sockets: (n: number) => (n === 1 ? '1 tomada' : `${n} tomadas`),
    noPhotos: 'Sem fotos',
    missingNotice: 'Este posto deixou de aparecer no NAP. Fica aqui com as fotos que tiver, mas pode já não existir.',
    building: 'Em construção (OSM)',
    buildingGone: 'Fora da lista de obras do OSM',
    buildingNotice: 'Em construção segundo o OpenStreetMap: ainda não está no NAP e pode ainda não carregar. As fotos aprovadas ficam aqui e passam para o posto do NAP quando ele aparecer. Até lá não há link estático nem tomadas.',
    buildingGoneNotice: 'Este posto saiu da lista de obras que vem do OpenStreetMap, e não se juntou a nenhum posto do NAP. Pode já ter aberto, a obra pode ter parado, ou o mapa mudou. Fica aqui com as fotos que tiver.',
    buildingCodes: 'Códigos MOBI.E no OSM:',
    ownHeading: 'Fotos enviadas',
    moreHeading: 'Outras fotos',
    sendMore: 'Enviar outra foto',
    ownAlt: (id: string, n: number) => `Foto ${n} do posto ${id}`,
    photosHeading: 'Fotos do posto',
    emptyTitle: 'Ainda não há fotos deste posto',
    emptySend: 'Envia a primeira',
    hasPhoto: 'Com foto',
    photoBy: 'Foto:',
    externalHeading: 'Noutras fontes',
    externalIntro: 'Fotos que outras pessoas puseram no OpenStreetMap (Panoramax, Wikimedia Commons). Ficam na origem, com o autor e a licença deles; não são a foto principal nem têm link estático.',
    externalAlt: (id: string, n: number) => `Foto ${n} do posto ${id} noutra fonte`,
    externalOrigin: { osm_panoramax: 'Panoramax', commons: 'Wikimedia Commons' } as Record<string, string>,
    externalSource: 'Ver na origem',
    externalMark: 'Externa',
    creditAlt: (code: string) => `Foto da tomada ${code}: ver o crédito`,
    askRemoval: 'Pedir remoção',
    photoAlt: (id: string) => `Foto principal do posto ${id}`,
    hint: 'A foto principal é escolhida pela comunidade. O link estático continua o mesmo quando ela muda.',
    linksTitle: 'Links estáticos',
    linksIntro: 'Para apps, mapas e o OSM. Devolvem 404 enquanto não houver foto principal.',
    size: 'Tamanho',
    stationLabel: 'Posto',
    copyStation: 'Copiar link: posto',
    copySocket: (code: string) => `Copiar link: tomada ${code}`,
    copied: 'Copiado.',
    copyFailed: 'Não foi possível copiar. O texto ficou selecionado: copia-o à mão.',
    socketsTitle: 'Tomadas',
    socketsIntro: 'Cada tomada com código EVSE tem o seu link.',
    noPhoto: 'sem foto',
    noEvse: 'Sem código EVSE no NAP: sem link de tomada',
    socketMore: 'Outras fotos desta tomada',
    platesHeading: 'Chapas',
    platesIntro: 'As placas de características dos carregadores: modelo, número de série, tensão, corrente e potência. Não são a foto principal nem têm link estático.',
    moderate: 'Moderar as fotos deste posto',
    socketSend: 'Enviar foto desta tomada',
    socketSendMore: 'Enviar outra foto desta tomada',
    socketGone: 'já não está no NAP',
    unknownPlug: 'Ficha desconhecida',
    osmTitle: 'No OpenStreetMap',
    osmLinked: (el: string) => `Ligado ao elemento ${el}.`,
    osmView: 'Ver no OpenStreetMap',
    osmNone: 'Ainda não está ligado a um elemento do OpenStreetMap.',
    osmMap: 'Ver o sítio no mapa',
    osmAddTitle: 'Acrescentar a foto principal ao OSM',
    osmAddIntro: 'Copia a etiqueta e cola-a no elemento do posto, no editor. À mão: não há bots nem edições automáticas.',
    osmAddPlaceNote: 'O posto ainda não está ligado a um elemento: procura-o no mapa ou cria-o.',
    osmTag: 'Etiqueta',
    copyTag: 'Copiar etiqueta',
    osmEditElement: 'Abrir o elemento no editor iD',
    osmEditPlace: 'Abrir o sítio no editor iD',
    alsoTitle: 'Ver também',
    alsoNap: 'Preços e estado das tomadas no NAP dashboard',
    alsoPano: 'A foto principal no mapa do Panoramax',
    dataTitle: 'Dados',
    dataJson: 'Em JSON, pela API',
    unknownOperator: 'Operador desconhecido',
    stationDesc: (id: string, operator: string | null, town: string | null) =>
      `Fotos e links estáticos do posto de carregamento ${id}${operator ? ` (${operator})` : ''}${town ? `, ${town}` : ''}.`,
    choiceTitle: (code: string) => `Tomada ${code}`,
    choiceDesc: (code: string) => `O código EVSE ${code} aparece em mais de um posto.`,
    choiceH1: 'Tomada em mais de um posto',
    choiceText: (code: string, n: number) => `O NAP publica o código ${code} em ${n} postos. Escolhe o certo:`,
    notFound: 'Não encontrado',
    notFoundDesc: 'Página não encontrada.',
    back: 'Voltar ao início',
    noStation: (id: string) => `Não há nenhum posto público com o código ${id}.`,
    noPublishedPhoto: (id: string) => `Não há nenhuma foto publicada com o código ${id}.`,
    noSocket: (code: string) => `Não há nenhuma tomada com o código EVSE ${code}.`,
    badStation: 'Código de posto inválido.',
    badSocket: 'Código EVSE inválido.',
    noPage: 'Esta página não existe.',
    homeTitle: `${BRAND} · fotos dos postos de carregamento`,
    homeDesc: 'Fotos comunitárias de postos e tomadas de carregamento em Portugal, com links estáticos pelo código do posto ou da tomada.',
    homeH1: 'Fotos dos postos de carregamento',
    homeText: 'Fotos comunitárias de postos e tomadas em Portugal, com um link estático por posto e por tomada. O envio de fotos está aberto: cada foto é desfocada no teu dispositivo e passa pela moderação.',
    homeExample: 'Exemplo:',
    homeExampleLink: 'posto EZC-AMD-00051',
    homeApi: 'API:',
    homeNoPhoto: 'Postos que ainda não têm foto',
    homeRecent: 'Últimos postos com fotos novas',
    and: 'e',
    searchLabel: 'Procurar um posto',
    searchHint: 'Código do posto ou da tomada, localidade, morada ou operador.',
    searchButton: 'Procurar',
    searchH1: 'Pesquisar postos',
    searchTitle: (q: string) => `Pesquisa: ${q}`,
    searchDesc: 'Pesquisa de postos de carregamento em Portugal por código, localidade, morada ou operador.',
    results: (n: number, q: string) => (n === 1 ? `1 posto para «${q}»` : `${n} postos para «${q}»`),
    resultsTop: (n: number, q: string) => `Primeiros ${n} postos para «${q}»`,
    resultsCapped: () => `Há mais resultados. Acrescenta palavras para afinar.`,
    noResults: (q: string) => `Nenhum posto encontrado para «${q}».`,
    noResultsTip: 'Experimenta o código do posto (EZC-AMD-00051), a localidade ou o operador.',
    tooShort: 'Escreve pelo menos duas letras ou dois números.',
    accountTitle: 'Conta',
    accountDesc: `Iniciar sessão no ${BRAND} com a conta OpenStreetMap.`,
    loginIntro: 'Para enviar fotos, inicia sessão com a tua conta OpenStreetMap. Só guardamos o número e o nome da conta no OSM, nunca o email.',
    loginButton: 'Iniciar sessão com o OpenStreetMap',
    loginOff: 'O início de sessão ainda não está disponível. Abre com o envio de fotos.',
    privacyLink: 'Como tratamos estes dados.',
    signedIn: 'Sessão iniciada como',
    roleLabel: 'Papel:',
    roles: {
      contributor: 'contribuidor (as fotos passam pela moderação antes de aparecerem)',
      trusted: 'de confiança (as fotos aparecem logo)',
      moderator: 'moderador',
      admin: 'administrador',
    } as Record<string, string>,
    logout: 'Terminar sessão',
    uploadLink: 'Enviar fotos',
    manageUsers: 'Gerir utilizadores e papéis',
    takedowns: 'Pedidos de remoção',
    withoutMain: 'Sem foto principal',
    missingStations: 'Postos fora do NAP',
    moderationQueue: 'Fila de moderação',
    loginErrors: {
      denied: 'O início de sessão foi cancelado no OpenStreetMap.',
      expired: 'O pedido expirou ou foi aberto noutro separador. Tenta outra vez.',
      failed: 'Não foi possível falar com o OpenStreetMap. Tenta outra vez daqui a pouco.',
    } as Record<string, string>,
  },
  en: {
    other: 'Português',
    theme: 'Theme',
    themeAuto: 'Automatic',
    themeLight: 'Light',
    themeDark: 'Dark',
    footerData: 'Photos CC BY-SA 4.0 · Station data: NAP Portugal (MOBI.E) and © OpenStreetMap contributors (ODbL)',
    footerCode: 'Source code (MIT)',
    footerPrivacy: 'Privacy',
    footerTerms: 'Terms',
    footerGroup: 'The group',
    installOpen: 'Install app',
    installBarTitle: 'olh\'o\'posto as an app',
    installBarText: 'On your home screen, no app store, no download.',
    installBarAdd: 'Install',
    installLater: 'Not now',
    installTitle: 'Install olh\'o\'posto',
    installLede: 'Nothing to download: you get an icon on your home screen and the site opens full screen, like your other apps. Handy for photographing a charger while you are there.',
    installCopy: 'Copy link',
    installCopied: 'Copied',
    installClose: 'Close',
    installSteps: {
      'ios-safari': { before: [], steps: ['Tap Share <svg class="install-glyph" aria-hidden="true"><use href="#i-share"/></svg> in Safari’s toolbar. If you can’t see it, tap ⋯ first.', 'Choose “Add to Home Screen” (scroll the list up if it isn’t there).', 'Tap “Add”.'], after: 'Opened the link inside another app (WhatsApp, Gmail…)? Tap the Safari icon at the bottom to open it there, then try again.' },
      'ios-other': { before: [], steps: ['Tap Share <svg class="install-glyph" aria-hidden="true"><use href="#i-share"/></svg>: it’s in the address bar or in the browser’s menu (⋯ or ☰).', 'Choose “Add to Home Screen”, then “Add”.'], after: 'Can’t find it? Open this page in Safari and try again.' },
      'in-app': { before: ['You’re in another app’s browser (Facebook, Instagram, Messenger…), which can’t install sites.'], steps: ['Tap ⋯ or ⋮ at the top and open the page in your browser (Safari or Chrome).', 'There, tap “Install app” again, at the bottom of the page.'], after: 'Or copy the link and paste it into your browser:' },
      'android-firefox': { before: [], steps: ['Tap Firefox’s ⋮ menu.', 'Choose “Install” or “Add to Home screen”.', 'Confirm.'], after: null },
      'samsung': { before: [], steps: ['If the address bar shows an install icon, tap it.', 'Otherwise open the ≡ menu (at the bottom) and add the page to the Home screen.'], after: null },
      'android': { before: [], steps: ['Tap the browser menu (⋮, top right).', 'Choose “Install app” or “Add to Home screen”.', 'Confirm.'], after: 'Opened the link inside another app and the menu only offers to open it in the browser? Do that, then try again.' },
      'desktop': { before: [], steps: ['Chrome and Edge: click the install icon at the right of the address bar.', 'Safari on a Mac: File menu → “Add to Dock”.', 'Firefox: if your version lacks the option, use one of the others.'], after: 'On your phone it’s the same: open the site there and tap “Install app”.' },
    } as Record<string, InstallSteps>,
    ogImageAlt: `Pic, the ${BRAND} mascot`,
    inNap: 'In the NAP',
    outNap: 'Not in the NAP',
    sockets: (n: number) => (n === 1 ? '1 socket' : `${n} sockets`),
    noPhotos: 'No photos',
    missingNotice: 'This station no longer appears in the NAP. It stays here with any photos it has, but it may no longer exist.',
    building: 'Under construction (OSM)',
    buildingGone: 'Off the OSM works list',
    buildingNotice: 'Under construction according to OpenStreetMap: not in the NAP yet, and it may not charge yet. Approved photos stay here and move to the NAP station when it shows up. Until then there is no static link and no sockets.',
    buildingGoneNotice: 'This station left the list of building sites that comes from OpenStreetMap, and did not merge into any NAP station. It may have opened, the works may have stopped, or the map changed. It stays here with any photos it has.',
    buildingCodes: 'MOBI.E codes in OSM:',
    ownHeading: 'Photos sent',
    moreHeading: 'More photos',
    sendMore: 'Send another photo',
    ownAlt: (id: string, n: number) => `Photo ${n} of station ${id}`,
    photosHeading: 'Station photos',
    emptyTitle: 'No photos of this station yet',
    emptySend: 'Send the first one',
    hasPhoto: 'Has a photo',
    photoBy: 'Photo:',
    externalHeading: 'From other sources',
    externalIntro: 'Photos other people added to OpenStreetMap (Panoramax, Wikimedia Commons). They stay at their source, with their author and licence; they are not the main photo and have no static link.',
    externalAlt: (id: string, n: number) => `Photo ${n} of station ${id} from another source`,
    externalOrigin: { osm_panoramax: 'Panoramax', commons: 'Wikimedia Commons' } as Record<string, string>,
    externalSource: 'View at the source',
    externalMark: 'External',
    creditAlt: (code: string) => `Photo of socket ${code}: see the credit`,
    askRemoval: 'Ask for removal',
    photoAlt: (id: string) => `Main photo of station ${id}`,
    hint: 'The community picks the main photo. The static link stays the same when it changes.',
    linksTitle: 'Static links',
    linksIntro: 'For apps, maps and OSM. They return 404 until there is a main photo.',
    size: 'Size',
    stationLabel: 'Station',
    copyStation: 'Copy link: station',
    copySocket: (code: string) => `Copy link: socket ${code}`,
    copied: 'Copied.',
    copyFailed: 'Couldn’t copy. The text is selected: copy it by hand.',
    socketsTitle: 'Sockets',
    socketsIntro: 'Each socket with an EVSE code has its own link.',
    noPhoto: 'no photo',
    noEvse: 'No EVSE code in the NAP: no socket link',
    socketMore: 'More photos of this socket',
    platesHeading: 'Rating plates',
    platesIntro: 'The chargers’ rating plates: model, serial number, voltage, current and power. They are never the main photo and have no static link.',
    moderate: 'Moderate the photos of this station',
    socketSend: 'Send a photo of this socket',
    socketSendMore: 'Send another photo of this socket',
    socketGone: 'no longer in the NAP',
    unknownPlug: 'Unknown connector',
    osmTitle: 'On OpenStreetMap',
    osmLinked: (el: string) => `Linked to the element ${el}.`,
    osmView: 'View on OpenStreetMap',
    osmNone: 'Not linked to an OpenStreetMap element yet.',
    osmMap: 'Show on map',
    osmAddTitle: 'Add the main photo to OSM',
    osmAddIntro: 'Copy the tag and paste it on the station’s element in the editor. By hand: no bots and no automatic edits.',
    osmAddPlaceNote: 'The station is not linked to an element yet: find it on the map or create it.',
    osmTag: 'Tag',
    copyTag: 'Copy tag',
    osmEditElement: 'Open the element in the iD editor',
    osmEditPlace: 'Open the place in the iD editor',
    alsoTitle: 'See also',
    alsoNap: 'Prices and socket status on the NAP dashboard',
    alsoPano: 'The main photo on the Panoramax map',
    dataTitle: 'Data',
    dataJson: 'As JSON, from the API',
    unknownOperator: 'Unknown operator',
    stationDesc: (id: string, operator: string | null, town: string | null) =>
      `Photos and static links for the charging station ${id}${operator ? ` (${operator})` : ''}${town ? `, ${town}` : ''}.`,
    choiceTitle: (code: string) => `Socket ${code}`,
    choiceDesc: (code: string) => `The EVSE code ${code} appears at more than one station.`,
    choiceH1: 'Socket at more than one station',
    choiceText: (code: string, n: number) => `The NAP lists the code ${code} at ${n} stations. Pick the right one:`,
    notFound: 'Not found',
    notFoundDesc: 'Page not found.',
    back: 'Back to home',
    noStation: (id: string) => `There is no public station with the code ${id}.`,
    noPublishedPhoto: (id: string) => `There is no published photo with the code ${id}.`,
    noSocket: (code: string) => `There is no socket with the EVSE code ${code}.`,
    badStation: 'Invalid station code.',
    badSocket: 'Invalid EVSE code.',
    noPage: 'This page does not exist.',
    homeTitle: `${BRAND} · photos of charging stations`,
    homeDesc: 'Community photos of EV charging stations and sockets in Portugal, with static links by station or socket code.',
    homeH1: 'Photos of charging stations',
    homeText: 'Community photos of charging stations and sockets in Portugal, with one static link per station and per socket. Photo uploads are open: each photo is blurred on your device and moderated.',
    homeExample: 'Example:',
    homeExampleLink: 'station EZC-AMD-00051',
    homeApi: 'API:',
    homeNoPhoto: 'Stations that still have no photo',
    homeRecent: 'Latest stations with new photos',
    and: 'and',
    searchLabel: 'Find a station',
    searchHint: 'Station or socket code, town, address or operator.',
    searchButton: 'Search',
    searchH1: 'Search stations',
    searchTitle: (q: string) => `Search: ${q}`,
    searchDesc: 'Search EV charging stations in Portugal by code, town, address or operator.',
    results: (n: number, q: string) => (n === 1 ? `1 station for “${q}”` : `${n} stations for “${q}”`),
    resultsTop: (n: number, q: string) => `First ${n} stations for “${q}”`,
    resultsCapped: () => `There are more results. Add words to narrow it down.`,
    noResults: (q: string) => `No stations found for “${q}”.`,
    noResultsTip: 'Try the station code (EZC-AMD-00051), the town or the operator.',
    tooShort: 'Type at least two letters or numbers.',
    accountTitle: 'Account',
    accountDesc: `Sign in to ${BRAND} with your OpenStreetMap account.`,
    loginIntro: 'To upload photos, sign in with your OpenStreetMap account. We only keep the account number and name on OSM, never your email.',
    loginButton: 'Sign in with OpenStreetMap',
    loginOff: 'Signing in is not available yet. It opens with photo uploads.',
    privacyLink: 'How we handle this data.',
    signedIn: 'Signed in as',
    roleLabel: 'Role:',
    roles: {
      contributor: 'contributor (photos are moderated before they appear)',
      trusted: 'trusted (photos appear straight away)',
      moderator: 'moderator',
      admin: 'administrator',
    } as Record<string, string>,
    logout: 'Sign out',
    uploadLink: 'Upload photos',
    manageUsers: 'Manage users and roles',
    takedowns: 'Removal requests',
    withoutMain: 'Without a main photo',
    missingStations: 'Stations missing from the NAP',
    moderationQueue: 'Moderation queue',
    loginErrors: {
      denied: 'Signing in was cancelled on OpenStreetMap.',
      expired: 'The request expired or was opened in another tab. Try again.',
      failed: 'Could not reach OpenStreetMap. Try again in a little while.',
    } as Record<string, string>,
  },
} satisfies Record<Lang, unknown>;

export type Messages = typeof T.pt;
export const messages = (lang: Lang): Messages => T[lang];

const CONNECTORS: Record<Lang, Record<string, string>> = {
  pt: {
    T2: 'Tipo 2',
    CCS: 'CCS',
    CHADEMO: 'CHAdeMO',
    iec60309x2single16: 'CEE 16 A (industrial)',
    domesticF: 'Doméstica (Schuko)',
    domesticG: 'Doméstica tipo G',
  },
  en: {
    T2: 'Type 2',
    CCS: 'CCS',
    CHADEMO: 'CHAdeMO',
    iec60309x2single16: 'CEE 16 A (industrial)',
    domesticF: 'Domestic (Schuko)',
    domesticG: 'Domestic type G',
  },
};

const REGIONS: Record<Lang, Record<string, string>> = {
  pt: { CONT: 'Portugal continental', AZO: 'Açores', MAD: 'Madeira' },
  en: { CONT: 'Mainland Portugal', AZO: 'Azores', MAD: 'Madeira' },
};

const kw = (lang: Lang, v: number | null) =>
  v === null ? null : `${v.toLocaleString(NUMBER_LOCALE[lang], { maximumFractionDigits: 1 })} kW`;

const plug = (lang: Lang, c: string | null) => (c ? CONNECTORS[lang][c] ?? c : T[lang].unknownPlug);

// NAP text on an English page: escaped, and marked as Portuguese.
export const nap = (lang: Lang, v: string) => (lang === 'pt' ? esc(v) : `<span lang="pt-PT">${esc(v)}</span>`);

// OSM elements as the import stores them (node/123). Anything else is not linked.
const OSM_ELEMENT = /^(node|way|relation)\/(\d+)$/;

// The iD editor on the element if we know it, or on the position. A socket's
// photo always opens on the position: the NAP does not tell us which OSM
// element is the socket (only the station's, if linked).
export function osmEditUrl(row: { evse_compact: string | null; osm_ref: string | null; lat: number; lon: number }): { url: string; element: boolean } {
  const m = !row.evse_compact && row.osm_ref ? OSM_ELEMENT.exec(row.osm_ref) : null;
  if (m) return { url: `https://www.openstreetmap.org/edit?editor=id&${m[1]}=${m[2]}`, element: true };
  return { url: `https://www.openstreetmap.org/edit?editor=id#map=19/${row.lat}/${row.lon}`, element: false };
}

const ICON_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>';
const ICON_COPY = '<svg class="idle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>';
// Shown after a copy, so success is a shape change and not only a colour change.
const ICON_CHECK = '<svg class="done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

interface Layout {
  lang: Lang;
  title: string;
  description: string;
  // Path of this page when it should be indexed: gives the canonical and og:url.
  path?: string;
  // The same page in each language, for hreflang and the language link.
  alternates?: Record<Lang, string>;
  // Where the language link goes when it is not an alternate (a search keeps its words).
  switchTo?: Record<Lang, string>;
  noindex?: boolean;
  body: string;
  script?: boolean;
  // A page-specific ES module from public/.
  module?: string;
  // schema.org JSON-LD, already serialised with < escaped.
  jsonld?: string;
  // The page's photo for link previews (Open Graph): the mascot when absent.
  image?: { url: string; alt: string };
}

// "Instalar app" (public/install.js shows what fits): a footer button, a banner
// for phones and the dialog with the steps for each kind of browser.
function installMarkup(t: typeof T.pt): string {
  const blocks = Object.entries(t.installSteps).map(([hint, b]) => {
    const tag = hint === 'desktop' ? 'ul' : 'ol';
    const list = `<${tag} class="${hint === 'desktop' ? 'install-list' : 'install-steps'}">${b.steps.map((x) => `<li>${x}</li>`).join('')}</${tag}>`;
    const before = b.before.map((x) => `<p class="install-note">${x}</p>`).join('');
    const after = b.after ? `<p class="install-note">${b.after}</p>` : '';
    const copy = hint === 'in-app'
      ? `<p class="install-copy"><code data-install-url></code> <button class="install-btn" type="button" data-install-copy data-copied="${esc(t.installCopied)}">${t.installCopy}</button></p>`
      : '';
    return `  <div data-install-hint="${hint}" hidden>${before}${list}${after}${copy}</div>`;
  });
  return `<div class="install-bar" id="install-bar" data-install-key="oop-install" hidden>
  <img src="/icon-192.png" alt="" width="44" height="44">
  <p><strong>${t.installBarTitle}</strong> <span>${t.installBarText}</span></p>
  <button class="install-btn primary" type="button" data-install-open>${t.installBarAdd}</button>
  <button class="install-x" type="button" data-install-dismiss aria-label="${esc(t.installLater)}">×</button>
</div>
<dialog class="install-dlg" id="install-dialog" closedby="any" aria-labelledby="install-title">
  <svg hidden><symbol id="i-share" viewBox="0 0 24 24"><path d="M12 14V3M8 7l4-4 4 4M7 10H5v11h14V10h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>
  <div class="install-tile" aria-hidden="true"><img src="/icon-192.png" alt="" width="64" height="64"><span>${BRAND}</span></div>
  <h2 id="install-title">${t.installTitle}</h2>
  <p class="install-lede">${t.installLede}</p>
${blocks.join('\n')}
  <p class="install-actions"><button class="install-btn" type="button" data-install-close>${t.installClose}</button></p>
</dialog>`;
}

export function layout(p: Layout): string {
  const t = T[p.lang];
  const other: Lang = p.lang === 'pt' ? 'en' : 'pt';
  const otherHref = p.switchTo?.[other] ?? p.alternates?.[other] ?? homePath(other);
  const head: string[] = [];
  if (p.noindex) head.push('<meta name="robots" content="noindex">');
  if (p.path) head.push(`<link rel="canonical" href="${esc(SITE + p.path)}">`);
  if (p.alternates) {
    for (const l of LANGS) head.push(`<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${esc(SITE + p.alternates[l])}">`);
    head.push(`<link rel="alternate" hreflang="x-default" href="${esc(SITE + p.alternates.pt)}">`);
  }
  head.push(
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.description)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[p.lang]}">`,
    `<meta property="og:locale:alternate" content="${OG_LOCALE[other]}">`,
    `<meta property="og:image" content="${esc(p.image?.url ?? `${SITE}/icon-512.png`)}">`,
    `<meta property="og:image:alt" content="${esc(p.image?.alt ?? t.ogImageAlt)}">`,
    // A photo gets the large card; the square mascot stays small.
    `<meta name="twitter:card" content="${p.image ? 'summary_large_image' : 'summary'}">`,
  );
  if (p.path) head.push(`<meta property="og:url" content="${esc(SITE + p.path)}">`);
  if (p.jsonld) head.push(`<script type="application/ld+json">${p.jsonld}</script>`);
  return `<!doctype html>
<html lang="${HTML_LANG[p.lang]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="text-scale" content="scale">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
${head.join('\n')}
<link rel="stylesheet" href="/site.css">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="apple-mobile-web-app-title" content="${BRAND}">
<meta name="theme-color" content="#F2B33D">
<script src="/theme.js"></script>
<script src="/install.js" defer></script>
${p.script ? '<script src="/site.js" defer></script>\n' : ''}${p.module ? `<script type="module" src="${esc(p.module)}"></script>\n` : ''}</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${homePath(p.lang)}">
      <img src="/pic-icon.svg" alt="" width="34" height="34">
      <span class="brand-name"><span aria-hidden="true">${BRAND}</span><span class="sr-only" lang="pt-PT">${BRAND_SPOKEN}</span></span>
    </a>
    <a class="header-link" href="${uploadPath(p.lang)}">${t.uploadLink}</a>
    <a class="header-link" href="${accountPath(p.lang)}">${t.accountTitle}</a>
    <div class="theme" hidden>
      <label for="theme">${t.theme}</label>
      <select id="theme">
        <option value="auto">${t.themeAuto}</option>
        <option value="light">${t.themeLight}</option>
        <option value="dark">${t.themeDark}</option>
      </select>
    </div>
    <a class="lang-switch" href="${esc(otherHref)}" hreflang="${HTML_LANG[other]}" lang="${HTML_LANG[other]}">${t.other}</a>
  </div>
</header>
<main>
<div class="wrap">
${p.body}
</div>
</main>
<footer class="site-footer">
  <div class="wrap">
    <span>${t.footerData}</span>
    <a href="${privacyPath(p.lang)}">${t.footerPrivacy}</a>
    <a href="${termsPath(p.lang)}">${t.footerTerms}</a>
    <a href="${groupPath(p.lang)}">${t.footerGroup}</a>
    <a target="_blank" rel="noopener" href="https://github.com/CarregaErvilhas/OlhaOPosto">${t.footerCode}</a>
    <button class="linkbtn" type="button" data-install-open>${t.installOpen}</button>
  </div>
</footer>
${installMarkup(t)}
</body>
</html>
`;
}

function copyRow(id: string, base: string, label: string): string {
  return `<div class="copy-row">
          <code id="${esc(id)}" data-base="${esc(base)}">${esc(base)}.jpg</code>
          <button type="button" class="copy" data-target="${esc(id)}" aria-label="${esc(label)}">${ICON_COPY}${ICON_CHECK}</button>
        </div>`;
}

// Text to copy as it is (no size suffix: no data-base).
function tagRow(id: string, text: string, label: string): string {
  return `<div class="copy-row">
          <code id="${esc(id)}">${esc(text)}</code>
          <button type="button" class="copy" data-target="${esc(id)}" aria-label="${esc(label)}">${ICON_COPY}${ICON_CHECK}</button>
        </div>`;
}

// The thumbnail of a socket's main photo, linked to its credit page.
function thumb(lang: Lang, compact: string, main: MainPhotos[string]): string {
  const img = `<img class="thumb" src="${shownPicture(compact, '.thumb', main.photo_id)}" alt="${esc(T[lang].creditAlt(compact))}" loading="lazy">`;
  return main.photo_id ? `<a href="${photoPath(lang, main.photo_id)}">${img}</a>` : img;
}

function socketItem(lang: Lang, stationId: string, p: PointRow, i: number, main?: MainPhotos[string], others: OwnPhoto[] = []): string {
  const t = T[lang];
  // Its other photos, small, each linked to its credit page.
  const more = others.length
    ? `\n        <ul class="socket-more" role="list" aria-label="${esc(t.socketMore)}">${others.map((o, k) => `<li><a href="${photoPath(lang, o.id)}"><img src="${PANORAMAX_URL}/api/pictures/${encodeURIComponent(o.panoramax_id)}/thumb.jpg" alt="${esc(t.ownAlt(p.evse_id ?? p.point_id, k + 2))}" loading="lazy" referrerpolicy="no-referrer"></a></li>`).join('')}</ul>`
    : '';
  const anchor = p.evse_compact ? ` id="t-${esc(p.evse_compact)}"` : '';
  const meta = [plug(lang, p.connector), kw(lang, p.max_kw), p.dc ? 'DC' : 'AC'];
  if (p.status === 'missing_from_nap') meta.push(t.socketGone);
  const code = p.evse_id
    ? `<div class="code mono">${esc(p.evse_id)}</div>`
    : `<div class="code mono">${esc(p.point_id)}</div><div class="meta">${t.noEvse}</div>`;
  const link = p.evse_compact
    ? copyRow(`l-t${i}`, `${PICTURES}/${encodeURIComponent(p.evse_compact)}`, t.copySocket(p.evse_id ?? p.point_id))
      + `\n        <a class="send-socket" href="${uploadPath(lang)}?posto=${encodeURIComponent(stationId)}&amp;tomada=${encodeURIComponent(p.evse_compact)}">${main ? t.socketSendMore : t.socketSend}</a>`
    : '';
  return `<li class="socket"${anchor}>
      ${main && p.evse_compact
        ? thumb(lang, p.evse_compact, main)
        : `<div class="thumb" aria-hidden="true">${t.noPhoto}</div>`}
      <div class="info">
        ${code}
        <div class="meta">${esc(meta.filter(Boolean).join(' · '))}</div>
        ${link}${more}
      </div>
    </li>`;
}

// The licence as text, with a link when it is a Creative Commons one we can
// name. Third-party text: only through esc().
function licenseHtml(lang: Lang, license: string): string {
  const cc = /^CC[- ]BY(?:[- ](SA))?[- ](\d\.\d)$/i.exec(license.trim());
  if (!cc) return esc(license);
  const code = `by${cc[1] ? '-sa' : ''}`;
  return `<a href="https://creativecommons.org/licenses/${code}/${cc[2]}/deed.${lang === 'pt' ? 'pt' : 'en'}" rel="license noopener" target="_blank">${esc(license)}</a>`;
}

// Photos that live at their origin: a reference with author, licence and a
// link, clearly marked as external. They only ever show here, never as main.
function externalGallery(lang: Lang, stationId: string, photos: ExternalPhoto[]): string {
  if (!photos.length) return '';
  const t = T[lang];
  return `<section class="external" aria-labelledby="ext-h">
      <h2 id="ext-h">${t.externalHeading}</h2>
      <p class="hint">${t.externalIntro}</p>
      <ul class="external-list" role="list">
        ${photos.map((p, i) => `<li>
          <figure class="external-photo">
            <a target="_blank" rel="noopener noreferrer" href="${esc(p.source)}"><img src="${esc(p.thumb)}" alt="${esc(t.externalAlt(stationId, i + 1))}" loading="lazy" referrerpolicy="no-referrer"></a>
            <figcaption><span class="chip">${t.externalMark} · ${esc(t.externalOrigin[p.origin] ?? p.origin)}</span>
              <span>${t.photoBy} <span lang="">${esc(p.credit ?? '?')}</span> · ${licenseHtml(lang, p.license)}</span>
              <a target="_blank" rel="noopener noreferrer" href="${esc(p.source)}">${t.externalSource}</a></figcaption>
          </figure>
        </li>`).join('\n        ')}
      </ul>
    </section>`;
}

// Our published photos that are not a main photo (all of them, for a station
// under construction): Panoramax's thumbnail, linked to each photo's credit page.
function ownGallery(lang: Lang, stationId: string, photos: OwnPhoto[], heading = T[lang].ownHeading, key = 'own', intro = ''): string {
  if (!photos.length) return '';
  const t = T[lang];
  return `<section class="external" aria-labelledby="${key}-h">
      <h2 id="${key}-h">${heading}</h2>${intro ? `\n      <p class="hint">${intro}</p>` : ''}
      <ul class="external-list" role="list">
        ${photos.map((p, i) => `<li>
          <figure class="external-photo">
            <a href="${photoPath(lang, p.id)}"><img src="${PANORAMAX_URL}/api/pictures/${encodeURIComponent(p.panoramax_id)}/thumb.jpg" alt="${esc(t.ownAlt(stationId, i + 1))}" loading="lazy" referrerpolicy="no-referrer"></a>
            <figcaption><span>${t.photoBy} <a href="${photoPath(lang, p.id)}"><span lang="">${esc(p.credit ?? BRAND)}</span></a> · ${licenseHtml(lang, 'CC-BY-SA-4.0')}</span></figcaption>
          </figure>
        </li>`).join('\n        ')}
      </ul>
    </section>`;
}

export function stationPage(
  lang: Lang, s: StationRow, points: PointRow[], mains: MainPhotos = {}, externals: ExternalPhoto[] = [], own: OwnPhoto[] = [],
): string {
  const t = T[lang];
  const building = underConstruction(s);
  const missing = s.status === 'missing_from_nap';
  const main = mains[s.id];
  // Rating plates have their own gallery; the rest are photos of the station or a socket.
  const plates = own.filter((p) => p.kind === 'plate');
  const pics = own.filter((p) => p.kind !== 'plate');
  const place = [s.address, s.municipality].filter(Boolean).join(', ');
  const subtitle = [s.name, place].filter(Boolean).join(' · ');
  const region = s.region ? REGIONS[lang][s.region] ?? s.region : null;
  const operator = s.operator ?? s.opc;
  const osm = s.osm_ref && OSM_ELEMENT.test(s.osm_ref)
    ? `<p>${t.osmLinked(`<code>${esc(s.osm_ref)}</code>`)}</p>
        <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/${esc(s.osm_ref)}">${t.osmView}</a>`
    : `<p>${t.osmNone}</p>
        <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lon}#map=19/${s.lat}/${s.lon}">${t.osmMap}</a>`;
  // Only the current main photo goes to OSM (Docs/plan.md, *OSM*): its tag and
  // the iD editor, by hand.
  const edit = osmEditUrl({ evse_compact: null, osm_ref: s.osm_ref, lat: s.lat, lon: s.lon });
  const osmAdd = main?.panoramax_id
    ? `
      <h3>${t.osmAddTitle}</h3>
      <p>${t.osmAddIntro}</p>
      <div class="label">${t.osmTag}</div>
      ${tagRow('osm-tag', `panoramax=${main.panoramax_id}`, t.copyTag)}
      <p><a class="button" target="_blank" rel="noopener" href="${esc(edit.url)}">${edit.element ? t.osmEditElement : t.osmEditPlace}</a></p>
      ${edit.element ? '' : `<p class="hint">${t.osmAddPlaceNote}</p>`}`
    : '';
  // The NAP dashboard only lists what the NAP publishes today; the Panoramax
  // viewer opens on a photo, so it only gets a link once there is one.
  const also = [
    s.status === 'active' && s.code && !building
      ? `<li><a target="_blank" rel="noopener" href="${NAP_DASHBOARD}/?posto=${encodeURIComponent(s.code)}">${t.alsoNap}</a></li>`
      : '',
    main?.panoramax_id
      ? `<li><a target="_blank" rel="noopener" href="${PANORAMAX_URL}/viewer?focus=map&amp;map=19/${s.lat}/${s.lon}&amp;pic=${encodeURIComponent(main.panoramax_id)}">${t.alsoPano}</a></li>`
      : '',
  ].filter(Boolean);
  const operatorData = [s.operator ? nap(lang, s.operator) : null, s.opc ? `(${esc(s.opc)})` : null].filter(Boolean).join(' ');
  const body = `<p class="operator">${operator ? nap(lang, operator) : t.unknownOperator}</p>
<div class="title-row">
  <div>
    <h1>${esc(s.id)}</h1>
    ${subtitle ? `<p class="subtitle">${nap(lang, subtitle)}</p>` : ''}
  </div>
  <div class="chips">
    ${building
      ? `<span class="chip warn">${s.status === 'missing_from_osm' ? t.buildingGone : t.building}</span>`
      : missing ? `<span class="chip warn">${t.outNap}</span>` : `<span class="chip ok">${t.inNap}</span>`}
    ${building ? '' : `<span class="chip">${t.sockets(points.length)}</span>`}
    <span class="chip${main || pics.length ? ' ok' : ''}">${main || pics.length ? t.hasPhoto : t.noPhotos}</span>
  </div>
</div>
${missing ? `<p class="notice">${t.missingNotice}</p>\n` : ''}${building ? `<p class="notice">${s.status === 'missing_from_osm' ? t.buildingGoneNotice : t.buildingNotice}</p>\n` : ''}${building && s.codes ? `<p>${t.buildingCodes} ${s.codes.split(' ').map((c) => `<code>${esc(c)}</code>`).join(', ')}</p>\n` : ''}<div class="columns">
  <section class="photos">
    <h2 class="sr-only">${t.photosHeading}</h2>
    ${building && pics.length ? ownGallery(lang, s.id, pics) : main
      ? `<figure class="main-photo">
      <a href="${shownPicture(s.id, '.full', main.photo_id)}" target="_blank" rel="noopener"><img src="${shownPicture(s.id, '', main.photo_id)}" alt="${esc(t.photoAlt(s.id))}"></a>
      <figcaption>${t.photoBy} ${main.photo_id ? `<a href="${photoPath(lang, main.photo_id)}">` : ''}<span lang="">${esc(main.credit ?? BRAND)}</span>${main.photo_id ? '</a>' : ''} · <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.${lang === 'pt' ? 'pt' : 'en'}" rel="license noopener" target="_blank">CC BY-SA 4.0</a> · <a href="${lang === 'pt' ? '/report' : '/en/report'}?alvo=${encodeURIComponent(s.id)}" rel="nofollow">${t.askRemoval}</a></figcaption>
    </figure>`
      : `<div class="empty-photo">
      ${ICON_CAMERA}
      <strong>${t.emptyTitle}</strong>
      <a href="${uploadPath(lang)}?posto=${encodeURIComponent(s.id)}">${t.emptySend}</a>
    </div>`}
    ${building ? (pics.length ? `<p><a href="${uploadPath(lang)}?posto=${encodeURIComponent(s.id)}">${t.sendMore}</a></p>` : '') : `<p class="hint">${t.hint}</p>
    ${ownGallery(lang, s.id, pics.filter((p) => !p.evse_compact), t.moreHeading, 'more')}`}
    ${ownGallery(lang, s.id, plates, t.platesHeading, 'plates', t.platesIntro)}
    <p class="mod-link" hidden><a href="${stationAdminPath(lang, s.id)}">${t.moderate}</a></p>
    ${externalGallery(lang, s.id, externals)}
  </section>
  <div class="side">
    ${building ? '' : `<section class="card">
      <h2>${t.linksTitle}</h2>
      <p>${t.linksIntro}</p>
      <div class="sizes" role="group" aria-label="${t.size}">
        <button type="button" data-size="thumb" aria-pressed="false">400 px</button>
        <button type="button" data-size="main" aria-pressed="true">1024 px</button>
        <button type="button" data-size="full" aria-pressed="false">2048 px</button>
      </div>
      <div class="links">
        <div>
          <div class="label">${t.stationLabel}</div>
          ${copyRow('l-s', `${PICTURES}/${encodeURIComponent(s.id)}`, t.copyStation)}
        </div>
      </div>
      <p id="copy-status" class="sr-only" role="status" data-copied="${esc(t.copied)}" data-failed="${esc(t.copyFailed)}"></p>
    </section>
    <section class="card">
      <h2>${t.socketsTitle}</h2>
      <p>${t.socketsIntro}</p>
      <ul class="sockets" role="list">
    ${points.map((p, i) => socketItem(lang, s.id, p, i, p.evse_compact ? mains[p.evse_compact] : undefined, pics.filter((o) => p.evse_compact && o.evse_compact === p.evse_compact))).join('\n    ')}
      </ul>
    </section>`}
    <section class="card" id="osm">
      <h2>${t.osmTitle}</h2>
      ${osm}${osmAdd}
    </section>
    ${also.length ? `<section class="card">
      <h2>${t.alsoTitle}</h2>
      <ul class="also" role="list">
        ${also.join('\n        ')}
      </ul>
    </section>
    ` : ''}<section class="card">
      <h2>${t.dataTitle}</h2>
      <p>${operatorData}${region ? `${operatorData ? ' · ' : ''}${esc(region)}` : ''}</p>
      <a target="_blank" rel="noopener" href="/api/v1/stations/${encodeURIComponent(s.id)}">${t.dataJson}</a>
    </section>
  </div>
</div>`;
  return layout({
    lang,
    title: `${s.id}${s.name ? ` · ${s.name}` : ''} · ${BRAND}`,
    description: t.stationDesc(s.id, s.operator, s.municipality),
    path: stationPath(lang, s.id),
    alternates: { pt: stationPath('pt', s.id), en: stationPath('en', s.id) },
    // Its URL becomes a redirect once it merges into the NAP station.
    noindex: building,
    body,
    script: true,
    // A station being built has no static links yet.
    image: main && !building
      ? { url: shownPicture(s.id, '', main.photo_id), alt: `${t.photoAlt(s.id)} · © ${main.credit ?? BRAND}, CC BY-SA 4.0` }
      : undefined,
  });
}

export function evseChoicePage(lang: Lang, code: string, matches: EvseMatch[]): string {
  const t = T[lang];
  const items = matches.map((m) =>
    `<li><a href="${stationPath(lang, m.station_id)}${socketAnchor(m.evse_compact)}">${esc(m.station_id)}</a>` +
    `${m.name ? ` · ${nap(lang, m.name)}` : ''}${m.operator ? ` · ${nap(lang, m.operator)}` : ''}</li>`).join('\n  ');
  return layout({
    lang,
    title: `${t.choiceTitle(code)} · ${BRAND}`,
    description: t.choiceDesc(code),
    // A list of links to the real pages: no use in a search index.
    noindex: true,
    alternates: { pt: socketPath('pt', code), en: socketPath('en', code) },
    body: `<div class="page-msg">
<h1>${t.choiceH1}</h1>
<p>${t.choiceText(`<code>${esc(code)}</code>`, matches.length)}</p>
<ul class="plain-list">
  ${items}
</ul>
</div>`,
  });
}

export function notFoundPage(lang: Lang, what: string): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.notFound} · ${BRAND}`,
    description: t.notFoundDesc,
    body: `<div class="page-msg">
<h1>${t.notFound}</h1>
<p>${esc(what)}</p>
<p><a href="${homePath(lang)}">${t.back}</a></p>
</div>`,
  });
}

export interface AccountView {
  name: string;
  role: string;
}

// The only page that knows who is signed in. It is never cached, so the
// station and search pages can stay public and cacheable.
export function accountPage(
  lang: Lang,
  // sections: the signed-in parts that need D1 (points, tokens), from src/account.ts.
  p: { user: AccountView | null; enabled: boolean; error?: string; sections?: string },
): string {
  const t = T[lang];
  const here = accountPath(lang);
  const parts: string[] = [`<h1>${t.accountTitle}</h1>`];
  const err = p.error ? t.loginErrors[p.error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  if (p.user) {
    // The OSM name is the person's own text, in whatever language they chose.
    parts.push(
      `<p>${t.signedIn} <strong lang="">${esc(p.user.name)}</strong>.</p>`,
      `<p>${t.roleLabel} ${esc(t.roles[p.user.role] ?? p.user.role)}</p>`,
      `<p><a class="button" href="${uploadPath(lang)}">${t.uploadLink}</a> <a class="button secondary" href="${lang === 'pt' ? '/conta/envios' : '/en/account/uploads'}">${lang === 'pt' ? 'Os meus envios' : 'My uploads'}</a></p>`,
      ...(p.user.role === 'moderator' || p.user.role === 'admin'
        ? [
          `<p><a class="button secondary" href="${lang === 'pt' ? '/admin/fila' : '/en/admin/queue'}">${t.moderationQueue}</a></p>`,
          `<p><a class="button secondary" href="${lang === 'pt' ? '/admin/utilizadores' : '/en/admin/users'}">${t.manageUsers}</a></p>`,
          `<p><a class="button secondary" href="${lang === 'pt' ? '/admin/remocoes' : '/en/admin/takedowns'}">${t.takedowns}</a></p>`,
          `<p><a class="button secondary" href="${lang === 'pt' ? '/admin/sem-principal' : '/en/admin/no-main'}">${t.withoutMain}</a></p>`,
          `<p><a class="button secondary" href="${lang === 'pt' ? '/admin/postos-fora-do-nap' : '/en/admin/stations-missing'}">${t.missingStations}</a></p>`,
        ]
        : []),
      ...(p.sections ? [p.sections] : []),
      `<form method="post" action="/auth/logout?next=${encodeURIComponent(here)}">` +
        `<button type="submit" class="button">${t.logout}</button></form>`,
    );
  } else if (p.enabled) {
    // A link, not a form: the CSP's form-action 'self' would block the
    // redirect to openstreetmap.org that follows a form submission.
    parts.push(
      `<p>${t.loginIntro} <a href="${privacyPath(lang)}">${t.privacyLink}</a></p>`,
      `<p><a class="button" href="/auth/osm/login?next=${encodeURIComponent(here)}">${t.loginButton}</a></p>`,
    );
  } else {
    parts.push(`<p>${t.loginOff}</p>`);
  }
  return layout({
    lang,
    title: `${t.accountTitle} · ${BRAND}`,
    description: t.accountDesc,
    noindex: true,
    switchTo: { pt: accountPath('pt'), en: accountPath('en') },
    body: `<div class="page-msg">\n${parts.join('\n')}\n</div>`,
  });
}

// The search box: a plain GET form, so it works without JavaScript.
function searchForm(lang: Lang, q = ''): string {
  const t = T[lang];
  return `<form class="search" action="${searchPath(lang)}" method="get" role="search">
  <label for="q">${t.searchLabel}</label>
  <div class="search-row">
    <input id="q" name="q" type="search" value="${esc(q)}" required minlength="2" maxlength="${MAX_QUERY}"
      autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-describedby="q-hint">
    <button type="submit">${t.searchButton}</button>
  </div>
  <p id="q-hint" class="hint">${t.searchHint}</p>
</form>`;
}

// Thumbnails from Panoramax (the static links are the main photo's, which may
// not be the new one), each linked to its credit page, with the authors named.
function recentList(lang: Lang, stations: RecentStation[]): string {
  if (!stations.length) return '';
  const t = T[lang];
  return `
<section class="recent" aria-labelledby="recent-h">
<h2 id="recent-h">${t.homeRecent}</h2>
<ul role="list">
${stations.map((s) => {
    const line = [s.name, s.municipality].filter(Boolean).join(' · ');
    const authors = [...new Set(s.photos.map((p) => p.credit ?? BRAND))];
    const chip = underConstruction(s)
      ? ` <span class="chip warn">${s.status === 'missing_from_osm' ? t.buildingGone : t.building}</span>`
      : s.status === 'missing_from_nap' ? ` <span class="chip warn">${t.outNap}</span>` : '';
    return `<li>
  <a class="mono" href="${stationPath(lang, s.id)}">${esc(s.id)}</a>${chip}
  ${line ? `<div>${nap(lang, line)}</div>` : ''}
  <ul class="recent-photos" role="list">${s.photos.map((p, i) => `<li><a href="${photoPath(lang, p.id)}"><img src="${PANORAMAX_URL}/api/pictures/${encodeURIComponent(p.panoramax_id)}/thumb.jpg" alt="${esc(t.ownAlt(s.id, i + 1))}" width="72" height="72" loading="lazy" referrerpolicy="no-referrer"></a></li>`).join('')}</ul>
  <div class="meta">${t.photoBy} ${authors.map((a) => `<span lang="">${esc(a)}</span>`).join(', ')} · ${licenseHtml(lang, 'CC-BY-SA-4.0')}</div>
</li>`;
  }).join('\n')}
</ul>
</section>`;
}

export function homePage(lang: Lang, recent: RecentStation[] = []): string {
  const t = T[lang];
  return layout({
    lang,
    title: t.homeTitle,
    description: t.homeDesc,
    path: homePath(lang),
    alternates: { pt: homePath('pt'), en: homePath('en') },
    body: `<div class="page-msg">
<h1>${t.homeH1}</h1>
<p>${t.homeText}</p>
${searchForm(lang)}
<p>${t.homeExample} <a href="${stationPath(lang, 'EZC-AMD-00051')}">${t.homeExampleLink}</a>.</p>${recentList(lang, recent)}
<p>${t.homeApi} <code>/api/v1/stations?q=</code>, <code>/api/v1/stations/{id}</code> ${t.and} <code>/api/v1/evses/{evse}</code>.</p>
<p><a href="${withoutPhotoPath(lang)}">${t.homeNoPhoto}</a> · <a href="${rankingPath(lang)}">${lang === 'pt' ? 'Ranking de contribuidores' : 'Contributor ranking'}</a></p>
</div>`,
  });
}

function resultItem(lang: Lang, r: SearchRow): string {
  const t = T[lang];
  const place = [r.address, r.municipality].filter(Boolean).join(', ');
  const line = [r.name, place].filter(Boolean).join(' · ');
  return `<li class="result">
    <a class="mono" href="${stationPath(lang, r.id)}">${esc(r.id)}</a>
    ${line ? `<div>${nap(lang, line)}</div>` : ''}
    <div class="meta">${r.operator ? nap(lang, r.operator) : t.unknownOperator}${r.status === 'missing_from_nap' ? ` · ${t.outNap}` : ''}${underConstruction(r) ? ` · ${r.status === 'missing_from_osm' ? t.buildingGone : t.building}` : ''}</div>
  </li>`;
}

// q is what the person typed (already trimmed); results is null when q had no
// searchable word. Not indexed: a search page is a list of links to the real ones.
export function searchPage(lang: Lang, q: string, results: SearchRow[] | null, limit: number): string {
  const t = T[lang];
  const query = (l: Lang) => (q ? `${searchPath(l)}?q=${encodeURIComponent(q)}` : searchPath(l));
  let body: string;
  if (results === null) {
    body = q ? `<p>${t.tooShort}</p>` : '';
  } else if (results.length === 0) {
    body = `<p>${t.noResults(esc(q))}</p>\n<p>${t.noResultsTip}</p>`;
  } else {
    const capped = results.length >= limit;
    body = `<p>${capped ? t.resultsTop(limit, esc(q)) : t.results(results.length, esc(q))}</p>
<ul class="results" role="list">
  ${results.map((r) => resultItem(lang, r)).join('\n  ')}
</ul>${capped ? `\n<p class="hint">${t.resultsCapped()}</p>` : ''}`;
  }
  return layout({
    lang,
    title: `${q ? t.searchTitle(q) : t.searchH1} · ${BRAND}`,
    description: t.searchDesc,
    noindex: true,
    switchTo: { pt: query('pt'), en: query('en') },
    body: `<div class="page-msg">
<h1>${t.searchH1}</h1>
${searchForm(lang, q)}
${body}
</div>`,
  });
}

const MEDAL_NAMES: Record<Lang, Record<Medal, string>> = {
  pt: { gold: 'Ouro', silver: 'Prata', bronze: 'Bronze' },
  en: { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' },
};

export const medalBadge = (lang: Lang, m: Medal | null) =>
  m ? `<span class="medal medal-${m}">${MEDAL_NAMES[lang][m]}</span>` : '';

const RANKING_T = {
  pt: {
    month: 'Ranking do mês', all: 'Ranking de sempre', seeAll: 'Ver de sempre', seeMonth: 'Ver do mês',
    desc: `Quem mais contribuiu com fotos de postos para o ${BRAND}.`,
    empty: 'Ainda não há pontos.',
    cols: ['#', 'Nome', 'Medalha', 'Fotos', 'Pontos'],
    caption: (p: string) => `${p}: os 50 primeiros`,
    rulesH: 'Como se ganham pontos',
    rules: [
      `${POINTS.approved} ponto por foto aprovada.`,
      `+${POINTS.first_photo} pela primeira foto de um posto ou de uma tomada.`,
      `+${POINTS.refresh} por substituir uma foto principal com mais de 12 meses.`,
      `Várias fotos tuas do mesmo posto ou tomada em ${SAME_TARGET_DAYS} dias contam uma vez.`,
      `Medalhas pelo total de sempre: bronze com ${MEDALS[2].min} pontos, prata com ${MEDALS[1].min}, ouro com ${MEDALS[0].min}. Não há prémios.`,
    ],
    optOut: 'Podes sair do ranking na tua conta; as fotos continuam a contar pontos.',
  },
  en: {
    month: "This month's ranking", all: 'All-time ranking', seeAll: 'All-time', seeMonth: 'This month',
    desc: `Who has contributed the most station photos to ${BRAND}.`,
    empty: 'No points yet.',
    cols: ['#', 'Name', 'Medal', 'Photos', 'Points'],
    caption: (p: string) => `${p}: top 50`,
    rulesH: 'How points are earned',
    rules: [
      `${POINTS.approved} point per approved photo.`,
      `+${POINTS.first_photo} for the first photo of a station or socket.`,
      `+${POINTS.refresh} for replacing a main photo older than 12 months.`,
      `Several photos of yours of the same station or socket within ${SAME_TARGET_DAYS} days count once.`,
      `Medals from the all-time total: bronze at ${MEDALS[2].min} points, silver at ${MEDALS[1].min}, gold at ${MEDALS[0].min}. There are no prizes.`,
    ],
    optOut: 'You can leave the ranking from your account; your photos still earn points.',
  },
};

export function rankingPage(lang: Lang, period: 'month' | 'all', rows: RankingRow[]): string {
  const t = RANKING_T[lang];
  const h1 = period === 'month' ? t.month : t.all;
  const other = period === 'month' ? 'all' : 'month';
  const [cRank, cName, cMedal, cPhotos, cPoints] = t.cols;
  const table = rows.length === 0
    ? `<p>${t.empty}</p>`
    : `<div class="table-wrap"><table class="ranking">
<caption class="sr-only">${esc(t.caption(h1))}</caption>
<thead><tr><th scope="col">${cRank}</th><th scope="col">${cName}</th><th scope="col">${cMedal}</th><th scope="col" class="num">${cPhotos}</th><th scope="col" class="num">${cPoints}</th></tr></thead>
<tbody>
${rows.map((r, i) => `<tr><td>${i + 1}</td><th scope="row" lang="">${esc(r.name)}</th><td>${medalBadge(lang, r.medal)}</td><td class="num">${r.photos}</td><td class="num">${r.points}</td></tr>`).join('\n')}
</tbody>
</table></div>`;
  const switchTo = { pt: `${rankingPath('pt')}?period=${period}`, en: `${rankingPath('en')}?period=${period}` };
  return layout({
    lang,
    title: `${h1} · ${BRAND}`,
    description: t.desc,
    path: `${rankingPath(lang)}?period=${period}`,
    alternates: switchTo,
    body: `<div class="page-msg">
<h1>${h1}</h1>
<p><a href="${rankingPath(lang)}?period=${other}">${period === 'month' ? t.seeAll : t.seeMonth}</a></p>
${table}
<h2>${t.rulesH}</h2>
<ul>${t.rules.map((r) => `<li>${r}</li>`).join('')}</ul>
<p class="hint">${t.optOut} <a href="${accountPath(lang)}">${lang === 'pt' ? 'Conta' : 'Account'}</a>.</p>
</div>`,
  });
}
