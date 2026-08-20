# Roadmap: PDF to Markdown

> Stack: Tauri 2 + React + TypeScript + Vite + Tailwind CSS + Python + Docling + PyInstaller

---

## Estado atual

- [x] `promptbase.md` — spec completa
- [x] `roadmap.md` — este arquivo
- [x] `skills/` — pasta para referências de UI/UX

---

## Fase 0 — Pré-requisitos e scaffold

### 0.1 Verificar ambiente
- [ ] **Rust + Cargo instalado** ← BLOQUEADOR — instale via `winget install Rustlang.Rustup`
- [x] Node.js 18+ instalado (v22.13.1)
- [x] Python 3.11+ instalado (3.12.9)
- [ ] Tauri CLI disponível (instalado via `npm install` com `@tauri-apps/cli`)

### 0.2 Scaffold do projeto Tauri
- [x] Estrutura criada manualmente: `src/`, `src-tauri/`, `package.json`, `vite.config.ts`
- [x] `.gitignore` adequado
- [ ] `npm install` ← Execute após instalar o Rust

### 0.3 Configurar Tailwind CSS
- [x] `tailwind.config.ts` com dark mode: `class` e tokens de cor customizados
- [x] `postcss.config.ts`
- [x] Tailwind importado no `src/index.css`

---

## Fase 1 — Python / Sidecar

### 1.1 Estrutura Python
- [x] `python/converter.py`
- [x] `python/requirements.txt`
- [x] `python/build.py`
- [x] `python/test_converter.py`

### 1.2 `converter.py`
- [x] Aceitar JSON via argumento `--input`
- [x] Validar `inputPath` e `outputPath`
- [x] Verificar existência do PDF
- [x] Verificar extensão `.pdf`
- [x] Criar diretórios de saída se necessário
- [x] `DocumentConverter` inicializado UMA vez
- [x] Retornar JSON no stdout: `{ success, outputPath, markdown, durationMs }`
- [x] Erros tipados: `INVALID_INPUT`, `FILE_NOT_FOUND`, `INVALID_EXTENSION`, `OUTPUT_ERROR`, `MODEL_ERROR`, `CONVERSION_FAILED`, `UNKNOWN_ERROR`
- [x] Logs técnicos no stderr apenas
- [x] UTF-8 explícito
- [x] Detectar primeiro uso (modelos Docling ainda não baixados)

### 1.3 `requirements.txt`
- [x] `docling`, `pyinstaller`, `pytest`

### 1.4 `build.py`
- [x] Limpar builds anteriores
- [x] PyInstaller `--onedir`
- [x] Nomear `converter-x86_64-pc-windows-msvc`
- [x] Copiar para `src-tauri/binaries/`

### 1.5 Testes Python
- [x] Arquivo inexistente
- [x] Extensão inválida
- [x] Caminho de saída inválido
- [x] JSON de sucesso (mock Docling)
- [x] JSON de erro
- [x] Caracteres especiais no nome do arquivo

---

## Fase 2 — Tipos e serviços TypeScript

### 2.1 `src/types/`
- [x] `conversion.ts` — `ConversionRequest`, `ConversionResult`, `AppState`, `AppAction`, `appReducer`
- [x] `settings.ts` — `AppSettings`, `DEFAULT_SETTINGS`, `MAX_FILE_SIZE_BYTES`
- [x] `AppState`: `IDLE | FILE_SELECTED | CONVERTING | SUCCESS | ERROR`

### 2.2 `src/services/`
- [x] `conversionService.ts` — invoke Tauri command, parse JSON
- [x] `settingsService.ts` — localStorage (MVP)
- [x] `logService.ts` — console.log MVP (extensível para arquivo)

---

## Fase 3 — Configuração Tauri

### 3.1 `tauri.conf.json`
- [x] `productName: "PDF to Markdown"`, `identifier: "com.pdftomarkdown.app"`
- [x] Janela principal 1000×720, mín 720×560, `fileDropEnabled: true`
- [x] `externalBin: ["binaries/converter"]`
- [x] Permissões mínimas: shell, dialog, opener

### 3.2 `capabilities/`
- [x] `default.json` com permissões necessárias

### 3.3 `src-tauri/src/`
- [x] `main.rs` — entry point
- [x] `commands.rs` — `convert_pdf`, `save_markdown`, `open_folder`
- [x] `lib.rs` — setup plugins + invoke_handler

### 3.4 `Cargo.toml`
- [x] Tauri 2 + plugins: shell, dialog, fs, opener
- [ ] `cargo build` ← precisa de Rust instalado

---

## Fase 4 — Interface React (MVP)

### 4.1 Layout base
- [x] `App.tsx` — estado global com `useReducer` + máquina de estados discriminada
- [x] `src/index.css` — tema escuro, scrollbar customizada, prose dark
- [x] Fonte Segoe UI / system-ui

