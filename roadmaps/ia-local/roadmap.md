# Roadmap — IA local: legendas, voz, imagem

Fase 4 da suíte CAMPS-UTILS. Roadmap da Fase 1–3: `roadmaps/new-functions/roadmap.md`.

- **Prompt de arranque:** `roadmaps/ia-local/PROMPT.md` (Fase A)
- **Fluxo de agentes:** `roadmaps/ia-local/AGENTES.md` — quem faz o quê, os três portões, o que roda
  em paralelo. Definições em `.claude/agents/`.

Criado em 2026-08-08. Nada implementado ainda — este documento é o plano.

---

## Por que agora

Até a 0.2.0 o critério para recusar funcionalidade era **peso no instalador**. A spec original
chegou a listar remoção de fundo de imagem como fora de escopo por isso.

Esse critério caiu quando o `RemoteModule` (`src-tauri/src/commands.rs`) entrou em produção:
qualquer coisa pesada vira um zip num Release, verificado por SHA256 e extraído em
`appLocalData/runtime/`. O instalador não sente. Já há dois módulos rodando (`docling-v1`,
`ffmpeg-v1`) e o mecanismo aguenta mais.

A pergunta virou **"vale manter?"** em vez de **"cabe?"**.

---

## Princípios desta fase

1. **Antes de adicionar dependência, procurar no armário.** Ver a seção abaixo — três itens da
   lista de desejos já são resolvidos pelo ffmpeg que está empacotado.
2. **ONNX / ncnn / CTranslate2 antes de PyTorch.** Torch custa ~350 MB só de runtime. Já pagamos
   isso uma vez no bundle do Docling; não queremos pagar de novo por ferramenta.
3. **Binário spawnado > sidecar Python.** Vários candidatos (piper, realesrgan-ncnn, deep-filter)
   são executáveis autônomos: o Rust chama direto, igual faz com o ffmpeg. Sem PyInstaller, sem
   contrato de JSON no stdout, sem 90 MB de interpretador.
4. **Cada fase entrega algo usável sozinho.** Nada de três semanas até a primeira coisa que roda.
5. **Um módulo por capacidade, não por ferramenta.** `whisper-v1` serve legenda, ata e busca em
   vídeo. Não criar um módulo por tela.

---

## O que já está no armário (medido, não suposto)

Conferido no `src-tauri/binaries/ffmpeg.exe` (gyan.dev, 2024-12-23):

```
--enable-libass  --enable-libfreetype  --enable-libfribidi  --enable-libharfbuzz
--enable-fontconfig  --enable-nvenc  --enable-amf  --enable-libvpl  --enable-libx264/x265
```

| Já resolvido pelo ffmpeg | Dispensa |
|---|---|
| Filtros `ass` e `subtitles` (libass) | qualquer lib de render de legenda |
| `loudnorm` — normalização EBU R128 | `pyloudnorm` (+ numpy/scipy) |
| `arnndn` — redução de ruído em voz por RNN | `DeepFilterNet` no caso simples |
| `silenceremove` / `silencedetect` | `silero-vad` no caso simples |
| `nvenc` / `amf` / `libvpl` | codificação por GPU na queima da legenda |
| `libfribidi` + `libharfbuzz` | moldagem correta de acento em português |

**Consequência:** `pyloudnorm` sai da lista. `DeepFilterNet` vira *upgrade opcional*, só se o
`arnndn` não der conta — decidir **medindo**, não por suposição. O `arnndn` precisa de um arquivo
de modelo `.rnnn` (livres no repositório do RNNoise, poucos KB).

**`silero-vad` também sai da lista** — mas por outro motivo, descoberto ao medir o Portão 0: ele
**já vem dentro do faster-whisper**, via o `onnxruntime` que o módulo carrega. Não é dependência
nova, é um parâmetro (`vad_filter=True`).

---

## Módulos previstos

| Módulo | Tag | Conteúdo | Peso | Runtime |
|---|---|---|---|---|
| `whisper-v1` | `whisper-v1` | faster-whisper + CTranslate2 | **90 MB (medido)** | CTranslate2 |
| (modelos) | — | baixados à parte, escolha do usuário | 75 MB – 1,5 GB | — |
| `piper-v1` | `piper-v1` | piper.exe + 1–2 vozes pt-BR | ~80 MB* | ONNX |
| `translate-v1` | `translate-v1` | argos-translate + par en↔pt | ~150 MB* | CTranslate2 |
| `upscale-v1` | `upscale-v1` | realesrgan-ncnn-vulkan + modelos | ~90 MB* | ncnn/Vulkan |
| `rembg-v1` | `rembg-v1` | rembg + u2net | ~200 MB* | ONNX |
| `depth-v1` | `depth-v1` | onnxruntime + numpy + Pillow | **ver Fase F** | ONNX |
| (pesos) | — | Depth Anything V2 Small, baixado no 1º uso | 94 MB | — |

\* Estimativas de memória, **não medidas**. O Docling virou 700 MB por causa do torch — prototipar
e medir antes de assumir compromisso com qualquer um.

