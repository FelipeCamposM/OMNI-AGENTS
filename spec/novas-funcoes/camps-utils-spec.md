# CAMPS-UTILS — Especificação

> Suíte de utilitários desktop, local-first e offline, para Windows.
> Evolução do app PDF→Markdown para um conjunto de ferramentas com menu de seleção.

---

## 1. Visão geral

**O quê:** transformar o app atual (single-purpose PDF→Markdown) numa suíte chamada
**CAMPS-UTILS**, com uma tela inicial que lista ferramentas e uma navegação por categorias.

**Por quê:** o usuário faz várias conversões locais recorrentes (documentos, imagens, mídia) e
quer um único app offline em vez de sites/ferramentas espalhadas.

**Princípios:**
- **Local-first / offline:** todo processamento na máquina; nenhum arquivo enviado à internet.
  Exceção óbvia: baixar vídeo do YouTube (a fonte é remota por natureza).
- **Reuso máximo:** aproveitar a stack existente (Tauri 2 + React/TS + sidecar Python). Ferramentas
  leves nativas em Rust; libs pesadas no sidecar Python; trivial no frontend.
- **Contrato de I/O estável:** sidecar sempre imprime **1 linha JSON no stdout**, logs no stderr
  (ver `CLAUDE.md`).

Stack base: Tauri 2 (Rust) + React 18 + TypeScript + Vite + Tailwind + sidecar Python (PyInstaller).
UI em pt-BR.

---

## 2. Decisões

| Tema | Decisão | Consequência |
|---|---|---|
| Motor PDF→MD | **Manter Docling** | Melhor OCR/layout, qualidade máxima. |
| Distribuição do Docling | **Web installer**: baixado do **GitHub Releases** durante a instalação, sempre (não opcional) | `.exe` de distribuição cai p/ ~100–150MB. Exige internet no install. |
| ffmpeg | **Empacotado** no instalador | Offline total. +~80MB. |
| Ordem de entrega | **F1** menu+conversões locais → **F2** YouTube → **F3** PDF-utils/refino | Valor rápido antes das deps pesadas de mídia. |
| Extras | **Todos**: PDF juntar/dividir/comprimir; imagem resize/comprimir; áudio/vídeo; QR/hash/base64 | Escopo amplo, fatiado por fase. |

### Tamanho: web installer + Docling online

Medição do bundle atual do sidecar = **716MB**, dominado por dependências que só o Docling usa
(`torch/` 364MB, `cv2/` 99MB, `scipy/` 53MB, `transformers/` 41MB).

**Estratégia:** empacotar dois bundles PyInstaller separados —

| Bundle | Conteúdo | Onde fica |
|---|---|---|
| **camps-light** (~poucos MB) | yt-dlp, xhtml2pdf, markdown, PyMuPDF, pikepdf | dentro do instalador |
| **camps-docling** (~700MB, zip) | Docling + torch/cv2/scipy/transformers | **GitHub Releases**, baixado no install |

O instalador NSIS (web installer) baixa `camps-docling` no `NSIS_HOOK_POSTINSTALL`, valida o hash e
extrai pra pasta de instalação. Resultado: `.exe` distribuído ~100–150MB; Docling pronto pós-install,
sem espera no 1º uso.

**O que isto resolve e o que não:** encolhe o **arquivo de distribuição**. A **instalação** continua
~700MB pra todo usuário (download não é opcional) — é o tradeoff aceito por simplicidade (sem página
de componentes). Modelos ML do Docling seguem baixando no 1º uso (cache HuggingFace do usuário).

Detalhes de implementação do hook, hash, versionamento e fallback → §7.

> Alternativas registradas (não escolhidas): (a) **componente opcional** no install — quem não usa
> PDF→MD não baixa os 700MB; (b) trocar Docling por **PyMuPDF4LLM** → instalador ~100MB sem download.
> Reabrir se banda/pegada por usuário virar prioridade sobre simplicidade/qualidade.

---

## 3. Arquitetura

### Camadas

```
┌───────────────────────────────────────────────────────────┐
│ Frontend  React/TS  — menu de tools, UIs, base64/texto     │
├───────────────────────────────────────────────────────────┤
│ Rust (Tauri commands) — image/ico, QR, hash, orquestra     │
│                          ffmpeg, streama sidecar Python     │
├──────────────────────────────┬────────────────────────────┤
│ Sidecar Python (PyInstaller) │ ffmpeg (binário empacotado) │
│  Docling, xhtml2pdf, PyMuPDF,│  áudio/vídeo/gif e           │
│  yt-dlp                      │  extração de áudio do YouTube│
└──────────────────────────────┴────────────────────────────┘
```

