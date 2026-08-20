# Roadmap — Imagem: vetorizar, aumentar qualidade, remover fundo

> **Prioridade atual (definida em 2026-08-13).** Esta entrega vem **antes** da Fase 4
> (`roadmaps/ia-local/roadmap.md`), que fica em espera. As Fases 1–3
> (`roadmaps/new-functions/roadmap.md`) seguem com as pendências de release/validação,
> que são independentes desta.
>
> Absorve os dois itens de imagem que estavam na **Fase F** do `ia-local` (`realesrgan`,
> `rembg`) — lá eles ficaram marcados como movidos para cá. `imagehash`, EXIF e `pillow-heif`
> continuam na Fase F.

## Estado

- [x] **Vetorizar imagem (VTracer)** — 2026-08-13, ver abaixo
- [x] **Aumentar qualidade (Real-ESRGAN)** — 2026-08-13, ver abaixo
      ⚠️ **Pendente de ação do usuário:** publicar `python/dist/camps-realesrgan.zip` num Release
      com a tag **`realesrgan-v1`**, marcado como **pre-release** (senão vira o "latest" e quebra o
      updater — ver CLAUDE.md). Sem isso o módulo só funciona em dev.
- [x] **Remover fundo (rembg)** — 2026-08-13, ver abaixo
      ⚠️ **Pendente de ação do usuário:** publicar `python/dist/camps-rembg.zip` (136 MB) num
      Release com a tag **`rembg-v1`**, marcado como **pre-release**.

### ✅ Vetorizar imagem — 2026-08-13

**Nativo em Rust, sem sidecar e sem módulo baixado.** O VTracer tem crate
(`vtracer = "0.6.5"`, MIT/Apache) — o mesmo motor que a lib Python embrulha. Entrou junto às outras
ferramentas nativas de imagem (`convert_images`/`resize_images`/`compress_images`), então não há
PyInstaller, nem `--collect-all`, nem `RemoteModule`, nem download no primeiro uso.

**Arquivos:** `vectorize_image` + `copy_file` + `config_vetor` + `MAX_LADO_VETOR` em
`src-tauri/src/commands.rs`, registro em `lib.rs`, `vectorizeImage`/`copyFile` em
`services/conversionService.ts`, `src/tools/image-vectorize/ImageVectorizeTool.tsx`, entrada no
`registry.tsx` (ícone `Spline`, categoria Imagens). **18 ferramentas.**

- **Decodificação é nossa, não do VTracer.** O `convert_image_to_svg` dele traz um `image` 0.23
  próprio, que **não lê WebP** e devolve a mesma frase para qualquer falha. Decodificamos com o
  `image` 0.25 que já era dep do projeto e entregamos um `ColorImage` pronto ao `vtracer::convert`.
- **Transparência sai de graça, mas só porque o RGBA chega inteiro.** O VTracer detecta fundo
  transparente (≥20% de pixels com alfa 0 nas linhas de borda), procura uma cor não usada na
  imagem, pinta os pixels transparentes com ela e **descarta** esses clusters. Achatar o alfa antes
  de entregar criaria exatamente o fundo branco que o roadmap proíbe. Teste trava isso comparando
  a contagem de paths do mesmo desenho com e sem alfa.
- **Rascunho em temp + `copy_file`.** Mesmo fluxo em duas etapas do mapa de profundidade: traça uma
  vez para a prévia, e salvar é cópia. `copy_file` é genérico de propósito — o rembg e o
  Real-ESRGAN têm o mesmo fluxo prévia→salvar.
- **`MAX_LADO_VETOR = 2000`.** O custo é por pixel e o SVG cresce junto: uma foto de 4000 px vira
  minutos e dezenas de MB de `<path>`. Como a saída é vetorial, reduzir a entrada custa detalhe
  fino, não resolução final. A UI diz quando reduziu, em vez de fazer escondido.
- **Nível de detalhe** mapeia `filter_speckle`/`color_precision`/`layer_difference`; Médio é o
  padrão do próprio VTracer. Rótulo desconhecido cai no médio em vez de explodir.

