# Roadmap — CAMPS-UTILS (suíte de utilitários)

Estado vivo da implementação. Spec formal: `spec/novas-funcoes/camps-utils-spec.md`.
Última atualização: 2026-08-08.

> **Próxima entrega (2026-08-13):** `roadmaps/removebg-vtracer-realesrgan/roadmap.md` — vetorizar
> (VTracer), aumentar qualidade (Real-ESRGAN) e remover fundo (rembg). Tem prioridade sobre a Fase 4.
>
> **Fase 4 (em espera)** em `roadmaps/ia-local/roadmap.md` — legenda automática, voz e imagem com IA
> local, tudo em cima do `RemoteModule` que esta fase construiu. Prompt de arranque:
> `roadmaps/ia-local/PROMPT.md`.

---

## Onde estamos

**Fase 1 (núcleo) implementada e verde.** App deixou de ser single-purpose (PDF→Markdown) e
virou suíte multi-ferramenta com menu. Falta o empacotamento (web installer + 2 bundles) e a
validação visual rodando `tauri dev`.

Verificação atual (tudo passando):
- `npm run typecheck` — limpo
- `npm run test` (vitest) — 27/27
- `cargo check` (em `src-tauri/`) — ok
- `.venv/Scripts/python -m pytest python/test_converter.py` — 37/37
- `npm run build:vite` — ok
- Smoke md2pdf real → gerou PDF válido (`%PDF-`)

---

## Feito nesta implantação

### Arquitetura / menu
- **Registro de ferramentas** `src/tools/registry.tsx` — fonte única (id, nome, categoria, ícone,
  componente). Categorias: Documentos / Imagens / Mídia / Utilitários.
- **Home** em grade `src/components/Home.tsx` (cards por categoria, `aria-label="Abrir <tool>"`).
- **Sidebar** reescrita `src/components/Sidebar.tsx` — marca CAMPS-UTILS, nav por categoria,
  Início/Histórico/Configurações.
- **App shell** `src/App.tsx` — estado `activeToolId` + `showHistory`; roteia Home / tool / histórico.
- **Histórico generalizado** — `HistoryEntry` ganhou `tool`; `markdown` virou opcional
  (`src/types/conversion.ts`).

### Ferramentas
- **PDF → Markdown** — extraída de `App.tsx` p/ `src/tools/pdf-to-markdown/PdfToMarkdownTool.tsx`
  (lógica/UI idênticas, Docling mantido).
- **Markdown → PDF** — `src/tools/markdown-to-pdf/MarkdownToPdfTool.tsx` (arquivo .md ou texto colado →
  save dialog → sidecar `md2pdf`).
- **Converter imagens** — `src/tools/image-convert/ImageConvertTool.tsx`. Drag-drop, preview com
  thumbnails+nomes+remover, escolher pasta ao salvar. Formatos webp/png/jpg/ico + qualidade.
- **Base64 / Texto** — `src/tools/base64/Base64Tool.tsx` (frontend puro).
- **QR code** — `src/tools/qr-code/QrCodeTool.tsx` → Rust `generate_qr` (crate `qrcode`), salva PNG.
- **Hash / Checksum** — `src/tools/hash/HashTool.tsx` → Rust `hash_files` (md5/sha1/sha256), testado.
- **Ferramentas de PDF** — `src/tools/pdf-tools/PdfToolsTool.tsx` (juntar/dividir/comprimir) → sidecar
  `pdf_merge`/`pdf_split`/`pdf_compress` (PyMuPDF). Pytest cobre.
- **Redimensionar imagens** — `src/tools/image-resize/ImageResizeTool.tsx` → Rust `resize_images`
  (dimensão máx / escala %, formato, qualidade, renomear em lote). cargo test cobre.

- **Baixar do YouTube** — `src/tools/youtube/YoutubeTool.tsx` → Rust `download_youtube` → sidecar
  `youtube` (yt-dlp) + ffmpeg empacotado. Progresso real via evento `tool-progress`.

- **Comprimir vídeo / Converter áudio / Vídeo→GIF** — `src/tools/video-compress`,
  `src/tools/audio-convert`, `src/tools/video-to-gif` → Rust `compress_video`/`convert_audio`/
  `video_to_gif` (ffmpeg empacotado). Progresso real onde faz sentido.
- ~~**Baixar do Spotify**~~ — **removida em 2026-08-10** a pedido do usuário. Saíram: tool
  `src/tools/spotify/`, comando Rust `download_spotify`, sidecar `spotify`
  (`spotify_download`/`_spotify_tracks`/`_yt_audio` em `converter.py`), settings
  `spotifyClientId`/`spotifyClientSecret` + a migração da chave legada `spotify-creds`, a seção
  "Integrações" de `SettingsView.tsx` (só tinha Spotify) e a dep `spotipy`.
  ⚠️ `LIGHT_COLLECTS` em `python/build.py` perdeu `spotipy` — **exige `npm run build:python`** para o
  sidecar empacotado parar de carregar a lib morta.

### Legenda: prévia ao vivo, estilo configurável e duas abas (2026-08-09)

Relato: *"texto enorme na tela parado, sem animação de popup nem nada"*, fonte ruim, sem como
escolher posição/tamanho, e as duas tarefas (gerar arquivo × gravar no vídeo) dividindo uma tela só.

**Causa do paredão de texto:** `MAX_CHARS=42`/`MAX_LINES=2` — padrão Netflix/BBC, certo para filme e
errado para vídeo curto.

- **Ritmos** (`RITMOS` em `subtitles.py`): Clássica (42×2), Curta (24×1), Dinâmica (18×1, **máx. 3
  palavras**). O `max_palavras` é o que produz o "1-3 por vez": só limitar caractere ainda junta
  muita palavra curta.
- **Karaokê** — `word_timestamps=True` já existia, então o tempo por palavra estava lá sem uso.
  ⚠️ Semântica que decide tudo: com `\k` o texto começa em **SecondaryColour** e vira
  **PrimaryColour** — Primary é a cor ACESA, o inverso da intuição. Antes as duas eram iguais; sem
  trocar, o karaokê sai invisível. A duração de cada `\k` vai até o **início da próxima palavra**,
  não `end - start`: usar a duração da palavra ignora o silêncio e o destaque adianta ao longo do
  bloco (há teste somando os `\k` contra a duração).
- **Estilo configurável** — `para_ass` aceita `fonte`/`tamanho`/`alinhamento`/`margem_v` da UI; o
  preset segue mandando em cores, contorno e animação. `margem_v` usa `is None` e não `or`: `0` é
  legítimo (legenda colada na borda).
- **Prévia ao vivo** (`SubtitlePreview.tsx`) — `<video>` real + legenda em HTML por cima, arrastável.
  ⚠️ É **aproximação** do libass, não pixel a pixel. O que a torna honesta é a escala: o ASS mede
  contra `PlayResY=1080` e mede o quadro **renderizado** (com `object-contain` há barra preta; usar
  a altura do elemento jogaria a legenda dentro da barra). `medirQuadro`/`escalaAss` são funções
  puras justamente para testar isso.
- **Fontes** — `assets/fonts/` (OFL, `npm run fonts`, **fora do git**) + `fontsdir` no filtro `ass`,
  e `system_fonts()` no Rust lendo o registro (`winreg`) porque é lá que está o **nome de família**,
  que é por onde o libass casa — `seguibl.ttf` não é "Segoe UI Black". Sem os arquivos o app não
  quebra: `fontes_dir()` devolve `None` e cai nas fontes do Windows — **sem aviso nenhum**.
  ⚠️ `escapar_para_filtro` vale para os **dois** caminhos do filtro (legenda e fontsdir).
- **Duas ferramentas, não abas** — `video-subtitle` "Legenda automática" (→ .srt/.vtt) e
  `video-burn` "Legendar vídeo" (→ .mp4 legendado). Dentro da segunda, "Gravada na imagem" ×
  "Faixa que dá para desligar". Compartilham `components/CamposTranscricao`,
  `components/ProgressoTranscricao` e `hooks/useToolProgress` — o hook existe porque
  `tool-progress` é evento da **janela**: dois ouvintes montados reagiriam ao progresso um do outro.
  ⚠️ `video-burn` é gateada em **ffmpeg**, não em whisper: a queima sempre precisa do ffmpeg, e o
  Whisper só quando a legenda é transcrita na hora — gatear nele exigiria 90 MB de quem só quer
  gravar um `.srt` que já tem. O caso do Whisper vira aviso local, com o mesmo `useModule`.
- **Legenda pronta** — `de_srt()` + tool `restyle` deixam estilizar um `.srt` revisado à mão. Sem
  isso a aba 2 com arquivo importado não teria estilo nenhum. Karaokê fica desabilitado aí: `.srt`
  não guarda tempo por palavra.