### Onde cada ferramenta roda

| Ferramenta | Backend | Motivo |
|---|---|---|
| Base64 / texto encode/decode | **Frontend JS** (`btoa`/`atob`/`TextEncoder`) | zero backend |
| Imagens → webp/png/jpg/ico | **Rust** (`image` + `ico`) | nativo, leve, sem startup Python |
| Imagens: resize | **Rust** (`image`) | mesmo motor nativo |
| Imagens: comprimir (qualidade / tamanho-alvo) | **Rust** (`image` + `webp`) | busca binária em memória, sem crate nova |
| QR code | **Rust** (`qrcode`) | trivial, nativo |
| Hash / checksum | **Rust** (`sha2`) | nativo |
| Áudio (mp3/wav/flac), vídeo→gif, comprimir vídeo | **Rust** spawna ffmpeg empacotado | ffmpeg já bundlado; reuso |
| PDF → Markdown (existente) | **Python sidecar** (Docling) | mantido |
| Markdown → PDF | **Python sidecar** (`markdown` + `xhtml2pdf`) | puro-python, sem deps nativas no Windows |
| Word (.docx) → PDF | **Python sidecar** (`mammoth` + `xhtml2pdf`) | puro-python; Word/COM ou LibreOffice exigiriam instalação externa |
| PDF juntar/dividir/comprimir | **Python sidecar** (`PyMuPDF`/`pikepdf`) | libs maduras |
| YouTube (música/mp4/playlist) | **Python sidecar** (`yt-dlp`) + ffmpeg | padrão de mercado |

Regra: libs pesadas → sidecar Python (padrão já existente); one-liners → Rust nativo; trivial →
frontend. Ferramentas leves continuam funcionando mesmo que o Docling seja separado no futuro.

---

## 4. Catálogo de ferramentas

Cada ferramenta declara: **entrada**, **opções**, **saída**, **backend**, **erros**.
Categorias: **Documentos**, **Imagens**, **Mídia**, **Utilitários**.

### 4.1 Documentos

#### PDF → Markdown *(existente, mantido)*
- Entrada: 1..N arquivos `.pdf`.
- Opções: OCR (via Docling), caminho de saída (auto ao lado do PDF / pasta padrão).
- Saída: `.md` + preview no `MarkdownViewer`.
- Backend: sidecar `--tool pdf2md` (default).
- Erros: `FILE_NOT_FOUND`, `INVALID_EXTENSION`, `MODEL_ERROR`, `CONVERSION_FAILED`.

#### Markdown → PDF *(novo — F1)*
- Entrada: 1..N `.md` (ou texto colado).
- Opções: tema/CSS simples (claro), tamanho de página (A4/Carta), margens.
- Saída: `.pdf`.
- Backend: sidecar `--tool md2pdf` (`markdown` → HTML → `xhtml2pdf`).
- Erros: `INVALID_INPUT`, `RENDER_FAILED`, `OUTPUT_ERROR`.

#### PDF: juntar *(novo — F3)*
- Entrada: 2..N `.pdf` em ordem definida pelo usuário (arrastar p/ reordenar).
- Saída: 1 `.pdf`.
- Backend: sidecar `--tool pdf_merge` (PyMuPDF).

#### PDF: dividir *(novo — F3)*
- Entrada: 1 `.pdf` + regra (por intervalo de páginas / a cada N páginas / uma por página).
- Saída: N `.pdf`.
- Backend: sidecar `--tool pdf_split`.

#### PDF: comprimir *(novo — F3)*
- Entrada: 1..N `.pdf` + nível (leve/médio/forte — reamostra imagens).
- Saída: `.pdf` menor (relata % de redução).
- Backend: sidecar `--tool pdf_compress` (PyMuPDF/pikepdf).

### 4.2 Imagens

#### Converter formato *(novo — F1)*
- Entrada: 1..N imagens (`jpg`, `jpeg`, `png`, `bmp`, `gif`, `webp`, `tiff`).
- Opções: formato alvo (`webp`, `png`, `jpg`, `ico`), qualidade (para webp/jpg),
  para `ico`: tamanhos (16/32/48/256).