⚠️ **Peso de compilação:** o vtracer 0.6.5 arrasta um `image` 0.23 inteiro (png 0.16, jpeg-decoder
0.1, tiff 0.6) e o `clap` 2 do binário dele. O `clap` a LTO descarta (nada na lib o referencia); o
`image` 0.23 fica, porque o `read_image` dele existe mesmo sem ser chamado. Medir no próximo
instalador — se pesar, o caminho é o `visioncortex` direto.

**Verificado:** cargo test **15/15** (3 novos: paths reais sem raster embutido, transparência,
níveis de detalhe), typecheck limpo, vitest **82/82**, pytest **72/72** (Python intocado),
`cargo check --release` ok.
**Falta:** validar na janela real (`npm run dev`) — prévia do SVG pelo asset protocol, arrastar e
soltar, e salvar.

## Decisões tomadas (2026-08-13, com o usuário)

- **Real-ESRGAN = `realesrgan-ncnn-vulkan`**, não PyTorch. Binário spawnado pelo Rust como o
  ffmpeg, `RemoteModule` próprio, ~90 MB, **zero torch** (o princípio 2 do `ia-local` vale: torch
  são ~490 MB medidos). GPU por Vulkan em qualquer fabricante.
  ⚠️ **Consequência que muda o texto abaixo:** as seções "GERENCIAMENTO DE MEMÓRIA" e "CUDA OUT OF
  MEMORY" assumem torch (`del`/`gc.collect()`/`empty_cache()`). Com ncnn isso é resolvido de graça
  — o processo é externo e curto, e ao morrer devolve RAM e VRAM incondicionalmente (mesmo
  argumento já registrado no Depth Anything, Fase F do `ia-local`). O que **substitui** aquelas
  seções: detectar ausência de Vulkan e dar mensagem clara (não há fallback CPU), e usar o `-t`
  (tile) do binário para imagem grande.
- **Ordem: VTracer → rembg/Real-ESRGAN.** VTracer não tem modelo nem download; entrega usável em
  uma rodada e estabreia a UI "Original | Resultado" que as outras duas reusam.

---

Quero adicionar **3 novas ferramentas de imagem** ao aplicativo:

| Ferramenta         | Tecnologia  | Função                 |
| ------------------ | ----------- | ---------------------- |
| Vetorizar imagem   | VTracer     | PNG/JPG → SVG vetorial |
| Aumentar qualidade | Real-ESRGAN | Upscale 2x/4x          |
| Remover fundo      | rembg       | Fundo → transparência  |

Antes de implementar, **analise a arquitetura atual do projeto** e entenda como as ferramentas existentes funcionam.

Siga os padrões já existentes para:

* UI;
* navegação;
* componentes;
* processamento de arquivos;
* workers/processos em background;
* drag and drop;
* loading;
* progresso;
* tratamento de erros;
* toasts;
* previews;
* downloads;
* organização dos serviços.

**Não faça refatorações gerais.**
**Não altere funcionalidades existentes.**
**Não redesenhe o aplicativo.**
**Não crie uma arquitetura paralela se já existir uma solução equivalente.**

Todo o processamento deve ser **100% local**.

Nenhuma imagem deve ser enviada para API ou serviço externo.

### ✅ Remover fundo (rembg) — 2026-08-13

**Portão 0 medido antes de escrever a ferramenta**, e o resultado contrariou a estimativa (eu
chutei 250–400 MB):

| | `rembg` empacotado | u2net.onnx direto na pilha ONNX |
|---|---|---|
| Cru na .venv | 465 MB | 93 MB |
| **Exe PyInstaller** | **130,9 MB** (probe) → **136 MB** o módulo real | ~48 MB (o do Depth, já medido) |
| Só o `import`, a frio | 72 s | — |
| Só o `import`, a quente | 13,5–14 s | ~1 s |

**Decisão do usuário com os números na mão: ficar com o `rembg` de verdade**, pelo alpha matting e
pela galeria de modelos que vêm junto. O custo está registrado aqui para não ser redescoberto:
o `rembg/bg.py` importa `pymatting` no topo, que arrasta `numba` + `llvmlite`. Quem for otimizar
depois, o caminho é rodar `u2net.onnx` direto no onnxruntime — o pré/pós-processamento cabe em
~25 linhas, e o `depth.py` já é o molde.

