# CLAUDE.md

**OMNI AGENTS**: multiplexador de terminais e CLIs de agentes (Claude Code, Codex, Cursor, Antigravity) para
desktop, com web/celular espelhando as conversas. Spec: `spec.md`. Textos de UI em pt-BR.

## Roadmap obrigatório

Registre todo progresso em `roadmaps/omni-agents/roadmap.md` (pendências + entregas novas) antes de encerrar o
turno. O histórico até a v0.7.7 está em `roadmaps/omni-agents/roadmap-historico.md`: grep lá antes de mexer num
assunto antigo. Fluxos/orquestração: `roadmaps/orquestracao/roadmap.md`. Os outros roadmaps são do CAMPS-UTILS
(projeto de origem) e não valem aqui.

## Arquitetura

| Peça | Onde | Papel |
|---|---|---|
| UI desktop | `src/` (React/TS/Vite, Tauri 2) | Workspaces, panes, tabs, visão Conversa, Configurações |
| Shell Tauri | `src-tauri/src/` | Comandos nativos; fala com o engine por `engine_client.rs` |
| Engine | `crates/omni-engine/` (binário à parte, sidecar) | PTYs, detecção de estado, servidor web/celular (axum), executor de Fluxos. Sobrevive à janela fechada |
| Core | `crates/omni-core/` | Regras sem I/O de processo: conversas, feed, uso, fluxos, exportar, extensões |
| Protocolo | `crates/omni-protocol/` | Contrato IPC (JSON em loopback com token) |
| Web/celular | `src/mobile/`, `src/web/` | Mesmo `ConversationDetail` serve web, celular e a aba de agente do desktop |

- O desktop chama as rotas do engine por `engineApi` (`src/features/terminal/terminalService.ts`); web/celular
  por HTTP (`src/mobile/api.ts`). As rotas ficam em `crates/omni-engine/src/mobile.rs`.
- Estado do agente (trabalhando/esperando/aprovação) vem da **leitura da tela da CLI** (`main.rs`,
  `interaction.rs`). Texto novo de uma CLI quebra isso em silêncio: a rede é o acervo de telas reais
  `crates/omni-engine/tests-fixtures/telas/` (ver o `LEIA.md` dele) — capture a tela nova antes de mexer.
- Mudou o engine? `npm run dev` recompila; o app instalado só pega numa release.

## Comandos

```bash
npm run dev          # build:engine + tauri dev
npm run test         # vitest (jsdom)
npm run typecheck
cargo test --workspace
npx vitest run src/test/X.test.tsx
```

## Releases

Fonte da versão: `VERSION` → `npm run version:sync`. Novidades em `src/lib/changelog.ts`, em linguagem de usuário
(um teste reprova jargão). Depois, passo a passo com `node scripts/release.mjs validar | publicar | aguardar |
liberar | registrar` (o build assinado roda no GitHub Actions, `release.yml`, com os secrets de assinatura).

- **Publicar exige pedido explícito do usuário a cada vez.**
- `publicar` faz `git add -A`: com outra sessão mexendo no projeto, o trabalho dela vai junto. Confira o
  `git status` antes.
- Release do app nunca é pre-release: o updater lê
  `https://github.com/FelipeCamposM/OMNI-AGENTS/releases/latest/download/latest.json`.
- Chave de assinatura: `~/.tauri/omni-agents.key`. Perder chave ou senha = ninguém instalado recebe update.
  **Nunca rode `npx tauri signer --help`**: imprime as variáveis de ambiente (vazou chave antes).

## Armadilhas

- **CSP do `tauri.conf.json` não vale em `tauri dev`.** Leitura local (`convertFileSrc`) precisa de
  `http://asset.localhost`, `https://asset.localhost` e `asset:` (travado por `src/test/csp.test.ts`).
  **Não ligue `useHttpsScheme`**: muda a origem e todo mundo perde o localStorage.
- CSP do servidor web proíbe o atributo `style` no HTML; estilo posto por JS/React (CSSOM) funciona.
- Duas sessões do Claude costumam editar o projeto ao mesmo tempo: em `App.tsx`, `Sidebar.tsx`, `index.css`
  etc., só hunks pequenos e direcionados; nunca reverta mudança que não é sua.
- Não mate processos do app instalado sem perguntar: fecha os terminais vivos do usuário.
- Apagar conversa/duplicata vai para a Lixeira, nunca definitivo sem confirmação.
- Dados de extensões/MCP chegam à tela sem segredos; o token do celular só faz GET local de leitura.
