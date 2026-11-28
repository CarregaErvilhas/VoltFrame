# Plano — o que falta construir

Diagrama e ecrãs: `Design/Fluxo-panoramax.html` e `Design/Ecras-panoramax.html`.

Este documento só tem o que ainda não existe. O que já está a funcionar (servidor Panoramax, import dos postos, páginas, pesquisa, API de leitura e de escrita com *tokens*, login OSM, condições de utilização e privacidade, o envio com HEIC, mapa, postos propostos e deteção de caras, a moderação, os pedidos de remoção, a troca da foto principal, os aliases, os pontos, o ranking, o pseudónimo e o servidor MCP) está em [`arquitetura.md`](arquitetura.md), com a operação em [`cloudflare.md`](cloudflare.md) e [`infra.md`](infra.md). Quando uma parte daqui fica feita, sai deste documento e passa para lá.

## Fases

1. **Panoramax.** Falta:
- começar a conversa com a OSM Portugal e a equipa do Panoramax (proposta no fórum da comunidade OSM, categoria Portugal, e no fórum do Panoramax).
2. **O site para pessoas.** Falta:
- detetor de matrículas no browser (ver *Desfocagem*);
- confirmar num iPhone que o GPS de uma foto HEIC chega à página (o seletor do iOS pode converter para JPEG e tirar o GPS) e o tempo de CPU do envio em produção;
- o `charger_photos.py` do NAP dashboard a perguntar também ao nosso Panoramax;
- entrada na federação, depois da conversa com a comunidade;
- categorias das fotos e ferramentas para as mover (ver *Categorias das fotos*);
- locais (hubs e estações), quando o modelo do NAP dashboard os publicar (ver *Locais: hubs e estações*).
3. **Bot e agentes.** Bot do OSM (depois da aprovação da comunidade) e o `photos.json` lido pelo NAP dashboard e pelo ohmigo.
4. **Desfocagem no servidor**, quando houver uma GPU a um custo razoável.

## Panoramax: etiquetas e federação