**Arquivos:** `python/bgremove.py` (novo), `remove_bg` + `REMBG_EXTS` + `_dir_trabalho_rembg` +
dispatch em `converter.py`, `REMBG_STACK`/`REMBG_NEEDS`/`build_rembg` em `python/build.py`,
`REMBG` + `rembg_installed`/`ensure_rembg` + rota `remove_bg` em `commands.rs`, registro em
`lib.rs`, `removeBg`/`rembgInstalled`/`ensureRembg` em `conversionService.ts`, `MODULES.rembg`,
`src/tools/bg-remove/BgRemoveTool.tsx`, entrada no `registry.tsx` (ícone `Eraser`,
`module: "rembg"`). **20 ferramentas, 32 comandos Rust.**

**Modelo:** `u2net`, o padrão do próprio rembg para uso geral, com os parâmetros padrão
(`post_process_mask=False`, sem alpha matting). Pesos (~168 MB) baixados no primeiro uso.

⚠️ **`U2NET_HOME` apontado para `~/.cache/camps-utils/models/`**, ao lado dos pesos do Depth. O
rembg usaria `~/.u2net`; o roadmap pede um diretório só, e assim o usuário apaga o cache inteiro
sem caçar pasta escondida. Tem de ser setado **antes** do import — `_preparar_ambiente()`.

**Armadilhas do empacotamento (as duas custariam produção, não dev):**

- **`REMBG_STACK` teve de entrar nas exclusões de TODOS os outros bundles.** `remove_bg` faz
  `import bgremove` dentro da função e o PyInstaller segue isso — sem excluir, light, depth e
  whisper engordariam ~100 MB cada com numba/llvmlite/pymatting. **Conferido medindo:** o light
  reconstruído ficou em 154.066.345 bytes contra 154.065.756 antes — **+589 bytes**, nada vazou. E
  o light chamado com `remove_bg` recusa com `MODEL_ERROR` em pt-BR, não com traceback.
- **`REMBG_NEEDS` existe por causa de `requests`/`urllib3`.** Eles estão em `WHISPER_EXCLUDES`, e
  são exatamente como o `pooch` baixa os pesos. Sem a subtração o exe compila e só falha na
  primeira remoção, em produção, na hora do download.

**Verificado — cadeia completa, com o modelo de verdade:**

| Caso | Resultado |
|---|---|
| Contrato do stdout | uma linha JSON; o "Downloading data from…" do pooch vai para o stderr |
| Cache dos pesos | `u2net.onnx` (176 MB) em `~/.cache/camps-utils/models/`, junto do Depth |
| Objeto claro sobre fundo liso (512²) | 18,7% opaco · 80,3% transparente · **1,1% de borda suave** |
| Canal alfa | RGBA real, alfa 0 no fundo e 255 no objeto |
| `.exe` empacotado (144 MB) | recorte correto em **19 s a quente**, 81 s a frio |

pytest **81/81** (9 novos), cargo test **17/17**, typecheck limpo, vitest **82/82**,
`cargo check --release` ok.

**Limitação encontrada, do modelo e não do código:** numa arte de anime 220×220 em que o objeto
ocupa o quadro inteiro, o u2net devolveu máscara **mole** — 87% dos pixels com alfa intermediário,
resultado fantasma. Medi as duas saídas do rembg para o mesmo caso: `post_process_mask=True`
resolve a mole (47,8% opaco / 52,2% transparente) mas zera a borda suave, trocando fantasma por
serrilhado — que o roadmap proíbe explicitamente; e `alpha_matting=True` custou +7 s e não ajudou,
porque o trimap sai da mesma máscara ruim. Ficou o padrão do rembg. Se aparecer mais, o caminho é
`isnet-general-use` (uma linha em `ARQUIVOS`, mais um download de ~170 MB).

**Falta:** validar na janela real (`npm run dev`) e publicar o Release `rembg-v1`.

---

### ✅ Aumentar qualidade (Real-ESRGAN) — 2026-08-13

**Binário ncnn/Vulkan spawnado pelo Rust, como o ffmpeg.** `RemoteModule REALESRGAN`
(`realesrgan-v1`, **31 MB medidos**, SHA `b83144d1…4444`, zip reproduzível). Zero PyTorch, zero
Python: os pesos vão dentro do próprio módulo, então depois do download a ferramenta é offline de
verdade — não há segundo download de modelo como no Docling, no Whisper e no Depth.

