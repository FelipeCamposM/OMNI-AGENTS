# Roadmap — OMNI AGENTS

Estado vivo. O que já foi entregue até a v0.7.7 (com caminhos de arquivo, decisões e armadilhas) está em
`roadmap-historico.md` — procure lá com grep antes de reinventar algo. Aqui ficam só as pendências e as
entregas novas.

**Como registrar:** entrega nova vai no fim, numa seção `### <assunto> (data)` com checkboxes, os
arquivos tocados e o próximo passo. Quando a pendência for resolvida, risque daqui.

## Pendências conhecidas

### Bugs achados, não corrigidos
- [ ] `provider_running` (`crates/omni-engine/src/interaction.rs`) procura `cursor.exe`; nunca casa com
  `cursor-agent.exe`/`agent.exe` (só afeta a checagem de sessão ociosa do Cursor).
- [ ] Codex: reiniciar abre conversa nova (o id da sessão não é conhecido na criação).
- [ ] Duas sessões do Codex (ou do Antigravity no mesmo minuto) na mesma pasta podem trocar de conversa
  (`crates/omni-core/src/runtime.rs`, `antigravity.rs`).
- [ ] Uso do Antigravity mostra só o grupo Gemini, mesmo usando Claude/GPT dentro dele (`usage.rs`).
- [ ] Apagar conversa do Codex é definitivo e o índice dele (`thread_history_*.sqlite`) continua citando o rollout.
- [ ] Projeto WSL: transcript fica no `~/.claude` da distro; o índice do app não enxerga.

### Detecção de estado
- [ ] Aprovação de edição de arquivo do Claude/Codex ("make the following edits?") e acesso de rede do Codex não
  são reconhecidos.

### Fluxos (`roadmaps/orquestracao/roadmap.md`)
- [ ] Escolher conta com uso disponível.
- [ ] Tela de fluxos (editor) na web/celular.

### Plataforma e release
- [ ] macOS: atalhos usam Ctrl (Cmd esperado); AppImage some ao fechar com o engine vivo.
- [ ] SmartScreen no Windows: exige certificado Authenticode (decisão de custo).
- [ ] Engine de dev e o instalado usam a mesma porta de celular (47322).
- [ ] `.omni-agents/` dentro do projeto não entra no `.gitignore` dele.
- [ ] Prazo de tarefa chega sem aviso do sistema (só cor/contador).

### Adiadas de propósito
- [ ] Persistência em SQLite pelo engine (hoje localStorage + JSON em AppData).
- [ ] Command palette.
- [ ] Autostart do engine no login do Windows.

## Entregas

### Criar fluxo a partir de uma conversa (2026-10-25, v0.7.8)

- [x] "Criar fluxo com IA" ganhou o seletor **Basear numa conversa** (`DialogoDeFluxoComIa`, `src/features/fluxos/FluxosView.tsx`):
  lista as conversas do projeto aberto (`conversasDoProjeto`/`listarConversasParaFluxo` em `fluxosService.ts`) e manda o
  mesmo pacote do "Exportar" (`GET /conversas/{id}/exportar`, sem segredos) como "Conversa de referência" (`pedidoComConversa`).
  Com conversa escolhida a descrição fica opcional.
- [x] `crates/omni-core/prompts/criar-fluxo.md`: regras da conversa de referência e o nó `comando` + `na_pasta_do_projeto`,
  que faltavam no prompt.
- [x] Teste: `src/test/FluxoDeConversa.test.ts`.
- Próximo (se pedir): botão "Virar fluxo" direto no menu da conversa; pacote com todos os pedidos do usuário.

### Faxina de documentação + acervo de telas + aprovação remota + ramos paralelos (2026-10-25, v0.7.8)

- [x] `CLAUDE.md` reescrito para o OMNI (o anterior era quase todo do CAMPS-UTILS). Roadmap antigo arquivado em
  `roadmap-historico.md`; este ficou só com pendências e entregas novas.
- [x] Acervo de telas das CLIs: `crates/omni-engine/tests-fixtures/telas/<cli>.<esperado>.<nome>.txt` + teste
  `telas_do_acervo` (`interaction.rs`) + `OMNI_SONDA_SALVAR` na `sonda_aprovacao` grava capturas novas direto lá
  (`LEIA.md` na pasta). Achado: a tela de aprovação do Codex também casa como menu — inofensivo, `capabilities` só
  procura menu sem aprovação, e o teste segue essa regra.
