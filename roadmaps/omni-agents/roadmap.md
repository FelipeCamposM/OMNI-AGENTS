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
- Uma pane nunca fica sem tabs: fechar/mover sua última tab só é permitido quando outra pane
  pode assumir o layout; o reducer colapsa o split automaticamente.
- O conteúdo das panes ainda é placeholder intencional. Terminal e agentes dependem do engine
  persistente das Fases 2 e 3.
- A documentação `README.md`, `RESUME.md` e partes antigas de `CLAUDE.md` ainda descrevem
  CAMPS-UTILS e precisam de uma limpeza editorial própria.