**Arquivos:** `REALESRGAN` + `resolve_realesrgan` + `realesrgan_installed`/`ensure_realesrgan` +
`upscale_image` + `realesrgan_run` + `erro_do_realesrgan` + `MODELOS_UPSCALE` + `UPSCALE_LOCK` em
`commands.rs`, registro em `lib.rs`, `build_realesrgan()` em `python/build.py` (alvo
`python build.py realesrgan`), `upscaleImage`/`realesrganInstalled`/`ensureRealesrgan` em
`conversionService.ts`, `MODULES.realesrgan` em `ModuleGate.tsx`,
`src/tools/image-upscale/ImageUpscaleTool.tsx`, entrada no `registry.tsx` (ícone `Sparkles`,
`module: "realesrgan"`). **19 ferramentas, 30 comandos Rust.**

**Modelo:** `realesrgan-x4plus` (o geral do upstream), do bundle oficial
`xinntao/Real-ESRGAN` → `realesrgan-ncnn-vulkan-20220424-windows.zip`.
⚠️ O repo `Real-ESRGAN-ncnn-vulkan` publica o **exe sem os modelos** (o `cp models/*` está
comentado no workflow de release dele); os modelos só vêm no bundle do repo principal. Os de anime
(~11 MB) ficaram de fora — `MODELOS_UPSCALE` é uma tabela, acrescentar é uma linha + os arquivos no
zip.

⚠️ **A armadilha que decidiu o desenho: `-s 2` num modelo x4 não dá erro — dá lixo.** O binário
aceita, devolve a imagem no tamanho pedido, e o conteúdo sai corrompido. **Medido** com a amostra do
upstream: `-s 2` fica a **81,9** (escala 0–255) de distância média de um Lanczos 2x de referência,
enquanto rodar 4x nativo e reduzir fica a **8,2**. Por isso a inferência é **sempre** na escala
nativa do modelo e a redução para 2x é feita aqui com Lanczos3. Um teste trava a escala nativa
declarada na tabela.

**Memória — a exigência central do roadmap, resolvida por construção.** O modelo vive no processo
filho, que morre ao fim de cada imagem: RAM e VRAM voltam ao sistema incondicionalmente, inclusive
quando a inferência falha (que é justo o caso em que `del`/`gc.collect()`/`empty_cache()` costumam
ser esquecidos). Nada é carregado antes do clique, e nada fica carregado depois.

- **VRAM:** `-t 0` deixa o binário dimensionar o bloco pela memória disponível. Se ainda faltar,
  **uma segunda tentativa com `-t 128`** — lento, mas é a diferença entre funcionar e não.
- **Concorrência:** `UPSCALE_LOCK` (mutex do tokio). A UI já desabilita o botão; o lock é o que
  garante a regra quando dois cliques escapam — dois processos reservando VRAM derrubam justamente
  as máquinas mais fracas.
- **Erros:** `erro_do_realesrgan` separa **sem Vulkan** (pede driver) de **sem VRAM** (pede imagem
  menor) — as duas causas reais têm respostas opostas, e trocá-las é pior que não dizer nada.
  Desconhecido sai cru, pelo mesmo motivo do ffmpeg. 1 teste com os 4 casos.
- **Progresso real:** o binário escreve `25,00%` no stderr — **com vírgula**, é o locale da máquina.
  O mesmo stderr carrega o erro, então o leitor emite o que é porcentagem e guarda o resto.

**Verificado — cadeia completa, com o binário de verdade (RTX 3080, Vulkan):**

| Caso | Resultado |
|---|---|
| JPG 220×220, 4x | 880×880 ✔ |
| 2x pelo caminho 4x+redução | 440×440, desvio 8,2 contra 81,9 do `-s 2` direto |
| PNG com alfa 1254×1254, 4x | 5016×5016, **canal alfa preservado** (pixels com alfa 0 continuam lá) |
| PNG 1920×1080, 4x, tile automático | 7680×4320 em **16,8 s** |

cargo test **17/17** (2 novos), typecheck limpo, vitest **82/82**, `cargo check --release` ok.
⚠️ `NotificationBell.test.tsx` teve de ganhar o mock de `realesrganInstalled`/`ensureRealesrgan`:
o `ModuleGate` importa todos os `checar` de uma vez e um export faltando derruba a suíte inteira no
load. O próprio arquivo já avisava disso num comentário.