- Saída: imagens convertidas (nomes preservados, nova extensão).
- Backend: **Rust** (`image` + `ico`).
- Erros: `UNSUPPORTED_FORMAT`, `DECODE_FAILED`, `OUTPUT_ERROR`.

#### Redimensionar *(novo — F3)*
- Entrada: 1..N imagens.
- Opções: largura/altura (manter proporção), % de escala, qualidade, renomear em lote (prefixo +
  numeração).
- Saída: imagens processadas.
- Backend: **Rust** (`image`).

#### Comprimir *(novo — F3, tool próprio)*
- Entrada: 1..N imagens.
- Dois modos:
  - **Qualidade** — valor fixo de 1 a 100.
  - **Tamanho-alvo** — limite em KB por arquivo; o Rust faz **busca binária na qualidade** (≤ 8
    encodes) e usa a maior que ainda cabe. Se nem a qualidade mínima couber, grava assim mesmo e
    devolve `hitTarget: false` para a UI avisar.
- Formato de saída: `Manter | WebP | JPG`.
- Saída: imagens + relatório por arquivo (antes → depois, % economizado).
- Backend: **Rust** (`compress_images`, helpers `encode_image`/`search_quality`).
- **Política de PNG: nenhuma crate nova.** PNG/ICO/GIF/BMP/TIFF são sem perdas — `quality` não os
  afeta, então a busca binária é pulada e a UI mostra um aviso sugerindo WebP. Descartados
  `oxipng` (build mais lento), `mozjpeg`/`imagequant` (deps C pesadas no MSVC).
- Duas guardas: arquivo já abaixo do alvo com "Manter" é copiado sem recodificar; e se o encode
  ficar **maior** que o original no mesmo formato, o original é preservado.

### 4.3 Mídia

#### YouTube: baixar *(novo — F2)*
- Entrada: URL de vídeo ou de playlist.
- Modos: **música** (extrai áudio → mp3), **vídeo** (mp4, melhor qualidade), **playlist → música**
  (mp3 de todos os itens).
- Opções: pasta de saída, qualidade de áudio (kbps), limite de itens da playlist.
- Saída: `.mp3` / `.mp4` na pasta escolhida.
- Backend: sidecar `--tool youtube` (`yt-dlp`, `--ffmpeg-location` → ffmpeg empacotado).
- **Progresso real** via eventos (ver §6).
- Erros: `INVALID_URL`, `UNAVAILABLE`, `NETWORK_ERROR`, `FFMPEG_MISSING`.

#### Áudio: converter *(novo — F3)*
- Entrada: 1..N áudios.
- Opções: formato alvo (`mp3`/`wav`/`flac`), bitrate.
- Backend: **Rust** → ffmpeg.

#### Vídeo → GIF / comprimir *(novo — F3)*
- Entrada: 1 vídeo.
- Opções (gif): intervalo de tempo, fps, largura. Opções (comprimir): CRF/preset.
- Backend: **Rust** → ffmpeg.

### 4.4 Utilitários

#### QR code *(novo — F3)*
- Entrada: texto/URL. Opções: tamanho, correção de erro, cor.
- Saída: `.png`. Backend: **Rust** (`qrcode`).

#### Hash / checksum *(novo — F3)*
- Entrada: 1..N arquivos. Opções: algoritmo (md5/sha1/sha256).
- Saída: lista de hashes (copiável). Backend: **Rust** (`sha2`/`md5`).

#### Base64 / texto *(novo — F1)*
- Entrada: texto ou arquivo pequeno. Modos: codificar/decodificar base64, url-encode.
- Saída: texto no painel. Backend: **Frontend** (sem chamada nativa).

---

## 5. Menu / navegação

- **Registro de ferramentas** `src/tools/registry.ts`: array de
  `{ id, name, category, icon, component, backend }`. Fonte única de verdade para Home e Sidebar.
- **Home** (`activeTool === null`): grade de cards agrupada por categoria.
- **Sidebar** (`Sidebar.tsx`): logo "CAMPS-UTILS" + lista de categorias/ferramentas a partir do
  registro; rodapé com Histórico e Configurações.
- **App** (`App.tsx`): estado top-level ganha `activeTool: string | null`; renderiza
  `registry[activeTool].component` ou a Home. A conversão PDF→MD atual vira **uma tool** do registro,
  reaproveitando `useConversion`, `MarkdownViewer`, `DropZone`, `FileQueue`, `ActionBar`.