- **Animações de entrada refeitas** (`ENTRADAS` em `subtitles.py`) — só o preset "karaoke" tinha
  algum movimento; o resto era `\fad` puro. O "pop" de verdade vem de **dois `\t` encadeados**: o
  primeiro passa do alvo (overshoot) e o segundo volta. Um `\t` só dá crescimento linear, que é
  exatamente o que fazia parecer duro. `\blur` (extensão VSFilter, que o libass implementa) dá o
  brilho abrindo do preset neon sem custo de filtro no ffmpeg.
  ⚠️ Toda animação **termina no repouso** (escala 100, blur 0): se o libass cortar a linha antes do
  fim, o texto para legível em vez de congelar encolhido. Mesmo princípio nos keyframes CSS, por
  causa do bloco de reduced-motion.
  Espelhadas na prévia (`sub-assenta`/`sub-cresce`/`sub-pop`/`sub-desfoca`/`sub-brilha` no
  `index.css` + mapa `ANIMACAO` no `SubtitlePreview`), com `key` que remonta o `<span>` para
  reexecutar a animação a cada mudança de estilo/fonte/tamanho.
- **"ffmpeg falhou." sem motivo (corrigido)** — relato de falha ao queimar um `.mov`. A causa de não
  saber *por quê* era o próprio código: `ffmpeg_run_progress` **lia o stderr e jogava fora**, e toda
  falha virava a mesma string. Agora guarda a cauda (12 linhas — o ffmpeg escreve dezenas de linhas
  de banner e a causa está sempre no fim) e `erro_do_ffmpeg` traduz os casos conhecidos, deixando o
  texto cru quando não reconhece. 3 testes.
- **Dimensão ímpar** — o H.264 exige largura e altura pares; libx264 recusa com `Invalid argument` e
  não escreve nada (reproduzido: nem consegui *gerar* um arquivo 643×361 com libx264). Um `.mov` de
  editor ou gravador de tela pode ter dimensão ímpar porque ProRes e MJPEG aceitam. O filtro passou
  a ser `scale=trunc(iw/2)*2:trunc(ih/2)*2,ass=...` — **scale antes do ass**, para a legenda ser
  desenhada no tamanho final e não passar por reamostragem.
- **`README.md` dentro de `assets/fonts/`** — o libass tenta abrir **todo** arquivo do `fontsdir`
  como fonte (`Error opening memory font 'README.md'`). Movido para `assets/FONTES.md`.
  ⚠️ Hipóteses testadas e **descartadas**: áudio PCM do `.mov` com `-c:a copy` (este ffmpeg aceita,
  reproduzido com sucesso) e o `fontsdir` quebrar o filtro (funciona, só reclamava do README).
- **Salto na palavra acesa** — o `\k` sozinho só troca cor. Agora cada palavra leva dois `\t`
  próprios (sobe a 118% em 90 ms, volta em 100 ms), disparados no instante em que é dita.
  ⚠️ `\k` conta em **centésimos** e `\t` em **milésimos**, e as duas convivem na mesma tag: sem o
  ×10 o salto dispara 10× mais cedo e a palavra pula antes de ser falada. Cada palavra repõe
  `\fscx100` antes de animar, senão herdaria o estado final da anterior. Pico configurável por
  preset (`karaoke_escala`).
  ⚠️ **Conflito descoberto ao implementar:** a animação de entrada do bloco também anima escala
  (0–210 ms) e a 1ª palavra repunha 100 no instante 0 — o pop de entrada morria pela metade. Com
  karaokê a entrada passa a ser só o `\fad` (`_entrada_para_karaoke`); o movimento vem dos saltos.
  Efeito colateral aceito: escalar muda a largura de avanço, então as vizinhas se deslocam um pouco
  — é o balanço das legendas de rede social, e quase some no ritmo Dinâmica.
- **Cores escolhidas na interface** — texto, contorno (ou caixa, no preset YouTube) e palavra acesa
  viraram `ColorPicker` (amostra + 8 atalhos + roda nativa do sistema). Trocar o preset **recarrega**
  as cores dele: sem isso, escolher "Neon" depois de mexer nas cores não mudaria nada visível, já que
  o preset só define cor. Cada seletor tem "padrão" para voltar ao valor do preset.
  ⚠️ A conversão `#RRGGBB` → `&HAABBGGRR` (`hex_para_ass`) mora **só no Python**. Duas armadilhas
  silenciosas, ambas com teste: o ASS guarda **BGR**, não RGB (trocar vermelho por azul é o bug
  clássico), e o primeiro byte é **alfa invertido** — `00` é opaco. A caixa herda o alfa do preset,
  senão trocar a cor deixaria opaca uma caixa que era semitransparente.
  A regra de contraste virou **aviso na tela** (não bloqueio — pode ser intencional), espelhando em
  TS o limite travado no Python. `src/test/subtitleColors.test.ts` inclui um teste que reprova o
  roxo antigo, para ninguém "restaurar" achando que era melhor.
- **Palavra acesa ilegível (corrigido)** — o destaque do karaokê era o roxo da marca, e os presets
  "Karaokê" e "Neon" têm **contorno roxo**: a palavra acesa sumia dentro do próprio contorno.
  Medido: distância RGB **0** do contorno no preset Karaokê (cor idêntica) e 93 no Neon.
  `cor_karaoke` passou a âmbar `#FFD24A`, que contrasta tanto com preto quanto com roxo (230–339 em
  todos os presets). A cor de repouso segue branca opaca — escurecê-la ajudaria o efeito mas mexeria
  justo na legibilidade que era a reclamação.
  ⚠️ Invariante travada por teste: `cor_karaoke` tem de ficar a mais de 120 de distância RGB de
  `cor_contorno`. Um preset novo com contorno claro reprova sozinho.
- **Busca no Select** (`searchable`) — a lista de fontes do sistema tem centenas de itens. Filtra por
  rótulo **e** dica, sem acento (`NFD` + remoção de diacrítico), com aviso de "nada encontrado" e
  reset do filtro ao fechar (reabrir filtrado esconderia a opção marcada e pareceria bug). O `ativo`
  passou a indexar a lista **filtrada**, não a original — indexar a original selecionaria o item
  errado assim que houvesse filtro. 6 testes novos.
- `ResizeObserver` guardado — não existe no jsdom e o ReferenceError derrubava a tool inteira.
- Verificação: pytest **96/96** (subtitles 47), vitest **51/51**, cargo **8/8**, build ok.

### Novidades da versão, para o usuário (2026-08-13) — **1.1.0**

Pedido: mostrar dentro do app o que mudou em cada versão, "de forma bem simples, sem coisas
técnicas".

- **`src/lib/changelog.ts` (novo)** — uma entrada por versão (`versao`, `data`, `itens[]`), mais
  recente no topo. Conteúdo em linguagem de usuário: o que ele passou a conseguir fazer, não o que
  mudou no código.
- **Dois lugares, um componente** (`src/components/Novidades.tsx`): cartão dispensável no **Início**
  na primeira abertura após atualizar, e a lista completa em **Configurações → Sobre**.
  Cartão e não modal de propósito — novidade não é pendência, e travar a tela de quem abriu o app
  para converter um arquivo é pior que não avisar.
- `settings.lastSeenVersion` guarda o que já foi visto; "Entendi" grava a versão e o cartão não
  volta. Quem instala pela primeira vez vê uma vez (campo vazio).
- **Versão sem entrada escrita não mostra nada.** Esquecer de escrever a novidade vira silêncio, não
  um cartão vazio.
- ⚠️ **Teste que reprova jargão** (`changelog.test.ts`): nenhum item pode conter "rembg", "ONNX",
  "API", "cache", "build", "commit"… É a regra que mais se perde quando alguém escreve a entrada
  com o commit aberto do lado. Formato de arquivo (PNG, SVG) fica de fora da lista de proibidas —
  é vocabulário de quem usa.
- Fora do Tauri o `getVersion()` falha e vira `null` → sem versão, sem aviso. É por isso que o
  cartão não aparece em `npm run dev:vite`.
- `CLAUDE.md`: o passo a passo de release ganhou "escrever as novidades" como passo 2, e o passo 1
  passou a citar o `VERSION` + `npm run version:sync` (que já existiam e não estavam documentados
  ali).

**Versão 1.0.1 → 1.1.0** (`VERSION` + `npm run version:sync` nos três arquivos; `cargo check`
atualizou o `Cargo.lock`). Minor e não patch: três ferramentas novas de imagem e a cor
personalizável.

**Verificado:** vitest **104/104** (7 novos em `changelog.test.ts` + 2 em `App.test.tsx` — o cartão
aparece, some ao ser visto e não volta depois de remontar; a lista completa está em Sobre),
typecheck limpo, `cargo check` ok. Conferido no navegador: a lista das 4 versões aparece em Sobre.