- [x] Aprovar/recusar fluxo pela web e pelo celular: `src/mobile/AprovacoesDeFluxo.tsx` (lê `/fluxos/execucoes` a cada
  5 s, mostra a pergunta e a saída da etapa anterior), no início do celular e em "Precisa de você" da web. CSS
  `.aprov-fluxo*` em `mobile.css`. Teste: `src/test/AprovacoesDeFluxo.test.tsx`.
- [x] Ramos paralelos nos Fluxos: `executar` tira a fila inteira e roda cada passo numa thread (`std::thread::scope`);
  processos por `<execução>/<nó>` (pausar/cancelar matam todos); ramo irmão parado numa aprovação não invalida o
  trabalho dos outros; só conclui quando nenhum nó está rodando. Nó novo **Juntar** (`TipoDeNo::Juntar`,
  `antecessores`/`saida_do_juntar` em `omni-core/src/fluxos.rs`; editor, cor e prompt de criação). Testes:
  `ramos_paralelos_rodam_juntos_e_o_juntar_espera_os_dois`, `juntar_precisa_de_dois_ramos_e_entrega_cada_saida_com_o_titulo`.
- Limite: ramos paralelos dividem o mesmo worktree. Próximo, se doer: worktree por ramo + merge no Juntar.
- Precisa de `npm run dev` (engine recompila) para valer; app instalado só na próxima release.

### Diálogo de Resume + "não reconhecida" depois do /compact (2026-10-25, v0.7.8)

- [x] "Resume this conversation?" (conversa ociosa e grande) e "Resume from summary" travavam a sessão (menu sem
  número). Os dois respeitam `resumeReturnDismissed` no `.claude.json` da conta (achado no binário da 2.1.310): o
  engine grava `true` antes de abrir a CLI (`compartilhar_extensoes` → `garantir_verdadeiro`, `crates/omni-engine/src/main.rs`).
  Só em arquivo existente (criar vazio faria pedir login).
- [x] `ready`/`sobra_no_campo`/diagnóstico do Antigravity procuravam "esc to cancel" na tela inteira: o aviso
  "● Usage limit reached · … · esc to cancel" no histórico travava o campo vazio depois do /compact. Agora só na área
  do turno e fora das falas `●`/`⏺` (`cancelavel`, `interaction.rs`). Teste `esc_to_cancel_do_historico_nao_trava_o_campo`.
- Compactação aos 400k não rodou naquela sessão porque o processo era anterior à v0.7.3 (env
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`) e depois bateu o limite de uso (compactar também gasta limite). A env segue válida na 2.1.310.

### Troca de conta e compactação automáticas no engine (2026-10-26, v0.7.8)

- [x] Saíram do `TerminalPane` (só rodavam com a aba aberta no desktop) para `crates/omni-engine/src/automatico.rs`, um
  laço de 2 s sobre as sessões vivas: vale com a janela fechada e para quem usa só web/celular, e não manda duas vezes
  com duas janelas abertas.
  - Limite de uso (`meta.notice == "usage_limit"`) → outra conta autenticada da mesma IA que não esteja em 100%
    (`mobile::trocar_de_conta` = o `reabrir_com` do botão; mesma sessão, transcript vai junto). Sem conta: tenta de novo a
    cada 30 s.
  - No meio da tarefa: `/compact` (se `depois_da_troca` e a conversa tem 150k até a janela) e "continue", pela fila
    (`mobile::enfileirar_sozinho`), esperando o campo ficar livre.
  - Antes do limite: Claude acabou de parar (≤3 min), conta ≥ `limiar` % → `/compact` nesta conta, uma vez por janela de
    uso, só com a conversa entre metade da janela e a janela.
  - Ressalva aplicada: na janela ou acima o próprio Claude compacta (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`), então o OMNI não
    manda `/compact` ali (seria pagar duas vezes).