### 4.2 Componentes
- [x] `DropZone.tsx` — drag & drop, file picker, validação, exibir nome/tamanho, remover
- [x] `ConvertButton.tsx` — desabilitado sem PDF, sem cliques duplos
- [x] `ProgressIndicator.tsx` — spinner + 4 mensagens de etapa (sem % falsas)
- [x] `MarkdownViewer.tsx` — tabs Código/Prévia, editor, `react-markdown` + `rehype-sanitize`, Copiar, Limpar
- [x] `ActionBar.tsx` — Salvar .md, Abrir pasta, Converter outro
- [x] `ErrorDisplay.tsx` — erro amigável sem stack trace
- [x] `SettingsModal.tsx` — pasta padrão, auto-save, auto-abrir pasta

### 4.3 Hooks
- [x] `useConversion.ts`
- [x] `useSettings.ts`
- [x] `useDragDrop.ts`

### 4.4 Acessibilidade
- [x] Navegação por teclado (tabIndex, role, aria-*)
- [x] Labels nos inputs
- [x] Foco visível (outline accent)
- [x] Escape fecha modal
- [x] role="alert" nos erros, role="status" no progresso

---

## Fase 5 — Integração Tauri ↔ Python

- [x] Tauri command `convert_pdf` chama sidecar com JSON via `--input`
- [x] Captura stdout (JSON), stderr (logs internos)
- [x] Verifica exit code / evento Terminated
- [x] Propagação de erro tipado para React
- [ ] **Teste manual: PDF real → Markdown exibido** ← pendente (precisa de Rust + sidecar compilado)

---

## Fase 6 — Salvamento e abertura de pasta

- [x] Dialog nativo de salvar (filtro `.md`)
- [x] Nome sugerido baseado no PDF (`relatorio.pdf → relatorio.md`)
- [x] Exibir caminho + mensagem de sucesso (ActionBar)
- [x] Botão "Abrir pasta" via `opener::open_path` (Rust command)
- [x] Fluxo: salvar antes (auto-save settings) ou depois de converter

---

## Fase 7 — Logs

- [ ] `%APPDATA%/PDFToMarkdown/logs/app.log`
- [ ] Campos: timestamp, filename, durationMs, status, errorCode, appVersion
- [ ] Sem conteúdo dos documentos
- [ ] Rotação: máx 5 MB

---

## Fase 8 — Testes da interface

- [x] Setup Vitest + Testing Library (`src/test/setup.ts` + mocks Tauri)
- [x] Seleção de PDF válido
- [x] Rejeição de arquivo inválido
- [x] Estado CONVERTING (spinner visível)
- [x] Exibição de erro
- [x] Exibição de sucesso com Markdown
- [x] Copiar conteúdo
- [x] Limpar resultado / reset
- [ ] `npm test` para rodar ← precisa de `npm install`

---

## Fase 9 — Build e empacotamento

- [x] Scripts no `package.json`: `dev`, `build`, `build:vite`, `build:python`, `build:all`, `setup`, `setup:dev`
- [x] `python/build.py` — PyInstaller `--onedir`, nome correto, copia para `src-tauri/binaries/`
- [x] `scripts/setup.ps1` — automação completa: Rust + venv + icones + sidecar + build
- [x] `setup.bat` / `setup-dev.bat` — duplo-clique para buildar ou rodar dev
- [x] Ícones gerados automaticamente pelo setup.ps1 (ícone "MD" padrão via .NET)
- [ ] Instalador `.msi` / `.exe` NSIS ← rodará automaticamente ao executar `setup.bat`
- [ ] Testar instalador limpo (após primeiro build)

---

## Fase 10 — README

- [x] Visão geral + tecnologias
- [x] Pré-requisitos (Rust, Node, Python, Build Tools)
- [x] Setup: venv, pip install, npm install
- [x] Dev: `npm run dev`
- [x] Build sidecar: `npm run build:python`
- [x] Build instalador: `npm run build:all`
- [x] Modelos Docling (onde ficam, primeiro uso)
- [x] Limpar cache e builds
- [x] Limitações conhecidas (cancelamento, OCR, múltiplos PDFs)
- [x] Solução de problemas
- [x] Estrutura de pastas

---

## Ordem de implementação (MVP)

```
0 → 1 → 2 → 3 → 4 (parcial) → 5 → 6 → 9 → 10
```

**Pós-MVP:**
- Fase 7 (logs avançados)
- Fase 8 (testes interface)
- SettingsModal completo
- Cancelamento de conversão
- Múltiplos PDFs / histórico

---

## Notas técnicas

- Sidecar naming Tauri 2: `converter-x86_64-pc-windows-msvc.exe`
- Docling baixa modelos em `~/.cache/huggingface` no primeiro uso
- Usar `--onedir` no PyInstaller (DLLs do Docling não funcionam bem em `--onefile`)
- `react-markdown` + `rehype-sanitize` para bloquear HTML arbitrário no preview
- Sem `shell=True` no Python; args como lista
