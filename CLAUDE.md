# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Roadmap obrigatório

Este projeto está migrando de "PDF to Markdown" para a suíte **CAMPS-UTILS**. **Sempre** registre o
progresso no roadmap da fase em que estiver trabalhando: ao concluir um passo, marque o checkbox e
anote o que foi feito (com caminhos de arquivo) e os próximos passos, antes de encerrar o turno.

| Roadmap | Cobre |
|---|---|
| `roadmaps/new-functions/roadmap.md` | Fases 1–3: suíte, ferramentas, visual, módulos, updater. **Estado atual.** |
| `roadmaps/removebg-vtracer-realesrgan/roadmap.md` | Entregue: vetorizar (VTracer), aumentar qualidade (Real-ESRGAN), remover fundo (rembg). |
| `roadmaps/web-capture/roadmap.md` | Nova ferramenta: capturar site inteiro (Playwright) em Markdown/HTML/screenshot. Entregue na 1.2.0. |
| `roadmaps/ia-local/roadmap.md` | Fase 4 (**em espera**): legendas, voz, imagem com IA local. Prompt de arranque em `roadmaps/ia-local/PROMPT.md`. |

A spec formal é `spec/novas-funcoes/camps-utils-spec.md`. Comece qualquer sessão lendo o roadmap da
fase e este arquivo.

## What this is

Local-only Windows desktop suite of 20 conversion/utility tools (PDF, images, audio/video,
Base64/QR/hash) — nothing goes to the cloud except YouTube downloads and the on-demand
module downloads. Tauri 2 shell (Rust) + React/TypeScript/Vite/Tailwind frontend + a Python sidecar
for the heavy libraries. Tools are registered in `src/tools/registry.tsx` (single source of truth
for Home and Sidebar). UI strings are Portuguese (pt-BR).

## Commands

```bash
npm run dev            # tauri dev — full app (Rust + Vite), needs sidecar built + Rust installed
npm run dev:vite       # Vite only, no Tauri — UI work without Rust (invoke() calls will fail)
npm run test           # vitest run (jsdom)
npm run test:watch     # vitest watch
npx vitest run src/test/App.test.tsx   # single test file
npm run typecheck      # tsc --noEmit
npm run build:python   # rebuild the Python sidecar via python/build.py (activate .venv first)
npm run build          # tauri build + copia os instaladores para installers/
npm run build:all      # build:python then build
npm run installers     # só recopiar o bundle para installers/ (sem rebuildar)
npm run release        # gera installers/latest.json a partir do build assinado
```

First-time setup / full build from clean machine: `npm run setup` (installs Rust, Node deps, Python venv, icons, sidecar, then builds the installer) or `npm run setup:dev` (same but launches `tauri dev` instead of building). See `scripts/setup.ps1`.

Vite dev server is pinned to port **1420** (strictPort) — Tauri expects it there.

## Releases e atualizações

A partir da **0.2.0** o app se atualiza sozinho (plugin `updater` do Tauri). Quem estiver na 0.1.0
precisa instalar a 0.2.0 na mão uma última vez — aquela versão foi compilada sem o plugin.

### Como o updater funciona

1. O app busca o manifesto em
   `https://github.com/FelipeCamposM/CAMPS-UTILS/releases/latest/download/latest.json`
   (URL fixa configurada em `tauri.conf.json` → `plugins.updater.endpoints`; não muda a cada versão).
2. Compara o `version` do manifesto com a versão instalada. Maior ⇒ há atualização.
3. Baixa o instalador da URL do manifesto e **verifica a assinatura** contra a chave pública gravada
   no binário (`plugins.updater.pubkey`). Assinatura inválida ⇒ recusa e não instala nada.

A assinatura vai **inline** dentro do `latest.json` — o app não busca o `.sig` separado. O `.sig`
sobe junto no Release só por rastreabilidade.

### Dois tipos de Release — e a regra que evita quebrar tudo

