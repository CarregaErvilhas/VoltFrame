# Cloudflare — recursos do olh'o'posto

Zona `ocarroeletrico.com`, na conta Cloudflare existente. O servidor Panoramax (Zerops, bucket `panoramax`, DNS do `panoramax.*`) está em [`infra.md`](infra.md). O porquê está em [`arquitetura.md`](arquitetura.md), secções *Nomes e domínios* e *Links estáticos*; o que falta, em [`plan.md`](plan.md).

**A zona é partilhada.** Aqui estão só os recursos do olh'o'posto. O que vale para a zona toda e afeta outros projetos (TLS, *rate limiting*, regras WAF, cache, *redirects* e que CLI gere o quê) está em [Cloudflare: zone-wide rules](https://github.com/CarregaErvilhas/Architecture/blob/main/Docs/cloudflare-zone.md) (em inglês): atualizar lá no mesmo passo que mudar uma regra.

**Que CLI.** Os recursos da conta e da zona (R2, domínios, DNS, Cache Rules, purgas) fazem-se com o `cf`. O Worker, a D1 e os segredos do Worker continuam com o wrangler, sempre pelos *scripts* do `npm` (`npm run dev`, `npm run deploy`, `npm run remote`): o projeto tem `wrangler.json`, o deploy depende do truque do ID da D1 (secção 4), o Workers Builds corre o `npm run deploy`, e o `cf` (em beta) ainda não faz `secret put`. Não correr `cf dev`, `cf deploy` nem `cf migrate` aqui: geram outra configuração que ignora o `wrangler.json`.

## 1. Estado

| O quê | Estado |
| --- | --- |
| R2 `pictures` | Criado (WEUR), público em `pictures.ocarroeletrico.com`; ligado ao Worker (`PICTURES`), que escreve as fotos principais ao aprovar |
| R2 `pictures-staging` | Criado (WEUR), privado; ligado ao Worker (`STAGING`). Sem regra de ciclo de vida, de propósito (secção 2) |
| Cache Rule do `pictures.*` | Aplicada e testada |
| D1 `pictures` | Criada, jurisdição EU, com o import de hora a hora. O deploy aplica as migrações novas antes do Worker |
| Worker `olhaoposto` em `olhaoposto.ocarroeletrico.com` | Publicado: páginas dos postos, pesquisa por texto e por proximidade, API (leitura aberta; escrita com sessão ou *token*), `sitemap.xml`, privacidade e condições de utilização, seletor de tema, o login OSM, a conta (pontos, *tokens*), o ranking e a página de envio. O envio (`POST /api/v1/photos`) está aberto, com moderação; aprovar publica a foto principal em `pictures.*` |
| Servidor MCP (`/mcp`) | No código: leitura sem login e escrita com *token* de API. O OAuth usa o KV `olhaoposto-oauth`, que o deploy cria se faltar (secção 4, *Servidor MCP*); sem ele, o OAuth responde `503` |
| Início de sessão com o OSM | Ligado: aplicação registada no OSM (só `read_prefs`) e segredos postos (secção 4) |
| Deploy do Worker | `npm run deploy` (migrações e depois o Worker). Workers Builds ligado: corre isso a cada push para `main` (secção 4, *Deploy automático*) |
| Import dos postos | Workflow `import-stations.yml`, de hora a hora (`cron` no próprio workflow) e à mão (`workflow_dispatch`); segredos do repositório postos |

## 2. R2

| Bucket | Acesso | Para quê |
| --- | --- | --- |
| `pictures` | Público só pelo custom domain `pictures.ocarroeletrico.com`; `r2.dev` desligado | Links estáticos: as três chaves de cada foto principal |
| `pictures-staging` | Privado: sem domínio, `r2.dev` desligado | Versões de 1024 e 400 px de cada foto, enquanto ela existir |
| `panoramax` | Privado ([`infra.md`](infra.md), secção 5) | Armazenamento do Panoramax |

O `pictures-staging` tem de ser um bucket à parte, não um prefixo em `pictures`: tudo o que está em `pictures` fica público pelo domínio.

**Sem regra de ciclo de vida no `pictures-staging`, de propósito.** As cópias não servem só até à aprovação: trocar a principal (`chooseMain` em `src/publish.ts`, pelo `PUT /api/v1/selections/{target}` e por «Tornar principal»), a fusão de um posto em construção (`publishMain`, a partir de `src/construction.ts`) e as miniaturas da moderação e de «os meus envios» leem as de 1024 e 400 px de fotos publicadas há muito tempo. Uma regra por idade apagava-as e partia esses caminhos. As cópias de fotos recusadas ou removidas já saem no momento (`src/moderation.ts`, `src/takedown.ts`), e um envio que falha a meio apaga as suas (`src/photos.ts`). Rever se o código deixar de ler o `pictures-staging` depois da aprovação, ou se aparecerem cópias sem foto na D1.

## 3. `pictures.ocarroeletrico.com`

**Custom domain.** TLS mínimo **1.3**. Fica de fora quem só fala TLS 1.2: Android 9 e mais antigos, iOS anterior ao 12.2, apps nativas do Windows 10 (Schannel, .NET Framework, PowerShell 5) e Java ou Python com OpenSSL antigo. Se alguma app ou mapa se queixar, baixar para 1.2 com `cf r2 buckets domains custom update pictures.ocarroeletrico.com --bucket-name pictures --min-tls 1.2`.

**Cache Rule** (fase `http_request_cache_settings` da zona, a regra «pictures: static R2 links…», `http.host eq "pictures.ocarroeletrico.com"`):

- **Edge TTL de 30 dias**, ignorando o `Cache-Control` do objeto. A frescura vem da purga que o Worker faz ao mudar a foto principal, não do TTL.
- **4xx e 5xx: nunca ficam em cache** (4xx em *no-store*). Um posto sem foto dá `404` e esse `404` não fica guardado, por isso uma primeira foto aparece logo, sem purga. O custo é que cada pedido de um posto sem foto chega ao R2 (uma leitura Classe B).
- **Browser TTL: o do objeto.** O Worker grava cada objeto com `Cache-Control: public, max-age=86400` (`httpMetadata.cacheControl` no `put`). Sem isso o browser não recebe `Cache-Control` nenhum.
- **Query strings fora da chave de cache.** `?x=1` serve a mesma cópia, por isso ninguém fura a cache para gerar leituras Classe B no R2.

**CORS no bucket** (`public-read`): `GET` e `HEAD` de qualquer origem, `maxAgeSeconds` 86400. Um `<img>` não precisa disto, mas os mapas web (MapLibre) carregam imagens por `fetch` e falham sem `Access-Control-Allow-Origin`. Testado: com `Origin` a resposta leva `*`, também quando vem da cache (HIT).

Verificar:

```bash
# sem foto: 404, cf-cache-status: BYPASS (o 404 não fica em cache)
curl -sI https://pictures.ocarroeletrico.com/NAO-EXISTE.jpg | grep -iE '^(HTTP|cf-cache-status)'
# TLS 1.2 tem de ser recusado (000); o pedido normal, em 1.3, dá 404
curl -s -o /dev/null -w '%{http_code}\n' --tls-max 1.2 https://pictures.ocarroeletrico.com/NAO-EXISTE.jpg
```

Purga à mão (o Worker faz o mesmo pela API ao mudar a principal):

```bash
cf cache purge -z ocarroeletrico.com -f --body '{"files":["https://pictures.ocarroeletrico.com/<id>.jpg"]}'
```

No `cf`, os comandos que apagam ou substituem (`r2 objects delete`, `r2 buckets cors update`) pedem `--force` quando não há terminal interativo.

## 4. Worker e D1

O código está em `worker/`. O Worker chama-se `olhaoposto` e responde em `olhaoposto.ocarroeletrico.com` (custom domain; `workers.dev` e *preview URLs* desligados). Por agora tem:

| Pedido | Devolve |
| --- | --- |
| `GET /api/v1/stations/{id}` | Posto e pontos (cada um com o `evse` e o `compact`, o código sem `*` que dá o nome ao link estático), cada um com a foto principal (`photo`, ou `null`), com CORS e `max-age=300`. `404` para ids que não existem e para propostas ou postos rejeitados |
| `GET /api/v1/photos/{id}` | Uma foto publicada (`src/photoapi.ts`): crédito, licença, alvo, posto, tamanhos, id no Panoramax. Com CORS e `max-age=300`. O autor e os moderadores, com *token* ou sessão, veem também as outras (com o estado e o motivo da recusa), sem cache. `404` para as outras |
| `GET /api/v1/photos.json` | Exportação de todas as fotos publicadas (galeria incluída). A Cache API do Worker guarda-a um dia (`max-age=86400`), como o `sitemap.xml`; remover uma foto faz *purge* deste URL (`EXPORT_URLS` em `src/takedown.ts`) |
| `GET /api/v1/openapi.json` | A API em OpenAPI 3.1 (`src/openapi.ts`). O teste `test/openapi.test.ts` falha se uma rota de `/api/v1` do `src/index.ts` não estiver lá |
| `GET /postos/sem-foto`, `/en/stations/without-photo` | Postos públicos sem foto principal, com pesquisa por texto (FTS5, como a `/pesquisa`), filtros por concelho e operador (caixas com `datalist`) e uma ligação ao envio de cada um (`src/nophoto.ts`). Conta os postos por concelho e operador de cada vez (uma leitura da tabela `stations`), com `SEARCH_LIMIT` e `max-age=300` |
| `GET /api/v1/evses/{evse}` | Tomada pelo código EVSE, com ou sem os `*` (`PT*EZC*E*AMD*00051*1` ou `PTEZCEAMD000511`), e o posto a que pertence, cada um com a foto principal (`photo`, ou `null`). `300` com a lista `candidates` se o código estiver em mais de um posto |
| `GET /postos/{id}` | Página do posto: tomadas com o código EVSE, links estáticos de cada tamanho para copiar, ligação ao OSM. `404` em HTML como na API |
| `GET /tomadas/{evse}` | `302` para `/postos/{id}#t-{evse}`, com a tomada marcada; uma página com a lista se o código estiver em mais de um posto. `302` e não `301`, porque um código pode mudar de posto |
| `GET /api/v1/stations?q=&limit=` | Pesquisa por texto em `stations_fts` (FTS5): cada palavra tem de aparecer, como prefixo, no código, nome, morada, localidade ou operador; sem acentos (`acores` encontra `Açores`). Postos públicos, os melhores primeiro, `limit` até 50 (20 por omissão). `400` sem uma palavra de pelo menos dois caracteres |
| `GET /api/v1/stations?opc=&municipality=&has_photo=&after=` | Os filtros juntam-se à pesquisa por texto e por proximidade, ou usam-se sozinhos (lista por id, em páginas, com `next`/`after`). `has_photo=false`: postos sem foto principal publicada. `400` `bad_filter` |
| `GET /api/v1/stations?lat=&lon=&radius=&limit=` | Postos públicos a menos de `radius` metros (500 por omissão, até 5000), do mais perto para o mais longe, cada um com `distance_m`. Usa o índice `stations_lat_lon` (migração `0005`) para uma caixa à volta do ponto e corta o círculo no Worker. `400` com coordenadas em branco ou fora do intervalo, ou com `q` e coordenadas ao mesmo tempo |
| `GET /pesquisa?q=` | A mesma pesquisa em HTML, 20 resultados, `noindex` e fora do *sitemap*. Um código de posto ou de tomada escrito por inteiro faz `302` para a página dele |
| `GET /` | Página inicial com a caixa de pesquisa e os três postos com fotos mais recentes (lê a D1 a cada pedido). Com miniaturas, a CSP acrescenta o `panoramax.ocarroeletrico.com` em `img-src` |
| `GET /en/`, `/en/stations/{id}`, `/en/sockets/{evse}`, `/en/search` | As mesmas páginas em inglês. `/en/sockets/{evse}` faz `302` para `/en/stations/{id}#t-{evse}` |
| `GET /sitemap.xml` | Página inicial, privacidade, grupo e todos os postos públicos, nas duas línguas, com `lastmod` (a última alteração do posto ou de uma tomada). Fica um dia na Cache API: cada geração lê os postos e as tomadas (cerca de 28 mil linhas), uma vez por dia e por centro de dados |
| `GET /robots.txt`, `/llms.txt` | Ficheiros estáticos em `worker/public/`. O `robots.txt` deixa entrar todos os robôs, incluindo os de IA, e aponta para o *sitemap*. O `llms.txt` descreve as páginas, a API, o servidor MCP, os links estáticos e as licenças; as páginas HTML apontam para ele no cabeçalho `Link` (`rel="describedby"`) |
| `POST /mcp` | Servidor MCP `OlhaOPosto` (*Streamable HTTP*, sem estado), ver *Servidor MCP*, abaixo. `GET` dá `405` |
| `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `/.well-known/oauth-*` | O OAuth do MCP: consentimento (nosso, com o login OSM), *tokens*, registo dinâmico e metadados (do `workers-oauth-provider`). `503` sem o KV |
| `GET /privacidade`, `/en/privacy` | Política de privacidade (`src/privacy.ts`), com ligação no rodapé de todas as páginas e no *sitemap*. Muda no mesmo PR que mudar o que o Worker guarda |
| `GET /condicoes`, `/en/terms` | Condições de utilização (`src/terms.ts`): o que aceita quem envia fotos ou usa um *token*. Ligação no rodapé, no consentimento da página de envio e no *sitemap* |
| `GET /grupo`, `/en/group` | Os outros sites do grupo d'O Carro Elétrico, cada um com a sua mascote (`src/grupo.ts`; ordem e textos de `brand/group.json`, imagens copiadas de `brand/` para `public/grupo/`; o servidor Panoramax leva o logótipo do Panoramax). Mesma ordem e mesmos textos da página igual dos outros sites do grupo. Ligação no rodapé de todas as páginas e no *sitemap* |
| `GET /conta`, `/en/account` | A conta de quem tem sessão (`src/account.ts`): nome, papel, ligação para o envio, nome a mostrar (pseudónimo), pontos e medalha, sair ou voltar ao ranking, *tokens* de API (criar, listar, revogar) e o botão para terminar; ou o botão para iniciar sessão. Lê a sessão: `no-store` e `noindex` |
| `POST /conta/acao` | As ações da conta (`action`: `set_credit`, `reset_credit`, `create_token`, `revoke_token`, `ranking_out`, `ranking_in`), só do próprio site. Criar um *token* responde com a própria página, que o mostra uma vez; nunca vai num URL nem num redirect |
| `GET /ranking`, `/en/ranking`, `/api/v1/ranking?period=month\|all` | Tabela dos 50 primeiros (nome, medalha, fotos, pontos) e as regras dos pontos (`src/points.ts`). Só contam fotos publicadas; quem saiu do ranking não aparece |
| `GET /enviar`, `/en/upload` | Página de envio (`src/upload.ts` e `public/upload.js`), só com sessão; sem ela, o botão para iniciar sessão. Lê a sessão: `no-store`, `noindex`, fora do *sitemap*. A CSP desta página acrescenta `connect-src 'self'` (pede postos à API, e os ficheiros do HEIC e da deteção de caras), `blob:` e `https://tile.openstreetmap.org` em `img-src` (a foto preparada e o mapa), `'wasm-unsafe-eval'` em `script-src` (compilar o WebAssembly do libheif e do MediaPipe; não permite `eval` de JavaScript) e o Turnstile. O formulário de remoção tem a sua CSP, só com o Turnstile |
| `GET /auth/osm/login?next=` | `302` para o OpenStreetMap, com `state` e PKCE num *cookie* de 10 minutos. `503` enquanto não houver os segredos do OSM |
| `GET /auth/osm/callback` | Volta do OpenStreetMap: troca o código, lê o utilizador, cria a sessão e faz `302` para o `next`. Qualquer falha volta à conta com `?erro=` |
| `POST /auth/logout?next=` | Apaga a sessão e faz `303` para o `next`. `403` se o pedido vier de outro site |
| `POST /api/v1/photos` | Envio de uma foto, com sessão do próprio site ou com um *token* `photos:write` (ver *Envio* e *Tokens de API*). `503` `uploads_closed` se faltar um segredo |
| `DELETE /api/v1/photos/{id}` | O autor retira a sua foto, um moderador ou administrador qualquer uma (`src/photoapi.ts`, `removePhoto` em `src/takedown.ts`), com sessão do próprio site ou *token* `photos:write`. Oculta as cópias, purga a cache, apaga o *upload set* no Panoramax e passa a foto a `removed`; uma principal perdida fica em «Sem foto principal». Um moderador pode mandar `{reason, note}` |
| `PUT /api/v1/selections/{target}` | Escolher a foto principal de um posto ou tomada (`{"photo": "<id>"}`), para moderadores e administradores, com sessão do próprio site ou *token* `selections:write`. Copia os três tamanhos por cima e faz *purge* |

As páginas são HTML feito no Worker (`src/pages.ts`), sem *framework*. Os ficheiros de `worker/public/` (CSS, *scripts*, fontes, ícones) são *static assets* do Worker: a Cloudflare serve-os antes de o código correr e não contam para o limite de pedidos. O `public/_headers` dá às fontes um ano de cache (`immutable`): uma fonte nova leva um nome de ficheiro novo. O CSS e os *scripts* (`site.js`, `theme.js`, `upload.js`, `jpeg.js`, `heif.js`, `heic.js`, `detect.js`) e as bibliotecas de `public/vendor/` mantêm o nome, por isso vão com `no-cache`: o browser confirma-os (ETag) em cada página e um deploy nunca junta HTML novo com CSS antigo.

**Seletor de tema** (`public/theme.js`). Automático (segue o sistema), claro ou escuro, no cabeçalho. Carrega no `<head>` sem `defer`, para o tema estar posto antes de a página aparecer. "Automático" não guarda nada; claro ou escuro ficam em `localStorage` (`vf-theme`), só no browser. Sem JavaScript o seletor fica escondido e vale o tema do sistema.

**Links externos** (OSM, o código no GitHub) e o JSON da API abrem num separador novo, com `rel="noopener"`.

**Duas línguas, URLs fixos.** As páginas em pt-PT ficam onde estavam; o inglês vive em `/en/`. Não há redirecionamento pelo `Accept-Language` (os robôs de pesquisa só veriam uma língua): cada página tem um link para a outra língua, o seu próprio `canonical` e os `hreflang` das duas (`pt-PT`, `en`, `x-default` para o pt-PT). Os textos do NAP (nomes, moradas, operadores) não se traduzem; nas páginas em inglês vão marcados com `lang="pt-PT"` para os leitores de ecrã. Todas as frases estão num único dicionário em `src/pages.ts`.

**Acessibilidade.** Contraste de pelo menos 4,5:1 no texto e 3:1 nos contornos dos botões, nos temas claro e escuro. Tamanhos de letra em `rem` e sem tamanho no `html`, para respeitar o tamanho de letra do browser e do sistema; a página passa a 320 px de largura com texto a 200 % sem *scroll* horizontal. Há regras para `prefers-contrast: more` e para o modo de cores forçadas do Windows. O botão de copiar anuncia o resultado numa região `role="status"` e troca o ícone, em vez de mudar só a cor.

**Nada de terceiros nas páginas.** As fontes (Inter, Space Grotesk, JetBrains Mono) estão alojadas em `public/fonts/`, não no Google Fonts. A CSP só deixa carregar ficheiros do próprio site e imagens de `pictures.*` (e, nas páginas que as mostram, dos nossos `panoramax.*` e `nap.*`), e não permite *scripts* nem estilos *inline*: tudo vai em `site.css` e nos *scripts* de `public/`. A página de envio é a única com uma CSP mais larga (ver a tabela acima): o Turnstile e, só se a pessoa abrir o mapa, os mosaicos do OpenStreetMap.

**Ficheiros do grupo** (`scripts/brand.ts`). As mascotes e o `install.js` vêm do submódulo `brand/` ([CarregaErvilhas/Brand](https://github.com/CarregaErvilhas/Brand)), fixado numa tag, e são copiados para `public/` (ignorados pelo git) pelo `npm run vendor` e antes do `npm test`. O Worker importa o `brand/group.json` no *build*. Se o submódulo faltar, o *script* corre `git submodule update --init`.

**Bibliotecas do browser** (`scripts/vendor.ts`). A página de envio usa três bibliotecas, todas `devDependencies` com versão exata (o Dependabot do npm atualiza-as): `libheif-js` (LGPL-3.0, fotos HEIC), `@mediapipe/tasks-vision` (Apache-2.0, deteção de caras) e `leaflet` (BSD-2-Clause, o mapa). Nenhum ficheiro delas vai para o repositório: o `npm run vendor` copia-os de `node_modules` para `public/vendor/` (ignorada pelo git), e corre antes do `npm run dev` e no início do `npm run deploy`. O WebAssembly do MediaPipe tem cerca de 15 MB (o limite por ficheiro dos *static assets* é 25 MiB) e só se descarrega quando a página procura caras. O modelo de caras (BlazeFace, Apache-2.0, 230 kB) está em `public/models/`, com a origem e o SHA-256 no `README.txt` ao lado. As páginas levam também HSTS, `nosniff`, `referrer-policy` e COOP; a API leva `x-robots-tag: noindex`, porque é para apps e agentes, não para resultados de pesquisa.

**Registos do Worker** (`observability` no `wrangler.json`). Cada pedido fica nos Workers Logs com o URL (incluindo o texto das pesquisas), o IP, a localização que a Cloudflare tira dele e o navegador; os cabeçalhos `cookie` e `authorization` aparecem como `REDACTED`. Retenção: 3 dias no plano Free, até 7 com os preços novos da Cloudflare. É isto que a política de privacidade descreve; se a retenção ou os campos mudarem, ela muda também.

**Início de sessão com o OpenStreetMap** (`src/auth.ts`, migração `0004`). OAuth2 com PKCE (S256), só o âmbito `read_prefs`: chega para ler o número e o nome da conta, não dá o email nem deixa editar o mapa. O *token* do OSM serve uma vez, para ler `user/details`, e é revogado logo a seguir. A sessão é do olh'o'posto: um *cookie* `__Host-oop_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 dias) com um valor aleatório, e na tabela `sessions` só o SHA-256 dele. As sessões expiradas saem no login seguinte. A tabela `users` guarda o número e o nome no OSM (o nome e o `osm_key` atualizam-se em cada login), o papel (`contributor` por omissão), o pseudónimo, a promoção e a licença. As páginas dos postos e da pesquisa não leem a sessão, por isso continuam em cache e sem ida à D1; só a conta e o envio (`/conta`, `/enviar` e as versões em inglês) a leem.

Fica **desligado** até existirem os segredos do Worker `OSM_CLIENT_ID` e `OSM_CLIENT_SECRET`: até lá, `/conta` e `/enviar` dizem que ainda não está disponível e `/auth/osm/*` responde `503`. Para ligar (só o responsável do projeto):

1. Confirmar que a política de privacidade (`/privacidade`) está publicada e certa, incluindo o parágrafo sobre a página de envio.
2. Registar a aplicação em `openstreetmap.org/oauth2/applications`: nome "olh'o'posto", confidencial, só "Ler as preferências do utilizador" (`read_prefs`), *redirect* `https://olhaoposto.ocarroeletrico.com/auth/osm/callback`.
3. `npm run remote -- secret put OSM_CLIENT_ID` e o mesmo para `OSM_CLIENT_SECRET` (pedem o valor; nunca num ficheiro do repositório).

O `secret put` publica logo uma versão nova do Worker: não é preciso outro deploy. Ligar o login também abre `/enviar` a quem iniciar sessão: a página só prepara a foto, mas pede à API os postos à volta do GPS arredondado, e esse URL fica nos registos (a política já o diz). Para desligar outra vez, `npm run remote -- secret delete OSM_CLIENT_ID`.

Em local, o `worker/.dev.vars` (ignorado pelo git) pode apontar `OSM_URL` para o servidor de testes do OSM (`https://master.apis.dev.openstreetmap.org`, com conta e aplicação próprias, *redirect* `http://127.0.0.1:8787/auth/osm/callback`) ou para um servidor falso. O `wrangler dev` mostra ao Worker o domínio de produção como *host*; com `--local-upstream 127.0.0.1:8787` o `redirect_uri` fica local.

**Papéis** (`/admin/utilizadores` e `/en/admin/users`, `src/admin.ts`). Só para moderadores e administradores; quem não tem sessão vai para o login, outro papel recebe `403`. Lista as contas (as 200 com sessão mais recente, com pesquisa pelo nome no OSM) e muda o papel com um `POST /admin/papel` (mesma origem). Um administrador dá qualquer papel; um moderador só muda entre `contributor` e `trusted`, e nunca mexe em moderadores ou administradores. Ninguém muda o próprio papel, para o último administrador não se trancar fora. Cada mudança guarda `promoted_by` e `promoted_at`, e só escreve se o papel ainda for o que a página mostrava. O primeiro administrador foi promovido à mão na D1. Antes do Worker há uma segunda porta, o Cloudflare Access (*Acesso de administração*, abaixo).

**Aliases de postos** (`/admin/postos-fora-do-nap` e `/en/admin/stations-missing`, `src/aliases.ts`). Só para moderadores e administradores. Lista os postos `missing_from_nap` que ainda têm fotos; o moderador escreve o código do posto novo e cria o alias (`POST /admin/rekey`). O link antigo responde `301` para o novo (páginas e `/api/v1/stations/{id}`). Migração `0009_station_aliases.sql`. Lista também os postos em construção com fotos que saíram do OSM ou têm um posto do NAP parecido (mesmo elemento OSM ou um dos códigos, a qualquer distância, ou a menos de 60 m), com o código sugerido já escrito; aí o botão é «Juntar ao posto do NAP» e faz a fusão inteira (alias, fotos, estado `merged`, etiqueta marcada), numa transação.

**Pedidos de remoção** (`/report` e `/en/report`, públicos, com o mesmo nome do Panoramax; `/admin/remocoes` e `/en/admin/takedowns`, só moderadores; `src/takedown.ts`). Assentam nas denúncias do próprio Panoramax (`/api/reports`), sem tabela nossa. No Panoramax, uma denúncia por desfocagem em falta, privacidade, conteúdo impróprio ou direitos de autor põe logo a foto em `owner-only` (um *trigger* da BD; a denúncia nasce `open_autofix`). O que o Panoramax não conhece são as nossas cópias, e é disso que o Worker trata.

O formulário não pede conta nem contacto e usa o mesmo widget Turnstile do envio, com a ação `takedown` (um código do envio não serve aqui). A pessoa escreve o código do posto ou da tomada, ou cola o link da foto, da página ou do Panoramax; a página do posto tem um link «Pedir remoção» na legenda da foto que já o preenche. Se não corresponde a nenhuma foto publicada, a pessoa fica a saber (os links estáticos são públicos, não há nada a esconder). Se corresponde:

1. O Worker cria a denúncia no Panoramax **sem o token**: o Panoramax vê primeiro se quem edita é o autor da denúncia e só depois se é o dono da foto, e o autor não a pode fechar como ignorada. Todos os motivos do formulário correspondem a um tipo que oculta logo; o motivo vai no início do comentário.
2. Oculta as nossas cópias: `photos.status` passa a `hidden` (o site, a API e o `/main-photos` deixam de a mostrar, no máximo 5 minutos de cache), a foto no Panoramax passa a `owner-only` (o mesmo que o *trigger* faz), as cópias saem do R2 `pictures` e os URLs do `pictures.*` e das imagens do `panoramax.*` são purgados. As linhas de `selections` só passam a perdidas (`lost_at`, migração `0015`) depois de a purga correr bem: enquanto não passarem, há algo por limpar. Depois ficam, para a lista «Sem foto principal» (ver abaixo), e a sincronização dos créditos não lhes toca.

**Cron a cada 6 horas** (`triggers.crons` no `wrangler.json`, `scheduled` no `src/index.ts`). É um *cron* e não um *webhook* porque o Panoramax não avisa ninguém quando chega uma denúncia. Com a regra WAF e o botão do visualizador a mandar toda a gente para o formulário, o formulário já oculta as cópias na hora, e o cron fica para o que pode falhar a meio:

- Repete as ocultações que deixaram linhas de `selections` por marcar como perdidas (o R2 ou a purga falharam). Sem isto, um link estático ficava público até alguém abrir o painel, ou até 30 dias na cache.
- Rede de segurança: lê as denúncias abertas das fotos da conta de serviço (`/api/users/me/reports`; é dona de todas, chega para as ler e fechar sem ser admin) e oculta as nossas cópias de qualquer foto que o Panoramax tenha ocultado sem passar pelo formulário (por exemplo, se a regra WAF for desligada).

O painel faz o mesmo ao abrir. É quase só espera de rede, por isso cabe nos 10 ms de CPU do plano Free.

Depois disso, o mesmo *cron* corre um lote do que falta das mudanças de crédito (*Pseudónimo*, abaixo) e um lote do que as fusões de postos em construção deixaram (`src/construction.ts`: até 2 fotos principais de postos do NAP que receberam fotos numa fusão e não tinham principal, e até 5 etiquetas `OlhaOPosto|site` a trocar no Panoramax, `photos.site_tag_old`). Por fim, um pedido de purga com até 100 URLs da `purge_queue` (trocas da principal cuja purga falhou; `drainPurgeQueue` em `src/publish.ts`). Juntos ficam abaixo dos 50 pedidos externos do plano Free.

No painel, **Remover** limpa as cópias, apaga o *upload set* no Panoramax (a denúncia vai com ele) e as cópias do `pictures-staging` (foto `removed`). **Manter** fecha primeiro todas as denúncias abertas da foto (`closed_ignored`; senão o cron voltava a ocultá-la), torna a foto pública e volta a preencher os links estáticos que ainda estão vazios. As denúncias de uma sequência inteira (só pelo formulário do próprio visualizador, que a regra WAF agora bloqueia) não têm botões: o cron não as segue e tratam-se pela API do Panoramax com o token da conta de serviço. O prazo é de 72 horas; o painel mostra o tempo que falta.

**Sem foto principal** (`/admin/sem-principal` e `/en/admin/no-main`, só moderadores e administradores, e no fim da fila de moderação e do painel de remoções quando há alguma; `src/mains.ts`). Os postos e tomadas cuja principal foi ocultada ou removida (`selections.lost_at`), cada um com uma galeria das outras fotos publicadas do mesmo alvo (miniaturas do `pictures-staging`) e um botão de escolha por foto. «Tornar principal» (`POST /admin/principal`, mesma origem) chama o `chooseMain` do `src/publish.ts`, o mesmo do `PUT /api/v1/selections/{target}`: copia os três tamanhos, faz *purge* e limpa o `lost_at`. Só aceita alvos ainda sem principal (um segundo moderador no mesmo alvo fica a saber que já foi escolhida). Sem outras fotos, a página diz que o alvo fica sem principal até chegar uma nova. Nada passa a principal sozinho.

**Fotos de um posto** (`/admin/posto/{id}` e `/en/admin/station/{id}`, só moderadores e administradores, `no-store`; `src/stationadmin.ts`). Todas as fotos publicadas do posto e de cada tomada, agrupadas por alvo, com a principal marcada (miniaturas do `pictures-staging`). Em cada foto, «Tornar principal» (o `chooseMain`, sem a restrição de alvo sem principal; uma foto de tomada só vai para essa tomada) e «Remover» com motivo e nota (o `deletePhoto` do `DELETE /api/v1/photos/{id}`: sai do Panoramax e dos links, o autor vê o motivo, os pontos deixam de contar). «Mudar para» passa a foto para o posto em geral, outra tomada ou as chapas: primeiro troca as etiquetas no Panoramax (`osm|ref:EU:EVSE` e `OlhaOPosto|kind=plate`, por PATCH com o token do Worker), depois a D1; se o Panoramax falhar, nada muda. A principal não se muda (torna-se outra principal primeiro), e uma foto mudada para um alvo sem principal não passa a principal sozinha. Todos são `POST /admin/posto-foto`, mesma origem. Trocar por uma melhor são dois passos: primeiro tornar a melhor principal, depois remover a antiga se deve sair; remover a principal primeiro deixa o alvo em «Sem foto principal». A página pública do posto está em cache para todos, por isso só tem o link «Moderar as fotos deste posto» escondido, que o `site.js` mostra quando o `GET /api/v1/me` (`no-store`, só o *cookie* de sessão) diz `moderator: true`; a CSP da página do posto ganha `connect-src 'self'` para isso.

**O formulário fica fechado** (mostra o email) enquanto faltarem os segredos do Turnstile, da purga ou o `PANORAMAX_TOKEN`: sem purga, a foto continuaria na cache do `pictures.*` até 30 dias. Os segredos da purga (também usados na troca da foto principal, `PUT /api/v1/selections/{target}`; sem eles, cada troca deixa a foto antiga na cache e fica na `purge_queue` até eles existirem):

1. Um token de API só com *Zone → Cache Purge → Purge*, só na zona `ocarroeletrico.com` (cobre o `pictures.*` e o `panoramax.*`).
2. `npm run remote -- secret put CF_ZONE_ID` (o ID da zona) e `npm run remote -- secret put CF_CACHE_PURGE_TOKEN` (o token). Sem terminal (do telemóvel): no painel, *Workers & Pages → olhaoposto → Settings → Variables and Secrets → Add*, tipo *Secret*, com os mesmos dois nomes; o ID da zona está na página *Overview* da zona. Os segredos ficam nos deploys seguintes.
3. Depois do primeiro pedido real, os três URLs do `pictures.*` têm de dar `404` (`curl -sI`), não um `HIT` da cache. Para a troca da principal: o painel do posto deixa de dizer que a cache não foi limpa, e o `last-modified` do `<alvo>.jpg` passa a ser o da troca. Os registos do Worker mostram `cache purge failed` com o código da Cloudflare quando não corre bem.

**Regra WAF para as denúncias (aplicada).** O `POST /api/reports` do Panoramax não pede conta nem tem Turnstile, e oculta logo: sem filtro, um *script* pode ocultar todas as fotos. A regra só deixa passar as denúncias que trazem o cabeçalho que o Worker envia. O botão «Report» do nosso `/viewer` abre o formulário do olh'o'posto para essa foto (`/report?alvo=<id da foto>`, ou `/en/report` num browser que não esteja em português), em vez do formulário do próprio visualizador (`panoramax/templates/viewer.html`; o `tests/test_viewer.py` falha se uma versão nova do visualizador mudar o que o botão chama).

1. `npm run remote -- secret put PANORAMAX_REPORT_KEY` (um valor aleatório longo, por exemplo `openssl rand -hex 32`; nunca num ficheiro do repositório). Antes da regra existir, o cabeçalho não muda nada.
2. Na zona `ocarroeletrico.com`, *Security → WAF → Custom rules*, uma regra *Block*: `http.host eq "panoramax.ocarroeletrico.com" and http.request.method eq "POST" and starts_with(lower(http.request.uri.path), "/api/reports") and not any(http.request.headers["x-olhaoposto-report"][*] eq "<o valor>")`. **Não usar `eq "/api/reports"`:** o Panoramax aceita também `/api/reports/` (com barra no fim), que um `eq` deixa passar.
3. Testar, sem o valor: um `curl -X POST` sem o cabeçalho ou com um errado dá `403` em `/api/reports`, `/api/reports/` e `/api/reports?x=1`; o `GET /api/` continua a dar `200`. Um pedido no formulário continua a criar a denúncia (o pedido do Worker chega com o cabeçalho).

**Fila de moderação** (`/admin/fila` e `/en/admin/queue`, `src/moderation.ts`). Só para moderadores e administradores. Mostra as fotos `pending` da mais antiga para a mais recente (50 de cada vez), com o posto, quem enviou, a data, o GPS da foto e um aviso quando não há GPS ou a foto está a mais de 300 m do posto. As imagens vêm do `pictures-staging` por `/admin/staging/{id}/{main|thumb}.jpg`, só para moderadores e sem cache. `POST /admin/decidir` (mesma origem):

- **Aprovar:** `PATCH` do upload set no Panoramax para `visibility: anyone` e a foto passa a `published`. Se a tomada ou o posto ainda não têm foto principal, o Worker publica-a em `pictures` (`src/publish.ts`, tabela `selections`, migração `0007`; ver `arquitetura.md`, *Links estáticos*). Se essa cópia falhar, a aprovação fica, as cópias feitas são apagadas e a próxima aprovação desse alvo tenta outra vez. As cópias no `pictures-staging` ficam.
- **Recusar:** apaga o upload set no Panoramax (um `404` conta como apagado), a foto passa a `removed` e as cópias saem do `pictures-staging`.

Se o Panoramax falhar, nada muda. `approved_by` e `approved_at` guardam quem decidiu e quando, nos dois casos, e só se escreve se a foto ainda estiver `pending`.

**Turnstile** (`src/photos.ts`, `src/upload.ts`, `public/upload.js`). Um widget no modo *managed*, só para `olhaoposto.ocarroeletrico.com`. Com o envio aberto, a página carrega o script do Turnstile e põe o widget no passo de envio (aparece só se o Turnstile precisar de uma interação); o `upload.js` manda o token no campo `turnstile` e faz *reset* ao widget depois de cada tentativa, porque cada token só serve uma vez e dura 300 s. O Worker confirma o token no `siteverify` antes de ler a foto ou escrever alguma coisa, com o IP de quem envia, e exige `hostname` `olhaoposto.ocarroeletrico.com` e `action` `upload`; senão responde `403` `turnstile`. A *site key* também é um segredo do Worker (`TURNSTILE_SITEKEY`), para o ID não ficar no repositório; sem os dois segredos, o envio fica fechado. A CSP só da página de envio abre `script-src` e `frame-src` a `https://challenges.cloudflare.com`. Em local, as chaves de teste da Cloudflare (*site key* `1x00000000000000000000AA`) geram um token falso, que o `siteverify` real não aceita.

**Acesso de administração (Cloudflare Access).** Uma aplicação Access (Zero Trust Free) cobre `/admin`, `/admin/*`, `/en/admin` e `/en/admin/*`: antes de chegar ao Worker, quem abre estas paths recebe o ecrã de login da Cloudflare e um código de uso único no email. Só passam os emails da regra *Moderadores*; a sessão dura 24 h. Depois, o Worker ainda pede o login OSM e o papel `moderator` ou `admin`. Nomear um moderador são dois passos: o email na regra do Access e o papel em `/admin/utilizadores`. Os emails vivem só na Cloudflare, nunca no repositório. O resto do site não passa pelo Access.

**Limites de pedidos** (`src/ratelimit.ts`, `ratelimits` no `wrangler.json`). A [única regra de *rate limiting* da zona](https://github.com/CarregaErvilhas/Architecture/blob/main/Docs/cloudflare-zone.md#rate-limiting-the-only-rule) já está ocupada (apanha o `/mcp` de todos os *hosts*, também o nosso). Por isso os limites ficam no Worker, com o *binding* de *rate limiting* dos Workers (grátis):

| Binding | Chave | Limite | Onde |
| --- | --- | --- | --- |
| `UPLOAD_LIMIT` | conta | 6 por minuto | `POST /api/v1/photos`, antes de ler o corpo; `429` `too_fast` |
| `LOGIN_LIMIT` | IP | 10 por minuto | `/auth/osm/login`, `/auth/osm/callback` e `/oauth/*` |
| `SEARCH_LIMIT` | IP | 60 por minuto | `/api/v1/stations` (texto, proximidade e filtros), `/pesquisa`, `/en/search`, `/postos/sem-foto`, `/en/stations/without-photo`, `/mcp` |
| `TAKEDOWN_LIMIT` | IP | 5 por minuto | `POST /report`; volta ao formulário com `erro=limit` |

Acima do limite: `429` com `Retry-After: 60` (JSON na API, uma linha em pt e en nas páginas). Os contadores são por localização da Cloudflare e aproximados: travam scripts e enxurradas, não um ataque espalhado por muitas localizações. O limite exato continua a ser o diário da D1 (50 envios por dia para contribuidores). Se o *binding* faltar ou falhar, o pedido passa. As páginas dos postos não têm limite, para não travar os motores de busca.

**Servidor MCP** (`src/mcp.ts`, `src/oauth.ts`, `src/mcpauth.ts`; o desenho em [`arquitetura.md`](arquitetura.md), *Servidor MCP*). Não precisa de Durable Object (o `createMcpHandler` não guarda estado), mas o Worker passou a ter a *flag* `nodejs_compat` (o SDK usa o `AsyncLocalStorage`) e um KV para o OAuth:

- **KV `olhaoposto-oauth`**, *binding* `OAUTH_KV`. Como a D1, o ID não fica no repositório: o `wrangler.json` tem `local-only` e o `scripts/lib/wrangler.ts` procura o ID pelo título no deploy e nos comandos remotos. Se não o encontrar, o deploy (`npm run deploy`, no Workers Builds) cria-o; se não conseguir (o *token* do build sem permissão de KV), avisa e publica sem o *binding* (o OAuth fica em `503`, o resto do MCP funciona). Os outros comandos remotos (`npm run remote`) só o procuram, nunca o criam; o import e as outras leituras e escritas só da D1 (`d1()`) nem o procuram, porque o *token* do import só tem D1 e listar os KV com ele faz falhar a execução. Guarda os clientes registados (90 dias), as autorizações (1 ano no máximo, 30 dias sem uso) e os *tokens* (1 hora), todos com TTL do próprio KV; o *cron* chama o `purgeExpiredData` para o resto.
- **O `resource`** do OAuth é `https://olhaoposto.ocarroeletrico.com/mcp`, fixo no código: o OAuth só funciona nesse domínio (em local, o `wrangler dev --local-protocol https` simula-o).
- **Sem CIMD** (*client ID metadata documents*): pediria a *flag* `global_fetch_strictly_public`, que muda todos os `fetch` do Worker (ao Panoramax, na mesma zona). Os clientes usam o registo dinâmico.
- **Testar à mão**: `curl -s -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' https://olhaoposto.ocarroeletrico.com/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`; ou o MCP Inspector (`npx @modelcontextprotocol/inspector`) com esse URL.

**Página de envio** (`/enviar`, `src/upload.ts`, `public/upload.js`, `public/jpeg.js`, `public/heif.js`, `public/heic.js` e `public/detect.js`). Tudo o que mexe na foto corre no browser. Com o envio fechado (falta um segredo), a página para no passo 5 e oferece o download para testar; aberto, o botão passa a "Enviar a foto" e manda os três tamanhos ao Worker:

1. Abre um JPEG ou um HEIC (até 40 MB). Podem escolher-se várias fotos: tratam-se uma de cada vez («Foto seguinte», «Saltar esta foto»), e o posto da foto anterior enviada fica sugerido para a seguinte quando esta não tem GPS ou foi tirada a menos de 500 m dele. O JPEG abre com `createImageBitmap`, que aplica a rotação do EXIF. O HEIC tenta o mesmo (o Safari descodifica-o) e, se o browser não souber, usa o libheif em WebAssembly (`heic.js`), carregado só nessa altura. O lado maior fica em 2048 px.
2. Lê o GPS, a `DateTimeOriginal` e a `Orientation` com o leitor próprio de `jpeg.js`; num HEIC, o `heif.js` encontra o item Exif nas caixas `meta`/`iinf`/`iloc` e passa o bloco TIFF ao mesmo leitor. Nunca lança erro com um ficheiro mau.
3. Com GPS, arredonda a 3 casas decimais (cerca de 100 m) e pede os postos a 500 m; mostra a distância calculada com o GPS exato, que não sai do dispositivo. Sem GPS, pesquisa por texto ou mapa. Com `?posto=<id>` (a página do posto sem foto e o NAP dashboard ligam assim), esse posto vem primeiro, com a distância ao GPS da foto, e o login e a troca de língua mantêm-no; um id desconhecido conta como ausente. Depois pede o posto para listar as tomadas com código EVSE, numeradas como na página do posto, com a ficha, a potência e o código do autocolante. A pessoa escolhe «Posto em geral», uma tomada ou «Chapa do carregador» (a placa de características, `kind: "plate"`, sempre do posto em geral e sem link estático): não há escolha por omissão. Cada tomada da página do posto liga com `?posto=<id>&tomada=<EVSE>` (qualquer das duas formas do código), que já deixa essa tomada escolhida na primeira foto.
- **Mapa** (Leaflet, mosaicos do OpenStreetMap), só se a pessoa tocar em «Escolher no mapa». A partir do zoom 13 mostra os postos à volta do centro (a API de proximidade, com o centro arredondado a ~100 m e o raio até 5 km); tocar num escolhe-o. «Ir para a minha localização» usa a geolocalização do browser só para centrar o mapa.
4. A página procura caras (`detect.js`, MediaPipe Face Detector com o modelo BlazeFace de curto alcance, no CPU): na foto inteira e numa grelha de 3 × 3 recortes sobrepostos, porque o modelo olha para um quadrado de 128 px e uma cara a uns metros fica pequena demais na foto inteira. As caixas juntam-se, crescem 25 % para cada lado e entram como zonas ligadas, que a pessoa confirma. Com «poupar dados» ligado no browser, só procura quando se toca em «Procurar caras». Não há detetor de matrículas (*Questões em aberto* do `plan.md`). A pessoa desenha mais zonas por cima de caras e matrículas (rato, toque ou teclado). Cada zona leva um mosaico de cerca de 8 blocos no lado maior. A pré-visualização é a própria imagem que vai ser enviada.
5. Gera 2048, 1024 e 400 px em JPEG 0,85 a partir dessa imagem, tira com o `stripMetadata` todos os segmentos de metadados (fica o JFIF, o perfil de cor e o Adobe) e tudo o que vem depois do fim da imagem, e confirma com o `isCleanJpeg`, que percorre o ficheiro todo, incluindo entre as passagens de um JPEG progressivo. O Chrome só escreve JFIF e o perfil de cor; os outros browsers não foram testados.

As duas confirmações (sem caras nem matrículas, licença) são campos obrigatórios do formulário. O `jpeg.js` é JavaScript simples para o browser o carregar sem *build* e o Worker o importar para validar os envios.

**Envio** (`POST /api/v1/photos`, `src/photos.ts`, migração `0006`). O pedido é `multipart`: `full`, `main` e `thumb` (os três JPEG) e `meta` (JSON com o posto, o alvo, a data e o GPS da foto e as duas confirmações). O GPS vai no corpo, nunca no URL, que fica nos registos. O Worker não confia no browser:

1. Sessão e origem do próprio site, ou um *token* com `photos:write` (sem Turnstile; ver *Tokens de API*), e o limite diário (50 fotos por dia para `contributor`, 500 para os outros papéis, por dia UTC).
2. Cada ficheiro: tamanho máximo (6 MB, 2 MB e 500 kB), JPEG limpo (`isCleanJpeg`), lado maior até 2048, 1024 e 400 px, e os três com a mesma forma.
3. O posto tem de ser público e a tomada tem de ser desse posto. A distância ao posto calcula-se no Worker. Contas `trusted` publicam logo quando o posto está `active` e a foto foi tirada a 300 m ou menos dele; o resto fica `pending`.
4. Escreve a linha em `photos` como `uploading` antes de tudo o resto, guarda as versões de 1024 e 400 px em `pictures-staging` (`{id}/main.jpg`, `{id}/thumb.jpg`) e manda a de 2048 ao Panoramax: um *upload set* `owner-only` só com esta foto, com as coordenadas do posto, a data da foto e as etiquetas `osm|ref:EU:EVSE`, `OlhaOPosto|site` e `OlhaOPosto|author`. No fim, a linha passa a `pending` com os IDs do Panoramax, e a conta fica com `license_accepted_at`.
5. Se alguma coisa falhar, apaga o que já tinha guardado (R2 e *upload set*) e a linha fica `failed`. Um `409` do Panoramax (a mesma foto já enviada) dá `409` `duplicate`.

Medido no Node, verificar 1,5 MB de JPEG leva 0,6 ms e ler o formulário com as três fotos cerca de 4,5 ms. O plano Free dá 10 ms de CPU por pedido. Falta confirmar o tempo real no primeiro envio em produção; se passar, a saída é o Workers Paid (5 $/mês, já no orçamento do `plan.md`).

**Abrir o envio.** Feito: login, Turnstile, `STAGING` e `PANORAMAX_TOKEN` estão postos. Sem qualquer um destes segredos, o envio volta a fechar (`503` `uploads_closed`) e a página só prepara as fotos. Em local, `--var PANORAMAX_TOKEN:x --var PANORAMAX_URL:http://127.0.0.1:...` aponta para um Panoramax falso; o R2 local guarda as versões.

**Tokens de API** (`src/tokens.ts`, `src/account.ts`, migração `0012`). Quem tem sessão cria *tokens* na conta: um nome, os âmbitos (`photos:write`, e `selections:write` só para moderadores e administradores) e a validade (30, 90 ou 365 dias), até 5 ativos. O *token* (`oop_` + 32 bytes aleatórios) aparece uma vez; a tabela `api_tokens` guarda só o SHA-256, o início (para o reconhecer na lista), as datas e o último uso (no máximo uma escrita por hora). Revogar marca `revoked_at`; os revogados e expirados apagam-se quando a pessoa cria outro. Os pedidos levam `Authorization: Bearer oop_…`; o Worker lê o papel da conta em cada pedido, por isso uma despromoção tira logo o `selections:write` a todos os *tokens*. Um pedido com *token* não precisa de origem nem de Turnstile; um pedido só com o *cookie* de sessão continua a ter de vir do próprio site.

**Pseudónimo** (`src/credit.ts`, `src/account.ts`, migração `0014`). As regras estão em `arquitetura.md`, *Crédito*. A migração acrescenta a `users` o `pseudonym_key` (índice único parcial), o `osm_key` e o `pseudonym_changed_at`; a `photos` o `author_tag_old`; e a `selections` o `credit_pending`, os dois com índices parciais só nas linhas marcadas. As contas anteriores à migração recebem o `osm_key` no login seguinte ou na primeira verificação de um pseudónimo. `set_credit` e `reset_credit` em `POST /conta/acao` escrevem tudo numa transação da D1 e deixam marcas; o `syncCredits` faz um lote (5 alvos em `pictures`, com uma só purga de até 15 URLs, e 25 etiquetas no Panoramax) no `waitUntil` da própria mudança e em cada *cron*, depois da reconciliação das remoções. São no máximo 26 pedidos externos por execução, dentro dos 50 do plano Free, e o trabalho de CPU é copiar uns poucos MB por alvo. Uma cópia só se reescreve se a foto estiver `published` e se o objeto não mudou desde a leitura; uma marca só sai quando a purga correu bem (ou não há segredos de purga, em local) e o crédito ainda é o que se escreveu. Um `404` do Panoramax tira a marca da etiqueta.

**Pontos** (`src/points.ts`). Na aprovação, pelo moderador ou direta para `trusted`, o autor da foto (nunca o moderador) recebe +1 e, se for a primeira foto publicada do alvo, +3. Uma segunda foto da mesma pessoa no mesmo alvo em 30 dias não dá pontos. Trocar a principal por uma foto quando a anterior tinha mais de 12 meses dá +2 ao autor da foto nova. Cada motivo só se dá uma vez por foto. O ranking e a conta só somam pontos de fotos `published`: uma foto ocultada ou retirada deixa de contar sem apagar linhas. Medalhas pelo total de sempre: bronze 10, prata 50, ouro 200.

**A D1 `pictures` está na jurisdição EU**: vai guardar dados de utilizadores (RGPD), e a jurisdição só se escolhe ao criar a base.

**O ID da D1 não está no repositório.** O `wrangler.json` tem `database_id: "local-only"`, que só serve para o D1 local. Os comandos remotos passam pelo `npm run remote`, que procura o ID pelo nome com as credenciais de quem corre, escreve uma cópia temporária da configuração (`.wrangler.remote.json`, ignorada pelo git) e apaga-a no fim.

**Nunca correr `wrangler deploy` diretamente.** Com o *placeholder* falha. Sem `database_id` nenhum, o wrangler criaria uma D1 nova e vazia e escreveria o ID dela no `wrangler.json`.

Em local (sem login na Cloudflare):

```bash
cd worker
npm ci
npm test                  # testes do import, das páginas, do login e do JPEG
npm run db:local          # migrações na D1 local
npm run import:local      # importa o feed real para a D1 local
npm run dev               # http://localhost:8787/api/v1/stations/EZC-AMD-00051
```

Cada PR para `main` corre o workflow `checks.yml` (`npm run check`, `npm test` e um `wrangler deploy --dry-run`, sem credenciais). O job `worker` é um check obrigatório no ruleset `main`: sem ele verde, a PR não entra.

Em produção, depois de `npx wrangler login`:

```bash
cd worker
npm run deploy                                # migrações e depois o Worker
node scripts/import-stations.ts --remote      # só no primeiro import
```

O `npm run deploy` (`scripts/deploy.ts`) aplica as migrações que faltam e só depois publica o Worker, tudo com o ID procurado pelo nome. Sem migrações novas, esse passo não faz nada. Se uma migração falhar, o Worker não é publicado.

**Deploy automático (Workers Builds).** O Worker está ligado ao repositório no painel da Cloudflare (Workers & Pages → `olhaoposto` → Settings → Builds) e cada push para `main` corre o `npm run deploy`. A app da Cloudflare no GitHub (*Cloudflare Workers and Pages*) está instalada na org `CarregaErvilhas` só com acesso a este repositório; sem ela, o painel não mostra a org para escolher. A configuração também se lê e muda pela API (`/accounts/{conta}/builds/workers/{script}/triggers`).

| Campo | Valor |
| --- | --- |
| Branch de produção | `main` |
| Root directory (*Path*) | `/worker` |
| Build command | vazio (o Builds já corre o `npm ci`) |
| Deploy command | `npm run deploy` (traz o submódulo `brand/` se faltar; a [documentação](https://developers.cloudflare.com/workers/ci-cd/builds/) não diz se o Builds o clona) |
| Build watch paths | `*`: com o root em `/worker`, não é certo se os caminhos contam a partir da raiz do repositório ou de `worker/`, e um filtro errado nunca publicaria. Um PR só de docs publica o mesmo código outra vez, sem mal nenhum |
| Builds de outras branches (*Preview builds*) | Desligados: o comando por omissão (`wrangler versions upload`) falha com o *placeholder* |

O token que o Builds cria para a conta tem de poder ler e escrever na D1 (listar as bases e aplicar migrações), além de publicar o Worker. Os registos de cada build ficam no separador Deployments do Worker.

**Uma migração tem de funcionar com o código que já está no ar.** O deploy aplica-a e só depois publica o Worker novo, e durante esses segundos o Worker antigo usa o esquema novo. Acrescentar tabelas, colunas e índices não parte nada. Mudar o nome ou apagar uma coluna faz-se em dois PRs: um que deixa de a usar e, depois de publicado, outro com a migração. Criar um índice escreve uma linha por linha da tabela (cerca de 20 mil em `evses`), e isso conta para o limite diário da D1 Free (100 mil linhas escritas): não juntar no mesmo dia com um import que reescreva tudo.

**A D1 tem uma tabela virtual** (`stations_fts`, FTS5, migração `0003`). Um `wrangler d1 export` normal falha por causa dela; com `--compatibility sqlite3_cli_only` funciona, mas esse ficheiro só serve para o SQLite e não volta a entrar na D1. Para uma cópia que volte a entrar: apagar a `stations_fts` e os *triggers*, exportar, e correr a `0003` outra vez. Se a tabela alguma vez se estragar, `INSERT INTO stations_fts (stations_fts) VALUES ('rebuild')` refaz o índice a partir de `stations`. Para confirmar que o índice bate com a tabela: `INSERT INTO stations_fts (stations_fts, rank) VALUES ('integrity-check', 1)` dá erro se não bater.

**Custo da pesquisa, medido na D1 de produção:** uma palavra comum (`edp`, com mais de 1600 postos) lê cerca de 40 linhas para os 20 primeiros resultados; um código de posto completo lê 2. Um `LIKE` leria os cerca de 9 mil postos em cada pesquisa. Do lado das escritas, os *triggers* somam ao import duas linhas por posto alterado (a entrada antiga do índice sai, a nova entra) e uma por posto novo; um import que reescreva todos os postos escreve perto de 36 mil linhas só nos postos (as 27 mil dos *triggers* e da tabela, mais uma por posto no índice `stations_lat_lon`) e cerca de 20 mil nas tomadas: perto de 56 mil, ainda dentro do limite diário de 100 mil.

**Custo da pesquisa por proximidade, medido na D1 de produção.** O índice `(lat, lon)` percorre a faixa de latitude do pedido e só vai à tabela pelos postos dentro da caixa. Linhas lidas por pedido:

| Ponto | Raio | Postos na caixa | Linhas lidas |
| --- | --- | --- | --- |
| Centro de Lisboa | 500 m | 7 | 146 |
| Centro de Lisboa | 5 km | 670 | 1 712 |
| Centro do Porto | 500 m | 27 | 90 |
| Centro de Coimbra | 500 m | 3 | 16 |
| Centro de Faro | 500 m | 8 | 21 |

Lisboa é o pior caso: a faixa de latitude atravessa a cidade inteira. Do lado das escritas, um *upsert* de um posto com os mesmos valores escreve 4 linhas, mais uma do que antes da `0005`, porque o import reescreve `lat` e `lon`.

Quem chamar com a localização de uma pessoa deve arredondar as coordenadas a 3 casas decimais (cerca de 100 m) antes do pedido: os registos do Worker guardam o URL completo. A página de envio já o faz.

## 5. Importação dos postos

`worker/scripts/import-stations.ts` lê o modelo da rede do NAP dashboard (`https://nap.ocarroeletrico.com/ohmigo/chargers.json`, ~12 MB) e atualiza `stations` e `evses`. Corre no GitHub Actions (`.github/workflows/import-stations.yml`, de hora a hora aos 23 minutos e à mão com *Run workflow*), não no Worker: no plano Free, um Cron Trigger tem 10 ms de CPU e só ler o JSON passa disso.

- **Só escreve o que mudou.** Lê o estado da D1, compara e grava só as linhas novas ou alteradas: a D1 Free conta as linhas escritas por dia. Se o `generatedAt` do feed é o mesmo do último import, não faz nada (`--force` para repetir).
- **Nunca apaga.** Postos e pontos que saem do feed passam a `missing_from_nap` e voltam a `active` se regressarem.
- **Só mexe nas linhas do NAP.** Um posto de outra origem com o mesmo id fica como está e aparece em *conflicts*, para um moderador decidir.
- **Trava se o feed vier partido.** Recusa quando mais de 5 % dos postos ativos passariam a `missing_from_nap` (`--allow-mass-missing` para confirmar).
- **A D1 fica indisponível uns segundos** enquanto o `--file` remoto importa (API de importação da D1): um pequeno soluço na API quando o feed mudou (o NAP dashboard publica-o algumas vezes por dia).
- **Fotos externas.** O mesmo import lê o `photos` de cada posto do feed e acrescenta, atualiza e apaga as referências em `photos` (`origin` `osm_panoramax` ou `commons`, migração `0017`), na mesma importação e depois dos postos (`photos.station_id` aponta para eles). Ver `arquitetura.md`, *Fotos externas*. Escreve só o que mudou: a primeira vez, uma linha por foto (algumas dezenas), mais as entradas dos dois índices. As miniaturas são servidas pelo `nap.ocarroeletrico.com`, não pelo Worker nem pelo R2.
- **Postos em construção** (`scripts/lib/construction.ts`, migração `0018`; regras em `arquitetura.md`, *Postos em construção*). Lê o array `planned` do feed, só os `lifecycle: "construction"`, e escreve-os com `source = 'osm'` depois dos postos do NAP. Sem a chave `planned` (feed antigo, ou corrida sem o passo do OSM) não acrescenta nem marca nada. Os que saem passam a `missing_from_osm`, com travão (recusa quando sairia mais de metade de 10 ou mais). Na mesma importação faz as fusões automáticas (as instruções de `src/merge.ts`, que o Worker também usa na fusão manual). O que precisa do R2 e do Panoramax (a foto principal do posto do NAP e a etiqueta `OlhaOPosto|site`) fica para o *cron* do Worker.
- **Código EVSE de cada tomada.** O feed traz em cada ponto o `evse`, o código EVSE do NAP tal como publicado (`PT*EDP*E*LSB*90050*01`). Fica em `evse_id` e, sem os `*`, em `evse_compact` (`PTEDPELSB9005001`), a forma dos links de tomada. A chave de `evses` continua a ser (`station_id`, `point_id`): o NAP não garante que o código seja único (já houve um operador a publicar o mesmo em dois postos, `PT*KLS*E281*1`), por isso o índice em `evse_compact` não é `UNIQUE`. O primeiro import depois de o campo aparecer reescreve todos os pontos (cerca de 20 mil linhas, dentro do limite diário da D1 Free).

**Segredos do repositório** (*Settings → Secrets and variables → Actions*):

| Segredo | O quê |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token da conta só com **D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare |

## 6. Questões em aberto

