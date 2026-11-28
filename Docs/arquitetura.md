# Arquitetura — o que está a funcionar

Este documento descreve o olh'o'posto tal como existe hoje. O que ainda falta construir, e o design dessas partes, está em [`plan.md`](plan.md). Os detalhes de operação estão em [`infra.md`](infra.md) (servidor Panoramax no Zerops) e em [`cloudflare.md`](cloudflare.md) (R2, Worker, D1 e o import dos postos). As licenças estão em [`licenca.md`](licenca.md).

## Estado

- **Fase 1 (Panoramax):** o servidor está em produção em `panoramax.ocarroeletrico.com`, fora da federação, com o ensaio feito. Falta a conversa com a comunidade ([`plan.md`](plan.md), *Fases*) e a conta mensal ([`infra.md`](infra.md), secção 9).
- **Fase 2 (o site para pessoas):** quase feita. Funcionam as páginas, a pesquisa, a API, o login OSM, o envio, a moderação, a foto principal, as chapas, as fotos externas, os postos em construção, os pontos, o crédito, os *tokens*, o MCP e os pedidos de remoção (secções abaixo). O que falta (o detetor de matrículas, entre outros) está no [`plan.md`](plan.md).
- **Envio aberto:** Turnstile, limites de pedidos e 50 fotos por dia para contribuidores ([`cloudflare.md`](cloudflare.md), secção 4).
- **Papéis:** mudam-se em `/admin/utilizadores`; quem pode dar qual está em [`moderadores.md`](moderadores.md).
- **Deploy:** cada push para `main` que mexa em `worker/` publica o Worker pelo Workers Builds; o Panoramax faz deploy pelo webhook do Zerops. O que está publicado na Cloudflare está no [`cloudflare.md`](cloudflare.md), secção 1.

## Objetivo

Um servidor **Panoramax** próprio, só para postos de carregamento, guarda as fotos. Um **Worker da Cloudflare** (`olhaoposto`) faz o resto: a lista de postos do NAP, os links estáticos pelo ID oficial, a escolha da foto principal, o envio, a moderação, o ranking, a API e o MCP. Exemplo de link: `https://pictures.ocarroeletrico.com/TRK-VNT-00005.jpg`.

Requisitos (da proposta inicial do projeto):

- Servidor que aloja as fotos e gera links estáticos.
- Upload obrigatoriamente associado a um posto (`OPC-XXXXXXXXXX`) ou a uma tomada (`PT-OPC-E-YYYYYYYYY`).
- O posto tem de existir; pesquisa por referência, morada ou coordenadas. Postos novos entram numa fila de revisão humana (decidido depois: os postos vêm do NAP e do OpenStreetMap, e não se propõem no site).
- Quando há várias fotos, escolher qual alimenta cada link estático.
- Links por posto (`/OPC-XXXXXXXXXX.jpg`) e por tomada (`/PTOPCEYYYYYYYYY.jpg`), usáveis por qualquer app ou mapa (OSM, NAP dashboard).

Princípios:

- **URL estável, conteúdo trocável**: o link nunca muda; muda apenas a foto que ele aponta.
- **Dados oficiais como base**: postos e EVSE vêm do NAP/Mobi.E; o OSM serve de complemento.
- **Privacidade por defeito**: desfocagem de caras e matrículas e remoção do EXIF antes de publicar.
- **Licença aberta obrigatória** (CC BY-SA 4.0, com autorização ODbL), para poder ser usada no OSM.
- **Saída fácil**: dados exportáveis, código aberto e fotos num servidor Panoramax federado, para a comunidade não depender de uma pessoa ou conta.

Responsável (RGPD): O Carro Elétrico. Passar para uma associação fica como saída futura.

## Nomes e domínios

- **Marca:** "olh'o'posto" (lê-se "Olha o posto"). Só apresentação: logótipo, títulos e `display_name` da app OAuth do OSM. Leitores de ecrã: "Olha o posto" (`aria-label` dos SVG e texto escondido no cabeçalho). No código, `BRAND` e `BRAND_SPOKEN` em `worker/src/pages.ts`. Ficheiros e cores em `Design/marca/`.
- **Repositório:** `CarregaErvilhas/OlhaOPosto`.
- **Slug técnica:** `OlhaOPosto` onde as maiúsculas se mantêm e alguém o lê (conta de serviço e produtor no Panoramax, etiquetas `OlhaOPosto|…`, User-Agent, nome do servidor MCP, título dos *upload sets*), para não se ler "Olhão". `olhaoposto` em minúsculas só onde tem de ser ou onde as maiúsculas se perdem: subdomínio e URLs, nome do Worker, pacote npm, `photos.origin`. Os apóstrofos nunca entram num identificador técnico.
- **Nomes que ficam `pictures`:** o bucket R2 `pictures` (e `pictures.ocarroeletrico.com`, o host dos links estáticos), o `pictures-staging` e a D1 `pictures`. São internos ou já estão em links, e mudar a D1 obriga a criar outra base.

| Host | O que serve hoje | Como |
| --- | --- | --- |
| `olhaoposto.ocarroeletrico.com` | Páginas dos postos e pesquisa (pt-PT e inglês), API `/api/v1` (leitura aberta, escrita com sessão ou *token*), privacidade e condições de utilização, login OSM, conta, envio, moderação, ranking, `sitemap.xml`, `robots.txt`, `llms.txt` | Worker `olhaoposto` + D1 ([`cloudflare.md`](cloudflare.md), secção 4) |
| `pictures.ocarroeletrico.com` | Links estáticos (`/<id>.jpg` e tamanhos): a foto principal de cada posto e tomada, ou `404` | Custom domain do bucket R2 `pictures`, servido pela CDN **sem Worker** ([`cloudflare.md`](cloudflare.md), secção 3) |
| `panoramax.ocarroeletrico.com` | Servidor Panoramax (API, visualizador, imagens), fora da federação | Zerops, com o bucket R2 `panoramax` como armazenamento ([`infra.md`](infra.md)) |