### Cor de destaque escolhida pelo usuário (2026-08-13)

Pedido: poder trocar a cor do app e ter **ícones, barra de rolagem e os fundos animados** todos na
cor escolhida. 8 paletas em Configurações → Aparência → **Cor de destaque** (amostras redondas com
o degradê da paleta, não rótulos de texto — a cor é o próprio rótulo).

- **`src/lib/palettes.ts` (novo) é a fonte única.** Cada paleta declara **duas** cores (`base` e
  `deep`) mais uma variante `claro`; o resto é derivado (`coresDoEfeito`). Derivar em vez de listar:
  eram 5 cores por paleta × 8 paletas, e paleta nova com metade das cores esquecidas seria o
  defeito mais provável. Os fatores foram calibrados para reproduzir o roxo original
  (`#8944ff`/`#A855F7`/`#8300ff` nas ondas, `#7C3AED`/`#A855F7`/`#c73bf6` nas linhas).
- **Por que a tabela mora em TS e não como `[data-accent]` no CSS:** canvas WebGL não enxerga CSS
  var. Os efeitos precisam do hexadecimal na mão, então a tabela teria de existir em TS de
  qualquer jeito — e duas tabelas divergem no dia em que alguém mexe num lado só. O `useSettings`
  escreve `--c-accent`, `--c-accent-hover`, `--c-selected` e `--c-selected-deep` inline no `<html>`.
- **Tema e paleta viraram um efeito só.** A paleta tem variante para o tema claro, então quem
  resolve "sistema → claro/escuro" é quem sabe qual variante escrever; em dois efeitos a cor ficaria
  um render atrás do tema ao seguir o Windows.
- ⚠️ **`key={settings.accent}` no `<AppBackground>`**: os efeitos montam o material do WebGL uma
  vez, e trocar a cor por prop não repinta o que já está na GPU. Sem o remonte, a interface muda de
  cor e o fundo continua roxo.
- ⚠️ **Variante `claro` é obrigatória** e há teste que reprova paleta sem ela: `#22D3EE` (Ciano)
  sobre fundo branco não passa contraste, e o defeito só apareceria para quem usa o tema claro.
- **Mudança no visual padrão:** `--c-accent` era índigo (`#818CF8`) e `--c-selected` roxo. Como o
  pedido é "tudo da mesma cor", cada paleta é de um tom só — no padrão "Roxo" os ícones passaram de
  índigo para roxo. O índigo antigo continua disponível como a paleta **"Índigo"**.
- Já reagem sozinhos (usavam os tokens): rolagem (`.scrollbar`), neon do item ativo, barras de
  progresso, foco, `.btn-primary` e o segmentado.

**Verificado:** vitest **95/95** (9 novos em `palettes.test.ts` + 2 em `App.test.tsx` travando as
CSS vars e a variante do tema claro), typecheck limpo, e conferido no navegador: paleta Verde
deixou ícones, botões, sliders e **o canvas das Ondas e das Linhas flutuantes** verdes; no tema
claro o Ciano cai para `#0E7490` e o texto branco continua legível.

### Select próprio (2026-08-09)

O `<select>` nativo tinha um dropdown fora do tema: a lista é desenhada pelo **sistema operacional**,
não pelo WebView — **nenhum CSS alcança**. No Windows saía um menu branco quadrado ignorando tema,
vidro e o roxo do app. A única forma de padronizar é desenhar a lista em HTML.

- `src/components/ui/Select.tsx` — combobox/listbox próprio: gatilho com `.field` + chevron, lista no
  `.popover` (opaco), marca de seleção, `hint` opcional por opção.
- **A11y refeita à mão** (é o custo de abandonar o nativo): `role="combobox"`/`listbox"`/`option`,
  `aria-expanded`/`aria-activedescendant`/`aria-selected`, setas, Home/End, Enter, Esc, Tab,
  clique fora — e as opções `disabled` são puladas na navegação.
- Abre **para cima** quando não cabe embaixo (mede no `useLayoutEffect`); a lista tem teto de 240px.
- API mudou de `<option>` filhos para `options={[{value,label,hint?,disabled?}]}` e
  `onChange(valor)` em vez de `onChange(evento)`. 6 call sites migrados; zero `<select>` restante.
- ⚠️ `scrollIntoView` é chamado com `?.()` — não existe no jsdom, e o TypeError derrubava o
  componente inteiro por causa de um detalhe cosmético.
- `src/test/Select.test.tsx`: 5 testes (abre, escolhe, teclado pulando desabilitada, Esc, aria).

### Configurações: seção Módulos (2026-08-08)

Os três `ModuleCard` viviam dentro de **Armazenamento**, misturados com histórico e reset. Módulo não
é armazenamento — é pré-requisito de ferramenta. Ganharam seção própria.

- `SettingsView.tsx`: `SectionId`/`SECTIONS` ganham `"modulos"`, nova `ModulosSection`, e
  Armazenamento fica só com Histórico + Dados do app.
- A seção **itera `MODULES`** (`ModuleGate.tsx`) em vez de listar os cards à mão: módulo novo lá
  aparece aqui sozinho.
- ⚠️ `useNotifications.SettingsSection` mudou de `"armazenamento"` para `"modulos"` — é para onde o
  sino navega quando falta um módulo. Um teste em `NotificationBell.test.tsx` travava o valor antigo
  e pegou a mudança.
- **Card redesenhado**: chip de ícone (verde quando instalado, roxo quando pendente), badge de
  tamanho, pílula de status com ícone (`Check`/`CircleAlert`/spinner), linha "Usado por" e botão
  `Baixar` compacto à direita. `MODULES` ganhou `icone`, `tamanho` e `usadoPor` — o card desenha
  tudo a partir dali, sem texto repetido no `SettingsView`.

### Arrastar-e-soltar em todas as ferramentas (2026-08-08)

Relato: "só dá pra arrastar em Converter imagens". **Causa:** as outras 8 ferramentas usavam
`<Button variant="picker">` com **apenas `onClick`** — não havia handler de drop nenhum. Só
image-convert, image-compress e o `DropZone` montavam o `useDragDrop`.

- **`src/components/ui/FilePicker.tsx`** (novo) — junta diálogo nativo + `useDragDrop` num
  componente só. Emite `string[]` de caminhos por `onPick`, venha de clique ou de arrastar.
  Substituiu os 8 call sites (audio-convert, image-resize, video-compress, video-to-gif, hash,
  docx-to-pdf, video-subtitle, markdown-to-pdf).
- 💡 No Tauri o `useDragDrop` escuta `onDragDropEvent` da **janela**, não do elemento — basta o hook
  estar montado, o cursor não precisa estar sobre o botão. Os handlers HTML5 seguem como plano B
  fora do Tauri.
- `useDragDrop` ganhou o caso `accept: ["*"]` (Hash aceita qualquer arquivo). Sem isso o filtro
  virava `endsWith(".*")`, que nunca casa, e **todo** drop seria recusado em silêncio.
- `.btn-picker[data-dragging]` dá o mesmo destaque roxo da dropzone enquanto se arrasta.
- Não migrados de propósito: `DropZone` (PDF→MD e Ferramentas de PDF) e as dropzones de
  image-convert/image-compress — já tinham arrastar e têm layout próprio de área grande.

### Markdown → PDF: tabelas e paridade com GFM (2026-08-08)

Relato: "tabelas no PDF ficam como se fosse uma coluna só, visualização péssima". **Causa raiz
achada e reproduzida:** o GFM (e o Markdown Preview Enhanced) aceitam uma tabela colada no parágrafo
anterior; o Python-Markdown **não** — sem linha em branco ele trata as linhas como texto corrido.
`_normalize_markdown()` insere a linha em branco quando detecta cabeçalho + separador.

- **Largura de coluna por conteúdo** (`_size_table_columns`) — antes o xhtml2pdf repartia a largura
  igualmente e a coluna de descrição ficava do tamanho da de um número.
  ⚠️ A largura vai no atributo `width` das células da primeira linha: **`<colgroup>`/`<col>` são
  ignorados em silêncio** pelo xhtml2pdf (testado — saía correto no HTML e não mudava nada no PDF).
- `<thead repeat="1">` — cabeçalho se repete quando a tabela quebra de página (atributo, não CSS).
- **CSS reescrito** aproximando o tema do GitHub que o MPE usa: `@page` A4 com margens, rodapé com
  `<pdf:pagenumber>`, h1/h2 com filete, blockquote, code com borda, zebrado.