**Falta:** validar na janela real (`npm run dev`) e publicar o Release `realesrgan-v1`.
Não testado: máquina **sem** Vulkan (a mensagem de erro está escrita e coberta por teste, mas o
caminho real não foi exercido aqui) e GPU não-NVIDIA.

---

# 1. VETORIZAR IMAGEM

## Tecnologia

Utilizar:

**VTracer**

Objetivo:

Transformar imagens raster em **SVG vetorial de verdade**.

Entradas:

* PNG
* JPG
* JPEG
* WEBP, caso seja suportado de forma limpa

Saída:

* SVG

IMPORTANTE:

Não quero simplesmente colocar a imagem raster dentro de um container `<svg>`.

O arquivo precisa ser realmente vetorizado utilizando:

* paths;
* curvas;
* formas;
* regiões vetoriais.

O resultado deve continuar nítido independentemente do tamanho em que for renderizado.

---

## Interface

Adicionar dentro da categoria:

**IMAGENS → Vetorizar imagem**

Utilizar exatamente os padrões visuais das ferramentas existentes.

Fluxo:

imagem
↓
preview
↓
Vetorizar
↓
preview do SVG
↓
Salvar SVG

Mostrar:

**Original | Vetorizado**

Adicionar botão:

**Salvar SVG**

Nome sugerido:

`imagem.svg`

---

## Configurações

Não criar dezenas de opções técnicas.

Expor apenas configurações que realmente tragam benefício ao usuário.

Caso o VTracer permita de forma estável, considerar opções simples como:

### Nível de detalhe

* Baixo
* Médio
* Alto

O padrão deve ser:

**Médio**

A implementação interna pode mapear essas opções para os parâmetros apropriados do VTracer.

Não mostrar nomes técnicos obscuros do algoritmo para o usuário.

---

## Transparência

PNG com fundo transparente precisa funcionar corretamente.

Preservar transparência sempre que possível.

Não adicionar fundo branco automaticamente ao SVG final.

---

## Performance

VTracer não deve bloquear a interface.

Se o projeto possuir worker/thread/processo em background, utilizar a mesma arquitetura.

Como essa ferramenta não depende de um grande modelo de IA, não adicionar PyTorch ou outras dependências pesadas somente para ela.

---

# 2. AUMENTAR QUALIDADE

## Tecnologia

Utilizar:

**Real-ESRGAN**

Objetivo:

Aumentar a resolução e recuperar detalhes de imagens utilizando IA.

Adicionar:

**IMAGENS → Aumentar qualidade**

Entradas:

* PNG
* JPG
* JPEG
* WEBP

Saídas:

* PNG
* opcionalmente manter JPG quando fizer sentido

---

## Interface

Fluxo:

imagem
↓
preview
↓
selecionar escala
↓
Aumentar qualidade
↓
Real-ESRGAN
↓
preview
↓
Salvar

Mostrar:

**Original | Melhorada**

Adicionar controle:

### Escala

* 2x
* 4x

Padrão:

**2x**

Não adicionar resoluções absurdas ou parâmetros técnicos desnecessários.

Mostrar também, quando possível:

Resolução original:

`1920 × 1080`

Resultado:

`3840 × 2160`

---

# MODELO DO REAL-ESRGAN

Escolha um modelo oficial/estável do Real-ESRGAN adequado para imagens gerais.

Antes de decidir o modelo exato, verifique a integração atual recomendada pela própria biblioteca/projeto.

Não inventar modelo.

Não baixar vários modelos sem necessidade.

Estruture internamente para ser possível adicionar outros modelos futuramente sem reescrever toda a ferramenta.

---

# GPU / CPU

Detectar automaticamente.

Prioridade:

CUDA
↓
CPU

Se CUDA estiver disponível:

utilizar GPU.

Caso não esteja:

usar CPU.

Não exigir GPU para a funcionalidade funcionar.

---

# IMAGENS MUITO GRANDES

Tenha cuidado com VRAM.

Não tentar processar uma imagem gigantesca inteira de uma vez caso isso possa causar Out Of Memory.

Se necessário, utilizar o mecanismo de:

**tile processing**

oferecido/recomendado pelo Real-ESRGAN.

