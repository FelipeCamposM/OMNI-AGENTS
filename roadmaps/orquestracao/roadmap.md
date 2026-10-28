# Orquestração de agentes — roadmap

> Times de agentes e fluxos "Tarefa → PR" dentro do OMNI, montados num editor visual estilo n8n.
> Iniciado em 2026-10-17. Registrar o progresso aqui (e uma linha no `roadmaps/omni-agents/roadmap.md`).

## Decisões (do usuário, 2026-10-17)

1. **Modelos de agentes nos dois lugares**: globais (`~/.omni/agents/*.md`, valem em todo projeto) e do projeto
   (`<projeto>/.omni/agents/*.md`, vão no git). Global é o padrão.
2. **PR só no GitHub**, pelo `gh` (já instalado e logado).
3. **Nós dos fluxos rodam sem tela** (`claude -p --output-format stream-json`, `codex exec --json`), mas com:
   - histórico de cada nó para ver o que foi feito;
   - **pausar tudo**;
   - abrir um agente específico numa conversa e pedir para ele **reverter** o que fez.
4. **Visual estilo n8n**: canvas com nós e conexões.

## Formato do modelo de agente

`.md` com cabeçalho no mesmo espírito dos subagentes do Claude Code (`.claude/agents/*.md`):

```md
---
name: qa
description: Testa a entrega e devolve o que falhou com passos para reproduzir.
cli: claude          # claude | codex | cursor
modelo: opus         # opcional; vazio = padrão da CLI
conta:               # opcional; id da conta; vazio = qualquer
ferramentas: [Bash, Read, Grep]
saida: veredito      # texto | plano | veredito | relatorio
---
Instruções do agente (system prompt)...
```

"Instalar no Claude Code" grava uma cópia em `<projeto>/.claude/agents/<name>.md` (formato nativo:
`name`, `description`, `tools`, `model`) para o Claude Code usar como subagente.

## Etapas

### Etapa 1 — Biblioteca de agentes (feita 2026-10-17)
- [x] `crates/omni-core/src/agentes.rs`: ler/gravar/apagar (global `~/.omni/agents` + projeto `.omni/agents`),
      parser do cabeçalho (aceita também `tools`/`model` do Claude Code), nome validado (vira arquivo), kit de 7
      modelos em `crates/omni-core/agentes-kit/*.md` semeado na 1ª leitura, `instalar_no_claude_code`,
      `pedido_de_criacao` + `modelo_da_resposta`. 5 testes.
- [x] `src-tauri/src/agentes.rs`: `agentes_listar/salvar/apagar/restaurar_kit/instalar_claude/criar_com_ia`
      (`claude -p --output-format json --model sonnet`, pedido pela stdin, pasta temporária, conta pedida ou a
      primeira com login, limite de 180 s). Testado de verdade: modelo válido em ~17 s.
- [x] Configurações → **Modelos de agentes** (`src/features/agentes/ModelosDeAgentes.tsx`): criar com IA, em branco,
      restaurar kit, cartões com filtro Todos/Globais/Do projeto, editar (nome, escopo, CLI, modelo, conta, saída,
      ferramentas, instruções), duplicar, instalar no Claude Code, abrir arquivo, apagar com confirmação.

### Etapa 2 — Motor de fluxos (feita em boa parte, 2026-10-17)
- [x] `crates/omni-core/src/fluxos.rs`: formato (`Fluxo`, `No`, `Conexao`; tipos entrada/agente/condicao/aprovacao/
      sala/pr/fim), validação, salvar/listar/apagar (global `~/.omni/fluxos` + projeto), prontos em
      `crates/omni-core/fluxos-prontos/` (**Tarefa → PR** e **Time de agentes**, semeados na 1ª leitura),
      `montar_prompt` ({{entrada}}, {{anterior}}, {{no:id}}), `veredito` (JSON ou palavra), prompts da sala/ata. 4 testes.
- [x] `crates/omni-engine/src/fluxos.rs`: executor por thread; git worktree por execução (`<engine>/worktrees/<id>`,
      branch `omni/<fluxo>-<id>`); `claude -p --output-format stream-json` (instruções em `--append-system-prompt`,
      `--allowedTools` do modelo, `--permission-mode acceptEdits`) e `codex exec --json`; histórico por nó em
      `<engine>/execucoes/<id>/<no>.log`; estado em `<id>.json` a cada passo (reinício → pausado); condição com
      limite de voltas; aprovação para e espera; sala em rodadas até `CONSENSO` + ata; PR com commit/push/`gh pr create`;
      pausar (mata o processo; retomar usa `--resume` da sessão), retomar (inclui nó que falhou), cancelar;
      `abrir_conversa` cria uma sessão interativa `claude --resume <sid>` no worktree, na mesma conta.
      Teste sem CLI (aprovação) + execução real conferida (QA num repo temporário: worktree, sessão, custo, veredito).