**Nenhum módulo desta fase puxa PyTorch.** É condição, não coincidência: separação de faixas
(demucs) foi avaliada e **descartada** justamente por isso — sozinha passaria de 2 GB, mais que o
Docling inteiro. Se alguma dependência trouxer torch de carona, é sinal de que a escolha está
errada; parar e procurar o equivalente em ONNX, ncnn ou CTranslate2.

---

## Fase A — Módulo de fala e transcrição

**Entrega:** vídeo entra, `.srt`/`.vtt` sai. Sem estilo, sem queimar, sem editor.
Já é útil para quem publica no YouTube, e é o que valida peso e velocidade reais.

### ✅ Portão 0 — MEDIDO em 2026-08-08

Protótipo empacotado com PyInstaller (`--onefile`, `--collect-all` de `faster_whisper`,
`ctranslate2`, `tokenizers`, `onnxruntime`), executado e validado.

```
faster-whisper 1.2.1 + ctranslate2 4.8.1
EXE: 89,7 MB    ZIP: 89,1 MB    TORCH: não
compute types disponíveis em CPU: float32, int8, int8_float32
VEREDITO: viável — abaixo da estimativa de 100–200 MB, muito abaixo do corte de 400 MB
```

O `--onefile` já comprime, então zipar quase não ganha nada (89,7 → 89,1 MB). Diferente do
Docling, aqui o zip do Release é praticamente o próprio exe.

**Composição (tamanho no venv, antes da compressão):** `av.libs` 62,6 · `ctranslate2` 59,8 ·
`onnxruntime` 42,5 · `numpy` 50,9 · `tokenizers` 7,5.

**Duas descobertas que mudam o plano:**

1. **`onnxruntime` dentro do faster-whisper É o Silero VAD.** Sai da lista de dependências
   separadas — o VAD que a Fase E queria já vem de graça dentro deste módulo. Cortá-lo economiza
   14 MB (89,7 → 75,6, e o exe continua rodando), mas leva o VAD junto. **Não cortar.**
2. **`av` (PyAV) empacota o próprio ffmpeg — 62,6 MB duplicados**, já que o app distribui ffmpeg
   à parte. Excluir derruba para 49,4 MB, **mas o exe não roda**: `faster_whisper/__init__.py`
   importa `audio.py`, que importa `av` no topo. Só seria possível com stub, o que quebraria a
   cada atualização da lib. **Fica como otimização conhecida e recusada** — 40 MB não valem essa
   fragilidade num módulo que já cabe no orçamento.

- [x] Protótipo de empacotamento e medição.

### ✅ Fase A implementada em 2026-08-08

- [x] `RemoteModule WHISPER` em `commands.rs` + `whisper_installed`/`ensure_whisper`
      (evento `whisper-progress`), registrados em `lib.rs`.
      `run_docling_release` virou **`run_module_sidecar`** genérico — Docling e Whisper usam o
      mesmo caminho, e um módulo novo é uma linha no `match`.
- [x] `python build.py whisper` → `camps-whisper.zip` **112 MB**, SHA fixado no `commands.rs` e o
      exe testado transcrevendo de verdade (12 blocos de um WAV em pt-BR).
      ⚠️ **Este zip não é reproduzível** (o PyInstaller carimba data e build id), diferente do
      ffmpeg. Publicar exatamente o arquivo gerado, ou refazer o build e atualizar a constante.
      ⚠️ `clean()` do `build.py` passou a **preservar `camps-*.zip`/`.sha256`** — antes ele apagava
      `python/dist/` inteiro, e construir um alvo destruía o pacote de Release de outro (o do
      Docling custa ~40 min para regerar).
- [x] Setting `whisperModel` (tiny…large-v3, padrão `small`) e `subtitleFormat`, com controles em
      Configurações → Mídia. Modelo baixa sozinho no 1º uso, no cache da HuggingFace.
- [x] Tool `transcribe` no `converter.py`. `language="pt"` por padrão, `word_timestamps=True`,
      `vad_filter=True`. Progresso **real** (`PROGRESS:` por segmento), não contador falso.
- [x] `python/subtitles.py` — segmentação pura + geração de SRT/VTT. 19 testes.
- [x] Tool `video-subtitle` no registry com `module: "whisper"`, mais `ModuleCard` em
      Armazenamento.

**Contrato fixado antes de codar** (é o que o `AGENTES.md` manda):
`{inputPath, outputPath, language, model, format}` → `{success, outputPath, durationMs, language,
segments[], text}`. Os `segments` já são os blocos finais, que é o que a Fase C vai editar.

**Achados que só apareceram testando de verdade:**

1. **`_quebrar_em_linhas` descartava palavra.** Com `max_linhas <= 1` a recursão devolvia só a
   primeira linha e jogava o resto fora. A frase "…sem enviar nada para a internet." virava
   "…sem enviar nada para a" — a legenda **mentindo sobre o que foi dito**, o pior defeito
   possível. Os 17 testes de unidade não pegaram porque nenhum caía na fronteira exata
   (78 caracteres: cabe no bloco de 84, não cabe em 2 linhas de 42).
   Corrigido: na última linha disponível devolve todo o resto, **mesmo estourando** `max_chars` —
   linha comprida é defeito visual, palavra sumida é defeito de conteúdo.
   Teste de regressão com a frase exata que falhou.