- [x] `restart_session` zera `turnos_iniciados`: o aviso de limite que o `--resume` reexibe é histórico e não dispara outra troca.
- [x] Selo da aba: campo novo `automatico` em `TerminalSession` (`omni-protocol`), o front só mostra. Saíram do front
  `autoFailover`, `talvezContinuar`, `talvezCompactarAntes`, `selectFailoverProfile`/`exhaustedUntilMs`/
  `usageLimitResetAtMs` e o teste `terminalService.failover.test.ts`; regras testadas em `automatico.rs`.
- Perdeu: o aviso "conta X disponível" no horário do reset (a conta volta ao rodízio igual, só sem selo).
- Precisa de `npm run dev` para valer; app instalado só na próxima release.

### Cursor neon fora do lugar com texto longo (2026-10-26, v0.7.8)

- Passando de 10rem o campo liga a barra de rolagem e o texto quebra antes; o espelho que mede o cursor
  (`CursorNeon.tsx`) usava a largura cheia, então o cursor aparecia numa linha e a letra entrava em outra.
  Agora o espelho usa a largura útil (`clientWidth`, sem a barra).

### Parar logo depois de enviar deixava o texto no campo da CLI (2026-10-27, v0.7.8)

- O `/parar` saía na primeira leitura com o campo vazio; clicando rápido, a CLI ainda não tinha devolvido o
  prompt (ou a colagem ainda chegava), o texto aparecia depois e a conversa ficava "não reconhecida". Agora
  só sai com o campo livre por ~1,5 s seguidos (máx. 7,5 s), apagando o que voltar nesse meio-tempo.

### Servidores locais na lateral (2026-10-27, v0.7.8)

- Aba nova "Servidores locais" (`ServidoresPanel.tsx`, `src-tauri/src/servidores.rs`): de que projeto é cada
  localhost rodando no PC, agrupado por pasta (Next abre 2 portas = 1 linha), com tipo (Vite, Next, Django…).
- Filtro: só programa de dev (node, python, bun…) rodando script de dentro de pasta com `package.json` (ou
  parecido); caminho em `Program Files`/`AppData`/`.vscode` não conta. No PC real: 37 portas → 4 projetos.
- Apelido por pasta (localStorage, a porta muda entre execuções), abrir no navegador (`http://localhost:*`
  liberado no opener) e derrubar com confirmação (`taskkill /T /F`). O comando recebe a pasta e relê a
  lista: nunca mata PID vindo da tela. O próprio OMNI em `npm run dev` fica sem botão.
- Só desktop e só Windows (Get-NetTCPConnection + Win32_Process). Pendente: Mac/Linux (`lsof`); servidor sem
  caminho no comando (`python manage.py` relativo) não aparece; ligar com a aba do terminal do OMNI que o abriu.
- Testes: `servidores.rs` (leitura real encurtada), `ServidoresPanel.test.tsx`; diagnóstico ignorado
  `servidores_deste_pc`.

### Conta extra sumindo da lista (2026-10-27, v0.7.8)

- Causa: `list_profiles` gravava o `profiles.json` a cada leitura, e várias leituras rodam juntas. No Windows,
  ler no meio do `rename` de outra gravação falha; a leitura caía no padrão vazio e a gravação seguinte
  apagava as contas extras (a pasta e o login ficavam intactos). Aconteceu com a `emailuber` no app instalado.
- `src-tauri/src/profiles.rs`: trava única de leitura+gravação; leitura com erro tenta de novo e nunca grava
  em cima; `list_profiles` só grava quando algo mudou; pasta `profiles/<provider>/<id>` com login e sem
  registro é readotada (teste `conta_orfa_com_login_volta_para_a_lista`).
- App instalado: entrada da `emailuber` devolvida à mão ao `profiles.json` (backup `.bak-2026-10-27`).

### Celular com acabamento novo (2026-10-27, v0.7.8)

- `src/mobile/mobile.css`: camada "Acabamento do celular" no fim, só dentro de `.m-shell` (a visão Conversa do PC
  não muda). Sai a sombra preta deslocada; entram superfícies em degradê, filete do tema, halo e grade de fundo,
  barra de cima em vidro com filete, cartões com trilho de status e brilho, busca com lupa.
- `src/mobile/MobileApp.tsx`: `Saudacao` no início (bom dia/tarde/noite, data, frase do que espera você) com os
  três números ganhando ícone; `Secao` com ícone, contagem e filete; projeto com monograma em 8 tons fixos por
  nome (`corDoNome`) e ponto verde quando há agente ativo; na conversa, a IA aparece ao lado do título com anel na
  cor do estado (`TopBar` ganhou `marca`). Conferido em print com o engine instalado.