- **GFM**: `pymdown-extensions` traz `~~riscado~~`, listas de tarefa, autolink, superfences e
  `pymdownx.highlight` (Pygments). ⚠️ A classe do Pygments é `.highlight`, **não** `.codehilite` —
  errar isso deixa o código monocromático sem nenhum aviso.
- Checkbox de tarefa vira `[x]`/`[ ]` em ASCII: `<input type=checkbox>` não é desenhado, e ☑/☐ não
  existem nas fontes base do PDF (viram quadrado preto).
- Deps novas: `pymdown-extensions`, `Pygments` — **também no `LIGHT_COLLECTS` do `build.py`**, senão
  o exe empacotado dá `MODEL_ERROR`.
- O `docx2pdf` herda tudo, porque compartilha o `_html_to_pdf`.
- pytest **49/49** (6 testes novos: tabela colada, normalize idempotente, largura proporcional,
  thead repeat, checkbox, PDF válido com tabela).

**Teto assumido (decisão do usuário: ficar no xhtml2pdf).** Fidelidade real ao MPE exigiria um motor
de navegador — o MPE é Chromium print-to-PDF. O xhtml2pdf entende um subconjunto de CSS 2.1: sem
flexbox, sem CSS3, sem JS. Logo **Mermaid e KaTeX não têm como funcionar**. O resultado é "parecido
com", não "idêntico a". As alternativas avaliadas e recusadas foram Chromium sob demanda (~150 MB,
encaixaria no sistema de `RemoteModule` já existente) e WeasyPrint (DLLs do GTK no Windows).

- **Word → PDF** — `src/tools/docx-to-pdf/DocxToPdfTool.tsx` → sidecar `docx2pdf`. **mammoth**
  (DOCX → HTML, puro Python) + o mesmo `xhtml2pdf` do md2pdf. Sem Word (COM) e sem LibreOffice
  headless: os dois exigiriam instalação externa e o app é 100% local/empacotado.
  ⚠️ **Não é fac-símile.** Mammoth mapeia estrutura (títulos, listas, tabelas, negrito), não
  diagramação — fontes, margens, cabeçalhos/rodapés e quebras de página do original se perdem. A UI
  avisa isso *antes* de converter, não depois. Só `.docx`; `.doc` (binário pré-2007) devolve
  `UNSUPPORTED_FORMAT`. O helper `_html_to_pdf` foi extraído de `convert_md_to_pdf` e é o ponto
  único de geração dos dois. pytest 43/43 (6 testes novos, fixture gera um DOCX mínimo à mão via
  `zipfile` p/ não depender de python-docx).

**17 ferramentas ativas** (contagem de `src/tools/registry.tsx`): Documentos (PDF→MD, MD→PDF,
Word→PDF, Ferramentas de PDF) · Imagens (Converter, Redimensionar, Comprimir, Mapa de profundidade)
· Mídia (Legenda automática, Legendar vídeo, YouTube, Comprimir vídeo, Converter áudio, Vídeo→GIF) ·
Utilitários (Base64, QR code, Hash).

### Configurações abrangentes (2026-07-29)
Aba de Configurações deixou de ser "só do PDF→Markdown" e virou painel da suíte inteira.

- **Virou página, não modal** — `src/components/SettingsView.tsx` (novo) com nav de 8 seções:
  Geral / Documentos / Imagens / Mídia / Utilitários / Integrações / Armazenamento / Sobre.
  Salva na hora (sem botões Salvar/Cancelar). `SettingsModal.tsx` **deletado**.
  `App.tsx` agora tem `view: "home" | "tool" | "history" | "settings"`; `Sidebar.tsx` recebe
  `showSettings` e usa `NavItem` (fica destacado como as outras rotas).
- **`AppSettings` expandido** (`src/types/settings.ts`): tema, pasta padrão, abrir pasta, tamanho máx,
  autoSave .md, formato/qualidade de imagem, formato/dimensão de resize, formato/kbps de áudio,
  altura de vídeo YouTube, CRF de vídeo, fps/largura de GIF, algoritmo de hash, tamanho de QR,
  creds Spotify, limite do histórico. `MAX_FILE_SIZE_MB/_BYTES` saíram (viraram setting).
- **Tema claro/escuro/sistema** — cores do Tailwind passaram a CSS vars (`tailwind.config.ts` →
  `rgb(var(--c-…) / <alpha-value>)`), paletas em `src/index.css` (`:root[data-theme="escuro"|"claro"]`).
  `useSettings` seta `data-theme` no `<html>` e escuta `prefers-color-scheme` no modo "sistema".
  Os `theme('colors.…')` do index.css foram trocados por `rgb(var(--c-…))` (não resolvem com var).
- **Tools agora leem os padrões**: image-convert, image-resize, audio-convert, video-compress,
  video-to-gif, youtube, spotify, hash, qr-code. Continuam ajustáveis pontualmente na tool.
- **Settings mortos foram ligados**: `maxFileSizeMb` chega em `useDragDrop`/`DropZone` (antes era
  const fixa de 100 MB); `historyLimit` chega em `useHistory`/`addHistoryEntry` (era `MAX_ENTRIES=50`).
- **Creds do Spotify migraram** de `localStorage["spotify-creds"]` p/ settings (migração automática em
  `settingsService.loadSettings`); a tool só mostra o status e aponta p/ Configurações → Integrações.
- **Chave de storage** virou `camps-utils-settings`, com fallback de leitura em
  `pdf-to-markdown-settings` (não perde config de quem já usava).
- **Armazenamento**: status/download do módulo Docling (reusa `docling_installed`/`ensure_docling` +
  evento `docling-progress`), nº de entradas + limpar histórico, KB usados, restaurar padrões.
- Verificado: `npm run typecheck` limpo · `npm run test` 11/11 (3 testes novos de Configurações) ·
  `npm run build:vite` ok (CSS compila os dois temas).
- Não feito de propósito: exportar/importar config em arquivo (falta comando Rust de leitura) e
  remover o módulo Docling pelo app (idem). Validação visual do tema claro só com `npm run dev`.

### Busca no histórico (2026-07-29)
- `src/components/HistoryView.tsx`: barra de pesquisa **manual** — dois estados (`term` digitado,
  `query` aplicada); só o clique em **Buscar** (ou Enter) copia `term` → `query`. Digitar não filtra.
  Casa termo com `filename`, `inputPath`, `outputPath`, `tool` e `markdown` (helper `matches`).
  Contador vira "N de M" quando filtrando; link "Limpar busca"; vazio mostra o termo procurado.
- **Limpar tudo** agora pede confirmação inline (estado `confirmClear`, sem `window.confirm` —
  dialog nativo travaria a webview). Confirmar limpa histórico e a busca.
- 2 testes novos em `src/test/App.test.tsx` (busca só no clique; limpar após confirmar). 13/13 verde,
  `npm run typecheck` limpo.

### PDF avançado + visual "vidro líquido" + GSAP (2026-08-08)

Pedido do usuário: ver as páginas do PDF, escolher quais ficam, divisão mais elaborada, animações
em toda a app com GSAP, imagem de fundo e efeito de vidro do iPhone.

**Dependências novas:** `gsap` + `@gsap/react` (animação), `pdfjs-dist` (só para EXIBIR páginas —
quem escreve PDF continua sendo o PyMuPDF no sidecar).

**Backend PDF — `python/converter.py`:**
- `pdf_pages(inputPath, outputPath, pages[])` (novo): monta um PDF com as páginas na ordem dada
  (1-based, duplicatas OK). Uma função cobre 3 recursos da UI: extrair selecionadas, remover
  (o front manda o complemento) e reordenar (manda a ordem nova).
- `pdf_split` ganhou `ranges: [[ini,fim],…]` 1-based inclusivo; quando presente ignora `every`.
  Normaliza intervalo invertido e recusa fora da faixa com `INVALID_INPUT`.
- `dispatch`: entrada `pdf_pages` + repasse de `ranges`. **Nada mudou no Rust** — `run_tool` já é
  dispatcher genérico. `pytest` 22 → **37/37**.

**Visualizador de PDF (novo):**
- `src/hooks/usePdfDocument.ts` — import dinâmico do pdf.js (chunk separado de ~480 kB, só carrega
  ao abrir a tool), worker via `?url`, `renderPage(n, canvas, cssWidth)` com DPR limitado a 2.
- `src/components/PdfViewer.tsx` — grade de miniaturas em vidro, render **preguiçoso** por
  `IntersectionObserver`, modal de zoom (←/→/Esc), checkbox por página (`role="checkbox"`),
  drag-to-reorder nativo, barra Tudo/Inverter/Limpar/Ordem original.
- `src/lib/pageRanges.ts` + `src/test/pageRanges.test.ts` (12 testes) — parser tolerante
  "1-3, 7, 10-12" ↔ seleção, nos dois sentidos.