2. **Só o teste ponta a ponta acha esse tipo de coisa.** Gerei fala em pt-BR com o SAPI do Windows
   (`System.Speech`, voz "Microsoft Maria Desktop") e transcrevi de verdade. Vale repetir a receita
   nas próximas fases — não custa nada e é o único jeito de ver a saída real.
3. **O módulo é autossuficiente:** o PyAV que vem junto traz o próprio ffmpeg, então a transcrição
   funciona mesmo sem o módulo `ffmpeg` instalado.

**Verificação:** typecheck limpo · vitest 40/40 · pytest **68/68** · cargo debug e release ok ·
smoke real gerando SRT com tempos corretos e 3 blocos.

### Ajustes após o 1º uso real (mesmo dia)

Relato: *"a barra fica sempre em 0% e depois finaliza"* e *"preciso ver a miniatura do vídeo"*.

**A barra não estava quebrada — estava invisível.** Medindo os tempos:

```
 8.8s  STEP: Carregando modelo tiny      <- 9 s antes de existir qualquer progresso
 9.8s  STEP: Transcrevendo
11.3s  PROGRESS: 15 … 98                 <- tudo em 2,3 s
```

A parte cara acontece **antes** de haver progresso: startup do Python, carga do modelo e, no
primeiro uso, o download de até 3 GB. Em arquivo curto isso é 100% do tempo percebido.

- `emit_progress_lines` (`commands.rs`) agora entende **`STEP:`** e emite `tool-step` com o texto.
  O prefixo já existia no Python desde o Docling, mas o Rust só lia `PROGRESS:` e `EVENT:` — a
  informação estava sendo produzida e jogada fora.
- A barra é **indeterminada** enquanto `progresso === 0`, em vez de mostrar "0%" parado. Zero
  estático lê como travado; barra andando + texto da etapa lê como trabalhando.
- `_modelo_em_cache()` no Python escolhe entre "Carregando modelo" e **"Baixando modelo (só na
  primeira vez)"**. Errar a detecção muda só a mensagem, então qualquer exceção assume "em cache".

**Prévia do arquivo** — `src/components/MediaPreview.tsx`:

- `<video>`/`<audio>` de verdade via `convertFileSrc`, não miniatura estática: dá para dar play e
  pular no meio para confirmar que é o arquivo certo. Custo zero — quem decodifica é o WebView,
  sem passar pelo ffmpeg.
- Mostra a **duração**, lida do próprio elemento (`onLoadedMetadata`).
- ⚠️ **Exigiu `media-src` no CSP** (`tauri.conf.json`). O `img-src` já liberava `asset:`, mas mídia
  cai em `media-src`, que herdava `default-src 'self'` — sem isso o elemento carrega vazio e o erro
  só aparece no console.
- Formato que o WebView não decodifica (mkv com codec exótico) cai num aviso discreto; a
  transcrição funciona mesmo assim, porque quem lê o arquivo é o PyAV.

### Armadilhas do empacotamento (2026-08-08)

**O bundle real deu 144 MB, não os 90 MB do Portão 0.** A medição empacotou só o `faster-whisper`
isolado; o bundle de verdade passa pelo `converter.py` **inteiro**, e o PyInstaller segue import
dentro de função — vieram junto `yt_dlp`, `websockets`, `requests`, `reportlab`, `curl_cffi`.
Excluindo o que é do bundle light: **112 MB**. Lição: medir a lib isolada dá o piso, não o total.

**A exclusão engoliu o que era para ser coletado.** `onnxruntime` está em `DOCLING_MODULES`, então
o comando saía com `--collect-all onnxruntime` **e** `--exclude-module onnxruntime`. A exclusão
vence, e o exe morria em execução com *"Applying the VAD filter requires the onnxruntime package"*.

Só apareceu no **exe empacotado** — em dev a `.venv` tem tudo e nada falha. `build_whisper` agora
subtrai a lista de coletados da de excluídos, o que fecha essa classe de bug de vez.

⚠️ **Regra que vale para todo módulo novo:** rodar o `.exe` gerado antes de publicar. `cargo check`,
pytest e o teste em dev **não cobrem** o empacotado — foi assim que o `MODEL_ERROR` do
`LIGHT_COLLECTS` apareceu na fase anterior, e é exatamente o mesmo erro de novo.

**Pendente:** publicar o Release `whisper-v1` (**pre-release**) com o `camps-whisper.zip` gerado.
E validar no `npm run dev` — download do módulo e gate só existem no app real.
- [ ] `RemoteModule WHISPER` em `commands.rs` + `python build.py whisper` gerando
      `camps-whisper.zip` + SHA256 (espelhar `build_docling`).
- [ ] Download de modelo separado do runtime, como o Docling faz com o cache da HuggingFace.
      Setting nova: `whisperModel` (`tiny`/`base`/`small`/`medium`/`large-v3`), padrão `small`.
- [ ] Tool Python `transcribe`: `{inputPath, language, model, wordTimestamps}` → segmentos +
      palavras com tempo. `language="pt"` **forçado por padrão** — a autodetecção confunde
      português com espanhol.