- Pendente: favicon do projeto também no celular (precisa de rota no engine servindo o arquivo).

### Imagem anexada volta a aparecer como imagem (2026-10-29, sem release)

- Causa: a CLI nova do Claude embrulha o colado em `<pasted_content>` e não troca mais o caminho da imagem
  anexada por `[Image #N]` (até 21/10 trocava). Sem bloco de imagem no transcript, a bolha só mostrava o cartão "image.png".
- `crates/omni-core/src/feed.rs`: `anexos_de_imagem` lê a lista `[Anexos enviados pelo OMNI]` da mensagem do
  usuário; imagem que existe conta em `Item::imagens` (depois das coladas) e a rota `/conversas/{id}/imagens/{n}/{k}`
  serve o arquivo. Caminho solto digitado continua texto.
- `src/mobile/Chat.tsx` (`MessageBubble`): imagem já servida como imagem não vira cartão também.
- Engine mudou: o app instalado só pega na próxima release (`npm run dev` já mostra).

### Ícone real de MCP, plugin e conector, também na conversa (2026-10-27, v0.7.8)

- `src-tauri/src/icones_remotos.rs` (`icone_da_extensao(destino, nome)`): MCP remoto → `initialize`/`serverInfo.icons`;
  senão favicon (`<link rel=icon>`/apple-touch, depois `/favicon.ico`) do host, da marca pelo nome (lista: `stitch` →
  stitch.withgoogle.com, notion, vercel…) e do domínio pai. Plugin manda `pacote:<site>` (homepage/repo/autor do
  manifesto, `omni_core::extensoes::site_do_pacote`): homepage da marca → favicon; `github.com/<dono>` → avatar.
  Conector: mapa de nomes ou `<nome>.com`. MCP local sem marca conhecida não vai à rede.
- Salvo em `<engine>/icones/` como imagem (`stitch-1a2b3c4d.png`); "não achei" = `.sem-icone`, refeito em 1 dia.
  `icones/nomes.json` liga chave por nome (`mcp:stitch`, `plugin:vercel`, `conector:gmail`) ao arquivo.
- Conversa: `chaveDaFerramenta("mcp__stitch__…")` → ícone da marca na linha de ação (`Chat.tsx`, `IconeDaAcao`).
  PC: `icone_da_ferramenta(chave)` (salvo, senão acha a extensão na lista e busca). Web/celular: `GET /extensoes/icone?chave=`
  no engine, só lê o salvo (`omni_core::extensoes::icone_conhecido`, inclui logo de plugin) — aparece depois que o PC buscou.
- Deps `reqwest` (`rustls-no-provider`) + `rustls` (ring) + `base64`: as do updater, lock sem crate nova.
- Engine mudou (rota nova): o app instalado só pega na próxima release.

### Favicon como símbolo de projeto e workspace (2026-10-27, v0.7.8)

- `src/features/projects/iconesDoProjeto.ts`: varre o projeto (4 níveis, sem build/ocultas/`dist-*`) atrás de
  favicon/icon/logo/apple-touch; ordem: favicon, mais raso, svg/png antes de ico. Cache por pasta na sessão.
- `Project.icone` (caminho escolhido, `null` = pasta, sem campo = primeiro achado) e `WorkspaceState.icone`
  (favicon escolhido de um dos projetos, `null` = caixa, sem campo = o do primeiro projeto que tiver favicon;
  `useIconeDoWorkspace`). Janelas Abrir/Gerenciar workspaces também mostram os símbolos. Ações `SET_PROJECT_ICON` e `SET_WORKSPACE_ICON`.
- `src/components/EscolherIcone.tsx`: avatar da lateral vira botão (lápis no hover) e abre um popover ao lado da
  lateral, no desenho do painel de Uso: opções fixas (Automático/Ícone de pasta ou Caixa padrão) e grade de
  favicons por projeto, com o atual marcado, entrada em cascata. CSS `.icone-*` no fim do `index.css`.
- Conferido em print com as pastas reais do OMNI-AGENTS e do STUDYRATS. Testes em `iconesDoProjeto.test.tsx`.