**`src/tools/pdf-tools/PdfToolsTool.tsx` reescrito:** agora recebe `ToolProps` (grava histórico como
todas as outras), tem drag&drop via `DropZone`, lista reordenável no Juntar, e 4 modos de divisão —
Selecionar páginas → 1 PDF (`pdf_pages`), Intervalos (`pdf_split`+`ranges`), A cada N (comportamento
antigo preservado), Remover e reordenar (`pdf_pages` com o complemento). Trocar de modo não limpa
mais os arquivos. `registry.tsx` ganhou `wide?: boolean` (a grade de miniaturas usa `max-w-6xl`).

**Camada visual — `src/index.css` + `tailwind.config.ts`:**
- Vars de vidro por tema (`--glass-a/-border-a/-hi-a/-sheen-a`, sombras) e classes `.glass`,
  `.glass-strong`, `.glass-float`, `.glass-inset`, `.glass-hover`, `.glass-sheen` (brilho radial
  seguindo o cursor via `--mx/--my`). Fallback `@supports not (backdrop-filter)` → superfície opaca.
- Fundo: `body::before` (imagem/mesh, opacidade+blur configuráveis) + `body::after` (veil de
  contraste). 3 presets **sem arquivo de imagem** (`[data-bg="mesh-1|2|3"]`, gradientes) + imagem
  do PC via `convertFileSrc` (o asset protocol já estava com escopo `**`, **não precisou de
  comando Rust**) + "nenhum".
- Tokens de estado `--c-success/-danger/-warning` e `--c-overlay` (hover que clareia no escuro e
  escurece no claro). As 66 cores hardcoded (`text-red-400`, `bg-green-950/20`…) espalhadas em 17
  arquivos foram tokenizadas — fecha a pendência "validar tema claro".

**Animação — `src/lib/motion.ts`** (único módulo que conhece GSAP): `useEnter`, `useStagger`,
`useViewTransition`, `useMagnetic`, `useGlassSheen`, `useCountUp`, `useShake`, `usePulse` e
`useToolEnter` (1 linha por ferramenta: cascata dos blocos + magnetismo nos botões `bg-accent`).
Tudo respeita a setting `animations` **e** o `prefers-reduced-motion` do sistema (o sistema vence).

**Configurações:** nova seção **Aparência** (`SettingsView.tsx`) — tema, vidro (sutil/médio/forte),
fundo, opacidade, desfoque, animações. `settings.ts` ganhou 6 campos; `settingsService` já faz merge
sobre defaults, então não houve migração.

**Verificação:** `typecheck` limpo · vitest **26/26** · pytest **37/37** · `cargo check` ok ·
`vite build` ok (pdf.js sai em chunk próprio) · UI conferida no navegador (`dev:vite`) nos temas
claro e escuro, com os 3 mesh e os controles de aparência.

**Gotcha novo (custou tempo):** o `page.render()` do pdf.js usa `requestAnimationFrame`. Numa aba
**oculta** o rAF não dispara e o render **trava para sempre** — parece bug de API, não é. Só dá para
validar render de PDF com a janela visível. Além disso: `killTweensOf(el)` genérico mata também o
tween de entrada do pai e deixa o elemento preso em `opacity: 0` — sempre escopar por propriedade
(`killTweensOf(el, "x,y")`).

**Pendente (precisa de `npm run dev`, janela Tauri real):** conferir o visualizador com um PDF de
100+ páginas (carregamento preguiçoso, zoom, seleção), rodar os 4 modos de divisão e abrir os PDFs
gerados, arrastar para reordenar no Juntar, e escolher uma imagem de fundo do disco.

### Ícones lucide-react + fundos animados do React Bits (2026-08-08)

**Ícones:** `lucide-react`. Os **25 SVGs inline** espalhados em 11 arquivos viraram imports. De
quebra, cada uma das 13 ferramentas ganhou ícone próprio (antes várias dividiam o mesmo `DocIcon` /
`MediaIcon` / `VideoIcon`). Sobraram só dois wrappers finos — `UploadIcon` e `ImgIcon` — porque têm
prop `dragging`. Custo no bundle principal: +5,8 kB (tree-shaking por import nomeado).
**Atenção:** lucide v1 **não tem ícones de marca** — sem `Youtube`/`Spotify`. Ficou `CirclePlay` e
`AudioLines`.

**Fundos animados (React Bits) — `src/components/backgrounds/`:**
- `registry.tsx` — mesmo padrão do `tools/registry.tsx`: `BACKGROUND_EFFECTS[]` com `id`, `label` e
  um `lazy()` que embute o preset de props. **Adicionar efeito = 1 entrada aqui, mais nada.** O
  cabeçalho do arquivo tem o passo a passo.
- `AppBackground.tsx` — monta o efeito ativo em `fixed inset-0 -z-10` dentro do `#root`, com veil
  próprio e `ErrorBoundary` (WebGL não pode derrubar o app).
- `GradientWaves` vendorizado em `src/components/GradientWaves/` com os props que o usuário passou.
  Dep nova: `ogl` (~50 kB, WebGL puro, sem three.js). Sai em **chunk lazy de 51 kB** — só baixa
  para quem escolher o efeito.

**Preparação p/ os próximos efeitos (o pedido "vou mandar mais depois"):**
- `components.json` criado com o registry `@react-bits` já apontado. `pnpm dlx shadcn@latest add
  @react-bits/<Nome>-TS-TW` agora funciona e cai em `src/components/<Nome>/`.
- Alias `@` → `src/` em `tsconfig.json` (`paths`) **e** `vite.config.ts` (`resolve.alias`), porque
  o código gerado pelo shadcn importa com `@/`.
- `types/settings.ts`: `Background` virou união dos presets `| (string & {})` — mantém autocomplete
  dos fixos e aceita id novo sem editar tipo.
- `SettingsView` monta a lista de fundos a partir do registry; `useSettings` marca
  `data-bg="efeito"` (regra no `index.css` desliga `body::before/::after` p/ não duplicar veil).
- `motionOn()` exportado de `lib/motion.ts`: com animações desligadas (ou `prefers-reduced-motion`)
  o efeito é montado com `speed={0}` — congela em vez de sumir e deixar o app chapado.
- Sem slider de desfoque quando há efeito ativo: borrar canvas que repinta a 60fps é caro e não
  melhora nada.

**Regra:** nunca editar o arquivo vendorizado em `src/components/<Nome>/` — um `shadcn add` futuro
sobrescreve. Preset e ajustes moram no `registry.tsx`.

**Verificação:** typecheck limpo · vitest **27/27** (1 teste novo: efeito desliga as camadas CSS e
some com o slider de desfoque) · `vite build` ok com o chunk lazy separado · conferido no navegador
com o shader realmente pintando (`data-bg="efeito"`, 1 canvas, WebGL2 ok).

### Kit de UI `src/components/ui/` + botões de vidro líquido (2026-08-08)
O CSS de botão estava copiado à mão em **83 `<button>`** e **12 `<input type="range">`** por 13 tools
e 11 componentes, com divergências já acumuladas (`bg-accent/90` vs `bg-accent-hover`,
`disabled:opacity-40` vs `50`, `!border-accent/50`, `flex-1 py-2`). Mexer no visual = mexer em tudo.

- **`src/index.css` `@layer components`** — `.btn` + `.btn-primary` / `.btn-glass` / `.btn-picker` /
  `.btn-ghost` / `.btn-danger`, `.range` / `.range-sm`, `.checker`. Estado selecionado do segmentado
  sai do seletor `.btn-glass[aria-pressed="true"]` — **perder o `aria-pressed` apaga o visual**.
  - **Por que o CSS mora aqui e não como string no componente:** o Tailwind emite `@layer utilities`
    *depois* de `@layer components`, então qualquer `className` do call site (`w-full`, `flex-1`)
    vence sem `!important` e sem `tailwind-merge`. Por isso também **não** foi criado um `cn()`.
  - **Sem `backdrop-filter` em botão**, de propósito (~10 por tela viraria 10 camadas de composição
    no WebView2 — ver aviso em `.glass`). O vidro sai de gradiente + borda + inset highlight.
- **`src/components/ui/`** — `Button` (variants + `size` sm/md/lg + `loading`, com `forwardRef`
  porque o projeto é React 18), `SegmentedControl`, `Slider`, `Field` (movido do `SettingsView`),
  `ResultPanel` (o painel verde estava duplicado em 9 tools), `index.ts`.
  - `Button` usa prop `size`, **não** override por className: `py-2` no call site não venceria o
    `py-2.5` da base (Tailwind ordena a escala crescente) e o bug seria invisível.