- [ ] Extração de áudio via ffmpeg (16 kHz mono WAV) antes de transcrever.
- [ ] **Segmentação de linhas** — é aqui que mora a qualidade. Regras: máx. 2 linhas, ~42
      caracteres por linha, quebrar em fronteira de frase, duração mín./máx. por bloco.
      Testes de unidade obrigatórios: é lógica pura e é o que separa legenda profissional de
      paredão de texto.
- [ ] Progresso **real** via `PROGRESS:` no stderr — o faster-whisper reporta por segmento.
      Diferente do Docling, aqui não precisa de progresso falso.
- [ ] Tool `video-subtitle` no `registry.tsx` com `module: "whisper"`.
- [ ] Exportar `.srt` e `.vtt`.

**Verificação:** vídeo curto em português → SRT abrindo no VLC com tempos corretos.

---

## Fase B — Estilo e queima

**Entrega:** o "uau". Escolher um preset visual e receber o vídeo legendado.

### ✅ Implementada em 2026-08-09

- [x] `para_ass()` + `ESTILOS` em `python/subtitles.py` — um `dataclass` por preset, mesmo padrão
      do `registry.tsx`. Adicionar estilo é uma entrada no dicionário.
- [x] Presets: **Clássico**, **YouTube** (caixa opaca), **Karaokê** (roxo da marca, com salto de
      escala), **Minimalista**, **Neon**. Espelhados em `SUBTITLE_STYLES` no
      `conversionService.ts` — só os rótulos, porque é texto de interface.
- [x] `transcribe` aceita `format: "ass"` + `style`.
- [x] Comando Rust **`burn_subtitles`** reaproveitando `ffmpeg_run_progress` e `probe_duration`.
      Dois modos: queimar (recodifica, `-vf ass=`) ou faixa (`-c copy -c:s mov_text`, instantâneo).
- [x] Interface: "Arquivo de legenda" x "Vídeo legendado", seletor de estilo e de modo de gravação,
      com o texto explicando que faixa não aparece em Instagram/TikTok.
- [x] 9 testes novos de ASS (28 no total em `test_subtitles.py`).

**Armadilhas resolvidas:**