O `pictures.*` não tem Worker à frente de propósito: um Worker corre antes da cache, por isso cada pedido contaria para o limite dos Workers mesmo com a foto em cache. Uma Cache Rule no `pictures.*` dá um Edge TTL longo; um *cache miss* é uma leitura Classe B no R2 (10 milhões grátis por mês).

## Componentes

```
   Pessoas, apps, mapas, agentes
              |
   Worker olhaoposto (olhaoposto.*)        R2 "pictures" (pictures.*)
   páginas, API, tokens, login OSM,        links estáticos pela CDN
   envio, moderação,                       (fotos principais)
   pontos e ranking, sitemap
              |
   D1 "pictures": stations, evses,         R2 "pictures-staging"
   users, sessions, photos, selections,    (privado, cópias até à aprovação)
   points, api_tokens, review_queue...
              ^
   GitHub Actions, de hora a hora:
   ohmigo_chargers.json (NAP dashboard) --> D1

   Panoramax (panoramax.*, Zerops)
     PostgreSQL+PostGIS, worker de imagens
     R2 "panoramax" (originais e tamanhos)
     conta de serviço "OlhaOPosto", sem OAuth
```

O Worker fala com o Panoramax com a conta de serviço `OlhaOPosto`: cria um *upload set* escondido por foto no envio, torna-o público ao aprovar, apaga-o ao recusar, e trata as denúncias dos pedidos de remoção ([`cloudflare.md`](cloudflare.md), secção 4).

## Porque o Panoramax

**Porque o Panoramax.** Dá de graça o armazenamento e os tamanhos das imagens, a licença por servidor, as etiquetas por foto, uma API de envio, os pedidos de remoção e a federação: as fotos aparecem no mapa geral do Panoramax e o OSM aponta para elas com `panoramax=<uuid>`, a etiqueta que a comunidade já usa. Não há servidor Panoramax em Portugal; o da OSM França só aceita envios de fora de França para testes, e o do MapComplete só aceita envios pelo MapComplete.

**Porque um servidor só para postos.** Um "Panoramax PT" geral, aberto a fotos de rua de qualquer pessoa, faria de nós o responsável RGPD por tudo, com terabytes de armazenamento e moderação muito maior. Este servidor só recebe fotos de postos, enviadas pelo olh'o'posto. Só se chama "Panoramax PT" se a OSM Portugal e a equipa do Panoramax concordarem, e pode crescer para isso mais tarde.

**Sem logins no Panoramax.** O olh'o'posto envia tudo com uma única conta de serviço (`OlhaOPosto`, que não é admin); o registo no Panoramax está fechado, como no servidor do MapComplete. Os contribuidores só entram no olh'o'posto, com OSM. Isto garante que só entram fotos de postos e que a moderação é a do olh'o'posto. O visualizador, as páginas das fotos e a API de leitura do Panoramax continuam públicos. O que se perde (o envio pelo Panoramax e as apps dele, a página "as minhas fotos" do Panoramax) não faz falta ou é refeito no olh'o'posto.

O servidor está configurado para isto: licença CC BY-SA 4.0, envio só com token, fotos `owner-only` até o olh'o'posto as aprovar, sem desfocagem no servidor. Configuração e resultados do ensaio em [`infra.md`](infra.md), secções 4 e 9.

## Postos e tomadas

A lista de postos válidos vem do NAP (fonte oficial): mais de 8 900 locais e 19 700 pontos.

**Sincronização.** O olh'o'posto lê o `ohmigo_chargers.json` que o NAP dashboard já publica (o mesmo que o site e o ohmigo usam), de hora a hora, pelo GitHub Actions, e faz *upsert* na D1: postos novos entram como `active`, postos que desaparecem passam a `missing_from_nap` (nunca são apagados, para os links e as fotos continuarem a funcionar). O mesmo import traz os postos em construção do OpenStreetMap (abaixo). Corre de hora a hora e não faz nada quando o feed não mudou. Funcionamento e travões em [`cloudflare.md`](cloudflare.md), secção 5.

**Chave dos links.** O posto usa o `id` do local (`EZC-AMD-00051`: prefixo do operador + código), que é único e é o formato `OPC-XXXXXXXXXX` da proposta inicial. A tomada usa o código EVSE do NAP sem os `*` (`PTEZCEAMD000511`), vindo do campo `evse` de cada ponto do feed. Pontos sem código EVSE no NAP não têm link de tomada.