### Configurações → Agentes reorganizada (2026-10-27, v0.7.8)

- Na linguagem da lateral: uma faixa por IA (antes colunas desencontradas), contas lado a lado dentro dela,
  sem borda colorida por estado; cor do tema como destaque, estado em pontinho que pulsa, avatar com
  iniciais e o degradê da lateral, mestra com filete dourado. Reautenticar virou ícone (cartão estreito);
  Cursor sem medidor de uso (não tem). Compactação em linhas: explicação à esquerda, escolha compacta à
  direita (`ag-ajuste`). Conferido em prévia com dados falsos (escuro e claro), não no app rodando.

### Web do PC reorganizada + tarefas no engine (2026-10-28, v0.7.8)

- Coluna da direita saiu: "Precisa de você" (aprovações de fluxo + pedidos) mora no topo da lateral, com
  avatar do agente, pontinho de estado e o projeto. "Abertas no PC" do projeto em grupos: Pedindo você /
  Trabalhando / Paradas.
- Até 3 conversas do mesmo projeto lado a lado (`+` no cartão, endereço `#/c/a,b`); cada uma com
  cabeçalho, Conversa/Terminal e fechar próprios; a focada tem filete neon e manda no uso do topo.
  Conversa de outro projeto substitui a divisão.
- Topo: só o uso da conversa focada, Tarefas (mesmo popover do app) e Panorama (`#/panorama`, o
  componente do app com um workspace "PC" montado das conversas/terminais vivos).
- Tarefas moram no engine (`GET/POST /tarefas`, `tarefas.json`, máx. 500): app, web e celular veem a
  mesma lista; o localStorage virou cache, migrado uma vez na primeira leitura.
- Tela estreita (celular abrindo a web): uma coisa por vez — lista ou o que foi aberto, com voltar.
- Conferido em prévia com engine de mentira + conversas falsas (1600px e 600px), não no app rodando.
  Pendente: o celular (`index.html`) não ganhou passe visual novo nesta rodada.

### Release v0.7.8 (2026-10-28)

- Publicada: commit `177f823`, tag `v0.7.8`, `latest.json` respondendo 0.7.8. Entregas acima marcadas v0.7.8.
- Instalador NSIS com visual novo (`src-tauri/installer/sidebar.bmp` 164x314 e `header.bmp` 150x57, gerados com PIL a
  partir de `icons/icon.png`), ícone do app e idioma `PortugueseBR` (`bundle.windows.nsis`). Compilado localmente; telas
  do instalador não conferidas rodando.

### Ícone do projeto igual ao do workspace (2026-10-28, sem release)

- Linha do projeto na lateral ganhou o botão de imagem "Trocar ícone" (`Sidebar.tsx`, `pedidosDeIcone`), como a do workspace;
  o seletor do projeto (`AvatarDoProjeto`, prop `vizinhos`) oferece também os favicons dos outros projetos do workspace.
  Teste em `iconesDoProjeto.test.tsx`.

### Menu das Configurações em grupos (2026-10-28, sem release)

- `SettingsView.tsx`: seções com `grupo` (Preferências, Inteligência artificial, Dados e acesso, App), rótulo com fio entre
  grupos; Atalhos foi para Preferências. CSS no fim do `index.css`: ícone sempre aceso em avatar com degradê (cheio no item
  aberto), título e descrição maiores, item aberto com degradê/anel/brilho da lateral. Conferido em prévia, não no app.

### Tela de Acesso remoto refeita (2026-10-28, sem release)

- `MobileSettings.tsx` + bloco `remoto-*` no fim do `index.css`: cabeçalho com brilho e "N de 4 prontos"; passos em linha
  do tempo (número no trilho, fio verde nos feitos, passo atual com anel e chip "agora"); modos Direto/HTTPS como cartões
  com ícone (radio `sr-only`, foco no cartão); celular e computador em cartões com ícone. Textos e fluxo iguais; testes
  passam. Conferido em prévia com dados falsos, não no app.
- 2ª passada: QR agora é SVG próprio (`QRCode.create`): pontos, olhos de canto levemente arredondado, miolo vazio para a
  logo, moldura em degradê com brilho pulsando, cantos de mira e linha de leitura (some com reduced-motion). **Raio do
  olho ≤ 0,6 módulo**: com 0,8+ o OpenCV não acha mais o QR (testado). Os dois QRs (acesso e Authy) decodificam na captura.
  Botões da tela viraram `Acao` (ícone + texto; o principal cheio com degradê e brilho); links em caixa tracejada.