- **`src/lib/motion.ts`** — `useToolEnter` achava a CTA por `button[class*="bg-accent"]`, seletor que
  a migração ia quebrar em silêncio. Trocado por `button[data-primary]` em dois passos (seletor duplo
  no meio) p/ não haver janela sem efeito. ⚠️ O efeito magnético foi **removido depois** (nem
  `attachMagnetic` nem o atributo `data-primary` existem mais) — a query em `useToolEnter` sobrou sem
  alvo. Se for reintroduzir, o gancho é `<Button variant="primary">`.

**Paleta: roxo das ondas para o que está "ligado"** — `--c-selected` / `--c-selected-deep`
(`#A855F7` → `#8300ff` no escuro, violet-600/700 no claro por contraste), tirados do gradiente de
`src/components/backgrounds/registry.tsx`. Usado em `.btn-primary`, `.btn-glass[aria-pressed]` e no
trilho/polegar do `.range` — os três vivem no mesmo card e o índigo do accent lia igual para "ação
principal" e "opção selecionada". O `--c-accent` segue sendo o índigo, agora só em foco, links,
barras de progresso e hover da scrollbar.

**Console preto piscando no Windows (corrigido)** — o Docling (e ffmpeg/ffprobe) abria uma janela de
terminal a cada spawn. Causa: 4 `tokio::process::Command::new` crus em `commands.rs`. O
`main.rs` já tinha `windows_subsystem = "windows"` e o `tauri-plugin-shell` 2.3.5 já aplica
`CREATE_NO_WINDOW` nos sidecars — só os spawns manuais escapavam. Agora todos passam por
`headless_command()`, que seta `creation_flags(0x0800_0000)` sob `#[cfg(windows)]`.
⚠️ **Qualquer processo novo tem que usar `headless_command`** — `Command::new` cru volta a piscar o
console e isso só aparece no build release. (`creation_flags` é método inerente do
`tokio::process::Command` no Windows; não precisa importar `std::os::windows::process::CommandExt`.)
O yt-dlp chama ffmpeg por conta própria, mas o `Popen` dele já trata a flag.

**Campos de texto no kit** — `.field` no `index.css` + `src/components/ui/Input.tsx`
(`Input`/`Textarea`/`Select`, prop `size` sm/md, `forwardRef`). Substituiu 20 cópias da string
`glass-inset px-3 py-2 … focus:outline-none` em 12 arquivos; `inputClass` do `SettingsView` morreu.
Foco = anel + glow roxo **estático**, não a pulsação do `.neon`: campo piscando enquanto se digita
cansa. `outline: none` explícito no `:focus` porque o `:focus-visible` global desenharia um anel
índigo de 2px por cima do glow. `size` do HTML (largura em caracteres) é `Omit`-ado do tipo nativo
nos três — colidia com a prop. Estado de erro já previsto via `[aria-invalid="true"]`.
Fora do kit de propósito: o `<textarea>` do `MarkdownViewer` (painel de edição de altura cheia,
sem borda, dentro do vidro — não é campo de formulário).

**Fundo "Linhas flutuantes"** — `FloatingLines` (React Bits) vendorizado em
`src/components/FloatingLines.tsx`, preset em `backgrounds/registry.tsx` com o roxo da paleta
(`#7C3AED`/`#A855F7`/`#c73bf6`). Traz `three` + `@types/three` (`-D`); fica num chunk lazy de
~477 kB que só carrega para quem escolhe o efeito. Duas adaptações **fora** do arquivo vendorizado
(que um `shadcn add` futuro sobrescreve): wrapper `<div>` porque o componente não aceita
`className`, e `usePointerBridge` — o `<AppBackground>` é `pointer-events: none` (senão o fundo
roubaria cliques da UI), então o canvas nunca receberia `pointermove` e `interactive`/`parallax`
nasceriam mortos; a ponte reemite a posição da janela no canvas.

**Neon no item ativo do shell** — `.neon` (ícone) e `.neon-bar` (barra lateral) em `Sidebar.tsx`:
`drop-shadow`/`box-shadow` roxo pulsando em 2.4s. `drop-shadow` e não `box-shadow` no ícone porque
segue o traço do SVG, não a caixa. O keyframe `100%` é idêntico ao `0%` de propósito: com movimento
desligado o bloco de reduced-motion força `animation-duration: .001ms` + `iteration-count: 1`, que
congela no ÚLTIMO keyframe — assim para no brilho de repouso e não no pico.
- **Barra de rolagem** (`@layer utilities`) — padrão (`scrollbar-width`/`-color`) **e** `::-webkit-*`
  com as **mesmas cores**: WebView2 recente lê um, antigo lê o outro. Pílula de 4px numa área de
  clique de 10px (`border: 3px solid transparent` + `background-clip: padding-box`), hover em acento.
  `[scrollbar-gutter:stable]` no container de `App.tsx` mata o pulo ao trocar de tool.
- **`src/components/ConvertButton.tsx` deletado** — já estava órfão (zero imports).
- **Converter imagens redesenhado** — miniaturas `grid-cols-2 sm:grid-cols-3` + `aspect-square`
  `object-contain` sobre `.checker` (para de cortar a imagem, PNG transparente lê certo), `onError`
  marca tile não-previewável (`.tiff`/`.ico`), dropzone encolhe quando já há arquivos, formato +
  qualidade agrupados num card `glass`, slider `size="sm"` inline. `ImagePreviewGrid` é exportado e
  reusado pelo tool de comprimir.
- **Não migrados de propósito:** nav da Sidebar/SettingsView e tiles do Home (layout próprio),
  `DropZone` e a dropzone do image-convert (são `<div role="button">`, não `<button>`), `Toggle`
  (switch, 1 consumidor).

**Verificação:** typecheck limpo · vitest **27/27** · cargo test **6/6**.

### ffmpeg fora do instalador (2026-08-08)

Motivo: o instalador estava com **142 MB** e o updater do Tauri não faz delta — cada atualização
baixaria tudo de novo, mesmo para uma mudança de CSS. `ffmpeg.exe` + `ffprobe.exe` somam **168 MB
crus** (59 MB zipados), mais que todo o resto junto.

**Rust — `src-tauri/src/commands.rs`:**
- O download do Docling virou genérico: `struct RemoteModule { url, sha256, zip_name, event,
  marker, label }` + `ensure_module()`. Duas instâncias hoje: `DOCLING` e `FFMPEG`. `ensure_docling`
  é um wrapper fino (o front não mudou).
- `resolve_bundled()` agora procura **primeiro** em `appLocalData/runtime/` e só depois em
  resource/repo/exe-dir. É o que faz os 6 pontos de chamada do ffmpeg funcionarem sem alteração.
- Comandos novos `ffmpeg_installed` / `ensure_ffmpeg` (evento `ffmpeg-progress`), registrados em
  `lib.rs`. `ffmpeg_installed` **não** usa `cfg`: em dev acha em `src-tauri/binaries/`, em produção
  na `runtime/` — os dois casos que `resolve_bundled` já cobre.
- `FFMPEG_AUSENTE`: mensagem única mandando o usuário para Configurações → Armazenamento, no lugar
  de `"ffmpeg não encontrado."`.
- `bundle.resources` saiu do `tauri.conf.json`.

**Empacotamento — `python/build.py ffmpeg`:** zipa os dois .exe de `src-tauri/binaries/` →
`camps-ffmpeg.zip` + SHA256. Não roda PyInstaller e **não chama `clean()`** (apagaria os sidecars
já compilados). Zip conferido como **reproduzível**: reempacotar dá o mesmo hash, então o SHA já
está fixado no Rust (`2d6433b3…b7fb`) em vez de ficar vazio como o do Docling ficou no começo.

**Front:**
- `src/components/ModuleGate.tsx` (novo) — `MODULES` (espelho do `RemoteModule` do Rust), hook
  `useModule(id)` e `<ModuleGate>`. O `DoclingGate` que morava dentro do `PdfToMarkdownTool` foi
  deletado; de quebra ele tinha um **early return antes de um hook** (`useToolEnter` vinha depois).
- `registry.tsx` ganhou `module?: ModuleId`; o `App` embrulha a tool no gate. **Uma linha por
  ferramenta** em vez de editar 5 arquivos de mídia. Marcadas: `pdf-to-markdown` (docling),
  `youtube`/`spotify`/`video-compress`/`audio-convert`/`video-to-gif` (ffmpeg).
- `SettingsView` → Armazenamento: `<ModuleCard>` genérico usando o mesmo `useModule`, então o
  status ali e o do gate não divergem. Dois cards: Docling e ffmpeg.
- `useModule` só bloqueia com `false` explícito — fora do Tauri (testes, `dev:vite`) o invoke
  devolve undefined e travar a tool por uma checagem que não rodou seria pior.

**Verificação:** typecheck limpo · vitest **35/35** · `cargo check` debug e **release** ok ·
`python build.py ffmpeg` gerou o zip de 59 MB com hash estável.