| Tipo | Exemplo | Marcar como pre-release? |
|---|---|---|
| Versão do app | `v0.2.0` | **Não** |
| Depósito de arquivo | `ffmpeg-v1`, `docling-v1` | **Sim** |

O motivo: `releases/latest/download/...` faz o **GitHub escolher** qual release é o "latest" — o
último publicado que não seja *pre-release* nem *draft*. Se um release de depósito for publicado
como normal **depois** de uma versão do app, ele vira o "latest", o app procura o `latest.json`
lá dentro, recebe 404 e **a atualização para de funcionar sem nenhum erro visível**.

Marcar os depósitos como pre-release faz a ordem de publicação deixar de importar.

### Assinatura: variáveis de ambiente

`bundle.createUpdaterArtifacts: true` exige as duas variáveis **no terminal onde o build roda**,
senão `npm run build` falha com "A public key has been found, but no private key":

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$USERPROFILE/.tauri/camps-utils.key")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<senha da chave>"
```

Não são arquivo do projeto e **nunca** entram no repositório. Para gravar de vez no Windows, use
`[Environment]::SetEnvironmentVariable(..., "User")` no PowerShell e abra um terminal novo. Em CI,
vão como *repository secrets*.

Perder a chave privada ou a senha significa que **ninguém que já instalou recebe atualização de
novo** — a pública fica gravada no binário deles e não há como trocar remotamente.

### Passo a passo de uma release nova

1. **Subir a versão**: editar o arquivo `VERSION` na raiz (fonte única) e rodar
   `npm run version:sync`, que propaga para `package.json`, `src-tauri/tauri.conf.json` e
   `src-tauri/Cargo.toml`. Quem manda no updater é o do `tauri.conf.json`. `npm run version:check`
   confere sem escrever (o `npm run build` já sincroniza sozinho).
2. **Escrever as novidades** em `src/lib/changelog.ts`, entrada nova no topo, **em linguagem de
   usuário** — é o que o app mostra em Configurações → Sobre e no aviso do Início. Versão sem
   entrada não mostra aviso nenhum; um teste reprova jargão técnico no texto.
3. **Verificar**: `npm run typecheck`, `npm run test`, `cargo check --manifest-path src-tauri/Cargo.toml`,
   `pytest python/test_converter.py`.
4. **Exportar as variáveis de assinatura** (acima) e rodar `npm run build`.
   Os artefatos vão parar em `installers/`.
5. `npm run release` — gera `installers/latest.json` e imprime a tag esperada (`v<versão>`).
6. **Criar o Release no GitHub** com essa tag, anexando três arquivos de `installers/`:
   o instalador (`*-setup.exe`), o `.sig` dele e o `latest.json`.
7. Registrar no `roadmaps/new-functions/roadmap.md`.

### Armadilhas conhecidas

- **O nome do artefato assinado muda entre versões do Tauri.** Antigas: `*-setup.nsis.zip` +
  `.nsis.zip.sig`. Na **2.10**: o `-setup.exe` é assinado direto. `scripts/make-latest-json.mjs`
  tenta os três formatos (`.nsis.zip` → `-setup.exe` → `.msi`) e sempre exige o `.sig` do par.
- **O nome do asset no Release tem que bater exatamente com a URL do `latest.json`.** O GitHub troca
  espaços por pontos no upload; se divergir, o download dá 404 em silêncio.
- **`installers/` não é limpo entre builds** — versões antigas ficam lá de propósito (útil para
  testar atualização de N-1 para N). Confira a versão do arquivo antes de subir.
- `scripts/collect-installers.mjs` filtra por `productName`, senão herda artefatos de nomes de
  produto antigos que o `target/` guarda para sempre.

### Módulos baixados sob demanda

Fora do instalador porque são grandes demais (o updater não faz delta — cada atualização baixaria
tudo de novo). Ficam em Releases de depósito, verificados por SHA256, extraídos em
`appLocalData/runtime/`. Definidos como `RemoteModule` em `src-tauri/src/commands.rs`:

| Módulo | Tag | Zip | Gerado por |
|---|---|---|---|
| Docling (PDF→MD) | `docling-v1` | `camps-docling.zip` (~370 MB) | `python build.py docling` |
| ffmpeg + ffprobe | `ffmpeg-v1` | `camps-ffmpeg.zip` (~59 MB) | `python build.py ffmpeg` |
| Whisper (transcrição) | `whisper-v1` | `camps-whisper.zip` (~90 MB) | `python build.py whisper` |
| Depth Anything V2 | `depth-v1` | `camps-depth.zip` (~48 MB) | `python build.py depth` |
| Real-ESRGAN (upscale) | `realesrgan-v1` | `camps-realesrgan.zip` (~31 MB) | `python build.py realesrgan` |
| rembg (remover fundo) | `rembg-v1` | `camps-rembg.zip` (~130 MB) | `python build.py rembg` |

Trocar o conteúdo de um módulo exige: nova tag, novo zip, e **atualizar `url` e `sha256`** no
`commands.rs`. O `marker` (arquivo que prova que está instalado) não tem versão no nome — se um dia
o conteúdo mudar sem trocar o marker, o app mantém o módulo velho e não rebaixa.

Alguns módulos ainda baixam **pesos** à parte, no primeiro uso: o Docling e o Whisper no cache da
HuggingFace, o Depth em `~/.cache/camps-utils/models/`. O zip do módulo é só o runtime.

**Ao criar um módulo novo, exclua a pilha de TODOS os outros — não só a lista do vizinho.**
O PyInstaller segue `import` dentro de função, e o `converter.py` importa tudo assim. O primeiro
build do depth saiu com 124 MB em vez de 48 porque arrastou `av.libs` e `ctranslate2` pelo
`import faster_whisper` que mora dentro de `transcribe()`. Depois de compilar, **rode o `.exe`**:
módulo faltando não aparece em dev, onde a .venv tem tudo.

## Architecture

Conversion flow crosses three process boundaries. Follow it end to end before changing any layer:

1. **React** (`src/App.tsx`) — user drops a PDF → `useConversion` hook (`src/hooks/useConversion.ts`) → `conversionService.convertPdf()` (`src/services/conversionService.ts`).
2. **conversionService** calls Tauri `invoke("convert_pdf", { inputJson })`. `inputJson` is `JSON.stringify({ inputPath, outputPath? })`.
3. **Rust** (`src-tauri/src/commands.rs::convert_pdf`) spawns the Python sidecar via the shell plugin: `sidecar("converter").args(["--input", inputJson])`. It streams events, collects **stdout only**, and returns it as a raw string.
4. **Python** (`python/converter.py`) parses `--input` JSON, runs Docling (`DocumentConverter` + `RapidOcrOptions`), and prints **exactly one JSON line to stdout**. All progress/logging goes to **stderr** (`log()`), which Rust captures separately for debugging.
5. Back in `conversionService`, the stdout string is `JSON.parse`d into a `ConversionResult` discriminated union and returned to the hook, which dispatches state updates.

**The stdout/stderr split is a hard contract.** Python must never print anything but the final JSON to stdout, or the frontend's `JSON.parse` breaks. Use `log()` (stderr) for everything else.

### State

- Frontend app state is a **discriminated-union reducer** in `src/types/conversion.ts` (`appReducer` + `AppAction`), driven by `useReducer` in `App.tsx`. No Redux/context store.
- `ConversionResult` is `ConversionSuccess | ConversionFailure` keyed on `success`; error paths carry an `ErrorCode`. Both Rust and Python emit JSON matching this shape (including error JSON on failure) — keep the TS types, `converter.py` `make_error/make_success`, and the Rust error strings in `commands.rs` in sync.
- **Progress steps are cosmetic**: `useConversion` advances a fake step counter on a `setInterval` (`PROGRESS_STEPS`, `STEP_INTERVAL_MS`) because Docling doesn't report real progress. Don't mistake it for actual conversion state.

### Rust commands (the whole native surface)

32 registered in `src-tauri/src/lib.rs` (`generate_handler!`) — conversion (`convert_pdf`,
`run_tool`), on-demand modules (`docling_installed`/`ensure_docling`,
`ffmpeg_installed`/`ensure_ffmpeg`, `realesrgan_installed`/`ensure_realesrgan`,
`rembg_installed`/`ensure_rembg`), media
(`compress_video`, `convert_audio`, `video_to_gif`, `download_youtube`, `youtube_info`), native
image/util work (`convert_images`, `resize_images`, `compress_images`, `vectorize_image`,
`upscale_image`, `generate_qr`, `hash_files`) and `copy_file`/`save_markdown`/`open_folder`.

Adding a native capability means: new fn in `commands.rs` → register in `lib.rs`
`generate_handler!` → matching wrapper in `conversionService.ts`. Permissions live in
`src-tauri/capabilities/default.json` (core/dialog) and `desktop.json` (updater/process).

### CSP e o asset protocol — a armadilha que dev nunca mostra

**O CSP do `tauri.conf.json` não vale em `tauri dev`.** Ele é injetado pelo handler de assets do
Tauri, e em dev o front vem do servidor do Vite. Qualquer erro de CSP passa por todo teste manual e
só aparece no app instalado.

Toda leitura de arquivo local pelo webview (`convertFileSrc`) precisa das **três** formas liberadas
em `img-src`, `media-src` e `connect-src`:

| Forma | Onde vale |
|---|---|
| `http://asset.localhost` | **Windows e Android hoje** — é o padrão |
| `https://asset.localhost` | Windows com `useHttpsScheme: true` |
| `asset:` | macOS e Linux |