- Cada tool é um componente isolado com seu próprio estado; o app só roteia.

---

## 6. Contrato de dispatch e progresso

### Sidecar Python
- Invocação: `converter --tool <nome> --input <json>`.
- `--tool` default = `pdf2md` (compatibilidade com o comando atual).
- Ferramentas: `pdf2md`, `md2pdf`, `pdf_merge`, `pdf_split`, `pdf_compress`, `youtube`.
- **Contrato duro:** exatamente **1 linha JSON no stdout**; todo log/progresso no **stderr**.
  Formato: `{ success, ...dados }` ou `{ success:false, errorCode, message }`.

### Rust
- Comando genérico `run_python_tool(tool, input_json) -> Result<String>`: encapsula spawn/stream do
  sidecar (lógica atual de `commands.rs::convert_pdf` generalizada). `convert_pdf` vira wrapper fino
  (`run_python_tool("pdf2md", ...)`).
- Comandos nativos novos: `convert_images`, `resize_images`, `generate_qr`, `hash_file`,
  `run_ffmpeg`. Registrar em `lib.rs` (`generate_handler!`).
- Crates novas em `Cargo.toml`: `image`, `ico`, `qrcode`, `sha2` (+ `md5` se usado).
- Permissões em `capabilities/default.json`: shell (ffmpeg), fs (saída).

### Progresso real (tarefas longas)
- YouTube e ffmpeg emitem `%` no stderr. Rust encaminha ao frontend via
  `app.emit("tool-progress", { toolJobId, percent, stage })`; o hook escuta com `listen()`.
- Barra de progresso real **só** onde há sinal (YouTube, vídeo). Tools rápidas usam spinner.
- Substitui o timer fake (`PROGRESS_STEPS` + `setInterval` em `useConversion`) nesses casos.

### Histórico
- `HistoryEntry` ganha `tool` + campos genéricos de input/output. Persistência mantém-se em
  `localStorage` (`historyService.ts`), cap 50.

---

## 7. Empacotamento & tamanho

### Dois bundles PyInstaller (`python/build.py`)
- **camps-light** — `xhtml2pdf`, `markdown`, `PyMuPDF`, `pikepdf`, `yt-dlp`. Vai no instalador via
  `externalBin`. Poucos MB.
- **camps-docling** — Docling (torch/cv2/scipy/transformers). Buildado em `--onedir`, **zipado**
  (`camps-docling-vX.Y.Z.zip`) e **subido manualmente/CI pro GitHub Release** da versão. Não entra
  no instalador.
- `build.py` ganha modo/flag pra buildar cada bundle e gerar o zip do Docling + seu `sha256`.
- **Passo de upload documentado** (fácil esquecer): o instalador aponta pra um asset que precisa
  existir no Release **antes** de distribuir o `.exe`. CI deve publicar o zip e o hash junto.