**Medido:** instalador NSIS caiu de **142 MB → 97 MB** (build 0.2.0). MSI: 98 MB.

**Pendente (ação do usuário):** publicar `python/dist/camps-ffmpeg.zip` num Release com a tag
**`ffmpeg-v1`** — a URL já está fixada no Rust e o SHA confere só com **esse** arquivo. Os `.exe` do ffmpeg e o zip
estão no `.gitignore`, ou seja, não vão pro repo — quem clonar precisa colocar os dois em
`src-tauri/binaries/` para rodar em dev.

### Pasta `installers/` na raiz (2026-08-08)

`scripts/collect-installers.mjs` copia os artefatos de
`src-tauri/target/release/bundle/{nsis,msi}/` para `installers/` na raiz — o caminho real é fundo
demais para achar à mão. Plugado em `npm run build` e `build:all`; avulso via `npm run installers`.

- **Filtra por `productName`** lido do `tauri.conf.json`. Sem isso a pasta herdava os 687 MB de
  "PDF to Markdown" (nome antigo), porque `target/` nunca é limpo e guarda artefato de nome velho
  para sempre.
- Pega `.exe`, `.msi`, `.zip` e `.sig` — os dois últimos são o que o updater do Tauri publica.
- Não limpa o destino: manter a versão N-1 por perto é útil para testar atualização.
- Sai com 0 quando não há bundle (só `build:vite` rodou) — falhar ali quebraria o build por um
  passo que nem devia ter rodado.
- `installers/` entrou no `.gitignore`.

### Atualização pelo app + sino de notificações (2026-08-08)

**Updater (plugin oficial do Tauri).** `npx tauri add updater` + `npx tauri add process`.
Chave minisign gerada pelo usuário; a **pública** ficou em `tauri.conf.json` →
`plugins.updater.pubkey`. Endpoint: `releases/latest/download/latest.json` (URL fixa, não muda a
cada versão). `installMode: "passive"`, `bundle.createUpdaterArtifacts: true`.

- `src/components/UpdateCard.tsx` — máquina de estados (ocioso/checando/disponível/baixando/pronto)
  em Configurações → Sobre. Checagem **silenciosa** ao abrir a tela: falha de rede não vira erro na
  cara do usuário. Imports do plugin são **dinâmicos** — fora do Tauri o módulo não existe e um
  import estático derrubaria a tela toda.
- `scripts/make-latest-json.mjs` (`npm run release`) monta o `latest.json` a partir do build
  assinado: lê a versão do `tauri.conf.json`, acha o instalador + `.sig` em `installers/` e embute
  a assinatura **inline** (o updater não busca o `.sig` separado). Falha listando o que existe da
  versão em vez de gerar um json inválido.
- ⚠️ **O nome do artefato assinado mudou entre versões do Tauri.** As antigas geravam
  `<app>-setup.nsis.zip` + `.nsis.zip.sig`; a **2.10 assina o `-setup.exe` direto**. O script
  procurava só o zip e dizia "o build não assinou" quando o build tinha assinado. Agora tenta
  `.nsis.zip` → `-setup.exe` → `.msi`, sempre exigindo o `.sig` do par.
- ⚠️ **A permissão é `process:allow-restart`, não `allow-relaunch`.** O `relaunch()` do JS mapeia
  para o comando `restart`; com o nome errado o `cargo check` quebra no build script (e a lista de
  permissões válidas que ele cospe tem ~10 mil caracteres).
- ⚠️ `createUpdaterArtifacts: true` **exige** `TAURI_SIGNING_PRIVATE_KEY` e
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` no ambiente, senão `npm run build` falha ao assinar.

**Sino de notificações** — pedido: avisar sobre módulo não baixado e versão nova, com contador e
piscando.

- `src/hooks/useNotifications.ts` — agrega módulos faltando (varre `MODULES`) + atualização
  disponível. Só `false` explícito conta como pendência; erro de rede/fora do Tauri **não** vira
  notificação (o usuário não pode fazer nada e alerta permanente irrita).
- `src/components/NotificationBell.tsx` — no topo da sidebar, ao lado do título. Badge com contagem
  (`9+` no estouro), fecha com clique fora e Esc. O sino **só avisa e leva** até Configurações;
  instalar continua no `ModuleCard`/`UpdateCard` — duplicar o fluxo daria dois caminhos pro mesmo bug.
- CSS: `.bell-ring` balança em intervalos de 3,2s (não sem parar — ícone em movimento contínuo
  cansa) e `.badge-pulse` usa `box-shadow` em vez de `scale`, senão o número treme e fica ilegível.
- Deep-link: `SettingsView` ganhou `initialSection` (com `useEffect`, senão reabrir noutra pendência
  não trocaria de seção com a tela já montada); `App` guarda `settingsSection`.
- ⚠️ O footer da sidebar passava `onOpenSettings` **direto** como `onClick` — com a assinatura nova
  o React entregaria o `MouseEvent` como se fosse a seção. Virou `() => onOpenSettings()`.
- 5 testes em `src/test/NotificationBell.test.tsx` (contagem, deep-link das duas seções, falha de
  rede silenciosa).

**Verificação:** typecheck limpo · vitest **40/40** · `cargo check` release ok · `build:vite` ok.

**Versão 0.1.0 → 0.2.0** (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` —
quem manda no updater é o do `tauri.conf.json`, os outros dois ficam iguais por higiene).
Minor, não patch: 15 ferramentas, visual novo, PDF com visualizador, ffmpeg fora do instalador.
Não é 1.0 porque o updater ainda não rodou ponta a ponta com usuário real.

⚠️ **O 0.2.0 é a linha de base do updater, não a primeira atualização automática.** Quem está no
0.1.0 não tem o plugin instalado — vai precisar baixar o instalador na mão uma última vez. Do
0.2.0 em diante é que o app se atualiza sozinho.

**Pendente (ação do usuário):** `TAURI_SIGNING_PRIVATE_KEY` + senha no ambiente → `npm run build`
→ `npm run release` → criar o Release na tag `v0.2.0` subindo `.nsis.zip`, `.nsis.zip.sig` e
`latest.json`.

### Gotcha de build descoberto
`python/build.py` precisa `--collect-all` p/ libs importadas de forma lazy (dentro de funções):
adicionados `markdown`, `xhtml2pdf`, `reportlab`, `svglib`, `fitz`, `pikepdf`. Sem isso o exe
empacotado dá `MODEL_ERROR`. Também: rebuild do sidecar tem que rodar **depois** de mexer no
`converter.py` (senão dispatch novo = "ferramenta desconhecida").

### Backend Rust (`src-tauri/src/commands.rs`)
- `run_python_tool(app, tool, input_json)` genérico (spawn/stream do sidecar, contrato stdout=JSON).
- `convert_pdf` virou wrapper fino → `run_python_tool("pdf2md", …)`.
- `run_tool(tool, input_json)` — comando genérico exposto ao frontend (md2pdf etc.).
- `convert_images(args)` — nativo, crates `image` + `webp`. webp/png/jpg/ico, qualidade, ico ≤256px.
- Registrados em `src-tauri/src/lib.rs`. Cargo: `image`, `webp` (tauri-build ativou `protocol-asset`).

### Sidecar Python (`python/converter.py`)
- Dispatch `--tool` (default `pdf2md` p/ compat) → `dispatch()`.
- `convert_md_to_pdf()` via `markdown` + `xhtml2pdf` (deps novas em `requirements.txt` e no `.venv`).
- `pdf2md` inalterado (Docling).

### Fixes de raiz
- **Drag-drop quebrado** (`src/hooks/useDragDrop.ts`): usava evento Tauri **v1**
  (`tauri://file-drop`); trocado p/ API v2 `onDragDropEvent`. Agora aceita `accept: string[]`
  (default `["pdf"]`) — conserta drag de PDF **e** habilita imagens.
- **Asset protocol** habilitado em `tauri.conf.json` (`security.assetProtocol.enable + scope`) p/
  thumbnails via `convertFileSrc`.

### Rename → CAMPS-UTILS
- `tauri.conf.json` (`productName`, `identifier=com.camps.utils`, título), `package.json` (`name`),
  `index.html` (`<title>`), Sidebar. **Pendente:** ícone (`scripts/setup.ps1::New-AppIcon` ainda "MD").
- Crate Rust interno segue `pdf-to-markdown` (invisível ao usuário — não mexer sem necessidade).

### Testes
- `src/test/App.test.tsx` reescrito p/ UI atual (Home → abre tool → fluxo FileQueue) + teste Base64.
- `src/test/setup.ts` mocks atualizados (`onDragDropEvent`, `convertFileSrc`).
- `python/test_converter.py` + `TestDispatch` e `TestMdToPdf`; corrigido alvo de patch pré-quebrado
  (`docling.document_converter.DocumentConverter`).