- Secundários do `Acao` com o contorno preto + sombra deslocada do `.btn`. Depois, o mesmo visual em **todo `.btn` dentro de
  `.settings-conteudo`** (CSS sem camada no fim do `index.css`): neutros com contorno preto, brilho e leve subida no hover;
  `btn-primary` e segmentado selecionado (`aria-pressed`) em degradê da cor do tema com brilho. Fora das Configurações nada muda.

### Sobre: confirmação do reset e uma nota de versão por vez (2026-10-28, sem release)

- "Restaurar configurações padrão" agora abre `Modal` de confirmação (antes restaurava direto). Explica que só preferências
  voltam; projetos, workspaces, conversas e contas ficam.
- Novidades mostra só a versão instalada (`getVersion`; sem ela, a mais recente). `Select searchable` troca a versão (busca
  por número/data); selos "instalada"/"mais recente", lista com marcadores na cor do tema. Teste: `src/test/sobre.test.tsx`.

### Lateral: Recentes (mini histórico) e projeto na conversa (2026-10-28, sem release)

- `RecentesConversas.tsx`: abaixo de CHATS, as 6 conversas mais novas do Histórico (Claude + Codex, todos os projetos), sem
  as já abertas (`external_session_id`). Ícone do projeto no canto do avatar do agente, projeto e conta na 2ª linha; clique
  retoma via `resumeHistory` do App (prop `onResumeHistory`); "Ver histórico completo" abre o Histórico.
- `ProjetosContext` (`features/projects/projetosContext.ts`, provido no App): acha o projeto (e o ícone escolhido) por pasta.
  Topo da aba de conversa mostra ícone + nome do projeto (some o nome em aba estreita).
- CSS: linhas da lateral com leve deslize no hover, avatar acende, item ativo com anel e brilho. Teste: `RecentesConversas.test.tsx`.

### Lateral e Histórico: ícone do projeto em todo lugar, sem "projetos" aleatórios (2026-10-29, sem release)

- CHATS também tem o ícone do projeto no canto do avatar (`IconeDoProjetoDaSessao`, por `session.cwd`). Cabeçalhos das seções
  (`.lateral-secao`) com fio na cor do tema; selo do projeto acende no hover/ativo.
- Histórico: `pastaDoProjeto` (historyService) junta conversas de subpastas descartáveis no projeto pai — o DOMUS-ADPILOT roda
  o Claude em `.worker-data/videos/<uuid>`, e cada uuid virava um "projeto". Regra: projeto do OMNI mais fundo que contém a
  pasta; fora deles, corta na primeira pasta oculta. Filtro com ícone + "N conversas", projetos do OMNI primeiro, busca a partir
  de 7 opções; linha com selo do projeto e "subpasta"; detalhe com ícone. Travado (Novo agente) segue pasta exata (o `--resume`).
  Teste: `historyService.test.ts`.

### Lateral premium: linhas de projetos, chats, terminais e recentes (2026-10-29, sem release)

- Bloco "Lateral premium" no fim do `index.css`: superfície com fio de luz no topo, reflexo atravessando a linha no hover, avatar em vidro, anel girando em volta do agente trabalhando (`@property --lateral-giro`), luz correndo na barra de quem trabalha, brilho pulsando em quem pede aprovação, entrada suave e ações do hover em vidro (`.lateral-acoes`).
- `Sidebar.tsx`: linha do chat ganhou `data-status` (status da conversa; terminal rodando = trabalhando). Respeita reduzir movimento e animações desligadas.
- Compacta: linhas da lateral ~50px → ~38px (avatar 26px, respiro e entrelinha menores), só dentro do `aside` (Histórico mantém o tamanho).

### Troca de conta no limite: tela nova do Claude 2.1.312 (2026-10-29, sem release)