- [x] Rotas no engine (`mobile.rs`): `GET/POST /fluxos/execucoes`, `GET /fluxos/execucoes/{id}`,
      `POST .../{pausar|retomar|cancelar}`, `GET .../nos/{no}/historico`, `POST .../nos/{no}/aprovar`, `POST .../nos/{no}/conversa`.
- [x] Ramos paralelos (2026-10-25): a fila roda em lotes, cada passo numa thread (`executar`, `crates/omni-engine/src/fluxos.rs`), e o nó **Juntar** espera todos os ramos. Ainda no mesmo worktree (ver `ponytail:` no executor).
- [x] Aprovação de fluxo na fila "Precisa de você" da web/celular (2026-10-25, `src/mobile/AprovacoesDeFluxo.tsx`).
- [ ] Escolher conta com uso disponível (hoje: conta do modelo, senão a principal da CLI).

### Etapa 3 — Editor visual estilo n8n (feita, 2026-10-17)
- [x] `src/features/fluxos/` (`FluxosView.tsx`, `NoDoFluxo.tsx`, `fluxosService.ts`) com `@xyflow/react`: lateral
      "Fluxos de agentes" no app; fluxos salvos + execuções; canvas com paleta (Agente, Condição, Aprovação, Time, PR,
      Fim), arrastar, conectar por saída (sim/não/esgotou), apagar; painel do nó (modelo, prompt com marcadores,
      limite de voltas, pergunta, participantes/rodadas/objetivo, título do PR); salvar/apagar (global ou projeto);
      Executar (tarefa + projeto aberto).
- [x] Execução ao vivo no mesmo canvas: cor por estado (rodando pulsa, sua vez, falhou), voltas/tempo/custo no nó,
      aresta animada, centraliza no nó vivo; painel com aprovar/recusar, **Abrir numa conversa** (aba no workspace),
      histórico (fala + ações) e saída; barra com Pausar/Retomar/Cancelar, branch e link do PR.
- [ ] Tela de fluxos na web/celular.

### Etapa 4 — Polimento, IA e manual (feita, 2026-10-17)
- [x] Modelo/IA/esforço: `esforco` no `.md` (`crates/omni-core/src/agentes.rs`, kit), `agentes_modelos` (lista por
      CLI), `SeletorDeModelo` no editor de agente e override por nó (`config.modelo/esforco`); executor passa
      `--effort` (claude) / `model_reasoning_effort` (codex) — `crates/omni-engine/src/fluxos.rs`.
- [x] Criar agente com IA com system prompt de mercado (`crates/omni-core/prompts/criar-agente.md`), também
      direto do painel do nó ("Criar novo agente com IA").
- [x] Criar fluxo inteiro com IA (`prompts/criar-fluxo.md`, `fluxos_criar_com_ia`, prévia antes de abrir) e
      Importar/Copiar JSON.
- [x] Execução mais informativa: `atividade` por nó (o que o agente faz agora), resumo com branch/base/worktree
      (abre a pasta), duração, custo, plano do orquestrador e linha do tempo; cartão de início "O que vai acontecer".
- [x] Canvas: arestas próprias (`ArestaDoFluxo.tsx`, degrau + seta, rótulo sim/não junto da porta, × para
      remover), soltar conexão no vazio abre menu da próxima etapa, duplicar/apagar no nó, snap, portas maiores.
- [x] Rodapé (conta git, branch, uso, engine) também na tela de fluxos (`RodapeDoProjeto` em `WorkspaceView.tsx`).
- [x] Manual com prints (`src/features/agentes/ManualDeAgentes.tsx`, `public/manual/*.webp`, gerados com dados
      fictícios pelo Playwright + mock).
- [x] `config` ausente/null no JSON vira `{}` no Rust (a tela quebrava com fluxo sem `config`).
- [ ] Engine precisa ser recompilado (`npm run build:engine`) para o executor novo valer no app instalado/dev.