Cada foto enviada leva etiquetas `chave=valor` ([sintaxe](https://docs.panoramax.fr/tags/syntax/)):

```
osm|ref:EU:EVSE=PT*TRK*E*VNT*00005*01
OlhaOPosto|site=TRK-VNT-00005
OlhaOPosto|author=joao_osm
```

**Federação.** Abre-se um pedido no repositório do catálogo federado e os operadores acrescentam o servidor ao *harvester* ([como](https://docs.panoramax.fr/how-to-contribute/hosting-instance/)). Só depois da conversa com a OSM Portugal e com a equipa do Panoramax; até lá o servidor fica privado. Duas condições da federação a levar a essa conversa: a instância só pode ter fotos ao nível da rua (*street-level*), e fotos de perto de um posto podem não caber; e só aceitam as licenças LO 2.0 ou CC BY-SA 4.0 (a nossa é CC BY-SA 4.0). O catálogo federado só recolhe os metadados, as fotos ficam no nosso servidor.

## Modelo de dados (D1)

Falta uma tabela:

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| `osm_edits` | `osm_element`, `key`, `value`, `photo_id`, `changeset`, `written_at` | O que o bot escreveu no OSM, para só alterar valores dele |
| `locations` | `id`, `level` (`hub` ou `estacao`), `name`, `kind`, `osm_element`, `hub_id`, `lat`, `lon`, `status`, `updated_at` | Os hubs e as estações do modelo do NAP dashboard (ver *Locais: hubs e estações*). `hub_id`: o hub de uma estação que está dentro de um. `status`: `active` ou `dissolved` |

E colunas novas: `stations.location_id`; `photos.category`, `photos.location_id` e `photos.part` (ver *Categorias das fotos*).

E uma coluna para o motivo de uma recusa em `photos` (hoje fica só o estado `removed`, quem decidiu e quando).

## Publicação dos links estáticos

A primeira foto aprovada de cada alvo já é publicada, a principal já se troca e as fotos externas já aparecem na galeria ([`arquitetura.md`](arquitetura.md), *Links estáticos* e *Fotos externas*). Falta decidir se vale a pena a opção A.

### Fotos externas: copiar quando escolhida como principal (opção A, para discutir mais tarde)

Hoje (opção B) o link estático só existe para fotos enviadas pelo olh'o'posto, e muitos postos que já têm foto noutro lado dão `404`. A alternativa:

- O Worker vai buscar a imagem à origem (2048 px do Panoramax, ou a miniatura do Commons) quando um moderador a escolhe como principal, e grava as três chaves em `pictures`, com o crédito do autor original no XMP.
- A favor: o link estático cobre logo todos os postos que já têm foto.
- Contra: guardamos cópias de fotos de outras pessoas (a licença permite-o com crédito). Se a foto sair da origem (o autor apaga-a ou há um pedido de remoção lá), o cron diário tem de o detetar e apagar a cópia. Obrigaria a tirar as externas das exclusões de `selections` e de `publish.ts`.

Outras alternativas a procurar: convidar o autor a reenviar a foto pelo olh'o'posto, ou um host separado com Worker que faça redirect para a origem (sem cópia, mas com o custo de pedidos dos Workers).

## OSM

- **Etiqueta:** só `panoramax=<uuid>`, que aponta para a foto no nosso servidor Panoramax (as imagens vêm do bucket R2 `panoramax`). O `osm_tags.photo_refs()` do NAP dashboard já a lê. Os links de `pictures.*` são para apps e mapas fora do OSM.
- **Que fotos:** só a principal de cada elemento. Promover outra foto torna-a a principal.
- **Bot** (`OlhaOPosto_bot`, fase 3), segundo o [código de conduta das edições automáticas](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct):
- conta dedicada, um *changeset* por dia, com etiquetas que o descrevem;
- só em elementos já ligados por `ref` ou `ref:EU:EVSE`; a foto de uma tomada vai para o ponto `man_made=charge_point`, se existir;
- só acrescenta; substitui apenas valores que ele próprio escreveu (registados em `osm_edits`). Se o elemento já tem outro `panoramax=`, a nova vai para a chave numerada seguinte (confirmar a convenção que o MapComplete usa);
- desligado até a comunidade aprovar. A aprovação não é opcional: sem ela, a conta pode ser bloqueada e as edições revertidas. Por isso a conversa começa já na fase 1.
- **Manual** (feito, `arquitetura.md`, *Links estáticos*): a página do posto e a página de crédito da foto principal oferecem o link para o iD e a etiqueta, sem precisar de aprovação nenhuma.

## Ligação ao NAP dashboard e ao ohmigo

Na fase 3, o refresh do NAP dashboard lê a exportação `olhaoposto.ocarroeletrico.com/api/v1/photos.json` como uma fonte nova do `charger_photos.py`, incluindo as fotos por tomada. As miniaturas continuam a ser copiadas para `/photos/` do próprio site, para o browser de quem lê não pedir nada a terceiros. O ohmigo recebe-as pelo `ohmigo_chargers.json`. Antes disso, as fotos do olh'o'posto podem chegar pelo OSM (`panoramax=`), mas o `charger_photos.py` só resolve UUIDs pela pesquisa federada (`api.panoramax.xyz`): até o servidor entrar na federação, é preciso que também pergunte a `panoramax.ocarroeletrico.com/api` (tarefa da fase 2).

## API e llms.txt

A camada de serviço no Worker serve a página, a API REST e o servidor MCP ([`arquitetura.md`](arquitetura.md), *Servidor MCP*), para as regras (validação, licença, desfocagem, moderação) serem as mesmas para pessoas e para agentes: os *handlers* do `src/index.ts` são finos e a lógica está em funções (`src/photoapi.ts`, `src/data.ts`, `src/publish.ts`, `src/takedown.ts`). O que já existe está em [`api.md`](api.md).

### API REST (`/api/v1`)

Feita, em [`api.md`](api.md) (e em OpenAPI 3.1 em `/api/v1/openapi.json`). Falta ligar o `charger_photos.py` do NAP dashboard ao `photos.json` (ver *Ligação ao NAP dashboard e ao ohmigo*).

### llms.txt

O `/llms.txt` já descreve as páginas, a API de leitura e de escrita (com o OpenAPI), o servidor MCP, os links estáticos e as licenças, e as páginas HTML apontam para ele no cabeçalho `Link`. Falta uma página `.md` para cada parte (o que a [proposta](https://llmstxt.org/) pede para os links).

## Crédito

O pseudónimo já se escolhe na conta ([`arquitetura.md`](arquitetura.md), *Crédito*). Falta:

- **Seguir as mudanças de nome no OSM.** O `osm_name` atualiza-se em cada login, mas o `photos.credit` de quem não tem pseudónimo fica com o nome do envio. Ao detetar no login um nome OSM novo (e sem pseudónimo), fazer o mesmo que uma mudança de crédito (`changeCredit` em `src/credit.ts`).
- **Um nome OSM novo igual a um pseudónimo.** A unicidade só se verifica ao escolher o pseudónimo; quem cria depois uma conta OSM com esse nome fica com ele. Decidir se o login avisa a moderação.
- GitHub como segunda forma de entrar, para quando alguém o pedir.

## Desfocagem de caras e matrículas

**No browser.** A deteção de caras já pré-desenha as zonas ([`arquitetura.md`](arquitetura.md), *Fluxo de envio*). Falta o detetor de **matrículas**: um modelo com pesos de licença permissiva que se possa distribuir no browser (os YOLO da Ultralytics são AGPL-3.0, por isso não servem). Matrículas de carros a carregar são o caso comum; é a prioridade seguinte da desfocagem.

**Abuso:** um cliente alterado, ou um *token*, pode enviar fotos sem desfocar. A mitigação: só publicam direto os `trusted`, promovidos à mão; o resto passa pela fila.

**No servidor, mais tarde (fase 4).** O Panoramax liga-se a um serviço de desfocagem por `API_BLUR_URL` (hoje vazio); o de produção é o [sgblur](https://gitlab.com/panoramax/server/sgblur) (código MIT, modelo YOLOv11 para caras e matrículas). A deteção pede uma GPU NVIDIA (a CPU não é recomendada em produção) e a imagem Docker tem cerca de 7 GB. O Zerops não tem GPU. Falta encontrar uma forma barata de o correr em escala (GPU à hora, Cloudflare, ou outro fornecedor) antes de o ligar.

## Moderação

- Moderadores: só o responsável do projeto no lançamento; a lista de moderadores da comunidade vem depois. Com um só moderador, o prazo de 72 h depende de ele estar disponível; como a foto fica oculta logo, o risco é atraso, não exposição.
- Apagar a conta a partir da própria conta (hoje é por email, como diz a política de privacidade).

## Locais: hubs e estações

Os postos agrupam-se em dois níveis, os dois vindos do OpenStreetMap:

- **Estação:** a área `amenity=charging_station` que os mapeadores desenham à volta dos carregadores de um operador. Por exemplo, os 15 postos da Helexia no Auchan Cascais.
- **Hub:** um lugar (centro comercial, área de serviço, parque…) com várias estações ou postos, normalmente de vários operadores. Por exemplo, o Centro Comercial Colombo.

O **local** de um posto é o nível de cima que existir: o hub, ou a estação quando não há hub.

O que é cada nível, os membros, o nome, como se corrige e o que quem lê o modelo pode esperar está no [`Docs/hubs.md` do Architecture](https://github.com/CarregaErvilhas/Architecture/blob/main/Docs/hubs.md), a cópia única do grupo. Só o NAP dashboard decide os locais (`stationAreas` e `hubs` no modelo da rede). O olh'o'posto não os define nem edita os nomes; esta secção é a parte dele.

- **Import:** o `scripts/import-stations.ts` lê também `stationAreas` e `hubs`, para a tabela `locations` e para `stations.location_id` (o local de cada posto). Um local que sai do modelo passa a `dissolved` e nunca se apaga, como os postos `missing_from_nap`.
- **ID e link estático:** o ID é o elemento do OSM com o prefixo do nível: `HUB-w42645796` (Centro Comercial Colombo) e `EST-w1355046979` (Auchan Cascais). O link `pictures.ocarroeletrico.com/HUB-w42645796.jpg` (ou `EST-….jpg`) serve a foto principal do local (a vista geral), com as mesmas regras dos postos e das tomadas.
- **Página `/locais/{id}` (`/en/locations/{id}`):**
  - a vista geral;
  - «Como encontrar os carregadores»: a entrada e a sinalética;
  - num hub, as zonas (as estações e os postos soltos); numa estação, os postos;
  - os links estáticos e as fotos que faltam;
  - o elemento no OSM e a ligação ao NAP dashboard.
- **API e MCP:** `GET /api/v1/locations/{id}` e a ferramenta `get_location`. O `get_station` passa a dizer o local do posto.
- **Panoramax:** as fotos de um local levam `OlhaOPosto|location=HUB-w…` (ou `EST-w…`) em vez de `OlhaOPosto|site`. As vistas gerais são fotos «ao nível da rua», o que ajuda na conversa sobre a federação.
- **Pontos:** a primeira foto de um local conta como a primeira de um posto.
- **Quando um local muda no modelo:**
  - A área que fica no OSM mantém o ID, e nada muda.
  - Um local que se desfaz passa a `dissolved`. Acontece quando a área é apagada, quando fica com menos de dois postos ou unidades, ou quando uma estação passa a estar dentro de um hub novo:
    - o link estático continua a servir a última principal, porque o link nunca muda;
    - a página diz que locais o substituíram;
    - as fotos «Local» dele aparecem na moderação para mover.
  - A mesma área redesenhada no OSM (ID novo, os mesmos postos): um moderador confirma o alias, com `301`, como nos aliases dos postos (`/admin/postos-fora-do-nap`).
  - Os moderadores veem, depois de cada import, a lista dos locais que mudaram.

## Categorias das fotos

Hoje o envio pede primeiro o posto e só depois «O que mostra esta foto?» (posto em geral, tomada ou chapa). A moderação só aprova ou recusa: uma foto na categoria errada tem de ser recusada com `wrong_station` e enviada outra vez.

**Uma foto tem uma categoria e um alvo:**

| Categoria | Alvo | Pode ser principal |
| --- | --- | --- |
| Local | o local do posto: o hub, ou a estação quando não há hub; `part`: vista geral, entrada ou sinalética | Só a vista geral |
| Posto | posto | Sim |
| Tomada | tomada (código EVSE) | Sim |
| Chapa | posto (o carregador) | Nunca |

- **As categorias são uma lista no código,** `src/categories.ts`, como os motivos de recusa em `src/reasons.ts`. Cada entrada tem o nome em pt e en, o ícone, a cor, o nível do alvo e se pode ser principal. Uma categoria nova é uma entrada nessa lista mais a migração do `CHECK`. O nome, o ícone e a cor são os mesmos no envio, nas galerias, na moderação, na API e no MCP.
- **Dados:** as colunas `photos.category` (com o `CHECK` da lista), `photos.location_id` e `photos.part`. A migração das fotos que já existem:
  - `kind = 'plate'` → `chapa`;
  - `evse_compact` preenchido → `tomada`;
  - o resto → `posto`.

  A API e o MCP continuam a aceitar `kind: "plate"`, como `chapa`.
- **Envio:**
  - A categoria passa a ser a primeira escolha, em quatro cartões, cada um com ícone, nome e uma frase.
  - Depois vem «Ligar a», que muda com a categoria:
    - Local: o hub ou a estação, pelo GPS da foto, e a parte (vista geral, entrada ou sinalética);
    - Posto: os postos do mais perto para o mais longe;
    - Tomada: o posto e o código do autocolante;
    - Chapa: o carregador.
  - Uma linha no fim diz o que acontece à foto: se pode passar a principal, ou se nunca passa.
  - «Local» só aparece quando o posto pertence a um hub ou a uma estação.
- **Mover:** uma só função, `movePhoto` em `src/move.ts`. Usam-na a fila, a página de moderação de um local ou posto, a API (`PATCH /api/v1/photos/{id}` com `category` e `target`, só para moderadores) e o MCP (`move_photo`). O que faz:
  - Se a foto era a principal do alvo antigo, esse alvo fica em «Sem foto principal» e o link estático passa a `404`, como numa remoção.
  - Se o alvo novo não tem principal e a categoria o permite, a foto passa a principal, como numa aprovação.
  - Atualiza no Panoramax as etiquetas `OlhaOPosto|kind`, `OlhaOPosto|site` e `OlhaOPosto|location`, e repete o que falhar, como já se faz na fusão dos postos em construção (`site_tag_old`).
  - Os pontos passam a contar para o alvo novo.
  - O autor vê «Categoria corrigida para X» em «Os meus envios».
  - A mudança fica no histórico de decisões (`/admin/decisoes`), como uma ação nova.
- **Fila de moderação:**
  - Tem um filtro por categoria.
  - A categoria e o alvo mudam-se antes de aprovar, com atalhos de 1 a 4 para a categoria.
  - Um quadro «O que muda» explica o efeito, e o botão passa a «Mudar para X e aprovar».
  - O `wrong_station` fica só para fotos de outro sítio.
- **«Fotos de um local ou posto»:** uma página nova de moderação. Mostra as fotos publicadas numa coluna por categoria, com seleção múltipla e «Mover para…». Avisa quando uma das fotos é a principal de algum alvo.
- **Visitantes:** um «Categoria errada?» na página de crédito (`/p/{id}`), que aparece na moderação com uma bandeira. A política de privacidade muda no mesmo PR, se isto guardar alguma coisa nova.

## Custos

Orçamento: **10 €/mês** no total.

- **Panoramax no Zerops** (API, *workers*, PostgreSQL): o custo fixo maior, ainda por medir (ponto 6 do ensaio). Em repouso usa os mínimos (0,5 GB de RAM e 0,06 de 1 CPU no `pano`) e o pico de 20 fotos ficou abaixo de 1 GB. Se passar o orçamento, VPS pequena com o Docker Compose do Panoramax.
- **R2:** com 100k fotos, ~100 GB no bucket `panoramax` (mestre e tamanhos) e ~25 GB em `pictures` (só as principais, três tamanhos), ~1,7 $/mês: 10 GB-mês grátis e depois 0,015 $/GB-mês, sem custos de tráfego ([preços R2](https://developers.cloudflare.com/r2/pricing)). As leituras de `pictures.*` são Classe B (10 milhões grátis por mês).
- **Workers e D1:** plano grátis. Como as fotos não passam pelo Worker, o limite de 100 000 pedidos/dia só conta para o site e a API em `olhaoposto.*`. Workers Paid (5 $/mês) só se o site ou a API o pedirem.

## Questões em aberto

- [ ] Lista de moderadores da comunidade.
- [ ] «Categoria errada?» para visitantes: com ou sem conta, e o que se guarda.
- [ ] Que coordenadas o Panoramax recebe para uma foto de um local: o centro da área ou o posto mais perto da foto.
- [ ] Como correr a desfocagem no servidor com GPU de forma barata, em escala.
- [ ] Modelo de deteção de matrículas para o browser, com pesos de licença permissiva.
- [ ] Resposta da OSM Portugal e da equipa do Panoramax (federação, nome, bot).
- [ ] Convenção do MapComplete para várias fotos no mesmo elemento (`panoramax:1=`?).
- [ ] Fotos externas e links estáticos: rever a opção B (em uso) contra a A (*Publicação dos links estáticos*) ou outras alternativas.
- [ ] Os mosaicos do mapa vêm do `tile.openstreetmap.org`, cuja política de uso aceita sites pequenos com atribuição. Se o uso crescer, passar para um fornecedor próprio ou mosaicos servidos por nós.