- ⚠️ **Caminho do Windows dentro de filtro do ffmpeg.** O `-vf` tem sintaxe própria: `:` separa
  argumentos e `\` escapa. `C:\Users\…` cru faz o ffmpeg falhar com um erro que não menciona
  caminho. `escapar_para_filtro()` converte para `C\:/Users/…`. **A ordem importa** — trocar a
  barra invertida primeiro, senão as escapadas seguintes viram alvo.
- ⚠️ **No ASS a quebra de linha é `\N` literal**, não newline. Um newline de verdade encerra o
  registro `Dialogue` e o libass ignora silenciosamente o resto da legenda.
- ⚠️ **Tempo do ASS é em centésimos** (`H:MM:SS.cc`), não milésimos como no SRT.
- **CRF 20 na queima**, não os 28 do compressor: a legenda tem borda dura e compressão agressiva
  suja o contorno.
- `SegmentedControl` é genérico sobre `string | number` — booleano não passa. O modo de gravação
  virou union de string em vez de alargar o componente por um caso.

**Verificado de ponta a ponta:** vídeo estático + fala sintética → `.ass` no preset karaokê →
queima → comparação de pixels contra a mesma base recodificada **sem** o filtro. Região alterada
`(304, 536, 986, 641)` num quadro de 720px: centralizado e a 79px do rodapé, exatamente a
`margem_v` do preset escalada de 1080 para 720. Inspeção visual confirmou fonte, contorno roxo e
posição.

💡 A primeira tentativa desse teste usou `testsrc` (padrão animado) e deu "diferença em 100% do
quadro" — inconclusivo, porque o quadro muda sozinho. Comparação de pixel só diz alguma coisa com
**fonte estática e mesma recodificação nos dois lados**.

### ✅ Queima por GPU (2026-08-09)

- [x] `escolher_encoder()` testa **na prática** cada candidato — codifica 0,1 s e confere o código
      de saída. Ter `h264_nvenc` compilado no ffmpeg não diz nada sobre haver GPU NVIDIA.
      Ordem: nvenc → qsv → amf → libx264. Resultado cacheado num `OnceCell` (cada tentativa custa
      um processo).
- [x] Comando `video_encoder` + `nomeDoEncoder()` — a interface diz "Codificando com placa NVIDIA"
      em vez de deixar o usuário adivinhar por que está rápido ou lento.
- [x] `h264_mf` (MediaFoundation) **fora de propósito**: aceita quase tudo, mas o controle de
      qualidade é impreciso; o libx264 é um plano B melhor que um encoder que não obedece.

**O ganho é bem menor do que eu havia afirmado.** Prometi "minutos em vez de dezenas de minutos";
medido em 60 s de 1080p:

| | tempo | arquivo |
|---|---|---|
| libx264 `crf 20` | 14,2 s | 3,88 MB |
| h264_nvenc `cq 32` | 9,9 s | 3,87 MB |

**1,44x**, não 10x. O motivo: **o filtro do libass roda em CPU**. A GPU acelera só a etapa de
encode; decodificar e desenhar a legenda continua no processador, e é isso que domina o tempo.
Vale ligar, mas não é a transformação que eu vendi.

⚠️ **`cq` do NVENC não é `crf` do x264.** Passar o número cru dava arquivo **151% maior** pela
mesma qualidade nominal (cq20 → 9,75 MB contra crf20 → 3,88 MB). Cada encoder ganhou um
deslocamento: nvenc +12 (medido: crf20 ≈ cq32, bateu 3,87 vs 3,88 MB), qsv +6 e amf +8
**por estimativa — esta máquina só tem NVIDIA**. Se aparecer relato de arquivo grande em Intel ou
AMD, é o primeiro lugar para olhar.

💡 O preset `p7` do NVENC foi testado e descartado: mesmo tempo (a GPU não é o gargalo) e arquivo
maior que o `p5`.

💡 Comparar encoders por "mesmo número de qualidade" **não compara nada**. Só faz sentido medir
tempo com o **tamanho de arquivo equiparado** — foi o que mudou a conclusão de "2,5x mais rápido
e 151% maior" para "1,44x mais rápido com o mesmo tamanho".
- [ ] **Preview real**, não CSS. Renderizar 3–5 s do próprio vídeo com o estilo aplicado.
      Preview em HTML/CSS por cima de um `<video>` é tentador e **mente**: libass e CSS não
      renderizam igual, e o usuário escolheria uma coisa recebendo outra.
- [ ] Embarcar 2–3 fontes com licença aberta (OFL). Sem isso, o libass troca a fonte em silêncio
      quando a máquina não tem a pedida, e a saída não bate com o preview.
- [ ] Fila de renderização com progresso real (o ffmpeg já reporta; a máquina de progresso existe).

**Verificação:** o mesmo vídeo com os 5 presets, conferindo que a saída bate com o preview.

---

## Fase C — Editor e animação palavra a palavra

### ✅ Implementada em 2026-08-09

O karaokê, os ritmos, os estilos com fonte/tamanho/posição, a importação de `.srt` e a prévia ao
vivo já tinham sido feitos direto no módulo. **O que faltava era o editor** — e era a peça que eu
tinha apontado como a cara e a que importa.

**Backend:**
- `subtitles.de_segmentos()` — blocos a partir do que a interface devolve. Preserva o tempo por
  palavra do Whisper quando a contagem ainda casa com o texto; recalcula quando não casa.
- `subtitles.redistribuir_palavras()` — recalcula o tempo dentro do bloco com peso pelo comprimento
  da palavra ("extraordinariamente" leva mais que "de"). É aproximação, não alinhamento forçado, e
  por isso **só entra quando o texto mudou** — o tempo do Whisper é sempre melhor quando vale.
- Tool `subtitle_write` — grava srt/vtt/ass a partir dos blocos editados. Bundle **light**: só mexe
  em texto, não carrega o Whisper.
- 11 testes novos (104 no total em `python/`).

**Interface:**
- `src/components/SubtitleEditor.tsx` — lista de blocos com texto editável, deslocamento de ±0,1 s,
  remoção e botão para ouvir o trecho.
- `MediaPreview` ganhou `onMedia` (callback ref) para o editor comandar o `<video>`. Callback ref e
  não `forwardRef` porque o elemento alterna entre `<video>` e `<audio>` conforme o arquivo.
- **O diálogo de salvar mudou de lugar**: antes pedia o destino *antes* de existir texto, obrigando
  a decidir onde guardar algo que ainda podia estar errado. Agora é transcrever → revisar → gravar.

**Decisões:**
- `textarea` e não `input` no bloco: a quebra de linha é significativa — é ela que vira `\N` no
  `.ass` e a segunda linha no `.srt`.
- Deslocar move início e fim juntos, preservando a duração. Esticar bloco não entrou: o erro típico
  do Whisper é de posição, não de tamanho.
- **Corrigir uma palavra sem mudar a contagem preserva o tempo original** — trocar "transclica" por
  "transcrição" mantém o alinhamento exato do Whisper, e só uma edição que soma ou remove palavras
  dispara o recálculo.

**Teste que fixa a conta do karaokê:** a soma dos `\k` de um bloco tem de bater com a duração dele
em centésimos. Sobrando, a última palavra acende antes do fim; faltando, o destaque atrasa e
dessincroniza ao longo do bloco.

**Verificado de ponta a ponta:** transcrição → correção de "transclica" → gravação em `.srt` e em
`.ass` com karaokê. Conferido que o acento sobrevive em UTF-8 (`\xc3\xa7`), que o texto antigo
desapareceu do `.ass` e que as durações somam certo nos dois blocos.

### ✅ Editor também no "Legendar vídeo" + layout em duas colunas (2026-08-09)

Pedido: corrigir grafia **antes de queimar**, e aproveitar a largura em vez de empilhar tudo, com a
prévia sempre à vista.

- **`gerar()` virou duas etapas.** `revisar()` traz os blocos para a memória (transcrevendo ou lendo
  o arquivo) e `gerar()` grava o `.ass` **a partir dos blocos revisados** e queima. Corrigir uma
  palavra depois de queimar significaria recodificar o vídeo inteiro de novo.
- **Tool `subtitle_read`** — lê `.srt`/`.vtt` e devolve os blocos sem gravar nada. O `restyle` também
  devolvia segmentos, mas escrevia um `.ass` que seria descartado (o definitivo sai depois da
  revisão). Ler e escrever são coisas diferentes.
- `subtitle_write` passou a aceitar as cores, senão o caminho revisado perderia o que o usuário
  escolheu no seletor.
- **Layout:** `grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]`, coluna esquerda `lg:sticky`.
  Prévia + botão + progresso + resultado à esquerda, fixos; controles e editor à direita, rolando.
  Abaixo de `lg` volta a coluna única. `wide: true` no registry para caber (672px + 416px em 1152).
- **A prévia mostra a primeira frase real** assim que existe transcrição, no lugar da de exemplo —
  é o que revela cedo que a fonte não cabe ou que o texto estourou duas linhas.
- `SubtitlePreview` ganhou `onMedia` para o editor comandar o `<video>` (clicar no bloco leva o
  vídeo até ele). O ref interno é encadeado: o componente precisa do elemento para medir o quadro.
- ⚠️ `useRef<HTMLVideoElement>(null)` gera ref **somente-leitura**; encadear exige
  `useRef<HTMLVideoElement | null>(null)`.
- 10 testes de `SubtitleEditor` (73 no vitest, 127 no pytest).

**Verificado no navegador:** grid resolvendo em `672px 416px`, coluna esquerda `position: sticky`, e
a prévia permanecendo no lugar ao rolar a coluna de controles.

### Plano original

**Entrega:** legenda de qualidade profissional. A parte cara.

- [ ] Editor de transcrição: lista de blocos com tempo, texto editável, sincronizado com o vídeo
      tocando. É a maior peça de interface do recurso inteiro.
- [ ] Corrigir nome próprio, sigla e número — o Whisper escreve "vinte e três" onde se quer "23".
- [ ] Ajuste fino de tempo por bloco (arrastar borda).
- [ ] Tags de karaokê no `.ass`: `\k`/`\kf` para acender palavra a palavra.
- [ ] Animação de entrada: `\fad`, e `\t(...\fscx110\fscy110)` para o "pop" de escala.
- [ ] Exportar `.ass` para quem quiser refinar no Aegisub.

---

## Fase D — Tradução offline

**Entrega:** vídeo em inglês vira vídeo legendado em português. Sem nuvem, sem conta, sem limite.
É a combinação que quase nenhum app local tem.

- [ ] `RemoteModule TRANSLATE` — argos-translate, par en↔pt.
- [ ] Tool `translate`: SRT/ASS entra, SRT/ASS traduzido sai, **preservando os tempos**.
- [ ] Alternativa a considerar: o próprio Whisper traduz para inglês nativamente (`task=translate`).
      Serve para "qualquer idioma → inglês", mas **não** para "inglês → português" — daí o argos.
- [ ] Encadear na tool de legenda: caixa "traduzir para" no fluxo.

**Pipeline completo desejado:** `yt-dlp → ffmpeg → faster-whisper → argos → ffmpeg queima`.
Três das cinco peças já existem.

---

## Fase E — Voz e áudio

- [ ] **`piper-tts`** — `RemoteModule PIPER`. É um **executável autônomo com vozes ONNX**: o Rust
      chama direto, sem sidecar Python. Vozes pt-BR existem e são boas.
- [ ] **Tool "PDF → Podcast"**: PDF → Markdown (Docling, já existe) → piper → MP3.
      Um artigo vira algo para ouvir no trânsito. **É um pipeline, não uma ferramenta nova** —
      ver Fase G.
- [ ] **`mutagen`** — leitura/escrita de tags (ID3, FLAC, capa). Python puro, leve, entra no
      bundle **light**. Ferramenta de editar metadados em lote; a tool do Spotify passa a usá-la.
- [ ] Normalização de volume — **`ffmpeg -af loudnorm`**, não `pyloudnorm`. Zero dependência.
- [ ] Redução de ruído — **`ffmpeg -af arnndn=model=...`** primeiro (precisa do `.rnnn`).
      Só avaliar `DeepFilterNet` se o resultado não bastar, e **medindo**.

**Fora de escopo: separação de faixas (vocal/instrumental).** O `demucs` é o melhor que existe e
encaixaria no público das tools de YouTube/Spotify — mas puxa PyTorch e sozinho passaria de 2 GB,
mais que o Docling. Descartado por peso. Se um dia aparecer equivalente em ONNX que preste,
reabrir; até lá, não é candidato.

---

## Fase F — Imagem

### ✅ Mapa de profundidade (Depth Anything V2) — 2026-08-11

Ferramenta **Gerar Depth Map** na categoria Imagens. Imagem entra, mapa de profundidade em cinza
8 bits sai. Tudo local.

**ONNX em vez de torch/transformers — o princípio 2 desta fase, aplicado.** O caminho canônico
seria `transformers.pipeline("depth-estimation", …)`. Medido na .venv antes de escrever qualquer
código: torch **491,9 MB** + transformers **89,9 MB** = 582 MB, contra onnxruntime **40,4 MB** +
numpy **30 MB** + Pillow **15,2 MB** = 86 MB. Mesmo modelo, mesmos pesos
(`onnx-community/depth-anything-v2-small` é a exportação oficial do
`depth-anything/Depth-Anything-V2-Small-hf`), um sétimo do peso.

**Arquivos:** `python/depth.py` (novo, lógica pura), `depth_map` + `depth_adjust` +
`ajustar_cinza`/`_lut_ajuste` em `converter.py`, `DEPTH` em `commands.rs`,
`src/tools/depth-map/DepthMapTool.tsx`.

**Duas etapas, como no editor de legendas.** A inferência é a parte cara; inverter e mexer no
contraste não podem custar outra. O Python gera **uma vez** um PNG de rascunho em temp. A prévia
aplica `filter: invert() contrast()` do CSS, e o `depth_adjust` (bundle **light**, só Pillow) grava
os pixels de verdade na hora de salvar. Conferido pixel a pixel: **0 níveis** de diferença entre o
que a prévia mostra e o que o arquivo salvo contém — a LUT do Python usa a fórmula do CSS
(`(v − 0,5)·k + 0,5` em sRGB), não o `ImageEnhance.Contrast` do Pillow, que ancora na média.

**Transparência.** O RGB é achatado sobre cinza médio para alimentar o modelo (preto ou branco
criariam borda falsa), o alfa é preservado num canal à parte, e a normalização min–max **ignora os
pixels transparentes** — o fundo neutro tem profundidade própria e, entrando na conta, achataria
justamente o rosto e as dobras de roupa. Na hora de salvar o alfa multiplica o cinza
(`ImageChops.multiply`), então a borda semitransparente cai suave até o preto em vez de serrilhar.
Fundo transparente sai **preto**, inclusive com a profundidade invertida.

**Memória.** O sidecar é um processo separado e curto: ele morre depois de cada geração, e RAM e
VRAM voltam ao sistema incondicionalmente — mais forte que qualquer `gc.collect()`. A limpeza
explícita em `finally` existe mesmo assim, porque custa pouco e continua correta se o processo
virar residente. Medido no processo filho: **2 MB ao nascer → 266–702 MB no pico → processo
encerrado**. Nenhuma sessão global, nenhum modelo em cache entre chamadas.

**Sem GPU nesta versão, e o motivo é de empacotamento, não de código.** `escolher_provedor()` já
tenta CUDA → DirectML → CPU nessa ordem; com o pacote `onnxruntime` (CPU) só o último existe.
Ligar a GPU exigiria `onnxruntime-directml`, que **colide** com o `onnxruntime` que o Docling usa
(mesmo nome de pacote, uma .venv só), ou `onnxruntime-gpu`, que puxa ~2 GB de DLLs do CUDA. Como a
inferência em CPU fica em 1–3 s, não valeu uma segunda venv de build. Trocar o pacote liga a GPU
sem mexer em uma linha.

**Armadilhas:**

- **`WHISPER_EXCLUDES` não serve para outro módulo.** Ela lista o que o bundle do whisper não quer
  e, por definição, não exclui o próprio whisper. O primeiro build do depth saiu com **124 MB**:
  `av.libs` (63 MB), `ctranslate2` (59 MB), pandas e lxml, tudo alcançado pelo `import
  faster_whisper` que mora DENTRO de `transcribe()`. Daí a `DEPTH_EXCLUDES`. **Todo módulo novo
  precisa excluir a pilha de todos os outros**, não só a lista do vizinho.
- **`--collect-all numpy` acrescenta testes e headers.** O hook padrão já basta.
- **Teto de inferência calibrado, não chutado.** `MAX_LADO = 1554` (3×518) porque a atenção do ViT
  é O(patches²): 518×518 = 1,1 s · 1036×518 = 3,4 s · 1554×518 = 6,0 s · 2072×518 = 8,8 s. O valor
  anterior (1036) cortava o lado menor de um 16:7 de 518 para 448 — perda de detalhe num aspecto
  banal. Um teste trava isso.
- **O `python.exe` da .venv é um stub redirecionador** que spawna o interpretador base como filho.
  Medir memória dele dá 4,6 MB constantes, independentemente do que o processo faça. Custou uma
  rodada inteira de medição errada.

**Achado colateral, NÃO corrigido (fora do escopo pedido):** o bundle **light** — o que vai dentro
do instalador — carrega hoje `av.libs` (62,6 MB) + `ctranslate2` (58,8 MB) + pandas (12,6 MB) +
hf_xet (9 MB) = **~143 MB da pilha do Whisper que ele nunca usa**, pela mesma razão (o
`import faster_whisper` dentro de `transcribe()`). Aplicar a `DEPTH_EXCLUDES` também ao
`build_light` provavelmente derruba o instalador de 146 MB para perto de 30 MB, e cada atualização
junto — o updater não faz delta. Não foi mexido aqui porque exigiria revalidar as 16 outras
ferramentas empacotadas, o que não tem relação com o mapa de profundidade. **Vale uma tarefa
própria.**

**Verificado:** pytest 72/72 (23 novos), vitest 77/77 (4 novos), typecheck, cargo check release.
O `.exe` empacotado (48 MB) foi executado: uma linha JSON no stdout, `STEP:` no stderr, 3,0 s de
trabalho. O `depth_adjust` roda no light empacotado em 92 ms, e o `depth_map` chamado no light
recusa com mensagem em pt-BR em vez de traceback. Ponta a
ponta pelo contrato real do sidecar (subprocesso, uma linha JSON) nos 10 formatos pedidos + o ícone
do app. Correlação |depth × grayscale da entrada| = **0,18** — prova de que não é a imagem
dessaturada. Gradiente na silhueta 19,5 contra 1,0 no interior — borda preservada.

- [→] **Aumento de resolução com IA** e **remoção de fundo (`rembg`)** — **movidos em 2026-08-13**
      para `roadmaps/removebg-vtracer-realesrgan/roadmap.md`, que tem prioridade sobre esta fase
      e acrescenta vetorização (VTracer). Notas que continuam valendo: `realesrgan-ncnn-vulkan`
      é binário ncnn **sem torch**, chamado pelo Rust como o ffmpeg, e exige Vulkan (detectar e
      avisar em máquina sem suporte); o ONNX Runtime do `rembg` já é pago no módulo do Docling.
- [ ] **`imagehash`** — hash perceptual para achar imagens duplicadas ou parecidas numa pasta.
      Leve. Categoria Utilitários.
- [ ] Enquanto estiver em imagem: **remover EXIF** (Pillow puro, zero dependência) e
      **`pillow-heif`** (foto de iPhone no Windows, que hoje exige codec pago).

---

## Fase G — Documento

- [ ] **PDF escaneado com camada de texto pesquisável** — o Ctrl+F que hoje não funciona.
      ⚠️ **Avaliar dois caminhos antes de escolher:**
      1. `ocrmypdf` — maduro e completo, **mas exige Tesseract e Ghostscript como binários
         externos**. Dois executáveis novos no módulo.
      2. **PyMuPDF + RapidOCR** — os dois **já estão no projeto** (fitz no light, RapidOCR no
         bundle do Docling). O PyMuPDF insere texto invisível sobre a imagem; o RapidOCR fornece
         as caixas e o texto. Zero binário novo.
      O caminho 2 provavelmente ganha. Confirmar com um protótipo antes de fechar.

---

## Fase H — Pipelines (o que faz tudo isso valer)

Hoje as 15 ferramentas são ilhas: baixar do YouTube, comprimir e legendar são três operações
manuais escolhendo pasta três vezes.

- [ ] Descrever entrada e saída de cada tool no `registry.tsx` (o registro já existe; falta o
      tipo de arquivo que entra e sai).
- [ ] Encadear ferramentas numa "receita", salvar e reexecutar.
- [ ] Receitas de fábrica, que são exatamente os pipelines desejados:
      - **Legenda traduzida** — YouTube → áudio → whisper → argos → queima
      - **PDF → Podcast** — PDF → Markdown → piper → MP3
      - **Ata de reunião** — gravação → corte de silêncio → transcrição com locutores → Markdown

**Não precisa de dependência nenhuma.** É arquitetura, e transforma uma caixa de ferramentas em
linha de produção.

---

## Riscos e decisões em aberto

- **Estimativas de peso são chute.** Todas marcadas com `*` precisam de protótipo empacotado antes
  de virar compromisso. Precedente: o Docling estimado "grande" virou 700 MB.
- **Queimar legenda recodifica o vídeo inteiro.** Não tem como copiar o stream. Uma hora de vídeo é
  uma hora de H.264 — menos com NVENC, mas ainda é a operação mais lenta do app.
- **Transcrição em CPU não é instantânea.** Com `small` em int8, algo próximo de tempo real. Uma
  aula de 1 h leva dezenas de minutos. Não é problema **se a interface for honesta** e mostrar
  progresso de verdade.
- **Diarização (separar locutores)** exige `pyannote.audio` ou `whisperX` — ambos puxam torch, e o
  pyannote pede aceite de termos na HuggingFace para baixar o modelo. É o item mais atrito da
  "ata de reunião"; avaliar se a primeira versão sai **sem** separar locutores.
- **Whisper erra nome próprio, sigla e número.** Sem o editor da Fase C, a saída não é publicável
  sem revisão manual. Dizer isso na interface, não deixar o usuário descobrir.
- **Vulkan para o realesrgan** não existe em toda máquina. Precisa de detecção e mensagem clara.

---

## Verificação por fase (rodar sempre)

```bash
npm run typecheck
npm run test
.venv\Scripts\python.exe -m pytest python/test_converter.py -q
cargo check --manifest-path src-tauri/Cargo.toml
npm run dev            # tauri dev — o único jeito de validar módulo, drag&drop e ffmpeg real
```

Ao fechar cada fase: marcar os checkboxes, anotar **o peso medido** de cada módulo (substituindo as
estimativas), e registrar as armadilhas encontradas — o valor deste roadmap está tanto no que deu
certo quanto no que custou tempo.