O processamento por tiles deve ser transparente para o usuário.

O objetivo é permitir imagens grandes sem estourar a VRAM.

---

# GERENCIAMENTO DE MEMÓRIA — REAL-ESRGAN

Isso é **MUITO IMPORTANTE**.

Não quero o modelo ocupando RAM/VRAM depois que o processamento terminou.

O comportamento deve ser:

App inicia
↓
Real-ESRGAN NÃO é carregado
↓
usuário seleciona imagem
↓
usuário clica em Aumentar qualidade
↓
carrega modelo
↓
processa imagem
↓
converte resultado para imagem independente
↓
LIBERA MODELO E TENSORES
↓
mantém somente a imagem resultante

Os pesos podem permanecer armazenados no SSD.

Portanto:

**Cache dos pesos no disco: SIM**

**Modelo permanentemente na RAM: NÃO**

**Modelo permanentemente na VRAM: NÃO**

**Baixar novamente toda vez: NÃO**

---

## Depois da inferência

Liberar:

* modelo;
* tensores;
* outputs;
* buffers;
* imagens temporárias desnecessárias;
* objetos pesados da inferência.

Quando apropriado:

```python
del objeto
gc.collect()

if torch.cuda.is_available():
    torch.cuda.empty_cache()
```

Mas não depender somente de `empty_cache()`.

Primeiro remover corretamente as referências Python.

Utilizar:

`try/finally`

ou mecanismo equivalente para garantir que a limpeza ocorra tanto em sucesso quanto em erro.

---

# 3. REMOVER FUNDO

## Tecnologia

Utilizar:

**rembg**

Objetivo:

Detectar automaticamente o objeto principal da imagem e remover o fundo.

Adicionar:

**IMAGENS → Remover fundo**

Entradas:

* PNG
* JPG
* JPEG
* WEBP

Saída:

* PNG com transparência

---

## Fluxo

imagem
↓
preview
↓
Remover fundo
↓
segmentação
↓
aplicar alpha
↓
preview
↓
Salvar PNG

Mostrar:

**Original | Sem fundo**

O preview do resultado deve utilizar algum fundo visual apropriado para transparência, como o padrão quadriculado já utilizado pelo projeto, caso exista.

Adicionar:

**Salvar PNG**

Nome sugerido:

`imagem-sem-fundo.png`

---

# QUALIDADE DAS BORDAS

Priorizar:

* cabelo;
* rosto;
* roupas;
* objetos;
* bordas finas;
* detalhes pequenos.

Evitar:

* halos brancos;
* serrilhamento excessivo;
* bordas duras desnecessárias;
* fundo residual.

Utilizar o modelo padrão/recomendado pelo rembg para uso geral, a menos que exista uma razão técnica clara para escolher outro.

Não baixar múltiplos modelos sem necessidade.

---

# GERENCIAMENTO DE MEMÓRIA — REMBG

O mesmo princípio do Real-ESRGAN se aplica.

O modelo não deve ficar permanentemente ocupando memória depois que a tarefa terminar.

Fluxo:

usuário solicita remoção
↓
carregar sessão/modelo sob demanda
↓
processar
↓
produzir PNG independente
↓
liberar sessão/modelo
↓
manter somente resultado final

Os pesos/modelos podem permanecer armazenados em **cache no disco**.

Não quero fazer download novamente a cada execução.

Porém também não quero deixar modelos de IA permanentemente carregados na RAM.

Caso o rembg/ONNX Runtime mantenha sessões pesadas:

destruir corretamente essas sessões após o processamento.

Executar garbage collection quando apropriado.

---

# REGRA GERAL DE MEMÓRIA DAS FERRAMENTAS DE IA

Real-ESRGAN e rembg devem seguir esta regra:

### Antes de usar

Modelo não carregado.

### Durante

Modelo carregado somente pelo tempo necessário.

### Depois

Modelo liberado.

### Disco

Pesos continuam cacheados.

Em outras palavras:

```text
SSD/cache: SIM
RAM permanente: NÃO
VRAM permanente: NÃO
```

Aceito o pequeno custo de recarregar o modelo em uma nova operação.

Prefiro isso a deixar vários modelos de IA ocupando memória enquanto o aplicativo estiver aberto.

---

# PROCESSAMENTO EM BACKGROUND

