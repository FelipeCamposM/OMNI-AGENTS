# Roadmap — OMNI AGENTS

Estado vivo da implementação definida em `spec.md`.
Última atualização: 2026-08-27.

## Estado atual

Fase 0 concluída. A Fase 1 (Workspace Shell) está em andamento. Os três "próximos passos"
definidos em 2026-08-21 (persistência entre close/reopen, ações de sessão na sidebar,
NAVIGATE/TYPE + atenção) foram implementados em 2026-08-27 — ver detalhes nas Fases 2/3 abaixo.
Command palette e persistência SQLite continuam adiadas.

Verificação atual:

- `npm run typecheck` — limpo;
- `npm run test` (vitest) — 43/43;
- `cargo check --workspace` — limpo;
- `cargo test -p omni-engine` — 3/3 (`restart_session_keeps_id_but_gets_a_new_pid`,
  `approval_prompt_patterns_are_detected_case_insensitively`,
  `idle_timeout_only_demotes_working_sessions_to_answered`);
- `npm run build:engine` — concluído;
- script de verificação (`verify-engine-persistence.mjs`, scratchpad) — sessão sobrevive a um
  restart real do processo `omni-engine.exe` e volta como `stopped`;
- `git diff --check` — limpo.
- **Pendente**: passo manual completo em `tauri dev` (fechar/reabrir a janela com dois
  terminais vivos de verdade, via UI) — a lógica foi corrigida e validada no nível do engine,
  mas não substitui o roteiro manual com xterm real.

## Fase 0 — Fork interno

- [x] Identidade OMNI AGENTS e AppData próprios.
- [x] Updater e ícone próprios.
- [x] Remoção das ferramentas e do sidecar Python.
- [x] Shell vazio compilando e testado.
- [x] Tema, paletas, backgrounds e preferências preservados.

## Fase 1 — Workspace Shell

- [x] Modelo versionado de Workspace, Project, árvore de splits, panes e tabs
      (`src/types/workspace.ts`).
- [x] Projetos adicionados pelo seletor nativo, deduplicados por path e selecionáveis.
- [x] Persistência local e fallback para estado seguro quando o JSON está ausente/corrompido
      (`src/services/workspaceService.ts`, chave `omni-agents-workspace`).
- [x] Sidebar hierárquica com projeto ativo e seções recolhíveis.
- [x] Split horizontal e vertical, resize com limite 20%–80%, fechar e maximizar pane.
- [x] Pane/tab ativa, foco visual, barra de status e restauração após remontar a UI.
- [x] Testes do reducer e do fluxo persistido (`src/test/workspaceReducer.test.ts`,
      `src/test/App.test.tsx`).
- [x] Criar/fechar tabs reais e mover tab entre panes; mover a última tab colapsa a pane de origem.
- [x] Drag-and-drop de tabs para mover ou criar splits à esquerda, direita, acima e abaixo
      (`WorkspaceTabBar.tsx`, `TabDropOverlay.tsx`).
- [x] Fechar projeto (não existia antes): botão `×` por projeto na Sidebar encerra todas as
      sessões de terminal daquele projeto (`collectResourceIds` em `workspaceReducer.ts`
      percorre a árvore) e remove o projeto da lista (`CLOSE_PROJECT`); se era o ativo, seleciona
      outro ou zera `activeProjectId`.
- [ ] Persistir em SQLite pelo engine; localStorage é a persistência provisória da Fase 1.
- [ ] Command palette (adiada até concluir o núcleo de terminais).
- [ ] Validação visual no Tauri em tema claro e escuro.

## Fases 2/3 — Engine persistente e terminais

- [x] Workspace Cargo e contratos compartilhados (`omni-protocol`).
- [x] Binário separado `omni-engine`, sem dependência do WebView/Tauri.
- [x] IPC JSON tipado em loopback com token local, versionado e autenticado.
- [x] PTY real via `portable-pty`/ConPTY; PowerShell padrão e shell alternativo por sessão.
- [x] Múltiplas sessões simultâneas com input, resize, stop e PID.
- [x] Scrollback em ring buffer de 5 MB e snapshots incrementais por sequência.
- [x] Persistência de metadados em AppData e recovery seguro como `stopped`/`orphan`.
- [x] Cliente Tauri para start/reconnect/list/spawn/write/resize/stop/snapshot.
- [x] Renderer xterm.js com FitAddon, teclado, resize, polling incremental e reconnect.
- [x] Launcher sob demanda com detecção e escolha entre Cursor, Gemini, Claude e Codex.
- [x] Configurações > Agentes com detecção, refresh e login oficial por provider sem armazenar credenciais.
- [x] Build do engine integrado ao dev/build e sidecar incluído no bundle Tauri.
- [x] ADRs de engine, IPC e PTY em `docs/adr/`.
- [ ] Validar UI completa em `tauri dev`, incluindo fechar/reabrir com dois terminais vivos
      (corrigido o loop de reconexão em `src/features/terminal/TerminalPane.tsx` — tab
      apontando pra sessão morta agora oferece "Iniciar nova sessão" em vez de travar no
      mesmo erro; persistência do lado do engine validada por script, falta o passo manual
      com xterm real na UI).
- [x] Listar sessões do engine por projeto na sidebar e permitir attach manual sem duplicar tabs.
- [x] Fechar tab/pane encerra e remove sessões; sidebar permite remover agentes persistidos diretamente.
- [x] Duplicate/restart explícitos na UI (`⧉`/`↻` na sidebar por sessão, "reiniciar" também na
      barra de status do `TerminalPane`). Protocolo `DuplicateSession`/`RestartSession` em
      `crates/omni-protocol/src/lib.rs`; lógica em `crates/omni-engine/src/main.rs`
      (`duplicate_session`, `restart_session`, refatorado `spawn_terminal_inner`); comandos
      Tauri em `src-tauri/src/engine_client.rs`; wrappers em
      `src/features/terminal/terminalService.ts`. Restart reinvoca o mesmo agente/CLI original
      (`initial_command` agora persistido em `TerminalSession`) e preserva o `id`/scrollback;
      duplicate abre sessão nova sem replicar o agente. Teste:
      `restart_session_keeps_id_but_gets_a_new_pid`. **Clear/copy/paste ainda não
      implementados.**
- [x] Modo NAVIGATE/TYPE — primeira versão em `src/features/workspace/useWorkspaceKeymap.ts`:
      contexto inferido por `data-omni-context="terminal"` no host do xterm, atalho reservado
      `Ctrl+Shift+Space` sai do terminal, atalhos de app (`Ctrl+\` split, `Ctrl+W` fechar pane,
      `Ctrl+M` maximizar, `Ctrl+Tab` ir pro próximo item de atenção) hardcoded — não
      configuráveis ainda (`ponytail:` no código).
- [x] Detector de estados `answered`, `approval_required` e `crashed` — primeira heurística em
      `crates/omni-engine/src/main.rs`: `Crashed` agora é factual (exit code do processo via
      `try_wait`, guardado contra sessão trocada por restart); `Answered` por timeout de
      inatividade de 1.5s (`apply_idle_timeout`, computado on-read); `ApprovalRequired` por
      substring no último chunk de output (`looks_like_approval_prompt`, lista hardcoded:
      `(y/n)`, `do you want to`, `allow?`, `permitir?`). Testes:
      `approval_prompt_patterns_are_detected_case_insensitively`,
      `idle_timeout_only_demotes_working_sessions_to_answered`. **Ceiling conhecido**: lista de
      substrings e timeout fixo são heurísticas de primeira versão — ajustar com exemplos reais
      de prompts de cada CLI (Claude Code/Codex/Cursor/Gemini) durante o uso.
- [ ] Persistência do scrollback em disco e migração futura de metadados para SQLite.
- [ ] Autostart/recovery após login do Windows.
- [ ] Ações explícitas de clear/copy/paste na UI do terminal.

## Cobertura funcional do Tesseract

- [x] Mosaico multipane, tabs e splits persistentes.
- [x] Engine independente da tela e terminais desacoplados da UI.
- [x] Estados normalizados com glyph + texto na pane de terminal.
- [ ] Célula com contextos Claude/Cursor/shell/Markdown lazy.
- [x] Attention (`answered` diferente de `approval_required`) e navegação pro próximo item
      (`Ctrl+Tab`, heurística v1 — ver Fases 2/3).
- [ ] Seleção/cópia própria e atalhos completos (NAVIGATE/TYPE v1 já existe, falta copy/paste).
- [ ] Markdown pesquisável com live reload.
- [ ] Docker por projeto, ações progressivas e logs como pane.
- [ ] Detecção de atividade sem falso positivo de spinner/cursor.
- [ ] Notificações emitidas pelo engine com UI fechada.

## Próximos passos

1. Rodar o roteiro manual em `tauri dev` com dois terminais vivos de verdade (fechar pela X,
   reabrir, confirmar reattach automático) — a lógica está corrigida e o mecanismo de
   persistência validado por script, falta só a passada manual na UI real.
2. Coletar exemplos reais de prompt de aprovação de cada CLI instalada e ajustar a lista de
   substrings/timeout da heurística de atenção conforme uso real.
3. Ações explícitas de clear/copy/paste no terminal.
4. Command palette e persistência SQLite (continuam adiadas, retomar depois do item 1).

### Prompt por voz (implementado 2026-10-19, ainda não publicado)
Pedido do usuário: "inserir prompt falando", estilo OpenWhispr. Desenho aprovado em 2026-10-18 e entregue:
- [x] **Modelo opcional**: `ggml-small-q5_1.bin` (~190 MB, multilíngue) baixado só em Configurações → Geral → Voz
  (`VozCard` em `src/components/SettingsView.tsx`). **Sem o modelo, o microfone não aparece em lugar nenhum.**
  Download pelo `curl` do sistema para `<dados do engine>/voz/`, conferido por tamanho + SHA-256 antes de virar o
  modelo (`.part` até lá). Dá para remover (libera disco e a RAM do modelo).
- [x] **Transcrição no PC** com whisper.cpp via `whisper-rs 0.16` dentro do engine (`crates/omni-engine/src/voz.rs`).
  Rotas: `GET /voz`, `POST /voz/baixar|remover|ajustes`, `POST /conversas/{id}/voz` (PCM 16 bits 16 kHz mono, até 5 min).
  O navegador captura PCM cru (`AudioContext` + `ScriptProcessor`) e reamostra para 16 kHz (`src/mobile/voz.ts`):
  o engine não precisa de decodificador.
- [x] **Transcrição ao vivo por trechos** (pedido 2026-10-19, "no OpenWhispr vai transcrevendo enquanto falo"):
  `criarCortador` corta a fala nas pausas (≥0,6 s de silêncio com trecho ≥2 s, ou 20 s seguidos; silêncio puro nunca
  vira trecho — o whisper alucina "Obrigado."). Cada trecho vai em fila para `POST /conversas/{id}/voz` e o texto entra
  no campo enquanto a pessoa fala; a correção por IA roda uma vez no fim (`POST /conversas/{id}/voz/corrigir`) e só
  troca o fim do campo se ainda for a fala crua. No engine, `set_audio_ctx` do tamanho do trecho (piso 768 = 15 s) —
  sem isso o whisper codifica sempre 30 s e um trecho de 4 s custava ~7 s — e threads = núcleos físicos (8 threads
  num 6c/12t era instável, 3–10 s). Medido (Ryzen 5 3600, fala de 10 s com uma pausa): 1ª frase aparece ~3 s depois
  de dita, texto pronto **~2,8 s depois de parar** (antes: ~5–7 s, tudo só no fim). Janela cheia (1500) dava ~7 s por
  trecho — inviável ao vivo. Custo: a janela reduzida às vezes repete palavra (1 em 6 execuções: "Boi-boi-boi").
- [x] **Vocabulário do projeto** como `initial_prompt` (nome do projeto + entradas da raiz, sem ocultos/node_modules/target).
- [x] **Correção com IA opcional** (desligada por padrão): `claude -p --model haiku` com `--tools "" --strict-mcp-config
  --no-session-persistence --system-prompt` — ~6 s a mais (sem esses flags eram ~20 s) e não suja o histórico do Claude.
  Instrução mantém palavras/conjugação/tom. Falhou → volta a transcrição crua.
- [x] Texto **cai no campo para revisar**, nunca envia sozinho (`BotaoDeVoz` em `src/mobile/Composer.tsx`). Botão só com
  `transcrever` + página segura (`isSecureContext`) + `getUserMedia`; gravando: vermelho pulsando + tempo.
- [x] Build: `scripts/build-engine.mjs` passa `GGML_NATIVE=OFF` + piso AVX2/FMA/F16C/BMI2 em x86_64 (senão o binário do
  CI levaria as instruções da CPU do runner e travaria em outros PCs) e, no MSVC, `CMAKE_<LANG>_FLAGS_RELEASE` com `-O2`
  (o crate `cmake` tirava a otimização: **52 s → 5 s**). O engine confere a CPU (`cpu_suporta`) antes de oferecer a voz.
  No Windows precisa de LLVM (`winget install LLVM.LLVM`, para o bindgen) e CMake (pego do VS Build Tools automaticamente).
- [x] macOS: `src-tauri/Info.plist` com `NSMicrophoneUsageDescription` (sem ela o macOS mata o app no 1º acesso ao microfone).
- Testes: `voz::tests` (4, Rust) e `src/test/Voz.test.tsx` (6, incluindo o cortador). Ponta a ponta na web do engine de teste com microfone
  falso do Chromium tocando fala pt-BR sintetizada → texto certo no campo.
- **Pendente / limites conhecidos**:
  - Celular/web pelo `http://100.x` do Tailscale: o navegador não libera microfone → botão escondido (usar o ditado do
    teclado). Resolver com HTTPS (`tailscale serve`) se quiser voz no celular.
  - Não testado em Mac nem Linux reais; no Linux o WebKitGTK costuma não ter `getUserMedia` → botão some.
  - Limiar de silêncio fixo (RMS 0,01): ambiente muito barulhento nunca "pausa" e cai no corte de 20 s.
  - CI ainda não rodou com o whisper (precisa de libclang/cmake nos runners — devem ter; conferir no próximo push).

## Múltiplos workspaces + painel de arquivos (entregue 2026-08-27)

Pedido do usuário, fora do escopo original do MVP do spec (§14.3 marcava edição de arquivo como
P1) — expansão deliberada, não erro de spec.

- [x] **Múltiplos workspaces**: `WorkspaceCollection` (`src/types/workspace.ts`) — lista de
  `WorkspaceState` + `activeWorkspaceId`. `workspacesReducer.ts` novo (delega toda ação que não é
  `ADD_WORKSPACE`/`SELECT_WORKSPACE`/`CLOSE_WORKSPACE` pro `workspaceReducer` já existente,
  aplicado só ao workspace ativo — zero reescrita do reducer original). Persistência em nova
  chave `omni-agents-workspaces` (`workspaceService.ts`), com migração automática da chave
  legada `omni-agents-workspace` (single-workspace) na primeira carga. Switcher no Sidebar
  (`WorkspaceSwitcher.tsx`, substitui o rótulo estático "Workspace" sob o logo) — mesmo padrão
  de portal/clique-fora do `NotificationBell`. `CLOSE_WORKSPACE` encerra as sessões de terminal
  de todos os projects do workspace antes de remover (generaliza o padrão de `onCloseProject`).
  Testes: `src/test/workspacesReducer.test.ts` + extensão de `App.test.tsx` (2 workspaces
  sobrevivendo a remount).
- [x] **Painel de arquivos estilo IDE, com edição real**: `tauri-plugin-fs` (já registrado,
  dormant) ganhou permissões em `src-tauri/capabilities/default.json`
  (`fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-read-dir`, `fs:allow-exists`,
  `fs:allow-stat`, `fs:scope` amplo + `opener:allow-open-path`/`allow-reveal-item-in-dir`) — a
  restrição "só a raiz do projeto" (spec §25.1) é aplicada em código
  (`src/features/files/filesService.ts::assertWithinRoot`), não no Tauri. Árvore lazy
  (`useFileTree.ts`, `FileTree.tsx`) alimenta a seção FILES do Sidebar. Ignore-list padrão +
  `.omni/project.json` (`exclude`, spec §24.2) mesclado por cima. Editor **Monaco**
  (`@monaco-editor/react` + `monaco-editor`, decisão explícita do usuário sobre CodeMirror —
  mais pesado, mas foi o pedido) — workers via `new URL(..., import.meta.url)` em
  `monacoSetup.ts` (`?worker` em subpath de node_modules não resolve nem em dev nem em
  `vite build` nesse projeto; troquei pra esse mecanismo, único que funcionou). Salvar:
  auto-save com debounce de 1.5s por padrão, `Ctrl+S` sempre funciona nos dois modos,
  configurável pra manual em Configurações → Arquivos (`AppSettings.fileSaveMode`). Indicador
  de "não salvo" (`•`) na tab (`WorkspaceTabBar.tsx`). Markdown (`MarkdownPane.tsx`, só leitura)
  reaproveita `react-markdown`/`remark-gfm`/`rehype-sanitize` já instalados, com reload por
  polling de mtime a cada 1s (mesmo padrão de `useTerminalSessions`). `CREATE_TAB` ganhou
  `resourceId` opcional pra abrir arquivo direto na tab sem precisar de uma segunda ação.
  Testes: `src/test/filesService.test.ts` (ignore-list, restrição de raiz), `FilePane.test.tsx`
  (auto-save vs manual). **Verificado com `npm run build:vite` real (não só `tauri dev`)** — os
  workers do Monaco resolvem certo no bundle de produção; falta a passada final com
  `npm run build` completo (empacotado, exige a chave de assinatura) pra confirmar que o CSP do
  app instalado não bloqueia os workers — ninguém rodou esse passo ainda.
- [x] **Operações de arquivo estilo IDE** (pedido em seguida, mesmo dia): criar arquivo/pasta,
  renomear inline (clique direito → Renomear, campo de texto no lugar do nome), excluir (com
  `window.confirm`), arrastar entre pastas (`draggable` + payload JSON no
  `dataTransfer`, mesmo padrão de `tabDrag.ts`). Tudo em `FileTree.tsx` via menu de contexto
  próprio (`FileTreeContextMenu`, portal + fecha no clique fora/Esc, mesmo padrão do
  `NotificationBell`). Novo em `filesService.ts`: `createFile`, `createDir`, `renamePath` (serve
  tanto renomear quanto mover — mover é só renomear pra um path sob outra pasta),
  `removePath` (`recursive:true` só pra pastas), + `joinPath`/`dirName`/`baseName` exportados.
  Novo em `useFileTree.ts`: `refreshDir(absoluteDirPath)` recarrega uma pasta específica depois
  de qualquer operação. Guarda contra soltar uma pasta dentro dela mesma (comparação de prefixo
  de path). Renomear/mover um arquivo que está aberto numa tab atualiza o `resourceId` da tab em
  vez de deixá-la quebrada — ação nova `RENAME_TAB_RESOURCE` no `workspaceReducer.ts`, percorre
  todas as panes (o mesmo arquivo pode estar aberto em mais de uma tab). Testes: extensão de
  `filesService.test.ts` (create/rename/remove respeitam a raiz do projeto, `recursive` correto)
  e de `workspaceReducer.test.ts` (`RENAME_TAB_RESOURCE` em múltiplas panes).
- [x] **Fechar tabs de arquivo excluído** (resolvido — antes ficava de fora): nova ação
  `CLOSE_TABS_BY_RESOURCE_PREFIX` no `workspaceReducer.ts` — fecha toda tab cujo `resourceId`
  seja igual ou esteja dentro do path excluído (arquivo exato OU qualquer coisa dentro de uma
  pasta apagada), em todas as panes, reaplicando `takeTab` uma tab de cada vez (fechar mexe na
  árvore, não dá pra calcular tudo de uma vez olhando o estado original). Nunca força o projeto a
  ficar sem nenhuma pane. `FileTree.tsx` dispara isso (`onPathDeleted`) depois que
  `removePath` termina.
- [x] **Animação do alvo de arrasto** (`src/index.css` + `FileTree.tsx`): pasta sob o arquivo
  arrastado ganha anel pulsante contínuo (`.drop-target-active`/`drop-target-pulse`, CSS,
  0.9s loop, `outline` em vez de `border` pra não deslocar o conteúdo) — fecha o golfo de
  avaliação, confirma sem parar qual é o alvo atual enquanto o arrasto dura. O glifo da pasta
  (▸/▾) dá um bounce único (GSAP, `back.out(3)`, 120ms ida-e-volta) no instante em que vira
  alvo — fecha o golfo de execução, deixa óbvio na hora que soltar ali move o item pra dentro.
  Mesmo tratamento no drop da raiz do projeto (área vazia da árvore).
  **Causa raiz de verdade (achada depois, corrigida na sequência)**: não era o
  `onDragLeave` — o arrasto interno inteiro (mover arquivo entre pastas) nunca funcionava de
  verdade. `dragDropEnabled` do Tauri (ligado por padrão — é o que faz o
  `onDragDropEvent` do drop externo do Explorer existir) faz o WebView2 interceptar **todo**
  gesto de arrastar nativo da página, não só arquivo vindo de fora — isso incluía o
  `draggable`/`onDragStart`/`onDragOver`/`onDrop` HTML5 que o move interno usava, matando os
  dois ao mesmo tempo (por isso nem o move nem a animação apareciam — mesma causa, não dois
  bugs). **Reescrito**: o arrasto interno agora é rastreado por
  `pointerdown`/`pointermove`/`pointerup` (`FileTree.tsx::startNodeDrag`), que nunca passa pelo
  sistema nativo de drag — imune ao `dragDropEnabled`. Limiar de 4px pra distinguir de um
  clique normal; alvo resolvido a cada `pointermove` via `document.elementFromPoint` (mesma
  função `resolveDropTargetDir` que já existia pro drop externo — unificado, um resolvedor de
  alvo só). Um ref (`justDraggedRef`) suprime o clique sintético que o navegador dispara logo
  depois do `pointerup` de um arrasto de verdade, pra não abrir/expandir sem querer o item onde
  o mouse soltou. Isso também resolve a animação de vez — ela dependia dos mesmos eventos
  nativos que estavam sendo engolidos.
- [x] **Preview de imagem** (pedido no mesmo dia — antes `.png`/`.jpg`/etc. iam pro Monaco
  tentando ler binário como texto e mostravam lixo): `filesService.ts::isImagePath`
  (png/jpg/jpeg/gif/webp/bmp/ico/svg) + `ImagePane.tsx` novo (só visualização, `<img>` via
  `convertFileSrc`, sem edição — não faz sentido "editar" uma imagem no Monaco). `PaneView.tsx`
  decide entre `ImagePane`/`FilePane` pela extensão do `resourceId`, sem precisar de um
  `PaneKind` novo nem tocar o reducer. CSP do `tauri.conf.json` já libera `asset:`/
  `http://asset.localhost`/`https://asset.localhost` em `img-src` (herdado do fork CAMPS-UTILS)
  — não precisou mexer em permissões. **Só testado em dev**: o CSP real só vale no app
  empacotado (gotcha já documentado no `CLAUDE.md`), vale confirmar no build final também.
- [x] **Colar (Ctrl+V) e arrastar do Explorer do Windows pra dentro do app**: dois caminhos
  diferentes porque são duas fontes diferentes de dado.
  - *Arrastar do Explorer*: usa o evento nativo do Tauri (`getCurrentWebviewWindow().onDragDropEvent`,
    `@tauri-apps/api/webviewWindow`) — o HTML5 `dataTransfer` de um drop de arquivo do SO não
    expõe o caminho real no navegador, só o evento nativo do Tauri dá isso (`event.payload.paths`).
    A posição do drop vem em pixels físicos; convertida por `devicePixelRatio` e resolvida pra um
    nó da árvore via `document.elementFromPoint` + `data-tree-path`/`data-file-tree-root` nos
    elementos. Fora da árvore de arquivos, ignora (não intercepta drops jogados em outras partes
    da janela). Cópia recursiva pra pastas (`filesService.ts::copyIntoProject`, o plugin não tem
    cópia recursiva nativa).
  - *Colar*: evento `paste` do DOM (`onPaste` no container da árvore) lendo
    `event.clipboardData.files` — funciona pra arquivo copiado no Explorer (Ctrl+C lá, Ctrl+V
    aqui) porque o Chromium/WebView2 populam isso com o conteúdo. Sem path de origem disponível
    por esse caminho, só o conteúdo — grava direto via `filesService.ts::writeBinaryFile`
    (bytes crus, pra não corromper binário tipo imagem). Destino: pasta do elemento focado no
    momento (mesma resolução de path do drag), ou raiz do projeto se nada estiver focado.
  - Permissões novas: `fs:allow-copy-file`, `fs:allow-write-file`.
  - Sobrescreve sem perguntar se já existe algo com o mesmo nome (mesmo comportamento de
    `renamePath`/mover, que já sobrescreve).
  - Testes: `filesService.test.ts` (`copyIntoProject` arquivo único + recursivo + restrição de
    raiz, `writeBinaryFile` idem).
- [x] **Seção SKILLS na Sidebar** (pedido no mesmo dia): lista os skills do projeto aberto
  (`.claude/skills/<nome>/SKILL.md`, convenção do Claude Code) — nova pasta
  `src/features/skills/` (`skillsService.ts::listProjectSkills`, parser de frontmatter mínimo
  só pra `name`/`description`, não é YAML de verdade — suficiente pro formato de linha única
  que todo SKILL.md real usa; bloco multi-linha cai pro nome da pasta em vez de quebrar a
  lista), `useProjectSkills.ts` hook, `SkillsList.tsx` novo componente. Clicar num skill abre o
  `SKILL.md` como aba markdown — reaproveita o `MarkdownPane` já existente, dispatcha
  `onOpenFile(path, "markdown")` igual o painel de arquivos já faz. Projeto sem `.claude/skills`
  mostra "Vazio", não erro. Testes: `skillsService.test.ts` (lista vazia sem a pasta, parse de
  frontmatter com aspas simples/duplas, pasta sem SKILL.md não quebra a lista, fallback pro
  nome da pasta quando falta `name`/`description`).
- [ ] Ainda fora de escopo: abrir PDF no painel de arquivos — mostra "prévia não suportada"
  (imagem já funciona); escrever em `.omni/project.json` (só leitura por enquanto);
  code-splitting do Monaco (hoje carrega no bundle principal mesmo sem nenhuma tab de arquivo
  aberta — bundle principal ficou em ~4.85 MB / 1.29 MB gzip, a maior parte é o core do Monaco);
  perguntar antes de sobrescrever num conflito de nome ao colar/arrastar/mover; SKILLS não
  reflete skills instalados como plugin/marketplace (só `.claude/skills/` local do projeto).

## Rename de workspace, trust-skip genérico, retomar conversa, colar imagem, painel Git (2026-09-08)

Pedido do usuário citando o [maestrus](https://github.com/joaoventuri/maestrus) como referência —
explorado via GitHub API (sem clonar) pra separar padrão real de suposição. Sync de config entre
PCs (também citado inicialmente) foi descartado pelo usuário durante a conversa em favor do painel
Git abaixo.

- [x] **Renomear workspace**: ação `RENAME_WORKSPACE` (`src/types/workspace.ts`,
  `workspacesReducer.ts`) + clique duplo no nome dentro do `WorkspaceSwitcher.tsx` (campo inline,
  `Enter` confirma, `Escape` cancela). Testes novos em `workspacesReducer.test.ts`.
- [x] **Pular "trust this folder" (genérico por agente)**: novo comando Rust
  `ensure_agent_trust(agent_id, cwd)` (`src-tauri/src/engine_client.rs`) — mesmo mecanismo do
  `ensureTrusted` do Maestrus (`electron/claude-pty.js`): grava
  `projects.<cwd>.hasTrustDialogAccepted = true` em `~/.claude.json` antes do spawn. Só tem
  entrada pra `"claude"` hoje (único CLI com esse diálogo confirmado); adicionar outro agente é
  só um `match` novo na função — por isso "genérico" mesmo sem cobrir os outros 3 ainda. Chamado
  de `TerminalPane.tsx` antes de `spawnTerminal`, non-blocking (`.catch` engolido — falha só
  significa que o diálogo de trust volta a aparecer, não trava o spawn).
- [x] **Retomar conversa anterior**: em vez de indexar conversas do zero, reaproveita o resume
  nativo de cada CLI. **Correção 2026-09-08**: a primeira versão usava `--resume`/`resume`, que
  abre um *picker* interativo — pedido explícito do usuário pra abrir direto nas últimas
  mensagens, igual o Maestrus, sem esse passo intermediário. `AGENT_RESUME_FLAG`
  (`terminalService.ts`) agora mapeia `claude` → `--continue` (carrega a conversa mais recente do
  diretório automaticamente) e `codex` → `resume --last` (idem, confirmado via busca — sintaxe
  exata do Codex não estava validada antes). `AgentLauncher.tsx` só muda o `initialCommand`
  digitado na PTY, sem picker nenhum.
- [x] **Colar imagem no terminal**: `TerminalPane.tsx` ganhou um listener de `paste` em fase de
  captura no host do xterm (roda antes do próprio xterm, que só lê `text/plain` e ignora imagem
  silenciosamente). Se o clipboard tiver uma imagem, salva em
  `<projectRoot>/.omni-agents/pasted/` via `writeBinaryFile` (mesma função já usada em
  `FileTree.tsx` pra paste-de-arquivo) e digita o path absoluto na PTY em vez de fazer nada.
  **Não testado contra o comportamento real do Claude Code CLI pra imagem colada** — a decisão de
  "digitar o path" é a extrapolação do padrão já existente no app (drop de arquivo = path), não
  uma confirmação de como cada CLI trata isso.
- [x] **Painel Git por projeto + grafo visual completo**: não existia nenhuma integração Git
  antes (só a busca de `git-bash.exe` como shell). Novo módulo
  `src-tauri/src/git_client.rs` (shell-out pro `git` do sistema, sem crate nova) com
  `git_status`/`git_diff`/`git_stage`/`git_unstage`/`git_commit`/`git_branches`/
  `git_checkout_branch`/`git_log_graph`, registrados em `lib.rs`. Frontend:
  `src/features/git/gitService.ts` (wrappers `invoke`, com guarda de shape pra não confiar
  ciegamente na resposta), `src/components/GitPanel.tsx` (status/stage/commit, ocupa a seção GIT
  da Sidebar que já existia vazia), `src/features/git/GitDiffPane.tsx` (aba `git-diff`, novo
  `PaneKind`), `src/features/git/GitGraphPane.tsx` (aba `git-graph`, novo `PaneKind`) — grafo
  completo com branches/merges de verdade via `@gitgraph/react` (dependência nova), reconstruindo
  o DAG real (não só uma lista linear) a partir de `git_log_graph`: cada commit sabe sua "lane"
  antes de ser processado (decidido pelo pai, ao avançar); merge consome a lane do primeiro pai e
  recebe a do segundo como argumento de `.merge()`. `ponytail:` limite de 200 commits na janela do
  grafo (performance em repos grandes) — commits mais antigos que o corte aparecem como raiz
  sintética.
  **Requer `git` no PATH do usuário** — sem mensagem de boas-vindas se não tiver, só o erro crú do
  `git_client.rs` (`"git não encontrado no PATH: ..."`) aparecendo onde o painel tentar carregar.
- [x] **Bug corrigido (2026-09-08): "session not found" ao fechar a única sessão de um projeto**.
  Causa raiz em `takeTab` (`workspaceReducer.ts`) — quando a tab fechada é a última da última
  pane, ela nunca pode ser removida (uma pane nunca fica sem tab nenhuma) e a função devolvia
  `null`; `CLOSE_TAB` então não fazia nada, mas o backend já tinha encerrado a sessão (chamado
  antes do dispatch em `PaneView.tsx::closeTab`) — a tab ficava presa apontando pra um
  `resourceId` morto, e o `poll()` do `TerminalPane` batia "session not found" pra sempre. Corrigido
  na raiz, pra todo caller de `takeTab` (não só `CLOSE_TAB`): esse caso agora reseta a tab pro
  estado "agente novo" (sem `resourceId`) em vez de devolver `null` — `CLOSE_TABS_BY_RESOURCE_PREFIX`
  ganhou o mesmo comportamento de graça. Além disso, fechar uma sessão pela lista TERMINALS da
  Sidebar (`onCloseTerminal` em `App.tsx`) não disparava nenhuma limpeza de tab — só matava a
  sessão no backend; agora dispara `CLOSE_TABS_BY_RESOURCE_PREFIX` com o `sessionId` como prefix,
  mesmo mecanismo já usado pra arquivo excluído. Teste de regressão em
  `workspaceReducer.test.ts` (`CLOSE_TAB na última tab da última pane reseta...`).
- [ ] **Nada disso foi validado num `tauri dev` real** — só `npm run typecheck` (limpo),
  `npm run test` (80/80), `cargo check` (limpo). Falta o roteiro manual: renomear workspace e
  confirmar persistência; abrir Claude num projeto novo e confirmar que o diálogo de trust não
  aparece; testar "Retomar conversa" pro Claude e pro Codex; colar um screenshot de verdade no
  terminal; abrir a seção GIT num repo com merge real e confirmar que o grafo desenha a curva
  certa.

## Ordem dos agentes, drag de panes + layouts, fix do Git Graph, sidebar bonita, rename fácil (2026-09-08)

Cinco pedidos independentes, continuação da rodada anterior (rename workspace/trust-skip/git panel).

- [x] **Ordem dos agentes**: `engine_client.rs::agent_cli_statuses` e `AgentLauncher.tsx::FALLBACK_AGENTS`
  reordenados pra claude → codex → gemini → cursor (estava cursor primeiro). Default do `<select>`
  agora é `FALLBACK_AGENTS[0].id` em vez de um `"codex"` hardcoded que ficava fora de sincronia com
  a lista.
- [x] **Bug do Git Graph corrigido** — três causas achadas lendo o `@gitgraph/react`/`@gitgraph/core`
  reais em `node_modules` (não só a doc):
  1. `git_client.rs::git_log_graph` rodava `git log --all` sem `--topo-order` — ordem por data não
     garante pai-antes-do-filho; adicionado.
  2. `GitGraphPane.tsx` chamava `branch.merge(other, { subject, hash })`, que **não é a assinatura
     real** da lib (é `merge(branch, subjectString)` ou `merge({branch, commitOptions})`) — o
     objeto virava `"[object Object]"` na mensagem e o hash real era descartado. Corrigido pra
     `branch.merge({ branch: other, commitOptions: { subject, hash, author } })`, interface
     `GraphBranch.merge` local atualizada pra bater.
  3. `laneOf.get(inWindowParents[1])!` (non-null assert sem fallback) podia ser `undefined` mesmo
     com `--topo-order` (janela de `MAX_COMMITS` cortando o segundo pai) → `branch.merge()` real
     lança `TypeError` ao ler `.name` de `undefined`. Trocado por `laneFor(...)`, mesmo fallback já
     usado pro commit atual.
  4. **Causa real de "não aparece nada" (achada depois, com screenshot do usuário confirmando que
     as 3 correções acima não bastaram)**: nenhuma das 3 acima era o problema de exibição — o
     template padrão da lib (`metro`) nunca define `commit.color`, e o fallback interno da própria
     lib pra isso é `undefined`; um SVG sem `fill` explícito renderiza **preto** por padrão. Em
     cima do nosso fundo `#0e0e14`, texto da mensagem e pontos de commit ficavam pretos-no-preto —
     não travava, só não aparecia. `branch.label.bgColor` também vinha `"white"` (outro default da
     lib), que ia aparecer como uma caixa branca chapada se algum ref/branch label fosse exibido.
     Corrigido com um `template` explícito via `templateExtend(TemplateName.Metro, {...})`
     (`GitGraphPane.tsx`, `DARK_TEMPLATE`) passado em `options={{ template: DARK_TEMPLATE }}` pro
     `<Gitgraph>` — `commit.color` vira `#e2e2ec` (mesmo tom de texto do resto do app), que
     alimenta o fallback de `dot.color`/`message.color`/`branch.label.color` ao mesmo tempo (ver
     `@gitgraph/core`'s `template.js`), e `branch.label.bgColor` vira um tom escuro do tema.
  5. **Causa estrutural do "buga" ao trocar de aba**: não existia nenhum error boundary em volta do
     conteúdo das panes (só o `EffectBoundary` do fundo animado) — qualquer exceção derrubava o
     app inteiro. Novo `PaneErrorBoundary` (`PaneView.tsx`, mesmo padrão do `EffectBoundary`)
     envolve o switch de conteúdo da aba, `key={tab.id}` reseta o erro ao trocar de aba, com botão
     "Tentar de novo" em vez de tela branca/app morto.
- [x] **Arrastar panes + layouts prontos**: reaproveita 100% a infra de drag de tabs já existente.
  - `tabDrag.ts`: novo `PANE_DRAG_TYPE`/`PaneDragData`/`readDraggedPane()` — MIME próprio, sem
    fallback pra `text/plain` (esse é o que a tab usa), então os dois gestos nunca colidem.
  - `PaneView.tsx`: `<header>` da pane ganhou `draggable`+`onDragStart` — tabs individuais dentro
    dele continuam vencendo o drag quando o gesto começa nelas (comportamento nativo de HTML5 DnD
    com draggables aninhados).
  - `TabDropOverlay.tsx`: as 5 zonas de drop agora checam `readDraggedPane()` antes de
    `readDraggedTab()` — pane nas bordas dispara `MOVE_PANE` (novo, mesmo molde de
    `SPLIT_WITH_TAB` mas arrancando a pane inteira via `removePane` em vez de uma tab via
    `takeTab`), pane no centro dispara `SWAP_PANE` (novo — troca só as `tabs`/`activeTabId` das
    duas panes, mantém id/posição de cada uma na árvore, mais simples que reestruturar splits).
  - Layouts prontos: `buildPresetLayout` + `collectPanes` (`workspaceReducer.ts`) montam a árvore
    de splits de 4 presets (`columns-2`, `rows-2`, `grid-2x2`, `main-plus-side`) a partir das panes
    já abertas (reaproveita as existentes com suas tabs, completa com `newPane` se faltar, empilha
    tabs extras no último slot se sobrar pane). Novo botão "▦ Layouts" na barra superior
    (`WorkspaceView.tsx`) abre `LayoutPresetPicker.tsx` (flyout, mesmo padrão de portal/clique-fora
    do `WorkspaceSwitcher`/`NotificationBell`), dispara `APPLY_LAYOUT_PRESET`.
  - Testes novos em `workspaceReducer.test.ts`: `MOVE_PANE`, `SWAP_PANE`, `APPLY_LAYOUT_PRESET`
    (grid-2x2 e columns-2).
- [x] **Sidebar mais bonita**: 7 ícones pixel-art novos em `PixelIcon.tsx` (mesmo padrão
  `makeIcon(path)` dos 7 já vendorizados de pixelarticons, desenhados aqui em blocos de 2px —
  `EditIcon`, `TerminalIcon`, `ChatIcon`, `ListIcon`, `BoxIcon`, `BookIcon`, `GitBranchIcon`) — um
  por seção da Sidebar (`AGENTS`/`TERMINALS`/`COMMANDS`/`DOCKER`/`SKILLS`/`GIT`, `FILES` reaproveita
  o `FolderPlusIcon` já existente) + linha de projeto (trocou o `▸` fixo pelo ícone de pasta).
  **Escopo cortado**: `sessionGlyph()` (glifos de estado de sessão de terminal — `▸ ⏵ ✖ ⚠ ● ○`)
  ficou como estava — 6 ícones novos só pra isso não valia o custo/risco nesta rodada.
  Fundo atrás do menu: `.glass-strong` (`index.css`, usado só no `<aside>` da Sidebar) tinha
  opacidade própria fixa (`0.82`, era `var(--glass-a)` = 0.96/0.98) em vez de tocar na variável
  compartilhada com popover/glass-hover — deixa o efeito de fundo escolhido (`AppBackground.tsx`,
  WebGL via `ogl`) aparecer fraco atrás, sem vazar pra outros usos de `.glass`.
- [x] **Renomear workspace com botão visível**: `WorkspaceSwitcher.tsx` ganhou um botão de lápis
  (`EditIcon`, sempre visível a 60% de opacidade, mesmo padrão do "×" de fechar que já existia na
  mesma linha) além do duplo-clique escondido da sessão anterior — agora tem uma pista visual de
  que dá pra renomear.
- [ ] **Nada disso foi validado num `tauri dev` real** — só `npm run typecheck` (limpo),
  `npm run test` (85/85), `cargo check` (limpo). Falta o roteiro manual completo: arrastar
  cabeçalho de pane pra cada zona (borda × centro), aplicar os 4 presets com 1/2/3+ panes abertas,
  abrir "Ver grafo" num repo com merge real e trocar de aba várias vezes, e olhar visualmente a
  Sidebar/fundo nos dois temas.

## Trust-skip não pegava (path separator) + Git sem repo mostrava erro (2026-09-09)

Dois bugs reportados depois de usar as features das rodadas anteriores:

- [x] **`ensure_agent_trust` gravava a chave errada**: `cwd` chega em `engine_client.rs` com `\`
  (path nativo do Windows), mas o Claude Code CLI grava/lê a chave de projeto em `~/.claude.json`
  com `/` mesmo no Windows — confirmado lendo o `~/.claude.json` real desta máquina (chave
  `"D:/PROGRAMACAO/.../OMNI-AGENTS"` pro próprio OMNI-AGENTS, que obviamente já é confiado). A
  gravação criava uma entrada com `\` que o CLI nunca lia de volta — trust dialog continuava
  aparecendo sempre. Corrigido: `trust_claude` normaliza `cwd.replace('\\', "/")` (e tira barra
  final) antes de usar como chave.
- [x] **Painel Git mostrava erro vermelho quando o projeto não tinha repositório**: `git_status`
  chamava `git rev-parse --abbrev-ref HEAD` direto, que falha com "fatal: not a git repository"
  fora de um repo — isso virava uma `Err` genérica exibida como alerta vermelho no `GitPanel`, pra
  todo projeto sem `.git` (a maioria). Corrigido na raiz: `git_status` agora retorna
  `Result<Option<GitStatus>, String>` — checa `git rev-parse --is-inside-work-tree` primeiro (não
  por texto de stderr, que é frágil/varia por idioma) e devolve `Ok(None)` (não é erro) quando o
  projeto simplesmente não tem repo; só propaga `Err` de verdade se o `git` não estiver instalado
  (`git_available()`, checado antes). `GitPanel.tsx` ganhou um terceiro estado (`status:
  GitStatus | null | undefined` — carregando/sem-repo/carregado) e mostra "Nenhum repositório Git
  neste projeto." em texto neutro em vez do alerta vermelho.

## Ctrl+V no terminal + preview de Markdown "modo documento" (2026-09-09)

- [x] **Ctrl+V colava só como Ctrl+Shift+V**: xterm.js segue a convenção clássica Unix — Ctrl+V é
  "inserir literal" (byte `^V` pro shell), só Shift+Insert/Ctrl+Shift+V disparam paste de verdade.
  Esse app é Windows-first (usuário espera Ctrl+V como em qualquer app Windows). Corrigido em
  `TerminalPane.tsx`: `terminal.attachCustomKeyEventHandler` intercepta Ctrl+V (sem Shift/Alt/Meta),
  lê `navigator.clipboard.readText()` e escreve na sessão via `writeTerminal`, devolvendo `false`
  pra impedir o xterm de mandar o `^V` cru. Atalhos antigos continuam funcionando (não mexi neles).
  **Só cobre texto** — colar imagem continua exigindo o caminho nativo (`paste` DOM event, já
  existente) porque `readText()` não vê clipboard de imagem; não expandido pra isso agora.
- [x] **Preview de Markdown mais bonito + modo "documento" (estilo PDF)**: `@tailwindcss/typography`
  instalado e registrado em `tailwind.config.ts` — o CSS já tinha um bloco `.prose.prose-invert`
  em `index.css` preparado pra isso (mapeando as variáveis do plugin pro tema do app) que nunca
  tinha sido usado porque o plugin não estava instalado. `MarkdownPane.tsx` reescrito com dois
  modos, botão de alternância no topo da aba:
  - **App** (padrão): `prose prose-invert max-w-none` — mesmo fundo escuro do resto do app, mas
    com tipografia de verdade (headings, código, tabelas, citações) em vez das poucas classes
    manuais de antes.
  - **Documento**: página branca centralizada (`prose prose-neutral`, `max-w-[820px]`, sombra,
    padding generoso) sobre um fundo cinza neutro — mesma ideia visual do preview em PDF do
    Markdown Preview Enhanced (VSCode), só CSS, sem nova lib de renderização.
  **Não incluído** (fora do pedido, escopo cortado): syntax highlighting de blocos de código, TOC,
  math (KaTeX) e mermaid — tudo isso exigiria libs novas; o `prose` já estiliza `<pre>`/`<code>`
  de forma decente mesmo sem highlight de sintaxe.

## Botão do preview de Markdown mais visível + editar texto no modo App (2026-09-09)

- [x] **Botão mais visível/descrito**: trocou de link de texto 10px pra `<Button size="sm"
  variant="glass">` (mesmo componente usado no resto do app), com texto orientado a ação ("▤ Ver
  como documento (estilo PDF)" / "◧ Voltar ao app") em vez de só o nome do modo, e `title` mais
  longo explicando o que o clique faz.
- [x] **Editar o texto no modo App**: botão "✎ Editar texto" ao lado — em vez de duplicar
  editor/autosave/Ctrl+S do zero, `MarkdownPane.tsx` reaproveita o `FilePane`/Monaco inteiro
  (mesmo autosave/manual, mesmo indicador "•" de não-salvo na tab, `fileSaveMode`/`onDirtyChange`
  agora passados de `PaneView.tsx` pra `MarkdownPane` igual já eram pra `FilePane`). Sair do modo
  edição (`stopEditing`) recarrega o conteúdo na hora em vez de esperar o próximo tick do poll de
  1s. Modo "Documento" não ganhou edição de propósito — é a visão tipo prévia de impressão/PDF,
  não faz sentido editável ali (fica escondido o botão de editar quando esse modo está ativo).

## Kanban de tasks automatizadas, portado do Maestrus (2026-09-09)

Pedido citando o "kanban de resolução de problemas" do Maestrus — investigado o código real deles
(`renderer/src/components/Kanban.tsx`, `TaskModal.tsx`, `electron/task-queue.js`,
`electron/task-store.js`): não é board de bugs, é **fila de tasks automatizada pra agente de IA**
(colunas backlog→ready→doing→done/failed, dispatcher em background manda pro CLI sem confirmar,
loop de repetição, circuit-breaker de 3 falhas/5min → pausa 30min). Decisões confirmadas com o
usuário: disparo automático de verdade (capacidade **adicional**, desligada por padrão, não
substitui abrir agente manualmente), sessão **compartilhada por projeto** (fila mantém contexto
entre tasks, não abre sessão nova cada vez), escopo completo (board + loop + circuit-breaker) de
uma vez.

- [x] **Zero mudança em Rust/engine** — tudo em cima do que já existe: `SessionState` já expõe
  `answered` (heurística de idle 1.5s, recalculada a cada poll,
  `crates/omni-engine/src/main.rs:50-58`) e `crashed` (exit code real) via `listTerminalSessions()`
  já rodando no root do app (`useTerminalSessions.ts`, `App.tsx`). O dispatcher só observa
  `sessions[].state` e chama `spawnTerminal`/`writeTerminal`/`terminalSnapshot` — mesmas funções
  que `TerminalPane.tsx` e o Ctrl+V já usam.
- [x] **Modelo de dados** (`src/types/kanban.ts`) + **reducer** (`src/features/kanban/kanbanReducer.ts`,
  9 testes em `kanbanReducer.test.ts`) + **persistência** (`src/services/kanbanService.ts`, chave
  `omni-agents-kanban`, versionada, task individualmente inválida descartada sozinha) + hook
  (`useKanban.ts`) — mesma tríade reducer+service+hook de `workspaceReducer`/`workspaceService`/
  `useWorkspace`.
- [x] **Dispatcher** (`useKanbanDispatcher.ts`, chamado uma vez em `App.tsx`, mesmo cadenciamento
  de 1s dos pollers existentes): por projeto, task em "doing" cujo sessão virou `answered` fecha
  `done` (pega o texto final via `terminalSnapshot`); vira `crashed`/`stopped`/`orphan` fecha
  `failed` + `RECORD_FAILURE` (circuit-breaker). Sem task "doing", pega a próxima "ready" por
  posição, garante sessão viva pro projeto (reusa mapa em memória — **não persistido**, se a sessão
  sumir ou o app reiniciar o próximo tick respawna sozinho — `ensureAgentTrust` chamado antes de
  cada spawn, senão o diálogo de trust travaria o dispatcher rodando sem ninguém olhar), digita
  `título\n\ndescrição\r`. Loop decrementa só em sucesso (`TASK_FINISHED` no reducer) — falha nunca
  reprocessa o loop, fecha `failed` direto. `working`/`approval_required` não mexe — pedido de
  permissão do próprio CLI fica pro usuário resolver manualmente na aba (dispatcher não aprova
  nada).
  **Limitação conhecida, documentada, não é bug**: `answered` é a mesma heurística de idle já usada
  pro Attention Center — se o agente perguntar algo no meio da task, o dispatcher pode achar que
  terminou (indistinguível de "respondeu e esperou" só pelo estado da sessão).
- [x] **UI**: `KanbanBoard.tsx` abre como aba nova (`PaneKind` `"kanban"`, mesmo padrão de
  `git-graph` — `PaneView.tsx`, `CREATE_TAB`) — 5 colunas, card arrastável entre colunas (
  `kanbanDrag.ts`, mesmo MIME-type hand-rolled de `tabDrag.ts`/`PANE_DRAG_TYPE` — sem lib de drag
  nova, não existe nenhuma instalada), formulário inline de criar/editar (sem modal), toggle do
  dispatcher (off por padrão), seletor de agente por projeto, aviso com contagem regressiva quando
  o circuit-breaker pausou. `KanbanPanel.tsx` (mesmo tamanho/formato de `GitPanel.tsx`) vai na nova
  seção `"KANBAN"` da Sidebar — só contagem por coluna + botão "Abrir board", o board de verdade é
  a aba. Ícone novo `KanbanIcon` em `PixelIcon.tsx` (3 barras verticais, mesmo método de blocos de
  2px dos ícones já adicionados nesta sessão).
- [x] **Bug lateral corrigido de graça**: `PANE_KINDS` em `workspaceService.ts` (valida tabs
  persistidas) nunca tinha ganhado `"git-graph"` quando esse `PaneKind` foi criado numa sessão
  anterior — uma aba de Git Graph salva seria rejeitada como inválida ao recarregar o app,
  derrubando a persistência da pane inteira. Corrigido junto com a adição de `"kanban"`.
- [ ] **Nada disso rodou num `tauri dev` real** — só `npm run typecheck`, `npm run test` (94/94,
  9 novos), `vite build`. Falta o roteiro manual: criar task, ligar dispatcher, ver ir sozinha pra
  doing→done/failed com resposta real de agente; testar loop de verdade; forçar 3 falhas seguidas e
  confirmar a pausa de 30min na UI; confirmar que a sessão do dispatcher aparece normal na lista
  TERMINALS da Sidebar.

## Abrir local do arquivo + copiar caminho, Ctrl+C copia seleção no terminal (2026-09-09)

Pedido antes de fechar a primeira release pública.

- [x] **"Abrir local do arquivo" e "Copiar caminho" no menu de contexto do FileTree**
  (`FileTree.tsx`) — `revealItemInDir` (`@tauri-apps/plugin-opener`, permissão
  `opener:allow-reveal-item-in-dir` já existia em `capabilities/default.json`, nunca tinha sido
  usada) abre o Explorer com o item selecionado; "Copiar caminho" usa
  `navigator.clipboard.writeText` direto (Clipboard API do browser, não precisa de plugin Tauri).
  Mock de `revealItemInDir` adicionado em `src/test/setup.ts` (só tinha `openPath`).
- [x] **Ctrl+C copia quando há seleção no terminal** (`TerminalPane.tsx`) — mesmo
  `attachCustomKeyEventHandler` já usado pro Ctrl+V: se `terminal.hasSelection()`, copia via
  `terminal.getSelection()` e não deixa o xterm mandar `^C` (SIGINT) pro processo; sem seleção,
  comportamento de sempre (interrupt) intacto. Mesmo padrão de todo terminal moderno (Windows
  Terminal, VSCode). Métodos `attachCustomKeyEventHandler`/`hasSelection`/`getSelection`
  adicionados ao mock de `@xterm/xterm` em `setup.ts` (faltavam desde o Ctrl+V, só não quebrava
  porque nenhum teste hoje monta um `TerminalPane` de verdade).

## Shift+Enter não quebrava linha no terminal (2026-09-09)

Causa achada lendo o `@xterm/xterm` real (não minificado só de nome — `case 13` no bundle):
`o.key = e.altKey ? ESC+CR : CR` — o handler de teclado da lib só olha `altKey` pro Enter. `shiftKey`
é **completamente ignorado**: Shift+Enter e Enter puro geravam exatamente o mesmo `\r`, então a CLI
(Claude Code etc.) nunca via sinal nenhum de "quebra de linha sem enviar" — só via um Enter normal e
mandava a mensagem.

**Primeira tentativa (não funcionou, usuário confirmou)**: mandar `ESC+CR` manualmente — a mesma
sequência que Alt+Enter já produz por padrão na lib. Errado: isso é só o que Alt+Enter manda,
nenhuma CLI olha pra esse byte como "nova linha" especificamente.

**Correção**: pesquisado como o Claude Code CLI real reconhece Shift+Enter (terminais como
Kitty/iTerm2/WezTerm/Windows Terminal já mandam isso nativo; VS Code precisa de
`enableKittyKeyboardProtocol`) — é o protocolo **CSI-u/"fixterms"**: `ESC[13;2u`
(`13` = code do Enter, `2` = modificador Shift, formato `CSI keycode;modifiers u`). Trocado em
`TerminalPane.tsx`. **Fallback garantido, sem nenhuma mudança de código** (funciona em qualquer
terminal, é código de controle ASCII puro, não precisa de protocolo nenhum): **Ctrl+J** insere
quebra de linha sem confirmar — se o CSI-u não pegar pra alguma CLI específica, esse sempre funciona.

## v0.2.0 — primeiro release público (2026-09-09)

Publicado: https://github.com/FelipeCamposM/OMNI-AGENTS/releases/tag/v0.2.0

- [x] Todo o trabalho acumulado (nunca commitado até aqui — Fases 0-3 completas + tudo desta
  sessão) commitado e pushado em 2 commits (`e4cb4db` código, `177d980`+`b3a6e01` fixes de
  release).
- [x] **Chave de assinatura corrigida antes de publicar**: a pubkey em `tauri.conf.json` não
  batia com nenhuma chave privada existente na máquina (só havia `camps-utils.key`, de outro par
  — key ID diferente, confirmado por hash). Build teria assinado com uma chave e o app embutido a
  pubkey de outra, quebrando o updater **pra sempre** (toda assinatura futura falharia contra o
  binário publicado). Como nenhum release do OMNI AGENTS tinha saído ainda, gerado um par novo
  dedicado (`~/.tauri/omni-agents.key`, decisão do usuário: não reaproveitar a chave do
  CAMPS-UTILS) — sem risco de órfão porque não existe usuário instalado ainda.
  **Senha da chave nova**: mostrada uma única vez pro usuário no chat desta sessão — não gravada
  aqui de propósito (repo público). Sem ela e sem o arquivo `.key`, ninguém que instalar o v0.2.0
  recebe atualização de novo — guardar num cofre. Pra persistir no ambiente (PowerShell, precisa
  de terminal novo depois):
  ```powershell
  [Environment]::SetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY", (Get-Content "$env:USERPROFILE\.tauri\omni-agents.key" -Raw), "User")
  [Environment]::SetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "<senha, ver histórico da sessão ou o cofre onde foi salva>", "User")
  ```
- [x] **`collect-installers.mjs` apontava pro caminho errado** — `src-tauri/target/release/bundle`
  não existe mais desde que `src-tauri` virou membro de um Cargo workspace (`crates/omni-engine`,
  `omni-protocol`); o `target/` compartilhado do workspace fica na raiz do repo. Corrigido.
- [x] **`make-latest-json.mjs` apontava pro repo antigo** (`FelipeCamposM/CAMPS-UTILS`, hardcoded)
  — o endpoint que o app consulta (`tauri.conf.json`) já estava certo, só a URL do instalador
  *dentro* do `latest.json` ia pro repo errado. Corrigido pra `FelipeCamposM/OMNI-AGENTS`.
- [x] **Espaço no nome do asset** (`productName: "OMNI AGENTS"`) — o GitHub troca espaço por ponto
  no nome de todo asset de Release, sempre, sem aviso; o `latest.json` gerava a URL com `%20`
  (espaço codificado), que nunca bate com o nome real do asset (`OMNI.AGENTS_...`, ponto literal)
  → 404 em silêncio no download da atualização. `collect-installers.mjs` agora já copia pra
  `installers/` trocando espaço por ponto, e `make-latest-json.mjs` usa o mesmo nome — local e
  remoto batem exatamente, sem surpresa do GitHub no meio.
  **Verificado ponta a ponta**: `curl` no endpoint real de `releases/latest/download/latest.json`
  devolve a URL certa, e o instalador responde HTTP 200.

## 2026-09-10 — Detecção silenciosa, múltiplas contas e conversa contínua

### Fase A — bug da detecção de agentes (causa raiz)

- [x] **Piscar de janelas: `where.exe` por candidato.** `command_exists()` em
  `src-tauri/src/engine_client.rs` rodava `where.exe <cmd>` como processo filho. O binário do
  Tauri é subsistema `windows` (sem console), então **cada** `where.exe` alocava um console novo —
  `Stdio::null()` redireciona os streams mas não impede a alocação. Pior: `agent_cli_statuses()`
  chamava `command_exists` **duas vezes por provider** (uma dentro do `find`, outra para preencher
  `available`), ~9 janelas por consulta, e a consulta roda no mount de `AgentConnections`,
  `AgentLauncher` e `KanbanBoard` mais uma vez por task do Kanban.
  Corrigido com `resolve_on_path()`: resolução de PATH × PATHEXT em Rust puro, **zero processos**.
  Resolve uma vez só e devolve o caminho absoluto no payload, para que uma falha futura apareça na
  UI em vez de virar um `available: false` mudo. Usa `dir.join(format!("{name}{suffix}"))` e não
  `with_extension`, que truncaria no primeiro ponto do nome.
- [x] **Mesma causa em todo comando git.** `git_client.rs` disparava `git` sem `CREATE_NO_WINDOW`
  em `git_available()` **e** em `run_git()` — ou seja, toda operação de git piscava também. Helper
  `hidden()` aplicado nos dois. `connect_agent_cli` segue com janela visível de propósito: ali o
  console *é* a UX de login.
- [x] **"Nenhum aparece conectado": não existia estado de logado.** `available` significava só
  "o nome resolve no PATH", e o melhor rótulo que a UI sabia mostrar era o botão "Conectar" — nunca
  "conectado", por construção. Agora `AgentCliStatus` tem `authenticated`, e a UI separa três
  estados: verde/conectado, âmbar/instalado sem login, cinza/não instalado.
- [x] **`.catch(() => undefined)` em `AgentLauncher.tsx` engolia a falha do invoke**, deixando os
  quatro providers em `available: false` sem nenhum sinal — a outra metade do sintoma. Agora vira
  alerta visível.
- **Verificado**: o algoritmo PATH × PATHEXT foi rodado contra o PATH real desta máquina e resolve
  `claude` (`.exe`), `codex`, `gemini` (scripts npm sem extensão) e `cursor-agent`/`agent`
  (`.cmd`), e devolve nada para um nome inexistente. Testes: `resolve_on_path` e
  `every_declared_cli_has_a_config_dir` (Rust), `AgentConnections.test.tsx` (5 casos).

### Fase B — múltiplas contas por provider (spec §6.6, §9.3, §9.4)

- [x] **Bloqueio removido: o engine não passava env para a PTY.** Passava só `OMNI_AGENTS=1`, e o
  CLI não é argv — é digitado no shell 800 ms depois. Sem env, não há isolamento. `SpawnTerminal` e
  `TerminalSession` ganharam `env`, mais `provider`/`profile_id`/`conversation_id`/
  `external_session_id`, todos com `#[serde(default)]` para o `sessions.json` já gravado continuar
  carregando. `SessionOrigin` agrupa esses campos; `restart` e `duplicate` replicam o env, senão a
  troca de conta se desfazia sozinha no primeiro restart.
- [x] `src-tauri/src/profiles.rs`: registro em `profiles.json` (engine dir), config dirs em
  `%APPDATA%\OMNI-AGENTS\profiles\<provider>\<id>\`. Guarda id, provider, nome, config dir e datas
  — **nunca** credencial (§9.4). Um profile `builtin` por provider aponta para o diretório nativo,
  nasce sozinho e não pode ser removido: é o que preserva os logins que já existiam.
- [x] Mapa de isolamento: `claude` → `CLAUDE_CONFIG_DIR`, `codex` → `CODEX_HOME`. Gemini e Cursor
  não leem env var de config dir, então só têm o perfil padrão — `create_profile` recusa com
  mensagem explícita em vez de criar um perfil que nunca funcionaria.
- [x] `trust_claude` passou a gravar em `<config_dir>/.claude.json`, não mais em `~/.claude.json`
  fixo — sem isso todo profile novo esbarraria no diálogo de trust.
- [x] UI: Configurações → Agentes lista as contas por provider com "+ Conta", "Entrar"/
  "Reautenticar" por conta e "Remover" (que apaga também o config dir, onde mora a credencial).
  `AgentLauncher` ganhou seletor de conta, preferindo automaticamente uma já autenticada.
- **Verificado na mão**: `CLAUDE_CONFIG_DIR` apontado para um diretório vazio faz
  `claude auth status` reportar `loggedIn: false` com o `~/.claude` intacto, e o `.claude.json`
  nasce **dentro** do config dir. O mesmo comando reporta `projectsDirectory` como
  `<config_dir>/projects`, o que confirmou o layout usado na Fase C.

### Fase C — conversa que sobrevive à troca de conta e de IA

- [x] **Decisão: índice de ponteiros, não transcript.** Claude e Codex já gravam a conversa inteira
  em disco (um `.jsonl` deste projeto passa de 5 MB). `conversations.json` guarda só quais
  conversas existem e, por conversa, a lista de trechos: provider, profile, id da sessão nativa,
  caminho do arquivo e datas. Dezenas de linhas, escritas na criação e na troca.
  **Não existe tabela de mensagens, e por consequência não existe tailer** — sem mensagens para
  guardar, não há motivo para seguir arquivo nenhum.
- [x] `claude --session-id <uuid>` no spawn: escolher o id na largada torna o caminho do transcript
  conhecido desde já, sem vigiar diretório atrás do arquivo recém-nascido. `uuid` já vinha na
  árvore via Tauri, então virou dep direta sem baixar nada novo.
- [x] **Claude → Claude é continuação de verdade**: copia o `.jsonl` para
  `<config-dir-destino>/projects/<slug>/<uuid>.jsonl`, pré-aprova o trust lá, e retoma com
  `claude --resume <uuid>`. Mesmo id nos dois trechos, de propósito — o que muda é a conta.
- [x] **Cross-provider é handoff, não continuação.** Dois caminhos: o gracioso (`handoff_prompt`
  pede ao agente que ainda responde para escrever `.omni/handoff/<id>.md`) e o forçado (parseia o
  `.jsonl`, mantém só texto de `user`/`assistant`, descarta `tool_use`/`tool_result` e sidechains,
  e corta pela cauda em 12k caracteres). O cabeçalho do arquivo diz que é um resumo automático, não
  um briefing escrito pelo agente — o parser não sabe inventar "próximo passo".
  O agente novo recebe só o **caminho**: `codex "Leia .omni/handoff/<id>.md — ..."`. O transcript
  nunca vai por argumento (limite de 32k da linha de comando do Windows).
- [x] Parser cobre **só o formato do Claude** nesta passada, por combinação. Trecho de Codex nasce
  sem `transcript_path` (o CLI não deixa escolher o id da sessão); sair de um Codex mudo cai no
  caminho gracioso.
- [x] UI: botão "trocar conta / IA" na barra do `TerminalPane` abre o `AgentSwitcher`, que separa
  visualmente as duas operações e avisa, antes de trocar de IA, que cache de prompt, estado interno
  e aprovações não transferem.
- [x] `.omni/handoff/` no `.gitignore` — o markdown carrega conteúdo de conversa.

### Estado da verificação

`npm run typecheck` limpo, `npm run test` 99/99, `cargo test --workspace` 11/11 (8 em `src-tauri`,
3 no engine). `cargo check --workspace` limpo.

**Pendente de validação visual em `tauri dev`** — a porta 1420 estava ocupada por um dev server já
em execução na hora de conferir. O que precisa ser olhado com o app aberto:

1. Configurações → Agentes: nenhuma janela de console deve piscar, nem no mount nem clicando
   "Verificar novamente" várias vezes seguidas. Os CLIs instalados devem aparecer com caminho
   absoluto e os logados em verde. **Repetir num build instalado** (`npm run build`) — o subsistema
   `windows` é o que diferencia o comportamento, e dev pode mascarar (ver o gotcha do CSP em
   `CLAUDE.md`, mesma família de armadilha).
2. Criar uma conta Claude "trabalho", logar, e conferir que
   `%APPDATA%\OMNI-AGENTS\profiles\claude\trabalho\.credentials.json` nasceu e que `~/.claude`
   não mudou. `/status` dentro de cada agente deve mostrar contas distintas.
3. Abrir Claude, trocar duas ou três mensagens, usar "trocar conta / IA" para outra conta Claude:
   o histórico tem que aparecer no agente novo, e `conversations.json` tem que ter **uma** conversa
   com **dois** trechos. Depois passar o bastão para o Codex e conferir o
   `.omni/handoff/<id>.md`.

## 2026-09-10 — Uso por conta, pane vazia e acesso mobile

- [x] **Uso Codex:** `crates/omni-core/src/usage.rs` lê pela cauda o último evento de uso do
  rollout mais recente do perfil, valida percentuais/janelas/reset e informa observação
  desatualizada. Cache de 60 s no comando Tauri `account_usage`. `AccountUsage.tsx` integrado às
  contas em Configurações → Agentes; ausência de dado nunca vira zero.
- [x] **Última aba:** `workspaceReducer` preserva pane com `tabs: []` e `activeTabId: null`.
  `workspaceService` aceita o estado salvo, `PaneView` desmonta o terminal e mostra **Novo agente**.
  Ajustados fechamento por prefixo, testes de regressão e seleção ao redistribuir tabs em presets.
- [x] **Claude:** `interaction.rs` reconstrói tela ANSI com `vt100`, reconhece gramática estrita
  de `/usage`, reserva entrada e consulta só em sessão existente elegível. Cache de 5 min para
  resultado/15 s para falha, timeout de 10 s; também lê `/usage` aberto manualmente. Sem leitura
  de credencial ou acesso direto à API. Reset ambíguo permanece literal; UI informa melhor esforço.
- [x] **HTTP mobile no engine:** Axum, assets React/Vite embutidos, cinco rotas de conversas/
  timeline/prompt/aprovação/atenção. Configurações → Celular persiste ativação e bind. Desativado
  inicialmente; aceita localhost ou IP confirmado pelo cliente Tailscale. TCP fica em loopback.
- [x] **Fila e concorrência:** ações com idempotência, revisão de tela/entrada/instância, expiração
  e revalidação antes da PTY. Nenhum spawn pelo HTTP; escolhas de aprovação de uso único.
  Persistência de sessões serializada; leitores de perfis/conversas compartilhados sem Tauri.
  Histórico Codex só associa um candidato compatível; ambiguidade vira indisponível.
- [x] **UI mobile:** conversas, atenção, timeline paginada, resposta e permitir/negar. Poll de 5 s
  com recuo e suspensão quando oculta. Retry de rede conserva chave da ação. Sem xterm/PWA/push.
- [x] **Validação automatizada:** testes de parser/isolamento/paginação/deduplicação, pane vazia
  persistida e desmontagem, HTTP concorrente/origem inválida/ausência de spawn, reenvio, expiração,
  contexto vencido e escrita única de prompt/aprovação. Navegador headless verificado em 320,
  390 e 768 px, sem overflow e com alvos de toque de 44 px (`scripts/check-mobile-browser.mjs`).
- [ ] **Validação no ambiente real:** capturas de `/usage` e menus Claude/Codex em sessões
  existentes; celular em 4G com Tailscale e janela desktop fechada. Fixtures de parser são
  sintéticos: formatos não reconhecidos continuam bloqueados/indisponíveis, sem tentar adivinhar.
- [x] **`/usage` Claude não achava sessão (2026-09-15):** sessões vivas no engine instalado tinham
  `provider`/`profile_id`/`conversation_id` nulos — criadas por um engine antigo que sobreviveu à
  atualização (o `PROTOCOL_VERSION` nunca subiu, o app aceitou) e o restart preserva a origem vazia.
  `load_historical_sessions` (`crates/omni-engine/src/main.rs`) agora preenche a origem pelo
  `terminal_session_id` do `conversations.json`. `interaction::account_usage` passou a mandar
  `/usage` e o Enter em writes separados (rajada única o Claude trata como colagem). Conferido
  contra snapshot real: `ready()` e `provider_running` reconhecem a sessão ociosa. **Pendente:**
  app não reinicia engine de versão antiga; ver tela real do `/usage` depois de reinstalar.
  Motivo "Claude está respondendo" separado de "entrada não reconhecida" quando a única sessão
  elegível mostra `esc to interrupt`.
- [x] **Uso Claude fixo no rodapé (2026-09-15):** `src/features/terminal/ClaudeUsageStatus.tsx` ao
  lado de `ENGINE:` em `WorkspaceView.tsx`. Conta Claude usada por último; ao abrir só lê o cache do
  engine (`refresh: false`), `/usage` é digitado apenas no botão de ícone (`ReloadIcon`). Mostra 5H e
  semana com reset curto (sem fuso; completo no tooltip) e "consultado há X" (atualiza a cada 30 s).
  Teste `src/test/ClaudeUsageStatus.test.tsx`. Não conferido visualmente no app.
  Responsivo: rodapé sem quebra de linha (`whitespace-nowrap`/`overflow-hidden`); abaixo de `xl` some
  o reset, abaixo de `lg` o "consultado há", abaixo de `md` "CLAUDE" e "UI CONNECTED". Tudo segue no
  tooltip. Percentuais, ↻ e ENGINE ficam sempre.

Operação, contrato HTTP, limites e comandos de build/teste em `docs/mobile-and-account-usage.md`.

## v0.3.1 — release beta com notas de versão (2026-09-10)

- [x] **Notas de versão dentro do app**: `src/lib/changelog.ts` guarda as entradas (mais nova no
  topo, em linguagem de usuário) e `SobreSection` de `SettingsView.tsx` renderiza o card
  "Novidades". A entrada 0.3.1 tem `beta`, que desenha o selo e o aviso em `text-warning`.
- [x] **Aviso de beta onde importa**: além da nota de versão, um `role="note"` no topo de
  `src/features/mobile/MobileSettings.tsx` diz que a conexão com o celular não funciona nesta
  versão. Quem entra direto na seção Celular nunca leria a nota em Sobre.
- [x] **Release publicado como latest**: `v0.3.1`, com `-setup.exe`, `.sig` e `latest.json`.
  Endpoint do updater verificado respondendo 0.3.1, e a URL do instalador retorna 200.
- [x] **Marcado como release normal, não pre-release** — de propósito, mesmo sendo beta. Marcar
  pre-release tiraria ele de `releases/latest/download/latest.json` e o updater pararia calado.
  O aviso de beta vive no texto do release e na UI, não na flag do GitHub.

### A senha de assinatura quase se perdeu — leia antes do próximo release

`npm run build` falhou em *"failed to decode secret key: incorrect updater private key password"*.
As duas variáveis no escopo User estavam erradas **desde que foram gravadas**:

| Variável | Continha | Devia conter |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | a chave do **CAMPS-UTILS** | `~/.tauri/omni-agents.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | o texto-modelo `<senha da omni-agents>` | a senha real |

O snippet do próprio roadmap (linha ~591) foi colado sem substituir o placeholder. O 0.2.0 tinha
sido assinado com as credenciais passadas à mão na sessão de 09/09, que nunca chegaram ao ambiente.

A chave certa foi confirmada comparando o key id do `.sig` do 0.2.0 (`tVwu/Frvupa`) com
`omni-agents.key.pub` e com a `pubkey` do `tauri.conf.json` — as três batem. A senha foi
recuperada do transcript da sessão de 09/09, onde ficou o resultado do comando que a exibiu antes
de apagar o arquivo temporário.

**Duas lições:**

1. Guarde a senha num cofre de verdade. Ela só sobreviveu porque um transcript de sessão não foi
   apagado — isso não é armazenamento. Perder chave **e** senha significa que ninguém já
   instalado recebe atualização de novo: a pubkey está gravada no binário deles.
2. **`npx tauri signer --help` imprime o valor das variáveis de ambiente.** Rodar isso num
   contexto compartilhado despeja a chave privada na tela. Foi como a chave do CAMPS-UTILS vazou
   para o transcript desta sessão — ela está criptografada e a senha não vazou junto, mas
   **rotacione a chave do CAMPS-UTILS** quando for mexer naquele projeto.

`.env.example` na raiz documenta as duas variáveis; `.env` já é ignorado pelo git e o Vite não
expõe variável sem prefixo `VITE_` ao bundle, então a cópia local não vaza para produção.

### Pendente

- [ ] **Conexão com o celular**: o motivo de a 0.3.1 sair como beta. Enquanto não funcionar, o
  aviso em `MobileSettings.tsx` e o `beta` da entrada no changelog têm de continuar lá.

## "+" da barra de tabs escolhe agente ou terminal (2026-09-11)

- [x] O "+" de `WorkspaceTabBar.tsx` criava sempre uma aba de agente. Agora abre um menu
  (`NewTabMenu`, mesmo padrão de portal medido do `WorkspaceSwitcher` — a tablist é
  `overflow-x-auto` e recortaria um popover absoluto) com duas opções:
  **Novo agente** (seletor de CLI) e **Novo terminal** (shell do sistema, sem agente).
  As opções vivem em `NEW_TAB_OPTIONS`, exportado e reusado na pane vazia de `PaneView.tsx`.
- [x] `TerminalPane.tsx`: aba `kind: "terminal"` não passa mais pelo `AgentLauncher` — vai direto
  pro `spawnTerminal` sem `initialCommand`/`provider`, que é o shell puro (Git Bash no Windows).
  O nome da sessão passa a ser o título da aba quando não há agente.
- [x] `workspaceReducer.ts` → `BIND_TAB_RESOURCE` forçava `kind: "agent"` em qualquer aba ligada a
  uma sessão; isso devolvia o seletor de CLI numa aba de terminal puro. Agora preserva `terminal`.
- Testes: `src/test/PaneView.test.tsx` (menu abre, cada item despacha o `kind` certo, fecha depois
  do clique) e `src/test/App.test.tsx` (fluxo completo pelo menu).

## Colar e Shift+Enter no terminal (2026-09-11)

Três bugs distintos no mesmo caminho de entrada do terminal, todos com a mesma origem: a API de
teclado do xterm.js não faz o que o nome sugere.

- [x] **Ctrl+V colava duas vezes.** `attachCustomKeyEventHandler` devolvendo `false` só diz "xterm,
  não processa essa tecla" — **não** cancela o evento. A ação padrão do browser (o paste nativo)
  seguia acontecendo e caía no textarea do xterm, ao mesmo tempo em que o handler lia o clipboard
  e escrevia na PTY à mão. Agora só o paste nativo cola — e ele é o caminho certo, porque respeita
  bracketed paste (sem isso, texto multi-linha vira N mensagens separadas numa CLI como o Claude
  Code).
- [x] **Shift+Enter enviava a mensagem em vez de quebrar linha.** Mesma armadilha, sinal trocado:
  faltava o `preventDefault()`, então a quebra de linha nativa vazava pro xterm logo depois da
  sequência e a CLI lia como "enviar". Junto disso, a sequência estava errada: `ESC[13;2u` (CSI-u/fixterms) só
  vale se a CLI ligar o protocolo kitty, e o Ink não liga. O que o Ink lê é `ESC CR` (meta+Enter),
  a mesma sequência que o `/terminal-setup` do Claude Code instala no VS Code e no iTerm2.
- [x] **Colar arquivo/imagem morria com `os error 3`.** `writeBinaryFile()` em
  `src/features/files/filesService.ts` não criava a pasta destino, e `.omni-agents/pasted/` só
  nasce na primeira colagem. Corrigido com `mkdir(dirName(path), { recursive: true })` dentro da
  própria função — o outro caller (`FileTree.tsx`) cola em pasta existente, mas a guarda no lugar
  compartilhado cobre os dois.
- [x] **Ctrl+V de imagem agora entrega pra CLI, não salva arquivo.** Em aba de agente, quem sabe
  lidar com imagem é a própria CLI — ela lê o clipboard do sistema e anexa como `[Image #N]`.
  O handler só encaminha a tecla (`CLI_IMAGE_PASTE = "v"`, a mesma sequência ESC v que o
  Alt+V já mandava e que funcionava). Salvar em `.omni-agents/pasted/` e digitar o caminho ficou
  só pro terminal puro, onde não há ninguém pra ler o clipboard. Se alguma CLI passar a escutar
  `^V` (0x16), é a constante no topo de `TerminalPane.tsx` que muda.
- [x] Junto: o nome do arquivo colado é digitado cru na PTY, sem aspas. Nome com espaço e vírgula
  (`ChatGPT Image 4 de set. de 2026, 14_55_22.webp`) fazia a CLI ler só o primeiro pedaço.
  `TerminalPane.tsx` agora troca tudo fora de `[\w.-]` por `-` na geração do nome.
- O handler de teclas saiu de dentro do `useEffect` e virou `src/features/terminal/keyBindings.ts`
  (função pura `handleTerminalKey`), com a armadilha documentada no topo do arquivo. Isso existe
  porque a lógica já regrediu duas vezes e não havia teste nenhum: o mock do xterm em
  `src/test/setup.ts` descarta o handler, então não dava pra testar sem extrair.
- Testes: `src/test/keyBindings.test.ts` (Ctrl+V **não** pode cancelar o evento; Shift+Enter
  **tem** que cancelar e mandar `ESC CR`; Ctrl+C só copia com seleção) e um caso novo em
  `src/test/filesService.test.ts` pro mkdir da pasta destino.

## Commit e push num botão só (2026-09-11)

- [x] `git_push` novo em `src-tauri/src/git_client.rs` (registrado em `lib.rs`). Branch nova não
  tem upstream e aí `git push` puro falha mandando configurar — em vez de ler o texto do stderr
  (frágil, muda com idioma/versão, mesma razão do comentário em `git_status`), o comando pergunta
  por `@{u}`: se não existe, publica com `push --set-upstream origin <branch>`.
- [x] `gitPush()` em `src/features/git/gitService.ts` e o botão **Commit e push** ao lado do
  **Commit** em `src/components/GitPanel.tsx`. O push roda depois do commit, no mesmo `try`: se
  falhar (sem rede, sem remoto, rejeitado), o commit já está feito e o erro aparece — nada é
  desfeito nem escondido.
- [x] Bug encontrado ao escrever o teste: `refresh()` limpava o erro dentro do `.then`, o que
  apagava a mensagem do push logo depois de exibida (o commit tinha dado certo, o status
  recarregava, e o erro sumia). Agora a limpeza é síncrona no início do `refresh()` e o `catch`
  chama `refresh()` **antes** do `setError`.
- [x] `run_git()` engolia o motivo da falha: reportava stderr e, se ele viesse vazio, devolvia
  "git falhou sem mensagem de erro". Vários comandos (`commit` sem nada staged, hooks, o próprio
  `push`) escrevem a explicação no **stdout** e deixam só o código no status. Agora o stdout é o
  fallback, e quando os dois vêm vazios a mensagem nomeia o comando e o código de saída.
- [x] `GIT_TERMINAL_PROMPT=0` em todo `git` disparado pelo app: sem console, um pedido de
  usuário/senha no terminal penduraria o processo pra sempre e o botão travaria em "ocupado".
  Agora falha na hora com mensagem. Não afeta o Git Credential Manager, que é GUI.
- [x] `git_push` recusa HEAD destacado com mensagem própria em vez de tentar `push -u origin HEAD`.
- Testes: `src/test/GitPanel.test.tsx` (Commit não empurra; Commit e push comita antes de
  empurrar; push que falha deixa o erro visível).

## Attention Center entre workspaces + lista de workspaces na sidebar (2026-09-12)

Com vários workspaces abertos não dava pra saber que um agente de outro workspace terminou, pediu
aprovação ou quebrou — `App.tsx` só entregava à sidebar as sessões do projeto ativo.

- [x] **Seção ATENÇÃO** (`src/components/AttentionPanel.tsx`), primeiro filho do `<nav>` da
  sidebar: lista os agentes pendentes de **todos** os workspaces, com
  `workspace · projeto · motivo`, ordenados por prioridade (spec §11.3). Fica fora de
  `SidebarSection` de propósito — aquelas seções são desabilitadas sem projeto ativo, e o aviso
  precisa aparecer justamente quando você não está no workspace do agente.
- [x] **Lista de workspaces sempre visível** (`src/components/WorkspaceList.tsx`), substituindo o
  dropdown `WorkspaceSwitcher.tsx` (**apagado**). O dropdown escondia tanto a natureza da coisa
  ("Workspace 1" parecia rótulo, não seletor) quanto o badge de pendência. Sem portal: a máquina de
  `createPortal` + medição existia só porque aquilo era popover dentro da `<aside>.glass`.
- [x] **`useAttention`** (`src/features/terminal/useAttention.ts`): mapa de "já visto" em `useRef`,
  gravado **durante o render** (num efeito, o badge piscaria ~1s no agente que o usuário está
  olhando). Respeita `maximizedPaneId` (só a pane maximizada é renderizada) e as Configurações
  abertas (nenhuma pane na tela ⇒ nada é marcado como visto).
- [x] **`FOCUS_SESSION`** (`workspacesReducer.ts`): ação de nível de coleção, **antes** do
  roteamento por workspace ativo. Corrige um bug real de antes: o Ctrl+Tab ("próxima atenção")
  despachava `SELECT_PROJECT` pra um projeto de outro workspace — no-op — e o `ATTACH_TERMINAL`
  seguinte grudava a sessão **no projeto errado**. `useWorkspaceKeymap` agora recebe os itens de
  atenção no lugar das sessões (troca de prop, não adição: `WorkspaceView` era o único consumidor).
- [x] **Limite de uso e erro de API** (`crates/omni-protocol/src/lib.rs`,
  `crates/omni-engine/src/main.rs`): campo `notice: Option<String>` (`"usage_limit"` /
  `"api_error"`), **não** uma variante nova de `SessionState`. Três motivos: `append_output`
  reescreve `state` a cada chunk (a variante seria apagada pelo byte seguinte); `DEAD_STATES` do
  Kanban e `STATES` do `MobileApp.tsx` são `Set.has`/`Record<string,string>`, então a falha seria
  **silenciosa**; e o motivo da parada é metadado ortogonal ao estado.

### Por que a detecção lê a TELA e não o chunk

`detect_notice` recebe `interaction.parser.screen().contents()`. Três ganhos sobre varrer o chunk
(como `looks_like_approval_prompt` ainda faz): **limpa sozinho** quando a mensagem sai de vista —
zero código de limpeza em `write_terminal`/`stop_session`; **imune a fronteira de chunk** — uma
leitura de 8 KB pode partir a frase no meio (bug latente que a varredura de aprovação tem hoje); e
**sem escapes ANSI** no meio do texto, então `"api error:"` casa de verdade. A única limpeza
explícita que sobrou é em `restart_session` — um restart sem nenhuma saída nova nunca chamaria
`append_output` e deixaria o aviso velho colado.

Verificado: `npm run typecheck` limpo, `npm run test` 144/144, `cargo test -p omni-engine` 15/15,
`cargo check --manifest-path src-tauri/Cargo.toml` limpo, `npm run build:engine` refeito depois dos
testes (ver armadilha do binário vizinho no fim deste arquivo). **Falta a validação visual no app
instalado** — o fluxo de dois workspaces com agentes reais não foi exercido.

## Notificação do Windows quando agente pede atenção (2026-09-12)

Complemento da seção ATENÇÃO: aquilo só avisa com o app aberto na frente. Agora avisa fora dele.

- [x] **`tauri-plugin-notification`** adicionado (`src-tauri/Cargo.toml`, registrado em `lib.rs`,
  permissão `notification:default` em `capabilities/default.json`). É a única forma de toast do SO —
  não dava pra resolver com o que já existia.
- [x] **`useAttentionNotifier`** (`src/features/terminal/useAttentionNotifier.ts`): dois mecanismos
  de propósito — o **toast** conta o que aconteceu e some; o **piscar na barra de tarefas**
  (`requestUserAttention`, API core do Tauri, sem dependência nova) fica até você olhar.
- [x] Só dispara com a janela **sem foco** (`isFocused()`): com o app na frente, a seção ATENÇÃO já
  mostra tudo e o toast vira barulho. Chave = `sessionId:reason`, então o mesmo motivo não repete,
  mas "terminou" → "aprovação pendente" na mesma sessão notifica de novo. Aviso que sumiu é
  removido do set e pode notificar outra vez depois.
- [x] Acima de 3 agentes de uma vez, vira um aviso-resumo — dez toasts empilhados no Windows são
  dez cliques pra limpar.
- [x] Preferência `notifyAttention` (`src/types/settings.ts`, Configurações → **Avisos**), ligada
  por padrão; `loadSettings` faz spread sobre os defaults, então quem já tem o app instalado
  recebe ligada sem migração. Cobre a spec §21.4 no mínimo viável (liga/desliga global — ainda não
  tem por evento, por projeto nem por agente).

### O toast só vale no app instalado

`tauri dev` não tem AppUserModelID registrado, então no desenvolvimento o toast pode não aparecer
(ou aparecer com identidade errada). O piscar da barra funciona nos dois. Testar isso exige o
instalador NSIS, não o `dev` — mesma classe de armadilha do CSP documentada acima.

Verificado: `npm run typecheck` limpo, `npm run test` 148/148 (4 testes novos do notifier, com o
plugin e a janela mockados), `cargo check --manifest-path src-tauri/Cargo.toml` limpo. **Não
validado no Windows de verdade** — falta rodar o app instalado e confirmar o toast.

## Gemini removido (2026-09-12)

O Google desligou o Gemini CLI para contas individuais (Google AI Pro, Ultra e free) em
**18/06/2026** e migrou para o Antigravity CLI. Continuam funcionando só licença Gemini Code
Assist (enterprise) e API key — ou seja, o login por conta, que é o que o OMNI oferecia, deixou
de existir. Provider removido por inteiro.

- [x] `src-tauri/src/engine_client.rs`: fora de `AGENT_CLIS` (array 4 → 3).
- [x] `src-tauri/src/profiles.rs`: fora de `credential_rule` e `native_config_dir`. A lista de
  providers virou a const `SUPPORTED_PROVIDERS`, e `with_defaults()` agora **descarta** profiles
  de provider não suportado — senão o `profiles.json` de quem já usava o app guardaria um
  `gemini-padrao` órfão pra sempre.
- [x] Front: `AgentCliId` (`terminalService.ts`), `DESCRIPTIONS` (`AgentConnections.tsx`),
  fallback do `AgentLauncher.tsx`, dica do "+" em `WorkspaceTabBar.tsx`.
- [x] `spec.md` e o comentário em `conversations.rs` atualizados.
- Teste `AgentConnections.test.tsx` usava o gemini como exemplo de provider **sem** isolamento de
  config dir. Sobrou só o cursor nesse papel, então o caso foi remontado: cursor = instalado sem
  login (botão "Entrar"), codex = ausente (o "+ Conta" desabilitado, escopado na linha dele porque
  o claude também tem um).

## "os error 10048" no terminal: o app esgotava as portas do Windows (2026-09-13)

Sintoma relatado: depois de horas com o app aberto **sem mexer**, os panes enchiam de
`Normalmente e permitida apenas uma utilizacao de cada endereco de soquete (os error 10048)`;
trocar de projeto e voltar limpava, porque o remount do `TerminalPane` zerava o estado de erro.

**Causa raiz:** `send_request` (`src-tauri/src/engine_client.rs`) abria um `TcpStream` novo por
requisicao e o descartava. Cada pane pede snapshot a cada 100ms e a lista de sessoes vai a cada 1s
-> ~30 conexoes/s com tres panes, cada uma parada 120s em `TIME_WAIT`. A faixa dinamica do Windows
tem 16384 portas (`netsh int ipv4 show dynamicport tcp`); medido na maquina do usuario no momento
do erro: **5116 sockets em TIME_WAIT** so contra a porta 47321. Esgotada a faixa, todo `connect`
falha com `WSAEADDRINUSE`. O engine nunca teve culpa — `serve_client` sempre leu varias linhas na
mesma conexao; era o cliente que jogava o socket fora.

- [x] `IDLE_CONNECTION` (`Mutex<Option<BufReader<TcpStream>>>`) guarda a conexao entre requisicoes.
- [x] Reenvio seguro: `ExchangeError.unsent` separa "falhou antes de escrever a linha" (o engine so
  age com a linha completa, entao reenviar e seguro) de "ja enviei e o timeout estourou" (a operacao
  pode ter rodado). Requisicao que nao e `read_only()` nunca e reenviada — repetir `SpawnTerminal`
  abriria sessao duplicada e `WriteTerminal` digitaria duas vezes dentro do agente.
- [x] `EngineRequest::read_only()` (`crates/omni-protocol`): so `Ping`, `ListSessions` e `Snapshot`.
  **`AccountUsage` ficou de fora de proposito** — com `refresh` ele digita `/usage` na PTY, e
  escrita disfarcada de leitura.
- [x] Depois de qualquer erro a conexao e descartada em vez de devolvida ao cache: uma resposta
  atrasada viraria a resposta da requisicao seguinte (dessincronizacao silenciosa, o pior tipo).
- [x] Teste `sequential_requests_share_one_connection`: servidor de mentira conta quantas conexoes
  aceitou; tres requisicoes tem que caber em uma.

### O banner grudava por falha passageira (mesmo relato)

`TerminalPane.poll()` chamava `setError` na primeira falha e **nunca limpava** — so o remount
(trocar de projeto e voltar) apagava. Agora: `FALHAS_ATE_AVISAR = 3` falhas seguidas antes de
mostrar, `setError(null)` ao voltar a responder (atualizacao funcional, senao seriam 10 renders por
segundo), e o intervalo do poll cai de 100ms pra 1s enquanto esta falhando — martelar um engine
caido so gasta socket.

### `OMNI_ENGINE_PORT`

Cliente e engine agora leem essa variavel (`engine_client::engine_port` e o `bind` do `main.rs`).
Existe porque **app instalado e app de dev na mesma maquina disputam a porta fixa**: o segundo a
subir fala com o engine do primeiro. Foi exatamente o que aconteceu aqui — o engine de ontem
(`AppData\Local\OMNI AGENTS\omni-engine.exe`) segurava a 47321, entao o app de dev rodava contra
um engine sem o campo `notice`.

Verificado: `npm run typecheck` limpo, `npm run test` 151/151 (2 testes novos do banner),
`cargo test --manifest-path src-tauri/Cargo.toml` 9/9, `cargo test -p omni-engine` 15/15,
`npm run build:engine` refeito. **Falta rodar o app por horas e conferir o `TIME_WAIT` parado** —
a prova final e medir `netstat -ano | findstr :47321` depois de um dia aberto.

## Icones por tipo de arquivo na arvore (2026-09-13)

Antes: a arvore desenhava TEXTO — `.` para qualquer arquivo e `>`/`v` para pasta
(`FileTree.tsx:431-433`). Uma pasta com 40 itens virava 40 pontinhos iguais.

- [x] **76 icones novos** no gerador (`scripts/gen-pixel-icons.mjs`), total 101. Script npm novo:
  `npm run icons`.
- [x] **`src/features/files/fileIcons.ts`**: cascata pasta-conhecida -> pasta -> nome-exato ->
  extensao -> generico. ~180 chaves no total.
- [x] Ligado em **quatro lugares**: arvore (`FileTree.tsx`), abas (`WorkspaceTabBar.tsx`, no lugar
  do rotulo textual do kind), painel do Git (ao lado do status, nao no lugar dele) e Skills.
- [x] Testes: `src/test/fileIcons.test.ts` (10) + lista de contrato ampliada em `PixelIcon.test.tsx`.

### Monocromatico muda a estrategia de escolha dos icones

O usuario escolheu **sem cor** (tudo herda `currentColor`). No Material Icon Theme metade do
reconhecimento vem da cor; aqui a FORMA e o unico diferenciador — e o `pixelarticons` **nao tem
icone de linguagem nenhuma** (so marcas: npm, docker, react, github). Mandar 70 extensoes para um
`code` generico entregaria 70 desenhos iguais, ou seja, nada. Por isso linguagens irmas recebem
glifos diferentes de proposito: `braces` (ts/json), `brackets-angle` (html/xml), `brackets`
(vue/svelte), `cpu` (rs), `algorithm` (py), `binary` (c/cpp), `terminal` (sh/ps1), `hash` (cs).
`src/test/fileIcons.test.ts` tem um teste que **trava essa decisao**: minimo de 30 formas distintas
e nenhum icone cobrindo mais de 15% das extensoes. Se alguem no futuro simplificar o mapa jogando
tudo em `CodeIcon`, o teste reprova.

### Armadilhas do pipeline de icones

- `src/components/ui/PixelIcon.tsx` e **gerado** — editar a mao e perder o trabalho no proximo
  `npm run icons`. Adicionar icone = linha no objeto `ICONS` do script.
- `PixelIcon.test.tsx` impoe duas regras que limitam a escolha: path **sem curvas**
  (`/[CcSsQqTtAa]/`) e **nenhum path duplicado** entre exports. Os 76 escolhidos foram conferidos
  em massa ANTES de entrar (script descartavel comparando os `d` de 104 candidatos): zero curvas,
  zero duplicatas, inclusive contra os 25 que ja existiam. Dois tipos que compartilham desenho tem
  de compartilhar o mesmo export.
- `makeIcon` devolve sempre `function Icon`, entao **todo icone tem o mesmo `.name`** — comparar
  icones por nome colapsa tudo em um. Comparar por referencia (custou um teste vermelho aqui).
- Nao existe `folder-open` no pacote: a seta ao lado ja indica aberto/fechado, e dois indicadores
  do mesmo estado seriam redundancia.
- Na arvore, seta e icone agora sao elementos separados. **O `iconRef` do GSAP ficou no icone**, nao
  na seta — e a pasta que pulsa ao virar alvo de arrasto (`FileTree.tsx:392-396`).

Verificado: `npm run typecheck` limpo, `npm run test` 163/163. **Falta a conferencia visual** —
se algum glifo ficou ilegivel em 12px (`h-3 w-3`) so olhando o app.

## Celular: a causa raiz era um engine velho no instalador (2026-09-13)

O acesso pelo celular nunca funcionou — e **não era código faltando**. O engine em execução,
instalado junto com a 0.3.1, era de **09/09** e respondia a qualquer comando novo com
`INVALID_REQUEST: unknown variant 'mobile_settings', expected one of 'ping', 'list_sessions', ...`.
Ele não conhecia nem `mobile_settings` nem `account_usage`.

Por que um engine velho sob um app novo: **o engine roda destacado e sobrevive ao instalador**. O
NSIS não consegue substituir um `omni-engine.exe` em uso e segue em frente sem reclamar. App de
10/09, engine de 09/09, e a tela de Celular deixava clicar em Ativar sem nada acontecer.

- [x] `src-tauri/installer-hooks.nsh` + `bundle.windows.nsis.installerHooks`: `taskkill` no engine
  antes de copiar os arquivos. É o conserto de verdade — sem ele a próxima release repete tudo.
- [x] `engine_client.rs::outdated_engine_hint()` traduz `unknown variant` em `ENGINE_OUTDATED` com
  instrução do que fazer. Cobre qualquer comando futuro, não só este.
- [x] Banner "Beta — ainda não funciona" fora de `MobileSettings.tsx`; quem fala agora é
  `status.listening` / `status.error`, que já existiam.

### Token de dispositivo + QR

- [x] `MobileConfig.token` (`#[serde(default)]`, então `mobile.json` antigo carrega). Gerado **só**
  pelo engine: o `token` que vem do desktop é descartado em `settings()`, então uma tela de
  configuração não planta segredo escolhido por ela. `rotate` troca e reinicia o listener.
- [x] Validação dentro do `same_origin` que já existia, deny-by-default com allow-list de duas
  entradas (`/` e `/assets/`) — rota nova nasce protegida. Comparação em tempo constante, 3 linhas,
  sem dependência.
- [x] Entrega pelo **fragmento** (`#t=…`), não query: não vai no request, não entra em log nem em
  `Referer`. O celular grava em `localStorage`, limpa a barra e descarta sozinho no `401`.
- [x] QR desenhado no desktop com a lib npm `qrcode` a partir do link que o **engine** monta.

### Projetos publicados

- [x] `EngineRequest::PublishWorkspace` + `GET /projetos`. Projeção mínima (`id`, `name`, `path`) —
  sem árvore de layout, sem abas, sem git. Gravado em `engine/workspace.json` para sobreviver a
  reinício do engine com o desktop fechado, que é justamente quando o celular é a única via.
- [x] União com o `conversations.json`: projeto que já teve conversa aparece mesmo sem publicação.
- [x] `useWorkspace.ts` publica com a **projeção serializada como debounce** — arrastar aba ou
  mexer em split não gera IPC nenhum. Teste em `src/test/useWorkspace.test.tsx`.

### Abrir sessão pelo celular

- [x] `POST /sessoes` com `deny_unknown_fields`: `cwd` contrabandeado no corpo vira **422**, não um
  campo ignorado em silêncio. O `cwd` sai do projeto conhecido, o comando sai da CLI publicada e o
  `env` do perfil — o celular só escolhe ids dentro de listas fechadas. Teto de 16 sessões vivas.
- [x] Reusa a fila existente (`ActionKind::Spawn`), com idempotência e expiração, pulando
  `capabilities`/`If-Match` porque não há tela viva para ficar obsoleta.
- [x] Movidos para o `omni-core` (o engine precisa deles com o desktop fechado, e duas cópias
  divergiriam): `config_dir_var`, `env_for`, `write_index`, `claude_project_slug`,
  `claude_transcript_path` — o teste do slug foi junto.

### Pendente: validar no celular de verdade

Nada disto foi testado num telefone. **O engine em execução precisa ser reiniciado** para valer, e
isso mata as sessões vivas. Passos em `docs/mobile-and-account-usage.md`.

### Gotcha novo: `act()` engolindo `findBy*`

`await act(async () => { await userEvent.click(await screen.findByRole(...)) })` nunca acha o
elemento: esperar dentro do `act` impede o React de aplicar o estado que faria ele aparecer. O
`findBy*` fica **fora**, e só o clique dentro. Custou uma depuração inteira em `MobileApp.test.tsx`.

## `npm run dev` derrubava o OMNI instalado (2026-09-13)

**Sintoma:** todo `npm run dev` matava o app instalado e todas as sessões abertas nele.

**Causa, em duas camadas:**
1. `scripts/build-engine.mjs::shutdownRunningEngine()` — quando o binário de dev estava travado,
   mandava `shutdown` para `127.0.0.1:47321` com o token de `%LOCALAPPDATA%\com.omni.agents`. Esse
   endereço e esse token são **do app instalado**. O script matava o engine errado.
2. Dev e instalado tinham a mesma identidade: mesma porta, mesma pasta de dados, mesmo token. O
   `OMNI_ENGINE_PORT` existia, mas ninguém definia — a colisão era o padrão. De quebra, o app de
   dev conversava com o engine instalado (versão velha).

**Conserto:**
- [x] `omni-protocol`: `DEV_ENGINE_PORT = 47341` e `DEV_DATA_DIR = "com.omni.agents.dev"`.
- [x] `engine_client.rs`: `engine_port()` e `engine_dir()` devolvem a identidade de dev quando
  `cfg!(debug_assertions)`. São os dois únicos pontos — conversas, perfis e uso já passavam por eles.
- [x] `spawn_engine()` repassa `OMNI_ENGINE_PORT` e `OMNI_DATA_DIR` ao engine que abre. **Quem lança
  decide a identidade**, não o perfil com que o binário foi compilado — um engine de release aberto
  pelo app de dev continua isolado.
- [x] Engine honra `OMNI_DATA_DIR`.
- [x] `build-engine.mjs` mira só porta e token de dev. Porta e token são travas independentes: mesmo
  com a porta colidindo, o engine instalado recusa um token que não é o dele. Travado sem resposta,
  o script **para com erro** em vez de matar às cegas.
- [x] `src/test/devIsolation.test.ts` trava o espelho JS↔Rust das constantes e proíbe a porta e a
  pasta do instalado no código do script. Validado por mutação: voltar a porta para 47321 reprova.
- [x] Prova empírica: build com o binário de dev travado de propósito — o engine instalado manteve o
  mesmo pid antes e depois.

**Consequência visível:** o dev agora começa com pasta de dados vazia (`com.omni.agents.dev`) —
sem perfis, conversas nem sessões do app instalado. É o isolamento funcionando.

## QR apontava para 127.0.0.1 e falhava no 4G (2026-09-14)

O modo direto nascia com o bind padrão `127.0.0.1:47322` e a tela gerava QR com ele: abria no
PC, falhava no celular sem explicação.

- [x] `mobile.rs::preferir_ip()` — no modo direto, loopback vira o IP do Tailscale mantendo a porta.
  Aplicado ao salvar **e na subida do servidor**, então `mobile.json` antigo se corrige sozinho.
  Validado ao vivo: o engine de dev reabriu escutando em `100.94.187.72:47322` sem nenhum clique.
- [x] Loopback nunca vira `public_url`/QR. Sem Tailscale a tela explica que o endereço só abre no PC.
- [x] Modo direto virou o padrão ("funciona na hora"); HTTPS pelo Serve fica como opção que pede
  liberar uma vez na conta. Endereço manual escondido em "avançado".
- [x] A tela continua consultando enquanto o Serve publica em segundo plano.
- Teste: `modo_direto_troca_loopback_pelo_ip_do_tailscale` (troca; sem Tailscale não troca; Serve
  não troca; endereço já escolhido não é sobrescrito).

## Botão "Liberar na conta Tailscale" morto (2026-09-15)

Três defeitos empilhados, todos no mesmo fluxo:

- [x] **`tailscale serve --bg` nunca sai** quando o Serve não está liberado: imprime o link e fica
  esperando. O helper `tailscale()` matava no timeout e **descartava a saída** — a tela recebia
  "O Tailscale não respondeu." em vez do link. Agora a saída é lida mesmo no timeout, e o timeout
  do serve caiu de 45 s para 10 s (liberado, volta rápido; não liberado, nunca volta).
  `motivo_do_serve()` extrai o link; testado com a saída real capturada.
- [x] **Sem permissão de abrir URL**: `capabilities/default.json` só tinha `opener:allow-open-path`.
  O `openUrl()` era recusado e o `void` engolia o erro. Adicionado `opener:allow-open-url` **restrito a
  `https://login.tailscale.com/*`**.
- [x] **Qualquer aviso virava botão de liberar**, inclusive "não respondeu". Agora só link de
  liberação vira botão; o resto aparece como texto. Se o navegador não abrir, o link fica na tela.
- [x] `publicar()` zera o estado do Serve antes de cada tentativa: o aviso antigo parava o polling e o
  QR nunca aparecia depois de liberar e clicar em Aplicar.

## Sessão aberta pelo celular nunca iniciava + histórico "indisponível" (2026-09-15)

Diagnosticado com dados reais, não fixture.

- [x] **Causa principal — o ConPTY espera resposta de cursor.** Ao criar a PTY ele manda `ESC[6n` e
  **para** até receber `ESC[linha;colunaR`. No desktop quem responde é o xterm.js. Sessão aberta
  pelo celular não tem terminal exibindo: a saída inteira ficava só `ESC[6n`, o shell não tinha
  nenhum filho, e o `claude` injetado nunca rodava — daí "entrada do CLI não reconhecida".
  Confirmado respondendo `ESC[1;1R` à mão: a sessão destravou e passou a `prompt=true`.
  Conserto: `LiveSession.headless`; o engine responde `ESC[6n` pelo `vt100` enquanto ninguém exibe a
  sessão, e para no primeiro `snapshot` (o xterm assume — os dois respondendo vazaria `ESC[1;1R` como
  texto). Teste com PTY real: sem a resposta trava e falha em 15 s; com ela passa em 0,9 s.
- [x] **Histórico "indisponível" em conversa nova.** O Claude só grava o `.jsonl` depois da primeira
  mensagem; o caminho já existia (`--session-id`) e o arquivo não. Agora é "vazia", não "indisponível".
- [x] **Agente trabalhando parecia sem histórico.** Num transcript real ativo: 31 `tool_use`, 25
  `thinking`, 0 `text` — nada disso vira mensagem. O celular agora avisa que o agente está
  trabalhando. (Em 15 transcripts recentes, 12 têm texto: o parser estava certo.)
- [x] `composer_vazio()`: à esquerda do cursor só o prompt; à direita só vazio ou `dim`. A tela real
  não mostrou isso travando (um `ESC[K` apaga o exemplo em cinza), mas a regra da linha inteira
  quebraria sem ele. Primeiro fixture **real** do projeto: `tests-fixtures/claude-composer-vazio.ansi`.

## Chat no celular e ícone do PWA (2026-09-15)

### Chat
- [x] `src/mobile/Chat.tsx`: `MessageBubble` (seu à direita em laranja, do agente à esquerda) e
  `AgentWorking` — quadro que "respira" como o spinner do Claude Code, frase boba trocando a cada
  2,8 s ("Tricotando código…", "Consultando os astros…") com brilho correndo, e contador em segundos.
  O texto que muda é `aria-hidden`; leitor de tela recebe uma mensagem estável. Sem animação com
  `prefers-reduced-motion`.
- [x] Sai "Ação enfileirada" e a lista "Na fila / Enviando / Enviado ao CLI". O prompt vira balão na hora
  (otimista) e some quando chega no transcript; recusa da fila tira o balão e diz o motivo.
- [x] **Bug achado pelo teste:** o polling limpava todo erro a cada ciclo, então "não foi enviado"
  aparecia e sumia no mesmo instante. Falha de envio virou estado separado.
- [x] `usePoll` com intervalo configurável: 1,5 s com o agente ativo, 5 s parado.
- [x] Barra de digitação presa no pé da tela (shell em coluna flex, conversa com `flex: 1`).

### Ícone do PWA
Três camadas: `index.html` sem link de ícone/manifest; nenhum arquivo de ícone no bundle; e o servidor
exigia código de acesso fora de `/` e `/assets/` — o navegador busca ícone e manifest **sem** o
`X-Omni-Token`, então cairiam no 401.
- [x] `vite.mobile.config.ts` emite os ícones **direto de `src-tauri/icons`** (sem cópia no repo) com
  nomes fixos, mais o `manifest.webmanifest`. `apple-touch-icon` usa o 180×180 opaco do iOS (o iPhone
  pinta transparente de preto).
- [x] `mobile.rs`: `ARQUIVOS_PUBLICOS` (lista fechada, não prefixo) e `tipo_do_arquivo()` — com
  `nosniff`, PNG servido como `octet-stream` seria ignorado. Validado ao vivo: os 5 arquivos 200 sem
  código com o tipo certo, `/conversas` segue 401.

### Verificador do celular estava quebrado
`scripts/check-mobile-browser.mjs` não sabia do código de acesso nem da tela de projetos, e procurava
o botão de envio pelo texto. Atualizado (entra pelo link `#t=`, navega Projetos → Conversa, mede
estouro e alvos de toque também no chat). Virou `npm run test:mobile`.

## v0.4.1 — pareamento pelo Authy e entrega do chat/ícone ao app instalado (2026-09-15)

**Sintoma:** no iPhone nada mudava — sem ícone, aparência antiga. **Não era bug:** o iPhone falava com o
app instalado (engine de 14/09, v0.4.0), e tudo que tinha sido feito estava só no build de dev.
Verificado comparando o que o `https://pc-felipe…ts.net` servia (sem `apple-touch-icon`, bundle
`index-B8gBM43a.js`, ícone 401) com o build novo. A correção era uma versão instalada.

### Armadilha do iPhone — leia antes de mexer em autenticação do celular
**App da tela inicial do iPhone não compartilha `localStorage` nem cookies com o Safari, por design**
(engenheiro da Apple em [WebKit bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849)). O token
que o QR grava no Safari **não existe** dentro do app da tela inicial. Sem um segundo caminho de
autenticação, o PWA abriria sempre travado em "Dispositivo não autorizado", e ler o QR de novo abre o
Safari, não o app.

### Pareamento pelo Authy (TOTP, RFC 6238)
- [x] `totp-rs` (sem features padrão; `otpauth` + `gen_secret`) — HMAC de biblioteca, não escrito à mão.
- [x] `MobileConfig.totp_secret`/`totp_confirmed`, gravados **só pelo engine** (o desktop não confirma
  nem troca o segredo — testado). `EngineRequest::MobileTotp { Reset | Confirm }`.
- [x] `totp_uri` (`otpauth://`) só sai enquanto o cadastro não foi confirmado.
- [x] `POST /parear` público (quem chama ainda não tem token), sob o mesmo Host/Origin. Janela ±1 passo
  de 30 s; **replay recusado** (guarda o último passo aceito); **5 erros em 5 min → 429**. Força bruta:
  3 códigos válidos em 10⁶ a 5 tentativas por 5 min, e só de dentro da tailnet.
- [x] Teste com o vetor oficial do RFC 6238 (SHA-1, T=59 → `287082`).
- [x] Aba Celular, passo 4 "Proteger com o Authy": QR → código → "configurado"; refazer pede confirmação.
- [x] Celular: `401` troca o app pela `PairingScreen` (`autoComplete="one-time-code"`, só dígitos).

### Release
- [x] `VERSION` 0.4.1, changelog em linguagem de usuário, `npm run build` assinado. Instalador em
  `installers/`. **Instalação fica com o usuário** (o hook do NSIS encerra o engine e as sessões).

### Gotcha que voltou: `findBy*` dentro de `act()`
Apareceu de novo em `MobileSettings.test.tsx`. O teste só passava quando o elemento procurado já
existia na primeira renderização — por sorte. Regra: `findBy*` sempre **fora** do `act`, só o clique
dentro. Varredura feita nos outros testes: nenhuma ocorrência restante.

## A identidade do engine vazava para os terminais (2026-09-15)

**Sintoma:** a janela de `npm run dev` mostrava os dados do app instalado, e "Configurar Authy" falhava
com `unknown variant 'mobile_totp'` — o app de dev estava falando com o engine **instalado** (0.4.0).

**Causa — regressão do isolamento dev/instalado.** Para o engine usar a identidade de quem o abre,
`spawn_engine()` passou a entregar `OMNI_ENGINE_PORT` e `OMNI_DATA_DIR` ao engine. Só que o engine
repassa o próprio ambiente a **todo terminal** que cria. Quem desenvolve o OMNI dentro do próprio OMNI
roda `npm run dev` num shell que já traz a porta 47321 e a pasta `com.omni.agents` — e variável de
ambiente vence o padrão de dev. Confirmado lendo o ambiente de um shell aberto pelo OMNI
(`OMNI_ENGINE_PORT=47321`, `OMNI_DATA_DIR=…\com.omni.agents\engine`) e cruzando o código de acesso da
tela com a pasta do instalado.

- [x] `main.rs::ambiente_do_terminal()` remove `VARIAVEIS_DO_ENGINE` do shell antes de abrir a PTY.
  Teste validado por mutação (sem a limpeza: `OMNI_ENGINE_PORT vazou para o terminal`).
- [x] `engine_client.rs::send_request`: a tradução para "engine desatualizado" só valia na conexão
  nova; na reaproveitada (quase todas) a mensagem chegava crua. Teste de conexão agora exige a tradução
  nas três requisições.

**Consequência prática:** terminais já abertos pelo engine 0.4.0 continuam com as variáveis. Só depois
de instalar a 0.4.1 (que reinicia o engine) os terminais nascem limpos. Até lá, `npm run dev` rodado
dentro do OMNI instalado continua usando o engine instalado.

## Release v0.4.2 publicado (2026-09-15)

- [x] https://github.com/FelipeCamposM/OMNI-AGENTS/releases/tag/v0.4.2 — commit `ca339e4`, tag `v0.4.2`.
  Publicado manualmente (setup.exe + .sig + latest.json), como a 0.4.0. **Latest**, não pre-release.
- [x] Verificado depois de publicar: `releases/latest/download/latest.json` devolve 0.4.2 e a URL do
  instalador responde 200. Nenhum workflow disparou.
- A 0.4.1 foi só build local, nunca publicada: as notas dela foram fundidas na 0.4.2.
- **`.github/` ficou fora deste commit de propósito.** O `release.yml` dispara em qualquer tag `v*`: com ele
  commitado, a tag teria rodado o build multiplataforma **e** brigado com o release manual. Os workflows
  entram quando o CI for validado e os secrets de assinatura estiverem cadastrados no GitHub.
- Repositório é **público**: antes do commit foram trocados por valores fictícios o usuário/PC e o caminho
  de projeto no fixture `claude-composer-vazio.ansi` (mesmo tamanho, para não mexer na tela), o ID de nó
  do Tailscale num teste do engine e o IP do Tailscale num teste da tela. `.omni-agents/` (imagens
  coladas nos terminais) entrou no `.gitignore`.

## "Reiniciar" não voltava para a conversa do Claude (2026-09-15)

**Sintoma:** sessão parada → **reiniciar** → o Claude abria sem a conversa; era preciso digitar `claude -r`.

**Causa:** os dois caminhos de `restart_session` (sessão viva e histórica) reinjetam `initial_command`
literal. Numa conversa Claude ele é `claude --session-id <uuid>` — o comando de **criar** a conversa com
aquele id, não de retomar (`claude --help`: `--session-id` "Use a specific session ID for the
conversation"; `--resume <id>` é o que retoma).

- [x] `main.rs::comando_ao_reiniciar()`: conversa Claude cujo transcript existe reinicia com
  `--resume <uuid>` (mesmo id, então o celular segue lendo o mesmo arquivo). Sem transcript — nenhuma
  mensagem mandada — o `--resume` falharia, então fica o comando original. Transcript procurado no
  `CLAUDE_CONFIG_DIR` da conta da sessão ou no `~/.claude` padrão. Codex e terminal puro não mudam.
- Testes: `reiniciar_conversa_claude_com_historico_retoma_a_mesma`,
  `reiniciar_nao_mexe_no_que_nao_e_conversa_claude_nova`.

**Por que a sessão "sumia":** sem evidência de morte por ociosidade (nenhum evento de suspensão do
Windows). As sessões paradas coincidem com reinícios do engine — a atualização automática para a
0.4.2 reiniciou o engine às 03:02 de 15/09 e encerrou as sessões abertas, que é o comportamento
esperado de atualizar.

- [ ] Codex: o reinício ainda abre conversa nova. O id da sessão do Codex não é conhecido na criação;
  `codex resume --last` pegaria a mais recente da pasta, que pode não ser a mesma.
- [ ] Chega ao app instalado só na próxima versão.

## Painel Git: muro de texto vermelho no lugar de commit (2026-09-16)

Sintoma: o painel GIT mostrava a saida longa do `git status` em vermelho ("On branch main... no
changes added to commit"), com "tentar de novo".

**Causa raiz: v1 x v2 do porcelain.** `git_client.rs` roda `git status --porcelain=v1` e repassava
as colunas cruas. No **v1**, coluna sem alteracao e ESPACO; no **v2** e PONTO — e o front sempre
falou v2 (`isStaged`: `x !== "."`, `isUnstaged`: `y !== "."`, em `gitService.ts`). Com espaco cru,
`" " !== "."` dava verdadeiro nos dois lados: **todo arquivo modificado contava como preparado E
como nao preparado**. Dai o painel mostrava o botao Commit com o indice vazio, o git recusava
imprimindo o `status` longo no stdout, e `run_git` (que devolve stdout quando o stderr vem vazio)
entregava aquilo como mensagem de erro.

- [x] `parse_status_v1` normaliza espaco -> ponto. Duas linhas; o resto do app ja estava certo.
- [x] `git_commit` checa `diff --cached --quiet` antes e devolve "Nada preparado para commit" em
  vez de deixar o git cuspir o status inteiro — cobre a corrida (algo desfaz o stage entre o
  refresh e o clique).
- [x] Testes espelhados nos dois lados: `git_client.rs` (parser, com o caso do rename que descarta
  o caminho antigo) e `src/test/gitService.test.ts` (classificacao). O teste do TS documenta de
  proposito o caso do espaco cru — se alguem remover a normalizacao no Rust, esta escrito ali o que
  volta a acontecer.

Verificado: `cargo test --manifest-path src-tauri/Cargo.toml` 11/11, `npm run test` 199/199,
typecheck limpo.

## Modelo e esforco na aba do agente (2026-09-16)

Pedido: a aba de agente tem que dizer, no canto inferior direito, qual IA esta atendendo e com
qual esforco.

**De onde vem o dado.** O OMNI nao escolhe o modelo — a CLI escolhe, e pode trocar no meio da
conversa (`/model`). Entao configuracao nao serve: `~/.claude/settings.json` diz so `"model":
"opus"` (apelido, sem versao, sem esforco) e nao reflete troca feita na sessao. A fonte que nao
mente e o registro que a propria CLI grava por turno:

| Provider | Arquivo | Campos |
|---|---|---|
| Claude | `projects/<slug>/<session>.jsonl`, entrada `assistant` | `message.model` (`claude-opus-5`), envelope `effort` (`high`) e `version` |
| Codex | `sessions/**/rollout-*.jsonl`, entrada `turn_context` | `payload.model` (`gpt-6-astra`); esforco nem sempre presente |

- [x] `crates/omni-core/src/runtime.rs`: `claude_runtime` e `codex_runtime`. **Leitura sempre pela
  cauda** (1 MB): o transcript deste projeto ja passou de 4 MB e o poll ler o arquivo inteiro seria
  custo proporcional ao tamanho da conversa. A primeira linha da cauda pode vir cortada — quem le
  descarta o que nao for JSON valido, sem tratamento especial.
- [x] `perTurnEffort` ganha de `effort`: um e o esforco daquele turno, o outro o ajuste vigente.
- [x] Comando `agent_runtime` (`src-tauri/src/agent_runtime.rs`), no app e nao no engine: e leitura
  de arquivo local, sem PTY e sem estado — passar pelo engine so somaria um salto de rede.
- [x] `AgentRuntimeBadge` no canto inferior direito da pane, poll de 5s (o dado so muda quando o
  usuario roda `/model`; 1s como o terminal seria desperdicio). **Some por completo** quando nao ha
  o que dizer — etiqueta escrevendo "modelo desconhecido" ocuparia o mesmo espaco sem informar.
- [x] `nomeCurtoDoModelo`: `claude-opus-5` -> `Opus 5`, `claude-sonnet-4-5-20250929` -> `Sonnet 4.5`.
  Numeros seguidos viram versao com ponto; carimbo de data (8 digitos) sai fora — identifica build,
  nao modelo. Id cru e versao da CLI ficam no `title`.

### A etiqueta nasceu invisivel: condicionada ao launcher

Primeira versao gatilhava em `launch` (o estado que o `AgentLauncher` preenche). Isso so existe
quando foi AQUELA montagem da pane que abriu o agente — numa sessao restaurada (app reaberto, aba
reatachada) `launch` e `null` para sempre, que e justamente o caso mais comum. Agora provider,
profile e `external_session_id` saem do **snapshot da sessao**, com `launch` so como reserva para o
instante antes do primeiro poll. `src/test/TerminalPane.test.tsx` cobre exatamente esse caso.

### Por que o Claude aparecia vazio e o Codex vinha sem esforco

Dois motivos diferentes, os dois descobertos olhando os arquivos reais da maquina:

1. **Claude sem turno.** A aba estava aberta mas a sessao nunca chamou a API — o `.jsonl` existia
   com 14 linhas, so metadados (`mode`, `permission-mode`, `cost-state` com
   `totalAPIDuration: 0`), nenhuma entrada `assistant`. Sem turno nao ha modelo gravado. Agora cai
   no `settings.json` da conta (`"model": "opus"`), marcado `source: Config`, e a etiqueta avisa
   com `?` + tooltip "configurado — esta sessao ainda nao respondeu". Sem isso a etiqueta ficava
   invisivel da abertura da aba ate a primeira resposta, que e quando mais interessa saber com quem
   se esta falando.
2. **Codex com esforco nulo.** O rollout tem o campo, mas com `reasoning_effort: null` — o modelo
   nao expoe esforco. Agora completa pelo `model_reasoning_effort` do `config.toml`.
   `plan_mode_reasoning_effort` fica **de fora de proposito**: vale so no modo plano, e exibi-lo
   como esforco da sessao seria afirmar algo falso (tem teste travando isso).

Conferido contra os arquivos reais: Claude sem turno -> `opus`/Config; Claude com turno ->
`claude-opus-5` + `high`/Sessao; Codex -> `gpt-6-astra` + CLI 0.153.1.

Armadilha achada de passagem: a etiqueta nasceu com `pointer-events-none`, o que **impede o tooltip
de abrir** — e e no tooltip que mora o id cru do modelo e o aviso de "configurado". Ha teste.

### `<synthetic>` no lugar do modelo

A CLI grava entradas `assistant` com `model: "<synthetic>"` para mensagens que ela mesma fabrica
(interrupcao do usuario, erro local). Num transcript deste projeto: **677 entradas reais e uma
dessas** — e bastou ela ser a ULTIMA para a etiqueta exibir "<SYNTHETIC>" no canto da pane.
`claude_runtime` agora pula qualquer modelo que comece com `<` e continua procurando para tras;
o `AgentRuntimeBadge` repete a checagem (cinto e suspensorio) para que um marcador novo no futuro
nao estreie na tela do usuario. Teste dos dois lados.

### Limites conhecidos

- **Claude sem `external_session_id` nao mostra nada.** Sem ele nao da para saber QUAL transcript e
  o desta aba, e chutar o mais recente mostraria o modelo de outra sessao do mesmo projeto.
- **Codex casa por `cwd`**, porque o OMNI nao fixa id de sessao nele como faz no Claude: duas
  sessoes do Codex na mesma pasta ao mesmo tempo mostram o modelo da mais recente nas duas
  (marcado com `ponytail:` no codigo).

Verificado: `cargo test -p omni-core` (4 testes novos), `cargo test --manifest-path src-tauri`
11/11, `npm run test` 218/218 (11 novos), typecheck limpo. **Falta ver na tela** — precisa de
`npm run dev` com um agente Claude aberto.

## Gotchas

- **Bug real encontrado em 2026-08-27 (usuário travado com "tela preta")**: no caso sem split
  (um único pane), `PaneTree.tsx` devolve `<PaneView>` direto, sem wrapper. O container em
  `WorkspaceView.tsx` (`<div className="flex-1 min-h-0 p-2">`) não tinha `display:flex`, então
  a `<section>` do `PaneView` (sem `h-full`/`flex-1` próprio) ficava com altura `auto` — encolhia
  pro conteúdo em vez de esticar. O `FitAddon` do xterm calculava `rows: 1` (cols normal, ~93),
  terminal virava uma sessão real rodando (`bash`/`claude` vivos) só que espremida numa altura
  inútil — daí "tela preta, não abre, nada muda". Corrigido: `flex` adicionado no container de
  `WorkspaceView.tsx`, `flex-1` adicionado na `<section>` de `PaneView.tsx`. Isso nunca foi pego
  porque os testes cobrem a árvore do reducer, não o layout CSS real — "Validação visual no
  Tauri" (Fase 1, ainda pendente) é exatamente o item que teria pegado isso.
- Junto: `resizeTerminal()` no `ResizeObserver` de `TerminalPane.tsx` não tinha `.catch()` —
  gerava unhandled promise rejection no console sempre que a sessão não existia mais. Corrigido.
- **Shell padrão do terminal agora é Git Bash**, não PowerShell (`default_shell()` em
  `crates/omni-engine/src/main.rs`, checa `%ProgramFiles%\Git\bin\bash.exe` e
  `...\Git\usr\bin\bash.exe`, cai pra `powershell.exe` só se nenhum existir). Pedido explícito
  do usuário em 2026-08-27.
- **Armadilha de dev**: `cargo test -p omni-engine` (e qualquer `cargo build`/`check` direto na
  crate) recria `target/debug/omni-engine.exe` — um binário genérico no mesmo diretório de
  `target/debug/omni-agents.exe`. Antes de 2026-08-27, `engine_client.rs::engine_executable()`
  priorizava esse "vizinho" sobre o binário de verdade que `scripts/build-engine.mjs` gera em
  `src-tauri/binaries/`, então rodar `cargo test` e depois `npm run build:engine` **não**
  atualizava o engine de fato usado em `tauri dev` — o app continuava servindo código velho
  silenciosamente. Corrigido: em build de debug (`cfg!(debug_assertions)`), o caminho de
  `src-tauri/binaries/` é checado primeiro. Se o engine já estava rodando, ele não se
  autoatualiza sozinho — é preciso um `Shutdown` explícito (ou fechar/reabrir) pra
  `ensure_engine()` respawnar com o binário novo.
- A árvore de layout usa `ratio` normalizado e limita cada lado a no mínimo 20%.
- A última pane não pode ser fechada; fechar uma folha colapsa o split pai.
- A última pane pode ficar sem tabs (`activeTabId: null`); esse estado deve sobreviver ao reload.
  Fechar a última tab de uma pane secundária continua colapsando o split automaticamente.
- O conteúdo das panes ainda é placeholder intencional. Terminal e agentes dependem do engine
  persistente das Fases 2 e 3.
- A documentação `README.md`, `RESUME.md` e partes antigas de `CLAUDE.md` ainda descrevem
  CAMPS-UTILS e precisam de uma limpeza editorial própria.

## Release 0.4.0 (2026-09-14)

- Versão sincronizada em `VERSION`, `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `Cargo.lock` e `src-tauri/tauri.conf.json`.
- Novidades registradas em `src/lib/changelog.ts`: acesso pelo celular, ícones de arquivos, terminais, isolamento do desenvolvimento e atualização do engine no instalador.
- Validação: 169 testes frontend, TypeScript e 39 testes Rust aprovados; fixture manual de navegador ignorado.
- Build de produção compilado. O empacotamento MSI falhou ao executar `light.exe`; a distribuição utiliza NSIS, como as releases anteriores, via `npx tauri build --bundles nsis`.
- Publicação prevista em `v0.4.0` com instalador Windows x64, assinatura do updater e `latest.json`.
- Acesso por celular real/4G e instalação interativa não foram revalidados nesta preparação.
- Publicação concluída: https://github.com/FelipeCamposM/OMNI-AGENTS/releases/tag/v0.4.0 (commit `6e07e4f401f256b30bdbf2379cf3382df943072f`), release normal e mais recente.
- NSIS assinado gerado com sucesso; assinatura Ed25519 validada com a chave pública do updater. SHA-256 local e remoto: `0aff9282cc29b51679e9732c4c289c4034d93e37c7d961c90748e65de6fbce0c`.
- Os três assets foram publicados; `latest.json` baixado do GitHub é idêntico ao manifesto local da 0.4.0.

## Quick open (Ctrl+P) e árvore que se atualiza (2026-09-15)

- [x] **Ctrl+P** abre busca fuzzy de arquivos do projeto ativo, igual VS Code
  (`src/features/files/QuickOpen.tsx`, montado em `src/App.tsx`). Listener em captura na `window`,
  então funciona até com foco no terminal (o xterm não recebe o ^P). Setas + Enter abrem na pane ativa,
  Esc fecha. Índice recursivo refeito a cada abertura por `listAllFiles()` em `filesService.ts`
  (mesmo ignore da árvore, dotfiles incluídos, teto de 20k arquivos).
- [x] `.env` sumindo da aba Files: nada no código filtra dotfile (`readDir` do plugin-fs lista tudo no
  Windows e o render mostra — conferido em teste). A causa encontrada foi a árvore **nunca recarregar**
  depois de abrir o projeto: arquivo criado por agente/editor externo não aparecia. `useFileTree.ts`
  agora relê raiz + pastas abertas via `usePoll` (5s, só troca estado se mudou).
- Testes: `src/test/QuickOpen.test.tsx`. `kindFor` do `FileTree.tsx` virou `fileKind` em `filesService.ts`.
- Próximo: validar no Tauri; se `.env` continuar sumido num projeto específico, investigar esse caminho.

## Avisos só para "terminou" e "pediu aprovação" (2026-09-15)

- [x] Causa: o engine chamava de `answered` qualquer sessão com 1,5s sem saída (digitar no shell, log
  de dev server, pausa do agente) e de `approval_required` qualquer chunk com "do you want to"/"(y/n)"
  — inclusive texto da resposta do agente. O toast disparava em cima disso.
- [x] Engine (`crates/omni-engine/src/main.rs`): Claude/Codex agora têm estado lido da tela vt100.
  Aprovação = `interaction::approval()` (diálogo real, reconhecimento estrito). Fim de turno = o agente
  mostrou "esc to interrupt" (`Interaction.turn_active`), a hint sumiu e passou 1,5s sem saída
  (`settle_state`/`settle`). Cada um desses eventos sobe `TerminalSession.attention_seq`
  (`crates/omni-protocol/src/lib.rs`). Shell puro e outros CLIs mantêm o palpite por ociosidade só
  para exibição e nunca sobem o contador.
- [x] Desktop: `useAttentionNotifier.ts` notifica quando `attention_seq` muda com estado
  `answered`/`approval_required` — um toast por evento, nunca por travou/parou/órfã/shell, nem pelo
  que já estava pendente ao abrir o app. Usa `all` de `useAttention` (sem o filtro "já visto"), pra
  redesenho do CLI não ressuscitar aviso antigo. Evento que chega com a janela em foco conta como avisado.
- Testes: `only_a_real_agent_turn_ending_counts_as_attention` (Rust) e `useAttentionNotifier.test.tsx`.
- Próximo: validar no Tauri com Claude real (turno longo com ferramenta, aprovação, Esc). Precisa
  `npm run build:engine` e reiniciar o engine — o que está rodando é o binário velho.

## macOS e Linux + CI de release (2026-09-15)

Guia completo (release, primeira abertura no Mac, SmartScreen, roteiro de teste) em
`docs/multiplataforma.md`.

- [x] Pasta de dados portável: `omni_protocol::local_data_root()` (LOCALAPPDATA / `~/Library/Application
  Support` / XDG). Usada por `engine_dir` do engine e do app; `profiles_root` cai nela sem `APPDATA`.
- [x] Terminais em macOS/Linux abrem `$SHELL -l` (PATH do Homebrew/`~/.local/bin`).
- [x] `import_login_shell_path` (`src-tauri/src/engine_client.rs`), chamado no `run()`: app aberto
  pelo Finder/menu importa o PATH do shell de login (timeout 3 s).
- [x] `provider_running` fora do Windows via `ps -A -o pid,ppid,args` (`agent_descends_from`, testado).
  Religa `/usage`, prompt e aprovação pelo celular.
- [x] Login do agente: Terminal.app via `osascript` no macOS; x-terminal-emulator/gnome-terminal/
  konsole/xfce4-terminal/xterm no Linux. Variáveis de conta escritas no script.
- [x] Tailscale do app oficial no macOS (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`).
- [x] Claude no macOS guarda token no Keychain: conta conectada detectada por `oauthAccount` no `.claude.json`.
- [x] Engine desatualizado depois de update: `Pong` leva `engine_exe` + `engine_exe_modified_ms`;
  `ensure_engine` compara com o arquivo em disco e reinicia (equivalente ao hook do NSIS).
- [x] `scripts/build-engine.mjs --target <triple>`, incluindo `universal-apple-darwin` (lipo); triple
  padrão = host do `rustc`. `src-tauri/build.rs` expõe `OMNI_TARGET_TRIPLE` para o caminho de dev.
- [x] `tauri.conf.json`: `bundle.macOS.signingIdentity "-"` (ad-hoc, sem Apple Developer), mínimo 11.0.
- [x] `.github/workflows/ci.yml` (testes do engine + `cargo check` do app nas 3 plataformas; front no
  Ubuntu) e `release.yml` (tag `v*` → rascunho com instaladores + `latest.json` unificado via tauri-action).
- Verificado local: Windows (`cargo test` engine/app, vitest 183, typecheck); `cargo check --tests`
  do engine para `x86_64-unknown-linux-gnu` e `aarch64-apple-darwin`. App Tauri para macOS não compila
  fora do Mac (objc precisa do `cc` da Apple) — **primeira prova real é o CI**.
- [ ] Rodar o CI (push) e corrigir o que quebrar em macOS/Linux.
- [ ] Cadastrar secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` no GitHub.
- [ ] Teste do amigo no Mac (roteiro no doc), incluindo update N→N+1.
- [ ] Atalhos usam Ctrl no macOS (Cmd seria o esperado).
- [ ] Risco AppImage: engine sobrevive ao app, mas a imagem montada some ao fechar.
- [ ] SmartScreen no Windows: exige certificado Authenticode (decisão de custo pendente).

## Histórico de conversas Claude/Codex (2026-09-15)

- [x] Tela **Histórico** (rodapé da sidebar, `view === "history"` em `src/App.tsx`), com abas Claude e
  Codex separadas, busca por palavras (título, primeiro prompt, pasta, id), filtro por projeto e por
  conta (aparece com mais de uma), prévia das mensagens em markdown e **Retomar no terminal**.
  UI em `src/features/history/HistoryView.tsx`; filtro e comando em `historyService.ts`.
- [x] Fonte: transcripts nativos de todas as contas cadastradas, abertos pelo OMNI ou não
  (`crates/omni-core/src/history.rs`). Claude: `<config>/projects/<slug>/<uuid>.jsonl`, título do último
  `ai-title`. Codex: `<config>/sessions/**/rollout-*.jsonl` + título do `session_index.jsonl`. Sessão sem
  prompt digitado é descartada; texto injetado pelo CLI (`<...>`, AGENTS.md) não conta como prompt.
  Mesma sessão copiada entre contas aparece uma vez. Cache por mtime+tamanho em `src-tauri/src/history.rs`
  (medido nesta máquina: 39 conversas Claude/248 MB em 0,7s na primeira leitura, 7ms depois).
- [x] Leitura de transcript valida que o caminho está dentro da pasta de uma conta do provider.
- [x] Retomar: acha o projeto pela pasta em qualquer workspace (ou adiciona ao workspace ativo —
  `ADD_PROJECT` ganhou `id` opcional), abre `claude --resume <id>` / `codex resume <id>` na conta da
  conversa e foca a sessão.
- Testes: `history::tests` (Rust) e `src/test/historyService.test.ts`.
- Limites conhecidos: busca não olha o conteúdo inteiro das mensagens; prévia mostra as últimas 400;
  conversa retomada não entra no índice `conversations.json` (celular não a vê como conversa do OMNI).
- Próximo: validar no Tauri (visual e retomada real nos dois CLIs).

## Opacidade dos terminais (2026-09-15)

- [x] Configurações → Fundo → **Opacidade dos terminais** (`terminalOpacity`, 0–100, padrão 100 = visual
  de antes). `useSettings.ts` grava `--terminal-opacity`; `TerminalPane.tsx` usa xterm com
  `allowTransparency` e fundo transparente, e o container pinta `rgb(14 14 20 / var(--terminal-opacity))`.
  `PaneView.tsx` tira o `bg-bg-surface/90` do painel em abas terminal/agente, senão ele cobria o fundo.
- Próximo: conferir legibilidade no Tauri com fundo animado e com imagem customizada.
- [x] **Fundo continuava escondido:** o `xterm.css` (v6) pinta `.xterm .xterm-viewport` de `#000` e o
  tema transparente só limpa o elemento de rolagem — viewport preto cobria tudo em qualquer opacidade.
  `src/index.css` (fim, fora de `@layer`, `!important` porque o xterm.css carrega depois) deixa o
  viewport transparente. Medido no Edge headless com xterm 6 real: antes `xterm-viewport => rgb(0,0,0)`,
  depois só a cor do container com `--terminal-opacity`.

## Árvore de arquivos: criar inline e item preso ao ponteiro no arrasto (2026-09-15)

- [x] "Novo arquivo"/"Nova pasta" não usam mais `window.prompt`: linha de nome (`NewEntryInput`)
  aparece dentro da árvore, no topo da pasta de destino (abre a pasta se estiver fechada). Enter ou
  sair do campo cria; Esc ou nome vazio cancela. Arquivo criado abre numa tab.
- [x] Arrasto interno mostra `DragGhost` (ícone + nome) num portal preso ao ponteiro, com
  `pointer-events: none` para o `elementFromPoint` do drop continuar vendo a árvore. Posição via ref
  (sem re-render por pointermove); cursor `grabbing` durante o arrasto.
- Tudo em `src/components/FileTree.tsx`; teste `src/test/FileTree.test.tsx`. Não conferido no app.

## `/usage` do Claude confiável: lê o cache que o próprio CLI grava (2026-09-15)

Relato: clicar no uso do rodapé "às vezes carrega, às vezes não".

- Diagnóstico com sessão real: a consulta funcionava (425 ms) num painel de 58 linhas, mas o diálogo
  do `/usage` tem ~40 linhas e a lista "What's contributing" cresce depois do "Scanning" — num painel
  baixo os limites saem da tela e o parser falhava. Na falha o engine não mandava Esc: o diálogo
  ficava aberto e travava as próximas. Sucesso cacheado 5 min e falha 15 s mascaravam o clique.
- [x] Fonte nova: `cachedUsageUtilization` do `.claude.json` (Claude Code 2.1.272 grava a cada
  `/usage`; `fetchedAtMs` bateu com a consulta disparada). `omni_core::usage::read_claude_cache` +
  `claude_state_path` (perfil nativo `~/.claude.json`, isolado `<config_dir>/.claude.json`), valida
  `accountUuid`. Reset vira timestamp exato.
- [x] `interaction::account_usage` reescrito: `refresh:false` só lê o arquivo; `refresh:true` digita
  `/usage` em sessão ociosa, espera `fetchedAtMs` mudar (12 s, tela como plano B), **sempre** fecha o
  diálogo aberto com Esc; clique com leitura < 20 s não digita; sem sessão ociosa devolve a última
  leitura com motivo. Removido `EngineState.usage_cache`.
- [x] Rodapé (`ClaudeUsageStatus.tsx`) relê o arquivo a cada 30 s; reset curto (`11:40` hoje, `17/09 14:00`).
- Verificado: testes `claude_cache_reads_real_shape_and_rejects_other_account`,
  `claude_state_path_follows_profile_isolation`; engine novo isolado (pasta/porta temporárias) leu o
  `~/.claude.json` real (34%/61%). **Não validado:** clique no app — o engine instalado é o 0.4.2.
- Docs: `docs/mobile-and-account-usage.md`.
- Relato "não funciona" logo depois: os dois engines vivos eram anteriores à mudança (instalado 0.4.2;
  dev compilado 06:49, fonte alterada 07:01–07:05). `tauri dev` não recompila o engine — rodar
  `npm run build:engine` depois de mexer em `crates/`. Refeito às 07:10: engine de dev responde
  `source: claude_cache` 34%/61%.

## Arrastar abas entre painéis com prévia do destino (2026-09-15)

Pedido: arrastar abas para outros painéis e para as bordas (dividir), vendo onde a aba vai ficar.

**Causa de não funcionar:** abas de agente/terminal usavam HTML5 DnD, que o webview do Tauri no Windows
não entrega com `dragDropEnabled` ligado (o drop de arquivos do Explorer na árvore precisa dele). Só abas
de arquivo arrastavam, por pointer events, e o destino eram 5 botões de texto sem prévia de área.

- [x] `src/features/workspace/tabPointerDrag.ts` (era `fileTabDrag.ts`): um controle para **todas** as abas.
  `dropZone()` decide pela posição: sobre o cabeçalho = mover; borda mais próxima até 30% = dividir;
  resto = mover. Emite `TAB_DRAG_EVENT` só quando o destino muda; fantasma com o nome da aba preso ao
  ponteiro; Esc/blur/pointercancel cancelam.
- [x] `PaneView.tsx`: `data-drop-pane` na seção e prévia translúcida (metade do painel na borda, painel
  inteiro no centro) com rótulo "Dividir à direita"/"Mover para este painel", animada
  (`motion-reduce:transition-none`). Sem prévia onde soltar não faria nada (centro do próprio painel,
  borda do próprio painel com uma aba só).
- [x] `workspaceReducer.ts`: `SPLIT_WITH_TAB` no próprio painel com a única aba vira no-op (antes, com
  painel único, esvaziava o painel e criava outro ao lado).
- [x] `WorkspaceTabBar.tsx`/`tabDrag.ts`/`TabDropOverlay.tsx`: removido o HTML5 das abas; o overlay de
  botões ficou só para arrastar o painel inteiro pelo cabeçalho.
- Verificado: `src/test/PaneView.test.tsx` (5 tipos de aba, 4 bordas, cabeçalho, próprio painel, Esc,
  `dropZone`), `workspaceReducer.test.ts`; `node scripts/test-tab-drag-browser.mjs` no Edge real (aba de
  agente → borda direita: prévia `right` e `SPLIT_WITH_TAB` horizontal/after). 194 testes, typecheck ok.
- [x] **Regressão corrigida:** clicar numa aba parou de trocar de aba. `setPointerCapture` no
  pointerdown faz o `click` ir para o wrapper que capturou, não para o botão da aba. Agora a captura só
  acontece depois do limiar de 6 px. O harness do Edge clica numa aba antes de arrastar e reprova se não
  vier `SELECT_TAB` (conferido que reprova com a captura antiga).
- [ ] Arrastar o painel inteiro pelo cabeçalho continua HTML5 — mesmo problema no Windows. Migrar para o
  mesmo controle se for pedido.
- [ ] Não conferido no app Tauri.

## Release v0.4.3 (2026-09-15)

- [x] `VERSION` 0.4.3 + `version:sync`; entrada em `src/lib/changelog.ts` (arraste de abas com prévia,
  reiniciar volta à conversa do Claude, uso da conta confiável, transparência real dos terminais).
- [x] Verificado antes do build: typecheck, 194 testes front, `cargo test --workspace`, harness do Edge
  (`scripts/test-tab-drag-browser.mjs`).
- [x] `npm run build` assinado + `npm run release`; commit `ee38a6e` em `main`.
- [x] Release `v0.4.3` no GitHub (não pre-release) com `OMNI.AGENTS_0.4.3_x64-setup.exe`, `.sig` e
  `latest.json`. Conferido: `releases/latest/download/latest.json` responde `0.4.3` e o instalador baixa
  (200, 6.492.665 bytes).
- Gotcha: `gh release create --target` recusa SHA curto (`Release.target_commitish is invalid`) — passar
  o SHA completo ou o nome do branch.
- [ ] Não conferido no app instalado: atualização 0.4.2 → 0.4.3, arraste de abas no Tauri e reinício
  retomando a conversa.

### `/usage` mostrava número velho (34% com 53% real) — 2026-09-15

- Causa: o arquivo só muda quando alguém roda `/usage`; o app de dev não tinha agente Claude, então o
  ↻ nunca consultava e o rodapé exibia a leitura das 06:57.
- [x] Sem agente ocioso, o engine abre um **Claude oculto** (sessão headless na pasta do engine,
  `SessionOrigin.headless`), roda `/usage`, lê o arquivo e encerra (`end_hidden_claude`: Esc, `/exit`,
  e `taskkill /T` se o `claude.exe` sobreviver — matar só a sessão deixava o neto órfão no Windows).
- [x] Diálogo de confiança da pasta (2.1.272 vem com **"No, exit" selecionado**): `trust_dialog_keys`
  navega com seta até "Yes, …" e só confirma quando a tela mostra o `❯` nela. Testado.
- [x] Pronto = `fetchedAtMs` mudou, ou "Refreshing…" apareceu e sumiu + 1,5 s. Medido: o Claude não
  busca de novo se consultou há poucos minutos (4 min depois repetiu; 7 min depois buscou) — nesse
  intervalo o arquivo é o valor atual. Leitura < 60 s não consulta.
- [x] `engine_client::send_request`: `AccountUsage` em conexão própria (timeout 60 s). Na conexão
  compartilhada ela segurava o lock e congelava terminais/polls durante a consulta.
- Medido com engine isolado: 3,7–7,6 s por consulta; 5H 61% → 63% acompanhando o consumo real; nenhuma
  sessão ou `claude.exe` sobrando na versão final.
- Engine de dev recompilado. **App instalado** só com build + instalação.

### Marcas das CLIs na interface — 2026-09-16

- [x] `src/components/ui/AgentIcon.tsx`: `ClaudeIcon` (16×16, `#d97757`), `GptIcon` (57×57) e
  `CursorIcon` (33×35 numa caixa 35×35), traçados das artes de referência na grade nativa de cada
  uma. Ficam fora de `PixelIcon.tsx` porque aquele arquivo é gerado do `pixelarticons`, que não traz
  logos. GPT e Cursor herdam a cor do texto — as duas marcas são pretas e sumiriam no tema escuro.
- [x] `SelectOption.icon` e `SegmentedOption.icon` (`src/components/ui/`): slot opcional à esquerda do
  rótulo, usado pelo seletor de CLI e pelo filtro de provider do Histórico.
- [x] Marca ao lado do nome em: seletor de CLI e botão "Abrir <agente>" (`AgentLauncher`), lista de
  conexões (`AgentConnections`), "Trocar de IA" (`AgentSwitcher`), filtro e autor das mensagens do
  Histórico (`HistoryView`), rodapé do uso (`ClaudeUsageStatus`), lista de terminais do menu lateral
  (`Sidebar`) e, no celular, lista de conversas, cabeçalho do chat e autor do balão (`MobileApp`,
  `Chat`).
- [x] Aba de agente troca o ícone de conversa pela marca da CLI (`WorkspaceTabBar`). Duas fontes
  porque nem toda aba nasce do seletor: `WorkspaceTab.provider`, gravado no `BIND_TAB_RESOURCE`
  (imediato), e `SessionProvidersContext` (`src/features/terminal/sessionProviders.tsx`), alimentado
  pelo poll de sessões — cobre aba anexada do menu lateral, duplicada ou focada por notificação.
  O campo `provider` já vinha serializado do engine; faltava no espelho TS de `TerminalSession`.
- [x] `src/test/AgentIcon.test.tsx` (5) e `src/test/WorkspaceTabBar.icon.test.tsx` (3). Suíte: 207
  testes, typecheck limpo.
- [ ] O `<select>` nativo da tela do celular não aceita ícone na opção — continua só com o texto.
- [ ] Não conferido no app instalado.

### Configurações → Skills — 2026-09-16

- [x] Aba nova em Configurações (`SectionId "skills"`), painel em
  `src/features/skills/SkillsManager.tsx`. Um escopo por conta cadastrada de Claude/Codex
  (`<config_dir>/skills`) mais o projeto aberto (`.claude/skills`), escolhidos num `Select` com a
  marca da CLI. Mostra o caminho real e o contador de ativas.
- [x] Ações: **instalar** (escolhe pasta com `SKILL.md` na raiz e copia recursivamente),
  **ativar/desativar**, **remover** (com confirmação em dois passos) e **abrir pasta** no Explorer.
- [x] Desativar move a pasta para `skills-disabled/` ao lado de `skills/`. Não existe flag de
  "desativada" no formato e a CLI descobre skill varrendo `skills/`; mexer no `SKILL.md` de uma
  skill em link mudaria o original, que outras CLIs também usam.
- [x] **Bug corrigido na raiz:** `readDir` do plugin usa `entry.file_type()`, que não segue link —
  skill instalada como link chegava com `isDirectory: false` e o filtro antigo de `listProjectSkills`
  descartava. Nesta máquina eram 11 das 12 skills globais. O leitor compartilhado agora aceita
  `isDirectory || isSymlink` e confirma pelo `exists(SKILL.md)`, que segue link. Vale também para a
  lista da barra lateral, que usa o mesmo leitor.
- [x] Remover usa `recursive: !symlink`: com `recursive: true` o plugin chama `remove_dir_all` e
  levaria junto a pasta original compartilhada. Em link, `remove_dir` apaga só o link (conferido no
  código de `tauri-plugin-fs` 2.5.1).
- [x] `src/test/skillsManage.test.ts` (12) cobrindo escopos, link, ativar/desativar com conflito,
  remoção de link e instalação. Suíte: 230 testes, typecheck limpo.
- [ ] Skills de **plugin** (`~/.claude/plugins/`) não entram na lista — são geridas por
  `enabledPlugins` no `settings.json`, outro mecanismo.
- [ ] Escopo de projeto só cobre `.claude/skills`; não foi confirmado se o Codex lê `.codex/skills`
  dentro do projeto.
- [ ] Não conferido no app instalado.

### CLI do Cursor virou `agent` — 2026-09-16

- [x] `AGENT_CLIS` em `src-tauri/src/engine_client.rs`: candidatos do Cursor passam a
  `["agent", "cursor-agent"]`. O nome novo vem primeiro; o antigo fica no fim para quem não
  atualizou o Cursor. Conferido nesta máquina: o instalador deixa `agent.cmd` e `cursor-agent.cmd`
  lado a lado em `%LOCALAPPDATA%\cursor-agent`, e `.CMD` está no `PATHEXT`, então `resolve_on_path`
  acha os dois — com a ordem nova, abre pelo `agent`.
- [x] `FALLBACK_AGENTS` do `AgentLauncher.tsx` e o fixture de `AgentConnections.test.tsx` seguem o
  mesmo nome (é o que aparece na UI antes de o `invoke` responder).
- [x] Verificado: typecheck, 235 testes front, `cargo check`.
- [ ] **Achado, não corrigido:** `provider_running` (`crates/omni-engine/src/interaction.rs`) procura
  o processo por `{provider}.exe`, ou seja `cursor.exe` — nunca casou com `cursor-agent.exe` nem casa
  com `agent.exe`. Afeta só a checagem de sessão ociosa (celular/headless) do Cursor.
- [ ] Não conferido no app instalado.

### Rodapé: uso do agente em foco, com barra colorida — 2026-09-16

- [x] `ClaudeUsageStatus` virou `AgentUsageStatus` (arquivo e teste renomeados). Não é mais só do
  Claude: quem manda é a **aba em foco**. `WorkspaceView` acha a pane ativa (`findPane`, agora
  exportado do reducer), pega a aba ativa dela e passa o `resourceId` como `activeSessionId`.
- [x] Barra de progresso por janela (5H e SEMANA) com as faixas pedidas: verde até 60%, amarelo até
  85%, vermelho de 86% em diante (`usageTone`). O corte é por valor, não por arredondamento — 85,4%
  já é vermelho. O número acompanha a mesma cor. `role="progressbar"` com `aria-valuenow`.
- [x] Modelo e esforço da sessão em foco ao lado do nome do provider, lidos do mesmo `agent_runtime`
  que alimenta a etiqueta da pane, relidos a cada 30 s (um `/model` no meio da conversa troca os
  dois). Deps do efeito são os campos da sessão, não o objeto: o poll devolve objetos novos a cada
  segundo e depender dele piscaria o texto.
- [x] `SessionProvidersContext` passou a carregar a `TerminalSession` inteira por id (antes só o
  provider). `useSessionProvider` continua para a barra de abas; `useSession` serve o rodapé.
  `TerminalSession` no TS ganhou `profile_id` e `external_session_id`, que já vinham do engine.
- [x] Aba que não é de agente (terminal puro, arquivo, kanban) cai na conta usada mais recentemente
  entre Claude e Codex — esvaziar o rodapé a cada clique num arquivo seria pior.
- [x] `src/test/AgentUsageStatus.test.tsx` (5): cache ao abrir, `/usage` só no botão, troca de agente
  pela aba em foco com modelo/esforço, largura e cor da barra, e as três faixas. Suíte: 238 testes.
- [ ] **Cursor não tem número para mostrar:** `account_usage` responde `unavailable` ("Provider sem
  consulta de uso") e `agent_runtime` responde `None` para ele. O rodapé exibe CURSOR com `—` nas
  duas janelas e o `!` do motivo. Para ter uso e modelo do Cursor é preciso uma fonte nova em
  `omni-core` (`usage.rs` e `runtime.rs`).
- [ ] Não conferido no app instalado.

### Logo temática, e o ícone da janela junto — 2026-09-16

- [x] `assets/omni-agents-pixel-themeable.svg` (708 `<rect>`, 6 camadas) virou
  `src/components/ui/OmniLogo.tsx`: um `path` por camada, 3× menor que os retângulos originais.
  Conversão conferida por round-trip — os 708 retângulos voltam idênticos do path.
- [x] Cada camada pinta com `var(--omni-<camada>, <hex laranja>)`. O `<style>` do SVG original saiu
  de propósito: inline no documento, `.shadow`/`.primary`/`.accent` são nomes genéricos demais e
  vazariam para o resto da página (`.shadow` é utilitário do Tailwind).
- [x] `coresDaLogo` (`src/lib/palettes.ts`) deriva a rampa das duas cores da paleta com os
  `clarear`/`escurecer` que já existiam: contorno (deep escurecido 72%) → sombra (deep) → cor
  (base) → base+22% branco → base+55% branco → branco. `useSettings` escreve as seis no `<html>`
  junto com `--c-accent`, então a logo acompanha paleta **e** variante clara/escura.
- [x] `viewBox` recortado para `2 1 63 63`: a arte nasce 47×61 numa tela 64×66 cheia de margem
  morta, e usá-la crua esmagava a logo no slot `w-7 h-7` da barra lateral.
- [x] **Ícone da janela/barra de tarefas** repintado em tempo real
  (`src/features/appIcon.ts`): `svgDaLogo` monta o SVG com as cores literais, rasteriza num canvas
  252×252 (63 × 4, múltiplo inteiro para o pixel sair quadrado) e manda o RGBA cru para
  `Image.new` + `setIcon`. RGBA em vez de PNG porque `Image.new` não exige a feature `image-png` no
  Rust. Guarda a última assinatura de cor para não repintar à toa. Permissão nova:
  `core:window:allow-set-icon` em `src-tauri/capabilities/default.json` (validada por `cargo check`).
- [x] `src/test/OmniLogo.test.tsx` (7): camadas por var, pixel art sem curva, viewBox quadrado,
  markup do ícone sem `var()`, e a rampa em todas as 9 paletas nos dois temas. Suíte: 245 testes.
- [ ] **Não muda em tempo real:** o ícone do atalho fixado, o do instalador e o do Explorer — esses
  são o `.ico` gravado no executável (`src-tauri/icons/`), e trocar exigiria reinstalar. Só a janela
  viva recebe a cor da paleta.
- [ ] Não conferido no app rodando (typecheck, 245 testes e `cargo check` apenas).

### Fechar aba com o botão do meio — 2026-09-16

- [x] `WorkspaceTabBar`: `auxclick` com `button === 1` chama o mesmo `onCloseTab` do ×, então vale
  para qualquer tipo de aba e segue o mesmo fluxo de fechamento. `mousedown` do meio tem
  `preventDefault` para não abrir a rolagem automática do Windows. O arraste já ignorava botão ≠ 0.
- [x] 2 testes em `src/test/WorkspaceTabBar.icon.test.tsx`. Não conferido no app rodando.

### Retomar conversa escolhida no Novo agente — 2026-09-16

- [x] "Retomar conversa" do `AgentLauncher` agora abre o `HistoryView` dentro da própria pane,
  travado na CLI escolhida e na pasta do projeto (prop `lock`, que esconde provider e seletor de
  projeto). Clicar mostra as mensagens; "Retomar no terminal" lança `resumeCommand` na conta em que
  a conversa foi gravada. "Continuar a última" (`--continue`/`resume --last`) e "Voltar" ficam no
  cabeçalho (prop `actions`).
- [x] `begin_conversation` (`src-tauri/src/conversations.rs`): comando com `--resume <id>` reaproveita
  o id (transcript certo) e não soma `--session-id` novo. Teste `resumed_session_id_reads_resume_flag`.
- [x] `src/test/AgentLauncher.resume.test.tsx`. Suíte: 248 testes. Não conferido no app rodando.
- [ ] A ver: `claude --continue` ainda recebe `--session-id` somado — conferir se o Claude aceita
  a combinação sem `--fork-session`.

### Aba preta com "session is not running" — 2026-09-17

- [x] Diagnóstico: engine e CLIs vivos, sem crash nem corte de scrollback. A aba guardava o id de uma
  sessão que o engine só conhecia como **histórica** (engine reiniciado por update/reabertura, ou CLI
  que saiu). Snapshot de histórica volta vazio (`next_seq` 0) → tela preta; `write_terminal` →
  "session is not running". Trocar de aba/minimizar só remontava a pane e expunha isso.
- [x] `TerminalPane`: religa sozinho com `restartTerminal` (mesmo id; Claude volta com `--resume`)
  quando a primeira leitura mostra sessão histórica parada, e quando digitar dá "session is not
  running". O banner, nesse erro, reinicia a sessão em vez de abrir um shell novo sem agente.
- [x] 2 testes em `src/test/TerminalPane.test.tsx`. Suíte: 250. Não conferido no app rodando.
- [ ] Codex religado volta com `codex` puro (conversa nova) — `comando_ao_reiniciar` só sabe
  retomar Claude.

### QR do celular não abria — engine de dev apagava o Serve do app instalado — 2026-09-17

- **Sintoma:** o QR (`https://pc-felipe.tail68f850.ts.net/#t=…`) não abria no celular, mas a tela do
  app instalado continuava mostrando o código como pronto.
- **Diagnóstico (estado real da máquina):** `mobile.json` do instalado com `serve=true`;
  `tailscale serve status` → **"No serve config"**; HTTPS liberado no tailnet (`CertDomains`
  presente, cap `https`), iPhone online. Bundle do celular confirmado dentro do
  `omni-engine.exe` instalado (hipótese de asset faltando descartada). O `mobile.json` do **dev**
  estava `enabled=true, serve=false`.
- **Causa:** `publicar()` rodava `tailscale serve reset` em **toda subida em modo direto**. Serve é
  config do PC inteiro, então o engine de dev apagava a publicação HTTPS do instalado a cada
  `npm run dev`. A tela do instalado seguia exibindo o QR porque o `serve_state` dele é o
  resultado da publicação antiga — nada reconferia.
- [x] `crates/omni-engine/src/mobile.rs`: modo direto não toca mais no Serve na subida. Desfazer a
  publicação passou para o `settings`, só quando **este** engine deixa de publicar
  (`deixou_de_publicar`: Serve→direto ou Serve→desligado).
- [x] Mesmo nesse caso, `serve reset` só roda se a config do Tailscale for **exatamente** a nossa
  (`serve_e_so_o_nosso`: TCP só na 443, um site, uma rota `/` → `http://127.0.0.1:<porta>`, nada
  em Services/Funnel/Foreground). Qualquer outra publicação do PC fica intacta — antes o reset
  apagaria também serviços que o usuário publicou por fora.
- [x] **Testar**, no modo Serve, confere `serve status --json` e, se a rota sumiu, reinicia o
  listener (que republica) e diz isso na tela.
- [x] Tela do PC: o endereço era `<a target="_blank">`, que no Tauri não abre navegador — virou botão
  com `openUrl` e fallback para copiar. Permissão do opener ganhou `https://*.ts.net/*` e
  `http://100.*/*`; a URL é aberta com barra final porque o plugin casa `glob` na string crua e o
  engine manda o endereço sem ela. O token **não** vai para o navegador do PC.
- [x] Testes: 2 Rust novos (`reset_so_quando_a_config_do_serve_e_so_a_nossa`,
  `so_desfaz_a_publicacao_quando_este_engine_deixa_de_publicar`) e 2 no `MobileSettings.test.tsx`.
  Front 252, Rust do workspace verde, `cargo check` ok.
- [ ] **Formato do `serve status --json` populado não foi observado ao vivo** (a máquina estava sem
  publicação). As chaves seguem o `ipn.ServeConfig` (`TCP`/`Web`/`Handlers`/`Proxy`); vale conferir
  com o app rodando.
- [ ] Engine de dev e instalado continuam usando a mesma porta de celular (47322) por padrão —
  funciona porque escutam em IPs diferentes, mas o dev em modo Serve tentaria o mesmo loopback.
- [ ] Chega ao app instalado só com build + instalação.

### Painel Git sem Commit apesar de haver mudanças — 2026-09-17

- [x] `GitPanel` só lia o status ao montar: mudanças feitas pelo agente não apareciam (ficava em
  "árvore limpa"). Agora relê em silêncio a cada 3s e ao focar a janela, sem piscar "Carregando…".
- [x] Commit/Commit e push apareciam só com arquivo em stage. Agora aparecem com qualquer mudança;
  sem nada em stage, o commit faz `git add` de tudo antes (como o VS Code). Com stage, respeita.
- [x] 3 testes novos em `src/test/GitPanel.test.tsx`. Não conferido no app rodando.

### Celular: anexos, colar arquivo, tema do PC e navegação que sobrevive ao refresh — 2026-09-17

- [x] **Anexos.** Rota nova `POST /conversas/{id}/anexos` (`crates/omni-engine/src/mobile.rs`): corpo
  cru até 25 MB com limite **só nesta rota** (o global continua 32 KB), token e origem exigidos como
  no resto da API. Grava em `<cwd da conversa>/.omni-agents/anexos/<ms>-<hex>-<nome>` — a pasta sai
  da conversa registrada, nunca do celular. `nome_seguro` fica só com o último componente, troca o
  que não é `[A-Za-z0-9._-]`, recusa nomes reservados do Windows e corta nome longo preservando a
  extensão; `create_new` impede sobrescrever. Nome chega em `X-Omni-Nome` com `encodeURIComponent`.
- [x] O prompt leva os caminhos depois do texto, sob `[Anexos enviados pelo celular]` — é como as
  CLIs recebem arquivo (o PC cola pelo clipboard do próprio PC, que o celular não alcança). Só
  anexo, sem texto, também envia; o marcador abre a mensagem, nunca um caminho com `/`.
- [x] Celular (`src/mobile/Composer.tsx`, `anexos.ts`): botão de clipe (`<label>` em volta do
  `input type=file`, sem `accept`), colar arquivo/print no campo vira anexo, cartões com prévia de
  imagem e ícone por tipo (`iconForPath` do PC), remover, estado de envio, recusa local acima de
  25 MB. O caminho subido fica guardado no anexo: reenvio após timeout monta o mesmo texto e reusa
  a mesma chave de idempotência, sem duplicar arquivo. CSP do celular ganhou `img-src blob:`.
- [x] **Mesmo tema do PC.** `PublishWorkspace` leva `theme` (`PublishedTheme`: paleta, claro/escuro,
  fundo, relevo), publicado pelo `useWorkspace` junto com os projetos e devolvido em `/projetos`.
  Desktop antigo publicando sem tema mantém o último. O celular aplica com o mesmo
  `aplicarPaleta` do PC (extraído de `useSettings` para `src/lib/aplicarTema.ts`), segue o sistema
  quando o PC usa "Sistema", troca fundo animado (WebGL) pela grade de pixels e acompanha a cor da
  barra de status. Último tema fica no `localStorage` para o pareamento e o primeiro quadro.
- [x] **Visual.** Barra de cima com logo/voltar/atualizar, cartões `.glass` para projeto e conversa
  (marca do agente, ponto de estado, contagens), `SegmentedControl` e `Select` do PC, respostas do
  agente em markdown com `rehype-sanitize` (cores do `prose` mapeadas para os tokens do tema),
  horário em cada balão, anexos como cartões, aprovação em painel de alerta, pareamento com a
  `OmniLogo`. Ícones novos pelo gerador: `AttachmentIcon`, `SendIcon`, `ArrowLeftIcon`.
- [x] **Refresh não volta mais ao início.** A tela vive no endereço (`#/p/<projeto>`, `#/c/<conversa>`,
  `src/mobile/rota.ts`); o gesto de voltar do celular anda pelas telas, e aberto direto pelo
  endereço o "voltar" vai para a tela-pai. Rascunho e filtro "Atenção" ficam no `sessionStorage`.
- [x] **Chat abre no fim.** `timeline(cursor: None)` devolve as últimas 100 mensagens com
  `prev_cursor` (`crates/omni-core/src/conversations.rs`); antes abria nas 100 **mais antigas** e,
  numa conversa longa, a resposta nova nunca aparecia sem paginar. Balão otimista some também
  quando chega qualquer mensagem do usuário com índice acima da última vista no envio.
- [x] Testes: engine +4 (anexo com token/limite/pasta, nome seguro, cabeçalho com acento, tema
  publicado), core +1 (fim da conversa), celular 21 (anexar, colar, só anexo, falha de upload,
  limite, formato do prompt, refresh na conversa, rascunho, voltar, paginação, tema).
  Front 266, core 19, engine 52, `cargo check`, `npm run build:mobile`.
- [x] Conferido no navegador pelo `browser_fixture` (agora com projeto publicado, contas, transcript
  com markdown/tabela/anexos e tema por `OMNI_FIXTURE_THEME`/`OMNI_FIXTURE_ACCENT`): roxo escuro e
  verde claro. Achados corrigidos na hora: barra de cima translúcida deixando o texto vazar e faixa
  do compositor com margens transparentes. A aba de automação do Chrome se declara oculta — o poll
  pausa nela de propósito, então a checagem forçou `visibilityState`.
- [ ] Não conferido em aparelho real (iPhone/Android), nem o upload pelo Tailscale de verdade.
- [ ] A CLI lê imagem pelo caminho com a ferramenta dela; não foi medido se o Codex abre imagem
  assim tão bem quanto o Claude.
- [ ] `.omni-agents/` dentro do projeto não entra no `.gitignore` dele automaticamente.
- [ ] Chega ao app instalado só com build + instalação.

### Git Graph redesenhado — 2026-09-17

- [x] `@gitgraph/react` saiu (dependência removida). Os defeitos dele não se resolviam com template:
  etiquetas internas `lane-N`/`root-N` na tela, cores e fundo fixos (não seguiam tema claro nem a
  paleta), sem data, autor nem hash.
- [x] `src/features/git/graphLayout.ts`: trilhas no estilo do Git Graph do VS Code, em cima do
  `git log --topo-order` que o backend já entrega. Cada trilha espera um hash; o nó cai na primeira
  que o espera e as demais convergem (fork); o primeiro pai herda trilha e cor, os outros pais
  abrem trilha nova ou desembocam na que já os esperava. Trilhas não trocam de coluna enquanto
  vivem, então só há diagonal em fork e merge. Pai fora da janela encerra a trilha.
  `parseRefs` transforma o `%D` em etiquetas (branch atual, local, remoto, tag; `origin/HEAD` sai).
- [x] `GitGraphPane.tsx`: uma linha por commit — trilhas em SVG com curvas, nó quadrado (merge
  vazado, HEAD com moldura), etiquetas com a cor do ramo, mensagem (merge mais apagado), autor,
  data relativa na última semana e data depois, hash curto que copia ao clicar. Cabeçalho com
  contagem de commits/branches e botão de atualizar. Primeira cor das trilhas é a da paleta.
  Janela subiu de 200 para 500 commits.
- [x] CSS em `src/index.css` (`.gg-*`): tokens do tema, etiquetas pixel, container query que
  esconde autor (< 640 px) e data (< 460 px) quando o painel está dividido; etiquetas encolhem
  sem invadir o hash.
- [x] Conferido no navegador com uma prévia temporária (histórico sintético com develop, features,
  hotfix, merges, tags e remotos) em escuro/laranja, escuro/roxo e claro/azul, largo e estreito.
  Prévia apagada depois.
- [x] `src/test/gitGraph.test.tsx` (8): linear, merge + fork, duas pontas no mesmo pai, ramo
  paralelo, pai fora da janela, refs, render com etiquetas reais e sem `lane-`, repositório vazio.
  Front 274, typecheck, `vite build`.
- [ ] Sem virtualização: acima de 500 commits a lista corta (o cabeçalho avisa).
- [ ] Não conferido no app Tauri rodando.

## Release v0.4.5 (2026-09-17)

- [x] `VERSION` 0.4.5 + `version:sync`; entrada em `src/lib/changelog.ts` (anexos e tema no celular,
  refresh que mantém a conversa, QR que volta a abrir, Git Graph novo, logo na cor da paleta, fechar
  aba com o botão do meio, painel Git que se atualiza, retomar conversa escolhida, terminal preto
  que religa sozinho).
- [x] Verificado antes da tag, igual ao CI: typecheck, 274 testes front, `cargo test` de engine/core/
  protocolo, `cargo check -p omni-agents`.
- [x] Commit `50f15b1` + tag `v0.4.5`. Workflow `release.yml` (run 35180602064) verde nos três sistemas;
  CI verde. Rascunho conferido (`latest.json` 0.4.5 assinado para Windows/macOS/Linux) e publicado
  como **Latest**, não pre-release. `releases/latest/download/latest.json` responde 0.4.5 e o
  `OMNI.AGENTS_0.4.5_x64-setup.exe` baixa (200).
- [ ] Não conferido: atualização 0.4.4 → 0.4.5 no app instalado e o celular recebendo a tela nova
  depois do update (o engine instalado é que serve a página).

### Branch e pull no rodapé — 2026-09-17

- [x] `git_pull` novo em `src-tauri/src/git_client.rs` (`git pull --ff-only`, devolve a saída),
  registrado em `lib.rs`, com wrapper `gitPull` em `gitService.ts`.
- [x] `src/features/git/GitBranchStatus.tsx`: canto esquerdo do rodapé do workspace mostra
  `⎇ <branch>` do projeto em foco e um botão `pull` ao lado; recado do git (ou erro) fica ao lado,
  some ao clicar. Relê o status a cada 3s — quem troca de branch costuma ser o agente no terminal.
  Projeto sem git não renderiza nada. Encaixado em `WorkspaceView.tsx` junto do "UI CONNECTED".
- [x] 3 testes em `src/test/GitBranchStatus.test.tsx`. Suíte: 277. `cargo check` ok.
  Não conferido no app rodando.

### Fechar Configurações e atalhos configuráveis — 2026-09-17

- [x] Botão "Fechar" no topo das Configurações (`SettingsView.tsx`) + Esc: `App.tsx` guarda a tela
  anterior (`viewBeforeSettings`) e volta pra ela; workspace segue intacto no reducer.
- [x] `src/lib/shortcuts.ts`: lista `SHORTCUTS` (Ctrl+P, divisões, fechar/maximizar painel,
  Ctrl+Tab, Ctrl+Shift+Space, Esc), overrides em `settings.shortcuts` injetados por `useSettings`
  (mesmo padrão do `motion.ts`). `QuickOpen` e `useWorkspaceKeymap` passam a usar `matchesShortcut`.
- [x] Seção "Atalhos" nas Configurações: clica, aperta a combinação, Esc cancela; bloqueia conflito;
  "Padrão" por item e "Restaurar todos". Atalhos globais ficam mudos durante a gravação.
- [x] Divisão vertical agora é `Ctrl+Shift+|` (o antigo `key === "\\"` com Shift nunca casava).
- [x] `src/test/shortcuts.test.ts`. Suíte: 279. Não conferido no app rodando.

### Trocar e criar branch pelo rodapé — 2026-09-17

- [x] `git_checkout_branch` ganhou `create: bool` (`checkout -b`), a branch nova nascendo do HEAD
  atual. `gitCheckoutBranch(projectPath, branch, create = false)` no `gitService.ts`.
- [x] `GitBranchStatus`: clicar na branch abre um popover com campo que filtra a lista **e** serve de
  nome para a branch nova. Clicar numa branch troca; nome que não existe mostra
  "+ Criar “x” a partir de <atual>"; Enter faz o que couber (trocar se existe, criar se não). Erro do
  git (ex.: mudanças não commitadas) aparece no mesmo recado do pull.
- [x] Atalho novo `newBranch` (`Ctrl+Shift+B`, configurável em Configurações → Atalhos) abre o
  popover já no campo; escuta em captura, então funciona com o foco no terminal.
- [x] 3 testes novos em `src/test/GitBranchStatus.test.tsx` (troca, criação, atalho). `cargo check` ok.
  Não conferido no app rodando.
- [x] **Correção**: o dropdown não aparecia. O rodapé é `h-7` com `overflow-hidden`, então o popover
  `absolute` nascia dentro dele e era recortado até sumir. Agora é `fixed`, ancorado no
  `getBoundingClientRect()` do botão na abertura. Teste novo trava `fixed` (jsdom não mede recorte).

### Prompt com anexo ficava digitado no PC e nunca era enviado — 2026-09-17

- **Sintoma:** no celular, com anexo, o envio deixava a mensagem escrita no terminal do PC sem
  submeter, e o celular ficava em "trabalhando" para sempre. Sem anexo funcionava.
- **Causa:** `execute_checked` mandava colagem e Enter no **mesmo write**
  (`\x1b[200~{texto}\x1b[201~\r`). A CLI recebe a rajada inteira como colagem e engole o `\r`. Com
  anexo o prompt vira multi-linha e a CLI monta o "[Pasted text #N +L lines]" de forma assíncrona,
  então o Enter chega antes do texto entrar no campo. O mesmo problema já tinha sido resolvido no
  `/usage` (`interaction.rs`), com Enter separado — o caminho do celular ficou sem esse cuidado.
- [x] `interaction::submeter_colagem`: manda o Enter **depois** que a colagem aparece no campo
  (`composer_vazio` deixa de valer), esperando no máximo 1,2 s e mandando assim mesmo no limite —
  CLI sem eco não pode travar o envio. Fora dos locks: quem atualiza a tela é o leitor da PTY.
- [x] `execute_checked` passa a escrever em duas partes só no prompt; aprovação continua num write
  (é tecla de menu).
- [x] Celular: o balão otimista agora tem relógio próprio (2 min) e desiste avisando "Não consegui
  confirmar o envio". Antes, só saía da tela quando a mensagem aparecia no transcript ou a fila
  recusava — sem rede, girava para sempre.
- [x] Testes: 2 no engine (Enter só depois do eco da colagem; Enter no limite quando não há eco) e
  1 no celular. Front 284, engine 53, core 19, `cargo check`.
- [ ] Não conferido no app rodando: falta instalar uma versão com esta correção.

### Dispensar aviso de Atenção pelo X — 2026-09-17

- [x] `useAttention` expõe `dismiss(sessionId)`: grava o `output_seq` atual no mapa de "já visto"
  (mesmo mecanismo de quando a aba está na tela). Item volta sozinho se a sessão soltar saída nova.
- [x] `AttentionPanel.tsx`: X no canto de cada item (aparece no hover/foco), ligado via
  `Sidebar` → `App` (`onDismissAttention`). Toast do notificador não muda (usa `all`).
- [x] Testes em `useAttention.test.tsx` e `Sidebar.test.tsx`. Suíte: 290. Não conferido no app rodando.

### Projetos no WSL + lista de recentes ao abrir projeto — 2026-09-17

Etapa 1 de 3 do pedido "SSH + WSL + recentes". SSH fica para a etapa 3.

- [x] **Terminal dentro da distro** (`crates/omni-engine/src/main.rs`): `wsl_target()` reconhece
  `\wsl.localhost\<distro>\...` e `\wsl$\...`; nesse caso a PTY sobe `wsl.exe -d <distro> --cd
  <caminho linux>` em vez do shell do Windows. O ConPTY não aceita cwd em UNC, então o processo
  nasce no `%USERPROFILE%` e quem entra na pasta é o `--cd`. Teste `wsl_target_...`.
- [x] **Detecção de CLI por projeto** (`src-tauri/src/engine_client.rs`): `agent_cli_statuses` agora
  recebe `project_path`; em caminho do WSL a busca roda dentro da distro (`command -v` + arquivos de
  credencial), numa chamada `wsl.exe` só. `claude` do Windows não conta lá dentro e vice-versa.
  Comando novo `wsl_distros` (`wsl -l -q`).
- [x] `AgentLauncher` passa o caminho do projeto e, em projeto WSL, esconde o seletor de contas
  (os profiles são pastas de configuração do Windows e não atravessam a distro) e avisa isso.
- [x] **Abrir projeto** agora abre `ProjectPicker` (`src/features/projects/ProjectPicker.tsx`) antes
  do explorador: últimos 15 projetos (`src/services/recentProjectsService.ts`, localStorage), com
  etiqueta `WSL · <distro>`, botão de esquecer, "Procurar no computador…" e um
  "Procurar no WSL · <distro>" por distro, que abre o explorador já em `\wsl.localhost\<distro>\home`.
- [x] 4 testes em `src/test/ProjectPicker.test.tsx`; `App.test.tsx` passa pelo diálogo novo. Suíte:
  290. `cargo check` e testes do engine ok. Não conferido no app rodando.
- [ ] Sessão de agente em projeto WSL grava o transcript no `~/.claude` **da distro**; o índice de
  conversas do app aponta para o caminho do Windows, então etiqueta de modelo, `/usage` e histórico
  não enxergam essas sessões ainda.

### Claude local rodando sobre projeto remoto (WSL e SSH) — 2026-09-18

Objetivo: o agente continua sendo o `claude.exe` **deste PC** (conta, histórico, `/usage`, celular),
mas cada comando dele executa onde o código está. Fecha a limitação da entrega de 2026-09-17.

- [x] **Alvo de execução** em `crates/omni-core/src/targets.rs`: `Local | Wsl | Ssh`, resolvido pelo
  caminho do projeto, mais tradução de pasta e montagem de comando. Absorveu as duas cópias da regra
  do WSL (engine e Tauri). 9 testes.
- [x] **`crates/omni-shim`**: executável que o Claude recebe em `CLAUDE_CODE_SHELL_PREFIX`. Roda o
  comando no alvo (`wsl.exe --cd` / `ssh`), repassa stdin/stdout e código de saída.
- [x] **Engine** (`open_pty_and_spawn`): sessão de agente sobe shell local com o desvio no ambiente;
  aba de terminal comum continua entrando na distro/servidor. Restart e duplicate herdam.
- [x] **Git dentro do alvo** (`git_client::git_invocation`): `wsl git` / `ssh git`, para o Git do
  Windows não sujar repo Linux com CRLF e `filemode`. `git_status` parou de transformar toda falha em
  "não é repositório" — montagem caída e `dubious ownership` agora aparecem.
- [x] **SSH**: registro em `ssh.json` (`src-tauri/src/ssh.rs`, sem senha nem passphrase), formulário
  no diálogo de projetos com "Testar conexão", montagem SSHFS-Win por projeto e `ProjectPicker` que
  monta antes de abrir.
- [x] **Latência**: índice do Ctrl+P feito no alvo (`target_project_files`, `rg --files`), poll da
  árvore em 15s e do Git em 10s quando o projeto é remoto (`targetState`).
- [x] **Caminho normalizado num lugar só** (`src/lib/paths.ts`): reducer, recentes e histórico usavam
  três regras diferentes; `\wsl$\` e `\wsl.localhost\` viravam dois projetos.
- [x] **Visual**: diálogo de abrir projeto sai por `createPortal` — a `<aside>` é `sticky`, o que cria
  contexto de empilhamento e prendia o `z-50` atrás dos terminais.

**Verificado no app/CLI de verdade** (não só em teste): `claude -p` com o prefixo ligado, num projeto
em `\wsl.localhost\Ubuntu\...`, respondeu `Linux`, `/home/felipecampos/barber-app` e a branch do
repo — ou seja, ferramentas de arquivo pelo caminho montado e comandos dentro da distro. Hooks do
usuário continuam rodando no Windows. `git` pelo formato do app testado dentro da distro e por SSH.

**Três armadilhas que só apareceram testando** (e viraram teste):
1. `CLAUDE_CODE_SHELL_PREFIX` recebe o comando como argumento único e corta a string no último `" -"`
   — o prefixo tem de ser só o caminho do executável. Teste: `prefixo_do_claude_e_so_o_caminho_do_shim`.
2. O Git Bash converte variável que pareça caminho POSIX e **colapsa `\` em `\`**: `/home/ana/p`
   chegava como `C:/Program Files/Git/home/ana/p`. Por isso o shim deriva o alvo do caminho do
   Windows, e `wsl_parts` aceita UNC com uma barra só.
3. O Claude embrulha cada comando (`source snapshot … && eval '<cmd>' && pwd -P >| '/c/…/claude-XXXX-cwd'`).
   O arquivo de diretório é do Windows e não existe no alvo — o shim tira essa parte e grava ele
   mesmo. Hook chega **sem** embrulho: é assim que o shim sabe que ele roda local (`wrapper.rs`).
   `bash.exe` do PATH é o lançador do WSL, então o modo local usa o bash do Git.

Suíte: 303 testes de front, 56 do engine, 28 do core, 16 do Tauri, 3 do shim.

- [ ] **SSH não testado de ponta a ponta**: o `sshd` foi instalado no Ubuntu do WSL e a conexão por
  chave, o `git` remoto e o shim por SSH funcionaram; a **montagem SSHFS-Win não foi testada** porque
  WinFsp/SSHFS-Win não estão instalados nesta máquina.
- [ ] `cd` dentro de um comando do agente não persiste para o comando seguinte (cada chamada é uma
  invocação nova no alvo). Contornável com `cd x && cmd` na mesma chamada.
- [ ] `ssh` sem `ControlMaster` no Windows: cada comando paga handshake. Medir e, se pesar, manter um
  processo mestre no shim.

### Painel Docker (estilo extensão Containers) — 2026-09-18

- [x] `src-tauri/src/docker_client.rs`: `docker_containers` (`docker ps -a --format '{{json .}}'`, com
  projeto do Compose tirado do label) e `docker_container_action` (start/stop/restart/`rm -f`), fora
  da thread da janela. Teste de parse no Rust; conferido contra a saída real do `docker ps` da máquina.
- [x] `src/components/DockerPanel.tsx` na seção DOCKER da sidebar (antes vazia): agrupa por Compose,
  bolinha de estado, iniciar/parar, reiniciar, logs (`docker logs -f`) e shell (`docker exec -it … sh`)
  num terminal novo do projeto (`runInTerminal` em `App.tsx`), remover com confirmação inline.
  Poll de 5s só com a seção aberta. Ícones `StopIcon`/`TrashIcon` no gerador.
- [x] 3 testes em `src/test/DockerPanel.test.tsx`. Não conferido no app rodando.

## Release v0.5.0 (2026-09-18)

- [x] `VERSION` 0.5.0 + `version:sync`; entrada em `src/lib/changelog.ts` (Docker, WSL/SSH, recentes,
  branch no rodapé, Atalhos, fechar Configurações, X na Atenção, anexo do celular). README atualizado.
- [x] Verificado antes da tag, igual ao CI: `build-engine` (engine + shim), `cargo test` de
  engine/core/protocolo/shim, `cargo check -p omni-agents`, `cargo check` do shim/engine para Linux,
  typecheck, 306 testes front.
- [x] Commit `5eb5467` + tag `v0.5.0`. Workflow `release.yml` (run 35310425742) e CI (35310423129)
  verdes. Rascunho conferido (`latest.json` 0.5.0 assinado para Windows/macOS/Linux) e publicado como
  **Latest**. `releases/latest/download/latest.json` responde 0.5.0 e o `x64-setup.exe` baixa (200).
- [ ] Não conferido: atualização 0.4.5 → 0.5.0 no app instalado; SSHFS-Win sem teste de ponta a ponta.

### CLI instalada que o app não achava, e instalar sem sair do OMNI — 2026-09-20

- **Sintoma (notebook do usuário):** Claude Code instalado e funcionando no terminal, mas o OMNI
  dizia que não existia. Só passou a achar depois de editar o PATH na mão.
- **Causa:** o app herda o `PATH` de quem o abriu. Instalador que acrescenta pasta ao PATH do
  usuário não alcança processo já rodando — nem o Explorer que abre o app depois, até a próxima
  sessão. As três CLIs instalam fora das pastas clássicas: `~\.local\bin` (Claude),
  `%APPDATA%\npm` (Codex), `%LOCALAPPDATA%\cursor-agent` (Cursor).
- [x] `omni_core::cli_path::ampliar_path()`: acrescenta ao PATH do próprio processo as pastas
  conhecidas que existem e ainda não estão nele. Chamado na subida **do app e do engine** — o
  shell da PTY herda daí, então conserta detecção e execução de uma vez. Idempotente, sem
  processo novo e sem dependência nova. 2 testes (`faltando` é pura, com caixa do Windows).
- [x] Configurações → Agentes: CLI não encontrada agora mostra o comando oficial de instalação
  daquele sistema, com **Instalar** (abre um terminal visível rodando o instalador), **Copiar
  comando** e **Instruções oficiais**. Bloco novo do **Tailscale** (acesso pelo celular) com o
  download, repetido no passo 1 da aba Celular.
- [x] A tabela de comandos mora em `src-tauri/src/instalacao.rs`: o front manda só o id, então
  nada da interface vira linha de comando. Comandos conferidos nas páginas oficiais (Claude
  `code.claude.com/docs/en/setup`, Codex `learn.chatgpt.com/docs/codex/cli`, Cursor
  `cursor.com/docs/cli/installation`); Tailscale só abre o download, que é instalador gráfico.
  Permissões do opener ganharam esses domínios. 2 testes Rust + 2 no front.
- [x] Consertado de passagem: 3 construtores de teste em `omni-core/conversations.rs` ficaram sem
  o campo `title_source` (trabalho em andamento de outra sessão) e o workspace não compilava.
- [ ] Engine que já estava rodando com o PATH velho só pega as pastas novas ao reiniciar — o texto
  da tela avisa para fechar e abrir o OMNI se a CLI não aparecer depois de instalar.
- [ ] Não conferido no app rodando.

### Nome de conversa, modo plano/auto e web para computador — 2026-09-21

**1. Conversa com nome (fonte única).**
- [x] `omni-core/conversations.rs`: campo `title_source` (`auto`/`manual`), `auto_title()` (primeira
  linha útil do primeiro prompt, 60 caracteres), `display_title()` e `rename()`. 3 testes.
- [x] Renomear passa **pelo engine** (`EngineRequest::RenameConversation` + `POST /conversas/{id}/nome`),
  para o índice ter um escritor só. Comando `rename_conversation` no Tauri chama o engine.
- [x] `list_sessions` troca `session.name` pelo nome da conversa: barra lateral, painel de atenção e
  notificação do sistema herdam sem saber o que é conversa. `App.tsx` espelha na aba pelo
  `RENAME_TAB_RESOURCE`, que passou a devolver **o mesmo estado** quando nada muda (sem isso, o
  espelho a cada poll re-renderizava a árvore inteira).
- [x] Renomear com duplo clique na aba (`WorkspaceTabBar`), na lista de sessões (`Sidebar`), no
  Histórico e no celular/web. Componente `EditableLabel` extraído do padrão do `WorkspaceList`.
- [x] Testes: `src/test/RenomearConversa.test.tsx` (3) e Rust acima.

**2. Modo plano ⇄ automático pelo celular/web.**
- [x] **Leitura**: `claude_runtime` passou a devolver `permission_mode`, lido da última linha
  `{"type":"permission-mode",…}` do transcript — mais confiável que a tela. Aparece na etiqueta do
  desktop e no `summaries()` do celular (desse, pelo rodapé, que responde na hora).
- [x] **Escrita**: `ActionKind::Modo` + `POST /conversas/{id}/modo` (só `plan`/`auto`), com o mesmo
  contrato das outras ações (`Idempotency-Key`, `If-Match`, capacidade `prompt`).
  `interaction::alternar_modo` segue o padrão do `trust_dialog_keys`: manda `\x1b[Z` (shift+tab),
  relê o rodapé, repete até 4 voltas; sem reação, tenta `\x1bm` (meta+m) e depois falha com motivo.
- [x] Botão Plano|Auto no celular e na web, travado enquanto o agente está em turno.

**3. Página web para computador (`/pc`).**
- [x] Segunda entrada no mesmo build (`mobile/pc.html`), servida pelo engine em `/pc`. O celular não
  baixa esse código (3,4 kB contra 372 kB do bundle do celular).
- [x] `src/web/WebApp.tsx` + `web.css`: três colunas (projetos e conversas · conversa · pendências),
  reusando `ConversationDetail`, `ConversationList` e `NovaSessao` do celular. Carregamento comum
  extraído para `src/mobile/useDados.ts`. **Nenhuma rota nova de API.**
- [x] Testes: `src/test/WebApp.test.tsx` (4) e, no engine, `/pc` responde 200 com a página certa.

Suíte: 315 testes de front, 61 do engine, 12 do core, 16 do Tauri.

- [ ] **Não conferido no app rodando**: a troca de modo foi testada contra os rótulos reais do
  rodapé (extraídos do binário do Claude Code) e pelo laço, mas não numa sessão viva. Vale abrir uma
  conversa e alternar pelo celular uma vez.
- [ ] `RENAME_TAB_RESOURCE` só renomeia no projeto ativo; aba de outro projeto atualiza o nome ao
  voltar para ele.

## Release v0.5.1 (2026-09-21)

- [x] `VERSION` 0.5.1 + `version:sync`; entrada em `src/lib/changelog.ts` (nome de conversa e
  renomear, modo plano/auto pelo celular/web, página `/pc`, instalar ferramenta pelo app, PATH das
  CLIs recém-instaladas).
- [x] Verificado antes da tag: typecheck, 315 testes de front, `cargo test --workspace`
  (60 engine + core/protocolo/shim), `cargo check --workspace`. Build local assinado como prova de
  que a chave e a senha ainda valem (`OMNI.AGENTS_0.5.1_x64-setup.exe` + `.sig`).
- [x] Commit `59c4e99` + tag `v0.5.1`. Workflow `release.yml` (run 35604863398) verde em 18min.
  Rascunho conferido: `latest.json` 0.5.1 com assinatura nas 11 entradas (Windows NSIS/MSI, macOS
  universal, Linux AppImage/deb/rpm) e URLs apontando para a tag certa. Publicado como release normal
  (não pre-release).
- [x] Conferido depois de publicar: `releases/latest/download/latest.json` responde **0.5.1** e o
  `x64-setup.exe` baixa (200, 6,6 MB).
- [ ] Não conferido: atualização 0.5.0 → 0.5.1 dentro do app instalado; troca de modo plano/auto numa
  sessão viva.

### Teclado lerdo no terminal — 2026-09-22

- **Sintoma (usuário):** digitar no terminal do OMNI tem atraso visível em relação à tecla.
- **Medido antes de mexer:** o engine responde um `snapshot` em **0,3ms** (mediana de 15 leituras,
  resposta de 0,6KB) e `list_sessions` em 2,6ms. Não era o engine.
- **Causa 1 — eco espera a leitura seguinte.** Não existe eco local: a letra só aparece quando a CLI
  redesenha e o `snapshot` traz. Com ritmo fixo de 100ms, cada tecla esperava de 0 a 100ms.
- [x] `TerminalPane`: ritmo adaptativo — 16ms enquanto há atividade (tecla ou saída nova), 100ms
  parado, 1s no modo de falha. 2 testes travam as duas pontas do ritmo.
- **Causa 2 — comando síncrono do Tauri roda na thread principal.** Confirmado na documentação
  ("Commands without the async keyword are executed on the main thread"). O painel Git e o rodapé
  disparavam `git_status` a cada 3s **cada um** — em projeto WSL/SSH isso é `wsl.exe`/`ssh`, ~150ms
  por chamada, congelando a interface no meio da digitação.
- [x] 43 comandos passaram a `#[tauri::command(async)]` (git, ssh, conversas, profiles, instalação,
  índice do alvo, engine). `write_terminal` e `resize_terminal` **continuam síncronos de propósito**:
  são baratos e precisam manter a ordem das teclas, que tarefas concorrentes não garantem.
- **Causa 3 (regressão desta semana):** `tab.title` estava nas dependências do efeito que monta o
  xterm, então o nome automático vindo do primeiro prompt destruía o terminal e reproduzia o
  scrollback no meio da conversa.
- [x] Título passou a ser lido de um `ref`; teste novo garante que renomear não reinicia a leitura.
- [ ] **Não medido no app rodando** (as três correções precisam de build novo para serem sentidas).
- [ ] Ainda em aberto se sobrar atraso: o xterm usa o renderizador DOM com `allowTransparency`, e o
  addon WebGL estável (0.19) não declara compatibilidade com o xterm 6.0 — o beta pede `^6.1.0-beta`.
  Próximo passo seria medir o tempo de pintura antes de trocar de renderizador.

### Aviso de atenção que voltava sozinho — 2026-09-22

- **Sintoma (usuário):** "já abri e continua apontando que não foi lido; some e volta depois que eu
  olho".
- **Causa:** o mapa de "já visto" (`useAttention`) guardava o `output_seq` da sessão, que sobe a
  **cada pedaço de saída** — e a TUI do Claude redesenha o tempo todo (rodapé, relógio, spinner).
  Bastava um redesenho para a assinatura mudar e o item voltar, sem nada ter acontecido. O sinal
  certo já existia no engine e já era usado pelo notificador: `attention_seq`, que sobe **uma vez**
  por fim de turno de verdade ou diálogo de aprovação.
- [x] `useAttention` passa a marcar visto por `attention_seq` + motivo. O motivo entra na assinatura
  porque limite de uso, erro de API e sessão travada não mexem no contador — trocar de motivo é
  evento novo e deve reacender o aviso.
- [x] 2 testes novos: redesenho não traz de volta o que já foi visto; motivo novo reacende.
  Os dois testes que fixavam o comportamento antigo (`output_seq`) foram reescritos para o contrato
  novo. 15 testes na dupla `useAttention`/`useAttentionNotifier`.
- [ ] Não conferido no app rodando — precisa de build novo.

## Release v0.5.2 (2026-09-22)

- [x] `VERSION` 0.5.2 + `version:sync`; changelog em linguagem de usuário (teclado sem atraso,
  janela sem travadinha do Git, aviso de atenção que não volta, renomear aba sem reiniciar terminal).
- [x] Verificado antes da tag: typecheck, 320 testes de front, `cargo test --workspace`.
- [x] Commit `380052c` + tag `v0.5.2`. Workflow (run 35714679085) verde em 13min40s. Rascunho
  conferido: `latest.json` 0.5.2, 11 plataformas, todas assinadas e apontando para a tag certa.
  Publicado como release normal.
- [x] Conferido depois: `releases/latest/download/latest.json` responde 0.5.2 e o `x64-setup.exe`
  baixa (200, 6,7 MB).
- [ ] **A conferir no uso**: se o teclado ainda tiver atraso perceptível depois desta versão, o
  próximo suspeito é o renderizador do xterm (DOM + transparência) — medir a pintura antes de trocar.

## Release v0.5.3 (2026-09-26)

- **O que tinha acontecido:** a primeira tentativa (tag em `e544c55`, run 36270666954) **não falhou** —
  o workflow terminou com sucesso e deixou o Release em **rascunho**, que é o desenho dele (nada chega
  ao usuário até alguém publicar). O que faltava era a correção de PATH, que estava sem commit na
  árvore e por isso não entrou naquele build.
- [x] Correção de PATH commitada (`3d9a7c0`): além das pastas clássicas, entram nvm/fnm/nvs (versões do
  Node da mais nova para a mais antiga), Volta, pnpm, bun, deno, cargo, asdf, mise, yarn, Scoop,
  WinGet, Chocolatey, nix e Homebrew/Linuxbrew, mais o que vier em `NPM_CONFIG_PREFIX` e afins. A
  varredura deixou de ser só na subida: detectar CLI, conectar conta e abrir terminal reconferem, e o
  `spawn_terminal` repassa o PATH atual ao engine (engine antigo em execução passa a ver o que foi
  instalado depois dele). 2 testes em `cli_path.rs`.
- [x] Nota de versão correspondente acrescentada na entrada 0.5.3 do changelog, em linguagem de
  usuário e sem prometer cura: é "nova tentativa", com pedido para avisar qual gerenciador faltou.
- [x] Rascunho antigo e tag `v0.5.3` apagados; tag recriada em `3d9a7c0`. Run 36271615146 verde em
  10min41s, `latest.json` 0.5.3 com 11 plataformas assinadas e apontando para a tag certa.
- [x] Publicado como release normal. `releases/latest/download/latest.json` responde 0.5.3 e o
  `x64-setup.exe` baixa (200, 6,7 MB). Suíte: 327 testes de front + `cargo test --workspace`.
- [ ] Não conferido no app instalado: se alguma CLI continuar invisível, falta saber por qual
  gerenciador ela foi instalada.

## Failover que não voltava a tentar + conta no rodapé (2026-09-26, sem release)

- **O que aconteceu:** às 18:28 a conta Padrão do Claude estourou o limite. A EmailUber já tinha login
  desde 18:18, mas a aba ficou em "sem outra conta". Em `TerminalPane.tsx`, a flag
  `failoverInProgress` só era ligada: depois de um "sem outra conta" ou de um "troca automática
  falhou", aquela aba nunca mais tentava. Qualquer detecção de limite que acontecesse antes da conta
  nova existir travava a troca de vez.
- [x] `src/features/terminal/TerminalPane.tsx`: quando não acha conta ou falha, volta a tentar a cada
  `FAILOVER_RETRY_MS` (30 s) enquanto o aviso de limite continuar na tela. Nessas novas tentativas o
  status não pisca. Teste novo em `src/test/TerminalPane.test.tsx`.
- [x] `src/features/terminal/AgentUsageStatus.tsx`: o rodapé mostra o nome da conta ao lado de
  CLAUDE/CODEX (também no tooltip e no aria-label). Se a conta for criada depois da primeira leitura,
  a lista de perfis é lida de novo. Teste novo em `src/test/AgentUsageStatus.test.tsx`.
- [x] **Causa real encontrada depois:** `omni_core::Profile.authenticated` tinha `#[serde(skip)]`,
  e isso também tirava o campo do JSON enviado ao front. Toda conta chegava sem `authenticated`, o
  failover (que filtra por ele) nunca tinha conta elegível, e Configurações mostrava "sem login".
  Agora é `skip_deserializing` + `skip_serializing_if` (vai para o front, não entra no
  `profiles.json`). Teste `computed_fields_reach_the_front_but_not_the_store` em
  `src-tauri/src/profiles.rs`.
- [x] Campo calculado `email` no `Profile`: Claude pelo `oauthAccount.emailAddress` do `.claude.json`,
  Codex pela claim `email` do `id_token` do `auth.json` (só o payload é decodificado, nada é
  guardado). Aparece em Configurações → Agentes, no diálogo "trocar conta / IA" e no tooltip do
  rodapé. Testes em `profiles.rs` e `src/test/AgentConnections.test.tsx`.
- Nota: `npm run dev` usa outra pasta de dados (`com.omni.agents.dev`). Contas criadas no app
  instalado não aparecem no dev; a EmailUber foi copiada à mão para o `profiles.json` do dev.
- [ ] Entrar numa release (changelog em linguagem de usuário).
- [x] Histórico fecha igual às Configurações: botão "Fechar" no topo (`HistoryView` recebe `onClose`)
  e Esc (atalho `closeSettings`, agora chamado "Fechar configurações e histórico"). A volta é para a
  tela de antes (`viewBeforeHistory` em `src/App.tsx`); aberto por cima das Configurações, volta
  para a tela de antes delas. Teste em `src/test/HistoryView.test.tsx`.
- [x] Failover funcionou no dev (Padrão → EmailUber), mas em seguida a aba mostrou "sem outra conta":
  o `--resume` reexibe o "Usage limit reached" da conta anterior e o engine, que lê a tela, o
  atribuiu à conta nova. `staleLimitProfileRef` em `TerminalPane.tsx` ignora o limite da conta
  recém-assumida até o aviso sair da tela uma vez. Limitação: um limite real da conta nova antes
  disso passa despercebido. Teste em `TerminalPane.test.tsx`.
- Nota: o "Histórico não fecha" relatado era o app instalado (0.5.3), aberto ao lado do dev.
- [x] Retomada **silenciosa** depois do failover, por escolha do usuário. O prompt automático
  ("retome a tarefa pendente") aparecia no terminal como se fosse do usuário e, depois de um simples
  "ola" sem resposta, fez o agente sair rodando comandos. Agora `TerminalPane.tsx` roda só o
  `claude --resume <id>` / `codex resume <id>`, e a barra da aba mostra
  "conta trocada: Padrão → EmailUber" (os detalhes e o horário de reset ficam no tooltip). Quem
  continua é o usuário. Uma tarefa longa interrompida pelo limite espera um "continue".
- [x] Configurações → Celular, passo 3: bloco "No notebook ou em outro computador" com o endereço
  `/pc/` e o botão "Copiar link do computador". O link é o do QR com `/pc` no caminho e o mesmo
  token no fragmento (`linkDoPc` em `src/features/mobile/MobileSettings.tsx`). Na tela aparece só o
  endereço; o token vai apenas no que é copiado. O notebook precisa estar no mesmo Tailscale. Testes
  em `src/test/MobileSettings.test.tsx`.
- [x] Visual da aba Celular refeito (`src/features/mobile/MobileSettings.tsx`). Cabeçalho em card
  com a logo, um selo de estado (no ar / ligando… / só neste PC / desligado / com erro) e uma barra
  de 4 passos. Cada passo virou um card `glass`, com número que vira ✓. O modo (Direto/HTTPS) virou
  dois cartões clicáveis, e o radio continua lá para teclado e leitor de tela. O QR ganhou a cor da
  paleta, moldura em degradê e a logo no centro (correção "H"). A cor dos módulos é o tom escuro da
  paleta clara (`corDoQr`); um teste garante contraste ≥ 4,5:1 em toda paleta. O `Card` das
  Configurações saiu do `SettingsView` para `src/components/ui/Card.tsx`, e a aba recebe `accent`
  por prop.

## Release v0.5.4 (2026-09-26)

- [x] Junta as correções acima: failover que funciona de verdade (`authenticated` chegando ao front),
  retomada silenciosa, conta e e-mail visíveis, Histórico que fecha com Esc/botão, aba Celular nova
  com link para computador. Changelog 0.5.4 em linguagem de usuário.
- [x] Verificado antes da tag: `version:check`, `typecheck`, 336 testes de front,
  `cargo test --workspace`.
- [x] Tag `v0.5.4` em `45ef33e`. Run 36276266360 verde nas 3 plataformas (~14 min). `latest.json`
  do rascunho conferido antes de publicar: 0.5.4, 11 plataformas assinadas, URL na tag certa.
  Publicado como release normal. `releases/latest/download/latest.json` responde 0.5.4, e o
  `x64-setup.exe` baixa (200, 6,7 MB).
- [ ] Aviso do Actions: `actions/checkout@v4` e `setup-node@v4` rodam em Node 20, que está
  depreciado (o GitHub força Node 24). Ainda não quebra, mas vale subir as versões das actions.

## Web de PC: conversa completa, terminal ao vivo e otimização (2026-10-12, sem release)

Objetivo: usar o OMNI pela web (`/pc`) como se estivesse no PC. Validado com um engine de teste
isolado, numa cópia dos dados reais, contra transcripts de até 616 MB.

- [x] **Conversa completa** (`crates/omni-core/src/feed.rs`, novo). A timeline agora traz as ações
  do agente (`kind: tool`: Bash/Read/Edit… do Claude, `exec`/`apply_patch`/`function_call` do
  Codex), `/comandos` (`kind: command`) e avisos da CLI (`kind: notice`: interrompido, compactado).
  Lembretes de sistema, `isMeta` e saídas de comando, que apareciam como mensagens do usuário,
  ficam de fora. O comando aparece como no terminal (`Rodou npm test`), sem o `cd "<pasta>" &&` inicial.
- [x] **Leitura incremental** (`FeedCache`): o transcript é lido uma vez e depois só o trecho novo.
  A última linha sem `\n` vale provisoriamente e não duplica. Na conversa de 616 MB: 5,3 s na
  primeira leitura (build de debug) e 34 ms nas seguintes; antes, a leitura inteira se repetia a
  cada 1,5 s.
- [x] **Uma chamada só para a lista**: `GET /painel` (conversas + catálogo + tema) substitui
  `/conversas` + `/atencao` + `/projetos`, e o "precisa de você" passou a ser calculado no cliente.
  `ETag`/`304` no `/painel` e na timeline: sem novidade, a resposta volta sem corpo e a tela não
  re-renderiza. A timeline traz o estado da própria conversa, então o chat não recarrega mais a lista
  a cada 1,5 s. A lista é ordenada por última atividade (`updated_at_ms`). A busca de rollouts do
  Codex roda no máximo a cada 15 s, e o histórico é aquecido na subida do servidor (1ª abertura:
  6,6 s → 0,26 s).
- [x] **Terminal ao vivo** na web (`src/web/TerminalEspelho.tsx`, carregado só ao abrir a aba):
  `GET /conversas/{id}/terminal?desde=` espelha a PTY (primeira leitura limitada a 512 KB) e
  `POST /conversas/{id}/teclas` digita nela. Respostas automáticas do xterm (DA/DSR/OSC/foco) são
  filtradas para não vazarem como texto, e a página não marca a sessão como exibida (`headless`).
  A letra se ajusta à largura; a PTY nunca é redimensionada pela web. O CSP ganhou
  `style-src 'unsafe-inline'`, que o xterm exige; `script-src` continua só `'self'`.
- [x] **Chat**: balões memorizados; ações agrupadas em bloco recolhível (o bloco do turno em andamento
  fica aberto); a tela só acompanha as mensagens novas se você já está no fim (senão aparece
  "Novas mensagens ↓"); botão **Parar** (Esc) com o agente trabalhando; Enter envia e Shift+Enter
  quebra linha com teclado físico (no celular, igual a antes).
- [x] **Layout de PC**: o cabeçalho mostra a conversa aberta (estado · agente · conta · projeto); abas
  Conversa | Terminal; coluna "Precisa de você" + "Trabalhando agora"; pendências no título da aba
  do navegador; `/` ou Ctrl+K busca; lista lateral compacta com tempo desde a última atividade.
- [x] **Bug do engine achado no teste**: engine iniciado de dentro de uma sessão do Claude passava aos
  terminais `CLAUDE_CODE_CHILD_SESSION` (o Claude não gravava transcript: "Transcript saving is
  off") e `CLAUDE_CONFIG_DIR` da conta daquela sessão (o perfil Padrão rodava na conta errada).
  `ambiente_do_terminal` agora remove essas marcas quando o engine as herdou. Teste em `main.rs`.
- Testes: `feed.rs` (5), rotas `/painel`, timeline e terminal/teclas (3), ambiente (1),
  `src/test/WebChat.test.tsx` (6). Ajustados `WebApp.test.tsx` (botão "Fechar conversa").
- Bug pego pelos testes: o ETag fica guardado no módulo; uma tela remontada recebia 304 na primeira
  leitura e ficava vazia. A primeira leitura de cada montagem agora vem inteira.
- [ ] Entrar numa release (changelog em linguagem de usuário).

## Avisos de conversa: um por conversa, e abrir limpa (2026-10-12, sem release)

Relato: "mesmo eu abrindo, os avisos voltam do nada" e "várias notificações da mesma conversa".

- [x] **Web/celular — "Precisa de você" com "já vista"**: antes, toda conversa parada esperando
  mensagem ficava pendente para sempre. Agora abrir a conversa (com a página visível) marca o pedido
  atual como visto, e ela só volta quando o agente terminar outro turno ou pedir aprovação.
  - O engine manda `attention` (`sessão:attention_seq`) no resumo da conversa (`resumo()` em
    `crates/omni-engine/src/mobile.rs`).
  - `chaveDeAtencao` em `src/mobile/api.ts`; `useDados(aberta)` em `src/mobile/useDados.ts` guarda as
    vistas em `localStorage` (`omni-vistas`, podado às conversas que existem).
  - Ligado em `WebApp.tsx` e `MobileApp.tsx`; o título da aba usa a mesma contagem.
- [x] **Engine — diálogo de aprovação redesenhado não é pedido novo**: um quadro parcial do diálogo
  passava o estado para "working", e o quadro seguinte contava outro `attention_seq`.
  `Interaction.aprovacao_contada` trava até o agente voltar a trabalhar ("esc to interrupt" sem
  diálogo) ou o turno acabar (`interaction.rs`, `append_output`/`settle` em `main.rs`).
- [x] **App do PC — visto só com quem olha**:
  - `useAttention` não grava mais "working" como visto. Olhar a aba durante um redesenho fazia o
    aviso voltar 1,5 s depois.
  - O "visto" exige a janela em foco (`src/hooks/useJanelaEmFoco.ts`, `App.tsx`). Antes, a aba ativa
    de um app minimizado contava como vista.
- [x] **Toast do Windows — um por conversa**: `useAttentionNotifier(items, enabled, naoVistos)` não
  manda outro toast da mesma sessão até ela ser vista. Três turnos com você fora geram um aviso, não
  três.
- Testes: `aprovacao_redesenhada_conta_um_aviso_so` (engine); `useAttention.test.tsx` (redesenho);
  `useAttentionNotifier.test.tsx` (um toast por conversa); `WebApp.test.tsx` (abrir tira de
  "Precisa de você", turno novo traz de volta uma vez).
- [ ] Entrar numa release, junto com a web de PC acima.

### Segunda rodada (mesmo dia): ATENÇÃO com a mesma conversa dez vezes, status na lateral, Docker

Print do relato: "opa" repetido em ATENÇÃO. Causa nos dados do dev: a conversa `conv-268f…` tinha
~10 sessões. O failover abre uma sessão nova a cada troca de conta, e cada tentativa antiga ficava
`stopped` + `usage_limit`. Cada uma virava um item e entrava na lista TERMINALS do projeto.

- [x] **Aviso por conversa** (`src/features/terminal/useAttention.ts`):
  - `conversationKey` (`conversation_id`, ou o id da sessão) e `latestPerConversation`: a sessão viva
    representa a conversa; entre várias, a mais nova (`created_at_ms`, com o id `terminal-<ms>` como
    reserva).
  - "Visto" passa a ser por conversa: abrir qualquer sessão dela limpa o aviso.
  - Limite de uso, erro e travamento valem para a conversa: a próxima tentativa do failover batendo
    no mesmo limite não reacende o aviso.
- [x] **Toast**: `useAttentionNotifier` reserva por `conversationKey` e deduplica dentro do mesmo
  lote.
- [x] **Lista TERMINALS** (`App.tsx`): uma linha por conversa.
- [x] **Status claros na lateral** (`src/components/ConversaStatus.tsx`): trabalhando (verde,
  pulsando), aprovar, interrompido (limite/erro/travou), finalizado (terminou e você não viu) e
  neutro (sem etiqueta, apagado). Usados na lista de agentes (`Sidebar.tsx`, ações da linha só no
  hover/foco para caber a etiqueta) e em ATENÇÃO (`AttentionPanel.tsx`, com o detalhe do motivo na
  segunda linha).
- [x] **Docker fechado** (`dockerIndisponivel` em `src/features/docker/dockerService.ts`,
  `DockerPanel.tsx`):
  - Docker Desktop fechado ou docker ausente vira uma linha neutra ("Docker fechado" + Verificar),
    não alerta; o stderr fica no tooltip.
  - Poll de 30 s nesse estado.
  - Erro de verdade quebra a linha (`[overflow-wrap:anywhere]`) e o `<nav>` da lateral tem
    `overflow-x-hidden`: sem rolagem horizontal.
- Testes: `useAttention.test.tsx` (várias sessões → um aviso), `useAttentionNotifier.test.tsx`
  (failover não solta outro toast), `ConversaStatus.test.tsx` (novo), `DockerPanel.test.tsx` (fechado,
  ausente, erro real), `Sidebar.test.tsx` ajustado. Front: 352 testes.
- [x] **"Acabou e está como interrompido"**: o `notice` vinha da tela inteira, e a mensagem de limite
  do turno anterior continua visível depois que o agente volta e termina normalmente.
  - Agora só conta o aviso que apareceu depois que o turno atual começou:
    `Interaction.avisos_antes_do_turno` é gravado quando "esc to interrupt" aparece com
    `turn_active` falso, e cai junto quando o aviso rola para fora da tela.
  - Funções `notice_counts`/`notice_since` em `main.rs`.
  - Teste: `aviso_de_limite_de_um_turno_anterior_nao_vale_para_o_novo`.
- [x] **"Terminou mas aparece interrompido"**: o `notice` vinha da tela inteira, e a mensagem de limite
  do turno anterior continua visível depois que o agente volta e termina normalmente.
  - `Interaction.avisos_antes_do_turno` guarda quantos avisos já estavam na tela quando o turno
    começou ("esc to interrupt" aparecendo).
  - `notice_since` só considera os que surgirem depois disso (`main.rs`). A base diminui junto quando
    o aviso rola para fora da tela.
  - Teste: `aviso_de_limite_de_um_turno_anterior_nao_vale_para_o_novo`.
  - Ceiling: sessão retomada pelo failover sem prompt continua "interrompido" até o próximo turno
    (o replay do `--resume` reexibe o limite).

### Terceira rodada: "interrompido" num turno que terminou bem, e a "sessão que cai"

- [x] **Causa da sessão caindo**: a detecção de aviso do engine procurava as frases de limite em
  **qualquer ponto da tela**. Um agente mostrando o código do próprio engine (grep, testes) com essas
  frases fazia o engine reportar `usage_limit`. O failover do app então trocava de conta e reabria a
  sessão com `--resume` no meio do trabalho. Confirmado nesta sessão: ela roda no OMNI instalado
  (engine sem reiniciar), e as quedas vieram logo depois de imprimir essas frases, com a conta
  alternando entre Padrão e EmailUber.
- [x] **Detecção ancorada na linha** (`notice_counts` em `crates/omni-engine/src/main.rs`): só conta a
  linha que **começa** com a mensagem da CLI, depois dos marcadores da TUI (`⎿`, `●`, `■`…). Com o
  agente no meio do turno ("esc to interrupt" na tela), nada conta como aviso.
- [x] **Aviso só do turno atual**: `Interaction.avisos_antes_do_turno` guarda quantos avisos já
  estavam na tela quando o turno começou; o aviso do turno anterior não marca "interrompido" a
  conversa que acabou de terminar bem.
- Testes: `frase_de_limite_no_meio_de_codigo_nao_e_aviso`,
  `aviso_de_limite_de_um_turno_anterior_nao_vale_para_o_novo`, e o teste antigo com as mensagens
  reais. Engine: 69 testes; front: 352.
- `TerminalPane.test.tsx › ritmo da leitura` falhou uma vez na suíte cheia e passou isolado duas
  vezes: depende de tempo sob carga, não foi mexido.
- [ ] **Só vale no app instalado depois da release.** Até lá, o OMNI instalado continua com a
  detecção antiga.

### Terceira rodada: "acabou e aparece interrompido" e a sessão que caía sozinha

- [x] **Sessão caindo no meio do trabalho (grave).** O engine procurava as frases de limite de uso
  em qualquer ponto da tela. Quando o agente mostrava texto com essas frases (código do próprio
  engine, saída de `grep`/`cargo`, uma resposta falando de limite), a sessão era marcada como
  limitada. O failover então trocava de conta e reabria a conversa com `--resume`. Confirmado em
  `sessions.json` do app instalado: várias sessões desta conversa paradas como limitadas, alternando
  `claude-padrao`/`emailuber`.
  - `notice_counts` (`crates/omni-engine/src/main.rs`) agora só conta **linhas que começam** com a
    mensagem da CLI, depois dos marcadores da TUI (`⎿ ● ■ ⏺ …`): `USAGE_LIMIT_LINES` e
    `API_ERROR_LINES`.
  - Com o agente no meio do turno ("esc to interrupt" na tela), nada vira aviso.
- [x] **Turno que terminou aparecendo "interrompido".** A mensagem de limite de um turno anterior
  continuava na tela. `Interaction.avisos_antes_do_turno` guarda quantos avisos já havia quando o
  turno começou; só os novos contam (`notice_since`).
- Testes: `frase_de_limite_no_meio_de_codigo_nao_e_aviso`,
  `aviso_de_limite_de_um_turno_anterior_nao_vale_para_o_novo`, `notice_distinguishes…` ampliado com as
  mensagens reais. Engine: 69.
- ⚠️ O app **instalado** (0.5.4) continua com a detecção antiga até a próxima release: uma sessão
  dele que exibir essas frases ainda é derrubada pelo failover.
- [x] **Aviso reexibido pelo `--resume`**: logo depois do failover a conversa aparecia
  "interrompido" até a próxima mensagem, porque o histórico reexibido trazia o aviso antigo.
  `Interaction.turnos_iniciados`: antes do primeiro turno da sessão, tudo o que está na tela é base.
  Teste `aviso_reexibido_pelo_resume_nao_conta_antes_do_primeiro_turno` (`mobile.rs`). Engine: 70.

## Agentes como conversa no app do PC, CHATS × TERMINALS e "Acesso remoto" (2026-10-13, sem release)

Pedido: escolher se as abas de agente aparecem como terminal (como sempre) ou como o chat da web,
sem perder o terminal para rodar `npm run dev`. Separar conversas com IA dos terminais na lateral.
Deixar claro nas Configurações que o acesso remoto serve para celular **e** outro computador.

- [x] **Visão Conversa nas abas de agente** (Configurações → Aparência → Agentes; `agentView` em
  `src/types/settings.ts`, padrão `terminal`):
  - `src/features/conversa/AbaDeAgente.tsx`: o chat da web (`ConversationDetail`) por cima do
    `TerminalPane`, com "Ver terminal" / "Ver conversa".
  - O terminal **fica montado** por baixo: failover, respostas ao ConPTY e tamanho da PTY dependem
    dele.
  - Terminais sem IA continuam sempre terminal.
- [x] **Mesmas rotas, sem HTTP:**
  - `EngineRequest::Api { method, path, body }` → `mobile::local` despacha no roteador da API
    (`rotas()`, extraído de `router()`) sem a camada de origem/token de celular; quem chega já tem o
    token do engine.
  - Comando Tauri `engine_api`; `engineApi` em `terminalService.ts`.
  - `api.ts` ganhou `usarTransporte`: o app do PC liga `transporteDoEngine` em `src/main.tsx`.
  - Funciona com o acesso remoto desligado.
  - `tower` passou de dev-dependency para dependency (já vinha com o axum).
  - Anexo (imagem colada no chat do PC): `Api` ganhou `body_base64` e `headers`; `base64_decode`
    (biblioteca padrão, sem crate) em `mobile.rs`; `transporteDoEngine` lê o arquivo com
    `FileReader` e repassa `X-Omni-Nome`.
  - Timeout das chamadas `Api` no cliente: 30 s (as outras seguem 2 s). Abrir uma conversa enorme
    pela primeira vez leva ~5 s e estourava.
  - Testes: `anexo_colado_no_pc_chega_pelo_protocolo_local`, `base64_decode_confere_com_os_casos_do_rfc`
    (engine, 73) e o de imagem colada em `AbaDeAgente.test.tsx`.
- [x] **CSS**: as regras de página (`html`/`body`) saíram de `mobile.css` para `src/mobile/pagina.css`
  (importado só pelo celular e pela web). `mobile.css`/`web.css` entram no app do PC; conferido que
  nenhuma classe colide e não há seletor global.
- [x] **Lateral: CHATS × TERMINALS** (`Sidebar.tsx`): a seção AGENTS (vazia) virou CHATS, com as
  sessões que têm agente de IA; TERMINALS só os shells.
- [x] **"Celular" → "Acesso remoto"** (`SettingsView.tsx`, `MobileSettings.tsx`): título, passos e
  bloco do QR falam em celular ou outro computador.
- Testes: `desktop_chama_a_api_pelo_protocolo_local` (engine, 71); `AbaDeAgente.test.tsx` (3, novo);
  `Sidebar.test.tsx` (CHATS × TERMINALS).
  - O teste de ritmo do `TerminalPane` falhava às vezes com a suíte em paralelo (relógio real, 250
    ms); a janela foi para 600 ms com o limite proporcional.
  - Front: 356.
- [ ] Ver no app rodando: precisa reiniciar o `npm run dev` (engine e Tauri mudaram).
- [ ] Release + changelog.

### Ajustes depois do primeiro uso (2026-10-13)

- [x] **Terminal aparecendo por trás da conversa** (`AbaDeAgente.tsx`):
  - Com a conversa na tela, o terminal fica `invisible`. Continua montado e com tamanho (failover,
    PTY), mas não aparece e não recebe foco.
  - O botão "Ver conversa" saiu de cima da barra de status do terminal (mesmo canto, mesma camada).
- [x] **"Começa a pensar" ao abrir a conversa** (`append_output` em `main.rs`): reabrir a aba
  redesenha a TUI, e qualquer saída virava `working` por 1,5 s. Para Claude/Codex parados, saída
  sem "esc to interrupt" mantém `answered`. Teste `redesenho_com_o_agente_parado_nao_vira_trabalhando`.
- [x] **Plano: "Idempotency-Key obrigatório"**: a primeira versão do `engine_api` não levava
  cabeçalhos; já corrigido junto com o anexo. Teste `modo_pelo_pc_leva_o_idempotency_key`.
- [x] **Terminais sem agente na web** (`/terminais` em `mobile.rs`):
  - Listar (só shells), `saida`, `teclas`, `fechar` e `POST /terminais {project_id}`. A pasta sai da
    lista de projetos, nunca do navegador; limite de sessões compartilhado; WSL resolvido pelo engine.
  - Web: seção "Terminais" na lateral do projeto, "+ Novo terminal", terminal no centro (`#/t/<id>`)
    com "Fechar terminal".
  - `TerminalEspelho` recebe as rotas (`saida`/`teclas`) e trata 404 como "fechado".
  - Testes: `terminais_sem_agente_listam_e_recusam_sessao_de_agente`,
    `web_abre_shell_no_projeto_roda_e_fecha` (shell real, ponta a ponta) e o fluxo em
    `WebApp.test.tsx`. Engine: 77; front: 358.

## Conversas mais legíveis, uso na web, e conta/modelo/esforço na conversa (2026-10-13, sem release)

- [x] **Visual da conversa** (`mobile.css`, bloco "Leitura da conversa"; vale para celular, web e a
  visão Conversa do app):
  - Texto com a fonte do sistema (código continua mono).
  - Agente sem cartão: texto corrido com filete na cor de destaque marcando o turno.
  - Cabeçalho "Claude · hora" só na primeira fala do turno (`continuacoes` em `MobileApp.tsx`,
    prop `continua` no `MessageBubble`).
  - Você em cartão destacado à direita; ações presas ao filete, mais apagadas.
  - Conferido com screenshot.
- [x] **Uso das contas na web** (`src/web/UsoDasContas.tsx`, rota `GET /contas`):
  - 5H e semana por conta, mesmas faixas de cor do rodapé, com a conta da conversa aberta
    destacada.
  - Só o que já foi lido (consultar de novo digitaria `/usage` num agente).
  - Auxiliares de uso saíram para `src/lib/uso.ts` (sem Tauri), reexportados por
    `AgentUsageStatus`.
- [x] **Conta, modelo e esforço na conversa** (`src/mobile/AjustesDaConversa.tsx`, acima do campo de
  texto; web, celular e app):
  - `GET /conversas/{id}/opcoes`: contas do mesmo agente, modelos (Claude: fable/opus/sonnet/haiku;
    Codex: `models_cache.json` da conta, com os esforços de cada um) e o que está valendo (lido do
    transcript).
  - `POST /conversas/{id}/ajustes` → `reabrir_com`: reinicia a **mesma** sessão (a aba do app fica
    ligada) com `claude --resume <id> --model --effort` / `codex resume <id> -m -c
    model_reasoning_effort=`.
  - Troca de conta copia o transcript para o config dir da conta nova e abre um trecho novo na
    conversa.
  - Só com o agente parado; valores validados (`valor_seguro`) porque viram argumento de shell.
  - **Testado de verdade** num engine isolado:
    - "Haiku 5.5 with low effort" apareceu na sessão retomada.
    - A troca EmailUber → Padrão retomou o mesmo id em `~/.claude` e criou o segmento novo.
- [x] **Bug achado no teste**: sessão aberta pelo celular/web numa pasta que a conta nunca abriu
  travava no "trust this folder?" (o chat dizia só "entrada não reconhecida").
  `passar_pela_confianca` (thread à parte, `wait_claude_ready`) depois do spawn e da reabertura.
- Testes:
  - Engine (80): `comando_de_retomada_por_cli`, `ajustes_recusam_valor_que_vira_comando`,
    `opcoes_listam_modelos_e_contas_do_mesmo_agente`.
  - Front (361): `AjustesDaConversa.test.tsx` e `UsoDasContas.test.tsx`.
  - A faixa valida o formato da resposta (um `{}` derrubava a conversa — pego pelo teste).
- Artefato do teste real: conversa "Teste visual 2" (transcript `a6206027-…`, projeto domus) gravada
  em EmailUber e em `~/.claude`.
- [x] **Ajuste pedido depois do print**: a fonte da conversa voltou a ser a do app (só altura de
  linha 1,7). Texto do agente apagado no app do PC: `mobile.css` carrega antes do Tailwind ali, e o
  `.prose` padrão (cinza de fundo claro) vencia. As variáveis agora valem em
  `.bubble-markdown.prose`, e o texto usa `--c-text-primary`.
- [x] **"Cadê o trocar modelo/esforço no app?"**: o engine de dev em execução era de antes da rota
  (binário 09:23; `/opcoes` respondia 404). O front atualiza por HMR, o engine só no `npm run dev`.
  - A faixa agora avisa "reinicie o OMNI" num 404 em vez de sumir calada.
  - `request()` em `api.ts` lia JSON antes do status; um 404 sem corpo virava erro de parse, não
    `ApiError(404)`. Corrigido.
  - Teste em `AjustesDaConversa.test.tsx`. Front: 362.
- [x] **Composer redesenhado** (pedido: "ficou feio, o enviar tá cagado"; `Composer.tsx`,
  `AjustesDaConversa.tsx`, `ModoDoAgente` em `MobileApp.tsx`, bloco do composer em `mobile.css`):
  - Um cartão só: texto em cima; embaixo, anexo · chips Conta/Modelo/Esforço com ícone (menu abre
    para cima) · lápis de renomear · Plano/Auto segmentado com ícone · Enviar.
  - Borda acende no foco.
  - Enviar em destaque (sombra dura, afunda no clique) que vira **Parar** com o agente
    trabalhando e campo vazio.
  - Saiu a faixa solta com o título e os seletores com rótulo em cima. `BarraDaConversa` deu lugar
    a `RenomearConversa` (abre pelo lápis).
  - Modo e ajustes aparecem com sessão ligada (`capabilities`; engine antigo não manda `live`).
  - Conferido com screenshot em 2x (foco, texto digitado, menu aberto). Front: 362.
- [x] **Web impecável** ("faça o mesmo que no app no web"):
  - O composer novo e a troca de conta, modelo e esforço já eram os mesmos componentes da web. O
    usuário via a versão antiga porque os dois engines que servem a web estavam desatualizados:
    instalado 0.5.4 e dev iniciado antes das mudanças. Conferido baixando o bundle de cada um.
  - Polimento da web (`WebApp.tsx`, `web.css`, `UsoDasContas.tsx`, `NovaSessao` com `classeBotao`):
    - Rodapé da lateral com "Nova sessão" e "Novo terminal" lado a lado, com ícones (antes: botão
      azul gigante e "Terminais" espremido e cortado).
    - Terminais listados só quando existem.
    - Projetos com ícone de pasta e contagem em caixinha; abas Conversa/Terminal com ícone.
    - Uso das contas diz o agente de cada conta (eram três "Padrão" iguais).
    - Botão secundário com contorno.
  - Conferido com screenshots. Front: 362.
- [x] **"Não consigo trocar o modelo"** (print: conversa "Histórico"): conversa sem sessão aberta não
  tinha o que reabrir — os chips nem apareciam. Agora dá para **retomar** com conta/modelo/esforço:
  - Engine: `POST /conversas/{id}/retomar` (`plano_de_retomada` + `retomar` em `mobile.rs`).
    - Vale para conversa do OMNI com a sessão fechada e para conversa só do histórico da CLI.
    - Esta última vira conversa do OMNI com id estável (`stable_id("conv", [id])`), para um segundo
      toque não duplicar.
    - Abre sessão headless com `--resume` + ajustes na pasta do projeto, leva o transcript se a
      conta mudar (`levar_transcript`, agora comum com `reabrir_com`) e passa pelo diálogo de
      confiança.
    - `/opcoes` também responde para conversa do histórico (`ultima_sessao`).
  - Front: sem sessão, os chips ficam ativos com **Retomar conversa** (`onRetomar` em
    `AjustesDaConversa`). `ConversationDetail` espera a sessão subir e navega (`abrirConversa`). O
    placeholder explica.
  - Testado de ponta a ponta:
    - Pela interface (Playwright): conversa fechada → Haiku → Retomar → campo "Mensagem para o
      agente…".
    - Pela API: conversa só do histórico → `conv-4783…` viva em 3 s com as 4 mensagens, sem
      duplicar na lista.
    - Engine: `retomar_conversa_sem_sessao_e_recusar_a_aberta` (81).

### "Às vezes a conversa nova dá timeout e tenho que clicar de novo" (2026-10-13)

- [x] Causa medida no engine isolado: **abrir a primeira sessão num projeto do WSL levou 2,76 s**
  (`wsl.exe` frio; depois cai para ~40 ms). O cliente do engine dava 2 s a toda requisição.
  `SpawnTerminal` estourava: o app mostrava o erro com "Tentar reconectar", e o engine terminava de
  abrir a sessão do lado dele — o clique abria **outra** (de onde vinham as sessões repetidas).
- [x] `send_request` (`src-tauri/src/engine_client.rs`):
  - `SpawnTerminal`, `RestartSession`, `DuplicateSession` e `Api` vão em conexão própria com 30 s.
  - Não esperam pouco demais nem seguram a conexão compartilhada (terminal das outras abas).
- [x] `restart_session` (`main.rs`) soltava a trava da tela só depois de subir o processo;
  `list_sessions` passa por ela em toda sessão, então a lista inteira parava junto. Agora solta antes
  do spawn.
- [x] Visão Conversa (`AbaDeAgente.tsx`) tenta de novo sozinha (5×, com espera crescente) antes de
  mostrar erro. Engine desatualizado explica na hora.
- [x] **Trocar conta/modelo/esforço também no modo Terminal** (`FaixaDoTerminal` em `AbaDeAgente.tsx`):
  - Faixa fina acima do terminal (não flutuando sobre o texto da CLI) com os mesmos chips da
    conversa; `POST /ajustes` com `If-Match`, reabrindo a mesma sessão.
  - Erro de recusa aparece na faixa.
  - No modo Conversa, o "Ver conversa" mudou para essa faixa.
  - Teste novo em `AbaDeAgente.test.tsx`. Front: 363.
- [x] **Conversa "mais premium, menos colorida"** (`mobile.css`, blocos "Acabamento premium" e
  "Meio-termo"):
  - Bordas de 1 px; sem sombras duras (o composer ganhou sombra suave e enviar plano).
  - A cor de destaque em doses baixas: tom leve e borda fina na mensagem do usuário, filete suave do
    turno, verbos das ações, ícones dos chips e modo ativo.
  - Ícone do agente colorido só no cabeçalho, apagado nas linhas de ação.
  - Código inline e marcadores discretos. Primeira tentativa tirou cor demais — usuário pediu "uma
    corzinha" e ficou no meio-termo.
  - Conferido com screenshots.
- [x] **"Infinitamente mais bonito"** (`Chat.tsx`, `MobileApp.tsx`, bloco "Desenho da conversa" em
  `mobile.css`):
  - Avatar do agente numa coluna à esquerda (só na primeira fala do turno; o resto alinha com ele, o
    filete saiu).
  - Separador de dia ("Hoje", "Ontem", "12 de outubro") com linhas.
  - Bloco de código com a linguagem no topo e "Copiar" (`BlocoDeCodigo`).
  - "Copiar resposta" no hover (some onde não há área de transferência: HTTP fora de localhost).
  - Ícone por tipo de ação (`ICONE_DA_ACAO`; comando vira `$` — o ícone de terminal pequeno parecia
    uma caixa de seleção).
  - Sua mensagem com degradê leve.
  - Conferido com screenshots em 2x. Testes `ChatDesenho.test.tsx` (3). Front: 366.

## Bifurcar conversa (2026-10-14, sem release)

- [x] "Duplicar" numa sessão de agente agora **bifurca** a conversa (`bifurcar` em `main.rs`). Antes
  abria um shell sem agente, que caía em TERMINALS.
  - Claude: `--resume <id> --fork-session --session-id <novo>`. Conferido na CLI 2.1.296 que o fork
    nasce com o id escolhido e traz o histórico (teste real com `-p`). Assim a timeline sabe onde ler
    desde o começo.
  - Codex: `codex fork <id>` (id escolhido pela CLI; a descoberta de rollouts acha o arquivo).
  - Sem mensagem ainda: abre conversa nova do mesmo agente e conta.
  - Conversa nova "<nome> (fork)" com título manual, mesma conta; a original não muda.
  - `comando_ao_reiniciar`: reiniciar a aba do fork retoma a cópia (`--resume <novo>`) em vez de
    bifurcar de novo. Teste `reiniciar_um_fork_retoma_a_copia`.
  - Shell continua sendo duplicado como shell.
- [x] Lateral: em CHATS o botão é "Bifurcar conversa" (ícone de ramo, tooltip explicando); em
  TERMINALS, "Duplicar terminal".
- [x] `src/test/setup.ts` ganhou `ResizeObserver` falso: o terminal da web, carregado sob demanda,
  fazia um teste falhar ou passar conforme o carregamento.
- Engine: 82. Front: 366.
- Artefato do teste da CLI: fork `95b3b3c0-…` da "Teste visual 2" em `~/.claude`, projeto domus.

### Fork vazio (corrigido 2026-10-19, sem release)
Relato: "fiz um fork e ficou totalmente vazio, tem que aparecer o mesmo histórico". Duas causas:
- [x] **Terminal parado para sempre.** O ConPTY manda `ESC[6n` ao criar a PTY e espera a resposta. Só o
  xterm respondia (o engine só em sessão "headless", do celular). O fork abre na visão Conversa, sem
  xterm; ao trocar para Terminal, o xterm reproduz o `ESC[6n` como histórico e não responde. O bash
  ficava vivo, sem filho, e o `claude` nunca rodava (confirmado no app instalado: saída inteira = `ESC[6n`).
  Conserto: o **engine responde sempre** (`answer_terminal_queries`, posição pelo `vt100`) e
  `write_terminal` descarta respostas de cursor vindas do cliente (`sem_respostas_de_cursor`), que
  chegariam em dobro. Saiu o `headless` de `LiveSession`/`SessionOrigin`. Limite: Shift+F3 (`ESC[1;2R`)
  também some.
- [x] **Conversa vazia até a 1ª mensagem.** O Claude só grava o `.jsonl` do fork na primeira mensagem.
  `bifurcar` agora põe antes do segmento novo os segmentos da original com `historico_ate_ms` = hora do
  fork (`Segment` em `omni-core/src/conversations.rs`); a timeline e `feed::imagem` ignoram o que a
  original ganhar depois (`feed::ate`). As mensagens copiadas têm o mesmo uuid (conferido: 422 de 437)
  e não duplicam.
- Ponta a ponta no engine de teste, sem responder `ESC[6n`: fork de uma conversa de 1 MB → Claude aberto
  com o histórico em ~6 s e timeline do fork com 21 mensagens antes de qualquer mensagem nova.
  Esta conversa (275 MB) bifurca em 16 s pelo `-p` (cópia de 2 MB). Testes: core 73 (+1), engine 105.

## Anexar arrastando e colando, qualquer tipo (2026-10-14, sem release)

- [x] Qualquer tipo de arquivo sempre foi aceito (sem `accept`); o que faltava era o caminho de
  entrada:
  - **Web/celular** (`ConversationDetail`): arrastar para qualquer ponto da conversa anexa (camada
    "Solte para anexar"). Colar arquivo com o foco fora do campo também anexa (`paste` no
    documento, ignorando o que já foi tratado — não duplica).
  - **App do PC** (`useSoltarArquivos` em `AbaDeAgente.tsx`): o arrastar do Windows chega pelo
    `onDragDropEvent` do Tauri (caminhos). Lê com `readFile` (permissão nova `fs:allow-read-file`)
    e entrega à conversa pelo `EVENTO_ANEXAR` — dali é o mesmo anexo do celular.
  - `tipoPelaExtensao` para PDF, planilhas, documentos, CSV, MD etc.
- [x] Marcador do prompt passou a "[Anexos enviados pelo OMNI]" (dizia "pelo celular" até vindo do
  PC); o antigo continua sendo lido.
- Testes: `AnexarArquivos.test.tsx` (4). Conferido no navegador real (Playwright): PDF + CSV + PNG
  soltos viraram três anexos. Front: 370.

## Release v0.6.0 (2026-10-14)

- [x] `VERSION` 0.6.0 + `version:sync`; entrada no `src/lib/changelog.ts` em linguagem de usuário
  cobrindo tudo desde a 0.5.4:
  - web de PC;
  - visão Conversa no app;
  - visual novo;
  - conta/modelo/esforço;
  - retomar;
  - bifurcar;
  - anexos;
  - terminais na web;
  - CHATS × TERMINALS e status;
  - avisos;
  - correções de falso limite, timeout no WSL, confiança de pasta e Docker;
  - "Acesso remoto".
- [x] Verificado antes do commit: typecheck, front 370, workspace Rust (22/41/82/3), `cargo check` do
  Tauri.
- [x] Publicada como release normal (não pre-release, marcada como latest):
  https://github.com/FelipeCamposM/OMNI-AGENTS/releases/tag/v0.6.0.
  - `releases/latest/download/latest.json` → 0.6.0, assinatura presente, instalador Windows HTTP 200.
- [x] CI do commit da release falhou no Ubuntu (370 testes passaram, 1 erro não tratado). O teste
  novo da lateral montava o `DockerPanel` com o Tauri simulado, que devolve itens sem `name`, e o
  `sort` quebrava. Corrigido em `38becc4`:
  - `groupByCompose` tolera campos faltando e o painel descarta lista inválida;
  - o teste simula o painel;
  - teste novo "resposta estranha do docker não derruba o painel".
  - CI verde nas três plataformas. A release não foi refeita: com o docker real o caso não ocorre.
- Pendente antigo: actions do GitHub em Node 20 (depreciado).

## Atualizar uso na web e menção de arquivo com @ (2026-10-14, release v0.6.1)

- [x] **Atualizar o uso manualmente na web** (`UsoDasContas.tsx`; rota `POST /contas/{id}/uso` em
  `mobile.rs`):
  - Botão por conta.
  - Claude reaproveita `interaction::account_usage(…, refresh=true)`: digita `/usage` num Claude
    ocioso da conta ou num oculto, sem mandar mensagem a modelo.
  - Codex relê o rollout. Erro aparece na própria conta.
  - Testado de verdade: EmailUber relida em 6,2 s.
- [x] **@ para mencionar arquivo** (app, web e celular — `Composer.tsx`; rota
  `GET /conversas/{id}/arquivos?q=`):
  - O engine varre a pasta do projeto (`varrer_arquivos`, pulando node_modules/.git/target/dist…,
    teto 20 mil), com cache de 30 s por pasta. Devolve as 40 melhores (`melhores_arquivos`: nome
    que começa > nome que contém > caminho que contém).
  - No composer, `@texto` abre a lista. Setas/Enter/Tab/Esc; Enter com a lista aberta não envia.
  - Insere `@caminho/relativo ` (entre aspas se tiver espaço), o mesmo formato do terminal.
  - Bug achado no teste: `setEscolhida(0)` dentro do atualizador de estado era reexecutado pelo
    React e zerava a escolha das setas. Movido para fora, com ref.
  - Testado de verdade: domus, 2154 arquivos, 1,5 s na primeira busca; `@landing` → Enter inseriu
    `@packages/validation/src/landing-page.ts`.
- Testes: engine 84 (`melhores_arquivos_priorizam_o_nome`, `varredura_pula_pastas_pesadas`); front
  374 (`Mencoes.test.tsx`, atualizar em `UsoDasContas.test.tsx`).

### Release v0.6.1 (2026-10-14)

- [x] Teste `app_busca_arquivos_pelo_protocolo_local` em `mobile.rs`: a busca do `@` pelo caminho do
  app (`local`, com query string) devolve os arquivos e pula `node_modules`.
- [x] `VERSION` 0.6.1, changelog, typecheck, 374 testes de front, 85 do engine e `cargo check` verdes.
- [x] Publicada como release normal/latest (commit `4281d9f`, tag `v0.6.1`). CI e build verdes nas 3 plataformas; `latest.json` = 0.6.1, assinado; instalador Windows HTTP 200.
- [ ] Testar o `@` dentro do app instalado (visão Conversa). O usuário vai conferir em produção.

## Uso de todas as contas no rodapé do app e botão visível na web (2026-10-14, sem release)

- [x] **Dropdown no rodapé do app** (`src/features/terminal/UsoDeTodasAsContas.tsx`, ligado em
  `AgentUsageStatus.tsx`): botão de gráfico à esquerda do agente em foco. Abre para cima, num portal,
  porque o rodapé tem `overflow-hidden`. Mostra as contas de Claude e Codex com 5H e Semana,
  destaca a conta da aba e tem um botão por conta que consulta o `/usage` (`account_usage`,
  `refresh: true`). Abrir só lê o cache. Fecha com Esc ou clique fora. Teste em
  `src/test/UsoDeTodasAsContas.test.tsx`.
- [x] **Web:** o botão de atualizar existia na 0.6.1, mas era só um ícone apagado ao lado de
  "CLAUDE". Virou um botão com o texto "Atualizar" (ou "Lendo…"), com borda (`web.css`).
- [ ] Conferir o dropdown no app instalado depois da próxima release.
- [x] **Status dos chats mais destacado na lateral** (`ConversaStatus.tsx`, `Sidebar.tsx`): a
  etiqueta (trabalhando/aprovar/interrompido/finalizado) virou um selo com fundo e borda na cor do
  status. A linha ganhou uma barra de 2 px à esquerda e um fundo leve na mesma cor, e o nome fica em
  negrito. O ícone passou de 12 para 14 px. Linha neutra não muda. O painel "Precisa de você" usa o
  mesmo selo.
- [x] **Mesmo destaque de status na web e no celular** (`ConversationList` em `MobileApp.tsx`,
  `mobile.css`): cada conversa usa o `statusDaConversa` do PC e mostra o selo `EtiquetaDoStatus`
  (substitui o antigo "Aprovar"). O card ganha uma barra de 3 px e um degradê na cor do status
  (`.m-card[data-status]`). O "finalizado" vem de `naoVistas` (ids do `attention` do `useDados`).
  O engine passou a mandar `notice` no resumo da conversa, para o "interrompido" por limite ou erro
  de API aparecer. Conferido com print na web de PC e no celular (estados simulados por
  interceptação do `/painel`). Teste em `src/test/ListaStatus.test.tsx`.

## Capricho visual: barra superior própria e controles em pixel (2026-10-15, sem release)

- [x] **Barra superior customizada** (`src/components/TitleBar.tsx`, CSS `.titlebar*` em
  `index.css`): janela sem moldura (`decorations: false`, `shadow: true` em `tauri.conf.json`).
  - Conteúdo: logo e "OMNI AGENTS" (volta ao início), trilha workspace › projeto (caminho na
    dica), Layouts, sino e os botões minimizar, maximizar/restaurar e fechar, com o fechar
    vermelho no hover.
  - Glifos em pixel (`src/components/ui/PixelGlyph.tsx`). Arrasta e maximiza no duplo clique por
    `data-tauri-drag-region`. Um filete do acento no topo apaga com a janela fora de foco.
  - Permissões novas em `capabilities/default.json`: minimize, toggle-maximize,
    internal-toggle-maximize, is-maximized, start-dragging e close.
- [x] **Logo e sino saíram da lateral** (`Sidebar.tsx`). O popover do sino fica dentro da janela
  (`NotificationBell.tsx`).
- [x] **Sem o cabeçalho repetido do projeto** (`WorkspaceView.tsx`): nome e caminho foram para a
  trilha, e Layouts para a barra (`LayoutPresetPicker` com glifos de pixel no lugar de ▥▤▦▣).
- [x] **Painéis** (`PaneView.tsx`, `WorkspaceTabBar.tsx`):
  - Ações planas com glifo de pixel (`.pane-acao`) no lugar dos botões com sombra que vazava.
  - Maximizar e fechar só aparecem com mais de um painel.
  - A moldura laranja aparece só no painel ativo quando há vários.
  - Aba ativa com filete do acento; o × das abas inativas aparece no hover; "+" em pixel.
- [x] Testes: `TitleBar.test.tsx` (novo); `App.test.tsx` e `PaneView.test.tsx` ajustados.
  377 verdes; `cargo check` valida a config e as permissões.
- [x] Conferido com prints (Vite + Tauri simulado no Playwright): um painel, dois painéis,
  Configurações e tema claro.
- [ ] Conferir no app de verdade: arrastar, redimensionar pelas bordas, duplo clique, Snap do
  Windows e sombra da janela.

## Capricho visual 2: Configurações, novo agente, histórico, animações e bug do Auto/Plano (2026-10-15, sem release)

- [x] **Bug do Auto/Plano** (`post` em `MobileApp.tsx`): cada troca redesenha o rodapé do
  terminal, e a versão da tela que a conversa tinha ficava velha. O PC recusava com 412, aparecia
  um erro e era preciso clicar de novo. Agora modo e ajustes releem a versão (timeline) e repetem
  uma vez. Prompt e aprovação continuam recusando, porque ali o If-Match protege.
  - `ModoDoAgente` acende o modo pedido na hora (`is-pedido` pulsa até confirmar).
  - Teste em `WebApp.test.tsx` ("troca de modo com a tela redesenhada…").
- [x] **Configurações** (`SettingsView.tsx`, `.settings*` em `index.css`):
  - Largura máxima de 1180 px (era `max-w-3xl`).
  - Topo e menu em cartão, cada item com ícone, nome e descrição, e barra animada no item ativo.
  - Seção nova **Geral** (agentes, arquivos, avisos) tirada de Aparência, que fica com tema, cor,
    relevo, fundo e movimento. Grade de duas colunas.
  - Conteúdo entra com animação ao trocar de seção.
- [x] **Novo agente** (`AgentLauncher.tsx`, `.launcher*`):
  - As CLIs viram cartões de escolha (`radiogroup`) com ícone grande e status (conectada, sem
    login, não instalada), no lugar do dropdown.
  - Cabeçalho com projeto e caminho; "Abrir" como botão principal; entrada animada.
- [x] **Histórico e Retomar conversa** (`HistoryView.tsx`, `.historico*`):
  - Topo e filtros em cartão; itens com ícone, pasta, conta e tempo relativo; esqueleto de
    carregamento.
  - Mensagens em balões (você à direita); estado vazio ilustrado.
- [x] **Escolher a conta antes de retomar**:
  - "Abrir na conta" no detalhe do histórico, com a conta original como padrão.
  - Outra conta: rota nova `POST /historico/levar` (`mobile.rs`, `levar_do_historico`) copia o
    transcript para a conta escolhida. A conversa é achada pelos campos do histórico, sem
    caminho vindo de fora.
  - `levarParaConta` em `historyService.ts`, usado por `App.resumeHistory` e pelo `AgentLauncher`.
  - Testes: `historico_leva_a_conversa_para_outra_conta` (engine) e "retoma em outra conta" em
    `AgentLauncher.resume.test.tsx`.
- [x] **Animações**:
  - Todo `.popover` (Select, sino, layouts, menus) entra com deslize de 140 ms, para cima ou
    para baixo conforme o lado.
  - Opções do Select mais altas, com barra do acento.
  - Troca de conversa (`.chat-tela`) com fade.
  - Tudo respeita "animações desligadas" e o reduzir movimento do Windows.
- [x] 379 testes de front e 86 do engine verdes. Conferido com prints (Tauri simulado): Geral,
  Aparência, novo agente, histórico, dropdown de conta e Retomar dentro do painel.

## Extensões por IA e Cursor funcionando (2026-10-15, sem release)

- [x] **Diagnóstico do Cursor**: a CLI estava instalada (`agent` v2026.09.10, `%LOCALAPPDATA%\cursor-agent`,
  no PATH), logada e detectada pelo OMNI. Abrindo uma sessão pelo engine de teste, o problema
  apareceu:
  - O Cursor para no "Workspace Trust Required" em toda pasta nova. Na visão Conversa (e na
    web), esse diálogo fica escondido atrás de um chat vazio ("Entrada do CLI não reconhecida").
  - O OMNI não lê transcript do Cursor, então a timeline fica com 0 mensagens.
- [x] **Correções do Cursor**:
  - `comando_do_agente` em `engine_client.rs`: o Cursor abre com `--trust`, conferido no
    interativo (abre direto no campo de mensagem). Vale para o novo agente, o kanban e a web,
    porque a lista publicada no engine usa o mesmo `command`. Teste
    `cursor_abre_confiando_na_pasta_e_os_outros_ficam_iguais`.
  - `temConversa`/`AGENTES_COM_CONVERSA` em `mobile/api.ts`: a aba do Cursor fica no terminal
    mesmo com a visão Conversa (`AbaDeAgente.tsx`), e a web abre o terminal ao vivo com a aba
    Conversa desativada (`WebApp.tsx`). Teste em `AbaDeAgente.test.tsx`.
- [x] **Aba Extensões nas Configurações** (`src/features/extensoes/`, comando Tauri
  `listar_extensoes` em `src-tauri/src/extensoes.rs`, dependência `toml` 0.9 já presente no
  lock):
  - Abas por IA (Claude, Codex, Cursor) e por tipo (MCPs, Plugins, Conectores), com contagens.
  - Agrupado por conta: cada conta do Claude tem as próprias extensões.
  - MCPs com escopo (todo projeto, só numa pasta, do projeto), tipo (local stdio ou remoto),
    destino, nomes das variáveis e o aviso "Não vale neste projeto".
  - Plugins ligados ou desligados com origem e versão. O escopo de projeto lê o
    `.claude/settings*.json` do projeto.
  - Conectores do claude.ai (`claudeAiMcpEverConnected`).
  - "Onde isso fica" com "Mostrar no Explorer"; estado vazio diz como adicionar em cada IA.
  - **Sem segredos**: variáveis e cabeçalhos só pelo nome, URL sem query nem credencial,
    argumentos com cara de chave mascarados. Testes `json_le_mcps_sem_expor_valores` e
    `codex_le_mcps_e_plugins_do_toml`.
  - Conferido na máquina real: nenhum valor sensível na saída.
  - Teste de tela em `ExtensoesSettings.test.tsx`.
- [x] 380+ testes de front, 86 do engine e 27 do Tauri verdes. Prints conferidos.
- [ ] Efeito colateral do teste manual: a pasta SIAPLUS ficou marcada como confiável no Cursor
  real, e o Cursor se atualizou sozinho para v2026.10.14 ao abrir.

## Fila, tokens, contas com as mesmas extensões e release v0.6.2 (2026-10-15)

- [x] **Mensagem na fila durante o turno**:
  - `pode_enfileirar` em `interaction.rs`: "esc to interrupt" na tela, campo vazio e sem
    aprovação. Novo `Capabilities.enfileirar` e `ActionKind::Fila` (`/prompt` com
    `fila: true`), que pula a trava de versão da tela (muda a cada quadro) mas confere o campo
    livre na execução.
  - Tela: estado `fila` em `MobileApp.tsx` com o bloco "Na fila · entram quando o agente
    terminar", que sai quando a mensagem chega ao transcript.
  - Testes: `mensagem_durante_o_turno_entra_na_fila_da_cli` e o teste de tela em
    `WebApp.test.tsx`. **Testado com o Claude (Haiku) de verdade**: a segunda mensagem entrou
    na fila e foi respondida depois da primeira, pela API e pela web.
- [x] **Botão Parar** (`Composer.tsx`, `.composer-parar*`): com rótulo, ícone pulsando devagar,
  e o Enviar ao lado quando há texto.
- [x] **Tokens do turno**: `tokens_do_turno` lê o "↓ 113 tokens" da linha de status, o resumo da
  conversa manda `tokens` com o agente trabalhando, e `AgentWorking` mostra
  "(5s · ↓ 113 tokens)". Conferido ao vivo na web. O Codex não mostra tokens durante o turno.
- [x] **Bug corrigido**: trocar o modelo antes da primeira mensagem fechava a conversa
  ("No conversation found"). `reabrir_com` usa `--session-id` quando ainda não há transcript.
- [x] **Renomear arquivo** (`selecionarNome` em `FileTree.tsx`): pré-seleciona só o nome sem a
  extensão. Teste em `RenomearArquivo.test.tsx`.
- [x] **Arrastar de fora para a árvore**: `enter`/`over`/`leave` do Tauri acendem a pasta de
  destino, um selo "Copiar N arquivos para «pasta»" segue o cursor e "✓ copiados" aparece
  depois. Conferido com evento simulado.
- [x] **Mesmas extensões em todas as contas** (`omni_core::compartilhar`):
  - Antes de abrir sessão numa conta extra (spawn, reinício e failover em `main.rs`), leva da
    principal os MCPs (globais e por pasta), `enabledPlugins`, os registros de plugins e as
    pastas `skills`/`agents`/`commands` (Claude), e os `[mcp_servers]`/`[plugins]` (Codex).
    Mescla sem apagar.
  - Ligado por padrão (`extensoes.json`), com chave na aba Extensões.
  - Conectores do claude.ai não são copiáveis (ficam na conta, na nuvem), e a tela explica isso.
  - A EmailUber real já recebeu os 5 MCPs pela sessão do dev.
- [x] **Uso das contas na web**: "Atualizar" foi para baixo das barras (encostava na borda do card
  e espremia o nome).
- [x] **Web**:
  - Leitor de extensões movido para `omni_core::extensoes`. Rotas `GET /extensoes?projeto=<id>`
    e `POST /extensoes/compartilhar`.
  - Tela Extensões na web (`#/extensoes`, botão no topo), com a mesma `ExtensoesSettings`
    (`FonteDeExtensoes`).
  - Fila, Parar, tokens e status valem nos dois, porque o componente é o mesmo.
- [x] 383 testes de front, 88 do engine, 47 do core e 23 do Tauri verdes.
- [x] Publicada como release normal/latest (commit `a0cbcc6`, tag `v0.6.2`). CI e build verdes nas 3 plataformas; `latest.json` = 0.6.2, assinado; instalador Windows HTTP 200.

### v0.7.3 (publicada 2026-10-20, commit `5bb6e46`)
- [x] Reúne voz, comandos `/`, arquivo citado, layouts, fluxos como painel, uso de todas as IAs e bifurcação
  com histórico (sessão omni-agents-5b/66) e compactação de contexto, failover sem órfãos, git no topo da
  conversa, rodapé com avatar, mais modelos do Claude (esta sessão). Commits `9cd2468` (features) e `5bb6e46`
  (versão + notas). Pisos da compactação: antes do limite = metade da janela; depois da troca = 150k.
- [x] Verificado antes: tsc, 409 testes de front, 76 do core, 106 do engine (com whisper, cmake do VS no PATH e
  pasta de build sem espaço), `cargo check` do Tauri. CI da main verde nas 3 plataformas antes da tag.
- [x] Release verde nas 3 plataformas; rascunho conferido e publicado como latest; `latest.json` = 0.7.3 com
  assinatura nas 11 entradas; exe, dmg e AppImage HTTP 200.

### v0.7.2 (publicada 2026-10-19, commit `899bc43`)
- [x] Reúne as seções abaixo marcadas "sem release" (perguntas do agente, imagens no chat, Mac, celular sem
  arraste lateral) e o Antigravity da outra sessão. Commits: backend + Antigravity, front das perguntas/celular,
  versão + notas. Verificado antes: tsc, 391 testes de front, 72 do core, 100 do engine, `cargo check` do Tauri.
- [x] 1º CI falhou no Mac/Linux: teste de imagem citada com espaço no caminho (`/…` não aceitava espaço — o print
  padrão do Mac tem espaço). Corrigido em `899bc43`, build cancelado e tag `v0.7.2` movida antes de publicar.
- [x] CI e Release verdes nas 3 plataformas; publicada como latest; `latest.json` = 0.7.2 com assinatura nas 11
  entradas; instaladores (exe, dmg, AppImage, app.tar.gz) HTTP 200.

### macOS: conversa travada em "Entrada do CLI não reconhecida" (2026-10-18, entrou na 0.7.2)
- [x] Relato de usuário no Mac: conversa sempre bloqueada, sem trocar modelo nem nada. Causa: o Claude Code
  faz `process.title = <título da conversa>` (achado no binário 2.1.303); no macOS/Linux isso reescreve o
  `args` do `ps`, e `provider_running` (não-Windows) só procurava `claude` no `args` → agente "não rodando",
  `available=false`, tudo bloqueado. No Windows o title só muda a janela (lá a checagem é pelo `.exe`).
  Agora `provider_running` lê também o `comm` (no macOS, caminho do executável, com espaços) —
  `interaction.rs::agent_descends_from` + teste. `cargo check --target x86_64-unknown-linux-gnu` ok.
  **Não testado num Mac de verdade**: confirmar com o usuário após a próxima release.

### Pergunta do agente: lixo da conversa, prévia lado a lado e erro no clique (2026-10-19, sem release)
- [x] **Causa raiz**: o `escolha()` lia `screen.contents()`, que junta linha quebrada por largura com a de
  baixo. Depois de um turno, prompt destacado + borda + abas viravam uma linha (sem borda → a "pergunta" era
  20 linhas da conversa); na prévia, a pergunta (largura toda) colava na opção "1." e o menu nem era
  reconhecido. Agora `interaction::linha_a_linha` (`screen.rows`) alimenta o `escolha` (capabilities e execução).
- [x] Borda no meio da linha também é separada; opções só da opção 1 para baixo (lista numerada antiga não
  invalida mais o menu — era o 409 "Sessão ocupada…" intermitente no clique).
- [x] Prévia (`preview`): desenho cortado do rótulo/explicação, "Notes:" e "Chat about this" sem número
  ignorados. Ali o número só move a seleção → `Escolha.previa` ("to add notes") faz a execução mandar
  número e, 150 ms depois, Enter. Sem prévia continua só o número (Enter extra cairia na tela seguinte).
- [x] Front: 409 na escolha relê a tela e tenta uma vez se a mesma pergunta continua lá.
- [x] Testes com as telas dos prints + conferido ao vivo (Claude real): prévia → "Empilhado", pergunta
  normal depois de lista numerada → "Verde", nenhum erro no clique.

### Web do celular arrastava para o lado (2026-10-18, sem release)
- [x] Causa medida a 390 px: `.chat .bubble-agent` e `.chat .acoes` tinham `margin-left: 2.5rem` (coluna
  do avatar) + `max-width: 100%` → 28 px além da tela. `max-width` agora desconta a margem
  (`mobile.css`), e `pagina.css` trava a página com `overflow-x: clip` (não `hidden`, que quebraria o
  `sticky`) + `overscroll-behavior-x: none`. Remedido: nada vaza, `scrollTo(300,…)` fica em 0.
- [x] Cartão de pergunta (marcar várias + Continuar) e imagem citada conferidos ao vivo no web do celular
  com Claude real (`/`, 390×844) — mesmo `ConversationDetail` do `/pc`.

### Pergunta do agente na conversa (2026-10-17, sem release)
- [x] **AskUserQuestion não aparecia na conversa** (só no terminal). O menu tem uma borda `────` antes de
  "Chat about this" e o parser (`interaction::escolha`) começava a caixa na última borda, vendo só essa opção.
  Agora a caixa começa na borda acima da opção 1, bordas internas e a barra de abas (☐/✔) são ignoradas, borda
  colada na linha de baixo (linha cheia sem `
` no texto do vt100) é separada, e "Type something." fica de fora
  (abre um campo dentro do menu; "Chat about this" cobre resposta livre). Testes `pergunta_do_agente_vira_escolha`;
  conferido com Claude Code 2.1.302 real no engine de teste: pergunta e opções certas, responder pela rota
  `/escolher` segue a conversa.
- [x] **Várias perguntas, revisão e marcar várias** (2026-10-18), todos conferidos ao vivo (2.1.302, engine de
  teste + Playwright na web). Revisão final ("Ready to submit your answers?" / "1. Submit answers") vem sem rodapé
  e agora é reconhecida. MultiSelect: opções `[ ]`/`[✔]` viram `marcada`; o número marca/desmarca e Tab segue —
  nova resposta `{avancar: true}` (`Resposta::Avancar` em `mobile.rs`, só vale com `multipla`). `Escolha` ganhou
  `multipla`, `etapas` (abas ☐/☒) e `descricao` por opção; `detalhe` agora é uma linha da tela por linha.
- [x] **Cartão novo da pergunta** (`src/mobile/CartaoDePergunta.tsx`, CSS `.pergunta*` em `mobile.css`, vale no
  app e na web): visual do campo de mensagem, uma opção por linha com a descrição, caixa de marcar, etapas com ✓,
  revisão em lista, textos da CLI em português ("Responder com minhas palavras", "Enviar respostas").
- [x] **Clique seguido no marcar-várias se perdia**: o menu redesenha depois de marcar e o próximo clique chegava
  com a versão velha da tela (412). `post("escolher")` relê e tenta de novo só se a pergunta na tela é a mesma.
- [x] **Imagem citada pelo agente vira imagem na conversa** (`feed::caminhos_de_imagem`): caminho absoluto de
  `.png/.jpg/.jpeg/.gif/.webp` que existe (até 15 MB) no texto do agente conta em `Item::imagens` e sai pela rota
  de sempre `/conversas/{id}/imagens/{n}/{k}` — a rota continua só com índices, o caminho vem do transcript.
  Miniatura maior no balão do agente, abre ampliada. Conferido ao vivo. Obs.: colar um caminho de imagem no
  prompt do Claude Code vira anexo `[Image #1]` (comportamento da CLI).

### v0.7.1 (publicada 2026-10-17, commit `902eec8`)
- [x] Reúne orquestração (etapas 1–4), site/avisos/narração/instalador e o trabalho da outra sessão (resumo de
  agentes na lateral, tarefas pessoais, histórico no visual dos chats, shell com filho = ocupado, relatórios
  incrementais). Commits separados: `d3535c4` (fixes), `9a24f04` (relatórios), `f4f779c` (lateral/tarefas),
  `7ead4ac` (fluxos), `902eec8` (versão + notas).
- [x] CI e Release verdes nas 3 plataformas; `latest.json` = 0.7.1 com assinaturas; todos os instaladores HTTP 200.

### Orquestração de agentes (2026-10-17, entrou na 0.7.1)
- [x] Etapas 1 a 3 entregues (biblioteca de agentes, motor de fluxos, editor estilo n8n). Detalhes e pendências em
  `roadmaps/orquestracao/roadmap.md`.
- [x] Etapa 4: modelo/IA/esforço por agente e por nó, criar agente e fluxo inteiro com IA, JSON, execução com
  branch/worktree/atividade ao vivo, cartão de início, conexões novas, rodapé nos fluxos e manual com prints.

### Site, avisos de troca no lugar certo e narração do agente na conversa (2026-10-17, sem release)
- [x] **Site** em <https://omni.digitaldomus.com.br> (repo privado `FelipeCamposM/omni-agents-site`, projeto Vercel
  `omni-agents-site`, deploy a cada push). Vite + GSAP, visual do app; versão e notas buscadas do GitHub ao abrir
  (`src/dados.js` lê o `changelog.ts` só com regex + `JSON.parse`), snapshot de reserva no build; prints do app com
  dados do `browser_fixture` (nada real); `og-image.png` 1200×630. DNS: CNAME `omni` → Vercel na Cloudflare.
- [x] **Avisos de troca presos no fim do chat**: voltar a uma conta grava no mesmo `.jsonl`, e as mensagens novas eram
  lidas junto com o 1º segmento. `com_avisos_de_troca` (`conversations.rs`) agora posiciona pela hora da troca, junta
  trocas seguidas num aviso só e omite ida-e-volta para a mesma conta. Teste com o caso real.
- [x] **Fala do agente faltando na conversa**: a 2.1.302 grava o que diz entre ferramentas como `thinking` com texto
  (assinado); o raciocínio oculto vem vazio. `feed.rs` mostra `thinking` com texto, como o terminal. Conferido no
  transcript real desta sessão (frases que sumiam aparecem).
- [x] **Atualização pedia "Repetir" no Windows** (`src-tauri/installer-hooks.nsh`): o updater abre o instalador
  enquanto o app ainda fecha, e o Windows demora a soltar o `.exe`; a cópia falhava com "Erro ao abrir para
  escrita". O hook (antes da cópia e da desinstalação) agora espera app, engine e shim saírem (forçando após 2,5 s,
  desiste em 10 s) e só segue quando cada `.exe` aceita abrir para escrita. Compilado com o makensis do Tauri.
- [x] Publicado na 0.7.1.

### v0.7.0 (publicada 2026-10-17, commit `92334c9`)
- [x] Reúne as seções abaixo marcadas "sem release" (fundo da conversa, lateral/web/rodapé/painel vazio/Relatórios,
  Novo agente premium, bugs de terminal, campo da conversa, entrada não reconhecida, troca de conta que continua,
  abertas × histórico).
- [x] Typecheck, 387 testes de front (4 workers), core 54, engine 93, Tauri 25. CI verde nas 3 plataformas.
- [x] Publicada como latest; `latest.json` = 0.7.0, 11 entradas assinadas, todos os instaladores HTTP 200.

### Novo agente premium e dois bugs de terminal (2026-10-17, sem release)
- [x] **"Novo terminal" abria dois**: `TerminalPane.start()` só olhava `cancelled` depois do `spawnTerminal`; com o efeito
  rodando de novo durante a criação (StrictMode/remontagem) cada execução abria uma PTY. Agora uma criação só por
  sessão (`criandoRef`, promessa compartilhada). Teste em `src/test/TerminalPane.test.tsx`.
- [x] **"R", "1", ":" soltos num terminal parado**: ao reabrir a aba o xterm reproduzia o histórico e respondia de
  novo às perguntas antigas do shell (posição do cursor, cor de fundo); a resposta ia para a PTY como digitação. Agora as
  respostas durante a reprodução do histórico (só em sessão reatada, lendo do zero) são descartadas. Teste junto.
- [x] **Novo agente** (`AgentLauncher.tsx`, CSS `.lz-*` em `src/index.css`): cena com janela de terminal digitando o
  comando, mascote (Claude) ou ícone flutuando, faíscas, varredura CRT a cada troca, cartões entrando em sequência,
  escolhido pulsando e reflexo no botão Abrir. `Mascote` exportado de `PainelVazio.tsx`. Sem animação com movimento desligado.
- [x] **Web/celular: abertas × histórico** (`MobileApp.tsx::ConversasPorEstado`, `.m-subtitulo`): a lista do projeto
  separa "Abertas no PC" (`live`) do "Histórico", com contagem; usada na lateral da web e na tela de projeto do celular.
- [x] **Troca de conta continua sozinha no meio de uma tarefa** (`TerminalPane.tsx`): se o limite chega até 2 min
  depois do agente ter sido visto trabalhando (`trabalhouEmRef`), a troca marca `continuarRef`; o poll espera a conta
  nova mostrar o campo pronto (`/timeline` via `engineApi`) e manda `MENSAGEM_DE_CONTINUAR` pela fila (`/prompt`,
  `fila: true`), uma vez, desistindo em 2 min. A mensagem diz que é automática. Limite já na tela ao abrir = não manda.
- [x] **Troca de conta visível no chat** (`conversations.rs::aviso_de_troca`): na fronteira entre segmentos com conta
  ou IA diferente entra o aviso "Conta trocada: A → B" / "IA trocada: …" (antes mesmo de existir transcript novo);
  `LinhaDeAviso` destaca com ícone e cor do tema (`.aviso-troca`). Testes no core e no TerminalPane.
- [x] **"Entrada do CLI não reconhecida" num agente novo e parado**: a 2.1.302 desenha o exemplo
  `Try "fix lint errors"` com cada palavra em `dim` separado e os espaços entre elas sem estilo; `composer_vazio`
  (`interaction.rs`) via o espaço como rascunho. Espaço em branco agora conta como vazio. Achado lendo a tela real
  da sessão pelo protocolo local; teste com a sequência exata (falha sem a correção).
- [x] **Campo da conversa no app** (só CSS, `src/web/web.css`, escopo `.aba-conversa-tela`): cartão em pixel com brilho
  do tema, cantos acesos no foco, linha de luz no topo (corre no foco; barra verde indo e voltando com o agente
  trabalhando, via `:has(.composer-parar)`), Enviar com sombra dura e reflexo. Web e celular inalterados.
- [x] 387 testes de front verdes (com 4 workers; com paralelismo total oscilam testes de tempo já conhecidos).

### Lateral, web, rodapé, painel vazio e Relatórios (2026-10-16, sem release)
- [x] **Lateral do PC** (`src/components/Sidebar.tsx`, CSS `.lateral-*` em `src/index.css`): itens de chat em cartão
  (nome + tempo na 1ª linha, situação + conta na 2ª), avatar com brilho e pulso verde trabalhando, aba em foco
  marcada (`activeSessionId` vindo do `App.tsx`), contagem ao lado de CHATS/TERMINALS. Borda direita arrastável
  224–440 px (`LARGURA`), duplo clique volta a 256, setas pelo teclado; salva em `localStorage` (`omni-lateral-largura`).
- [x] **Web/celular — ocultar conversas**: rota `POST /conversas/{id}/ocultar {oculta}` (`mobile.rs`), lista em
  `conversas-ocultas.json` (só ids, teto 5000, id validado); `summaries` marca `hidden`. Front filtra das listas e mostra
  a seção recolhida `Ocultas` (`MobileApp.tsx::Ocultas`), reabre pelo botão de arquivo na conversa.
- [x] **Web/celular — bifurcar**: `POST /conversas/{id}/bifurcar` reaproveita `bifurcar()` do `main.rs` (novo parâmetro
  `headless`), exige sessão aberta (409 explicando), respeita `MAX_SESSOES`; botão na barra da conversa abre a nova.
- [x] **Web — Atualizar todas** em `src/web/UsoDasContas.tsx` (Claude/Codex em paralelo).
- [x] **Início do celular**: três números (Trabalhando / Aguardando / Projetos), seção Recentes, projetos ordenados
  por atividade com agentes e "há X" no lugar do caminho.
- [x] **Rodapé**: saiu o "● UI CONNECTED" (texto fixo, sem ligação com nada). Entrou `GitContaStatus`
  (`GitBranchStatus.tsx`) com comando `git_conta` (`src-tauri/src/git_client.rs`): login do `gh auth status` ou
  `user.name`, ícone GitHub/git verde ou amarelo com o motivo no tooltip; nunca e-mail nem token.
- [x] **Painel vazio** (`src/features/workspace/PainelVazio.tsx`): mascote em pixel andando com falas, cartões
  Novo agente / Novo terminal e atalhos; sem animação com movimento desligado.
- [x] **Configurações → Relatórios** (`src/features/relatorios/RelatoriosIa.tsx`): `omni_core::relatorio` lê os
  transcripts de todas as contas (Claude e Codex), sem conteúdo, com cache por arquivo e sem contar cópias de fork;
  comando `relatorio_ia` (`src-tauri/src/relatorio.rs`) junta commits dos projetos abertos (`commits_recentes`, IA pelo
  trailer `Co-Authored-By`). Mostra tokens/mensagens hoje, commits e linhas da IA, gráfico por dia, por conta/modelo/
  projeto e por hora. Dados reais: 30 dias em ~3,5 s na 1ª leitura, ~50 ms com cache.
- [x] Testes: front 385, core 53, engine 92, Tauri 25. Conferido em print (app via Vite, web e celular no engine de teste).
- [ ] Próximo: entra na próxima release (changelog em linguagem de usuário).

### Fundo da conversa igual à web (2026-10-16, sem release)
- [x] Configuração nova `conversationBackground` (`"web"` padrão | `"liso"`) em `src/types/settings.ts`;
  Configurações → Geral → Agentes → "Fundo da conversa" (`SettingsView.tsx`).
- [x] `useSettings` grava `data-conversa` no `<html>`; a visão Conversa ganhou a classe `aba-conversa-tela`
  (`AbaDeAgente.tsx`) e `src/web/web.css` pinta grade de pixels + brilho na cor do tema só nesse painel
  (não depende do fundo do app, que por padrão é efeito animado).
- [x] Movido para Configurações → Aparência, card "Conversa", com slider "Opacidade das linhas"
  (`conversationGridOpacity` 0..100, padrão 26 → CSS `--conversa-grade` = valor/400), visível só no modo web.
- [x] Aparência reorganizada em grade 2×2 de mesma altura (`settings-grade-par` em `src/index.css`):
  Tema | Painéis e movimento (Relevo + Animações) / Fundo do app | Terminais e conversa.
- [x] Conferido em print (Playwright + Vite); 385 testes de front verdes.
- [ ] Próximo: entra na próxima release (entrada no changelog quando subir versão).

### v0.6.4 (publicada 2026-10-16, commit `99a976a`)

- [x] **Mensagem mandada no meio do turno ficava "na fila" para sempre**: o Claude Code entrega a
  mensagem ao agente na pausa entre ferramentas e grava como `{"type":"attachment","attachment":
  {"type":"queued_command","prompt":…,"commandMode":"prompt"}}`, não como fala do usuário. O feed
  ignorava a linha: a bolha não saía da fila e a mensagem sumia do histórico. `feed::items` e
  `conversations::text_message` agora leem o anexo (só `commandMode` prompt). Teste no `feed.rs`.
- [x] **"Entrada do CLI não reconhecida" depois do primeiro turno**: o Claude Code 2.1.302 abre um
  menu ("Teach auto mode about your environment? 1. Yes / 2. Not now / 3. Don't show again") que
  trava o campo. Reproduzido no engine de teste (sem `NO_COLOR` herdado). `interaction::escolha`
  reconhece qualquer menu numerado com rodapé "Enter … Esc to cancel" (fora pedidos de permissão,
  que seguem no `approval`); `Capabilities.escolha`, rota `POST /conversas/{id}/escolher`
  (`ActionKind::Escolha`, manda só o dígito — confirmado no CLI real — ou Esc). A conversa mostra
  o cartão "A CLI está perguntando" com um botão por opção. Testes no engine e no front.
- [x] **Conversa que terminou aparecia "interrompida"**: `notice_counts` só conta aviso de limite/
  erro de API que **não** foi seguido de fala do agente (`●`) e ignora linhas "Retrying".
  Teste `aviso_superado_no_mesmo_turno_nao_interrompe`.
- [x] **Renomear terminal (shell) não fazia nada**: shell não tem conversa. `EngineRequest::RenameSession`
  (engine grava `meta.name` e persiste), comando Tauri `rename_session`, `renameSession` no
  `terminalService` usado pela lateral e pela aba.
- [x] **Imagem enviada virava "[Image #1][Anexos enviados pelo OMNI]"**: a CLI troca o caminho por um
  bloco base64 no transcript. `feed::Item.imagens` conta os blocos; `GET /conversas/{id}/imagens/{n}/{k}`
  devolve `{tipo, dados}` (JSON para passar pelo protocolo do engine); o balão mostra miniaturas
  que ampliam (portal no `body`). `[Image #N]` sai do texto, do título e do histórico
  (`feed::sem_marcas_de_imagem`); o `-` órfão da lista de anexos é aceito por `separarAnexos`.
- [x] **Visual do app**: aba de agente ganhou o topo da web (abas Conversa | Terminal, título e estado
  da conversa; no modo terminal os chips de conta/modelo/esforço ficam ao lado das abas). Lateral:
  conversas e terminais em duas linhas (avatar com selo de status, nome, situação · conta · tempo),
  ações sobrepostas só no hover. Conferido com `app_chat.js` (mock do Tauri + engine de teste).

### v0.6.3 (publicada 2026-10-15, commit `40e61a7`)

- [x] **Mensagem colada sumia da conversa** ("Não consegui confirmar o envio"): a CLI grava texto
  colado como `<pasted_content id="…">…</pasted_content id="…">` e o filtro de texto injetado
  descartava tudo que começa com `<`. `omni_core::feed::sem_colado` desembrulha (feed, título e
  histórico via `text_message`). Teste no `feed.rs`; conferido na conversa real pela web.
- [x] **Mensagens anteriores sem trocar de página** (`ConversationDetail` em `MobileApp.tsx`):
  as páginas antigas entram acima das recentes (`juntarPaginas`, pela numeração do servidor), a
  rolagem é compensada (`useLayoutEffect` com âncora de altura) e chegar ao topo busca sozinho.
  Saiu o modo "página antiga" com "Próximas mensagens"/"Ir para as mais recentes". Conferido no
  navegador: o item visível fica no mesmo pixel após cada carga.
- [x] **Dropdown de uso das contas** (`UsoDeTodasAsContas.tsx`, CSS `.uso-*`): agrupado por IA,
  selo "em uso", e-mail, horário de reset por janela, "consultado há…" e "Atualizar todas".
- [x] **Estrela da conta principal** (`omni_core::compartilhar::{principal, principais,
  definir_principal}`, preferência `principal` no `extensoes.json`): a conta com estrela é a fonte
  das extensões; sem estrela vale a nativa. Comando Tauri `definir_conta_principal`, rota
  `POST /extensoes/principal`, botão ★ em cada conta na aba Extensões (`.ext-estrela`,
  `StarFilledIcon`). Teste `estrela_troca_a_conta_de_onde_as_outras_recebem`; conferido no mock.
- [x] **Compartilhamento mais seguro** (`omni_core::compartilhar`): troca de estrela/liga-desliga
  pula contas com sessão aberta (`com_sessao_aberta`, lê o `sessions.json`) — recebem antes da
  próxima sessão; `config.toml` do Codex mesclado com `toml_edit` (comentários ficam, arquivo
  inválido não é tocado); plugin cujo `installPath` sumiu sai do registro e do `enabledPlugins`;
  skills copiadas e não editadas acompanham a principal (`omni-copiadas.json` guarda a data de
  cada cópia). Testes `skill_copiada_…`, `plugin_desinstalado_…`, `conta_com_sessao_aberta_…`.
- [-] **Conectores do claude.ai nas contas extras — descartado** (decisão do usuário, 2026-10-15).
  Só seria possível repassando o token OAuth da conta principal ao `mcp-proxy.anthropic.com`,
  endpoint não público e restrito a clientes oficiais. Riscos: termos de uso (suspensão da conta
  principal), quebra silenciosa a cada versão do Claude Code e conflito na renovação do login.
  Fica como está: cada conta conecta os seus em claude.ai → Configurações → Conectores (a aba
  Extensões já explica). Não retomar sem nova decisão do usuário.
- [x] **Resumo de agentes nas linhas de Workspaces e Projects** (2026-10-17). Linhas no mesmo
  visual dos chats (avatar 8×8, duas linhas, `lateral-item`); a segunda linha traz um selo por
  (agente, status): ícone do agente, cor do status e quantos. `ResumoDeAgentes` em
  `src/components/ConversaStatus.tsx`; App passa `agentSessions` (todas as conversas vivas) à
  `Sidebar` e à `WorkspaceList`. Sessões encerradas ficam de fora.
- [x] **Terminal com dev server aparecia "parado"** (2026-10-17). Shell puro virava `Answered` após
  1,5 s sem saída. Agora `settle` (`crates/omni-engine/src/main.rs`) mantém `Working` enquanto o
  shell tem processo filho (`interaction::has_children`, ToolHelp no Windows / `ps` fora). Teste
  `shell_com_filho_vivo_conta_como_ocupado`.
- [x] **Histórico de conversas no visual dos chats** (2026-10-17). Lista em
  `src/features/history/HistoryView.tsx` usa o cartão da lateral (avatar 8×8, duas linhas);
  CSS `.historico-item*` removido de `src/index.css`.
- [x] **Tarefas pessoais na lateral** (2026-10-17). Seção TAREFAS (global, não é o Kanban dos
  agentes): adicionar com Enter, concluir, apagar, limpar concluídas; contador de pendentes.
  `src/features/todo/TodoList.tsx` (localStorage `omni-todo`), teste `src/test/todo.test.tsx`.
- [x] **Relatórios rápidos + visual novo** (2026-10-17). Cache dos transcripts agora em disco
  (`<engine_dir>/relatorio-cache.json`) e incremental: cada `.jsonl` é lido só a partir do byte
  onde parou (`linhas_novas` em `crates/omni-core/src/relatorio.rs`, teste `continua_de_onde_parou`).
  Git dos projetos roda em paralelo (`src-tauri/src/relatorio.rs`); commit agora traz `removidas`.
  A tela abre com o último resultado (localStorage `omni-relatorio-v1-<dias>`) e atualiza por trás.
  Visual: 6 cartões com ícone (tokens do período, % de cache, dias com uso/sequência, linhas +/−),
  títulos com ícone, "Git por projeto" com ícone de branch, último commit e +/− da IA.
- [x] **Antigravity CLI (`agy`) como agente** (2026-10-18). Provider `antigravity` (binário `agy`, conferido
  na 1.4.2 instalada aqui): abre em conversa/terminal como o Cursor, botão de instalar
  (`irm https://antigravity.google/cli/install.ps1 | iex` / `install.sh`), PATH ampliado com
  `%LOCALAPPDATA%\agy\bin`, ícone em pixel, rótulo nas conversas. Só a conta nativa: o token fica no
  cofre do SO e o `agy` não aceita trocar o diretório de config, então não há contas extras nem troca
  automática. "Conectado" = existe `~/.gemini/antigravity-cli/settings.json` (já configurado; `ponytail:` em
  `profiles.rs`). Fora por enquanto: fluxos (executor só Claude/Codex), histórico/relatórios (formato dos
  arquivos de conversa não documentado), retomar com troca de modelo/conta.
  - Testado de verdade (2026-10-18, logado): `agy -p ... --output-format json` respondeu `SUCCESS` (11,7 mil
    tokens, 21 s). Conversas ficam em `~/.gemini/antigravity-cli/conversations/<id>.db` (SQLite, não JSONL);
    `settings.json` guarda `trustedWorkspaces` → `ensure_agent_trust` agora inclui o projeto antes de abrir
    (`trust_antigravity` em `src-tauri/src/engine_client.rs`), como o Claude.
- [x] **Antigravity: visão Conversa, uso e seleção 2×2/4** (2026-10-18). Telas reais do agy 1.4.2 enviadas pelo
  usuário + leitura de cópias dos `.db`.
  - Conversa: `crates/omni-core/src/antigravity.rs` lê `conversations/<id>.db` (SQLite, passos em protobuf sem
    schema: 14 = você `19.2`, 15 = resposta `20.1`, ação = `5.4.2` + resumo `140.1`, hora `5.1`) com `rusqlite`
    (bundled); `descobrir` acha a conversa da sessão pelo `conversation_summaries.db` (pasta + criada depois do
    início). `conversations.rs` resolve/descobre/lê o `.db`. Conferido num `.db` real (acentos ok).
  - Tela: `provider_running` procurava `antigravity.exe` (o binário é `agy.exe`) → nada era reconhecido. `ready`
    pelo rodapé "? for shortcuts", turno por "esc to cancel" (`in_turn` agora por provider), pergunta
    `ask_question` vira escolha (setas + Enter; "Write-in..." fora). Aprovação de ferramenta ainda não
    reconhecida (sem tela real): fica no terminal.
  - Uso: `parse_antigravity_screen` (painel "Models & Quota", grupo Gemini; mostra o que **resta**, guardamos o
    usado); engine digita `/usage` num agy ocioso ou num oculto na pasta do engine (confiada antes) e guarda
    `uso-antigravity-<conta>.json`.
  - Seleção de agentes: 4 colunas ou 2×2 por container query (`.launcher-agentes`).
- [x] **Antigravity: Conversa mostrava a conversa antiga** (2026-10-19). Ao reabrir (engine reiniciado no
  `npm run dev`), o agy começava conversa nova e o ponteiro ficava na primeira. Agora cada sessão abre com
  `--log-file <config>/log/omni-<sessão>.log` (conferido: o log traz "Created conversation <id>" /
  "Starting conversation update stream for <id>"); `conversa_da_sessao` lê a conversa atual por ele (cobre
  `/clear`), o ponteiro é reconferido sempre, e reiniciar/restaurar reabre com `--conversation <id>`.
  Campo "não reconhecido": motivo detalhado por condição do `ready` (`motivo_antigravity`, temporário) para
  calibrar com a próxima tela real.
- [x] **Antigravity: trocar modelo e esforço** (2026-10-19). Pesquisa no agy 1.4.2: `agy models` lista variantes
  com o esforço no nome (`gemini-4-argon-high`); `--model <família> --effort <nível>` escolhe a variante (recusa
  esforço inexistente); `--conversation <id> --model …` retoma a mesma conversa com outro modelo (testado: lembrou
  a 1ª mensagem); o log da sessão grava `label="… (High)"`. Implementado: `omni_core::antigravity::{familias,
  familia_e_esforco, modelo_da_sessao}`; engine guarda o `agy models` por 1 dia (`modelos-antigravity.txt`),
  `/opcoes` lista famílias com seus esforços e o modelo atual; `comando_de_retomada` monta
  `agy --model … --effort … --conversation <id>` e o reinício preserva. Conta: só a nativa (seletor some).

### 2026-10-19 — Troca de modelo do Antigravity logo após a 1ª mensagem + reordenar abas

- [x] Antigravity: a faixa de modelo travava em "Mande a primeira mensagem antes de trocar". O id da
      conversa do agy só nasce na 1ª mensagem e o índice só o recebe na descoberta seguinte; a faixa
      lia as opções uma vez. `id_externo` (`crates/omni-engine/src/mobile.rs`) lê o id do log da
      sessão quando falta no índice (usado em `/opcoes` e no "Aplicar"); `AjustesDaConversa.tsx`
      relê as opções a cada fim de turno. Verificado num engine isolado: trocar logo após a 1ª
      resposta reabre a mesma conversa em Gemini 3.8 Flash · low.
- [x] Reordenar abas no mesmo painel: soltar uma aba sobre outra (metade esquerda = antes, direita =
      depois). `MOVE_TAB` ganhou `index` (`workspaceReducer.ts`, `tabPointerDrag.ts`,
      `WorkspaceTabBar.tsx` com `data-tab-index`); teste em `workspaceReducer.test.ts`.
- [x] CLI órfã ao fechar/parar/reiniciar aba (Windows): o `kill` da PTY só derrubava o shell.
      `matar_arvore` (`crates/omni-engine/src/main.rs`, `taskkill /T`) em `close_session`,
      `stop_session` e `restart_session`. Verificado num engine isolado: `ping` filho some ao fechar.
      macOS/Linux ficam no SIGHUP da PTY (ponytail anotado).
- [x] Menu do Claude só de setas, sem números ("We recommend compacting earlier", rodapé
      "↑/↓ choose · enter confirm · esc not now"): travava o campo e a conversa dizia "entrada não
      reconhecida". `escolha_por_setas` (`interaction.rs`, teste `escolha_de_setas_sem_numero`) vira
      cartão de pergunta; resposta anda com ↑/↓ da opção marcada (`mobile.rs`).
- [x] Selecionar e copiar (Ctrl+C) texto das mensagens na Conversa do desktop: o `body` barra
      seleção; a bolha ganhou `selectable` (`src/mobile/Chat.tsx`). Realce da seleção na cor da
      paleta (`::selection` com `--c-selected` em `src/index.css`), não no azul do sistema.
- [x] "Mais modelos" do Claude no seletor da conversa: `MODELOS_CLAUDE` (`mobile.rs`) ganhou dica e
      seção, com as versões fixas que o `/model` da CLI 2.1.304 lista (Fable 5, Opus 5, Sonnet 5,
      Haiku 4.5, Opus 4.8/4.7/4.6, Sonnet 4.6); `Select` aceita `section` (cabeçalho de grupo) e os
      menus dos chips foram redesenhados (`mobile.css`, `.select-secao` em `index.css`). Codex e
      Antigravity já listam tudo o que a conta enxerga. Pendente: conferir na tela.
- [x] Gasto de tokens na troca de conta (diagnóstico 19/10: conversas de 400–550k relidas a cada
      passo; o cache não passa entre contas; órfãos de failover em "continuing automatically at 1am"
      e o "continue" desistindo em 2 min). Feito:
      - Compactação configurável (Configurações → Agentes → `CompactacaoCard`, engine
        `compactacao.json` + `GET/POST /compactacao`): janela 400k/1M via
        `CLAUDE_CODE_AUTO_COMPACT_WINDOW` no ambiente de toda sessão (`ambiente_do_terminal`) e
        `autoCompactEnabled: true` no settings.json da conta antes de abrir (`garantir_autocompact`,
        edita o texto sem reordenar).
      - Opção 1, antes do limite: agente parado + uso ≥ limiar → `/compact` na conta atual
        (`talvezCompactarAntes` em `TerminalPane.tsx`, uma vez por conversa/janela).
      - Opção 2, depois da troca: conversa ≥ 60k → fila `/compact` e só depois "continue"
        (`continuarRef.mensagens`); espera da conta nova 2 → 10 min.
      - Chip "Contexto 132k / 400k" na caixa de texto (`context_tokens`/`context_window` no
        `/opcoes`, lido do `usage` da última resposta em `runtime.rs`).
      Pendente: testar ao vivo o `/compact` pela rota de prompt e a troca real de conta.
      Correção (20/10): abrir uma conversa parada de 80k mandou `/compact` sozinho. Agora a opção 1
      exige o agente ter trabalhado nesta aba nos últimos 3 min (`ACABOU_DE_TRABALHAR_MS`) e a
      opção 2 só compacta quando a troca pegou uma tarefa no meio. Teste de regressão no
      `TerminalPane.test.tsx`.
- [x] Git no topo da conversa: branch (destacada, cor da paleta), Pull e "Ver grafo" saíram do
      rodapé (que ficou só com a conta do git) para o topo da Conversa (`GitBranchStatus` em
      `AbaDeAgente.tsx`, pasta = `cwd` da sessão; popover agora abre para baixo). Grafo em modal
      (`GitGraphModal`) com "Fetch from remote" (`git_fetch` = `fetch --all --prune` em
      `src-tauri/src/git_client.rs`). Topo sem o texto "Pronta para a próxima mensagem": só a
      etiqueta de status, motivo da parada no tooltip. Composer: anexo e microfone junto do enviar.
      Atalho de nova branch agora vive no topo da conversa (sem aba de agente aberta, não abre).
- [x] Rodapé repaginado (`.rodape-app` em `index.css`, `RodapeDoProjeto`): avatar do GitHub
      (`github.com/<login>.png`, inicial como reserva; ponto verde/amarelo = estado do git), filete
      entre grupos e selo "Engine online". CSP `img-src` liberou `github.com` e
      `avatars.githubusercontent.com`. Anexo e microfone com a mesma altura/borda do Parar/Enviar,
      colados como grupo (`.composer-direita .composer-botao`). Pendente: conferir na tela.

## Pedido 2026-10-19: splits, /comandos, fluxos em painel, arquivo clicável, uso de todas as IAs (sem release)
- [x] **Uso de todas as IAs**: painel do rodapé (`UsoDeTodasAsContas.tsx`) lista Claude, Codex, Antigravity e Cursor (antes só Claude/Codex). Medidor em 20 blocos de pixel (`.uso-blocos`). Cursor aparece sem medidor: a CLI só informa o plano (`agent about`), não o consumo. Rodapé mostra "sem medidor de uso" para Cursor. `NOME_DO_AGENTE` único em `mobile/api.ts` (chat mostrava "antigravity" cru).
- [x] **Mais layouts**: 12 moldes em `features/workspace/layoutPresets.ts` (3/4 colunas, 3 linhas, grade 3×2, lateral+principal, principal+3, principal em cima/embaixo…). O molde monta a árvore e desenha a miniatura do seletor (grade 4×3).
- [x] **Fluxos como painel**: `PaneKind` "fluxos"; "Fluxos de agentes" na lateral abre aba no painel ativo (sem projeto: tela cheia). Editor responsivo por `@container` (laterais empilham em painel estreito).
- [x] **Arquivo citado clicável (só app do PC)**: `código` com cara de arquivo, link relativo `[x](src/a.ts#L1)` e ações Leu/Editou/Escreveu abrem o arquivo (`usarAbrirArquivo` em `main.tsx` → evento `omni:abrir-arquivo` → `App`). Web/celular: texto. Teste `src/test/ArquivoCitado.test.tsx`.
- [x] **`/` no chat**: a rota `prompt` não recusa mais `/comando` (só caractere de controle). Conferido
  no Claude 2.1.304 que `/context` colado (bracketed paste, como o engine manda) + Enter executa como
  comando. `omni-core/src/comandos.rs` lista por agente — Claude: embutidos (inclui as skills da CLI:
  code-review, simplify, loop…), `commands/**.md` da conta e do projeto (subpasta = `ns:nome`),
  `skills/*/SKILL.md` da conta e do projeto, plugins **ligados** (`installed_plugins.json` +
  `enabledPlugins`; escopo projeto só na pasta dele; `_*.md` ignorado). Codex: embutidos +
  `prompts/*.md` → `prompts:nome`. Sai só nome/descrição. Rota `GET /conversas/{id}/comandos` (conta do
  último segmento). Composer: menu ao digitar `/` no começo; Tab completa, Enter completa ou envia se
  já é o comando exato. Na conta real: 98 itens (26 embutidos, 12 skills, 60 de plugins).
  Testes: `comandos::tests` (2), `src/test/ComandosBarra.test.tsx` (3).
  Limite: Antigravity e Cursor sem lista (o `/` ainda envia).
- Suíte do front: 68 arquivos passam com 4 threads; com o paralelismo padrão, 2 testes de tempo
  (diferentes a cada rodada) falham com o `npm run dev` rodando junto — isolados, passam.
- Faltou: print ponta a ponta do clique em arquivo no app.
- Artefato de teste: uma conversa "C:/Program Files/Git/context" no histórico do OMNI-AGENTS (o Git Bash
  converteu o argumento `/context` do meu script; virou prompt e bateu no limite da conta).

### 2026-10-20 — Celular: conversa presa na tela, acompanhar a resposta, home com uso e busca de projetos (sem release)

- [x] **Acompanhar o agente escrevendo**: a tela só descia quando chegava mensagem com id novo; resposta
  crescendo, ações entrando no mesmo bloco ou imagem carregando não moviam nada. Agora um
  `MutationObserver` na lista + `ResizeObserver` no rolador seguem o fim enquanto quem lê está nele
  (`src/mobile/MobileApp.tsx`, `ConversationDetail`). `irParaOFim` rola o próprio rolador
  (`scrollTo`) em vez de `scrollIntoView`, que também arrastava a página.
- [x] **Teclado não empurra mais o topo**: na conversa a casca vira `.m-shell-chat` (fixa, na área
  visível publicada por `useAreaVisivel` em `--vv-topo`/`--vv-altura` a partir do `visualViewport`).
  Topo e campo ficam parados; só a lista rola. Com o campo em foco os chips (contexto, conta, modelo,
  esforço) somem para a conversa ganhar espaço (`:has(.composer-campo:focus)`), e voltam ao fechar o teclado.
- [x] **Home**: card "Uso das contas" (reusa `src/web/UsoDasContas.tsx`; o CSS saiu de `web.css` para
  `src/web/uso.css`, importado pelo componente). No celular o atualizar é só o ícone.
- [x] **Projetos**: busca agora acha projetos (nome ou pasta) e conversas. A lista mostra os 6 projetos com
  conversa mais recentes; pastas temporárias (`PASTA_TEMPORARIA`: pasta oculta, `Temp`, `tmp`,
  `worktrees`) e projetos sem conversa ficam em "Mostrar todos". Cada card mostra de qual pasta vem.
- Testes: `src/test/MobileApp.test.tsx` (início com uso + recolher, busca de projeto, regex de pasta
  temporária, conversa seguindo texto que cresce). 412+ testes, typecheck ok. Conferido em Chrome
  headless 390px contra o engine real (inclusive altura 500px simulando teclado).
- Não testado em aparelho de verdade (iOS/Android): o `visualViewport` é o ponto a conferir.

### 2026-10-20 — Uso da conta na conversa (celular), git no painel estreito, conversa travada por U+FFFD (sem release)

- [x] **Celular, conversa aberta**: faixa com o uso (5H/semana) só da conta da conversa (sem conta escolhida, as do agente
  dela), acima das mensagens; some enquanto digita. `UsoDasContas` ganhou `daConversa`; a faixa é montada na rota do
  celular em `src/mobile/MobileApp.tsx` (não no `ConversationDetail`, que o PC e a web também usam). Teste em
  `src/test/UsoDasContas.test.tsx`.
- [x] **Branch no topo da conversa estourava** com o painel estreito (tela dividida): a media query olhava a janela.
  `.aba-agente-topo` virou container (`src/web/web.css`): até 560px saem Pull/Ver grafo/título; até 400px a branch fica
  só o ícone.
- [x] **Conversa travada em "Entrada do CLI não reconhecida" (sem enviar nem enfileirar)**: o ConPTY escreve U+FFFD no
  lugar do acento que não converte (ex.: aviso do Windows "Configurações" na saída de um comando); o terminal desenha
  com 1 coluna e o `vt100` com 0. A tela do engine entortava e a linha do `❯` ficava coberta pela borda.
  `interaction::sem_substituto` troca por `?` antes do parser (`crates/omni-engine/src/main.rs::append_output`).
  Confirmado reproduzindo a saída real da sessão: sem a troca `composer_vazio=false`, com ela `true`. Teste
  `substituto_ocupa_uma_coluna`. Vale só com engine novo (release).
- [ ] **Achado, não corrigido**: Claude Code 2.1.304 abre "Resume this conversation?" (conversa ociosa há horas) ao
  receber o `/usage` que o leitor de uso digita em sessão parada; a sessão fica presa no diálogo, e "Resume" custa
  ~10% do limite de 5h. Decidir: não consultar uso em sessão ociosa há muito tempo, ou reconhecer o diálogo.

### v0.7.4 (publicada 2026-10-20, commit `b21e616`)
- [x] Correção da conversa travada por U+FFFD (engine), celular acompanhando a resposta com topo/caixa fixos no
  teclado, uso da conta na conversa do celular, início do celular com uso/busca/recorte de projetos, branch do topo
  ajustada ao painel estreito.
- [x] Verificado antes: tsc, 414 testes de front, 107 do engine, `cargo check` do Tauri. CI da main verde nas 3
  plataformas antes da tag; release verde nas 3; rascunho publicado como latest; `latest.json` = 0.7.4 com
  assinatura nas 11 entradas; os 6 instaladores HTTP 200.
- [ ] Pendente: diálogo "Resume this conversation?" do Claude Code 2.1.304 disparado pelo `/usage` em sessão ociosa
  (ver entrada acima).

### 2026-10-20 — Prévia no navegador (localhost do PC na web e no celular) e versão no topo da web (sem release)

- [x] **Prévia**: `crates/omni-engine/src/previa.rs` — repasse TCP por porta (alvo + 10000, ou porta livre), não por
  caminho (Next/Vite pedem pela raiz e usam websocket). Reescreve `Host`/`Origin` para `localhost:<alvo>` (Vite
  recusaria o host, Next bloqueia HMR de outra origem); `Connection: close` por pedido, `Upgrade` mantido para HMR.
  Acesso por segredo na URL (`?__omni=`) que vira cookie `omni_previa_<porta>`; sem ele, 403. Modo direto: escuta no
  IP do acesso; modo Serve: escuta em loopback e publica `tailscale serve --https=<porta>` (testado no Tailscale real:
  porta arbitrária aceita; removida ao parar). Rotas `GET/POST /previas`, `POST /previas/{porta}/fechar`. Lista testa
  portas comuns (3000, 5173, 8080…) e aceita qualquer outra digitada.
- [x] Tela: `src/web/PreviasLocais.tsx` (+ `previas.css`) na lateral da web e na home do celular; abre numa aba nova
  (janela aberta antes do `await`, senão o celular bloqueia). Engine antigo (404): "Atualize o OMNI no PC".
- [x] **Versão** sutil abaixo de "OMNI AGENTS" no topo da web (só PC; some na largura de celular). `__APP_VERSION__`
  via `define` no `vite.config.ts` **e** no `vite.mobile.config.ts` (faltava neste: a web ficava preta com ReferenceError).
- [x] Testes: 6 em `previa.rs` (inclui ponta a ponta com servidor falso), `src/test/PreviasLocais.test.tsx`.
  416 front, 112 engine, `cargo check` ok. Prints conferidos (web 1280px, celular 390px).
- [ ] Limites: prévias somem quando o engine reinicia (a publicação do Serve fica apontando para nada até abrir de novo);
  OAuth com callback para `localhost` não funciona pela prévia.

### Fala do navegador no prompt (sem release)

- [x] `src/mobile/voz.ts` → `falaDoNavegador()`/`ouvir()`: Web Speech API (`SpeechRecognition`), texto parcial em
  tempo real, sem modelo no PC. Religa quando o Chrome encerra no silêncio, guardando o que já veio.
- [x] `Composer` usa a fala do navegador quando existe; senão, o whisper do PC como antes. Fora do app desktop
  (WebView2 tem o objeto mas não o serviço) e fora de página segura. Firefox não tem → whisper.
- [x] Teste: `src/test/FalaDoNavegador.test.tsx`. 417 front ok.
- [ ] Não testado em aparelho real. Áudio vai ao serviço do navegador (Google no Chrome, Apple no Safari).
  Chrome do Android pode repetir trechos no modo contínuo — ver `ponytail:` em `ouvir()`.

### Link do chat prendia o app na página (sem release)

- [x] Clicar em `http://localhost:3000` (ou qualquer link) no chat do app navegava a própria janela para a página,
  sem volta. `src-tauri/src/lib.rs`: plugin `links-externos` com `on_navigation` — só a tela do app
  (`tauri.localhost`, Vite 1420, `about:`/`blob:`/`data:`) navega na janela; http(s) externo abre no navegador do
  sistema (`tauri_plugin_opener::open_url`, lado Rust, sem escopo de capability). Teste `so_a_tela_do_app_navega_na_janela`.

### Release v0.7.5 publicada (2026-10-20)

- [x] Prévia no navegador, fala do navegador na web/celular, link externo do app no navegador do sistema, versão no topo
  da web. CI verde (`cb57d5f`), release `v0.7.5` publicada como latest; `latest.json` servindo 0.7.5.

### Exportar conversa para outro agente + uso do Antigravity na web (sem release)

- [x] `crates/omni-core/src/exportar.rs`: `pacote()` monta o Markdown (objetivo = 1º pedido, arquivos alterados com +/−
  somados do `Item.diff`, últimos 15 comandos, últimas falas até 12k caracteres) e passa por `sem_segredos()` (prefixos
  `sk-`/`ghp_`/`AKIA`… e `X_TOKEN=valor`). `salvar()` grava em `<projeto>/.omni/exports/<data>-<slug>.md` com
  `.gitignore` próprio (`*`). `prompt_inicial()` = só o caminho (limite de 32k da linha de comando). chrono ganhou `clock`
  (já estava no lock). `conversations::itens_cached` separado de `timeline_cached`.
- [x] Engine (`mobile.rs`): `GET /conversas/{id}/exportar` (prévia / copiar) e `POST` `{provider, profile_id}` → grava o
  pacote e abre a conversa nova na hora (`spawn_plano`, extraído de `spawn_from_mobile`), comando `<cli> "<prompt>"`.
  Vale para conversa do índice e do histórico (projeto achado pela pasta).
- [x] Front: `src/mobile/ExportarConversa.tsx` (botão nos chips da conversa, app e web): modal com agente (sugere outro
  que não o atual) e conta, "Exportar" e "Copiar como Markdown". Web vai para a conversa nova; no PC ela aparece em CHATS.
- [x] Uso do Antigravity na web: `/contas` lê a última consulta salva (`account_usage(.., false)`), `/contas/{id}/uso`
  consulta o `/usage` do agy; `UsoDasContas` mostra o nome "Antigravity".
- [x] Testes: core `pacote_tem_objetivo…`, `segredos_em_variavel…`; front `ExportarConversa.test.tsx`, `UsoDasContas.test.tsx`.
- [ ] Próximo: resumo com o Haiku e prévia editável antes de exportar; "Continuação de …" ligando as duas conversas.

### Fala do navegador: "Sem conexão com o reconhecimento" (sem release)

- [x] Erro `network` do Web Speech = navegador sem o serviço de fala (Brave, Opera, Vivaldi, Chromium) ou sem rede.
  `src/mobile/voz.ts`: mensagem `FALA_SEM_SERVICO` explica e manda para Chrome/Edge; marca a aba (`sessionStorage`).
  `Composer.tsx`: com a voz do PC instalada, troca para o whisper do PC (`BotaoDeVoz`) em vez de mostrar o erro.
  Teste em `FalaDoNavegador.test.tsx`.

### PDF abria como texto no editor (sem release)

- [x] Arquivo `.pdf` caía no Monaco e mostrava o binário. `PdfPane` (`src/features/files/ImagePane.tsx`) abre no leitor
  nativo do WebView2 via `<iframe src={convertFileSrc(...)}>`; `isPdfPath` em `filesService.ts`, rota em `PaneView.tsx`.
  CSP ganhou `frame-src 'self' asset: http://asset.localhost https://asset.localhost` (travado em `csp.test.ts`).
  Teste em `PaneView.test.tsx`.

### Release v0.7.6 publicada (2026-10-21)

- [x] Armazenamento + limpeza, conta mestra (hard link), Agentes refeita, tarefas no topo, arrasto flutuante, microfone
  sem aviso do WebView2 + ondas, abertura em etapas, vocabulário da voz, títulos curtos, diff nas edições. CI verde
  (`a39879d`), release `v0.7.6` publicada como latest; `latest.json` servindo 0.7.6.

### Codex travado na tela de update (sem release)

- [x] Codex com versão nova abre "Update available" (1 atualizar / 2 pular / 3 pular até a próxima), em inglês; o
  composer não aparece e a conversa dá "Entrada do CLI não reconhecida ou sessão ocupada". `crates/omni-engine/src/main.rs`
  → `sem_aviso_de_update()` em `spawn_initial_command_thread`: comando que começa com `codex` ganha
  `-c check_for_update_on_startup=false` (spawn e reinício; idempotente). Chave confirmada no binário 0.154.0.
  Teste `codex_abre_sem_tela_de_update`; 113 engine ok. Codex digitado à mão no terminal não muda.

### Aprovação pela Conversa não era reconhecida (sem release)

- [x] Sonda com as CLIs reais (`interaction.rs` → `sonda::sonda_aprovacao`, `#[ignore]`, `OMNI_SONDA=claude|codex`):
  Claude Code 2.1.305 e Codex 0.154.0 mostram exatamente os textos esperados, mas `approval()` devolvia `None` nos
  dois — a mensagem da pessoa fica visível acima com o mesmo `❯`/`›` da opção marcada, e a contagem de "uma opção
  marcada" era na tela inteira. Agora conta só da pergunta para baixo. Reconfirmado nas CLIs reais: Claude
  `1\r`/`3\r`, Codex `y`/Esc. Teste `aprovacao_real_com_a_mensagem_visivel`.
- [ ] Não coberto: aprovação de edição de arquivo do Claude/Codex ("make the following edits?"), acesso de rede do
  Codex e Antigravity (sem `approval`). Codex desta máquina usa `approvals_reviewer = "auto_review"` e quase nunca
  pede — a sonda força `approvals_reviewer="user"`.

### Codex na Conversa: campo some com o cabeçalho e modo Plan/Auto (sem release)

- [x] Sonda real (Codex 0.154.0, resposta de 60 linhas): o cabeçalho "OpenAI Codex" sai da tela e `ready()` virava
  `false` — a conversa travava em "Entrada do CLI não reconhecida" depois da primeira resposta comprida. Marca do
  Codex removida de `ready`/`pode_enfileirar` (como já era no Claude; `provider_running` garante a CLI).
  Reconfirmado na CLI real: `ready: true`.
- [x] Modo: o shift+tab do Codex só alterna Padrão ↔ Plan; o rodapé mostra `Plan mode (shift+tab to cycle)` e o
  Padrão não escreve nada. `modo_atual` reconhece a marca do Codex; `modo_com_provider` trata Codex com campo à
  vista e sem marca como `auto`, e `alternar_modo` usa a mesma leitura.
- [x] **Auto do Codex** = preset "Approve for me" do `/permissions` (Codex 0.154.0: Read Only / Ask for approval /
  Approve for me / Full Access; a conta já abre em "Approve for me" por `approvals_reviewer = "auto_review"`).
  `permissoes_do_codex()`: sai do Plan (shift+tab), digita `/permissions`, anda com as setas até o rótulo e confirma;
  erro com motivo se o menu não abrir/fechar. Sonda real (`OMNI_SONDA_AUTO=1`): "Permissions updated to Approve for
  me"; com conversa ativa o menu reaberto mostra o novo preset como `(current)`. Teste `menu_de_permissoes_do_codex`.
- [ ] Clique no botão pela Conversa do app não testado (a função foi exercida direto na CLI pela sonda). O preset atual
  não aparece na tela: Auto fica aceso fora do Plan mesmo se a pessoa trocar à mão para "Ask for approval".

### Conversa mostrando mensagens velhas no fim depois de trocar de conta (sem release)

- [x] Conversa "PRINCIPAL" (conta emailuber → padrão → emailuber, 8 segmentos): o chat terminava em mensagens de
  20/10 e o que o terminal mostrava (o "ola" de 21/10) ficava enterrado no meio, sem erro. `timeline_cached` juntava
  os segmentos em ordem de segmento; o `.jsonl` da conta lido primeiro já trazia o mais novo, e o que só existia no
  arquivo da outra conta caía no fim. `crates/omni-core/src/conversations.rs` → `em_ordem_de_hora()` (ordenação
  estável, item sem hora herda a do anterior). Teste `ida_e_volta_de_conta_mantem_o_chat_em_ordem_de_hora`.
  77 core + 115 engine ok.
- [x] Transcript de 299 MB (156 MB são linhas `api-request*` do Claude Code 2.1.3xx): `feed.rs` lê linha a linha
  (`BufReader::read_until`, sem carregar o arquivo inteiro) e pula `{"type":"api-request…` sem parsear
  (`chamada_da_api`). Mesmos 4024 itens, 3,2 s → 0,6 s (release). Teste `chamada_da_api_no_transcript_nao_vira_mensagem`.
  O caminho `\?\` não duplicava nada (o `resolve_transcript` canonicaliza tudo); são dois arquivos de verdade, um por conta.

### Configurações → Armazenamento (sem release)

- [x] `crates/omni-core/src/armazenamento.rs` → `medir()`: por conta do `profiles.json` + pasta do engine (OMNI), só o
  que é conversa (Claude: `projects`, `file-history`, `todos`/`plans`, `history.jsonl`; Codex: `sessions`,
  `thread_history_*`; Cursor: `chats`, `projects`, `plans`; Antigravity: `conversations`, resumos, `brain`…). Não
  segue link. 10 maiores conversas por conta, com o nome do OMNI pelo id da sessão. Sonda `sonda_armazenamento`
  (`#[ignore]`): 1,77 GB nesta máquina em 0,7 s.
- [x] Tauri `relatorio::armazenamento`; tela `src/features/armazenamento/Armazenamento.tsx` (seção nova em
  Configurações): total, por IA, por conta, maiores conversas (avisa "também em <conta>", a cópia da troca de
  conta) e partes de cada conta, com "Abrir pasta". Reusa `Barras`/`Kpi`/`Titulo` (agora exportados de
  `RelatoriosIa`). Teste `src/test/Armazenamento.test.tsx`. 419 front, 80 core, 115 engine.
- [ ] Sem apagar/limpar pela tela (só leitura). Não conferido no app rodando (só teste e sonda).

### Conversa presa em "trabalhando" depois do done (sem release)

- [x] `in_turn`, `ready` e `pode_enfileirar` procuravam "esc to interrupt" na tela inteira. Nesta própria sessão a tela
  mostrava diffs do `interaction.rs` com `contains("esc to interrupt")` → "trabalhando" para sempre, mesmo no `done`
  (confirmado lendo a saída da sessão pelo engine: 43 ocorrências, a maioria texto da conversa).
  `interaction::area_do_turno()`: só da linha do campo (`❯`/`›`) − 4 até o fim (status acima do campo + rodapé;
  Claude 2.1.305 põe o "esc to interrupt" no rodapé). Testes em `main.rs` (parado com diff na tela, Claude e Codex
  trabalhando). 115 engine ok.

### Workspaces: fechar só esconde, abrir/gerenciar em modal, arrastar para ordenar (sem release)

- [x] `WorkspaceState.hidden`: o X da lateral só esconde (agentes seguem rodando); `HIDE_WORKSPACE`/`SHOW_WORKSPACE`,
  `DELETE_WORKSPACE` (antigo CLOSE, encerra os terminais antes), `MOVE_WORKSPACE`, `CLOSE_PROJECT_IN_WORKSPACE`,
  `MOVE_PROJECT` (`workspacesReducer.ts`, `workspaceReducer.ts` → `moverAntes`). Esconder o último visível cria um novo;
  focar agente de um escondido o traz de volta; carregar com tudo escondido reabre o primeiro (`workspaceService`).
- [x] "+" abre `AbrirWorkspace` (novo com nome ou reabrir fechado); ícone de ajustes abre `GerenciarWorkspaces` (abrir,
  ver/remover projetos de cada um, excluir com confirmação explicando o que acontece) — `src/components/WorkspaceModais.tsx`,
  `ui/Modal.tsx` (Esc fecha só o de cima).
- [x] Arrastar workspaces e projetos na lateral (`lib/ordenarArrastando.ts`, pointer events — HTML5 DnD não chega no
  Tauri/Windows), linha de inserção em CSS. CHATS ordenado pela última atividade (mais recente primeiro).
- [x] Testes: reducer (esconder/reabrir/ordem/remover projeto), Sidebar (modais, confirmação, ordem das conversas),
  App. 426 front ok. Prints dos três modais conferidos (página temporária, já removida).
- [ ] Arrastar não testado no app real (só a lógica do reducer e o visual dos modais).

### Armazenamento → limpeza de conversas antigas (sem release)

- [x] `omni_core::armazenamento::antigas()`/`limpar()`: conversa entra só se **todas** as cópias (uma por conta da
  mesma IA) estão sem escrita há mais de N dias e nenhuma sessão aberta é dela. Sai com os pertences (Claude:
  `<id>/` com subagentes e `file-history/<id>`; Cursor: a pasta do chat; Antigravity: `brain/<id>`). A lista é refeita
  na hora de apagar, nunca vem da tela. Conversa sem arquivo nenhum sai do `conversations.json`. Corrigido junto: o
  `.jsonl` de subagente do Claude contava como conversa.
- [x] Engine (`mobile.rs`): `GET /limpeza` (ajuste + sugestões 30/60/90 com as 50 maiores + última limpeza),
  `POST /limpeza` (`limpeza.json`, só 30/60/90), `POST /limpeza/agora {dias}`; `conversas_abertas()` protege as sessões
  vivas; `limpeza_automatica()` (thread: 10 min depois da subida e a cada 6 h, se ligada; grava `limpeza-ultima.json`).
- [x] Tela: cartão "Limpeza de conversas antigas" na seção Armazenamento — 30 e 60 dias com tamanho, "Ver quais",
  "Limpar" com confirmação ("Apagar N de vez?") e "Limpar sozinho" (Desligado / 30 / 60 dias; padrão desligado).
- [x] Testes: core `limpeza_apaga_so_o_que_esta_parado_em_todas_as_contas`, engine `limpeza_sugere_salva_e_apaga_pela_rota`,
  front em `Armazenamento.test.tsx`. 427 front, 81 core, 116 engine. Sonda (só leitura) nesta máquina: 30 dias = 30
  conversas/58 MB, 60 dias = 20/40 MB (quase tudo Codex).
- [ ] Apagar é definitivo (sem lixeira). O índice do próprio Codex (`thread_history_*.sqlite`) continua citando o rollout
  apagado — o `codex resume` pode listar e não abrir. Não conferido no app rodando.

### Atenção: sem "encerrado" ao reabrir, ícone por tipo e há quanto tempo (sem release)

- [x] `stopped`/`orphan` saem do `AttentionReason`/`ATTENTION_ORDER` (`useAttention.ts`): reabrir o app listava dezenas
  de "encerrado" de conversas paradas. Ficam só aprovação, finalizado e interrompido (limite, erro de API, travou).
- [x] Engine grava `attention_at_ms` (`omni-protocol`) quando o aviso acontece — fim de turno, aprovação, notice novo.
  `last_activity_at_ms` não serve: sobe a cada redesenho da TUI. Sessão antiga sem o campo cai na última saída.
- [x] `AttentionPanel`: selos por tipo com ícone e contagem no lugar do número vermelho único; ícone em quadrado da
  cor do status; "há 5 min" com a data completa no tooltip. `haQuantoTempo` foi para `ConversaStatus.tsx`.
- [x] Testes: useAttention (encerrada/órfã fora, hora do evento), Sidebar (tempo + selo). 429 front, 116 engine.
- [x] Workspace na lateral usa os mesmos selos por tipo (`SelosDeAtencao` em `AttentionPanel.tsx`) no lugar do número
  vermelho. `WorkspaceList` recebe os itens de atenção; `countByWorkspace` saiu do `useAttention` (ficou sem uso).

### Tarefas na barra superior, com prazo (sem release)

- [x] Saíram da barra lateral (`Sidebar.tsx`, seção TAREFAS) para o topo: `src/features/todo/TarefasNoTopo.tsx` no
  `TitleBar`, ao lado do sino. Contador de pendentes (vermelho com atrasada; pula ao mudar), halo que "respira"
  devagar enquanto há pendência, painel em portal com entrada/saída animadas, Esc e clique fora fecham.
- [x] Prazo opcional (`Todo.prazo`, ms; tarefas antigas sem o campo continuam valendo). Lista agrupada: Atrasadas,
  Hoje, Próximas, Sem prazo, Concluídas; selo do prazo com cor ("atrasada há 2 h", "hoje 18:00", "amanhã 09:00").
  Reordenar desliza (FLIP com Web Animations), apagar sai para o lado, concluir anima a caixa.
- [x] `SeletorDePrazo.tsx`: atalhos (hoje 18h, amanhã 9h, segunda 9h, sem prazo), calendário próprio (mês desliza,
  dia passado desabilitado) e rodas de hora/minuto no formato do timer do iPhone — `scroll-snap` nativo + inclinação
  3D por item, arrastar com o mouse, roda, clique e setas/PageUp/PageDown (`role=spinbutton`). Horário passado não
  deixa definir. Em portal (a lista rola e cortaria). CSS em `src/features/todo/tarefas.css`.
- [x] Testes `src/test/todo.test.tsx` (6). Prints conferidos no Vite com Playwright (painel, seletor, roda arrastando e
  encaixando, troca de mês, concluir).
- [ ] Sem aviso do sistema quando o prazo chega (só a cor/contador mudam, relidos a cada 30 s). Rodas sem loop infinito
  (23 → 0 não dá a volta). Tema claro não conferido em print.

### Ícones de arquivo com as cores do Material Icon Theme (sem release)

- [x] `fileIcons.ts`: `CORES_PASTAS`/`CORES_NOMES`/`CORES_EXTENSOES` com as cores do Material, uma para cada chave de
  ícone (teste reprova chave sem cor ou cor sem ícone). Pasta sem regra = azul-acinzentado; arquivo desconhecido sem cor.
  `iconStyle()` aplica inline com `color-mix` e `--mistura-arquivo` (72% no tema claro, `index.css`).
- [x] Aplicado em: árvore (item, fantasma do arrasto, item novo), Quick Open, painel Git, abas (só ícone de arquivo,
  não marca de agente), anexos e menções do celular.
- [x] Conferido em print nos temas escuro e claro (página temporária, já removida). 438 testes front ok.
- [x] Roda do mouse no seletor de hora pulava 3–4 itens por clique (~100 px de rolagem nativa antes do encaixe):
  `wheel` nativo não passivo em `Roda` — um clique anda um item, trackpad anda um a cada 32 px. Conferido no Chromium
  (2→3, três cliques 3→6, um para cima →5). Teste `cada clique da roda do mouse anda um item`.
- [x] Botão de copiar o texto de cada tarefa (`navigator.clipboard`), ícone vira ✓ por 1,2 s. Teste no `todo.test.tsx`.

### Arrasto da lateral com o item flutuando (sem release)

- [x] `src/lib/ordenarArrastando.ts` (serve projetos e workspaces): cópia do item (`.ordenar-fantasma`, sem
  `data-ordem`/ids, `pointer-events: none`) segue o ponteiro mantendo o ponto em que foi pego, erguida (sombra,
  `scale`/`rotate` próprios, animação de levantar); original vira contorno tracejado. Ao soltar pousa na linha de
  inserção e some; Esc/fora da lista volta para a origem. CSS junto das regras `[data-ordem]` em `index.css`.
  Teste `src/test/ordenarArrastando.test.tsx`; prints no Vite (3 workspaces, arrasto e soltura). 441 front.
- [x] `.claude` e `CLAUDE.md` com a marca do Claude, `.cursor` e `.cursorrules` com a do Cursor (`AgentIcon`); pasta
  `apps` com ícone de monitor e cor própria. Teste de integridade aceita ícone de PixelIcon ou de AgentIcon.
- [x] Aviso de atenção mostra a marca do agente (Claude/Codex/Cursor) ao lado do nome da conversa; o nome do agente
  vai no tooltip e na notificação do Windows (que não tem ícone). `AttentionItem.provider`.

### Fluxos: canvas em tela cheia, opções em menus (sem release)

- [x] `FluxosView.tsx`: a lateral fixa (salvos, execuções, novo/IA/manual) virou o menu "Fluxos ▾"; a paleta flutuante
  virou "+ Etapa ▾" com a dica de cada tipo; escopo, importar/copiar JSON e apagar foram para "Opções ▾"; cancelar
  execução também. Componente `Suspenso` (fecha ao clicar fora, Esc ou ao escolher).
- [x] Painel direito só vira coluna com etapa selecionada ou pelo botão de detalhes; numa execução abre com o resumo.
  Erro e aviso flutuam sobre o canvas. CSS `fx-suspenso*`, `fx-opcao`, `.fx-tela.com-painel` (`index.css`); regras da
  lateral e da paleta removidas.
- [x] Conferido em print com Tauri simulado (página temporária, removida): menu de fluxos, de etapas, de opções e
  etapa selecionada. Sem teste de componente para o fluxo (não havia antes).
- [x] Correção do "Detalhes" (21/10): a barra de cima ocupa as duas colunas e quebra linha (antes ficava só na coluna
  do canvas e os botões invadiam o painel e o X); ao abrir o painel ou trocar de etapa o canvas desliza até a etapa
  se ela ficou escondida (`setCenter` com o zoom atual); minimapa some na tela estreita. Botão com `SlidersIcon`.

### Fluxo de release: etapa "Comando" + fluxo pronto (sem release)

- [x] Nó novo `comando` (`crates/omni-core/src/fluxos.rs`, `crates/omni-engine/src/fluxos.rs::rodar_comando`): roda
  no shell (`cmd /D /S /C` no Windows, `sh -c` fora), saída ao vivo no histórico, pausar/cancelar matam o processo.
  Saiu 0 → `sim`; falhou → `nao` (ou `esgotado` após `max_voltas`); sem nada ligado no `nao`, a execução para com a
  última linha do erro. Teste `comando_segue_pelo_codigo_de_saida`.
- [x] Fluxo com `na_pasta_do_projeto`: roda direto na pasta, sem worktree (leva o que não foi commitado). Não combina
  com etapa de PR (`validar` reprova). Checkbox no resumo do fluxo; painel do Comando com comando e tentativas.
- [x] `scripts/release.mjs` com os passos `validar | publicar | aguardar | liberar | registrar` (mesmo processo das
  releases feitas à mão: CI local, commit+push+tag, espera o `release.yml`, tira do rascunho e confere o
  `latest.json` público, commit do roadmap).
- [x] `.omni/fluxos/release.json` "Release do OMNI AGENTS" (fluxo do projeto): agente prepara versão e changelog →
  valida (loop com agente que corrige, até 3) → aprovação "Publicar?" → commit/push/tag → build no GitHub → aprovação
  "Liberar para todos?" → libera → agente registra no roadmap → commit. Teste `fluxo_de_release_do_omni_valida`.
  Conferido em print com Tauri simulado. 443 front, core 86, engine 117.
- [ ] Próximo: rodar o fluxo de verdade na próxima release (o "Publicar" faz commit de TUDO que está na pasta).

### Rodapé premium + "Uso" na barra de cima (sem release)

- [x] Botão "Uso" na barra de cima, ao lado de "Layouts" e no mesmo estilo (`titlebar-acao`), em todas as telas: entra
  pelo `acoes` do `TitleBar` em `App.tsx` (o `TitleBar` não mudou); a conta em uso vem da aba em foco (`sessaoAtiva`).
- [x] `UsoDeTodasAsContas.tsx` refeito: abre para baixo, alinhado à direita; cabeçalho com resumo (contas · IAs · lido
  há), "Atualizar todas"; grupo por IA com logo; cartão por conta com inicial, selo "em uso" sólido, e `Medidor` novo
  (rótulo, "renova …", % grande e barra fina com brilho na cor da faixa). CSS `.uso-*` em `index.css`.
- [x] Rodapé (`.rodape-app`): gradiente da superfície, filete do tema no topo, chips leves para conta do git, uso do
  agente em foco (`.rodape-uso`) e engine (ponto verde com brilho); sombra suave no tema claro. Sem o filete solto.
- [x] Conferido em print com Tauri simulado (escuro e claro, página temporária removida). 444 front.
- [x] Animações do painel de uso com GSAP (`src/lib/motion.ts`): `abrirPopover`/`fecharPopover` (cai do botão com
  zoom a partir do canto, sai rápido antes de desmontar), `entrarEmCascata` (ref de callback com `data-ordem`: grupos e
  cartões entram um após o outro, inclusive quando a lista chega depois), `encherBarra` (barras enchem da esquerda) e
  `useCountUp` com `inicio` (o % sobe do zero e corre até o número novo após uma consulta). Respeitam "animações" e o
  reduzir movimento do sistema. Medido no navegador a 60/120/250 ms; teste do painel espera a contagem. 446 front.

### Lateral em abas com ícones fixos (sem release)

- [x] `src/components/Sidebar.tsx`: fileira de ícones no topo — Conversas (atenção, workspaces, projetos, CHATS e
  TERMINALS juntos), Arquivos, Git, Docker, Skills e Kanban. Cada aba ocupa a lateral inteira; as que dependem de
  projeto pedem um quando não há. A seção COMMANDS (sempre vazia) saiu.
- [x] Troca com deslize GSAP (`deslizarAba` em `src/lib/motion.ts`): ir para uma aba à direita traz a nova pela direita
  e leva a velha pela esquerda, e vice-versa; a velha fica montada só até o fim. Marcador do tema desliza até o ícone
  ativo (`moverIndicador`).
- [x] Ordem das abas configurável arrastando os ícones (salva em `omni-lateral-abas`); `arrastarParaOrdenar` ganhou
  `eixo = "x"` para fileiras, com linha de inserção vertical (`.lateral-aba[data-soltar]`).
- [x] Aba Conversas avisa: contagem amarela de atenção e ponto verde pulsando quando algum agente está trabalhando
  (também no nome acessível). Botões `aria-pressed` (não `role="tab"`: o App.test conta as abas dos painéis).
- [x] Conferido em print com página temporária (removida); deslize medido a 120 ms. Teste novo em `Sidebar.test.tsx`.
- [x] Aba Skills cria e importa: "+ Nova" pede o nome e cria `.claude/skills/<slug>/SKILL.md` com frontmatter
  (`criarSkillNoProjeto`/`slugDaSkill` em `skillsService.ts`) e já abre o arquivo; "Importar" copia uma pasta com
  SKILL.md para o projeto (`installSkill`). `useProjectSkills` devolve `[skills, recarregar]`. Testes em
  `skillsService.test.ts`.

### Conta mestra das conversas + tela de Agentes nova (sem release)

- [x] `crates/omni-core/src/mestra.rs`: uma conta mestra por IA (`mestras.json` no engine; sem escolha = primeira
  criada). `unificar(mestre, copias)`: a versão mais recente vira a da mestra, as outras vão para a **Lixeira**
  (`SHFileOperationW` + `FOF_ALLOWUNDO`) e voltam como **hard link** — um arquivo físico, um nome por conta. Outro volume
  cai em cópia. Conferido que o Claude escreve no fim do mesmo arquivo (id NTFS estável), então o link segue
  compartilhado. Deps: `same-file`, `windows-sys` (`Win32_UI_Shell`), ambas já no lock.
- [x] `levar_transcript` (`mobile.rs`) não copia mais: chama `unificar` com a mestra. Troca de conta, failover e
  retomar do histórico passam todos por ali.
- [x] `armazenamento.rs`: link conta uma vez só (mestra primeiro), na medição e na limpeza. `copias()` /
  `juntar_copias()` + rotas `GET/POST /copias` (lista refeita no engine, sessões abertas de fora). Card "Conversas em
  mais de uma conta" em Armazenamento com confirmação. Testes core 84, engine 116.
- [x] Tauri `contas_mestras` / `definir_mestra` (`profiles.rs`). Estrela na conta em Configurações → Agentes.
- [x] `AgentConnections.tsx` refeito: KPIs (CLIs, contas conectadas, contas), um cartão por CLI com tom do estado,
  contas como blocos com estrela, ações leves (`.ag-acao`), remover com confirmação, uso como medidores
  (`AccountUsage.tsx`). CSS em `src/features/terminal/agentes.css`. Conferido em print com Tauri simulado. 443 front.
- [x] PRINCIPAL (`9fa46572…`) juntada à mão: cópia do Padrão (297,7 MB, só o "continue" que bateu no limite) foi para
  a Lixeira, e virou link do arquivo do emailuber. ~298 MB livres.
- [x] Ajuste da tela de Agentes (21/10): e-mail da conta numa linha própria com reticências (não cobre mais estrela/botão), cartões em colunas CSS (`.ag-colunas`, sem vão à direita) e KPIs novos (`AgKpi` em `AgentConnections.tsx`): agentes prontos com logos, conta com mais folga, mais perto do limite (quando libera) e próximo reset. `AccountUsage` repassa o uso por `onUsage`.
- [x] Microfone sem o aviso do WebView2 (21/10): `src-tauri/src/microfone.rs` libera o microfone só para as páginas do app (`PermissionRequested`, mesma regra de `eh_do_app`); no lugar do aviso, modal "Usar o microfone?" no Composer, uma vez por computador (`omni-microfone-liberado`). Ondas da voz ao gravar/ouvir (`Ondas` em `src/mobile/Composer.tsx`, AnalyserNode + canvas, cor do tema com brilho neon), no app e na web.
- [x] Abertura da conversa com etapas (21/10): engine expõe `capabilities.iniciando` (processo do agente ainda não subiu, `interaction.rs`); `AbrindoAgente` em `src/features/conversa/AbaDeAgente.tsx` mostra Abrindo o terminal → Iniciando o <agente> → Carregando a conversa, com ícone animado (anel girando, `mobile.css`), esconde o "trabalhando" falso e o "não reconhecida" até o agente ficar pronto (ou 45 s; só sessão com < 90 s). Teste em `AbaDeAgente.test.tsx`.
- [x] Vocabulário da voz + títulos curtos (21/10): `voz.rs` guarda `voz/vocabulario.json` (termo + formas ouvidas; rotas `/voz/vocabulario` e `/voz/vocabulario/aprender`), tira nomes de cada projeto (pasta, package.json, tauri.conf, Cargo, README) e põe tudo na dica do whisper. Front: `aplicarVocabulario`/`substituicoes` em `src/mobile/voz.ts`; `useDitado` no Composer troca o ouvido pelo termo ao fim do ditado e, ao enviar ou sair do campo, pergunta (painel único, com todas as trocas) se registra as correções; lista em Configurações → Geral (`src/features/voz/VocabularioCard.tsx`). Títulos: `titulo_curto` (≤3 palavras de conteúdo, sem conectivo/verbo de pedido) e `TitleSource::Ia` — sessão aberta pede ao Haiku (`claude_rapido`) 1–3 substantivos, uma vez por conversa; manual continua vencendo.
- [x] Diff nas ações de edição (21/10): `feed::Item.diff` (`mais`/`menos` exatos + até 80 linhas `+`/`-`/` `) vindo do `Edit`/`MultiEdit` (LCS de linhas), `Write` (tudo `+`) e `apply_patch` do Codex; vai em `conversations::Message.diff`. `LinhaDeAcao` em `src/mobile/Chat.tsx` mostra `+N` verde / `−N` vermelho e abre o diff no clique (`.acao-diff` em `mobile.css`). Teste `edicao_traz_linhas_adicionadas_e_removidas` e `ChatDesenho.test.tsx`. Próximo: rota sob demanda se a página pesar.
- [ ] Próximo: rebuild do engine para a troca de conta usar o link; depois "Juntar na mestra" em Armazenamento para
  as outras 10 duplicadas (~270 MB; 5 divergentes perdem a versão mais velha, que vai para a Lixeira).

### Arquivo citado inexistente mostrava erro cru (sem release)

- [x] Clicar num arquivo citado na Conversa que não existe no disco (ex.: `.claude/settings.local.json` ainda não
  criado) abria o painel com "failed to open file … (os error 2)". `src/features/files/filesService.ts`
  `readTextFile` traduz os error 2/3 em "Arquivo não encontrado: … Ele não existe no disco…" (vale para editor e
  Markdown). Teste em `src/test/filesService.test.ts`.
- [x] (22/10) Agora nem abre a aba: `src/App.tsx` checa `exists` antes de abrir o citado; não existindo, o evento
  rejeita (`src/main.tsx` virou Promise com `{caminho, ok, falha}`) e o botão no chat (`src/mobile/Chat.tsx`
  `Arquivo`) mostra "Não existe no disco" ao lado por 4s (`.bubble-arquivo-falta` em `index.css`). Teste em
  `src/test/ArquivoCitado.test.tsx`.

### Panorama: tudo o que roda no OMNI num canvas (sem release)

- [x] (22/10) Botão "Panorama" no topo, à esquerda do Uso. Abre uma tela (view `panorama` em `src/App.tsx`) que fecha no
  X e no Esc, como as Configurações. `src/features/panorama/panoramaModel.ts` monta o modelo (workspaces → projetos
  → agentes/terminais vivos por conversa + abas que não são sessão; sessões de projeto fechado em "Fora dos
  workspaces"; KPIs). `Panorama.tsx`: canvas com arrastar/zoom no cursor/Centralizar, hub OMNI ligado a cada
  workspace e às ilhas por curvas medidas do DOM, faíscas correndo pelas ligações (rAF, mais rápidas onde tem agente
  trabalhando), entrada em cascata (GSAP), mascotes por agente (Claude anda, Codex gira, Antigravity levita com
  sombra, Cursor balança com caret), pastas e marcas à deriva no fundo. Clique: agente/terminal → `FOCUS_SESSION`,
  projeto → `SHOW_WORKSPACE`+`SELECT_PROJECT`, aba → + `SELECT_TAB`, workspace → `SHOW_WORKSPACE`. CSS próprio em
  `panorama.css`. Respeita "menos movimento". Testes `src/test/Panorama.test.tsx` + caso no `App.test.tsx`.
  Próximo: mini-mapa, busca no canvas, prévia da última fala do agente no nó.
- [x] (22/10) Correções do Panorama: (1) faíscas cortavam no meio — cada poll das sessões remedia as ligações, trocava
  o array e o efeito recomeçava o relógio; agora relógio único (`inicio` em ref) e `setArestas` só troca se mudou.
  Medida das ligações por `offsetLeft/Top` (layout), não `getBoundingClientRect`: a entrada GSAP deslocava os nós e as
  curvas terminavam no ar. (2) Conversas abertas não apareciam: o modelo filtrava sessão `stopped`; agora toda aba de
  agente/terminal com sessão aparece (qualquer estado, rótulo "parada"), mais as sessões rodando sem aba (uma por
  conversa). Aba de agente sem CLI escolhida vira aba com ícone de robô.
- [x] (22/10) Nós varando os cards: hover em `transition: transform` + entrada GSAP (rodando 2x no StrictMode) fazia o
  GSAP capturar um transform do meio da transição como final — nós presos ~40px abaixo. Hover agora usa as
  propriedades `translate`/`scale` e a entrada tem `clearProps`. Faíscas em px/s (220; 420 com agente trabalhando).

### Roda de hora das tarefas mais suave (sem release)

- [x] (22/10) `src/features/todo/SeletorDePrazo.tsx` `Roda`: giro próprio com mola em rAF (posição em float, encaixe
  desligado enquanto gira) no lugar do `scrollTo` suave, que recomeçava a cada clique e dava tranco. Clique de roda
  em sequência rápida (<90 ms) acelera 1,1,2,3,4,5 itens; trackpad continua proporcional. Corrigido também o reset do
  contador de sentido (zerava a cada passo). Teste "giro rápido da roda acelera" em `src/test/todo.test.tsx`.
- [x] (22/10) Cards repaginados: borda em gradiente com faixa de luz, halo cônico girando na ilha com agente trabalhando, linha de contadores (trabalhando/pedindo você/agentes/terminais/abas/branch), grupos com contagem, nós com trilho e fundo na cor da marca (`--marca`: Claude laranja, Antigravity azul…), pílulas de estado, seta "›" no hover, terminal em verde mostrando só o nome do shell, abas em pílula.
- [x] (22/10) Panorama com cantos retos como o resto do app: todo `border-radius` de `panorama.css` virou `var(--glass-radius)` (0px); só pontos de status e a sombra do Antigravity seguem redondos.

### Fotos nas Extensões (sem release)

- [x] (22/10) `crates/omni-core/src/extensoes.rs` `logo_do_pacote`: o `Plugin` ganha `logo` (`data:` URI, ≤256 KB) lido do
  `logo`/`icon`/`composerIcon` de qualquer manifesto do pacote (`.claude-plugin`/`.cursor-plugin`/`.codex-plugin`;
  o do Claude não tem o campo, os outros sim) ou de um `logo*`/`icon*`/`<nome-do-plugin>*` na raiz/`assets/`. Só
  imagem e só dentro da pasta do pacote (canonicalize + starts_with). Claude pelo `installPath`, Codex por
  `plugins/cache/<marketplace>/<nome>/<versão mais nova>`, Cursor pela pasta local. Embutido para valer no app e na
  web sem liberar asset scope. Front: `src/features/extensoes/IconeDaExtensao.tsx` — logo > marca já desenhada
  (GitHub, Vercel, Docker, npm, Claude, OpenAI, Cursor, Antigravity, pelo nome ou URL) > inicial colorida (cor da
  marca nas conhecidas: Figma, Stripe, Supabase, Notion, Slack, Google…). Em MCPs, plugins e conectores. Testes no
  Rust e em `ExtensoesSettings.test.tsx`. Favicon de MCP remoto ficou de fora (precisa de internet).

### Microfone no "Criar fluxo com IA" (sem release)
- [x] `Microfone` exportado de `src/mobile/Composer.tsx` (mesma escolha do chat: fala do navegador, senão a voz do PC) e usado no `DialogoDeFluxoComIa` (`src/features/fluxos/FluxosView.tsx`).
- [x] Engine: `/conversas/{id}/voz` e `/voz/corrigir` aceitam id sem conversa (`-`) — `pasta_da_voz` em `crates/omni-engine/src/mobile.rs` usa só o vocabulário da pessoa.
- [x] Teste em `src/test/FalaDoNavegador.test.tsx`.

### Web: lateral em abas e uso no topo (sem release)
- [x] `src/web/WebApp.tsx`: lateral com abas **Conversas** (busca, projetos, conversas, terminais) e **Prévia no navegador**
  (`PreviasLocais`), deslizando como no app (`deslizarAba`/`moverIndicador`). Cada painel rola sozinho; Nova sessão e
  Novo terminal ficam fixos embaixo. Conversas/terminais sem caixa própria (altura natural), linhas mais altas.
- [x] `src/web/UsoDasContas.tsx` → `UsoNoTopo`: no cabeçalho, conta da conversa (nome, 5H, semana) e popover com todas as
  contas (fecha no Esc/clique fora). Saiu da coluna da direita, que ficou só com Precisa de você / Trabalhando agora.
- [x] Polimento em `src/web/web.css` (rótulos com ícone e contador, cartões na direita, degradês). Teste em `WebApp.test.tsx`.
- [x] Histórico em aba própria na lateral da web (Conversas | Histórico | Prévia): agrupado por Hoje/Ontem/7 dias/30
  dias/Mais antigas, busca e filtro por projeto, ocultas no fim. Na aba Conversas: "Abertas no PC" do projeto (com o
  projeto em destaque no título) e "Últimas conversas" (6 de todos os projetos) + "Ver todo o histórico".
- [x] Cartão de conversa (`ConversationList`, web e celular) mostra o projeto como etiqueta acima do título.
- [x] Popover de uso (`UsoDasContas animar`): abre crescendo do botão, cartões em cascata, barras enchendo e % contando
  do zero (GSAP, respeita movimento reduzido); chip do topo brilha quando a leitura muda.

- [x] **Pergunta do agente marca na hora** (2026-10-22): `src/mobile/CartaoDePergunta.tsx` marca a opção no clique (otimista) e, no marcar-várias, enfileira toques feitos enquanto o anterior vai ao PC; `key` por pergunta em `MobileApp.tsx` zera o estado; o cartão não esmaece mais inteiro enquanto envia (`mobile.css`). Teste `src/test/CartaoDePergunta.test.tsx`.

- [x] **Parar sem travar o próximo prompt** (2026-10-22): Esc antes de a CLI ler o prompt devolve o texto ao campo do terminal e o `ready` recusava tudo ("Entrada do CLI não reconhecida"). Rota nova `POST /conversas/{id}/parar` (`crates/omni-engine/src/mobile.rs`): Esc e, com `interaction::sobra_no_campo`, Ctrl+U até o campo esvaziar; `limpou` faz `MobileApp.tsx` devolver o texto ao campo da conversa. Teste `prompt_devolvido_ao_campo_conta_como_sobra_so_com_o_turno_parado`; `WebChat.test` usa a rota nova.
- [x] **Web: sem scroll horizontal em Projetos** (`src/web/web.css`, `overflow-x: hidden`: o `translate` do hover vazava 2px).

- [x] **Pergunta do agente: Voltar e resposta rápida** (2026-10-22): `Resposta::Voltar` (`crates/omni-engine/src/mobile.rs`, corpo `{voltar:true}`) manda ← na barra de abas das perguntas; `CartaoDePergunta` mostra "← Voltar" depois de alguma respondida. Lentidão: depois de responder, `escolher` em `MobileApp.tsx` relê a timeline a cada 100 ms (até 1,5 s) até a pergunta mudar, em vez de esperar o polling de 3 s da conversa parada. Não confirmado contra um Claude Code real: se a ← não voltar, trocar a tecla.
- [x] **Entrada animada das mensagens na conversa (app e web)** — bloco que chega com a conversa
  aberta (fala do agente, ações, aviso, comando) sobe e acende; a resposta do agente se revela de
  cima para baixo (máscara CSS, 350–1200 ms conforme o tamanho); cada ação nova no bloco ao vivo
  desliza. O que já estava na tela ao abrir não anima, nem a fala do usuário que substitui o balão
  otimista (este anima ao nascer). `prefers-reduced-motion` desliga tudo. `src/mobile/MobileApp.tsx`
  (`conhecidos`/`entraram`, `chaveDoBloco`), `src/mobile/Chat.tsx` (prop `entra`), `src/mobile/mobile.css`
  (`.entra`, `chat-revela`, `acao-entra`); teste `src/test/EntradaDeMensagens.test.tsx`.
  - [x] **Revisão: resposta "digitada"** — a máscara saiu; o plugin `rehypeDigitar` (`src/mobile/Chat.tsx`,
    roda depois do sanitize) quebra o texto em `<span class="palavra">` com atraso crescente (≤25 ms
    por palavra, resposta inteira em ~1,6 s), cada palavra acende desfocada → nítida, e um cursor neon
    pisca no fim até sumir. Código acende inteiro (quebrar o `código` solto mataria o link de
    arquivo). Entrada do balão mais suave (520 ms, ease-out longo, leve blur/scale). Mensagens
    anteriores buscadas ao rolar não animam. Só o texto inicial do balão é digitado.
- [x] **Cursor do campo de digitação personalizado** — `#reply` com `caret-color` no accent do tema e,
  onde há `caret-animation: manual`, pulsa suave (accent → 20%) em vez de piscar seco.
  `src/mobile/mobile.css` (fim). Sem movimento com `prefers-reduced-motion`.
- [x] **Cursor neon desenhado (campo de digitação)** — substitui o `caret-color` animado. `src/mobile/CursorNeon.tsx`:
  espelho invisível mede a posição do cursor no `<textarea>`; barra de 3 px no accent com brilho em
  camadas + halo, desliza (transform 120 ms), "soco" de luz a cada tecla (remonta a luz) e respira
  parado; some com seleção ou sem foco. Altura = altura da letra (com a da linha ficava baixo).
  Nativo transparente (`#reply`), `.composer-campo-caixa` relativo. Teste `src/test/CursorNeon.test.tsx`.
- [x] **Busca nas Configurações + acabamento premium** — `src/components/SettingsSearch.tsx`: índice
  (`ITENS_DE_BUSCA`: seção, título do cartão/campo, sinônimos) + as próprias seções; busca sem
  acento, todas as palavras, título pesa mais que sinônimo. Campo no topo (cresce e brilha no foco,
  `Ctrl+F` ou `/` focam, Esc limpa/solta), painel com trecho aceso, ↑↓ Enter, estado vazio com
  sugestões. Escolher troca a seção, rola até o cartão (`acenderNaTela`, tenta ~1,5 s p/ seções que
  carregam dados) e ele pulsa no accent. Menu lateral apaga seções sem resultado e mostra contagem.
  Visual (`src/index.css`, bloco "acabamento e busca"): fio de luz no topo, cabeçalho da seção com
  barra/gradiente, menu e cartões em cascata, borda dos cartões acende no hover. Teste
  `src/test/SettingsSearch.test.tsx`. Ao criar cartão novo nas Configurações, adicionar ao índice.