---

## Gotchas (não esquecer)

- **DEV roda o Python da fonte, não o exe.** `run_python_tool` em `commands.rs` tem `#[cfg]`:
  em **debug** (`npm run dev`) executa `.venv/Scripts/python.exe python/converter.py` direto
  (via `tokio::process`) → mudanças no `converter.py` valem na hora, sem PyInstaller. Em **release**
  usa o sidecar empacotado. ⇒ **Não precisa `build:python` pra testar sidecar em dev.**
- **Sidecar empacotado (`build:python`) só importa p/ RELEASE/instalador.** Rodar quando for gerar
  o `.exe` final; precisa das libs coletadas no `build.py` (docling, md2pdf, pdf, yt_dlp).
- **Drag/preview/asset só funcionam no Tauri real** (`npm run dev`), não em `npm run dev:vite`.
- **`tauri dev` 1ª vez**: Rust ~10-20 min; depois rápido.
- **YouTube em ambiente de datacenter** retorna "Video unavailable" (IP bloqueado). Testar só em
  máquina com IP residencial.

---

## Próximos passos

### Fase 1 — fechar o que falta
- [~] Rebuild do sidecar com `--tool` via `build.py` — **em andamento** (background). Depois
      `npm run dev` e validar visualmente TODAS as tools (inclui runtime de imagem e thumbnails).
- [x] Ícone CAMPS-UTILS **definitivo** (2026-08-08): arte real em `app-icon.png` na raiz
      (1254×1254 RGBA, chave de vidro sobre squircle roxo `#A855F7`→`#8300FF`, mesma linguagem do
      fundo de ondas). Regenerado com `npx tauri icon` → todo `src-tauri/icons/*`. Conferido a 32px
      e no 16px de dentro do `icon.ico` (a chave continua legível).
      `scripts/setup.ps1` passou a preferir `app-icon.png`; o `New-AppIcon` (placeholder "C") virou
      plano B para clone incompleto. Já era guardado por `if (-not (Test-Path icon.ico))`, então
      nunca sobrescreve arte existente.
      ⚠️ **Gotcha de PowerShell:** `setup.ps1` não tem BOM, então o PS 5.1 lê como ANSI. Um
      travessão dentro de string vira aspa curva, que **fecha a string** e desalinha as chaves do
      arquivo inteiro. Só hífen simples aqui. Validar com
      `[System.Management.Automation.Language.Parser]::ParseFile(...)` depois de editar.
- [x] **build.py split**: `python build.py light|docling|both`. Light exclui torch/docling
      (`--exclude-module`) → só ferramentas leves. Docling gera `camps-docling.zip` + `.sha256`.
- [x] **Download no 1º uso** (escolhido em vez de NSIS): Rust `ensure_docling` (reqwest stream +
      SHA256 + crate `zip` → `%LOCALAPPDATA%/com.camps.utils/runtime/`), `docling_installed`, rota
      release `pdf2md` → sidecar docling baixado (`run_docling_release`). Frontend `DoclingGate` no
      PdfToMarkdownTool (botão + barra via evento `docling-progress`). Dev = no-op (roda a fonte).
- [x] Git: `git init` + commit em `main` + remote `FelipeCamposM/CAMPS-UTILS`.
- [x] Build **light** = 89.8 MB (md2pdf ok; pdf2md → MODEL_ERROR, docling fora). Instalador ≈275MB.
- [x] Build **docling** → `python/dist/camps-docling.zip` (368 MB) + SHA256.
- [x] `DOCLING_SHA256` preenchido em `commands.rs`
      (`6620709852f9edeba4a8d9f4b232c2f1b70396f0286b040370eb3f789f6782bf`). 2 commits em `main`.
- [ ] **Usuário:** `git push -u origin main`; Release **tag `docling-v1`** (exato) → subir
      `python/dist/camps-docling.zip`; depois `npm run build`.
- [ ] (Opcional/futuro) NSIS install-time download; MSI full offline.
- [ ] Validar visualmente o **tema claro** (`npm run dev`): cores hardcoded de estado
      (`text-red-400`, `bg-green-950/20`, `bg-amber-950/20`) não foram tokenizadas.
- [ ] (Opcional) Comando Rust de leitura de arquivo → habilita importar/exportar configurações;
      comando p/ remover o módulo Docling e liberar ~700 MB.

### Fase 2 — YouTube
- [x] Empacotar **ffmpeg + ffprobe** (static, ~87MB cada) em `src-tauri/binaries/`; `tauri.conf.json`
      `bundle.resources`. Rust `resolve_ffmpeg` (prod=resource, dev=`CARGO_MANIFEST_DIR`, fallback exe).
- [x] Sidecar `--tool youtube` (`yt-dlp`): `audio`(mp3) / `video`(mp4) / `playlist_audio`.
      `ffmpegLocation` injetado pelo Rust.
- [x] **Progresso real**: `run_python_tool` emite `tool-progress` ao ver `PROGRESS: <pct>` no stderr;
      `YoutubeTool` escuta com `listen()` e mostra barra.
- [x] Tool `src/tools/youtube/YoutubeTool.tsx` (URL, modo, kbps, pasta) — categoria Mídia.
- [ ] **Validar download real** — bloqueado aqui (IP de datacenter → YouTube barra). yt-dlp/ffmpeg/erros
      OK; falta testar na máquina do usuário (`npm run build:python` + `npm run dev`).
- [~] Rebuild do sidecar com `yt_dlp` coletado — **em andamento** (background).

### Fase 3 — PDF-utils, mídia extra, utilitários, tamanho
- [x] PDF: juntar / dividir / comprimir (sidecar `pdf_merge`/`pdf_split`/`pdf_compress` via PyMuPDF).
      Tool único `src/tools/pdf-tools/PdfToolsTool.tsx` (3 modos). Pytest 12/12 (rápido, sem Docling).
      **Antecipado.** Falta validar via exe empacotado após rebuild.
- [x] Imagens: redimensionar / renomear em lote — Rust `resize_images` (helper
      `write_image` reaproveitado), tool `src/tools/image-resize/ImageResizeTool.tsx`. cargo test 4/4.
      **Antecipado.**
- [x] **Imagens: comprimir** — virou **tool próprio** (antes era só o knob `quality` do
      `resize_images`). Rust `compress_images` + helpers `encode_image` (extraído de `write_image`)
      e `search_quality` (busca binária, ≤ 8 encodes). Dois modos: qualidade fixa ou tamanho-alvo
      em KB. Formato `Manter | WebP | JPG`. Sem crate nova — PNG/ICO/GIF/BMP/TIFF são sem perdas,
      pulam a busca e a UI avisa sugerindo WebP. Guardas: não recodifica arquivo já abaixo do alvo,
      não devolve arquivo maior que o original. Tool
      `src/tools/image-compress/ImageCompressTool.tsx`, service `compressImages`. cargo test 6/6.
- [x] **Comprimir vídeo** — Rust `compress_video` (ffmpeg H.264, CRF Leve/Médio/Forte), progresso
      real via ffprobe + `-progress pipe:1`. Tool `src/tools/video-compress/`. Pipeline validado
      headless (155KB→43KB). **Antecipado.**
- [x] **Converter áudio** (mp3/wav/flac) — Rust `convert_audio` (batch, ffmpeg). Tool
      `src/tools/audio-convert/`. Validado headless.
- [x] **Vídeo → GIF** — Rust `video_to_gif` (fps/largura/trecho, ffmpeg + progresso). Tool
      `src/tools/video-to-gif/`. Validado headless. Helpers `ffmpeg_run`/`ffmpeg_run_progress`
      compartilhados com `compress_video`.
- [x] QR code (`qrcode`) + hash/checksum (`sha2`/`sha1`/`md5`/`hex`) — **antecipados p/ agora**.
      Comandos Rust `generate_qr`/`hash_files` (+ `cargo test` c/ vetores conhecidos), tools
      `src/tools/qr-code/` e `src/tools/hash/`, registrados na categoria Utilitários.
- [ ] Trims oportunistas no bundle Docling (`--exclude-module`, UPX, torch CPU-only); medir zip.

> Nota de ordem: QR e hash foram puxados da F3 p/ frente (eram Rust puro, testáveis headless) enquanto
> o empacotamento F1 aguarda feedback de build/instalador.

---

## Verificação por fase (rodar sempre)
- `npm run typecheck` · `npm run test` · `cargo check` · `pytest python/test_converter.py`
- Manual: `npm run build:python` → `npm run dev` → exercitar cada tool com arquivo real.
- Web installer (F1): rodar `.exe` em máquina limpa com internet; testar hash inválido/offline.