O `convertFileSrc` monta `${protocolScheme}://asset.localhost/<path>` no Windows, e
`protocolScheme` só é `https` se `app.windows[].useHttpsScheme` estiver ligado. Na 1.0.0 o CSP
liberava só a variante `https` — prévia de imagem, de vídeo, de legenda e o visualizador de PDF
falhavam **todos** no app instalado, funcionando perfeitamente em dev. Corrigido na 1.0.1.

**Não "conserte" isso ligando `useHttpsScheme`.** Isso troca a origem da janela de
`http://tauri.localhost` para `https://tauri.localhost`, e o localStorage é por origem — todo mundo
que já tem o app perde configurações e histórico (ver *Persistence* abaixo).

`src/test/csp.test.ts` trava as três formas. É o único teste que pega esse tipo de erro.

### Persistence

Settings and history are **localStorage only** (MVP), not the Tauri fs plugin — `settingsService.ts`
(key `camps-utils-settings`, with read fallback to the legacy `pdf-to-markdown-settings`) and
`historyService.ts` (key `pdf-to-markdown-history`, capped by `settings.historyLimit`). File saving
to disk goes through the `save_markdown` Rust command instead.

### Python sidecar packaging

`python/build.py` bundles `converter.py` with PyInstaller (collects `docling`, `rapidocr`, `onnxruntime`, `docling_parse`), names the output `converter-<target-triple>` (Tauri 2 sidecar convention), and copies the `.exe` into `src-tauri/binaries/`. `tauri.conf.json` references it via `externalBin: ["binaries/converter"]`. On first conversion Docling downloads ML models to `~/.cache/huggingface/hub` — `detect_first_run()` warns about this.

## Notes

- Rust must be installed for `tauri dev`/`tauri build` (`winget install Rustlang.Rustup`); MSVC Build Tools needed for linking. Pure UI work can skip Rust with `npm run dev:vite`.
- Frontend tests use Vitest + Testing Library + jsdom (`src/test/setup.ts`); Python has `python/test_converter.py` (pytest).
- `roadmap.md` tracks feature checklist state; `promptbase.md` / `spec/` hold the original spec.