Nenhuma dessas ferramentas pode congelar a interface.

Analise como os processamentos pesados existentes são feitos.

Se o projeto utiliza:

* worker;
* subprocess;
* processo Python;
* thread;
* job;
* fila;

reutilize o mesmo mecanismo.

Não executar Real-ESRGAN diretamente na thread principal da UI.

---

# PESOS DOS MODELOS

Real-ESRGAN e rembg podem precisar baixar pesos na primeira utilização.

Comportamento esperado:

### Primeira execução

Se modelo não estiver disponível:

mostrar algo equivalente a:

**Preparando modelo...**

ou

**Baixando modelo...**

Depois armazenar localmente.

### Próximas execuções

Utilizar o arquivo local.

Não baixar novamente.

Se o aplicativo já possui um diretório próprio para modelos/cache, utilizar esse diretório.

Se não possuir, escolha uma localização adequada seguindo os padrões do sistema operacional/projeto.

Não espalhar arquivos de modelos aleatoriamente pelo projeto.

---

# OFFLINE

Depois que os modelos necessários já tiverem sido baixados:

as três ferramentas devem funcionar sem internet.

VTracer:

offline.

Real-ESRGAN:

offline.

rembg:

offline.

---

# PRIVACIDADE

Nenhuma imagem enviada para essas ferramentas pode sair da máquina.

Não utilizar:

* API externa;
* cloud inference;
* upload temporário;
* serviços pagos;
* servidores terceiros.

---

# ORGANIZAÇÃO DA INTERFACE

Dentro de:

**IMAGENS**

teremos as ferramentas atuais e adicionar:

* Vetorizar imagem
* Aumentar qualidade
* Remover fundo

Seguir exatamente:

* ícones;
* espaçamentos;
* typography;
* hover;
* cards;
* navegação;
* headers;
* botões;

existentes.

Escolher ícones coerentes com a biblioteca de ícones já usada pelo projeto.

Não adicionar outra biblioteca de ícones.

---

# ARQUITETURA

Não colocar toda a lógica dentro da UI.

Separar conceitualmente:

```text
UI
 ↓
handler/controller existente
 ↓
serviço da ferramenta
 ↓
biblioteca
```

Por exemplo:

```text
VectorizationService
→ VTracer

ImageUpscaleService
→ Real-ESRGAN

BackgroundRemovalService
→ rembg
```

Os nomes reais devem seguir a convenção já existente no projeto.

---

# DEPENDÊNCIAS

Antes de instalar qualquer coisa:

analise as dependências atuais.

Não instalar bibliotecas duplicadas.

Verificar especialmente se já existem:

* torch;
* torchvision;
* pillow;
* numpy;
* onnxruntime;
* onnxruntime-gpu;
* opencv;
* dependências equivalentes.

Não atualizar versões importantes sem necessidade.

Não quebrar ferramentas existentes para instalar essas funcionalidades.

---

# CUDA

Caso o projeto já utilize PyTorch/CUDA para outras ferramentas, garantir compatibilidade.

Não instalar uma versão incompatível do PyTorch apenas por causa do Real-ESRGAN.

Se houver conflito potencial:

pare e me informe antes de realizar uma alteração destrutiva.

---

# TRATAMENTO DE ERROS

Tratar:

* formato inválido;
* arquivo corrompido;
* imagem muito grande;
* erro de leitura;
* erro de escrita;
* modelo indisponível;
* erro no download;
* falha de inferência;
* falta de RAM;
* CUDA Out Of Memory;
* GPU incompatível;
* erro durante vetorização;
* erro ao salvar SVG;
* erro ao gerar PNG.

Para o usuário:

mensagem simples e amigável.

Para desenvolvimento:

usar o mecanismo de logs existente.

Não mostrar stack trace bruto na UI.

---

# CUDA OUT OF MEMORY

Caso Real-ESRGAN cause CUDA OOM:

1. abortar aquela inferência;
2. remover tensors;
3. remover modelo;
4. limpar referências;
5. executar garbage collection;
6. liberar cache CUDA;
7. tentar estratégia de tile menor se fizer sentido;
8. caso ainda falhe, utilizar CPU ou informar o usuário.

Nunca deixar VRAM presa depois de uma falha.

---

# ARQUIVOS TEMPORÁRIOS