- Causa: o Claude passou a mostrar o limite no rodapé (`⚠ Usage limit reached · limit resets…` + `Continuing automatically at… · Esc to cancel`). O "Esc to cancel" fazia `cancelavel()` achar menu aberto → campo "não reconhecido" e troca manual bloqueada; o aviso não virava `usage_limit` (⚠ fora dos marcadores + contagem do turno), então a troca automática nunca disparava.
- Correção: `limite_no_rodape` (main.rs) lê o estado atual embaixo do campo e marca `usage_limit` independente da contagem; `cancelavel` ignora a linha "continuing automatically"; ⚠ entrou em `MARCADORES`. Na interface, `podeReabrir` libera trocar conta/modelo com o agente parado ou no limite (só bloqueia trabalhando).
- Rede: tela real `tests-fixtures/telas/claude.nada.limite-continua-sozinho-2.1.312.txt` (o `telas_do_acervo` cobra campo livre + limite em toda tela `.limite-`) e teste `rodape_do_limite_vale_mesmo_com_o_aviso_ja_na_tela`.
- Pendente: chega ao app instalado só na próxima release.

### Web/celular: projetos certos, ícones do PC, layouts, arrastar e Ajustes com avisos (2026-10-29, sem release)

- **Engine**: `raiz_do_projeto`/`dono_da_pasta` (mobile.rs) — mesma regra de `pastaDoProjeto`: subpasta descartável
  (`.worker-data/videos/<uuid>`) conta como do projeto pai, na lista de projetos e no `project_id` das conversas do
  histórico. Teste `subpasta_descartavel_conta_como_do_projeto_pai`.
- **Ícone do projeto na web**: o desktop publica o ícone efetivo (`useWorkspace` → `PublishedProject.icone`, escolhido
  ou o favicon achado). O caminho **não** sai no HTTP: o catálogo só diz `icone: true`, e `GET /projetos/{id}/icone`
  devolve `{tipo, dados}` via `omni_core::feed::icone_do_projeto` (canônico dentro da pasta do projeto, imagem, ≤256 KB;
  teste no feed.rs). Web/celular: `src/mobile/IconeDoProjeto.tsx` (lista de projetos, cartões, filtro do histórico).
- Web: filtro do histórico virou `Select` com ícone e "N conversas" (só projetos com conversa). `Select` ganhou `aria-label`.
- Web: **Layouts** no topo (o mesmo `LayoutPresetPicker` do PC, agora com `onEscolher`/`atual`/`onAutomatico`); o centro
  monta as células pelo molde (`celulas`), até 6 conversas. **Arrastar**: cartão da lateral → célula; topo do painel →
  outra célula troca de lugar (`colocarNaCelula`). Layout guardado no navegador (`omni-web-layout`). Botão de avisos no topo.
- Celular: **barra de baixo** (Início · Precisa de você com contador · Ajustes) e tela **Ajustes** (`#/ajustes`,
  `AjustesDoAparelho.tsx`): notificações (pedir permissão, aprovação, terminou, vibrar, com a página na tela, teste),
  conexão (PC, versão, versão de computador) e "Desconectar este aparelho" com confirmação. Uso/Prévia foram para o fim do início.
- Avisos: `src/mobile/notificacoes.ts` + `src/mobile/sw.js` (emitido no build, público em `/sw.js`; só mostra aviso e
  foca a página no toque). Só em HTTPS (modo "Seguro com HTTPS"); com a página fechada de vez não chega — Web Push
  (VAPID) seria o próximo passo. Histórico do PC: botões no padrão das Configurações (`:is(.settings-conteudo, .historico)`).
- Testes: `celularAjustes.test.tsx`, `WebApp.test.tsx` (Select), `useWorkspace.test.tsx` (publicação agora assíncrona).
- Depois: **Configurações na web** (engrenagem no topo, `#/ajustes`): a mesma `AjustesDoAparelho` (prop `pagina`, `children`)
  + grupo "Tela" com o layout das conversas. Celular: engrenagem também no topo do início. Lateral do PC: **busca nos
  Recentes** (input ali mesmo, procura no histórico inteiro, até 10 resultados).

### Seletor de ícone abria sozinho (2026-10-28, sem release)

- Trocar de aba na lateral e voltar remontava `AvatarDoProjeto`/`AvatarDoWorkspace` com o `pedido` antigo (contador guardado
  no Sidebar) e o efeito reabria o seletor. `useAbrirAoPedir` ignora o valor da montagem; teste em `iconesDoProjeto.test.tsx`.