### Web installer NSIS (download do Docling no install)
- Tauri v2: `tauri.conf.json` → `bundle.windows.nsis.installerHooks` com script custom no
  `NSIS_HOOK_POSTINSTALL`:
  1. `inetc::get` baixa `camps-docling-vX.Y.Z.zip` do Release (URL fixa HTTPS, versão casando com o app).
  2. **Valida SHA256** contra hash embutido no script (plugin Crypto). Hash errado → aborta, não extrai.
  3. Extrai pra pasta de instalação (ex.: `$INSTDIR\runtime\docling\`).
  4. **Fallback:** download/hash falha → não brickar. App detecta ausência do runtime e baixa no 1º
     uso da tool PDF→MD (mesmo downloader, reaproveitado), com mensagem clara.
- Rust: helper `docling_sidecar_path()` resolve o `converter.exe` do Docling em `$INSTDIR\runtime\...`;
  se ausente, dispara o fallback de download no app. `run_python_tool("pdf2md", ...)` usa esse caminho.
- **Alvos de bundle:** NSIS = web installer (online). MSI mantido só como **full offline** opcional
  (baixa nada, empacota Docling) — restringir `targets` conforme o alvo do build.

### ffmpeg
- Binário estático Windows empacotado como sidecar/resource Tauri (`externalBin` ou
  `bundle.resources`). `yt-dlp` recebe `--ffmpeg-location`; `run_ffmpeg` usa o mesmo binário.
  Resolver caminho via API de resource do Tauri (dev e produção).

### Trims oportunistas (F3)
- No bundle Docling: `--exclude-module` (tkinter, matplotlib se houver, testes), UPX, garantir torch
  CPU-only (remover libs CUDA). Reduz o zip do Release, não o instalador. Medir antes/depois.

### Nome/identidade
- `tauri.conf.json` (`productName` = "CAMPS-UTILS", `identifier` = `com.camps.utils`, título da
  janela), `package.json` `name`, `index.html` `<title>`, logo do `Sidebar.tsx`, marca do ícone em
  `scripts/setup.ps1::New-AppIcon`.

### Segurança do download (obrigatório)
- HTTPS + URL fixa do Release. **SHA256 verificado** antes de extrair (install e fallback do app).
- Versionar o asset por release do app — mismatch de versão = runtime incompatível.
- GitHub Releases = fair use (grátis, 2GB/arquivo ok); sem SLA de CDN. Se tráfego crescer, migrar o
  asset p/ R2/S3 mantendo a URL versionada.

---

## 8. Fases de entrega

### Fase 1 — Fundação + conversões locais + web installer
- [x] Renomear para **CAMPS-UTILS** (produto, identifier, título, package). Ícone (`New-AppIcon`) pendente.
- [x] Registro de ferramentas (`src/tools/registry.tsx`) + Home em grade + Sidebar por categoria.
- [x] Refatorar `App.tsx` p/ `activeTool`; PDF→MD vira tool (`src/tools/pdf-to-markdown/`).
- [x] Imagens → webp/png/jpg/ico (Rust `convert_images`, crates `image`+`webp`). *Falta teste runtime.*
- [x] Markdown → PDF (sidecar `md2pdf`, xhtml2pdf) — PDF válido verificado.
- [x] Base64/texto (frontend) — testado.
- [x] `run_python_tool`/`run_tool` genérico; `convert_pdf` vira wrapper.
- [ ] `build.py` gera 2 bundles (light + docling.zip + sha256); light no `externalBin`.
- [ ] Web installer NSIS: hook baixa Docling do Release, valida hash, extrai; fallback no app.
- [ ] `docling_sidecar_path()` no Rust + fallback de download no 1º uso.
- [ ] Publicar `camps-docling-vX.zip` + hash no GitHub Release (CI ou manual documentado).
- [ ] Rodar `tauri dev` e validar cada tool visualmente (inclui teste runtime de imagem).

### Fase 2 — YouTube
- [ ] Empacotar ffmpeg; resolver caminho em dev/prod.
- [ ] Sidecar `--tool youtube` (yt-dlp): música / vídeo / playlist→música.
- [ ] Eventos de progresso real (`tool-progress` + `listen`).

### Fase 3 — PDF-utils, mídia extra, utilitários, tamanho
- [ ] PDF: juntar / dividir / comprimir (sidecar, PyMuPDF/pikepdf).
- [ ] Imagens: redimensionar / comprimir / renomear em lote (Rust).
- [ ] Áudio converter; vídeo→gif; comprimir vídeo (Rust→ffmpeg).
- [ ] QR code; hash/checksum (Rust).
- [ ] Trims oportunistas no bundle Docling; medir zip do Release antes/depois.

---

## 9. Fora de escopo / futuro

- Remover fundo de imagem (precisa modelo ML — pesado).
- OCR de imagem → texto (poderia reusar RapidOCR já presente).
- Conversão de documentos Office (docx/xlsx) além de PDF.
- Fila/lote persistente entre sessões; agendamento.
- Multi-idioma da UI (hoje pt-BR fixo).
- Migrar settings/histórico de `localStorage` p/ plugin fs do Tauri.

---

## 10. Verificação (por fase, ao implementar)

- `npm run typecheck` limpo; `npm run test` (registro de tools + services).
- `python/test_converter.py` estendido p/ dispatch `--tool`.
- `npm run dev`: abrir cada tool, processar arquivo real de cada tipo, conferir saída em disco.
- YouTube: baixar 1 vídeo curto (mp4 + mp3) **offline**, confirmar uso do ffmpeg empacotado.
- `npm run build`: gerar `.exe` NSIS e medir tamanho (deve ficar ~100–150MB, sem o Docling).
- **Web installer end-to-end:** rodar o `.exe` numa máquina limpa com internet → confirma download do
  Docling do Release, hash válido, extração, e PDF→MD funcionando pós-install.
- **Hash inválido / offline:** adulterar hash e cortar rede → install não brica; fallback do app baixa
  no 1º uso ou mostra erro claro.