Não acumular arquivos temporários.

Depois que o processamento terminar:

remover arquivos temporários que não são mais necessários.

Não remover:

* arquivo original do usuário;
* arquivo de saída;
* pesos/modelos cacheados.

---

# TESTES — VTRACER

Testar:

1. logo simples;
2. imagem colorida;
3. PNG transparente;
4. JPG;
5. desenho;
6. imagem com curvas;
7. imagem com detalhes pequenos.

Validar que o SVG possui elementos vetoriais reais.

Não aceitar como implementação válida um SVG contendo apenas:

```xml
<image href="data:image/png;base64,...">
```

---

# TESTES — REAL-ESRGAN

Testar:

1. JPG pequeno;
2. PNG;
3. imagem de baixa resolução;
4. fotografia;
5. ilustração;
6. upscale 2x;
7. upscale 4x;
8. imagem grande;
9. CPU;
10. CUDA, quando disponível.

Confirmar que as dimensões realmente aumentaram.

Exemplo:

```text
1000 × 1000
2x
→
2000 × 2000
```

---

# TESTES — REMBG

Testar:

1. pessoa;
2. objeto;
3. produto;
4. cabelo;
5. JPG;
6. PNG;
7. imagem com fundo simples;
8. imagem com fundo complexo.

Confirmar que o resultado possui **canal alpha real**.

---

# TESTE DE RAM/VRAM

Obrigatório para:

* Real-ESRGAN;
* rembg.

Monitorar:

```text
ANTES
DURANTE
DEPOIS
```

Tanto RAM quanto VRAM quando aplicável.

Durante a execução:

é esperado aumento de memória.

Depois:

o modelo não pode continuar ocupando grandes quantidades de RAM/VRAM.

Não precisa voltar exatamente para o mesmo número de bytes devido a caches e runtime.

Mas não pode permanecer com vários GB ocupados simplesmente porque a ferramenta foi utilizada uma vez.

---

# CONCORRÊNCIA

Impedir múltiplas inferências acidentais da mesma ferramenta.

Se o usuário clicar várias vezes rapidamente:

não carregar várias cópias do Real-ESRGAN ou rembg simultaneamente.

Utilizar locks/jobs/estado de processamento seguindo a arquitetura atual.

---

# NÃO FAZER

Não:

* utilizar APIs externas;
* criar serviço cloud;
* mandar imagens para internet;
* carregar todos os modelos no startup;
* manter modelos permanentemente na memória;
* redesenhar o aplicativo;
* refatorar código não relacionado;
* mudar outras funcionalidades;
* duplicar infraestrutura existente;
* instalar dependências sem verificar as atuais;
* implementar falso SVG contendo PNG internamente.

---

# CRITÉRIO DE CONCLUSÃO

Considere pronto somente quando:

## Vetorizar imagem

* VTracer funcionando;
* PNG/JPG → SVG;
* SVG realmente vetorial;
* transparência funcionando quando aplicável;
* preview;
* download.

## Aumentar qualidade

* Real-ESRGAN funcionando;
* 2x;
* 4x;
* GPU automática;
* CPU fallback;
* preview;
* download;
* pesos cacheados;
* modelo liberado da memória.

## Remover fundo

* rembg funcionando;
* PNG transparente real;
* boa qualidade de bordas;
* preview;
* download;
* pesos cacheados;
* modelo liberado da memória.

E todas devem:

* funcionar localmente;
* não bloquear a UI;
* respeitar o design existente;
* tratar erros;
* não quebrar ferramentas atuais.

---

# AO FINAL

Depois de implementar, me responda de forma **sucinta** informando:

1. arquivos criados;
2. arquivos modificados;
3. dependências instaladas;
4. versões utilizadas;
5. modelo do Real-ESRGAN utilizado;
6. modelo do rembg utilizado;
7. onde os pesos ficam cacheados;
8. como RAM/VRAM são liberadas;
9. resultado dos testes;
10. como testar manualmente cada uma das três ferramentas;
11. qualquer limitação encontrada.

Se durante a implementação houver alguma decisão importante que não possa ser determinada analisando o projeto ou a documentação das bibliotecas, **não invente**.

Me pergunte antes de tomar uma decisão que possa afetar arquitetura, dependências, compatibilidade ou comportamento do aplicativo.