**Armadilhas de IDs** (do [gotchas.md](https://github.com/CarregaErvilhas/nap-dashboard/blob/main/references/gotchas.md) do NAP dashboard):

- Juntar pelo `site_external_id` do NAP. O `point_external_id` (`PT*op*[E]*reg*num*tom`) não é fiável como chave: às vezes traz `ELSB` em vez de `LSB` e tem entre 3 e 7 segmentos.
- O código EVSE não é garantidamente único: já houve um operador a publicar o mesmo em dois postos. Por isso a chave das tomadas é (`station_id`, `point_id`) e o código tem um índice simples.
- Os EVSE do MOBI.Data aparecem em vários formatos (`ABF-00011-01`, `PT-EDP-EABF-00008-1`) e centenas são só números (`97`).
- O `ref:EU:EVSE` do OSM está rigorosamente igual ao código EVSE do NAP, por isso a junção faz-se pelo código tal como vem, sem normalizar nem tirar zeros à esquerda.

**Tabelas na D1** (`worker/migrations/`):

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| `stations` | `id` (PK, ex. `EZC-AMD-00051`), `code`, `opc`, `operator`, `name`, `address`, `municipality`, `region`, `lat`, `lon`, `source` (`nap`, `osm`), `status` (`active`, `missing_from_nap`, `missing_from_osm`, `merged`), `osm_ref`, `codes`, `updated_at` | `osm` = posto em construção (id `OSM-w…`/`OSM-n…`, `codes` = os códigos MOBI.E que o OSM traz, separados por espaços). `merged` não é público: o id responde `301` pelo alias |
| `evses` | `station_id` (FK) + `point_id` (PK), `evse_id` (forma original com `*`), `evse_compact` (sem `*`, índice simples), `connector`, `max_kw`, `dc`, `status` | Uma linha por ponto/tomada. O `point_id` do MOBI.Data repete-se entre postos |
| `stations_fts` | Índice FTS5 de `id`, `code`, `name`, `address`, `municipality`, `operator`, `opc`, `codes` | Para a pesquisa. Só o índice: o texto fica em `stations`, e três *triggers* mantêm-no a par, por isso o import não muda |
| `import_state` | `key`, `value` | O `generatedAt` do último feed importado |
| `users` | `id` (UUID nosso), `osm_uid` (único), `osm_name`, `osm_key`, `pseudonym`, `pseudonym_key` (único), `pseudonym_changed_at`, `role` (`contributor`, `trusted`, `moderator`, `admin`), `ranking_opt_out`, `promoted_by`, `promoted_at`, `license_accepted_at`, `created_at`, `last_login_at` | Só do login OSM: sem email. Os `*_key` são os nomes sem acentos, maiúsculas nem pontuação, para a unicidade do pseudónimo (*Crédito*, abaixo) |
| `sessions` | `token_hash` (PK, SHA-256 do *cookie*), `user_id` (FK), `created_at`, `expires_at` | Uma cópia da tabela não abre sessões. As expiradas saem no login seguinte |
| `photos` | `id` (UUID), `origin`, `station_id` (FK), `evse_compact` (nulo = foto geral), `kind` (`photo` ou `plate`, a chapa de um carregador; ver *Chapas*), `uploader_id` (FK), `panoramax_set`, `panoramax_id`, `taken_at`, `exif_lat`, `exif_lon`, `distance_m`, `license`, `credit`, `author_tag_old`, `external_ref`, `external_src`, `source_url`, `status` (`uploading`, `failed`, `pending`, `published`, `hidden`, `removed`), `approved_by`, `approved_at`, `refusal_reason`, `refusal_note`, `refused_by`, `created_at` | Uma linha por envio. O GPS do EXIF é só para a moderação, nunca publicado. `uploading` e `failed` são envios a meio ou falhados. `author_tag_old`: a etiqueta de autor que falta trocar no Panoramax depois de uma mudança de crédito. As linhas de `origin` `osm_panoramax` ou `commons` são fotos externas (*Fotos externas*, abaixo), só referências, sem `uploader_id` |
| `selections` | `target` (PK), `station_id` (FK), `photo_id` (FK), `chosen_by`, `chosen_at`, `published_at`, `credit_pending` | Qual foto cada link estático serve. `INSERT OR IGNORE` torna a primeira aprovação atómica. `credit_pending`: as três cópias ainda têm o crédito antigo no XMP. `lost_at` marca um alvo que perdeu a principal (migração `0015`), para o distinguir de um que nunca teve |
| `purge_queue` | `url` (PK), `queued_at`, `attempts`, `last_error` | Links estáticos cuja cópia antiga ainda está na cache do `pictures.*`: uma troca da principal cuja purga falhou (migração `0020`, que também pôs na fila, uma vez, todos os links com principal). O *cron* tenta de novo até a Cloudflare aceitar |
| `station_aliases` | `old_id` (PK), `new_id` (FK), `created_by`, `created_at` | Re-keys do NAP: o link antigo responde `301` para o novo |
| `points` | `id` (autoincrement), `user_id` (FK), `photo_id` (FK), `points`, `reason` (`approved`, `first_photo`, `refresh`), `month`, `created_at` | Gamificação (*Pontos e ranking*, abaixo). Uma linha por atribuição; só contam as de fotos `published` |
| `api_tokens` | `id`, `user_id` (FK), `token_hash` (único, SHA-256), `prefix`, `name`, `scopes`, `created_at`, `expires_at`, `last_used_at`, `revoked_at` | *Tokens* de API: uma cópia da tabela não abre nada |
| `review_queue` | `id`, `kind` (`new_station`), `station_id` (FK), `payload` (JSON), `submitted_by`, `status` (`pending`, `approved`, `rejected`), `decided_by`, `decided_at`, `note`, `created_at` | Vazia: era das propostas de postos, que saíram. As fotos têm o estado em `photos`, e os pedidos de remoção vivem no Panoramax |

## Postos em construção

Para haver fotos de um posto antes de ele abrir (as mais difíceis de arranjar depois). Um posto em construção é o que o OpenStreetMap diz estar em obra e o NAP ainda não tem. O OSM passa a ser a fonte só destes, e o NAP manda logo que os publica. Os planeados (sem obra à vista) ficam de fora.

- **Origem:** o array `planned` do feed do NAP dashboard, só os `lifecycle: "construction"`. Uma chave `planned` em falta (corrida sem o passo do OSM) não muda nada; uma lista vazia passa-os todos a `missing_from_osm`, com travão.
- **Id:** o elemento OSM, `OSM-w1551836005` (`n` para um nó, `w` para uma *way*), o mesmo que o NAP dashboard usa. `osm_ref` guarda `way/1551836005`, e `codes` os códigos MOBI.E que vêm do `ref` e do nome (`ALM-00114 ALM-00155`), que também entram na pesquisa.
- **Página** (`/postos/OSM-w…`): faixa «Em construção segundo o OpenStreetMap», os códigos, as fotos aprovadas em galeria (miniatura do Panoramax, ligada à página de crédito), sem tomadas, sem links estáticos, sem link para o NAP dashboard, `noindex` e fora do `sitemap.xml`. Na pesquisa e na página de envio aparecem marcados, depois dos do NAP. Ficam fora de `/postos/sem-foto` e do `has_photo=false` (não têm link estático por preencher). A API e o MCP trazem `lifecycle: "construction"`, os `codes` e as `photos`.
- **Fotos:** como noutro posto (as `trusted` publicam direto a ≤300 m), mas **sem foto principal nem link estático** até à fusão: o `publishMain` e o `chooseMain` recusam um posto `osm`. Assim um link estático nunca muda de chave. A fila de moderação marca estas fotos para uma revisão mais atenta (trabalhadores, carrinhas com o nome da empresa).
- **Fusão automática** (no import, `src/merge.ts`): o posto do NAP tem o mesmo elemento OSM (`osm.element`) e o código dele está nos `codes` (ou não há códigos). Olha para todos os postos em construção da D1, também os que já saíram do feed. Faz o alias (`OSM-w…` → id do NAP, `301`), passa as fotos para o posto do NAP, marca a etiqueta do Panoramax para trocar (`photos.site_tag_old`) e põe o posto em construção a `merged`. Um posto novo que já bate com um do NAP nem entra.
- **Depois da fusão** (o *cron* de 6 em 6 horas, `src/construction.ts`, porque o import só escreve na D1): se o posto do NAP não tinha principal, a primeira foto aprovada passa a principal dele, como numa aprovação; e a etiqueta `OlhaOPosto|site` troca para o id do NAP no Panoramax.
- **Fusão manual:** a página `/admin/postos-fora-do-nap` lista também os postos em construção com fotos que saíram do OSM ou que têm um posto do NAP parecido (mesmo elemento ou um dos códigos, a qualquer distância, porque há postos com as coordenadas erradas no NAP e certas no OSM; ou a menos de 60 m), com a sugestão. A fusão automática nunca usa a distância. O moderador junta-os com as mesmas instruções da fusão automática.
- **Nunca são apagados.** Um que sai do OSM sem entrar no NAP passa a `missing_from_osm` e fica com a página e as fotos.

## Site e API

O Worker serve as páginas dos postos em pt-PT (`/postos/{id}`) e em inglês (`/en/stations/{id}`), a procura de uma tomada pelo código EVSE (`/tomadas/{evse}`, `/en/sockets/{evse}`), a pesquisa de postos (`/pesquisa`, `/en/search`, também no formulário da página inicial), a API de leitura (`/api/v1/stations?q=`, `/api/v1/stations?lat=&lon=`, `/api/v1/stations/{id}`, `/api/v1/evses/{evse}`, `/api/v1/photos/{id}`, `/api/v1/photos.json`, `/api/v1/main-photos`, `/api/v1/ranking`, e a descrição em OpenAPI 3.1, `/api/v1/openapi.json`), a lista dos postos sem foto (`/postos/sem-foto`, `/en/stations/without-photo`), a política de privacidade (`/privacidade`), as condições de utilização (`/condicoes`), o ranking (`/ranking`), o servidor MCP (`/mcp`, abaixo), o `sitemap.xml`, o `robots.txt` e o `llms.txt`. As páginas HTML levam o cabeçalho `Link: </llms.txt>; rel="describedby"; type="text/markdown"`, para os agentes encontrarem o `llms.txt`.

A página inicial mostra os três postos com as fotos publicadas mais recentes (data de aprovação), cada um com até quatro miniaturas do Panoramax ligadas às páginas de crédito, os autores e a licença. Só entram fotos do olh'o'posto, sem as chapas; sem fotos, a secção não aparece.

Com o login OSM há a conta (`/conta`: nome a mostrar, pontos, medalha, sair do ranking, *tokens* de API), a página de envio (`/enviar`), a fila de moderação e os painéis de administração (`/admin/…`). A escrita na API (`POST /api/v1/photos`, `DELETE /api/v1/photos/{id}`, `POST /api/v1/stations`, `PUT /api/v1/selections/{target}`) aceita a sessão, só a partir do próprio site, ou um *token* (`Authorization: Bearer oop_…`) com o âmbito certo. Rotas, cabeçalhos, acessibilidade e cache em [`cloudflare.md`](cloudflare.md), secção 4.

## Fluxo de envio

Tudo o que mexe na foto original acontece no browser: o servidor nunca recebe o original nem os metadados. A página `/enviar`:

1. Abre uma ou várias fotos, JPEG ou HEIC (o HEIC pelo browser ou pelo libheif em WebAssembly), e trata-as uma de cada vez.
2. Lê o GPS e a data do EXIF e sugere os postos a 500 m. Sem GPS: pesquisa por texto ou mapa (OpenStreetMap, só se a pessoa o abrir). O posto da foto anterior fica sugerido para a seguinte.
3. Procura caras no dispositivo (MediaPipe, BlazeFace) e pré-desenha as zonas; a pessoa confirma, desliga ou acrescenta zonas, também para as matrículas, e cada zona leva um mosaico.
4. Gera 2048, 1024 e 400 px sem metadados e envia-os, com a data e o GPS à parte. O Worker volta a verificar tudo, guarda a de 2048 px escondida no Panoramax (com as coordenadas do posto, nunca as do GPS) e as outras em `pictures-staging`.

Contas `trusted` publicam logo quando a foto foi tirada a 300 m ou menos de um posto `active`; o resto fica `pending` para a fila (`/admin/fila`), que avisa das fotos sem GPS ou longe do posto. Quem envia aceita as condições de utilização e a licença no primeiro envio (`license_accepted_at`).

**O que se faz com o GPS do EXIF.** Sugere o posto e sinaliza fotos longe dele (`distance_m`, e o aviso na fila). Fica só na D1, para a moderação; a API pública mostra a data, nunca as coordenadas de quem tirou a foto. O Panoramax recebe as coordenadas do posto.

## Links estáticos

O URL é o ID e nunca muda. Só há link estático para fotos enviadas pelo olh'o'posto; as externas (*Fotos externas*, abaixo) ficam só na galeria. A resolução código → foto acontece **na escrita, não no pedido**: quando um moderador aprova uma foto e o alvo (a tomada, ou o posto para uma foto do posto em geral) ainda não tem principal, o Worker (`src/publish.ts`) regista-a na tabela `selections` e copia três tamanhos para o bucket `pictures`. Uma foto de uma tomada também passa a principal do posto, se o posto não tiver nenhuma. As cópias de 1024 e 400 px vêm do `pictures-staging`; a de 2048 px vem do Panoramax, sem o EXIF que o Panoramax lhe escreve. Cada cópia leva um XMP com o autor, a licença CC BY-SA 4.0 e o link da página de crédito da foto (`/p/{photo_id}`; o R2 não manda cabeçalhos próprios), sem GPS, e `Cache-Control: public, max-age=86400`. As cópias publicadas antes da página de crédito existir continuam a apontar para a página do posto até serem publicadas outra vez. A página do posto mostra a foto principal com o crédito, e as miniaturas das tomadas; ambas ligam à página de crédito. As outras fotos publicadas do posto e das tomadas (as que não são principais) aparecem por baixo, em «Outras fotos», com a miniatura do Panoramax ligada à página de crédito. Um moderador ou administrador pode trocar a principal (`PUT /api/v1/selections/{target}`): o Worker copia a foto nova por cima das três chaves e faz *purge* desses URLs. Sem a purga, a cache do `pictures.*` continuava a servir a foto antiga até 30 dias, com o crédito da nova: se a Cloudflare recusar (ou faltarem os segredos), os URLs vão para a `purge_queue`, o *cron* tenta de novo de 6 em 6 horas, a resposta diz `cachePending: true` (no painel do posto, uma mensagem), e o erro da Cloudflare fica nos registos do Worker. As nossas páginas mostram as imagens com `?v=` e o início do id da foto principal: a Cache Rule não conta a *query string*, por isso a Cloudflare serve a mesma cópia, mas o browser, que guarda a imagem um dia, vai buscar a nova logo que a página muda (5 minutos no máximo). Os links para copiar ficam sem isso.

Quando a principal é ocultada ou removida (pedido de remoção), as três chaves saem logo do `pictures` e o link passa a `404`: a privacidade vem primeiro. A seguinte **nunca passa a principal sozinha**, porque pode estar mal desfocada, ser de outra tomada ou simplesmente pior. A linha de `selections` fica, com `lost_at` preenchido e `published_at` a `NULL`, e o alvo aparece na lista «Sem foto principal» (`/admin/sem-principal`, e no fim da fila de moderação e do painel de remoções; `src/mains.ts`), com as outras fotos publicadas do mesmo alvo: do posto em geral para um posto, dessa tomada para uma tomada. Um moderador ou administrador escolhe uma e carrega em «Tornar principal» (`POST /admin/principal`, que usa o mesmo caminho do `PUT /api/v1/selections/{target}`). Sem escolha, o link fica `404`. Uma foto nova desse alvo, quando aprovada, preenche-o como a qualquer alvo sem principal; o mesmo faz a própria foto, se o moderador a mantiver.

| URL (`pictures.ocarroeletrico.com`) | Devolve |
| --- | --- |
| `/EZC-AMD-00051.jpg` | Foto principal do posto (1024 px) |
| `/EZC-AMD-00051.thumb.jpg` | 400 px |
| `/EZC-AMD-00051.full.jpg` | 2048 px |
| `/PTTRKEVNT0000501.jpg` (e `.thumb.jpg`, `.full.jpg`) | Foto principal da tomada |

- **Sem query strings.** O R2 ignora-as, por isso cada tamanho tem a sua chave.
- **Galerias e metadados** ficam na API: `olhaoposto.ocarroeletrico.com/api/v1/stations/{id}`.
- **Lista das fotos principais:** `olhaoposto.ocarroeletrico.com/api/v1/main-photos`, com o autor, os três tamanhos, a página do posto e o id da foto no Panoramax. O NAP dashboard copia as miniaturas uma vez por dia e mostra-as com o crédito, como faz com as do OSM.
- **Exportação completa:** `olhaoposto.ocarroeletrico.com/api/v1/photos.json`, todas as fotos publicadas (a galeria também, não só as principais), cada uma com a licença, o autor, o alvo, o posto e a sua posição, os tamanhos e o id no Panoramax. Em cache um dia; para quem reutiliza as fotos. As fotos externas (Panoramax de outros autores, Commons) vão na lista com `origin` próprio, a miniatura e o `sourceUrl`, sem cópia nossa. Uma foto individual: `GET /api/v1/photos/{id}`.
- **Postos sem foto:** `GET /api/v1/stations?has_photo=false` (com `opc` e `municipality`) e a página `/postos/sem-foto`, ligada da página inicial e da página de envio. Um posto conta como sem foto enquanto o link estático dele der `404`.
- **Retirar uma foto:** `DELETE /api/v1/photos/{id}` (o autor, ou um moderador) usa o mesmo caminho dos pedidos de remoção (`removePhoto` em `src/takedown.ts`): o posto fica em «Sem foto principal» se perde a principal, e os pontos da foto deixam de contar.
- **Ligações entre os sites:** a página de cada posto aponta para o NAP dashboard (`nap.ocarroeletrico.com/?posto={código}`, só para postos que o NAP ainda publica) e, quando há foto principal, para ela no mapa do Panoramax (`/viewer?focus=map&map=19/{lat}/{lon}&pic={id}`).
- **Sem foto:** o R2 responde `404`, para cada app decidir o que mostrar.
- **Pré-visualização nas redes sociais:** a página de um posto com foto principal (e a página de crédito de cada foto) põe essa foto no `og:image`, com o autor e a licença no `og:image:alt`, e pede o cartão grande (`twitter:card` `summary_large_image`). Sem foto principal do próprio posto (só de uma tomada, ou um posto em construção), fica a mascote. As redes guardam a pré-visualização em cache, por isso, quando a principal muda, a antiga pode continuar a aparecer durante uns dias.
- **Cache:** Edge TTL de 30 dias e `404` nunca em cache na Cache Rule, sem query strings na chave ([`cloudflare.md`](cloudflare.md), secção 3).

**Página de crédito** (`/p/{photo_id}`, `/en/p/{photo_id}`; `src/photopage.ts`): a foto, o autor (`photos.credit`), a data (a da foto, ou a da aprovação), a licença CC BY-SA 4.0 com o link do texto, o posto ou a tomada que mostra, o texto de atribuição pronto a copiar e os links para a página do posto, para o Panoramax e para o pedido de remoção. Só existe para fotos publicadas de postos públicos: uma foto pendente, oculta ou retirada dá `404`. A foto principal vem de `pictures.*`; outra foto publicada vem do Panoramax. Não vai para o `sitemap.xml`: chega-se lá pelas páginas dos postos.

**Acrescentar ao OSM** (só na foto principal atual de um posto ou tomada, sem bot nem edição automática): o link abre o editor iD no elemento ligado ao posto (`osm_ref`) ou, se não houver ou se a foto for de uma tomada, no sítio do posto, e mostra a etiqueta `panoramax=<id>` para copiar. A página do posto mostra o mesmo no cartão «No OpenStreetMap» quando o posto tem foto principal: a etiqueta da principal do posto, com botão de copiar, e um botão para o iD (no elemento, ou no sítio com o aviso de que o posto ainda não está ligado). As fotos das tomadas ficam só na página de crédito.

## Chapas

A chapa de um carregador é a placa de características: modelo, número de série, tensão, corrente e potência nominais. Em inglês, *rating plate*. É uma foto com `kind = 'plate'` (migração `0019`), sempre do posto em geral (`evse_compact` nulo): um posto pode ter vários carregadores e o NAP não diz que tomada está em qual.

- **Envio:** na página de envio é a terceira escolha de «O que mostra esta foto?», ao lado de «Posto em geral» e das tomadas. Na API e no MCP, `kind: "plate"` no `meta` (ou no `submit_photo`), com `target` = o id do posto. Passa pela mesma moderação, desfocagem e Panoramax (etiqueta `OlhaOPosto|kind=plate`).
- **Nunca é principal:** o `publishMain`, o `chooseMain`, a fusão dos postos em construção e a lista de «Sem foto principal» só aceitam `kind = 'photo'`. Por isso não há link estático de uma chapa, e o princípio do URL estável fica igual.
- **Galeria:** a página do posto mostra-as em «Chapas», à parte das «Outras fotos»; a API e o MCP trazem-nas em `photos` com `kind: "plate"`, e o `photos.json` também. Várias por posto. Na página de moderação do posto têm secção própria e só se removem (com motivo: duplicada, qualidade fraca…).
- **Pontos:** contam como um alvo à parte das fotos do mesmo posto (a regra dos 30 dias e a primeira foto do alvo olham para o `kind`).

## Fotos externas

Há postos com uma foto que alguém pôs no OSM (`panoramax=`, `wikimedia_commons=`, `image=`, pelo MapComplete ou à mão) e que ninguém enviou pelo olh'o'posto. O NAP dashboard já as recolhe (`charger_photos.py`) e publica cada miniatura em `nap.ocarroeletrico.com/photos/`. O import dos postos (`scripts/import-stations.ts`, [`cloudflare.md`](cloudflare.md)) lê o `photos` de cada posto do feed e guarda-as em `photos` **só como referência** (migração `0017`):

- `origin` é `osm_panoramax` (a página é um Panoramax, `external_ref` é o UUID da imagem) ou `commons` (a página é do Wikimedia, `external_ref` é o título do ficheiro). `external_src` é a miniatura, `source_url` a página na origem, e `credit`, `license` e `taken_at` vêm da origem. Sem cópias no R2, sem `uploader_id`, sem moderação (`status` fica `published`), sem pontos, sem `panoramax_id`. O `id` é um hash do posto e da origem, por isso o API é estável entre importações.
- Ficam de fora: o Mapillary (a API deles pede chave), fotos sem miniatura ou sem licença, miniaturas que não estejam em `nap.ocarroeletrico.com/photos/`, e as nossas (a página é do olh'o'posto ou do nosso Panoramax, ou o UUID é o `panoramax_id` de uma foto `olhaoposto`).
- Cada importação põe, atualiza e **apaga** as referências que saíram do feed (só linhas com `origin` diferente de `olhaoposto`). Se a importação fosse apagar mais de metade das referências (um feed sem fotos por engano), recusa, como com os postos em falta; `--allow-mass-missing` confirma.
- Aparecem na página do posto (secção «Noutras fontes», em pt-PT e em inglês) com a marca «Externa» e a origem, o autor, a licença e o link «Ver na origem», e na API do posto (`externalPhotos`, [`api.md`](api.md)). A CSP da página só abre `img-src` a `nap.ocarroeletrico.com` quando o posto tem alguma; o browser nunca pede nada ao Panoramax nem ao Commons para as ver (política de privacidade).
- **Nunca são a principal.** Não entram em `/main-photos`, o `PUT /selections` e «Tornar principal» recusam-nas, a lista «Sem foto principal» não as oferece, não dão pontos, não têm página de crédito (`/p/…` dá `404`) nem entram nos pedidos de remoção (o pedido faz-se na origem) e nos postos em falta com fotos. Todas as consultas das nossas fotos filtram por `origin = 'olhaoposto'`.
- O link estático (`pictures.*`) só existe para fotos enviadas pelo olh'o'posto: um posto que só tem fotos externas dá `404` aí. Copiar a externa escolhida (opção A) está em [`plan.md`](plan.md).

## Publicação e gestão de fotos

- **Publicação direta:** contas `trusted` publicam logo no envio, quando o posto está `active` e a foto foi tirada a ≤300 m dele. Caso contrário (contributor, sem GPS, >300 m) fica `pending` para a fila.
- **Trocar a principal:** `PUT /api/v1/selections/{target}` com `{ "photo": "<id>" }` (moderador ou administrador; sessão ou *token* `selections:write`) copia os 3 tamanhos por cima e faz *purge* da cache.
- **Aliases (re-key):** quando o NAP muda o código de um posto, o antigo fica `missing_from_nap`. Um moderador cria o alias em `/admin/postos-fora-do-nap`; o link antigo responde `301` para o novo.
- **Motivo de recusa:** recusar uma foto na fila (`/admin/fila`) exige um motivo de uma lista fixa (`wrong_station`, `privacy`, `quality`, `duplicate`, `advertising`, `other`, em `src/reasons.ts`) e aceita uma nota curta. Guarda-se em `photos.refusal_reason`, `refusal_note` e `refused_by`. Uma remoção pelo painel `/admin/remocoes` guarda o motivo da denúncia convertido para a mesma lista, sem `refused_by`.
- **Os meus envios:** `/conta/envios` (`/en/account/uploads`), ligada da conta: as fotos do próprio autor, com miniatura (só dele), posto, data, estado (à espera, publicada, principal, recusada, removida, oculta) e o motivo em linguagem simples. Paginada, 20 por página.
- **Histórico de decisões:** `/admin/decisoes` (`/en/admin/decisions`), para moderadores: quem aprovou ou recusou fotos, quando e porquê, da mais recente para a mais antiga. As remoções por denúncia não entram (vivem no Panoramax).

## Pedidos de remoção

Assentam nas denúncias do próprio Panoramax (`src/takedown.ts`). O formulário `/report` (com Turnstile; o botão «Report» do nosso `/viewer` abre-o) cria a denúncia e oculta logo as nossas cópias. Os moderadores decidem no painel `/admin/remocoes`. Uma regra WAF só deixa passar as denúncias que vêm do Worker, e um *cron* de 6 em 6 horas (e o painel, ao abrir) repete as ocultações que falharam a meio. Uma principal oculta ou removida sai logo do `pictures` (*Links estáticos*, acima). Detalhe em [`cloudflare.md`](cloudflare.md), secção 4.

## Pontos e ranking

- **Pontos**, só para fotos aprovadas e sempre para o autor da foto: +1 por foto, +3 pela primeira foto de um posto ou tomada, +2 quando a foto passa a principal no lugar de uma com mais de 12 meses. A mesma pessoa no mesmo alvo em 30 dias conta uma vez.
- **Só fotos publicadas contam:** uma foto ocultada ou retirada (pedido de remoção, batota) deixa de dar pontos sem se apagar nada.
- **Medalhas**, pelo total de sempre: bronze com 10 pontos, prata com 50, ouro com 200. Sem prémios.
- **Ranking:** `/ranking` (do mês e de sempre), em tabela, com o nome de crédito, a medalha, as fotos e os pontos; `/api/v1/ranking?period=month|all`. Quem sai do ranking na conta deixa de aparecer, e os pontos continuam a contar para si.

## Crédito

O crédito de uma foto é o nome de quem a enviou: por defeito o nome no OSM; se a pessoa escolher um **pseudónimo** («nome a mostrar», na conta), esse. Vai em todo o lado: nas páginas dos postos, no ranking, na API (`photos.credit`), na etiqueta `OlhaOPosto|author` do Panoramax (que o nosso servidor mostra como autor da foto, `infra.md`, «Autor das fotos no Panoramax») e no XMP das três cópias em `pictures`. O `uploader_id` fica sempre, para a moderação.

- **Regras** (`src/credit.ts`): de 2 a 40 caracteres depois de normalizar (NFC, espaços colapsados, sem caracteres de controlo nem invisíveis); letras, números, espaços e pontuação simples (`. , ' ’ ( ) ! ? & + _ -`); nada que pareça um link (`://`, `www.`, `palavra.palavra`); alguns nomes reservados (o do site, `admin`, `moderador`…).
- **Unicidade:** não pode ser igual ao nome OSM nem ao pseudónimo de outra conta, comparando sem acentos, maiúsculas, espaços nem pontuação (`João Silva` = `joao_silva`). O próprio nome OSM, noutra grafia, é da pessoa. Um índice único em `pseudonym_key` apanha dois pedidos ao mesmo tempo.
- **Uma mudança por dia** (24 horas desde a última, `pseudonym_changed_at`), contando também voltar ao nome OSM.
- **Mudar o crédito** escreve numa transação o nome novo em `users`, o `photos.credit` de todas as fotos da pessoa e as marcas do que falta refazer: `selections.credit_pending` (as cópias de cada foto principal) e `photos.author_tag_old` (a etiqueta no Panoramax). Um primeiro lote corre logo a seguir (`waitUntil`) e o *cron* de 6 em 6 horas continua até não haver marcas. As cópias reescrevem-se no próprio `pictures` (só o XMP muda, com escrita condicional pelo *etag*, para não pisar uma principal nova) e são purgadas; a etiqueta troca-se com um `PATCH /api/pictures/{id}` que apaga o valor antigo e o novo e acrescenta o novo, por isso repetir é inofensivo. As cópias que outras pessoas já fizeram ficam com o nome antigo, e o histórico de etiquetas do Panoramax guarda-o.

## Tokens de API

Na conta, cada pessoa cria *tokens* (até 5 ativos) com um nome, os âmbitos (`photos:write`; `selections:write` só para moderadores e administradores) e a validade (30, 90 ou 365 dias). O *token* aparece uma vez; a D1 guarda só o hash. Age como a conta, com o papel e os limites dela, lidos em cada pedido. O envio pela API é só `mode=clean`: o cliente manda as três fotos já desfocadas e sem EXIF, com as coordenadas e a data no JSON, e o Worker recusa ficheiros com metadados. Não passa pelo Turnstile.

## Servidor MCP

Servidor MCP remoto no mesmo Worker, em `/mcp`, com o nome `OlhaOPosto` e o transporte *Streamable HTTP*. Usa o `createMcpHandler` do Agents SDK da Cloudflare (`agents/mcp/server`, com o SDK v2 do MCP): sem estado, um servidor novo a cada pedido, sem Durable Object, porque nenhuma ferramenta guarda nada entre chamadas (o `McpAgent`, com Durable Object, está descontinuado pela Cloudflare). O SDK usa o `AsyncLocalStorage`, por isso o Worker tem a *flag* `nodejs_compat`.

As ferramentas (`src/mcp.ts`, descrições em inglês) chamam as mesmas funções que a API REST, para a validação, a licença, a moderação e os limites serem iguais para pessoas e para agentes. As respostas de fotos levam o crédito, a licença e a `attribution` pronta a colar; os erros das escritas são os códigos da API (`daily_limit`, `bad_photo`, `station_nearby`…), com uma explicação.

| Ferramenta | Faz | Precisa de |
| --- | --- | --- |
| `search_stations` | Por texto, por coordenadas e raio, ou só por filtros: operador (`opc`), concelho, `has_photo` (`searchStations`, `nearStations` e `filterStations`, como a API REST) | — |
| `get_station` | Posto (pelo id ou pelo código EVSE de uma tomada), tomadas e as fotos principais | — |
| `get_photo_link` | Link estático de um posto ou tomada num tamanho, com a atribuição; ou a página de envio, se ainda não há foto | — |
| `list_missing_photos` | Postos ativos, ou tomadas com código EVSE, sem foto, por concelho ou operador, para campanhas | — |
| `list_main_photos` | Todas as fotos principais (como `/api/v1/main-photos`), às páginas | — |
| `get_ranking` | O ranking do mês ou de sempre | — |
| `submit_photo` | Envio dos três tamanhos já limpos (base64 ou URL https), como o `POST /api/v1/photos` | `photos:write` |
| `set_primary_photo` | Escolher a foto principal, como o `PUT /api/v1/selections/{target}` | `selections:write` e conta de moderador ou administrador |
| `get_photo` | Uma foto, como o `GET /api/v1/photos/{id}` (`getPhoto`) | — |
| `delete_photo` | Retirar uma foto, como o `DELETE /api/v1/photos/{id}` (`deletePhoto`): a própria, ou a de outra pessoa por um moderador, com motivo | `photos:write` |

**Quem chama** (`src/oauth.ts`, `src/mcpauth.ts`):

- **Ninguém**: as ferramentas de leitura funcionam, para qualquer assistente mostrar fotos de um posto. Uma chamada a uma ferramenta de escrita recebe o `401` com o `WWW-Authenticate` do OAuth, e o cliente inicia sessão e repete-a.
- **OAuth** (`@cloudflare/workers-oauth-provider`): metadados em `/.well-known/oauth-protected-resource/mcp` e `/.well-known/oauth-authorization-server`, registo dinâmico de clientes em `/oauth/register`, *tokens* em `/oauth/token`. A página de consentimento (`/oauth/authorize`) é nossa: pede o login OSM do site (volta lá depois), mostra o nome que a aplicação dá de si, para onde volta (com um aviso se for um programa local) e o que o agente vai poder fazer, com os âmbitos que o papel permite. A autorização guarda só a conta e os âmbitos escolhidos; o papel lê-se da D1 em cada pedido, como nos *tokens* de API, e um âmbito que o papel perdeu deixa logo de valer. *Tokens* de acesso de uma hora, renovados enquanto o agente for usado; 30 dias sem uso e caduca. As autorizações, os clientes e os *tokens* ficam no KV `OAUTH_KV` (com hash ou cifrados pelo próprio *provider*), não na D1. Na conta, «Agentes ligados» lista-as e desliga-as (`revokeGrant`), e o *cron* de 6 em 6 horas limpa o que expirou.
- **Um *token* de API** (`Authorization: Bearer oop_…`): o Worker confere-o como na API REST, com os mesmos âmbitos.

O deploy cria o KV se ainda não existir. Sem o KV ligado, o OAuth responde `503` e só funcionam a leitura e os *tokens* de API. O `/mcp` partilha o limite de pedidos da pesquisa (60 por minuto por IP) e os *endpoints* do OAuth o do login (10 por minuto).

